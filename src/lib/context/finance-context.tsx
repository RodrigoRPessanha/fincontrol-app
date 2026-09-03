'use client';

import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
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
  Transaction,
  Transfer,
  UpdateTransactionDTO,
  Workspace,
  WorkspaceMember,
} from '../types';
import {
  mockAccounts,
  mockBudgets,
  mockCategories,
  mockCreditCardBills,
  mockCreditCards,
  mockGoals,
  mockInstallments,
  mockPaymentMethods,
  mockPayments,
  mockPurchases,
  mockRecurring,
  mockTransactions,
  mockWorkspaceMembers,
  mockWorkspaces,
} from '../mock-data';
import {
  calculateCardBillDates,
  splitInstallments,
  getActualDaysInMonth,
  isValidCustomInterval,
  validateCreditCardResolution,
  validateTransactionBusinessRules,
  validateBilledTransactionDateImmutability,
  sanitizeLegacyRecurringState,
  validateRecurringAmount,
  resolveTransactionAccountId,
  validateBillPaymentAccount,
  validateRecurringMaterialization,
  stepNextOccurrence,
  calculateCatchUpOccurrence,
  validateCategoryActive,
  validateTransactionAccount,
} from '../financial-engine';
import { format, parseISO, addDays } from 'date-fns';

interface FinanceContextType {
  isLoaded: boolean;
  workspaces: Workspace[];
  activeWorkspace: Workspace;
  workspaceMembers: WorkspaceMember[];
  setActiveWorkspaceId: (id: string) => void;
  createWorkspace: (name: string) => Workspace;
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
  payCreditCardBill: (billId: string, accountId: string, amount: number, paymentDate?: string, notes?: string) => Payment;

  paymentMethods: PaymentMethod[];
  allWorkspacePaymentMethods: PaymentMethod[];
  addPaymentMethod: (pm: Omit<PaymentMethod, 'id' | 'workspace_id' | 'created_at'>) => PaymentMethod;

  categories: Category[];
  allWorkspaceCategories: Category[];
  addCategory: (cat: Omit<Category, 'id' | 'workspace_id' | 'created_at'>) => Category;
  updateCategory: (id: string, cat: Omit<Partial<Category>, 'id' | 'workspace_id' | 'created_at'>) => void;

  transactions: Transaction[];
  addTransaction: (tx: Omit<Transaction, 'id' | 'workspace_id' | 'created_at'>) => Transaction;
  updateTransaction: (id: string, tx: UpdateTransactionDTO) => void;
  deleteTransaction: (id: string) => void;
  duplicateTransaction: (id: string) => Transaction | null;

  purchases: Purchase[];
  installments: Installment[];
  createInstallmentPurchase: (data: {
    description: string;
    total_amount: number;
    installment_count: number;
    purchase_date: string;
    credit_card_id?: string;
    category_id?: string;
    account_id?: string;
    payment_method_id?: string;
    paid_installments_count?: number;
  }) => Purchase;

  payments: Payment[];
  recordPayment: (data: {
    transaction_id?: string;
    installment_id?: string;
    credit_card_bill_id?: string;
    account_id: string;
    payment_method_id?: string;
    amount: number;
    payment_date: string;
    notes?: string;
  }) => Payment;

  transfers: Transfer[];
  createTransfer: (fromAccountId: string, toAccountId: string, amount: number, date?: string, notes?: string) => Transfer | null;

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

  viewPerspective: 'realized' | 'planned';
  setViewPerspective: (p: 'realized' | 'planned') => void;
}

const FinanceContext = createContext<FinanceContextType | undefined>(undefined);

const STORAGE_PREFIX = 'fincontrol_v2_';

function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
}

