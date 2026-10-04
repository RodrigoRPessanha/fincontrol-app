BEGIN;
SELECT plan(50);
CREATE TEMP TABLE tap_runs(msg text);
CREATE TEMP TABLE a2_vars(name text PRIMARY KEY,id uuid);
GRANT ALL ON tap_runs,a2_vars TO authenticated;
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at) VALUES
('a2400000-0000-0000-0000-000000000001','authenticated','authenticated','a2.money@example.test',now());
INSERT INTO a2_vars SELECT 'ws',id FROM public.workspaces WHERE owner_id='a2400000-0000-0000-0000-000000000001';
WITH x AS(INSERT INTO public.accounts(workspace_id,name,type,initial_balance,current_balance)
 SELECT id,'Source','cash',1000,1000 FROM a2_vars WHERE name='ws' RETURNING id) INSERT INTO a2_vars SELECT 'source',id FROM x;
WITH x AS(INSERT INTO public.accounts(workspace_id,name,type,initial_balance,current_balance)
 SELECT id,'Destination','cash',500,500 FROM a2_vars WHERE name='ws' RETURNING id) INSERT INTO a2_vars SELECT 'dest',id FROM x;
WITH x AS(INSERT INTO public.credit_cards(workspace_id,name,credit_limit,closing_day,due_day)
 SELECT id,'Card',2000,25,5 FROM a2_vars WHERE name='ws' RETURNING id) INSERT INTO a2_vars SELECT 'card',id FROM x;
WITH x AS(INSERT INTO public.financial_goals(workspace_id,name,target_amount,current_amount)
 SELECT id,'Goal',200,0 FROM a2_vars WHERE name='ws' RETURNING id) INSERT INTO a2_vars SELECT 'goal',id FROM x;
SET LOCAL request.jwt.claim.sub='a2400000-0000-0000-0000-000000000001';
SET LOCAL role='authenticated';

