export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatar_url?: string;
  created_at: string;
}

export interface Workspace {
  id: string;
  name: string;
  owner_id: string;
  currency: string;
  created_at: string;
}

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  user?: UserProfile;
  created_at: string;
}

export type AccountType = 'checking' | 'savings' | 'cash' | 'wallet' | 'investment' | 'other';

export interface Account {
  id: string;
  workspace_id: string;
  name: string;
  type: AccountType;
  institution: string;
  initial_balance: number;
  current_balance: number;
  color: string;
  active: boolean;
  created_at: string;
}

export interface CreditCard {
  id: string;
  workspace_id: string;
  name: string;
  institution: string;
  last_four_digits?: string;
  credit_limit: number;
  closing_day: number; // 1-31
  due_day: number; // 1-31
  linked_payment_account_id?: string;
  color: string;
  active: boolean;
  created_at: string;
}

export type BillStatus = 'open' | 'closed' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled';

export interface CreditCardBill {
  id: string;
  credit_card_id: string;
  workspace_id: string;
  reference_month: string; // 'YYYY-MM'
  closing_date: string;
  due_date: string;
  total_amount: number;
  paid_amount: number;
  status: BillStatus;
  paid_at?: string | null;
  created_at: string;
}

export type PaymentMethodType =
  | 'cash'
  | 'pix'
  | 'debit_card'
  | 'credit_card'
  | 'bank_transfer'
  | 'boleto'
  | 'automatic_debit'
  | 'other';

export interface PaymentMethod {
  id: string;
  workspace_id: string;
  name: string;
  type: PaymentMethodType;
  linked_account_id?: string;
  credit_card_id?: string;
  active: boolean;
  created_at: string;
}

export interface Category {
  id: string;
  workspace_id: string;
  parent_id?: string | null;
  name: string;
  icon: string;
  color: string;
  type: 'income' | 'expense';
  active: boolean;
  created_at: string;
  subcategories?: Category[];
}

export type TransactionStatus = 'pending' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled';
export type TransactionType = 'income' | 'expense';

export interface Transaction {
  id: string;
  workspace_id: string;
  account_id?: string | null;
  category_id?: string | null;
  payment_method_id?: string | null;
  credit_card_id?: string | null;
  credit_card_bill_id?: string | null;
  recurring_transaction_id?: string | null;
  description: string;
  amount: number;
  type: TransactionType;
  transaction_date: string; // Data de competência
  due_date: string; // Data de vencimento
  paid_at?: string | null;
  status: TransactionStatus;
  notes?: string | null;
  created_by?: string;
  created_at: string;
  updated_at?: string;
  // Campos calculados / expandidos no frontend
  paid_amount?: number;
  category?: Category;
  account?: Account;
  credit_card?: CreditCard;
  payment_method?: PaymentMethod;
}

export type UpdateTransactionDTO = {
  description?: string;
  amount?: number;
  category_id?: string | null;
  due_date?: string;
  transaction_date?: string;
  notes?: string | null;
};

export interface Payment {
  id: string;
  workspace_id: string;
  transaction_id?: string | null;
  installment_id?: string | null;
  credit_card_bill_id?: string | null;
  account_id: string;
  payment_method_id?: string | null;
  amount: number;
  payment_date: string;
  notes?: string | null;
  created_by?: string;
  created_at: string;
}

export interface Purchase {
  id: string;
  workspace_id: string;
  account_id?: string | null;
  credit_card_id?: string | null;
  category_id?: string | null;
  payment_method_id?: string | null;
  description: string;
  total_amount: number;
  installment_count: number;
  paid_installments_count?: number;
  purchase_date: string;
  created_by?: string;
  created_at: string;
  // Expandidos
  installments?: Installment[];
  category?: Category;
  credit_card?: CreditCard;
}

export interface Installment {
  id: string;
  purchase_id: string;
  installment_number: number;
  amount: number;
  due_date: string;
  credit_card_bill_id?: string | null;
  status: TransactionStatus;
  paid_amount: number;
  paid_at?: string | null;
  created_at: string;
  // Expandidos
  purchase?: Purchase;
  bill?: CreditCardBill;
}

export interface Transfer {
  id: string;
  workspace_id: string;
  from_account_id: string;
  to_account_id: string;
  amount: number;
  transfer_date: string;
  notes?: string | null;
  created_by?: string;
  created_at: string;
  from_account?: Account;
  to_account?: Account;
}

export type RecurrenceFrequency =
  | 'weekly'
  | 'monthly'
  | 'bimonthly'
  | 'quarterly'
  | 'semiannual'
  | 'annual'
  | 'custom';

export interface RecurringTransaction {
  id: string;
  workspace_id: string;
  description: string;
  amount: number;
  type: TransactionType;
  category_id?: string | null;
  account_id?: string | null;
  payment_method_id?: string | null;
  credit_card_id?: string | null;
  frequency: RecurrenceFrequency;
  interval_days?: number | null;
  start_date: string;
  end_date?: string | null;
  next_occurrence: string;
  auto_create: boolean;
  active: boolean;
  suspended_reason?: string | null;
  created_at: string;
  category?: Category;
}

export interface Budget {
  id: string;
  workspace_id: string;
  category_id: string;
  month: number; // 1-12
  year: number;
  planned_amount: number;
  category?: Category;
  spent_amount?: number; // Calculado
}

export interface FinancialGoal {
  id: string;
  workspace_id: string;
  name: string;
  target_amount: number;
  current_amount: number;
  target_date?: string | null;
  status: 'in_progress' | 'completed' | 'paused';
  color: string;
  icon: string;
  created_at: string;
}

export interface MonthlyCommitment {
  monthKey: string; // '2026-09'
  monthLabel: string; // 'Setembro 2026'
  installmentsAmount: number;
  recurringAmount: number;
  pendingTransactionsAmount: number;
  expectedIncome: number;
  totalCommitment: number;
  netForecast: number;
  installmentsCount: number;
  items: {
    title: string;
    amount: number;
    type: 'installment' | 'recurring' | 'bill' | 'transaction';
    dueDate: string;
    categoryName?: string;
  }[];
}
