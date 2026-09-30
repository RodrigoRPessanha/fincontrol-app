-- ==============================================================================
-- MIGRATION 035: PESSOAS NÃO-MEMBROS E RATEIO/ACERTO FLEXÍVEL DE CONTAS
-- ==============================================================================
-- 1. Criação da tabela public.people com RLS e triggers de integridade
-- 2. Suporte a person_id em transaction_splits e purchase_splits
-- 3. Suporte a paid_by_person_id em transactions e purchases
-- 4. Suporte a from_person_id e to_person_id em settlements
-- 5. Atualização das RPCs financeiras para suporte a pessoas
-- 6. Endurecimento de grants e registro no catálogo fail-closed (_db_managed_objects)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. TABELA PUBLIC.PEOPLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.people (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    archived BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_people_name_not_empty CHECK (trim(name) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_people_workspace_name_active
    ON public.people (workspace_id, lower(trim(name)))
    WHERE (archived = false);

CREATE INDEX IF NOT EXISTS idx_people_workspace_id ON public.people (workspace_id);

ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_prevent_workspace_change_people
    BEFORE UPDATE OF workspace_id ON public.people
    FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_workspace_id_change();

DROP POLICY IF EXISTS people_select ON public.people;
CREATE POLICY people_select ON public.people
    FOR SELECT USING (is_member(workspace_id));

DROP POLICY IF EXISTS people_insert ON public.people;
CREATE POLICY people_insert ON public.people
    FOR INSERT WITH CHECK (has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']));

DROP POLICY IF EXISTS people_update ON public.people;
CREATE POLICY people_update ON public.people
    FOR UPDATE USING (has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']));

DROP POLICY IF EXISTS people_delete ON public.people;
CREATE POLICY people_delete ON public.people
    FOR DELETE USING (has_workspace_role(workspace_id, ARRAY['owner', 'admin']));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.people TO authenticated;

-- ------------------------------------------------------------------------------
-- 2. ALTERAÇÃO DE TRANSACTIONS E PURCHASES (PAID_BY_PERSON_ID)
-- ------------------------------------------------------------------------------
ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS paid_by_person_id UUID REFERENCES public.people(id) ON DELETE RESTRICT;

ALTER TABLE public.transactions
    DROP CONSTRAINT IF EXISTS chk_transactions_paid_by_exclusive;
ALTER TABLE public.transactions
    ADD CONSTRAINT chk_transactions_paid_by_exclusive
    CHECK (paid_by_member_id IS NULL OR paid_by_person_id IS NULL);

CREATE INDEX IF NOT EXISTS idx_transactions_paid_by_person ON public.transactions(paid_by_person_id);

ALTER TABLE public.purchases
    ADD COLUMN IF NOT EXISTS paid_by_person_id UUID REFERENCES public.people(id) ON DELETE RESTRICT;

ALTER TABLE public.purchases
    DROP CONSTRAINT IF EXISTS chk_purchases_paid_by_exclusive;
ALTER TABLE public.purchases
    ADD CONSTRAINT chk_purchases_paid_by_exclusive
    CHECK (paid_by_member_id IS NULL OR paid_by_person_id IS NULL);

CREATE INDEX IF NOT EXISTS idx_purchases_paid_by_person ON public.purchases(paid_by_person_id);

-- ------------------------------------------------------------------------------
-- 3. ALTERAÇÃO DE TRANSACTION_SPLITS E PURCHASE_SPLITS (PERSON_ID)
-- ------------------------------------------------------------------------------
ALTER TABLE public.transaction_splits
    ALTER COLUMN member_id DROP NOT NULL;

ALTER TABLE public.transaction_splits
    ADD COLUMN IF NOT EXISTS person_id UUID REFERENCES public.people(id) ON DELETE RESTRICT;

ALTER TABLE public.transaction_splits
    DROP CONSTRAINT IF EXISTS chk_tx_splits_participant;
ALTER TABLE public.transaction_splits
    ADD CONSTRAINT chk_tx_splits_participant
    CHECK ((member_id IS NOT NULL AND person_id IS NULL) OR (member_id IS NULL AND person_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_tx_splits_person_id ON public.transaction_splits(person_id);

ALTER TABLE public.purchase_splits
    ALTER COLUMN member_id DROP NOT NULL;

ALTER TABLE public.purchase_splits
    ADD COLUMN IF NOT EXISTS person_id UUID REFERENCES public.people(id) ON DELETE RESTRICT;

ALTER TABLE public.purchase_splits
    DROP CONSTRAINT IF EXISTS chk_purchase_splits_participant;
ALTER TABLE public.purchase_splits
    ADD CONSTRAINT chk_purchase_splits_participant
    CHECK ((member_id IS NOT NULL AND person_id IS NULL) OR (member_id IS NULL AND person_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_purchase_splits_person_id ON public.purchase_splits(person_id);

-- ------------------------------------------------------------------------------
-- 4. ALTERAÇÃO DE SETTLEMENTS (FROM/TO PERSON_ID)
-- ------------------------------------------------------------------------------
ALTER TABLE public.settlements
    ALTER COLUMN from_member_id DROP NOT NULL;

ALTER TABLE public.settlements
    ALTER COLUMN to_member_id DROP NOT NULL;

ALTER TABLE public.settlements
    ADD COLUMN IF NOT EXISTS from_person_id UUID REFERENCES public.people(id) ON DELETE RESTRICT;

ALTER TABLE public.settlements
    ADD COLUMN IF NOT EXISTS to_person_id UUID REFERENCES public.people(id) ON DELETE RESTRICT;

ALTER TABLE public.settlements
    DROP CONSTRAINT IF EXISTS settlements_distinct_members_chk;
ALTER TABLE public.settlements
    DROP CONSTRAINT IF EXISTS chk_settlements_from_participant;
ALTER TABLE public.settlements
    DROP CONSTRAINT IF EXISTS chk_settlements_to_participant;
ALTER TABLE public.settlements
    DROP CONSTRAINT IF EXISTS chk_settlements_distinct_participants;

ALTER TABLE public.settlements
    ADD CONSTRAINT chk_settlements_from_participant
    CHECK ((from_member_id IS NOT NULL AND from_person_id IS NULL) OR (from_member_id IS NULL AND from_person_id IS NOT NULL));

ALTER TABLE public.settlements
    ADD CONSTRAINT chk_settlements_to_participant
    CHECK ((to_member_id IS NOT NULL AND to_person_id IS NULL) OR (to_member_id IS NULL AND to_person_id IS NOT NULL));

ALTER TABLE public.settlements
    ADD CONSTRAINT chk_settlements_distinct_participants
    CHECK (
        (from_member_id IS NULL OR to_member_id IS NULL OR from_member_id <> to_member_id) AND
        (from_person_id IS NULL OR to_person_id IS NULL OR from_person_id <> to_person_id)
    );

CREATE INDEX IF NOT EXISTS idx_settlements_from_person ON public.settlements(from_person_id);
CREATE INDEX IF NOT EXISTS idx_settlements_to_person ON public.settlements(to_person_id);

-- ------------------------------------------------------------------------------
-- 5. TRIGGERS CHILD-SIDE DE INTEGRIDADE REFERENCIAL DE WORKSPACE
-- ------------------------------------------------------------------------------

-- 5.1 Transactions paid_by
DROP TRIGGER IF EXISTS trg_check_transaction_paid_by_member ON public.transactions;
DROP TRIGGER IF EXISTS trg_check_transaction_paid_by_workspace ON public.transactions;
DROP FUNCTION IF EXISTS public.fn_check_transaction_paid_by_member_workspace_integrity();
DROP FUNCTION IF EXISTS public.fn_check_transaction_paid_by_workspace_integrity();

CREATE OR REPLACE FUNCTION public.fn_check_transaction_paid_by_workspace_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.paid_by_member_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.workspace_members
            WHERE id = NEW.paid_by_member_id AND workspace_id = NEW.workspace_id
        ) THEN
            RAISE EXCEPTION 'O membro pagador (paid_by_member_id) deve pertencer ao mesmo workspace da transação.';
        END IF;
    END IF;

    IF NEW.paid_by_person_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.people
            WHERE id = NEW.paid_by_person_id AND workspace_id = NEW.workspace_id
        ) THEN
            RAISE EXCEPTION 'A pessoa pagadora (paid_by_person_id) deve pertencer ao mesmo workspace da transação.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_check_transaction_paid_by_workspace
    BEFORE INSERT OR UPDATE OF paid_by_member_id, paid_by_person_id, workspace_id ON public.transactions
    FOR EACH ROW EXECUTE FUNCTION public.fn_check_transaction_paid_by_workspace_integrity();

-- 5.2 Purchases paid_by
DROP TRIGGER IF EXISTS trg_check_purchase_paid_by_member ON public.purchases;
DROP TRIGGER IF EXISTS trg_check_purchase_paid_by_workspace ON public.purchases;
DROP FUNCTION IF EXISTS public.fn_check_purchase_paid_by_member_workspace_integrity();
DROP FUNCTION IF EXISTS public.fn_check_purchase_paid_by_workspace_integrity();

CREATE OR REPLACE FUNCTION public.fn_check_purchase_paid_by_workspace_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.paid_by_member_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.workspace_members
            WHERE id = NEW.paid_by_member_id AND workspace_id = NEW.workspace_id
        ) THEN
            RAISE EXCEPTION 'O membro pagador (paid_by_member_id) deve pertencer ao mesmo workspace da compra parcelada.';
        END IF;
    END IF;

    IF NEW.paid_by_person_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.people
            WHERE id = NEW.paid_by_person_id AND workspace_id = NEW.workspace_id
        ) THEN
            RAISE EXCEPTION 'A pessoa pagadora (paid_by_person_id) deve pertencer ao mesmo workspace da compra parcelada.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_check_purchase_paid_by_workspace
    BEFORE INSERT OR UPDATE OF paid_by_member_id, paid_by_person_id, workspace_id ON public.purchases
    FOR EACH ROW EXECUTE FUNCTION public.fn_check_purchase_paid_by_workspace_integrity();

-- 5.3 Transaction splits
DROP TRIGGER IF EXISTS trg_check_transaction_split_workspace ON public.transaction_splits;
DROP FUNCTION IF EXISTS public.fn_check_transaction_split_workspace_integrity();

CREATE OR REPLACE FUNCTION public.fn_check_transaction_split_workspace_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tx_workspace_id UUID;
    v_part_workspace_id UUID;
BEGIN
    SELECT workspace_id INTO v_tx_workspace_id FROM public.transactions WHERE id = NEW.transaction_id;
    IF v_tx_workspace_id IS NULL OR v_tx_workspace_id <> NEW.workspace_id THEN
        RAISE EXCEPTION 'A transação do rateio pertence a outro workspace ou não existe.';
    END IF;

    IF NEW.member_id IS NOT NULL THEN
        SELECT workspace_id INTO v_part_workspace_id FROM public.workspace_members WHERE id = NEW.member_id;
        IF v_part_workspace_id IS NULL OR v_part_workspace_id <> NEW.workspace_id THEN
            RAISE EXCEPTION 'O participante do rateio deve pertencer ao mesmo workspace da transação.';
        END IF;
    END IF;

    IF NEW.person_id IS NOT NULL THEN
        SELECT workspace_id INTO v_part_workspace_id FROM public.people WHERE id = NEW.person_id;
        IF v_part_workspace_id IS NULL OR v_part_workspace_id <> NEW.workspace_id THEN
            RAISE EXCEPTION 'A pessoa participante do rateio deve pertencer ao mesmo workspace da transação.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_check_transaction_split_workspace
    BEFORE INSERT OR UPDATE ON public.transaction_splits
    FOR EACH ROW EXECUTE FUNCTION public.fn_check_transaction_split_workspace_integrity();

-- 5.4 Purchase splits
DROP TRIGGER IF EXISTS trg_check_purchase_split_workspace ON public.purchase_splits;
DROP FUNCTION IF EXISTS public.fn_check_purchase_split_workspace_integrity();

CREATE OR REPLACE FUNCTION public.fn_check_purchase_split_workspace_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_pur_workspace_id UUID;
    v_part_workspace_id UUID;
BEGIN
    SELECT workspace_id INTO v_pur_workspace_id FROM public.purchases WHERE id = NEW.purchase_id;
    IF v_pur_workspace_id IS NULL OR v_pur_workspace_id <> NEW.workspace_id THEN
        RAISE EXCEPTION 'A compra parcelada do rateio pertence a outro workspace ou não existe.';
    END IF;

    IF NEW.member_id IS NOT NULL THEN
        SELECT workspace_id INTO v_part_workspace_id FROM public.workspace_members WHERE id = NEW.member_id;
        IF v_part_workspace_id IS NULL OR v_part_workspace_id <> NEW.workspace_id THEN
            RAISE EXCEPTION 'O participante do rateio deve pertencer ao mesmo workspace da compra parcelada.';
        END IF;
    END IF;

    IF NEW.person_id IS NOT NULL THEN
        SELECT workspace_id INTO v_part_workspace_id FROM public.people WHERE id = NEW.person_id;
        IF v_part_workspace_id IS NULL OR v_part_workspace_id <> NEW.workspace_id THEN
            RAISE EXCEPTION 'A pessoa participante do rateio deve pertencer ao mesmo workspace da compra parcelada.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_check_purchase_split_workspace
    BEFORE INSERT OR UPDATE ON public.purchase_splits
    FOR EACH ROW EXECUTE FUNCTION public.fn_check_purchase_split_workspace_integrity();

-- 5.5 Settlements
DROP TRIGGER IF EXISTS trg_check_settlement_workspace ON public.settlements;
DROP FUNCTION IF EXISTS public.fn_check_settlement_workspace_integrity();

CREATE OR REPLACE FUNCTION public.fn_check_settlement_workspace_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_from_ws UUID;
    v_to_ws UUID;
    v_acc_ws UUID;
BEGIN
    IF NEW.from_member_id IS NOT NULL THEN
        SELECT workspace_id INTO v_from_ws FROM public.workspace_members WHERE id = NEW.from_member_id;
        IF v_from_ws IS NULL OR v_from_ws <> NEW.workspace_id THEN
            RAISE EXCEPTION 'O membro devedor (from_member_id) não pertence ao workspace do acerto.';
        END IF;
    END IF;

    IF NEW.from_person_id IS NOT NULL THEN
        SELECT workspace_id INTO v_from_ws FROM public.people WHERE id = NEW.from_person_id;
        IF v_from_ws IS NULL OR v_from_ws <> NEW.workspace_id THEN
            RAISE EXCEPTION 'A pessoa devedora (from_person_id) não pertence ao workspace do acerto.';
        END IF;
    END IF;

    IF NEW.to_member_id IS NOT NULL THEN
        SELECT workspace_id INTO v_to_ws FROM public.workspace_members WHERE id = NEW.to_member_id;
        IF v_to_ws IS NULL OR v_to_ws <> NEW.workspace_id THEN
            RAISE EXCEPTION 'O membro credor (to_member_id) não pertence ao workspace do acerto.';
        END IF;
    END IF;

    IF NEW.to_person_id IS NOT NULL THEN
        SELECT workspace_id INTO v_to_ws FROM public.people WHERE id = NEW.to_person_id;
        IF v_to_ws IS NULL OR v_to_ws <> NEW.workspace_id THEN
            RAISE EXCEPTION 'A pessoa credora (to_person_id) não pertence ao workspace do acerto.';
        END IF;
    END IF;

    IF NEW.payment_account_id IS NOT NULL THEN
        SELECT workspace_id INTO v_acc_ws FROM public.accounts WHERE id = NEW.payment_account_id;
        IF v_acc_ws IS NULL OR v_acc_ws <> NEW.workspace_id THEN
            RAISE EXCEPTION 'A conta de pagamento do acerto não pertence ao workspace informado.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_check_settlement_workspace
    BEFORE INSERT OR UPDATE ON public.settlements
    FOR EACH ROW EXECUTE FUNCTION public.fn_check_settlement_workspace_integrity();

-- ------------------------------------------------------------------------------
-- 6. ATUALIZAÇÃO DAS RPCS DE RATEIO (fn_set_transaction_splits / fn_set_purchase_splits)
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
    v_person_id UUID;
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

    FOR v_split IN SELECT * FROM jsonb_to_recordset(p_splits) AS x(member_id UUID, person_id UUID, amount NUMERIC, percentage NUMERIC) LOOP
        v_member_id := v_split.member_id;
        v_person_id := v_split.person_id;
        v_amount := v_split.amount;
        v_pct := v_split.percentage;

        IF (v_member_id IS NULL AND v_person_id IS NULL) OR (v_member_id IS NOT NULL AND v_person_id IS NOT NULL) THEN
            RAISE EXCEPTION 'Cada fração de rateio deve informar exatamente um member_id ou person_id válido.';
        END IF;

        IF v_amount IS NULL OR v_amount <= 0 THEN
            RAISE EXCEPTION 'O valor de cada fração de rateio deve ser estritamente maior que zero.';
        END IF;

        IF v_pct IS NOT NULL AND (v_pct < 0 OR v_pct > 100) THEN
            RAISE EXCEPTION 'O percentual de cada fração de rateio deve estar entre 0 e 100.';
        END IF;

        IF v_member_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM public.workspace_members
            WHERE id = v_member_id AND workspace_id = p_workspace_id
        ) THEN
            RAISE EXCEPTION 'O participante do rateio (%) não pertence ao workspace.', v_member_id;
        END IF;

        IF v_person_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM public.people
            WHERE id = v_person_id AND workspace_id = p_workspace_id
        ) THEN
            RAISE EXCEPTION 'A pessoa participante do rateio (%) não pertence ao workspace.', v_person_id;
        END IF;

        v_total_split := v_total_split + v_amount;
    END LOOP;

    -- Conservação financeira estrita: soma das frações exatamente igual ao valor da transação
    IF v_total_split <> v_tx_amount THEN
        RAISE EXCEPTION 'A soma das frações do rateio (R$ %) deve ser exatamente igual ao valor total da transação (R$ %).', v_total_split, v_tx_amount;
    END IF;

    DELETE FROM public.transaction_splits WHERE transaction_id = p_transaction_id;

    FOR v_split IN SELECT * FROM jsonb_to_recordset(p_splits) AS x(member_id UUID, person_id UUID, amount NUMERIC, percentage NUMERIC) LOOP
        INSERT INTO public.transaction_splits (workspace_id, transaction_id, member_id, person_id, amount, percentage)
        VALUES (p_workspace_id, p_transaction_id, v_split.member_id, v_split.person_id, v_split.amount, v_split.percentage);
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
    v_person_id UUID;
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

    FOR v_split IN SELECT * FROM jsonb_to_recordset(p_splits) AS x(member_id UUID, person_id UUID, amount NUMERIC, percentage NUMERIC) LOOP
        v_member_id := v_split.member_id;
        v_person_id := v_split.person_id;
        v_amount := v_split.amount;
        v_pct := v_split.percentage;

        IF (v_member_id IS NULL AND v_person_id IS NULL) OR (v_member_id IS NOT NULL AND v_person_id IS NOT NULL) THEN
            RAISE EXCEPTION 'Cada fração de rateio deve informar exatamente um member_id ou person_id válido.';
        END IF;

        IF v_amount IS NULL OR v_amount <= 0 THEN
            RAISE EXCEPTION 'O valor de cada fração de rateio deve ser estritamente maior que zero.';
        END IF;

        IF v_pct IS NOT NULL AND (v_pct < 0 OR v_pct > 100) THEN
            RAISE EXCEPTION 'O percentual de cada fração de rateio deve estar entre 0 e 100.';
        END IF;

        IF v_member_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM public.workspace_members
            WHERE id = v_member_id AND workspace_id = p_workspace_id
        ) THEN
            RAISE EXCEPTION 'O participante do rateio (%) não pertence ao workspace.', v_member_id;
        END IF;

        IF v_person_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM public.people
            WHERE id = v_person_id AND workspace_id = p_workspace_id
        ) THEN
            RAISE EXCEPTION 'A pessoa participante do rateio (%) não pertence ao workspace.', v_person_id;
        END IF;

        v_total_split := v_total_split + v_amount;
    END LOOP;

    -- Conservação financeira estrita: soma das frações exatamente igual ao total da compra
    IF v_total_split <> v_purchase_amount THEN
        RAISE EXCEPTION 'A soma das frações do rateio (R$ %) deve ser exatamente igual ao valor total da compra (R$ %).', v_total_split, v_purchase_amount;
    END IF;

    DELETE FROM public.purchase_splits WHERE purchase_id = p_purchase_id;

    FOR v_split IN SELECT * FROM jsonb_to_recordset(p_splits) AS x(member_id UUID, person_id UUID, amount NUMERIC, percentage NUMERIC) LOOP
        INSERT INTO public.purchase_splits (workspace_id, purchase_id, member_id, person_id, amount, percentage)
        VALUES (p_workspace_id, p_purchase_id, v_split.member_id, v_split.person_id, v_split.amount, v_split.percentage);
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. ATUALIZAÇÃO DAS RPCS DE CRIAÇÃO E EDIÇÃO ATÔMICA (TRANSAÇÕES E COMPRAS)
-- ------------------------------------------------------------------------------

