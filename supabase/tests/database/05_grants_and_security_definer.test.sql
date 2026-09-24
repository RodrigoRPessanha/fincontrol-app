-- ==============================================================================
-- TESTE 05: IDEMPOTÊNCIA DE TRANSFERÊNCIAS E REPETIÇÃO SEGURA
-- ==============================================================================
BEGIN;
SELECT plan(10);

-- 1. Setup: Workspace com 2 contas bancárias usando IDs determinísticos
INSERT INTO auth.users (id, aud, role, email)
VALUES ('30000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'transfer_owner@test.com');

CREATE TEMPORARY TABLE transfer_vars AS
SELECT 
    (SELECT id FROM public.workspaces WHERE owner_id = '30000000-0000-0000-0000-000000000001' LIMIT 1) AS ws_id,
    '30000000-0000-0000-0000-000000000010'::UUID AS acc1_id,
    '30000000-0000-0000-0000-000000000020'::UUID AS acc2_id;
GRANT ALL ON transfer_vars TO authenticated;

INSERT INTO public.accounts (id, workspace_id, name, type, initial_balance, current_balance)
SELECT acc1_id, ws_id, 'Conta Origem A', 'checking', 1000.00, 1000.00 FROM transfer_vars;

INSERT INTO public.accounts (id, workspace_id, name, type, initial_balance, current_balance)
SELECT acc2_id, ws_id, 'Conta Destino B', 'savings', 500.00, 500.00 FROM transfer_vars;

-- Autenticar como Owner
SET LOCAL "request.jwt.claim.sub" = '30000000-0000-0000-0000-000000000001';
SET LOCAL role = 'authenticated';

-- ==============================================================================
-- 2. PRIMEIRA EXECUÇÃO DA TRANSFERÊNCIA COM CHAVE DE IDEMPOTÊNCIA
-- ==============================================================================
CREATE TEMPORARY TABLE tx_res1 AS
SELECT fn_create_transfer(
    (SELECT ws_id FROM transfer_vars),
    (SELECT acc1_id FROM transfer_vars),
    (SELECT acc2_id FROM transfer_vars),
    200.00,
    CURRENT_DATE,
    'Transferência Original',
    'idemp-key-abc-001'
) AS transfer_id;

-- 2.1. Transferência criada com sucesso
SELECT ok(
    (SELECT transfer_id IS NOT NULL FROM tx_res1),
    'Primeira chamada de transferência retorna ID gerado'
);

-- 2.2. Saldos atualizados corretamente
SELECT is(
    (SELECT current_balance FROM public.accounts WHERE id = (SELECT acc1_id FROM transfer_vars)),
    800.00::NUMERIC,
    'Saldo da conta origem debitado de 1000 para 800'
);

SELECT is(
    (SELECT current_balance FROM public.accounts WHERE id = (SELECT acc2_id FROM transfer_vars)),
    700.00::NUMERIC,
    'Saldo da conta destino creditado de 500 para 700'
);

-- ==============================================================================
-- 3. SEGUNDA EXECUÇÃO (REPETIÇÃO COM A MESMA CHAVE DE IDEMPOTÊNCIA)
-- ==============================================================================
CREATE TEMPORARY TABLE tx_res2 AS
SELECT fn_create_transfer(
    (SELECT ws_id FROM transfer_vars),
    (SELECT acc1_id FROM transfer_vars),
    (SELECT acc2_id FROM transfer_vars),
    200.00,
    CURRENT_DATE,
    'Tentativa Duplicada em Retry',
    'idemp-key-abc-001'
) AS transfer_id;

-- 3.1. Retorna o MESMO ID da primeira execução
SELECT is(
    (SELECT transfer_id FROM tx_res2),
    (SELECT transfer_id FROM tx_res1),
    'Chamada repetida com mesma chave de idempotência retorna exatamente o mesmo transfer_id'
);

-- 3.2. NÃO debita saldo novamente da conta de origem
SELECT is(
    (SELECT current_balance FROM public.accounts WHERE id = (SELECT acc1_id FROM transfer_vars)),
    800.00::NUMERIC,
    'Saldo da conta origem permanece inalterado em 800 (sem débito duplo)'
);

-- 3.3. NÃO credita saldo novamente na conta de destino
SELECT is(
    (SELECT current_balance FROM public.accounts WHERE id = (SELECT acc2_id FROM transfer_vars)),
    700.00::NUMERIC,
    'Saldo da conta destino permanece inalterado em 700 (sem crédito duplo)'
);

-- 3.4. Exatamente 1 registro persistido com essa chave de idempotência
SELECT is(
    (SELECT count(*)::INT FROM public.transfers WHERE idempotency_key = 'idemp-key-abc-001'),
    1,
    'Tabela transfers contém apenas 1 registro único para a chave idempotente'
);

-- ==============================================================================
-- 4. EXECUÇÃO COM NOVA CHAVE DE IDEMPOTÊNCIA
-- ==============================================================================
CREATE TEMPORARY TABLE tx_res3 AS
SELECT fn_create_transfer(
    (SELECT ws_id FROM transfer_vars),
    (SELECT acc1_id FROM transfer_vars),
    (SELECT acc2_id FROM transfer_vars),
    150.00,
    CURRENT_DATE,
    'Segunda Transferência Legítima',
    'idemp-key-abc-002'
) AS transfer_id;

SELECT isnt(
    (SELECT transfer_id FROM tx_res3),
    (SELECT transfer_id FROM tx_res1),
    'Nova transferência com chave distinta gera novo transfer_id'
);

SELECT is(
    (SELECT current_balance FROM public.accounts WHERE id = (SELECT acc1_id FROM transfer_vars)),
    650.00::NUMERIC,
    'Saldo da conta origem atualizado para 650'
);

SELECT is(
    (SELECT current_balance FROM public.accounts WHERE id = (SELECT acc2_id FROM transfer_vars)),
    850.00::NUMERIC,
    'Saldo da conta destino atualizado para 850'
);

SELECT * FROM finish();
SELECT extensions._get('curr_test')::int AS ran, extensions._get('plan')::int AS planned, extensions.num_failed()::int AS failed, ARRAY(SELECT * FROM extensions.finish()) AS finish_diagnostics;
ROLLBACK;
