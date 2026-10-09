-- ==============================================================================
-- FINCONTROL DATABASE MIGRATION 037 (V38 Revision 2)
-- Correção de Regressões Financeiras, Concorrência e Alinhamento Determinístico
--
-- 1. [P1] fn_create_transaction_with_splits:
--    - Restaura status = 'paid' (em vez de 'completed'), registro em payments,
--      atualização de saldo em accounts e preenchimento de paid_at.
--    - Restaura bloqueio de cartão direto como 'paid' e validação no modo 'full'.
--    - Preserva suporte a valor zero (amount >= 0) e verificação de duplicidade de participantes.
--
-- 2. [P1] fn_update_purchase_with_splits:
--    - Restaura proteção contra alteração de compras totalmente quitadas (v_unpaid_count = 0).
--    - Restaura validação de pagamentos parciais de parcelas (v_inst_amt >= paid_amount).
--    - Restaura reconciliação atômica de status de faturas e parcelas de cartão de crédito.
--    - Preserva suporte a valor zero e verificação de duplicidade de participantes.
--
-- 3. [P1] fn_update_transaction_with_splits:
--    - Restaura recálculo dinâmico de status ('paid', 'partially_paid', 'overdue', 'pending')
--      e atualização de paid_at e due_date.
--    - Restaura ajuste de saldo na alternância de tipo (expense <-> income).
--    - Preserva suporte a valor zero e verificação de duplicidade de participantes.
--
-- 4. [P1] Serialização Estrita de Concorrência:
--    - fn_record_settlement, fn_delete_settlement e mutações financeiras (transações/compras)
--      bloqueiam a linha do workspace (FOR UPDATE) e obtêm advisory lock por workspace.
--    - Previne qualquer race condition em acertos concorrentes ou mutações de dívida.
--
-- 5. [P2] Alinhamento Determinístico de Desempate:
--    - Ordenação de credores e devedores com tie-breaker participant_id::TEXT ASC,
--      idêntico à ordenação TypeScript (b.cents - a.cents || a.id.localeCompare(b.id)).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. FN_CREATE_TRANSACTION_WITH_SPLITS
-- ------------------------------------------------------------------------------
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
    v_tx_id UUID;
    v_status TEXT;
    v_ws_mode TEXT;
    v_affects_balance BOOLEAN;
    v_payment_id UUID;
    v_split RECORD;
    v_total_split NUMERIC(12, 2) := 0;
    v_member_id UUID;
    v_person_id UUID;
    v_seen_members UUID[] := '{}';
    v_seen_people UUID[] := '{}';
    v_split_mode TEXT;
BEGIN
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

    IF TRIM(COALESCE(p_description, '')) = '' THEN
        RAISE EXCEPTION 'A descrição da transação não pode ser vazia.';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'O valor da transação deve ser maior que zero.';
    END IF;

    v_status := COALESCE(p_status, 'pending');

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

    -- Bloqueio: transações de cartão não podem ser criadas com status 'paid' direto (dependem da fatura)
    IF (p_credit_card_id IS NOT NULL OR p_credit_card_bill_id IS NOT NULL) AND v_status = 'paid' THEN
        RAISE EXCEPTION 'Transações vinculadas a cartão de crédito não podem ser marcadas como pagas diretamente.';
    END IF;

    -- Validação de conta no modo 'full' quando status = 'paid'
    IF v_status = 'paid' THEN
        SELECT tracking_mode INTO v_ws_mode
        FROM public.workspaces
        WHERE id = p_workspace_id;

        IF v_ws_mode = 'full' AND p_account_id IS NULL THEN
            RAISE EXCEPTION 'Conta bancária é obrigatória para registrar transação paga no modo full.';
        END IF;
    END IF;

    -- Validação de splits e duplicidade
    IF p_splits IS NOT NULL AND jsonb_array_length(p_splits) > 0 THEN
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

        IF v_total_split <> p_amount THEN
            RAISE EXCEPTION 'A soma das frações do rateio (R$ %) deve ser exatamente igual ao valor total da transação (R$ %).', v_total_split, p_amount;
        END IF;
    END IF;

    v_split_mode := COALESCE(p_split_type, 'individual');

    INSERT INTO public.transactions (
        workspace_id, description, amount, transaction_date, due_date,
        type, status, category_id, account_id, payment_method_id,
        credit_card_id, credit_card_bill_id, notes, paid_by_member_id,
        paid_by_person_id, split_type, created_by, paid_at
    )
    VALUES (
        p_workspace_id, TRIM(p_description), p_amount, COALESCE(p_transaction_date, CURRENT_DATE),
        COALESCE(p_due_date, p_transaction_date, CURRENT_DATE),
        COALESCE(p_type, 'expense'), v_status,
        p_category_id, p_account_id, p_payment_method_id,
        p_credit_card_id, p_credit_card_bill_id, p_notes,
        p_paid_by_member_id, p_paid_by_person_id, v_split_mode, v_user_id,
        CASE WHEN v_status = 'paid' THEN COALESCE(p_transaction_date, CURRENT_DATE)::TIMESTAMPTZ ELSE NULL END
    )
    RETURNING id INTO v_tx_id;

    -- Inserção de splits se informados
    IF p_splits IS NOT NULL AND jsonb_array_length(p_splits) > 0 THEN
        FOR v_split IN SELECT * FROM jsonb_to_recordset(p_splits) AS x(member_id UUID, person_id UUID, amount NUMERIC, percentage NUMERIC) LOOP
            INSERT INTO public.transaction_splits (workspace_id, transaction_id, member_id, person_id, amount, percentage)
            VALUES (p_workspace_id, v_tx_id, v_split.member_id, v_split.person_id, v_split.amount, v_split.percentage);
        END LOOP;
    END IF;

    -- Se criada como 'paid', registra o pagamento correspondente e atualiza o saldo bancário
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

