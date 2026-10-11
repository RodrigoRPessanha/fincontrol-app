-- Owner-only workspace maintenance with stale-preview detection and durable retry receipts.
CREATE TABLE public.workspace_maintenance_operations (
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 operation_key text NOT NULL CHECK(length(operation_key) BETWEEN 1 AND 200),
 workspace_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN('clear','delete')),
 confirmation_name text NOT NULL,
 expected_fingerprint text NOT NULL,
 completed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,operation_key)
);
-- No workspace FK: receipts must survive deletion to make a lost-response retry safe.
ALTER TABLE public.workspace_maintenance_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_maintenance_operations FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.workspace_maintenance_operations TO service_role;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='backup_reader') THEN GRANT SELECT ON public.workspace_maintenance_operations TO backup_reader; END IF;
END $$;

CREATE FUNCTION public.fn_workspace_maintenance_snapshot(p_workspace_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE ws public.workspaces; snapshot jsonb; rows jsonb; table_name text; other_ids jsonb;
BEGIN
 SELECT * INTO ws FROM public.workspaces WHERE id=p_workspace_id;
 IF ws.id IS NULL THEN RAISE EXCEPTION 'Workspace não encontrado.' USING ERRCODE='23514'; END IF;
 snapshot:=jsonb_build_object('workspace',to_jsonb(ws));
 FOREACH table_name IN ARRAY ARRAY['accounts','credit_cards','payment_methods','categories','people','workspace_members','transactions','transaction_splits','purchases','purchase_splits','payments','transfers','recurring_transactions','budgets','financial_goals','goal_deposits','credit_card_bills','financial_operations'] LOOP
  EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),''[]''::jsonb) FROM public.%I r WHERE workspace_id=$1',table_name) INTO rows USING p_workspace_id;
  snapshot:=snapshot||jsonb_build_object(table_name,rows);
 END LOOP;
 SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.id),'[]'::jsonb) INTO rows FROM public.installments i JOIN public.purchases p ON p.id=i.purchase_id WHERE p.workspace_id=p_workspace_id;
 snapshot:=snapshot||jsonb_build_object('installments',rows);
 SELECT COALESCE(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO other_ids FROM public.workspaces WHERE owner_id=ws.owner_id AND id<>ws.id;
 snapshot:=snapshot||jsonb_build_object('other_owned_workspaces',other_ids);
 RETURN jsonb_build_object('workspace_id',ws.id,'name',ws.name,'fingerprint',md5(snapshot::text),'can_delete',jsonb_array_length(other_ids)>0,
  'counts',jsonb_build_object('transactions',jsonb_array_length(snapshot->'transactions'),'purchases',jsonb_array_length(snapshot->'purchases'),'installments',jsonb_array_length(snapshot->'installments'),
   'payments',jsonb_array_length(snapshot->'payments'),'transfers',jsonb_array_length(snapshot->'transfers'),'settlements',jsonb_array_length(snapshot->'settlements'),
   'bills',jsonb_array_length(snapshot->'credit_card_bills'),'recurring',jsonb_array_length(snapshot->'recurring_transactions'),'budgets',jsonb_array_length(snapshot->'budgets'),'goals',jsonb_array_length(snapshot->'financial_goals'),'goal_deposits',jsonb_array_length(snapshot->'goal_deposits')),
  'retained',jsonb_build_object('accounts',jsonb_array_length(snapshot->'accounts'),'cards',jsonb_array_length(snapshot->'credit_cards'),'methods',jsonb_array_length(snapshot->'payment_methods'),
   'categories',jsonb_array_length(snapshot->'categories'),'people',jsonb_array_length(snapshot->'people'),'members',jsonb_array_length(snapshot->'workspace_members')),
  'initial_balance_total',(SELECT COALESCE(sum(initial_balance),0) FROM public.accounts WHERE workspace_id=ws.id));
END $$;
REVOKE ALL ON FUNCTION public.fn_workspace_maintenance_snapshot(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.fn_preview_workspace_maintenance(p_workspace_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id=p_workspace_id AND owner_id=auth.uid()) OR
 NOT public.has_workspace_role(p_workspace_id,ARRAY['owner']) THEN RAISE EXCEPTION 'Somente o proprietário pode limpar ou excluir este workspace.' USING ERRCODE='42501'; END IF;
 RETURN public.fn_workspace_maintenance_snapshot(p_workspace_id);
END $$;
REVOKE ALL ON FUNCTION public.fn_preview_workspace_maintenance(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_preview_workspace_maintenance(uuid) TO authenticated;

CREATE FUNCTION public.fn_maintain_workspace(p_workspace_id uuid,p_action text,p_confirmation_name text,p_expected_fingerprint text,p_operation_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ws public.workspaces; preview jsonb; previous public.workspace_maintenance_operations; table_name text;
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
 FOREACH table_name IN ARRAY ARRAY['accounts','credit_cards','payment_methods','categories','people','workspace_members','transactions','transaction_splits','purchases','purchase_splits','payments','transfers','recurring_transactions','budgets','financial_goals','goal_deposits','credit_card_bills','financial_operations'] LOOP
  IF table_name<>'recurring_transactions' THEN
   EXECUTE format('SELECT 1 FROM public.%I r WHERE workspace_id=$1 ORDER BY to_jsonb(r)::text FOR NO KEY UPDATE',table_name) USING p_workspace_id;
  END IF;
 END LOOP;
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
END $$;
REVOKE ALL ON FUNCTION public.fn_maintain_workspace(uuid,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_maintain_workspace(uuid,text,text,text,text) TO authenticated;
REVOKE DELETE ON public.workspaces FROM authenticated;

DO $$ BEGIN
 IF has_table_privilege('authenticated','public.workspaces','DELETE') THEN RAISE EXCEPTION 'Direct workspace deletion privilege remains active'; END IF;
END $$;
