-- Migration 017: RPCs atômicas de exclusão de transação e compra com estorno de pagamentos e reconciliação de faturas
-- Garante que deleteTransaction e deletePurchase revertam saldos bancários e mantenham faturas íntegras

-- 1. RPC ATÔMICA PARA EXCLUSÃO DE TRANSAÇÃO (fn_delete_transaction)
CREATE OR REPLACE FUNCTION public.fn_delete_transaction(
    p_workspace_id UUID,
    p_transaction_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_tx RECORD;
    v_pay RECORD;
    v_bill RECORD;
    v_new_bill_total NUMERIC(12, 2);
    v_bill_fully_paid BOOLEAN;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: você não possui permissão de escrita neste workspace.';
    END IF;

    SELECT * INTO v_tx
    FROM public.transactions
    WHERE id = p_transaction_id AND workspace_id = p_workspace_id
    FOR UPDATE;

    IF v_tx.id IS NULL THEN
        RAISE EXCEPTION 'Transação não encontrada no workspace informado.';
    END IF;

    -- 1. Se a transação estiver vinculada a uma fatura de cartão de crédito:
    -- o total_amount da fatura deve ser reduzido do valor da transação (v_tx.amount).
    -- Verifica se a redução não deixa total_amount < paid_amount
    IF v_tx.credit_card_bill_id IS NOT NULL THEN
        SELECT * INTO v_bill
        FROM public.credit_card_bills
        WHERE id = v_tx.credit_card_bill_id AND workspace_id = p_workspace_id
        FOR UPDATE;

        IF v_bill.id IS NOT NULL THEN
            v_new_bill_total := v_bill.total_amount - v_tx.amount;
            IF v_new_bill_total < v_bill.paid_amount THEN
                RAISE EXCEPTION 'A exclusão da transação resulta na fatura % com valor total (R$ %) inferior ao valor já pago nela (R$ %). Estorne ou reduza os pagamentos da fatura antes.',
                    v_bill.reference_month, v_new_bill_total, v_bill.paid_amount;
            END IF;

            v_bill_fully_paid := (v_bill.paid_amount >= v_new_bill_total) AND (v_new_bill_total > 0);

            UPDATE public.credit_card_bills
            SET total_amount = v_new_bill_total,
                status = CASE 
                    WHEN v_bill_fully_paid THEN 'paid'
                    WHEN paid_amount > 0 THEN 'partially_paid'
                    ELSE 'open'
                END,
                paid_at = CASE
                    WHEN v_bill_fully_paid THEN COALESCE(paid_at, NOW())
                    WHEN v_new_bill_total = 0 AND paid_amount = 0 THEN NULL
                    ELSE paid_at
                END
            WHERE id = v_tx.credit_card_bill_id;

            -- Se a fatura ficou quitada com essa exclusão, sincroniza as parcelas e demais transações da fatura
            IF v_bill_fully_paid THEN
                UPDATE public.installments
                SET status = 'paid',
                    paid_amount = amount,
                    paid_at = COALESCE(paid_at, NOW())
                WHERE credit_card_bill_id = v_tx.credit_card_bill_id;

                UPDATE public.transactions
                SET status = 'paid',
                    paid_at = COALESCE(paid_at, NOW())
                WHERE credit_card_bill_id = v_tx.credit_card_bill_id AND id <> p_transaction_id;
            END IF;
        END IF;
    END IF;

    -- 2. Estorna todos os pagamentos vinculados a esta transação
    FOR v_pay IN
        SELECT * FROM public.payments
        WHERE transaction_id = p_transaction_id AND workspace_id = p_workspace_id
        FOR UPDATE
    LOOP
        -- Reverte o saldo bancário
        IF v_pay.affects_balance AND v_pay.account_id IS NOT NULL THEN
            IF v_tx.type = 'income' THEN
                -- Pagamento de receita havia somado ao saldo -> estorno subtrai
                UPDATE public.accounts
                SET current_balance = current_balance - v_pay.amount
                WHERE id = v_pay.account_id AND workspace_id = p_workspace_id;
            ELSE
                -- Pagamento de despesa havia subtraído do saldo -> estorno soma
                UPDATE public.accounts
                SET current_balance = current_balance + v_pay.amount
                WHERE id = v_pay.account_id AND workspace_id = p_workspace_id;
            END IF;
        END IF;

        DELETE FROM public.payments WHERE id = v_pay.id;
    END LOOP;

    -- 3. Exclui rateios (splits) da transação
    DELETE FROM public.transaction_splits WHERE transaction_id = p_transaction_id;

    -- 4. Exclui a transação
    DELETE FROM public.transactions WHERE id = p_transaction_id AND workspace_id = p_workspace_id;

    RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_delete_transaction(UUID, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_delete_transaction(UUID, UUID) FROM public, anon;

-- 2. RPC ATÔMICA PARA EXCLUSÃO DE COMPRA PARCELADA (fn_delete_purchase)
CREATE OR REPLACE FUNCTION public.fn_delete_purchase(
    p_workspace_id UUID,
    p_purchase_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_purchase RECORD;
    v_inst RECORD;
    v_pay RECORD;
    v_bill RECORD;
    v_new_bill_total NUMERIC(12, 2);
    v_bill_fully_paid BOOLEAN;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: você não possui permissão de escrita neste workspace.';
    END IF;

    SELECT * INTO v_purchase
    FROM public.purchases
    WHERE id = p_purchase_id AND workspace_id = p_workspace_id
    FOR UPDATE;

    IF v_purchase.id IS NULL THEN
        RAISE EXCEPTION 'Compra parcelada não encontrada no workspace informado.';
    END IF;

    -- 1. Pré-validação e ajuste das faturas de cartão vinculadas às parcelas da compra
    FOR v_bill IN
        SELECT b.id, b.reference_month, b.total_amount, b.paid_amount, SUM(i.amount) AS sum_reduction
        FROM public.installments i
        JOIN public.credit_card_bills b ON b.id = i.credit_card_bill_id
        WHERE i.purchase_id = p_purchase_id AND i.credit_card_bill_id IS NOT NULL AND b.workspace_id = p_workspace_id
        GROUP BY b.id, b.reference_month, b.total_amount, b.paid_amount
    LOOP
        v_new_bill_total := v_bill.total_amount - v_bill.sum_reduction;
        IF v_new_bill_total < v_bill.paid_amount THEN
            RAISE EXCEPTION 'A exclusão da compra resulta na fatura % com valor total (R$ %) inferior ao valor já pago nela (R$ %). Estorne ou reduza os pagamentos da fatura antes.',
                v_bill.reference_month, v_new_bill_total, v_bill.paid_amount;
        END IF;

        v_bill_fully_paid := (v_bill.paid_amount >= v_new_bill_total) AND (v_new_bill_total > 0);

        UPDATE public.credit_card_bills
        SET total_amount = v_new_bill_total,
            status = CASE 
                WHEN v_bill_fully_paid THEN 'paid'
                WHEN paid_amount > 0 THEN 'partially_paid'
                ELSE 'open'
            END,
            paid_at = CASE
                WHEN v_bill_fully_paid THEN COALESCE(paid_at, NOW())
                WHEN v_new_bill_total = 0 AND paid_amount = 0 THEN NULL
                ELSE paid_at
            END
        WHERE id = v_bill.id;

        -- Se a fatura ficou totalmente quitada, sincroniza outras parcelas e transações avulsas
        IF v_bill_fully_paid THEN
            UPDATE public.installments
            SET status = 'paid',
                paid_amount = amount,
                paid_at = COALESCE(paid_at, NOW())
            WHERE credit_card_bill_id = v_bill.id AND purchase_id <> p_purchase_id;

            UPDATE public.transactions
            SET status = 'paid',
                paid_at = COALESCE(paid_at, NOW())
            WHERE credit_card_bill_id = v_bill.id;
        END IF;
    END LOOP;

    -- 2. Estorna todos os pagamentos vinculados às parcelas desta compra
    FOR v_pay IN
        SELECT p.*
        FROM public.payments p
        JOIN public.installments i ON i.id = p.installment_id
        WHERE i.purchase_id = p_purchase_id AND p.workspace_id = p_workspace_id
        FOR UPDATE
    LOOP
        -- Compra é despesa: pagamento havia debitado conta bancária -> estorno credita (+amount)
        IF v_pay.affects_balance AND v_pay.account_id IS NOT NULL THEN
            UPDATE public.accounts
            SET current_balance = current_balance + v_pay.amount
            WHERE id = v_pay.account_id AND workspace_id = p_workspace_id;
        END IF;

        DELETE FROM public.payments WHERE id = v_pay.id;
    END LOOP;

    -- 3. Exclui parcelas da compra
    DELETE FROM public.installments WHERE purchase_id = p_purchase_id;

    -- 4. Exclui rateios (splits) da compra
    DELETE FROM public.purchase_splits WHERE purchase_id = p_purchase_id;

    -- 5. Exclui a compra
    DELETE FROM public.purchases WHERE id = p_purchase_id AND workspace_id = p_workspace_id;

    RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_delete_purchase(UUID, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_delete_purchase(UUID, UUID) FROM public, anon;
