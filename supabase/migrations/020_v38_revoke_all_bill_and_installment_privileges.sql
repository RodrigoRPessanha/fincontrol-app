-- ==============================================================================
-- MIGRATION 020: REVOGAÇÃO TOTAL DE PRIVILÉGIOS (REVOKE ALL) EM FATURAS E PARCELAS
-- ==============================================================================
-- 1. Executa REVOKE ALL ON public.credit_card_bills e public.installments
--    para authenticated, anon e PUBLIC, eliminando TRUNCATE, TRIGGER, REFERENCES
--    e qualquer outro privilégio residual não protegido por RLS.
-- 2. Concede estritamente SELECT em public.credit_card_bills e public.installments
--    para authenticated, assegurando que as tabelas sejam estritamente somente leitura.
-- 3. Cria a função auxiliar public.fn_check_table_privilege para verificação
--    programática estrita de privilégios por testes automatizados.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. REVOGAÇÃO TOTAL DE TODOS OS PRIVILÉGIOS (INCLUINDO TRUNCATE, TRIGGER, REFERENCES)
-- ------------------------------------------------------------------------------
REVOKE ALL ON public.credit_card_bills FROM authenticated, anon, PUBLIC;
REVOKE ALL ON public.installments FROM authenticated, anon, PUBLIC;

-- ------------------------------------------------------------------------------
-- 2. CONCESSÃO ESTRITA EXCLUSIVA DE LEITURA (SELECT)
-- ------------------------------------------------------------------------------
GRANT SELECT ON public.credit_card_bills TO authenticated;
GRANT SELECT ON public.installments TO authenticated;

-- ------------------------------------------------------------------------------
-- 3. FUNÇÃO AUXILIAR DE INTROSPECÇÃO DE PRIVILÉGIOS PARA TESTES AUTOMATIZADOS
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_check_table_privilege(p_table TEXT, p_privilege TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT has_table_privilege('authenticated', 'public.' || quote_ident(p_table), p_privilege);
$$;

GRANT EXECUTE ON FUNCTION public.fn_check_table_privilege(TEXT, TEXT) TO authenticated, anon;
