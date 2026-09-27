-- ==============================================================================
-- MIGRATION 009: ALINHAMENTO DO SCHEMA DA EXTENSÃO PGTAP
-- ==============================================================================
-- Move a extensão pgtap do schema public para o schema extensions.
-- Isso mantém o schema public estritamente isolado para as tabelas e rotinas
-- da aplicação FinControl, garantindo que o db lint analise apenas nosso código.
-- ==============================================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgtap') THEN
        ALTER EXTENSION pgtap SET SCHEMA extensions;
    ELSE
        CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
    END IF;
END $$;

GRANT USAGE ON SCHEMA extensions TO authenticated;
