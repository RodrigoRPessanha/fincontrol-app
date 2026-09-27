-- ==============================================================================
-- MIGRATION 032: CATÁLOGO DE OBJETOS GERENCIADOS E BLINDAGEM ESTRITA SEM SILENCIAMENTO
-- ==============================================================================
-- 1. Cria a tabela de catálogo interno public._db_managed_objects para rastrear
--    todos os objetos legítimos do schema public.
-- 2. Popula o catálogo com todos os objetos existentes (tabelas, views, sequences, rotinas).
-- 3. Redefine o event trigger trg_lockdown_new_objects (ddl_command_end):
--    - Detecta com precisão cirúrgica se o objeto é NOVO ou MODIFICADO/SUBSTITUÍDO:
--      * Se for MODIFICADO/SUBSTITUÍDO (ALTER TABLE, CREATE OR REPLACE VIEW,
--        CREATE OR REPLACE FUNCTION): não altera privilégios, preservando grants existentes.
--      * Se for NOVO (CREATE TABLE, CREATE VIEW, CREATE FUNCTION, CREATE SEQUENCE):
--        executa REVOKE ALL para PUBLIC, anon, authenticated e registra no catálogo.
--    - Falha visível: NÃO silencia exceções com EXCEPTION WHEN OTHERS THEN NULL.
--      Qualquer falha de revogação aborta a transação DDL imediatamente.
-- 4. Cria o event trigger trg_unmanage_dropped_objects (sql_drop):
--    - Remove do catálogo objetos excluídos via DROP para que, se recriados,
--      sejam novamente tratados como novos e blindados.
-- ==============================================================================

-- 1. Tabela de Catálogo de Objetos Gerenciados
CREATE TABLE IF NOT EXISTS public._db_managed_objects (
    object_identity text PRIMARY KEY,
    object_type text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public._db_managed_objects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._db_managed_objects FROM PUBLIC, anon, authenticated;

-- 2. Popula objetos existentes
INSERT INTO public._db_managed_objects (object_identity, object_type)
SELECT 'public.' || quote_ident(tablename), 'table'
FROM pg_tables WHERE schemaname = 'public'
ON CONFLICT (object_identity) DO NOTHING;

INSERT INTO public._db_managed_objects (object_identity, object_type)
SELECT 'public.' || quote_ident(viewname), 'view'
FROM pg_views WHERE schemaname = 'public'
ON CONFLICT (object_identity) DO NOTHING;

INSERT INTO public._db_managed_objects (object_identity, object_type)
SELECT 'public.' || quote_ident(sequencename), 'sequence'
FROM pg_sequences WHERE schemaname = 'public'
ON CONFLICT (object_identity) DO NOTHING;

INSERT INTO public._db_managed_objects (object_identity, object_type)
SELECT p.oid::regprocedure::text, 'function'
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ON CONFLICT (object_identity) DO NOTHING;

-- 3. Função de Blindagem Estrita em ddl_command_end
CREATE OR REPLACE FUNCTION public.fn_lockdown_new_objects()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    obj RECORD;
    is_managed boolean;
BEGIN
    FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands() WHERE schema_name = 'public' AND NOT in_extension
    LOOP
        SELECT EXISTS (
            SELECT 1 FROM public._db_managed_objects WHERE object_identity = obj.object_identity
        ) INTO is_managed;

        IF NOT is_managed THEN
            IF obj.object_type IN ('table', 'foreign table', 'materialized view', 'view') THEN
                EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated;', obj.object_identity);
                INSERT INTO public._db_managed_objects (object_identity, object_type)
                VALUES (obj.object_identity, obj.object_type)
                ON CONFLICT (object_identity) DO NOTHING;
            ELSIF obj.object_type IN ('function', 'procedure') THEN
                EXECUTE format('REVOKE ALL ON ROUTINE %s FROM PUBLIC, anon, authenticated;', obj.object_identity);
                INSERT INTO public._db_managed_objects (object_identity, object_type)
                VALUES (obj.object_identity, obj.object_type)
                ON CONFLICT (object_identity) DO NOTHING;
            ELSIF obj.object_type = 'sequence' THEN
                EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon;', obj.object_identity);
                INSERT INTO public._db_managed_objects (object_identity, object_type)
                VALUES (obj.object_identity, obj.object_type)
                ON CONFLICT (object_identity) DO NOTHING;
            END IF;
        END IF;
    END LOOP;
END;
$$;

-- 4. Função de Limpeza do Catálogo em sql_drop
CREATE OR REPLACE FUNCTION public.fn_unmanage_dropped_objects()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    obj RECORD;
BEGIN
    FOR obj IN SELECT * FROM pg_event_trigger_dropped_objects() WHERE schema_name = 'public'
    LOOP
        DELETE FROM public._db_managed_objects WHERE object_identity = obj.object_identity;
    END LOOP;
END;
$$;

DROP EVENT TRIGGER IF EXISTS trg_lockdown_new_objects;
CREATE EVENT TRIGGER trg_lockdown_new_objects
ON ddl_command_end
EXECUTE FUNCTION public.fn_lockdown_new_objects();

DROP EVENT TRIGGER IF EXISTS trg_unmanage_dropped_objects;
CREATE EVENT TRIGGER trg_unmanage_dropped_objects
ON sql_drop
EXECUTE FUNCTION public.fn_unmanage_dropped_objects();
