-- ==============================================================================
-- MIGRATION 014: HARDENING FINAL DE RATEIOS, RECONCILIAÇÃO DE COMPRAS E ESTORNO DE FATURAS
-- ==============================================================================
-- 1. Elimina totalmente o bypass por flag de sessão (fincontrol.skip_split_check)
--    tornando os triggers de conservação de rateio 100% incondicionais e estritos.
-- 2. fn_update_transaction_with_splits e fn_update_purchase_with_splits atualizam
--    os rateios PRIMEIRO para satisfazer o trigger incondicional sem flags de bypass.
-- 3. fn_update_purchase_with_splits recalcula valores de parcelas pendentes e ajusta
--    o total_amount das faturas de cartão vinculadas ao alterar total_amount da compra.
-- 4. fn_delete_payment e fn_update_payment reabrem transações e parcelas vinculadas
--    a faturas de cartão quando o pagamento é estornado ou reduzido.
-- ==============================================================================

-- 1. TRIGGERS PARENT-SIDE INCONDICIONAIS (SEM BYPASS DE SESSÃO)
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

-- 2. ATUALIZAÇÃO ATÔMICA DE TRANSAÇÃO COM RATEIOS (fn_update_transaction_with_splits)
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
    v_new_type TEXT;
    v_pay RECORD;
    v_paid_total NUMERIC(12, 2) := 0;
    v_split RECORD;
    v_total_split NUMERIC(12, 2) := 0;
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

    v_new_type := COALESCE(p_type, v_old_tx.type);

    -- Se o tipo mudou (expense <-> income), inverte o efeito dos pagamentos existentes nas contas bancárias
    IF v_new_type <> v_old_tx.type THEN
        FOR v_pay IN
            SELECT account_id, amount
            FROM public.payments
            WHERE transaction_id = p_transaction_id AND affects_balance = TRUE AND account_id IS NOT NULL
        LOOP
            IF v_new_type = 'income' AND v_old_tx.type = 'expense' THEN
                -- Despesa virou receita: reverte débito (+amount) e aplica crédito (+amount) => + 2 * amount
                UPDATE public.accounts
                SET current_balance = current_balance + (2 * v_pay.amount)
                WHERE id = v_pay.account_id AND workspace_id = p_workspace_id;
            ELSIF v_new_type = 'expense' AND v_old_tx.type = 'income' THEN
                -- Receita virou despesa: reverte crédito (-amount) e aplica débito (-amount) => - 2 * amount
                UPDATE public.accounts
                SET current_balance = current_balance - (2 * v_pay.amount)
                WHERE id = v_pay.account_id AND workspace_id = p_workspace_id;
            END IF;
        END LOOP;
    END IF;

    -- 1. Se splits foram fornecidos, sincroniza os rateios PRIMEIRO para satisfazer o trigger incondicional
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
                RAISE EXCEPTION 'A soma das frações do rateio (R$ %) deve ser exatamente igual ao valor total da transação (R$ %).', v_total_split, v_new_amount;
            END IF;

            DELETE FROM public.transaction_splits WHERE transaction_id = p_transaction_id;

            FOR v_split IN SELECT * FROM jsonb_to_recordset(p_splits) AS x(member_id UUID, amount NUMERIC, percentage NUMERIC) LOOP
                INSERT INTO public.transaction_splits (workspace_id, transaction_id, member_id, amount, percentage)
                VALUES (p_workspace_id, p_transaction_id, v_split.member_id, v_split.amount, v_split.percentage);
            END LOOP;
        ELSE
            DELETE FROM public.transaction_splits WHERE transaction_id = p_transaction_id;
        END IF;
    END IF;

    -- 2. Atualiza a transação (o trigger verificará se o novo amount bate com os splits que já estão no banco)
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
        split_type = COALESCE(p_split_type, split_type),
        status = CASE
            WHEN v_paid_total >= v_new_amount AND v_paid_total > 0 THEN 'paid'
            WHEN v_paid_total > 0 THEN 'partially_paid'
            WHEN COALESCE(p_due_date, due_date) < CURRENT_DATE THEN 'overdue'
            ELSE 'pending'
        END
    WHERE id = p_transaction_id AND workspace_id = p_workspace_id;

    RETURN p_transaction_id;
END;
$$;

