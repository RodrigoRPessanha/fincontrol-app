-- Historical repayments are distinct from bank/card payments and manual settlements.
ALTER TABLE public.purchase_splits
  ADD COLUMN repaid_installments_count integer NOT NULL DEFAULT 0 CHECK(repaid_installments_count>=0),
  ADD COLUMN repaid_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK(repaid_amount>=0 AND repaid_amount<=amount);
ALTER TABLE public.purchases ADD COLUMN repayment_version integer NOT NULL DEFAULT 0;

CREATE FUNCTION public.fn_calculate_purchase_repayments(p_purchase_id uuid)
RETURNS TABLE(split_id uuid,repaid_amount numeric) LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE pur public.purchases; row record; ids uuid[]; shares bigint[]; counts integer[]; totals bigint[];
 remaining numeric; cents numeric; allocations bigint[]; remainders numeric[]; extra integer; idx integer; n integer;
BEGIN
 SELECT * INTO STRICT pur FROM public.purchases WHERE id=p_purchase_id;
 SELECT array_agg(id ORDER BY COALESCE(person_id,member_id)::text),
   array_agg((amount*100)::bigint ORDER BY COALESCE(person_id,member_id)::text),
   array_agg(repaid_installments_count ORDER BY COALESCE(person_id,member_id)::text)
 INTO ids,shares,counts FROM public.purchase_splits WHERE purchase_id=p_purchase_id;
 n:=COALESCE(array_length(ids,1),0);
 IF n=0 THEN RETURN; END IF;
 totals:=array_fill(0::bigint,ARRAY[n]);
 IF EXISTS(SELECT 1 FROM unnest(counts) c WHERE c>pur.installment_count) THEN RAISE EXCEPTION 'Quantidade de parcelas repassadas inválida.'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(counts) c WHERE c>0) THEN
   remaining:=pur.total_amount*100;
   IF (SELECT sum(s) FROM unnest(shares) s)<>remaining OR
     (SELECT count(*) FROM public.installments WHERE purchase_id=p_purchase_id)<>pur.installment_count OR
     (SELECT count(DISTINCT installment_number) FROM public.installments WHERE purchase_id=p_purchase_id)<>pur.installment_count OR
     EXISTS(SELECT 1 FROM public.installments WHERE purchase_id=p_purchase_id AND (status='cancelled' OR amount<=0 OR installment_number NOT BETWEEN 1 AND pur.installment_count)) OR
     (SELECT sum(amount)*100 FROM public.installments WHERE purchase_id=p_purchase_id)<>remaining THEN
     RAISE EXCEPTION 'Confira as parcelas e o rateio antes de registrar repasses.';
   END IF;
   FOR row IN SELECT * FROM public.installments WHERE purchase_id=p_purchase_id ORDER BY installment_number,id LOOP
     cents:=row.amount*100; allocations:=ARRAY[]::bigint[]; remainders:=ARRAY[]::numeric[];
     FOR idx IN 1..n LOOP
       allocations:=array_append(allocations,floor(cents*shares[idx]/remaining)::bigint);
       remainders:=array_append(remainders,mod(cents*shares[idx],remaining));
     END LOOP;
     extra:=cents-(SELECT sum(a) FROM unnest(allocations) a);
     FOR idx IN SELECT i FROM generate_series(1,n) i ORDER BY remainders[i] DESC,i LOOP
       IF extra>0 THEN allocations[idx]:=allocations[idx]+1; extra:=extra-1; END IF;
       shares[idx]:=shares[idx]-allocations[idx];
       IF row.installment_number<=counts[idx] THEN totals[idx]:=totals[idx]+allocations[idx]; END IF;
     END LOOP;
     remaining:=remaining-cents;
   END LOOP;
 END IF;
 FOR idx IN 1..n LOOP split_id:=ids[idx]; repaid_amount:=totals[idx]/100.0; RETURN NEXT; END LOOP;
