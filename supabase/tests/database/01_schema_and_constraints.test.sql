-- ==============================================================================
-- TESTE 01: SCHEMA E CONSTRAINTS ESTRUTURAIS V38
-- ==============================================================================
BEGIN;
SELECT plan(23);

-- 1. Extensões
SELECT has_extension('uuid-ossp', 'Extensão uuid-ossp instalada');
SELECT has_extension('pgtap', 'Extensão pgtap instalada');

-- 2. Tabelas centrais e V38
SELECT has_table('public', 'workspaces', 'Tabela workspaces existe');
SELECT has_table('public', 'workspace_members', 'Tabela workspace_members existe');
SELECT has_table('public', 'accounts', 'Tabela accounts existe');
SELECT has_table('public', 'credit_cards', 'Tabela credit_cards existe');
SELECT has_table('public', 'credit_card_bills', 'Tabela credit_card_bills existe');
SELECT has_table('public', 'transactions', 'Tabela transactions existe');
SELECT has_table('public', 'purchases', 'Tabela purchases existe');
SELECT has_table('public', 'installments', 'Tabela installments existe');
SELECT has_table('public', 'payments', 'Tabela payments existe');
SELECT has_table('public', 'transfers', 'Tabela transfers existe');
SELECT has_table('public', 'transaction_splits', 'Tabela transaction_splits existe');
SELECT has_table('public', 'purchase_splits', 'Tabela purchase_splits existe');
SELECT has_table('public', 'settlements', 'Tabela settlements existe');

-- 3. Colunas V38
SELECT has_column('public', 'workspaces', 'tracking_mode', 'workspaces.tracking_mode existe');
SELECT has_column('public', 'payments', 'affects_balance', 'payments.affects_balance existe');
SELECT has_column('public', 'transfers', 'idempotency_key', 'transfers.idempotency_key existe');
SELECT has_column('public', 'transactions', 'paid_by_member_id', 'transactions.paid_by_member_id existe');
SELECT has_column('public', 'transactions', 'split_type', 'transactions.split_type existe');
SELECT has_column('public', 'purchases', 'paid_by_member_id', 'purchases.paid_by_member_id existe');
SELECT has_column('public', 'purchases', 'split_type', 'purchases.split_type existe');

-- 4. Constraints
SELECT has_check('public', 'settlements', 'Tabela settlements possui check constraints');

SELECT * FROM finish();
SELECT extensions._get('curr_test')::int AS ran, extensions._get('plan')::int AS planned, extensions.num_failed()::int AS failed, ARRAY(SELECT * FROM extensions.finish()) AS finish_diagnostics;
ROLLBACK;
