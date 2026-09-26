-- ==============================================================================
-- MIGRATION 027: V38 RECURRING CRON HARDENING AND TARGET DATE LIMIT
-- 1. Permite criação de faturas por chamadas do sistema/pg_cron sem auth.uid()
-- 2. Limita p_target_date para chamadas de usuários comuns autenticados
-- 3. Grants explícitos para authenticated e service_role
-- ==============================================================================

-- 1. Atualizar fn_get_or_create_credit_card_bill para suportar execução em jobs agendados (pg_cron)
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

    -- Cálculo do vencimento: se closing_day >= due_day, o vencimento é no mês seguinte
    IF v_closing_day >= v_due_day THEN
        v_due_month := v_month + 1;
        v_due_year := v_year;
        IF v_due_month > 12 THEN
            v_due_month := 1;
            v_due_year := v_year + 1;
        END IF;
    ELSE
        v_due_month := v_month;
        v_due_year := v_year;
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

-- 2. Atualizar fn_materialize_recurring_transactions com limite de target_date para usuários autenticados
CREATE OR REPLACE FUNCTION public.fn_materialize_recurring_transactions(
    p_workspace_id UUID DEFAULT NULL,
    p_target_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_rec RECORD;
    v_curr DATE;
    v_next_step DATE;
    v_iterations INT;
    v_should_deactivate BOOLEAN;
    v_is_suspended BOOLEAN;
    v_suspended_reason TEXT;
    
    -- Validações de entidades vinculadas
    v_acc_active BOOLEAN;
    v_cat_active BOOLEAN;
    v_pm_active BOOLEAN;
    v_pm_type TEXT;
    v_pm_card_id UUID;
    v_pm_acc_id UUID;
    
    -- Cartão e fatura
    v_effective_card_id UUID;
    v_effective_account_id UUID;
    v_card_active BOOLEAN;
    v_card_closing INT;
    v_card_due INT;
    v_bill_id UUID;
    v_due_date DATE;
    v_ref_month TEXT;
    v_p_day INT;
    v_p_month INT;
    v_p_year INT;
    v_bill_month INT;
    v_bill_year INT;

    -- Contadores
    v_created_count INT := 0;
    v_suspended_count INT := 0;
    v_processed_count INT := 0;
BEGIN
    -- 1. Validação de permissão e data limite quando chamado por usuário autenticado
    IF auth.uid() IS NOT NULL THEN
        -- Bloqueia geração de ocorrências arbitrariamente futuras por usuários comuns
        IF p_target_date > (CURRENT_DATE + INTERVAL '30 days')::DATE THEN
            RAISE EXCEPTION 'A data limite para materialização não pode exceder 30 dias a partir da data atual.';
        END IF;

        IF p_workspace_id IS NOT NULL THEN
            IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
                RAISE EXCEPTION 'Acesso negado: você não possui permissão de escrita neste workspace.';
            END IF;
        END IF;
    ELSIF current_user = 'anon' OR session_user = 'anon' OR COALESCE(auth.role(), '') = 'anon' THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    -- Itera sobre recorrências ativas que devem gerar ocorrências até p_target_date
    -- Lock exclusivo por linha com SKIP LOCKED para garantir atomicidade em concorrência
    FOR v_rec IN
        SELECT r.*
        FROM public.recurring_transactions r
        JOIN public.workspaces w ON w.id = r.workspace_id
        WHERE r.active = TRUE
          AND r.auto_create = TRUE
          AND r.next_occurrence <= p_target_date
          AND (p_workspace_id IS NULL OR r.workspace_id = p_workspace_id)
          AND (
              auth.uid() IS NULL 
              OR EXISTS (
                  SELECT 1 FROM public.workspace_members wm
                  WHERE wm.workspace_id = r.workspace_id
                    AND wm.user_id = auth.uid()
                    AND wm.role IN ('owner', 'admin', 'member')
              )
          )
        ORDER BY r.workspace_id, r.id
        FOR UPDATE OF r SKIP LOCKED
    LOOP
        v_is_suspended := FALSE;
        v_suspended_reason := NULL;
        v_effective_card_id := v_rec.credit_card_id;
        v_effective_account_id := v_rec.account_id;

        -- 1. Verifica se next_occurrence já ultrapassou end_date
        IF v_rec.end_date IS NOT NULL AND v_rec.next_occurrence > v_rec.end_date THEN
            UPDATE public.recurring_transactions
            SET active = FALSE, updated_at = NOW()
            WHERE id = v_rec.id;
            v_suspended_count := v_suspended_count + 1;
            CONTINUE;
        END IF;

        -- 2. Resolução de Método de Pagamento
        IF v_rec.payment_method_id IS NOT NULL THEN
            SELECT active, type, credit_card_id, linked_account_id
            INTO v_pm_active, v_pm_type, v_pm_card_id, v_pm_acc_id
            FROM public.payment_methods
            WHERE id = v_rec.payment_method_id AND workspace_id = v_rec.workspace_id;

            IF v_pm_active IS NULL OR v_pm_active = FALSE THEN
                v_is_suspended := TRUE;
                v_suspended_reason := 'Método de pagamento vinculado está inativo.';
            ELSE
                IF v_pm_card_id IS NOT NULL THEN
                    v_effective_card_id := v_pm_card_id;
                END IF;
                IF v_pm_acc_id IS NOT NULL AND v_effective_account_id IS NULL THEN
                    v_effective_account_id := v_pm_acc_id;
                END IF;
            END IF;
        END IF;

        -- 3. Validação de Conta Bancária
        IF NOT v_is_suspended AND v_effective_account_id IS NOT NULL THEN
            SELECT active INTO v_acc_active
            FROM public.accounts
            WHERE id = v_effective_account_id AND workspace_id = v_rec.workspace_id;

            IF v_acc_active IS NULL THEN
                v_is_suspended := TRUE;
                v_suspended_reason := 'Conta bancária associada não encontrada no workspace.';
            ELSIF v_acc_active = FALSE THEN
                v_is_suspended := TRUE;
                v_suspended_reason := 'Conta bancária vinculada está inativa.';
            END IF;
        END IF;

        -- 4. Validação de Categoria
        IF NOT v_is_suspended AND v_rec.category_id IS NOT NULL THEN
            SELECT active INTO v_cat_active
            FROM public.categories
            WHERE id = v_rec.category_id AND workspace_id = v_rec.workspace_id;

            IF v_cat_active IS NULL OR v_cat_active = FALSE THEN
                v_is_suspended := TRUE;
                v_suspended_reason := 'Categoria vinculada inativa ou inválida.';
            END IF;
        END IF;

        -- 5. Validação de Cartão de Crédito
        IF NOT v_is_suspended AND v_effective_card_id IS NOT NULL THEN
            IF v_rec.type = 'income' THEN
                v_is_suspended := TRUE;
                v_suspended_reason := 'Receitas não podem ser vinculadas a cartão de crédito ou faturas.';
            ELSE
                SELECT active, closing_day, due_day
                INTO v_card_active, v_card_closing, v_card_due
                FROM public.credit_cards
                WHERE id = v_effective_card_id AND workspace_id = v_rec.workspace_id;

                IF v_card_active IS NULL OR v_card_active = FALSE THEN
                    v_is_suspended := TRUE;
                    v_suspended_reason := 'Cartão de crédito vinculado está inativo.';
                END IF;
            END IF;
        END IF;

        -- Se alguma regra de negócio foi violada, suspende a recorrência
        IF v_is_suspended THEN
            UPDATE public.recurring_transactions
            SET active = FALSE,
                suspended_reason = v_suspended_reason,
                updated_at = NOW()
            WHERE id = v_rec.id;
            v_suspended_count := v_suspended_count + 1;
            CONTINUE;
        END IF;

        -- 6. Loop de Materialização com Catch-Up
        v_curr := v_rec.next_occurrence;
        v_iterations := 0;
        v_should_deactivate := FALSE;

        WHILE v_curr <= p_target_date AND (v_rec.end_date IS NULL OR v_curr <= v_rec.end_date) AND v_iterations < 120 LOOP
            v_iterations := v_iterations + 1;

            -- Verifica idempotência da ocorrência
            IF NOT EXISTS (
                SELECT 1 FROM public.transactions
                WHERE recurring_transaction_id = v_rec.id
                  AND transaction_date = v_curr
            ) THEN
                -- Se vinculada a cartão, resolve/cria fatura e calcula due_date
                IF v_effective_card_id IS NOT NULL THEN
                    v_p_day := EXTRACT(DAY FROM v_curr)::INT;
                    v_p_month := EXTRACT(MONTH FROM v_curr)::INT;
                    v_p_year := EXTRACT(YEAR FROM v_curr)::INT;

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
                    v_bill_id := public.fn_get_or_create_credit_card_bill(v_rec.workspace_id, v_effective_card_id, v_ref_month);

                    UPDATE public.credit_card_bills
                    SET total_amount = total_amount + v_rec.amount,
                        status = CASE WHEN paid_amount >= total_amount + v_rec.amount AND total_amount + v_rec.amount > 0 THEN 'paid' WHEN paid_amount > 0 THEN 'partially_paid' ELSE 'open' END,
                        paid_at = CASE WHEN paid_amount >= total_amount + v_rec.amount AND total_amount + v_rec.amount > 0 THEN paid_at ELSE NULL END,
                        updated_at = NOW()
                    WHERE id = v_bill_id
                    RETURNING due_date INTO v_due_date;
                ELSE
                    v_bill_id := NULL;
                    v_due_date := v_curr;
                END IF;

                -- Insere a transação materializada
                INSERT INTO public.transactions (
                    workspace_id,
                    account_id,
                    category_id,
                    payment_method_id,
                    credit_card_id,
                    credit_card_bill_id,
                    recurring_transaction_id,
                    description,
                    amount,
                    type,
                    transaction_date,
                    due_date,
                    status,
                    created_by
                )
                VALUES (
                    v_rec.workspace_id,
                    v_effective_account_id,
                    v_rec.category_id,
                    v_rec.payment_method_id,
                    v_effective_card_id,
                    v_bill_id,
                    v_rec.id,
                    v_rec.description,
                    v_rec.amount,
                    v_rec.type,
                    v_curr,
                    v_due_date,
                    'pending',
                    COALESCE(auth.uid(), (SELECT owner_id FROM public.workspaces WHERE id = v_rec.workspace_id))
                )
                ON CONFLICT (recurring_transaction_id, transaction_date) DO NOTHING;

                v_created_count := v_created_count + 1;
            END IF;

            -- Avança para a próxima data
            v_next_step := public.fn_step_next_occurrence(v_curr, v_rec.start_date, v_rec.frequency, v_rec.interval_days);
            IF v_rec.end_date IS NOT NULL AND v_next_step > v_rec.end_date THEN
                v_should_deactivate := TRUE;
                v_curr := v_next_step;
                EXIT;
            END IF;
            v_curr := v_next_step;
        END LOOP;

        -- Atualiza next_occurrence e encerra se expirado
        UPDATE public.recurring_transactions
        SET next_occurrence = v_curr,
            active = CASE WHEN v_should_deactivate THEN FALSE ELSE active END,
            updated_at = NOW()
        WHERE id = v_rec.id;

        v_processed_count := v_processed_count + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'created_transactions', v_created_count,
        'suspended_recurring', v_suspended_count,
        'processed_recurring', v_processed_count,
        'target_date', p_target_date
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_materialize_recurring_transactions(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_materialize_recurring_transactions(UUID, DATE) TO authenticated, service_role;
