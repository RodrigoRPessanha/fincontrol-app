-- A2-R1: conta contextual validada permitida; cartão pendente não debita banco.
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
    v_bill_id UUID;
    v_card RECORD;
    v_date DATE;
    v_month DATE;
BEGIN
    p_amount := public.fn_normalize_money(p_amount);
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

    IF p_credit_card_id IS NOT NULL OR p_credit_card_bill_id IS NOT NULL THEN
      IF COALESCE(p_type,'expense')<>'expense' THEN
        RAISE EXCEPTION 'Receitas não podem ser vinculadas a cartão de crédito.';
      END IF;
      IF p_credit_card_id IS NULL THEN
        SELECT credit_card_id INTO p_credit_card_id FROM public.credit_card_bills
        WHERE id=p_credit_card_bill_id AND workspace_id=p_workspace_id;
        IF p_credit_card_id IS NULL THEN RAISE EXCEPTION 'Fatura não pertence ao workspace.'; END IF;
      END IF;
      SELECT * INTO v_card FROM public.credit_cards WHERE id=p_credit_card_id AND workspace_id=p_workspace_id AND active;
      IF v_card.id IS NULL THEN RAISE EXCEPTION 'Cartão ativo não encontrado no workspace.'; END IF;
      v_date := COALESCE(p_transaction_date,CURRENT_DATE);
      v_month := date_trunc('month',v_date)::date;
      IF EXTRACT(day FROM v_date)>LEAST(v_card.closing_day,EXTRACT(day FROM(v_month+interval '1 month - 1 day'))::int) THEN
        v_month := (v_month+interval '1 month')::date;
      END IF;
      v_bill_id := public.fn_get_or_create_credit_card_bill(p_workspace_id,p_credit_card_id,to_char(v_month,'YYYY-MM'));
      IF p_credit_card_bill_id IS NOT NULL AND p_credit_card_bill_id<>v_bill_id THEN
        RAISE EXCEPTION 'Fatura informada não corresponde ao ciclo do cartão.';
      END IF;
      p_credit_card_bill_id := v_bill_id;
      SELECT due_date INTO p_due_date FROM public.credit_card_bills WHERE id=v_bill_id;
      UPDATE public.credit_card_bills SET total_amount=total_amount+p_amount,
        status=CASE WHEN paid_amount>=total_amount+p_amount THEN 'paid' WHEN paid_amount>0 THEN 'partially_paid' ELSE 'open' END,
        paid_at=CASE WHEN paid_amount>=total_amount+p_amount THEN paid_at ELSE NULL END
      WHERE id=v_bill_id AND workspace_id=p_workspace_id;
    END IF;

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
$function$
;
