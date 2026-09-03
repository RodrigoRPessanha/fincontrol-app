-- ==============================================================================
-- SCHEMA DE BANCO DE DADOS: CONTROLE FINANCEIRO PESSOAL E COMPARTILHADO (SUPABASE)
-- VERSÃO ENDURECIDA PARA PRODUÇÃO V5 (COM TRIGGER TRANSACIONAL DE OWNERSHIP E CHECKS ESTRUTURAIS)
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==============================================================================
-- 1. PERFIS E WORKSPACES
-- ==============================================================================

CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    currency TEXT NOT NULL DEFAULT 'BRL',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspace_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, user_id)
);

-- Trigger de integridade que bloqueia alteração direta de owner_id fora de RPCs autorizadas via flag transacional
CREATE OR REPLACE FUNCTION trg_prevent_workspace_owner_change_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.owner_id <> OLD.owner_id AND current_setting('app.allow_owner_transfer', true) IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'A alteração direta de owner_id é proibida. Utilize a função fn_transfer_workspace_ownership.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_workspace_owner_change ON workspaces;
CREATE TRIGGER trg_prevent_workspace_owner_change
    BEFORE UPDATE OF owner_id ON workspaces
    FOR EACH ROW EXECUTE FUNCTION trg_prevent_workspace_owner_change_fn();

-- ==============================================================================
-- 2. CONTAS FINANCEIRAS E CARTÕES DE CRÉDITO
-- ==============================================================================

CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('checking', 'savings', 'cash', 'wallet', 'investment', 'other')),
    institution TEXT NOT NULL DEFAULT 'Geral',
    initial_balance NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    current_balance NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    color TEXT NOT NULL DEFAULT '#10b981',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credit_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    institution TEXT NOT NULL DEFAULT 'Banco',
    last_four_digits VARCHAR(4),
    credit_limit NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    closing_day INT NOT NULL CHECK (closing_day BETWEEN 1 AND 31),
    due_day INT NOT NULL CHECK (due_day BETWEEN 1 AND 31),
    linked_payment_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    color TEXT NOT NULL DEFAULT '#6366f1',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credit_card_bills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    credit_card_id UUID NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    reference_month VARCHAR(7) NOT NULL, -- Formato: 'YYYY-MM'
    closing_date DATE NOT NULL,
    due_date DATE NOT NULL,
    total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'partially_paid', 'paid', 'overdue', 'cancelled')),
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(credit_card_id, reference_month)
);

-- ==============================================================================
-- 3. MÉTODOS DE PAGAMENTO E CATEGORIAS
-- ==============================================================================

CREATE TABLE IF NOT EXISTS payment_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('cash', 'pix', 'debit_card', 'credit_card', 'bank_transfer', 'boleto', 'automatic_debit', 'other')),
    linked_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    credit_card_id UUID REFERENCES credit_cards(id) ON DELETE SET NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES categories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT 'tag',
    color TEXT NOT NULL DEFAULT '#64748b',
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- 4. TRANSAÇÕES, COMPRAS PARCELADAS E PAGAMENTOS
-- ==============================================================================

