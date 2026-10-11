-- Correct purchase dates atomically, preserving installment/payment/repayment identities.
CREATE FUNCTION public.fn_purchase_date_schedule(p_purchase_id uuid,p_purchase_date date)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
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
   first_cycle:=date_trunc('month',p_purchase_date)::date;
   IF extract(day FROM p_purchase_date)>=card.closing_day THEN first_cycle:=(first_cycle+interval '1 month')::date; END IF;
 END IF;
 FOR inst IN SELECT * FROM public.installments WHERE purchase_id=pur.id ORDER BY installment_number LOOP
   IF (pur.credit_card_id IS NOT NULL AND inst.credit_card_bill_id IS NULL) OR
      (inst.credit_card_bill_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.credit_card_bills WHERE id=inst.credit_card_bill_id AND workspace_id=pur.workspace_id AND credit_card_id=pur.credit_card_id)) THEN RAISE EXCEPTION 'Fatura da parcela não encontrada no workspace.'; END IF;
   reference:=NULL; closing:=NULL; target:=NULL;
   IF pur.credit_card_id IS NULL THEN due:=(p_purchase_date+make_interval(months=>inst.installment_number-1))::date;
   ELSE
     cycle:=(first_cycle+make_interval(months=>inst.installment_number-1))::date; reference:=to_char(cycle,'YYYY-MM');
     closing:=make_date(extract(year FROM cycle)::int,extract(month FROM cycle)::int,least(card.closing_day,extract(day FROM cycle+interval '1 month - 1 day')::int));
     due_month:=CASE WHEN card.due_day<card.closing_day THEN (cycle+interval '1 month')::date ELSE cycle END;
     due:=make_date(extract(year FROM due_month)::int,extract(month FROM due_month)::int,least(card.due_day,extract(day FROM due_month+interval '1 month - 1 day')::int));
     SELECT * INTO target FROM public.credit_card_bills WHERE workspace_id=pur.workspace_id AND credit_card_id=pur.credit_card_id AND reference_month=reference;
     due:=COALESCE(target.due_date,due); closing:=COALESCE(target.closing_date,closing);
   END IF;
   plan:=plan||jsonb_build_array(jsonb_build_object('installment_id',inst.id,'installment_number',inst.installment_number,'old_due_date',inst.due_date,'due_date',due,
     'old_bill_id',inst.credit_card_bill_id,'target_bill_id',target.id,'reference_month',reference,'closing_date',closing,'amount',inst.amount,'paid_amount',inst.paid_amount,'status',inst.status));
 END LOOP;
 RETURN plan;
END $$;
REVOKE ALL ON FUNCTION public.fn_purchase_date_schedule(uuid,date) FROM PUBLIC,anon,authenticated;

