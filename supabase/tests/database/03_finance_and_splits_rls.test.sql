-- ==============================================================================
-- TESTE 03: PERMISSÕES RBAC POR PAPEL (VIEWER, MEMBER, ADMIN, OWNER)
-- ==============================================================================
BEGIN;
SELECT plan(13);

-- 1. Setup: 4 usuários com papéis distintos no mesmo workspace
INSERT INTO auth.users (id, aud, role, email)
VALUES 
    ('10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'owner@test.com'),
    ('10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'admin@test.com'),
    ('10000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'member@test.com'),
    ('10000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'viewer@test.com');

CREATE TEMPORARY TABLE rbac_vars AS
SELECT 
    (SELECT id FROM public.workspaces WHERE owner_id = '10000000-0000-0000-0000-000000000001' LIMIT 1) AS ws_id;
GRANT ALL ON rbac_vars TO authenticated, anon;

-- Vincular os demais usuários com seus respectivos papéis
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT ws_id, '10000000-0000-0000-0000-000000000002', 'admin' FROM rbac_vars;
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT ws_id, '10000000-0000-0000-0000-000000000003', 'member' FROM rbac_vars;
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT ws_id, '10000000-0000-0000-0000-000000000004', 'viewer' FROM rbac_vars;

-- Criar conta e transação inicial como superuser
INSERT INTO public.accounts (id, workspace_id, name, type, current_balance)
SELECT 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', ws_id, 'Conta Principal', 'checking', 1000.00 FROM rbac_vars;

INSERT INTO public.transactions (id, workspace_id, description, amount, type, status)
SELECT 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', ws_id, 'Despesa Base', 100.00, 'expense', 'pending' FROM rbac_vars;

-- ==============================================================================
-- 2. TESTES COMO VIEWER
-- ==============================================================================
SET LOCAL "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000004';
SET LOCAL role = 'authenticated';

-- 2.1. Viewer pode ler transações
SELECT is(
    (SELECT count(*)::INT FROM public.transactions WHERE workspace_id = (SELECT ws_id FROM rbac_vars)),
    1,
    'Viewer pode consultar transações do workspace'
);

-- 2.2. Viewer é impedido de inserir transação
SELECT throws_ok(
    'INSERT INTO public.transactions (workspace_id, description, amount, type) SELECT ws_id, ''Despesa Viewer'', 50.00, ''expense'' FROM rbac_vars',
    '42501',
    NULL,
    'Viewer é impedido pelo RLS de criar transações'
);

-- 2.3. Viewer é impedido de executar RPC de acerto de contas
SELECT throws_ok(
    'SELECT fn_record_settlement((SELECT ws_id FROM rbac_vars), ''10000000-0000-0000-0000-000000000003'', ''10000000-0000-0000-0000-000000000002'', 50.00)',
    'Acesso negado: você não possui permissão de escrita neste workspace.',
    'Viewer é impedido de executar fn_record_settlement'
);

-- ==============================================================================
-- 3. TESTES COMO MEMBER
-- ==============================================================================
SET LOCAL "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000003';
SET LOCAL role = 'authenticated';

-- 3.1. Member pode criar transação
SELECT lives_ok(
    'INSERT INTO public.transactions (workspace_id, description, amount, type) SELECT ws_id, ''Despesa Member'', 75.00, ''expense'' FROM rbac_vars',
    'Member pode criar transações no workspace'
);

-- 3.2. Member pode registrar acerto de contas via RPC
SELECT lives_ok(
    'SELECT fn_record_settlement((SELECT ws_id FROM rbac_vars), 
        (SELECT id FROM public.workspace_members WHERE user_id = ''10000000-0000-0000-0000-000000000003'' AND workspace_id = (SELECT ws_id FROM rbac_vars)), 
        (SELECT id FROM public.workspace_members WHERE user_id = ''10000000-0000-0000-0000-000000000002'' AND workspace_id = (SELECT ws_id FROM rbac_vars)), 
        50.00)',
    'Member pode registrar acertos de contas via fn_record_settlement'
);

-- 3.3. Member NÃO pode excluir acerto de contas (apenas admin/owner)
DELETE FROM public.settlements WHERE workspace_id = (SELECT ws_id FROM rbac_vars);
SELECT is(
    (SELECT count(*)::INT FROM public.settlements WHERE workspace_id = (SELECT ws_id FROM rbac_vars)),
    1,
    'Member é impedido pelo RLS de deletar acertos financeiros (acerto permanece intacto)'
);

-- 3.4. Member NÃO pode excluir workspace
DELETE FROM public.workspaces WHERE id = (SELECT ws_id FROM rbac_vars);
SELECT is(
    (SELECT count(*)::INT FROM public.workspaces WHERE id = (SELECT ws_id FROM rbac_vars)),
    1,
    'Member é impedido pelo RLS de deletar o workspace (workspace permanece intacto)'
);

-- ==============================================================================
-- 4. TESTES COMO ADMIN
-- ==============================================================================
SET LOCAL "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000002';
SET LOCAL role = 'authenticated';

-- 4.1. Admin pode excluir acertos de contas
SELECT lives_ok(
    'DELETE FROM public.settlements WHERE workspace_id = (SELECT ws_id FROM rbac_vars)',
    'Admin pode excluir acertos de contas'
);

-- 4.2. Admin pode gerenciar membros não-owners
SELECT lives_ok(
    'UPDATE public.workspace_members SET role = ''member'' 
     WHERE user_id = ''10000000-0000-0000-0000-000000000004'' AND workspace_id = (SELECT ws_id FROM rbac_vars)',
    'Admin pode atualizar papel de membros comuns'
);

-- 4.3. Admin NÃO pode alterar diretamente o owner_id do workspace
SELECT throws_ok(
    'UPDATE public.workspaces SET owner_id = ''10000000-0000-0000-0000-000000000002'' WHERE id = (SELECT ws_id FROM rbac_vars)',
    'A alteração direta de owner_id é proibida. Utilize a função fn_transfer_workspace_ownership.',
    'Admin é bloqueado por trigger ao tentar usurpar ownership diretamente'
);

-- 4.4. Admin NÃO pode transferir ownership via RPC (apenas o owner atual)
SELECT throws_ok(
    'SELECT fn_transfer_workspace_ownership((SELECT ws_id FROM rbac_vars), ''10000000-0000-0000-0000-000000000002'')',
    'Apenas o proprietário atual pode transferir a posse do workspace.',
    'Admin é impedido de executar fn_transfer_workspace_ownership'
);

-- ==============================================================================
-- 5. TESTES COMO OWNER
-- ==============================================================================
SET LOCAL "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000001';
SET LOCAL role = 'authenticated';

-- 5.1. Owner pode transferir ownership via RPC oficial
SELECT lives_ok(
    'SELECT fn_transfer_workspace_ownership((SELECT ws_id FROM rbac_vars), ''10000000-0000-0000-0000-000000000002'')',
    'Owner pode transferir com sucesso a propriedade do workspace'
);

-- 5.2. Verificar que o novo owner agora é o Admin
SELECT is(
    (SELECT owner_id FROM public.workspaces WHERE id = (SELECT ws_id FROM rbac_vars)),
    '10000000-0000-0000-0000-000000000002'::UUID,
    'A transferência de ownership atualizou o owner_id corretamente'
);

SELECT * FROM finish();
SELECT extensions._get('curr_test')::int AS ran, extensions._get('plan')::int AS planned, extensions.num_failed()::int AS failed, ARRAY(SELECT * FROM extensions.finish()) AS finish_diagnostics;
ROLLBACK;
