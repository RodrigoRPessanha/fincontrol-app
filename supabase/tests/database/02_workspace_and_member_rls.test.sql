-- ==============================================================================
-- TESTE 02: ISOLAMENTO TOTAL ENTRE WORKSPACES E MEMBROS (MULTI-TENANCY)
-- ==============================================================================
BEGIN;
SELECT plan(17);

-- 1. Setup de fixtures temporárias: dois usuários distintos
INSERT INTO auth.users (id, aud, role, email)
VALUES 
    ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'alice@test.com'),
    ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'bob@test.com'),
    ('44444444-4444-4444-4444-444444444444', 'authenticated', 'authenticated', 'charlie@test.com');

-- Obter os workspaces criados automaticamente pelo trigger handle_new_user
CREATE TEMPORARY TABLE test_vars AS
SELECT 
    (SELECT id FROM public.workspaces WHERE owner_id = '11111111-1111-1111-1111-111111111111' LIMIT 1) AS ws_alice,
    (SELECT id FROM public.workspaces WHERE owner_id = '22222222-2222-2222-2222-222222222222' LIMIT 1) AS ws_bob;
GRANT SELECT ON test_vars TO authenticated;

-- Inserir dados no workspace de Bob como superuser
INSERT INTO public.accounts (workspace_id, name, type, initial_balance, current_balance)
SELECT ws_bob, 'Conta Secreta de Bob', 'checking', 5000.00, 5000.00 FROM test_vars;

INSERT INTO public.transactions (workspace_id, description, amount, type, status)
SELECT ws_bob, 'Salário Confidencial Bob', 10000.00, 'income', 'paid' FROM test_vars;

-- 2. Autenticar como ALICE (request.jwt.claim.sub = Alice)
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SET LOCAL role = 'authenticated';

-- 2.1. Alice enxerga apenas o seu próprio workspace
SELECT is(
    (SELECT count(*)::INT FROM public.workspaces),
    1,
    'Alice enxerga exatamente 1 workspace (o seu próprio)'
);

-- 2.2. Workspace de Bob é 100% invisível para Alice
SELECT is(
    (SELECT count(*)::INT FROM public.workspaces WHERE owner_id = '22222222-2222-2222-2222-222222222222'),
    0,
    'Workspace de Bob é invisível para Alice via RLS'
);

-- 2.3. Contas bancárias de Bob são invisíveis para Alice
SELECT is(
    (SELECT count(*)::INT FROM public.accounts WHERE name = 'Conta Secreta de Bob'),
    0,
    'Contas bancárias de Bob são invisíveis para Alice via RLS'
);

-- 2.4. Transações de Bob são invisíveis para Alice
SELECT is(
    (SELECT count(*)::INT FROM public.transactions WHERE description = 'Salário Confidencial Bob'),
    0,
    'Transações de Bob são invisíveis para Alice via RLS'
);

-- 2.5. Tentativa de Alice inserir dados no workspace de Bob é rejeitada pelo RLS
SELECT throws_ok(
    'INSERT INTO public.accounts (workspace_id, name, type) SELECT ws_bob, ''Conta Invasora'', ''checking'' FROM test_vars',
    '42501',
    NULL,
    'Alice é impedida pelo RLS de criar contas no workspace de Bob'
);

-- 2.6. Tentativa de Alice chamar RPC no workspace de Bob é rejeitada
SELECT throws_ok(
    'SELECT fn_create_credit_card_transaction((SELECT ws_bob FROM test_vars), gen_random_uuid(), ''Tentativa Fraude'', 500.00)',
    'Acesso negado: você não possui permissão de escrita neste workspace.',
    'Alice é impedida de invocar RPC no workspace de Bob'
);

-- 2.7. Alice adiciona Charlie ao seu workspace informando o e-mail (resolução automática de UUID)
SELECT ok(
    fn_add_workspace_member((SELECT ws_alice FROM test_vars), 'charlie@test.com', 'member') IS NOT NULL,
    'Alice adiciona Charlie ao seu workspace via e-mail com sucesso'
);

-- 2.8. Charlie agora tem linha em workspace_members com seu UUID canônico
SELECT is(
    (SELECT user_id FROM public.workspace_members WHERE workspace_id = (SELECT ws_alice FROM test_vars) AND user_id = '44444444-4444-4444-4444-444444444444'::UUID),
    '44444444-4444-4444-4444-444444444444'::UUID,
    'Membro gravado possui o UUID canônico exato de Charlie'
);

-- 2.9. Tentativa de adicionar o mesmo usuário novamente é rejeitada
SELECT throws_ok(
    'SELECT fn_add_workspace_member((SELECT ws_alice FROM test_vars), ''charlie@test.com'', ''member'')',
    'O usuário informado já é membro deste workspace.',
    'Adição duplicada do mesmo membro é rejeitada'
);

-- 2.10. Tentativa de adicionar e-mail inexistente é rejeitada com mensagem clara
SELECT throws_ok(
    'SELECT fn_add_workspace_member((SELECT ws_alice FROM test_vars), ''inexistente@test.com'', ''member'')',
    'Nenhum usuário cadastrado foi encontrado com o e-mail: inexistente@test.com',
    'E-mail não cadastrado em profiles é rejeitado'
);

-- 3. Autenticar como BOB (request.jwt.claim.sub = Bob)
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
SET LOCAL role = 'authenticated';

-- 3.1. Bob enxerga seus próprios dados
SELECT is(
    (SELECT count(*)::INT FROM public.workspaces),
    1,
    'Bob enxerga seu próprio workspace'
);

SELECT is(
    (SELECT count(*)::INT FROM public.accounts WHERE name = 'Conta Secreta de Bob'),
    1,
    'Bob enxerga sua própria conta'
);

SELECT is(
    (SELECT count(*)::INT FROM public.transactions WHERE description = 'Salário Confidencial Bob'),
    1,
    'Bob enxerga sua própria transação'
);

-- 3.2. Dados de Alice são invisíveis para Bob
SELECT is(
    (SELECT count(*)::INT FROM public.workspaces WHERE owner_id = '11111111-1111-1111-1111-111111111111'),
    0,
    'Workspace de Alice é invisível para Bob'
);

-- 4. Autenticar como ANÔNIMO (role = anon, sem claims)
SET LOCAL role = 'anon';
SET LOCAL "request.jwt.claim.sub" = '';

SELECT throws_ok(
    'SELECT count(*)::INT FROM public.workspaces',
    '42501',
    NULL,
    'Usuário anônimo não tem permissão para consultar workspaces'
);

SELECT throws_ok(
    'SELECT count(*)::INT FROM public.accounts',
    '42501',
    NULL,
    'Usuário anônimo não tem permissão para consultar contas bancárias'
);

SELECT throws_ok(
    'SELECT public.fn_add_workspace_member(''00000000-0000-0000-0000-000000000001''::UUID, ''test@test.com'', ''member'')',
    '42501',
    NULL,
    'Usuário anônimo não tem permissão para executar fn_add_workspace_member'
);

SELECT * FROM finish();
SELECT extensions._get('curr_test')::int AS ran, extensions._get('plan')::int AS planned, extensions.num_failed()::int AS failed, ARRAY(SELECT * FROM extensions.finish()) AS finish_diagnostics;
ROLLBACK;
