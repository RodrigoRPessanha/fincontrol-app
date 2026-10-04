-- ==============================================================================
-- TESTE 08: LEAST PRIVILEGE, BLINDAGEM DE GRANTS E CONTROLE DE ACESSO A ROTINAS
-- ==============================================================================
BEGIN;
SELECT plan(80);

-- ------------------------------------------------------------------------------
-- 1. Setup: Criar usuário de teste determinístico no Auth
-- ------------------------------------------------------------------------------
INSERT INTO auth.users (id, aud, role, email)
VALUES ('80000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'privilege_auditor@test.com')
ON CONFLICT (id) DO NOTHING;

-- ==============================================================================
-- 2. PRIVILÉGIOS EM TABELAS: USUÁRIO AUTENTICADO
-- ==============================================================================

-- 2.1. Tabelas Somente Leitura Auxiliares (credit_card_bills, installments, transaction_splits, purchase_splits)
SELECT ok(
    has_table_privilege('authenticated', 'public.credit_card_bills', 'select'),
    'authenticated pode executar SELECT em credit_card_bills'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public.credit_card_bills', 'insert'),
    'authenticated NÃO pode executar INSERT em credit_card_bills'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public.credit_card_bills', 'truncate'),
    'authenticated NÃO pode executar TRUNCATE em credit_card_bills'
);

SELECT ok(
    has_table_privilege('authenticated', 'public.installments', 'select'),
    'authenticated pode executar SELECT em installments'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public.installments', 'update'),
    'authenticated NÃO pode executar UPDATE em installments'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public.installments', 'truncate'),
    'authenticated NÃO pode executar TRUNCATE em installments'
);

SELECT ok(
    has_table_privilege('authenticated', 'public.transaction_splits', 'select'),
    'authenticated pode executar SELECT em transaction_splits'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public.transaction_splits', 'insert'),
    'authenticated NÃO pode executar INSERT em transaction_splits'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public.transaction_splits', 'truncate'),
    'authenticated NÃO pode executar TRUNCATE em transaction_splits'
);

SELECT ok(
    has_table_privilege('authenticated', 'public.purchase_splits', 'select'),
    'authenticated pode executar SELECT em purchase_splits'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public.purchase_splits', 'delete'),
    'authenticated NÃO pode executar DELETE em purchase_splits'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public.purchase_splits', 'truncate'),
    'authenticated NÃO pode executar TRUNCATE em purchase_splits'
);

-- 2.2. Perfis de Usuário (profiles: apenas SELECT e UPDATE)
SELECT ok(
    has_table_privilege('authenticated', 'public.profiles', 'select'),
    'authenticated pode executar SELECT em profiles'
);
SELECT ok(
    has_column_privilege('authenticated', 'public.profiles', 'name', 'update'),
    'authenticated pode editar apresentação do perfil, sem UPDATE irrestrito'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public.profiles', 'insert'),
    'authenticated NÃO pode executar INSERT direto em profiles'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public.profiles', 'delete'),
    'authenticated NÃO pode executar DELETE direto em profiles'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public.profiles', 'truncate'),
    'authenticated NÃO pode executar TRUNCATE em profiles'
);

-- 2.3. Entidades de Domínio com DML Direto Permitido sob RLS (accounts)
SELECT ok(
    has_table_privilege('authenticated', 'public.accounts', 'select') AND
    has_table_privilege('authenticated', 'public.accounts', 'insert') AND
    has_table_privilege('authenticated', 'public.accounts', 'update') AND
    has_table_privilege('authenticated', 'public.accounts', 'delete'),
    'authenticated possui SELECT, INSERT, UPDATE, DELETE em accounts'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public.accounts', 'truncate'),
    'authenticated NÃO pode executar TRUNCATE em accounts'
);

-- 2.4. Entidades Financeiras Centrais: Escritas Diretas Bloqueadas (Mutações Exclusivas por RPCs)
-- (payments, transfers, transactions, purchases: SELECT permitido; INSERT, UPDATE, DELETE, TRUNCATE bloqueados)
SELECT ok(
    has_table_privilege('authenticated', 'public.transactions', 'select'),
    'authenticated pode executar SELECT em transactions'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public.transactions', 'insert'),
    'authenticated NÃO pode executar INSERT direto em transactions'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public.transactions', 'update'),
    'authenticated NÃO pode executar UPDATE direto em transactions'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public.transactions', 'delete'),
    'authenticated NÃO pode executar DELETE direto em transactions'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public.transactions', 'truncate'),
    'authenticated NÃO pode executar TRUNCATE em transactions'
);

SELECT ok(
    has_table_privilege('authenticated', 'public.purchases', 'select'),
    'authenticated pode executar SELECT em purchases'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public.purchases', 'insert'),
    'authenticated NÃO pode executar INSERT direto em purchases'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public.purchases', 'update'),
    'authenticated NÃO pode executar UPDATE direto em purchases'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public.purchases', 'delete'),
    'authenticated NÃO pode executar DELETE direto em purchases'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public.purchases', 'truncate'),
    'authenticated NÃO pode executar TRUNCATE em purchases'
);

SELECT ok(
    has_table_privilege('authenticated', 'public.payments', 'select'),
    'authenticated pode executar SELECT em payments'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public.payments', 'insert'),
    'authenticated NÃO pode executar INSERT direto em payments'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public.payments', 'update'),
    'authenticated NÃO pode executar UPDATE direto em payments'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public.payments', 'delete'),
    'authenticated NÃO pode executar DELETE direto em payments'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public.payments', 'truncate'),
    'authenticated NÃO pode executar TRUNCATE em payments'
);

SELECT ok(
    has_table_privilege('authenticated', 'public.transfers', 'select'),
    'authenticated pode executar SELECT em transfers'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public.transfers', 'insert'),
    'authenticated NÃO pode executar INSERT direto em transfers'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public.transfers', 'update'),
    'authenticated NÃO pode executar UPDATE direto em transfers'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public.transfers', 'delete'),
    'authenticated NÃO pode executar DELETE direto em transfers'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public.transfers', 'truncate'),
    'authenticated NÃO pode executar TRUNCATE em transfers'
);

-- ==============================================================================
-- 3. REJEIÇÃO RUNTIME DE ESCRITA DIRETA FINANCEIRA (42501)
-- ==============================================================================
SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claim.sub" = '80000000-0000-0000-0000-000000000001';

SELECT throws_ok(
    'INSERT INTO public.payments (workspace_id, account_id, amount) VALUES (''80000000-0000-0000-0000-000000000001'', ''80000000-0000-0000-0000-000000000001'', 10)',
    '42501',
    NULL,
    'authenticated é rejeitado com 42501 em INSERT direto em payments'
);
SELECT throws_ok(
    'DELETE FROM public.payments WHERE id = ''80000000-0000-0000-0000-000000000001''',
    '42501',
    NULL,
    'authenticated é rejeitado com 42501 em DELETE direto em payments'
);
SELECT throws_ok(
    'DELETE FROM public.transfers WHERE id = ''80000000-0000-0000-0000-000000000001''',
    '42501',
    NULL,
    'authenticated é rejeitado com 42501 em DELETE direto em transfers'
);
SELECT throws_ok(
    'UPDATE public.transactions SET amount = 999 WHERE id = ''80000000-0000-0000-0000-000000000001''',
    '42501',
    NULL,
    'authenticated é rejeitado com 42501 em UPDATE direto em transactions'
);

RESET ROLE;

-- ==============================================================================
-- 4. PRIVILÉGIOS EM TABELAS: ANÔNIMO (anon / PUBLIC) TOTALMENTE NEGADO
-- ==============================================================================
SELECT ok(
    NOT has_table_privilege('anon', 'public.accounts', 'select'),
    'anon NÃO tem acesso SELECT a accounts'
);
SELECT ok(
    NOT has_table_privilege('anon', 'public.credit_card_bills', 'select'),
    'anon NÃO tem acesso SELECT a credit_card_bills'
);
SELECT ok(
    NOT has_table_privilege('anon', 'public.transactions', 'select'),
    'anon NÃO tem acesso SELECT a transactions'
);
SELECT ok(
    NOT has_table_privilege('anon', 'public.payments', 'select'),
    'anon NÃO tem acesso SELECT a payments'
);

-- ==============================================================================
-- 5. PRIVILÉGIOS EM ROTINAS E RPCS
-- ==============================================================================

-- 5.1. RPCs de Negócio: authenticated possui permissão de EXECUTE
SELECT ok(
    has_function_privilege('authenticated', 'public.fn_create_workspace(text, text, text)', 'execute'),
    'authenticated pode executar RPC fn_create_workspace'
);
SELECT ok(
    has_function_privilege('authenticated', 'public.fn_create_transaction_with_splits(uuid, text, numeric, date, text, text, uuid, uuid, uuid, uuid, uuid, text, uuid, text, date, jsonb, uuid)', 'execute'),
    'authenticated pode executar RPC fn_create_transaction_with_splits'
);
SELECT ok(
    has_function_privilege('authenticated', 'public.fn_record_payment(uuid, uuid, numeric, date, uuid, uuid, uuid, uuid, text, boolean)', 'execute'),
    'authenticated pode executar RPC fn_record_payment'
);
SELECT ok(
    has_function_privilege('authenticated', 'public.fn_materialize_recurring_transactions(uuid, date)', 'execute'),
    'authenticated pode executar RPC fn_materialize_recurring_transactions'
);

-- 5.2. Trigger Functions: authenticated NÃO possui permissão de EXECUTE
SELECT ok(
    NOT has_function_privilege('authenticated', 'public.handle_new_user()', 'execute'),
    'authenticated NÃO pode executar trigger function handle_new_user'
);
SELECT ok(
    NOT has_function_privilege('authenticated', 'public.fn_prevent_workspace_id_change()', 'execute'),
    'authenticated NÃO pode executar trigger function fn_prevent_workspace_id_change'
);
SELECT ok(
    NOT has_function_privilege('authenticated', 'public.fn_check_payment_workspace_integrity()', 'execute'),
    'authenticated NÃO pode executar trigger function fn_check_payment_workspace_integrity'
);

-- 5.3. Chamada anônima bloqueada em RPC de negócio (42501)
SET LOCAL role = 'anon';
SET LOCAL "request.jwt.claim.sub" = '';

SELECT throws_ok(
    'SELECT public.fn_create_workspace(''Invasão Anônima'')',
    '42501',
    NULL,
    'anon é estritamente bloqueado com 42501 ao tentar chamar fn_create_workspace'
);

RESET ROLE;

-- ==============================================================================
-- 6. OBJETOS FUTUROS: PRIVADOS POR PADRÃO (DEFAULT ACLS & EVENT TRIGGER)
-- ==============================================================================
-- Criação de tabela e função dentro da transação do teste para comprovar
-- que novos objetos nascem estritamente privados para anon e authenticated.
CREATE TABLE public._pgtap_future_test_table (id INT PRIMARY KEY, val TEXT);
CREATE FUNCTION public._pgtap_future_test_func() RETURNS INT LANGUAGE sql AS 'SELECT 42;';

SELECT ok(
    NOT has_table_privilege('authenticated', 'public._pgtap_future_test_table', 'select'),
    'authenticated NÃO possui SELECT automático em tabela recém-criada'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public._pgtap_future_test_table', 'insert'),
    'authenticated NÃO possui INSERT automático em tabela recém-criada'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public._pgtap_future_test_table', 'update'),
    'authenticated NÃO possui UPDATE automático em tabela recém-criada'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public._pgtap_future_test_table', 'delete'),
    'authenticated NÃO possui DELETE automático em tabela recém-criada'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public._pgtap_future_test_table', 'truncate'),
    'authenticated NÃO possui TRUNCATE automático em tabela recém-criada'
);
SELECT ok(
    NOT has_table_privilege('anon', 'public._pgtap_future_test_table', 'select'),
    'anon NÃO possui SELECT automático em tabela recém-criada'
);
SELECT ok(
    NOT has_table_privilege('anon', 'public._pgtap_future_test_table', 'insert'),
    'anon NÃO possui INSERT automático em tabela recém-criada'
);
SELECT ok(
    NOT has_table_privilege('anon', 'public._pgtap_future_test_table', 'update'),
    'anon NÃO possui UPDATE automático em tabela recém-criada'
);
SELECT ok(
    NOT has_table_privilege('anon', 'public._pgtap_future_test_table', 'delete'),
    'anon NÃO possui DELETE automático em tabela recém-criada'
);

SELECT ok(
    NOT has_function_privilege('authenticated', 'public._pgtap_future_test_func()', 'execute'),
    'authenticated NÃO possui EXECUTE automático em função recém-criada'
);
SELECT ok(
    NOT has_function_privilege('anon', 'public._pgtap_future_test_func()', 'execute'),
    'anon NÃO possui EXECUTE automático em função recém-criada'
);

-- 6.1. Comprovação de não-regressão: ALTER TABLE preserva grants previamente concedidos
GRANT SELECT ON public._pgtap_future_test_table TO authenticated;
ALTER TABLE public._pgtap_future_test_table ADD COLUMN extra_audit_col TEXT;
SELECT ok(
    has_table_privilege('authenticated', 'public._pgtap_future_test_table', 'select'),
    'ALTER TABLE preserva grant SELECT previamente concedido em tabela existente'
);

-- 6.2. Comprovação de Views: criação privada por padrão e preservação em CREATE OR REPLACE VIEW
CREATE VIEW public._pgtap_future_test_view AS SELECT 1 AS val;
SELECT ok(
    NOT has_table_privilege('authenticated', 'public._pgtap_future_test_view', 'select'),
    'authenticated NÃO possui SELECT automático em view recém-criada'
);
SELECT ok(
    NOT has_table_privilege('anon', 'public._pgtap_future_test_view', 'select'),
    'anon NÃO possui SELECT automático em view recém-criada'
);

GRANT SELECT ON public._pgtap_future_test_view TO authenticated;
CREATE OR REPLACE VIEW public._pgtap_future_test_view AS SELECT 2 AS val;
SELECT ok(
    has_table_privilege('authenticated', 'public._pgtap_future_test_view', 'select'),
    'CREATE OR REPLACE VIEW preserva grant SELECT previamente concedido em view existente'
);

DROP VIEW public._pgtap_future_test_view;
CREATE VIEW public._pgtap_future_test_view AS SELECT 3 AS val;
SELECT ok(
    NOT has_table_privilege('authenticated', 'public._pgtap_future_test_view', 'select'),
    'View recriada após DROP volta a nascer estritamente privada por padrão'
);

-- 6.3. Comprovação de não-regressão: CREATE OR REPLACE FUNCTION preserva grants previamente concedidos
GRANT EXECUTE ON FUNCTION public._pgtap_future_test_func() TO authenticated;
CREATE OR REPLACE FUNCTION public._pgtap_future_test_func() RETURNS INT LANGUAGE sql AS 'SELECT 84;';
SELECT ok(
    has_function_privilege('authenticated', 'public._pgtap_future_test_func()', 'execute'),
    'CREATE OR REPLACE FUNCTION preserva grant EXECUTE previamente concedido em rotina existente'
);

-- 6.3.1. Comprovação de substituição de RPC pré-existente (criada antes da 032): preserva grant EXECUTE
CREATE OR REPLACE FUNCTION public.fn_create_workspace(
    p_name text,
    p_currency text DEFAULT 'BRL'::text,
    p_tracking_mode text DEFAULT 'full'::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_user_id UUID;
    v_ws_id UUID;
    v_mode TEXT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF TRIM(p_name) = '' THEN
        RAISE EXCEPTION 'O nome do workspace não pode ser vazio.';
    END IF;

    v_mode := COALESCE(p_tracking_mode, 'full');
    IF v_mode NOT IN ('full', 'expense_tracker') THEN
        RAISE EXCEPTION 'Modo de rastreamento inválido. Permitidos: full, expense_tracker.';
    END IF;

    INSERT INTO public.workspaces (name, owner_id, currency, tracking_mode)
    VALUES (TRIM(p_name), v_user_id, COALESCE(p_currency, 'BRL'), v_mode)
    RETURNING id INTO v_ws_id;

    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (v_ws_id, v_user_id, 'owner');

    RETURN v_ws_id;
END;
$function$;

SELECT ok(
    has_function_privilege('authenticated', 'public.fn_create_workspace(text,text,text)', 'execute'),
    'CREATE OR REPLACE FUNCTION em RPC pré-existente (anterior à 032) preserva grant EXECUTE de authenticated'
);

-- 6.4. Comprovação de Sequences: sequences nascem estritamente privadas para anon
CREATE SEQUENCE public._pgtap_future_test_seq;
SELECT ok(
    NOT has_sequence_privilege('anon', 'public._pgtap_future_test_seq', 'usage'),
    'anon NÃO possui USAGE automático em sequence recém-criada'
);

-- 6.5. Isolamento e proteção de roles: postgres não pode assumir supabase_admin nem há objetos de supabase_admin em public
SELECT throws_ok(
    'SET ROLE supabase_admin',
    '42501',
    NULL,
    'postgres é estritamente impedido de executar SET ROLE supabase_admin (42501)'
);

SELECT throws_ok(
    'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated',
    '42501',
    NULL,
    'postgres é impedido de alterar default privileges de supabase_admin (42501)'
);

SELECT throws_ok(
    'ALTER TABLE public._pgtap_future_test_table OWNER TO supabase_admin',
    '42501',
    NULL,
    'postgres é impedido de transferir ownership de objetos para supabase_admin (42501)'
);

SELECT ok(
    NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relowner = 'supabase_admin'::regrole
    ),
    'Nenhum objeto de dados ou relação no schema public pertence a supabase_admin'
);

-- 6.6. Comprovação de DEFAULT ACLs: postgres não concede acesso automático a tabelas nem rotinas em public
SELECT ok(
    NOT EXISTS (
        SELECT 1 FROM pg_default_acl d
        JOIN pg_namespace n ON d.defaclnamespace = n.oid
        WHERE n.nspname = 'public'
          AND pg_get_userbyid(d.defaclrole) = 'postgres'
          AND d.defaclobjtype = 'r'
          AND array_to_string(d.defaclacl, ',') ~ '(anon|authenticated)'
    ),
    'postgres não possui default ACLs para anon ou authenticated em tabelas no schema public'
);
SELECT ok(
    NOT EXISTS (
        SELECT 1 FROM pg_default_acl d
        JOIN pg_namespace n ON d.defaclnamespace = n.oid
        WHERE n.nspname = 'public'
          AND pg_get_userbyid(d.defaclrole) = 'postgres'
          AND d.defaclobjtype = 'f'
          AND array_to_string(d.defaclacl, ',') ~ '(anon|authenticated)'
    ),
    'postgres não possui default ACLs para anon ou authenticated em rotinas no schema public'
);

SELECT * FROM finish();
SELECT extensions._get('curr_test')::int AS ran, extensions._get('plan')::int AS planned, extensions.num_failed()::int AS failed, ARRAY(SELECT * FROM extensions.finish()) AS finish_diagnostics;
ROLLBACK;