CREATE TABLE IF NOT EXISTS recurring_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    payment_method_id UUID REFERENCES payment_methods(id) ON DELETE SET NULL,
    credit_card_id UUID REFERENCES credit_cards(id) ON DELETE SET NULL,
    frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual', 'custom')),
    interval_days INT CHECK (interval_days IS NULL OR interval_days > 0),
    start_date DATE NOT NULL,
    end_date DATE,
    next_occurrence DATE NOT NULL,
    auto_create BOOLEAN NOT NULL DEFAULT TRUE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    suspended_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    payment_method_id UUID REFERENCES payment_methods(id) ON DELETE SET NULL,
    credit_card_id UUID REFERENCES credit_cards(id) ON DELETE SET NULL,
    credit_card_bill_id UUID REFERENCES credit_card_bills(id) ON DELETE SET NULL,
    recurring_transaction_id UUID REFERENCES recurring_transactions(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE NOT NULL DEFAULT CURRENT_DATE,
    paid_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partially_paid', 'paid', 'overdue', 'cancelled')),
    notes TEXT,
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    credit_card_id UUID REFERENCES credit_cards(id) ON DELETE SET NULL,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    payment_method_id UUID REFERENCES payment_methods(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount > 0),
    installment_count INT NOT NULL CHECK (installment_count BETWEEN 1 AND 120),
    purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS installments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    installment_number INT NOT NULL CHECK (installment_number >= 1),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    due_date DATE NOT NULL,
    credit_card_bill_id UUID REFERENCES credit_card_bills(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partially_paid', 'paid', 'overdue', 'cancelled')),
    paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(purchase_id, installment_number)
);

CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE,
    installment_id UUID REFERENCES installments(id) ON DELETE CASCADE,
    credit_card_bill_id UUID REFERENCES credit_card_bills(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    payment_method_id UUID REFERENCES payment_methods(id) ON DELETE SET NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT payments_single_target_chk CHECK (num_nonnulls(transaction_id, installment_id, credit_card_bill_id) = 1)
);

-- ==============================================================================
-- 5. TRANSFERÊNCIAS, ORÇAMENTOS E METAS
-- ==============================================================================

CREATE TABLE IF NOT EXISTS transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    from_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    to_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    transfer_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (from_account_id <> to_account_id)
);

CREATE TABLE IF NOT EXISTS budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
    year INT NOT NULL CHECK (year >= 2000),
    planned_amount NUMERIC(12, 2) NOT NULL CHECK (planned_amount >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, category_id, month, year)
);

