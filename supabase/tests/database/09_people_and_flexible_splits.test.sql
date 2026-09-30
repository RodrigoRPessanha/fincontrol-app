-- ==============================================================================
-- TESTE 09: PESSOAS NÃO-MEMBROS E RATEIO/ACERTO FLEXÍVEL DE CONTAS
-- ==============================================================================
BEGIN;
SELECT plan(46);

-- 1. Setup: Dois usuários e dois workspaces para testar isolamento e rateio flexível
INSERT INTO auth.users (id, aud, role, email)
VALUES
    ('90000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'people_owner1@test.com'),
    ('90000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'people_owner2@test.com');

CREATE TEMPORARY TABLE test_vars AS
SELECT
    (SELECT id FROM public.workspaces WHERE owner_id = '90000000-0000-0000-0000-000000000001' LIMIT 1) AS ws1_id,
    (SELECT id FROM public.workspace_members WHERE user_id = '90000000-0000-0000-0000-000000000001' LIMIT 1) AS m1_id,
    (SELECT id FROM public.workspaces WHERE owner_id = '90000000-0000-0000-0000-000000000002' LIMIT 1) AS ws2_id,
    (SELECT id FROM public.workspace_members WHERE user_id = '90000000-0000-0000-0000-000000000002' LIMIT 1) AS m2_id;
GRANT ALL ON test_vars TO authenticated, anon;

CREATE TEMPORARY TABLE tap_runs (msg text);
GRANT ALL ON tap_runs TO authenticated, anon;

-- Autenticar como Usuário 1 (Workspace 1 tem apenas 1 membro: owner1)
SET LOCAL "request.jwt.claim.sub" = '90000000-0000-0000-0000-000000000001';
SET LOCAL role = 'authenticated';

-- ==============================================================================
-- 2. CADASTRO DE PESSOAS POR NOME (SEM AUTH.USERS NEM WORKSPACE_MEMBERS)
-- ==============================================================================

-- 2.1. Inserir pessoa no workspace 1
INSERT INTO tap_runs SELECT lives_ok(
    'INSERT INTO public.people (id, workspace_id, name)
     SELECT ''90000000-0000-0000-0000-000000000010''::UUID, ws1_id, ''Carlos Silva'' FROM test_vars',
    'Usuário autenticado pode cadastrar pessoa apenas pelo nome no seu workspace'
);

-- 2.2. Inserir segunda pessoa no workspace 1
INSERT INTO tap_runs SELECT lives_ok(
    'INSERT INTO public.people (id, workspace_id, name)
     SELECT ''90000000-0000-0000-0000-000000000011''::UUID, ws1_id, ''Mariana Costa'' FROM test_vars',
    'Usuário autenticado pode cadastrar segunda pessoa'
);

-- 2.3. Unicidade de nome ativo no mesmo workspace (case-insensitive)
INSERT INTO tap_runs SELECT throws_ok(
    'INSERT INTO public.people (workspace_id, name)
     SELECT ws1_id, ''  carlos silva  '' FROM test_vars',
    '23505',
    NULL,
    'Não permite duplicar nome ativo no mesmo workspace'
);

-- 2.4. Validação de nome não-vazio
INSERT INTO tap_runs SELECT throws_ok(
    'INSERT INTO public.people (workspace_id, name)
     SELECT ws1_id, ''   '' FROM test_vars',
    '23514',
    NULL,
    'Não permite cadastrar pessoa com nome vazio ou apenas espaços'
);

-- ==============================================================================
-- 3. ISOLAMENTO RLS ENTRE WORKSPACES PARA PEOPLE
-- ==============================================================================

-- 3.1. Trocar para Usuário 2 (Workspace 2)
SET LOCAL "request.jwt.claim.sub" = '90000000-0000-0000-0000-000000000002';
SET LOCAL role = 'authenticated';

-- 3.2. Usuário 2 não enxerga pessoas do Workspace 1
INSERT INTO tap_runs SELECT is(
    (SELECT count(*)::INT FROM public.people WHERE name = 'Carlos Silva'),
    0,
    'RLS impede usuário de ver pessoas cadastradas em outro workspace'
);

-- 3.3. Usuário 2 não pode inserir pessoas em Workspace 1
INSERT INTO tap_runs SELECT throws_ok(
    'INSERT INTO public.people (workspace_id, name)
     SELECT ws1_id, ''Invasor'' FROM test_vars',
    '42501',
    NULL,
    'RLS impede usuário de inserir pessoa em workspace alheio'
);

-- Inserir pessoa no workspace 2 para testes cruzados
INSERT INTO public.people (id, workspace_id, name)
SELECT '90000000-0000-0000-0000-000000000020'::UUID, ws2_id, 'Pessoa do WS2' FROM test_vars;

-- ==============================================================================
-- 4. TRANSAÇÕES E COMPRAS COM RATEIO FLEXÍVEL (MEMBER + PERSON)
-- ==============================================================================
SET LOCAL "request.jwt.claim.sub" = '90000000-0000-0000-0000-000000000001';
SET LOCAL role = 'authenticated';

-- 4.1. Criar transação com rateio entre membro e pessoa via RPC
INSERT INTO tap_runs SELECT lives_ok(
    'SELECT fn_create_transaction_with_splits(
        (SELECT ws1_id FROM test_vars),
        ''Aluguel Casa de Praia'',
        200.00,
        CURRENT_DATE,
        ''expense'',
        ''pending'',
        NULL, NULL, NULL, NULL, NULL,
        ''Dividido com Carlos'',
        (SELECT m1_id FROM test_vars),
        ''equal'',
        CURRENT_DATE,
        jsonb_build_array(
            jsonb_build_object(''member_id'', (SELECT m1_id FROM test_vars), ''amount'', 100.00, ''percentage'', 50.00),
            jsonb_build_object(''person_id'', ''90000000-0000-0000-0000-000000000010''::UUID, ''amount'', 100.00, ''percentage'', 50.00)
        ),
        NULL
    )',
    'Cria transação com rateio 50/50 entre membro do workspace e pessoa cadastrada'
);

-- 4.2. Criar transação paga por uma pessoa (paid_by_person_id)
INSERT INTO tap_runs SELECT lives_ok(
    'SELECT fn_create_transaction_with_splits(
        (SELECT ws1_id FROM test_vars),
        ''Mercado pago por Carlos'',
        80.00,
        CURRENT_DATE,
        ''expense'',
        ''pending'',
        NULL, NULL, NULL, NULL, NULL,
        ''Carlos pagou tudo'',
        NULL,
        ''equal'',
        CURRENT_DATE,
        jsonb_build_array(
            jsonb_build_object(''member_id'', (SELECT m1_id FROM test_vars), ''amount'', 40.00, ''percentage'', 50.00),
            jsonb_build_object(''person_id'', ''90000000-0000-0000-0000-000000000010''::UUID, ''amount'', 40.00, ''percentage'', 50.00)
        ),
        ''90000000-0000-0000-0000-000000000010''::UUID
    )',
    'Cria transação indicando paid_by_person_id'
);