INSERT INTO tap_runs SELECT is(public.fn_normalize_money(10.075),10.08::numeric,'Half-up before effects');
INSERT INTO tap_runs SELECT is(public.fn_normalize_money(0.005),0.01::numeric,'Half-cent rounds up');
INSERT INTO tap_runs SELECT throws_ok($q$SELECT public.fn_normalize_money(0.004)$q$,'P0001',NULL,'Subcent operation rejected');
INSERT INTO tap_runs SELECT throws_ok($q$SELECT public.fn_normalize_money('NaN')$q$,'P0001',NULL,'NaN rejected');
INSERT INTO tap_runs SELECT throws_ok($q$SELECT public.fn_normalize_money('Infinity')$q$,'P0001',NULL,'Infinity rejected');
INSERT INTO tap_runs SELECT throws_ok($q$SELECT public.fn_normalize_money(NULL)$q$,'P0001',NULL,'Null rejected');
INSERT INTO tap_runs SELECT throws_ok($q$SELECT public.fn_normalize_money(10000000000)$q$,'P0001',NULL,'Overflow rejected');
INSERT INTO a2_vars VALUES('transfer',public.fn_create_transfer((SELECT id FROM a2_vars WHERE name='ws'),(SELECT id FROM a2_vars WHERE name='source'),(SELECT id FROM a2_vars WHERE name='dest'),10.075));
INSERT INTO tap_runs SELECT is((SELECT current_balance FROM public.accounts WHERE id=(SELECT id FROM a2_vars WHERE name='source')),989.92::numeric,'Transfer debit canonical');
INSERT INTO tap_runs SELECT is((SELECT current_balance FROM public.accounts WHERE id=(SELECT id FROM a2_vars WHERE name='dest')),510.08::numeric,'Transfer credit canonical');
INSERT INTO tap_runs SELECT is((SELECT sum(current_balance) FROM public.accounts WHERE id IN (SELECT id FROM a2_vars WHERE name IN ('source','dest'))),1500::numeric,'Transfer conserves balances');
SELECT public.fn_delete_transfer((SELECT id FROM a2_vars WHERE name='ws'),(SELECT id FROM a2_vars WHERE name='transfer'));
INSERT INTO tap_runs SELECT is((SELECT current_balance FROM public.accounts WHERE id=(SELECT id FROM a2_vars WHERE name='source')),1000::numeric,'Reversal restores source');
INSERT INTO a2_vars VALUES('tx',public.fn_create_transaction_with_splits(p_workspace_id=>(SELECT id FROM a2_vars WHERE name='ws'),p_description=>'Payment rounding',p_amount=>10.08));
INSERT INTO a2_vars VALUES('payment',public.fn_record_payment(p_workspace_id=>(SELECT id FROM a2_vars WHERE name='ws'),p_account_id=>(SELECT id FROM a2_vars WHERE name='source'),p_amount=>10.075,p_transaction_id=>(SELECT id FROM a2_vars WHERE name='tx')));
INSERT INTO tap_runs SELECT is((SELECT current_balance FROM public.accounts WHERE id=(SELECT id FROM a2_vars WHERE name='source')),989.92::numeric,'Payment debit canonical');
INSERT INTO tap_runs SELECT is((SELECT amount FROM public.payments WHERE id=(SELECT id FROM a2_vars WHERE name='payment')),10.08::numeric,'Payment stored canonical');
SELECT public.fn_delete_payment((SELECT id FROM a2_vars WHERE name='ws'),(SELECT id FROM a2_vars WHERE name='payment'));
INSERT INTO tap_runs SELECT is((SELECT current_balance FROM public.accounts WHERE id=(SELECT id FROM a2_vars WHERE name='source')),1000::numeric,'Payment reversal exact');
INSERT INTO tap_runs SELECT throws_ok($q$SELECT public.fn_create_transaction_with_splits(p_workspace_id=>(SELECT id FROM a2_vars WHERE name='ws'),p_description=>'NaN injection',p_amount=>'NaN',p_status=>'paid',p_account_id=>(SELECT id FROM a2_vars WHERE name='source'))$q$,'P0001',NULL,'Paid NaN rejected before effects');
INSERT INTO tap_runs SELECT is((SELECT current_balance FROM public.accounts WHERE id=(SELECT id FROM a2_vars WHERE name='source')),1000::numeric,'NaN preserves balance');
INSERT INTO tap_runs SELECT throws_ok($q$UPDATE public.accounts SET initial_balance='NaN' WHERE id=(SELECT id FROM a2_vars WHERE name='source')$q$,'23514',NULL,'Catalog NaN constraint');

