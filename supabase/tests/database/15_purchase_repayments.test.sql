BEGIN;
SELECT plan(20);
CREATE TEMP TABLE repayment_results(msg text);
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at) VALUES('a1500000-0000-0000-0000-000000000001','authenticated','authenticated','qa-repayment@example.test',now());
CREATE TEMP TABLE repayment_vars(name text,id uuid);
INSERT INTO repayment_vars SELECT 'ws',id FROM public.workspaces WHERE owner_id='a1500000-0000-0000-0000-000000000001';
UPDATE public.workspaces SET tracking_mode='expense_tracker' WHERE id=(SELECT id FROM repayment_vars WHERE name='ws');
INSERT INTO repayment_vars SELECT 'member',id FROM public.workspace_members WHERE workspace_id=(SELECT id FROM repayment_vars WHERE name='ws');
WITH p AS(INSERT INTO public.people(workspace_id,name) SELECT id,'QA Repayment Person' FROM repayment_vars WHERE name='ws' RETURNING id) INSERT INTO repayment_vars SELECT 'person',id FROM p;
GRANT ALL ON repayment_vars,repayment_results TO authenticated;
SET LOCAL request.jwt.claim.sub='a1500000-0000-0000-0000-000000000001';
SET LOCAL role='authenticated';
INSERT INTO repayment_vars SELECT 'pur',public.fn_create_purchase_with_splits(
 p_workspace_id=>(SELECT id FROM repayment_vars WHERE name='ws'),p_description=>'600 split',p_total_amount=>600,p_installment_count=>3,p_paid_installments_count=>2,
 p_paid_by_member_id=>(SELECT id FROM repayment_vars WHERE name='member'),p_split_type=>'equal',
 p_splits=>jsonb_build_array(jsonb_build_object('member_id',(SELECT id FROM repayment_vars WHERE name='member'),'amount',300),jsonb_build_object('person_id',(SELECT id FROM repayment_vars WHERE name='person'),'amount',300,'repaid_installments_count',2)));
INSERT INTO repayment_results SELECT is((SELECT repaid_amount FROM public.purchase_splits WHERE purchase_id=(SELECT id FROM repayment_vars WHERE name='pur') AND person_id IS NOT NULL),200::numeric,'Two installments repaid are 200');
INSERT INTO repayment_results SELECT is((SELECT count(*)::int FROM public.payments WHERE workspace_id=(SELECT id FROM repayment_vars WHERE name='ws')),0,'No duplicate card/bank payment from repayment');
INSERT INTO repayment_results SELECT is((SELECT count(*)::int FROM public.settlements WHERE workspace_id=(SELECT id FROM repayment_vars WHERE name='ws')),0,'Manual settlement ledger unchanged');
INSERT INTO repayment_results SELECT lives_ok($q$ SELECT public.fn_set_purchase_repayments((SELECT id FROM repayment_vars WHERE name='ws'),(SELECT id FROM repayment_vars WHERE name='pur'),jsonb_build_array(jsonb_build_object('participant_id',(SELECT id FROM repayment_vars WHERE name='person'),'count',1)),(SELECT repayment_version FROM public.purchases WHERE id=(SELECT id FROM repayment_vars WHERE name='pur'))) $q$,'Existing purchase adjustment succeeds');
INSERT INTO repayment_results SELECT is((SELECT repaid_amount FROM public.purchase_splits WHERE purchase_id=(SELECT id FROM repayment_vars WHERE name='pur') AND person_id IS NOT NULL),100::numeric,'Adjustment replaces rather than accumulates');
INSERT INTO repayment_results SELECT throws_ok($q$ SELECT public.fn_set_purchase_repayments((SELECT id FROM repayment_vars WHERE name='ws'),(SELECT id FROM repayment_vars WHERE name='pur'),'[]',0) $q$,'PT409',NULL,'Stale adjustment rejected');
INSERT INTO repayment_results SELECT throws_ok($q$ SELECT public.fn_set_purchase_repayments((SELECT id FROM repayment_vars WHERE name='ws'),(SELECT id FROM repayment_vars WHERE name='pur'),jsonb_build_array(jsonb_build_object('participant_id',(SELECT id FROM repayment_vars WHERE name='person'),'count',4)),(SELECT repayment_version FROM public.purchases WHERE id=(SELECT id FROM repayment_vars WHERE name='pur'))) $q$,'P0001',NULL,'Count above installment total rejected');
INSERT INTO repayment_results SELECT throws_ok($q$ SELECT public.fn_set_purchase_repayments((SELECT id FROM repayment_vars WHERE name='ws'),(SELECT id FROM repayment_vars WHERE name='pur'),jsonb_build_array(jsonb_build_object('participant_id',(SELECT id FROM repayment_vars WHERE name='member'),'count',1)),(SELECT repayment_version FROM public.purchases WHERE id=(SELECT id FROM repayment_vars WHERE name='pur'))) $q$,'P0001',NULL,'Payer cannot repay self');
INSERT INTO repayment_results SELECT throws_ok($q$ SELECT public.fn_record_settlement(p_workspace_id=>(SELECT id FROM repayment_vars WHERE name='ws'),p_from_person_id=>(SELECT id FROM repayment_vars WHERE name='person'),p_to_member_id=>(SELECT id FROM repayment_vars WHERE name='member'),p_amount=>201) $q$,'P0001',NULL,'Server debt cap includes historical repayments');
INSERT INTO repayment_results SELECT lives_ok($q$ SELECT public.fn_record_settlement(p_workspace_id=>(SELECT id FROM repayment_vars WHERE name='ws'),p_from_person_id=>(SELECT id FROM repayment_vars WHERE name='person'),p_to_member_id=>(SELECT id FROM repayment_vars WHERE name='member'),p_amount=>200) $q$,'Remaining debt can be settled exactly');
RESET ROLE;
INSERT INTO repayment_results SELECT ok(NOT has_function_privilege('anon','public.fn_set_purchase_repayments(uuid,uuid,jsonb,integer)','EXECUTE'),'Anonymous access denied');
SET LOCAL request.jwt.claim.sub='';
INSERT INTO repayment_results SELECT throws_ok($q$ SELECT public.fn_set_purchase_repayments((SELECT id FROM repayment_vars WHERE name='ws'),(SELECT id FROM repayment_vars WHERE name='pur'),'[]',0) $q$,'42501',NULL,'Unauthenticated principal denied');

