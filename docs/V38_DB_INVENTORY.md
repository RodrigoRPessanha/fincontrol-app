# FinControl V38 - Inventário Detalhado do Banco de Dados PostgreSQL

**Data da Catalogação**: 20/09/2026  
**Migrations Cobertas**: `001_initial_schema.sql` até `006_v38_schema_alignment.sql`  
**Escopo**: Schema `public`

---

## 1. Tabelas de Domínio (19 Tabelas)

### 1.1. Perfis e Gestão de Workspaces
- **`profiles`**:
  - `id` (UUID PK REFERENCES `auth.users(id)` ON DELETE CASCADE)
  - `name` (TEXT NOT NULL)
  - `email` (TEXT NOT NULL)
  - `avatar_url` (TEXT)
  - `created_at`, `updated_at` (TIMESTAMPTZ NOT NULL DEFAULT NOW())
  - RLS: Habilitado.

- **`workspaces`**:
  - `id` (UUID PK DEFAULT `gen_random_uuid()`)
  - `name` (TEXT NOT NULL)
  - `owner_id` (UUID NOT NULL REFERENCES `profiles(id)` ON DELETE CASCADE)
  - `currency` (TEXT NOT NULL DEFAULT 'BRL')
  - `tracking_mode` (TEXT NOT NULL DEFAULT 'full' CHECK in ('full', 'expense_tracker')) [V38]
  - `created_at`, `updated_at` (TIMESTAMPTZ NOT NULL DEFAULT NOW())
  - Triggers: `trg_prevent_workspace_owner_change` (bloqueia alteração direta de `owner_id`).
  - RLS: Habilitado.

- **`workspace_members`**:
  - `id` (UUID PK DEFAULT `gen_random_uuid()`)
  - `workspace_id` (UUID NOT NULL REFERENCES `workspaces(id)` ON DELETE CASCADE)
  - `user_id` (UUID NOT NULL REFERENCES `profiles(id)` ON DELETE CASCADE)
  - `role` (TEXT NOT NULL CHECK in ('owner', 'admin', 'member', 'viewer'))
  - `created_at` (TIMESTAMPTZ NOT NULL DEFAULT NOW())
  - Constraints: `UNIQUE(workspace_id, user_id)`.
  - Triggers: `trg_prevent_ws_change_members` (imutabilidade de `workspace_id` [P1-02]).
  - RLS: Habilitado.

### 1.2. Contas Financeiras e Meios de Pagamento
- **`accounts`**:
  - `id` (UUID PK DEFAULT `gen_random_uuid()`)
  - `workspace_id` (UUID NOT NULL REFERENCES `workspaces(id)` ON DELETE CASCADE)
  - `name` (TEXT NOT NULL)
  - `type` (TEXT NOT NULL CHECK in ('checking', 'savings', 'cash', 'wallet', 'investment', 'other'))
  - `institution` (TEXT NOT NULL DEFAULT '')
  - `initial_balance` (NUMERIC(12,2) NOT NULL DEFAULT 0.00)
  - `current_balance` (NUMERIC(12,2) NOT NULL DEFAULT 0.00)
  - `color` (TEXT NOT NULL DEFAULT '#10b981')
  - `active` (BOOLEAN NOT NULL DEFAULT true)
  - `created_at`, `updated_at` (TIMESTAMPTZ NOT NULL DEFAULT NOW())
  - Triggers: `trg_prevent_ws_change_accounts` (imutabilidade de `workspace_id` [P1-02]).
  - RLS: Habilitado.

- **`credit_cards`**:
  - `id` (UUID PK DEFAULT `gen_random_uuid()`)
  - `workspace_id` (UUID NOT NULL REFERENCES `workspaces(id)` ON DELETE CASCADE)
  - `name` (TEXT NOT NULL)
  - `institution` (TEXT NOT NULL DEFAULT '')
  - `credit_limit` (NUMERIC(12,2) NOT NULL CHECK (credit_limit >= 0))
  - `closing_day` (INT NOT NULL CHECK (closing_day BETWEEN 1 AND 31))
  - `due_day` (INT NOT NULL CHECK (due_day BETWEEN 1 AND 31))
  - `color` (TEXT NOT NULL DEFAULT '#3b82f6')
  - `active` (BOOLEAN NOT NULL DEFAULT true)
  - `linked_payment_account_id` (UUID REFERENCES `accounts(id)` ON DELETE SET NULL)
  - Triggers: `trg_check_credit_card_workspace` (valida se conta vinculada pertence ao mesmo workspace).
  - RLS: Habilitado.

