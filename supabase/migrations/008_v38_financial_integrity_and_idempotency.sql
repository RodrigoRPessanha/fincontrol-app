-- ==============================================================================
-- MIGRATION 008: INTEGRIDADE FINANCEIRA, IDEMPOTÊNCIA E PROTEÇÃO DE RATEIOS
-- ==============================================================================
-- 1. Habilitação formal da extensão pgtap para testes de banco
-- 2. Conservação exata de rateios (tolerância zero R$ 0,00) em transações e compras
-- 3. Bloqueio de mutação direta em transaction_splits e purchase_splits fora de RPCs
-- 4. Idempotência transacional em transfers (coluna idempotency_key + RPC atualizada)
-- 5. Limpeza de variáveis não utilizadas em fn_create_credit_card_transaction e fn_create_installment_purchase
-- 6. Revisão de grants e search_path seguro
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. EXTENSÃO PGTAP
-- ------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgtap;

-- ------------------------------------------------------------------------------
-- 2. IDEMPOTÊNCIA EM TRANSFERS
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'transfers' AND column_name = 'idempotency_key'
    ) THEN
        ALTER TABLE public.transfers ADD COLUMN idempotency_key TEXT;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transfers_workspace_idempotency 
    ON public.transfers(workspace_id, idempotency_key) 
    WHERE idempotency_key IS NOT NULL;