-- 4.3. Bloqueio de paid_by_member_id e paid_by_person_id simultaneamente
INSERT INTO tap_runs SELECT throws_ok(
    'SELECT fn_create_transaction_with_splits(
        (SELECT ws1_id FROM test_vars),
        ''Transação Inválida'',
        50.00,
        CURRENT_DATE,
        ''expense'',
        ''pending'',
        NULL, NULL, NULL, NULL, NULL,
        NULL,
        (SELECT m1_id FROM test_vars),
        ''individual'',
        CURRENT_DATE,
        NULL,
        ''90000000-0000-0000-0000-000000000010''::UUID
    )',
    'P0001',
    NULL,
    'Bloqueia definição simultânea de member e person como pagador da transação'
);

-- 4.4. Bloqueio de paid_by_person de outro workspace
INSERT INTO tap_runs SELECT throws_ok(
    'SELECT fn_create_transaction_with_splits(
        (SELECT ws1_id FROM test_vars),
        ''Transação Cross-Workspace'',
        50.00,
        CURRENT_DATE,
        ''expense'',
        ''pending'',
        NULL, NULL, NULL, NULL, NULL,
        NULL,
        NULL,
        ''individual'',
        CURRENT_DATE,
        NULL,
        ''90000000-0000-0000-0000-000000000020''::UUID
    )',
    'P0001',
    NULL,
    'Bloqueia paid_by_person_id de outro workspace'
);

-- 4.5. Bloqueio de fração de rateio com person_id de outro workspace
INSERT INTO tap_runs SELECT throws_ok(
    'SELECT fn_create_transaction_with_splits(
        (SELECT ws1_id FROM test_vars),
        ''Transação Rateio Cross-WS'',
        100.00,
        CURRENT_DATE,
        ''expense'',
        ''pending'',
        NULL, NULL, NULL, NULL, NULL,
        NULL,
        (SELECT m1_id FROM test_vars),
        ''equal'',
        CURRENT_DATE,
        jsonb_build_array(
            jsonb_build_object(''member_id'', (SELECT m1_id FROM test_vars), ''amount'', 50.00, ''percentage'', 50.00),
            jsonb_build_object(''person_id'', ''90000000-0000-0000-0000-000000000020''::UUID, ''amount'', 50.00, ''percentage'', 50.00)
        ),
        NULL
    )',
    'P0001',
    NULL,
    'Bloqueia fração de rateio com person_id pertencente a outro workspace'
);