- **`credit_card_bills`**:
  - `id` (UUID PK DEFAULT `gen_random_uuid()`)
  - `workspace_id` (UUID NOT NULL REFERENCES `workspaces(id)` ON DELETE CASCADE)
  - `credit_card_id` (UUID NOT NULL REFERENCES `credit_cards(id)` ON DELETE CASCADE)
  - `reference_month` (TEXT NOT NULL CHECK (reference_month ~ '^\d{4}-\d{2}$'))
  - `closing_date`, `due_date` (DATE NOT NULL)
  - `amount` (NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (amount >= 0))
  - `paid_amount` (NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (paid_amount >= 0))
  - `status` (TEXT NOT NULL DEFAULT 'open' CHECK in ('open', 'closed', 'partially_paid', 'paid', 'overdue'))
  - Constraints: `UNIQUE(credit_card_id, reference_month)`.
  - Triggers: `trg_check_credit_card_bill_workspace`.
  - RLS: Habilitado.

- **`payment_methods`**:
  - `id` (UUID PK DEFAULT `gen_random_uuid()`)
  - `workspace_id` (UUID NOT NULL REFERENCES `workspaces(id)` ON DELETE CASCADE)
  - `name` (TEXT NOT NULL)
  - `type` (TEXT NOT NULL CHECK in ('cash', 'pix', 'debit_card', 'credit_card', 'bank_transfer', 'boleto', 'automatic_debit', 'other'))
  - `linked_account_id` (UUID REFERENCES `accounts(id)` ON DELETE SET NULL)
  - `credit_card_id` (UUID REFERENCES `credit_cards(id)` ON DELETE SET NULL)
  - `active` (BOOLEAN NOT NULL DEFAULT true)
  - Triggers: `trg_check_payment_method_workspace`.
  - RLS: Habilitado.

- **`categories`**:
  - `id` (UUID PK DEFAULT `gen_random_uuid()`)
  - `workspace_id` (UUID NOT NULL REFERENCES `workspaces(id)` ON DELETE CASCADE)
  - `name` (TEXT NOT NULL)
  - `type` (TEXT NOT NULL CHECK in ('income', 'expense'))
  - `color`, `icon` (TEXT NOT NULL)
  - `parent_id` (UUID REFERENCES `categories(id)` ON DELETE CASCADE)
  - `active` (BOOLEAN NOT NULL DEFAULT true)
  - Triggers: `trg_check_category_workspace`.
  - RLS: Habilitado.

### 1.3. Movimentações, Compras e Pagamentos
- **`transactions`**:
  - `id` (UUID PK DEFAULT `gen_random_uuid()`)
  - `workspace_id` (UUID NOT NULL REFERENCES `workspaces(id)` ON DELETE CASCADE)
  - `account_id` (UUID REFERENCES `accounts(id)` ON DELETE SET NULL)
  - `category_id` (UUID REFERENCES `categories(id)` ON DELETE SET NULL)
  - `payment_method_id` (UUID REFERENCES `payment_methods(id)` ON DELETE SET NULL)
  - `credit_card_id` (UUID REFERENCES `credit_cards(id)` ON DELETE SET NULL)
  - `credit_card_bill_id` (UUID REFERENCES `credit_card_bills(id)` ON DELETE SET NULL)
  - `recurring_transaction_id` (UUID REFERENCES `recurring_transactions(id)` ON DELETE SET NULL)
  - `description` (TEXT NOT NULL)
  - `amount` (NUMERIC(12,2) NOT NULL CHECK (amount > 0))
  - `type` (TEXT NOT NULL CHECK in ('income', 'expense'))
  - `transaction_date`, `due_date` (DATE NOT NULL DEFAULT CURRENT_DATE)
  - `status` (TEXT NOT NULL DEFAULT 'pending' CHECK in ('pending', 'partially_paid', 'paid', 'overdue', 'cancelled'))
  - `paid_by_member_id` (UUID REFERENCES `workspace_members(id)` ON DELETE SET NULL) [V38]
  - `split_type` (TEXT NOT NULL DEFAULT 'individual' CHECK in ('individual', 'equal', 'full_other', 'custom')) [V38]
  - Triggers: `trg_check_transaction_workspace_integrity`, `trg_check_transaction_paid_by_member`, `trg_prevent_ws_change_transactions` [P1-02].
  - RLS: Habilitado.

