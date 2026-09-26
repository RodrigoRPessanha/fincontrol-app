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
import {
  loadFinanceSnapshot,
  saveFinanceSnapshot,
  STORAGE_KEYS,
} from '../context/finance-storage';
import { FinanceRepository } from './finance-repository';
import { RepositoryError } from './repository-errors';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

function generateId(): string {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return 'local_' + Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
}

/**
 * Implementação local do FinanceRepository baseada no Storage do navegador (ou memória).
 * Preserva 100% da compatibilidade e comportamento do finance-storage.ts legado.
 */
export class LocalFinanceRepository implements FinanceRepository {
  private readonly storage: Storage;

  constructor(storage?: Storage) {
    if (storage) {
      this.storage = storage;
    } else if (typeof window !== 'undefined' && window.localStorage) {
      this.storage = window.localStorage;
    } else {
      this.storage = createMemoryStorage();
    }
  }

  private getState(): FinanceState {
    const result = loadFinanceSnapshot(this.storage);
    return result.snapshot;
  }

  private saveState(state: FinanceState): void {
    saveFinanceSnapshot(this.storage, state);
  }

  async loadSnapshot(workspaceId: string): Promise<FinanceState> {
    const state = this.getState();
    if (workspaceId && state.allWorkspaces.some((w) => w.id === workspaceId)) {
      state.activeWorkspaceId = workspaceId;
      try {
        this.storage.setItem(STORAGE_KEYS.activeWorkspaceId, workspaceId);
      } catch {
        // Ignora erros de escrita no storage para activeWorkspaceId
      }
    }
    return state;
  }

  // Workspaces e Membros
  async getWorkspaces(_userId?: string): Promise<Workspace[]> {
    return this.getState().allWorkspaces;
  }

  async createWorkspace(workspace: Omit<Workspace, 'id' | 'created_at'>): Promise<Workspace> {
    const state = this.getState();
    const newWs: Workspace = {
      ...workspace,
      id: generateId(),
      created_at: new Date().toISOString(),
    };
    state.allWorkspaces = [...state.allWorkspaces, newWs];
    this.saveState(state);
    return newWs;
  }

  async updateWorkspace(id: string, updates: Partial<Workspace>): Promise<Workspace> {
    const state = this.getState();
    const index = state.allWorkspaces.findIndex((w) => w.id === id);
    if (index === -1) {
      throw new RepositoryError(`Workspace com id ${id} não encontrado`, 'NOT_FOUND', undefined, 'workspaces');
    }
    const updated: Workspace = { ...state.allWorkspaces[index], ...updates };
    state.allWorkspaces = [
      ...state.allWorkspaces.slice(0, index),
      updated,
      ...state.allWorkspaces.slice(index + 1),
    ];
    this.saveState(state);
    return updated;
  }

  async deleteWorkspace(id: string): Promise<void> {
    const state = this.getState();
    const exists = state.allWorkspaces.some((w) => w.id === id);
    if (!exists) {
      throw new RepositoryError(`Workspace com id ${id} não encontrado`, 'NOT_FOUND', undefined, 'workspaces');
    }
    state.allWorkspaces = state.allWorkspaces.filter((w) => w.id !== id);
    this.saveState(state);
  }

