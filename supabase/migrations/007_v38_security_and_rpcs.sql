-- ==============================================================================
-- MIGRATION 007: V38 SEGURANÇA, RLS, RPCs ATÔMICAS E CONTROLE DE ACESSO
-- ==============================================================================
-- 1. Políticas RLS completas para tabelas novas:
--    - transaction_splits
--    - purchase_splits
--    - settlements
-- 2. Endurecimento de RPCs atômicas:
--    - fn_create_workspace (com suporte a tracking_mode)
--    - fn_transfer_workspace_ownership (revalidação e grants)
--    - fn_create_credit_card_transaction (com paid_by_member_id e split_type)
--    - fn_create_installment_purchase (com paid_by_member_id e split_type)
--    - fn_record_payment (com suporte a expense_tracker / affects_balance = false)
--    - fn_record_settlement (novo acerto atômico entre membros)
--    - fn_set_transaction_splits (mutação atômica de rateios)
--    - fn_set_purchase_splits (mutação atômica de rateios parcelados)
--    - fn_create_transfer (revalidação e grants)
-- 3. Definição estrita de search_path = public, pg_temp em todas as funções
-- 4. Revisão de Grants: Revogação de acesso anônimo/público e concessão a authenticated
-- ==============================================================================

-- ==============================================================================
-- 1. POLÍTICAS RLS PARA AS NOVAS TABELAS V38
-- ==============================================================================

-- 1.1. TRANSACTION_SPLITS
DROP POLICY IF EXISTS transaction_splits_select ON public.transaction_splits;
DROP POLICY IF EXISTS transaction_splits_insert ON public.transaction_splits;
DROP POLICY IF EXISTS transaction_splits_update ON public.transaction_splits;
DROP POLICY IF EXISTS transaction_splits_delete ON public.transaction_splits;

CREATE POLICY transaction_splits_select ON public.transaction_splits
    FOR SELECT USING (public.is_member(workspace_id));

CREATE POLICY transaction_splits_insert ON public.transaction_splits
    FOR INSERT WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']));

CREATE POLICY transaction_splits_update ON public.transaction_splits
    FOR UPDATE USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']));

CREATE POLICY transaction_splits_delete ON public.transaction_splits
    FOR DELETE USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']));

-- 1.2. PURCHASE_SPLITS
DROP POLICY IF EXISTS purchase_splits_select ON public.purchase_splits;
DROP POLICY IF EXISTS purchase_splits_insert ON public.purchase_splits;
DROP POLICY IF EXISTS purchase_splits_update ON public.purchase_splits;
DROP POLICY IF EXISTS purchase_splits_delete ON public.purchase_splits;

CREATE POLICY purchase_splits_select ON public.purchase_splits
    FOR SELECT USING (public.is_member(workspace_id));

CREATE POLICY purchase_splits_insert ON public.purchase_splits
    FOR INSERT WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']));

CREATE POLICY purchase_splits_update ON public.purchase_splits
    FOR UPDATE USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']));

CREATE POLICY purchase_splits_delete ON public.purchase_splits
    FOR DELETE USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']));

-- 1.3. SETTLEMENTS (Acertos de Contas Entre Membros)
DROP POLICY IF EXISTS settlements_select ON public.settlements;
DROP POLICY IF EXISTS settlements_insert ON public.settlements;
DROP POLICY IF EXISTS settlements_update ON public.settlements;
DROP POLICY IF EXISTS settlements_delete ON public.settlements;

CREATE POLICY settlements_select ON public.settlements
    FOR SELECT USING (public.is_member(workspace_id));

CREATE POLICY settlements_insert ON public.settlements
    FOR INSERT WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']));

CREATE POLICY settlements_update ON public.settlements
    FOR UPDATE USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']));

CREATE POLICY settlements_delete ON public.settlements
    FOR DELETE USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']));

-- ==============================================================================
-- 2. ATUALIZAÇÃO E CRIAÇÃO DE RPCs ATÔMICAS V38
-- ==============================================================================

