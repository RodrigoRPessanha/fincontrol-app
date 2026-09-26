-- ==============================================================================
-- MIGRATION 028: V38 FIX CREDIT CARD BILL DUE DATE CALCULATION
-- 1. Corrige o cálculo de due_date quando closing_day == due_day:
--    O vencimento ocorre no mês seguinte APENAS quando due_day < closing_day.
--    Quando due_day >= closing_day (ex: 10 e 10), o vencimento é no mesmo mês de referência.
-- 2. Mantém a autorização segura sem sessão (auth.uid() IS NULL) para o cron do sistema.
-- ==============================================================================

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
    -- Se invocado por usuário com sessão autenticada, valida papel no workspace
    IF auth.uid() IS NOT NULL THEN
        IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
            RAISE EXCEPTION 'Acesso negado: você não possui permissão neste workspace.';
        END IF;
    ELSIF current_user = 'anon' OR session_user = 'anon' OR COALESCE(auth.role(), '') = 'anon' THEN
        -- Rejeita chamadas não autenticadas de clientes anônimos
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
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

    -- Cálculo do vencimento:
    -- O vencimento ocorre no mês seguinte APENAS se due_day < closing_day
    -- Quando due_day >= closing_day (inclusive dias iguais), vence no mesmo mês
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

REVOKE ALL ON FUNCTION public.fn_get_or_create_credit_card_bill(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_get_or_create_credit_card_bill(UUID, UUID, TEXT) TO authenticated, service_role;
