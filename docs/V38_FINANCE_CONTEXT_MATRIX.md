# FinControl V38 - Matriz Exaustiva de Mapeamento do FinanceContext

**Data da Homologação**: 20/09/2026  
**Interface Mapeada**: `FinanceContextType` (`src/lib/context/finance-state.ts`)  
**Total de Entradas**: 54 propriedades e métodos públicos

---

## 1. Estados e Seletores Reativos (17 Entradas)

| # | Propriedade / Getter | Tipo TypeScript | Origem dos Dados no Supabase / Runtime |
| :---: | :--- | :--- | :--- |
| 1 | `isLoaded` | `boolean` | Estado local do Provider (true após carregamento inicial do snapshot) |
| 2 | `workspaces` | `Workspace[]` | `public.workspaces` filtrado pelo usuário autenticado via `workspace_members` |
| 3 | `activeWorkspace` | `Workspace` | Workspace selecionado no `stateRef` |
| 4 | `workspaceMembers` | `WorkspaceMember[]` | `public.workspace_members` onde `workspace_id = activeWorkspace.id` |
| 5 | `accounts` | `Account[]` | `public.accounts` ativas no workspace ativo |
| 6 | `allWorkspaceAccounts` | `Account[]` | `public.accounts` (ativas + inativas) no workspace ativo |
| 7 | `creditCards` | `CreditCard[]` | `public.credit_cards` ativas no workspace ativo |
| 8 | `allWorkspaceCreditCards`| `CreditCard[]` | `public.credit_cards` (ativas + inativas) no workspace ativo |
| 9 | `creditCardBills` | `CreditCardBill[]` | `public.credit_card_bills` no workspace ativo |
| 10 | `paymentMethods` | `PaymentMethod[]` | `public.payment_methods` ativas no workspace ativo |
| 11 | `allWorkspacePaymentMethods`| `PaymentMethod[]`| `public.payment_methods` (ativas + inativas) no workspace ativo |
| 12 | `categories` | `Category[]` | `public.categories` ativas no workspace ativo |
| 13 | `allWorkspaceCategories`| `Category[]` | `public.categories` (ativas + inativas) no workspace ativo |
| 14 | `transactions` | `Transaction[]` | `public.transactions` no workspace ativo (+ `transaction_splits`) |
| 15 | `purchases` | `Purchase[]` | `public.purchases` no workspace ativo (+ `purchase_splits`) |
| 16 | `installments` | `Installment[]` | `public.installments` no workspace ativo |
| 17 | `payments` | `Payment[]` | `public.payments` no workspace ativo |
| 18 | `transfers` | `Transfer[]` | `public.transfers` no workspace ativo |
| 19 | `settlements` | `Settlement[]` | `public.settlements` no workspace ativo |
| 20 | `recurring` | `RecurringTransaction[]`| `public.recurring_transactions` no workspace ativo |
| 21 | `budgets` | `Budget[]` | `public.budgets` no workspace ativo |
| 22 | `goals` | `FinancialGoal[]` | `public.financial_goals` no workspace ativo |
| 23 | `viewPerspective` | `'realized' \| 'planned'` | Preferência de UI (armazenada em cookie/localStorage de preferência) |

---

## 2. Métodos de Mutação e Ações de Domínio (31 Métodos)

