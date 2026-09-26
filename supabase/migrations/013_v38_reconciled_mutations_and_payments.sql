-- ==============================================================================
-- MIGRATION 013: RECONCILIAÇÃO FINANCEIRA ATÔMICA, ESTORNO DE RECEITAS E MUTATIONS PARENT-SIDE
-- ==============================================================================
-- 1. Reconciliação precisa em fn_delete_payment (inverte receita vs despesa, recalcula status parcial)
-- 2. Atualização atômica de pagamentos com estorno e reaplicação de saldos (fn_update_payment)
-- 3. Atualização atômica de transferências com estorno bilateral e reaplicação (fn_update_transfer)
-- 4. Triggers parent-side com suporte a bypass em RPCs de atualização atômica pai+splits
-- 5. Atualização atômica de transação e rateios (fn_update_transaction_with_splits)
-- 6. Atualização atômica de compra e rateios (fn_update_purchase_with_splits)
-- 7. Correção de criação de transação 'paid' em fn_create_transaction_with_splits (cria pagamento e ajusta saldo)
-- ==============================================================================

-- 1. RECONCILIAÇÃO CORRETA EM fn_delete_payment
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
    v_tx RECORD;
    v_bill RECORD;
    v_inst RECORD;
    v_is_income BOOLEAN := FALSE;
    v_remaining_paid NUMERIC(12, 2);
    v_latest_paid_at TIMESTAMPTZ;
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

    -- Se há transação vinculada, buscamos para saber se é income ou expense e recalcular status
    IF v_payment.transaction_id IS NOT NULL THEN
        SELECT * INTO v_tx
        FROM public.transactions
        WHERE id = v_payment.transaction_id AND workspace_id = p_workspace_id
        FOR UPDATE;

        IF v_tx.id IS NOT NULL THEN
            IF v_tx.type = 'income' THEN
                v_is_income := TRUE;
            END IF;

            SELECT COALESCE(SUM(amount), 0), MAX(payment_date::TIMESTAMPTZ)
            INTO v_remaining_paid, v_latest_paid_at
            FROM public.payments
            WHERE transaction_id = v_payment.transaction_id AND id <> p_payment_id;

            UPDATE public.transactions
            SET status = CASE
                    WHEN v_remaining_paid >= v_tx.amount THEN 'paid'
                    WHEN v_remaining_paid > 0 THEN 'partially_paid'
                    WHEN v_tx.due_date < CURRENT_DATE THEN 'overdue'
                    ELSE 'pending'
                END,
                paid_at = CASE
                    WHEN v_remaining_paid >= v_tx.amount THEN COALESCE(v_latest_paid_at, CURRENT_TIMESTAMP)
                    ELSE NULL
                END
            WHERE id = v_payment.transaction_id;
        END IF;
    END IF;

    -- Reverte impacto no saldo da conta caso tenha afetado saldo
    IF v_payment.affects_balance AND v_payment.account_id IS NOT NULL THEN
        IF v_is_income THEN
            -- Receita: ao registrar o pagamento o saldo havia SUBIDO; ao estornar, o saldo deve DESCER
            UPDATE public.accounts
            SET current_balance = current_balance - v_payment.amount
            WHERE id = v_payment.account_id AND workspace_id = p_workspace_id;
        ELSE
            -- Despesas, faturas, parcelas ou avulsos: ao registrar o saldo havia DESCIDO; ao estornar, o saldo SOBE
            UPDATE public.accounts
            SET current_balance = current_balance + v_payment.amount
            WHERE id = v_payment.account_id AND workspace_id = p_workspace_id;
        END IF;
    END IF;

    -- Reverte status da parcela vinculada recalculando pagamentos restantes
    IF v_payment.installment_id IS NOT NULL THEN
        SELECT * INTO v_inst
        FROM public.installments
        WHERE id = v_payment.installment_id
        FOR UPDATE;

        IF v_inst.id IS NOT NULL THEN
            SELECT COALESCE(SUM(amount), 0), MAX(payment_date::TIMESTAMPTZ)
            INTO v_remaining_paid, v_latest_paid_at
            FROM public.payments
            WHERE installment_id = v_payment.installment_id AND id <> p_payment_id;

            UPDATE public.installments
            SET paid_amount = v_remaining_paid,
                status = CASE 
                    WHEN v_remaining_paid >= v_inst.amount THEN 'paid'
                    WHEN v_remaining_paid > 0 THEN 'partially_paid'
                    ELSE 'pending'
                END,
                paid_at = CASE
                    WHEN v_remaining_paid >= v_inst.amount THEN COALESCE(v_latest_paid_at, CURRENT_TIMESTAMP)
                    ELSE NULL
                END
            WHERE id = v_payment.installment_id;
        END IF;
    END IF;

    -- Reverte status da fatura de cartão vinculada recalculando pagamentos restantes
    IF v_payment.credit_card_bill_id IS NOT NULL THEN
        SELECT * INTO v_bill
        FROM public.credit_card_bills
        WHERE id = v_payment.credit_card_bill_id AND workspace_id = p_workspace_id
        FOR UPDATE;

        IF v_bill.id IS NOT NULL THEN
            SELECT COALESCE(SUM(amount), 0), MAX(payment_date::TIMESTAMPTZ)
            INTO v_remaining_paid, v_latest_paid_at
            FROM public.payments
            WHERE credit_card_bill_id = v_payment.credit_card_bill_id AND id <> p_payment_id;

            UPDATE public.credit_card_bills
            SET paid_amount = v_remaining_paid,
                status = CASE
                    WHEN v_remaining_paid >= v_bill.total_amount THEN 'paid'
                    WHEN v_remaining_paid > 0 THEN 'partially_paid'
                    ELSE 'open'
                END,
                paid_at = CASE
                    WHEN v_remaining_paid >= v_bill.total_amount THEN COALESCE(v_latest_paid_at, CURRENT_TIMESTAMP)
                    ELSE NULL
                END
            WHERE id = v_payment.credit_card_bill_id;
        END IF;
    END IF;

    -- Remove o registro de pagamento
    DELETE FROM public.payments
    WHERE id = p_payment_id AND workspace_id = p_workspace_id;

    RETURN TRUE;
