BEGIN;
SELECT plan(9);
CREATE TEMP TABLE calendar_results(msg text);
CREATE TEMP TABLE calendar_card AS SELECT NULL::public.credit_cards AS card;
UPDATE calendar_card SET card=jsonb_populate_record(NULL::public.credit_cards,'{"closing_day":22,"due_day":1,"closing_days_before_due":7}');
INSERT INTO calendar_results SELECT is((SELECT closing_date FROM calendar_card c,public.fn_card_cycle_calendar(c.card,'2026-02-01')),date '2026-02-22','February relative closing');
INSERT INTO calendar_results SELECT is((SELECT due_date FROM calendar_card c,public.fn_card_cycle_calendar(c.card,'2026-02-01')),date '2026-03-01','Due day one remains next month');
INSERT INTO calendar_results SELECT is((SELECT closing_date FROM calendar_card c,public.fn_card_cycle_calendar(c.card,'2026-03-01')),date '2026-03-25','March closing changes with calendar');
INSERT INTO calendar_results SELECT is((SELECT closing_date FROM calendar_card c,public.fn_card_cycle_calendar(c.card,'2028-02-01')),date '2028-02-23','Leap year closing');
INSERT INTO calendar_results SELECT is((SELECT due_date FROM calendar_card c,public.fn_card_cycle_calendar(c.card,'2026-12-01')),date '2027-01-01','Year rollover');
INSERT INTO calendar_results SELECT ok(NOT has_function_privilege('authenticated','public.fn_card_cycle_calendar(public.credit_cards,date)','EXECUTE'),'Calendar helper is private');
INSERT INTO calendar_results SELECT ok(NOT has_function_privilege('anon','public.fn_card_purchase_cycle(uuid,date,boolean)','EXECUTE'),'Purchase cycle helper is private');
UPDATE calendar_card SET card=jsonb_populate_record(card,'{"due_day":31}');
INSERT INTO calendar_results SELECT is((SELECT closing_date FROM calendar_card c,public.fn_card_cycle_calendar(c.card,'2026-02-01')),date '2026-02-21','Due day clamps before subtracting offset');
UPDATE calendar_card SET card=jsonb_populate_record(card,'{"due_day":1,"closing_days_before_due":null}');
INSERT INTO calendar_results SELECT is((SELECT closing_date FROM calendar_card c,public.fn_card_cycle_calendar(c.card,'2026-02-01')),date '2026-02-22','Fixed mode remains unchanged');
SELECT (SELECT array_agg(msg) FROM calendar_results WHERE msg LIKE 'not ok%') AS not_ok_messages,
 extensions._get('curr_test')::int AS ran,extensions._get('plan')::int AS planned,extensions.num_failed()::int AS failed,ARRAY(SELECT * FROM extensions.finish()) AS finish_diagnostics;
ROLLBACK;
