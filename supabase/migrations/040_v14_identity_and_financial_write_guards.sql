-- A1-01/A1-03/A1-04: identidade canônica e validação de novas escritas.
-- Histórico não é reescrito; UPDATE com associações inalteradas permanece válido.

REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (name, avatar_url) ON public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_guard_profile_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id OR
       (NEW.email IS DISTINCT FROM OLD.email AND NEW.email IS DISTINCT FROM
        (SELECT email FROM auth.users WHERE id = OLD.id)) THEN
        RAISE EXCEPTION 'Identidade do perfil deve corresponder ao usuário Auth.';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_guard_profile_identity BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_profile_identity();

UPDATE public.profiles p SET email = u.email
FROM auth.users u WHERE p.id = u.id AND p.email IS DISTINCT FROM u.email;

CREATE OR REPLACE FUNCTION public.fn_sync_auth_profile_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
    UPDATE public.profiles SET email = NEW.email WHERE id = NEW.id;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_sync_auth_profile_email AFTER UPDATE OF email ON auth.users
FOR EACH ROW WHEN (OLD.email IS DISTINCT FROM NEW.email)
EXECUTE FUNCTION public.fn_sync_auth_profile_email();

CREATE OR REPLACE FUNCTION public.fn_add_workspace_member(
    p_workspace_id uuid, p_email_or_user_id text, p_role text DEFAULT 'member'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
    v_user_id uuid;
    v_member_id uuid;
    v_role text;
    v_count integer;
BEGIN
    v_role := LOWER(TRIM(COALESCE(p_role, 'member')));
    IF v_role NOT IN ('admin', 'member', 'viewer') THEN
        RAISE EXCEPTION 'Papel de membro inválido: %. Valores permitidos: admin, member, viewer.', p_role;
    END IF;
    IF auth.uid() IS NULL OR NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin']) THEN
        RAISE EXCEPTION 'Apenas proprietários ou administradores podem adicionar membros ao workspace.';
    END IF;
    IF p_email_or_user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        SELECT id INTO v_user_id FROM auth.users
        WHERE id = p_email_or_user_id::uuid AND email_confirmed_at IS NOT NULL
          AND deleted_at IS NULL;
        IF v_user_id IS NULL THEN
            RAISE EXCEPTION 'Perfil de usuário não encontrado para o ID informado: %', p_email_or_user_id;
        END IF;
    ELSE
        SELECT count(*), min(id::text)::uuid INTO v_count, v_user_id
        FROM auth.users
        WHERE LOWER(TRIM(email)) = LOWER(TRIM(p_email_or_user_id))
          AND email_confirmed_at IS NOT NULL AND deleted_at IS NULL;
        IF v_count <> 1 THEN
            RAISE EXCEPTION 'Nenhum usuário cadastrado foi encontrado com o e-mail: %', p_email_or_user_id;
        END IF;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id) THEN
        RAISE EXCEPTION 'Perfil de usuário não encontrado para o ID informado: %', p_email_or_user_id;
    END IF;
    IF EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = p_workspace_id AND user_id = v_user_id) THEN
        RAISE EXCEPTION 'O usuário informado já é membro deste workspace.';
    END IF;
    INSERT INTO public.workspace_members(workspace_id, user_id, role)
    VALUES (p_workspace_id, v_user_id, v_role) RETURNING id INTO v_member_id;
    RETURN v_member_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_guard_new_financial_references()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
    v_new jsonb := to_jsonb(NEW);
    v_old jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
    v_refs text[][];
    v_ref text[];
    v_id uuid;
    v_workspace uuid := (v_new->>'workspace_id')::uuid;
    v_valid boolean;
    v_mode text;