-- ------------------------------------------------------------------------------
-- 2. FN_UPDATE_TRANSACTION_WITH_SPLITS
-- ------------------------------------------------------------------------------
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

            DELETE FROM public.transaction_splits WHERE transaction_id = p_transaction_id;

            FOR v_split IN SELECT * FROM jsonb_to_recordset(p_splits) AS x(member_id UUID, person_id UUID, amount NUMERIC, percentage NUMERIC) LOOP
                INSERT INTO public.transaction_splits (workspace_id, transaction_id, member_id, person_id, amount, percentage)
                VALUES (p_workspace_id, p_transaction_id, v_split.member_id, v_split.person_id, v_split.amount, v_split.percentage);
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
            WHEN v_paid_total >= v_new_amount AND v_paid_total > 0 THEN 'paid'
            WHEN v_paid_total > 0 THEN 'partially_paid'
            WHEN COALESCE(p_due_date, due_date) < CURRENT_DATE THEN 'overdue'
            ELSE 'pending'
        END,
        paid_at = CASE
            WHEN v_paid_total >= v_new_amount AND v_paid_total > 0 THEN COALESCE(paid_at, CURRENT_TIMESTAMP)
            ELSE NULL
        END
    WHERE id = p_transaction_id AND workspace_id = p_workspace_id;

    RETURN p_transaction_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. FN_CREATE_PURCHASE_WITH_SPLITS
-- ------------------------------------------------------------------------------
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
    p_splits JSONB DEFAULT NULL,
    p_paid_by_person_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_purchase_id UUID;
    v_split RECORD;
    v_total_split NUMERIC(12, 2) := 0;
    v_member_id UUID;
    v_person_id UUID;
    v_seen_members UUID[] := '{}';
    v_seen_people UUID[] := '{}';
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: permissão insuficiente no workspace.';
    END IF;

    -- Concorrência: serialização por workspace para mutações financeiras e rateios
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
    PERFORM pg_advisory_xact_lock(hashtext('workspace_debt:' || p_workspace_id::text));

    IF p_splits IS NOT NULL AND jsonb_array_length(p_splits) > 0 THEN
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

        IF v_total_split <> p_total_amount THEN
            RAISE EXCEPTION 'A soma das frações do rateio (R$ %) deve ser exatamente igual ao valor total da compra (R$ %).', v_total_split, p_total_amount;
        END IF;
    END IF;

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
        p_split_type,
        p_paid_by_person_id
    );

    IF p_splits IS NOT NULL AND jsonb_array_length(p_splits) > 0 THEN
        DELETE FROM public.purchase_splits WHERE purchase_id = v_purchase_id;
        FOR v_split IN SELECT * FROM jsonb_to_recordset(p_splits) AS x(member_id UUID, person_id UUID, amount NUMERIC, percentage NUMERIC) LOOP
            INSERT INTO public.purchase_splits (workspace_id, purchase_id, member_id, person_id, amount, percentage)
            VALUES (p_workspace_id, v_purchase_id, v_split.member_id, v_split.person_id, v_split.amount, v_split.percentage);
        END LOOP;
    END IF;

    RETURN v_purchase_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. FN_UPDATE_PURCHASE_WITH_SPLITS (Restauração Completa de Proteções e Parcelas)
