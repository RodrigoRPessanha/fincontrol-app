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
  Purchase,
  RecurringTransaction,
  Settlement,
  Transaction,
  Transfer,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
} from '../types';
import { FinanceState } from '../context/finance-state';

/**
 * Interface agnóstica de persistência financeira do FinControl V38.
 * Desacopla o FinanceProvider e a UI das fontes concretas (Local vs Supabase Cloud).
 */
export interface FinanceRepository {
  // Snapshot consolidado de um workspace (sem problemas de N+1)
  loadSnapshot(workspaceId: string): Promise<FinanceState>;

  // Workspaces e Membros
  getWorkspaces(userId?: string): Promise<Workspace[]>;
  createWorkspace(workspace: Omit<Workspace, 'id' | 'created_at'>): Promise<Workspace>;
  updateWorkspace(id: string, updates: Partial<Workspace>): Promise<Workspace>;
  deleteWorkspace(id: string): Promise<void>;
  getWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[]>;
  addWorkspaceMember(member: Omit<WorkspaceMember, 'id' | 'created_at'>): Promise<WorkspaceMember>;
  updateWorkspaceMemberRole(id: string, role: WorkspaceRole): Promise<WorkspaceMember>;
  removeWorkspaceMember(id: string): Promise<void>;

  // Contas
  getAccounts(workspaceId: string): Promise<Account[]>;
  saveAccount(account: Omit<Account, 'id' | 'created_at'> & { id?: string }): Promise<Account>;
  deleteAccount(id: string): Promise<void>;

  // Formas de Pagamento
  getPaymentMethods(workspaceId: string): Promise<PaymentMethod[]>;
  savePaymentMethod(method: Omit<PaymentMethod, 'id' | 'created_at'> & { id?: string }): Promise<PaymentMethod>;
  deletePaymentMethod(id: string): Promise<void>;

  // Cartões de Crédito e Faturas
  getCreditCards(workspaceId: string): Promise<CreditCard[]>;
  saveCreditCard(card: Omit<CreditCard, 'id' | 'created_at'> & { id?: string }): Promise<CreditCard>;
  deleteCreditCard(id: string): Promise<void>;
  getCreditCardBills(creditCardId: string): Promise<CreditCardBill[]>;

  // Categorias
  getCategories(workspaceId: string): Promise<Category[]>;
  saveCategory(category: Omit<Category, 'id' | 'created_at'> & { id?: string }): Promise<Category>;
  deleteCategory(id: string): Promise<void>;

  // Transações
  getTransactions(workspaceId: string): Promise<Transaction[]>;
  saveTransaction(transaction: Omit<Transaction, 'id' | 'created_at'> & { id?: string }): Promise<Transaction>;
  deleteTransaction(id: string): Promise<void>;

  // Compras Parceladas e Parcelas
  getPurchases(workspaceId: string): Promise<Purchase[]>;
  savePurchase(purchase: Omit<Purchase, 'id' | 'created_at'> & { id?: string }): Promise<Purchase>;
  deletePurchase(id: string): Promise<void>;
  getInstallments(purchaseId: string): Promise<Installment[]>;

  // Pagamentos
  getPayments(workspaceId: string): Promise<Payment[]>;
  savePayment(payment: Omit<Payment, 'id' | 'created_at'> & { id?: string }): Promise<Payment>;
  deletePayment(id: string): Promise<void>;

  // Transferências
  getTransfers(workspaceId: string): Promise<Transfer[]>;
  saveTransfer(transfer: Omit<Transfer, 'id' | 'created_at'> & { id?: string }): Promise<Transfer>;
  deleteTransfer(id: string): Promise<void>;

  // Transações Recorrentes
  getRecurring(workspaceId: string): Promise<RecurringTransaction[]>;
  saveRecurring(recurring: Omit<RecurringTransaction, 'id' | 'created_at'> & { id?: string }): Promise<RecurringTransaction>;
  deleteRecurring(id: string): Promise<void>;

  // Orçamentos e Metas
  getBudgets(workspaceId: string): Promise<Budget[]>;
  saveBudget(budget: Omit<Budget, 'id'> & { id?: string }): Promise<Budget>;
  deleteBudget(id: string): Promise<void>;
  getGoals(workspaceId: string): Promise<FinancialGoal[]>;
  saveGoal(goal: Omit<FinancialGoal, 'id' | 'created_at'> & { id?: string }): Promise<FinancialGoal>;
  deleteGoal(id: string): Promise<void>;

  // Acertos entre Membros (Settlements)
  getSettlements(workspaceId: string): Promise<Settlement[]>;
  saveSettlement(settlement: Omit<Settlement, 'id' | 'created_at'> & { id?: string }): Promise<Settlement>;
  deleteSettlement(id: string): Promise<void>;
}