CREATE TABLE IF NOT EXISTS financial_goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    target_amount NUMERIC(12, 2) NOT NULL CHECK (target_amount > 0),
    current_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    target_date DATE,
    status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'paused')),
    color TEXT NOT NULL DEFAULT '#10b981',
    icon TEXT NOT NULL DEFAULT 'target',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- 6. ÍNDICES PARA ALTA PERFORMANCE
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_transactions_ws_date ON transactions(workspace_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_transactions_due_status ON transactions(workspace_id, due_date, status);
CREATE INDEX IF NOT EXISTS idx_installments_purchase ON installments(purchase_id);
CREATE INDEX IF NOT EXISTS idx_installments_bill ON installments(credit_card_bill_id);
CREATE INDEX IF NOT EXISTS idx_credit_card_bills_card_month ON credit_card_bills(credit_card_id, reference_month);
CREATE INDEX IF NOT EXISTS idx_payments_transaction ON payments(transaction_id);
CREATE INDEX IF NOT EXISTS idx_payments_installment ON payments(installment_id);
CREATE INDEX IF NOT EXISTS idx_payments_bill ON payments(credit_card_bill_id);
CREATE INDEX IF NOT EXISTS idx_transfers_ws_date ON transfers(workspace_id, transfer_date);

-- ==============================================================================
-- 7. ROW LEVEL SECURITY (RLS) POLICIES ENDURECIDAS
-- ==============================================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_card_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_goals ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION is_member(p_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM workspace_members
        WHERE workspace_id = p_workspace_id
        AND user_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION has_workspace_role(p_workspace_id UUID, p_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM workspace_members
        WHERE workspace_id = p_workspace_id
        AND user_id = auth.uid()
        AND role = ANY(p_roles)
    );
$$;

CREATE POLICY profiles_select ON profiles FOR SELECT USING (
    id = auth.uid() OR EXISTS (
        SELECT 1 FROM workspace_members m1
        JOIN workspace_members m2 ON m1.workspace_id = m2.workspace_id
        WHERE m1.user_id = auth.uid() AND m2.user_id = profiles.id
    )
);
CREATE POLICY profiles_update ON profiles FOR UPDATE USING (id = auth.uid());

CREATE POLICY workspaces_select ON workspaces FOR SELECT USING (is_member(id));
CREATE POLICY workspaces_insert ON workspaces FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY workspaces_update ON workspaces FOR UPDATE USING (
    is_member(id) AND has_workspace_role(id, ARRAY['owner', 'admin'])
);
CREATE POLICY workspaces_delete ON workspaces FOR DELETE USING (owner_id = auth.uid());

CREATE POLICY members_select ON workspace_members FOR SELECT USING (is_member(workspace_id));
CREATE POLICY members_insert ON workspace_members FOR INSERT WITH CHECK (
    has_workspace_role(workspace_id, ARRAY['owner', 'admin']) AND
    role <> 'owner'
);
CREATE POLICY members_update ON workspace_members FOR UPDATE USING (
    has_workspace_role(workspace_id, ARRAY['owner', 'admin']) AND
    role <> 'owner' AND
    user_id <> (SELECT owner_id FROM workspaces WHERE id = workspace_id)
);
CREATE POLICY members_delete ON workspace_members FOR DELETE USING (
    has_workspace_role(workspace_id, ARRAY['owner', 'admin']) AND
    user_id <> (SELECT owner_id FROM workspaces WHERE id = workspace_id)
);

DO $$
DECLARE
    t TEXT;
    table_list TEXT[] := ARRAY[
        'accounts', 'credit_cards', 'credit_card_bills', 'payment_methods',
        'categories', 'transactions', 'purchases', 'payments', 'transfers',
        'recurring_transactions', 'budgets', 'financial_goals'
    ];
BEGIN
    FOREACH t IN ARRAY table_list LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I_select ON %I;', t, t);
        EXECUTE format('DROP POLICY IF EXISTS %I_insert ON %I;', t, t);
        EXECUTE format('DROP POLICY IF EXISTS %I_update ON %I;', t, t);
        EXECUTE format('DROP POLICY IF EXISTS %I_delete ON %I;', t, t);

        EXECUTE format('CREATE POLICY %I_select ON %I FOR SELECT USING (is_member(workspace_id));', t, t);
        EXECUTE format('CREATE POLICY %I_insert ON %I FOR INSERT WITH CHECK (has_workspace_role(workspace_id, ARRAY[''owner'', ''admin'', ''member'']));', t, t);
        EXECUTE format('CREATE POLICY %I_update ON %I FOR UPDATE USING (has_workspace_role(workspace_id, ARRAY[''owner'', ''admin'', ''member'']));', t, t);
        EXECUTE format('CREATE POLICY %I_delete ON %I FOR DELETE USING (has_workspace_role(workspace_id, ARRAY[''owner'', ''admin'']));', t, t);
    END LOOP;
END $$;

DROP POLICY IF EXISTS installments_select ON installments;
DROP POLICY IF EXISTS installments_all ON installments;
CREATE POLICY installments_select ON installments FOR SELECT USING (
    EXISTS (SELECT 1 FROM purchases p WHERE p.id = installments.purchase_id AND is_member(p.workspace_id))
);
CREATE POLICY installments_all ON installments FOR ALL USING (
    EXISTS (SELECT 1 FROM purchases p WHERE p.id = installments.purchase_id AND has_workspace_role(p.workspace_id, ARRAY['owner', 'admin', 'member']))
);

-- ==============================================================================
-- 8. FUNÇÕES ATÔMICAS (RPC) COM VALIDAÇÃO SEGURA DE OWNERSHIP E SEM DÉBITO DUPLO
-- ==============================================================================

-- 8.1. Bootstrap Atômico de Novo Workspace
CREATE OR REPLACE FUNCTION fn_create_workspace(
    p_name TEXT,
    p_currency TEXT DEFAULT 'BRL'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_ws_id UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Usuário não autenticado.';
    END IF;

    IF TRIM(p_name) = '' THEN
        RAISE EXCEPTION 'O nome do workspace não pode ser vazio.';
    END IF;

    INSERT INTO workspaces (name, owner_id, currency)
    VALUES (TRIM(p_name), v_user_id, p_currency)
    RETURNING id INTO v_ws_id;

    INSERT INTO workspace_members (workspace_id, user_id, role)
    VALUES (v_ws_id, v_user_id, 'owner');

    RETURN v_ws_id;
END;
$$;

-- 8.2. Transferência Segura de Ownership de Workspace
CREATE OR REPLACE FUNCTION fn_transfer_workspace_ownership(
    p_workspace_id UUID,
    p_new_owner_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_current_owner_id UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Usuário não autenticado.';
    END IF;

    IF p_new_owner_id = v_user_id THEN
        RAISE EXCEPTION 'O novo proprietário deve ser diferente do proprietário atual.';
    END IF;

    SELECT owner_id INTO v_current_owner_id
    FROM workspaces
    WHERE id = p_workspace_id
    FOR UPDATE;

    IF v_current_owner_id <> v_user_id THEN
        RAISE EXCEPTION 'Apenas o proprietário atual pode transferir a propriedade do workspace.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = p_workspace_id AND user_id = p_new_owner_id) THEN
        RAISE EXCEPTION 'O novo proprietário deve ser membro do workspace.';
    END IF;

    -- Permite atualização do owner_id nesta transação
    PERFORM set_config('app.allow_owner_transfer', 'true', true);

    UPDATE workspaces SET owner_id = p_new_owner_id WHERE id = p_workspace_id;
    UPDATE workspace_members SET role = 'owner' WHERE workspace_id = p_workspace_id AND user_id = p_new_owner_id;
    UPDATE workspace_members SET role = 'admin' WHERE workspace_id = p_workspace_id AND user_id = v_user_id;
END;
$$;

-- 8.3. Obter ou Criar Fatura de Cartão
CREATE OR REPLACE FUNCTION fn_get_or_create_credit_card_bill(
    p_card_id UUID,
    p_date DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ws_id UUID;
    v_closing_day INT;
    v_due_day INT;
    v_purchase_day INT;
    v_bill_year INT;
    v_bill_month INT;
    v_ref_month VARCHAR(7);
    v_first_of_month DATE;
    v_days_in_closing_month INT;
    v_closing_date DATE;
    v_due_year INT;
    v_due_month INT;
    v_days_in_due_month INT;
    v_due_date DATE;
    v_bill_id UUID;
BEGIN
    SELECT workspace_id, closing_day, due_day
    INTO v_ws_id, v_closing_day, v_due_day
    FROM credit_cards
    WHERE id = p_card_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cartão de crédito não encontrado.';
    END IF;

    IF NOT has_workspace_role(v_ws_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: apenas membros com permissão de escrita podem criar/obter faturas.';
    END IF;

    v_purchase_day := EXTRACT(DAY FROM p_date);
    v_bill_year := EXTRACT(YEAR FROM p_date);
    v_bill_month := EXTRACT(MONTH FROM p_date);

    IF v_purchase_day > v_closing_day THEN
        v_bill_month := v_bill_month + 1;
        IF v_bill_month > 12 THEN
            v_bill_month := 1;
            v_bill_year := v_bill_year + 1;
        END IF;
    END IF;

    v_ref_month := TO_CHAR(TO_DATE(v_bill_year || '-' || v_bill_month || '-01', 'YYYY-MM-DD'), 'YYYY-MM');

    v_first_of_month := make_date(v_bill_year, v_bill_month, 1);
    v_days_in_closing_month := EXTRACT(DAY FROM (v_first_of_month + INTERVAL '1 month - 1 day'))::INT;
    v_closing_date := make_date(v_bill_year, v_bill_month, LEAST(v_closing_day, v_days_in_closing_month));

    v_due_year := v_bill_year;
    v_due_month := v_bill_month;
    IF v_due_day < v_closing_day THEN
        v_due_month := v_due_month + 1;
        IF v_due_month > 12 THEN
            v_due_month := 1;
            v_due_year := v_due_year + 1;
        END IF;
    END IF;

    v_days_in_due_month := EXTRACT(DAY FROM (make_date(v_due_year, v_due_month, 1) + INTERVAL '1 month - 1 day'))::INT;
    v_due_date := make_date(v_due_year, v_due_month, LEAST(v_due_day, v_days_in_due_month));

    SELECT id INTO v_bill_id
    FROM credit_card_bills
    WHERE credit_card_id = p_card_id AND reference_month = v_ref_month;

    IF v_bill_id IS NULL THEN
        INSERT INTO credit_card_bills (
            credit_card_id, workspace_id, reference_month,
            closing_date, due_date, status, total_amount, paid_amount
        ) VALUES (
            p_card_id, v_ws_id, v_ref_month,
            v_closing_date, v_due_date, 'open', 0.00, 0.00
        )
        ON CONFLICT (credit_card_id, reference_month)
        DO UPDATE SET updated_at = NOW()
        RETURNING id INTO v_bill_id;
    END IF;

    RETURN v_bill_id;
END;
$$;

-- 8.4. Criação Atômica de Compra Parcelada com Limite de 120 Parcelas
CREATE OR REPLACE FUNCTION fn_create_installment_purchase(
    p_workspace_id UUID,
    p_description TEXT,
    p_total_amount NUMERIC,
    p_installment_count INT,
    p_purchase_date DATE,
    p_category_id UUID DEFAULT NULL,
    p_credit_card_id UUID DEFAULT NULL,
    p_account_id UUID DEFAULT NULL,
    p_payment_method_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_purchase_id UUID;
    v_base_installment_amount NUMERIC(12, 2);
    v_remainder NUMERIC(12, 2);
    v_first_installment_amount NUMERIC(12, 2);
    v_current_inst_amount NUMERIC(12, 2);
    v_inst_date DATE;
    v_bill_id UUID;
    v_bill_due_date DATE;
    i INT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Usuário não autenticado.';
    END IF;

    IF NOT has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: permissão insuficiente no workspace.';
    END IF;

    IF p_installment_count < 1 OR p_installment_count > 120 THEN
        RAISE EXCEPTION 'O número de parcelas deve estar entre 1 e 120.';
    END IF;

    IF p_total_amount <= 0 THEN
        RAISE EXCEPTION 'O valor total da compra deve ser maior que zero.';
    END IF;

    IF p_total_amount < p_installment_count * 0.01 THEN
        RAISE EXCEPTION 'O valor total é insuficiente para a quantidade de parcelas.';
    END IF;

    IF p_credit_card_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM credit_cards WHERE id = p_credit_card_id AND workspace_id = p_workspace_id) THEN
        RAISE EXCEPTION 'Cartão de crédito não pertence ao workspace informado.';
    END IF;

    IF p_account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = p_account_id AND workspace_id = p_workspace_id) THEN
        RAISE EXCEPTION 'Conta financeira não pertence ao workspace informado.';
    END IF;

    IF p_category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM categories WHERE id = p_category_id AND workspace_id = p_workspace_id) THEN
        RAISE EXCEPTION 'Categoria não pertence ao workspace informado.';
    END IF;

    IF p_payment_method_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM payment_methods WHERE id = p_payment_method_id AND workspace_id = p_workspace_id) THEN
        RAISE EXCEPTION 'Método de pagamento não pertence ao workspace informado.';
    END IF;

    INSERT INTO purchases (
        workspace_id, account_id, credit_card_id, category_id,
        payment_method_id, description, total_amount, installment_count,
        purchase_date, created_by
    ) VALUES (
        p_workspace_id, p_account_id, p_credit_card_id, p_category_id,
        p_payment_method_id, p_description, p_total_amount, p_installment_count,
        p_purchase_date, v_user_id
    ) RETURNING id INTO v_purchase_id;

    v_base_installment_amount := TRUNC(p_total_amount / p_installment_count, 2);
    v_remainder := p_total_amount - (v_base_installment_amount * p_installment_count);
    v_first_installment_amount := v_base_installment_amount + v_remainder;

    FOR i IN 1..p_installment_count LOOP
        v_inst_date := p_purchase_date + ((i - 1) * INTERVAL '1 month');
        
        IF i = 1 THEN
            v_current_inst_amount := v_first_installment_amount;
        ELSE
            v_current_inst_amount := v_base_installment_amount;
        END IF;

        v_bill_id := NULL;
        v_bill_due_date := v_inst_date;

        IF p_credit_card_id IS NOT NULL THEN
            v_bill_id := fn_get_or_create_credit_card_bill(p_credit_card_id, v_inst_date);
            
            SELECT due_date INTO v_bill_due_date FROM credit_card_bills WHERE id = v_bill_id;

            UPDATE credit_card_bills
            SET total_amount = total_amount + v_current_inst_amount,
                status = CASE WHEN status = 'paid' THEN 'partially_paid' ELSE status END,
                paid_at = CASE WHEN status = 'paid' THEN NULL ELSE paid_at END
            WHERE id = v_bill_id;
        END IF;

        INSERT INTO installments (
            purchase_id, installment_number, amount, due_date,
            credit_card_bill_id, status, paid_amount
        ) VALUES (
            v_purchase_id, i, v_current_inst_amount, v_bill_due_date,
            v_bill_id, 'pending', 0.00
        );
    END LOOP;

    RETURN v_purchase_id;
END;
$$;

-- 8.5. Registro Atômico de Pagamento com Bloqueio de Débito Duplo
CREATE OR REPLACE FUNCTION fn_record_payment(
    p_workspace_id UUID,
    p_account_id UUID,
    p_amount NUMERIC,
    p_payment_date DATE DEFAULT CURRENT_DATE,
    p_transaction_id UUID DEFAULT NULL,
    p_installment_id UUID DEFAULT NULL,
    p_credit_card_bill_id UUID DEFAULT NULL,
    p_payment_method_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_payment_id UUID;
    v_target_total NUMERIC(12, 2);
    v_already_paid NUMERIC(12, 2);
    v_remaining NUMERIC(12, 2);
    v_new_paid NUMERIC(12, 2);
    v_target_type TEXT;
    v_bill_id UUID;
    v_card_id UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Usuário não autenticado.';
    END IF;

    IF NOT has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: permissão insuficiente no workspace.';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'O valor do pagamento deve ser estritamente maior que zero.';
    END IF;

    IF (p_transaction_id IS NOT NULL)::INT + (p_installment_id IS NOT NULL)::INT + (p_credit_card_bill_id IS NOT NULL)::INT <> 1 THEN
        RAISE EXCEPTION 'Informe exatamente uma obrigação de destino para o pagamento.';
    END IF;

    IF p_payment_method_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM payment_methods WHERE id = p_payment_method_id AND workspace_id = p_workspace_id) THEN
        RAISE EXCEPTION 'Método de pagamento não pertence ao workspace informado.';
    END IF;

    PERFORM 1 FROM accounts WHERE id = p_account_id AND workspace_id = p_workspace_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Conta de saída não encontrada no workspace especificado.';
    END IF;

    -- 1. Transação avulsa
    IF p_transaction_id IS NOT NULL THEN
        SELECT amount, type, credit_card_bill_id, credit_card_id INTO v_target_total, v_target_type, v_bill_id, v_card_id
        FROM transactions
        WHERE id = p_transaction_id AND workspace_id = p_workspace_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Transação não encontrada no workspace.';
        END IF;

        IF v_bill_id IS NOT NULL OR v_card_id IS NOT NULL THEN
            RAISE EXCEPTION 'Itens vinculados a cartão de crédito devem ser quitados exclusivamente através da fatura correspondente.';
        END IF;

        SELECT COALESCE(SUM(amount), 0) INTO v_already_paid
        FROM payments WHERE transaction_id = p_transaction_id;

        v_remaining := v_target_total - v_already_paid;
        IF p_amount > v_remaining THEN
            RAISE EXCEPTION 'Valor do pagamento (R$ %) excede o saldo restante da transação (R$ %).', p_amount, v_remaining;
        END IF;

        v_new_paid := v_already_paid + p_amount;

        INSERT INTO payments (
            workspace_id, transaction_id, account_id, payment_method_id,
            amount, payment_date, notes, created_by
        ) VALUES (
            p_workspace_id, p_transaction_id, p_account_id, p_payment_method_id,
            p_amount, p_payment_date, p_notes, v_user_id
        ) RETURNING id INTO v_payment_id;

        UPDATE transactions
        SET status = CASE WHEN v_new_paid >= v_target_total THEN 'paid' ELSE 'partially_paid' END,
            paid_at = CASE WHEN v_new_paid >= v_target_total THEN p_payment_date::TIMESTAMPTZ ELSE NULL END
        WHERE id = p_transaction_id;

        IF v_target_type = 'expense' THEN
            UPDATE accounts SET current_balance = current_balance - p_amount WHERE id = p_account_id;
        ELSE
            UPDATE accounts SET current_balance = current_balance + p_amount WHERE id = p_account_id;
        END IF;

        RETURN v_payment_id;
    END IF;

    -- 2. Parcela individual
    IF p_installment_id IS NOT NULL THEN
        SELECT i.amount, i.paid_amount, i.credit_card_bill_id, p.credit_card_id
        INTO v_target_total, v_already_paid, v_bill_id, v_card_id
        FROM installments i
        JOIN purchases p ON p.id = i.purchase_id
        WHERE i.id = p_installment_id AND p.workspace_id = p_workspace_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Parcela não encontrada no workspace.';
        END IF;

        IF v_bill_id IS NOT NULL OR v_card_id IS NOT NULL THEN
            RAISE EXCEPTION 'Parcelas vinculadas a cartão de crédito devem ser quitadas exclusivamente através da fatura correspondente.';
        END IF;

        v_remaining := v_target_total - v_already_paid;
        IF p_amount > v_remaining THEN
            RAISE EXCEPTION 'Valor do pagamento (R$ %) excede o saldo restante da parcela (R$ %).', p_amount, v_remaining;
        END IF;

        v_new_paid := v_already_paid + p_amount;

        INSERT INTO payments (
            workspace_id, installment_id, account_id, payment_method_id,
            amount, payment_date, notes, created_by
        ) VALUES (
            p_workspace_id, p_installment_id, p_account_id, p_payment_method_id,
            p_amount, p_payment_date, p_notes, v_user_id
        ) RETURNING id INTO v_payment_id;

        UPDATE installments
        SET paid_amount = v_new_paid,
            status = CASE WHEN v_new_paid >= v_target_total THEN 'paid' ELSE 'partially_paid' END,
            paid_at = CASE WHEN v_new_paid >= v_target_total THEN p_payment_date::TIMESTAMPTZ ELSE NULL END
        WHERE id = p_installment_id;

        UPDATE accounts SET current_balance = current_balance - p_amount WHERE id = p_account_id;

        RETURN v_payment_id;
    END IF;

    -- 3. Fatura de cartão
    IF p_credit_card_bill_id IS NOT NULL THEN
        SELECT total_amount, paid_amount INTO v_target_total, v_already_paid
        FROM credit_card_bills
        WHERE id = p_credit_card_bill_id AND workspace_id = p_workspace_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Fatura não encontrada no workspace.';
        END IF;

        v_remaining := v_target_total - v_already_paid;
        IF p_amount > v_remaining THEN
            RAISE EXCEPTION 'Valor do pagamento (R$ %) excede o saldo restante da fatura (R$ %).', p_amount, v_remaining;
        END IF;

        v_new_paid := v_already_paid + p_amount;

        INSERT INTO payments (
            workspace_id, credit_card_bill_id, account_id, payment_method_id,
            amount, payment_date, notes, created_by
        ) VALUES (
            p_workspace_id, p_credit_card_bill_id, p_account_id, p_payment_method_id,
            p_amount, p_payment_date, p_notes, v_user_id
        ) RETURNING id INTO v_payment_id;

        UPDATE credit_card_bills
        SET paid_amount = v_new_paid,
            status = CASE WHEN v_new_paid >= v_target_total THEN 'paid' ELSE 'partially_paid' END,
            paid_at = CASE WHEN v_new_paid >= v_target_total THEN p_payment_date::TIMESTAMPTZ ELSE NULL END
        WHERE id = p_credit_card_bill_id;

        IF v_new_paid >= v_target_total THEN
            UPDATE installments
            SET status = 'paid', paid_amount = amount, paid_at = p_payment_date::TIMESTAMPTZ
            WHERE credit_card_bill_id = p_credit_card_bill_id;

            UPDATE transactions
            SET status = 'paid', paid_at = p_payment_date::TIMESTAMPTZ
            WHERE credit_card_bill_id = p_credit_card_bill_id;
        END IF;

        UPDATE accounts SET current_balance = current_balance - p_amount WHERE id = p_account_id;

        RETURN v_payment_id;
    END IF;

    RAISE EXCEPTION 'Erro inesperado na validação do pagamento.';
END;
$$;

-- 8.6. Transferência Neutra com Locks Ordenados Determinísticos
CREATE OR REPLACE FUNCTION fn_create_transfer(
    p_workspace_id UUID,
    p_from_account_id UUID,
    p_to_account_id UUID,
    p_amount NUMERIC,
    p_transfer_date DATE DEFAULT CURRENT_DATE,
    p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_transfer_id UUID;
    v_first_acc UUID;
    v_second_acc UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Usuário não autenticado.';
    END IF;

    IF NOT has_workspace_role(p_workspace_id, ARRAY['owner', 'admin', 'member']) THEN
        RAISE EXCEPTION 'Acesso negado: permissão insuficiente no workspace.';
    END IF;

    IF p_from_account_id = p_to_account_id THEN
        RAISE EXCEPTION 'A conta de origem e destino devem ser diferentes.';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'O valor da transferência deve ser maior que zero.';
    END IF;

    IF p_from_account_id < p_to_account_id THEN
        v_first_acc := p_from_account_id;
        v_second_acc := p_to_account_id;
    ELSE
        v_first_acc := p_to_account_id;
        v_second_acc := p_from_account_id;
    END IF;

    PERFORM 1 FROM accounts WHERE id = v_first_acc AND workspace_id = p_workspace_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Conta % não pertence ao workspace informado.', v_first_acc;
    END IF;

    PERFORM 1 FROM accounts WHERE id = v_second_acc AND workspace_id = p_workspace_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Conta % não pertence ao workspace informado.', v_second_acc;
    END IF;

    INSERT INTO transfers (
        workspace_id, from_account_id, to_account_id, amount,
        transfer_date, notes, created_by
    ) VALUES (
        p_workspace_id, p_from_account_id, p_to_account_id, p_amount,
        p_transfer_date, p_notes, v_user_id
    ) RETURNING id INTO v_transfer_id;

    UPDATE accounts SET current_balance = current_balance - p_amount WHERE id = p_from_account_id;
    UPDATE accounts SET current_balance = current_balance + p_amount WHERE id = p_to_account_id;

    RETURN v_transfer_id;
END;
$$;

-- ==============================================================================
-- 9. TRIGGER DE AUTO-CRIAÇÃO DE PERFIL E WORKSPACE NO SIGNUP
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ws_id UUID;
BEGIN
    INSERT INTO public.profiles (id, name, email, avatar_url)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
        NEW.email,
        NEW.raw_user_meta_data->>'avatar_url'
    );

    INSERT INTO public.workspaces (name, owner_id)
    VALUES ('Minhas Finanças', NEW.id)
    RETURNING id INTO v_ws_id;

    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (v_ws_id, NEW.id, 'owner');

    INSERT INTO public.categories (workspace_id, name, icon, color, type) VALUES
    (v_ws_id, 'Alimentação', 'utensils', '#f59e0b', 'expense'),
    (v_ws_id, 'Moradia', 'home', '#3b82f6', 'expense'),
    (v_ws_id, 'Transporte', 'car', '#ef4444', 'expense'),
    (v_ws_id, 'Saúde', 'heart-pulse', '#ec4899', 'expense'),
    (v_ws_id, 'Educação', 'graduation-cap', '#8b5cf6', 'expense'),
    (v_ws_id, 'Lazer & Cultura', 'gamepad-2', '#06b6d4', 'expense'),
    (v_ws_id, 'Salário & Renda', 'wallet', '#10b981', 'income'),
    (v_ws_id, 'Investimentos & Dividendos', 'trending-up', '#14b8a6', 'income'),
    (v_ws_id, 'Outras Receitas', 'plus-circle', '#84cc16', 'income');

    INSERT INTO public.accounts (workspace_id, name, type, institution, initial_balance, current_balance, color)
    VALUES (v_ws_id, 'Conta Corrente Principal', 'checking', 'Banco Digital', 0.00, 0.00, '#10b981');

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
