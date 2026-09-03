-- ==============================================================================
-- FINCONTROL V11 - MIGRATION INCREMENTAL DE ENDURECIMENTO E SEGURANÇA (005_v10_hardening.sql)
-- Fechamento de SECURITY DEFINER, triggers estruturais completos e constraints de intervalo
-- ==============================================================================

-- 1. Redefine o helper fn_get_or_create_credit_card_bill com validação de permissão e REVOKE/GRANT
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
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: você não possui permissão neste workspace.';
    END IF;

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

-- Restringe execução de fn_get_or_create_credit_card_bill apenas para usuários autenticados
REVOKE ALL ON FUNCTION public.fn_get_or_create_credit_card_bill(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_or_create_credit_card_bill(UUID, UUID, TEXT) TO authenticated;

-- 2. Preflight de saneamento e constraint para validação de intervalo customizado de 1 a 3.650 dias
DO $$
BEGIN
    -- Preflight: saneamento de dados legados caso existam registros acima de 3650 dias ou inválidos
    UPDATE public.recurring_transactions
    SET interval_days = 3650
    WHERE frequency = 'custom' AND interval_days > 3650;

    UPDATE public.recurring_transactions
    SET interval_days = 30
    WHERE frequency = 'custom' AND (interval_days IS NULL OR interval_days <= 0);

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'recurring_custom_interval_chk'
    ) THEN
        ALTER TABLE public.recurring_transactions
        ADD CONSTRAINT recurring_custom_interval_chk
        CHECK (frequency != 'custom' OR (interval_days IS NOT NULL AND interval_days BETWEEN 1 AND 3650));
    END IF;
END $$;

-- 3. Triggers Cross-Workspace Adicionais para garantir Integridade Estrutural Completa

-- A. credit_card_bills
CREATE OR REPLACE FUNCTION public.fn_check_credit_card_bill_workspace_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.credit_cards WHERE id = NEW.credit_card_id AND workspace_id = NEW.workspace_id
    ) THEN
        RAISE EXCEPTION 'O cartão de crédito informado na fatura pertence a outro workspace.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_credit_card_bill_workspace_integrity ON public.credit_card_bills;
CREATE TRIGGER trg_check_credit_card_bill_workspace_integrity
    BEFORE INSERT OR UPDATE ON public.credit_card_bills
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_check_credit_card_bill_workspace_integrity();

-- B. payment_methods
CREATE OR REPLACE FUNCTION public.fn_check_payment_method_workspace_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.linked_account_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.accounts WHERE id = NEW.linked_account_id AND workspace_id = NEW.workspace_id
    ) THEN
        RAISE EXCEPTION 'A conta vinculada ao método de pagamento pertence a outro workspace.';
    END IF;

    IF NEW.credit_card_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.credit_cards WHERE id = NEW.credit_card_id AND workspace_id = NEW.workspace_id
    ) THEN
        RAISE EXCEPTION 'O cartão vinculado ao método de pagamento pertence a outro workspace.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_payment_method_workspace_integrity ON public.payment_methods;
CREATE TRIGGER trg_check_payment_method_workspace_integrity
    BEFORE INSERT OR UPDATE ON public.payment_methods
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_check_payment_method_workspace_integrity();

-- C. budgets
CREATE OR REPLACE FUNCTION public.fn_check_budget_workspace_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.categories WHERE id = NEW.category_id AND workspace_id = NEW.workspace_id
    ) THEN
        RAISE EXCEPTION 'A categoria vinculada ao orçamento pertence a outro workspace.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_budget_workspace_integrity ON public.budgets;
CREATE TRIGGER trg_check_budget_workspace_integrity
    BEFORE INSERT OR UPDATE ON public.budgets
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_check_budget_workspace_integrity();

-- D. credit_cards (linked_payment_account_id)
CREATE OR REPLACE FUNCTION public.fn_check_credit_card_workspace_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.linked_payment_account_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.accounts WHERE id = NEW.linked_payment_account_id AND workspace_id = NEW.workspace_id
    ) THEN
        RAISE EXCEPTION 'A conta bancária de pagamento automático do cartão pertence a outro workspace.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_credit_card_workspace_integrity ON public.credit_cards;
CREATE TRIGGER trg_check_credit_card_workspace_integrity
    BEFORE INSERT OR UPDATE ON public.credit_cards
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_check_credit_card_workspace_integrity();

-- E. categories (parent_id)
CREATE OR REPLACE FUNCTION public.fn_check_category_workspace_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.parent_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.categories WHERE id = NEW.parent_id AND workspace_id = NEW.workspace_id
    ) THEN
        RAISE EXCEPTION 'A categoria pai informada pertence a outro workspace.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_category_workspace_integrity ON public.categories;
CREATE TRIGGER trg_check_category_workspace_integrity
    BEFORE INSERT OR UPDATE ON public.categories
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_check_category_workspace_integrity();