INSERT INTO a2_vars VALUES('cardtx',public.fn_create_transaction_with_splits(p_workspace_id=>(SELECT id FROM a2_vars WHERE name='ws'),p_description=>'One-off card',p_amount=>25,p_transaction_date=>'2026-09-26',p_credit_card_id=>(SELECT id FROM a2_vars WHERE name='card'),p_account_id=>(SELECT id FROM a2_vars WHERE name='source')));
INSERT INTO a2_vars SELECT 'bill',credit_card_bill_id FROM public.transactions WHERE id=(SELECT id FROM a2_vars WHERE name='cardtx');
INSERT INTO tap_runs SELECT ok((SELECT id IS NOT NULL FROM a2_vars WHERE name='bill'),'Card expense associated');
INSERT INTO tap_runs SELECT is((SELECT reference_month FROM public.credit_card_bills WHERE id=(SELECT id FROM a2_vars WHERE name='bill')),'2026-10','Correct closing cycle');
INSERT INTO tap_runs SELECT is((SELECT due_date FROM public.transactions WHERE id=(SELECT id FROM a2_vars WHERE name='cardtx')),'2026-11-05'::date,'Bill due date used');
INSERT INTO tap_runs SELECT is((SELECT total_amount FROM public.credit_card_bills WHERE id=(SELECT id FROM a2_vars WHERE name='bill')),25::numeric,'New bill total');
INSERT INTO tap_runs SELECT is((SELECT current_balance FROM public.accounts WHERE id=(SELECT id FROM a2_vars WHERE name='source')),1000::numeric,'Contextual card account is not debited');
INSERT INTO tap_runs SELECT throws_ok($q$SELECT public.fn_create_transaction_with_splits(p_workspace_id=>(SELECT id FROM a2_vars WHERE name='ws'),p_description=>'Direct card payment',p_amount=>1,p_status=>'paid',p_account_id=>(SELECT id FROM a2_vars WHERE name='source'),p_credit_card_id=>(SELECT id FROM a2_vars WHERE name='card'))$q$,'P0001',NULL,'Context account does not allow direct card payment');
UPDATE public.accounts SET active=false WHERE id=(SELECT id FROM a2_vars WHERE name='source');
INSERT INTO tap_runs SELECT throws_ok($q$SELECT public.fn_create_transaction_with_splits(p_workspace_id=>(SELECT id FROM a2_vars WHERE name='ws'),p_description=>'Inactive context',p_amount=>1,p_transaction_date=>'2026-09-26',p_account_id=>(SELECT id FROM a2_vars WHERE name='source'),p_credit_card_id=>(SELECT id FROM a2_vars WHERE name='card'))$q$,'P0001',NULL,'Inactive context account rejected');
UPDATE public.accounts SET active=true WHERE id=(SELECT id FROM a2_vars WHERE name='source');
INSERT INTO tap_runs SELECT is((SELECT total_amount FROM public.credit_card_bills WHERE id=(SELECT id FROM a2_vars WHERE name='bill')),25::numeric,'Rejected card operations rollback bill total');
INSERT INTO tap_runs SELECT throws_ok($q$SELECT public.fn_create_transaction_with_splits(p_workspace_id=>(SELECT id FROM a2_vars WHERE name='ws'),p_description=>'Foreign context',p_amount=>1,p_transaction_date=>'2026-09-26',p_account_id=>'a2400000-0000-0000-0000-000000000099',p_credit_card_id=>(SELECT id FROM a2_vars WHERE name='card'))$q$,'P0001',NULL,'Foreign/missing context account rejected');
INSERT INTO tap_runs SELECT is((SELECT current_balance FROM public.accounts WHERE id=(SELECT id FROM a2_vars WHERE name='source')),1000::numeric,'Rejected contextual operations preserve account');
INSERT INTO a2_vars VALUES('cardtx2',public.fn_create_transaction_with_splits(p_workspace_id=>(SELECT id FROM a2_vars WHERE name='ws'),p_description=>'Existing bill',p_amount=>40,p_transaction_date=>'2026-09-27',p_credit_card_id=>(SELECT id FROM a2_vars WHERE name='card'),p_credit_card_bill_id=>(SELECT id FROM a2_vars WHERE name='bill')));
INSERT INTO tap_runs SELECT is((SELECT total_amount FROM public.credit_card_bills WHERE id=(SELECT id FROM a2_vars WHERE name='bill')),65::numeric,'Existing bill increments once');
SELECT public.fn_delete_transaction((SELECT id FROM a2_vars WHERE name='ws'),(SELECT id FROM a2_vars WHERE name='cardtx2'));
INSERT INTO tap_runs SELECT is((SELECT total_amount FROM public.credit_card_bills WHERE id=(SELECT id FROM a2_vars WHERE name='bill')),25::numeric,'Deletion reconciles bill');
INSERT INTO a2_vars VALUES('billpayment',public.fn_record_payment(p_workspace_id=>(SELECT id FROM a2_vars WHERE name='ws'),p_account_id=>(SELECT id FROM a2_vars WHERE name='source'),p_amount=>25,p_credit_card_bill_id=>(SELECT id FROM a2_vars WHERE name='bill')));
INSERT INTO tap_runs SELECT is((SELECT status FROM public.transactions WHERE id=(SELECT id FROM a2_vars WHERE name='cardtx')),'paid','One-off card payable via bill');
SELECT public.fn_update_transaction_with_splits(p_workspace_id=>(SELECT id FROM a2_vars WHERE name='ws'),p_transaction_id=>(SELECT id FROM a2_vars WHERE name='cardtx'),p_notes=>'Metadata only');
INSERT INTO tap_runs SELECT is((SELECT credit_card_bill_id FROM public.transactions WHERE id=(SELECT id FROM a2_vars WHERE name='cardtx')),(SELECT id FROM a2_vars WHERE name='bill'),'Metadata preserves bill association');
INSERT INTO tap_runs SELECT is((SELECT status FROM public.transactions WHERE id=(SELECT id FROM a2_vars WHERE name='cardtx')),'paid','Metadata preserves bill-paid status');
INSERT INTO tap_runs SELECT throws_ok($q$SELECT public.fn_update_transaction_with_splits(p_workspace_id=>(SELECT id FROM a2_vars WHERE name='ws'),p_transaction_id=>(SELECT id FROM a2_vars WHERE name='cardtx'),p_amount=>26)$q$,'P0001',NULL,'Billed amount cannot desynchronize total');
INSERT INTO tap_runs SELECT throws_ok($q$SELECT public.fn_update_transaction_with_splits(p_workspace_id=>(SELECT id FROM a2_vars WHERE name='ws'),p_transaction_id=>(SELECT id FROM a2_vars WHERE name='cardtx'),p_transaction_date=>'2027-01-01')$q$,'P0001',NULL,'Billed date cannot switch cycle');
SELECT public.fn_delete_payment((SELECT id FROM a2_vars WHERE name='ws'),(SELECT id FROM a2_vars WHERE name='billpayment'));

