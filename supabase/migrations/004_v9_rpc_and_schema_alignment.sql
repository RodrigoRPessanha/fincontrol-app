-- ==============================================================================
-- FINCONTROL V10 - MIGRATION INCREMENTAL DE ENDURECIMENTO E ALINHAMENTO COMPLETO
-- (004_v9_rpc_and_schema_alignment.sql)
-- ==============================================================================

-- 1. Helper Canônico para obter ou criar fatura por mês de referência
CREATE OR REPLACE FUNCTION public.fn_get_or_create_credit_card_bill(
    p_workspace_id UUID,
    p_credit_card_id UUID,
    p_reference_month TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_bill_id UUID;
    v_closing_day INT;
    v_due_day INT;
    v_year INT;
    v_month INT;
    v_due_year INT;
    v_due_month INT;
    v_max_closing_days INT;
    v_max_due_days INT;
    v_closing_date DATE;
    v_due_date DATE;
BEGIN
    SELECT id INTO v_bill_id
    FROM public.credit_card_bills
    WHERE credit_card_id = p_credit_card_id
      AND reference_month = p_reference_month
      AND workspace_id = p_workspace_id;

    IF v_bill_id IS NOT NULL THEN
        RETURN v_bill_id;
    END IF;

    SELECT closing_day, due_day INTO v_closing_day, v_due_day
    FROM public.credit_cards
    WHERE id = p_credit_card_id AND workspace_id = p_workspace_id;

    IF v_closing_day IS NULL THEN
        RAISE EXCEPTION 'Cartão de crédito não encontrado no workspace informado.';
    END IF;

    v_year := SPLIT_PART(p_reference_month, '-', 1)::INT;
    v_month := SPLIT_PART(p_reference_month, '-', 2)::INT;

    -- Dias máximos do mês de fechamento
    v_max_closing_days := EXTRACT(DAY FROM (DATE_TRUNC('month', MAKE_DATE(v_year, v_month, 1)) + INTERVAL '1 month - 1 day'))::INT;
    v_closing_date := MAKE_DATE(v_year, v_month, LEAST(v_closing_day, v_max_closing_days));

    -- Cálculo do vencimento
    v_due_year := v_year;
    v_due_month := v_month;
    IF v_due_day < v_closing_day THEN
        v_due_month := v_due_month + 1;
        IF v_due_month > 12 THEN
            v_due_month := 1;
            v_due_year := v_due_year + 1;
        END IF;
    END IF;

    v_max_due_days := EXTRACT(DAY FROM (DATE_TRUNC('month', MAKE_DATE(v_due_year, v_due_month, 1)) + INTERVAL '1 month - 1 day'))::INT;
    v_due_date := MAKE_DATE(v_due_year, v_due_month, LEAST(v_due_day, v_max_due_days));

    INSERT INTO public.credit_card_bills (
        workspace_id, credit_card_id, reference_month,
        closing_date, due_date, total_amount, paid_amount, status
    )
    VALUES (
        p_workspace_id, p_credit_card_id, p_reference_month,
        v_closing_date, v_due_date, 0.00, 0.00, 'open'
    )
    ON CONFLICT (credit_card_id, reference_month)
    DO UPDATE SET updated_at = NOW()
    RETURNING id INTO v_bill_id;

    RETURN v_bill_id;
END;
$$;

-- 2. Remove assinatura legada de 9 parâmetros para evitar sobrecarga ambígua
DROP FUNCTION IF EXISTS public.fn_create_installment_purchase(UUID, TEXT, NUMERIC, INT, DATE, UUID, UUID, UUID, UUID);

-- 3. Criação da RPC de Compra Parcelada com ciclo consecutivo, paid_installments_count e segurança completa
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
    p_paid_installments_count INT DEFAULT 0
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
BEGIN
    -- Validação de Autenticação e Permissão de Workspace
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

    -- Validação de integridade de workspace das entidades vinculadas
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

    -- Cria o registro da compra
    INSERT INTO public.purchases (
        workspace_id, account_id, credit_card_id, category_id, payment_method_id,
        description, total_amount, installment_count, paid_installments_count,
        purchase_date, created_by
    )
    VALUES (
        p_workspace_id, p_account_id, p_credit_card_id, p_category_id, p_payment_method_id,
        p_description, p_total_amount, p_installment_count, v_paid_count,
        p_purchase_date, auth.uid()
    )
    RETURNING id INTO v_purchase_id;

    -- Divisão com absorção de resto de centavos na 1ª parcela
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

            -- Atualiza total da fatura e obtém due_date
            UPDATE public.credit_card_bills
            SET total_amount = total_amount + v_amount
            WHERE id = v_bill_id
            RETURNING due_date INTO v_due_date;

            -- Insere a parcela
            INSERT INTO public.installments (
                purchase_id, installment_number, amount, due_date, credit_card_bill_id,
                status, paid_amount, paid_at
            )
            VALUES (
                v_purchase_id, i, v_amount, v_due_date, v_bill_id,
                CASE WHEN v_is_paid THEN 'paid' ELSE 'pending' END,
                CASE WHEN v_is_paid THEN v_amount ELSE 0.00 END,
                CASE WHEN v_is_paid THEN v_due_date ELSE NULL END
            )
            RETURNING id INTO v_inst_id;

            -- Se a parcela for pré-paga, credita fatura e cria pagamento com ALVO ÚNICO em installment_id
            IF v_is_paid THEN
                UPDATE public.credit_card_bills
                SET paid_amount = paid_amount + v_amount,
                    status = CASE WHEN paid_amount + v_amount >= total_amount THEN 'paid' ELSE 'partially_paid' END,
                    paid_at = CASE WHEN paid_amount + v_amount >= total_amount THEN v_due_date ELSE NULL END
                WHERE id = v_bill_id;

                IF p_account_id IS NOT NULL THEN
                    -- ALVO ÚNICO: apenas installment_id preenchido para respeitar payments_single_target_chk
                    INSERT INTO public.payments (
                        workspace_id, installment_id, credit_card_bill_id, transaction_id,
                        account_id, payment_method_id, amount, payment_date, notes, created_by
                    )
                    VALUES (
                        p_workspace_id, v_inst_id, NULL, NULL,
                        p_account_id, p_payment_method_id, v_amount, v_due_date,
                        'Quitação prévia de parcela importada', auth.uid()
                    );
                END IF;
            ELSE
                -- Se a fatura estava quitada e recebe item não pago, reabre status e limpa paid_at
                UPDATE public.credit_card_bills
                SET status = CASE WHEN paid_amount >= total_amount AND total_amount > 0 THEN 'paid' WHEN paid_amount > 0 THEN 'partially_paid' ELSE 'open' END,
                    paid_at = CASE WHEN paid_amount >= total_amount AND total_amount > 0 THEN paid_at ELSE NULL END
                WHERE id = v_bill_id;
            END IF;
        END LOOP;
    ELSE
        -- Parcelamento não-cartão
        FOR i IN 1..p_installment_count LOOP
            v_amount := CASE WHEN i = 1 THEN v_first_amount ELSE v_base_amount END;
            v_is_paid := (i <= v_paid_count);
            v_due_date := (p_purchase_date + ((i - 1) || ' months')::INTERVAL)::DATE;

            INSERT INTO public.installments (
                purchase_id, installment_number, amount, due_date, credit_card_bill_id,
                status, paid_amount, paid_at
            )
            VALUES (
                v_purchase_id, i, v_amount, v_due_date, NULL,
                CASE WHEN v_is_paid THEN 'paid' ELSE 'pending' END,
                CASE WHEN v_is_paid THEN v_amount ELSE 0.00 END,
                CASE WHEN v_is_paid THEN v_due_date ELSE NULL END
            )
            RETURNING id INTO v_inst_id;

            IF v_is_paid AND p_account_id IS NOT NULL THEN
                INSERT INTO public.payments (
                    workspace_id, installment_id, credit_card_bill_id, transaction_id,
                    account_id, payment_method_id, amount, payment_date, notes, created_by
                )
                VALUES (
                    p_workspace_id, v_inst_id, NULL, NULL,
                    p_account_id, p_payment_method_id, v_amount, v_due_date,
                    'Quitação prévia de parcela importada', auth.uid()
                );
            END IF;
        END LOOP;
    END IF;

    RETURN v_purchase_id;
END;
$$;

-- 4. Criação da RPC Atômica para Compra de Cartão 1x com reabertura e segurança completa
CREATE OR REPLACE FUNCTION public.fn_create_credit_card_transaction(
    p_workspace_id UUID,
    p_credit_card_id UUID,
    p_description TEXT,
    p_amount NUMERIC(12, 2),
    p_transaction_date DATE DEFAULT CURRENT_DATE,
    p_category_id UUID DEFAULT NULL,
    p_payment_method_id UUID DEFAULT NULL
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

    -- Atualiza total da fatura, reabrindo status e limpando paid_at se a fatura já estava quitada
    UPDATE public.credit_card_bills
    SET total_amount = total_amount + p_amount,
        status = CASE WHEN paid_amount >= total_amount + p_amount AND total_amount + p_amount > 0 THEN 'paid' WHEN paid_amount > 0 THEN 'partially_paid' ELSE 'open' END,
        paid_at = CASE WHEN paid_amount >= total_amount + p_amount AND total_amount + p_amount > 0 THEN paid_at ELSE NULL END
    WHERE id = v_bill_id
    RETURNING due_date INTO v_due_date;

    -- Insere a transação vinculada à fatura
    INSERT INTO public.transactions (
        workspace_id, category_id, payment_method_id, credit_card_id,
        credit_card_bill_id, description, amount, type,
        transaction_date, due_date, status, created_by
    )
    VALUES (
        p_workspace_id, p_category_id, p_payment_method_id, p_credit_card_id,
        v_bill_id, p_description, p_amount, 'expense',
        p_transaction_date, v_due_date, 'pending', auth.uid()
    )
    RETURNING id INTO v_tx_id;

    RETURN v_tx_id;
END;
$$;

-- 5. Triggers de Integridade Cross-Workspace Adicionais
CREATE OR REPLACE FUNCTION public.fn_check_purchase_workspace_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.account_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.accounts WHERE id = NEW.account_id AND workspace_id = NEW.workspace_id
    ) THEN
        RAISE EXCEPTION 'A conta bancária da compra não pertence ao mesmo workspace.';
    END IF;

    IF NEW.credit_card_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.credit_cards WHERE id = NEW.credit_card_id AND workspace_id = NEW.workspace_id
    ) THEN
        RAISE EXCEPTION 'O cartão de crédito da compra não pertence ao mesmo workspace.';
    END IF;

    IF NEW.category_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.categories WHERE id = NEW.category_id AND workspace_id = NEW.workspace_id
    ) THEN
        RAISE EXCEPTION 'A categoria da compra não pertence ao mesmo workspace.';
    END IF;

    IF NEW.payment_method_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.payment_methods WHERE id = NEW.payment_method_id AND workspace_id = NEW.workspace_id
    ) THEN
        RAISE EXCEPTION 'O método de pagamento da compra não pertence ao mesmo workspace.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_purchase_workspace_integrity ON public.purchases;