- **`purchases`**:
  - `id` (UUID PK DEFAULT `gen_random_uuid()`)
  - `workspace_id` (UUID NOT NULL REFERENCES `workspaces(id)` ON DELETE CASCADE)
  - `account_id`, `credit_card_id`, `category_id`, `payment_method_id`
  - `description` (TEXT NOT NULL)
  - `total_amount` (NUMERIC(12,2) NOT NULL CHECK (total_amount > 0))
  - `installment_count` (INT NOT NULL CHECK (installment_count BETWEEN 1 AND 120))
  - `purchase_date` (DATE NOT NULL DEFAULT CURRENT_DATE)
  - `paid_by_member_id` (UUID REFERENCES `workspace_members(id)`) [V38]
  - `split_type` (TEXT NOT NULL DEFAULT 'individual') [V38]
  - Triggers: `trg_check_purchase_workspace_integrity`, `trg_check_purchase_paid_by_member`, `trg_prevent_ws_change_purchases` [P1-02].
  - RLS: Habilitado.

- **`installments`**:
  - `id` (UUID PK DEFAULT `gen_random_uuid()`)
  - `purchase_id` (UUID NOT NULL REFERENCES `purchases(id)` ON DELETE CASCADE)
  - `installment_number` (INT NOT NULL CHECK (installment_number >= 1))
  - `amount` (NUMERIC(12,2) NOT NULL CHECK (amount > 0))
  - `due_date` (DATE NOT NULL)
  - `credit_card_bill_id` (UUID REFERENCES `credit_card_bills(id)` ON DELETE SET NULL)
  - `status` (TEXT NOT NULL DEFAULT 'pending')
  - Constraints: `UNIQUE(purchase_id, installment_number)`.
  - RLS: Habilitado.

- **`payments`**:
  - `id` (UUID PK DEFAULT `gen_random_uuid()`)
  - `workspace_id` (UUID NOT NULL REFERENCES `workspaces(id)` ON DELETE CASCADE)
  - `transaction_id`, `installment_id`, `credit_card_bill_id` (alvo único)
  - `account_id` (UUID NULLABLE REFERENCES `accounts(id)`) [V38]
  - `affects_balance` (BOOLEAN NOT NULL DEFAULT true) [V38]
  - `amount` (NUMERIC(12,2) NOT NULL CHECK (amount > 0))
  - `payment_date` (DATE NOT NULL DEFAULT CURRENT_DATE)
  - Constraints: `payments_single_target_chk`, `payments_account_balance_chk` [V38].
  - Triggers: `trg_check_payment_workspace_integrity` (ajustado para account_id nullable [P1-01]).
  - RLS: Habilitado.

- **`transfers`**:
  - `id` (UUID PK DEFAULT `gen_random_uuid()`)
  - `workspace_id` (UUID NOT NULL REFERENCES `workspaces(id)` ON DELETE CASCADE)
  - `from_account_id`, `to_account_id` (UUID NOT NULL REFERENCES `accounts(id)`)
  - `amount` (NUMERIC(12,2) NOT NULL CHECK (amount > 0))
  - `transfer_date` (DATE NOT NULL DEFAULT CURRENT_DATE)
  - Constraints: `CHECK (from_account_id <> to_account_id)`.
  - Triggers: `trg_check_transfer_workspace_integrity`.
  - RLS: Habilitado.

