-- ==============================================================================
-- MIGRATION 006: ALINHAMENTO DO SCHEMA V38 (DOMÍNIO COMPLETO V37 NO POSTGRES)
-- ==============================================================================
-- Adiciona suporte nativo a:
-- 1. Modos de rastreamento do workspace (full vs expense_tracker)
-- 2. Flexibilização de pagamentos (account_id opcional + affects_balance)
--    - Inclui redefinição de fn_check_payment_workspace_integrity (P1-01)
-- 3. Rateios e divisões de despesas (paid_by_member_id, split_type)
-- 4. Tabelas relacionais normalizadas: transaction_splits, purchase_splits, settlements
-- 5. Triggers de integridade por workspace (child-side e parent-side imutabilidade P1-02)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. WORKSPACES: Modo de Rastreamento (tracking_mode)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'workspaces' AND column_name = 'tracking_mode'
    ) THEN
        ALTER TABLE public.workspaces 
            ADD COLUMN tracking_mode TEXT NOT NULL DEFAULT 'full' 
            CHECK (tracking_mode IN ('full', 'expense_tracker'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_workspaces_tracking_mode ON public.workspaces(tracking_mode);

-- ------------------------------------------------------------------------------
-- 2. PAYMENTS: Flexibilização para modo expense_tracker (account_id nullable + affects_balance)
-- ------------------------------------------------------------------------------
-- Permite pagamentos registrados como marcação de despesa sem movimentação de saldo bancário
ALTER TABLE public.payments ALTER COLUMN account_id DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'affects_balance'
    ) THEN
        ALTER TABLE public.payments 
            ADD COLUMN affects_balance BOOLEAN NOT NULL DEFAULT true;
    END IF;
END $$;

-- Garante que se affects_balance for true, a conta bancária deve estar preenchida
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'payments_account_balance_chk'
    ) THEN
        ALTER TABLE public.payments
            ADD CONSTRAINT payments_account_balance_chk
            CHECK (account_id IS NOT NULL OR affects_balance = false);
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 2.1 CORREÇÃO DO TRIGGER LEGADO DE PAGAMENTOS (RESOLUÇÃO P1-01)
-- ------------------------------------------------------------------------------
-- A migration 002 exigia account_id obrigatório em fn_check_payment_workspace_integrity.
-- Com a flexibilização para o modo expense_tracker (account_id IS NULL), a validação
-- de conta só deve ocorrer se a conta for informada.
CREATE OR REPLACE FUNCTION public.fn_check_payment_workspace_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Valida Conta (apenas se informada)
    IF NEW.account_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.accounts 
            WHERE id = NEW.account_id AND workspace_id = NEW.workspace_id
        ) THEN
            RAISE EXCEPTION 'A conta bancária do pagamento não pertence ao workspace informado.';
        END IF;
    END IF;

    -- Valida Transação vinculada
    IF NEW.transaction_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.transactions 
            WHERE id = NEW.transaction_id AND workspace_id = NEW.workspace_id
        ) THEN
            RAISE EXCEPTION 'A transação do pagamento não pertence ao mesmo workspace.';
        END IF;
    END IF;

    -- Valida Fatura vinculada
    IF NEW.credit_card_bill_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.credit_card_bills 
            WHERE id = NEW.credit_card_bill_id AND workspace_id = NEW.workspace_id
        ) THEN
            RAISE EXCEPTION 'A fatura do pagamento não pertence ao mesmo workspace.';
        END IF;
    END IF;

    -- Valida Parcela vinculada (via purchases)
    IF NEW.installment_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.installments i
            JOIN public.purchases pur ON pur.id = i.purchase_id
            WHERE i.id = NEW.installment_id AND pur.workspace_id = NEW.workspace_id
        ) THEN
            RAISE EXCEPTION 'A parcela do pagamento não pertence ao mesmo workspace.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. TRANSACTIONS: Pagador e Tipo de Rateio
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'paid_by_member_id'
    ) THEN
        ALTER TABLE public.transactions 
            ADD COLUMN paid_by_member_id UUID REFERENCES public.workspace_members(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'split_type'
    ) THEN
        ALTER TABLE public.transactions 
            ADD COLUMN split_type TEXT NOT NULL DEFAULT 'individual' 
            CHECK (split_type IN ('individual', 'equal', 'full_other', 'custom'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transactions_paid_by_member ON public.transactions(paid_by_member_id);
CREATE INDEX IF NOT EXISTS idx_transactions_split_type ON public.transactions(split_type);

-- ------------------------------------------------------------------------------
-- 4. PURCHASES: Pagador e Tipo de Rateio em Compras Parceladas
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'purchases' AND column_name = 'paid_by_member_id'
    ) THEN
        ALTER TABLE public.purchases 
            ADD COLUMN paid_by_member_id UUID REFERENCES public.workspace_members(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'purchases' AND column_name = 'split_type'
    ) THEN
        ALTER TABLE public.purchases 
            ADD COLUMN split_type TEXT NOT NULL DEFAULT 'individual' 
            CHECK (split_type IN ('individual', 'equal', 'full_other', 'custom'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_purchases_paid_by_member ON public.purchases(paid_by_member_id);
CREATE INDEX IF NOT EXISTS idx_purchases_split_type ON public.purchases(split_type);

-- ------------------------------------------------------------------------------
-- 5. TABELA NORMALIZADA: TRANSACTION_SPLITS (Frações de Rateio por Transação)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transaction_splits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    transaction_id UUID NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES public.workspace_members(id) ON DELETE CASCADE,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
    percentage NUMERIC(5, 2) CHECK (percentage IS NULL OR (percentage >= 0 AND percentage <= 100)),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT transaction_splits_tx_member_uniq UNIQUE (transaction_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_transaction_splits_workspace ON public.transaction_splits(workspace_id);
CREATE INDEX IF NOT EXISTS idx_transaction_splits_tx ON public.transaction_splits(transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_splits_member ON public.transaction_splits(member_id);

ALTER TABLE public.transaction_splits ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 6. TABELA NORMALIZADA: PURCHASE_SPLITS (Frações de Rateio por Compra Parcelada)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchase_splits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    purchase_id UUID NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES public.workspace_members(id) ON DELETE CASCADE,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
    percentage NUMERIC(5, 2) CHECK (percentage IS NULL OR (percentage >= 0 AND percentage <= 100)),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT purchase_splits_purchase_member_uniq UNIQUE (purchase_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_purchase_splits_workspace ON public.purchase_splits(workspace_id);
CREATE INDEX IF NOT EXISTS idx_purchase_splits_purchase ON public.purchase_splits(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_splits_member ON public.purchase_splits(member_id);

ALTER TABLE public.purchase_splits ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 7. TABELA NORMALIZADA: SETTLEMENTS (Acertos de Contas Entre Membros)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    from_member_id UUID NOT NULL REFERENCES public.workspace_members(id) ON DELETE RESTRICT,
    to_member_id UUID NOT NULL REFERENCES public.workspace_members(id) ON DELETE RESTRICT,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    settlement_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    payment_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT settlements_distinct_members_chk CHECK (from_member_id <> to_member_id)
);

CREATE INDEX IF NOT EXISTS idx_settlements_workspace ON public.settlements(workspace_id);
CREATE INDEX IF NOT EXISTS idx_settlements_from_member ON public.settlements(from_member_id);
CREATE INDEX IF NOT EXISTS idx_settlements_to_member ON public.settlements(to_member_id);
CREATE INDEX IF NOT EXISTS idx_settlements_date ON public.settlements(settlement_date);

ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 8. TRIGGERS DE INTEGRIDADE REFERENCIAL DE WORKSPACE (CHILD-SIDE)
-- ------------------------------------------------------------------------------

-- Integridade de paid_by_member_id em transactions
CREATE OR REPLACE FUNCTION public.fn_check_transaction_paid_by_member_workspace_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
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
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_transaction_paid_by_member ON public.transactions;
CREATE TRIGGER trg_check_transaction_paid_by_member
    BEFORE INSERT OR UPDATE OF paid_by_member_id, workspace_id ON public.transactions
    FOR EACH ROW EXECUTE FUNCTION public.fn_check_transaction_paid_by_member_workspace_integrity();

-- Integridade de paid_by_member_id em purchases
CREATE OR REPLACE FUNCTION public.fn_check_purchase_paid_by_member_workspace_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
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
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_purchase_paid_by_member ON public.purchases;
CREATE TRIGGER trg_check_purchase_paid_by_member
    BEFORE INSERT OR UPDATE OF paid_by_member_id, workspace_id ON public.purchases
    FOR EACH ROW EXECUTE FUNCTION public.fn_check_purchase_paid_by_member_workspace_integrity();

-- Integridade de transaction_splits
CREATE OR REPLACE FUNCTION public.fn_check_transaction_split_workspace_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_tx_workspace_id UUID;
    v_member_workspace_id UUID;
BEGIN
    SELECT workspace_id INTO v_tx_workspace_id FROM public.transactions WHERE id = NEW.transaction_id;
    IF v_tx_workspace_id IS NULL OR v_tx_workspace_id <> NEW.workspace_id THEN
        RAISE EXCEPTION 'A transação do rateio pertence a outro workspace ou não existe.';
    END IF;

    SELECT workspace_id INTO v_member_workspace_id FROM public.workspace_members WHERE id = NEW.member_id;
    IF v_member_workspace_id IS NULL OR v_member_workspace_id <> NEW.workspace_id THEN
        RAISE EXCEPTION 'O participante do rateio deve pertencer ao mesmo workspace da transação.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_transaction_split_workspace ON public.transaction_splits;
CREATE TRIGGER trg_check_transaction_split_workspace
    BEFORE INSERT OR UPDATE ON public.transaction_splits
    FOR EACH ROW EXECUTE FUNCTION public.fn_check_transaction_split_workspace_integrity();

-- Integridade de purchase_splits
CREATE OR REPLACE FUNCTION public.fn_check_purchase_split_workspace_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_purchase_workspace_id UUID;
    v_member_workspace_id UUID;
BEGIN
    SELECT workspace_id INTO v_purchase_workspace_id FROM public.purchases WHERE id = NEW.purchase_id;
    IF v_purchase_workspace_id IS NULL OR v_purchase_workspace_id <> NEW.workspace_id THEN
        RAISE EXCEPTION 'A compra parcelada do rateio pertence a outro workspace ou não existe.';
    END IF;

    SELECT workspace_id INTO v_member_workspace_id FROM public.workspace_members WHERE id = NEW.member_id;
    IF v_member_workspace_id IS NULL OR v_member_workspace_id <> NEW.workspace_id THEN
        RAISE EXCEPTION 'O participante do rateio deve pertencer ao mesmo workspace da compra parcelada.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_purchase_split_workspace ON public.purchase_splits;
CREATE TRIGGER trg_check_purchase_split_workspace
    BEFORE INSERT OR UPDATE ON public.purchase_splits
    FOR EACH ROW EXECUTE FUNCTION public.fn_check_purchase_split_workspace_integrity();

-- Integridade de settlements
CREATE OR REPLACE FUNCTION public.fn_check_settlement_workspace_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_from_ws UUID;
    v_to_ws UUID;
    v_acc_ws UUID;
BEGIN
    SELECT workspace_id INTO v_from_ws FROM public.workspace_members WHERE id = NEW.from_member_id;
    IF v_from_ws IS NULL OR v_from_ws <> NEW.workspace_id THEN
        RAISE EXCEPTION 'O membro devedor (from_member_id) não pertence ao workspace do acerto.';
    END IF;

    SELECT workspace_id INTO v_to_ws FROM public.workspace_members WHERE id = NEW.to_member_id;
    IF v_to_ws IS NULL OR v_to_ws <> NEW.workspace_id THEN
        RAISE EXCEPTION 'O membro credor (to_member_id) não pertence ao workspace do acerto.';
    END IF;

    IF NEW.payment_account_id IS NOT NULL THEN
        SELECT workspace_id INTO v_acc_ws FROM public.accounts WHERE id = NEW.payment_account_id;
        IF v_acc_ws IS NULL OR v_acc_ws <> NEW.workspace_id THEN
            RAISE EXCEPTION 'A conta bancária informada para quitação do acerto pertence a outro workspace.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_settlement_workspace ON public.settlements;
CREATE TRIGGER trg_check_settlement_workspace
    BEFORE INSERT OR UPDATE ON public.settlements
    FOR EACH ROW EXECUTE FUNCTION public.fn_check_settlement_workspace_integrity();

-- ------------------------------------------------------------------------------
-- 9. INTEGRIDADE PARENT-SIDE: IMUTABILIDADE DO WORKSPACE_ID (RESOLUÇÃO P1-02)
-- ------------------------------------------------------------------------------
-- Bloqueia a alteração de workspace_id em registros pais para impedir que alterações
-- posteriores invalidem splits, contas, faturas e participantes vinculados.
CREATE OR REPLACE FUNCTION public.fn_prevent_workspace_id_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.workspace_id <> OLD.workspace_id THEN
        RAISE EXCEPTION 'A alteração de workspace_id é estritamente proibida após a criação do registro (tabela: %).', TG_TABLE_NAME;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_ws_change_transactions ON public.transactions;
CREATE TRIGGER trg_prevent_ws_change_transactions
    BEFORE UPDATE OF workspace_id ON public.transactions
    FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_workspace_id_change();

DROP TRIGGER IF EXISTS trg_prevent_ws_change_purchases ON public.purchases;
CREATE TRIGGER trg_prevent_ws_change_purchases
    BEFORE UPDATE OF workspace_id ON public.purchases
    FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_workspace_id_change();

DROP TRIGGER IF EXISTS trg_prevent_ws_change_members ON public.workspace_members;
CREATE TRIGGER trg_prevent_ws_change_members
    BEFORE UPDATE OF workspace_id ON public.workspace_members
    FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_workspace_id_change();

DROP TRIGGER IF EXISTS trg_prevent_ws_change_accounts ON public.accounts;
CREATE TRIGGER trg_prevent_ws_change_accounts
    BEFORE UPDATE OF workspace_id ON public.accounts
    FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_workspace_id_change();

DROP TRIGGER IF EXISTS trg_prevent_ws_change_tx_splits ON public.transaction_splits;
CREATE TRIGGER trg_prevent_ws_change_tx_splits
    BEFORE UPDATE OF workspace_id ON public.transaction_splits
    FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_workspace_id_change();

DROP TRIGGER IF EXISTS trg_prevent_ws_change_purchase_splits ON public.purchase_splits;
CREATE TRIGGER trg_prevent_ws_change_purchase_splits
    BEFORE UPDATE OF workspace_id ON public.purchase_splits
    FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_workspace_id_change();

DROP TRIGGER IF EXISTS trg_prevent_ws_change_settlements ON public.settlements;
CREATE TRIGGER trg_prevent_ws_change_settlements
    BEFORE UPDATE OF workspace_id ON public.settlements
    FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_workspace_id_change();
