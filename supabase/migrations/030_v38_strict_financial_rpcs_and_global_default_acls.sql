-- ==============================================================================
-- MIGRATION 030: BLINDAGEM RESTRITA DE ESCRITAS FINANCEIRAS E DEFAULT ACLS GLOBAIS
-- ==============================================================================
-- 1. Revogação de escritas diretas (INSERT, UPDATE, DELETE) nas 4 tabelas financeiras:
--    - payments: mutações exclusivas via fn_record_payment, fn_update_payment, fn_delete_payment
--    - transfers: mutações exclusivas via fn_create_transfer, fn_update_transfer, fn_delete_transfer
--    - transactions: mutações exclusivas via fn_create_transaction_with_splits, fn_update_transaction_with_splits, fn_delete_transaction
--    - purchases: mutações exclusivas via fn_create_purchase_with_splits, fn_update_purchase_with_splits, fn_delete_purchase
--    authenticated mantém exclusivamente SELECT nessas 4 tabelas.
-- 2. Revogação de privilégios padrão GLOBAIS (sem restrição de schema)
--    para o role postgres, eliminando grants herdados em objetos novos.
-- 3. Revogação de privilégios padrão no schema public para postgres.
-- 4. Event Trigger protetor (trg_lockdown_new_objects em ddl_command_end):
--    Garante que qualquer novo objeto (tabela, rotina, sequence) criado no schema public
--    por QUALQUER role (incluindo supabase_admin e postgres) nasça automaticamente privado por padrão,
--    revogando todo e qualquer grant automático para PUBLIC, anon e authenticated.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. REVOGAÇÃO DE ESCRITAS DIRETAS NAS 4 TABELAS FINANCEIRAS CENTRAIS
-- ------------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON
    public.payments,
    public.transfers,
    public.transactions,
    public.purchases
FROM authenticated, anon, PUBLIC;

-- Garante SELECT estrito para authenticated
GRANT SELECT ON
    public.payments,
    public.transfers,
    public.transactions,
    public.purchases
TO authenticated;

-- ------------------------------------------------------------------------------
-- 2. REVOGAÇÃO DE PRIVILÉGIOS PADRÃO GLOBAIS (SEM ESPECIFICAÇÃO DE SCHEMA)
-- ------------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES REVOKE ALL ON ROUTINES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE ALL ON ROUTINES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 3. REVOGAÇÃO ESTRITA DE PRIVILÉGIOS PADRÃO NO SCHEMA PUBLIC
-- ------------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON ROUTINES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT USAGE, SELECT ON SEQUENCES TO authenticated;

-- ------------------------------------------------------------------------------
-- 4. EVENT TRIGGER DE BLINDAGEM DE NOVOS OBJETOS NO SCHEMA PUBLIC
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_lockdown_new_objects()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    obj RECORD;
BEGIN
    FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands() WHERE schema_name = 'public'
    LOOP
        IF obj.object_type IN ('table', 'foreign table', 'materialized view', 'view') THEN
            EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated;', obj.object_identity);
        ELSIF obj.object_type IN ('function', 'procedure') THEN
            EXECUTE format('REVOKE ALL ON ROUTINE %s FROM PUBLIC, anon, authenticated;', obj.object_identity);
        ELSIF obj.object_type = 'sequence' THEN
            EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon;', obj.object_identity);
        END IF;
    END LOOP;
END;
$$;

DROP EVENT TRIGGER IF EXISTS trg_lockdown_new_objects;
CREATE EVENT TRIGGER trg_lockdown_new_objects
ON ddl_command_end
EXECUTE FUNCTION public.fn_lockdown_new_objects();