-- 4.6. Bloqueio de fração sem member_id nem person_id
INSERT INTO tap_runs SELECT throws_ok(
    'SELECT fn_create_transaction_with_splits(
        (SELECT ws1_id FROM test_vars),
        ''Transação Sem Participante'',
        100.00,
        CURRENT_DATE,
        ''expense'',
        ''pending'',
        NULL, NULL, NULL, NULL, NULL,
        NULL,
        (SELECT m1_id FROM test_vars),
        ''equal'',
        CURRENT_DATE,
        jsonb_build_array(
            jsonb_build_object(''amount'', 100.00, ''percentage'', 100.00)
        ),
        NULL
    )',
    'P0001',
    NULL,
    'Bloqueia fração de rateio sem participante informado'
);

-- 4.7. Bloqueio de fração com member_id E person_id simultaneamente
INSERT INTO tap_runs SELECT throws_ok(
    'SELECT fn_create_transaction_with_splits(
        (SELECT ws1_id FROM test_vars),
        ''Transação Ambos Participantes'',
        100.00,
        CURRENT_DATE,
        ''expense'',
        ''pending'',
        NULL, NULL, NULL, NULL, NULL,
        NULL,
        (SELECT m1_id FROM test_vars),
        ''equal'',
        CURRENT_DATE,
        jsonb_build_array(
            jsonb_build_object(''member_id'', (SELECT m1_id FROM test_vars), ''person_id'', ''90000000-0000-0000-0000-000000000010''::UUID, ''amount'', 100.00, ''percentage'', 100.00)
        ),
        NULL
    )',
    'P0001',
    NULL,
    'Bloqueia fração de rateio com ambos os identificadores preenchidos'
);

-- 4.8. Conservação exata de rateio com pessoas
INSERT INTO tap_runs SELECT throws_ok(
    'SELECT fn_create_transaction_with_splits(
        (SELECT ws1_id FROM test_vars),
        ''Rateio Divergente'',
        100.00,
        CURRENT_DATE,
        ''expense'',
        ''pending'',
        NULL, NULL, NULL, NULL, NULL,
        NULL,
        (SELECT m1_id FROM test_vars),
        ''custom'',
        CURRENT_DATE,
        jsonb_build_array(
            jsonb_build_object(''member_id'', (SELECT m1_id FROM test_vars), ''amount'', 60.00, ''percentage'', 60.00),
            jsonb_build_object(''person_id'', ''90000000-0000-0000-0000-000000000010''::UUID, ''amount'', 39.99, ''percentage'', 39.99)
        ),
        NULL
    )',
    'P0001',
    NULL,
    'Exige conservação exata ao centavo no rateio com pessoas'
);

-- ==============================================================================
-- 5. COMPRAS PARCELADAS COM RATEIO ENTRE PESSOAS (PURCHASE_SPLITS)
-- ==============================================================================

-- 5.1. Criar compra parcelada com rateio com pessoa
INSERT INTO tap_runs SELECT lives_ok(
    'SELECT fn_create_purchase_with_splits(
        (SELECT ws1_id FROM test_vars),
        ''TV da Sala'',
        1200.00,
        3,
        CURRENT_DATE,
        NULL, NULL, NULL, NULL, 0,
        (SELECT m1_id FROM test_vars),
        ''equal'',
        jsonb_build_array(
            jsonb_build_object(''member_id'', (SELECT m1_id FROM test_vars), ''amount'', 600.00, ''percentage'', 50.00),
            jsonb_build_object(''person_id'', ''90000000-0000-0000-0000-000000000010''::UUID, ''amount'', 600.00, ''percentage'', 50.00)
        ),
        NULL
    )',
    'Cria compra parcelada com rateio entre membro e pessoa cadastrada'
);