  async getWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    return this.getState().allWorkspaceMembers.filter((m) => m.workspace_id === workspaceId);
  }

  async addWorkspaceMember(member: Omit<WorkspaceMember, 'id' | 'created_at'>): Promise<WorkspaceMember> {
    const state = this.getState();
    const newMember: WorkspaceMember = {
      ...member,
      id: generateId(),
      created_at: new Date().toISOString(),
    };
    state.allWorkspaceMembers = [...state.allWorkspaceMembers, newMember];
    this.saveState(state);
    return newMember;
  }

  async updateWorkspaceMemberRole(id: string, role: WorkspaceRole): Promise<WorkspaceMember> {
    const state = this.getState();
    const index = state.allWorkspaceMembers.findIndex((m) => m.id === id);
    if (index === -1) {
      throw new RepositoryError(`Membro de workspace com id ${id} não encontrado`, 'NOT_FOUND', undefined, 'workspace_members');
    }
    const updated: WorkspaceMember = { ...state.allWorkspaceMembers[index], role };
    state.allWorkspaceMembers = [
      ...state.allWorkspaceMembers.slice(0, index),
      updated,
      ...state.allWorkspaceMembers.slice(index + 1),
    ];
    this.saveState(state);
    return updated;
  }

  async removeWorkspaceMember(id: string): Promise<void> {
    const state = this.getState();
    const exists = state.allWorkspaceMembers.some((m) => m.id === id);
    if (!exists) {
      throw new RepositoryError(`Membro de workspace com id ${id} não encontrado`, 'NOT_FOUND', undefined, 'workspace_members');
    }
    state.allWorkspaceMembers = state.allWorkspaceMembers.filter((m) => m.id !== id);
    this.saveState(state);
  }

  // Contas
  async getAccounts(workspaceId: string): Promise<Account[]> {
    return this.getState().allAccounts.filter((a) => a.workspace_id === workspaceId);
  }

  async saveAccount(account: Omit<Account, 'id' | 'created_at'> & { id?: string }): Promise<Account> {
    const state = this.getState();
    if (account.id) {
      const index = state.allAccounts.findIndex((a) => a.id === account.id);
      if (index !== -1) {
        const updated: Account = {
          ...state.allAccounts[index],
          ...account,
          id: account.id,
        };
        state.allAccounts = [
          ...state.allAccounts.slice(0, index),
          updated,
          ...state.allAccounts.slice(index + 1),
        ];
        this.saveState(state);
        return updated;
      }
    }
    const newAccount: Account = {
      ...account,
      id: account.id || generateId(),
      created_at: new Date().toISOString(),
    };
    state.allAccounts = [...state.allAccounts, newAccount];
    this.saveState(state);
    return newAccount;
  }

  async deleteAccount(id: string): Promise<void> {
    const state = this.getState();
    const exists = state.allAccounts.some((a) => a.id === id);
    if (!exists) {
      throw new RepositoryError(`Conta com id ${id} não encontrada`, 'NOT_FOUND', undefined, 'accounts');
    }
    state.allAccounts = state.allAccounts.filter((a) => a.id !== id);
    this.saveState(state);
  }

  // Formas de Pagamento
  async getPaymentMethods(workspaceId: string): Promise<PaymentMethod[]> {
    return this.getState().allPaymentMethods.filter((m) => m.workspace_id === workspaceId);
  }

  async savePaymentMethod(method: Omit<PaymentMethod, 'id' | 'created_at'> & { id?: string }): Promise<PaymentMethod> {
    const state = this.getState();
    if (method.id) {
      const index = state.allPaymentMethods.findIndex((m) => m.id === method.id);
      if (index !== -1) {
        const updated: PaymentMethod = {
          ...state.allPaymentMethods[index],
          ...method,
          id: method.id,
        };
        state.allPaymentMethods = [
          ...state.allPaymentMethods.slice(0, index),
          updated,
          ...state.allPaymentMethods.slice(index + 1),
        ];
        this.saveState(state);
        return updated;
      }
    }
    const newMethod: PaymentMethod = {
      ...method,
      id: method.id || generateId(),
      created_at: new Date().toISOString(),
    };
    state.allPaymentMethods = [...state.allPaymentMethods, newMethod];
    this.saveState(state);
    return newMethod;
  }

  async deletePaymentMethod(id: string): Promise<void> {
    const state = this.getState();
    const exists = state.allPaymentMethods.some((m) => m.id === id);
    if (!exists) {
      throw new RepositoryError(`Forma de pagamento com id ${id} não encontrada`, 'NOT_FOUND', undefined, 'payment_methods');
    }
    state.allPaymentMethods = state.allPaymentMethods.filter((m) => m.id !== id);
    this.saveState(state);
  }

  // Cartões de Crédito e Faturas
  async getCreditCards(workspaceId: string): Promise<CreditCard[]> {
    return this.getState().allCreditCards.filter((c) => c.workspace_id === workspaceId);
  }

  async saveCreditCard(card: Omit<CreditCard, 'id' | 'created_at'> & { id?: string }): Promise<CreditCard> {
    const state = this.getState();
    if (card.id) {
      const index = state.allCreditCards.findIndex((c) => c.id === card.id);
      if (index !== -1) {
        const updated: CreditCard = {
          ...state.allCreditCards[index],
          ...card,
          id: card.id,
        };
        state.allCreditCards = [
          ...state.allCreditCards.slice(0, index),
          updated,
          ...state.allCreditCards.slice(index + 1),
        ];
        this.saveState(state);
        return updated;
      }
    }
    const newCard: CreditCard = {
      ...card,
      id: card.id || generateId(),
      created_at: new Date().toISOString(),
    };
    state.allCreditCards = [...state.allCreditCards, newCard];
    this.saveState(state);
    return newCard;
  }

  async deleteCreditCard(id: string): Promise<void> {
    const state = this.getState();
    const exists = state.allCreditCards.some((c) => c.id === id);
    if (!exists) {
      throw new RepositoryError(`Cartão com id ${id} não encontrado`, 'NOT_FOUND', undefined, 'credit_cards');
    }
    state.allCreditCards = state.allCreditCards.filter((c) => c.id !== id);
    this.saveState(state);
  }

  async getCreditCardBills(creditCardId: string): Promise<CreditCardBill[]> {
    return this.getState().allCreditCardBills.filter((b) => b.credit_card_id === creditCardId);
  }

  // Categorias
  async getCategories(workspaceId: string): Promise<Category[]> {
    return this.getState().allCategories.filter((c) => c.workspace_id === workspaceId);
  }

  async saveCategory(category: Omit<Category, 'id' | 'created_at'> & { id?: string }): Promise<Category> {
    const state = this.getState();
    if (category.id) {
      const index = state.allCategories.findIndex((c) => c.id === category.id);
      if (index !== -1) {
        const updated: Category = {
          ...state.allCategories[index],
          ...category,
          id: category.id,
        };
        state.allCategories = [
          ...state.allCategories.slice(0, index),
          updated,
          ...state.allCategories.slice(index + 1),
        ];
        this.saveState(state);
        return updated;
      }
    }
    const newCat: Category = {
      ...category,
      id: category.id || generateId(),
      created_at: new Date().toISOString(),
    };
    state.allCategories = [...state.allCategories, newCat];
    this.saveState(state);
    return newCat;
  }

  async deleteCategory(id: string): Promise<void> {
    const state = this.getState();
    const exists = state.allCategories.some((c) => c.id === id);
    if (!exists) {
      throw new RepositoryError(`Categoria com id ${id} não encontrada`, 'NOT_FOUND', undefined, 'categories');
    }
    state.allCategories = state.allCategories.filter((c) => c.id !== id);
    this.saveState(state);
  }

  // Transações
  async getTransactions(workspaceId: string): Promise<Transaction[]> {
    return this.getState().allTransactions.filter((t) => t.workspace_id === workspaceId);
  }

  async saveTransaction(transaction: Omit<Transaction, 'id' | 'created_at'> & { id?: string }): Promise<Transaction> {
    const state = this.getState();

    // Validação de integridade de rateios
    if (transaction.splits && transaction.splits.length > 0) {
      const sum = transaction.splits.reduce((acc, s) => acc + Number(s.amount), 0);
      if (Math.abs(sum - transaction.amount) > 0.01) {
        throw new RepositoryError(
          'A soma dos rateios deve ser exatamente igual ao valor total da transação',
          'VALIDATION_FAILED',
          undefined,
          'transactions'
        );
      }
    }

    if (transaction.id) {
      const index = state.allTransactions.findIndex((t) => t.id === transaction.id);
      if (index !== -1) {
        const oldTx = state.allTransactions[index];
        const newType = transaction.type ?? oldTx.type;

        // Se o tipo mudou (expense <-> income), inverte o efeito dos pagamentos existentes nas contas bancárias
        if (newType !== oldTx.type) {
          const txPayments = state.allPayments.filter(
            (p) => p.transaction_id === transaction.id && p.affects_balance && p.account_id
          );
          for (const p of txPayments) {
            const acc = state.allAccounts.find((a) => a.id === p.account_id);
            if (acc) {
              if (newType === 'income' && oldTx.type === 'expense') {
                acc.current_balance = Number((acc.current_balance + 2 * p.amount).toFixed(2));
              } else if (newType === 'expense' && oldTx.type === 'income') {
                acc.current_balance = Number((acc.current_balance - 2 * p.amount).toFixed(2));
              }
            }
          }
        }

        const updated: Transaction = {
          ...oldTx,
          ...transaction,
          id: transaction.id,
        };
        state.allTransactions = [
          ...state.allTransactions.slice(0, index),
          updated,
          ...state.allTransactions.slice(index + 1),
        ];
        this.saveState(state);
        return updated;
      }
    }
    const newTx: Transaction = {
      ...transaction,
      id: transaction.id || generateId(),
      paid_at: transaction.status === 'paid' ? (transaction.paid_at || transaction.transaction_date) : transaction.paid_at,
      created_at: new Date().toISOString(),
    };
    state.allTransactions = [...state.allTransactions, newTx];

    // Se criada como 'paid', gera o pagamento correspondente e atualiza saldo bancário
    if (!transaction.id && transaction.status === 'paid') {
      const payment: Payment = {
        id: generateId(),
        workspace_id: transaction.workspace_id,
        transaction_id: newTx.id,
        account_id: transaction.account_id ?? null,
        payment_method_id: transaction.payment_method_id ?? null,
        amount: transaction.amount,
        payment_date: transaction.transaction_date,
        notes: transaction.notes ?? null,
        affects_balance: Boolean(transaction.account_id),
        created_at: new Date().toISOString(),
      };
      state.allPayments.push(payment);

      if (payment.affects_balance && payment.account_id) {
        const acc = state.allAccounts.find((a) => a.id === payment.account_id);
        if (acc) {
          if (transaction.type === 'income') {
            acc.current_balance = Number((acc.current_balance + payment.amount).toFixed(2));
          } else {
            acc.current_balance = Number((acc.current_balance - payment.amount).toFixed(2));
          }
        }
      }
    }

    this.saveState(state);
    return newTx;
  }

  async deleteTransaction(id: string): Promise<void> {
    const state = this.getState();
    const tx = state.allTransactions.find((t) => t.id === id);
    if (!tx) {
      throw new RepositoryError(`Transação com id ${id} não encontrada`, 'NOT_FOUND', undefined, 'transactions');
    }

    // 1. Reconciliação de fatura de cartão se vinculado
    if (tx.credit_card_bill_id) {
      const bill = state.allCreditCardBills.find((b) => b.id === tx.credit_card_bill_id);
      if (bill) {
        const newBillTotal = Number((bill.total_amount - tx.amount).toFixed(2));
        if (newBillTotal < bill.paid_amount) {
          throw new RepositoryError(
            `A exclusão da transação resulta na fatura ${bill.reference_month} com valor total (R$ ${newBillTotal}) inferior ao valor já pago nela (R$ ${bill.paid_amount})`,
            'VALIDATION_FAILED',
            undefined,
            'transactions'
          );
        }
        bill.total_amount = newBillTotal;
        const billFullyPaid = bill.paid_amount >= bill.total_amount && bill.total_amount > 0;
        if (billFullyPaid) {
          bill.status = 'paid';
          bill.paid_at = new Date().toISOString();
          for (const inst of state.allInstallments) {
            if (inst.credit_card_bill_id === bill.id) {
              inst.status = 'paid';
              inst.paid_amount = inst.amount;
              inst.paid_at = new Date().toISOString();
            }
          }
          for (const otherTx of state.allTransactions) {
            if (otherTx.credit_card_bill_id === bill.id && otherTx.id !== id) {
              otherTx.status = 'paid';
              otherTx.paid_at = new Date().toISOString();
            }
          }
        } else {
          bill.status = bill.paid_amount > 0 ? 'partially_paid' : 'open';
        }
      }
    }

    // 2. Estorno de pagamentos vinculados e ajuste de saldo
    const linkedPayments = state.allPayments.filter((p) => p.transaction_id === id);
    for (const payment of linkedPayments) {
      if (payment.affects_balance && payment.account_id) {
        const acc = state.allAccounts.find((a) => a.id === payment.account_id);
        if (acc) {
          if (tx.type === 'income') {
            acc.current_balance = Number((acc.current_balance - payment.amount).toFixed(2));
          } else {
            acc.current_balance = Number((acc.current_balance + payment.amount).toFixed(2));
          }
        }
      }
    }
    state.allPayments = state.allPayments.filter((p) => p.transaction_id !== id);

    // 3. Remove a transação
    state.allTransactions = state.allTransactions.filter((t) => t.id !== id);
    this.saveState(state);
  }

  // Compras Parceladas e Parcelas
  async getPurchases(workspaceId: string): Promise<Purchase[]> {
    return this.getState().allPurchases.filter((p) => p.workspace_id === workspaceId);
  }

  async savePurchase(purchase: Omit<Purchase, 'id' | 'created_at'> & { id?: string }): Promise<Purchase> {
    const state = this.getState();

    // Validação de integridade de rateios
    if (purchase.splits && purchase.splits.length > 0) {
      const sum = purchase.splits.reduce((acc, s) => acc + Number(s.amount), 0);
      if (Math.abs(sum - purchase.total_amount) > 0.01) {
        throw new RepositoryError(
          'A soma dos rateios deve ser exatamente igual ao valor total da compra',
          'VALIDATION_FAILED',
          undefined,
          'purchases'
        );
      }
    }

    if (purchase.id) {
      const index = state.allPurchases.findIndex((p) => p.id === purchase.id);
      if (index !== -1) {
        const oldPurchase = state.allPurchases[index];
        const newTotal = purchase.total_amount;
        if (newTotal !== oldPurchase.total_amount) {
          const purchaseInsts = state.allInstallments.filter((i) => i.purchase_id === purchase.id);
          const fullyPaidInsts = purchaseInsts.filter((i) => i.status === 'paid' || (i.paid_amount ?? 0) >= i.amount);
          const fullyPaidAmount = fullyPaidInsts.reduce((sum, i) => sum + i.amount, 0);
          const totalPaidAll = purchaseInsts.reduce((sum, i) => sum + (i.paid_amount ?? 0), 0);

          if (newTotal < totalPaidAll) {
            throw new RepositoryError(
              `O novo valor total da compra (R$ ${newTotal}) não pode ser menor do que o total já pago pelas parcelas (R$ ${totalPaidAll})`,
              'VALIDATION_FAILED',
              undefined,
              'purchases'
            );
          }
          if (fullyPaidInsts.length >= oldPurchase.installment_count) {
            throw new RepositoryError(
              'Todas as parcelas desta compra já foram quitadas e seu valor não pode ser alterado',
              'VALIDATION_FAILED',
              undefined,
              'purchases'
            );
          }

          const unpaidInsts = purchaseInsts
            .filter((i) => i.status !== 'paid' && (i.paid_amount ?? 0) < i.amount)
            .sort((a, b) => a.installment_number - b.installment_number);

          if (unpaidInsts.length > 0) {
            const remainingAmount = Number((newTotal - fullyPaidAmount).toFixed(2));
            const baseAmount = Math.floor((remainingAmount / unpaidInsts.length) * 100) / 100;
            const remainder = Number((remainingAmount - baseAmount * unpaidInsts.length).toFixed(2));
            const firstAmount = Number((baseAmount + remainder).toFixed(2));

            unpaidInsts.forEach((inst, idx) => {
              const newInstAmount = idx === 0 ? firstAmount : baseAmount;
              if (newInstAmount < (inst.paid_amount ?? 0)) {
                throw new RepositoryError(
                  `O novo valor da parcela (R$ ${newInstAmount}) não pode ser menor do que o valor já pago nela (R$ ${inst.paid_amount})`,
                  'VALIDATION_FAILED',
                  undefined,
                  'purchases'
                );
              }
              const diff = Number((newInstAmount - inst.amount).toFixed(2));
              inst.amount = newInstAmount;
              let billFullyPaid = false;

              if (inst.credit_card_bill_id && diff !== 0) {
                const bill = state.allCreditCardBills.find((b) => b.id === inst.credit_card_bill_id);
                if (bill) {
                  const newBillTotal = Number((bill.total_amount + diff).toFixed(2));
                  if (newBillTotal < bill.paid_amount) {
                    throw new RepositoryError(
                      `O novo valor da compra resulta na fatura ${bill.reference_month} com valor total (R$ ${newBillTotal}) inferior ao valor já pago nela (R$ ${bill.paid_amount})`,
                      'VALIDATION_FAILED',
                      undefined,
                      'purchases'
                    );
                  }
                  bill.total_amount = newBillTotal;
                  billFullyPaid = bill.paid_amount >= bill.total_amount && bill.total_amount > 0;
                  if (billFullyPaid) {
                    bill.status = 'paid';
                    bill.paid_at = new Date().toISOString();
                    for (const otherInst of state.allInstallments) {
                      if (otherInst.credit_card_bill_id === bill.id && otherInst.id !== inst.id) {
                        otherInst.status = 'paid';
                        otherInst.paid_amount = otherInst.amount;
                        otherInst.paid_at = new Date().toISOString();
                      }
                    }
                    for (const billTx of state.allTransactions) {
                      if (billTx.credit_card_bill_id === bill.id) {
                        billTx.status = 'paid';
                        billTx.paid_at = new Date().toISOString();
                      }
                    }
                  } else {
                    bill.status = bill.paid_amount > 0 ? 'partially_paid' : 'open';
                  }
                }
              }

              if (billFullyPaid) {
                inst.status = 'paid';
                inst.paid_amount = newInstAmount;
                inst.paid_at = new Date().toISOString();
              } else {
                inst.status = (inst.paid_amount ?? 0) >= newInstAmount && newInstAmount > 0
                  ? 'paid'
                  : (inst.paid_amount ?? 0) > 0
                    ? 'partially_paid'
                    : (inst.due_date < new Date().toISOString().slice(0, 10) ? 'overdue' : 'pending');
              }
            });
          }
        }

        const updated: Purchase = {
          ...oldPurchase,
          ...purchase,
          id: purchase.id,
        };
        state.allPurchases = [
          ...state.allPurchases.slice(0, index),
          updated,
          ...state.allPurchases.slice(index + 1),
        ];
        this.saveState(state);
        return updated;
      }
    }

    const newPurchase: Purchase = {
      ...purchase,
      id: purchase.id || generateId(),
      created_at: new Date().toISOString(),
    };
    state.allPurchases = [...state.allPurchases, newPurchase];

    // Geração automática de parcelas para novas compras se installment_count > 0
    if (!purchase.id && (purchase.installment_count ?? 1) > 0) {
      const count = purchase.installment_count ?? 1;
      const baseAmount = Math.floor((purchase.total_amount / count) * 100) / 100;
      const remainder = Number((purchase.total_amount - baseAmount * count).toFixed(2));
      const paidCount = purchase.paid_installments_count ?? 0;

      for (let i = 1; i <= count; i++) {
        const isFirst = i === 1;
        const amount = isFirst ? Number((baseAmount + remainder).toFixed(2)) : baseAmount;
        const isPaid = i <= paidCount;
        const d = new Date(purchase.purchase_date);
        d.setMonth(d.getMonth() + (i - 1));
        const dueDate = d.toISOString().split('T')[0];

        const inst: Installment = {
          id: generateId(),
          purchase_id: newPurchase.id,
          installment_number: i,
          amount,
          due_date: dueDate,
          status: isPaid ? 'paid' : 'pending',
          paid_amount: isPaid ? amount : 0,
          paid_at: isPaid ? new Date().toISOString() : null,
          created_at: new Date().toISOString(),
        };
        state.allInstallments.push(inst);
      }
    }

    this.saveState(state);
    return newPurchase;
  }

  async deletePurchase(id: string): Promise<void> {
    const state = this.getState();
    const purchase = state.allPurchases.find((p) => p.id === id);
    if (!purchase) {
      throw new RepositoryError(`Compra com id ${id} não encontrada`, 'NOT_FOUND', undefined, 'purchases');
    }

    const purchaseInsts = state.allInstallments.filter((i) => i.purchase_id === id);

    // 1. Pré-validação e ajuste das faturas de cartão vinculadas
    const billDeltas = new Map<string, number>();
    for (const inst of purchaseInsts) {
      if (inst.credit_card_bill_id) {
        const currentDelta = billDeltas.get(inst.credit_card_bill_id) || 0;
        billDeltas.set(inst.credit_card_bill_id, Number((currentDelta + inst.amount).toFixed(2)));
      }
    }

    for (const [billId, totalReduction] of billDeltas.entries()) {
      const bill = state.allCreditCardBills.find((b) => b.id === billId);
      if (bill) {
        const newBillTotal = Number((bill.total_amount - totalReduction).toFixed(2));
        if (newBillTotal < bill.paid_amount) {
          throw new RepositoryError(
            `A exclusão da compra resulta na fatura ${bill.reference_month} com valor total (R$ ${newBillTotal}) inferior ao valor já pago nela (R$ ${bill.paid_amount})`,
            'VALIDATION_FAILED',
            undefined,
            'purchases'
          );
        }
        bill.total_amount = newBillTotal;
        const billFullyPaid = bill.paid_amount >= bill.total_amount && bill.total_amount > 0;
        if (billFullyPaid) {
          bill.status = 'paid';
          bill.paid_at = new Date().toISOString();
          for (const otherInst of state.allInstallments) {
            if (otherInst.credit_card_bill_id === bill.id && otherInst.purchase_id !== id) {
              otherInst.status = 'paid';
              otherInst.paid_amount = otherInst.amount;
              otherInst.paid_at = new Date().toISOString();
            }
          }
          for (const billTx of state.allTransactions) {
            if (billTx.credit_card_bill_id === bill.id) {
              billTx.status = 'paid';
              billTx.paid_at = new Date().toISOString();
            }
          }
        } else {
          bill.status = bill.paid_amount > 0 ? 'partially_paid' : 'open';
        }
      }
    }

    // 2. Estorno de pagamentos vinculados às parcelas da compra e ajuste de saldo
    const instIds = new Set(purchaseInsts.map((i) => i.id));
    const linkedPayments = state.allPayments.filter((p) => p.installment_id && instIds.has(p.installment_id));
    for (const payment of linkedPayments) {
      if (payment.affects_balance && payment.account_id) {
        const acc = state.allAccounts.find((a) => a.id === payment.account_id);
        if (acc) {
          acc.current_balance = Number((acc.current_balance + payment.amount).toFixed(2));
        }
      }
    }
    state.allPayments = state.allPayments.filter((p) => !p.installment_id || !instIds.has(p.installment_id));

    // 3. Remove parcelas e a compra
    state.allInstallments = state.allInstallments.filter((i) => i.purchase_id !== id);
    state.allPurchases = state.allPurchases.filter((p) => p.id !== id);
    this.saveState(state);
  }

  async getInstallments(purchaseId: string): Promise<Installment[]> {
    return this.getState().allInstallments.filter((i) => i.purchase_id === purchaseId);
  }

  // Pagamentos
  async getPayments(workspaceId: string): Promise<Payment[]> {
    return this.getState().allPayments.filter((p) => p.workspace_id === workspaceId);
  }

  async savePayment(payment: Omit<Payment, 'id' | 'created_at'> & { id?: string }): Promise<Payment> {
    const state = this.getState();
    if (payment.id) {
      const index = state.allPayments.findIndex((p) => p.id === payment.id);
      if (index !== -1) {
        const oldPayment = state.allPayments[index];

        // 1. Reverte efeito antigo de saldo
        if (oldPayment.affects_balance && oldPayment.account_id) {
          const oldAcc = state.allAccounts.find((a) => a.id === oldPayment.account_id);
          if (oldAcc) {
            const oldTx = oldPayment.transaction_id ? state.allTransactions.find((t) => t.id === oldPayment.transaction_id) : null;
            if (oldTx && oldTx.type === 'income') {
              oldAcc.current_balance = Number((oldAcc.current_balance - oldPayment.amount).toFixed(2));
            } else {
              oldAcc.current_balance = Number((oldAcc.current_balance + oldPayment.amount).toFixed(2));
            }
          }
        }

        // 2. Aplica novo efeito de saldo
        if (payment.affects_balance && payment.account_id) {
          const newAcc = state.allAccounts.find((a) => a.id === payment.account_id);
          if (newAcc) {
            const targetTxId = payment.transaction_id || oldPayment.transaction_id;
            const newTx = targetTxId ? state.allTransactions.find((t) => t.id === targetTxId) : null;
            if (newTx && newTx.type === 'income') {
              newAcc.current_balance = Number((newAcc.current_balance + payment.amount).toFixed(2));
            } else {
              newAcc.current_balance = Number((newAcc.current_balance - payment.amount).toFixed(2));
            }
          }
        }

        const updated: Payment = {
          ...oldPayment,
          ...payment,
          id: payment.id,
        };
        state.allPayments = [
          ...state.allPayments.slice(0, index),
          updated,
          ...state.allPayments.slice(index + 1),
        ];

        // 3. Recalcula status e valores pagos da obrigação
        const txId = payment.transaction_id || oldPayment.transaction_id;
        if (txId) {
          const tx = state.allTransactions.find((t) => t.id === txId);
          if (tx) {
            const totalPaid = state.allPayments
              .filter((p) => p.transaction_id === txId)
              .reduce((sum, p) => sum + (p.id === payment.id ? payment.amount : p.amount), 0);
            tx.status = totalPaid >= tx.amount ? 'paid' : totalPaid > 0 ? 'partially_paid' : 'pending';
            tx.paid_at = totalPaid >= tx.amount ? payment.payment_date : null;
          }
        }

        const instId = payment.installment_id || oldPayment.installment_id;
        if (instId) {
          const inst = state.allInstallments.find((i) => i.id === instId);
          if (inst) {
            const totalPaid = state.allPayments
              .filter((p) => p.installment_id === instId)
              .reduce((sum, p) => sum + (p.id === payment.id ? payment.amount : p.amount), 0);
            inst.paid_amount = Number(totalPaid.toFixed(2));
            inst.status = totalPaid >= inst.amount ? 'paid' : totalPaid > 0 ? 'partially_paid' : 'pending';
            inst.paid_at = totalPaid >= inst.amount ? payment.payment_date : null;
          }
        }

        const billId = payment.credit_card_bill_id || oldPayment.credit_card_bill_id;
        if (billId) {
          const bill = state.allCreditCardBills.find((b) => b.id === billId);
          if (bill) {
            const totalPaid = state.allPayments
              .filter((p) => p.credit_card_bill_id === billId)
              .reduce((sum, p) => sum + (p.id === payment.id ? payment.amount : p.amount), 0);
            bill.paid_amount = Number(totalPaid.toFixed(2));
            bill.status = totalPaid >= bill.total_amount && bill.total_amount > 0 ? 'paid' : totalPaid > 0 ? 'partially_paid' : 'open';
            bill.paid_at = totalPaid >= bill.total_amount && bill.total_amount > 0 ? payment.payment_date : null;

            if (bill.status === 'paid') {
              state.allTransactions.forEach((t) => {
                if (t.credit_card_bill_id === bill.id) {
                  t.status = 'paid';
                  t.paid_at = payment.payment_date;
                }
              });
              state.allInstallments.forEach((i) => {
                if (i.credit_card_bill_id === bill.id) {
                  i.status = 'paid';
                  i.paid_amount = i.amount;
                  i.paid_at = payment.payment_date;
                }
              });
            } else {
              state.allTransactions.forEach((t) => {
                if (t.credit_card_bill_id === bill.id) {
                  t.status = 'pending';
                  t.paid_at = null;
                }
              });
              state.allInstallments.forEach((i) => {
                if (i.credit_card_bill_id === bill.id) {
                  i.status = 'pending';
                  i.paid_amount = 0;
                  i.paid_at = null;
                }
              });
            }
          }
        }

        this.saveState(state);
        return updated;
      }
    }

    const newPayment: Payment = {
      ...payment,
      id: payment.id || generateId(),
      created_at: new Date().toISOString(),
    };

    // Ajusta saldo bancário se affects_balance for true (distingue receita e despesa)
    if (payment.affects_balance && payment.account_id) {
      const acc = state.allAccounts.find((a) => a.id === payment.account_id);
      if (acc) {
        const tx = payment.transaction_id ? state.allTransactions.find((t) => t.id === payment.transaction_id) : null;
        if (tx && tx.type === 'income') {
          acc.current_balance = Number((acc.current_balance + payment.amount).toFixed(2));
        } else {
          acc.current_balance = Number((acc.current_balance - payment.amount).toFixed(2));
        }
      }
    }

    // Atualiza status/valor pago da obrigação associada
    if (payment.transaction_id) {
      const tx = state.allTransactions.find((t) => t.id === payment.transaction_id);
      if (tx) {
        tx.status = 'paid';
        tx.paid_at = payment.payment_date;
      }
    }

    if (payment.installment_id) {
      const inst = state.allInstallments.find((i) => i.id === payment.installment_id);
      if (inst) {
        inst.paid_amount = Number(((inst.paid_amount ?? 0) + payment.amount).toFixed(2));
        if (inst.paid_amount >= inst.amount) {
          inst.status = 'paid';
          inst.paid_at = payment.payment_date;
        } else {
          inst.status = 'partially_paid';
        }
      }
    }

    if (payment.credit_card_bill_id) {
      const bill = state.allCreditCardBills.find((b) => b.id === payment.credit_card_bill_id);
      if (bill) {
        bill.paid_amount = Number(((bill.paid_amount ?? 0) + payment.amount).toFixed(2));
        if (bill.paid_amount >= bill.total_amount && bill.total_amount > 0) {
          bill.status = 'paid';
          bill.paid_at = payment.payment_date;

          state.allTransactions.forEach((t) => {
            if (t.credit_card_bill_id === bill.id) {
              t.status = 'paid';
              t.paid_at = payment.payment_date;
            }
          });
          state.allInstallments.forEach((i) => {
            if (i.credit_card_bill_id === bill.id) {
              i.status = 'paid';
              i.paid_amount = i.amount;
              i.paid_at = payment.payment_date;
            }
          });
        } else {
          bill.status = 'partially_paid';
        }
      }
    }

    state.allPayments = [...state.allPayments, newPayment];
    this.saveState(state);
    return newPayment;
  }

  async deletePayment(id: string): Promise<void> {
    const state = this.getState();
    const payment = state.allPayments.find((p) => p.id === id);
    if (!payment) {
      throw new RepositoryError(`Pagamento com id ${id} não encontrado`, 'NOT_FOUND', undefined, 'payments');
    }

    // Reverte saldo bancário se afetava saldo (distingue receita de despesa)
    if (payment.affects_balance && payment.account_id) {
      const acc = state.allAccounts.find((a) => a.id === payment.account_id);
      if (acc) {
        const tx = payment.transaction_id ? state.allTransactions.find((t) => t.id === payment.transaction_id) : null;
        if (tx && tx.type === 'income') {
          acc.current_balance = Number((acc.current_balance - payment.amount).toFixed(2));
        } else {
          acc.current_balance = Number((acc.current_balance + payment.amount).toFixed(2));
        }
      }
    }

    // Reverte status/valor pago da obrigação associada recalculando pagamentos restantes
    if (payment.transaction_id) {
      const tx = state.allTransactions.find((t) => t.id === payment.transaction_id);
      if (tx) {
        const remaining = state.allPayments
          .filter((p) => p.transaction_id === tx.id && p.id !== id)
          .reduce((sum, p) => sum + p.amount, 0);
        tx.status = remaining >= tx.amount ? 'paid' : remaining > 0 ? 'partially_paid' : 'pending';
        if (remaining < tx.amount) {
          tx.paid_at = null;
        }
      }
    }

    if (payment.installment_id) {
      const inst = state.allInstallments.find((i) => i.id === payment.installment_id);
      if (inst) {
        const remaining = state.allPayments
          .filter((p) => p.installment_id === inst.id && p.id !== id)
          .reduce((sum, p) => sum + p.amount, 0);
        inst.paid_amount = Number(remaining.toFixed(2));
        inst.status = remaining >= inst.amount ? 'paid' : remaining > 0 ? 'partially_paid' : 'pending';
        if (remaining < inst.amount) {
          inst.paid_at = null;
        }
      }
    }

    if (payment.credit_card_bill_id) {
      const bill = state.allCreditCardBills.find((b) => b.id === payment.credit_card_bill_id);
      if (bill) {
        const remaining = state.allPayments
          .filter((p) => p.credit_card_bill_id === bill.id && p.id !== id)
          .reduce((sum, p) => sum + p.amount, 0);
        bill.paid_amount = Number(remaining.toFixed(2));
        bill.status = remaining >= bill.total_amount && bill.total_amount > 0 ? 'paid' : remaining > 0 ? 'partially_paid' : 'open';
        if (bill.status !== 'paid') {
          bill.paid_at = null;
          state.allTransactions.forEach((t) => {
            if (t.credit_card_bill_id === bill.id) {
              t.status = 'pending';
              t.paid_at = null;
            }
          });
          state.allInstallments.forEach((i) => {
            if (i.credit_card_bill_id === bill.id) {
              i.status = 'pending';
              i.paid_amount = 0;
              i.paid_at = null;
            }
          });
        }
      }
    }

    state.allPayments = state.allPayments.filter((p) => p.id !== id);
    this.saveState(state);
  }

  // Transferências
  async getTransfers(workspaceId: string): Promise<Transfer[]> {
    return this.getState().allTransfers.filter((t) => t.workspace_id === workspaceId);
  }

  async saveTransfer(transfer: Omit<Transfer, 'id' | 'created_at'> & { id?: string }): Promise<Transfer> {
    const state = this.getState();
    if (transfer.id) {
      const index = state.allTransfers.findIndex((t) => t.id === transfer.id);
      if (index !== -1) {
        const oldTransfer = state.allTransfers[index];

        const oldFromAcc = state.allAccounts.find((a) => a.id === oldTransfer.from_account_id);
        const oldToAcc = state.allAccounts.find((a) => a.id === oldTransfer.to_account_id);

        const newFromAccId = transfer.from_account_id || oldTransfer.from_account_id;
        const newToAccId = transfer.to_account_id || oldTransfer.to_account_id;
        const newAmount = transfer.amount ?? oldTransfer.amount;

        const newFromAcc = state.allAccounts.find((a) => a.id === newFromAccId);
        const newToAcc = state.allAccounts.find((a) => a.id === newToAccId);

        if (!newFromAcc || !newToAcc || !oldFromAcc || !oldToAcc) {
          throw new RepositoryError(
            'Conta de origem ou destino não encontrada',
            'NOT_FOUND',
            undefined,
            'transfers'
          );
        }

        // 1. Reverte saldos antigos
        oldFromAcc.current_balance = Number((oldFromAcc.current_balance + oldTransfer.amount).toFixed(2));
        oldToAcc.current_balance = Number((oldToAcc.current_balance - oldTransfer.amount).toFixed(2));

        // 2. Aplica novos saldos
        newFromAcc.current_balance = Number((newFromAcc.current_balance - newAmount).toFixed(2));
        newToAcc.current_balance = Number((newToAcc.current_balance + newAmount).toFixed(2));

        const updated: Transfer = {
          ...oldTransfer,
          ...transfer,
          id: transfer.id,
        };
        state.allTransfers = [
          ...state.allTransfers.slice(0, index),
          updated,
          ...state.allTransfers.slice(index + 1),
        ];
        this.saveState(state);
        return updated;
      }
    }

    const fromAcc = state.allAccounts.find((a) => a.id === transfer.from_account_id);
    const toAcc = state.allAccounts.find((a) => a.id === transfer.to_account_id);
    if (!fromAcc || !toAcc) {
      throw new RepositoryError(
        'Conta de origem ou destino não encontrada',
        'NOT_FOUND',
        undefined,
        'transfers'
      );
    }

    // Debita origem e credita destino
    fromAcc.current_balance = Number((fromAcc.current_balance - transfer.amount).toFixed(2));
    toAcc.current_balance = Number((toAcc.current_balance + transfer.amount).toFixed(2));

    const newTransfer: Transfer = {
      ...transfer,
      id: transfer.id || generateId(),
      created_at: new Date().toISOString(),
    };
    state.allTransfers = [...state.allTransfers, newTransfer];
    this.saveState(state);
    return newTransfer;
  }

  async deleteTransfer(id: string): Promise<void> {
    const state = this.getState();
    const transfer = state.allTransfers.find((t) => t.id === id);
    if (!transfer) {
      throw new RepositoryError(`Transferência com id ${id} não encontrada`, 'NOT_FOUND', undefined, 'transfers');
    }

    // Reverte saldos: credita origem e debita destino
    const fromAcc = state.allAccounts.find((a) => a.id === transfer.from_account_id);
    const toAcc = state.allAccounts.find((a) => a.id === transfer.to_account_id);
    if (fromAcc) {
      fromAcc.current_balance = Number((fromAcc.current_balance + transfer.amount).toFixed(2));
    }
    if (toAcc) {
      toAcc.current_balance = Number((toAcc.current_balance - transfer.amount).toFixed(2));
    }

    state.allTransfers = state.allTransfers.filter((t) => t.id !== id);
    this.saveState(state);
  }

  // Transações Recorrentes
  async getRecurring(workspaceId: string): Promise<RecurringTransaction[]> {
    return this.getState().allRecurring.filter((r) => r.workspace_id === workspaceId);
  }

  async saveRecurring(recurring: Omit<RecurringTransaction, 'id' | 'created_at'> & { id?: string }): Promise<RecurringTransaction> {
    const state = this.getState();
    if (recurring.id) {
      const index = state.allRecurring.findIndex((r) => r.id === recurring.id);
      if (index !== -1) {
        const updated: RecurringTransaction = {
          ...state.allRecurring[index],
          ...recurring,
          id: recurring.id,
        };
        state.allRecurring = [
          ...state.allRecurring.slice(0, index),
          updated,
          ...state.allRecurring.slice(index + 1),
        ];
        this.saveState(state);
        return updated;
      }
    }
    const newRec: RecurringTransaction = {
      ...recurring,
      id: recurring.id || generateId(),
      created_at: new Date().toISOString(),
    };
    state.allRecurring = [...state.allRecurring, newRec];
    this.saveState(state);
    return newRec;
  }

  async deleteRecurring(id: string): Promise<void> {
    const state = this.getState();
    const exists = state.allRecurring.some((r) => r.id === id);
    if (!exists) {
      throw new RepositoryError(`Recorrência com id ${id} não encontrada`, 'NOT_FOUND', undefined, 'recurring_transactions');
    }
    state.allRecurring = state.allRecurring.filter((r) => r.id !== id);
    this.saveState(state);
  }

  // Orçamentos e Metas
  async getBudgets(workspaceId: string): Promise<Budget[]> {
    return this.getState().allBudgets.filter((b) => b.workspace_id === workspaceId);
  }

  async saveBudget(budget: Omit<Budget, 'id'> & { id?: string }): Promise<Budget> {
    const state = this.getState();
    if (budget.id) {
      const index = state.allBudgets.findIndex((b) => b.id === budget.id);
      if (index !== -1) {
        const updated: Budget = {
          ...state.allBudgets[index],
          ...budget,
          id: budget.id,
        };
        state.allBudgets = [
          ...state.allBudgets.slice(0, index),
          updated,
          ...state.allBudgets.slice(index + 1),
        ];
        this.saveState(state);
        return updated;
      }
    }
    const newBudget: Budget = {
      ...budget,
      id: budget.id || generateId(),
    };
    state.allBudgets = [...state.allBudgets, newBudget];
    this.saveState(state);
    return newBudget;
  }

  async deleteBudget(id: string): Promise<void> {
    const state = this.getState();
    const exists = state.allBudgets.some((b) => b.id === id);
    if (!exists) {
      throw new RepositoryError(`Orçamento com id ${id} não encontrado`, 'NOT_FOUND', undefined, 'budgets');
    }
    state.allBudgets = state.allBudgets.filter((b) => b.id !== id);
    this.saveState(state);
  }

  async getGoals(workspaceId: string): Promise<FinancialGoal[]> {
    return this.getState().allGoals.filter((g) => g.workspace_id === workspaceId);
  }

  async saveGoal(goal: Omit<FinancialGoal, 'id' | 'created_at'> & { id?: string }): Promise<FinancialGoal> {
    const state = this.getState();
    if (goal.id) {
      const index = state.allGoals.findIndex((g) => g.id === goal.id);
      if (index !== -1) {
        const updated: FinancialGoal = {
          ...state.allGoals[index],
          ...goal,
          id: goal.id,
        };
        state.allGoals = [
          ...state.allGoals.slice(0, index),
          updated,
          ...state.allGoals.slice(index + 1),
        ];
        this.saveState(state);
        return updated;
      }
    }
    const newGoal: FinancialGoal = {
      ...goal,
      id: goal.id || generateId(),
      created_at: new Date().toISOString(),
    };
    state.allGoals = [...state.allGoals, newGoal];
    this.saveState(state);
    return newGoal;
  }

  async deleteGoal(id: string): Promise<void> {
    const state = this.getState();
    const exists = state.allGoals.some((g) => g.id === id);
    if (!exists) {
      throw new RepositoryError(`Meta com id ${id} não encontrada`, 'NOT_FOUND', undefined, 'financial_goals');
    }
    state.allGoals = state.allGoals.filter((g) => g.id !== id);
    this.saveState(state);
  }

  // Acertos entre Membros (Settlements)
  async getSettlements(workspaceId: string): Promise<Settlement[]> {
    return this.getState().allSettlements.filter((s) => s.workspace_id === workspaceId);
  }

  async saveSettlement(settlement: Omit<Settlement, 'id' | 'created_at'> & { id?: string }): Promise<Settlement> {
    const state = this.getState();
    if (settlement.id) {
      const index = state.allSettlements.findIndex((s) => s.id === settlement.id);
      if (index !== -1) {
        const updated: Settlement = {
          ...state.allSettlements[index],
          ...settlement,
          id: settlement.id,
        };
        state.allSettlements = [
          ...state.allSettlements.slice(0, index),
          updated,
          ...state.allSettlements.slice(index + 1),
        ];
        this.saveState(state);
        return updated;
      }
    }
    const newSettlement: Settlement = {
      ...settlement,
      id: settlement.id || generateId(),
      created_at: new Date().toISOString(),
    };
    state.allSettlements = [...state.allSettlements, newSettlement];
    this.saveState(state);
    return newSettlement;
  }

  async deleteSettlement(id: string): Promise<void> {
    const state = this.getState();
    const exists = state.allSettlements.some((s) => s.id === id);
    if (!exists) {
      throw new RepositoryError(`Acerto com id ${id} não encontrado`, 'NOT_FOUND', undefined, 'settlements');
    }
    state.allSettlements = state.allSettlements.filter((s) => s.id !== id);
    this.saveState(state);
  }
}
