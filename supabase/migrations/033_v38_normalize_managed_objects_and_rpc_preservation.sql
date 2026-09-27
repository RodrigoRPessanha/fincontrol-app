-- ==============================================================================
-- MIGRATION 033: NORMALIZAÇÃO DE IDENTIDADES NO CATÁLOGO E PRESERVAÇÃO DE RPCS
-- ==============================================================================
-- 1. Normaliza as identidades em public._db_managed_objects utilizando
--    (pg_identify_object(...)).identity para que o formato armazenado coincida
--    100% com o object_identity canônico retornado por pg_event_trigger_ddl_commands()
--    (ex: 'public.fn_record_payment(pg_catalog.uuid,...)').
-- 2. Assegura que todas as RPCs e rotinas criadas em migrações anteriores (001 a 032)
--    sejam catalogadas com sua assinatura qualificada por schema.
-- 3. Atualiza o event trigger trg_lockdown_new_objects para verificar a existência
--    da identidade normalizada em _db_managed_objects antes de revogar privilégios,
--    preservando permissões de EXECUTE em CREATE OR REPLACE FUNCTION de rotinas existentes.
-- ==============================================================================

-- 1. Limpa e repopula o catálogo de objetos gerenciados com identidades canônicas
TRUNCATE TABLE public._db_managed_objects;

-- Tabelas, views, materialized views, foreign tables e sequences
INSERT INTO public._db_managed_objects (object_identity, object_type)
SELECT (pg_identify_object(1259, c.oid, 0)).identity,
       CASE c.relkind
           WHEN 'r' THEN 'table'
           WHEN 'v' THEN 'view'
           WHEN 'm' THEN 'materialized view'
           WHEN 'S' THEN 'sequence'
           WHEN 'f' THEN 'foreign table'
       END
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'v', 'm', 'S', 'f')
ON CONFLICT (object_identity) DO NOTHING;

-- Rotinas (functions e procedures) com assinatura qualificada canônica
INSERT INTO public._db_managed_objects (object_identity, object_type)
SELECT (pg_identify_object(1255, p.oid, 0)).identity, 'function'
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ON CONFLICT (object_identity) DO NOTHING;

-- 2. Redefine o event trigger para garantir comparação canônica e falha visível
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