SET LOCAL request.jwt.claim.sub='a1500000-0000-0000-0000-000000000002';
SET LOCAL role='authenticated';
INSERT INTO repayment_results SELECT throws_ok($q$ SELECT public.fn_set_purchase_repayments((SELECT id FROM repayment_vars WHERE name='ws'),(SELECT id FROM repayment_vars WHERE name='pur'),'[]',0) $q$,'42501',NULL,'Foreign principal denied');
SET LOCAL request.jwt.claim.sub='a1500000-0000-0000-0000-000000000001';
INSERT INTO repayment_results SELECT throws_ok($q$ SELECT public.fn_set_purchase_repayments((SELECT id FROM repayment_vars WHERE name='ws'),(SELECT id FROM repayment_vars WHERE name='pur'),jsonb_build_array(jsonb_build_object('participant_id',(SELECT id FROM repayment_vars WHERE name='person'),'count',-1)),(SELECT repayment_version FROM public.purchases WHERE id=(SELECT id FROM repayment_vars WHERE name='pur'))) $q$,'P0001',NULL,'Negative count rejected');
INSERT INTO repayment_results SELECT throws_ok($q$ SELECT public.fn_set_purchase_repayments((SELECT id FROM repayment_vars WHERE name='ws'),(SELECT id FROM repayment_vars WHERE name='pur'),jsonb_build_array(jsonb_build_object('participant_id',(SELECT id FROM repayment_vars WHERE name='person'),'count',0),jsonb_build_object('participant_id',(SELECT id FROM repayment_vars WHERE name='person'),'count',0)),(SELECT repayment_version FROM public.purchases WHERE id=(SELECT id FROM repayment_vars WHERE name='pur'))) $q$,'P0001',NULL,'Duplicate participant rejected');
INSERT INTO repayment_vars SELECT 'rounded',public.fn_create_purchase_with_splits(
 p_workspace_id=>(SELECT id FROM repayment_vars WHERE name='ws'),p_description=>'Rounded custom',p_total_amount=>100.01,p_installment_count=>3,
 p_paid_by_member_id=>(SELECT id FROM repayment_vars WHERE name='member'),p_split_type=>'custom',
 p_splits=>jsonb_build_array(jsonb_build_object('member_id',(SELECT id FROM repayment_vars WHERE name='member'),'amount',70.01),jsonb_build_object('person_id',(SELECT id FROM repayment_vars WHERE name='person'),'amount',30,'repaid_installments_count',3)));
INSERT INTO repayment_results SELECT is((SELECT repaid_amount FROM public.purchase_splits WHERE purchase_id=(SELECT id FROM repayment_vars WHERE name='rounded') AND person_id IS NOT NULL),30::numeric,'Full repayment conserves custom quota cents');
SELECT public.fn_set_purchase_repayments((SELECT id FROM repayment_vars WHERE name='ws'),(SELECT id FROM repayment_vars WHERE name='rounded'),jsonb_build_array(jsonb_build_object('participant_id',(SELECT id FROM repayment_vars WHERE name='person'),'count',1)),(SELECT repayment_version FROM public.purchases WHERE id=(SELECT id FROM repayment_vars WHERE name='rounded')));
INSERT INTO repayment_results SELECT is((SELECT repaid_amount FROM public.purchase_splits WHERE purchase_id=(SELECT id FROM repayment_vars WHERE name='rounded') AND person_id IS NOT NULL),10::numeric,'First repayment matches canonical monthly allocation');
INSERT INTO repayment_results SELECT lives_ok($q$ SELECT public.fn_delete_purchase((SELECT id FROM repayment_vars WHERE name='ws'),(SELECT id FROM repayment_vars WHERE name='rounded')) $q$,'Purchase with repayment history can be deleted atomically');
INSERT INTO repayment_results SELECT is((SELECT count(*)::int FROM public.purchase_splits WHERE purchase_id=(SELECT id FROM repayment_vars WHERE name='rounded')),0,'Deletion removes purchase-scoped repayments');
INSERT INTO repayment_results SELECT ok(NOT has_table_privilege('authenticated','public.purchase_splits','UPDATE'),'Direct repayment edits denied');
RESET ROLE;
SELECT (SELECT array_agg(msg) FROM repayment_results WHERE msg LIKE 'not ok%') AS not_ok_messages,
 extensions._get('curr_test')::int AS ran,extensions._get('plan')::int AS planned,extensions.num_failed()::int AS failed,ARRAY(SELECT * FROM extensions.finish()) AS finish_diagnostics;
ROLLBACK;