CREATE TRIGGER trg_check_purchase_workspace_integrity
    BEFORE INSERT OR UPDATE ON public.purchases
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_check_purchase_workspace_integrity();

CREATE OR REPLACE FUNCTION public.fn_check_recurring_workspace_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.account_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.accounts WHERE id = NEW.account_id AND workspace_id = NEW.workspace_id
    ) THEN
        RAISE EXCEPTION 'A conta da recorrência não pertence ao mesmo workspace.';
    END IF;

    IF NEW.credit_card_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.credit_cards WHERE id = NEW.credit_card_id AND workspace_id = NEW.workspace_id
    ) THEN
        RAISE EXCEPTION 'O cartão da recorrência não pertence ao mesmo workspace.';
    END IF;

    IF NEW.category_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.categories WHERE id = NEW.category_id AND workspace_id = NEW.workspace_id
    ) THEN
        RAISE EXCEPTION 'A categoria da recorrência não pertence ao mesmo workspace.';
    END IF;

    IF NEW.payment_method_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.payment_methods WHERE id = NEW.payment_method_id AND workspace_id = NEW.workspace_id
    ) THEN
        RAISE EXCEPTION 'O método de pagamento da recorrência não pertence ao mesmo workspace.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_recurring_workspace_integrity ON public.recurring_transactions;
CREATE TRIGGER trg_check_recurring_workspace_integrity
    BEFORE INSERT OR UPDATE ON public.recurring_transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_check_recurring_workspace_integrity();

CREATE OR REPLACE FUNCTION public.fn_check_transfer_workspace_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.accounts WHERE id = NEW.from_account_id AND workspace_id = NEW.workspace_id
    ) THEN
        RAISE EXCEPTION 'A conta de origem da transferência não pertence ao mesmo workspace.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.accounts WHERE id = NEW.to_account_id AND workspace_id = NEW.workspace_id
    ) THEN
        RAISE EXCEPTION 'A conta de destino da transferência não pertence ao mesmo workspace.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_transfer_workspace_integrity ON public.transfers;
CREATE TRIGGER trg_check_transfer_workspace_integrity
    BEFORE INSERT OR UPDATE ON public.transfers
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_check_transfer_workspace_integrity();