-- 2.1. CRIAR WORKSPACE COM SUPORTE A tracking_mode
CREATE OR REPLACE FUNCTION public.fn_create_workspace(
    p_name TEXT,
    p_currency TEXT DEFAULT 'BRL',
    p_tracking_mode TEXT DEFAULT 'full'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_ws_id UUID;
    v_mode TEXT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF TRIM(p_name) = '' THEN
        RAISE EXCEPTION 'O nome do workspace não pode ser vazio.';
    END IF;

    v_mode := COALESCE(p_tracking_mode, 'full');
    IF v_mode NOT IN ('full', 'expense_tracker') THEN
        RAISE EXCEPTION 'Modo de rastreamento inválido. Permitidos: full, expense_tracker.';
    END IF;

    INSERT INTO public.workspaces (name, owner_id, currency, tracking_mode)
    VALUES (TRIM(p_name), v_user_id, COALESCE(p_currency, 'BRL'), v_mode)
    RETURNING id INTO v_ws_id;

    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (v_ws_id, v_user_id, 'owner');

    RETURN v_ws_id;
END;
$$;

-- 2.2. RPC ATÔMICA PARA REGISTRO DE ACERTO DE CONTAS (SETTLEMENT)
CREATE OR REPLACE FUNCTION public.fn_record_settlement(
    p_workspace_id UUID,
    p_from_member_id UUID,
    p_to_member_id UUID,
    p_amount NUMERIC(12, 2),
    p_settlement_date DATE DEFAULT CURRENT_DATE,
    p_notes TEXT DEFAULT NULL,
    p_payment_account_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_settlement_id UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: você não possui permissão de escrita neste workspace.';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'O valor do acerto de contas deve ser estritamente maior que zero.';
    END IF;

    IF p_from_member_id = p_to_member_id THEN
        RAISE EXCEPTION 'Os membros pagador e recebedor do acerto devem ser distintos.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.workspace_members 
        WHERE id = p_from_member_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Membro pagador (from_member_id) não pertence ao workspace informado.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.workspace_members 
        WHERE id = p_to_member_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Membro recebedor (to_member_id) não pertence ao workspace informado.';
    END IF;

    IF p_payment_account_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.accounts 
            WHERE id = p_payment_account_id AND workspace_id = p_workspace_id
        ) THEN
            RAISE EXCEPTION 'Conta bancária informada não pertence ao workspace.';
        END IF;
    END IF;

    INSERT INTO public.settlements (
        workspace_id,
        from_member_id,
        to_member_id,
        amount,
        settlement_date,
        notes,
        payment_account_id,
        created_by
    ) VALUES (
        p_workspace_id,
        p_from_member_id,
        p_to_member_id,
        p_amount,
        COALESCE(p_settlement_date, CURRENT_DATE),
        p_notes,
        p_payment_account_id,
        v_user_id
    ) RETURNING id INTO v_settlement_id;

    RETURN v_settlement_id;
END;
$$;

-- 2.3. MUTAÇÃO ATÔMICA DE RATEIOS DE TRANSAÇÃO (fn_set_transaction_splits)
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

    -- Se lista for vazia ou nula, remove rateios existentes
    IF p_splits IS NULL OR jsonb_array_length(p_splits) = 0 THEN
        DELETE FROM public.transaction_splits WHERE transaction_id = p_transaction_id;
        RETURN 0;
    END IF;

    -- Validação prévia de cada item do array de rateio
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

        IF NOT EXISTS (
            SELECT 1 FROM public.workspace_members 
            WHERE id = v_member_id AND workspace_id = p_workspace_id
        ) THEN
            RAISE EXCEPTION 'O participante do rateio (%) não pertence ao workspace.', v_member_id;
        END IF;

        v_total_split := v_total_split + v_amount;
    END LOOP;

    -- Tolerância de 5 centavos para arredondamento
    IF ABS(v_total_split - v_tx_amount) > 0.05 THEN
        RAISE EXCEPTION 'A soma das frações do rateio (R$ %) difere do valor total da transação (R$ %).', v_total_split, v_tx_amount;
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

-- 2.4. MUTAÇÃO ATÔMICA DE RATEIOS DE COMPRA PARCELADA (fn_set_purchase_splits)
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

    -- Se lista for vazia ou nula, remove rateios existentes
    IF p_splits IS NULL OR jsonb_array_length(p_splits) = 0 THEN
        DELETE FROM public.purchase_splits WHERE purchase_id = p_purchase_id;
        RETURN 0;
    END IF;

    -- Validação de integridade
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

        IF NOT EXISTS (
            SELECT 1 FROM public.workspace_members 
            WHERE id = v_member_id AND workspace_id = p_workspace_id
        ) THEN
            RAISE EXCEPTION 'O participante do rateio (%) não pertence ao workspace.', v_member_id;
        END IF;

        v_total_split := v_total_split + v_amount;
    END LOOP;

    IF ABS(v_total_split - v_purchase_amount) > 0.05 THEN
        RAISE EXCEPTION 'A soma das frações do rateio (R$ %) difere do valor total da compra (R$ %).', v_total_split, v_purchase_amount;
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

-- 2.5. COMPRA DE CARTÃO 1X COM paid_by_member_id E split_type
DROP FUNCTION IF EXISTS public.fn_create_credit_card_transaction(UUID, UUID, TEXT, NUMERIC, DATE, UUID, UUID);
DROP FUNCTION IF EXISTS public.fn_create_credit_card_transaction(UUID, UUID, TEXT, NUMERIC, DATE, UUID, UUID, UUID, TEXT);

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
    v_card_due INT;
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

    SELECT closing_day, due_day INTO v_card_closing, v_card_due
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

-- 2.6. COMPRA PARCELADA COM paid_by_member_id E split_type
DROP FUNCTION IF EXISTS public.fn_create_installment_purchase(UUID, TEXT, NUMERIC, INT, DATE, UUID, UUID, UUID, UUID, INT);
DROP FUNCTION IF EXISTS public.fn_create_installment_purchase(UUID, TEXT, NUMERIC, INT, DATE, UUID, UUID, UUID, UUID, INT, UUID, TEXT);

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
    v_card_due INT;
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
    v_inst_id UUID;
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
        SELECT closing_day, due_day INTO v_card_closing, v_card_due
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
        -- Compra sem cartão (carnê / boleto parcelado)
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

-- 2.7. REGISTRO DE PAGAMENTO FLEXÍVEL (SUPORTE A expense_tracker / affects_balance = false)
DROP FUNCTION IF EXISTS public.fn_record_payment(UUID, UUID, NUMERIC, DATE, UUID, UUID, UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.fn_record_payment(UUID, UUID, NUMERIC, DATE, UUID, UUID, UUID, UUID, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION public.fn_record_payment(
    p_workspace_id UUID,
    p_account_id UUID,
    p_amount NUMERIC(12, 2),
    p_payment_date DATE DEFAULT CURRENT_DATE,
    p_transaction_id UUID DEFAULT NULL,
    p_installment_id UUID DEFAULT NULL,
    p_credit_card_bill_id UUID DEFAULT NULL,
    p_payment_method_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_affects_balance BOOLEAN DEFAULT true
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_payment_id UUID;
    v_target_total NUMERIC(12, 2);
    v_already_paid NUMERIC(12, 2);
    v_remaining NUMERIC(12, 2);
    v_new_paid NUMERIC(12, 2);
    v_target_type TEXT;
    v_bill_id UUID;
    v_card_id UUID;
    v_affects_balance BOOLEAN;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: permissão insuficiente no workspace.';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'O valor do pagamento deve ser estritamente maior que zero.';
    END IF;

    v_affects_balance := COALESCE(p_affects_balance, true);

    -- Se afeta saldo, conta bancária é obrigatória
    IF v_affects_balance AND p_account_id IS NULL THEN
        RAISE EXCEPTION 'Conta bancária de saída é obrigatória quando o pagamento afeta saldo.';
    END IF;

    IF (p_transaction_id IS NOT NULL)::INT + (p_installment_id IS NOT NULL)::INT + (p_credit_card_bill_id IS NOT NULL)::INT <> 1 THEN
        RAISE EXCEPTION 'Informe exatamente uma obrigação de destino para o pagamento.';
    END IF;

    IF p_payment_method_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.payment_methods WHERE id = p_payment_method_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Método de pagamento não pertence ao workspace informado.';
    END IF;

    -- Bloqueio e validação da conta apenas se afeta saldo ou se foi informada
    IF p_account_id IS NOT NULL THEN
        IF v_affects_balance THEN
            PERFORM 1 FROM public.accounts WHERE id = p_account_id AND workspace_id = p_workspace_id FOR UPDATE;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Conta de saída não encontrada no workspace especificado.';
            END IF;
        ELSE
            IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_account_id AND workspace_id = p_workspace_id) THEN
                RAISE EXCEPTION 'Conta bancária informada não pertence ao workspace.';
            END IF;
        END IF;
    END IF;

    -- 1. TRANSAÇÃO AVULSA
    IF p_transaction_id IS NOT NULL THEN
        SELECT amount, type, credit_card_bill_id, credit_card_id INTO v_target_total, v_target_type, v_bill_id, v_card_id
        FROM public.transactions
        WHERE id = p_transaction_id AND workspace_id = p_workspace_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Transação não encontrada no workspace.';
        END IF;

        IF v_bill_id IS NOT NULL OR v_card_id IS NOT NULL THEN
            RAISE EXCEPTION 'Itens vinculados a cartão de crédito devem ser quitados exclusivamente através da fatura correspondente.';
        END IF;

        SELECT COALESCE(SUM(amount), 0) INTO v_already_paid
        FROM public.payments WHERE transaction_id = p_transaction_id;

        v_remaining := v_target_total - v_already_paid;
        IF p_amount > v_remaining THEN
            RAISE EXCEPTION 'Valor do pagamento (R$ %) excede o saldo restante da transação (R$ %).', p_amount, v_remaining;
        END IF;

        v_new_paid := v_already_paid + p_amount;

        INSERT INTO public.payments (
            workspace_id, transaction_id, account_id, payment_method_id,
            amount, payment_date, notes, created_by, affects_balance
        ) VALUES (
            p_workspace_id, p_transaction_id, p_account_id, p_payment_method_id,
            p_amount, COALESCE(p_payment_date, CURRENT_DATE), p_notes, v_user_id, v_affects_balance
        ) RETURNING id INTO v_payment_id;

        UPDATE public.transactions
        SET status = CASE WHEN v_new_paid >= v_target_total THEN 'paid' ELSE 'partially_paid' END,
            paid_at = CASE WHEN v_new_paid >= v_target_total THEN COALESCE(p_payment_date, CURRENT_DATE)::TIMESTAMPTZ ELSE NULL END
        WHERE id = p_transaction_id;

        IF v_affects_balance AND p_account_id IS NOT NULL THEN
            IF v_target_type = 'expense' THEN
                UPDATE public.accounts SET current_balance = current_balance - p_amount WHERE id = p_account_id;
            ELSE
                UPDATE public.accounts SET current_balance = current_balance + p_amount WHERE id = p_account_id;
            END IF;
        END IF;

        RETURN v_payment_id;
    END IF;

    -- 2. PARCELA INDIVIDUAL
    IF p_installment_id IS NOT NULL THEN
        SELECT i.amount, i.paid_amount, i.credit_card_bill_id, p.credit_card_id
        INTO v_target_total, v_already_paid, v_bill_id, v_card_id
        FROM public.installments i
        JOIN public.purchases p ON p.id = i.purchase_id
        WHERE i.id = p_installment_id AND p.workspace_id = p_workspace_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Parcela não encontrada no workspace.';
        END IF;

        IF v_bill_id IS NOT NULL OR v_card_id IS NOT NULL THEN
            RAISE EXCEPTION 'Parcelas vinculadas a cartão de crédito devem ser quitadas exclusivamente através da fatura correspondente.';
        END IF;

        v_remaining := v_target_total - v_already_paid;
        IF p_amount > v_remaining THEN
            RAISE EXCEPTION 'Valor do pagamento (R$ %) excede o saldo restante da parcela (R$ %).', p_amount, v_remaining;
        END IF;

        v_new_paid := v_already_paid + p_amount;

        INSERT INTO public.payments (
            workspace_id, installment_id, account_id, payment_method_id,
            amount, payment_date, notes, created_by, affects_balance
        ) VALUES (
            p_workspace_id, p_installment_id, p_account_id, p_payment_method_id,
            p_amount, COALESCE(p_payment_date, CURRENT_DATE), p_notes, v_user_id, v_affects_balance
        ) RETURNING id INTO v_payment_id;

        UPDATE public.installments
        SET paid_amount = v_new_paid,
            status = CASE WHEN v_new_paid >= v_target_total THEN 'paid' ELSE 'partially_paid' END,
            paid_at = CASE WHEN v_new_paid >= v_target_total THEN COALESCE(p_payment_date, CURRENT_DATE)::TIMESTAMPTZ ELSE NULL END
        WHERE id = p_installment_id;

        IF v_affects_balance AND p_account_id IS NOT NULL THEN
            UPDATE public.accounts SET current_balance = current_balance - p_amount WHERE id = p_account_id;
        END IF;

        RETURN v_payment_id;
    END IF;

    -- 3. FATURA DE CARTÃO
    IF p_credit_card_bill_id IS NOT NULL THEN
        SELECT total_amount, paid_amount INTO v_target_total, v_already_paid
        FROM public.credit_card_bills
        WHERE id = p_credit_card_bill_id AND workspace_id = p_workspace_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Fatura não encontrada no workspace.';
        END IF;

        v_remaining := v_target_total - v_already_paid;
        IF p_amount > v_remaining THEN
            RAISE EXCEPTION 'Valor do pagamento (R$ %) excede o saldo restante da fatura (R$ %).', p_amount, v_remaining;
        END IF;

        v_new_paid := v_already_paid + p_amount;

        INSERT INTO public.payments (
            workspace_id, credit_card_bill_id, account_id, payment_method_id,
            amount, payment_date, notes, created_by, affects_balance
        ) VALUES (
            p_workspace_id, p_credit_card_bill_id, p_account_id, p_payment_method_id,
            p_amount, COALESCE(p_payment_date, CURRENT_DATE), p_notes, v_user_id, v_affects_balance
        ) RETURNING id INTO v_payment_id;

        UPDATE public.credit_card_bills
        SET paid_amount = v_new_paid,
            status = CASE WHEN v_new_paid >= v_target_total THEN 'paid' ELSE 'partially_paid' END,
            paid_at = CASE WHEN v_new_paid >= v_target_total THEN COALESCE(p_payment_date, CURRENT_DATE)::TIMESTAMPTZ ELSE NULL END
        WHERE id = p_credit_card_bill_id;

        IF v_new_paid >= v_target_total THEN
            UPDATE public.installments
            SET status = 'paid', paid_amount = amount, paid_at = COALESCE(p_payment_date, CURRENT_DATE)::TIMESTAMPTZ
            WHERE credit_card_bill_id = p_credit_card_bill_id;

            UPDATE public.transactions
            SET status = 'paid', paid_at = COALESCE(p_payment_date, CURRENT_DATE)::TIMESTAMPTZ
            WHERE credit_card_bill_id = p_credit_card_bill_id;
        END IF;

        IF v_affects_balance AND p_account_id IS NOT NULL THEN
            UPDATE public.accounts SET current_balance = current_balance - p_amount WHERE id = p_account_id;
        END IF;

        RETURN v_payment_id;
    END IF;

    RAISE EXCEPTION 'Erro inesperado na validação do pagamento.';
END;
$$;

-- 2.8. TRANSFERÊNCIA ENTRE CONTAS
CREATE OR REPLACE FUNCTION public.fn_create_transfer(
    p_workspace_id UUID,
    p_from_account_id UUID,
    p_to_account_id UUID,
    p_amount NUMERIC(12, 2),
    p_transfer_date DATE DEFAULT CURRENT_DATE,
    p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_transfer_id UUID;
    v_first_acc UUID;
    v_second_acc UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: permissão insuficiente no workspace.';
    END IF;

    IF p_from_account_id = p_to_account_id THEN
        RAISE EXCEPTION 'A conta de origem e destino devem ser diferentes.';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'O valor da transferência deve ser maior que zero.';
    END IF;

    -- Deadlock prevention por ordenação de IDs
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
        transfer_date, notes, created_by
    ) VALUES (
        p_workspace_id, p_from_account_id, p_to_account_id, p_amount,
        COALESCE(p_transfer_date, CURRENT_DATE), p_notes, v_user_id
    ) RETURNING id INTO v_transfer_id;

    UPDATE public.accounts SET current_balance = current_balance - p_amount WHERE id = p_from_account_id;
    UPDATE public.accounts SET current_balance = current_balance + p_amount WHERE id = p_to_account_id;

    RETURN v_transfer_id;
END;
$$;

-- ==============================================================================
-- 3. AUDITORIA E ENDURECIMENTO DE SEARCH_PATH NAS FUNÇÕES EXISTENTES
-- ==============================================================================
ALTER FUNCTION public.is_member(UUID) SET search_path = public, pg_temp;
ALTER FUNCTION public.has_workspace_role(UUID, TEXT[]) SET search_path = public, pg_temp;
ALTER FUNCTION public.trg_prevent_workspace_owner_change_fn() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_transfer_workspace_ownership(UUID, UUID) SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_get_or_create_credit_card_bill(UUID, UUID, TEXT) SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_check_purchase_paid_installments_count() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_check_transaction_workspace_integrity() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_check_payment_workspace_integrity() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_check_purchase_workspace_integrity() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_check_recurring_workspace_integrity() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_check_transfer_workspace_integrity() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_check_credit_card_bill_workspace_integrity() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_check_payment_method_workspace_integrity() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_check_budget_workspace_integrity() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_check_credit_card_workspace_integrity() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_check_category_workspace_integrity() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_check_transaction_paid_by_member_workspace_integrity() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_check_purchase_paid_by_member_workspace_integrity() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_check_transaction_split_workspace_integrity() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_check_purchase_split_workspace_integrity() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_check_settlement_workspace_integrity() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_prevent_workspace_id_change() SET search_path = public, pg_temp;
ALTER FUNCTION public.handle_new_user() SET search_path = public, pg_temp;

-- ==============================================================================
-- 4. REVISÃO DE GRANTS E REVOGAÇÃO DE ACESSO PÚBLICO / ANÔNIMO
-- ==============================================================================

-- 4.1. Revogação de acesso a tabelas e sequências para PUBLIC e anon
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon;
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM PUBLIC, anon;

-- 4.2. Concessão de uso do schema public
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- 4.3. Concessão de DML apenas para authenticated (protegido por RLS)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- 4.4. Concessão de execução de rotinas/RPCs apenas para authenticated
GRANT EXECUTE ON ALL ROUTINES IN SCHEMA public TO authenticated;

-- 4.5. Configuração de privilégios padrão para futuros objetos no schema public
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON ROUTINES FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON ROUTINES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO authenticated;