BEGIN
    IF TG_TABLE_NAME = 'payments' THEN
        IF TG_OP = 'INSERT' THEN
            SELECT tracking_mode INTO v_mode FROM public.workspaces WHERE id = v_workspace FOR SHARE;
            IF NEW.affects_balance IS DISTINCT FROM (v_mode = 'full') OR
               (v_mode = 'full' AND NEW.account_id IS NULL) THEN
                RAISE EXCEPTION 'Efeito do pagamento incompatível com o modo do workspace.';
            END IF;
        ELSIF NEW.affects_balance IS DISTINCT FROM OLD.affects_balance THEN
            RAISE EXCEPTION 'O efeito histórico do pagamento sobre saldo não pode ser alterado.';
        END IF;
    END IF;
    IF TG_TABLE_NAME = 'transfers' AND TG_OP = 'INSERT' AND EXISTS (
        SELECT 1 FROM public.workspaces WHERE id = v_workspace AND tracking_mode = 'expense_tracker'
    ) THEN
        RAISE EXCEPTION 'Transferências não estão disponíveis no modo de despesas.';
    END IF;
    v_refs := CASE TG_TABLE_NAME
        WHEN 'transactions' THEN ARRAY[['account_id','accounts'],['category_id','categories'],['payment_method_id','payment_methods'],['credit_card_id','credit_cards'],['credit_card_bill_id','credit_card_bills'],['paid_by_person_id','people']]
        WHEN 'purchases' THEN ARRAY[['account_id','accounts'],['category_id','categories'],['payment_method_id','payment_methods'],['credit_card_id','credit_cards'],['paid_by_person_id','people']]
        WHEN 'payments' THEN ARRAY[['account_id','accounts'],['payment_method_id','payment_methods']]
        WHEN 'transfers' THEN ARRAY[['from_account_id','accounts'],['to_account_id','accounts']]
        WHEN 'settlements' THEN ARRAY[['payment_account_id','accounts'],['from_person_id','people'],['to_person_id','people']]
        WHEN 'transaction_splits' THEN ARRAY[['person_id','people']]
        WHEN 'purchase_splits' THEN ARRAY[['person_id','people']]
        WHEN 'credit_cards' THEN ARRAY[['linked_payment_account_id','accounts']]
        WHEN 'payment_methods' THEN ARRAY[['linked_account_id','accounts'],['credit_card_id','credit_cards']]
        WHEN 'categories' THEN ARRAY[['parent_id','categories']]
        WHEN 'budgets' THEN ARRAY[['category_id','categories']]
        WHEN 'recurring_transactions' THEN ARRAY[['account_id','accounts'],['category_id','categories'],['payment_method_id','payment_methods'],['credit_card_id','credit_cards']]
    END;
    FOREACH v_ref SLICE 1 IN ARRAY v_refs LOOP
        v_id := NULLIF(v_new->>v_ref[1], '')::uuid;
        IF v_id IS NULL OR (TG_OP = 'UPDATE' AND v_new->v_ref[1] IS NOT DISTINCT FROM v_old->v_ref[1]) THEN
            CONTINUE;
        END IF;
        IF v_ref[2] = 'people' THEN
            SELECT EXISTS (SELECT 1 FROM public.people WHERE id = v_id AND workspace_id = v_workspace AND NOT archived) INTO v_valid;
        ELSIF v_ref[2] = 'credit_card_bills' THEN
            SELECT EXISTS (SELECT 1 FROM public.credit_card_bills b JOIN public.credit_cards c ON c.id = b.credit_card_id
                WHERE b.id = v_id AND b.workspace_id = v_workspace AND c.workspace_id = v_workspace AND c.active) INTO v_valid;
        ELSE
            -- Tabela vem exclusivamente da whitelist estática acima; valores são parâmetros.
            EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE id = $1 AND workspace_id = $2 AND active)', v_ref[2])
            INTO v_valid USING v_id, v_workspace;
        END IF;
        IF NOT v_valid THEN
            RAISE EXCEPTION 'Nova referência % exige entidade ativa do mesmo workspace.', v_ref[1];
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$;

