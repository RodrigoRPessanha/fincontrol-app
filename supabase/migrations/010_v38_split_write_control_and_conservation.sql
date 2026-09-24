-- ==============================================================================
-- MIGRATION 010: CONTROLE ESTRITO DE ESCRITA DE RATEIOS E CONSERVAÇÃO FINANCEIRA
-- ==============================================================================
-- 1. Remoção de triggers baseados na flag transacional app.allow_split_mutation
-- 2. Revogação formal de DML (INSERT, UPDATE, DELETE) em transaction_splits e purchase_splits para authenticated e anon
-- 3. Mutação de rateios exclusivamente autorizada via RPCs SECURITY DEFINER (fn_set_transaction_splits / fn_set_purchase_splits)
-- 4. Constraint triggers diferidos (DEFERRED) garantindo conservação exata da soma dos rateios
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. LIMPEZA DOS TRIGGERS E FUNÇÃO BASEADOS EM SET_CONFIG
-- ------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_prevent_direct_tx_split_mutation ON public.transaction_splits;
DROP TRIGGER IF EXISTS trg_prevent_direct_purchase_split_mutation ON public.purchase_splits;
DROP FUNCTION IF EXISTS public.fn_prevent_direct_split_mutation();

-- ------------------------------------------------------------------------------
-- 2. REVOGAÇÃO DE PRIVILÉGIOS DE ESCRITA DIRETA (NÍVEL DE TABELA)
-- ------------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.transaction_splits, public.purchase_splits FROM authenticated, anon, PUBLIC;
GRANT SELECT ON public.transaction_splits, public.purchase_splits TO authenticated;

-- Ajuste de políticas RLS: remoção das policies permissivas de escrita direta
DROP POLICY IF EXISTS transaction_splits_insert ON public.transaction_splits;
DROP POLICY IF EXISTS transaction_splits_update ON public.transaction_splits;
DROP POLICY IF EXISTS transaction_splits_delete ON public.transaction_splits;

DROP POLICY IF EXISTS purchase_splits_insert ON public.purchase_splits;
DROP POLICY IF EXISTS purchase_splits_update ON public.purchase_splits;
DROP POLICY IF EXISTS purchase_splits_delete ON public.purchase_splits;

-- ------------------------------------------------------------------------------
-- 3. CONSTRAINT TRIGGERS DIFERIDOS (GARANTIA DE CONSERVAÇÃO EXATA NO COMMIT)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_enforce_transaction_splits_total()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tx_id UUID;
    v_expected NUMERIC(12, 2);
    v_actual NUMERIC(12, 2);
    v_count INT;
BEGIN
    v_tx_id := COALESCE(NEW.transaction_id, OLD.transaction_id);
    SELECT amount INTO v_expected FROM public.transactions WHERE id = v_tx_id;
    IF FOUND THEN
        SELECT COALESCE(SUM(amount), 0), COUNT(*) INTO v_actual, v_count
        FROM public.transaction_splits WHERE transaction_id = v_tx_id;
        IF v_count > 0 AND v_actual <> v_expected THEN
            RAISE EXCEPTION 'Conservação violada: a soma das frações de rateio (R$ %) difere do total da transação (R$ %).', v_actual, v_expected;
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_tx_splits_total ON public.transaction_splits;
CREATE CONSTRAINT TRIGGER trg_enforce_tx_splits_total
    AFTER INSERT OR UPDATE OR DELETE ON public.transaction_splits
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_transaction_splits_total();

CREATE OR REPLACE FUNCTION public.fn_enforce_purchase_splits_total()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_pur_id UUID;
    v_expected NUMERIC(12, 2);
    v_actual NUMERIC(12, 2);
    v_count INT;
BEGIN
    v_pur_id := COALESCE(NEW.purchase_id, OLD.purchase_id);
    SELECT total_amount INTO v_expected FROM public.purchases WHERE id = v_pur_id;
    IF FOUND THEN
        SELECT COALESCE(SUM(amount), 0), COUNT(*) INTO v_actual, v_count
        FROM public.purchase_splits WHERE purchase_id = v_pur_id;
        IF v_count > 0 AND v_actual <> v_expected THEN
            RAISE EXCEPTION 'Conservação violada: a soma das frações de rateio (R$ %) difere do total da compra (R$ %).', v_actual, v_expected;
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_purchase_splits_total ON public.purchase_splits;
CREATE CONSTRAINT TRIGGER trg_enforce_purchase_splits_total
    AFTER INSERT OR UPDATE OR DELETE ON public.purchase_splits
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_purchase_splits_total();

