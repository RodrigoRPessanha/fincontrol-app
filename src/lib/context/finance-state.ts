import {
  Account,
  Budget,
  Category,
  CreditCard,
  CreditCardBill,
  FinancialGoal,
  Installment,
  Payment,
  PaymentMethod,
  Person,
  Purchase,
  RecurringTransaction,
  Settlement,
  Transaction,
  Transfer,
  UpdateTransactionDTO,
  Workspace,
  WorkspaceMember,
  WorkspaceTrackingMode,
  SplitType,
  TransactionSplit,
} from '../types';

export interface FinanceState {
  activeWorkspaceId: string;
  allWorkspaces: Workspace[];
  allWorkspaceMembers: WorkspaceMember[];
  allPeople: Person[];
  allAccounts: Account[];
  allCreditCards: CreditCard[];
  allCreditCardBills: CreditCardBill[];
  allPaymentMethods: PaymentMethod[];
  allCategories: Category[];
  allTransactions: Transaction[];
  allPurchases: Purchase[];
  allInstallments: Installment[];
  allPayments: Payment[];
  allTransfers: Transfer[];
  allRecurring: RecurringTransaction[];
  allBudgets: Budget[];
  allGoals: FinancialGoal[];
  allSettlements: Settlement[];
}

export interface FinanceContextType {
  isLoaded: boolean;
  isLoading: boolean;
  isSaving: boolean;
  isWorkspaceReadOnly: boolean;
  error: Error | null;
  clearError: () => void;
  refreshData: () => Promise<void>;
  dataMode: 'local' | 'supabase';
  workspaces: Workspace[];
  activeWorkspace: Workspace;
  workspaceMembers: WorkspaceMember[];
  setActiveWorkspaceId: (id: string) => void;
  createWorkspace: (name: string, tracking_mode?: WorkspaceTrackingMode) => Workspace;
  updateWorkspace: (id: string, data: Partial<Workspace>) => void;
  addWorkspaceMember: (email: string, role: 'admin' | 'member' | 'viewer') => void;

  accounts: Account[];
  allWorkspaceAccounts: Account[];
  addAccount: (account: Omit<Account, 'id' | 'workspace_id' | 'created_at'>) => Account;
  updateAccount: (id: string, account: Omit<Partial<Account>, 'id' | 'workspace_id' | 'created_at'>) => void;
  deleteAccount: (id: string) => { success: boolean; action: 'deleted' | 'inactivated'; message: string };

  creditCards: CreditCard[];
  allWorkspaceCreditCards: CreditCard[];
  creditCardBills: CreditCardBill[];
  addCreditCard: (card: Omit<CreditCard, 'id' | 'workspace_id' | 'created_at'>) => CreditCard;
  updateCreditCard: (id: string, card: Omit<Partial<CreditCard>, 'id' | 'workspace_id' | 'created_at'>) => void;
  payCreditCardBill: (billId: string, accountId?: string | null, amount?: number, paymentDate?: string, notes?: string, operationKey?: string) => Payment;
  payCreditCardBillAsync: (billId: string, accountId?: string | null, amount?: number, paymentDate?: string, notes?: string, operationKey?: string) => Promise<Payment>;

  paymentMethods: PaymentMethod[];
  allWorkspacePaymentMethods: PaymentMethod[];
  addPaymentMethod: (pm: Omit<PaymentMethod, 'id' | 'workspace_id' | 'created_at'>) => PaymentMethod;
  addPaymentMethodAsync: (pm: Omit<PaymentMethod, 'id' | 'workspace_id' | 'created_at'>) => Promise<PaymentMethod>;
  updatePaymentMethodAsync: (id: string, data: Partial<Pick<PaymentMethod, 'name' | 'type' | 'active'>>) => Promise<PaymentMethod>;
  deletePaymentMethodAsync: (id: string) => Promise<void>;

  categories: Category[];
  allWorkspaceCategories: Category[];
  addCategory: (cat: Omit<Category, 'id' | 'workspace_id' | 'created_at'>) => Category;
  updateCategory: (id: string, cat: Omit<Partial<Category>, 'id' | 'workspace_id' | 'created_at'>) => void;

