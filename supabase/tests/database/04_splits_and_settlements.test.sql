-- ==============================================================================
-- TESTE 04: INTEGRIDADE FINANCEIRA, CONSERVAÇÃO EXATA DE RATEIOS E PROTEÇÃO DIRETA
-- ==============================================================================
BEGIN;
SELECT plan(24);

-- 1. Setup: Workspace com 2 membros e transação/compra com IDs determinísticos
INSERT INTO auth.users (id, aud, role, email)
VALUES 
    ('20000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'split_owner@test.com'),
    ('20000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'split_member@test.com');

INSERT INTO public.workspace_members (workspace_id, user_id, role)
VALUES (
    (SELECT id FROM public.workspaces WHERE owner_id = '20000000-0000-0000-0000-000000000001' LIMIT 1),
    '20000000-0000-0000-0000-000000000002',
    'member'
);

CREATE TEMPORARY TABLE split_vars AS
SELECT 
    ws.id AS ws_id,
    (SELECT id FROM public.workspace_members WHERE user_id = '20000000-0000-0000-0000-000000000001' AND workspace_id = ws.id) AS m1_id,
    (SELECT id FROM public.workspace_members WHERE user_id = '20000000-0000-0000-0000-000000000002' AND workspace_id = ws.id) AS m2_id,
    '20000000-0000-0000-0000-000000000010'::UUID AS tx_id,
    '20000000-0000-0000-0000-000000000020'::UUID AS pur_id
FROM public.workspaces ws
WHERE ws.owner_id = '20000000-0000-0000-0000-000000000001'
LIMIT 1;
GRANT ALL ON split_vars TO authenticated, anon;

-- Inserir transação de R$ 100,00 e compra de R$ 300,00 com IDs fixos
INSERT INTO public.transactions (id, workspace_id, description, amount, type, status, split_type)
SELECT tx_id, ws_id, 'Jantar Compartilhado', 100.00, 'expense', 'pending', 'equal' FROM split_vars;

INSERT INTO public.purchases (id, workspace_id, description, total_amount, installment_count, split_type)
SELECT pur_id, ws_id, 'Televisão Parcelada', 300.00, 3, 'equal' FROM split_vars;

-- Autenticar como Member 1 (Owner)
SET LOCAL "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000001';
SET LOCAL role = 'authenticated';

-- ==============================================================================
-- 2. TESTE DE BLOQUEIO DE MUTAÇÃO DIRETA EM TABELAS DE RATEIO (42501)
-- ==============================================================================

-- 2.1. Bloqueio de INSERT direto em transaction_splits
SELECT throws_ok(
    'INSERT INTO public.transaction_splits (workspace_id, transaction_id, member_id, amount) 
     SELECT ws_id, tx_id, m1_id, 999.00 FROM split_vars',
    '42501',
    NULL,
    'INSERT direto em transaction_splits é bloqueado no nível de permissão'
);

-- 2.2. Bloqueio de INSERT direto em purchase_splits
SELECT throws_ok(
    'INSERT INTO public.purchase_splits (workspace_id, purchase_id, member_id, amount) 
     SELECT ws_id, pur_id, m1_id, 999.00 FROM split_vars',
    '42501',
    NULL,
    'INSERT direto em purchase_splits é bloqueado no nível de permissão'
);

-- 2.3. Bloqueio de INSERT direto em credit_card_bills (Migration 019)
SELECT throws_ok(
    'INSERT INTO public.credit_card_bills (workspace_id, credit_card_id, reference_month, closing_date, due_date, total_amount)
     SELECT ws_id, ''20000000-0000-0000-0000-000000000030''::UUID, ''2026-05'', ''2026-05-01''::DATE, ''2026-05-10''::DATE, 100.00 FROM split_vars',
    '42501',
    NULL,
    'INSERT direto em credit_card_bills é bloqueado no nível de permissão'
);

-- 2.4. Bloqueio de INSERT direto em installments (Migration 019)
SELECT throws_ok(
    'INSERT INTO public.installments (purchase_id, installment_number, amount, due_date)
     SELECT pur_id, 4, 100.00, ''2026-06-01''::DATE FROM split_vars',
    '42501',
    NULL,
    'INSERT direto em installments é bloqueado no nível de permissão'
);

-- 2.5. Bloqueio de UPDATE direto em credit_card_bills (Migration 019)
SELECT throws_ok(
    'UPDATE public.credit_card_bills SET total_amount = 999.00 WHERE workspace_id = (SELECT ws_id FROM split_vars)',
    '42501',
    NULL,
    'UPDATE direto em credit_card_bills é bloqueado no nível de permissão'
);

-- 2.6. Bloqueio de UPDATE direto em installments (Migration 019)
SELECT throws_ok(
    'UPDATE public.installments SET amount = 999.00 WHERE purchase_id = (SELECT pur_id FROM split_vars)',
    '42501',
    NULL,
    'UPDATE direto em installments é bloqueado no nível de permissão'
);

-- 2.7. Bloqueio de TRUNCATE direto em credit_card_bills (Migration 020)
SELECT throws_ok(
    'TRUNCATE public.credit_card_bills',
    '42501',
    NULL,
    'TRUNCATE direto em credit_card_bills é bloqueado no nível de permissão'
);

-- 2.8. Bloqueio de TRUNCATE direto em installments (Migration 020)
SELECT throws_ok(
    'TRUNCATE public.installments',
    '42501',
    NULL,
    'TRUNCATE direto em installments é bloqueado no nível de permissão'
);

-- 2.9. Confirmação explícita de ausência de privilégios de TRUNCATE, TRIGGER e REFERENCES (Migration 020)
SELECT ok(NOT has_table_privilege('authenticated', 'public.credit_card_bills', 'truncate'), 'authenticated não possui privilégio TRUNCATE em credit_card_bills');
SELECT ok(NOT has_table_privilege('authenticated', 'public.installments', 'truncate'), 'authenticated não possui privilégio TRUNCATE em installments');
SELECT ok(NOT has_table_privilege('authenticated', 'public.credit_card_bills', 'trigger'), 'authenticated não possui privilégio TRIGGER em credit_card_bills');
SELECT ok(NOT has_table_privilege('authenticated', 'public.installments', 'trigger'), 'authenticated não possui privilégio TRIGGER em installments');
SELECT ok(NOT has_table_privilege('authenticated', 'public.credit_card_bills', 'references'), 'authenticated não possui privilégio REFERENCES em credit_card_bills');
SELECT ok(NOT has_table_privilege('authenticated', 'public.installments', 'references'), 'authenticated não possui privilégio REFERENCES em installments');

-- ==============================================================================
-- 3. TESTES DE CONSERVAÇÃO EXATA DE RATEIOS VIA RPC (TOLERÂNCIA ZERO R$ 0,00)
-- ==============================================================================

-- 3.1. Rejeição com diferença de 5 centavos (R$ 50,00 + R$ 49,95 = R$ 99,95 vs R$ 100,00)
SELECT throws_ok(
    'SELECT fn_set_transaction_splits(
        (SELECT ws_id FROM split_vars),
        (SELECT tx_id FROM split_vars),
        jsonb_build_array(
            jsonb_build_object(''member_id'', (SELECT m1_id FROM split_vars), ''amount'', 50.00),
            jsonb_build_object(''member_id'', (SELECT m2_id FROM split_vars), ''amount'', 49.95)
        )
    )',
    'A soma das frações do rateio (R$ 99.95) deve ser exatamente igual ao valor total da transação (R$ 100.00).',
    'fn_set_transaction_splits rejeita diferença de 5 centavos'
);

-- 3.2. Rejeição com diferença de 1 centavo (R$ 50,00 + R$ 50,01 = R$ 100,01 vs R$ 100,00)
SELECT throws_ok(
    'SELECT fn_set_transaction_splits(
        (SELECT ws_id FROM split_vars),
        (SELECT tx_id FROM split_vars),
        jsonb_build_array(
            jsonb_build_object(''member_id'', (SELECT m1_id FROM split_vars), ''amount'', 50.00),
            jsonb_build_object(''member_id'', (SELECT m2_id FROM split_vars), ''amount'', 50.01)
        )
    )',
    'A soma das frações do rateio (R$ 100.01) deve ser exatamente igual ao valor total da transação (R$ 100.00).',
    'fn_set_transaction_splits rejeita diferença de 1 centavo'
);