-- 5.2. Criar compra paga por pessoa externa (paid_by_person_id)
INSERT INTO tap_runs SELECT lives_ok(
    'SELECT fn_create_purchase_with_splits(
        (SELECT ws1_id FROM test_vars),
        ''Sofá da Sala'',
        900.00,
        2,
        CURRENT_DATE,
        NULL, NULL, NULL, NULL, 0,
        NULL,
        ''equal'',
        jsonb_build_array(
            jsonb_build_object(''member_id'', (SELECT m1_id FROM test_vars), ''amount'', 450.00, ''percentage'', 50.00),
            jsonb_build_object(''person_id'', ''90000000-0000-0000-0000-000000000010''::UUID, ''amount'', 450.00, ''percentage'', 50.00)
        ),
        ''90000000-0000-0000-0000-000000000010''::UUID
    )',
    'Cria compra parcelada indicando paid_by_person_id'
);

-- ==============================================================================
-- 6. ACERTOS DE CONTAS COM PESSOAS (SETTLEMENTS)
-- ==============================================================================

-- 6.0. Registrar despesa paga por Mariana dividida com Carlos para criar dívida entre pessoas
INSERT INTO tap_runs SELECT lives_ok(
    'SELECT fn_create_transaction_with_splits(
        (SELECT ws1_id FROM test_vars),
        ''Lanche pago por Mariana'',
        50.00,
        CURRENT_DATE,
        ''expense'',
        ''pending'',
        NULL, NULL, NULL, NULL, NULL,
        ''Mariana pagou'',
        NULL,
        ''equal'',
        CURRENT_DATE,
        jsonb_build_array(
            jsonb_build_object(''person_id'', ''90000000-0000-0000-0000-000000000011''::UUID, ''amount'', 25.00, ''percentage'', 50.00),
            jsonb_build_object(''person_id'', ''90000000-0000-0000-0000-000000000010''::UUID, ''amount'', 25.00, ''percentage'', 50.00)
        ),
        ''90000000-0000-0000-0000-000000000011''::UUID
    )',
    'Cria despesa paga por Mariana gerando dívida de Carlos com Mariana'
);

-- 6.1. Bloqueio de acerto sem dívida correspondente: Membro tenta pagar Pessoa (m1 -> Carlos)
INSERT INTO tap_runs SELECT throws_ok(
    'SELECT fn_record_settlement(
        (SELECT ws1_id FROM test_vars),
        (SELECT m1_id FROM test_vars),
        NULL,
        50.00,
        CURRENT_DATE,
        ''Acerto sem divida'',
        NULL,
        NULL,
        ''90000000-0000-0000-0000-000000000010''::UUID
    )',
    'P0001',
    'Não há débito pendente registrado entre o pagador e o recebedor informados.',
    'Bloqueia acerto quando não há débito pendente do pagador para o recebedor'
);

-- 6.2. Bloqueio de acerto que excede o saldo devedor calculado (Carlos deve 210 para m1, tenta pagar 250)
INSERT INTO tap_runs SELECT throws_ok(
    'SELECT fn_record_settlement(
        (SELECT ws1_id FROM test_vars),
        NULL,
        (SELECT m1_id FROM test_vars),
        250.00,
        CURRENT_DATE,
        ''Carlos pagando a mais'',
        NULL,
        ''90000000-0000-0000-0000-000000000010''::UUID,
        NULL
    )',
    'P0001',
    'O valor do acerto (R$ 250.00) excede a dívida pendente de R$ 210.00.',
    'Bloqueia acerto cujo valor excede o saldo devedor máximo apurado'
);

-- 6.3. Acerto válido: Pessoa paga para Membro (Carlos -> m1 R$ 30,00)
INSERT INTO tap_runs SELECT lives_ok(
    'SELECT fn_record_settlement(
        (SELECT ws1_id FROM test_vars),
        NULL,
        (SELECT m1_id FROM test_vars),
        30.00,
        CURRENT_DATE,
        ''Carlos pagou sua parte'',
        NULL,
        ''90000000-0000-0000-0000-000000000010''::UUID,
        NULL
    )',
    'Registra acerto de pessoa não-membro pagando para membro respeitando limite da dívida'
);

-- 6.4. Acerto válido entre pessoas: Carlos paga Mariana R$ 25,00 (Carlos -> Mariana)
INSERT INTO tap_runs SELECT lives_ok(
    'SELECT fn_record_settlement(
        (SELECT ws1_id FROM test_vars),
        NULL,
        NULL,
        25.00,
        CURRENT_DATE,
        ''Carlos pagou Mariana'',
        NULL,
        ''90000000-0000-0000-0000-000000000010''::UUID,
        ''90000000-0000-0000-0000-000000000011''::UUID
    )',
    'Registra acerto direto entre duas pessoas não-membros quitando dívida pendente'
);

