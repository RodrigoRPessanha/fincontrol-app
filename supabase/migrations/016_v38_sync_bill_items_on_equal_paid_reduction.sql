-- Migration 016: Sincronização de parcelas e transações vinculadas quando redução de compra quita fatura de cartão
-- Garante que se o total_amount de uma fatura for reduzido até igualar o paid_amount existente, a fatura e todos os seus itens fiquem como 'paid'

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
    p_splits JSONB DEFAULT NULL
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
    v_fully_paid_amount NUMERIC(12, 2) := 0;
    v_total_paid_all NUMERIC(12, 2) := 0;
    v_paid_count INT := 0;
    v_unpaid_count INT := 0;
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
        RAISE EXCEPTION 'Acesso negado: você não possui permissão de escrita neste workspace.';
    END IF;

    SELECT * INTO v_old_purchase
    FROM public.purchases
    WHERE id = p_purchase_id AND workspace_id = p_workspace_id
    FOR UPDATE;

    IF v_old_purchase.id IS NULL THEN
        RAISE EXCEPTION 'Compra parcelada não encontrada no workspace informado.';
    END IF;

    v_new_amount := COALESCE(p_total_amount, v_old_purchase.total_amount);
    IF v_new_amount <= 0 THEN
        RAISE EXCEPTION 'O valor total da compra deve ser estritamente maior que zero.';
    END IF;

    -- 1. Sincroniza splits PRIMEIRO para satisfazer o trigger incondicional
    IF p_splits IS NOT NULL THEN
        IF jsonb_array_length(p_splits) > 0 THEN
            FOR v_split IN SELECT * FROM jsonb_to_recordset(p_splits) AS x(member_id UUID, amount NUMERIC, percentage NUMERIC) LOOP
                IF v_split.member_id IS NULL THEN
                    RAISE EXCEPTION 'Cada fração de rateio deve informar um member_id válido.';
                END IF;

                IF NOT EXISTS (
                    SELECT 1 FROM public.workspace_members 
                    WHERE id = v_split.member_id AND workspace_id = p_workspace_id
                ) THEN
                    RAISE EXCEPTION 'Membro do rateio não pertence ao workspace.';
                END IF;

                IF v_split.amount IS NULL OR v_split.amount <= 0 THEN
                    RAISE EXCEPTION 'O valor de cada fração do rateio deve ser estritamente maior que zero.';
                END IF;

                v_total_split := v_total_split + v_split.amount;
            END LOOP;

            IF v_total_split <> v_new_amount THEN
                RAISE EXCEPTION 'A soma das frações do rateio (R$ %) deve ser exatamente igual ao valor total da compra (R$ %).', v_total_split, v_new_amount;
            END IF;

            DELETE FROM public.purchase_splits WHERE purchase_id = p_purchase_id;

            FOR v_split IN SELECT * FROM jsonb_to_recordset(p_splits) AS x(member_id UUID, amount NUMERIC, percentage NUMERIC) LOOP
                INSERT INTO public.purchase_splits (workspace_id, purchase_id, member_id, amount, percentage)
                VALUES (p_workspace_id, p_purchase_id, v_split.member_id, v_split.amount, v_split.percentage);
            END LOOP;
        ELSE
            DELETE FROM public.purchase_splits WHERE purchase_id = p_purchase_id;
        END IF;
    END IF;

    -- 2. Reconciliação das parcelas (installments) e faturas vinculadas caso o total_amount tenha mudado
    IF v_new_amount <> v_old_purchase.total_amount THEN
        -- Soma dos valores das parcelas totalmente quitadas
        SELECT 
            COALESCE(SUM(amount), 0),
            COUNT(*)
        INTO v_fully_paid_amount, v_paid_count
        FROM public.installments
        WHERE purchase_id = p_purchase_id AND (status = 'paid' OR paid_amount >= amount);

        -- Total pago no somatório de todas as parcelas
        SELECT COALESCE(SUM(paid_amount), 0) INTO v_total_paid_all
        FROM public.installments
        WHERE purchase_id = p_purchase_id;

        IF v_new_amount < v_total_paid_all THEN
            RAISE EXCEPTION 'O novo valor total da compra (R$ %) não pode ser menor do que o total já pago pelas parcelas (R$ %).', v_new_amount, v_total_paid_all;
        END IF;

        IF v_paid_count >= v_old_purchase.installment_count THEN
            RAISE EXCEPTION 'Todas as parcelas desta compra já foram quitadas e seu valor não pode ser alterado.';
        END IF;

        v_unpaid_count := v_old_purchase.installment_count - v_paid_count;
        v_remaining_amount := v_new_amount - v_fully_paid_amount;
        v_base_inst := TRUNC(v_remaining_amount / v_unpaid_count, 2);
        v_rem_inst := v_remaining_amount - (v_base_inst * v_unpaid_count);
        v_first_inst := v_base_inst + v_rem_inst;

        FOR v_inst IN 
            SELECT id, amount, paid_amount, due_date, credit_card_bill_id 
            FROM public.installments 
            WHERE purchase_id = p_purchase_id AND status <> 'paid' AND paid_amount < amount
            ORDER BY installment_number ASC 
            FOR UPDATE
        LOOP
            v_inst_idx := v_inst_idx + 1;
            IF v_inst_idx = 1 THEN
                v_inst_amt := v_first_inst;
            ELSE
                v_inst_amt := v_base_inst;
            END IF;

            IF v_inst_amt < v_inst.paid_amount THEN
                RAISE EXCEPTION 'O novo valor da parcela (R$ %) não pode ser menor do que o valor já pago nela (R$ %).', v_inst_amt, v_inst.paid_amount;
            END IF;

            v_diff := v_inst_amt - v_inst.amount;
            v_bill := NULL;
            v_bill_fully_paid := FALSE;

            -- Ajusta a fatura de cartão correspondente se houver diferença, impedindo que total_amount fique abaixo de paid_amount
            IF v_diff <> 0 AND v_inst.credit_card_bill_id IS NOT NULL THEN
                SELECT id, total_amount, paid_amount, reference_month
                INTO v_bill
                FROM public.credit_card_bills
                WHERE id = v_inst.credit_card_bill_id
                FOR UPDATE;

                IF v_bill.id IS NOT NULL THEN
                    IF (v_bill.total_amount + v_diff) < v_bill.paid_amount THEN
                        RAISE EXCEPTION 'O novo valor da compra resulta na fatura % com valor total (R$ %) inferior ao valor já pago nela (R$ %). Estorne ou reduza os pagamentos da fatura antes.',
                            v_bill.reference_month, (v_bill.total_amount + v_diff), v_bill.paid_amount;
                    END IF;

                    v_bill_fully_paid := (v_bill.paid_amount >= (v_bill.total_amount + v_diff)) AND ((v_bill.total_amount + v_diff) > 0);

                    UPDATE public.credit_card_bills
                    SET total_amount = total_amount + v_diff,
                        status = CASE 
                            WHEN v_bill_fully_paid THEN 'paid' 
                            WHEN paid_amount > 0 THEN 'partially_paid' 
                            ELSE 'open' 
                        END,
                        paid_at = CASE
                            WHEN v_bill_fully_paid THEN COALESCE(paid_at, NOW())
                            ELSE paid_at
                        END
                    WHERE id = v_inst.credit_card_bill_id;

                    -- Se a fatura foi quitada pela redução do total, sincroniza os demais itens vinculados à fatura
                    IF v_bill_fully_paid THEN
                        UPDATE public.installments
                        SET status = 'paid',
                            paid_amount = amount,
                            paid_at = COALESCE(paid_at, NOW())
                        WHERE credit_card_bill_id = v_inst.credit_card_bill_id AND id <> v_inst.id;

                        UPDATE public.transactions
                        SET status = 'paid',
                            paid_at = COALESCE(paid_at, NOW())
                        WHERE credit_card_bill_id = v_inst.credit_card_bill_id;
                    END IF;
                END IF;
            END IF;

            -- Atualiza o valor, status e paid_amount da parcela atual
            UPDATE public.installments
            SET amount = v_inst_amt,
                status = CASE
                    WHEN v_bill_fully_paid THEN 'paid'
                    WHEN paid_amount >= v_inst_amt AND v_inst_amt > 0 THEN 'paid'
                    WHEN paid_amount > 0 THEN 'partially_paid'
                    WHEN due_date < CURRENT_DATE THEN 'overdue'
                    ELSE 'pending'
                END,
                paid_amount = CASE
                    WHEN v_bill_fully_paid THEN v_inst_amt
                    ELSE paid_amount
                END,
                paid_at = CASE
                    WHEN v_bill_fully_paid THEN COALESCE(paid_at, NOW())
                    WHEN paid_amount >= v_inst_amt AND v_inst_amt > 0 THEN COALESCE(paid_at, NOW())
                    ELSE NULL
                END
            WHERE id = v_inst.id;
        END LOOP;
    END IF;

    -- 3. Atualiza a compra (o trigger incondicional trg_check_purchase_amount_split validará total_amount contra os splits já gravados)
    UPDATE public.purchases
    SET description = COALESCE(TRIM(p_description), description),
        total_amount = v_new_amount,
        purchase_date = COALESCE(p_purchase_date, purchase_date),
        category_id = p_category_id,
        account_id = p_account_id,
        payment_method_id = p_payment_method_id,
        credit_card_id = p_credit_card_id,
        paid_by_member_id = p_paid_by_member_id,
        split_type = COALESCE(p_split_type, split_type)
    WHERE id = p_purchase_id AND workspace_id = p_workspace_id;

    RETURN p_purchase_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_update_purchase_with_splits(UUID, UUID, TEXT, NUMERIC, DATE, UUID, UUID, UUID, UUID, UUID, TEXT, JSONB) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_update_purchase_with_splits(UUID, UUID, TEXT, NUMERIC, DATE, UUID, UUID, UUID, UUID, UUID, TEXT, JSONB) FROM public, anon;
