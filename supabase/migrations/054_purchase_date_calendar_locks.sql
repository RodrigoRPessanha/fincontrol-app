-- Freeze card settings while deriving the calendar and validate the actual target
-- bill dates after locking all referenced bills, including date-only corrections.
DO $$ DECLARE definition text; needle text; replacement text; BEGIN
 SELECT pg_get_functiondef('public.fn_reschedule_purchase_date(uuid,uuid,date,integer,jsonb)'::regprocedure) INTO definition;
 needle:=' PERFORM 1 FROM public.installments WHERE purchase_id=pur.id ORDER BY id FOR UPDATE;';
 replacement:=E' PERFORM 1 FROM public.credit_cards WHERE id=pur.credit_card_id AND workspace_id=p_workspace_id FOR SHARE;\n'||needle;
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected purchase-date lock definition'; END IF;
 definition:=replace(definition,needle,replacement);
 needle:=' PERFORM 1 FROM public.credit_card_bills WHERE workspace_id=p_workspace_id AND id=ANY(bill_ids) ORDER BY id FOR UPDATE;';
 replacement:=E' PERFORM 1 FROM public.credit_card_bills WHERE workspace_id=p_workspace_id AND id IN (SELECT id FROM jsonb_to_recordset(moves) AS m(old_bill uuid,new_bill uuid),LATERAL unnest(ARRAY[m.old_bill,m.new_bill]) id WHERE id IS NOT NULL) ORDER BY id FOR UPDATE;\n IF EXISTS(SELECT 1 FROM jsonb_to_recordset(moves) AS m(new_bill uuid,due_date date) JOIN public.credit_card_bills b ON b.id=m.new_bill AND b.workspace_id=p_workspace_id WHERE b.due_date IS DISTINCT FROM m.due_date) THEN\n  RAISE EXCEPTION ''As faturas foram alteradas. Atualize os dados e confira a prévia.'' USING ERRCODE=''PT409'';\n END IF;';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected purchase-date bill lock definition'; END IF;
 definition:=replace(definition,needle,replacement);
 EXECUTE definition;
END $$;
