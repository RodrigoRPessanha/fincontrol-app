-- Relative closing uses calendar days before due date; existing bill dates remain immutable.
ALTER TABLE public.credit_cards ADD COLUMN closing_days_before_due integer
 CHECK (closing_days_before_due BETWEEN 1 AND 27);

CREATE FUNCTION public.fn_card_cycle_calendar(p_card public.credit_cards,p_cycle date)
RETURNS TABLE(closing_date date,due_date date) LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE month_date date:=date_trunc('month',p_cycle)::date; due_month date;
BEGIN
 due_month:=CASE WHEN (p_card.closing_days_before_due IS NOT NULL AND p_card.due_day<=p_card.closing_days_before_due)
 OR (p_card.closing_days_before_due IS NULL AND p_card.due_day<p_card.closing_day) THEN (month_date+interval '1 month')::date ELSE month_date END;
 due_date:=make_date(extract(year FROM due_month)::int,extract(month FROM due_month)::int,least(p_card.due_day,extract(day FROM due_month+interval '1 month - 1 day')::int));
 closing_date:=CASE WHEN p_card.closing_days_before_due IS NOT NULL THEN due_date-p_card.closing_days_before_due
 ELSE make_date(extract(year FROM month_date)::int,extract(month FROM month_date)::int,least(p_card.closing_day,extract(day FROM month_date+interval '1 month - 1 day')::int)) END;
 RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION public.fn_card_cycle_calendar(public.credit_cards,date) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.fn_card_purchase_cycle(p_card_id uuid,p_date date,p_inclusive boolean DEFAULT false)
RETURNS date LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE card public.credit_cards; cycle date:=date_trunc('month',p_date)::date; closing date;
BEGIN
 SELECT * INTO STRICT card FROM public.credit_cards WHERE id=p_card_id;
 SELECT closing_date INTO closing FROM public.fn_card_cycle_calendar(card,cycle);
 IF p_date>closing OR ((p_inclusive OR card.closing_days_before_due IS NOT NULL) AND p_date=closing) THEN cycle:=(cycle+interval '1 month')::date; END IF;
 RETURN cycle;