-- 3. ATUALIZAÇÃO ATÔMICA DE COMPRA COM RECONCILIAÇÃO DE PARCELAS E RATEIOS (fn_update_purchase_with_splits)
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

            -- Ajusta a fatura de cartão correspondente se houver diferença
            IF v_diff <> 0 AND v_inst.credit_card_bill_id IS NOT NULL THEN
                UPDATE public.credit_card_bills
                SET total_amount = total_amount + v_diff,
                    status = CASE 
                        WHEN paid_amount >= total_amount + v_diff AND total_amount + v_diff > 0 THEN 'paid' 
                        WHEN paid_amount > 0 THEN 'partially_paid' 
                        ELSE 'open' 
                    END
                WHERE id = v_inst.credit_card_bill_id;
            END IF;

            -- Atualiza o valor e status da parcela
            UPDATE public.installments
            SET amount = v_inst_amt,
                status = CASE
                    WHEN paid_amount >= v_inst_amt AND v_inst_amt > 0 THEN 'paid'
                    WHEN paid_amount > 0 THEN 'partially_paid'
                    WHEN due_date < CURRENT_DATE THEN 'overdue'
                    ELSE 'pending'
                END,
                paid_at = CASE
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

-- 4. EXCLUSÃO E REVERSÃO ATÔMICA DE PAGAMENTOS COM REABERTURA DE FATURA (fn_delete_payment)
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
    v_is_income BOOLEAN := FALSE;
    v_remaining_paid NUMERIC(12, 2);
    v_target_total NUMERIC(12, 2);
    v_inst RECORD;
    v_bill RECORD;
    v_new_status TEXT;
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

    -- Identifica se é receita vinculada
    IF v_payment.transaction_id IS NOT NULL THEN
        SELECT * INTO v_tx
        FROM public.transactions
        WHERE id = v_payment.transaction_id AND workspace_id = p_workspace_id
        FOR UPDATE;
        IF v_tx.id IS NOT NULL AND v_tx.type = 'income' THEN
            v_is_income := TRUE;
        END IF;
    END IF;

    -- 1. Reconciliação do Saldo Bancário
    IF v_payment.affects_balance AND v_payment.account_id IS NOT NULL THEN
        IF v_is_income THEN
            -- Exclusão de pagamento de receita: subtrai da conta
            UPDATE public.accounts
            SET current_balance = current_balance - v_payment.amount
            WHERE id = v_payment.account_id AND workspace_id = p_workspace_id;
        ELSE
            -- Exclusão de pagamento de despesa/fatura/parcela: estorna somando à conta
            UPDATE public.accounts
            SET current_balance = current_balance + v_payment.amount
            WHERE id = v_payment.account_id AND workspace_id = p_workspace_id;
        END IF;
    END IF;

    -- 2. Reconciliação de Transação vinculada
    IF v_payment.transaction_id IS NOT NULL THEN
        IF v_tx.id IS NOT NULL THEN
            SELECT COALESCE(SUM(amount), 0) INTO v_remaining_paid
            FROM public.payments
            WHERE transaction_id = v_payment.transaction_id AND id <> p_payment_id;

            v_target_total := v_tx.amount;

            UPDATE public.transactions
            SET status = CASE
                    WHEN v_remaining_paid >= v_target_total THEN 'paid'
                    WHEN v_remaining_paid > 0 THEN 'partially_paid'
                    WHEN v_tx.due_date < CURRENT_DATE THEN 'overdue'
                    ELSE 'pending'
                END,
                paid_at = CASE
                    WHEN v_remaining_paid >= v_target_total THEN paid_at
                    ELSE NULL
                END
            WHERE id = v_payment.transaction_id AND workspace_id = p_workspace_id;
        END IF;
    END IF;

    -- 3. Reconciliação de Parcela vinculada
    IF v_payment.installment_id IS NOT NULL THEN
        SELECT * INTO v_inst
        FROM public.installments
        WHERE id = v_payment.installment_id
        FOR UPDATE;

        IF v_inst.id IS NOT NULL THEN
            SELECT COALESCE(SUM(amount), 0) INTO v_remaining_paid
            FROM public.payments
            WHERE installment_id = v_payment.installment_id AND id <> p_payment_id;

            v_target_total := v_inst.amount;

            UPDATE public.installments
            SET paid_amount = v_remaining_paid,
                status = CASE
                    WHEN v_remaining_paid >= v_target_total THEN 'paid'
                    WHEN v_remaining_paid > 0 THEN 'partially_paid'
                    WHEN v_inst.due_date < CURRENT_DATE THEN 'overdue'
                    ELSE 'pending'
                END,
                paid_at = CASE
                    WHEN v_remaining_paid >= v_target_total THEN paid_at
                    ELSE NULL
                END
            WHERE id = v_payment.installment_id;
        END IF;
    END IF;

    -- 4. Reconciliação de Fatura de Cartão vinculada E REABERTURA DE ITENS
    IF v_payment.credit_card_bill_id IS NOT NULL THEN
        SELECT * INTO v_bill
        FROM public.credit_card_bills
        WHERE id = v_payment.credit_card_bill_id AND workspace_id = p_workspace_id
        FOR UPDATE;

        IF v_bill.id IS NOT NULL THEN
            SELECT COALESCE(SUM(amount), 0) INTO v_remaining_paid
            FROM public.payments
            WHERE credit_card_bill_id = v_payment.credit_card_bill_id AND id <> p_payment_id;

            v_target_total := v_bill.total_amount;
            v_new_status := CASE
                WHEN v_remaining_paid >= v_target_total AND v_target_total > 0 THEN 'paid'
                WHEN v_remaining_paid > 0 THEN 'partially_paid'
                ELSE 'open'
            END;

            UPDATE public.credit_card_bills
            SET paid_amount = v_remaining_paid,
                status = v_new_status,
                paid_at = CASE
                    WHEN v_new_status = 'paid' THEN paid_at
                    ELSE NULL
                END
            WHERE id = v_payment.credit_card_bill_id AND workspace_id = p_workspace_id;

            -- Se a fatura deixou de estar 'paid', reabre as transações e parcelas vinculadas a ela
            IF v_new_status <> 'paid' THEN
                UPDATE public.transactions
                SET status = CASE WHEN due_date < CURRENT_DATE THEN 'overdue' ELSE 'pending' END,
                    paid_at = NULL
                WHERE credit_card_bill_id = v_bill.id;

                UPDATE public.installments
                SET status = CASE WHEN due_date < CURRENT_DATE THEN 'overdue' ELSE 'pending' END,
                    paid_amount = 0,
                    paid_at = NULL
                WHERE credit_card_bill_id = v_bill.id;
            END IF;
        END IF;
    END IF;

    -- 5. Remove o registro de pagamento
    DELETE FROM public.payments
    WHERE id = p_payment_id AND workspace_id = p_workspace_id;

    RETURN TRUE;