-- 6.5. Bloqueio de auto-acerto (mesma pessoa devedora e credora)
INSERT INTO tap_runs SELECT throws_ok(
    'SELECT fn_record_settlement(
        (SELECT ws1_id FROM test_vars),
        NULL,
        NULL,
        10.00,
        CURRENT_DATE,
        ''Auto acerto'',
        NULL,
        ''90000000-0000-0000-0000-000000000010''::UUID,
        ''90000000-0000-0000-0000-000000000010''::UUID
    )',
    'P0001',
    NULL,
    'Bloqueia acerto entre a mesma pessoa'
);

-- 6.6. Bloqueio de pessoa de outro workspace em settlement
INSERT INTO tap_runs SELECT throws_ok(
    'SELECT fn_record_settlement(
        (SELECT ws1_id FROM test_vars),
        (SELECT m1_id FROM test_vars),
        NULL,
        20.00,
        CURRENT_DATE,
        ''Acerto cross-ws'',
        NULL,
        NULL,
        ''90000000-0000-0000-0000-000000000020''::UUID
    )',
    'P0001',
    NULL,
    'Bloqueia acerto com pessoa pertencente a outro workspace'
);

-- 6.7. Exclusão segura de acerto via RPC fn_delete_settlement por Owner/Admin
INSERT INTO tap_runs SELECT lives_ok(
    'SELECT fn_delete_settlement(
        (SELECT id FROM public.settlements WHERE notes = ''Carlos pagou sua parte'' LIMIT 1),
        (SELECT ws1_id FROM test_vars)
    )',
    'Owner pode excluir acerto exclusivamente através de fn_delete_settlement'
);

-- ==============================================================================
-- 7. INTEGRIDADE HISTÓRICA E RESTRIÇÃO DE EXCLUSÃO (RESTRICT)
-- ==============================================================================

-- 7.1. Tentativa de excluir pessoa que possui transações/splits/acertos (RESTRICT)
INSERT INTO tap_runs SELECT throws_ok(
    'DELETE FROM public.people WHERE id = ''90000000-0000-0000-0000-000000000010''::UUID',
    '23503',
    NULL,
    'Exclusão de pessoa com histórico é estritamente bloqueada por FK RESTRICT'
);

-- 7.2. Arquivamento e renomeação preservam histórico perfeitamente
INSERT INTO tap_runs SELECT lives_ok(
    'UPDATE public.people
     SET archived = true, name = ''Carlos Silva (Arquivado)''
     WHERE id = ''90000000-0000-0000-0000-000000000010''::UUID',
    'Permite renomear ou arquivar pessoa sem alterar ou perder histórico'
);

-- 7.3. Após arquivar, permite cadastrar nova pessoa com o mesmo nome original
INSERT INTO tap_runs SELECT lives_ok(
    'INSERT INTO public.people (workspace_id, name)
     SELECT ws1_id, ''Carlos Silva'' FROM test_vars',
    'Permite reutilizar nome para nova pessoa ativa após o arquivamento da anterior'
);

-- 7.4. Exclusão direta permitida para pessoa sem qualquer histórico
INSERT INTO public.people (id, workspace_id, name)
SELECT '90000000-0000-0000-0000-000000000099'::UUID, ws1_id, 'Pessoa Sem Historico' FROM test_vars;

INSERT INTO tap_runs SELECT lives_ok(
    'DELETE FROM public.people WHERE id = ''90000000-0000-0000-0000-000000000099''::UUID',
    'Permite exclusão limpa de pessoa sem histórico vinculado'
);

-- 7.5. Tentativa de alterar workspace_id de uma pessoa é bloqueada por trigger
INSERT INTO tap_runs SELECT throws_ok(
    'UPDATE public.people
     SET workspace_id = (SELECT ws2_id FROM test_vars)
     WHERE id = ''90000000-0000-0000-0000-000000000011''::UUID',
    'P0001',
    NULL,
    'Trigger impede alteração de workspace_id em people'
);

-- ==============================================================================
-- 8. CONSERVAÇÃO E CONTROLE DE MUTAÇÃO DIRETA EM TABELAS DE SPLIT
-- ==============================================================================

-- 8.1. INSERT direto em transaction_splits com person_id é bloqueado no nível de grant
INSERT INTO tap_runs SELECT throws_ok(
    'INSERT INTO public.transaction_splits (workspace_id, transaction_id, person_id, amount)
     VALUES ((SELECT ws1_id FROM test_vars), gen_random_uuid(), ''90000000-0000-0000-0000-000000000011''::UUID, 100.00)',
    '42501',
    NULL,
    'INSERT direto em transaction_splits continua bloqueado por falta de privilégio DML'
);

