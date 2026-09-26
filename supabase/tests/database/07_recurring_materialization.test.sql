-- ==============================================================================
-- TESTE 07: MATERIALIZAÇÃO DE RECORRÊNCIAS NO BANCO COM RPC IDEMPOTENTE
-- ==============================================================================
BEGIN;
SELECT plan(28);

-- ==============================================================================
-- 1. TESTES UNITÁRIOS DA FUNÇÃO FN_STEP_NEXT_OCCURRENCE
-- ==============================================================================

-- 1.1. Frequência semanal avança exatamente 7 dias
SELECT is(
    public.fn_step_next_occurrence('2026-05-01'::DATE, '2026-05-01'::DATE, 'weekly'),
    '2026-05-08'::DATE,
    'fn_step_next_occurrence (weekly) avança 7 dias'
);

-- 1.2. Frequência mensal simples
SELECT is(
    public.fn_step_next_occurrence('2026-05-15'::DATE, '2026-05-15'::DATE, 'monthly'),
    '2026-06-15'::DATE,
    'fn_step_next_occurrence (monthly) avança para o mesmo dia do próximo mês'
);

-- 1.3. Ajuste de fim de mês (clamping): 31 de janeiro para 28 de fevereiro
SELECT is(
    public.fn_step_next_occurrence('2026-01-31'::DATE, '2026-01-31'::DATE, 'monthly'),
    '2026-02-28'::DATE,
    'fn_step_next_occurrence ajusta 31/jan para 28/fev (limite do mês)'
);

-- 1.4. Preservação do dia âncora: de 28 de fevereiro para 31 de março
SELECT is(
    public.fn_step_next_occurrence('2026-02-28'::DATE, '2026-01-31'::DATE, 'monthly'),
    '2026-03-31'::DATE,
    'fn_step_next_occurrence restaura dia âncora 31 ao avançar de fev para mar'
);

-- 1.5. Frequência personalizada com intervalo de dias
SELECT is(
    public.fn_step_next_occurrence('2026-05-01'::DATE, '2026-05-01'::DATE, 'custom', 15),
    '2026-05-16'::DATE,
    'fn_step_next_occurrence (custom) avança o intervalo de dias especificado'
);

-- 1.6. Frequência custom sem intervalo válido deve falhar
SELECT throws_ok(
    'SELECT public.fn_step_next_occurrence(''2026-05-01''::DATE, ''2026-05-01''::DATE, ''custom'', NULL)',
    'Intervalo de dias deve ser maior que zero para frequência personalizada.',
    'fn_step_next_occurrence rejeita custom com intervalo nulo'
);

-- 1.7. Frequência inválida deve falhar
SELECT throws_ok(
    'SELECT public.fn_step_next_occurrence(''2026-05-01''::DATE, ''2026-05-01''::DATE, ''invalid_freq'')',
    'Frequência de recorrência inválida: invalid_freq',
    'fn_step_next_occurrence rejeita frequência desconhecida'
);

-- ==============================================================================
-- 2. SETUP DE DADOS PARA RPC FN_MATERIALIZE_RECURRING_TRANSACTIONS
-- ==============================================================================