-- 3.3. Aplicação com soma EXATA (R$ 60,00 + R$ 40,00 = R$ 100,00)
SELECT is(
    (SELECT fn_set_transaction_splits(
        (SELECT ws_id FROM split_vars),
        (SELECT tx_id FROM split_vars),
        jsonb_build_array(
            jsonb_build_object('member_id', (SELECT m1_id FROM split_vars), 'amount', 60.00, 'percentage', 60.00),
            jsonb_build_object('member_id', (SELECT m2_id FROM split_vars), 'amount', 40.00, 'percentage', 40.00)
        )
    )),
    2,
    'fn_set_transaction_splits aplica rateio de soma exata com sucesso'
);

-- 3.4. Conferência dos registros persistidos no rateio da transação
SELECT is(
    (SELECT sum(amount) FROM public.transaction_splits WHERE transaction_id = (SELECT tx_id FROM split_vars)),
    100.00::NUMERIC,
    'Soma persistida no banco é exatamente igual aos R$ 100,00 da transação'
);

-- 3.5. Rejeição de compra com diferença de centavos (R$ 150,00 + R$ 149,95 = R$ 299,95 vs R$ 300,00)
SELECT throws_ok(
    'SELECT fn_set_purchase_splits(
        (SELECT ws_id FROM split_vars),
        (SELECT pur_id FROM split_vars),
        jsonb_build_array(
            jsonb_build_object(''member_id'', (SELECT m1_id FROM split_vars), ''amount'', 150.00),
            jsonb_build_object(''member_id'', (SELECT m2_id FROM split_vars), ''amount'', 149.95)
        )
    )',
    'A soma das frações do rateio (R$ 299.95) deve ser exatamente igual ao valor total da compra (R$ 300.00).',
    'fn_set_purchase_splits rejeita diferença de centavos'
);