-- 8.2. INSERT direto em purchase_splits com person_id é bloqueado no nível de grant
INSERT INTO tap_runs SELECT throws_ok(
    'INSERT INTO public.purchase_splits (workspace_id, purchase_id, person_id, amount)
     VALUES ((SELECT ws1_id FROM test_vars), gen_random_uuid(), ''90000000-0000-0000-0000-000000000011''::UUID, 100.00)',
    '42501',
    NULL,
    'INSERT direto em purchase_splits continua bloqueado por falta de privilégio DML'
);

-- 8.3. INSERT direto em settlements é bloqueado por falta de privilégio DML (revogação de escrita direta)
INSERT INTO tap_runs SELECT throws_ok(
    'INSERT INTO public.settlements (workspace_id, from_member_id, amount, settlement_date)
     VALUES ((SELECT ws1_id FROM test_vars), (SELECT m1_id FROM test_vars), 10.00, CURRENT_DATE)',
    '42501',
    NULL,
    'INSERT direto em settlements é bloqueado por falta de privilégio DML (escrita revogada)'
);

-- 8.4. DELETE direto em settlements é bloqueado por falta de privilégio DML (exclusão apenas via RPC)
INSERT INTO tap_runs SELECT throws_ok(
    'DELETE FROM public.settlements WHERE workspace_id = (SELECT ws1_id FROM test_vars)',
    '42501',
    NULL,
    'DELETE direto em settlements é bloqueado por falta de privilégio DML (escrita revogada)'
);

-- ==============================================================================
-- 9. SINCRONIZAÇÃO DE TRANSAÇÕES AVULSAS EM FATURA QUITADA POR REDUÇÃO DE COMPRA (MIGRATION 038)
-- ==============================================================================

-- Reset role para superuser para inserção segura de fixtures
RESET role;

-- Setup da fatura, cartão, transação avulsa e compra
INSERT INTO public.credit_cards (id, workspace_id, name, closing_day, due_day, credit_limit)
SELECT 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::UUID, ws1_id, 'Cartão Fatura Sync', 10, 20, 5000.00
FROM test_vars;

INSERT INTO public.credit_card_bills (id, workspace_id, credit_card_id, reference_month, closing_date, due_date, total_amount, paid_amount, status)
SELECT 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::UUID, ws1_id, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::UUID, '2026-11', '2026-11-10'::DATE, '2026-11-20'::DATE, 200.00, 150.00, 'partially_paid'
FROM test_vars;

INSERT INTO public.transactions (id, workspace_id, description, amount, type, status, credit_card_id, credit_card_bill_id)
SELECT 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::UUID, ws1_id, 'Transação Avulsa Fatura', 50.00, 'expense', 'pending', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::UUID, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::UUID
FROM test_vars;

INSERT INTO public.purchases (id, workspace_id, description, total_amount, installment_count, purchase_date, credit_card_id)
SELECT 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::UUID, ws1_id, 'Compra Fatura Sync', 150.00, 1, '2026-11-01'::DATE, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::UUID
FROM test_vars;

INSERT INTO public.installments (id, purchase_id, installment_number, amount, due_date, status, credit_card_bill_id)
SELECT 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::UUID, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::UUID, 1, 150.00, '2026-11-20'::DATE, 'pending', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::UUID
FROM test_vars;

-- Retoma autenticação como Usuário 1 (Owner)
SET LOCAL "request.jwt.claim.sub" = '90000000-0000-0000-0000-000000000001';
SET LOCAL role = 'authenticated';

-- 9.1. Reduzir a compra de R$ 150,00 para R$ 100,00 via fn_update_purchase_with_splits
INSERT INTO tap_runs SELECT lives_ok(
    'SELECT fn_update_purchase_with_splits(
        (SELECT ws1_id FROM test_vars),
        ''eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee''::UUID,
        ''Compra Fatura Sync Reduzida'',
        100.00,
        ''2026-11-01''::DATE
    )',
    'fn_update_purchase_with_splits reduz compra vinculada a fatura com sucesso'
);

-- 9.2. Fatura fica quitada (status = paid)
INSERT INTO tap_runs SELECT is(
    (SELECT status FROM public.credit_card_bills WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::UUID),
    'paid',
    'Fatura de cartão passa para status paid ao ter total reduzido ao valor já pago'
);