END;
$$;

-- 5. ATUALIZAÇÃO ATÔMICA DE PAGAMENTOS COM REABERTURA/QUITAÇÃO DE ITENS (fn_update_payment)
DROP FUNCTION IF EXISTS public.fn_update_payment(UUID, UUID, NUMERIC, UUID, DATE, UUID, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.fn_update_payment(UUID, UUID, UUID, NUMERIC, DATE, UUID, TEXT, BOOLEAN);

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
    v_is_income BOOLEAN := FALSE;
    v_tx RECORD;
    v_bill RECORD;
    v_inst RECORD;
    v_target_total NUMERIC(12, 2);
    v_other_paid NUMERIC(12, 2) := 0;
    v_total_paid NUMERIC(12, 2) := 0;
    v_new_status TEXT;
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
    IF v_old_payment.transaction_id IS NOT NULL THEN
        IF v_tx.id IS NOT NULL THEN
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
                    WHEN v_inst.due_date < CURRENT_DATE THEN 'overdue'
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
            v_new_status := CASE
                WHEN v_total_paid >= v_target_total AND v_target_total > 0 THEN 'paid'
                WHEN v_total_paid > 0 THEN 'partially_paid'
                ELSE 'open'
            END;

            UPDATE public.credit_card_bills
            SET paid_amount = v_total_paid,
                status = v_new_status,
                paid_at = CASE
                    WHEN v_new_status = 'paid' THEN v_new_payment_date::TIMESTAMPTZ
                    ELSE NULL
                END
            WHERE id = v_old_payment.credit_card_bill_id;

            -- Reabre ou quita itens da fatura
            IF v_new_status = 'paid' THEN
                UPDATE public.transactions
                SET status = 'paid',
                    paid_at = v_new_payment_date::TIMESTAMPTZ
                WHERE credit_card_bill_id = v_bill.id;

                UPDATE public.installments
                SET status = 'paid',
                    paid_amount = amount,
                    paid_at = v_new_payment_date::TIMESTAMPTZ
                WHERE credit_card_bill_id = v_bill.id;
            ELSE
                UPDATE public.transactions
                SET status = CASE WHEN due_date < CURRENT_DATE THEN 'overdue' ELSE 'pending' END,
                    paid_at = NULL
                WHERE credit_card_bill_id = v_bill.id;

                UPDATE public.installments
                SET status = CASE WHEN due_date < CURRENT_DATE THEN 'overdue' ELSE 'pending' END,
                    paid_amount = 0,
                    paid_at = NULL
                WHERE credit_card_bill_id = v_bill.id;
            END IF;
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

GRANT EXECUTE ON FUNCTION public.fn_update_payment(UUID, UUID, UUID, NUMERIC, DATE, UUID, TEXT, BOOLEAN) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_update_payment(UUID, UUID, UUID, NUMERIC, DATE, UUID, TEXT, BOOLEAN) FROM public, anon;