-- 7.1 fn_create_transaction_with_splits
DROP FUNCTION IF EXISTS public.fn_create_transaction_with_splits(UUID, TEXT, NUMERIC, DATE, TEXT, TEXT, UUID, UUID, UUID, UUID, UUID, TEXT, UUID, TEXT, DATE, JSONB);
DROP FUNCTION IF EXISTS public.fn_create_transaction_with_splits(UUID, TEXT, NUMERIC, DATE, TEXT, TEXT, UUID, UUID, UUID, UUID, UUID, TEXT, UUID, TEXT, DATE, JSONB, UUID);

CREATE OR REPLACE FUNCTION public.fn_create_transaction_with_splits(
    p_workspace_id UUID,
    p_description TEXT,
    p_amount NUMERIC(12, 2),
    p_transaction_date DATE DEFAULT CURRENT_DATE,
    p_type TEXT DEFAULT 'expense',
    p_status TEXT DEFAULT 'pending',
    p_category_id UUID DEFAULT NULL,
    p_account_id UUID DEFAULT NULL,
    p_payment_method_id UUID DEFAULT NULL,
    p_credit_card_id UUID DEFAULT NULL,
    p_credit_card_bill_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_paid_by_member_id UUID DEFAULT NULL,
    p_split_type TEXT DEFAULT 'individual',
    p_due_date DATE DEFAULT NULL,
    p_splits JSONB DEFAULT NULL,
    p_paid_by_person_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_tx_id UUID;
    v_status TEXT;
    v_ws_mode TEXT;
    v_affects_balance BOOLEAN;
    v_payment_id UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: você não possui permissão de escrita neste workspace.';
    END IF;

    IF TRIM(COALESCE(p_description, '')) = '' THEN
        RAISE EXCEPTION 'A descrição da transação não pode ser vazia.';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'O valor da transação deve ser maior que zero.';
    END IF;

    v_status := COALESCE(p_status, 'pending');

    -- Validação de pagador exclusivo
    IF p_paid_by_member_id IS NOT NULL AND p_paid_by_person_id IS NOT NULL THEN
        RAISE EXCEPTION 'A transação não pode ter paid_by_member_id e paid_by_person_id simultaneamente.';
    END IF;

    IF p_paid_by_member_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.workspace_members
        WHERE id = p_paid_by_member_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Membro pagador informado não pertence ao workspace.';
    END IF;

    IF p_paid_by_person_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.people
        WHERE id = p_paid_by_person_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Pessoa pagadora informada não pertence ao workspace.';
    END IF;

    -- Bloqueio: transações de cartão não podem ser criadas com status 'paid' direto (dependem da fatura)
    IF (p_credit_card_id IS NOT NULL OR p_credit_card_bill_id IS NOT NULL) AND v_status = 'paid' THEN
        RAISE EXCEPTION 'Transações vinculadas a cartão de crédito não podem ser marcadas como pagas diretamente.';
    END IF;

    -- Se status for 'paid', valida regras de conta conforme o modo do workspace
    IF v_status = 'paid' THEN
        SELECT tracking_mode INTO v_ws_mode
        FROM public.workspaces
        WHERE id = p_workspace_id;

        IF v_ws_mode = 'full' AND p_account_id IS NULL THEN
            RAISE EXCEPTION 'Conta bancária é obrigatória para registrar transação paga no modo full.';
        END IF;
    END IF;

    INSERT INTO public.transactions (
        workspace_id, description, amount, transaction_date, due_date,
        type, status, category_id, account_id, payment_method_id,
        credit_card_id, credit_card_bill_id, notes, paid_by_member_id,
        paid_by_person_id, split_type, created_by, paid_at
    )
    VALUES (
        p_workspace_id, TRIM(p_description), p_amount, COALESCE(p_transaction_date, CURRENT_DATE),
        COALESCE(p_due_date, p_transaction_date, CURRENT_DATE),
        COALESCE(p_type, 'expense'), v_status,
        p_category_id, p_account_id, p_payment_method_id,
        p_credit_card_id, p_credit_card_bill_id, p_notes,
        p_paid_by_member_id, p_paid_by_person_id, COALESCE(p_split_type, 'individual'), v_user_id,
        CASE WHEN v_status = 'paid' THEN COALESCE(p_transaction_date, CURRENT_DATE)::TIMESTAMPTZ ELSE NULL END
    )
    RETURNING id INTO v_tx_id;

    -- Se splits foram fornecidos, insere atomicamente
    IF p_splits IS NOT NULL AND jsonb_array_length(p_splits) > 0 THEN
        PERFORM public.fn_set_transaction_splits(p_workspace_id, v_tx_id, p_splits);
    END IF;

    -- Se criada como 'paid', registra o pagamento correspondente e ajusta o saldo da conta
    IF v_status = 'paid' THEN
        v_affects_balance := (p_account_id IS NOT NULL);

        INSERT INTO public.payments (
            workspace_id, transaction_id, account_id, payment_method_id,
            amount, payment_date, notes, created_by, affects_balance
        )
        VALUES (
            p_workspace_id, v_tx_id, p_account_id, p_payment_method_id,
            p_amount, COALESCE(p_transaction_date, CURRENT_DATE), p_notes, v_user_id, v_affects_balance
        )
        RETURNING id INTO v_payment_id;

        IF v_affects_balance THEN
            IF COALESCE(p_type, 'expense') = 'income' THEN
                UPDATE public.accounts
                SET current_balance = current_balance + p_amount
                WHERE id = p_account_id AND workspace_id = p_workspace_id;
            ELSE
                UPDATE public.accounts
                SET current_balance = current_balance - p_amount
                WHERE id = p_account_id AND workspace_id = p_workspace_id;
            END IF;
        END IF;
    END IF;

    RETURN v_tx_id;
END;
$$;

-- 7.2 fn_update_transaction_with_splits
DROP FUNCTION IF EXISTS public.fn_update_transaction_with_splits(UUID, UUID, TEXT, NUMERIC, DATE, TEXT, UUID, UUID, UUID, UUID, UUID, TEXT, UUID, TEXT, DATE, JSONB);
DROP FUNCTION IF EXISTS public.fn_update_transaction_with_splits(UUID, UUID, TEXT, NUMERIC, DATE, TEXT, UUID, UUID, UUID, UUID, UUID, TEXT, UUID, TEXT, DATE, JSONB, UUID);

CREATE OR REPLACE FUNCTION public.fn_update_transaction_with_splits(
    p_workspace_id UUID,
    p_transaction_id UUID,
    p_description TEXT DEFAULT NULL,
    p_amount NUMERIC(12, 2) DEFAULT NULL,
    p_transaction_date DATE DEFAULT NULL,
    p_type TEXT DEFAULT NULL,
    p_category_id UUID DEFAULT NULL,
    p_account_id UUID DEFAULT NULL,
    p_payment_method_id UUID DEFAULT NULL,
    p_credit_card_id UUID DEFAULT NULL,
    p_credit_card_bill_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_paid_by_member_id UUID DEFAULT NULL,
    p_split_type TEXT DEFAULT NULL,
    p_due_date DATE DEFAULT NULL,
    p_splits JSONB DEFAULT NULL,
    p_paid_by_person_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_old_tx RECORD;
    v_new_amount NUMERIC(12, 2);
    v_new_type TEXT;
    v_pay RECORD;
    v_paid_total NUMERIC(12, 2) := 0;
    v_split RECORD;
    v_total_split NUMERIC(12, 2) := 0;
    v_member_id UUID;
    v_person_id UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: você não possui permissão de escrita neste workspace.';
    END IF;

    SELECT * INTO v_old_tx
    FROM public.transactions
    WHERE id = p_transaction_id AND workspace_id = p_workspace_id
    FOR UPDATE;

    IF v_old_tx.id IS NULL THEN
        RAISE EXCEPTION 'Transação não encontrada no workspace informado.';
    END IF;

    v_new_amount := COALESCE(p_amount, v_old_tx.amount);
    IF v_new_amount <= 0 THEN
        RAISE EXCEPTION 'O valor da transação deve ser estritamente maior que zero.';
    END IF;

    -- Validação de pagador exclusivo
    IF p_paid_by_member_id IS NOT NULL AND p_paid_by_person_id IS NOT NULL THEN
        RAISE EXCEPTION 'A transação não pode ter paid_by_member_id e paid_by_person_id simultaneamente.';
    END IF;

    IF p_paid_by_member_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.workspace_members
        WHERE id = p_paid_by_member_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Membro pagador informado não pertence ao workspace.';
    END IF;

    IF p_paid_by_person_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.people
        WHERE id = p_paid_by_person_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Pessoa pagadora informada não pertence ao workspace.';
    END IF;

    -- Valida se o novo valor não é menor que o total já pago
    SELECT COALESCE(SUM(amount), 0) INTO v_paid_total
    FROM public.payments
    WHERE transaction_id = p_transaction_id;

    IF v_paid_total > v_new_amount THEN
        RAISE EXCEPTION 'O novo valor da transação (R$ %) não pode ser menor do que o total já pago (R$ %).', v_new_amount, v_paid_total;
    END IF;

    v_new_type := COALESCE(p_type, v_old_tx.type);

    -- Se o tipo mudou (expense <-> income), inverte o efeito dos pagamentos existentes nas contas bancárias
    IF v_new_type <> v_old_tx.type THEN
        FOR v_pay IN
            SELECT account_id, amount
            FROM public.payments
            WHERE transaction_id = p_transaction_id AND affects_balance = TRUE AND account_id IS NOT NULL
        LOOP
            IF v_new_type = 'income' AND v_old_tx.type = 'expense' THEN
                UPDATE public.accounts
                SET current_balance = current_balance + (2 * v_pay.amount)
                WHERE id = v_pay.account_id AND workspace_id = p_workspace_id;
            ELSIF v_new_type = 'expense' AND v_old_tx.type = 'income' THEN
                UPDATE public.accounts
                SET current_balance = current_balance - (2 * v_pay.amount)
                WHERE id = v_pay.account_id AND workspace_id = p_workspace_id;
            END IF;
        END LOOP;
    END IF;

    -- Sincroniza splits PRIMEIRO se informados
    IF p_splits IS NOT NULL THEN
        IF jsonb_array_length(p_splits) > 0 THEN
            FOR v_split IN SELECT * FROM jsonb_to_recordset(p_splits) AS x(member_id UUID, person_id UUID, amount NUMERIC, percentage NUMERIC) LOOP
                v_member_id := v_split.member_id;
                v_person_id := v_split.person_id;

                IF (v_member_id IS NULL AND v_person_id IS NULL) OR (v_member_id IS NOT NULL AND v_person_id IS NOT NULL) THEN
                    RAISE EXCEPTION 'Cada fração de rateio deve informar exatamente um member_id ou person_id válido.';
                END IF;

                IF v_member_id IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM public.workspace_members
                    WHERE id = v_member_id AND workspace_id = p_workspace_id
                ) THEN
                    RAISE EXCEPTION 'Membro do rateio não pertence ao workspace.';
                END IF;

                IF v_person_id IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM public.people
                    WHERE id = v_person_id AND workspace_id = p_workspace_id
                ) THEN
                    RAISE EXCEPTION 'Pessoa participante do rateio não pertence ao workspace.';
                END IF;

                IF v_split.amount IS NULL OR v_split.amount <= 0 THEN
                    RAISE EXCEPTION 'O valor de cada fração do rateio deve ser estritamente maior que zero.';
                END IF;

                v_total_split := v_total_split + v_split.amount;
            END LOOP;

            IF v_total_split <> v_new_amount THEN
                RAISE EXCEPTION 'A soma das frações do rateio (R$ %) deve ser exatamente igual ao valor total da transação (R$ %).', v_total_split, v_new_amount;
            END IF;

            DELETE FROM public.transaction_splits WHERE transaction_id = p_transaction_id;

            FOR v_split IN SELECT * FROM jsonb_to_recordset(p_splits) AS x(member_id UUID, person_id UUID, amount NUMERIC, percentage NUMERIC) LOOP
                INSERT INTO public.transaction_splits (workspace_id, transaction_id, member_id, person_id, amount, percentage)
                VALUES (p_workspace_id, p_transaction_id, v_split.member_id, v_split.person_id, v_split.amount, v_split.percentage);
            END LOOP;
        ELSE
            DELETE FROM public.transaction_splits WHERE transaction_id = p_transaction_id;
        END IF;
    END IF;

    -- Atualiza a transação
    UPDATE public.transactions
    SET description = COALESCE(TRIM(p_description), description),
        amount = v_new_amount,
        transaction_date = COALESCE(p_transaction_date, transaction_date),
        due_date = COALESCE(p_due_date, due_date),
        type = v_new_type,
        category_id = p_category_id,
        account_id = p_account_id,
        payment_method_id = p_payment_method_id,
        credit_card_id = p_credit_card_id,
        credit_card_bill_id = p_credit_card_bill_id,
        notes = p_notes,
        paid_by_member_id = p_paid_by_member_id,
        paid_by_person_id = p_paid_by_person_id,
        split_type = COALESCE(p_split_type, split_type),
        status = CASE
            WHEN v_paid_total >= v_new_amount AND v_paid_total > 0 THEN 'paid'
            WHEN v_paid_total > 0 THEN 'partially_paid'
            WHEN COALESCE(p_due_date, due_date) < CURRENT_DATE THEN 'overdue'
            ELSE 'pending'
        END
    WHERE id = p_transaction_id AND workspace_id = p_workspace_id;

    RETURN p_transaction_id;