-- ------------------------------------------------------------------------------
-- 4. REVISÃO DE fn_set_transaction_splits E fn_set_purchase_splits (SEM SET_CONFIG)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_set_transaction_splits(
    p_workspace_id UUID,
    p_transaction_id UUID,
    p_splits JSONB
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_tx_amount NUMERIC(12, 2);
    v_split RECORD;
    v_total_split NUMERIC(12, 2) := 0;
    v_count INT := 0;
    v_member_id UUID;
    v_amount NUMERIC(12, 2);
    v_pct NUMERIC(5, 2);
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: permissão insuficiente no workspace.';
    END IF;

    SELECT amount INTO v_tx_amount
    FROM public.transactions
    WHERE id = p_transaction_id AND workspace_id = p_workspace_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transação não encontrada no workspace especificado.';
    END IF;

    IF p_splits IS NULL OR jsonb_array_length(p_splits) = 0 THEN
        DELETE FROM public.transaction_splits WHERE transaction_id = p_transaction_id;
        RETURN 0;
    END IF;

    FOR v_split IN SELECT * FROM jsonb_to_recordset(p_splits) AS x(member_id UUID, amount NUMERIC, percentage NUMERIC) LOOP
        v_member_id := v_split.member_id;
        v_amount := v_split.amount;
        v_pct := v_split.percentage;

        IF v_member_id IS NULL THEN
            RAISE EXCEPTION 'Cada fração de rateio deve informar um member_id válido.';
        END IF;

        IF v_amount IS NULL OR v_amount < 0 THEN
            RAISE EXCEPTION 'O valor de cada fração de rateio não pode ser negativo.';
        END IF;

        IF v_pct IS NOT NULL AND (v_pct < 0 OR v_pct > 100) THEN
            RAISE EXCEPTION 'O percentual de cada fração de rateio deve estar entre 0 e 100.';
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM public.workspace_members 
            WHERE id = v_member_id AND workspace_id = p_workspace_id
        ) THEN
            RAISE EXCEPTION 'O participante do rateio (%) não pertence ao workspace.', v_member_id;
        END IF;

        v_total_split := v_total_split + v_amount;
    END LOOP;

    -- Conservação financeira estrita: soma das frações exatamente igual ao valor da transação
    IF v_total_split <> v_tx_amount THEN
        RAISE EXCEPTION 'A soma das frações do rateio (R$ %) deve ser exatamente igual ao valor total da transação (R$ %).', v_total_split, v_tx_amount;
    END IF;

    DELETE FROM public.transaction_splits WHERE transaction_id = p_transaction_id;

    FOR v_split IN SELECT * FROM jsonb_to_recordset(p_splits) AS x(member_id UUID, amount NUMERIC, percentage NUMERIC) LOOP
        INSERT INTO public.transaction_splits (workspace_id, transaction_id, member_id, amount, percentage)
        VALUES (p_workspace_id, p_transaction_id, v_split.member_id, v_split.amount, v_split.percentage);
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_set_purchase_splits(
    p_workspace_id UUID,
    p_purchase_id UUID,
    p_splits JSONB
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_purchase_amount NUMERIC(12, 2);
    v_split RECORD;
    v_total_split NUMERIC(12, 2) := 0;
    v_count INT := 0;
    v_member_id UUID;
    v_amount NUMERIC(12, 2);
    v_pct NUMERIC(5, 2);
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: permissão insuficiente no workspace.';
    END IF;

    SELECT total_amount INTO v_purchase_amount
    FROM public.purchases
    WHERE id = p_purchase_id AND workspace_id = p_workspace_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Compra parcelada não encontrada no workspace especificado.';
    END IF;

    IF p_splits IS NULL OR jsonb_array_length(p_splits) = 0 THEN
        DELETE FROM public.purchase_splits WHERE purchase_id = p_purchase_id;
        RETURN 0;
    END IF;

    FOR v_split IN SELECT * FROM jsonb_to_recordset(p_splits) AS x(member_id UUID, amount NUMERIC, percentage NUMERIC) LOOP
        v_member_id := v_split.member_id;
        v_amount := v_split.amount;
        v_pct := v_split.percentage;

        IF v_member_id IS NULL THEN
            RAISE EXCEPTION 'Cada fração de rateio deve informar um member_id válido.';
        END IF;

        IF v_amount IS NULL OR v_amount < 0 THEN
            RAISE EXCEPTION 'O valor de cada fração de rateio não pode ser negativo.';
        END IF;

        IF v_pct IS NOT NULL AND (v_pct < 0 OR v_pct > 100) THEN
            RAISE EXCEPTION 'O percentual de cada fração de rateio deve estar entre 0 e 100.';
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM public.workspace_members 
            WHERE id = v_member_id AND workspace_id = p_workspace_id
        ) THEN
            RAISE EXCEPTION 'O participante do rateio (%) não pertence ao workspace.', v_member_id;
        END IF;

        v_total_split := v_total_split + v_amount;
    END LOOP;

    -- Conservação financeira estrita: soma das frações exatamente igual ao total da compra
    IF v_total_split <> v_purchase_amount THEN
        RAISE EXCEPTION 'A soma das frações do rateio (R$ %) deve ser exatamente igual ao valor total da compra (R$ %).', v_total_split, v_purchase_amount;
    END IF;

    DELETE FROM public.purchase_splits WHERE purchase_id = p_purchase_id;

    FOR v_split IN SELECT * FROM jsonb_to_recordset(p_splits) AS x(member_id UUID, amount NUMERIC, percentage NUMERIC) LOOP
        INSERT INTO public.purchase_splits (workspace_id, purchase_id, member_id, amount, percentage)
        VALUES (p_workspace_id, p_purchase_id, v_split.member_id, v_split.amount, v_split.percentage);
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

ALTER FUNCTION public.fn_enforce_transaction_splits_total() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_enforce_purchase_splits_total() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_set_transaction_splits(UUID, UUID, JSONB) SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_set_purchase_splits(UUID, UUID, JSONB) SET search_path = public, pg_temp;

REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM PUBLIC, anon;
GRANT EXECUTE ON ALL ROUTINES IN SCHEMA public TO authenticated;