INSERT INTO auth.users (id, aud, role, email)
VALUES ('70000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'rec_owner@test.com');

CREATE TEMPORARY TABLE rec_vars AS
SELECT
    (SELECT id FROM public.workspaces WHERE owner_id = '70000000-0000-0000-0000-000000000001' LIMIT 1) AS ws_id,
    '70000000-0000-0000-0000-000000000010'::UUID AS acc_id,
    '70000000-0000-0000-0000-000000000011'::UUID AS inactive_acc_id,
    '70000000-0000-0000-0000-000000000020'::UUID AS cat_id,
    '70000000-0000-0000-0000-000000000021'::UUID AS inactive_cat_id,
    '70000000-0000-0000-0000-000000000030'::UUID AS card_id,
    '70000000-0000-0000-0000-000000000031'::UUID AS card_sameday_id,
    '70000000-0000-0000-0000-000000000032'::UUID AS card_nextmonth_id,
    '70000000-0000-0000-0000-000000000041'::UUID AS rec_simple_id,
    '70000000-0000-0000-0000-000000000042'::UUID AS rec_card_id,
    '70000000-0000-0000-0000-000000000043'::UUID AS rec_catchup_id,
    '70000000-0000-0000-0000-000000000044'::UUID AS rec_expiring_id,
    '70000000-0000-0000-0000-000000000045'::UUID AS rec_inactive_acc_id,
    '70000000-0000-0000-0000-000000000046'::UUID AS rec_inactive_cat_id,
    '70000000-0000-0000-0000-000000000047'::UUID AS rec_income_card_id;
GRANT ALL ON rec_vars TO authenticated, anon;

-- Inserir contas (ativa e inativa)
INSERT INTO public.accounts (id, workspace_id, name, type, initial_balance, current_balance, active)
SELECT acc_id, ws_id, 'Conta Ativa', 'checking', 1000.00, 1000.00, TRUE FROM rec_vars;

INSERT INTO public.accounts (id, workspace_id, name, type, initial_balance, current_balance, active)
SELECT inactive_acc_id, ws_id, 'Conta Inativa', 'checking', 0.00, 0.00, FALSE FROM rec_vars;

-- Inserir categorias (ativa e inativa)
INSERT INTO public.categories (id, workspace_id, name, type, active, color, icon)
SELECT cat_id, ws_id, 'Categoria Ativa', 'expense', TRUE, '#10b981', 'tag' FROM rec_vars;

INSERT INTO public.categories (id, workspace_id, name, type, active, color, icon)
SELECT inactive_cat_id, ws_id, 'Categoria Inativa', 'expense', FALSE, '#ef4444', 'tag' FROM rec_vars;

-- Inserir cartões de crédito: padrão (fechamento 10, vencimento 20), mesmo dia (10 e 10), mês seguinte (25 e 5)
INSERT INTO public.credit_cards (id, workspace_id, name, credit_limit, closing_day, due_day, active)
SELECT card_id, ws_id, 'Cartão Black', 5000.00, 10, 20, TRUE FROM rec_vars;

INSERT INTO public.credit_cards (id, workspace_id, name, credit_limit, closing_day, due_day, active)
SELECT card_sameday_id, ws_id, 'Cartão Mesmo Dia', 3000.00, 10, 10, TRUE FROM rec_vars;

INSERT INTO public.credit_cards (id, workspace_id, name, credit_limit, closing_day, due_day, active)
SELECT card_nextmonth_id, ws_id, 'Cartão Mes Seguinte', 3000.00, 25, 5, TRUE FROM rec_vars;

-- Inserir regras de recorrência para teste
-- 1. Despesa bancária simples mensal
INSERT INTO public.recurring_transactions (id, workspace_id, description, amount, type, frequency, start_date, next_occurrence, account_id, category_id, auto_create, active)
SELECT rec_simple_id, ws_id, 'Aluguel Escritório', 150.00, 'expense', 'monthly', '2026-01-05', '2026-01-05', acc_id, cat_id, TRUE, TRUE FROM rec_vars;

-- 2. Despesa em cartão de crédito mensal
INSERT INTO public.recurring_transactions (id, workspace_id, description, amount, type, frequency, start_date, next_occurrence, credit_card_id, category_id, auto_create, active)
SELECT rec_card_id, ws_id, 'Assinatura Software', 200.00, 'expense', 'monthly', '2026-01-05', '2026-01-05', card_id, cat_id, TRUE, TRUE FROM rec_vars;

-- 3. Catch-up semanal (start 2026-01-01, target 2026-01-22 -> 4 ocorrências: 01, 08, 15, 22)
INSERT INTO public.recurring_transactions (id, workspace_id, description, amount, type, frequency, start_date, next_occurrence, account_id, category_id, auto_create, active)
SELECT rec_catchup_id, ws_id, 'Limpeza Semanal', 50.00, 'expense', 'weekly', '2026-01-01', '2026-01-01', acc_id, cat_id, TRUE, TRUE FROM rec_vars;

-- 4. Expiração com end_date
INSERT INTO public.recurring_transactions (id, workspace_id, description, amount, type, frequency, start_date, next_occurrence, end_date, account_id, auto_create, active)
SELECT rec_expiring_id, ws_id, 'Contrato Temporário', 80.00, 'expense', 'weekly', '2026-01-01', '2026-01-08', '2026-01-10', acc_id, TRUE, TRUE FROM rec_vars;

-- 5. Suspensão por conta inativa
INSERT INTO public.recurring_transactions (id, workspace_id, description, amount, type, frequency, start_date, next_occurrence, account_id, auto_create, active)
SELECT rec_inactive_acc_id, ws_id, 'Recorrência Conta Inativa', 90.00, 'expense', 'monthly', '2026-01-01', '2026-01-01', inactive_acc_id, TRUE, TRUE FROM rec_vars;

-- 6. Suspensão por categoria inativa
INSERT INTO public.recurring_transactions (id, workspace_id, description, amount, type, frequency, start_date, next_occurrence, category_id, auto_create, active)
SELECT rec_inactive_cat_id, ws_id, 'Recorrência Categoria Inativa', 70.00, 'expense', 'monthly', '2026-01-01', '2026-01-01', inactive_cat_id, TRUE, TRUE FROM rec_vars;

-- 7. Suspensão por receita vinculada a cartão de crédito
INSERT INTO public.recurring_transactions (id, workspace_id, description, amount, type, frequency, start_date, next_occurrence, credit_card_id, auto_create, active)
SELECT rec_income_card_id, ws_id, 'Receita em Cartão Inválida', 300.00, 'income', 'monthly', '2026-01-01', '2026-01-01', card_id, TRUE, TRUE FROM rec_vars;

-- Autenticar como Owner do workspace
SET LOCAL "request.jwt.claim.sub" = '70000000-0000-0000-0000-000000000001';
SET LOCAL role = 'authenticated';

-- ==============================================================================
-- 3. EXECUÇÃO E TESTES DE MATERIALIZAÇÃO
-- ==============================================================================

-- 3.1. Materializar recorrência bancária simples para data 2026-01-05
SELECT is(
    (SELECT (public.fn_materialize_recurring_transactions((SELECT ws_id FROM rec_vars), '2026-01-05'::DATE)->>'created_transactions')::INT >= 2),
    TRUE,
    'fn_materialize_recurring_transactions cria transações até a data informada'
);

-- 3.2. Verificar atributos da transação gerada para Rec 1
SELECT is(
    (SELECT amount FROM public.transactions WHERE recurring_transaction_id = (SELECT rec_simple_id FROM rec_vars)),
    150.00::NUMERIC,
    'Transação materializada possui o valor correto de R$ 150.00'
);

-- 3.3. Verificar avanço de next_occurrence da recorrência simples
SELECT is(
    (SELECT next_occurrence FROM public.recurring_transactions WHERE id = (SELECT rec_simple_id FROM rec_vars)),
    '2026-02-05'::DATE,
    'next_occurrence avança deterministamente para o próximo mês'
);

-- 3.4. Idempotência estrita: re-executar na mesma data não gera transações duplicadas
SELECT is(
    (SELECT (public.fn_materialize_recurring_transactions((SELECT ws_id FROM rec_vars), '2026-01-05'::DATE)->>'created_transactions')::INT),
    0,
    'Re-execução da materialização na mesma data não gera novas transações (idempotência)'
);

-- 3.5. Total de transações para Rec 1 permanece exatamente 1
SELECT is(
    (SELECT count(*)::INT FROM public.transactions WHERE recurring_transaction_id = (SELECT rec_simple_id FROM rec_vars)),
    1,
    'Nenhuma duplicata de transação inserida para a mesma ocorrência'
);

-- 3.6. Transação de cartão de crédito possui fatura associada
SELECT is(
    (SELECT credit_card_bill_id IS NOT NULL FROM public.transactions WHERE recurring_transaction_id = (SELECT rec_card_id FROM rec_vars)),
    TRUE,
    'Transação com cartão de crédito vincula automaticamente a fatura correspondente'
);

-- 3.7. Fatura do cartão de crédito tem total_amount atualizado com R$ 200,00
SELECT is(
    (SELECT b.total_amount FROM public.credit_card_bills b
     JOIN public.transactions t ON t.credit_card_bill_id = b.id
     WHERE t.recurring_transaction_id = (SELECT rec_card_id FROM rec_vars)),
    200.00::NUMERIC,
    'Fatura do cartão de crédito é incrementada com o valor da recorrência'
);

-- 3.8. Catch-up semanal: materializar até 2026-01-22 gera 4 ocorrências (01, 08, 15, 22)
SELECT is(
    (SELECT (public.fn_materialize_recurring_transactions((SELECT ws_id FROM rec_vars), '2026-01-22'::DATE)->>'created_transactions')::INT >= 3),
    TRUE,
    'Catch-up acumula e gera múltiplas ocorrências pendentes'
);

SELECT is(
    (SELECT count(*)::INT FROM public.transactions WHERE recurring_transaction_id = (SELECT rec_catchup_id FROM rec_vars)),
    4,
    'Catch-up semanal materializa exatamente 4 ocorrências entre 01/jan e 22/jan'
);

-- 3.9. Recorrência com end_date é desativada após ultrapassar o término
SELECT is(
    (SELECT active FROM public.recurring_transactions WHERE id = (SELECT rec_expiring_id FROM rec_vars)),
    FALSE,
    'Recorrência é desativada automaticamente (active = false) ao atingir end_date'
);

-- 3.10. Suspensão de recorrência com conta inativa
SELECT is(
    (SELECT active = FALSE AND suspended_reason LIKE '%inativa%' FROM public.recurring_transactions WHERE id = (SELECT rec_inactive_acc_id FROM rec_vars)),
    TRUE,
    'Recorrência com conta bancária inativa é suspensa com justificativa gravada'
);

-- 3.11. Suspensão de recorrência com categoria inativa
SELECT is(
    (SELECT active = FALSE AND suspended_reason LIKE '%inativa%' FROM public.recurring_transactions WHERE id = (SELECT rec_inactive_cat_id FROM rec_vars)),
    TRUE,
    'Recorrência com categoria inativa é suspensa com justificativa gravada'
);

-- 3.12. Suspensão de receita associada a cartão de crédito
SELECT is(
    (SELECT active = FALSE AND suspended_reason LIKE '%Receitas não podem ser vinculadas%' FROM public.recurring_transactions WHERE id = (SELECT rec_income_card_id FROM rec_vars)),
    TRUE,
    'Receita vinculada a cartão de crédito é suspensa por regra de negócio'
);

-- 3.13. Usuário autenticado não pode passar target_date arbitrariamente no futuro (> 30 dias)
SELECT throws_ok(
    'SELECT public.fn_materialize_recurring_transactions((SELECT ws_id FROM rec_vars), (CURRENT_DATE + INTERVAL ''60 days'')::DATE)',
    'A data limite para materialização não pode exceder 30 dias a partir da data atual.',
    'fn_materialize_recurring_transactions rejeita data arbitrariamente futura para usuário autenticado'
);

-- 3.14. Fatura para cartão com closing_day == due_day vence no mesmo mês (2026-10-10)
SELECT public.fn_get_or_create_credit_card_bill((SELECT ws_id FROM rec_vars), (SELECT card_sameday_id FROM rec_vars), '2026-10');
SELECT is(
    (SELECT due_date FROM public.credit_card_bills WHERE credit_card_id = (SELECT card_sameday_id FROM rec_vars) AND reference_month = '2026-10'),
    '2026-10-10'::DATE,
    'fn_get_or_create_credit_card_bill mantém vencimento no mesmo mês quando closing_day == due_day'
);

-- 3.15. Fatura para cartão com due_day < closing_day vence no mês seguinte (2026-11-05)
SELECT public.fn_get_or_create_credit_card_bill((SELECT ws_id FROM rec_vars), (SELECT card_nextmonth_id FROM rec_vars), '2026-10');
SELECT is(
    (SELECT due_date FROM public.credit_card_bills WHERE credit_card_id = (SELECT card_nextmonth_id FROM rec_vars) AND reference_month = '2026-10'),
    '2026-11-05'::DATE,
    'fn_get_or_create_credit_card_bill avança vencimento para o próximo mês quando due_day < closing_day'
);

-- ==============================================================================
-- 4. EXECUÇÃO EM CONTEXTO PG_CRON SEM SESSÃO (AUTH.UID() IS NULL)
-- ==============================================================================
SET LOCAL role = 'postgres';
SET LOCAL "request.jwt.claim.sub" = '';

-- Inserir nova regra de cartão para ser materializada exclusivamente pelo cron sem auth.uid()
INSERT INTO public.recurring_transactions (id, workspace_id, description, amount, type, frequency, start_date, next_occurrence, credit_card_id, category_id, auto_create, active)
SELECT '70000000-0000-0000-0000-000000000099'::UUID, ws_id, 'Assinatura Cron Sem Sessão', 75.00, 'expense', 'monthly', '2026-01-05', '2026-01-05', card_id, cat_id, TRUE, TRUE FROM rec_vars;

-- 4.1. Materialização via cron (auth.uid() é NULL): cria fatura e transação de cartão sem falhar por permissão
SELECT is(
    (SELECT (public.fn_materialize_recurring_transactions((SELECT ws_id FROM rec_vars), '2026-01-05'::DATE)->>'created_transactions')::INT >= 1),
    TRUE,
    'fn_materialize_recurring_transactions roda com sucesso em contexto pg_cron (auth.uid() IS NULL) para cartão'
);

-- 4.2. Verificar que a transação de cartão foi gravada e vinculada à fatura pelo cron
SELECT is(
    (SELECT count(*)::INT FROM public.transactions WHERE recurring_transaction_id = '70000000-0000-0000-0000-000000000099'::UUID),
    1,
    'Transação de cartão foi materializada com sucesso em chamada do cron sem sessão'
);

-- ==============================================================================
-- 5. BLOQUEIO DE CHAMADAS ANÔNIMAS (UNAUTHENTICATED)
-- ==============================================================================
SET LOCAL role = 'anon';
SET LOCAL "request.jwt.claim.sub" = '';

-- 5.1. Chamada anônima para fn_materialize_recurring_transactions é bloqueada (42501)
SELECT throws_ok(
    'SELECT public.fn_materialize_recurring_transactions(gen_random_uuid(), CURRENT_DATE)',
    '42501',
    NULL,
    'fn_materialize_recurring_transactions bloqueia usuário anônimo por negação de privilégio (42501)'
);

-- 5.2. Chamada anônima para fn_step_next_occurrence é bloqueada (42501)
SELECT throws_ok(
    'SELECT public.fn_step_next_occurrence(''2026-05-01''::DATE, ''2026-05-01''::DATE, ''monthly'')',
    '42501',
    NULL,
    'fn_step_next_occurrence bloqueia usuário anônimo por negação de privilégio (42501)'
);

-- 5.3. Chamada anônima para fn_get_or_create_credit_card_bill é bloqueada (42501)
SELECT throws_ok(
    'SELECT public.fn_get_or_create_credit_card_bill(gen_random_uuid(), gen_random_uuid(), ''2026-09'')',
    '42501',
    NULL,
    'fn_get_or_create_credit_card_bill bloqueia usuário anônimo por negação de privilégio (42501)'
);

SELECT * FROM finish();
SELECT extensions._get('curr_test')::int AS ran, extensions._get('plan')::int AS planned, extensions.num_failed()::int AS failed, ARRAY(SELECT * FROM extensions.finish()) AS finish_diagnostics;
ROLLBACK;