END; $$;
REVOKE ALL ON FUNCTION public.fn_calculate_purchase_repayments(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.fn_set_purchase_repayments(p_workspace_id uuid,p_purchase_id uuid,p_counts jsonb,p_expected_version integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE pur public.purchases; entry record; payer uuid; seen uuid[]='{}'; participant uuid; count_value integer;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_workspace_role(p_workspace_id,ARRAY['owner','admin','member']) THEN RAISE EXCEPTION 'Sem permissão para ajustar repasses.' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id FOR UPDATE;
 PERFORM pg_advisory_xact_lock(hashtext('workspace_debt:'||p_workspace_id::text));
 SELECT * INTO pur FROM public.purchases WHERE id=p_purchase_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF pur.id IS NULL THEN RAISE EXCEPTION 'Compra não encontrada no workspace.'; END IF;
 IF p_expected_version IS NULL OR pur.repayment_version<>p_expected_version THEN RAISE EXCEPTION 'Os repasses foram alterados. Atualize os dados.' USING ERRCODE='PT409'; END IF;
 IF jsonb_typeof(p_counts) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Lista de repasses inválida.'; END IF;
 payer:=COALESCE(pur.paid_by_person_id,pur.paid_by_member_id,(SELECT id FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=pur.created_by LIMIT 1));
 FOR entry IN SELECT value FROM jsonb_array_elements(p_counts) LOOP
   IF jsonb_typeof(entry.value) IS DISTINCT FROM 'object' OR jsonb_typeof(entry.value->'count') IS DISTINCT FROM 'number' OR (entry.value->>'count') !~ '^(0|[1-9][0-9]*)$' THEN RAISE EXCEPTION 'Quantidade de parcelas repassadas inválida.'; END IF;
   participant:=(entry.value->>'participant_id')::uuid; count_value:=(entry.value->>'count')::integer;
   IF participant IS NULL OR participant=payer OR participant=ANY(seen) OR count_value>pur.installment_count OR NOT EXISTS(
     SELECT 1 FROM public.purchase_splits WHERE purchase_id=pur.id AND COALESCE(person_id,member_id)=participant
   ) THEN RAISE EXCEPTION 'Participante ou quantidade inválidos para o rateio.'; END IF;
   seen:=array_append(seen,participant);
 END LOOP;
 UPDATE public.purchase_splits ps SET repaid_installments_count=COALESCE((SELECT (value->>'count')::integer FROM jsonb_array_elements(p_counts) WHERE (value->>'participant_id')::uuid=COALESCE(ps.person_id,ps.member_id)),0)
 WHERE ps.purchase_id=pur.id;
 UPDATE public.purchase_splits ps SET repaid_amount=calc.repaid_amount FROM public.fn_calculate_purchase_repayments(pur.id) calc WHERE ps.id=calc.split_id;
 UPDATE public.purchases SET repayment_version=repayment_version+1 WHERE id=pur.id;
 RETURN pur.id;
END; $$;
REVOKE ALL ON FUNCTION public.fn_set_purchase_repayments(uuid,uuid,jsonb,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_set_purchase_repayments(uuid,uuid,jsonb,integer) TO authenticated;

-- Any split replacement invalidates an open repayment editor. Preserve repaid history.
CREATE FUNCTION public.fn_guard_purchase_repayment_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   IF OLD.repaid_installments_count>0 AND EXISTS(SELECT 1 FROM public.purchases WHERE id=OLD.purchase_id) THEN RAISE EXCEPTION 'Ajuste os repasses para zero antes de substituir o rateio.'; END IF;
   UPDATE public.purchases SET repayment_version=repayment_version+1 WHERE id=OLD.purchase_id;
   RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND OLD.repaid_installments_count>0 AND (NEW.amount,NEW.member_id,NEW.person_id,NEW.purchase_id) IS DISTINCT FROM (OLD.amount,OLD.member_id,OLD.person_id,OLD.purchase_id) THEN RAISE EXCEPTION 'Rateio com repasses já registrados está protegido.'; END IF;
 UPDATE public.purchases SET repayment_version=repayment_version+1 WHERE id=NEW.purchase_id;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.fn_guard_purchase_repayment_history() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_purchase_repayment_history BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_splits FOR EACH ROW EXECUTE FUNCTION public.fn_guard_purchase_repayment_history();

CREATE FUNCTION public.fn_guard_purchase_repayment_basis() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF (NEW.total_amount,NEW.installment_count,NEW.purchase_date,NEW.credit_card_id,NEW.paid_by_member_id,NEW.paid_by_person_id,NEW.split_type)
 IS DISTINCT FROM (OLD.total_amount,OLD.installment_count,OLD.purchase_date,OLD.credit_card_id,OLD.paid_by_member_id,OLD.paid_by_person_id,OLD.split_type) THEN
   IF EXISTS(SELECT 1 FROM public.purchase_splits WHERE purchase_id=OLD.id AND repaid_installments_count>0) THEN RAISE EXCEPTION 'Ajuste os repasses antes de alterar os dados financeiros da compra.'; END IF;
   NEW.repayment_version:=OLD.repayment_version+1;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.fn_guard_purchase_repayment_basis() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_purchase_repayment_basis BEFORE UPDATE ON public.purchases FOR EACH ROW EXECUTE FUNCTION public.fn_guard_purchase_repayment_basis();

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

    PERFORM public.fn_set_purchase_repayments(p_workspace_id, v_purchase_id,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('participant_id',COALESCE(item->>'person_id',item->>'member_id'),'count',COALESCE(item->'repaid_installments_count','0'::jsonb))),'[]'::jsonb)
       FROM jsonb_array_elements(COALESCE(p_splits,'[]'::jsonb)) item
       WHERE COALESCE(item->>'person_id',item->>'member_id') IS DISTINCT FROM COALESCE(p_paid_by_person_id,p_paid_by_member_id)::text),
      (SELECT repayment_version FROM public.purchases WHERE id=v_purchase_id));
    RETURN v_purchase_id;
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
    PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id FOR UPDATE;
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
    WITH all_settlements AS (
      SELECT workspace_id,from_member_id,from_person_id,to_member_id,to_person_id,amount FROM public.settlements
      UNION ALL
      SELECT ps.workspace_id,ps.member_id,ps.person_id,
        CASE WHEN pur.paid_by_person_id IS NULL THEN COALESCE(pur.paid_by_member_id,(SELECT id FROM public.workspace_members WHERE workspace_id=pur.workspace_id AND user_id=pur.created_by LIMIT 1)) END,
        pur.paid_by_person_id,ps.repaid_amount
      FROM public.purchase_splits ps JOIN public.purchases pur ON pur.id=ps.purchase_id
      WHERE ps.repaid_amount>0
    ), all_participants AS (
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
                FROM all_settlements s
                WHERE s.workspace_id = p_workspace_id
                  AND (s.from_member_id = p.id OR s.from_person_id = p.id)
            ) AS settled_out_cents,
            (
                -- Settled in (recebido em acertos)
                SELECT COALESCE(SUM(ROUND(s.amount * 100)), 0)::BIGINT
                FROM all_settlements s
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

    WITH all_settlements AS (
      SELECT workspace_id,from_member_id,from_person_id,to_member_id,to_person_id,amount FROM public.settlements
      UNION ALL
      SELECT ps.workspace_id,ps.member_id,ps.person_id,
        CASE WHEN pur.paid_by_person_id IS NULL THEN COALESCE(pur.paid_by_member_id,(SELECT id FROM public.workspace_members WHERE workspace_id=pur.workspace_id AND user_id=pur.created_by LIMIT 1)) END,
        pur.paid_by_person_id,ps.repaid_amount
      FROM public.purchase_splits ps JOIN public.purchases pur ON pur.id=ps.purchase_id
      WHERE ps.repaid_amount>0
    ), all_participants AS (
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
                FROM all_settlements s
                WHERE s.workspace_id = p_workspace_id
                  AND (s.from_member_id = p.id OR s.from_person_id = p.id)
            ) AS settled_out_cents,
            (
                SELECT COALESCE(SUM(ROUND(s.amount * 100)), 0)::BIGINT
                FROM all_settlements s
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