-- Atualização da RPC fn_create_transfer com suporte a chave de idempotência
DROP FUNCTION IF EXISTS public.fn_create_transfer(UUID, UUID, UUID, NUMERIC, DATE, TEXT);
DROP FUNCTION IF EXISTS public.fn_create_transfer(UUID, UUID, UUID, NUMERIC, DATE, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.fn_create_transfer(
    p_workspace_id UUID,
    p_from_account_id UUID,
    p_to_account_id UUID,
    p_amount NUMERIC(12, 2),
    p_transfer_date DATE DEFAULT CURRENT_DATE,
    p_notes TEXT DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_existing_id UUID;
    v_transfer_id UUID;
    v_first_acc UUID;
    v_second_acc UUID;
    v_clean_key TEXT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: permissão insuficiente no workspace.';
    END IF;

    -- Verificação de Idempotência: retorna transferência existente sem debitar novamente
    v_clean_key := NULLIF(TRIM(p_idempotency_key), '');
    IF v_clean_key IS NOT NULL THEN
        SELECT id INTO v_existing_id
        FROM public.transfers
        WHERE workspace_id = p_workspace_id AND idempotency_key = v_clean_key;

        IF v_existing_id IS NOT NULL THEN
            RETURN v_existing_id;
        END IF;
    END IF;

    IF p_from_account_id = p_to_account_id THEN
        RAISE EXCEPTION 'A conta de origem e destino devem ser diferentes.';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'O valor da transferência deve ser maior que zero.';
    END IF;

    -- Deadlock prevention por ordenação determinística de IDs
    IF p_from_account_id < p_to_account_id THEN
        v_first_acc := p_from_account_id;
        v_second_acc := p_to_account_id;
    ELSE
        v_first_acc := p_to_account_id;
        v_second_acc := p_from_account_id;
    END IF;

    PERFORM 1 FROM public.accounts WHERE id = v_first_acc AND workspace_id = p_workspace_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Conta % não pertence ao workspace informado.', v_first_acc;
    END IF;

    PERFORM 1 FROM public.accounts WHERE id = v_second_acc AND workspace_id = p_workspace_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Conta % não pertence ao workspace informado.', v_second_acc;
    END IF;

    INSERT INTO public.transfers (
        workspace_id, from_account_id, to_account_id, amount,
        transfer_date, notes, created_by, idempotency_key
    ) VALUES (
        p_workspace_id, p_from_account_id, p_to_account_id, p_amount,
        COALESCE(p_transfer_date, CURRENT_DATE), p_notes, v_user_id, v_clean_key
    ) RETURNING id INTO v_transfer_id;

    UPDATE public.accounts SET current_balance = current_balance - p_amount WHERE id = p_from_account_id;
    UPDATE public.accounts SET current_balance = current_balance + p_amount WHERE id = p_to_account_id;

    RETURN v_transfer_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. PROTEÇÃO CONTRA MUTAÇÃO DIRETA EM RATEIOS FORA DE RPCS
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_prevent_direct_split_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF current_setting('app.allow_split_mutation', true) IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'A alteração direta de frações de rateio é proibida. Utilize a função fn_set_transaction_splits ou fn_set_purchase_splits.';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_direct_tx_split_mutation ON public.transaction_splits;
CREATE TRIGGER trg_prevent_direct_tx_split_mutation
    BEFORE INSERT OR UPDATE OR DELETE ON public.transaction_splits
    FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_direct_split_mutation();

DROP TRIGGER IF EXISTS trg_prevent_direct_purchase_split_mutation ON public.purchase_splits;
CREATE TRIGGER trg_prevent_direct_purchase_split_mutation
    BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_splits
    FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_direct_split_mutation();

-- ------------------------------------------------------------------------------
-- 4. CONSERVAÇÃO EXATA DE RATEIOS (TOLERÂNCIA ZERO R$ 0,00)
-- ------------------------------------------------------------------------------

-- 4.1. Rateios de Transação com Soma Exata e Flag Transacional
CREATE OR REPLACE FUNCTION public.fn_set_transaction_splits(
    p_workspace_id UUID,
    p_transaction_id UUID,
    p_splits JSONB
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_tx_amount NUMERIC(12, 2);
    v_split RECORD;
    v_total_split NUMERIC(12, 2) := 0;
    v_count INT := 0;
    v_member_id UUID;
    v_amount NUMERIC(12, 2);
    v_pct NUMERIC(5, 2);
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: permissão insuficiente no workspace.';
    END IF;

    SELECT amount INTO v_tx_amount
    FROM public.transactions
    WHERE id = p_transaction_id AND workspace_id = p_workspace_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transação não encontrada no workspace especificado.';
    END IF;

    -- Permite alteração controlada nesta transação
    PERFORM set_config('app.allow_split_mutation', 'true', true);

    -- Se lista for vazia ou nula, remove rateios existentes
    IF p_splits IS NULL OR jsonb_array_length(p_splits) = 0 THEN
        DELETE FROM public.transaction_splits WHERE transaction_id = p_transaction_id;
        RETURN 0;
    END IF;

    -- Validação estrita de cada item do array de rateio
    FOR v_split IN SELECT * FROM jsonb_to_recordset(p_splits) AS x(member_id UUID, amount NUMERIC, percentage NUMERIC) LOOP
        v_member_id := v_split.member_id;
        v_amount := v_split.amount;
        v_pct := v_split.percentage;

        IF v_member_id IS NULL THEN
            RAISE EXCEPTION 'Cada fração de rateio deve informar um member_id válido.';
        END IF;

        IF v_amount IS NULL OR v_amount < 0 THEN
            RAISE EXCEPTION 'O valor de cada fração de rateio não pode ser negativo.';
        END IF;

        IF v_pct IS NOT NULL AND (v_pct < 0 OR v_pct > 100) THEN
            RAISE EXCEPTION 'O percentual de cada fração de rateio deve estar entre 0 e 100.';
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM public.workspace_members 
            WHERE id = v_member_id AND workspace_id = p_workspace_id
        ) THEN
            RAISE EXCEPTION 'O participante do rateio (%) não pertence ao workspace.', v_member_id;
        END IF;

        v_total_split := v_total_split + v_amount;
    END LOOP;

    -- Conservação financeira estrita: tolerância ZERO (diferença de centavos proibida)
    IF v_total_split <> v_tx_amount THEN
        RAISE EXCEPTION 'A soma das frações do rateio (R$ %) deve ser exatamente igual ao valor total da transação (R$ %).', v_total_split, v_tx_amount;
    END IF;

    -- Aplicação atômica: substituição completa
    DELETE FROM public.transaction_splits WHERE transaction_id = p_transaction_id;

    FOR v_split IN SELECT * FROM jsonb_to_recordset(p_splits) AS x(member_id UUID, amount NUMERIC, percentage NUMERIC) LOOP
        INSERT INTO public.transaction_splits (workspace_id, transaction_id, member_id, amount, percentage)
        VALUES (p_workspace_id, p_transaction_id, v_split.member_id, v_split.amount, v_split.percentage);
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

-- 4.2. Rateios de Compra Parcelada com Soma Exata e Flag Transacional
CREATE OR REPLACE FUNCTION public.fn_set_purchase_splits(
    p_workspace_id UUID,
    p_purchase_id UUID,
    p_splits JSONB
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_purchase_amount NUMERIC(12, 2);
    v_split RECORD;
    v_total_split NUMERIC(12, 2) := 0;
    v_count INT := 0;
    v_member_id UUID;
    v_amount NUMERIC(12, 2);
    v_pct NUMERIC(5, 2);
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: permissão insuficiente no workspace.';
    END IF;

    SELECT total_amount INTO v_purchase_amount
    FROM public.purchases
    WHERE id = p_purchase_id AND workspace_id = p_workspace_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Compra parcelada não encontrada no workspace especificado.';
    END IF;

    -- Permite alteração controlada nesta transação
    PERFORM set_config('app.allow_split_mutation', 'true', true);

    -- Se lista for vazia ou nula, remove rateios existentes
    IF p_splits IS NULL OR jsonb_array_length(p_splits) = 0 THEN
        DELETE FROM public.purchase_splits WHERE purchase_id = p_purchase_id;
        RETURN 0;
    END IF;

    -- Validação estrita
    FOR v_split IN SELECT * FROM jsonb_to_recordset(p_splits) AS x(member_id UUID, amount NUMERIC, percentage NUMERIC) LOOP
        v_member_id := v_split.member_id;
        v_amount := v_split.amount;
        v_pct := v_split.percentage;

        IF v_member_id IS NULL THEN
            RAISE EXCEPTION 'Cada fração de rateio deve informar um member_id válido.';
        END IF;

        IF v_amount IS NULL OR v_amount < 0 THEN
            RAISE EXCEPTION 'O valor de cada fração de rateio não pode ser negativo.';
        END IF;

        IF v_pct IS NOT NULL AND (v_pct < 0 OR v_pct > 100) THEN
            RAISE EXCEPTION 'O percentual de cada fração de rateio deve estar entre 0 e 100.';
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM public.workspace_members 
            WHERE id = v_member_id AND workspace_id = p_workspace_id
        ) THEN
            RAISE EXCEPTION 'O participante do rateio (%) não pertence ao workspace.', v_member_id;
        END IF;

        v_total_split := v_total_split + v_amount;
    END LOOP;

    -- Conservação financeira estrita: tolerância ZERO
    IF v_total_split <> v_purchase_amount THEN
        RAISE EXCEPTION 'A soma das frações do rateio (R$ %) deve ser exatamente igual ao valor total da compra (R$ %).', v_total_split, v_purchase_amount;
    END IF;

    DELETE FROM public.purchase_splits WHERE purchase_id = p_purchase_id;

    FOR v_split IN SELECT * FROM jsonb_to_recordset(p_splits) AS x(member_id UUID, amount NUMERIC, percentage NUMERIC) LOOP
        INSERT INTO public.purchase_splits (workspace_id, purchase_id, member_id, amount, percentage)
        VALUES (p_workspace_id, p_purchase_id, v_split.member_id, v_split.amount, v_split.percentage);
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. LIMPEZA DE VARIÁVEIS EM COMPRAS DE CARTÃO E PARCELADAS
-- ------------------------------------------------------------------------------

-- 5.1. fn_create_credit_card_transaction sem variável v_card_due não lida
CREATE OR REPLACE FUNCTION public.fn_create_credit_card_transaction(
    p_workspace_id UUID,
    p_credit_card_id UUID,
    p_description TEXT,
    p_amount NUMERIC(12, 2),
    p_transaction_date DATE DEFAULT CURRENT_DATE,
    p_category_id UUID DEFAULT NULL,
    p_payment_method_id UUID DEFAULT NULL,
    p_paid_by_member_id UUID DEFAULT NULL,
    p_split_type TEXT DEFAULT 'individual'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_card_closing INT;
    v_p_day INT;
    v_p_month INT;
    v_p_year INT;
    v_bill_month INT;
    v_bill_year INT;
    v_ref_month TEXT;
    v_bill_id UUID;
    v_due_date DATE;
    v_tx_id UUID;
    v_split_mode TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: você não possui permissão de escrita neste workspace.';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'O valor da transação deve ser estritamente maior que zero.';
    END IF;

    v_split_mode := COALESCE(p_split_type, 'individual');
    IF v_split_mode NOT IN ('individual', 'equal', 'full_other', 'custom') THEN
        RAISE EXCEPTION 'Tipo de rateio inválido.';
    END IF;

    IF p_paid_by_member_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.workspace_members 
        WHERE id = p_paid_by_member_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Membro pagador informado não pertence ao workspace.';
    END IF;

    SELECT closing_day INTO v_card_closing
    FROM public.credit_cards
    WHERE id = p_credit_card_id AND workspace_id = p_workspace_id;

    IF v_card_closing IS NULL THEN
        RAISE EXCEPTION 'Cartão de crédito não encontrado no workspace informado.';
    END IF;

    IF p_category_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.categories WHERE id = p_category_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Categoria informada não pertence ao workspace.';
    END IF;

    IF p_payment_method_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.payment_methods WHERE id = p_payment_method_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Método de pagamento informado não pertence ao workspace.';
    END IF;

    v_p_day := EXTRACT(DAY FROM p_transaction_date)::INT;
    v_p_month := EXTRACT(MONTH FROM p_transaction_date)::INT;
    v_p_year := EXTRACT(YEAR FROM p_transaction_date)::INT;

    v_bill_month := v_p_month;
    v_bill_year := v_p_year;
    IF v_p_day > v_card_closing THEN
        v_bill_month := v_bill_month + 1;
        IF v_bill_month > 12 THEN
            v_bill_month := 1;
            v_bill_year := v_bill_year + 1;
        END IF;
    END IF;

    v_ref_month := v_bill_year || '-' || LPAD(v_bill_month::TEXT, 2, '0');
    v_bill_id := public.fn_get_or_create_credit_card_bill(p_workspace_id, p_credit_card_id, v_ref_month);

    UPDATE public.credit_card_bills
    SET total_amount = total_amount + p_amount,
        status = CASE WHEN paid_amount >= total_amount + p_amount AND total_amount + p_amount > 0 THEN 'paid' WHEN paid_amount > 0 THEN 'partially_paid' ELSE 'open' END,
        paid_at = CASE WHEN paid_amount >= total_amount + p_amount AND total_amount + p_amount > 0 THEN paid_at ELSE NULL END
    WHERE id = v_bill_id
    RETURNING due_date INTO v_due_date;

    INSERT INTO public.transactions (
        workspace_id, category_id, payment_method_id, credit_card_id,
        credit_card_bill_id, description, amount, type,
        transaction_date, due_date, status, created_by,
        paid_by_member_id, split_type
    )
    VALUES (
        p_workspace_id, p_category_id, p_payment_method_id, p_credit_card_id,
        v_bill_id, p_description, p_amount, 'expense',
        p_transaction_date, v_due_date, 'pending', auth.uid(),
        p_paid_by_member_id, v_split_mode
    )
    RETURNING id INTO v_tx_id;

    RETURN v_tx_id;
END;
$$;

-- 5.2. fn_create_installment_purchase sem variáveis não utilizadas
CREATE OR REPLACE FUNCTION public.fn_create_installment_purchase(
    p_workspace_id UUID,
    p_description TEXT,
    p_total_amount NUMERIC(12, 2),
    p_installment_count INT,
    p_purchase_date DATE DEFAULT CURRENT_DATE,
    p_credit_card_id UUID DEFAULT NULL,
    p_category_id UUID DEFAULT NULL,
    p_account_id UUID DEFAULT NULL,
    p_payment_method_id UUID DEFAULT NULL,
    p_paid_installments_count INT DEFAULT 0,
    p_paid_by_member_id UUID DEFAULT NULL,
    p_split_type TEXT DEFAULT 'individual'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_purchase_id UUID;
    v_base_amount NUMERIC(12, 2);
    v_remainder NUMERIC(12, 2);
    v_first_amount NUMERIC(12, 2);
    v_amount NUMERIC(12, 2);
    v_bill_id UUID;
    v_card_closing INT;
    v_p_day INT;
    v_p_month INT;
    v_p_year INT;
    v_start_month INT;
    v_start_year INT;
    v_cycle_month INT;
    v_cycle_year INT;
    v_ref_month TEXT;
    v_due_date DATE;
    v_is_paid BOOLEAN;
    v_paid_count INT;
    v_split_mode TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: você não possui permissão de escrita neste workspace.';
    END IF;

    IF p_installment_count < 1 OR p_installment_count > 120 THEN
        RAISE EXCEPTION 'A quantidade de parcelas deve estar entre 1 e 120.';
    END IF;

    IF p_total_amount <= 0 THEN
        RAISE EXCEPTION 'O valor total deve ser estritamente maior que zero.';
    END IF;

    IF p_total_amount < p_installment_count * 0.01 THEN
        RAISE EXCEPTION 'O valor total é insuficiente para gerar parcelas de no mínimo R$ 0,01.';
    END IF;

    v_paid_count := COALESCE(p_paid_installments_count, 0);
    IF v_paid_count < 0 OR v_paid_count > p_installment_count THEN
        RAISE EXCEPTION 'A quantidade de parcelas já pagas deve estar entre 0 e o total de parcelas.';
    END IF;

    v_split_mode := COALESCE(p_split_type, 'individual');
    IF v_split_mode NOT IN ('individual', 'equal', 'full_other', 'custom') THEN
        RAISE EXCEPTION 'Tipo de rateio inválido.';
    END IF;

    IF p_paid_by_member_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.workspace_members 
        WHERE id = p_paid_by_member_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Membro pagador informado não pertence ao workspace.';
    END IF;

    IF p_account_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.accounts WHERE id = p_account_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Conta bancária informada não pertence ao workspace.';
    END IF;

    IF p_category_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.categories WHERE id = p_category_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Categoria informada não pertence ao workspace.';
    END IF;

    IF p_payment_method_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.payment_methods WHERE id = p_payment_method_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Método de pagamento informado não pertence ao workspace.';
    END IF;

    INSERT INTO public.purchases (
        workspace_id, account_id, credit_card_id, category_id, payment_method_id,
        description, total_amount, installment_count, paid_installments_count,
        purchase_date, created_by, paid_by_member_id, split_type
    )
    VALUES (
        p_workspace_id, p_account_id, p_credit_card_id, p_category_id, p_payment_method_id,
        p_description, p_total_amount, p_installment_count, v_paid_count,
        p_purchase_date, auth.uid(), p_paid_by_member_id, v_split_mode
    )
    RETURNING id INTO v_purchase_id;

    v_base_amount := TRUNC(p_total_amount / p_installment_count, 2);
    v_remainder := p_total_amount - (v_base_amount * p_installment_count);
    v_first_amount := v_base_amount + v_remainder;

    IF p_credit_card_id IS NOT NULL THEN
        SELECT closing_day INTO v_card_closing
        FROM public.credit_cards
        WHERE id = p_credit_card_id AND workspace_id = p_workspace_id;

        IF v_card_closing IS NULL THEN
            RAISE EXCEPTION 'Cartão de crédito não encontrado no workspace informado.';
        END IF;

        v_p_day := EXTRACT(DAY FROM p_purchase_date)::INT;
        v_p_month := EXTRACT(MONTH FROM p_purchase_date)::INT;
        v_p_year := EXTRACT(YEAR FROM p_purchase_date)::INT;

        v_start_month := v_p_month;
        v_start_year := v_p_year;
        IF v_p_day > v_card_closing THEN
            v_start_month := v_start_month + 1;
            IF v_start_month > 12 THEN
                v_start_month := 1;
                v_start_year := v_start_year + 1;
            END IF;
        END IF;

        FOR i IN 1..p_installment_count LOOP
            v_amount := CASE WHEN i = 1 THEN v_first_amount ELSE v_base_amount END;
            v_is_paid := (i <= v_paid_count);

            v_cycle_month := v_start_month + (i - 1);
            v_cycle_year := v_start_year;
            WHILE v_cycle_month > 12 LOOP
                v_cycle_month := v_cycle_month - 12;
                v_cycle_year := v_cycle_year + 1;
            END LOOP;

            v_ref_month := v_cycle_year || '-' || LPAD(v_cycle_month::TEXT, 2, '0');
            v_bill_id := public.fn_get_or_create_credit_card_bill(p_workspace_id, p_credit_card_id, v_ref_month);

            UPDATE public.credit_card_bills
            SET total_amount = total_amount + v_amount
            WHERE id = v_bill_id
            RETURNING due_date INTO v_due_date;

            INSERT INTO public.installments (
                purchase_id, installment_number, amount, due_date, credit_card_bill_id,
                status, paid_amount, paid_at
            )
            VALUES (
                v_purchase_id, i, v_amount, v_due_date, v_bill_id,
                CASE WHEN v_is_paid THEN 'paid' ELSE 'pending' END,
                CASE WHEN v_is_paid THEN v_amount ELSE 0.00 END,
                CASE WHEN v_is_paid THEN p_purchase_date::TIMESTAMPTZ ELSE NULL END
            );
        END LOOP;
    ELSE
        FOR i IN 1..p_installment_count LOOP
            v_amount := CASE WHEN i = 1 THEN v_first_amount ELSE v_base_amount END;
            v_is_paid := (i <= v_paid_count);
            v_due_date := p_purchase_date + ((i - 1) || ' month')::INTERVAL;

            INSERT INTO public.installments (
                purchase_id, installment_number, amount, due_date, credit_card_bill_id,
                status, paid_amount, paid_at
            )
            VALUES (
                v_purchase_id, i, v_amount, v_due_date, NULL,
                CASE WHEN v_is_paid THEN 'paid' ELSE 'pending' END,
                CASE WHEN v_is_paid THEN v_amount ELSE 0.00 END,
                CASE WHEN v_is_paid THEN p_purchase_date::TIMESTAMPTZ ELSE NULL END
            );
        END LOOP;
    END IF;

    RETURN v_purchase_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. PRIVILÉGIOS E SEARCH_PATH
-- ------------------------------------------------------------------------------
ALTER FUNCTION public.fn_prevent_direct_split_mutation() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_create_transfer(UUID, UUID, UUID, NUMERIC, DATE, TEXT, TEXT) SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_set_transaction_splits(UUID, UUID, JSONB) SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_set_purchase_splits(UUID, UUID, JSONB) SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_create_credit_card_transaction(UUID, UUID, TEXT, NUMERIC, DATE, UUID, UUID, UUID, TEXT) SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_create_installment_purchase(UUID, TEXT, NUMERIC, INT, DATE, UUID, UUID, UUID, UUID, INT, UUID, TEXT) SET search_path = public, pg_temp;

REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM PUBLIC, anon;
GRANT EXECUTE ON ALL ROUTINES IN SCHEMA public TO authenticated;
