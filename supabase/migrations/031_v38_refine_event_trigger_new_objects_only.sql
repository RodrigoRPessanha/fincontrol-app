-- ==============================================================================
-- MIGRATION 031: REFINAMENTO DO EVENT TRIGGER PARA CRIAÇÃO EXCLUSIVA DE NOVOS OBJETOS
-- ==============================================================================
-- 1. Corrige o event trigger trg_lockdown_new_objects para atuar estritamente
--    na CRIAÇÃO de novos objetos de esquema:
--    - Tabelas e Views: CREATE TABLE, CREATE TABLE AS, CREATE FOREIGN TABLE,
--      CREATE VIEW, CREATE MATERIALIZED VIEW.
--    - Sequences: CREATE SEQUENCE.
-- 2. Não interfere em comandos de alteração de objetos existentes:
--    - ALTER TABLE (preserva grants previamente concedidos)
--    - ALTER VIEW / ALTER MATERIALIZED VIEW
--    - ALTER SEQUENCE
-- 3. Não revoga grants durante substituição de rotinas existentes:
--    - CREATE OR REPLACE FUNCTION e ALTER FUNCTION preservam grants concedidos.
--    - Novas rotinas já nascem privadas por padrão graças às DEFAULT ACLS
--      revogadas para o role postgres na migration 030.
-- 4. Tratamento defensivo de exceção (BEGIN ... EXCEPTION WHEN OTHERS THEN NULL; END;):
--    Garante que restrições de permissão/ownership do PostgreSQL para roles do
--    sistema (como supabase_admin) não causem falhas em operações DDL.
-- ==============================================================================

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
        -- Atua estritamente em comandos de criação de novas tabelas/views
        IF obj.command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'CREATE FOREIGN TABLE', 'CREATE VIEW', 'CREATE MATERIALIZED VIEW') THEN
            BEGIN
                EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated;', obj.object_identity);
            EXCEPTION
                WHEN OTHERS THEN
                    NULL;
            END;
        ELSIF obj.command_tag = 'CREATE SEQUENCE' THEN
            BEGIN
                EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon;', obj.object_identity);
            EXCEPTION
                WHEN OTHERS THEN
                    NULL;
            END;
        END IF;
    END LOOP;
END;
$$;

DROP EVENT TRIGGER IF EXISTS trg_lockdown_new_objects;
CREATE EVENT TRIGGER trg_lockdown_new_objects
ON ddl_command_end
EXECUTE FUNCTION public.fn_lockdown_new_objects();