INSERT INTO a2_vars VALUES('deposit',public.fn_record_goal_deposit((SELECT id FROM a2_vars WHERE name='ws'),(SELECT id FROM a2_vars WHERE name='goal'),(SELECT id FROM a2_vars WHERE name='source'),100,'deposit-1'));
INSERT INTO tap_runs SELECT is((SELECT current_balance FROM public.accounts WHERE id=(SELECT id FROM a2_vars WHERE name='source')),900::numeric,'Goal deposit debits persisted account');
INSERT INTO tap_runs SELECT is((SELECT current_amount FROM public.financial_goals WHERE id=(SELECT id FROM a2_vars WHERE name='goal')),100::numeric,'Goal deposit credits goal');
INSERT INTO tap_runs SELECT is(public.fn_record_goal_deposit((SELECT id FROM a2_vars WHERE name='ws'),(SELECT id FROM a2_vars WHERE name='goal'),(SELECT id FROM a2_vars WHERE name='source'),100,'deposit-1'),(SELECT id FROM a2_vars WHERE name='deposit'),'Same key returns same operation');
INSERT INTO tap_runs SELECT is((SELECT current_balance FROM public.accounts WHERE id=(SELECT id FROM a2_vars WHERE name='source')),900::numeric,'Retry does not debit twice');
INSERT INTO tap_runs SELECT throws_ok($q$SELECT public.fn_record_goal_deposit((SELECT id FROM a2_vars WHERE name='ws'),(SELECT id FROM a2_vars WHERE name='goal'),(SELECT id FROM a2_vars WHERE name='source'),101,'deposit-1')$q$,'P0001',NULL,'Conflicting retry rejected');
SELECT public.fn_record_goal_deposit((SELECT id FROM a2_vars WHERE name='ws'),(SELECT id FROM a2_vars WHERE name='goal'),(SELECT id FROM a2_vars WHERE name='source'),10.075,'deposit-2');
INSERT INTO tap_runs SELECT is((SELECT current_amount FROM public.financial_goals WHERE id=(SELECT id FROM a2_vars WHERE name='goal')),110.08::numeric,'Second deposit uses canonical cents');
SELECT public.fn_reverse_goal_deposit((SELECT id FROM a2_vars WHERE name='ws'),(SELECT id FROM a2_vars WHERE name='deposit'));
SELECT public.fn_reverse_goal_deposit((SELECT id FROM a2_vars WHERE name='ws'),(SELECT id FROM a2_vars WHERE name='deposit'));
INSERT INTO tap_runs SELECT is((SELECT current_balance FROM public.accounts WHERE id=(SELECT id FROM a2_vars WHERE name='source')),989.92::numeric,'Goal reversal idempotent');
INSERT INTO tap_runs SELECT is((SELECT current_amount FROM public.financial_goals WHERE id=(SELECT id FROM a2_vars WHERE name='goal')),10.08::numeric,'Goal reversal removes exactly contribution');
INSERT INTO tap_runs SELECT ok(NOT has_table_privilege('authenticated','public.goal_deposits','INSERT'),'Journal cannot be inserted directly');
INSERT INTO tap_runs SELECT ok(NOT has_table_privilege('authenticated','public.goal_deposits','TRUNCATE'),'Journal cannot be truncated');
UPDATE public.workspaces SET tracking_mode='expense_tracker' WHERE id=(SELECT id FROM a2_vars WHERE name='ws');
INSERT INTO tap_runs SELECT throws_ok($q$SELECT public.fn_record_goal_deposit((SELECT id FROM a2_vars WHERE name='ws'),(SELECT id FROM a2_vars WHERE name='goal'),(SELECT id FROM a2_vars WHERE name='source'),1,'tracker')$q$,'P0001',NULL,'Tracker deposit denied');
INSERT INTO tap_runs SELECT is((SELECT current_balance FROM public.accounts WHERE id=(SELECT id FROM a2_vars WHERE name='source')),989.92::numeric,'Rejected deposit preserves account');
UPDATE public.workspaces SET tracking_mode='full' WHERE id=(SELECT id FROM a2_vars WHERE name='ws');
UPDATE public.accounts SET active=false WHERE id=(SELECT id FROM a2_vars WHERE name='source');
INSERT INTO tap_runs SELECT throws_ok($q$SELECT public.fn_record_goal_deposit((SELECT id FROM a2_vars WHERE name='ws'),(SELECT id FROM a2_vars WHERE name='goal'),(SELECT id FROM a2_vars WHERE name='source'),1,'inactive')$q$,'P0001',NULL,'Inactive account deposit denied');
INSERT INTO tap_runs SELECT throws_ok($q$SELECT public.fn_record_goal_deposit((SELECT id FROM a2_vars WHERE name='ws'),'a2400000-0000-0000-0000-000000000099',(SELECT id FROM a2_vars WHERE name='dest'),1,'foreign')$q$,'P0001',NULL,'Foreign/missing goal denied');
INSERT INTO tap_runs SELECT throws_ok($q$SELECT public.fn_record_goal_deposit((SELECT id FROM a2_vars WHERE name='ws'),(SELECT id FROM a2_vars WHERE name='goal'),(SELECT id FROM a2_vars WHERE name='dest'),'NaN','nan')$q$,'P0001',NULL,'NaN goal deposit rejected');
INSERT INTO tap_runs SELECT is((SELECT current_amount FROM public.financial_goals WHERE id=(SELECT id FROM a2_vars WHERE name='goal')),10.08::numeric,'Rejected deposits preserve goal');
RESET ROLE;
SELECT count(*)::int AS ran,50 AS planned,count(*) FILTER(WHERE msg LIKE 'not ok%')::int AS failed,
 COALESCE((SELECT jsonb_agg(x) FROM finish() x),'[]'::jsonb) AS finish_diagnostics FROM tap_runs;
SELECT msg FROM tap_runs WHERE msg LIKE 'not ok%';
ROLLBACK;