-- ------------------------------------------------------------------------------
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

                v_bill_fully_paid := (v_bill.paid_amount = (v_bill.total_amount + v_diff));

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

                IF v_bill_fully_paid THEN
                    UPDATE public.installments
                    SET paid_amount = amount,
                        status = 'paid',
                        paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP)
                    WHERE credit_card_bill_id = v_inst.credit_card_bill_id
                      AND id <> v_inst.id
                      AND status <> 'paid';
                END IF;
            END IF;

            UPDATE public.installments
            SET amount = v_inst_amt,
                status = CASE
                    WHEN v_inst_amt <= COALESCE(paid_amount, 0) AND COALESCE(paid_amount, 0) > 0 THEN 'paid'
                    WHEN COALESCE(paid_amount, 0) > 0 THEN 'partially_paid'
                    ELSE status
                END,
                paid_at = CASE
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

-- ------------------------------------------------------------------------------
-- 5. FN_RECORD_SETTLEMENT (Bloqueio Concorrente + Desempate participant_id::TEXT ASC)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_record_settlement(
    p_workspace_id UUID,
    p_from_member_id UUID DEFAULT NULL,
    p_to_member_id UUID DEFAULT NULL,
    p_amount NUMERIC(12, 2) DEFAULT NULL,
    p_settlement_date DATE DEFAULT CURRENT_DATE,
    p_notes TEXT DEFAULT NULL,
    p_payment_account_id UUID DEFAULT NULL,
    p_from_person_id UUID DEFAULT NULL,
    p_to_person_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_settlement_id UUID;
    v_debtor_id UUID;
    v_creditor_id UUID;
    v_amount_cents BIGINT;
    v_available_debt_cents BIGINT := 0;
    v_cred_ids UUID[];
    v_cred_cents BIGINT[];
    v_deb_ids UUID[];
    v_deb_cents BIGINT[];
    v_c_idx INT;
    v_d_idx INT;
    v_num_cred INT;
    v_num_deb INT;
    v_settle_cents BIGINT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: você não possui permissão de escrita neste workspace.';
    END IF;

    -- Concorrência: serialização por workspace para gravação e cálculo de acertos
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
    PERFORM pg_advisory_xact_lock(hashtext('workspace_debt:' || p_workspace_id::text));

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'O valor do acerto deve ser maior que zero.';
    END IF;

    -- Validação de pagador (devedor)
    IF (p_from_member_id IS NULL AND p_from_person_id IS NULL) OR
       (p_from_member_id IS NOT NULL AND p_from_person_id IS NOT NULL) THEN
        RAISE EXCEPTION 'O pagador do acerto deve ser exatamente um membro ou uma pessoa cadastrada.';
    END IF;

    -- Validação de recebedor (credor)
    IF (p_to_member_id IS NULL AND p_to_person_id IS NULL) OR
       (p_to_member_id IS NOT NULL AND p_to_person_id IS NOT NULL) THEN
        RAISE EXCEPTION 'O recebedor do acerto deve ser exatamente um membro ou uma pessoa cadastrada.';
    END IF;

    v_debtor_id := COALESCE(p_from_member_id, p_from_person_id);
    v_creditor_id := COALESCE(p_to_member_id, p_to_person_id);

    IF v_debtor_id = v_creditor_id THEN
        RAISE EXCEPTION 'O pagador e o recebedor do acerto não podem ser o mesmo participante.';
    END IF;

    IF p_from_member_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.workspace_members
        WHERE id = p_from_member_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Membro pagador (from_member_id) não pertence ao workspace informado.';
    END IF;

    IF p_to_member_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.workspace_members
        WHERE id = p_to_member_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Membro recebedor (to_member_id) não pertence ao workspace informado.';
    END IF;

    IF p_from_person_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.people
        WHERE id = p_from_person_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Pessoa devedora (from_person_id) não pertence ao workspace informado.';
    END IF;

    IF p_to_person_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.people
        WHERE id = p_to_person_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Pessoa credora (to_person_id) não pertence ao workspace informado.';
    END IF;

    IF p_payment_account_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.accounts
            WHERE id = p_payment_account_id AND workspace_id = p_workspace_id
        ) THEN
            RAISE EXCEPTION 'Conta bancária informada não pertence ao workspace.';
        END IF;
    END IF;

    -- --------------------------------------------------------------------------
    -- CÁLCULO DETERMINÍSTICO DE DÍVIDAS PENDENTES (PAID - SHARE + SETTLED)
    -- --------------------------------------------------------------------------
    WITH all_participants AS (
        SELECT id FROM public.workspace_members WHERE workspace_id = p_workspace_id
        UNION
        SELECT id FROM public.people WHERE workspace_id = p_workspace_id
    ),
    participant_balances AS (
        SELECT
            p.id AS participant_id,
            (
                -- Paid in transactions (apenas despesas com rateio existente)
                (SELECT COALESCE(SUM(ROUND(t.amount * 100)), 0)::BIGINT
                 FROM public.transactions t
                 WHERE t.workspace_id = p_workspace_id
                   AND t.status <> 'cancelled'
                   AND t.type = 'expense'
                   AND COALESCE(t.paid_by_person_id, t.paid_by_member_id, (
                       SELECT wm.id FROM public.workspace_members wm WHERE wm.workspace_id = t.workspace_id AND wm.user_id = t.created_by LIMIT 1
                   )) = p.id
                   AND EXISTS (SELECT 1 FROM public.transaction_splits ts WHERE ts.transaction_id = t.id)
                )
                +
                -- Paid in purchases (apenas compras com rateio existente)
                (SELECT COALESCE(SUM(ROUND(pur.total_amount * 100)), 0)::BIGINT
                 FROM public.purchases pur
                 WHERE pur.workspace_id = p_workspace_id
                   AND COALESCE(pur.paid_by_person_id, pur.paid_by_member_id, (
                       SELECT wm.id FROM public.workspace_members wm WHERE wm.workspace_id = pur.workspace_id AND wm.user_id = pur.created_by LIMIT 1
                   )) = p.id
                   AND EXISTS (SELECT 1 FROM public.purchase_splits ps WHERE ps.purchase_id = pur.id)
                )
            ) AS paid_cents,
            (
                -- Share in transactions
                (SELECT COALESCE(SUM(ROUND(ts.amount * 100)), 0)::BIGINT
                 FROM public.transaction_splits ts
                 JOIN public.transactions t ON t.id = ts.transaction_id
                 WHERE t.workspace_id = p_workspace_id
                   AND t.status <> 'cancelled'
                   AND t.type = 'expense'
                   AND (ts.member_id = p.id OR ts.person_id = p.id)
                )
                +
                -- Share in purchases
                (SELECT COALESCE(SUM(ROUND(ps.amount * 100)), 0)::BIGINT
                 FROM public.purchase_splits ps
                 JOIN public.purchases pur ON pur.id = ps.purchase_id
                 WHERE pur.workspace_id = p_workspace_id
                   AND (ps.member_id = p.id OR ps.person_id = p.id)
                )
            ) AS share_cents,
            (
                -- Settled out (pago em acertos)
                SELECT COALESCE(SUM(ROUND(s.amount * 100)), 0)::BIGINT
                FROM public.settlements s
                WHERE s.workspace_id = p_workspace_id
                  AND (s.from_member_id = p.id OR s.from_person_id = p.id)
            ) AS settled_out_cents,
            (
                -- Settled in (recebido em acertos)
                SELECT COALESCE(SUM(ROUND(s.amount * 100)), 0)::BIGINT
                FROM public.settlements s
                WHERE s.workspace_id = p_workspace_id
                  AND (s.to_member_id = p.id OR s.to_person_id = p.id)
            ) AS settled_in_cents
        FROM all_participants p
    )
    SELECT
        COALESCE(array_agg(participant_id ORDER BY net_cents DESC, participant_id::TEXT ASC), '{}'),
        COALESCE(array_agg(net_cents ORDER BY net_cents DESC, participant_id::TEXT ASC), '{}')
    INTO v_cred_ids, v_cred_cents
    FROM (
        SELECT participant_id, (paid_cents - share_cents + settled_out_cents - settled_in_cents) AS net_cents
        FROM participant_balances
        WHERE (paid_cents - share_cents + settled_out_cents - settled_in_cents) > 0
    ) c;

    WITH all_participants AS (
        SELECT id FROM public.workspace_members WHERE workspace_id = p_workspace_id
        UNION
        SELECT id FROM public.people WHERE workspace_id = p_workspace_id
    ),
    participant_balances AS (
        SELECT
            p.id AS participant_id,
            (
                (SELECT COALESCE(SUM(ROUND(t.amount * 100)), 0)::BIGINT
                 FROM public.transactions t
                 WHERE t.workspace_id = p_workspace_id
                   AND t.status <> 'cancelled'
                   AND t.type = 'expense'
                   AND COALESCE(t.paid_by_person_id, t.paid_by_member_id, (
                       SELECT wm.id FROM public.workspace_members wm WHERE wm.workspace_id = t.workspace_id AND wm.user_id = t.created_by LIMIT 1
                   )) = p.id
                   AND EXISTS (SELECT 1 FROM public.transaction_splits ts WHERE ts.transaction_id = t.id)
                )
                +
                (SELECT COALESCE(SUM(ROUND(pur.total_amount * 100)), 0)::BIGINT
                 FROM public.purchases pur
                 WHERE pur.workspace_id = p_workspace_id
                   AND COALESCE(pur.paid_by_person_id, pur.paid_by_member_id, (
                       SELECT wm.id FROM public.workspace_members wm WHERE wm.workspace_id = pur.workspace_id AND wm.user_id = pur.created_by LIMIT 1
                   )) = p.id
                   AND EXISTS (SELECT 1 FROM public.purchase_splits ps WHERE ps.purchase_id = pur.id)
                )
            ) AS paid_cents,
            (
                (SELECT COALESCE(SUM(ROUND(ts.amount * 100)), 0)::BIGINT
                 FROM public.transaction_splits ts
                 JOIN public.transactions t ON t.id = ts.transaction_id
                 WHERE t.workspace_id = p_workspace_id
                   AND t.status <> 'cancelled'
                   AND t.type = 'expense'
                   AND (ts.member_id = p.id OR ts.person_id = p.id)
                )
                +
                (SELECT COALESCE(SUM(ROUND(ps.amount * 100)), 0)::BIGINT
                 FROM public.purchase_splits ps
                 JOIN public.purchases pur ON pur.id = ps.purchase_id
                 WHERE pur.workspace_id = p_workspace_id
                   AND (ps.member_id = p.id OR ps.person_id = p.id)
                )
            ) AS share_cents,
            (
                SELECT COALESCE(SUM(ROUND(s.amount * 100)), 0)::BIGINT
                FROM public.settlements s
                WHERE s.workspace_id = p_workspace_id
                  AND (s.from_member_id = p.id OR s.from_person_id = p.id)
            ) AS settled_out_cents,
            (
                SELECT COALESCE(SUM(ROUND(s.amount * 100)), 0)::BIGINT
                FROM public.settlements s
                WHERE s.workspace_id = p_workspace_id
                  AND (s.to_member_id = p.id OR s.to_person_id = p.id)
            ) AS settled_in_cents
        FROM all_participants p
    )
    SELECT
        COALESCE(array_agg(participant_id ORDER BY abs_net DESC, participant_id::TEXT ASC), '{}'),
        COALESCE(array_agg(abs_net ORDER BY abs_net DESC, participant_id::TEXT ASC), '{}')
    INTO v_deb_ids, v_deb_cents
    FROM (
        SELECT participant_id, ABS(paid_cents - share_cents + settled_out_cents - settled_in_cents) AS abs_net
        FROM participant_balances
        WHERE (paid_cents - share_cents + settled_out_cents - settled_in_cents) < 0
    ) d;

    -- Reconciliação gulosa de dívidas recíprocas (alinhada 100% com TypeScript)
    v_c_idx := 1;
    v_d_idx := 1;
    v_num_cred := COALESCE(array_length(v_cred_ids, 1), 0);
    v_num_deb := COALESCE(array_length(v_deb_ids, 1), 0);
    v_available_debt_cents := 0;

    WHILE v_c_idx <= v_num_cred AND v_d_idx <= v_num_deb LOOP
        v_settle_cents := LEAST(v_cred_cents[v_c_idx], v_deb_cents[v_d_idx]);

        IF v_deb_ids[v_d_idx] = v_debtor_id AND v_cred_ids[v_c_idx] = v_creditor_id THEN
            v_available_debt_cents := v_available_debt_cents + v_settle_cents;
        END IF;

        v_cred_cents[v_c_idx] := v_cred_cents[v_c_idx] - v_settle_cents;
        v_deb_cents[v_d_idx] := v_deb_cents[v_d_idx] - v_settle_cents;

        IF v_cred_cents[v_c_idx] = 0 THEN
            v_c_idx := v_c_idx + 1;
        END IF;
        IF v_deb_cents[v_d_idx] = 0 THEN
            v_d_idx := v_d_idx + 1;
        END IF;
    END LOOP;

    IF v_available_debt_cents <= 0 THEN
        RAISE EXCEPTION 'Não há débito pendente registrado entre o pagador e o recebedor informados.';
    END IF;

    v_amount_cents := ROUND(p_amount * 100)::BIGINT;
    IF v_amount_cents > v_available_debt_cents THEN
        RAISE EXCEPTION 'O valor do acerto (R$ %) excede a dívida pendente de R$ %.',
            to_char(p_amount, 'FM999999990.00'),
            to_char(v_available_debt_cents / 100.0, 'FM999999990.00');
    END IF;

    INSERT INTO public.settlements (
        workspace_id,
        from_member_id,
        to_member_id,
        from_person_id,
        to_person_id,
        amount,
        settlement_date,
        notes,
        payment_account_id,
        created_by
    )
    VALUES (
        p_workspace_id,
        p_from_member_id,
        p_to_member_id,
        p_from_person_id,
        p_to_person_id,
        p_amount,
        COALESCE(p_settlement_date, CURRENT_DATE),
        p_notes,
        p_payment_account_id,
        v_user_id
    )
    RETURNING id INTO v_settlement_id;

    RETURN v_settlement_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. FN_DELETE_SETTLEMENT (Bloqueio Concorrente + Verificação de Permissão)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_delete_settlement(
    p_settlement_id UUID,
    p_workspace_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_target_ws UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    SELECT workspace_id INTO v_target_ws
    FROM public.settlements
    WHERE id = p_settlement_id;

    IF v_target_ws IS NULL THEN
        RETURN FALSE;
    END IF;

    IF p_workspace_id IS NOT NULL AND v_target_ws <> p_workspace_id THEN
        RAISE EXCEPTION 'O acerto não pertence ao workspace informado.';
    END IF;

    IF NOT public.has_workspace_role(v_target_ws, ARRAY['owner', 'admin']) THEN
        RAISE EXCEPTION 'Acesso negado: apenas proprietários e administradores podem excluir acertos.';
    END IF;

    -- Concorrência: serialização por workspace
    PERFORM 1 FROM public.workspaces WHERE id = v_target_ws FOR UPDATE;
    PERFORM pg_advisory_xact_lock(hashtext('workspace_debt:' || v_target_ws::text));

    DELETE FROM public.settlements
    WHERE id = p_settlement_id;

    RETURN TRUE;
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. PERMISSÕES E SEGURANÇA (LEAST PRIVILEGE)
-- ------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.fn_create_transaction_with_splits(UUID, TEXT, NUMERIC, DATE, TEXT, TEXT, UUID, UUID, UUID, UUID, UUID, TEXT, UUID, TEXT, DATE, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_create_transaction_with_splits(UUID, TEXT, NUMERIC, DATE, TEXT, TEXT, UUID, UUID, UUID, UUID, UUID, TEXT, UUID, TEXT, DATE, JSONB, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.fn_update_transaction_with_splits(UUID, UUID, TEXT, NUMERIC, DATE, TEXT, UUID, UUID, UUID, UUID, UUID, TEXT, UUID, TEXT, DATE, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_update_transaction_with_splits(UUID, UUID, TEXT, NUMERIC, DATE, TEXT, UUID, UUID, UUID, UUID, UUID, TEXT, UUID, TEXT, DATE, JSONB, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.fn_create_purchase_with_splits(UUID, TEXT, NUMERIC, INT, DATE, UUID, UUID, UUID, UUID, INT, UUID, TEXT, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_create_purchase_with_splits(UUID, TEXT, NUMERIC, INT, DATE, UUID, UUID, UUID, UUID, INT, UUID, TEXT, JSONB, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.fn_update_purchase_with_splits(UUID, UUID, TEXT, NUMERIC, DATE, UUID, UUID, UUID, UUID, UUID, TEXT, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_update_purchase_with_splits(UUID, UUID, TEXT, NUMERIC, DATE, UUID, UUID, UUID, UUID, UUID, TEXT, JSONB, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.fn_record_settlement(UUID, UUID, UUID, NUMERIC, DATE, TEXT, UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_record_settlement(UUID, UUID, UUID, NUMERIC, DATE, TEXT, UUID, UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.fn_delete_settlement(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_delete_settlement(UUID, UUID) TO authenticated;

-- Garantir que settlements continua com DML direta revogada
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.settlements FROM authenticated, anon, PUBLIC;
GRANT SELECT ON public.settlements TO authenticated;