END;
$$;

-- 2. ATUALIZAÇÃO ATÔMICA DE PAGAMENTOS COM RECONCILIAÇÃO (fn_update_payment)
CREATE OR REPLACE FUNCTION public.fn_update_payment(
    p_workspace_id UUID,
    p_payment_id UUID,
    p_account_id UUID DEFAULT NULL,
    p_amount NUMERIC(12, 2) DEFAULT NULL,
    p_payment_date DATE DEFAULT NULL,
    p_payment_method_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_affects_balance BOOLEAN DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_old_payment RECORD;
    v_new_amount NUMERIC(12, 2);
    v_new_account_id UUID;
    v_new_affects_balance BOOLEAN;
    v_new_payment_date DATE;
    v_tx RECORD;
    v_bill RECORD;
    v_inst RECORD;
    v_target_total NUMERIC(12, 2);
    v_other_paid NUMERIC(12, 2) := 0;
    v_total_paid NUMERIC(12, 2);
    v_is_income BOOLEAN := FALSE;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: você não possui permissão de escrita neste workspace.';
    END IF;

    SELECT * INTO v_old_payment
    FROM public.payments
    WHERE id = p_payment_id AND workspace_id = p_workspace_id
    FOR UPDATE;

    IF v_old_payment.id IS NULL THEN
        RAISE EXCEPTION 'Pagamento não encontrado no workspace informado.';
    END IF;

    v_new_amount := COALESCE(p_amount, v_old_payment.amount);
    v_new_account_id := COALESCE(p_account_id, v_old_payment.account_id);
    v_new_affects_balance := COALESCE(p_affects_balance, v_old_payment.affects_balance);
    v_new_payment_date := COALESCE(p_payment_date, v_old_payment.payment_date);

    IF v_new_amount <= 0 THEN
        RAISE EXCEPTION 'O valor do pagamento deve ser estritamente maior que zero.';
    END IF;

    IF v_new_affects_balance AND v_new_account_id IS NULL THEN
        RAISE EXCEPTION 'Conta bancária de saída é obrigatória quando o pagamento afeta saldo.';
    END IF;

    IF v_new_account_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.accounts WHERE id = v_new_account_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Conta bancária informada não pertence ao workspace.';
    END IF;

    -- Identifica se é receita vinculada
    IF v_old_payment.transaction_id IS NOT NULL THEN
        SELECT * INTO v_tx
        FROM public.transactions
        WHERE id = v_old_payment.transaction_id AND workspace_id = p_workspace_id
        FOR UPDATE;
        IF v_tx.id IS NOT NULL AND v_tx.type = 'income' THEN
            v_is_income := TRUE;
        END IF;
    END IF;

    -- 1. Reverte efeito antigo de saldo
    IF v_old_payment.affects_balance AND v_old_payment.account_id IS NOT NULL THEN
        IF v_is_income THEN
            UPDATE public.accounts
            SET current_balance = current_balance - v_old_payment.amount
            WHERE id = v_old_payment.account_id AND workspace_id = p_workspace_id;
        ELSE
            UPDATE public.accounts
            SET current_balance = current_balance + v_old_payment.amount
            WHERE id = v_old_payment.account_id AND workspace_id = p_workspace_id;
        END IF;
    END IF;

    -- 2. Valida capacidade da obrigação com o novo valor
    IF v_old_payment.transaction_id IS NOT NULL AND v_tx.id IS NOT NULL THEN
        v_target_total := v_tx.amount;
        SELECT COALESCE(SUM(amount), 0) INTO v_other_paid
        FROM public.payments
        WHERE transaction_id = v_old_payment.transaction_id AND id <> p_payment_id;

        IF (v_other_paid + v_new_amount) > v_target_total THEN
            RAISE EXCEPTION 'O novo valor do pagamento (R$ %) somado aos demais (R$ %) excede o valor total da transação (R$ %).', v_new_amount, v_other_paid, v_target_total;
        END IF;

        v_total_paid := v_other_paid + v_new_amount;
        UPDATE public.transactions
        SET status = CASE
                WHEN v_total_paid >= v_target_total THEN 'paid'
                WHEN v_total_paid > 0 THEN 'partially_paid'
                WHEN v_tx.due_date < CURRENT_DATE THEN 'overdue'
                ELSE 'pending'
            END,
            paid_at = CASE
                WHEN v_total_paid >= v_target_total THEN v_new_payment_date::TIMESTAMPTZ
                ELSE NULL
            END
        WHERE id = v_old_payment.transaction_id;
    END IF;

    IF v_old_payment.installment_id IS NOT NULL THEN
        SELECT * INTO v_inst
        FROM public.installments
        WHERE id = v_old_payment.installment_id
        FOR UPDATE;

        IF v_inst.id IS NOT NULL THEN
            v_target_total := v_inst.amount;
            SELECT COALESCE(SUM(amount), 0) INTO v_other_paid
            FROM public.payments
            WHERE installment_id = v_old_payment.installment_id AND id <> p_payment_id;

            IF (v_other_paid + v_new_amount) > v_target_total THEN
                RAISE EXCEPTION 'O novo valor do pagamento (R$ %) somado aos demais (R$ %) excede o valor da parcela (R$ %).', v_new_amount, v_other_paid, v_target_total;
            END IF;

            v_total_paid := v_other_paid + v_new_amount;
            UPDATE public.installments
            SET paid_amount = v_total_paid,
                status = CASE
                    WHEN v_total_paid >= v_target_total THEN 'paid'
                    WHEN v_total_paid > 0 THEN 'partially_paid'
                    ELSE 'pending'
                END,
                paid_at = CASE
                    WHEN v_total_paid >= v_target_total THEN v_new_payment_date::TIMESTAMPTZ
                    ELSE NULL
                END
            WHERE id = v_old_payment.installment_id;
        END IF;
    END IF;

    IF v_old_payment.credit_card_bill_id IS NOT NULL THEN
        SELECT * INTO v_bill
        FROM public.credit_card_bills
        WHERE id = v_old_payment.credit_card_bill_id AND workspace_id = p_workspace_id
        FOR UPDATE;

        IF v_bill.id IS NOT NULL THEN
            v_target_total := v_bill.total_amount;
            SELECT COALESCE(SUM(amount), 0) INTO v_other_paid
            FROM public.payments
            WHERE credit_card_bill_id = v_old_payment.credit_card_bill_id AND id <> p_payment_id;

            IF (v_other_paid + v_new_amount) > v_target_total THEN
                RAISE EXCEPTION 'O novo valor do pagamento (R$ %) somado aos demais (R$ %) excede o valor da fatura (R$ %).', v_new_amount, v_other_paid, v_target_total;
            END IF;

            v_total_paid := v_other_paid + v_new_amount;
            UPDATE public.credit_card_bills
            SET paid_amount = v_total_paid,
                status = CASE
                    WHEN v_total_paid >= v_target_total THEN 'paid'
                    WHEN v_total_paid > 0 THEN 'partially_paid'
                    ELSE 'open'
                END,
                paid_at = CASE
                    WHEN v_total_paid >= v_target_total THEN v_new_payment_date::TIMESTAMPTZ
                    ELSE NULL
                END
            WHERE id = v_old_payment.credit_card_bill_id;
        END IF;
    END IF;

    -- 3. Aplica novo efeito de saldo
    IF v_new_affects_balance AND v_new_account_id IS NOT NULL THEN
        IF v_is_income THEN
            UPDATE public.accounts
            SET current_balance = current_balance + v_new_amount
            WHERE id = v_new_account_id AND workspace_id = p_workspace_id;
        ELSE
            UPDATE public.accounts
            SET current_balance = current_balance - v_new_amount
            WHERE id = v_new_account_id AND workspace_id = p_workspace_id;
        END IF;
    END IF;

    -- 4. Atualiza o registro do pagamento
    UPDATE public.payments
    SET amount = v_new_amount,
        account_id = v_new_account_id,
        payment_date = v_new_payment_date,
        payment_method_id = COALESCE(p_payment_method_id, v_old_payment.payment_method_id),
        notes = COALESCE(p_notes, v_old_payment.notes),
        affects_balance = v_new_affects_balance
    WHERE id = p_payment_id AND workspace_id = p_workspace_id;

    RETURN p_payment_id;
END;
$$;

-- 3. ATUALIZAÇÃO ATÔMICA DE TRANSFERÊNCIAS COM RECONCILIAÇÃO (fn_update_transfer)
CREATE OR REPLACE FUNCTION public.fn_update_transfer(
    p_workspace_id UUID,
    p_transfer_id UUID,
    p_from_account_id UUID DEFAULT NULL,
    p_to_account_id UUID DEFAULT NULL,
    p_amount NUMERIC(12, 2) DEFAULT NULL,
    p_transfer_date DATE DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_old_transfer RECORD;
    v_new_amount NUMERIC(12, 2);
    v_new_from_account_id UUID;
    v_new_to_account_id UUID;
    v_new_date DATE;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: você não possui permissão de escrita neste workspace.';
    END IF;

    SELECT * INTO v_old_transfer
    FROM public.transfers
    WHERE id = p_transfer_id AND workspace_id = p_workspace_id
    FOR UPDATE;

    IF v_old_transfer.id IS NULL THEN
        RAISE EXCEPTION 'Transferência não encontrada no workspace informado.';
    END IF;

    v_new_amount := COALESCE(p_amount, v_old_transfer.amount);
    v_new_from_account_id := COALESCE(p_from_account_id, v_old_transfer.from_account_id);
    v_new_to_account_id := COALESCE(p_to_account_id, v_old_transfer.to_account_id);
    v_new_date := COALESCE(p_transfer_date, v_old_transfer.transfer_date);

    IF v_new_amount <= 0 THEN
        RAISE EXCEPTION 'O valor da transferência deve ser estritamente maior que zero.';
    END IF;

    IF v_new_from_account_id = v_new_to_account_id THEN
        RAISE EXCEPTION 'As contas de origem e destino da transferência devem ser distintas.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = v_new_from_account_id AND workspace_id = p_workspace_id) THEN
        RAISE EXCEPTION 'Conta de origem não pertence ao workspace.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = v_new_to_account_id AND workspace_id = p_workspace_id) THEN
        RAISE EXCEPTION 'Conta de destino não pertence ao workspace.';
    END IF;

    -- 1. Reverte o efeito da transferência antiga:
    -- Origem antiga recebe de volta o valor (credita)
    UPDATE public.accounts
    SET current_balance = current_balance + v_old_transfer.amount
    WHERE id = v_old_transfer.from_account_id AND workspace_id = p_workspace_id;

    -- Destino antigo perde o valor transferido (debita)
    UPDATE public.accounts
    SET current_balance = current_balance - v_old_transfer.amount
    WHERE id = v_old_transfer.to_account_id AND workspace_id = p_workspace_id;

    -- 2. Aplica o efeito da nova transferência:
    -- Nova origem é debitada
    UPDATE public.accounts
    SET current_balance = current_balance - v_new_amount
    WHERE id = v_new_from_account_id AND workspace_id = p_workspace_id;

    -- Novo destino é creditado
    UPDATE public.accounts
    SET current_balance = current_balance + v_new_amount
    WHERE id = v_new_to_account_id AND workspace_id = p_workspace_id;

    -- 3. Atualiza o registro em transfers
    UPDATE public.transfers
    SET from_account_id = v_new_from_account_id,
        to_account_id = v_new_to_account_id,
        amount = v_new_amount,
        transfer_date = v_new_date,
        notes = COALESCE(p_notes, v_old_transfer.notes)
    WHERE id = p_transfer_id AND workspace_id = p_workspace_id;

    RETURN p_transfer_id;
END;
$$;

-- 4. TRIGGERS PARENT-SIDE DE INTEGRIDADE COM SUPORTE A BYPASS CONTROLADO
CREATE OR REPLACE FUNCTION public.fn_check_transaction_amount_split_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_splits_total NUMERIC(12, 2);
    v_splits_count INT;
BEGIN
    IF current_setting('fincontrol.skip_split_check', true) = 'true' THEN
        RETURN NEW;
    END IF;

    IF NEW.amount <> OLD.amount THEN
        SELECT COALESCE(SUM(amount), 0), COUNT(*) 
        INTO v_splits_total, v_splits_count
        FROM public.transaction_splits 
        WHERE transaction_id = NEW.id;

        IF v_splits_count > 0 AND v_splits_total <> NEW.amount THEN
            RAISE EXCEPTION 'A alteração do valor da transação (R$ %) viola a conservação das frações de rateio existentes (R$ %). Atualize os rateios via fn_set_transaction_splits.', NEW.amount, v_splits_total;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_transaction_amount_split ON public.transactions;
CREATE TRIGGER trg_check_transaction_amount_split
    BEFORE UPDATE OF amount ON public.transactions
    FOR EACH ROW EXECUTE FUNCTION public.fn_check_transaction_amount_split_integrity();

CREATE OR REPLACE FUNCTION public.fn_check_purchase_amount_split_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_splits_total NUMERIC(12, 2);
    v_splits_count INT;
BEGIN
    IF current_setting('fincontrol.skip_split_check', true) = 'true' THEN
        RETURN NEW;
    END IF;

    IF NEW.total_amount <> OLD.total_amount THEN
        SELECT COALESCE(SUM(amount), 0), COUNT(*) 
        INTO v_splits_total, v_splits_count
        FROM public.purchase_splits 
        WHERE purchase_id = NEW.id;

        IF v_splits_count > 0 AND v_splits_total <> NEW.total_amount THEN
            RAISE EXCEPTION 'A alteração do valor total da compra parcelada (R$ %) viola a conservação das frações de rateio existentes (R$ %). Atualize os rateios via fn_set_purchase_splits.', NEW.total_amount, v_splits_total;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_purchase_amount_split ON public.purchases;
CREATE TRIGGER trg_check_purchase_amount_split
    BEFORE UPDATE OF total_amount ON public.purchases
    FOR EACH ROW EXECUTE FUNCTION public.fn_check_purchase_amount_split_integrity();

-- 5. ATUALIZAÇÃO ATÔMICA DE TRANSAÇÃO COM RATEIOS (fn_update_transaction_with_splits)
CREATE OR REPLACE FUNCTION public.fn_update_transaction_with_splits(
    p_workspace_id UUID,
    p_transaction_id UUID,
    p_description TEXT DEFAULT NULL,
    p_amount NUMERIC(12, 2) DEFAULT NULL,
    p_transaction_date DATE DEFAULT NULL,
    p_type TEXT DEFAULT NULL,
    p_category_id UUID DEFAULT NULL,
    p_account_id UUID DEFAULT NULL,
    p_payment_method_id UUID DEFAULT NULL,
    p_credit_card_id UUID DEFAULT NULL,
    p_credit_card_bill_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_paid_by_member_id UUID DEFAULT NULL,
    p_split_type TEXT DEFAULT NULL,
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
    v_old_tx RECORD;
    v_new_amount NUMERIC(12, 2);
    v_paid_total NUMERIC(12, 2) := 0;
    v_splits_total NUMERIC(12, 2);
    v_splits_count INT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: você não possui permissão de escrita neste workspace.';
    END IF;

    SELECT * INTO v_old_tx
    FROM public.transactions
    WHERE id = p_transaction_id AND workspace_id = p_workspace_id
    FOR UPDATE;

    IF v_old_tx.id IS NULL THEN
        RAISE EXCEPTION 'Transação não encontrada no workspace informado.';
    END IF;

    v_new_amount := COALESCE(p_amount, v_old_tx.amount);
    IF v_new_amount <= 0 THEN
        RAISE EXCEPTION 'O valor da transação deve ser estritamente maior que zero.';
    END IF;

    -- Valida se o novo valor não é menor que o total já pago
    SELECT COALESCE(SUM(amount), 0) INTO v_paid_total
    FROM public.payments
    WHERE transaction_id = p_transaction_id;

    IF v_paid_total > v_new_amount THEN
        RAISE EXCEPTION 'O novo valor da transação (R$ %) não pode ser menor do que o total já pago (R$ %).', v_new_amount, v_paid_total;
    END IF;

    -- Ativa flag local de bypass para permitir atualização atômica pai + filhos
    PERFORM set_config('fincontrol.skip_split_check', 'true', true);

    -- 1. Atualiza a transação
    UPDATE public.transactions
    SET description = COALESCE(TRIM(p_description), description),
        amount = v_new_amount,
        transaction_date = COALESCE(p_transaction_date, transaction_date),
        due_date = COALESCE(p_due_date, due_date),
        type = COALESCE(p_type, type),
        category_id = p_category_id,
        account_id = p_account_id,
        payment_method_id = p_payment_method_id,
        credit_card_id = p_credit_card_id,
        credit_card_bill_id = p_credit_card_bill_id,
        notes = p_notes,
        paid_by_member_id = p_paid_by_member_id,
        split_type = COALESCE(p_split_type, split_type),
        status = CASE
            WHEN v_paid_total >= v_new_amount AND v_paid_total > 0 THEN 'paid'
            WHEN v_paid_total > 0 THEN 'partially_paid'
            WHEN COALESCE(p_due_date, due_date) < CURRENT_DATE THEN 'overdue'
            ELSE 'pending'
        END
    WHERE id = p_transaction_id AND workspace_id = p_workspace_id;

    -- 2. Se splits foram fornecidos, sincroniza os rateios
    IF p_splits IS NOT NULL THEN
        PERFORM public.fn_set_transaction_splits(p_workspace_id, p_transaction_id, p_splits);
    ELSE
        -- Se não foram fornecidos splits mas já existiam splits e o amount mudou, valida conservação
        SELECT COALESCE(SUM(amount), 0), COUNT(*) 
        INTO v_splits_total, v_splits_count
        FROM public.transaction_splits 
        WHERE transaction_id = p_transaction_id;

        IF v_splits_count > 0 AND v_splits_total <> v_new_amount THEN
            RAISE EXCEPTION 'A alteração do valor da transação (R$ %) viola a conservação das frações de rateio existentes (R$ %). Atualize os rateios via fn_set_transaction_splits.', v_new_amount, v_splits_total;
        END IF;
    END IF;

    PERFORM set_config('fincontrol.skip_split_check', 'false', true);

    RETURN p_transaction_id;
END;
$$;

-- 6. ATUALIZAÇÃO ATÔMICA DE COMPRA COM RATEIOS (fn_update_purchase_with_splits)
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
    v_splits_total NUMERIC(12, 2);
    v_splits_count INT;
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

    -- Ativa flag local de bypass para permitir atualização atômica pai + filhos
    PERFORM set_config('fincontrol.skip_split_check', 'true', true);

    -- 1. Atualiza a compra
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

    -- 2. Se splits foram fornecidos, sincroniza os rateios
    IF p_splits IS NOT NULL THEN
        PERFORM public.fn_set_purchase_splits(p_workspace_id, p_purchase_id, p_splits);
    ELSE
        SELECT COALESCE(SUM(amount), 0), COUNT(*) 
        INTO v_splits_total, v_splits_count
        FROM public.purchase_splits 
        WHERE purchase_id = p_purchase_id;

        IF v_splits_count > 0 AND v_splits_total <> v_new_amount THEN
            RAISE EXCEPTION 'A alteração do valor total da compra parcelada (R$ %) viola a conservação das frações de rateio existentes (R$ %). Atualize os rateios via fn_set_purchase_splits.', v_new_amount, v_splits_total;
        END IF;
    END IF;

    PERFORM set_config('fincontrol.skip_split_check', 'false', true);

    RETURN p_purchase_id;
END;
$$;

-- 7. CORREÇÃO EM fn_create_transaction_with_splits:
-- - status padrão 'pending'
-- - se criada como 'paid', insere pagamento atômico e ajusta saldo da conta
CREATE OR REPLACE FUNCTION public.fn_create_transaction_with_splits(
    p_workspace_id UUID,
    p_description TEXT,
    p_amount NUMERIC(12, 2),
    p_transaction_date DATE DEFAULT CURRENT_DATE,
    p_type TEXT DEFAULT 'expense',
    p_status TEXT DEFAULT 'pending',
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
    v_status TEXT;
    v_ws_mode TEXT;
    v_affects_balance BOOLEAN;
    v_payment_id UUID;
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

    v_status := COALESCE(p_status, 'pending');

    -- Bloqueio: transações de cartão não podem ser criadas com status 'paid' direto (dependem da fatura)
    IF (p_credit_card_id IS NOT NULL OR p_credit_card_bill_id IS NOT NULL) AND v_status = 'paid' THEN
        RAISE EXCEPTION 'Transações vinculadas a cartão de crédito não podem ser marcadas como pagas diretamente.';
    END IF;

    -- Se status for 'paid', valida regras de conta conforme o modo do workspace
    IF v_status = 'paid' THEN
        SELECT tracking_mode INTO v_ws_mode
        FROM public.workspaces
        WHERE id = p_workspace_id;

        IF v_ws_mode = 'full' AND p_account_id IS NULL THEN
            RAISE EXCEPTION 'Conta bancária é obrigatória para registrar transação paga no modo full.';
        END IF;
    END IF;

    INSERT INTO public.transactions (
        workspace_id, description, amount, transaction_date, due_date,
        type, status, category_id, account_id, payment_method_id,
        credit_card_id, credit_card_bill_id, notes, paid_by_member_id,
        split_type, created_by, paid_at
    )
    VALUES (
        p_workspace_id, TRIM(p_description), p_amount, COALESCE(p_transaction_date, CURRENT_DATE),
        COALESCE(p_due_date, p_transaction_date, CURRENT_DATE),
        COALESCE(p_type, 'expense'), v_status,
        p_category_id, p_account_id, p_payment_method_id,
        p_credit_card_id, p_credit_card_bill_id, p_notes,
        p_paid_by_member_id, COALESCE(p_split_type, 'individual'), v_user_id,
        CASE WHEN v_status = 'paid' THEN COALESCE(p_transaction_date, CURRENT_DATE)::TIMESTAMPTZ ELSE NULL END
    )
    RETURNING id INTO v_tx_id;

    -- Se splits foram fornecidos, insere atomicamente
    IF p_splits IS NOT NULL AND jsonb_array_length(p_splits) > 0 THEN
        PERFORM public.fn_set_transaction_splits(p_workspace_id, v_tx_id, p_splits);
    END IF;

    -- Se criada como 'paid', registra o pagamento correspondente e ajusta o saldo da conta
    IF v_status = 'paid' THEN
        v_affects_balance := (p_account_id IS NOT NULL);

        INSERT INTO public.payments (
            workspace_id, transaction_id, account_id, payment_method_id,
            amount, payment_date, notes, created_by, affects_balance
        )
        VALUES (
            p_workspace_id, v_tx_id, p_account_id, p_payment_method_id,
            p_amount, COALESCE(p_transaction_date, CURRENT_DATE), p_notes, v_user_id, v_affects_balance
        )
        RETURNING id INTO v_payment_id;

        IF v_affects_balance THEN
            IF COALESCE(p_type, 'expense') = 'income' THEN
                UPDATE public.accounts
                SET current_balance = current_balance + p_amount
                WHERE id = p_account_id AND workspace_id = p_workspace_id;
            ELSE
                UPDATE public.accounts
                SET current_balance = current_balance - p_amount
                WHERE id = p_account_id AND workspace_id = p_workspace_id;
            END IF;
        END IF;
    END IF;

    RETURN v_tx_id;
END;
$$;

-- Permissões estritas para authenticated
GRANT EXECUTE ON FUNCTION public.fn_delete_payment(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_update_payment(UUID, UUID, UUID, NUMERIC, DATE, UUID, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_update_transfer(UUID, UUID, UUID, UUID, NUMERIC, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_update_transaction_with_splits(UUID, UUID, TEXT, NUMERIC, DATE, TEXT, UUID, UUID, UUID, UUID, UUID, TEXT, UUID, TEXT, DATE, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_update_purchase_with_splits(UUID, UUID, TEXT, NUMERIC, DATE, UUID, UUID, UUID, UUID, UUID, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_transaction_with_splits(UUID, TEXT, NUMERIC, DATE, TEXT, TEXT, UUID, UUID, UUID, UUID, UUID, TEXT, UUID, TEXT, DATE, JSONB) TO authenticated;

-- Revoga explicitamente de public/anon
REVOKE EXECUTE ON FUNCTION public.fn_delete_payment(UUID, UUID) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.fn_update_payment(UUID, UUID, UUID, NUMERIC, DATE, UUID, TEXT, BOOLEAN) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.fn_update_transfer(UUID, UUID, UUID, UUID, NUMERIC, DATE, TEXT) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.fn_update_transaction_with_splits(UUID, UUID, TEXT, NUMERIC, DATE, TEXT, UUID, UUID, UUID, UUID, UUID, TEXT, UUID, TEXT, DATE, JSONB) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.fn_update_purchase_with_splits(UUID, UUID, TEXT, NUMERIC, DATE, UUID, UUID, UUID, UUID, UUID, TEXT, JSONB) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.fn_create_transaction_with_splits(UUID, TEXT, NUMERIC, DATE, TEXT, TEXT, UUID, UUID, UUID, UUID, UUID, TEXT, UUID, TEXT, DATE, JSONB) FROM public, anon;