END;
$$;

-- 7.3 fn_create_installment_purchase
DROP FUNCTION IF EXISTS public.fn_create_installment_purchase(UUID, TEXT, NUMERIC, INT, DATE, UUID, UUID, UUID, UUID, INT, UUID, TEXT);
DROP FUNCTION IF EXISTS public.fn_create_installment_purchase(UUID, TEXT, NUMERIC, INT, DATE, UUID, UUID, UUID, UUID, INT, UUID, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.fn_create_installment_purchase(
    p_workspace_id UUID,
    p_description TEXT,
    p_total_amount NUMERIC(12, 2),
    p_installment_count INT,
    p_purchase_date DATE DEFAULT CURRENT_DATE,
    p_credit_card_id UUID DEFAULT NULL,
    p_category_id UUID DEFAULT NULL,
    p_account_id UUID DEFAULT NULL,
    p_payment_method_id UUID DEFAULT NULL,
    p_paid_installments_count INT DEFAULT 0,
    p_paid_by_member_id UUID DEFAULT NULL,
    p_split_type TEXT DEFAULT 'individual',
    p_paid_by_person_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_purchase_id UUID;
    v_base_amount NUMERIC(12, 2);
    v_remainder NUMERIC(12, 2);
    v_first_amount NUMERIC(12, 2);
    v_amount NUMERIC(12, 2);
    v_bill_id UUID;
    v_card_closing INT;
    v_p_day INT;
    v_p_month INT;
    v_p_year INT;
    v_start_month INT;
    v_start_year INT;
    v_cycle_month INT;
    v_cycle_year INT;
    v_ref_month TEXT;
    v_due_date DATE;
    v_is_paid BOOLEAN;
    v_paid_count INT;
    v_split_mode TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: você não possui permissão de escrita neste workspace.';
    END IF;

    IF p_installment_count < 1 OR p_installment_count > 120 THEN
        RAISE EXCEPTION 'A quantidade de parcelas deve estar entre 1 e 120.';
    END IF;

    IF p_total_amount <= 0 THEN
        RAISE EXCEPTION 'O valor total deve ser estritamente maior que zero.';
    END IF;

    IF p_total_amount < p_installment_count * 0.01 THEN
        RAISE EXCEPTION 'O valor total é insuficiente para gerar parcelas de no mínimo R$ 0,01.';
    END IF;

    v_paid_count := COALESCE(p_paid_installments_count, 0);
    IF v_paid_count < 0 OR v_paid_count > p_installment_count THEN
        RAISE EXCEPTION 'A quantidade de parcelas já pagas deve estar entre 0 e o total de parcelas.';
    END IF;

    v_split_mode := COALESCE(p_split_type, 'individual');
    IF v_split_mode NOT IN ('individual', 'equal', 'full_other', 'custom') THEN
        RAISE EXCEPTION 'Tipo de rateio inválido.';
    END IF;

    IF p_paid_by_member_id IS NOT NULL AND p_paid_by_person_id IS NOT NULL THEN
        RAISE EXCEPTION 'A compra não pode ter paid_by_member_id e paid_by_person_id simultaneamente.';
    END IF;

    IF p_paid_by_member_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.workspace_members
        WHERE id = p_paid_by_member_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Membro pagador informado não pertence ao workspace.';
    END IF;

    IF p_paid_by_person_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.people
        WHERE id = p_paid_by_person_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Pessoa pagadora informada não pertence ao workspace.';
    END IF;

    IF p_account_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.accounts WHERE id = p_account_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Conta bancária informada não pertence ao workspace.';
    END IF;

    IF p_category_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.categories WHERE id = p_category_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Categoria informada não pertence ao workspace.';
    END IF;

    IF p_payment_method_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.payment_methods WHERE id = p_payment_method_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Método de pagamento informado não pertence ao workspace.';
    END IF;

    INSERT INTO public.purchases (
        workspace_id, account_id, credit_card_id, category_id, payment_method_id,
        description, total_amount, installment_count, paid_installments_count,
        purchase_date, created_by, paid_by_member_id, paid_by_person_id, split_type
    )
    VALUES (
        p_workspace_id, p_account_id, p_credit_card_id, p_category_id, p_payment_method_id,
        p_description, p_total_amount, p_installment_count, v_paid_count,
        p_purchase_date, auth.uid(), p_paid_by_member_id, p_paid_by_person_id, v_split_mode
    )
    RETURNING id INTO v_purchase_id;

    v_base_amount := TRUNC(p_total_amount / p_installment_count, 2);
    v_remainder := p_total_amount - (v_base_amount * p_installment_count);
    v_first_amount := v_base_amount + v_remainder;

    IF p_credit_card_id IS NOT NULL THEN
        SELECT closing_day INTO v_card_closing
        FROM public.credit_cards
        WHERE id = p_credit_card_id AND workspace_id = p_workspace_id;

        IF v_card_closing IS NULL THEN
            RAISE EXCEPTION 'Cartão de crédito não encontrado no workspace informado.';
        END IF;

        v_p_day := EXTRACT(DAY FROM p_purchase_date);
        v_p_month := EXTRACT(MONTH FROM p_purchase_date);
        v_p_year := EXTRACT(YEAR FROM p_purchase_date);

        IF v_p_day >= v_card_closing THEN
            v_start_month := v_p_month + 1;
            v_start_year := v_p_year;
            IF v_start_month > 12 THEN
                v_start_month := 1;
                v_start_year := v_start_year + 1;
            END IF;
        ELSE
            v_start_month := v_p_month;
            v_start_year := v_p_year;
        END IF;
    END IF;

    FOR i IN 1..p_installment_count LOOP
        IF i = 1 THEN
            v_amount := v_first_amount;
        ELSE
            v_amount := v_base_amount;
        END IF;

        v_is_paid := (i <= v_paid_count);
        v_bill_id := NULL;

        IF p_credit_card_id IS NOT NULL THEN
            v_cycle_month := v_start_month + (i - 1);
            v_cycle_year := v_start_year + ((v_cycle_month - 1) / 12);
            v_cycle_month := ((v_cycle_month - 1) % 12) + 1;
            v_ref_month := to_char(v_cycle_year, 'FM0000') || '-' || to_char(v_cycle_month, 'FM00');

            v_bill_id := public.fn_get_or_create_credit_card_bill(
                p_workspace_id,
                p_credit_card_id,
                v_ref_month
            );

            SELECT due_date INTO v_due_date
            FROM public.credit_card_bills
            WHERE id = v_bill_id;
        ELSE
            v_due_date := (p_purchase_date + ((i - 1) || ' month')::INTERVAL)::DATE;
        END IF;

        INSERT INTO public.installments (
            purchase_id,
            credit_card_bill_id,
            installment_number,
            amount,
            due_date,
            status,
            paid_amount,
            paid_at
        )
        VALUES (
            v_purchase_id,
            v_bill_id,
            i,
            v_amount,
            v_due_date,
            CASE WHEN v_is_paid THEN 'paid' ELSE 'pending' END,
            CASE WHEN v_is_paid THEN v_amount ELSE 0.00 END,
            CASE WHEN v_is_paid THEN CURRENT_TIMESTAMP ELSE NULL END
        );

        IF v_bill_id IS NOT NULL THEN
            UPDATE public.credit_card_bills
            SET total_amount = total_amount + v_amount,
                paid_amount = paid_amount + (CASE WHEN v_is_paid THEN v_amount ELSE 0.00 END),
                status = CASE
                    WHEN (paid_amount + (CASE WHEN v_is_paid THEN v_amount ELSE 0.00 END)) >= (total_amount + v_amount) THEN 'paid'
                    WHEN (paid_amount + (CASE WHEN v_is_paid THEN v_amount ELSE 0.00 END)) > 0 THEN 'partially_paid'
                    ELSE status
                END,
                paid_at = CASE
                    WHEN (paid_amount + (CASE WHEN v_is_paid THEN v_amount ELSE 0.00 END)) >= (total_amount + v_amount) THEN CURRENT_TIMESTAMP
                    ELSE paid_at
                END
            WHERE id = v_bill_id;
        END IF;
    END LOOP;

    RETURN v_purchase_id;
END;
$$;

-- 7.4 fn_create_purchase_with_splits
DROP FUNCTION IF EXISTS public.fn_create_purchase_with_splits(UUID, TEXT, NUMERIC, INT, DATE, UUID, UUID, UUID, UUID, INT, UUID, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.fn_create_purchase_with_splits(UUID, TEXT, NUMERIC, INT, DATE, UUID, UUID, UUID, UUID, INT, UUID, TEXT, JSONB, UUID);

CREATE OR REPLACE FUNCTION public.fn_create_purchase_with_splits(
    p_workspace_id UUID,
    p_description TEXT,
    p_total_amount NUMERIC(12, 2),
    p_installment_count INT,
    p_purchase_date DATE DEFAULT CURRENT_DATE,
    p_credit_card_id UUID DEFAULT NULL,
    p_category_id UUID DEFAULT NULL,
    p_account_id UUID DEFAULT NULL,
    p_payment_method_id UUID DEFAULT NULL,
    p_paid_installments_count INT DEFAULT 0,
    p_paid_by_member_id UUID DEFAULT NULL,
    p_split_type TEXT DEFAULT 'individual',
    p_splits JSONB DEFAULT NULL,
    p_paid_by_person_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_purchase_id UUID;
BEGIN
    v_purchase_id := public.fn_create_installment_purchase(
        p_workspace_id,
        p_description,
        p_total_amount,
        p_installment_count,
        p_purchase_date,
        p_credit_card_id,
        p_category_id,
        p_account_id,
        p_payment_method_id,
        p_paid_installments_count,
        p_paid_by_member_id,
        p_split_type,
        p_paid_by_person_id
    );

    IF p_splits IS NOT NULL AND jsonb_array_length(p_splits) > 0 THEN
        PERFORM public.fn_set_purchase_splits(p_workspace_id, v_purchase_id, p_splits);
    END IF;

    RETURN v_purchase_id;
END;
$$;

-- 7.5 fn_update_purchase_with_splits
DROP FUNCTION IF EXISTS public.fn_update_purchase_with_splits(UUID, UUID, TEXT, NUMERIC, DATE, UUID, UUID, UUID, UUID, UUID, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.fn_update_purchase_with_splits(UUID, UUID, TEXT, NUMERIC, DATE, UUID, UUID, UUID, UUID, UUID, TEXT, JSONB, UUID);

CREATE OR REPLACE FUNCTION public.fn_update_purchase_with_splits(
    p_workspace_id UUID,
    p_purchase_id UUID,
    p_description TEXT DEFAULT NULL,
    p_total_amount NUMERIC(12, 2) DEFAULT NULL,
    p_purchase_date DATE DEFAULT NULL,
    p_category_id UUID DEFAULT NULL,
    p_account_id UUID DEFAULT NULL,
    p_payment_method_id UUID DEFAULT NULL,
    p_credit_card_id UUID DEFAULT NULL,
    p_paid_by_member_id UUID DEFAULT NULL,
    p_split_type TEXT DEFAULT NULL,
    p_splits JSONB DEFAULT NULL,
    p_paid_by_person_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_old_purchase RECORD;
    v_new_amount NUMERIC(12, 2);
    v_split RECORD;
    v_total_split NUMERIC(12, 2) := 0;
    v_member_id UUID;
    v_person_id UUID;
    v_fully_paid_amount NUMERIC(12, 2) := 0;
    v_total_paid_all NUMERIC(12, 2) := 0;
    v_paid_count INT := 0;
    v_unpaid_count INT := 0;
    v_remaining_amount NUMERIC(12, 2);
    v_base_inst NUMERIC(12, 2);
    v_rem_inst NUMERIC(12, 2);
    v_first_inst NUMERIC(12, 2);
    v_inst_amt NUMERIC(12, 2);
    v_inst RECORD;
    v_inst_idx INT := 0;
    v_diff NUMERIC(12, 2);
    v_bill RECORD;
    v_bill_fully_paid BOOLEAN;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: você não possui permissão de escrita neste workspace.';
    END IF;

    SELECT * INTO v_old_purchase
    FROM public.purchases
    WHERE id = p_purchase_id AND workspace_id = p_workspace_id
    FOR UPDATE;

    IF v_old_purchase.id IS NULL THEN
        RAISE EXCEPTION 'Compra parcelada não encontrada no workspace informado.';
    END IF;

    v_new_amount := COALESCE(p_total_amount, v_old_purchase.total_amount);
    IF v_new_amount <= 0 THEN
        RAISE EXCEPTION 'O valor total da compra deve ser estritamente maior que zero.';
    END IF;

    -- Validação de pagador exclusivo
    IF p_paid_by_member_id IS NOT NULL AND p_paid_by_person_id IS NOT NULL THEN
        RAISE EXCEPTION 'A compra não pode ter paid_by_member_id e paid_by_person_id simultaneamente.';
    END IF;

    IF p_paid_by_member_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.workspace_members
        WHERE id = p_paid_by_member_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Membro pagador informado não pertence ao workspace.';
    END IF;

    IF p_paid_by_person_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.people
        WHERE id = p_paid_by_person_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Pessoa pagadora informada não pertence ao workspace.';
    END IF;

    -- 1. Sincroniza splits PRIMEIRO para satisfazer o trigger incondicional
    IF p_splits IS NOT NULL THEN
        IF jsonb_array_length(p_splits) > 0 THEN
            FOR v_split IN SELECT * FROM jsonb_to_recordset(p_splits) AS x(member_id UUID, person_id UUID, amount NUMERIC, percentage NUMERIC) LOOP
                v_member_id := v_split.member_id;
                v_person_id := v_split.person_id;

                IF (v_member_id IS NULL AND v_person_id IS NULL) OR (v_member_id IS NOT NULL AND v_person_id IS NOT NULL) THEN
                    RAISE EXCEPTION 'Cada fração de rateio deve informar exatamente um member_id ou person_id válido.';
                END IF;

                IF v_member_id IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM public.workspace_members
                    WHERE id = v_member_id AND workspace_id = p_workspace_id
                ) THEN
                    RAISE EXCEPTION 'Membro do rateio não pertence ao workspace.';
                END IF;

                IF v_person_id IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM public.people
                    WHERE id = v_person_id AND workspace_id = p_workspace_id
                ) THEN
                    RAISE EXCEPTION 'Pessoa participante do rateio não pertence ao workspace.';
                END IF;

                IF v_split.amount IS NULL OR v_split.amount <= 0 THEN
                    RAISE EXCEPTION 'O valor de cada fração do rateio deve ser estritamente maior que zero.';
                END IF;

                v_total_split := v_total_split + v_split.amount;
            END LOOP;

            IF v_total_split <> v_new_amount THEN
                RAISE EXCEPTION 'A soma das frações do rateio (R$ %) deve ser exatamente igual ao valor total da compra (R$ %).', v_total_split, v_new_amount;
            END IF;

            DELETE FROM public.purchase_splits WHERE purchase_id = p_purchase_id;

            FOR v_split IN SELECT * FROM jsonb_to_recordset(p_splits) AS x(member_id UUID, person_id UUID, amount NUMERIC, percentage NUMERIC) LOOP
                INSERT INTO public.purchase_splits (workspace_id, purchase_id, member_id, person_id, amount, percentage)
                VALUES (p_workspace_id, p_purchase_id, v_split.member_id, v_split.person_id, v_split.amount, v_split.percentage);
            END LOOP;
        ELSE
            DELETE FROM public.purchase_splits WHERE purchase_id = p_purchase_id;
        END IF;
    END IF;

    -- 2. Se o valor mudou, valida e reconcilia parcelas
    IF v_new_amount <> v_old_purchase.total_amount THEN
        FOR v_inst IN
            SELECT id, installment_number, amount, paid_amount, status
            FROM public.installments
            WHERE purchase_id = p_purchase_id
            ORDER BY installment_number ASC
        LOOP
            v_total_paid_all := v_total_paid_all + COALESCE(v_inst.paid_amount, 0);
            IF v_inst.status = 'paid' THEN
                v_paid_count := v_paid_count + 1;
                v_fully_paid_amount := v_fully_paid_amount + v_inst.amount;
            ELSE
                v_unpaid_count := v_unpaid_count + 1;
            END IF;
        END LOOP;

        IF v_new_amount < v_total_paid_all THEN
            RAISE EXCEPTION 'O novo valor da compra (R$ %) não pode ser menor do que o total já pago em parcelas (R$ %).', v_new_amount, v_total_paid_all;
        END IF;

        IF v_unpaid_count = 0 THEN
            RAISE EXCEPTION 'Não é possível alterar o valor de uma compra cujas parcelas já foram todas quitadas.';
        END IF;

        v_remaining_amount := v_new_amount - v_fully_paid_amount;
        IF v_remaining_amount < (v_unpaid_count * 0.01) THEN
            RAISE EXCEPTION 'O valor restante (R$ %) é insuficiente para cobrir as % parcelas restantes com pelo menos R$ 0,01 cada.', v_remaining_amount, v_unpaid_count;
        END IF;

        v_base_inst := TRUNC(v_remaining_amount / v_unpaid_count, 2);
        v_rem_inst := v_remaining_amount - (v_base_inst * v_unpaid_count);
        v_first_inst := v_base_inst + v_rem_inst;

        FOR v_inst IN
            SELECT id, installment_number, amount, paid_amount, credit_card_bill_id
            FROM public.installments
            WHERE purchase_id = p_purchase_id AND status <> 'paid'
            ORDER BY installment_number ASC
        LOOP
            v_inst_idx := v_inst_idx + 1;
            IF v_inst_idx = 1 THEN
                v_inst_amt := v_first_inst;
            ELSE
                v_inst_amt := v_base_inst;
            END IF;

            IF v_inst_amt < COALESCE(v_inst.paid_amount, 0) THEN
                RAISE EXCEPTION 'A parcela % não pode ter valor (R$ %) menor do que o montante já pago parcialmente (R$ %).', v_inst.installment_number, v_inst_amt, v_inst.paid_amount;
            END IF;

            v_diff := v_inst_amt - v_inst.amount;

            IF v_inst.credit_card_bill_id IS NOT NULL AND v_diff <> 0 THEN
                SELECT * INTO v_bill
                FROM public.credit_card_bills
                WHERE id = v_inst.credit_card_bill_id AND workspace_id = p_workspace_id
                FOR UPDATE;

                IF (v_bill.total_amount + v_diff) < v_bill.paid_amount THEN
                    RAISE EXCEPTION 'A redução do valor da compra deixaria a fatura % com total menor que o valor já pago (R$ %).', v_bill.reference_month, v_bill.paid_amount;
                END IF;

                v_bill_fully_paid := (v_bill.paid_amount = (v_bill.total_amount + v_diff));

                UPDATE public.credit_card_bills
                SET total_amount = total_amount + v_diff,
                    status = CASE
                        WHEN (total_amount + v_diff) <= paid_amount THEN 'paid'
                        WHEN paid_amount > 0 THEN 'partially_paid'
                        ELSE status
                    END,
                    paid_at = CASE
                        WHEN (total_amount + v_diff) <= paid_amount THEN COALESCE(paid_at, CURRENT_TIMESTAMP)
                        ELSE paid_at
                    END
                WHERE id = v_inst.credit_card_bill_id;

                IF v_bill_fully_paid THEN
                    UPDATE public.installments
                    SET paid_amount = amount,
                        status = 'paid',
                        paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP)
                    WHERE credit_card_bill_id = v_inst.credit_card_bill_id
                      AND id <> v_inst.id
                      AND status <> 'paid';

                    UPDATE public.transactions
                    SET status = 'paid',
                        paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP)
                    WHERE credit_card_bill_id = v_inst.credit_card_bill_id
                      AND status <> 'paid';
                END IF;
            END IF;

            UPDATE public.installments
            SET amount = v_inst_amt,
                status = CASE
                    WHEN v_inst_amt = COALESCE(paid_amount, 0) AND v_inst_amt > 0 THEN 'paid'
                    WHEN COALESCE(paid_amount, 0) > 0 THEN 'partially_paid'
                    ELSE status
                END,
                paid_at = CASE
                    WHEN v_inst_amt = COALESCE(paid_amount, 0) AND v_inst_amt > 0 THEN COALESCE(paid_at, CURRENT_TIMESTAMP)
                    ELSE paid_at
                END
            WHERE id = v_inst.id;
        END LOOP;
    END IF;

    -- 3. Atualiza os dados da compra
    UPDATE public.purchases
    SET description = COALESCE(TRIM(p_description), description),
        total_amount = v_new_amount,
        purchase_date = COALESCE(p_purchase_date, purchase_date),
        category_id = p_category_id,
        account_id = p_account_id,
        payment_method_id = p_payment_method_id,
        credit_card_id = p_credit_card_id,
        paid_by_member_id = p_paid_by_member_id,
        paid_by_person_id = p_paid_by_person_id,
        split_type = COALESCE(p_split_type, split_type)
    WHERE id = p_purchase_id AND workspace_id = p_workspace_id;

    RETURN p_purchase_id;
END;
$$;

-- 7.6 fn_record_settlement
DROP FUNCTION IF EXISTS public.fn_record_settlement(UUID, UUID, UUID, NUMERIC, DATE, TEXT, UUID);
DROP FUNCTION IF EXISTS public.fn_record_settlement(UUID, UUID, UUID, NUMERIC, DATE, TEXT, UUID, UUID, UUID);

CREATE OR REPLACE FUNCTION public.fn_record_settlement(
    p_workspace_id UUID,
    p_from_member_id UUID DEFAULT NULL,
    p_to_member_id UUID DEFAULT NULL,
    p_amount NUMERIC(12, 2) DEFAULT NULL,
    p_settlement_date DATE DEFAULT CURRENT_DATE,
    p_notes TEXT DEFAULT NULL,
    p_payment_account_id UUID DEFAULT NULL,
    p_from_person_id UUID DEFAULT NULL,
    p_to_person_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_settlement_id UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.';
    END IF;

    IF NOT public.has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: você não possui permissão de escrita neste workspace.';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'O valor do acerto de contas deve ser estritamente maior que zero.';
    END IF;

    -- Validação do devedor (from)
    IF (p_from_member_id IS NULL AND p_from_person_id IS NULL) OR (p_from_member_id IS NOT NULL AND p_from_person_id IS NOT NULL) THEN
        RAISE EXCEPTION 'O acerto deve indicar exatamente um devedor (from_member_id ou from_person_id).';
    END IF;

    -- Validação do credor (to)
    IF (p_to_member_id IS NULL AND p_to_person_id IS NULL) OR (p_to_member_id IS NOT NULL AND p_to_person_id IS NOT NULL) THEN
        RAISE EXCEPTION 'O acerto deve indicar exatamente um credor (to_member_id ou to_person_id).';
    END IF;

    -- Devedor e credor não podem ser a mesma entidade
    IF p_from_member_id IS NOT NULL AND p_to_member_id IS NOT NULL AND p_from_member_id = p_to_member_id THEN
        RAISE EXCEPTION 'Os membros pagador e recebedor do acerto devem ser distintos.';
    END IF;

    IF p_from_person_id IS NOT NULL AND p_to_person_id IS NOT NULL AND p_from_person_id = p_to_person_id THEN
        RAISE EXCEPTION 'As pessoas pagadora e recebedora do acerto devem ser distintas.';
    END IF;

    -- Pertencimento ao workspace
    IF p_from_member_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.workspace_members
        WHERE id = p_from_member_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Membro pagador (from_member_id) não pertence ao workspace informado.';
    END IF;

    IF p_to_member_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.workspace_members
        WHERE id = p_to_member_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Membro recebedor (to_member_id) não pertence ao workspace informado.';
    END IF;

    IF p_from_person_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.people
        WHERE id = p_from_person_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Pessoa devedora (from_person_id) não pertence ao workspace informado.';
    END IF;

    IF p_to_person_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.people
        WHERE id = p_to_person_id AND workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'Pessoa credora (to_person_id) não pertence ao workspace informado.';
    END IF;

    IF p_payment_account_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.accounts
            WHERE id = p_payment_account_id AND workspace_id = p_workspace_id
        ) THEN
            RAISE EXCEPTION 'Conta bancária informada não pertence ao workspace.';
        END IF;
    END IF;

    INSERT INTO public.settlements (
        workspace_id,
        from_member_id,
        to_member_id,
        from_person_id,
        to_person_id,
        amount,
        settlement_date,
        notes,
        payment_account_id,
        created_by
    ) VALUES (
        p_workspace_id,
        p_from_member_id,
        p_to_member_id,
        p_from_person_id,
        p_to_person_id,
        p_amount,
        COALESCE(p_settlement_date, CURRENT_DATE),
        p_notes,
        p_payment_account_id,
        v_user_id
    ) RETURNING id INTO v_settlement_id;

    RETURN v_settlement_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- 8. ENDURECIMENTO DE PERMISSÕES E REGISTRO NO CATÁLOGO FAIL-CLOSED
-- ------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.fn_set_transaction_splits(UUID, UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_set_transaction_splits(UUID, UUID, JSONB) TO authenticated;

REVOKE ALL ON FUNCTION public.fn_set_purchase_splits(UUID, UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_set_purchase_splits(UUID, UUID, JSONB) TO authenticated;

REVOKE ALL ON FUNCTION public.fn_create_transaction_with_splits(UUID, TEXT, NUMERIC, DATE, TEXT, TEXT, UUID, UUID, UUID, UUID, UUID, TEXT, UUID, TEXT, DATE, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_create_transaction_with_splits(UUID, TEXT, NUMERIC, DATE, TEXT, TEXT, UUID, UUID, UUID, UUID, UUID, TEXT, UUID, TEXT, DATE, JSONB, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.fn_update_transaction_with_splits(UUID, UUID, TEXT, NUMERIC, DATE, TEXT, UUID, UUID, UUID, UUID, UUID, TEXT, UUID, TEXT, DATE, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_update_transaction_with_splits(UUID, UUID, TEXT, NUMERIC, DATE, TEXT, UUID, UUID, UUID, UUID, UUID, TEXT, UUID, TEXT, DATE, JSONB, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.fn_create_installment_purchase(UUID, TEXT, NUMERIC, INT, DATE, UUID, UUID, UUID, UUID, INT, UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_create_installment_purchase(UUID, TEXT, NUMERIC, INT, DATE, UUID, UUID, UUID, UUID, INT, UUID, TEXT, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.fn_create_purchase_with_splits(UUID, TEXT, NUMERIC, INT, DATE, UUID, UUID, UUID, UUID, INT, UUID, TEXT, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_create_purchase_with_splits(UUID, TEXT, NUMERIC, INT, DATE, UUID, UUID, UUID, UUID, INT, UUID, TEXT, JSONB, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.fn_update_purchase_with_splits(UUID, UUID, TEXT, NUMERIC, DATE, UUID, UUID, UUID, UUID, UUID, TEXT, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_update_purchase_with_splits(UUID, UUID, TEXT, NUMERIC, DATE, UUID, UUID, UUID, UUID, UUID, TEXT, JSONB, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.fn_record_settlement(UUID, UUID, UUID, NUMERIC, DATE, TEXT, UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_record_settlement(UUID, UUID, UUID, NUMERIC, DATE, TEXT, UUID, UUID, UUID) TO authenticated;

-- Registra a nova tabela e novas funções canônicas em _db_managed_objects
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
  AND c.relname = 'people'
ON CONFLICT (object_identity) DO NOTHING;

INSERT INTO public._db_managed_objects (object_identity, object_type)
SELECT (pg_identify_object(1255, p.oid, 0)).identity, 'function'
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'fn_set_transaction_splits',
    'fn_set_purchase_splits',
    'fn_create_transaction_with_splits',
    'fn_update_transaction_with_splits',
    'fn_create_installment_purchase',
    'fn_create_purchase_with_splits',
    'fn_update_purchase_with_splits',
    'fn_record_settlement',
    'fn_check_transaction_paid_by_workspace_integrity',
    'fn_check_purchase_paid_by_workspace_integrity',
    'fn_check_transaction_split_workspace_integrity',
    'fn_check_purchase_split_workspace_integrity',
    'fn_check_settlement_workspace_integrity'
  )
ON CONFLICT (object_identity) DO NOTHING;
