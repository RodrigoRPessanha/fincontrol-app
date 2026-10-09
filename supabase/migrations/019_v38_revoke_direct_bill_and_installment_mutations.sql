-- ==============================================================================
-- MIGRATION 019: REVOGAÇÃO DE ESCRITA DIRETA EM FATURAS E PARCELAS
-- ==============================================================================
-- 1. Revoga privilégios DML (INSERT, UPDATE, DELETE) em public.credit_card_bills
--    e public.installments para as roles authenticated, anon e PUBLIC.
-- 2. Concede explicitamente SELECT em public.credit_card_bills e public.installments
--    para authenticated e anon (para leitura sob RLS).
-- 3. Remove policies de escrita permissivas (INSERT, UPDATE, DELETE) em
--    credit_card_bills e installments.
-- 4. Garante que as policies de leitura (SELECT) permaneçam ativas sob RLS.
-- 5. Preserva mutações exclusivamente via RPCs com SECURITY DEFINER (owned by postgres).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. REVOGAÇÃO DE PRIVILÉGIOS DML DIRETOS
-- ------------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.credit_card_bills FROM authenticated, anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.installments FROM authenticated, anon, PUBLIC;

GRANT SELECT ON public.credit_card_bills TO authenticated;
GRANT SELECT ON public.installments TO authenticated;

-- ------------------------------------------------------------------------------
-- 2. REMOÇÃO DE POLÍTICAS DE ESCRITA DIRETA (INSERT, UPDATE, DELETE)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS credit_card_bills_insert ON public.credit_card_bills;
DROP POLICY IF EXISTS credit_card_bills_update ON public.credit_card_bills;
DROP POLICY IF EXISTS credit_card_bills_delete ON public.credit_card_bills;

DROP POLICY IF EXISTS installments_all ON public.installments;
DROP POLICY IF EXISTS installments_insert ON public.installments;
DROP POLICY IF EXISTS installments_update ON public.installments;
DROP POLICY IF EXISTS installments_delete ON public.installments;

-- ------------------------------------------------------------------------------
-- 3. GARANTIA DAS POLÍTICAS DE LEITURA (SELECT) SOB RLS
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS credit_card_bills_select ON public.credit_card_bills;
CREATE POLICY credit_card_bills_select ON public.credit_card_bills
    FOR SELECT
    USING (is_member(workspace_id));

DROP POLICY IF EXISTS installments_select ON public.installments;
CREATE POLICY installments_select ON public.installments
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.purchases p
            WHERE p.id = installments.purchase_id
              AND is_member(p.workspace_id)
        )
    );
