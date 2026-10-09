-- ==============================================================================
-- MIGRATION 029: PRINCÍPIO DO MENOR PRIVILÉGIO (LEAST PRIVILEGE) E HARDENING DE GRANTS
-- ==============================================================================
-- 1. Remoção de sobrecargas obsoletas de funções legadas (001):
--    - fn_create_workspace(text, text) -> substituída pela versão com tracking_mode (007)
--    - fn_get_or_create_credit_card_bill(uuid, date) -> substituída pela versão com ref_month (004/027/028)
-- 2. Revogação abrangente de privilégios residuais e perigosos (TRUNCATE, TRIGGER, REFERENCES)
--    em todas as 19 tabelas para authenticated, anon e PUBLIC.
-- 3. Concessão estrita e discriminada de DML por tabela:
--    - Somente Leitura (SELECT): credit_card_bills, installments, transaction_splits, purchase_splits
--    - Perfil Restrito (SELECT, UPDATE): profiles (INSERT via trigger handle_new_user; DELETE via cascade)
--    - Entidades de Negócio (SELECT, INSERT, UPDATE, DELETE): workspaces, workspace_members, accounts,
--      credit_cards, payment_methods, categories, transactions, purchases, payments, transfers,
--      recurring_transactions, budgets, financial_goals, settlements.
-- 4. Revogação de EXECUTE em rotinas internas e triggers (23 trigger functions restritas).
-- 5. Concessão explícita de EXECUTE apenas para as 21 RPCs de negócio e helpers de RLS/auditoria.
-- 6. Bloqueio estrito de privilégios padrão futuros (ALTER DEFAULT PRIVILEGES):
--    impede concessão automática e indiscriminada de DML ou EXECUTE em novos objetos criados em public.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. REMOÇÃO DE SOBRECARGAS OBSOLETAS
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.fn_create_workspace(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.fn_get_or_create_credit_card_bill(UUID, DATE);

-- ------------------------------------------------------------------------------
-- 2. REVOGAÇÃO GLOBAL DEFENSIVA EM TABELAS, SEQUÊNCIAS E ROTINAS
-- ------------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- Concessão básica de navegação no schema public
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Sequências: somente authenticated e service_role (USO e LEITURA, sem DDL)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 3. CONCESSÃO DISCRIMINADA DE PRIVILÉGIOS EM TABELAS (LEAST PRIVILEGE)
-- ------------------------------------------------------------------------------

-- 3.1. Tabelas Estritamente Somente Leitura (Mutações Exclusivas por RPCs SECURITY DEFINER)
-- Bloqueio total contra TRUNCATE, TRIGGER, REFERENCES, INSERT, UPDATE e DELETE diretos
GRANT SELECT ON public.credit_card_bills TO authenticated;
GRANT SELECT ON public.installments TO authenticated;
GRANT SELECT ON public.transaction_splits TO authenticated;
GRANT SELECT ON public.purchase_splits TO authenticated;

-- 3.2. Perfis de Usuário (Criados por Trigger no Auth; Deletados via Cascade)
-- Cliente só pode consultar membros de seus workspaces e atualizar seus próprios dados (nome/avatar)
GRANT SELECT, UPDATE ON public.profiles TO authenticated;

-- 3.3. Tabelas de Domínio com Escrita Direta Sujeita a Políticas RLS
-- Concede apenas SELECT, INSERT, UPDATE, DELETE (TRUNCATE, TRIGGER e REFERENCES permanecem REVOGADOS)
GRANT SELECT, INSERT, UPDATE, DELETE ON
    public.workspaces,
    public.workspace_members,
    public.accounts,
    public.credit_cards,
    public.payment_methods,
    public.categories,
    public.transactions,
    public.purchases,
    public.payments,
    public.transfers,
    public.recurring_transactions,
    public.budgets,
    public.financial_goals,
    public.settlements
TO authenticated;

-- ------------------------------------------------------------------------------
-- 4. FUNÇÕES DE INTROSPECÇÃO E AUDITORIA DE SEGURANÇA
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_check_table_privilege(p_table TEXT, p_privilege TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT has_table_privilege('authenticated', 'public.' || quote_ident(p_table), p_privilege);
$$;

CREATE OR REPLACE FUNCTION public.fn_check_routine_privilege(p_routine TEXT, p_privilege TEXT DEFAULT 'execute')
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT has_function_privilege('authenticated', 'public.' || p_routine, p_privilege);
$$;

GRANT EXECUTE ON FUNCTION public.fn_check_table_privilege(TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_check_routine_privilege(TEXT, TEXT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_check_table_privilege(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_check_routine_privilege(TEXT, TEXT) FROM PUBLIC, anon;

-- ------------------------------------------------------------------------------
-- 5. CONCESSÃO ESTRITA DE EXECUÇÃO EM FUNÇÕES DE RLS E RPCS DA APLICAÇÃO
-- ------------------------------------------------------------------------------

-- 5.1. Funções de RLS
GRANT EXECUTE ON FUNCTION public.is_member(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_workspace_role(UUID, TEXT[]) TO authenticated, service_role;

-- 5.2. Helpers Internos de Negócio
GRANT EXECUTE ON FUNCTION public.fn_get_or_create_credit_card_bill(UUID, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_step_next_occurrence(DATE, DATE, TEXT, INT) TO authenticated, service_role;

-- 5.3. RPCs de Negócio da Aplicação
GRANT EXECUTE ON FUNCTION public.fn_create_workspace(TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_add_workspace_member(UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_transfer_workspace_ownership(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_record_settlement(UUID, UUID, UUID, NUMERIC, DATE, TEXT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_set_transaction_splits(UUID, UUID, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_set_purchase_splits(UUID, UUID, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_create_credit_card_transaction(UUID, UUID, TEXT, NUMERIC, DATE, UUID, UUID, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_create_installment_purchase(UUID, TEXT, NUMERIC, INT, DATE, UUID, UUID, UUID, UUID, INT, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_create_transaction_with_splits(UUID, TEXT, NUMERIC, DATE, TEXT, TEXT, UUID, UUID, UUID, UUID, UUID, TEXT, UUID, TEXT, DATE, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_update_transaction_with_splits(UUID, UUID, TEXT, NUMERIC, DATE, TEXT, UUID, UUID, UUID, UUID, UUID, TEXT, UUID, TEXT, DATE, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_delete_transaction(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_create_purchase_with_splits(UUID, TEXT, NUMERIC, INT, DATE, UUID, UUID, UUID, UUID, INT, UUID, TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_update_purchase_with_splits(UUID, UUID, TEXT, NUMERIC, DATE, UUID, UUID, UUID, UUID, UUID, TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_delete_purchase(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_record_payment(UUID, UUID, NUMERIC, DATE, UUID, UUID, UUID, UUID, TEXT, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_update_payment(UUID, UUID, UUID, NUMERIC, DATE, UUID, TEXT, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_delete_payment(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_create_transfer(UUID, UUID, UUID, NUMERIC, DATE, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_update_transfer(UUID, UUID, UUID, UUID, NUMERIC, DATE, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_delete_transfer(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_materialize_recurring_transactions(UUID, DATE) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 6. BLOQUEIO ESTRITO DE DEFAULT PRIVILEGES (PROTEÇÃO DE TABELAS E ROTINAS FUTURAS)
-- ------------------------------------------------------------------------------
-- Revoga privilégios automáticos concedidos pela migration 007 para objetos criados no futuro.
-- Qualquer nova tabela ou função deverá declarar explicitamente seus privilégios na respectiva migration.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON ROUTINES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO authenticated;