| # | Método | Parâmetros | Retorno | Destino Supabase | Tipo de Operação |
| :---: | :--- | :--- | :--- | :--- | :--- |
| 24 | `setActiveWorkspaceId` | `(id: string)` | `void` | `stateRef` + Cookie de preferência | Local / Seleção de Workspace |
| 25 | `createWorkspace` | `(name: string, mode?: WorkspaceTrackingMode)` | `Workspace` | `workspaces` + `workspace_members` | RPC `fn_create_workspace` |
| 26 | `updateWorkspace` | `(id: string, data: Partial<Workspace>)` | `void` | `public.workspaces` | `UPDATE ... WHERE id = $1` sob RLS |
| 27 | `addWorkspaceMember` | `(email: string, role: Role)` | `void` | `public.workspace_members` | `INSERT INTO workspace_members` sob RLS |
| 28 | `addAccount` | `(account: Omit<Account, 'id' \| ...>)` | `Account` | `public.accounts` | `INSERT INTO accounts` sob RLS |
| 29 | `updateAccount` | `(id: string, account: Partial<Account>)` | `void` | `public.accounts` | `UPDATE accounts` sob RLS |
| 30 | `deleteAccount` | `(id: string)` | `{ success, action, message }` | `public.accounts` | `DELETE` ou `UPDATE active=false` sob RLS |
| 31 | `addCreditCard` | `(card: Omit<CreditCard, 'id' \| ...>)` | `CreditCard` | `public.credit_cards` | `INSERT INTO credit_cards` sob RLS |
| 32 | `updateCreditCard` | `(id: string, card: Partial<CreditCard>)` | `void` | `public.credit_cards` | `UPDATE credit_cards` sob RLS |
| 33 | `payCreditCardBill` | `(billId, accountId?, amount?, date?, notes?)` | `Payment` | `payments` + `credit_card_bills` | RPC `fn_record_payment` |
| 34 | `addPaymentMethod` | `(pm: Omit<PaymentMethod, 'id' \| ...>)` | `PaymentMethod` | `public.payment_methods` | `INSERT INTO payment_methods` sob RLS |
| 35 | `addCategory` | `(cat: Omit<Category, 'id' \| ...>)` | `Category` | `public.categories` | `INSERT INTO categories` sob RLS |
| 36 | `updateCategory` | `(id: string, cat: Partial<Category>)` | `void` | `public.categories` | `UPDATE categories` sob RLS |
| 37 | `addTransaction` | `(tx: Omit<Transaction, 'id' \| ...>)` | `Transaction` | `transactions` (+ `transaction_splits`) | `INSERT` com splits normalizados |
| 38 | `updateTransaction` | `(id: string, tx: UpdateTransactionDTO)` | `void` | `transactions` (+ `transaction_splits`) | `UPDATE` atômico transação + splits |
| 39 | `deleteTransaction` | `(id: string)` | `void` | `public.transactions` | `DELETE transactions` (cascade nos splits) |
| 40 | `duplicateTransaction`| `(id: string)` | `Transaction \| null` | `transactions` (+ splits) | `INSERT` de cópia sob RLS |
| 41 | `createInstallmentPurchase` | `(data: InstallmentPurchaseDTO)` | `Purchase` | `purchases` + `installments` + splits | RPC `fn_create_installment_purchase` |
| 42 | `recordPayment` | `(data: PaymentDTO)` | `Payment` | `payments` + `accounts` + target | RPC `fn_record_payment` |
| 43 | `createTransfer` | `(fromAcc, toAcc, amount, date?, notes?)` | `Transfer \| null` | `transfers` + `accounts` | RPC `fn_create_transfer` |
| 44 | `recordSettlement` | `(data: SettlementDTO)` | `Settlement` | `public.settlements` | RPC `fn_record_settlement` [V38] |
| 45 | `deleteSettlement` | `(id: string)` | `void` | `public.settlements` | `DELETE settlements` sob RLS |
| 46 | `addRecurring` | `(data: Omit<RecurringTransaction, 'id' \| ...>)` | `RecurringTransaction` | `public.recurring_transactions` | `INSERT recurring_transactions` sob RLS |
| 47 | `toggleRecurring` | `(id: string)` | `void` | `public.recurring_transactions` | `UPDATE active = NOT active` sob RLS |
| 48 | `deleteRecurring` | `(id: string)` | `void` | `public.recurring_transactions` | `DELETE recurring_transactions` sob RLS |
| 49 | `processPendingRecurring` | `()` | `void` | `recurring_transactions` + `transactions` | RPC `materialize_due_recurring_transactions` |
| 50 | `setBudget` | `(categoryId, plannedAmount, month?, year?)` | `void` | `public.budgets` | `INSERT ... ON CONFLICT DO UPDATE` sob RLS |
| 51 | `addGoal` | `(goal: Omit<FinancialGoal, 'id' \| ...>)` | `FinancialGoal` | `public.financial_goals` | `INSERT financial_goals` sob RLS |
| 52 | `updateGoal` | `(id: string, data: Partial<FinancialGoal>)` | `void` | `public.financial_goals` | `UPDATE financial_goals` sob RLS |
| 53 | `depositGoal` | `(goalId, amount, accountId)` | `void` | `financial_goals` + `accounts` | Transação / RPC de aporte sob RLS |
| 54 | `setViewPerspective` | `(perspective: 'realized' \| 'planned')` | `void` | Runtime / Local State | Atualização reativa de visualização |
