BEGIN;
SELECT plan(35);
CREATE TEMP TABLE tap_runs(msg text);
GRANT ALL ON tap_runs TO authenticated;

INSERT INTO auth.users(id,aud,role,email,email_confirmed_at) VALUES
('a1400000-0000-0000-0000-000000000001','authenticated','authenticated','a1.owner@example.test',now()),
('a1400000-0000-0000-0000-000000000002','authenticated','authenticated','a1.target@example.test',now()),
('a1400000-0000-0000-0000-000000000003','authenticated','authenticated','a1.unconfirmed@example.test',NULL);
CREATE TEMP TABLE a1_guard_vars(name text,id uuid);
GRANT ALL ON a1_guard_vars TO authenticated;
INSERT INTO a1_guard_vars SELECT 'ws',id FROM public.workspaces WHERE owner_id='a1400000-0000-0000-0000-000000000001';
WITH a AS(INSERT INTO public.accounts(workspace_id,name,type,initial_balance,current_balance)
 SELECT id,'Guard account','cash',1000,1000 FROM a1_guard_vars WHERE name='ws' RETURNING id)
INSERT INTO a1_guard_vars SELECT 'account',id FROM a;
WITH a AS(INSERT INTO public.categories(workspace_id,name,type,active)
 SELECT id,'Inactive category','expense',false FROM a1_guard_vars WHERE name='ws' RETURNING id)
INSERT INTO a1_guard_vars SELECT 'inactive_category',id FROM a;
WITH a AS(INSERT INTO public.payment_methods(workspace_id,name,type,active)
 SELECT id,'Inactive method','other',false FROM a1_guard_vars WHERE name='ws' RETURNING id)
INSERT INTO a1_guard_vars SELECT 'inactive_method',id FROM a;
WITH a AS(INSERT INTO public.credit_cards(workspace_id,name,credit_limit,closing_day,due_day,active)
 SELECT id,'Inactive card',100,1,10,false FROM a1_guard_vars WHERE name='ws' RETURNING id)
INSERT INTO a1_guard_vars SELECT 'inactive_card',id FROM a;
WITH a AS(INSERT INTO public.people(workspace_id,name,archived)
 SELECT id,'Archived payer',true FROM a1_guard_vars WHERE name='ws' RETURNING id)
INSERT INTO a1_guard_vars SELECT 'archived_person',id FROM a;
SET LOCAL request.jwt.claim.sub='a1400000-0000-0000-0000-000000000001';
SET LOCAL role='authenticated';

INSERT INTO tap_runs SELECT throws_ok($q$UPDATE public.profiles SET email='spoof@example.test' WHERE id=auth.uid()$q$,'42501',NULL,'Client cannot change identity email');
INSERT INTO tap_runs SELECT throws_ok($q$UPDATE public.profiles SET id='a1400000-0000-0000-0000-000000000009' WHERE id=auth.uid()$q$,'42501',NULL,'Client cannot change identity id');
INSERT INTO tap_runs SELECT lives_ok($q$UPDATE public.profiles SET name='Presentation',avatar_url=NULL WHERE id=auth.uid()$q$,'Presentation remains editable');
INSERT INTO tap_runs SELECT ok(NOT has_table_privilege('authenticated','public.profiles','UPDATE'),'No broad profile update grant');
INSERT INTO tap_runs SELECT ok(has_column_privilege('authenticated','public.profiles','name','UPDATE'),'Name update grant');
INSERT INTO tap_runs SELECT ok(NOT has_column_privilege('authenticated','public.profiles','email','UPDATE'),'No email update grant');
INSERT INTO a1_guard_vars VALUES('invited',public.fn_add_workspace_member((SELECT id FROM a1_guard_vars WHERE name='ws'),' A1.TARGET@EXAMPLE.TEST ','member'));
INSERT INTO tap_runs SELECT is((SELECT user_id FROM public.workspace_members WHERE id=(SELECT id FROM a1_guard_vars WHERE name='invited')),
 'a1400000-0000-0000-0000-000000000002'::uuid,'Invite resolves confirmed Auth principal case-insensitively');
