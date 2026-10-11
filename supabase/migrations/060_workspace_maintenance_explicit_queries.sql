-- Use explicit statements for every ledger/catalog: easier to audit and lint.
CREATE OR REPLACE FUNCTION public.fn_maintain_workspace(p_workspace_id uuid, p_action text, p_confirmation_name text, p_expected_fingerprint text, p_operation_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE ws public.workspaces; preview jsonb; previous public.workspace_maintenance_operations;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão não autenticada.' USING ERRCODE='42501'; END IF;
 IF p_action IS NULL OR p_action NOT IN('clear','delete') OR p_operation_key IS NULL OR length(p_operation_key) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Operação ou identificação da tentativa inválida.' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('workspace_maintenance_owner:'||auth.uid()::text));
 SELECT * INTO previous FROM public.workspace_maintenance_operations WHERE owner_id=auth.uid() AND operation_key=p_operation_key;
 IF previous.operation_key IS NOT NULL THEN
  IF (previous.workspace_id,previous.action,previous.confirmation_name,previous.expected_fingerprint) IS DISTINCT FROM (p_workspace_id,p_action,p_confirmation_name,p_expected_fingerprint) THEN RAISE EXCEPTION 'Tentativa reutilizada com dados diferentes.' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('replayed',true);
 END IF;
 SELECT * INTO ws FROM public.workspaces WHERE id=p_workspace_id;
 IF ws.id IS NULL OR ws.owner_id IS DISTINCT FROM auth.uid() OR NOT public.has_workspace_role(p_workspace_id,ARRAY['owner']) THEN RAISE EXCEPTION 'Somente o proprietário pode limpar ou excluir este workspace.' USING ERRCODE='42501'; END IF;
 -- Recurring workers lock recurrence rows before referencing a workspace. Match that
 -- order, using NO KEY UPDATE so ordinary FK key-share checks can finish.
 PERFORM 1 FROM public.recurring_transactions WHERE workspace_id=p_workspace_id ORDER BY id FOR NO KEY UPDATE;
 SELECT * INTO ws FROM public.workspaces WHERE id=p_workspace_id FOR UPDATE;
 IF ws.id IS NULL THEN RAISE EXCEPTION 'Workspace não encontrado.' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('workspace_debt:'||p_workspace_id::text));
 PERFORM 1 FROM public.accounts r WHERE workspace_id=p_workspace_id ORDER BY to_jsonb(r)::text FOR NO KEY UPDATE;
 PERFORM 1 FROM public.credit_cards r WHERE workspace_id=p_workspace_id ORDER BY to_jsonb(r)::text FOR NO KEY UPDATE;
 PERFORM 1 FROM public.payment_methods r WHERE workspace_id=p_workspace_id ORDER BY to_jsonb(r)::text FOR NO KEY UPDATE;
 PERFORM 1 FROM public.categories r WHERE workspace_id=p_workspace_id ORDER BY to_jsonb(r)::text FOR NO KEY UPDATE;
 PERFORM 1 FROM public.people r WHERE workspace_id=p_workspace_id ORDER BY to_jsonb(r)::text FOR NO KEY UPDATE;
 PERFORM 1 FROM public.workspace_members r WHERE workspace_id=p_workspace_id ORDER BY to_jsonb(r)::text FOR NO KEY UPDATE;
 PERFORM 1 FROM public.transactions r WHERE workspace_id=p_workspace_id ORDER BY to_jsonb(r)::text FOR NO KEY UPDATE;
 PERFORM 1 FROM public.transaction_splits r WHERE workspace_id=p_workspace_id ORDER BY to_jsonb(r)::text FOR NO KEY UPDATE;
 PERFORM 1 FROM public.purchases r WHERE workspace_id=p_workspace_id ORDER BY to_jsonb(r)::text FOR NO KEY UPDATE;
 PERFORM 1 FROM public.purchase_splits r WHERE workspace_id=p_workspace_id ORDER BY to_jsonb(r)::text FOR NO KEY UPDATE;
 PERFORM 1 FROM public.payments r WHERE workspace_id=p_workspace_id ORDER BY to_jsonb(r)::text FOR NO KEY UPDATE;
 PERFORM 1 FROM public.transfers r WHERE workspace_id=p_workspace_id ORDER BY to_jsonb(r)::text FOR NO KEY UPDATE;
 PERFORM 1 FROM public.budgets r WHERE workspace_id=p_workspace_id ORDER BY to_jsonb(r)::text FOR NO KEY UPDATE;
 PERFORM 1 FROM public.financial_goals r WHERE workspace_id=p_workspace_id ORDER BY to_jsonb(r)::text FOR NO KEY UPDATE;
 PERFORM 1 FROM public.goal_deposits r WHERE workspace_id=p_workspace_id ORDER BY to_jsonb(r)::text FOR NO KEY UPDATE;
 PERFORM 1 FROM public.credit_card_bills r WHERE workspace_id=p_workspace_id ORDER BY to_jsonb(r)::text FOR NO KEY UPDATE;
 PERFORM 1 FROM public.financial_operations r WHERE workspace_id=p_workspace_id ORDER BY to_jsonb(r)::text FOR NO KEY UPDATE;
 PERFORM 1 FROM public.installments i JOIN public.purchases p ON p.id=i.purchase_id WHERE p.workspace_id=p_workspace_id ORDER BY i.id FOR NO KEY UPDATE OF i;
 preview:=public.fn_workspace_maintenance_snapshot(p_workspace_id);
 IF p_confirmation_name IS DISTINCT FROM ws.name THEN RAISE EXCEPTION 'Digite o nome exato do workspace para confirmar.' USING ERRCODE='23514'; END IF;
 IF p_expected_fingerprint IS DISTINCT FROM preview->>'fingerprint' THEN RAISE EXCEPTION 'Os dados do workspace mudaram. Atualize a prévia antes de confirmar.' USING ERRCODE='PT409'; END IF;
 IF p_action='delete' AND NOT (preview->>'can_delete')::boolean THEN RAISE EXCEPTION 'Crie outro workspace seu antes de excluir este, ou use Limpar lançamentos.' USING ERRCODE='23514'; END IF;

 DELETE FROM public.payments WHERE workspace_id=p_workspace_id;
 DELETE FROM public.goal_deposits WHERE workspace_id=p_workspace_id;
 DELETE FROM public.settlements WHERE workspace_id=p_workspace_id;
 DELETE FROM public.transfers WHERE workspace_id=p_workspace_id;
 UPDATE public.purchase_splits SET repaid_installments_count=0,repaid_amount=0 WHERE workspace_id=p_workspace_id;
 DELETE FROM public.purchases WHERE workspace_id=p_workspace_id;
 DELETE FROM public.transactions WHERE workspace_id=p_workspace_id;
 DELETE FROM public.credit_card_bills WHERE workspace_id=p_workspace_id;
 DELETE FROM public.recurring_transactions WHERE workspace_id=p_workspace_id;
 DELETE FROM public.budgets WHERE workspace_id=p_workspace_id;
 DELETE FROM public.financial_goals WHERE workspace_id=p_workspace_id;
 IF p_action='delete' THEN
  DELETE FROM public.workspaces WHERE id=p_workspace_id;
 ELSE
  UPDATE public.accounts SET current_balance=initial_balance WHERE workspace_id=p_workspace_id;
  -- Keep only technical tombstones so old financial attempts cannot recreate wiped
  -- data. The original financial descriptions/amounts are removed from the payload.
  UPDATE public.financial_operations SET payload=jsonb_build_object('cleared',true) WHERE workspace_id=p_workspace_id;
 END IF;
 INSERT INTO public.workspace_maintenance_operations(owner_id,operation_key,workspace_id,action,confirmation_name,expected_fingerprint)
 VALUES(auth.uid(),p_operation_key,p_workspace_id,p_action,p_confirmation_name,p_expected_fingerprint);
 RETURN jsonb_build_object('replayed',false);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_workspace_maintenance_snapshot(p_workspace_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE ws public.workspaces; snapshot jsonb; rows jsonb; other_ids jsonb;
BEGIN
 SELECT * INTO ws FROM public.workspaces WHERE id=p_workspace_id;
 IF ws.id IS NULL THEN RAISE EXCEPTION 'Workspace não encontrado.' USING ERRCODE='23514'; END IF;
 snapshot:=jsonb_build_object('workspace',to_jsonb(ws));
 SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) INTO rows FROM public.accounts r WHERE workspace_id=p_workspace_id;
 snapshot:=snapshot||jsonb_build_object('accounts',rows);
 SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) INTO rows FROM public.credit_cards r WHERE workspace_id=p_workspace_id;
 snapshot:=snapshot||jsonb_build_object('credit_cards',rows);
 SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) INTO rows FROM public.payment_methods r WHERE workspace_id=p_workspace_id;
 snapshot:=snapshot||jsonb_build_object('payment_methods',rows);
 SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) INTO rows FROM public.categories r WHERE workspace_id=p_workspace_id;
 snapshot:=snapshot||jsonb_build_object('categories',rows);
 SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) INTO rows FROM public.people r WHERE workspace_id=p_workspace_id;
 snapshot:=snapshot||jsonb_build_object('people',rows);
 SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) INTO rows FROM public.workspace_members r WHERE workspace_id=p_workspace_id;
 snapshot:=snapshot||jsonb_build_object('workspace_members',rows);
 SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) INTO rows FROM public.transactions r WHERE workspace_id=p_workspace_id;
 snapshot:=snapshot||jsonb_build_object('transactions',rows);
 SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) INTO rows FROM public.transaction_splits r WHERE workspace_id=p_workspace_id;
 snapshot:=snapshot||jsonb_build_object('transaction_splits',rows);
 SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) INTO rows FROM public.purchases r WHERE workspace_id=p_workspace_id;
 snapshot:=snapshot||jsonb_build_object('purchases',rows);
 SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) INTO rows FROM public.purchase_splits r WHERE workspace_id=p_workspace_id;
 snapshot:=snapshot||jsonb_build_object('purchase_splits',rows);
 SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) INTO rows FROM public.payments r WHERE workspace_id=p_workspace_id;
 snapshot:=snapshot||jsonb_build_object('payments',rows);
 SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) INTO rows FROM public.transfers r WHERE workspace_id=p_workspace_id;
 snapshot:=snapshot||jsonb_build_object('transfers',rows);
 SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) INTO rows FROM public.recurring_transactions r WHERE workspace_id=p_workspace_id;
 snapshot:=snapshot||jsonb_build_object('recurring_transactions',rows);
 SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) INTO rows FROM public.budgets r WHERE workspace_id=p_workspace_id;
 snapshot:=snapshot||jsonb_build_object('budgets',rows);
 SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) INTO rows FROM public.financial_goals r WHERE workspace_id=p_workspace_id;
 snapshot:=snapshot||jsonb_build_object('financial_goals',rows);
 SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) INTO rows FROM public.goal_deposits r WHERE workspace_id=p_workspace_id;
 snapshot:=snapshot||jsonb_build_object('goal_deposits',rows);
 SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) INTO rows FROM public.credit_card_bills r WHERE workspace_id=p_workspace_id;
 snapshot:=snapshot||jsonb_build_object('credit_card_bills',rows);
 SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) INTO rows FROM public.financial_operations r WHERE workspace_id=p_workspace_id;
 snapshot:=snapshot||jsonb_build_object('financial_operations',rows);
 SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.id),'[]'::jsonb) INTO rows FROM public.installments i JOIN public.purchases p ON p.id=i.purchase_id WHERE p.workspace_id=p_workspace_id;
 snapshot:=snapshot||jsonb_build_object('installments',rows);
 SELECT COALESCE(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO other_ids FROM public.workspaces w WHERE w.owner_id=ws.owner_id AND w.id<>ws.id AND EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=w.id AND m.user_id=ws.owner_id AND m.role='owner');
 snapshot:=snapshot||jsonb_build_object('other_owned_workspaces',other_ids);
 RETURN jsonb_build_object('workspace_id',ws.id,'name',ws.name,'fingerprint',md5(snapshot::text),'can_delete',jsonb_array_length(other_ids)>0,
  'counts',jsonb_build_object('transactions',jsonb_array_length(snapshot->'transactions'),'purchases',jsonb_array_length(snapshot->'purchases'),'installments',jsonb_array_length(snapshot->'installments'),
   'payments',jsonb_array_length(snapshot->'payments'),'transfers',jsonb_array_length(snapshot->'transfers'),'settlements',jsonb_array_length(snapshot->'settlements'),
   'bills',jsonb_array_length(snapshot->'credit_card_bills'),'recurring',jsonb_array_length(snapshot->'recurring_transactions'),'budgets',jsonb_array_length(snapshot->'budgets'),'goals',jsonb_array_length(snapshot->'financial_goals'),'goal_deposits',jsonb_array_length(snapshot->'goal_deposits')),
  'retained',jsonb_build_object('accounts',jsonb_array_length(snapshot->'accounts'),'cards',jsonb_array_length(snapshot->'credit_cards'),'methods',jsonb_array_length(snapshot->'payment_methods'),
   'categories',jsonb_array_length(snapshot->'categories'),'people',jsonb_array_length(snapshot->'people'),'members',jsonb_array_length(snapshot->'workspace_members')),
  'initial_balance_total',(SELECT COALESCE(sum(initial_balance),0) FROM public.accounts WHERE workspace_id=ws.id));
END $function$;

REVOKE ALL ON FUNCTION public.fn_workspace_maintenance_snapshot(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.fn_maintain_workspace(uuid,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_maintain_workspace(uuid,text,text,text,text) TO authenticated;
