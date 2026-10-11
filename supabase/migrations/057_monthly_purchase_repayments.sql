-- Atomic confirmation of installment repayments through a selected competence month.
CREATE FUNCTION public.fn_monthly_repayment_plan(p_workspace_id uuid,p_month text,p_participant_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE cutoff date; result jsonb;
BEGIN
 IF p_month IS NULL OR p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'Selecione um mês válido.' USING ERRCODE='23514'; END IF;
 cutoff:=(to_date(p_month||'-01','YYYY-MM-DD')+interval '1 month')::date;
 IF NOT EXISTS(SELECT 1 FROM public.people WHERE id=p_participant_id AND workspace_id=p_workspace_id)
 AND NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE id=p_participant_id AND workspace_id=p_workspace_id) THEN
   RAISE EXCEPTION 'Participante não encontrado no workspace.' USING ERRCODE='23514';
 END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('purchase_id',id,'expected_version',repayment_version,'previous_count',previous_count,'count',target_count) ORDER BY id),'[]'::jsonb)
 INTO result FROM (
   SELECT p.id,p.repayment_version,s.repaid_installments_count AS previous_count,
   (SELECT COALESCE(max(i.installment_number),0) FROM public.installments i WHERE i.purchase_id=p.id AND i.due_date<cutoff) AS target_count
   FROM public.purchases p JOIN public.purchase_splits s ON s.purchase_id=p.id
   WHERE p.workspace_id=p_workspace_id AND p.split_type<>'individual' AND COALESCE(s.person_id,s.member_id)=p_participant_id
   AND COALESCE(p.paid_by_person_id,p.paid_by_member_id) IS DISTINCT FROM p_participant_id
 ) candidates WHERE target_count>previous_count;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.fn_monthly_repayment_plan(uuid,text,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.fn_mark_monthly_repayments(p_workspace_id uuid,p_month text,p_participant_id uuid,p_expected jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE plan jsonb; item record; counts jsonb; cutoff date;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_workspace_role(p_workspace_id,ARRAY['owner','admin','member']) THEN RAISE EXCEPTION 'Sem permissão para registrar repasses.' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id FOR UPDATE;
 PERFORM pg_advisory_xact_lock(hashtext('workspace_debt:'||p_workspace_id::text));
 PERFORM 1 FROM public.purchases WHERE workspace_id=p_workspace_id ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.installments WHERE purchase_id IN (SELECT id FROM public.purchases WHERE workspace_id=p_workspace_id) ORDER BY id FOR UPDATE;
 plan:=public.fn_monthly_repayment_plan(p_workspace_id,p_month,p_participant_id);
 IF p_expected IS DISTINCT FROM plan THEN RAISE EXCEPTION 'As compras ou os repasses foram alterados. Atualize os dados e confira a prévia.' USING ERRCODE='PT409'; END IF;
 cutoff:=(to_date(p_month||'-01','YYYY-MM-DD')+interval '1 month')::date;
 FOR item IN SELECT * FROM jsonb_to_recordset(plan) x(purchase_id uuid,expected_version integer,count integer) LOOP
   IF EXISTS(SELECT 1 FROM public.installments WHERE purchase_id=item.purchase_id AND installment_number<=item.count AND due_date>=cutoff) THEN RAISE EXCEPTION 'Confira a ordem dos vencimentos antes de marcar os repasses.' USING ERRCODE='23514'; END IF;
   SELECT jsonb_agg(jsonb_build_object('participant_id',COALESCE(s.person_id,s.member_id),'count',CASE WHEN COALESCE(s.person_id,s.member_id)=p_participant_id THEN item.count ELSE s.repaid_installments_count END) ORDER BY COALESCE(s.person_id,s.member_id))
   INTO counts FROM public.purchase_splits s JOIN public.purchases p ON p.id=s.purchase_id WHERE p.id=item.purchase_id
   AND COALESCE(s.person_id,s.member_id) IS DISTINCT FROM COALESCE(p.paid_by_person_id,p.paid_by_member_id);
   PERFORM public.fn_set_purchase_repayments(p_workspace_id,item.purchase_id,counts,item.expected_version);
 END LOOP;
 RETURN jsonb_array_length(plan);
END $$;
REVOKE ALL ON FUNCTION public.fn_mark_monthly_repayments(uuid,text,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_mark_monthly_repayments(uuid,text,uuid,jsonb) TO authenticated;