-- 3.6. Aplicação de compra com soma EXATA (R$ 150,00 + R$ 150,00 = R$ 300,00)
SELECT is(
    (SELECT fn_set_purchase_splits(
        (SELECT ws_id FROM split_vars),
        (SELECT pur_id FROM split_vars),
        jsonb_build_array(
            jsonb_build_object('member_id', (SELECT m1_id FROM split_vars), 'amount', 150.00, 'percentage', 50.00),
            jsonb_build_object('member_id', (SELECT m2_id FROM split_vars), 'amount', 150.00, 'percentage', 50.00)
        )
    )),
    2,
    'fn_set_purchase_splits aplica rateio parcelado com soma exata com sucesso'
);

-- 3.7. Bloqueio de UPDATE direto em frações existentes
SELECT throws_ok(
    'UPDATE public.transaction_splits SET amount = 99.00 WHERE transaction_id = (SELECT tx_id FROM split_vars)',
    '42501',
    NULL,
    'UPDATE direto em frações de rateio é bloqueado no nível de permissão'
);

-- 3.8. Bloqueio de DELETE direto em frações existentes
SELECT throws_ok(
    'DELETE FROM public.transaction_splits WHERE transaction_id = (SELECT tx_id FROM split_vars)',
    '42501',
    NULL,
    'DELETE direto em frações de rateio é bloqueado no nível de permissão'
);

-- 3.9. Bloqueio parent-side: alteração direta no amount da transação que viole a conservação dos rateios existentes
SELECT throws_ok(
    'UPDATE public.transactions SET amount = 150.00 WHERE id = (SELECT tx_id FROM split_vars)',
    'A alteração do valor da transação (R$ 150.00) viola a conservação das frações de rateio existentes (R$ 100.00). Atualize os rateios via fn_set_transaction_splits.',
    'UPDATE parent-side em transactions.amount é bloqueado por violação de conservação'
);

-- 3.10. Bloqueio parent-side: alteração direta no total_amount da compra que viole a conservação dos rateios existentes
SELECT throws_ok(
    'UPDATE public.purchases SET total_amount = 350.00 WHERE id = (SELECT pur_id FROM split_vars)',
    'A alteração do valor total da compra parcelada (R$ 350.00) viola a conservação das frações de rateio existentes (R$ 300.00). Atualize os rateios via fn_set_purchase_splits.',
    'UPDATE parent-side em purchases.total_amount é bloqueado por violação de conservação'
);

SELECT * FROM finish();
SELECT extensions._get('curr_test')::int AS ran, extensions._get('plan')::int AS planned, extensions.num_failed()::int AS failed, ARRAY(SELECT * FROM extensions.finish()) AS finish_diagnostics;
ROLLBACK;