END $$;
REVOKE ALL ON FUNCTION public.fn_card_purchase_cycle(uuid,date,boolean) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.fn_create_credit_card_transaction(p_workspace_id uuid, p_credit_card_id uuid, p_description text, p_amount numeric, p_transaction_date date DEFAULT CURRENT_DATE, p_category_id uuid DEFAULT NULL::uuid, p_payment_method_id uuid DEFAULT NULL::uuid, p_paid_by_member_id uuid DEFAULT NULL::uuid, p_split_type text DEFAULT 'individual'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_card_closing INT;
    v_p_day INT;
    v_p_month INT;
    v_p_year INT;
    v_bill_month INT;
    v_bill_year INT;
    v_ref_month TEXT;
    v_bill_id UUID;
    v_due_date DATE;
    v_tx_id UUID;
    v_split_mode TEXT;
BEGIN
    PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id FOR UPDATE;
    p_amount := public.fn_normalize_money(p_amount);
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: você não possui permissão de escrita neste workspace.';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'O valor da transação deve ser estritamente maior que zero.';
    END IF;

    v_split_mode := COALESCE(p_split_type, 'individual');
    IF v_split_mode NOT IN ('individual', 'equal', 'full_other', 'custom') THEN
        RAISE EXCEPTION 'Tipo de rateio inválido.';
    END IF;

    IF p_paid_by_member_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.workspace_members
        WHERE id = p_paid_by_member_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Membro pagador informado não pertence ao workspace.';
    END IF;

    SELECT closing_day INTO v_card_closing
    FROM public.credit_cards
    WHERE id = p_credit_card_id AND workspace_id = p_workspace_id;

    IF v_card_closing IS NULL THEN
        RAISE EXCEPTION 'Cartão de crédito não encontrado no workspace informado.';
    END IF;

    IF p_category_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.categories WHERE id = p_category_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Categoria informada não pertence ao workspace.';
    END IF;

    IF p_payment_method_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.payment_methods WHERE id = p_payment_method_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Método de pagamento informado não pertence ao workspace.';
    END IF;

    v_p_day := EXTRACT(DAY FROM p_transaction_date)::INT;
    v_p_month := EXTRACT(MONTH FROM p_transaction_date)::INT;
    v_p_year := EXTRACT(YEAR FROM p_transaction_date)::INT;

    v_bill_month:=extract(month FROM public.fn_card_purchase_cycle(p_credit_card_id,p_transaction_date,false))::int;
    v_bill_year:=extract(year FROM public.fn_card_purchase_cycle(p_credit_card_id,p_transaction_date,false))::int;

    v_ref_month := v_bill_year || '-' || LPAD(v_bill_month::TEXT, 2, '0');
    v_bill_id := public.fn_get_or_create_credit_card_bill(p_workspace_id, p_credit_card_id, v_ref_month);

    UPDATE public.credit_card_bills
    SET total_amount = total_amount + p_amount,
        status = CASE WHEN paid_amount >= total_amount + p_amount AND total_amount + p_amount > 0 THEN 'paid' WHEN paid_amount > 0 THEN 'partially_paid' ELSE 'open' END,
        paid_at = CASE WHEN paid_amount >= total_amount + p_amount AND total_amount + p_amount > 0 THEN paid_at ELSE NULL END
    WHERE id = v_bill_id
    RETURNING due_date INTO v_due_date;

    INSERT INTO public.transactions (
        workspace_id, category_id, payment_method_id, credit_card_id,
        credit_card_bill_id, description, amount, type,
        transaction_date, due_date, status, created_by,
        paid_by_member_id, split_type
    )
    VALUES (
        p_workspace_id, p_category_id, p_payment_method_id, p_credit_card_id,
        v_bill_id, p_description, p_amount, 'expense',
        p_transaction_date, v_due_date, 'pending', auth.uid(),
        p_paid_by_member_id, v_split_mode
    )
    RETURNING id INTO v_tx_id;

    RETURN v_tx_id;
END;
$function$;


CREATE OR REPLACE FUNCTION public.fn_create_installment_purchase(p_workspace_id uuid, p_description text, p_total_amount numeric, p_installment_count integer, p_purchase_date date DEFAULT CURRENT_DATE, p_credit_card_id uuid DEFAULT NULL::uuid, p_category_id uuid DEFAULT NULL::uuid, p_account_id uuid DEFAULT NULL::uuid, p_payment_method_id uuid DEFAULT NULL::uuid, p_paid_installments_count integer DEFAULT 0, p_paid_by_member_id uuid DEFAULT NULL::uuid, p_split_type text DEFAULT 'individual'::text, p_paid_by_person_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_purchase_id UUID;
    v_base_amount NUMERIC(12, 2);
    v_remainder NUMERIC(12, 2);
    v_first_amount NUMERIC(12, 2);
    v_amount NUMERIC(12, 2);
    v_bill_id UUID;
    v_card_closing INT;
    v_p_day INT;
    v_p_month INT;
    v_p_year INT;
    v_start_month INT;
    v_start_year INT;
    v_cycle_month INT;
    v_cycle_year INT;
    v_ref_month TEXT;
    v_due_date DATE;
    v_is_paid BOOLEAN;
    v_paid_count INT;
    v_split_mode TEXT;
BEGIN
    PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id FOR UPDATE;
    p_total_amount := public.fn_normalize_money(p_total_amount);
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: você não possui permissão de escrita neste workspace.';
    END IF;

    IF p_installment_count < 1 OR p_installment_count > 120 THEN
        RAISE EXCEPTION 'A quantidade de parcelas deve estar entre 1 e 120.';
    END IF;

    IF p_total_amount <= 0 THEN
        RAISE EXCEPTION 'O valor total deve ser estritamente maior que zero.';
    END IF;

    IF p_total_amount < p_installment_count * 0.01 THEN
        RAISE EXCEPTION 'O valor total é insuficiente para gerar parcelas de no mínimo R$ 0,01.';
    END IF;

    v_paid_count := COALESCE(p_paid_installments_count, 0);
    IF v_paid_count < 0 OR v_paid_count > p_installment_count THEN
        RAISE EXCEPTION 'A quantidade de parcelas já pagas deve estar entre 0 e o total de parcelas.';
    END IF;

    v_split_mode := COALESCE(p_split_type, 'individual');
    IF v_split_mode NOT IN ('individual', 'equal', 'full_other', 'custom') THEN
        RAISE EXCEPTION 'Tipo de rateio inválido.';
    END IF;

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

    IF p_account_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.accounts WHERE id = p_account_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Conta bancária informada não pertence ao workspace.';
    END IF;

    IF p_category_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.categories WHERE id = p_category_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Categoria informada não pertence ao workspace.';
    END IF;

    IF p_payment_method_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.payment_methods WHERE id = p_payment_method_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Método de pagamento informado não pertence ao workspace.';
    END IF;

    INSERT INTO public.purchases (
        workspace_id, account_id, credit_card_id, category_id, payment_method_id,
        description, total_amount, installment_count, paid_installments_count,
        purchase_date, created_by, paid_by_member_id, paid_by_person_id, split_type
    )
    VALUES (
        p_workspace_id, p_account_id, p_credit_card_id, p_category_id, p_payment_method_id,
        p_description, p_total_amount, p_installment_count, v_paid_count,
        p_purchase_date, auth.uid(), p_paid_by_member_id, p_paid_by_person_id, v_split_mode
    )
    RETURNING id INTO v_purchase_id;

    v_base_amount := TRUNC(p_total_amount / p_installment_count, 2);
    v_remainder := p_total_amount - (v_base_amount * p_installment_count);
    v_first_amount := v_base_amount + v_remainder;

    IF p_credit_card_id IS NOT NULL THEN
        SELECT closing_day INTO v_card_closing
        FROM public.credit_cards
        WHERE id = p_credit_card_id AND workspace_id = p_workspace_id;

        IF v_card_closing IS NULL THEN
            RAISE EXCEPTION 'Cartão de crédito não encontrado no workspace informado.';
        END IF;

        v_p_day := EXTRACT(DAY FROM p_purchase_date);
        v_p_month := EXTRACT(MONTH FROM p_purchase_date);
        v_p_year := EXTRACT(YEAR FROM p_purchase_date);

        v_start_month:=extract(month FROM public.fn_card_purchase_cycle(p_credit_card_id,p_purchase_date,true))::int;
        v_start_year:=extract(year FROM public.fn_card_purchase_cycle(p_credit_card_id,p_purchase_date,true))::int;
    END IF;

    FOR i IN 1..p_installment_count LOOP
        IF i = 1 THEN
            v_amount := v_first_amount;
        ELSE
            v_amount := v_base_amount;
        END IF;

        v_is_paid := (i <= v_paid_count);
        v_bill_id := NULL;

        IF p_credit_card_id IS NOT NULL THEN
            v_cycle_month := v_start_month + (i - 1);
            v_cycle_year := v_start_year + ((v_cycle_month - 1) / 12);
            v_cycle_month := ((v_cycle_month - 1) % 12) + 1;
            v_ref_month := to_char(v_cycle_year, 'FM0000') || '-' || to_char(v_cycle_month, 'FM00');

            v_bill_id := public.fn_get_or_create_credit_card_bill(
                p_workspace_id,
                p_credit_card_id,
                v_ref_month
            );

            SELECT due_date INTO v_due_date
            FROM public.credit_card_bills
            WHERE id = v_bill_id;
        ELSE
            v_due_date := (p_purchase_date + ((i - 1) || ' month')::INTERVAL)::DATE;
        END IF;

        INSERT INTO public.installments (
            purchase_id,
            credit_card_bill_id,
            installment_number,
            amount,
            due_date,
            status,
            paid_amount,
            paid_at
        )
        VALUES (
            v_purchase_id,
            v_bill_id,
            i,
            v_amount,
            v_due_date,
            CASE WHEN v_is_paid THEN 'paid' ELSE 'pending' END,
            CASE WHEN v_is_paid THEN v_amount ELSE 0.00 END,
            CASE WHEN v_is_paid THEN CURRENT_TIMESTAMP ELSE NULL END
        );

        IF v_bill_id IS NOT NULL THEN
            UPDATE public.credit_card_bills
            SET total_amount = total_amount + v_amount,
                paid_amount = paid_amount + (CASE WHEN v_is_paid THEN v_amount ELSE 0.00 END),
                status = CASE
                    WHEN (paid_amount + (CASE WHEN v_is_paid THEN v_amount ELSE 0.00 END)) >= (total_amount + v_amount) THEN 'paid'
                    WHEN (paid_amount + (CASE WHEN v_is_paid THEN v_amount ELSE 0.00 END)) > 0 THEN 'partially_paid'
                    ELSE status
                END,
                paid_at = CASE
                    WHEN (paid_amount + (CASE WHEN v_is_paid THEN v_amount ELSE 0.00 END)) >= (total_amount + v_amount) THEN CURRENT_TIMESTAMP
                    ELSE paid_at
                END
            WHERE id = v_bill_id;
        END IF;
    END LOOP;

    RETURN v_purchase_id;
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
    v_bill_id UUID;
    v_card RECORD;
    v_date DATE;
    v_month DATE;
BEGIN
    PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id FOR UPDATE;
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
      v_month := public.fn_card_purchase_cycle(p_credit_card_id,v_date,false);
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
$function$;


CREATE OR REPLACE FUNCTION public.fn_get_or_create_credit_card_bill(p_workspace_id uuid, p_credit_card_id uuid, p_reference_month text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_bill_id UUID;
    v_closing_day INT;
    v_due_day INT;
    v_year INT;
    v_month INT;
    v_due_year INT;
    v_due_month INT;
    v_max_closing_days INT;
    v_max_due_days INT;
    v_closing_date DATE;
    v_due_date DATE;
BEGIN
    PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id FOR UPDATE;
    -- Se invocado por usuário com sessão autenticada, valida papel no workspace
    IF auth.uid() IS NOT NULL THEN
        IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
            RAISE EXCEPTION 'Acesso negado: você não possui permissão neste workspace.';
        END IF;
    ELSIF current_user = 'anon' OR session_user = 'anon' OR COALESCE(auth.role(), '') = 'anon' THEN
        -- Rejeita chamadas não autenticadas de clientes anônimos
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    SELECT id INTO v_bill_id
    FROM public.credit_card_bills
    WHERE credit_card_id = p_credit_card_id
      AND reference_month = p_reference_month
      AND workspace_id = p_workspace_id;

    IF v_bill_id IS NOT NULL THEN
        RETURN v_bill_id;
    END IF;

    SELECT closing_day, due_day INTO v_closing_day, v_due_day
    FROM public.credit_cards
    WHERE id = p_credit_card_id AND workspace_id = p_workspace_id;

    IF v_closing_day IS NULL THEN
        RAISE EXCEPTION 'Cartão de crédito não encontrado no workspace informado.';
    END IF;

    v_year := SPLIT_PART(p_reference_month, '-', 1)::INT;
    v_month := SPLIT_PART(p_reference_month, '-', 2)::INT;

    SELECT d.closing_date,d.due_date INTO v_closing_date,v_due_date
    FROM public.credit_cards c CROSS JOIN LATERAL public.fn_card_cycle_calendar(c,make_date(v_year,v_month,1)) d
    WHERE c.id=p_credit_card_id AND c.workspace_id=p_workspace_id;

    INSERT INTO public.credit_card_bills (
        workspace_id, credit_card_id, reference_month,
        closing_date, due_date, total_amount, paid_amount, status
    )
    VALUES (
        p_workspace_id, p_credit_card_id, p_reference_month,
        v_closing_date, v_due_date, 0.00, 0.00, 'open'
    )
    ON CONFLICT (credit_card_id, reference_month)
    DO UPDATE SET updated_at = NOW()
    RETURNING id INTO v_bill_id;

    RETURN v_bill_id;
END;
$function$;


CREATE OR REPLACE FUNCTION public.fn_materialize_recurring_transactions(p_workspace_id uuid DEFAULT NULL::uuid, p_target_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_rec RECORD;
    v_curr DATE;
    v_next_step DATE;
    v_iterations INT;
    v_should_deactivate BOOLEAN;
    v_is_suspended BOOLEAN;
    v_suspended_reason TEXT;

    -- Validações de entidades vinculadas
    v_acc_active BOOLEAN;
    v_cat_active BOOLEAN;
    v_pm_active BOOLEAN;
    v_pm_type TEXT;
    v_pm_card_id UUID;
    v_pm_acc_id UUID;

    -- Cartão e fatura
    v_effective_card_id UUID;
    v_effective_account_id UUID;
    v_card_active BOOLEAN;
    v_card_closing INT;
    v_card_due INT;
    v_bill_id UUID;
    v_due_date DATE;
    v_ref_month TEXT;
    v_p_day INT;
    v_p_month INT;
    v_p_year INT;
    v_bill_month INT;
    v_bill_year INT;

    -- Contadores
    v_created_count INT := 0;
    v_suspended_count INT := 0;
    v_processed_count INT := 0;
BEGIN
    -- 1. Validação de permissão e data limite quando chamado por usuário autenticado
    IF auth.uid() IS NOT NULL THEN
        -- Bloqueia geração de ocorrências arbitrariamente futuras por usuários comuns
        IF p_target_date > (CURRENT_DATE + INTERVAL '30 days')::DATE THEN
            RAISE EXCEPTION 'A data limite para materialização não pode exceder 30 dias a partir da data atual.';
        END IF;

        IF p_workspace_id IS NOT NULL THEN
            IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
                RAISE EXCEPTION 'Acesso negado: você não possui permissão de escrita neste workspace.';
            END IF;
        END IF;
    ELSIF current_user = 'anon' OR session_user = 'anon' OR COALESCE(auth.role(), '') = 'anon' THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    -- Itera sobre recorrências ativas que devem gerar ocorrências até p_target_date
    -- Lock exclusivo por linha com SKIP LOCKED para garantir atomicidade em concorrência
    FOR v_rec IN
        SELECT r.*
        FROM public.recurring_transactions r
        JOIN public.workspaces w ON w.id = r.workspace_id
        WHERE r.active = TRUE
          AND r.auto_create = TRUE
          AND r.next_occurrence <= p_target_date
          AND (p_workspace_id IS NULL OR r.workspace_id = p_workspace_id)
          AND (
              auth.uid() IS NULL
              OR EXISTS (
                  SELECT 1 FROM public.workspace_members wm
                  WHERE wm.workspace_id = r.workspace_id
                    AND wm.user_id = auth.uid()
                    AND wm.role IN ('owner', 'admin', 'member')
              )
          )
        ORDER BY r.workspace_id, r.id
        FOR UPDATE OF r SKIP LOCKED
    LOOP
        v_is_suspended := FALSE;
        v_suspended_reason := NULL;
        v_effective_card_id := v_rec.credit_card_id;
        v_effective_account_id := v_rec.account_id;

        -- 1. Verifica se next_occurrence já ultrapassou end_date
        IF v_rec.end_date IS NOT NULL AND v_rec.next_occurrence > v_rec.end_date THEN
            UPDATE public.recurring_transactions
            SET active = FALSE, updated_at = NOW()
            WHERE id = v_rec.id;
            v_suspended_count := v_suspended_count + 1;
            CONTINUE;
        END IF;

        -- 2. Resolução de Método de Pagamento
        IF v_rec.payment_method_id IS NOT NULL THEN
            SELECT active, type, credit_card_id, linked_account_id
            INTO v_pm_active, v_pm_type, v_pm_card_id, v_pm_acc_id
            FROM public.payment_methods
            WHERE id = v_rec.payment_method_id AND workspace_id = v_rec.workspace_id;

            IF v_pm_active IS NULL OR v_pm_active = FALSE THEN
                v_is_suspended := TRUE;
                v_suspended_reason := 'Método de pagamento vinculado está inativo.';
            ELSE
                IF v_pm_card_id IS NOT NULL THEN
                    v_effective_card_id := v_pm_card_id;
                END IF;
                IF v_pm_acc_id IS NOT NULL AND v_effective_account_id IS NULL THEN
                    v_effective_account_id := v_pm_acc_id;
                END IF;
            END IF;
        END IF;

        -- 3. Validação de Conta Bancária
        IF NOT v_is_suspended AND v_effective_account_id IS NOT NULL THEN
            SELECT active INTO v_acc_active
            FROM public.accounts
            WHERE id = v_effective_account_id AND workspace_id = v_rec.workspace_id;

            IF v_acc_active IS NULL THEN
                v_is_suspended := TRUE;
                v_suspended_reason := 'Conta bancária associada não encontrada no workspace.';
            ELSIF v_acc_active = FALSE THEN
                v_is_suspended := TRUE;
                v_suspended_reason := 'Conta bancária vinculada está inativa.';
            END IF;
        END IF;

        -- 4. Validação de Categoria
        IF NOT v_is_suspended AND v_rec.category_id IS NOT NULL THEN
            SELECT active INTO v_cat_active
            FROM public.categories
            WHERE id = v_rec.category_id AND workspace_id = v_rec.workspace_id;

            IF v_cat_active IS NULL OR v_cat_active = FALSE THEN
                v_is_suspended := TRUE;
                v_suspended_reason := 'Categoria vinculada inativa ou inválida.';
            END IF;
        END IF;

        -- 5. Validação de Cartão de Crédito
        IF NOT v_is_suspended AND v_effective_card_id IS NOT NULL THEN
            IF v_rec.type = 'income' THEN
                v_is_suspended := TRUE;
                v_suspended_reason := 'Receitas não podem ser vinculadas a cartão de crédito ou faturas.';
            ELSE
                SELECT active, closing_day, due_day
                INTO v_card_active, v_card_closing, v_card_due
                FROM public.credit_cards
                WHERE id = v_effective_card_id AND workspace_id = v_rec.workspace_id;

                IF v_card_active IS NULL OR v_card_active = FALSE THEN
                    v_is_suspended := TRUE;
                    v_suspended_reason := 'Cartão de crédito vinculado está inativo.';
                END IF;
            END IF;
        END IF;

        -- Se alguma regra de negócio foi violada, suspende a recorrência
        IF v_is_suspended THEN
            UPDATE public.recurring_transactions
            SET active = FALSE,
                suspended_reason = v_suspended_reason,
                updated_at = NOW()
            WHERE id = v_rec.id;
            v_suspended_count := v_suspended_count + 1;
            CONTINUE;
        END IF;

        -- 6. Loop de Materialização com Catch-Up
        v_curr := v_rec.next_occurrence;
        v_iterations := 0;
        v_should_deactivate := FALSE;

        WHILE v_curr <= p_target_date AND (v_rec.end_date IS NULL OR v_curr <= v_rec.end_date) AND v_iterations < 120 LOOP
            v_iterations := v_iterations + 1;

            -- Verifica idempotência da ocorrência
            IF NOT EXISTS (
                SELECT 1 FROM public.transactions
                WHERE recurring_transaction_id = v_rec.id
                  AND transaction_date = v_curr
            ) THEN
                -- Se vinculada a cartão, resolve/cria fatura e calcula due_date
                IF v_effective_card_id IS NOT NULL THEN
                    v_p_day := EXTRACT(DAY FROM v_curr)::INT;
                    v_p_month := EXTRACT(MONTH FROM v_curr)::INT;
                    v_p_year := EXTRACT(YEAR FROM v_curr)::INT;

                    v_bill_month:=extract(month FROM public.fn_card_purchase_cycle(v_effective_card_id,v_curr,false))::int;
    v_bill_year:=extract(year FROM public.fn_card_purchase_cycle(v_effective_card_id,v_curr,false))::int;

                    v_ref_month := v_bill_year || '-' || LPAD(v_bill_month::TEXT, 2, '0');
                    v_bill_id := public.fn_get_or_create_credit_card_bill(v_rec.workspace_id, v_effective_card_id, v_ref_month);

                    UPDATE public.credit_card_bills
                    SET total_amount = total_amount + v_rec.amount,
                        status = CASE WHEN paid_amount >= total_amount + v_rec.amount AND total_amount + v_rec.amount > 0 THEN 'paid' WHEN paid_amount > 0 THEN 'partially_paid' ELSE 'open' END,
                        paid_at = CASE WHEN paid_amount >= total_amount + v_rec.amount AND total_amount + v_rec.amount > 0 THEN paid_at ELSE NULL END,
                        updated_at = NOW()
                    WHERE id = v_bill_id
                    RETURNING due_date INTO v_due_date;
                ELSE
                    v_bill_id := NULL;
                    v_due_date := v_curr;
                END IF;

                -- Insere a transação materializada
                INSERT INTO public.transactions (
                    workspace_id,
                    account_id,
                    category_id,
                    payment_method_id,
                    credit_card_id,
                    credit_card_bill_id,
                    recurring_transaction_id,
                    description,
                    amount,
                    type,
                    transaction_date,
                    due_date,
                    status,
                    created_by
                )
                VALUES (
                    v_rec.workspace_id,
                    v_effective_account_id,
                    v_rec.category_id,
                    v_rec.payment_method_id,
                    v_effective_card_id,
                    v_bill_id,
                    v_rec.id,
                    v_rec.description,
                    v_rec.amount,
                    v_rec.type,
                    v_curr,
                    v_due_date,
                    'pending',
                    COALESCE(auth.uid(), (SELECT owner_id FROM public.workspaces WHERE id = v_rec.workspace_id))
                )
                ON CONFLICT (recurring_transaction_id, transaction_date) DO NOTHING;

                v_created_count := v_created_count + 1;
            END IF;

            -- Avança para a próxima data
            v_next_step := public.fn_step_next_occurrence(v_curr, v_rec.start_date, v_rec.frequency, v_rec.interval_days);
            IF v_rec.end_date IS NOT NULL AND v_next_step > v_rec.end_date THEN
                v_should_deactivate := TRUE;
                v_curr := v_next_step;
                EXIT;
            END IF;
            v_curr := v_next_step;
        END LOOP;

        -- Atualiza next_occurrence e encerra se expirado
        UPDATE public.recurring_transactions
        SET next_occurrence = v_curr,
            active = CASE WHEN v_should_deactivate THEN FALSE ELSE active END,
            updated_at = NOW()
        WHERE id = v_rec.id;

        v_processed_count := v_processed_count + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'created_transactions', v_created_count,
        'suspended_recurring', v_suspended_count,
        'processed_recurring', v_processed_count,
        'target_date', p_target_date
    );
END;
$function$;


CREATE OR REPLACE FUNCTION public.fn_purchase_date_schedule(p_purchase_id uuid, p_purchase_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE pur public.purchases; card public.credit_cards; inst record; target public.credit_card_bills;
 first_cycle date; cycle date; due_month date; closing date; due date; reference text; plan jsonb='[]';
BEGIN
 SELECT * INTO pur FROM public.purchases WHERE id=p_purchase_id;
 IF pur.id IS NULL OR p_purchase_date IS NULL THEN RAISE EXCEPTION 'Compra ou data inválida.' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM public.installments WHERE purchase_id=pur.id)<>pur.installment_count OR
    (SELECT count(DISTINCT installment_number) FROM public.installments WHERE purchase_id=pur.id)<>pur.installment_count OR
    (SELECT sum(amount) FROM public.installments WHERE purchase_id=pur.id) IS DISTINCT FROM pur.total_amount OR
    EXISTS(SELECT 1 FROM public.installments WHERE purchase_id=pur.id AND (installment_number NOT BETWEEN 1 AND pur.installment_count OR status='cancelled' OR paid_amount<0 OR paid_amount>amount OR (status='paid' AND paid_amount<>amount))) THEN
   RAISE EXCEPTION 'Confira as parcelas da compra antes de corrigir a data.' USING ERRCODE='23514';
 END IF;
 IF pur.credit_card_id IS NOT NULL THEN
   SELECT * INTO card FROM public.credit_cards WHERE id=pur.credit_card_id AND workspace_id=pur.workspace_id;
   IF card.id IS NULL THEN RAISE EXCEPTION 'Cartão da compra não encontrado no workspace.'; END IF;
   first_cycle:=public.fn_card_purchase_cycle(card.id,p_purchase_date,true);
 END IF;
 FOR inst IN SELECT * FROM public.installments WHERE purchase_id=pur.id ORDER BY installment_number LOOP
   IF (pur.credit_card_id IS NOT NULL AND inst.credit_card_bill_id IS NULL) OR
      (inst.credit_card_bill_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.credit_card_bills WHERE id=inst.credit_card_bill_id AND workspace_id=pur.workspace_id AND credit_card_id=pur.credit_card_id)) THEN RAISE EXCEPTION 'Fatura da parcela não encontrada no workspace.'; END IF;
   reference:=NULL; closing:=NULL; target:=NULL;
   IF pur.credit_card_id IS NULL THEN due:=(p_purchase_date+make_interval(months=>inst.installment_number-1))::date;
   ELSE
     cycle:=(first_cycle+make_interval(months=>inst.installment_number-1))::date; reference:=to_char(cycle,'YYYY-MM');
     SELECT d.closing_date,d.due_date INTO closing,due FROM public.fn_card_cycle_calendar(card,cycle) d;
     SELECT * INTO target FROM public.credit_card_bills WHERE workspace_id=pur.workspace_id AND credit_card_id=pur.credit_card_id AND reference_month=reference;
     due:=COALESCE(target.due_date,due); closing:=COALESCE(target.closing_date,closing);
   END IF;
   plan:=plan||jsonb_build_array(jsonb_build_object('installment_id',inst.id,'installment_number',inst.installment_number,'old_due_date',inst.due_date,'due_date',due,
     'old_bill_id',inst.credit_card_bill_id,'target_bill_id',target.id,'reference_month',reference,'closing_date',closing,'amount',inst.amount,'paid_amount',inst.paid_amount,'status',inst.status));
 END LOOP;
 RETURN plan;
END $function$;