-- Date-only corrections preserve repayment amounts. The trigger independently checks
-- the complete calendar, so old update RPCs cannot silently leave stale due dates.
CREATE OR REPLACE FUNCTION public.fn_guard_purchase_repayment_basis() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE plan jsonb;
BEGIN
 IF (NEW.total_amount,NEW.installment_count,NEW.credit_card_id,NEW.paid_by_member_id,NEW.paid_by_person_id,NEW.split_type)
 IS DISTINCT FROM (OLD.total_amount,OLD.installment_count,OLD.credit_card_id,OLD.paid_by_member_id,OLD.paid_by_person_id,OLD.split_type) THEN
   IF EXISTS(SELECT 1 FROM public.purchase_splits WHERE purchase_id=OLD.id AND repaid_installments_count>0) THEN RAISE EXCEPTION 'Ajuste os repasses antes de alterar os dados financeiros da compra.'; END IF;
   NEW.repayment_version:=OLD.repayment_version+1;
 END IF;
 IF NEW.purchase_date IS DISTINCT FROM OLD.purchase_date THEN
   plan:=public.fn_purchase_date_schedule(OLD.id,NEW.purchase_date);
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(plan) item WHERE item->>'old_due_date' IS DISTINCT FROM item->>'due_date' OR item->>'old_bill_id' IS DISTINCT FROM item->>'target_bill_id') THEN
     RAISE EXCEPTION 'Use a correção de data com prévia para recalcular as parcelas.' USING ERRCODE='23514';
   END IF;
   NEW.repayment_version:=OLD.repayment_version+1;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fn_guard_purchase_repayment_basis() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.fn_reschedule_purchase_date(p_workspace_id uuid,p_purchase_id uuid,p_purchase_date date,p_expected_version integer,p_expected_schedule jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE pur public.purchases; plan jsonb; item record; new_bill uuid; moves jsonb='[]'; bill_ids uuid[]; bill public.credit_card_bills;
 new_total numeric; new_paid numeric; amount_delta numeric; paid_delta numeric;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_workspace_role(p_workspace_id,ARRAY['owner','admin','member']) THEN RAISE EXCEPTION 'Sem permissão para corrigir a data da compra.' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id FOR UPDATE;
 PERFORM pg_advisory_xact_lock(hashtext('workspace_debt:'||p_workspace_id::text));
 SELECT * INTO pur FROM public.purchases WHERE id=p_purchase_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF pur.id IS NULL THEN RAISE EXCEPTION 'Compra não encontrada no workspace.'; END IF;
 IF p_expected_version IS NULL OR pur.repayment_version<>p_expected_version THEN RAISE EXCEPTION 'A compra foi alterada. Atualize os dados e confira a prévia.' USING ERRCODE='PT409'; END IF;
 PERFORM 1 FROM public.installments WHERE purchase_id=pur.id ORDER BY id FOR UPDATE;
 plan:=public.fn_purchase_date_schedule(pur.id,p_purchase_date);
 IF p_expected_schedule IS DISTINCT FROM plan THEN RAISE EXCEPTION 'As parcelas ou as faturas foram alteradas. Atualize os dados e confira a prévia.' USING ERRCODE='PT409'; END IF;
 FOR item IN SELECT * FROM jsonb_to_recordset(plan) AS x(installment_id uuid,old_bill_id uuid,target_bill_id uuid,reference_month text,due_date date,amount numeric,paid_amount numeric) LOOP
   new_bill:=item.target_bill_id;
   IF pur.credit_card_id IS NOT NULL AND new_bill IS NULL THEN new_bill:=public.fn_get_or_create_credit_card_bill(p_workspace_id,pur.credit_card_id,item.reference_month); END IF;
   moves:=moves||jsonb_build_array(jsonb_build_object('id',item.installment_id,'old_bill',item.old_bill_id,'new_bill',new_bill,'due_date',item.due_date,'amount',item.amount,'paid',item.paid_amount));
 END LOOP;
 SELECT array_agg(DISTINCT id ORDER BY id) INTO bill_ids FROM jsonb_to_recordset(moves) AS m(old_bill uuid,new_bill uuid),LATERAL unnest(ARRAY[m.old_bill,m.new_bill]) id
 WHERE id IS NOT NULL AND m.old_bill IS DISTINCT FROM m.new_bill;
 PERFORM 1 FROM public.credit_card_bills WHERE workspace_id=p_workspace_id AND id=ANY(bill_ids) ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.credit_card_bills WHERE workspace_id=p_workspace_id AND id=ANY(bill_ids) AND status='cancelled') OR
 EXISTS(SELECT 1 FROM public.payments p WHERE p.workspace_id=p_workspace_id AND (p.credit_card_bill_id=ANY(bill_ids) OR
   EXISTS(SELECT 1 FROM public.installments i WHERE i.id=p.installment_id AND i.credit_card_bill_id=ANY(bill_ids)) OR
   EXISTS(SELECT 1 FROM public.transactions t WHERE t.id=p.transaction_id AND t.credit_card_bill_id=ANY(bill_ids)))) THEN
   RAISE EXCEPTION 'Uma fatura envolvida possui baixa registrada ou está cancelada. Não é possível mover esse histórico para outra fatura.' USING ERRCODE='23514';
 END IF;
 FOR bill IN SELECT * FROM public.credit_card_bills WHERE workspace_id=p_workspace_id AND id=ANY(bill_ids) ORDER BY id LOOP
   SELECT COALESCE(sum((CASE WHEN m.new_bill=bill.id THEN m.amount ELSE 0 END)-(CASE WHEN m.old_bill=bill.id THEN m.amount ELSE 0 END)),0),
     COALESCE(sum((CASE WHEN m.new_bill=bill.id THEN m.paid ELSE 0 END)-(CASE WHEN m.old_bill=bill.id THEN m.paid ELSE 0 END)),0)
   INTO amount_delta,paid_delta FROM jsonb_to_recordset(moves) AS m(old_bill uuid,new_bill uuid,amount numeric,paid numeric);
   new_total:=bill.total_amount+amount_delta;new_paid:=bill.paid_amount+paid_delta;
   IF new_total<0 OR new_paid<0 OR new_paid>new_total THEN RAISE EXCEPTION 'A correção deixaria uma fatura com valores inconsistentes. Confira os pagamentos.' USING ERRCODE='23514'; END IF;
   UPDATE public.credit_card_bills SET total_amount=new_total,paid_amount=new_paid,
     status=CASE WHEN new_total>0 AND new_paid=new_total THEN 'paid' WHEN new_paid>0 THEN 'partially_paid' WHEN due_date<CURRENT_DATE AND new_total>0 THEN 'overdue' ELSE 'open' END,
     paid_at=CASE WHEN new_total>0 AND new_paid=new_total THEN COALESCE(bill.paid_at,(SELECT max(i.paid_at) FROM public.installments i JOIN jsonb_to_recordset(moves) AS m(id uuid,new_bill uuid) ON i.id=m.id WHERE m.new_bill=bill.id),now()) ELSE NULL END,
     updated_at=clock_timestamp() WHERE id=bill.id;
 END LOOP;
 UPDATE public.installments i SET due_date=m.due_date,credit_card_bill_id=m.new_bill,
   status=CASE WHEN i.status IN('pending','overdue') THEN CASE WHEN m.due_date<CURRENT_DATE THEN 'overdue' ELSE 'pending' END ELSE i.status END,
   updated_at=clock_timestamp()
 FROM jsonb_to_recordset(moves) AS m(id uuid,new_bill uuid,due_date date) WHERE i.id=m.id AND i.purchase_id=pur.id;
 UPDATE public.purchases SET purchase_date=p_purchase_date,repayment_version=repayment_version+1,updated_at=clock_timestamp() WHERE id=pur.id;
 RETURN pur.id;
END $$;
REVOKE ALL ON FUNCTION public.fn_reschedule_purchase_date(uuid,uuid,date,integer,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_reschedule_purchase_date(uuid,uuid,date,integer,jsonb) TO authenticated;
