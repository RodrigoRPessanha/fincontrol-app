-- ==============================================================================
-- FINCONTROL DATABASE MIGRATION 039 (V38 Revision 4)
-- Reinicialização de Estado de Quitação de Fatura por Parcela em Atualização de Compra
--
-- [P1] fn_update_purchase_with_splits:
--      Reinicializa explicitamente v_bill_fully_paid := FALSE e v_bill := NULL no início
--      de cada iteração do loop de parcelas.
--      Determina a quitação exclusivamente com base na fatura da parcela da iteração corrente,
--      impedindo que a quitação de uma fatura contamine parcelas de faturas subsequentes cujo
--      valor não se alterou (v_diff = 0).
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.fn_update_purchase_with_splits(
    p_workspace_id UUID,
    p_purchase_id UUID,
    p_description TEXT DEFAULT NULL,
    p_total_amount NUMERIC(12, 2) DEFAULT NULL,
    p_purchase_date DATE DEFAULT NULL,
    p_category_id UUID DEFAULT NULL,
    p_account_id UUID DEFAULT NULL,
    p_payment_method_id UUID DEFAULT NULL,
    p_credit_card_id UUID DEFAULT NULL,
    p_paid_by_member_id UUID DEFAULT NULL,
    p_split_type TEXT DEFAULT NULL,
    p_splits JSONB DEFAULT NULL,
    p_paid_by_person_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_old_purchase RECORD;
    v_new_amount NUMERIC(12, 2);
    v_split RECORD;
    v_total_split NUMERIC(12, 2) := 0;
    v_member_id UUID;
    v_person_id UUID;
    v_seen_members UUID[] := '{}';
    v_seen_people UUID[] := '{}';
    v_unpaid_count INT := 0;
    v_paid_count INT := 0;
    v_total_paid_all NUMERIC(12, 2) := 0;
    v_fully_paid_amount NUMERIC(12, 2) := 0;
    v_remaining_amount NUMERIC(12, 2);
    v_base_inst NUMERIC(12, 2);
    v_rem_inst NUMERIC(12, 2);
    v_first_inst NUMERIC(12, 2);
    v_inst_amt NUMERIC(12, 2);
    v_inst RECORD;
    v_inst_idx INT := 0;
    v_diff NUMERIC(12, 2);
    v_bill RECORD;
    v_bill_fully_paid BOOLEAN;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: permissão insuficiente no workspace.';
    END IF;

    -- Concorrência: serialização por workspace para mutações financeiras e rateios
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
    PERFORM pg_advisory_xact_lock(hashtext('workspace_debt:' || p_workspace_id::text));

    SELECT * INTO v_old_purchase
    FROM public.purchases
    WHERE id = p_purchase_id AND workspace_id = p_workspace_id
    FOR UPDATE;

    IF v_old_purchase.id IS NULL THEN
        RAISE EXCEPTION 'Compra parcelada não encontrada no workspace informado.';
    END IF;

    v_new_amount := COALESCE(p_total_amount, v_old_purchase.total_amount);
    IF v_new_amount <= 0 THEN
        RAISE EXCEPTION 'O valor da compra deve ser estritamente maior que zero.';
    END IF;

    -- Validação de pagador exclusivo
    IF p_paid_by_member_id IS NOT NULL AND p_paid_by_person_id IS NOT NULL THEN
        RAISE EXCEPTION 'A compra não pode ter paid_by_member_id e paid_by_person_id simultaneamente.';
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

    -- 1. Sincroniza splits se informados
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
                RAISE EXCEPTION 'A soma das frações do rateio (R$ %) deve ser exatamente igual ao valor total da compra (R$ %).', v_total_split, v_new_amount;
            END IF;

            DELETE FROM public.purchase_splits WHERE purchase_id = p_purchase_id;

            FOR v_split IN SELECT * FROM jsonb_to_recordset(p_splits) AS x(member_id UUID, person_id UUID, amount NUMERIC, percentage NUMERIC) LOOP
                INSERT INTO public.purchase_splits (workspace_id, purchase_id, member_id, person_id, amount, percentage)
                VALUES (p_workspace_id, p_purchase_id, v_split.member_id, v_split.person_id, v_split.amount, v_split.percentage);
            END LOOP;
        ELSE
            DELETE FROM public.purchase_splits WHERE purchase_id = p_purchase_id;
        END IF;
    END IF;

    -- 2. Se o valor total mudou, valida parcelas quitadas, pagamentos parciais e reconcilia
    IF v_new_amount <> v_old_purchase.total_amount THEN
        FOR v_inst IN
            SELECT id, installment_number, amount, paid_amount, status
            FROM public.installments
            WHERE purchase_id = p_purchase_id
            ORDER BY installment_number ASC
        LOOP
            v_total_paid_all := v_total_paid_all + COALESCE(v_inst.paid_amount, 0);
            IF v_inst.status = 'paid' THEN
                v_paid_count := v_paid_count + 1;
                v_fully_paid_amount := v_fully_paid_amount + v_inst.amount;
            ELSE
                v_unpaid_count := v_unpaid_count + 1;
            END IF;
        END LOOP;

        IF v_new_amount < v_total_paid_all THEN
            RAISE EXCEPTION 'O novo valor da compra (R$ %) não pode ser menor do que o total já pago em parcelas (R$ %).', v_new_amount, v_total_paid_all;
        END IF;

        IF v_unpaid_count = 0 THEN
            RAISE EXCEPTION 'Não é possível alterar o valor de uma compra cujas parcelas já foram todas quitadas.';
        END IF;

        v_remaining_amount := v_new_amount - v_fully_paid_amount;
        IF v_remaining_amount < (v_unpaid_count * 0.01) THEN
            RAISE EXCEPTION 'O valor restante (R$ %) é insuficiente para cobrir as % parcelas restantes com pelo menos R$ 0,01 cada.', v_remaining_amount, v_unpaid_count;
        END IF;

        v_base_inst := TRUNC(v_remaining_amount / v_unpaid_count, 2);
        v_rem_inst := v_remaining_amount - (v_base_inst * v_unpaid_count);
        v_first_inst := v_base_inst + v_rem_inst;

        FOR v_inst IN
            SELECT id, installment_number, amount, paid_amount, credit_card_bill_id
            FROM public.installments
            WHERE purchase_id = p_purchase_id AND status <> 'paid'
            ORDER BY installment_number ASC
        LOOP
            -- Reinicialização estrita de estado por parcela: evita contaminação entre faturas distintas
            v_bill_fully_paid := FALSE;
            v_bill := NULL;

            v_inst_idx := v_inst_idx + 1;
            IF v_inst_idx = 1 THEN
                v_inst_amt := v_first_inst;
            ELSE
                v_inst_amt := v_base_inst;
            END IF;

            IF v_inst_amt < COALESCE(v_inst.paid_amount, 0) THEN
                RAISE EXCEPTION 'A parcela % não pode ter valor (R$ %) menor do que o montante já pago parcialmente (R$ %).', v_inst.installment_number, v_inst_amt, v_inst.paid_amount;
            END IF;

            v_diff := v_inst_amt - v_inst.amount;

            IF v_inst.credit_card_bill_id IS NOT NULL AND v_diff <> 0 THEN
                SELECT * INTO v_bill
                FROM public.credit_card_bills
                WHERE id = v_inst.credit_card_bill_id AND workspace_id = p_workspace_id
                FOR UPDATE;

                IF (v_bill.total_amount + v_diff) < v_bill.paid_amount THEN
                    RAISE EXCEPTION 'A redução do valor da compra deixaria a fatura % com total menor que o valor já pago (R$ %).', v_bill.reference_month, v_bill.paid_amount;
                END IF;

                v_bill_fully_paid := (v_bill.paid_amount >= (v_bill.total_amount + v_diff)) AND ((v_bill.total_amount + v_diff) > 0);

                UPDATE public.credit_card_bills
                SET total_amount = total_amount + v_diff,
                    status = CASE
                        WHEN (total_amount + v_diff) <= paid_amount THEN 'paid'
                        WHEN paid_amount > 0 THEN 'partially_paid'
                        ELSE status
                    END,
                    paid_at = CASE
                        WHEN (total_amount + v_diff) <= paid_amount THEN COALESCE(paid_at, CURRENT_TIMESTAMP)
                        ELSE paid_at
                    END
                WHERE id = v_inst.credit_card_bill_id;

                -- Se a fatura foi totalmente quitada pela redução, sincroniza parcelas e transações avulsas
                IF v_bill_fully_paid THEN
                    UPDATE public.installments
                    SET paid_amount = amount,
                        status = 'paid',
                        paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP)
                    WHERE credit_card_bill_id = v_inst.credit_card_bill_id
                      AND id <> v_inst.id
                      AND status <> 'paid';

                    UPDATE public.transactions
                    SET status = 'paid',
                        paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP)
                    WHERE credit_card_bill_id = v_inst.credit_card_bill_id
                      AND status <> 'paid';
                END IF;
            END IF;

            UPDATE public.installments
            SET amount = v_inst_amt,
                status = CASE
                    WHEN v_bill_fully_paid THEN 'paid'
                    WHEN v_inst_amt <= COALESCE(paid_amount, 0) AND COALESCE(paid_amount, 0) > 0 THEN 'paid'
                    WHEN COALESCE(paid_amount, 0) > 0 THEN 'partially_paid'
                    ELSE status
                END,
                paid_amount = CASE
                    WHEN v_bill_fully_paid THEN v_inst_amt
                    ELSE paid_amount
                END,
                paid_at = CASE
                    WHEN v_bill_fully_paid THEN COALESCE(paid_at, CURRENT_TIMESTAMP)
                    WHEN v_inst_amt <= COALESCE(paid_amount, 0) AND COALESCE(paid_amount, 0) > 0 THEN COALESCE(paid_at, CURRENT_TIMESTAMP)
                    ELSE paid_at
                END
            WHERE id = v_inst.id;
        END LOOP;
    END IF;

    UPDATE public.purchases
    SET description = COALESCE(TRIM(p_description), description),
        total_amount = v_new_amount,
        purchase_date = COALESCE(p_purchase_date, purchase_date),
        category_id = p_category_id,
        account_id = p_account_id,
        payment_method_id = p_payment_method_id,
        credit_card_id = p_credit_card_id,
        paid_by_member_id = p_paid_by_member_id,
        paid_by_person_id = p_paid_by_person_id,
        split_type = COALESCE(p_split_type, split_type)
    WHERE id = p_purchase_id AND workspace_id = p_workspace_id;

    RETURN p_purchase_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_update_purchase_with_splits(UUID, UUID, TEXT, NUMERIC, DATE, UUID, UUID, UUID, UUID, UUID, TEXT, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_update_purchase_with_splits(UUID, UUID, TEXT, NUMERIC, DATE, UUID, UUID, UUID, UUID, UUID, TEXT, JSONB, UUID) TO authenticated;

INSERT INTO public._db_managed_objects (object_identity, object_type)
SELECT p.oid::regprocedure::text, 'function'
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'fn_update_purchase_with_splits'
ON CONFLICT (object_identity) DO NOTHING;
