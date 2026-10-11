-- An inaccessible ownership row must not bypass the last-owned-workspace guard.
DO $$ DECLARE definition text; old_query text; new_query text; BEGIN
 SELECT pg_get_functiondef('public.fn_workspace_maintenance_snapshot(uuid)'::regprocedure) INTO definition;
 old_query:='FROM public.workspaces WHERE owner_id=ws.owner_id AND id<>ws.id;';
 new_query:='FROM public.workspaces w WHERE w.owner_id=ws.owner_id AND w.id<>ws.id AND EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=w.id AND m.user_id=ws.owner_id AND m.role=''owner'');';
 IF position(old_query IN definition)=0 THEN RAISE EXCEPTION 'Unexpected workspace snapshot ownership query'; END IF;
 EXECUTE replace(definition,old_query,new_query);
END $$;
