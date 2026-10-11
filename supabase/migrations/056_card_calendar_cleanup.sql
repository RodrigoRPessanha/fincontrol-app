-- Remove the obsolete fixed-calendar variable from the date correction preview.
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.fn_purchase_date_schedule(uuid,date)'::regprocedure) INTO definition;
 IF position('cycle date; due_month date; closing date' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected purchase schedule declaration'; END IF;
 EXECUTE replace(definition,'cycle date; due_month date; closing date','cycle date; closing date');
END $$;
