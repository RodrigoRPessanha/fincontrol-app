-- Include settlement history in both the confirmed snapshot and the row-lock set.
DO $$ DECLARE definition text; marker text; addition text; BEGIN
 SELECT pg_get_functiondef('public.fn_workspace_maintenance_snapshot(uuid)'::regprocedure) INTO definition;
 marker:=' SELECT COALESCE(jsonb_agg(to_jsonb(i)';
 addition:=$patch$ SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) INTO rows FROM public.settlements r WHERE workspace_id=p_workspace_id;
 snapshot:=snapshot||jsonb_build_object('settlements',rows);
$patch$;
 IF position(marker IN definition)=0 THEN RAISE EXCEPTION 'Unexpected workspace snapshot installment query'; END IF;
 EXECUTE replace(definition,marker,addition||marker);
 SELECT pg_get_functiondef('public.fn_maintain_workspace(uuid,text,text,text,text)'::regprocedure) INTO definition;
 marker:=' PERFORM 1 FROM public.installments i';
 addition:=' PERFORM 1 FROM public.settlements r WHERE workspace_id=p_workspace_id ORDER BY to_jsonb(r)::text FOR NO KEY UPDATE;';
 IF position(marker IN definition)=0 THEN RAISE EXCEPTION 'Unexpected maintenance installment lock'; END IF;
 EXECUTE replace(definition,marker,addition||chr(10)||marker);
END $$;
REVOKE ALL ON FUNCTION public.fn_workspace_maintenance_snapshot(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.fn_maintain_workspace(uuid,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_maintain_workspace(uuid,text,text,text,text) TO authenticated;
