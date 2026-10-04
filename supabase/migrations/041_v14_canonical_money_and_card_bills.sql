-- A2-01/04/05: quantização anterior a efeitos, integridade monetária e faturas avulsas.
-- Definições completas preservam autorização, locks e histórico da migration 040.
CREATE OR REPLACE FUNCTION public.fn_normalize_money(p_value numeric, p_rule text DEFAULT 'positive')
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE v numeric;
BEGIN
  IF p_value IS NULL OR p_value::text IN ('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION 'Valor monetário deve ser finito e não nulo.';
  END IF;
  IF p_rule NOT IN ('positive','nonnegative','signed') THEN RAISE EXCEPTION 'Regra monetária inválida.'; END IF;
  v := round(p_value,2);
  IF abs(v)>9999999999.99 OR (p_rule='positive' AND v<=0) OR (p_rule='nonnegative' AND p_value<0) THEN
    RAISE EXCEPTION 'Valor monetário fora do intervalo permitido.';
  END IF;
  RETURN v;
END; $$;
REVOKE ALL ON FUNCTION public.fn_normalize_money(numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_normalize_money(numeric,text) TO authenticated,service_role;

-- A migration aborta, sem inventar saldos, caso haja dados monetários inválidos.
DO $$
DECLARE c record; invalid bigint; predicate text;
BEGIN
  FOR c IN SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema='public' AND data_type='numeric'
      AND column_name IN ('amount','total_amount','paid_amount','initial_balance','current_balance','credit_limit','planned_amount','target_amount','current_amount')
  LOOP
    predicate := format('%I::text NOT IN (''NaN'',''Infinity'',''-Infinity'') AND abs(%I)<=9999999999.99',c.column_name,c.column_name);
    IF c.column_name NOT IN ('initial_balance','current_balance') THEN predicate := predicate || format(' AND %I>=0',c.column_name); END IF;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE NOT (%s)',c.table_name,predicate) INTO invalid;
    IF invalid>0 THEN RAISE EXCEPTION 'Integridade monetária: %.% contém % registros inválidos; requer revisão manual.',c.table_name,c.column_name,invalid; END IF;
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%s)',c.table_name,'finite_'||c.column_name||'_check',predicate);
  END LOOP;
END; $$;

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

    v_bill_month := v_p_month;
    v_bill_year := v_p_year;
    IF v_p_day > v_card_closing THEN
        v_bill_month := v_bill_month + 1;
        IF v_bill_month > 12 THEN
            v_bill_month := 1;
            v_bill_year := v_bill_year + 1;
        END IF;
    END IF;

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
$function$
;

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

        IF v_p_day >= v_card_closing THEN
            v_start_month := v_p_month + 1;
            v_start_year := v_p_year;
            IF v_start_month > 12 THEN
                v_start_month := 1;
                v_start_year := v_start_year + 1;
            END IF;
        ELSE
            v_start_month := v_p_month;
            v_start_year := v_p_year;
        END IF;
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
$function$
;

CREATE OR REPLACE FUNCTION public.fn_create_purchase_with_splits(p_workspace_id uuid, p_description text, p_total_amount numeric, p_installment_count integer, p_purchase_date date DEFAULT CURRENT_DATE, p_credit_card_id uuid DEFAULT NULL::uuid, p_category_id uuid DEFAULT NULL::uuid, p_account_id uuid DEFAULT NULL::uuid, p_payment_method_id uuid DEFAULT NULL::uuid, p_paid_installments_count integer DEFAULT 0, p_paid_by_member_id uuid DEFAULT NULL::uuid, p_split_type text DEFAULT 'individual'::text, p_splits jsonb DEFAULT NULL::jsonb, p_paid_by_person_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_purchase_id UUID;
    v_split RECORD;
    v_total_split NUMERIC(12, 2) := 0;
    v_member_id UUID;
    v_person_id UUID;
    v_seen_members UUID[] := '{}';
    v_seen_people UUID[] := '{}';
BEGIN
    p_total_amount := public.fn_normalize_money(p_total_amount);
    IF p_splits IS NOT NULL THEN
      SELECT COALESCE(jsonb_agg(jsonb_set(item,'{amount}',to_jsonb(public.fn_normalize_money((item->>'amount')::numeric,'nonnegative'))) ORDER BY ord),'[]'::jsonb)
      INTO p_splits FROM jsonb_array_elements(p_splits) WITH ORDINALITY AS a(item,ord);
    END IF;
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
$function$
;

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
      IF COALESCE(p_type,'expense')<>'expense' OR p_account_id IS NOT NULL THEN
        RAISE EXCEPTION 'Despesa de cartão não pode ser receita ou afetar conta diretamente.';
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

CREATE OR REPLACE FUNCTION public.fn_create_transfer(p_workspace_id uuid, p_from_account_id uuid, p_to_account_id uuid, p_amount numeric, p_transfer_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_user_id UUID;
    v_existing_id UUID;
    v_transfer_id UUID;
    v_first_acc UUID;
    v_second_acc UUID;
    v_clean_key TEXT;
BEGIN
    p_amount := public.fn_normalize_money(p_amount);
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: permissão insuficiente no workspace.';
    END IF;

    -- Verificação de Idempotência: retorna transferência existente sem debitar novamente
    v_clean_key := NULLIF(TRIM(p_idempotency_key), '');
    IF v_clean_key IS NOT NULL THEN
        SELECT id INTO v_existing_id
        FROM public.transfers
        WHERE workspace_id = p_workspace_id AND idempotency_key = v_clean_key;

        IF v_existing_id IS NOT NULL THEN
            RETURN v_existing_id;
        END IF;
    END IF;

    IF p_from_account_id = p_to_account_id THEN
        RAISE EXCEPTION 'A conta de origem e destino devem ser diferentes.';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'O valor da transferência deve ser maior que zero.';
    END IF;

    -- Deadlock prevention por ordenação determinística de IDs
    IF p_from_account_id < p_to_account_id THEN
        v_first_acc := p_from_account_id;
        v_second_acc := p_to_account_id;
    ELSE
        v_first_acc := p_to_account_id;
        v_second_acc := p_from_account_id;
    END IF;

    PERFORM 1 FROM public.accounts WHERE id = v_first_acc AND workspace_id = p_workspace_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Conta % não pertence ao workspace informado.', v_first_acc;
    END IF;

    PERFORM 1 FROM public.accounts WHERE id = v_second_acc AND workspace_id = p_workspace_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Conta % não pertence ao workspace informado.', v_second_acc;
    END IF;

    INSERT INTO public.transfers (
        workspace_id, from_account_id, to_account_id, amount,
        transfer_date, notes, created_by, idempotency_key
    ) VALUES (
        p_workspace_id, p_from_account_id, p_to_account_id, p_amount,
        COALESCE(p_transfer_date, CURRENT_DATE), p_notes, v_user_id, v_clean_key
    ) RETURNING id INTO v_transfer_id;

    UPDATE public.accounts SET current_balance = current_balance - p_amount WHERE id = p_from_account_id;
    UPDATE public.accounts SET current_balance = current_balance + p_amount WHERE id = p_to_account_id;

    RETURN v_transfer_id;
END;
$function$
;

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
    p_amount := public.fn_normalize_money(p_amount);
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
$function$
;

CREATE OR REPLACE FUNCTION public.fn_record_settlement(p_workspace_id uuid, p_from_member_id uuid DEFAULT NULL::uuid, p_to_member_id uuid DEFAULT NULL::uuid, p_amount numeric DEFAULT NULL::numeric, p_settlement_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text, p_payment_account_id uuid DEFAULT NULL::uuid, p_from_person_id uuid DEFAULT NULL::uuid, p_to_person_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    p_amount := public.fn_normalize_money(p_amount);
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
$function$
;

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
    IF p_splits IS NOT NULL THEN
      SELECT COALESCE(jsonb_agg(jsonb_set(item,'{amount}',to_jsonb(public.fn_normalize_money((item->>'amount')::numeric,'nonnegative'))) ORDER BY ord),'[]'::jsonb)
      INTO p_splits FROM jsonb_array_elements(p_splits) WITH ORDINALITY AS a(item,ord);
    END IF;
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
$function$
;

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
    IF p_splits IS NOT NULL THEN
      SELECT COALESCE(jsonb_agg(jsonb_set(item,'{amount}',to_jsonb(public.fn_normalize_money((item->>'amount')::numeric,'nonnegative'))) ORDER BY ord),'[]'::jsonb)
      INTO p_splits FROM jsonb_array_elements(p_splits) WITH ORDINALITY AS a(item,ord);
    END IF;
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
$function$
;

CREATE OR REPLACE FUNCTION public.fn_update_payment(p_workspace_id uuid, p_payment_id uuid, p_account_id uuid DEFAULT NULL::uuid, p_amount numeric DEFAULT NULL::numeric, p_payment_date date DEFAULT NULL::date, p_payment_method_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_affects_balance boolean DEFAULT NULL::boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    IF p_amount IS NOT NULL THEN p_amount := public.fn_normalize_money(p_amount); END IF;
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
$function$
;

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
    IF p_total_amount IS NOT NULL THEN p_total_amount := public.fn_normalize_money(p_total_amount); END IF;
    IF p_splits IS NOT NULL THEN
      SELECT COALESCE(jsonb_agg(jsonb_set(item,'{amount}',to_jsonb(public.fn_normalize_money((item->>'amount')::numeric,'nonnegative'))) ORDER BY ord),'[]'::jsonb)
      INTO p_splits FROM jsonb_array_elements(p_splits) WITH ORDINALITY AS a(item,ord);
    END IF;
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
$function$
;

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
    IF p_amount IS NOT NULL THEN p_amount := public.fn_normalize_money(p_amount); END IF;
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

    SELECT * INTO v_old_tx
    FROM public.transactions
    WHERE id = p_transaction_id AND workspace_id = p_workspace_id
    FOR UPDATE;

    IF v_old_tx.id IS NULL THEN
        RAISE EXCEPTION 'Transação não encontrada no workspace informado.';
    END IF;

    -- Alterar vínculo de cartão exige rebilling, que esta edição não oferece.
    IF (p_credit_card_id IS NOT NULL AND p_credit_card_id IS DISTINCT FROM v_old_tx.credit_card_id)
      OR (p_credit_card_bill_id IS NOT NULL AND p_credit_card_bill_id IS DISTINCT FROM v_old_tx.credit_card_bill_id)
      OR (v_old_tx.credit_card_id IS NOT NULL AND p_type IS NOT NULL AND p_type<>'expense') THEN
      RAISE EXCEPTION 'Não é permitido alterar o vínculo de cartão/fatura desta transação.';
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
$function$
;

CREATE OR REPLACE FUNCTION public.fn_update_transfer(p_workspace_id uuid, p_transfer_id uuid, p_from_account_id uuid DEFAULT NULL::uuid, p_to_account_id uuid DEFAULT NULL::uuid, p_amount numeric DEFAULT NULL::numeric, p_transfer_date date DEFAULT NULL::date, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_user_id UUID;
    v_old_transfer RECORD;
    v_new_amount NUMERIC(12, 2);
    v_new_from_account_id UUID;
    v_new_to_account_id UUID;
    v_new_date DATE;
BEGIN
    IF p_amount IS NOT NULL THEN p_amount := public.fn_normalize_money(p_amount); END IF;
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
$function$
;


-- Reparo conservador do defeito anterior: despesas sem fatura e totais com itens.
-- Não reinterpreta pagamentos avulsos nem muda saldos; casos ambíguos abortam.
DO $$
DECLARE v_orphan record; b record; month_date date; bill uuid; item_total numeric;
BEGIN
  IF EXISTS(SELECT 1 FROM public.transactions t WHERE t.credit_card_id IS NOT NULL AND t.credit_card_bill_id IS NULL
      AND (t.type<>'expense' OR t.status IN ('paid','partially_paid','cancelled') OR EXISTS(SELECT 1 FROM public.payments p WHERE p.transaction_id=t.id))) THEN
    RAISE EXCEPTION 'Transações de cartão órfãs com histórico ambíguo requerem revisão manual.';
  END IF;
  FOR v_orphan IN SELECT t.*,c.closing_day,c.active AS card_active FROM public.transactions t JOIN public.credit_cards c ON c.id=t.credit_card_id
    WHERE t.credit_card_bill_id IS NULL LOOP
    IF NOT v_orphan.card_active THEN RAISE EXCEPTION 'Transação órfã de cartão inativo requer revisão manual.'; END IF;
    month_date := date_trunc('month',v_orphan.transaction_date)::date;
    IF extract(day FROM v_orphan.transaction_date)>LEAST(v_orphan.closing_day,extract(day FROM(month_date+interval '1 month - 1 day'))::int) THEN month_date := (month_date+interval '1 month')::date; END IF;
    bill := public.fn_get_or_create_credit_card_bill(v_orphan.workspace_id,v_orphan.credit_card_id,to_char(month_date,'YYYY-MM'));
    UPDATE public.transactions SET credit_card_bill_id=bill,due_date=(SELECT due_date FROM public.credit_card_bills WHERE id=bill) WHERE id=v_orphan.id;
  END LOOP;
  FOR b IN SELECT * FROM public.credit_card_bills FOR UPDATE LOOP
    SELECT COALESCE(sum(amount),0) INTO item_total FROM (
      SELECT amount FROM public.transactions WHERE credit_card_bill_id=b.id AND status<>'cancelled'
      UNION ALL SELECT amount FROM public.installments WHERE credit_card_bill_id=b.id AND status<>'cancelled'
    ) items;
    IF b.paid_amount>item_total THEN RAISE EXCEPTION 'Fatura com pagamentos acima dos itens requer revisão manual.'; END IF;
    IF b.total_amount<>item_total THEN
      IF item_total=0 AND b.total_amount>0 THEN RAISE EXCEPTION 'Fatura sem itens requer revisão manual.'; END IF;
      UPDATE public.credit_card_bills SET total_amount=item_total,
        status=CASE WHEN item_total>0 AND paid_amount>=item_total THEN 'paid' WHEN paid_amount>0 THEN 'partially_paid' ELSE 'open' END,
        paid_at=CASE WHEN item_total>0 AND paid_amount>=item_total THEN paid_at ELSE NULL END WHERE id=b.id;
    END IF;
  END LOOP;
END; $$;