export function FinanceProvider({ children }: { children: React.ReactNode }) {
  const [isLoaded, setIsLoaded] = useState(false);

  const [allWorkspaces, setAllWorkspaces] = useState<Workspace[]>(mockWorkspaces);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(mockWorkspaces[0].id);
  const [allWorkspaceMembers, setAllWorkspaceMembers] = useState<WorkspaceMember[]>(mockWorkspaceMembers);
  const [allAccounts, setAllAccounts] = useState<Account[]>(mockAccounts);
  const [allCreditCards, setAllCreditCards] = useState<CreditCard[]>(mockCreditCards);
  const [allCreditCardBills, setAllCreditCardBills] = useState<CreditCardBill[]>(mockCreditCardBills);
  const [allPaymentMethods, setAllPaymentMethods] = useState<PaymentMethod[]>(mockPaymentMethods);
  const [allCategories, setAllCategories] = useState<Category[]>(mockCategories);
  const [allTransactions, setAllTransactions] = useState<Transaction[]>(mockTransactions);
  const [allPurchases, setAllPurchases] = useState<Purchase[]>(mockPurchases);
  const [allInstallments, setAllInstallments] = useState<Installment[]>(mockInstallments);
  const [allPayments, setAllPayments] = useState<Payment[]>(mockPayments);
  const [allTransfers, setAllTransfers] = useState<Transfer[]>([]);
  const [allRecurring, setAllRecurring] = useState<RecurringTransaction[]>(mockRecurring);
  const [allBudgets, setAllBudgets] = useState<Budget[]>(mockBudgets);
  const [allGoals, setAllGoals] = useState<FinancialGoal[]>(mockGoals);

  const [viewPerspective, setViewPerspective] = useState<'realized' | 'planned'>('realized');

  // Carregamento Determinístico Seguro no Mount + Saneamento Idempotente de Dados Legados V20 (P0-01)
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const savedWs = localStorage.getItem(`${STORAGE_PREFIX}workspaces`);
        const savedActiveWs = localStorage.getItem(`${STORAGE_PREFIX}active_ws`);
        const savedMembers = localStorage.getItem(`${STORAGE_PREFIX}members`);
        const savedAccounts = localStorage.getItem(`${STORAGE_PREFIX}accounts`);
        const savedCards = localStorage.getItem(`${STORAGE_PREFIX}creditCards`);
        const savedBills = localStorage.getItem(`${STORAGE_PREFIX}bills`);
        const savedPms = localStorage.getItem(`${STORAGE_PREFIX}paymentMethods`);
        const savedCats = localStorage.getItem(`${STORAGE_PREFIX}categories`);
        const savedTxs = localStorage.getItem(`${STORAGE_PREFIX}transactions`);
        const savedPurchases = localStorage.getItem(`${STORAGE_PREFIX}purchases`);
        const savedInsts = localStorage.getItem(`${STORAGE_PREFIX}installments`);
        const savedPays = localStorage.getItem(`${STORAGE_PREFIX}payments`);
        const savedTransfers = localStorage.getItem(`${STORAGE_PREFIX}transfers`);
        const savedRecs = localStorage.getItem(`${STORAGE_PREFIX}recurring`);
        const savedBudgets = localStorage.getItem(`${STORAGE_PREFIX}budgets`);
        const savedGoals = localStorage.getItem(`${STORAGE_PREFIX}goals`);

        if (savedWs) setAllWorkspaces(JSON.parse(savedWs));
        if (savedActiveWs) setActiveWorkspaceId(savedActiveWs);
        if (savedMembers) setAllWorkspaceMembers(JSON.parse(savedMembers));
        if (savedAccounts) setAllAccounts(JSON.parse(savedAccounts));
        if (savedCards) setAllCreditCards(JSON.parse(savedCards));
        if (savedBills) setAllCreditCardBills(JSON.parse(savedBills));
        const loadedPms: PaymentMethod[] = savedPms ? JSON.parse(savedPms) : mockPaymentMethods;
        if (savedPms) setAllPaymentMethods(loadedPms);
        if (savedCats) setAllCategories(JSON.parse(savedCats));
        if (savedTxs) setAllTransactions(JSON.parse(savedTxs));
        if (savedPurchases) setAllPurchases(JSON.parse(savedPurchases));
        if (savedInsts) setAllInstallments(JSON.parse(savedInsts));
        if (savedPays) setAllPayments(JSON.parse(savedPays));
        if (savedTransfers) setAllTransfers(JSON.parse(savedTransfers));

        // Saneamento idempotente de dados legados V20 (P0-01)
        const rawRecs: RecurringTransaction[] = savedRecs ? JSON.parse(savedRecs) : mockRecurring;
        const { sanitized: cleanRecs } = sanitizeLegacyRecurringState(rawRecs, loadedPms);
        setAllRecurring(cleanRecs);

        if (savedBudgets) setAllBudgets(JSON.parse(savedBudgets));
        if (savedGoals) setAllGoals(JSON.parse(savedGoals));
      } catch (e) {
        console.error('Erro ao hidratar dados locais:', e);
      } finally {
        setIsLoaded(true);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // Sincronização com LocalStorage (SOMENTE após isLoaded = true para proteger dados persistidos)
  useEffect(() => {
    if (!isLoaded || typeof window === 'undefined') return;
    localStorage.setItem(`${STORAGE_PREFIX}workspaces`, JSON.stringify(allWorkspaces));
    localStorage.setItem(`${STORAGE_PREFIX}active_ws`, activeWorkspaceId);
    localStorage.setItem(`${STORAGE_PREFIX}members`, JSON.stringify(allWorkspaceMembers));
    localStorage.setItem(`${STORAGE_PREFIX}accounts`, JSON.stringify(allAccounts));
    localStorage.setItem(`${STORAGE_PREFIX}creditCards`, JSON.stringify(allCreditCards));
    localStorage.setItem(`${STORAGE_PREFIX}bills`, JSON.stringify(allCreditCardBills));
    localStorage.setItem(`${STORAGE_PREFIX}paymentMethods`, JSON.stringify(allPaymentMethods));
    localStorage.setItem(`${STORAGE_PREFIX}categories`, JSON.stringify(allCategories));
    localStorage.setItem(`${STORAGE_PREFIX}transactions`, JSON.stringify(allTransactions));
    localStorage.setItem(`${STORAGE_PREFIX}purchases`, JSON.stringify(allPurchases));
    localStorage.setItem(`${STORAGE_PREFIX}installments`, JSON.stringify(allInstallments));
    localStorage.setItem(`${STORAGE_PREFIX}payments`, JSON.stringify(allPayments));
    localStorage.setItem(`${STORAGE_PREFIX}transfers`, JSON.stringify(allTransfers));
    localStorage.setItem(`${STORAGE_PREFIX}recurring`, JSON.stringify(allRecurring));
    localStorage.setItem(`${STORAGE_PREFIX}budgets`, JSON.stringify(allBudgets));
    localStorage.setItem(`${STORAGE_PREFIX}goals`, JSON.stringify(allGoals));
  }, [
    isLoaded,
    allWorkspaces,
    activeWorkspaceId,
    allWorkspaceMembers,
    allAccounts,
    allCreditCards,
    allCreditCardBills,
    allPaymentMethods,
    allCategories,
    allTransactions,
    allPurchases,
    allInstallments,
    allPayments,
    allTransfers,
    allRecurring,
    allBudgets,
    allGoals,
  ]);

  // Helper SÍNCRONO E DETERMINÍSTICO para obter ou criar fatura e somar montante
  const getOrCreateAndAddItemToBill = useCallback(
    (
      cardId: string,
      referenceMonth: string,
      closingDate: string,
      dueDate: string,
      amount: number,
      wsId?: string,
      isPaid: boolean = false
    ): string => {
      const targetWsId = wsId || activeWorkspaceId;
      const targetBillId = `bill-${cardId}-${referenceMonth}`;

      setAllCreditCardBills((prev) => {
        const existingIndex = prev.findIndex(
          (b) =>
            b.credit_card_id === cardId &&
            b.reference_month === referenceMonth &&
            b.workspace_id === targetWsId
        );

        if (existingIndex >= 0) {
          return prev.map((b, idx) => {
            if (idx === existingIndex) {
              const newTotal = b.total_amount + amount;
              const newPaid = isPaid ? (b.paid_amount || 0) + amount : (b.paid_amount || 0);
              const fullyPaid = newPaid >= newTotal && newTotal > 0;
              return {
                ...b,
                total_amount: newTotal,
                paid_amount: newPaid,
                status: fullyPaid ? 'paid' : newPaid > 0 ? 'partially_paid' : b.status,
                paid_at: fullyPaid ? dueDate : null,
              };
            }
            return b;
          });
        } else {
          const newBill: CreditCardBill = {
            id: targetBillId,
            credit_card_id: cardId,
            workspace_id: targetWsId,
            reference_month: referenceMonth,
            closing_date: closingDate,
            due_date: dueDate,
            total_amount: amount,
            paid_amount: isPaid ? amount : 0,
            status: isPaid ? 'paid' : 'open',
            paid_at: isPaid ? dueDate : null,
            created_at: new Date().toISOString(),
          };
          return [...prev, newBill];
        }
      });

      return targetBillId;
    },
    [activeWorkspaceId]
  );

  // Helper centralizado para validar categoria/subcategoria ativa e de mesmo workspace
  const validateActiveCategory = useCallback(
    (workspaceId: string, categoryId?: string | null) => {
      if (!categoryId) return;
      const parent = allCategories.find(
        (c) =>
          (c.id === categoryId || c.subcategories?.some((s) => s.id === categoryId)) &&
          c.workspace_id === workspaceId
      );
      if (!parent) {
        throw new Error('Categoria informada não pertence ao workspace.');
      }
      if (parent.active === false) {
        throw new Error('A categoria informada está inativa.');
      }
      if (parent.id !== categoryId) {
        const sub = parent.subcategories?.find((s) => s.id === categoryId);
        if (sub && sub.active === false) {
          throw new Error('A subcategoria informada está inativa.');
        }
      }
    },
    [allCategories]
  );

  // Helper centralizado para inferir, validar coerência e status ativo de cartão de crédito
  // Helper centralizado para inferir, validar coerência e status ativo de cartão de crédito
  const resolveAndValidateCreditCard = useCallback(
    (workspaceId: string, pmId?: string | null, explicitCardId?: string | null): string | null => {
      return validateCreditCardResolution(
        workspaceId,
        allPaymentMethods,
        allCreditCards,
        allAccounts,
        pmId,
        explicitCardId
      );
    },
    [allPaymentMethods, allCreditCards, allAccounts]
  );

  // Processamento Reativo de Recorrências sem Loops com Desativação Semântica e Resolução de Cartão
  const processPendingRecurring = useCallback(() => {
    if (!isLoaded) return;
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    let hasRecurringChanges = false;
    let updatedRecurring = [...allRecurring];
    let newTransactions: Transaction[] = [];

    // 1. Passagem de desativação semântica para qualquer série cujo next_occurrence já ultrapassou end_date
    updatedRecurring = updatedRecurring.map((r) => {
      if (r.active && r.end_date && r.next_occurrence > r.end_date) {
        hasRecurringChanges = true;
        return { ...r, active: false };
      }
      return r;
    });

    const recurringToProcess = updatedRecurring.filter(
      (r) => r.active && r.auto_create && r.next_occurrence <= todayStr && (!r.end_date || r.next_occurrence <= r.end_date)
    );

    if (recurringToProcess.length > 0) {
      const processedSet = new Set(
        allTransactions.map((t) => `${t.recurring_transaction_id || ''}:${t.transaction_date}`)
      );

      for (const rec of recurringToProcess) {
        let currOccurrence = rec.next_occurrence;
        let iterations = 0;
        let shouldDeactivate = false;

        // Validação pura de integridade e regras de negócio para materialização (P1-01 V25)
        const validation = validateRecurringMaterialization(
          rec,
          allAccounts,
          allPaymentMethods,
          allCreditCards,
          allCategories,
          rec.workspace_id
        );

        if (!validation.isValid) {
          shouldDeactivate = true;
          hasRecurringChanges = true;
          updatedRecurring = updatedRecurring.map((r) =>
            r.id === rec.id ? { ...r, active: false, suspended_reason: validation.reason } : r
          );
          continue;
        }

        const effectiveCardId = validation.effectiveCardId || null;

        while (
          currOccurrence <= todayStr &&
          (!rec.end_date || currOccurrence <= rec.end_date) &&
          iterations < 120
        ) {
          iterations++;
          const itemKey = `${rec.id}:${currOccurrence}`;

          if (!processedSet.has(itemKey)) {
            let billId: string | null = null;
            let calculatedDueDate = currOccurrence;

            if (effectiveCardId) {
              const card = allCreditCards.find((c) => c.id === effectiveCardId && c.workspace_id === rec.workspace_id);
              if (card) {
                const billDates = calculateCardBillDates(currOccurrence, card.closing_day, card.due_day);
                billId = getOrCreateAndAddItemToBill(
                  card.id,
                  billDates.referenceMonth,
                  billDates.closingDate,
                  billDates.dueDate,
                  rec.amount,
                  rec.workspace_id
                );
                calculatedDueDate = billDates.dueDate;
              }
            }

            const newTx: Transaction = {
              id: generateId('tx-rec'),
              workspace_id: rec.workspace_id,
              account_id: rec.account_id,
              category_id: rec.category_id,
              payment_method_id: rec.payment_method_id,
              credit_card_id: effectiveCardId || undefined,
              credit_card_bill_id: billId,
              recurring_transaction_id: rec.id,
              description: rec.description,
              amount: rec.amount,
              type: rec.type,
              transaction_date: currOccurrence,
              due_date: calculatedDueDate,
              status: 'pending',
              paid_amount: 0,
              created_at: new Date().toISOString(),
            };
            newTransactions.push(newTx);
            processedSet.add(itemKey);
            hasRecurringChanges = true;
          }

          const nextStep = stepNextOccurrence(currOccurrence, rec.start_date, rec.frequency, rec.interval_days);
          if (rec.end_date && nextStep > rec.end_date) {
            shouldDeactivate = true;
            currOccurrence = nextStep;
            break;
          }
          currOccurrence = nextStep;
        }

        if (rec.next_occurrence !== currOccurrence || shouldDeactivate) {
          hasRecurringChanges = true;
          updatedRecurring = updatedRecurring.map((r) =>
            r.id === rec.id
              ? {
                  ...r,
                  next_occurrence: currOccurrence,
                  active: shouldDeactivate ? false : r.active,
                }
              : r
          );
        }
      }

      if (newTransactions.length > 0) {
        setAllTransactions((prev) => [...newTransactions, ...prev]);
      }
    }

    if (hasRecurringChanges) {
      setAllRecurring(updatedRecurring);
    }
  }, [isLoaded, allRecurring, allTransactions, allCreditCards, allAccounts, allPaymentMethods, allCategories, getOrCreateAndAddItemToBill]);

  // Executa processamento de recorrências SOMENTE após a conclusão da hidratação local (P1-02 V22/V23)
  useEffect(() => {
    if (!isLoaded) return;
    const timer = setTimeout(() => {
      processPendingRecurring();
    }, 0);
    return () => clearTimeout(timer);
  }, [isLoaded, processPendingRecurring]);

  const activeWorkspace = allWorkspaces.find((w) => w.id === activeWorkspaceId) || allWorkspaces[0] || mockWorkspaces[0];

  // ==============================================================================
  // ISOLAMENTO ESTRITO POR WORKSPACE
  // ==============================================================================
  const accounts = useMemo(
    () => allAccounts.filter((a) => a.workspace_id === activeWorkspace.id && a.active !== false),
    [allAccounts, activeWorkspace.id]
  );

  const allWorkspaceAccounts = useMemo(
    () => allAccounts.filter((a) => a.workspace_id === activeWorkspace.id),
    [allAccounts, activeWorkspace.id]
  );

  const creditCards = useMemo(
    () => allCreditCards.filter((c) => c.workspace_id === activeWorkspace.id && c.active !== false),
    [allCreditCards, activeWorkspace.id]
  );

  const allWorkspaceCreditCards = useMemo(
    () => allCreditCards.filter((c) => c.workspace_id === activeWorkspace.id),
    [allCreditCards, activeWorkspace.id]
  );

  const creditCardBills = useMemo(
    () =>
      allCreditCardBills
        .filter((b) => b.workspace_id === activeWorkspace.id)
        .sort((a, b) => b.reference_month.localeCompare(a.reference_month)),
    [allCreditCardBills, activeWorkspace.id]
  );

  const paymentMethods = useMemo(
    () => allPaymentMethods.filter((p) => p.workspace_id === activeWorkspace.id && p.active !== false),
    [allPaymentMethods, activeWorkspace.id]
  );

  const allWorkspacePaymentMethods = useMemo(
    () => allPaymentMethods.filter((p) => p.workspace_id === activeWorkspace.id),
    [allPaymentMethods, activeWorkspace.id]
  );

  const categories = useMemo(
    () =>
      allCategories
        .filter((c) => c.workspace_id === activeWorkspace.id && c.active !== false)
        .map((c) => ({
          ...c,
          subcategories: c.subcategories ? c.subcategories.filter((s) => s.active !== false) : undefined,
        })),
    [allCategories, activeWorkspace.id]
  );

  const allWorkspaceCategories = useMemo(
    () => allCategories.filter((c) => c.workspace_id === activeWorkspace.id),
    [allCategories, activeWorkspace.id]
  );

  const transactions = useMemo(
    () => allTransactions.filter((t) => t.workspace_id === activeWorkspace.id),
    [allTransactions, activeWorkspace.id]
  );

  const purchases = useMemo(
    () => allPurchases.filter((p) => p.workspace_id === activeWorkspace.id),
    [allPurchases, activeWorkspace.id]
  );

  const installments = useMemo(() => {
    const wsPurchaseIds = new Set(purchases.map((p) => p.id));
    return allInstallments.filter((i) => wsPurchaseIds.has(i.purchase_id));
  }, [allInstallments, purchases]);

  const payments = useMemo(
    () => allPayments.filter((p) => p.workspace_id === activeWorkspace.id),
    [allPayments, activeWorkspace.id]
  );

  const transfers = useMemo(
    () => allTransfers.filter((t) => t.workspace_id === activeWorkspace.id),
    [allTransfers, activeWorkspace.id]
  );

  const recurring = useMemo(
    () => allRecurring.filter((r) => r.workspace_id === activeWorkspace.id),
    [allRecurring, activeWorkspace.id]
  );

  const budgets = useMemo(
    () => allBudgets.filter((b) => b.workspace_id === activeWorkspace.id),
    [allBudgets, activeWorkspace.id]
  );

  const goals = useMemo(
    () => allGoals.filter((g) => g.workspace_id === activeWorkspace.id),
    [allGoals, activeWorkspace.id]
  );

  const workspaceMembers = useMemo(
    () => allWorkspaceMembers.filter((m) => m.workspace_id === activeWorkspace.id),
    [allWorkspaceMembers, activeWorkspace.id]
  );

  // Funções de Workspaces
  const createWorkspace = (name: string) => {
    const newWs: Workspace = {
      id: generateId('ws'),
      name: name.trim(),
      owner_id: 'usr-1',
      currency: 'BRL',
      created_at: new Date().toISOString(),
    };

    const newMember: WorkspaceMember = {
      id: generateId('wsm'),
      workspace_id: newWs.id,
      user_id: 'usr-1',
      role: 'owner',
      created_at: new Date().toISOString(),
    };

    setAllWorkspaces((prev) => [...prev, newWs]);
    setAllWorkspaceMembers((prev) => [...prev, newMember]);
    setActiveWorkspaceId(newWs.id);
    return newWs;
  };

  const addWorkspaceMember = (email: string, role: 'admin' | 'member' | 'viewer') => {
    const singleUserId = generateId('usr');
    const newMember: WorkspaceMember = {
      id: generateId('wsm'),
      workspace_id: activeWorkspace.id,
      user_id: singleUserId,
      role,
      user: {
        id: singleUserId,
        name: email.split('@')[0],
        email,
        created_at: new Date().toISOString(),
      },
      created_at: new Date().toISOString(),
    };
    setAllWorkspaceMembers((prev) => [...prev, newMember]);
  };

  // Funções de Contas
  const addAccount = (accountData: Omit<Account, 'id' | 'workspace_id' | 'created_at'>) => {
    const newAcc: Account = {
      ...accountData,
      id: generateId('acc'),
      workspace_id: activeWorkspace.id,
      created_at: new Date().toISOString(),
    };
    setAllAccounts((prev) => [...prev, newAcc]);
    return newAcc;
  };

  const updateAccount = (id: string, data: Omit<Partial<Account>, 'id' | 'workspace_id' | 'created_at'>) => {
    setAllAccounts((prev) =>
      prev.map((a) =>
        a.id === id && a.workspace_id === activeWorkspace.id
          ? { ...a, ...data, id: a.id, workspace_id: a.workspace_id, created_at: a.created_at }
          : a
      )
    );
  };

  const deleteAccount = (id: string): { success: boolean; action: 'deleted' | 'inactivated'; message: string } => {
    const targetAcc = allAccounts.find((a) => a.id === id && a.workspace_id === activeWorkspace.id);
    if (!targetAcc) {
      return {
        success: false,
        action: 'deleted',
        message: 'Conta bancária não encontrada no workspace ativo.',
      };
    }

    const hasPayments = allPayments.some((p) => p.account_id === id);
    const hasTransfers = allTransfers.some((tr) => tr.from_account_id === id || tr.to_account_id === id);
    const hasActiveTxs = allTransactions.some((t) => t.account_id === id && (t.status === 'paid' || t.credit_card_bill_id));
    const hasPurchases = allPurchases.some((p) => p.account_id === id);

    if (hasPayments || hasTransfers || hasActiveTxs || hasPurchases) {
      // Soft-delete / inativação segura para manter integridade de pagamentos, transferências e compras
      setAllAccounts((prev) =>
        prev.map((acc) => (acc.id === id ? { ...acc, active: false } : acc))
      );
      return {
        success: true,
        action: 'inactivated',
        message: 'A conta possui histórico financeiro (pagamentos/transferências/compras) e foi inativada para preservar os registros contábeis.',
      };
    }

    // Sem histórico financeiro restritivo: exclusão física com desvinculação limpa (SET NULL)
    setAllTransactions((prev) =>
      prev.map((t) => (t.account_id === id ? { ...t, account_id: undefined } : t))
    );
    setAllPaymentMethods((prev) =>
      prev.map((pm) => (pm.linked_account_id === id ? { ...pm, linked_account_id: undefined } : pm))
    );
    setAllCreditCards((prev) =>
      prev.map((c) => (c.linked_payment_account_id === id ? { ...c, linked_payment_account_id: undefined } : c))
    );
    setAllPurchases((prev) =>
      prev.map((pur) => (pur.account_id === id ? { ...pur, account_id: undefined } : pur))
    );
    setAllRecurring((prev) =>
      prev.map((r) => (r.account_id === id ? { ...r, account_id: undefined } : r))
    );
    setAllAccounts((prev) => prev.filter((a) => a.id !== id));

    return {
      success: true,
      action: 'deleted',
      message: 'Conta bancária excluída com sucesso.',
    };
  };

  // Funções de Cartões
  const addCreditCard = (cardData: Omit<CreditCard, 'id' | 'workspace_id' | 'created_at'>) => {
    const newCard: CreditCard = {
      ...cardData,
      id: generateId('card'),
      workspace_id: activeWorkspace.id,
      created_at: new Date().toISOString(),
    };
    setAllCreditCards((prev) => [...prev, newCard]);
    return newCard;
  };

  const updateCreditCard = (id: string, data: Omit<Partial<CreditCard>, 'id' | 'workspace_id' | 'created_at'>) => {
    setAllCreditCards((prev) =>
      prev.map((c) =>
        c.id === id && c.workspace_id === activeWorkspace.id
          ? { ...c, ...data, id: c.id, workspace_id: c.workspace_id, created_at: c.created_at }
          : c
      )
    );
  };

  // Pagamento de Fatura (com validação estrita da conta contra o workspace)
  const payCreditCardBill = (
    billId: string,
    accountId: string,
    amount: number,
    paymentDate: string = format(new Date(), 'yyyy-MM-dd'),
    notes?: string
  ): Payment => {
    const bill = allCreditCardBills.find((b) => b.id === billId && b.workspace_id === activeWorkspace.id);
    if (!bill) throw new Error('Fatura não encontrada no workspace ativo.');

    validateBillPaymentAccount(accountId, allAccounts, activeWorkspace.id);

    if (amount <= 0 || !Number.isFinite(amount)) throw new Error('Valor inválido para pagamento.');

    const remaining = Math.max(0, bill.total_amount - (bill.paid_amount || 0));
    if (amount > remaining) {
      throw new Error(`Valor do pagamento (R$ ${amount.toFixed(2)}) excede o saldo restante da fatura (R$ ${remaining.toFixed(2)}).`);
    }

    const finalAmount = amount;

    const newPay: Payment = {
      id: generateId('pay'),
      workspace_id: activeWorkspace.id,
      credit_card_bill_id: billId,
      account_id: accountId,
      amount: finalAmount,
      payment_date: paymentDate,
      notes: notes || `Pagamento de fatura ${bill.reference_month}`,
      created_by: 'usr-1',
      created_at: new Date().toISOString(),
    };
    setAllPayments((prev) => [newPay, ...prev]);

    setAllAccounts((prev) =>
      prev.map((a) => (a.id === accountId ? { ...a, current_balance: a.current_balance - finalAmount } : a))
    );

    const newPaid = (bill.paid_amount || 0) + finalAmount;
    const isPaid = newPaid >= bill.total_amount;

    setAllCreditCardBills((prev) =>
      prev.map((b) =>
        b.id === billId
          ? {
              ...b,
              paid_amount: newPaid,
              status: isPaid ? 'paid' : 'partially_paid',
              paid_at: isPaid ? paymentDate : null,
            }
          : b
      )
    );

    if (isPaid) {
      setAllInstallments((prev) =>
        prev.map((inst) =>
          inst.credit_card_bill_id === billId
            ? { ...inst, status: 'paid', paid_amount: inst.amount, paid_at: paymentDate }
            : inst
        )
      );

      setAllTransactions((prev) =>
        prev.map((t) =>
          t.credit_card_bill_id === billId
            ? { ...t, status: 'paid', paid_amount: t.amount, paid_at: paymentDate }
            : t
        )
      );
    }

    return newPay;
  };

  // Funções de Métodos de Pagamento
  const addPaymentMethod = (pmData: Omit<PaymentMethod, 'id' | 'workspace_id' | 'created_at'>) => {
    const newPm: PaymentMethod = {
      ...pmData,
      id: generateId('pm'),
      workspace_id: activeWorkspace.id,
      created_at: new Date().toISOString(),
    };
    setAllPaymentMethods((prev) => [...prev, newPm]);
    return newPm;
  };

  // Funções de Categorias
  const addCategory = (catData: Omit<Category, 'id' | 'workspace_id' | 'created_at'>) => {
    const newCat: Category = {
      ...catData,
      id: generateId('cat'),
      workspace_id: activeWorkspace.id,
      created_at: new Date().toISOString(),
    };
    setAllCategories((prev) => [...prev, newCat]);
    return newCat;
  };

  const updateCategory = (id: string, data: Omit<Partial<Category>, 'id' | 'workspace_id' | 'created_at'>) => {
    setAllCategories((prev) =>
      prev.map((c) =>
        c.id === id && c.workspace_id === activeWorkspace.id
          ? { ...c, ...data, id: c.id, workspace_id: c.workspace_id, created_at: c.created_at }
          : c
      )
    );
  };

  // Funções de Transações (com adição atômica de fatura)
  const addTransaction = (txData: Omit<Transaction, 'id' | 'workspace_id' | 'created_at'>) => {
    const effectiveAccountId = resolveTransactionAccountId(
      txData.payment_method_id,
      txData.account_id,
      allPaymentMethods,
      activeWorkspace.id
    );

    validateTransactionBusinessRules(
      { ...txData, account_id: effectiveAccountId },
      allPaymentMethods,
      activeWorkspace.id
    );

    if (effectiveAccountId) {
      const a = allAccounts.find((acc) => acc.id === effectiveAccountId && acc.workspace_id === activeWorkspace.id);
      if (!a) throw new Error('Conta bancária informada não pertence ao workspace ativo.');
      if (a.active === false) throw new Error('A conta bancária informada está inativa.');
    }

    const cardId = resolveAndValidateCreditCard(activeWorkspace.id, txData.payment_method_id, txData.credit_card_id);
    if (txData.type === 'income' && cardId) {
      throw new Error('Receitas não podem ser vinculadas a cartão de crédito ou faturas.');
    }
    validateActiveCategory(activeWorkspace.id, txData.category_id);

    let billId: string | null = txData.credit_card_bill_id || null;

    if (cardId && !billId) {
      const card = allCreditCards.find((c) => c.id === cardId && c.workspace_id === activeWorkspace.id);
      if (card) {
        const billDates = calculateCardBillDates(
          txData.transaction_date,
          card.closing_day,
          card.due_day
        );
        billId = getOrCreateAndAddItemToBill(
          card.id,
          billDates.referenceMonth,
          billDates.closingDate,
          billDates.dueDate,
          txData.amount,
          activeWorkspace.id
        );
      }
    }

    const newTx: Transaction = {
      ...txData,
      id: generateId('tx'),
      workspace_id: activeWorkspace.id,
      account_id: effectiveAccountId,
      credit_card_id: cardId,
      credit_card_bill_id: billId,
      paid_amount: txData.status === 'paid' ? txData.amount : (txData.paid_amount || 0),
      created_at: new Date().toISOString(),
    };

    setAllTransactions((prev) => [newTx, ...prev]);

    if (newTx.status === 'paid' && newTx.account_id && !newTx.credit_card_id) {
      setAllAccounts((prev) =>
        prev.map((acc) => {
          if (acc.id === newTx.account_id) {
            const diff = newTx.type === 'expense' ? -newTx.amount : newTx.amount;
            return { ...acc, current_balance: acc.current_balance + diff };
          }
          return acc;
        })
      );

      const newPay: Payment = {
        id: generateId('pay'),
        workspace_id: activeWorkspace.id,
        transaction_id: newTx.id,
        account_id: newTx.account_id,
        payment_method_id: newTx.payment_method_id || undefined,
        amount: newTx.amount,
        payment_date: format(new Date(), 'yyyy-MM-dd'),
        created_by: 'usr-1',
        created_at: new Date().toISOString(),
      };
      setAllPayments((prev) => [newPay, ...prev]);
    }

    return newTx;
  };

  // Edição segura de transações através de DTO estrito (bloqueia alteração contábil/estrutural direta)
  const updateTransaction = (
    id: string,
    data: UpdateTransactionDTO
  ) => {
    const existing = allTransactions.find((t) => t.id === id && t.workspace_id === activeWorkspace.id);
    if (!existing) return;

    validateBilledTransactionDateImmutability(existing, data);

    if (data.amount !== undefined && data.amount !== existing.amount) {
      if (existing.status === 'paid' || existing.status === 'partially_paid' || existing.credit_card_bill_id) {
        throw new Error(
          'Alterações em valores de transações já quitadas ou faturadas devem ser realizadas através de estorno ou pagamento transacional.'
        );
      }
      if (!Number.isFinite(data.amount) || data.amount <= 0) {
        throw new Error('O valor da transação deve ser maior que zero.');
      }
    }

    if (data.category_id !== undefined) {
      validateActiveCategory(activeWorkspace.id, data.category_id);
    }

    if (data.account_id !== undefined) {
      validateTransactionAccount(data.account_id, allAccounts, activeWorkspace.id);
    }

    setAllTransactions((prev) =>
      prev.map((t) => {
        if (t.id === id && t.workspace_id === activeWorkspace.id) {
          return {
            ...t,
            description: data.description !== undefined ? data.description.trim() : t.description,
            amount: data.amount !== undefined ? data.amount : t.amount,
            category_id: data.category_id !== undefined ? data.category_id : t.category_id,
            account_id: data.account_id !== undefined ? (data.account_id || undefined) : t.account_id,
            due_date: data.due_date !== undefined ? data.due_date : t.due_date,
            transaction_date: data.transaction_date !== undefined ? data.transaction_date : t.transaction_date,
            notes: data.notes !== undefined ? data.notes : t.notes,
            updated_at: new Date().toISOString(),
          };
        }
        return t;
      })
    );
  };

  // Exclusão Transacional com Proteção Rigorosa Anti-Overpayment
  const deleteTransaction = (id: string) => {
    const tx = allTransactions.find((t) => t.id === id && t.workspace_id === activeWorkspace.id);
    if (!tx) return;

    if (tx.credit_card_bill_id) {
      const bill = allCreditCardBills.find((b) => b.id === tx.credit_card_bill_id);
      if (bill) {
        const newTotal = Math.max(0, bill.total_amount - tx.amount);
        if (bill.paid_amount && bill.paid_amount > newTotal) {
          throw new Error(
            `Não é possível excluir o item da fatura: o valor pago (R$ ${bill.paid_amount.toFixed(2)}) excederia o novo total (R$ ${newTotal.toFixed(2)}). Estorne o pagamento da fatura antes de excluir o item.`
          );
        }

        setAllCreditCardBills((prev) =>
          prev.map((b) => {
            if (b.id === tx.credit_card_bill_id) {
              const newPaid = Math.min(b.paid_amount || 0, newTotal);
              const isNowPaid = newPaid >= newTotal && newTotal > 0;
              return {
                ...b,
                total_amount: newTotal,
                paid_amount: newPaid,
                status: newTotal === 0 ? 'open' : isNowPaid ? 'paid' : newPaid > 0 ? 'partially_paid' : 'open',
                paid_at: isNowPaid ? b.paid_at : null,
              };
            }
            return b;
          })
        );
      }
    }

    if (tx.account_id && !tx.credit_card_id && (tx.status === 'paid' || tx.status === 'partially_paid')) {
      const paid = tx.paid_amount || (tx.status === 'paid' ? tx.amount : 0);
      if (paid > 0) {
        setAllAccounts((prev) =>
          prev.map((acc) => {
            if (acc.id === tx.account_id) {
              const diff = tx.type === 'expense' ? paid : -paid;
              return { ...acc, current_balance: acc.current_balance + diff };
            }
            return acc;
          })
        );
      }
    }

    setAllPayments((prev) => prev.filter((p) => p.transaction_id !== id));
    setAllTransactions((prev) => prev.filter((t) => t.id !== id));
  };

  // Duplicação de Transação Atômica (passa pelas mesmas regras de negócio e validações de addTransaction)
  const duplicateTransaction = (id: string) => {
    const tx = allTransactions.find((t) => t.id === id && t.workspace_id === activeWorkspace.id);
    if (!tx) return null;

    const todayStr = format(new Date(), 'yyyy-MM-dd');
    return addTransaction({
      description: `${tx.description} (Cópia)`,
      amount: tx.amount,
      type: tx.type,
      category_id: tx.category_id,
      account_id: tx.account_id,
      payment_method_id: tx.payment_method_id,
      credit_card_id: tx.credit_card_id,
      transaction_date: todayStr,
      due_date: todayStr,
      status: 'pending',
      paid_amount: 0,
      paid_at: null,
      notes: tx.notes,
    });
  };

  // Criação Atômica de Compra Parcelada com suporte a parcelas já pagas
  const createInstallmentPurchase = (data: {
    description: string;
    total_amount: number;
    installment_count: number;
    purchase_date: string;
    credit_card_id?: string;
    category_id?: string;
    account_id?: string;
    payment_method_id?: string;
    paid_installments_count?: number;
  }) => {
    if (typeof data.total_amount !== 'number' || !Number.isFinite(data.total_amount) || data.total_amount <= 0) {
      throw new Error('O valor total da compra parcelada deve ser maior que zero.');
    }

    if (data.account_id) {
      const a = allAccounts.find((acc) => acc.id === data.account_id && acc.workspace_id === activeWorkspace.id);
      if (!a) throw new Error('Conta bancária informada não pertence ao workspace ativo.');
      if (a.active === false) throw new Error('A conta bancária informada está inativa.');
    }

    const effectiveCardId = resolveAndValidateCreditCard(activeWorkspace.id, data.payment_method_id, data.credit_card_id);
    validateTransactionBusinessRules(
      {
        type: 'expense',
        credit_card_id: effectiveCardId || data.credit_card_id,
        payment_method_id: data.payment_method_id,
        account_id: data.account_id,
      },
      allPaymentMethods,
      activeWorkspace.id
    );
    validateActiveCategory(activeWorkspace.id, data.category_id);

    const paidCount = Math.max(0, Math.min(data.installment_count, data.paid_installments_count || 0));
    const card = effectiveCardId ? allCreditCards.find((c) => c.id === effectiveCardId && c.workspace_id === activeWorkspace.id) : undefined;
    const split = splitInstallments(data.total_amount, data.installment_count, data.purchase_date, card, paidCount);

    if (split.length === 0) {
      throw new Error('Parâmetros de parcelamento inválidos.');
    }

    const newPurchase: Purchase = {
      id: generateId('pur'),
      workspace_id: activeWorkspace.id,
      description: data.description,
      total_amount: data.total_amount,
      installment_count: data.installment_count,
      paid_installments_count: paidCount,
      purchase_date: data.purchase_date,
      credit_card_id: effectiveCardId,
      category_id: data.category_id,
      account_id: data.account_id,
      payment_method_id: data.payment_method_id,
      created_by: 'usr-1',
      created_at: new Date().toISOString(),
    };

    const generatedInstallments: Installment[] = split.map((s) => {
      let billId: string | null = null;
      if (card && s.referenceMonth && s.closingDate) {
        billId = getOrCreateAndAddItemToBill(
          card.id,
          s.referenceMonth,
          s.closingDate,
          s.dueDate,
          s.amount,
          activeWorkspace.id,
          s.isPaid
        );
      }

      return {
        id: generateId(`inst-${newPurchase.id}`),
        purchase_id: newPurchase.id,
        installment_number: s.installmentNumber,
        amount: s.amount,
        due_date: s.dueDate,
        credit_card_bill_id: billId,
        status: s.isPaid ? 'paid' : 'pending',
        paid_amount: s.isPaid ? s.amount : 0,
        paid_at: s.isPaid ? s.dueDate : null,
        created_at: new Date().toISOString(),
      };
    });

    const generatedPayments: Payment[] = [];
    if (data.account_id && paidCount > 0) {
      generatedInstallments.forEach((inst, idx) => {
        if (split[idx]?.isPaid) {
          generatedPayments.push({
            id: generateId('pay'),
            workspace_id: activeWorkspace.id,
            installment_id: inst.id,
            account_id: data.account_id!,
            payment_method_id: data.payment_method_id,
            amount: inst.amount,
            payment_date: inst.paid_at || inst.due_date,
            notes: 'Quitação prévia de parcela importada',
            created_by: 'usr-1',
            created_at: new Date().toISOString(),
          });
        }
      });
    }

    setAllPurchases((prev) => [newPurchase, ...prev]);
    setAllInstallments((prev) => [...prev, ...generatedInstallments]);
    if (generatedPayments.length > 0) {
      setAllPayments((prev) => [...generatedPayments, ...prev]);
    }
    return newPurchase;
  };

  // Registro de Pagamento
  const recordPayment = (data: {
    transaction_id?: string;
    installment_id?: string;
    credit_card_bill_id?: string;
    account_id: string;
    payment_method_id?: string;
    amount: number;
    payment_date: string;
    notes?: string;
  }): Payment => {
    if (!Number.isFinite(data.amount) || data.amount <= 0) {
      throw new Error('O valor do pagamento deve ser estritamente maior que zero.');
    }

    const targetsCount =
      (data.transaction_id ? 1 : 0) +
      (data.installment_id ? 1 : 0) +
      (data.credit_card_bill_id ? 1 : 0);

    if (targetsCount !== 1) {
      throw new Error('Informe exatamente uma obrigação de destino para o pagamento.');
    }

    const acc = accounts.find((a) => a.id === data.account_id);
    if (!acc) throw new Error('Conta informada não pertence ao workspace ativo.');

    if (data.payment_method_id) {
      const pm = paymentMethods.find((p) => p.id === data.payment_method_id);
      if (!pm) throw new Error('Método de pagamento não pertence ao workspace ativo.');
    }

    // 1. Transação avulsa
    if (data.transaction_id) {
      const tx = allTransactions.find((t) => t.id === data.transaction_id && t.workspace_id === activeWorkspace.id);
      if (!tx) throw new Error('Transação não encontrada no workspace ativo.');

      if (tx.credit_card_bill_id || tx.credit_card_id) {
        throw new Error('Itens vinculados a cartão de crédito devem ser quitados exclusivamente através da fatura correspondente.');
      }

      const remaining = Math.max(0, tx.amount - (tx.paid_amount || 0));
      if (data.amount > remaining) {
        throw new Error(
          `Valor do pagamento (R$ ${data.amount.toFixed(2)}) excede o saldo restante da transação (R$ ${remaining.toFixed(2)}).`
        );
      }

      const currentPaid = (tx.paid_amount || 0) + data.amount;
      const isFull = currentPaid >= tx.amount;

      setAllTransactions((prev) =>
        prev.map((t) =>
          t.id === data.transaction_id
            ? {
                ...t,
                paid_amount: currentPaid,
                status: isFull ? 'paid' : 'partially_paid',
                paid_at: isFull ? data.payment_date : t.paid_at,
              }
            : t
        )
      );

      setAllAccounts((prev) =>
        prev.map((a) => {
          if (a.id === data.account_id) {
            const diff = tx.type === 'expense' ? -data.amount : data.amount;
            return { ...a, current_balance: a.current_balance + diff };
          }
          return a;
        })
      );
    }

    // 2. Parcela
    if (data.installment_id) {
      const inst = allInstallments.find((i) => i.id === data.installment_id);
      if (!inst) throw new Error('Parcela não encontrada.');

      const pur = purchases.find((p) => p.id === inst.purchase_id);
      if (!pur) throw new Error('Compra associada à parcela não pertence ao workspace ativo.');

      if (inst.credit_card_bill_id || pur.credit_card_id) {
        throw new Error('Parcelas vinculadas a cartão de crédito devem ser quitadas exclusivamente através da fatura correspondente.');
      }

      const remaining = Math.max(0, inst.amount - (inst.paid_amount || 0));
      if (data.amount > remaining) {
        throw new Error(
          `Valor do pagamento (R$ ${data.amount.toFixed(2)}) excede o saldo restante da parcela (R$ ${remaining.toFixed(2)}).`
        );
      }

      const currentPaid = (inst.paid_amount || 0) + data.amount;
      const isFull = currentPaid >= inst.amount;

      setAllInstallments((prev) =>
        prev.map((i) =>
          i.id === data.installment_id
            ? {
                ...i,
                paid_amount: currentPaid,
                status: isFull ? 'paid' : 'partially_paid',
                paid_at: isFull ? data.payment_date : i.paid_at,
              }
            : i
        )
      );

      setAllAccounts((prev) =>
        prev.map((a) =>
          a.id === data.account_id ? { ...a, current_balance: a.current_balance - data.amount } : a
        )
      );
    }

    // 3. Fatura de cartão
    if (data.credit_card_bill_id) {
      return payCreditCardBill(data.credit_card_bill_id, data.account_id, data.amount, data.payment_date, data.notes);
    }

    const newPay: Payment = {
      id: generateId('pay'),
      workspace_id: activeWorkspace.id,
      transaction_id: data.transaction_id,
      installment_id: data.installment_id,
      credit_card_bill_id: data.credit_card_bill_id,
      account_id: data.account_id,
      payment_method_id: data.payment_method_id,
      amount: data.amount,
      payment_date: data.payment_date,
      notes: data.notes,
      created_by: 'usr-1',
      created_at: new Date().toISOString(),
    };

    setAllPayments((prev) => [newPay, ...prev]);
    return newPay;
  };

  // Transferência Neutra
  const createTransfer = (
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    date: string = format(new Date(), 'yyyy-MM-dd'),
    notes?: string
  ) => {
    if (fromAccountId === toAccountId) {
      throw new Error('A conta de origem e destino devem ser diferentes.');
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('O valor da transferência deve ser maior que zero.');
    }

    const fromAcc = accounts.find((a) => a.id === fromAccountId);
    const toAcc = accounts.find((a) => a.id === toAccountId);
    if (!fromAcc || !toAcc) {
      throw new Error('As contas informadas devem pertencer ao workspace ativo.');
    }

    const newTransfer: Transfer = {
      id: generateId('trf'),
      workspace_id: activeWorkspace.id,
      from_account_id: fromAccountId,
      to_account_id: toAccountId,
      amount,
      transfer_date: date,
      notes: notes || undefined,
      created_by: 'usr-1',
      created_at: new Date().toISOString(),
      from_account: fromAcc,
      to_account: toAcc,
    };

    setAllTransfers((prev) => [newTransfer, ...prev]);

    setAllAccounts((prev) =>
      prev.map((acc) => {
        if (acc.id === fromAccountId) {
          return { ...acc, current_balance: acc.current_balance - amount };
        }
        if (acc.id === toAccountId) {
          return { ...acc, current_balance: acc.current_balance + amount };
        }
        return acc;
      })
    );

    return newTransfer;
  };

  // Recorrências com disparo reativo e validação estrita
  const addRecurring = (data: Omit<RecurringTransaction, 'id' | 'workspace_id' | 'created_at'>) => {
    validateRecurringAmount(data.amount);
    if (data.frequency === 'custom') {
      if (!isValidCustomInterval(data.interval_days)) {
        throw new Error('Intervalo em dias inválido para recorrência personalizada (deve ser número inteiro entre 1 e 3650 dias).');
      }
    }
    if (data.account_id) {
      const a = allAccounts.find((acc) => acc.id === data.account_id && acc.workspace_id === activeWorkspace.id);
      if (!a) throw new Error('Conta bancária informada não pertence ao workspace ativo.');
      if (a.active === false) throw new Error('A conta bancária informada está inativa.');
    }
    const effectiveCardId = resolveAndValidateCreditCard(activeWorkspace.id, data.payment_method_id, data.credit_card_id);
    validateTransactionBusinessRules(
      {
        type: data.type,
        credit_card_id: effectiveCardId || data.credit_card_id,
        payment_method_id: data.payment_method_id,
        account_id: data.account_id,
      },
      allPaymentMethods,
      activeWorkspace.id
    );
    validateActiveCategory(activeWorkspace.id, data.category_id);

    const newRec: RecurringTransaction = {
      ...data,
      id: generateId('rec'),
      workspace_id: activeWorkspace.id,
      credit_card_id: effectiveCardId || undefined,
      active: true,
      suspended_reason: null,
      created_at: new Date().toISOString(),
    };
    setAllRecurring((prev) => [...prev, newRec]);
    setTimeout(() => processPendingRecurring(), 0);
    return newRec;
  };

  const toggleRecurring = (id: string) => {
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    setAllRecurring((prev) =>
      prev.map((r) => {
        if (r.id === id && r.workspace_id === activeWorkspace.id) {
          const willBeActive = !r.active;
          let nextOcc = r.next_occurrence;
          if (willBeActive && nextOcc < todayStr) {
            nextOcc = calculateCatchUpOccurrence(nextOcc, r.start_date, r.frequency, r.interval_days, todayStr);
          }
          return {
            ...r,
            active: willBeActive,
            next_occurrence: nextOcc,
            suspended_reason: willBeActive ? null : r.suspended_reason,
          };
        }
        return r;
      })
    );
    setTimeout(() => processPendingRecurring(), 0);
  };

  const deleteRecurring = (id: string) => {
    setAllRecurring((prev) => prev.filter((r) => !(r.id === id && r.workspace_id === activeWorkspace.id)));
  };

  // Orçamentos
  const setBudget = (
    categoryId: string,
    plannedAmount: number,
    month: number = new Date().getMonth() + 1,
    year: number = new Date().getFullYear()
  ) => {
    setAllBudgets((prev) => {
      const existingIndex = prev.findIndex(
        (b) => b.category_id === categoryId && b.month === month && b.year === year && b.workspace_id === activeWorkspace.id
      );
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = { ...updated[existingIndex], planned_amount: plannedAmount };
        return updated;
      }
      return [
        ...prev,
        {
          id: generateId('bud'),
          workspace_id: activeWorkspace.id,
          category_id: categoryId,
          month,
          year,
          planned_amount: plannedAmount,
        },
      ];
    });
  };

  // Metas
  const addGoal = (goalData: Omit<FinancialGoal, 'id' | 'workspace_id' | 'created_at'>) => {
    const newGoal: FinancialGoal = {
      ...goalData,
      id: generateId('goal'),
      workspace_id: activeWorkspace.id,
      created_at: new Date().toISOString(),
    };
    setAllGoals((prev) => [...prev, newGoal]);
    return newGoal;
  };

  const updateGoal = (id: string, data: Omit<Partial<FinancialGoal>, 'id' | 'workspace_id' | 'created_at'>) => {
    setAllGoals((prev) =>
      prev.map((g) =>
        g.id === id && g.workspace_id === activeWorkspace.id
          ? { ...g, ...data, id: g.id, workspace_id: g.workspace_id, created_at: g.created_at }
          : g
      )
    );
  };

  const depositGoal = (goalId: string, amount: number, accountId: string) => {
    if (amount <= 0 || !Number.isFinite(amount)) {
      throw new Error('Valor inválido para depósito na meta.');
    }
    const goal = allGoals.find((g) => g.id === goalId && g.workspace_id === activeWorkspace.id);
    if (!goal) throw new Error('Meta financeira não encontrada no workspace ativo.');

    const acc = allAccounts.find((a) => a.id === accountId && a.workspace_id === activeWorkspace.id);
    if (!acc) throw new Error('Conta bancária não encontrada no workspace ativo.');
    if (acc.active === false) throw new Error('A conta bancária informada está inativa.');

    setAllGoals((prev) =>
      prev.map((g) => {
        if (g.id === goalId && g.workspace_id === activeWorkspace.id) {
          const newCurrent = g.current_amount + amount;
          return {
            ...g,
            current_amount: newCurrent,
            status: newCurrent >= g.target_amount ? 'completed' : g.status,
          };
        }
        return g;
      })
    );
    setAllAccounts((prev) =>
      prev.map((a) => (a.id === accountId && a.workspace_id === activeWorkspace.id ? { ...a, current_balance: a.current_balance - amount } : a))
    );
  };

  return (
    <FinanceContext.Provider
      value={{
        isLoaded,
        workspaces: allWorkspaces,
        activeWorkspace,
        workspaceMembers,
        setActiveWorkspaceId,
        createWorkspace,
        addWorkspaceMember,

        accounts,
        allWorkspaceAccounts,
        addAccount,
        updateAccount,
        deleteAccount,

        creditCards,
        allWorkspaceCreditCards,
        creditCardBills,
        addCreditCard,
        updateCreditCard,
        payCreditCardBill,

        paymentMethods,
        allWorkspacePaymentMethods,
        addPaymentMethod,

        categories,
        allWorkspaceCategories,
        addCategory,
        updateCategory,

        transactions,
        addTransaction,
        updateTransaction,
        deleteTransaction,
        duplicateTransaction,

        purchases,
        installments,
        createInstallmentPurchase,

        payments,
        recordPayment,

        transfers,
        createTransfer,

        recurring,
        addRecurring,
        toggleRecurring,
        deleteRecurring,
        processPendingRecurring,

        budgets,
        setBudget,

        goals,
        addGoal,
        updateGoal,
        depositGoal,

        viewPerspective,
        setViewPerspective,
      }}
    >
      {children}
    </FinanceContext.Provider>
  );
}

export function useFinance() {
  const context = useContext(FinanceContext);
  if (!context) {
    throw new Error('useFinance deve ser usado dentro de um FinanceProvider');
  }
  return context;
}
