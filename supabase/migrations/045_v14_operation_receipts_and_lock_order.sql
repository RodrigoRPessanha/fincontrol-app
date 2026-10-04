-- A3-01: durable identity of financial creation attempts, payload checked atomically.
CREATE TABLE public.financial_operations (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  operation_kind text NOT NULL,
  operation_key text NOT NULL CHECK (length(operation_key) BETWEEN 1 AND 200),
  payload jsonb NOT NULL,
  result_id uuid NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,operation_kind,operation_key)
);
ALTER TABLE public.financial_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY financial_operations_read ON public.financial_operations FOR SELECT TO authenticated
  USING(created_by=auth.uid() AND public.is_member(workspace_id));
REVOKE ALL ON public.financial_operations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.financial_operations TO authenticated;
GRANT ALL ON public.financial_operations TO service_role;

ALTER TABLE public.payments ADD COLUMN operation_key text;
ALTER TABLE public.purchases ADD COLUMN operation_key text;
ALTER TABLE public.transactions ADD COLUMN operation_key text;
ALTER TABLE public.transfers ADD COLUMN operation_key text;
ALTER TABLE public.settlements ADD COLUMN operation_key text;

CREATE OR REPLACE FUNCTION public.fn_execute_financial_operation(
  p_workspace_id uuid,p_operation_kind text,p_operation_key text,p_payload jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE old public.financial_operations; target_table text; routine oid; argument record; args text[]='{}'; result uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_workspace_role(p_workspace_id,ARRAY['owner','admin','member']) THEN RAISE EXCEPTION 'Acesso negado para operação financeira.'; END IF;
  IF p_operation_key IS NULL OR length(p_operation_key) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Identificação da tentativa inválida.'; END IF;
  IF p_payload IS NULL OR (p_payload->>'p_workspace_id')::uuid IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'Workspace da tentativa inválido.'; END IF;
  target_table := CASE p_operation_kind
    WHEN 'fn_record_payment' THEN 'payments'
    WHEN 'fn_create_purchase_with_splits' THEN 'purchases'
    WHEN 'fn_create_transaction_with_splits' THEN 'transactions'
    WHEN 'fn_create_transfer' THEN 'transfers'
    WHEN 'fn_record_settlement' THEN 'settlements' END;
  IF target_table IS NULL THEN RAISE EXCEPTION 'Tipo de operação não permitido.'; END IF;
  PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id FOR UPDATE;
  SELECT * INTO old FROM public.financial_operations WHERE workspace_id=p_workspace_id AND operation_kind=p_operation_kind AND operation_key=p_operation_key;
  IF old.result_id IS NOT NULL THEN
    IF old.created_by IS DISTINCT FROM auth.uid() OR old.payload<>p_payload THEN RAISE EXCEPTION 'Tentativa reutilizada com identidade ou dados diferentes.'; END IF;
    RETURN old.result_id;
  END IF;
  SELECT p.oid INTO STRICT routine FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname=p_operation_kind;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) AS fields(key)
    WHERE NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=routine AND key=ANY(p.proargnames))) THEN
    RAISE EXCEPTION 'Campo de operação não permitido.';
  END IF;
  FOR argument IN SELECT name,type FROM pg_proc p,
    unnest(p.proargnames,p.proargtypes::oid[]) AS a(name,type) WHERE p.oid=routine LOOP
    IF p_payload ? argument.name THEN
      args := array_append(args,CASE WHEN argument.type='jsonb'::regtype THEN format('%I => ($1->%L)',argument.name,argument.name)
        ELSE format('%I => ($1->>%L)::%s',argument.name,argument.name,format_type(argument.type,NULL)) END);
    END IF;
  END LOOP;
  EXECUTE format('SELECT public.%I(%s)',p_operation_kind,array_to_string(args,',')) INTO result USING p_payload;
  EXECUTE format('UPDATE public.%I SET operation_key=$1 WHERE id=$2 AND workspace_id=$3',target_table) USING p_operation_key,result,p_workspace_id;
  INSERT INTO public.financial_operations(workspace_id,operation_kind,operation_key,payload,result_id,created_by)
    VALUES(p_workspace_id,p_operation_kind,p_operation_key,p_payload,result,auth.uid());
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.fn_execute_financial_operation(uuid,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_execute_financial_operation(uuid,text,text,jsonb) TO authenticated,service_role;

-- A3-05: parent workspace is locked before every existing financial routine's entity locks.
-- A fixed whitelist, expected language/body and explicit authorization protect the rewrite.
DO $$
DECLARE f record; body text; definition text;
BEGIN
  FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('fn_record_payment','fn_update_payment','fn_delete_payment',
      'fn_create_transfer','fn_update_transfer','fn_delete_transfer','fn_create_transaction_with_splits',
      'fn_update_transaction_with_splits','fn_delete_transaction','fn_create_purchase_with_splits',
      'fn_update_purchase_with_splits','fn_delete_purchase','fn_record_settlement','fn_delete_settlement',
      'fn_create_credit_card_transaction','fn_create_installment_purchase','fn_get_or_create_credit_card_bill') LOOP
    definition := pg_get_functiondef(f.oid);
    IF definition !~ E'\nBEGIN\r?\n' THEN RAISE EXCEPTION 'Corpo inesperado: %',f.proname; END IF;
    IF f.proname='fn_delete_settlement' THEN
      body := E'\nBEGIN\n    PERFORM 1 FROM public.workspaces WHERE id=(SELECT workspace_id FROM public.settlements WHERE id=p_settlement_id) FOR UPDATE;\n';
    ELSE
      body := E'\nBEGIN\n    PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id FOR UPDATE;\n';
    END IF;
    EXECUTE regexp_replace(definition,E'\nBEGIN\r?\n',body);
  END LOOP;
END; $$;