-- 9.3. Transação avulsa vinculada à fatura é sincronizada para status = paid
INSERT INTO tap_runs SELECT is(
    (SELECT status FROM public.transactions WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::UUID),
    'paid',
    'Transação avulsa vinculada à fatura é sincronizada para status paid com a quitação da fatura'
);

-- 9.4. Transação avulsa vinculada à fatura tem paid_at preenchido
INSERT INTO tap_runs SELECT ok(
    (SELECT paid_at IS NOT NULL FROM public.transactions WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::UUID),
    'Transação avulsa vinculada à fatura recebe timestamp em paid_at'
);

-- ==============================================================================
-- 10. SERIALIZAÇÃO COMPLETA DE MUTAÇÕES DE DÍVIDA (MIGRATION 038)
-- ==============================================================================

RESET role;
INSERT INTO public.transactions (id, workspace_id, description, amount, type, status)
SELECT '11111111-1111-4111-8111-111111111111'::UUID, ws1_id, 'Transação Lock Sec 10', 100.00, 'expense', 'pending'
FROM test_vars;

INSERT INTO public.purchases (id, workspace_id, description, total_amount, installment_count, purchase_date)
SELECT '22222222-2222-4222-8222-222222222222'::UUID, ws1_id, 'Compra Lock Sec 10', 200.00, 2, '2026-11-01'::DATE
FROM test_vars;

INSERT INTO public.installments (id, purchase_id, installment_number, amount, due_date, status)
SELECT '33333333-3333-4333-8333-333333333333'::UUID, '22222222-2222-4222-8222-222222222222'::UUID, 1, 100.00, '2026-11-20'::DATE, 'pending';
INSERT INTO public.installments (id, purchase_id, installment_number, amount, due_date, status)
SELECT '44444444-4444-4444-8444-444444444444'::UUID, '22222222-2222-4222-8222-222222222222'::UUID, 2, 100.00, '2026-12-20'::DATE, 'pending';

SET LOCAL "request.jwt.claim.sub" = '90000000-0000-0000-0000-000000000001';
SET LOCAL role = 'authenticated';

-- 10.1. Atualizar rateio de transação via fn_set_transaction_splits com person_id
INSERT INTO tap_runs SELECT lives_ok(
    'SELECT fn_set_transaction_splits(
        (SELECT ws1_id FROM test_vars),
        ''11111111-1111-4111-8111-111111111111''::UUID,
        jsonb_build_array(
            jsonb_build_object(''member_id'', (SELECT m1_id FROM test_vars), ''amount'', 60.00, ''percentage'', 60.00),
            jsonb_build_object(''person_id'', ''90000000-0000-0000-0000-000000000010''::UUID, ''amount'', 40.00, ''percentage'', 40.00)
        )
    )',
    'fn_set_transaction_splits adquire locks compartilhados e atualiza rateios flexíveis com sucesso'
);

-- 10.2. Atualizar rateio de compra via fn_set_purchase_splits com person_id
INSERT INTO tap_runs SELECT lives_ok(
    'SELECT fn_set_purchase_splits(
        (SELECT ws1_id FROM test_vars),
        ''22222222-2222-4222-8222-222222222222''::UUID,
        jsonb_build_array(
            jsonb_build_object(''member_id'', (SELECT m1_id FROM test_vars), ''amount'', 100.00, ''percentage'', 50.00),
            jsonb_build_object(''person_id'', ''90000000-0000-0000-0000-000000000010''::UUID, ''amount'', 100.00, ''percentage'', 50.00)
        )
    )',
    'fn_set_purchase_splits adquire locks compartilhados e atualiza rateios flexíveis com sucesso'
);

-- 10.3. Excluir transação via fn_delete_transaction com locks de workspace prévios
INSERT INTO tap_runs SELECT lives_ok(
    'SELECT fn_delete_transaction(
        (SELECT ws1_id FROM test_vars),
        ''11111111-1111-4111-8111-111111111111''::UUID
    )',
    'fn_delete_transaction adquire locks de workspace ordenados e exclui transação com sucesso'
);

-- 10.4. Excluir compra via fn_delete_purchase com locks de workspace prévios
INSERT INTO tap_runs SELECT lives_ok(
    'SELECT fn_delete_purchase(
        (SELECT ws1_id FROM test_vars),
        ''22222222-2222-4222-8222-222222222222''::UUID
    )',
    'fn_delete_purchase adquire locks de workspace ordenados e exclui compra com sucesso'
);

-- ==============================================================================
-- 11. ISOLAMENTO DE ESTADO DE QUITAÇÃO ENTRE FATURAS DISTINTAS (MIGRATION 039)
-- ==============================================================================

RESET role;