DO $$
DECLARE v_table text;
BEGIN
    FOREACH v_table IN ARRAY ARRAY['transactions','purchases','payments','transfers','settlements',
        'transaction_splits','purchase_splits','credit_cards','payment_methods','categories','budgets','recurring_transactions'] LOOP
        EXECUTE format('CREATE TRIGGER trg_guard_new_financial_references BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_guard_new_financial_references()', v_table);
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_guard_profile_identity(), public.fn_sync_auth_profile_email(),
    public.fn_guard_new_financial_references() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guard_profile_identity(), public.fn_sync_auth_profile_email(),
    public.fn_guard_new_financial_references() TO service_role;

-- As definições completas abaixo preservam locks, reconciliação e assinaturas existentes.

CREATE OR REPLACE FUNCTION public.fn_record_payment(p_workspace_id uuid, p_account_id uuid, p_amount numeric, p_payment_date date DEFAULT CURRENT_DATE, p_transaction_id uuid DEFAULT NULL::uuid, p_installment_id uuid DEFAULT NULL::uuid, p_credit_card_bill_id uuid DEFAULT NULL::uuid, p_payment_method_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_affects_balance boolean DEFAULT true)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_user_id UUID;
    v_payment_id UUID;
    v_target_total NUMERIC(12, 2);
    v_already_paid NUMERIC(12, 2);
    v_remaining NUMERIC(12, 2);
    v_new_paid NUMERIC(12, 2);
    v_target_type TEXT;
    v_bill_id UUID;
    v_card_id UUID;
    v_affects_balance BOOLEAN;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: permissão insuficiente no workspace.';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'O valor do pagamento deve ser estritamente maior que zero.';
    END IF;

    SELECT tracking_mode = 'full' INTO v_affects_balance FROM public.workspaces WHERE id = p_workspace_id FOR SHARE;
    IF p_affects_balance IS DISTINCT FROM v_affects_balance THEN
        RAISE EXCEPTION 'Efeito do pagamento incompatível com o modo do workspace.';
    END IF;

    -- Se afeta saldo, conta bancária é obrigatória
    IF v_affects_balance AND p_account_id IS NULL THEN
        RAISE EXCEPTION 'Conta bancária de saída é obrigatória quando o pagamento afeta saldo.';
    END IF;

    IF (p_transaction_id IS NOT NULL)::INT + (p_installment_id IS NOT NULL)::INT + (p_credit_card_bill_id IS NOT NULL)::INT <> 1 THEN
        RAISE EXCEPTION 'Informe exatamente uma obrigação de destino para o pagamento.';
    END IF;

    IF p_payment_method_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.payment_methods WHERE id = p_payment_method_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Método de pagamento não pertence ao workspace informado.';
    END IF;

    -- Bloqueio e validação da conta apenas se afeta saldo ou se foi informada
    IF p_account_id IS NOT NULL THEN
        IF v_affects_balance THEN
            PERFORM 1 FROM public.accounts WHERE id = p_account_id AND workspace_id = p_workspace_id FOR UPDATE;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Conta de saída não encontrada no workspace especificado.';
            END IF;
        ELSE
            IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_account_id AND workspace_id = p_workspace_id) THEN
                RAISE EXCEPTION 'Conta bancária informada não pertence ao workspace.';
            END IF;
        END IF;
    END IF;

    -- 1. TRANSAÇÃO AVULSA
    IF p_transaction_id IS NOT NULL THEN
        SELECT amount, type, credit_card_bill_id, credit_card_id INTO v_target_total, v_target_type, v_bill_id, v_card_id
        FROM public.transactions
        WHERE id = p_transaction_id AND workspace_id = p_workspace_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Transação não encontrada no workspace.';
        END IF;

        IF v_bill_id IS NOT NULL OR v_card_id IS NOT NULL THEN
            RAISE EXCEPTION 'Itens vinculados a cartão de crédito devem ser quitados exclusivamente através da fatura correspondente.';
        END IF;

        SELECT COALESCE(SUM(amount), 0) INTO v_already_paid
        FROM public.payments WHERE transaction_id = p_transaction_id;

        v_remaining := v_target_total - v_already_paid;
        IF p_amount > v_remaining THEN
            RAISE EXCEPTION 'Valor do pagamento (R$ %) excede o saldo restante da transação (R$ %).', p_amount, v_remaining;
        END IF;

        v_new_paid := v_already_paid + p_amount;

        INSERT INTO public.payments (
            workspace_id, transaction_id, account_id, payment_method_id,
            amount, payment_date, notes, created_by, affects_balance
        ) VALUES (
            p_workspace_id, p_transaction_id, p_account_id, p_payment_method_id,
            p_amount, COALESCE(p_payment_date, CURRENT_DATE), p_notes, v_user_id, v_affects_balance
        ) RETURNING id INTO v_payment_id;

        UPDATE public.transactions
        SET status = CASE WHEN v_new_paid >= v_target_total THEN 'paid' ELSE 'partially_paid' END,
            paid_at = CASE WHEN v_new_paid >= v_target_total THEN COALESCE(p_payment_date, CURRENT_DATE)::TIMESTAMPTZ ELSE NULL END
        WHERE id = p_transaction_id;

        IF v_affects_balance AND p_account_id IS NOT NULL THEN
            IF v_target_type = 'expense' THEN
                UPDATE public.accounts SET current_balance = current_balance - p_amount WHERE id = p_account_id;
            ELSE
                UPDATE public.accounts SET current_balance = current_balance + p_amount WHERE id = p_account_id;
            END IF;
        END IF;

        RETURN v_payment_id;
    END IF;

    -- 2. PARCELA INDIVIDUAL
    IF p_installment_id IS NOT NULL THEN
        SELECT i.amount, i.paid_amount, i.credit_card_bill_id, p.credit_card_id
        INTO v_target_total, v_already_paid, v_bill_id, v_card_id
        FROM public.installments i
        JOIN public.purchases p ON p.id = i.purchase_id
        WHERE i.id = p_installment_id AND p.workspace_id = p_workspace_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Parcela não encontrada no workspace.';
        END IF;

        IF v_bill_id IS NOT NULL OR v_card_id IS NOT NULL THEN
            RAISE EXCEPTION 'Parcelas vinculadas a cartão de crédito devem ser quitadas exclusivamente através da fatura correspondente.';
        END IF;

        v_remaining := v_target_total - v_already_paid;
        IF p_amount > v_remaining THEN
            RAISE EXCEPTION 'Valor do pagamento (R$ %) excede o saldo restante da parcela (R$ %).', p_amount, v_remaining;
        END IF;

        v_new_paid := v_already_paid + p_amount;

        INSERT INTO public.payments (
            workspace_id, installment_id, account_id, payment_method_id,
            amount, payment_date, notes, created_by, affects_balance
        ) VALUES (
            p_workspace_id, p_installment_id, p_account_id, p_payment_method_id,
            p_amount, COALESCE(p_payment_date, CURRENT_DATE), p_notes, v_user_id, v_affects_balance
        ) RETURNING id INTO v_payment_id;

        UPDATE public.installments
        SET paid_amount = v_new_paid,
            status = CASE WHEN v_new_paid >= v_target_total THEN 'paid' ELSE 'partially_paid' END,
            paid_at = CASE WHEN v_new_paid >= v_target_total THEN COALESCE(p_payment_date, CURRENT_DATE)::TIMESTAMPTZ ELSE NULL END
        WHERE id = p_installment_id;

        IF v_affects_balance AND p_account_id IS NOT NULL THEN
            UPDATE public.accounts SET current_balance = current_balance - p_amount WHERE id = p_account_id;
        END IF;

        RETURN v_payment_id;
    END IF;

    -- 3. FATURA DE CARTÃO
    IF p_credit_card_bill_id IS NOT NULL THEN
        SELECT total_amount, paid_amount INTO v_target_total, v_already_paid
        FROM public.credit_card_bills
        WHERE id = p_credit_card_bill_id AND workspace_id = p_workspace_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Fatura não encontrada no workspace.';
        END IF;

        v_remaining := v_target_total - v_already_paid;
        IF p_amount > v_remaining THEN
            RAISE EXCEPTION 'Valor do pagamento (R$ %) excede o saldo restante da fatura (R$ %).', p_amount, v_remaining;
        END IF;

        v_new_paid := v_already_paid + p_amount;

        INSERT INTO public.payments (
            workspace_id, credit_card_bill_id, account_id, payment_method_id,
            amount, payment_date, notes, created_by, affects_balance
        ) VALUES (
            p_workspace_id, p_credit_card_bill_id, p_account_id, p_payment_method_id,
            p_amount, COALESCE(p_payment_date, CURRENT_DATE), p_notes, v_user_id, v_affects_balance
        ) RETURNING id INTO v_payment_id;

        UPDATE public.credit_card_bills
        SET paid_amount = v_new_paid,
            status = CASE WHEN v_new_paid >= v_target_total THEN 'paid' ELSE 'partially_paid' END,
            paid_at = CASE WHEN v_new_paid >= v_target_total THEN COALESCE(p_payment_date, CURRENT_DATE)::TIMESTAMPTZ ELSE NULL END
        WHERE id = p_credit_card_bill_id;

        IF v_new_paid >= v_target_total THEN
            UPDATE public.installments
            SET status = 'paid', paid_amount = amount, paid_at = COALESCE(p_payment_date, CURRENT_DATE)::TIMESTAMPTZ
            WHERE credit_card_bill_id = p_credit_card_bill_id;

            UPDATE public.transactions
            SET status = 'paid', paid_at = COALESCE(p_payment_date, CURRENT_DATE)::TIMESTAMPTZ
            WHERE credit_card_bill_id = p_credit_card_bill_id;
        END IF;

        IF v_affects_balance AND p_account_id IS NOT NULL THEN
            UPDATE public.accounts SET current_balance = current_balance - p_amount WHERE id = p_account_id;
        END IF;

        RETURN v_payment_id;
    END IF;

    RAISE EXCEPTION 'Erro inesperado na validação do pagamento.';