### 1.4. Rateios e Liquidações (V38 Normalizadas)
- **`transaction_splits`** [V38]:
  - `id` (UUID PK)
  - `workspace_id` (UUID NOT NULL REFERENCES `workspaces(id)` ON DELETE CASCADE)
  - `transaction_id` (UUID NOT NULL REFERENCES `transactions(id)` ON DELETE CASCADE)
  - `member_id` (UUID NOT NULL REFERENCES `workspace_members(id)` ON DELETE CASCADE)
  - `amount` (NUMERIC(12,2) NOT NULL CHECK (amount >= 0))
  - `percentage` (NUMERIC(5,2) NULLABLE)
  - Constraints: `UNIQUE (transaction_id, member_id)`.
  - Triggers: `trg_check_transaction_split_workspace`, `trg_prevent_ws_change_tx_splits` [P1-02].

- **`purchase_splits`** [V38]:
  - `id` (UUID PK)
  - `workspace_id` (UUID NOT NULL REFERENCES `workspaces(id)` ON DELETE CASCADE)
  - `purchase_id` (UUID NOT NULL REFERENCES `purchases(id)` ON DELETE CASCADE)
  - `member_id` (UUID NOT NULL REFERENCES `workspace_members(id)` ON DELETE CASCADE)
  - `amount` (NUMERIC(12,2) NOT NULL CHECK (amount >= 0))
  - `percentage` (NUMERIC(5,2) NULLABLE)
  - Constraints: `UNIQUE (purchase_id, member_id)`.
  - Triggers: `trg_check_purchase_split_workspace`, `trg_prevent_ws_change_purchase_splits` [P1-02].

- **`settlements`** [V38]:
  - `id` (UUID PK)
  - `workspace_id` (UUID NOT NULL REFERENCES `workspaces(id)` ON DELETE CASCADE)
  - `from_member_id`, `to_member_id` (UUID NOT NULL REFERENCES `workspace_members(id)` ON DELETE RESTRICT)
  - `amount` (NUMERIC(12,2) NOT NULL CHECK (amount > 0))
  - `settlement_date` (DATE NOT NULL DEFAULT CURRENT_DATE)
  - `payment_account_id` (UUID NULLABLE REFERENCES `accounts(id)`)
  - Constraints: `CHECK (from_member_id <> to_member_id)`.
  - Triggers: `trg_check_settlement_workspace`, `trg_prevent_ws_change_settlements` [P1-02].

### 1.5. Recorrências, Orçamentos e Metas
- **`recurring_transactions`**:
  - `id`, `workspace_id`, `account_id`, `category_id`, `payment_method_id`
  - `frequency` (TEXT CHECK in ('weekly', 'monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual', 'custom'))
  - `start_date`, `next_occurrence`, `end_date`, `interval_days`
  - `auto_create`, `active` (BOOLEAN)
  - Triggers: `trg_check_recurring_workspace_integrity`.
  - RLS: Habilitado.

- **`budgets`**:
  - `id`, `workspace_id`, `category_id`, `month`, `year`, `planned_amount`
  - Constraints: `UNIQUE(workspace_id, category_id, month, year)`.
  - Triggers: `trg_check_budget_workspace_integrity`.
  - RLS: Habilitado.

- **`financial_goals`**:
  - `id`, `workspace_id`, `name`, `target_amount`, `current_amount`, `target_date`, `status`
  - RLS: Habilitado.

---

## 2. Funções e RPCs Atômicas

1. `is_member(p_workspace_id UUID) -> BOOLEAN` (usada em RLS)
2. `has_workspace_role(p_workspace_id UUID, p_roles TEXT[]) -> BOOLEAN` (usada em RLS)
3. `fn_create_workspace(p_name TEXT, p_currency TEXT) -> UUID`
4. `fn_transfer_workspace_ownership(p_workspace_id UUID, p_new_owner_id UUID) -> VOID`
5. `fn_get_or_create_credit_card_bill(...) -> UUID`
6. `fn_create_installment_purchase(...) -> UUID`
7. `fn_create_credit_card_transaction(...) -> UUID`
8. `fn_record_payment(...) -> UUID`
9. `fn_create_transfer(...) -> UUID`
10. `fn_prevent_workspace_id_change() -> TRIGGER` (Imutabilidade parent-side [P1-02])
11. `fn_check_payment_workspace_integrity() -> TRIGGER` (Compatível com account_id NULL [P1-01])
