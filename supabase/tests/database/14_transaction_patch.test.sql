BEGIN;
SELECT plan(19);
CREATE TEMP TABLE patch_results(msg text);
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at) VALUES
('a1470000-0000-0000-0000-000000000001','authenticated','authenticated','qa-patch-owner@example.test',now()),
('a1470000-0000-0000-0000-000000000002','authenticated','authenticated','qa-patch-other@example.test',now());
CREATE TEMP TABLE patch_vars(name text,id uuid);
INSERT INTO patch_vars SELECT 'ws',id FROM public.workspaces WHERE owner_id='a1470000-0000-0000-0000-000000000001';
UPDATE public.workspaces SET tracking_mode='expense_tracker' WHERE id=(SELECT id FROM patch_vars WHERE name='ws');
WITH m AS(INSERT INTO public.payment_methods(workspace_id,name,type) SELECT id,'Patch Pix','pix' FROM patch_vars WHERE name='ws' RETURNING id) INSERT INTO patch_vars SELECT 'method',id FROM m;
WITH t AS(INSERT INTO public.transactions(workspace_id,description,amount,type,payment_method_id,notes) SELECT id,'Original',100,'expense',(SELECT id FROM patch_vars WHERE name='method'),'Keep' FROM patch_vars WHERE name='ws' RETURNING id) INSERT INTO patch_vars SELECT 'tx',id FROM t;
WITH c AS(INSERT INTO public.credit_cards(workspace_id,name,credit_limit,closing_day,due_day) SELECT id,'Patch Card',1000,20,28 FROM patch_vars WHERE name='ws' RETURNING id) INSERT INTO patch_vars SELECT 'card',id FROM c;
GRANT ALL ON patch_vars,patch_results TO authenticated;
SET LOCAL request.jwt.claim.sub='a1470000-0000-0000-0000-000000000001';
SET LOCAL role='authenticated';
INSERT INTO patch_results SELECT lives_ok($q$SELECT public.fn_patch_transaction((SELECT id FROM patch_vars WHERE name='ws'),(SELECT id FROM patch_vars WHERE name='tx'),' {"description":"Edited"}',(SELECT updated_at FROM public.transactions WHERE id=(SELECT id FROM patch_vars WHERE name='tx')))$q$,'Metadata edit succeeds');
INSERT INTO patch_results SELECT is((SELECT description FROM public.transactions WHERE id=(SELECT id FROM patch_vars WHERE name='tx')),'Edited','Description saved');
INSERT INTO patch_results SELECT is((SELECT payment_method_id FROM public.transactions WHERE id=(SELECT id FROM patch_vars WHERE name='tx')),(SELECT id FROM patch_vars WHERE name='method'),'Omitted funding link preserved');
INSERT INTO patch_results SELECT throws_ok($q$SELECT public.fn_patch_transaction((SELECT id FROM patch_vars WHERE name='ws'),(SELECT id FROM patch_vars WHERE name='tx'),'{"description":"Stale"}','2000-01-01')$q$,'PT409',NULL,'Stale version rejected');
INSERT INTO patch_results SELECT throws_ok($q$SELECT public.fn_patch_transaction((SELECT id FROM patch_vars WHERE name='ws'),(SELECT id FROM patch_vars WHERE name='tx'),'{"workspace_id":"bad"}',(SELECT updated_at FROM public.transactions WHERE id=(SELECT id FROM patch_vars WHERE name='tx')))$q$,'23514',NULL,'Identity fields rejected');
INSERT INTO patch_results SELECT lives_ok($q$SELECT public.fn_patch_transaction((SELECT id FROM patch_vars WHERE name='ws'),(SELECT id FROM patch_vars WHERE name='tx'),'{"amount":120}',(SELECT updated_at FROM public.transactions WHERE id=(SELECT id FROM patch_vars WHERE name='tx')))$q$,'Pending amount can change');
INSERT INTO patch_results SELECT is((SELECT amount FROM public.transactions WHERE id=(SELECT id FROM patch_vars WHERE name='tx')),120::numeric,'Amount saved');
SELECT public.fn_record_payment(p_workspace_id=>(SELECT id FROM patch_vars WHERE name='ws'),p_account_id=>NULL,p_amount=>20,p_transaction_id=>(SELECT id FROM patch_vars WHERE name='tx'),p_affects_balance=>false);
INSERT INTO patch_results SELECT lives_ok($q$SELECT public.fn_patch_transaction((SELECT id FROM patch_vars WHERE name='ws'),(SELECT id FROM patch_vars WHERE name='tx'),'{"notes":null}',(SELECT updated_at FROM public.transactions WHERE id=(SELECT id FROM patch_vars WHERE name='tx')))$q$,'Paid metadata remains editable');
INSERT INTO patch_results SELECT is((SELECT status FROM public.transactions WHERE id=(SELECT id FROM patch_vars WHERE name='tx')),'partially_paid','Partial payment state preserved');
INSERT INTO patch_results SELECT throws_ok($q$SELECT public.fn_patch_transaction((SELECT id FROM patch_vars WHERE name='ws'),(SELECT id FROM patch_vars WHERE name='tx'),'{"amount":130}',(SELECT updated_at FROM public.transactions WHERE id=(SELECT id FROM patch_vars WHERE name='tx')))$q$,'23514',NULL,'Paid amount immutable');
INSERT INTO patch_vars SELECT 'billed',public.fn_create_transaction_with_splits(p_workspace_id=>(SELECT id FROM patch_vars WHERE name='ws'),p_description=>'Billed',p_amount=>20,p_transaction_date=>'2050-01-05',p_credit_card_id=>(SELECT id FROM patch_vars WHERE name='card'));
SELECT public.fn_record_payment(p_workspace_id=>(SELECT id FROM patch_vars WHERE name='ws'),p_account_id=>NULL,p_amount=>20,p_credit_card_bill_id=>(SELECT credit_card_bill_id FROM public.transactions WHERE id=(SELECT id FROM patch_vars WHERE name='billed')),p_affects_balance=>false);
INSERT INTO patch_results SELECT lives_ok($q$SELECT public.fn_patch_transaction((SELECT id FROM patch_vars WHERE name='ws'),(SELECT id FROM patch_vars WHERE name='billed'),'{"description":"Paid card edited"}',(SELECT updated_at FROM public.transactions WHERE id=(SELECT id FROM patch_vars WHERE name='billed')))$q$,'Paid billed metadata editable');
INSERT INTO patch_results SELECT is((SELECT status FROM public.transactions WHERE id=(SELECT id FROM patch_vars WHERE name='billed')),'paid','Bill payment state preserved');
INSERT INTO patch_results SELECT throws_ok($q$SELECT public.fn_patch_transaction((SELECT id FROM patch_vars WHERE name='ws'),(SELECT id FROM patch_vars WHERE name='billed'),'{"due_date":"2050-02-28"}',(SELECT updated_at FROM public.transactions WHERE id=(SELECT id FROM patch_vars WHERE name='billed')))$q$,'23514',NULL,'Billed date protected');
INSERT INTO patch_results SELECT throws_ok($q$SELECT public.fn_patch_transaction((SELECT id FROM patch_vars WHERE name='ws'),(SELECT id FROM patch_vars WHERE name='tx'),'{"description":" "}',(SELECT updated_at FROM public.transactions WHERE id=(SELECT id FROM patch_vars WHERE name='tx')))$q$,'23514',NULL,'Blank description rejected');
INSERT INTO patch_results SELECT throws_ok($q$SELECT public.fn_patch_transaction((SELECT id FROM patch_vars WHERE name='ws'),(SELECT id FROM patch_vars WHERE name='tx'),'[]',(SELECT updated_at FROM public.transactions WHERE id=(SELECT id FROM patch_vars WHERE name='tx')))$q$,'23514',NULL,'Invalid patch shape rejected');
INSERT INTO patch_results SELECT throws_ok($q$SELECT public.fn_patch_transaction((SELECT id FROM patch_vars WHERE name='ws'),'a1470000-0000-0000-0000-000000000099','{}',now())$q$,'P0001',NULL,'Missing transaction rejected');
SET LOCAL request.jwt.claim.sub='a1470000-0000-0000-0000-000000000002';
INSERT INTO patch_results SELECT throws_ok($q$SELECT public.fn_patch_transaction((SELECT id FROM patch_vars WHERE name='ws'),(SELECT id FROM patch_vars WHERE name='tx'),'{"description":"Foreign"}',now())$q$,'42501',NULL,'Foreign principal cannot edit');
RESET ROLE;
INSERT INTO patch_results SELECT ok(NOT has_function_privilege('anon','public.fn_patch_transaction(uuid,uuid,jsonb,timestamptz)','EXECUTE'),'Anonymous RPC access revoked');
INSERT INTO patch_results SELECT is((SELECT count(*)::int FROM public.payments WHERE workspace_id=(SELECT id FROM patch_vars WHERE name='ws')),2,'Edits do not create or delete payments');
SELECT (SELECT array_agg(msg) FROM patch_results WHERE msg LIKE 'not ok%') AS not_ok_messages,
  extensions._get('curr_test')::int AS ran,extensions._get('plan')::int AS planned,
  extensions.num_failed()::int AS failed,ARRAY(SELECT * FROM extensions.finish()) AS finish_diagnostics;
ROLLBACK;
