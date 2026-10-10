BEGIN;
SELECT plan(12);
CREATE TEMP TABLE method_results(msg text);
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at)
VALUES('a1460000-0000-0000-0000-000000000001','authenticated','authenticated','qa-method-owner@example.test',now());
CREATE TEMP TABLE method_ws AS SELECT id FROM public.workspaces WHERE owner_id='a1460000-0000-0000-0000-000000000001';
UPDATE public.workspaces SET tracking_mode='expense_tracker' WHERE id=(SELECT id FROM method_ws);
INSERT INTO public.payment_methods(id,workspace_id,name,type)
SELECT ('a1460000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,id,'QA method ' || n,'pix'
FROM method_ws CROSS JOIN generate_series(10,14) n;
INSERT INTO public.transactions(workspace_id,description,amount,type,payment_method_id)
SELECT id,'QA transaction',10,'expense','a1460000-0000-0000-0000-000000000010' FROM method_ws;
INSERT INTO public.purchases(workspace_id,description,total_amount,installment_count,payment_method_id)
SELECT id,'QA purchase',10,1,'a1460000-0000-0000-0000-000000000011' FROM method_ws;
INSERT INTO public.recurring_transactions(workspace_id,description,amount,type,frequency,start_date,next_occurrence,payment_method_id)
SELECT id,'QA recurring',10,'expense','monthly','2050-01-01','2050-01-01','a1460000-0000-0000-0000-000000000012' FROM method_ws;
INSERT INTO public.payments(workspace_id,transaction_id,amount,affects_balance,payment_method_id)
SELECT w.id,t.id,1,false,'a1460000-0000-0000-0000-000000000013' FROM method_ws w JOIN public.transactions t ON t.workspace_id=w.id;
GRANT ALL ON method_results,method_ws TO authenticated;
SET LOCAL request.jwt.claim.sub='a1460000-0000-0000-0000-000000000001';
SET LOCAL role='authenticated';
INSERT INTO method_results SELECT throws_ok($q$DELETE FROM public.payment_methods WHERE id='a1460000-0000-0000-0000-000000000010'$q$,'23514',NULL,'Transaction history blocks deletion');
INSERT INTO method_results SELECT throws_ok($q$DELETE FROM public.payment_methods WHERE id='a1460000-0000-0000-0000-000000000011'$q$,'23514',NULL,'Purchase history blocks deletion');
INSERT INTO method_results SELECT throws_ok($q$DELETE FROM public.payment_methods WHERE id='a1460000-0000-0000-0000-000000000012'$q$,'23514',NULL,'Recurring history blocks deletion');
INSERT INTO method_results SELECT throws_ok($q$DELETE FROM public.payment_methods WHERE id='a1460000-0000-0000-0000-000000000013'$q$,'23514',NULL,'Payment history blocks deletion');
INSERT INTO method_results SELECT throws_ok($q$UPDATE public.payment_methods SET type='cash' WHERE id='a1460000-0000-0000-0000-000000000010'$q$,'23514',NULL,'Used type cannot change');
INSERT INTO method_results SELECT lives_ok($q$UPDATE public.payment_methods SET name='Renamed',active=false WHERE id='a1460000-0000-0000-0000-000000000010'$q$,'Rename and deactivate preserves history');
INSERT INTO method_results SELECT lives_ok($q$UPDATE public.payment_methods SET active=true WHERE id='a1460000-0000-0000-0000-000000000010'$q$,'Reactivate a method');
INSERT INTO method_results SELECT lives_ok($q$UPDATE public.payment_methods SET type='cash' WHERE id='a1460000-0000-0000-0000-000000000014'$q$,'Unused type can change');
INSERT INTO method_results SELECT lives_ok($q$DELETE FROM public.payment_methods WHERE id='a1460000-0000-0000-0000-000000000014'$q$,'Unused method can be deleted');
INSERT INTO method_results SELECT throws_ok($q$UPDATE public.payment_methods SET name=' ' WHERE id='a1460000-0000-0000-0000-000000000010'$q$,'23514',NULL,'Empty name rejected');
INSERT INTO method_results SELECT ok(NOT has_function_privilege('authenticated','public.fn_guard_payment_method_history()','EXECUTE'),'Trigger not exposed as RPC');
RESET ROLE;
INSERT INTO method_results SELECT lives_ok($q$DELETE FROM public.workspaces WHERE id=(SELECT id FROM method_ws)$q$,'Workspace cascade remains possible');
SELECT (SELECT array_agg(msg) FROM method_results WHERE msg LIKE 'not ok%') AS not_ok_messages,
  extensions._get('curr_test')::int AS ran, extensions._get('plan')::int AS planned,
  extensions.num_failed()::int AS failed, ARRAY(SELECT * FROM extensions.finish()) AS finish_diagnostics;
ROLLBACK;