INSERT INTO tap_runs SELECT throws_ok($q$SELECT public.fn_add_workspace_member((SELECT id FROM a1_guard_vars WHERE name='ws'),'a1.unconfirmed@example.test','member')$q$,'P0001',NULL,'Unconfirmed identity is not invited');
INSERT INTO tap_runs SELECT throws_ok($q$SELECT public.fn_add_workspace_member((SELECT id FROM a1_guard_vars WHERE name='ws'),'spoof@example.test','member')$q$,'P0001',NULL,'Unknown/spoofed identity is not invited');
DELETE FROM public.workspace_members WHERE workspace_id=(SELECT id FROM a1_guard_vars WHERE name='ws') AND user_id='a1400000-0000-0000-0000-000000000002';
RESET ROLE;
UPDATE auth.users SET email='a1.changed@example.test' WHERE id='a1400000-0000-0000-0000-000000000002';
INSERT INTO tap_runs SELECT is((SELECT email FROM public.profiles WHERE id='a1400000-0000-0000-0000-000000000002'),'a1.changed@example.test','Auth email change synchronizes profile');
SET LOCAL role='authenticated';
INSERT INTO tap_runs SELECT throws_ok($q$SELECT public.fn_add_workspace_member((SELECT id FROM a1_guard_vars WHERE name='ws'),'a1.target@example.test','member')$q$,'P0001',NULL,'Old email no longer resolves');
INSERT INTO tap_runs SELECT lives_ok($q$SELECT public.fn_add_workspace_member((SELECT id FROM a1_guard_vars WHERE name='ws'),'a1.changed@example.test','viewer')$q$,'New canonical email resolves');

