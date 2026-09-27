-- Migration 034: Verificação Ativa de Privilégios Pós-REVOKE no Event Trigger (Fail-Closed)
--
-- Motivação:
-- Em clusters gerenciados pelo Supabase, a role superuser `supabase_admin` possui default privileges
-- preexistentes em pg_default_acl que concedem privilégios automáticos a `anon` e `authenticated`.
-- A role `postgres` não é superusuária nem membro de `supabase_admin`, portanto não pode alterar
-- essas default ACLs (PostgreSQL erro 42501).
-- Se um objeto for criado por uma role cujos grants postgres não possua autoridade para revogar,
-- a instrução REVOKE emite apenas um WARNING no PostgreSQL sem lançar erro, deixando os grants
-- ativos.
--
-- Esta migration aprimora a função `public.fn_lockdown_new_objects()` para que, imediatamente após
-- a tentativa de revogação de cada novo objeto, seja feita uma verificação ativa (active grant inspection)
-- via `has_table_privilege`, `has_function_privilege` e `has_sequence_privilege`. Se qualquer privilégio
-- indevido permanecer ativo para anon ou authenticated, a função dispara explicitamente um
-- `RAISE EXCEPTION`, abortando a transação de DDL e garantindo o princípio fail-closed.

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

                -- Verificação ativa pós-revogação: se anon ou authenticated ainda retiverem qualquer
                -- privilégio de tabela (ex: grants emitidos por superuser que postgres não pôde revogar),
                -- aborta imediatamente a transação impedindo a criação do objeto exposto.
                IF has_table_privilege('anon', obj.object_identity, 'SELECT')
                   OR has_table_privilege('anon', obj.object_identity, 'INSERT')
                   OR has_table_privilege('anon', obj.object_identity, 'UPDATE')
                   OR has_table_privilege('anon', obj.object_identity, 'DELETE')
                   OR has_table_privilege('anon', obj.object_identity, 'TRUNCATE')
                   OR has_table_privilege('anon', obj.object_identity, 'REFERENCES')
                   OR has_table_privilege('anon', obj.object_identity, 'TRIGGER')
                   OR has_table_privilege('authenticated', obj.object_identity, 'SELECT')
                   OR has_table_privilege('authenticated', obj.object_identity, 'INSERT')
                   OR has_table_privilege('authenticated', obj.object_identity, 'UPDATE')
                   OR has_table_privilege('authenticated', obj.object_identity, 'DELETE')
                   OR has_table_privilege('authenticated', obj.object_identity, 'TRUNCATE')
                   OR has_table_privilege('authenticated', obj.object_identity, 'REFERENCES')
                   OR has_table_privilege('authenticated', obj.object_identity, 'TRIGGER') THEN
                    RAISE EXCEPTION 'Security lockdown violation: object % still has active privileges for anon or authenticated after REVOKE attempt by role %',
                        obj.object_identity, current_user;
                END IF;

                INSERT INTO public._db_managed_objects (object_identity, object_type)
                VALUES (obj.object_identity, obj.object_type)
                ON CONFLICT (object_identity) DO NOTHING;

            ELSIF obj.object_type IN ('function', 'procedure') THEN
                EXECUTE format('REVOKE ALL ON ROUTINE %s FROM PUBLIC, anon, authenticated;', obj.object_identity);

                -- Verificação ativa pós-revogação para rotinas
                IF has_function_privilege('anon', obj.object_identity, 'EXECUTE')
                   OR has_function_privilege('authenticated', obj.object_identity, 'EXECUTE') THEN
                    RAISE EXCEPTION 'Security lockdown violation: routine % still has active EXECUTE privilege for anon or authenticated after REVOKE attempt by role %',
                        obj.object_identity, current_user;
                END IF;

                INSERT INTO public._db_managed_objects (object_identity, object_type)
                VALUES (obj.object_identity, obj.object_type)
                ON CONFLICT (object_identity) DO NOTHING;

            ELSIF obj.object_type = 'sequence' THEN
                EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon;', obj.object_identity);

                -- Verificação ativa pós-revogação para sequências (anon não pode ter privilégios)
                IF has_sequence_privilege('anon', obj.object_identity, 'USAGE')
                   OR has_sequence_privilege('anon', obj.object_identity, 'SELECT')
                   OR has_sequence_privilege('anon', obj.object_identity, 'UPDATE') THEN
                    RAISE EXCEPTION 'Security lockdown violation: sequence % still has active privileges for anon after REVOKE attempt by role %',
                        obj.object_identity, current_user;
                END IF;

                INSERT INTO public._db_managed_objects (object_identity, object_type)
                VALUES (obj.object_identity, obj.object_type)
                ON CONFLICT (object_identity) DO NOTHING;
            END IF;
        END IF;
    END LOOP;
END;
$$;