  transactions: Transaction[];
  addTransaction: (tx: Omit<Transaction, 'id' | 'workspace_id' | 'created_at'>) => Transaction;
  updateTransaction: (id: string, tx: UpdateTransactionDTO) => void;
  updateTransactionAsync: (id: string, tx: UpdateTransactionDTO, expectedUpdatedAt?: string) => Promise<void>;
  addTransactionAsync: (data: Parameters<FinanceContextType['addTransaction']>[0]) => Promise<Transaction>;
  deleteTransaction: (id: string) => void;
  duplicateTransaction: (id: string) => Transaction | null;

  purchases: Purchase[];
  installments: Installment[];
  createInstallmentPurchase: (data: {
    operation_key?: string;
    description: string;
    total_amount: number;
    installment_count: number;
    purchase_date: string;
    credit_card_id?: string;
    category_id?: string;
    account_id?: string;
    payment_method_id?: string;
    paid_installments_count?: number;
    paid_by_member_id?: string;
    paid_by_person_id?: string;
    split_type?: SplitType;
    splits?: TransactionSplit[];
  }) => Purchase;

  createInstallmentPurchaseAsync: (data: Parameters<FinanceContextType['createInstallmentPurchase']>[0]) => Promise<Purchase>;

  payments: Payment[];
  recordPayment: (data: {
    operation_key?: string;
    transaction_id?: string;
    installment_id?: string;
    credit_card_bill_id?: string;
    account_id?: string | null;
    payment_method_id?: string;
    amount: number;
    payment_date: string;
    notes?: string;
  }) => Payment;
  recordPaymentAsync: (data: {
    operation_key?: string;
    transaction_id?: string;
    installment_id?: string;
    credit_card_bill_id?: string;
    account_id?: string | null;
    payment_method_id?: string;
    amount: number;
    payment_date: string;
    notes?: string;
  }) => Promise<Payment>;

  transfers: Transfer[];
  createTransfer: (fromAccountId: string, toAccountId: string, amount: number, date?: string, notes?: string, operationKey?: string) => Transfer | null;

  createTransferAsync: (...args: Parameters<FinanceContextType['createTransfer']>) => Promise<Transfer | null>;
  recordSettlementAsync: (data: Parameters<FinanceContextType['recordSettlement']>[0]) => Promise<Settlement>;

  settlements: Settlement[];
  recordSettlement: (data: {
    operation_key?: string;
    from_member_id?: string | null;
    to_member_id?: string | null;
    from_person_id?: string | null;
    to_person_id?: string | null;
    amount: number;
    settlement_date?: string;
    notes?: string;
    payment_account_id?: string;
  }) => Settlement;
  deleteSettlement: (id: string) => void;

  people: Person[];
  allWorkspacePeople: Person[];
  addPerson: (nameOrData: string | { name: string; workspace_id?: string }) => Person;
  updatePerson: (id: string, data: { name?: string; archived?: boolean }) => void;
  deletePerson: (id: string) => void;

  recurring: RecurringTransaction[];
  addRecurring: (data: Omit<RecurringTransaction, 'id' | 'workspace_id' | 'created_at'>) => RecurringTransaction;
  toggleRecurring: (id: string) => void;
  deleteRecurring: (id: string) => void;
  processPendingRecurring: () => void;

  budgets: Budget[];
  setBudget: (categoryId: string, plannedAmount: number, month?: number, year?: number) => void;

  goals: FinancialGoal[];
  addGoal: (goal: Omit<FinancialGoal, 'id' | 'workspace_id' | 'created_at'>) => FinancialGoal;
  updateGoal: (id: string, data: Omit<Partial<FinancialGoal>, 'id' | 'workspace_id' | 'created_at'>) => void;
  depositGoal: (goalId: string, amount: number, accountId: string) => void;
  depositGoalAsync: (goalId: string, amount: number, accountId: string, idempotencyKey?: string) => Promise<void>;

  viewPerspective: 'realized' | 'planned';
  setViewPerspective: (p: 'realized' | 'planned') => void;
  waitForPendingMutations: () => Promise<void>;
}