UPDATE public.people SET archived=false WHERE id=(SELECT id FROM a1_guard_vars WHERE name='archived_person');
INSERT INTO a1_guard_vars VALUES('historical_tx',public.fn_create_transaction_with_splits(p_workspace_id=>(SELECT id FROM a1_guard_vars WHERE name='ws'),p_description=>'Historical split',p_amount=>10,p_split_type=>'custom',p_paid_by_person_id=>(SELECT id FROM a1_guard_vars WHERE name='archived_person'),p_splits=>jsonb_build_array(jsonb_build_object('person_id',(SELECT id FROM a1_guard_vars WHERE name='archived_person'),'amount',10))));
INSERT INTO a1_guard_vars VALUES('historical_purchase',public.fn_create_purchase_with_splits(p_workspace_id=>(SELECT id FROM a1_guard_vars WHERE name='ws'),p_description=>'Historical purchase',p_total_amount=>10,p_installment_count=>1,p_paid_by_person_id=>(SELECT id FROM a1_guard_vars WHERE name='archived_person'),p_split_type=>'custom',p_splits=>jsonb_build_array(jsonb_build_object('person_id',(SELECT id FROM a1_guard_vars WHERE name='archived_person'),'amount',10))));
UPDATE public.people SET archived=true WHERE id=(SELECT id FROM a1_guard_vars WHERE name='archived_person');
INSERT INTO tap_runs SELECT throws_ok($q$SELECT public.fn_create_transaction_with_splits(p_workspace_id=>(SELECT id FROM a1_guard_vars WHERE name='ws'),p_description=>'inactive',p_amount=>10,p_category_id=>(SELECT id FROM a1_guard_vars WHERE name='inactive_category'))$q$,'P0001',NULL,'Inactive category rejected');
INSERT INTO tap_runs SELECT throws_ok($q$SELECT public.fn_create_transaction_with_splits(p_workspace_id=>(SELECT id FROM a1_guard_vars WHERE name='ws'),p_description=>'inactive',p_amount=>10,p_payment_method_id=>(SELECT id FROM a1_guard_vars WHERE name='inactive_method'))$q$,'P0001',NULL,'Inactive payment method rejected');
INSERT INTO tap_runs SELECT throws_ok($q$SELECT public.fn_create_transaction_with_splits(p_workspace_id=>(SELECT id FROM a1_guard_vars WHERE name='ws'),p_description=>'inactive',p_amount=>10,p_credit_card_id=>(SELECT id FROM a1_guard_vars WHERE name='inactive_card'))$q$,'P0001',NULL,'Inactive card rejected');
INSERT INTO tap_runs SELECT throws_ok($q$SELECT public.fn_create_transaction_with_splits(p_workspace_id=>(SELECT id FROM a1_guard_vars WHERE name='ws'),p_description=>'archived',p_amount=>10,p_paid_by_person_id=>(SELECT id FROM a1_guard_vars WHERE name='archived_person'))$q$,'P0001',NULL,'Archived payer rejected');
INSERT INTO a1_guard_vars VALUES('tx',public.fn_create_transaction_with_splits(p_workspace_id=>(SELECT id FROM a1_guard_vars WHERE name='ws'),p_description=>'History',p_amount=>100));
INSERT INTO tap_runs SELECT throws_ok($q$SELECT public.fn_record_payment(p_workspace_id=>(SELECT id FROM a1_guard_vars WHERE name='ws'),p_account_id=>NULL,p_amount=>5,p_transaction_id=>(SELECT id FROM a1_guard_vars WHERE name='tx'),p_affects_balance=>false)$q$,'P0001',NULL,'Full cannot bypass account/balance');
INSERT INTO a1_guard_vars VALUES('old_payment',public.fn_record_payment(p_workspace_id=>(SELECT id FROM a1_guard_vars WHERE name='ws'),p_account_id=>(SELECT id FROM a1_guard_vars WHERE name='account'),p_amount=>5,p_transaction_id=>(SELECT id FROM a1_guard_vars WHERE name='tx'),p_affects_balance=>true));
INSERT INTO tap_runs SELECT is((SELECT current_balance FROM public.accounts WHERE id=(SELECT id FROM a1_guard_vars WHERE name='account')),995::numeric,'Full payment debits once');
UPDATE public.accounts SET active=false WHERE id=(SELECT id FROM a1_guard_vars WHERE name='account');
INSERT INTO tap_runs SELECT throws_ok($q$SELECT public.fn_record_payment(p_workspace_id=>(SELECT id FROM a1_guard_vars WHERE name='ws'),p_account_id=>(SELECT id FROM a1_guard_vars WHERE name='account'),p_amount=>5,p_transaction_id=>(SELECT id FROM a1_guard_vars WHERE name='tx'),p_affects_balance=>true)$q$,'P0001',NULL,'Inactive account cannot receive new payment');
INSERT INTO tap_runs SELECT is((SELECT current_balance FROM public.accounts WHERE id=(SELECT id FROM a1_guard_vars WHERE name='account')),995::numeric,'Rejected payment preserves balance');
INSERT INTO tap_runs SELECT lives_ok($q$SELECT public.fn_update_payment(p_workspace_id=>(SELECT id FROM a1_guard_vars WHERE name='ws'),p_payment_id=>(SELECT id FROM a1_guard_vars WHERE name='old_payment'),p_notes=>'Historical metadata')$q$,'Unchanged historical inactive association remains editable');
UPDATE public.workspaces SET tracking_mode='expense_tracker' WHERE id=(SELECT id FROM a1_guard_vars WHERE name='ws');
INSERT INTO tap_runs SELECT throws_ok($q$SELECT public.fn_record_payment(p_workspace_id=>(SELECT id FROM a1_guard_vars WHERE name='ws'),p_account_id=>(SELECT id FROM a1_guard_vars WHERE name='account'),p_amount=>5,p_transaction_id=>(SELECT id FROM a1_guard_vars WHERE name='tx'),p_affects_balance=>true)$q$,'P0001',NULL,'Expense tracker cannot enable balance effect');
INSERT INTO a1_guard_vars VALUES('tracker_payment',public.fn_record_payment(p_workspace_id=>(SELECT id FROM a1_guard_vars WHERE name='ws'),p_account_id=>NULL,p_amount=>5,p_transaction_id=>(SELECT id FROM a1_guard_vars WHERE name='tx'),p_affects_balance=>false));
INSERT INTO tap_runs SELECT is((SELECT current_balance FROM public.accounts WHERE id=(SELECT id FROM a1_guard_vars WHERE name='account')),995::numeric,'Tracker payment preserves balance');
INSERT INTO tap_runs SELECT throws_ok($q$SELECT public.fn_update_payment(p_workspace_id=>(SELECT id FROM a1_guard_vars WHERE name='ws'),p_payment_id=>(SELECT id FROM a1_guard_vars WHERE name='old_payment'),p_affects_balance=>false)$q$,'P0001',NULL,'Historical effect cannot be rewritten after mode change');
INSERT INTO tap_runs SELECT lives_ok($q$SELECT public.fn_delete_payment((SELECT id FROM a1_guard_vars WHERE name='ws'),(SELECT id FROM a1_guard_vars WHERE name='old_payment'))$q$,'Reversal on inactive account preserves original effect after mode change');
INSERT INTO tap_runs SELECT is((SELECT current_balance FROM public.accounts WHERE id=(SELECT id FROM a1_guard_vars WHERE name='account')),1000::numeric,'Historical full reversal restores balance');
UPDATE public.accounts SET active=true WHERE id=(SELECT id FROM a1_guard_vars WHERE name='account');
INSERT INTO tap_runs SELECT lives_ok($q$SELECT public.fn_create_transaction_with_splits(p_workspace_id=>(SELECT id FROM a1_guard_vars WHERE name='ws'),p_description=>'Tracker paid with optional account',p_amount=>5,p_status=>'paid',p_account_id=>(SELECT id FROM a1_guard_vars WHERE name='account'))$q$,'Paid creation in tracker derives false even with optional account');
INSERT INTO tap_runs SELECT is((SELECT current_balance FROM public.accounts WHERE id=(SELECT id FROM a1_guard_vars WHERE name='account')),1000::numeric,'Tracker paid creation has no balance effect');
UPDATE public.workspaces SET tracking_mode='full' WHERE id=(SELECT id FROM a1_guard_vars WHERE name='ws');
INSERT INTO tap_runs SELECT lives_ok($q$SELECT public.fn_delete_payment((SELECT id FROM a1_guard_vars WHERE name='ws'),(SELECT id FROM a1_guard_vars WHERE name='tracker_payment'))$q$,'Historical tracker reversal remains balance-neutral in full');
INSERT INTO tap_runs SELECT is((SELECT current_balance FROM public.accounts WHERE id=(SELECT id FROM a1_guard_vars WHERE name='account')),1000::numeric,'Mixed-mode history conserves balance');
SET LOCAL request.jwt.claim.sub='a1400000-0000-0000-0000-000000000002';
INSERT INTO tap_runs SELECT throws_ok($q$SELECT public.fn_add_workspace_member((SELECT id FROM a1_guard_vars WHERE name='ws'),'a1.unconfirmed@example.test','member')$q$,'P0001',NULL,'Viewer cannot invite');
SET LOCAL request.jwt.claim.sub='a1400000-0000-0000-0000-000000000001';
INSERT INTO tap_runs SELECT lives_ok($q$SELECT public.fn_update_transaction_with_splits(p_workspace_id=>(SELECT id FROM a1_guard_vars WHERE name='ws'),p_transaction_id=>(SELECT id FROM a1_guard_vars WHERE name='historical_tx'),p_splits=>jsonb_build_array(jsonb_build_object('person_id',(SELECT id FROM a1_guard_vars WHERE name='archived_person'),'amount',10)))$q$,'fn_update_transaction_with_splits retains archived historical participant');
INSERT INTO tap_runs SELECT lives_ok($q$SELECT public.fn_update_purchase_with_splits(p_workspace_id=>(SELECT id FROM a1_guard_vars WHERE name='ws'),p_purchase_id=>(SELECT id FROM a1_guard_vars WHERE name='historical_purchase'),p_splits=>jsonb_build_array(jsonb_build_object('person_id',(SELECT id FROM a1_guard_vars WHERE name='archived_person'),'amount',10)))$q$,'fn_update_purchase_with_splits retains archived historical participant');
INSERT INTO tap_runs SELECT lives_ok($q$SELECT public.fn_set_transaction_splits(p_workspace_id=>(SELECT id FROM a1_guard_vars WHERE name='ws'),p_transaction_id=>(SELECT id FROM a1_guard_vars WHERE name='historical_tx'),p_splits=>jsonb_build_array(jsonb_build_object('person_id',(SELECT id FROM a1_guard_vars WHERE name='archived_person'),'amount',10)))$q$,'fn_set_transaction_splits retains archived historical participant');
INSERT INTO tap_runs SELECT lives_ok($q$SELECT public.fn_set_purchase_splits(p_workspace_id=>(SELECT id FROM a1_guard_vars WHERE name='ws'),p_purchase_id=>(SELECT id FROM a1_guard_vars WHERE name='historical_purchase'),p_splits=>jsonb_build_array(jsonb_build_object('person_id',(SELECT id FROM a1_guard_vars WHERE name='archived_person'),'amount',10)))$q$,'fn_set_purchase_splits retains archived historical participant');
RESET ROLE;
SELECT (SELECT array_agg(msg) FROM tap_runs WHERE msg LIKE 'not ok%') AS not_ok_messages, extensions._get('curr_test')::int AS ran, extensions._get('plan')::int AS planned, extensions.num_failed()::int AS failed, ARRAY(SELECT * FROM extensions.finish()) AS finish_diagnostics;
ROLLBACK;