END;
$function$;


CREATE OR REPLACE FUNCTION public.fn_create_transaction_with_splits(p_workspace_id uuid, p_description text, p_amount numeric, p_transaction_date date DEFAULT CURRENT_DATE, p_type text DEFAULT 'expense'::text, p_status text DEFAULT 'pending'::text, p_category_id uuid DEFAULT NULL::uuid, p_account_id uuid DEFAULT NULL::uuid, p_payment_method_id uuid DEFAULT NULL::uuid, p_credit_card_id uuid DEFAULT NULL::uuid, p_credit_card_bill_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_paid_by_member_id uuid DEFAULT NULL::uuid, p_split_type text DEFAULT 'individual'::text, p_due_date date DEFAULT NULL::date, p_splits jsonb DEFAULT NULL::jsonb, p_paid_by_person_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
        v_affects_balance := (v_ws_mode = 'full' AND p_account_id IS NOT NULL);

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
$function$;



-- Preserva referências históricas sem recriar participantes arquivados.
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
$function$;



-- Preserva referências históricas sem recriar participantes arquivados.
CREATE OR REPLACE FUNCTION public.fn_update_purchase_with_splits(p_workspace_id uuid, p_purchase_id uuid, p_description text DEFAULT NULL::text, p_total_amount numeric DEFAULT NULL::numeric, p_purchase_date date DEFAULT NULL::date, p_category_id uuid DEFAULT NULL::uuid, p_account_id uuid DEFAULT NULL::uuid, p_payment_method_id uuid DEFAULT NULL::uuid, p_credit_card_id uuid DEFAULT NULL::uuid, p_paid_by_member_id uuid DEFAULT NULL::uuid, p_split_type text DEFAULT NULL::text, p_splits jsonb DEFAULT NULL::jsonb, p_paid_by_person_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

            DELETE FROM public.purchase_splits existing_split WHERE purchase_id = p_purchase_id
            AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(p_splits) AS x(member_id uuid, person_id uuid)
                WHERE x.member_id IS NOT DISTINCT FROM existing_split.member_id
                  AND x.person_id IS NOT DISTINCT FROM existing_split.person_id);

            FOR v_split IN SELECT * FROM jsonb_to_recordset(p_splits) AS x(member_id UUID, person_id UUID, amount NUMERIC, percentage NUMERIC) LOOP
                UPDATE public.purchase_splits SET amount = v_split.amount, percentage = v_split.percentage
                WHERE purchase_id = p_purchase_id
                  AND member_id IS NOT DISTINCT FROM v_split.member_id
                  AND person_id IS NOT DISTINCT FROM v_split.person_id;
            IF NOT FOUND THEN
                INSERT INTO public.purchase_splits (workspace_id, purchase_id, member_id, person_id, amount, percentage)
                VALUES (p_workspace_id, p_purchase_id, v_split.member_id, v_split.person_id, v_split.amount, v_split.percentage);
            END IF;
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
$function$;



-- Preserva referências históricas sem recriar participantes arquivados.
CREATE OR REPLACE FUNCTION public.fn_set_transaction_splits(p_workspace_id uuid, p_transaction_id uuid, p_splits jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_user_id UUID;
    v_tx_amount NUMERIC(12, 2);
    v_split RECORD;
    v_total_split NUMERIC(12, 2) := 0;
    v_count INT := 0;
    v_member_id UUID;
    v_person_id UUID;
    v_amount NUMERIC(12, 2);
    v_pct NUMERIC(5, 2);
    v_seen_members UUID[] := '{}';
    v_seen_people UUID[] := '{}';
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: permissão insuficiente no workspace.';
    END IF;

    -- Concorrência: serialização por workspace ANTES dos bloqueios de entidades
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
    PERFORM pg_advisory_xact_lock(hashtext('workspace_debt:' || p_workspace_id::text));

    SELECT amount INTO v_tx_amount
    FROM public.transactions
    WHERE id = p_transaction_id AND workspace_id = p_workspace_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transação não encontrada no workspace especificado.';
    END IF;

    IF p_splits IS NULL OR jsonb_array_length(p_splits) = 0 THEN
        DELETE FROM public.transaction_splits WHERE transaction_id = p_transaction_id;
        RETURN 0;
    END IF;

    FOR v_split IN SELECT * FROM jsonb_to_recordset(p_splits) AS x(member_id UUID, person_id UUID, amount NUMERIC, percentage NUMERIC) LOOP
        v_member_id := v_split.member_id;
        v_person_id := v_split.person_id;
        v_amount := v_split.amount;
        v_pct := v_split.percentage;

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
                RAISE EXCEPTION 'O participante do rateio (%) não pertence ao workspace.', v_member_id;
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
                RAISE EXCEPTION 'A pessoa participante do rateio (%) não pertence ao workspace.', v_person_id;
            END IF;
        END IF;

        IF v_amount IS NULL OR v_amount < 0 THEN
            RAISE EXCEPTION 'O valor de cada fração de rateio não pode ser negativo.';
        END IF;

        IF v_pct IS NOT NULL AND (v_pct < 0 OR v_pct > 100) THEN
            RAISE EXCEPTION 'O percentual de cada fração de rateio deve estar entre 0 e 100.';
        END IF;

        v_total_split := v_total_split + v_amount;
    END LOOP;

    -- Conservação financeira estrita: soma das frações exatamente igual ao valor da transação
    IF v_total_split <> v_tx_amount THEN
        RAISE EXCEPTION 'A soma das frações do rateio (R$ %) deve ser exatamente igual ao valor total da transação (R$ %).', v_total_split, v_tx_amount;
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
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$function$;



-- Preserva referências históricas sem recriar participantes arquivados.
CREATE OR REPLACE FUNCTION public.fn_set_purchase_splits(p_workspace_id uuid, p_purchase_id uuid, p_splits jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_user_id UUID;
    v_purchase_amount NUMERIC(12, 2);
    v_split RECORD;
    v_total_split NUMERIC(12, 2) := 0;
    v_count INT := 0;
    v_member_id UUID;
    v_person_id UUID;
    v_amount NUMERIC(12, 2);
    v_pct NUMERIC(5, 2);
    v_seen_members UUID[] := '{}';
    v_seen_people UUID[] := '{}';
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: permissão insuficiente no workspace.';
    END IF;

    -- Concorrência: serialização por workspace ANTES dos bloqueios de entidades
    PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
    PERFORM pg_advisory_xact_lock(hashtext('workspace_debt:' || p_workspace_id::text));

    SELECT total_amount INTO v_purchase_amount
    FROM public.purchases
    WHERE id = p_purchase_id AND workspace_id = p_workspace_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Compra não encontrada no workspace especificado.';
    END IF;

    IF p_splits IS NULL OR jsonb_array_length(p_splits) = 0 THEN
        DELETE FROM public.purchase_splits WHERE purchase_id = p_purchase_id;
        RETURN 0;
    END IF;

    FOR v_split IN SELECT * FROM jsonb_to_recordset(p_splits) AS x(member_id UUID, person_id UUID, amount NUMERIC, percentage NUMERIC) LOOP
        v_member_id := v_split.member_id;
        v_person_id := v_split.person_id;
        v_amount := v_split.amount;
        v_pct := v_split.percentage;

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
                RAISE EXCEPTION 'O participante do rateio (%) não pertence ao workspace.', v_member_id;
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
                RAISE EXCEPTION 'A pessoa participante do rateio (%) não pertence ao workspace.', v_person_id;
            END IF;
        END IF;

        IF v_amount IS NULL OR v_amount < 0 THEN
            RAISE EXCEPTION 'O valor de cada fração de rateio não pode ser negativo.';
        END IF;

        IF v_pct IS NOT NULL AND (v_pct < 0 OR v_pct > 100) THEN
            RAISE EXCEPTION 'O percentual de cada fração de rateio deve estar entre 0 e 100.';
        END IF;

        v_total_split := v_total_split + v_amount;
    END LOOP;

    -- Conservação financeira estrita: soma das frações exatamente igual ao total da compra
    IF v_total_split <> v_purchase_amount THEN
        RAISE EXCEPTION 'A soma das frações do rateio (R$ %) deve ser exatamente igual ao valor total da compra (R$ %).', v_total_split, v_purchase_amount;
    END IF;

    DELETE FROM public.purchase_splits existing_split WHERE purchase_id = p_purchase_id
            AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(p_splits) AS x(member_id uuid, person_id uuid)
                WHERE x.member_id IS NOT DISTINCT FROM existing_split.member_id
                  AND x.person_id IS NOT DISTINCT FROM existing_split.person_id);

    FOR v_split IN SELECT * FROM jsonb_to_recordset(p_splits) AS x(member_id UUID, person_id UUID, amount NUMERIC, percentage NUMERIC) LOOP
        UPDATE public.purchase_splits SET amount = v_split.amount, percentage = v_split.percentage
                WHERE purchase_id = p_purchase_id
                  AND member_id IS NOT DISTINCT FROM v_split.member_id
                  AND person_id IS NOT DISTINCT FROM v_split.person_id;
            IF NOT FOUND THEN
                INSERT INTO public.purchase_splits (workspace_id, purchase_id, member_id, person_id, amount, percentage)
        VALUES (p_workspace_id, p_purchase_id, v_split.member_id, v_split.person_id, v_split.amount, v_split.percentage);
            END IF;
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$function$;
