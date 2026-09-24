-- ==============================================================================
-- TESTE 06: ATOMICIDADE DE RPCS E ROLLBACK APÓS FALHA PARCIAL
-- ==============================================================================
BEGIN;
SELECT plan(9);

-- 1. Setup: Usuário, Workspace, Conta de R$ 500,00 e Transação de R$ 100,00 com IDs fixos
INSERT INTO auth.users (id, aud, role, email)
VALUES ('40000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'atomic_owner@test.com');

CREATE TEMPORARY TABLE atomic_vars AS
SELECT 
    (SELECT id FROM public.workspaces WHERE owner_id = '40000000-0000-0000-0000-000000000001' LIMIT 1) AS ws_id,
    '40000000-0000-0000-0000-000000000010'::UUID AS acc_id,
    '40000000-0000-0000-0000-000000000020'::UUID AS tx_id;
GRANT ALL ON atomic_vars TO authenticated, anon;

INSERT INTO public.accounts (id, workspace_id, name, type, initial_balance, current_balance)
SELECT acc_id, ws_id, 'Conta Carteira', 'checking', 500.00, 500.00 FROM atomic_vars;

INSERT INTO public.transactions (id, workspace_id, description, amount, type, status)
SELECT tx_id, ws_id, 'Conta de Luz', 100.00, 'expense', 'pending' FROM atomic_vars;

-- Autenticar como Owner
SET LOCAL "request.jwt.claim.sub" = '40000000-0000-0000-0000-000000000001';
SET LOCAL role = 'authenticated';

-- ==============================================================================
-- 2. FALHA EM RPC: PAGAMENTO COM VALOR SUPERIOR AO RESTANTE (OVERPAYMENT)
-- ==============================================================================

-- 2.1. Tentativa de pagar R$ 150,00 para transação de R$ 100,00 deve falhar
SELECT throws_ok(
    'SELECT fn_record_payment(
        (SELECT ws_id FROM atomic_vars),
        (SELECT acc_id FROM atomic_vars),
        150.00,
        CURRENT_DATE,
        (SELECT tx_id FROM atomic_vars)
    )',
    'Valor do pagamento (R$ 150.00) excede o saldo restante da transação (R$ 100.00).',
    'fn_record_payment rejeita pagamento que excede saldo da transação'
);

-- 2.2. Verificar que o saldo da conta permanece INTACTO em R$ 500,00
SELECT is(
    (SELECT current_balance FROM public.accounts WHERE id = (SELECT acc_id FROM atomic_vars)),
    500.00::NUMERIC,
    'Saldo da conta bancária permaneceu inalterado após falha da RPC'
);

-- 2.3. Verificar que nenhum registro de pagamento foi inserido
SELECT is(
    (SELECT count(*)::INT FROM public.payments WHERE transaction_id = (SELECT tx_id FROM atomic_vars)),
    0,
    'Nenhum pagamento parcial ou sujo foi registrado no banco'
);

-- 2.4. Verificar que a transação permanece com status "pending"
SELECT is(
    (SELECT status FROM public.transactions WHERE id = (SELECT tx_id FROM atomic_vars)),
    'pending',
    'Status da transação permaneceu "pending"'
);

-- ==============================================================================
-- 3. FALHA EM SAVEPOINT / SUBTRANSAÇÃO E ROLLBACK LIMPO
-- ==============================================================================
SAVEPOINT sp_before_fail;

-- Inserção parcial seguida de falha em RPC de rateio
INSERT INTO public.transactions (workspace_id, description, amount, type, status)
SELECT ws_id, 'Transação Que Falhará no Rateio', 200.00, 'expense', 'pending' FROM atomic_vars;

-- Chamar fn_set_transaction_splits com soma inválida dentro da subtransação
SELECT throws_ok(
    'SELECT fn_set_transaction_splits(
        (SELECT ws_id FROM atomic_vars),
        (SELECT id FROM public.transactions WHERE description = ''Transação Que Falhará no Rateio''),
        jsonb_build_array(
            jsonb_build_object(''member_id'', (SELECT id FROM public.workspace_members WHERE user_id = ''40000000-0000-0000-0000-000000000001''), ''amount'', 99.00)
        )
    )',
    'A soma das frações do rateio (R$ 99.00) deve ser exatamente igual ao valor total da transação (R$ 200.00).',
    'fn_set_transaction_splits falha por soma incompatível'
);

-- Reverter para o savepoint
ROLLBACK TO SAVEPOINT sp_before_fail;

-- 3.1. Confirmar que a transação criada na subtransação revertida desapareceu
SELECT is(
    (SELECT count(*)::INT FROM public.transactions WHERE description = 'Transação Que Falhará no Rateio'),
    0,
    'Transação e rateio da subtransação abortada foram revertidos integralmente'
);

-- ==============================================================================
-- 4. BLOQUEIO DE CHAMADAS ANÔNIMAS (UNAUTHENTICATED)
-- ==============================================================================
SET LOCAL role = 'anon';
SET LOCAL "request.jwt.claim.sub" = '';

SELECT throws_ok(
    'SELECT fn_create_workspace(''Workspace Sem Auth'', ''BRL'', ''full'')',
    '42501',
    NULL,
    'fn_create_workspace bloqueia usuário anônimo por negação de privilégio'
);

SELECT throws_ok(
    'SELECT fn_create_transfer(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 50.00)',
    '42501',
    NULL,
    'fn_create_transfer bloqueia usuário anônimo por negação de privilégio'
);

SELECT throws_ok(
    'SELECT fn_record_settlement(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 100.00)',
    '42501',
    NULL,
    'fn_record_settlement bloqueia usuário anônimo por negação de privilégio'
);

SELECT * FROM finish();
SELECT extensions._get('curr_test')::int AS ran, extensions._get('plan')::int AS planned, extensions.num_failed()::int AS failed, ARRAY(SELECT * FROM extensions.finish()) AS finish_diagnostics;
ROLLBACK;
