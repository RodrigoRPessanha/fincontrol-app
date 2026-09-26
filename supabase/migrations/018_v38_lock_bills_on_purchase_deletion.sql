-- Migration 018: Lock determinístico e recálculo seguro de faturas na exclusão concorrente de compras
-- Garante que exclusões concorrentes de compras vinculadas à mesma fatura de cartão de crédito
-- obtenham lock exclusivo (FOR UPDATE) ordenado por id e recalculem o total_amount após o lock,
-- eliminando race conditions onde o total antigo era lido simultaneamente por duas transações.

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
    v_bill_reduction RECORD;
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

    -- 1. Reconciliação das faturas de cartão vinculadas às parcelas da compra.
    -- Para garantir segurança contra concorrência e evitar race conditions em exclusões
    -- simultâneas de compras vinculadas à mesma fatura, agrupamos as reduções por fatura,
    -- iteramos em ordem determinística (ORDER BY credit_card_bill_id), obtemos o lock exclusivo
    -- na linha da fatura (FOR UPDATE) e recalculamos o total após obter o lock com os valores mais recentes.
    FOR v_bill_reduction IN
        SELECT i.credit_card_bill_id AS bill_id, SUM(i.amount) AS sum_reduction
        FROM public.installments i
        WHERE i.purchase_id = p_purchase_id AND i.credit_card_bill_id IS NOT NULL
        GROUP BY i.credit_card_bill_id
        ORDER BY i.credit_card_bill_id
    LOOP
        SELECT * INTO v_bill
        FROM public.credit_card_bills
        WHERE id = v_bill_reduction.bill_id AND workspace_id = p_workspace_id
        FOR UPDATE;

        IF v_bill.id IS NOT NULL THEN
            v_new_bill_total := v_bill.total_amount - v_bill_reduction.sum_reduction;
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
        END IF;
    END LOOP;

    -- 2. Estorna todos os pagamentos vinculados às parcelas desta compra
    FOR v_pay IN
        SELECT p.*
        FROM public.payments p
        JOIN public.installments i ON i.id = p.installment_id
        WHERE i.purchase_id = p_purchase_id AND p.workspace_id = p_workspace_id
        FOR UPDATE OF p
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
