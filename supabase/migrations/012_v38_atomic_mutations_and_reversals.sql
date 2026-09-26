-- ==============================================================================
-- MIGRATION 012: RPCS TRANSACIONAIS ATÔMICAS E REVERSÕES FINANCEIRAS
-- ==============================================================================
-- 1. Criação atômica de transação com rateios (fn_create_transaction_with_splits)
-- 2. Criação atômica de compra parcelada com parcelas e rateios (fn_create_purchase_with_splits)
-- 3. Exclusão e reversão atômica de pagamentos com estorno de saldos e obrigações (fn_delete_payment)
-- 4. Exclusão e reversão atômica de transferências com estorno de saldos (fn_delete_transfer)
-- ==============================================================================

-- 1. CRIAÇÃO ATÔMICA DE TRANSAÇÃO COM RATEIOS
CREATE OR REPLACE FUNCTION public.fn_create_transaction_with_splits(
    p_workspace_id UUID,
    p_description TEXT,
    p_amount NUMERIC(12, 2),
    p_transaction_date DATE DEFAULT CURRENT_DATE,
    p_type TEXT DEFAULT 'expense',
    p_status TEXT DEFAULT 'paid',
    p_category_id UUID DEFAULT NULL,
    p_account_id UUID DEFAULT NULL,
    p_payment_method_id UUID DEFAULT NULL,
    p_credit_card_id UUID DEFAULT NULL,
    p_credit_card_bill_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_paid_by_member_id UUID DEFAULT NULL,
    p_split_type TEXT DEFAULT 'individual',
    p_due_date DATE DEFAULT NULL,
    p_splits JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_tx_id UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: você não possui permissão de escrita neste workspace.';
    END IF;

    IF TRIM(COALESCE(p_description, '')) = '' THEN
        RAISE EXCEPTION 'A descrição da transação não pode ser vazia.';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'O valor da transação deve ser maior que zero.';
    END IF;

    INSERT INTO public.transactions (
        workspace_id, description, amount, transaction_date, due_date,
        type, status, category_id, account_id, payment_method_id,
        credit_card_id, credit_card_bill_id, notes, paid_by_member_id,
        split_type, created_by
    )
    VALUES (
        p_workspace_id, TRIM(p_description), p_amount, COALESCE(p_transaction_date, CURRENT_DATE),
        COALESCE(p_due_date, p_transaction_date, CURRENT_DATE),
        COALESCE(p_type, 'expense'), COALESCE(p_status, 'paid'),
        p_category_id, p_account_id, p_payment_method_id,
        p_credit_card_id, p_credit_card_bill_id, p_notes,
        p_paid_by_member_id, COALESCE(p_split_type, 'individual'), v_user_id
    )
    RETURNING id INTO v_tx_id;

    -- Se splits foram fornecidos, sincroniza na mesma transação atômica.
    -- Caso a validação de rateio falhe (soma divergente, membro inválido),
    -- a transação inteira sofre rollback automático.
    IF p_splits IS NOT NULL AND jsonb_array_length(p_splits) > 0 THEN
        PERFORM public.fn_set_transaction_splits(p_workspace_id, v_tx_id, p_splits);
    END IF;

    RETURN v_tx_id;
END;
$$;

-- 2. CRIAÇÃO ATÔMICA DE COMPRA PARCELADA COM RATEIOS
CREATE OR REPLACE FUNCTION public.fn_create_purchase_with_splits(
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
    p_split_type TEXT DEFAULT 'individual',
    p_splits JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_purchase_id UUID;
BEGIN
    -- Gera compra, parcelas e ciclos de faturas de forma atômica
    v_purchase_id := public.fn_create_installment_purchase(
        p_workspace_id,
        p_description,
        p_total_amount,
        p_installment_count,
        p_purchase_date,
        p_credit_card_id,
        p_category_id,
        p_account_id,
        p_payment_method_id,
        p_paid_installments_count,
        p_paid_by_member_id,
        p_split_type
    );

    -- Se splits foram fornecidos, sincroniza na mesma transação atômica
    IF p_splits IS NOT NULL AND jsonb_array_length(p_splits) > 0 THEN
        PERFORM public.fn_set_purchase_splits(p_workspace_id, v_purchase_id, p_splits);
    END IF;

    RETURN v_purchase_id;
END;
$$;

-- 3. EXCLUSÃO E REVERSÃO ATÔMICA DE PAGAMENTO
CREATE OR REPLACE FUNCTION public.fn_delete_payment(
    p_workspace_id UUID,
    p_payment_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_payment RECORD;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: você não possui permissão de escrita neste workspace.';
    END IF;

    SELECT * INTO v_payment
    FROM public.payments
    WHERE id = p_payment_id AND workspace_id = p_workspace_id
    FOR UPDATE;

    IF v_payment.id IS NULL THEN
        RAISE EXCEPTION 'Pagamento não encontrado no workspace informado.';
    END IF;

    -- Reverte impacto no saldo da conta caso tenha afetado saldo
    IF v_payment.affects_balance AND v_payment.account_id IS NOT NULL THEN
        UPDATE public.accounts
        SET current_balance = current_balance + v_payment.amount
        WHERE id = v_payment.account_id AND workspace_id = p_workspace_id;
    END IF;

    -- Reverte status da transação vinculada
    IF v_payment.transaction_id IS NOT NULL THEN
        UPDATE public.transactions
        SET status = 'pending',
            paid_at = NULL
        WHERE id = v_payment.transaction_id AND workspace_id = p_workspace_id;
    END IF;

    -- Reverte status da parcela vinculada
    IF v_payment.installment_id IS NOT NULL THEN
        UPDATE public.installments
        SET paid_amount = GREATEST(0, paid_amount - v_payment.amount),
            status = CASE 
                WHEN GREATEST(0, paid_amount - v_payment.amount) = 0 THEN 'pending'
                ELSE 'partially_paid'
            END,
            paid_at = NULL
        WHERE id = v_payment.installment_id;
    END IF;

    -- Reverte status da fatura de cartão vinculada
    IF v_payment.credit_card_bill_id IS NOT NULL THEN
        UPDATE public.credit_card_bills
        SET paid_amount = GREATEST(0, paid_amount - v_payment.amount),
            status = 'open',
            paid_at = NULL
        WHERE id = v_payment.credit_card_bill_id AND workspace_id = p_workspace_id;
    END IF;

    -- Remove o registro de pagamento
    DELETE FROM public.payments
    WHERE id = p_payment_id AND workspace_id = p_workspace_id;

    RETURN TRUE;
END;
$$;

-- 4. EXCLUSÃO E REVERSÃO ATÔMICA DE TRANSFERÊNCIA
CREATE OR REPLACE FUNCTION public.fn_delete_transfer(
    p_workspace_id UUID,
    p_transfer_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_transfer RECORD;
    v_first_acc UUID;
    v_second_acc UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: você não possui permissão de escrita neste workspace.';
    END IF;

    SELECT * INTO v_transfer
    FROM public.transfers
    WHERE id = p_transfer_id AND workspace_id = p_workspace_id
    FOR UPDATE;

    IF v_transfer.id IS NULL THEN
        RAISE EXCEPTION 'Transferência não encontrada no workspace informado.';
    END IF;

    -- Bloqueio determinístico de contas para prevenção de deadlock
    IF v_transfer.from_account_id < v_transfer.to_account_id THEN
        v_first_acc := v_transfer.from_account_id;
        v_second_acc := v_transfer.to_account_id;
    ELSE
        v_first_acc := v_transfer.to_account_id;
        v_second_acc := v_transfer.from_account_id;
    END IF;

    PERFORM 1 FROM public.accounts WHERE id = v_first_acc AND workspace_id = p_workspace_id FOR UPDATE;
    PERFORM 1 FROM public.accounts WHERE id = v_second_acc AND workspace_id = p_workspace_id FOR UPDATE;

    -- Estorna: devolve o valor debitado para from_account_id e subtrai de to_account_id
    UPDATE public.accounts
    SET current_balance = current_balance + v_transfer.amount
    WHERE id = v_transfer.from_account_id AND workspace_id = p_workspace_id;

    UPDATE public.accounts
    SET current_balance = current_balance - v_transfer.amount
    WHERE id = v_transfer.to_account_id AND workspace_id = p_workspace_id;

    -- Remove o registro de transferência
    DELETE FROM public.transfers
    WHERE id = p_transfer_id AND workspace_id = p_workspace_id;

    RETURN TRUE;
END;
$$;

-- Permissões de Execução
GRANT EXECUTE ON FUNCTION public.fn_create_transaction_with_splits TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_purchase_with_splits TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_delete_payment TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_delete_transfer TO authenticated;
