-- A2-01: metadados preservam a fatura; edição faturada acompanha a regra local.
CREATE OR REPLACE FUNCTION public.fn_update_transaction_with_splits(p_workspace_id uuid, p_transaction_id uuid, p_description text DEFAULT NULL::text, p_amount numeric DEFAULT NULL::numeric, p_transaction_date date DEFAULT NULL::date, p_type text DEFAULT NULL::text, p_category_id uuid DEFAULT NULL::uuid, p_account_id uuid DEFAULT NULL::uuid, p_payment_method_id uuid DEFAULT NULL::uuid, p_credit_card_id uuid DEFAULT NULL::uuid, p_credit_card_bill_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_paid_by_member_id uuid DEFAULT NULL::uuid, p_split_type text DEFAULT NULL::text, p_due_date date DEFAULT NULL::date, p_splits jsonb DEFAULT NULL::jsonb, p_paid_by_person_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_user_id UUID;
    v_old_tx RECORD;
    v_new_amount NUMERIC(12, 2);
    v_new_type TEXT;
    v_pay RECORD;
    v_paid_total NUMERIC(12, 2) := 0;
    v_split RECORD;
    v_total_split NUMERIC(12, 2) := 0;
    v_member_id UUID;
    v_person_id UUID;
    v_seen_members UUID[] := '{}';
    v_seen_people UUID[] := '{}';
BEGIN
    IF p_amount IS NOT NULL THEN p_amount := public.fn_normalize_money(p_amount); END IF;
    IF p_splits IS NOT NULL THEN
      SELECT COALESCE(jsonb_agg(jsonb_set(item,'{amount}',to_jsonb(public.fn_normalize_money((item->>'amount')::numeric,'nonnegative'))) ORDER BY ord),'[]'::jsonb)
      INTO p_splits FROM jsonb_array_elements(p_splits) WITH ORDINALITY AS a(item,ord);
    END IF;
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: você não possui permissão de escrita neste workspace.';
    END IF;

    -- Concorrência: serialização por workspace para mutações financeiras e rateios
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
    PERFORM pg_advisory_xact_lock(hashtext('workspace_debt:' || p_workspace_id::text));

    SELECT * INTO v_old_tx
    FROM public.transactions
    WHERE id = p_transaction_id AND workspace_id = p_workspace_id
    FOR UPDATE;

    IF v_old_tx.id IS NULL THEN
        RAISE EXCEPTION 'Transação não encontrada no workspace informado.';
    END IF;

    -- Alterar vínculo de cartão exige rebilling, que esta edição não oferece.
    IF (p_credit_card_id IS NOT NULL AND p_credit_card_id IS DISTINCT FROM v_old_tx.credit_card_id)
      OR (p_credit_card_bill_id IS NOT NULL AND p_credit_card_bill_id IS DISTINCT FROM v_old_tx.credit_card_bill_id)
      OR (v_old_tx.credit_card_id IS NOT NULL AND p_type IS NOT NULL AND p_type<>'expense') THEN
      RAISE EXCEPTION 'Não é permitido alterar o vínculo de cartão/fatura desta transação.';
    END IF;
    IF v_old_tx.credit_card_bill_id IS NOT NULL THEN
      IF (p_amount IS NOT NULL AND p_amount<>v_old_tx.amount)
        OR (p_transaction_date IS NOT NULL AND p_transaction_date<>v_old_tx.transaction_date)
        OR (p_due_date IS NOT NULL AND p_due_date<>v_old_tx.due_date) THEN
        RAISE EXCEPTION 'Valores e datas de transação faturada exigem estorno e nova operação.';
      END IF;
      -- NULL/default não pode soltar item de uma fatura e deixar seu total órfão.
      p_credit_card_id := COALESCE(p_credit_card_id,v_old_tx.credit_card_id);
      p_credit_card_bill_id := v_old_tx.credit_card_bill_id;
    END IF;
    v_new_amount := COALESCE(p_amount, v_old_tx.amount);
    IF v_new_amount <= 0 THEN
        RAISE EXCEPTION 'O valor da transação deve ser estritamente maior que zero.';
    END IF;

    -- Validação de pagador exclusivo
    IF p_paid_by_member_id IS NOT NULL AND p_paid_by_person_id IS NOT NULL THEN
        RAISE EXCEPTION 'A transação não pode ter paid_by_member_id e paid_by_person_id simultaneamente.';
    END IF;

    IF p_paid_by_member_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.workspace_members
        WHERE id = p_paid_by_member_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Membro pagador informado não pertence ao workspace.';
    END IF;

    IF p_paid_by_person_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.people
        WHERE id = p_paid_by_person_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Pessoa pagadora informada não pertence ao workspace.';
    END IF;

    -- Valida se o novo valor não é menor que o total já pago
    SELECT COALESCE(SUM(amount), 0) INTO v_paid_total
    FROM public.payments
    WHERE transaction_id = p_transaction_id;

    IF v_paid_total > v_new_amount THEN
        RAISE EXCEPTION 'O novo valor da transação (R$ %) não pode ser menor do que o total já pago (R$ %).', v_new_amount, v_paid_total;
    END IF;

    v_new_type := COALESCE(p_type, v_old_tx.type);

    -- Se o tipo mudou (expense <-> income), inverte o efeito dos pagamentos existentes nas contas bancárias
    IF v_new_type <> v_old_tx.type THEN
        FOR v_pay IN
            SELECT account_id, amount
            FROM public.payments
            WHERE transaction_id = p_transaction_id AND affects_balance = TRUE AND account_id IS NOT NULL
        LOOP
            IF v_new_type = 'income' AND v_old_tx.type = 'expense' THEN
                UPDATE public.accounts
                SET current_balance = current_balance + (2 * v_pay.amount)
                WHERE id = v_pay.account_id AND workspace_id = p_workspace_id;
            ELSIF v_new_type = 'expense' AND v_old_tx.type = 'income' THEN
                UPDATE public.accounts
                SET current_balance = current_balance - (2 * v_pay.amount)
                WHERE id = v_pay.account_id AND workspace_id = p_workspace_id;
            END IF;
        END LOOP;
    END IF;

    -- Sincroniza splits se informados
    IF p_splits IS NOT NULL THEN
        IF jsonb_array_length(p_splits) > 0 THEN
            FOR v_split IN SELECT * FROM jsonb_to_recordset(p_splits) AS x(member_id UUID, person_id UUID, amount NUMERIC, percentage NUMERIC) LOOP
                v_member_id := v_split.member_id;
                v_person_id := v_split.person_id;

                IF (v_member_id IS NULL AND v_person_id IS NULL) OR (v_member_id IS NOT NULL AND v_person_id IS NOT NULL) THEN
                    RAISE EXCEPTION 'Cada fração de rateio deve informar exatamente um member_id ou person_id válido.';
                END IF;

                IF v_member_id IS NOT NULL THEN
                    IF v_member_id = ANY(v_seen_members) THEN
                        RAISE EXCEPTION 'Participante duplicado no rateio (member_id: %).', v_member_id;
                    END IF;
                    v_seen_members := array_append(v_seen_members, v_member_id);

                    IF NOT EXISTS (
                        SELECT 1 FROM public.workspace_members
                        WHERE id = v_member_id AND workspace_id = p_workspace_id
                    ) THEN
                        RAISE EXCEPTION 'Membro do rateio não pertence ao workspace.';
                    END IF;
                END IF;

                IF v_person_id IS NOT NULL THEN
                    IF v_person_id = ANY(v_seen_people) THEN
                        RAISE EXCEPTION 'Participante duplicado no rateio (person_id: %).', v_person_id;
                    END IF;
                    v_seen_people := array_append(v_seen_people, v_person_id);

                    IF NOT EXISTS (
                        SELECT 1 FROM public.people
                        WHERE id = v_person_id AND workspace_id = p_workspace_id
                    ) THEN
                        RAISE EXCEPTION 'Pessoa participante do rateio não pertence ao workspace.';
                    END IF;
                END IF;

                IF v_split.amount IS NULL OR v_split.amount < 0 THEN
                    RAISE EXCEPTION 'O valor de cada fração de rateio não pode ser negativo.';
                END IF;

                v_total_split := v_total_split + v_split.amount;
            END LOOP;

            IF v_total_split <> v_new_amount THEN
                RAISE EXCEPTION 'A soma das frações do rateio (R$ %) deve ser exatamente igual ao valor total da transação (R$ %).', v_total_split, v_new_amount;
            END IF;

            DELETE FROM public.transaction_splits existing_split WHERE transaction_id = p_transaction_id
            AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(p_splits) AS x(member_id uuid, person_id uuid)
                WHERE x.member_id IS NOT DISTINCT FROM existing_split.member_id
                  AND x.person_id IS NOT DISTINCT FROM existing_split.person_id);

            FOR v_split IN SELECT * FROM jsonb_to_recordset(p_splits) AS x(member_id UUID, person_id UUID, amount NUMERIC, percentage NUMERIC) LOOP
                UPDATE public.transaction_splits SET amount = v_split.amount, percentage = v_split.percentage
                WHERE transaction_id = p_transaction_id
                  AND member_id IS NOT DISTINCT FROM v_split.member_id
                  AND person_id IS NOT DISTINCT FROM v_split.person_id;
            IF NOT FOUND THEN
                INSERT INTO public.transaction_splits (workspace_id, transaction_id, member_id, person_id, amount, percentage)
                VALUES (p_workspace_id, p_transaction_id, v_split.member_id, v_split.person_id, v_split.amount, v_split.percentage);
            END IF;
            END LOOP;
        ELSE
            DELETE FROM public.transaction_splits WHERE transaction_id = p_transaction_id;
        END IF;
    END IF;

    -- Atualiza a transação com recálculo completo de status e paid_at
    UPDATE public.transactions
    SET description = COALESCE(TRIM(p_description), description),
        amount = v_new_amount,
        transaction_date = COALESCE(p_transaction_date, transaction_date),
        due_date = COALESCE(p_due_date, due_date),
        type = v_new_type,
        category_id = p_category_id,
        account_id = p_account_id,
        payment_method_id = p_payment_method_id,
        credit_card_id = p_credit_card_id,
        credit_card_bill_id = p_credit_card_bill_id,
        notes = p_notes,
        paid_by_member_id = p_paid_by_member_id,
        paid_by_person_id = p_paid_by_person_id,
        split_type = COALESCE(p_split_type, split_type),
        status = CASE
            WHEN v_old_tx.credit_card_bill_id IS NOT NULL THEN v_old_tx.status
            WHEN v_paid_total >= v_new_amount AND v_paid_total > 0 THEN 'paid'
            WHEN v_paid_total > 0 THEN 'partially_paid'
            WHEN COALESCE(p_due_date, due_date) < CURRENT_DATE THEN 'overdue'
            ELSE 'pending'
        END,
        paid_at = CASE
            WHEN v_old_tx.credit_card_bill_id IS NOT NULL THEN v_old_tx.paid_at
            WHEN v_paid_total >= v_new_amount AND v_paid_total > 0 THEN COALESCE(paid_at, CURRENT_TIMESTAMP)
            ELSE NULL
        END
    WHERE id = p_transaction_id AND workspace_id = p_workspace_id;

    RETURN p_transaction_id;
END;
$function$
;