-- Setup: 2 Faturas distintas para o mesmo cartão
INSERT INTO public.credit_card_bills (id, workspace_id, credit_card_id, reference_month, closing_date, due_date, total_amount, paid_amount, status)
SELECT 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::UUID, ws1_id, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::UUID, '2026-12', '2026-12-10'::DATE, '2026-12-20'::DATE, 100.01, 100.00, 'partially_paid'
FROM test_vars;

INSERT INTO public.credit_card_bills (id, workspace_id, credit_card_id, reference_month, closing_date, due_date, total_amount, paid_amount, status)
SELECT 'bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::UUID, ws1_id, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::UUID, '2027-01', '2027-01-10'::DATE, '2027-01-20'::DATE, 100.00, 0.00, 'open'
FROM test_vars;

-- Compra de R$ 200,01 com parcelas de R$ 100,01 (Fatura 1) e R$ 100,00 (Fatura 2)
INSERT INTO public.purchases (id, workspace_id, description, total_amount, installment_count, purchase_date, credit_card_id)
SELECT '55555555-5555-4555-8555-555555555555'::UUID, ws1_id, 'Compra Multi Fatura Sec 11', 200.01, 2, '2026-12-01'::DATE, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::UUID
FROM test_vars;

INSERT INTO public.installments (id, purchase_id, installment_number, amount, due_date, status, credit_card_bill_id, paid_amount)
SELECT '66666666-6666-4666-8666-666666666661'::UUID, '55555555-5555-4555-8555-555555555555'::UUID, 1, 100.01, '2026-12-20'::DATE, 'pending', 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::UUID, 0.00;

INSERT INTO public.installments (id, purchase_id, installment_number, amount, due_date, status, credit_card_bill_id, paid_amount)
SELECT '66666666-6666-4666-8666-666666666662'::UUID, '55555555-5555-4555-8555-555555555555'::UUID, 2, 100.00, '2027-01-20'::DATE, 'pending', 'bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::UUID, 0.00;

SET LOCAL "request.jwt.claim.sub" = '90000000-0000-0000-0000-000000000001';
SET LOCAL role = 'authenticated';

-- 11.1. Reduz a compra para R$ 200,00 (Parcela 1 vira R$ 100,00 com v_diff = -0.01; Parcela 2 vira R$ 100,00 com v_diff = 0)
INSERT INTO tap_runs SELECT lives_ok(
    'SELECT fn_update_purchase_with_splits(
        (SELECT ws1_id FROM test_vars),
        ''55555555-5555-4555-8555-555555555555''::UUID,
        ''Compra Multi Fatura Sec 11 Reduzida'',
        200.00,
        ''2026-12-01''::DATE
    )',
    'fn_update_purchase_with_splits reduz compra com múltiplas faturas sem contaminação'
);

-- 11.2. Parcela 1 fica paid pois sua fatura (Fatura 1) atingiu o valor pago
INSERT INTO tap_runs SELECT is(
    (SELECT status FROM public.installments WHERE id = '66666666-6666-4666-8666-666666666661'::UUID),
    'paid',
    'Parcela 1 fica paid pois a Fatura 1 teve seu total reduzido ao valor pago'
);

-- 11.3. Parcela 2 NÃO é contaminada e permanece pending (Fatura 2 não tem pagamento)
INSERT INTO tap_runs SELECT is(
    (SELECT status FROM public.installments WHERE id = '66666666-6666-4666-8666-666666666662'::UUID),
    'pending',
    'Parcela 2 permanece pending com isolamento estrito de estado por fatura'
);

-- 11.4. Parcela 2 mantém paid_amount = 0.00
INSERT INTO tap_runs SELECT is(
    (SELECT paid_amount FROM public.installments WHERE id = '66666666-6666-4666-8666-666666666662'::UUID),
    0.00,
    'Parcela 2 mantém paid_amount zerado sem herdar quitação espúria'
);

-- 11.5. Fatura 2 permanece open
INSERT INTO tap_runs SELECT is(
    (SELECT status FROM public.credit_card_bills WHERE id = 'bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::UUID),
    'open',
    'Fatura 2 continua com status open sem pagamentos'
);

SELECT (SELECT array_agg(msg) FROM tap_runs WHERE msg LIKE 'not ok%') AS not_ok_messages,
       extensions._get('curr_test')::int AS ran,
       extensions._get('plan')::int AS planned,
       extensions.num_failed()::int AS failed,
       ARRAY(SELECT * FROM extensions.finish()) AS finish_diagnostics;
ROLLBACK;
