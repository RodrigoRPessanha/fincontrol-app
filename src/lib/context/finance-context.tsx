'use client';

import React, { createContext, useContext, useEffect, useState, useMemo, useCallback, useRef } from 'react';
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
  Settlement,
  SplitType,
  TransactionSplit,
  WorkspaceTrackingMode,
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
  isValidCustomInterval,
  validateCreditCardResolution,
  validateTransactionBusinessRules,
  validateBilledTransactionDateImmutability,
  sanitizeLegacyRecurringState,
  validateRecurringAmount,
  resolveTransactionAccountId,
  validateBillPaymentAccount,
  validatePaymentAccount,
  validateRecurringMaterialization,
  stepNextOccurrence,
  calculateCatchUpOccurrence,
  validateCategoryActive,
  validateTransactionAccount,
  processRecurringBatchState,
  resolveOrCreateCreditCardBill,
  reconcileBillAfterItemDeletion,
  validateCreditCardBillIntegrity,
  toCents,
  fromCents,
  roundCurrency,
  validateSettlement,
  calculateMemberNetBalances,
  calculateExpenseSplits,
} from '../financial-engine';
import { format } from 'date-fns';

interface FinanceContextType {
  isLoaded: boolean;
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
  payCreditCardBill: (billId: string, accountId?: string | null, amount?: number, paymentDate?: string, notes?: string) => Payment;

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
    paid_by_member_id?: string;
    split_type?: SplitType;
    splits?: TransactionSplit[];
  }) => Purchase;

  payments: Payment[];
  recordPayment: (data: {
    transaction_id?: string;
    installment_id?: string;
    credit_card_bill_id?: string;
    account_id?: string | null;
    payment_method_id?: string;
    amount: number;
    payment_date: string;
    notes?: string;
  }) => Payment;

  transfers: Transfer[];
  createTransfer: (fromAccountId: string, toAccountId: string, amount: number, date?: string, notes?: string) => Transfer | null;

  settlements: Settlement[];
  recordSettlement: (data: {
    from_member_id: string;
    to_member_id: string;
    amount: number;
    settlement_date?: string;
    notes?: string;
    payment_account_id?: string;
  }) => Settlement;
  deleteSettlement: (id: string) => void;

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

  const [allSettlements, setAllSettlements] = useState<Settlement[]>([]);

  const [viewPerspective, setViewPerspective] = useState<'realized' | 'planned'>('realized');

  // Sincronização atômica síncrona para chamadas encadeadas no mesmo ciclo de renderização (V36 / P1-01)
  const stateRef = useRef({
    activeWorkspaceId,
    allWorkspaces,
    allWorkspaceMembers,
    allTransactions,
    allPurchases,
    allInstallments,
    allCreditCardBills,
    allAccounts,
    allPayments,
    allGoals,
    allTransfers,
    allRecurring,
    allCreditCards,
    allPaymentMethods,
    allCategories,
    allSettlements,
  });

  useEffect(() => {
    stateRef.current = {
      activeWorkspaceId,
      allWorkspaces,
      allWorkspaceMembers,
      allTransactions,
      allPurchases,
      allInstallments,
      allCreditCardBills,
      allAccounts,
      allPayments,
      allGoals,
      allTransfers,
      allRecurring,
      allCreditCards,
      allPaymentMethods,
      allCategories,
      allSettlements,
    };
  });

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
        const savedSettlements = localStorage.getItem(`${STORAGE_PREFIX}settlements`);

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
        if (savedSettlements) setAllSettlements(JSON.parse(savedSettlements));

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
    localStorage.setItem(`${STORAGE_PREFIX}settlements`, JSON.stringify(allSettlements));
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
    allSettlements,
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

      // 1. Calcula a atualização da fatura de forma síncrona a partir do estado atual em stateRef
      const preview = resolveOrCreateCreditCardBill({
        bills: stateRef.current.allCreditCardBills,
        cardId,
        referenceMonth,
        closingDate,
        dueDate,
        amount,
        workspaceId: targetWsId,
        isPaid,
      });

      // 2. Atualiza sincronamente a referência mutável para comandos no mesmo lote e enfileira no React
      stateRef.current.allCreditCardBills = preview.updatedBills;
      setAllCreditCardBills(preview.updatedBills);

      // 3. Retorna o ID síncrono imediatamente sem depender do timing do setter React
      return preview.billId;
    },
    [activeWorkspaceId]
  );

  // Helper centralizado para validar categoria/subcategoria ativa e de mesmo workspace
  const validateActiveCategory = useCallback(
    (workspaceId: string, categoryId?: string | null) => {
      if (!categoryId) return;
      const categories = stateRef.current.allCategories;
      const parent = categories.find(
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
    []
  );

  // Helper centralizado para inferir, validar coerência e status ativo de cartão de crédito
  const resolveAndValidateCreditCard = useCallback(
    (workspaceId: string, pmId?: string | null, explicitCardId?: string | null): string | null => {
      return validateCreditCardResolution(
        workspaceId,
        stateRef.current.allPaymentMethods,
        stateRef.current.allCreditCards,
        stateRef.current.allAccounts,
        pmId,
        explicitCardId
      );
    },
    []
  );

  // Helper centralizado para validação de borda monetária e estrutural de rateios (P1-01 V36)
  const validateTransactionSplits = useCallback(
    (
      totalAmount: number,
      targetWsId: string,
      paidByMemberId?: string | null,
      splits?: TransactionSplit[],
      splitType?: SplitType | null
    ) => {
      const wsMembers = stateRef.current.allWorkspaceMembers.filter((m) => m.workspace_id === targetWsId);
      const memberIds = new Set(wsMembers.map((m) => m.id));

      if (paidByMemberId && !memberIds.has(paidByMemberId)) {
        throw new Error('O membro pagador informado não pertence ao workspace ativo.');
      }

      const effectiveSplitType: SplitType = splitType || 'individual';

      // Regra individual ou ausente: não pode ter splits
      if (effectiveSplitType === 'individual') {
        if (splits && splits.length > 0) {
          throw new Error('Transações individuais não devem possuir divisão de despesas.');
        }
        return;
      }

      // Regras de rateio ('equal', 'full_other', 'custom'): OBRIGATÓRIO ter splits
      if (!splits || splits.length === 0) {
        throw new Error('A regra de divisão selecionada exige o preenchimento das frações de rateio.');
      }

      const seen = new Set<string>();
      let sumCents = 0;
      const totalCents = toCents(totalAmount);

      for (const split of splits) {
        if (!split.member_id || !memberIds.has(split.member_id)) {
          throw new Error('Membro informado no rateio não pertence ao workspace ativo.');
        }
        if (seen.has(split.member_id)) {
          throw new Error('Membros duplicados identificados no rateio.');
        }
        seen.add(split.member_id);

        if (typeof split.amount !== 'number' || !Number.isFinite(split.amount) || split.amount < 0) {
          throw new Error('O valor de rateio atribuído a cada membro não pode ser negativo ou inválido.');
        }

        // Na regra 100% de outra pessoa: o pagador não pode possuir fração atribuída a si mesmo
        if (effectiveSplitType === 'full_other' && paidByMemberId && split.member_id === paidByMemberId && split.amount > 0) {
          throw new Error('Na regra 100% de outra pessoa, o pagador não pode possuir fração atribuída a si mesmo.');
        }

        sumCents += toCents(split.amount);
      }

      if (sumCents !== totalCents) {
        throw new Error(
          `A soma das frações do rateio (R$ ${(sumCents / 100).toFixed(2)}) diverge do valor total da despesa (R$ ${(totalCents / 100).toFixed(2)}).`
        );
      }

      // Validação canônica estrita para 'equal' e 'full_other' (P1-01 V36 Semântica)
      if (effectiveSplitType === 'equal') {
        const effectivePayer = paidByMemberId || wsMembers[0]?.id;
        const canonical = calculateExpenseSplits(totalAmount, 'equal', wsMembers, effectivePayer);

        if (splits.length !== canonical.length) {
          throw new Error(
            `A distribuição de frações informada diverge do cálculo canônico para a regra 'equal'.`
          );
        }

        for (const c of canonical) {
          const received = splits.find((s) => s.member_id === c.member_id);
          const receivedCents = received ? toCents(received.amount) : 0;
          if (receivedCents !== toCents(c.amount)) {
            throw new Error(
              `A distribuição de frações informada diverge do cálculo canônico para a regra 'equal'.`
            );
          }
        }
      } else if (effectiveSplitType === 'full_other') {
        const effectivePayer = paidByMemberId || wsMembers[0]?.id;
        if (effectivePayer && wsMembers.length > 0) {
          const canonical = calculateExpenseSplits(totalAmount, 'full_other', wsMembers, effectivePayer);

          if (splits.length !== canonical.length) {
            throw new Error(
              `A distribuição de frações informada diverge do cálculo canônico para a regra 'full_other'.`
            );
          }

          for (const c of canonical) {
            const received = splits.find((s) => s.member_id === c.member_id);
            const receivedCents = received ? toCents(received.amount) : 0;
            if (receivedCents !== toCents(c.amount)) {
              throw new Error(
                `A distribuição de frações informada diverge do cálculo canônico para a regra 'full_other'.`
              );
            }
          }
        }
      }
    },
    []
  );

  // Processamento Reativo de Recorrências via função pura de transição de estado de produção
  const processPendingRecurring = useCallback(() => {
    if (!isLoaded) return;
    const todayStr = format(new Date(), 'yyyy-MM-dd');

    const result = processRecurringBatchState({
      recurring: stateRef.current.allRecurring,
      transactions: stateRef.current.allTransactions,
      bills: stateRef.current.allCreditCardBills,
      accounts: stateRef.current.allAccounts,
      paymentMethods: stateRef.current.allPaymentMethods,
      creditCards: stateRef.current.allCreditCards,
      categories: stateRef.current.allCategories,
      todayStr,
      generateId,
    });

    if (result.hasChanges) {
      if (result.newTransactions.length > 0) {
        stateRef.current.allTransactions = [...result.newTransactions, ...stateRef.current.allTransactions];
        setAllTransactions((prev) => [...result.newTransactions, ...prev]);
      }
      stateRef.current.allCreditCardBills = result.updatedBills;
      stateRef.current.allRecurring = result.updatedRecurring;
      setAllRecurring(result.updatedRecurring);
      setAllCreditCardBills(result.updatedBills);
    }
  }, [
    isLoaded,
  ]);

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

  const settlements = useMemo(
    () => allSettlements.filter((s) => s.workspace_id === activeWorkspace.id),
    [allSettlements, activeWorkspace.id]
  );

  const handleSetActiveWorkspaceId = useCallback((id: string) => {
    stateRef.current.activeWorkspaceId = id;
    setActiveWorkspaceId(id);
  }, []);

  const getActiveWsId = useCallback(() => {
    return stateRef.current.activeWorkspaceId || activeWorkspaceId || activeWorkspace.id;
  }, [activeWorkspaceId, activeWorkspace.id]);

  // Funções de Workspaces
  const createWorkspace = (name: string, tracking_mode: WorkspaceTrackingMode = 'full') => {
    const newWs: Workspace = {
      id: generateId('ws'),
      name: name.trim(),
      owner_id: 'usr-1',
      currency: 'BRL',
      tracking_mode,
      created_at: new Date().toISOString(),
    };

    const newMember: WorkspaceMember = {
      id: generateId('wsm'),
      workspace_id: newWs.id,
      user_id: 'usr-1',
      role: 'owner',
      created_at: new Date().toISOString(),
    };

    stateRef.current.allWorkspaces = [...stateRef.current.allWorkspaces, newWs];
    stateRef.current.allWorkspaceMembers = [...stateRef.current.allWorkspaceMembers, newMember];
    stateRef.current.activeWorkspaceId = newWs.id;

    setAllWorkspaces((prev) => [...prev, newWs]);
    setAllWorkspaceMembers((prev) => [...prev, newMember]);
    setActiveWorkspaceId(newWs.id);
    return newWs;
  };

  const updateWorkspace = (id: string, data: Partial<Workspace>) => {
    stateRef.current.allWorkspaces = stateRef.current.allWorkspaces.map((w) =>
      w.id === id ? { ...w, ...data, id: w.id, created_at: w.created_at } : w
    );
    setAllWorkspaces((prev) =>
      prev.map((w) => (w.id === id ? { ...w, ...data, id: w.id, created_at: w.created_at } : w))
    );
  };

  const addWorkspaceMember = (email: string, role: 'admin' | 'member' | 'viewer') => {
    const singleUserId = generateId('usr');
    const targetWsId = getActiveWsId();
    const newMember: WorkspaceMember = {
      id: generateId('wsm'),
      workspace_id: targetWsId,
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
    stateRef.current.allWorkspaceMembers = [...stateRef.current.allWorkspaceMembers, newMember];
    setAllWorkspaceMembers((prev) => [...prev, newMember]);
  };

  // Funções de Contas
  const addAccount = (accountData: Omit<Account, 'id' | 'workspace_id' | 'created_at'>) => {
    const targetWsId = getActiveWsId();
    const newAcc: Account = {
      ...accountData,
      id: generateId('acc'),
      workspace_id: targetWsId,
      current_balance: accountData.initial_balance || 0,
      active: accountData.active !== undefined ? accountData.active : true,
      created_at: new Date().toISOString(),
    };
    stateRef.current.allAccounts = [...stateRef.current.allAccounts, newAcc];
    setAllAccounts((prev) => [...prev, newAcc]);
    return newAcc;
  };

  const updateAccount = (id: string, data: Omit<Partial<Account>, 'id' | 'workspace_id' | 'created_at'>) => {
    const targetWsId = getActiveWsId();
    stateRef.current.allAccounts = stateRef.current.allAccounts.map((a) =>
      a.id === id && a.workspace_id === targetWsId
        ? { ...a, ...data, id: a.id, workspace_id: a.workspace_id, created_at: a.created_at }
        : a
    );
    setAllAccounts((prev) =>
      prev.map((a) =>
        a.id === id && a.workspace_id === targetWsId
          ? { ...a, ...data, id: a.id, workspace_id: a.workspace_id, created_at: a.created_at }
          : a
      )
    );
  };

  const deleteAccount = (id: string): { success: boolean; action: 'deleted' | 'inactivated'; message: string } => {
    const targetWsId = getActiveWsId();
    const targetAcc = stateRef.current.allAccounts.find((a) => a.id === id && a.workspace_id === targetWsId);
    if (!targetAcc) {
      return {
        success: false,
        action: 'deleted',
        message: 'Conta bancária não encontrada no workspace ativo.',
      };
    }

    const hasPayments = stateRef.current.allPayments.some((p) => p.account_id === id);
    const hasTransfers = stateRef.current.allTransfers.some((tr) => tr.from_account_id === id || tr.to_account_id === id);
    const hasActiveTxs = stateRef.current.allTransactions.some((t) => t.account_id === id && (t.status === 'paid' || t.credit_card_bill_id));
    const hasPurchases = stateRef.current.allPurchases.some((p) => p.account_id === id);

    if (hasPayments || hasTransfers || hasActiveTxs || hasPurchases) {
      // Soft-delete / inativação segura para manter integridade de pagamentos, transferências e compras
      stateRef.current.allAccounts = stateRef.current.allAccounts.map((acc) =>
        acc.id === id ? { ...acc, active: false } : acc
      );
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
    stateRef.current.allTransactions = stateRef.current.allTransactions.map((t) =>
      t.account_id === id ? { ...t, account_id: undefined } : t
    );
    stateRef.current.allPurchases = stateRef.current.allPurchases.map((pur) =>
      pur.account_id === id ? { ...pur, account_id: undefined } : pur
    );
    stateRef.current.allRecurring = stateRef.current.allRecurring.map((r) =>
      r.account_id === id ? { ...r, account_id: undefined } : r
    );
    stateRef.current.allPaymentMethods = stateRef.current.allPaymentMethods.map((pm) =>
      pm.linked_account_id === id ? { ...pm, linked_account_id: undefined } : pm
    );
    stateRef.current.allCreditCards = stateRef.current.allCreditCards.map((c) =>
      c.linked_payment_account_id === id ? { ...c, linked_payment_account_id: undefined } : c
    );
    stateRef.current.allAccounts = stateRef.current.allAccounts.filter((a) => a.id !== id);

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
    const targetWsId = getActiveWsId();
    if (cardData.linked_payment_account_id) {
      const acc = stateRef.current.allAccounts.find(
        (a) => a.id === cardData.linked_payment_account_id && a.workspace_id === targetWsId
      );
      if (!acc) throw new Error('Conta vinculada ao cartão não pertence ao workspace ativo.');
      if (acc.active === false) throw new Error('A conta bancária vinculada ao cartão está inativa.');
    }
    const newCard: CreditCard = {
      ...cardData,
      id: generateId('card'),
      workspace_id: targetWsId,
      created_at: new Date().toISOString(),
    };
    stateRef.current.allCreditCards = [...stateRef.current.allCreditCards, newCard];
    setAllCreditCards((prev) => [...prev, newCard]);
    return newCard;
  };

  const updateCreditCard = (id: string, data: Omit<Partial<CreditCard>, 'id' | 'workspace_id' | 'created_at'>) => {
    const targetWsId = getActiveWsId();
    if (data.linked_payment_account_id) {
      const acc = stateRef.current.allAccounts.find(
        (a) => a.id === data.linked_payment_account_id && a.workspace_id === targetWsId
      );
      if (!acc) throw new Error('Conta vinculada ao cartão não pertence ao workspace ativo.');
      if (acc.active === false) throw new Error('A conta bancária vinculada ao cartão está inativa.');
    }
    stateRef.current.allCreditCards = stateRef.current.allCreditCards.map((c) =>
      c.id === id && c.workspace_id === targetWsId
        ? { ...c, ...data, id: c.id, workspace_id: c.workspace_id, created_at: c.created_at }
        : c
    );
    setAllCreditCards((prev) =>
      prev.map((c) =>
        c.id === id && c.workspace_id === targetWsId
          ? { ...c, ...data, id: c.id, workspace_id: c.workspace_id, created_at: c.created_at }
          : c
      )
    );
  };

  // Pagamento de Fatura (com validação atômica sob batching e updaters puros V36 / P1-01 e P2-03)
  const payCreditCardBill = (
    billId: string,
    accountId?: string | null,
    amount?: number,
    paymentDate: string = format(new Date(), 'yyyy-MM-dd'),
    notes?: string
  ): Payment => {
    const targetWsId = getActiveWsId();
    const currentBills = stateRef.current.allCreditCardBills;
    const currentAccounts = stateRef.current.allAccounts;

    const bill = currentBills.find((b) => b.id === billId && b.workspace_id === targetWsId);
    if (!bill) throw new Error('Fatura não encontrada no workspace ativo.');

    const activeWs = stateRef.current.allWorkspaces.find((w) => w.id === targetWsId);
    const isExpenseTracker = activeWs?.tracking_mode === 'expense_tracker';

    validateCreditCardBillIntegrity(bill);
    validateBillPaymentAccount(accountId, currentAccounts, targetWsId, isExpenseTracker);

    const payAmount = typeof amount === 'number' ? amount : (bill.total_amount - (bill.paid_amount || 0));
    const paymentCents = toCents(payAmount);
    if (!Number.isFinite(payAmount) || payAmount <= 0 || paymentCents <= 0 || !Number.isSafeInteger(paymentCents)) {
      throw new Error('Valor inválido para pagamento.');
    }

    const totalCents = toCents(bill.total_amount);
    const paidCents = toCents(bill.paid_amount || 0);
    const remainingCents = Math.max(0, totalCents - paidCents);

    if (paymentCents > remainingCents) {
      throw new Error(
        `Valor do pagamento (R$ ${payAmount.toFixed(2)}) excede o saldo restante da fatura (R$ ${(remainingCents / 100).toFixed(2)}).`
      );
    }

    const finalAmount = fromCents(paymentCents);
    const shouldMutateAccount = !!(accountId && !isExpenseTracker);
    const newPay: Payment = {
      id: generateId('pay'),
      workspace_id: targetWsId,
      credit_card_bill_id: billId,
      account_id: accountId || null,
      amount: finalAmount,
      payment_date: paymentDate,
      notes: notes || `Pagamento de fatura ${bill.reference_month}`,
      created_by: 'usr-1',
      created_at: new Date().toISOString(),
      affects_balance: shouldMutateAccount,
    };

    const bNewPaidCents = paidCents + paymentCents;
    const bIsPaid = bNewPaidCents >= totalCents;

    // Atualização síncrona imediata para consistência atômica sob batching
    const nextBills = currentBills.map((b) => {
      if (b.id === billId) {
        return {
          ...b,
          paid_amount: fromCents(bNewPaidCents),
          status: bIsPaid ? ('paid' as const) : ('partially_paid' as const),
          paid_at: bIsPaid ? paymentDate : b.paid_at,
        };
      }
      return b;
    });

    const nextAccounts = (accountId && !isExpenseTracker)
      ? currentAccounts.map((a) =>
          a.id === accountId
            ? { ...a, current_balance: fromCents(toCents(a.current_balance) - paymentCents) }
            : a
        )
      : currentAccounts;

    let nextInstallments = stateRef.current.allInstallments;
    let nextTransactions = stateRef.current.allTransactions;

    if (bIsPaid) {
      nextInstallments = nextInstallments.map((inst) =>
        inst.credit_card_bill_id === billId
          ? { ...inst, status: 'paid', paid_amount: inst.amount, paid_at: paymentDate }
          : inst
      );
      nextTransactions = nextTransactions.map((t) =>
        t.credit_card_bill_id === billId
          ? { ...t, status: 'paid', paid_amount: t.amount, paid_at: paymentDate }
          : t
      );
    }

    stateRef.current.allCreditCardBills = nextBills;
    stateRef.current.allAccounts = nextAccounts;
    stateRef.current.allPayments = [newPay, ...stateRef.current.allPayments];
    stateRef.current.allInstallments = nextInstallments;
    stateRef.current.allTransactions = nextTransactions;

    // Setters React puros e independentes
    setAllPayments((prev) => [newPay, ...prev]);

    if (accountId && !isExpenseTracker) {
      setAllAccounts((prev) =>
        prev.map((a) =>
          a.id === accountId
            ? { ...a, current_balance: fromCents(toCents(a.current_balance) - paymentCents) }
            : a
        )
      );
    }

    setAllCreditCardBills((prev) =>
      prev.map((b) => {
        if (b.id === billId) {
          const bPrevTotalCents = toCents(b.total_amount);
          const bPrevPaidCents = toCents(b.paid_amount || 0);
          const bCurrentPaidCents = bPrevPaidCents + paymentCents;
          const isFinished = bCurrentPaidCents >= bPrevTotalCents;
          return {
            ...b,
            paid_amount: fromCents(bCurrentPaidCents),
            status: isFinished ? ('paid' as const) : ('partially_paid' as const),
            paid_at: isFinished ? paymentDate : b.paid_at,
          };
        }
        return b;
      })
    );

    if (bIsPaid) {
      setAllInstallments((prevInst) =>
        prevInst.map((inst) =>
          inst.credit_card_bill_id === billId
            ? { ...inst, status: 'paid', paid_amount: inst.amount, paid_at: paymentDate }
            : inst
        )
      );
      setAllTransactions((prevTx) =>
        prevTx.map((t) =>
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
    const targetWsId = getActiveWsId();
    if (pmData.linked_account_id) {
      const acc = stateRef.current.allAccounts.find(
        (a) => a.id === pmData.linked_account_id && a.workspace_id === targetWsId
      );
      if (!acc) throw new Error('Conta vinculada ao método de pagamento não pertence ao workspace ativo.');
      if (acc.active === false) throw new Error('A conta bancária vinculada ao método de pagamento está inativa.');
    }
    const newPm: PaymentMethod = {
      ...pmData,
      id: generateId('pm'),
      workspace_id: targetWsId,
      created_at: new Date().toISOString(),
    };
    stateRef.current.allPaymentMethods = [...stateRef.current.allPaymentMethods, newPm];
    setAllPaymentMethods((prev) => [...prev, newPm]);
    return newPm;
  };

  // Funções de Categorias
  const addCategory = (catData: Omit<Category, 'id' | 'workspace_id' | 'created_at'>) => {
    const targetWsId = getActiveWsId();
    const newCat: Category = {
      ...catData,
      id: generateId('cat'),
      workspace_id: targetWsId,
      created_at: new Date().toISOString(),
    };
    stateRef.current.allCategories = [...stateRef.current.allCategories, newCat];
    setAllCategories((prev) => [...prev, newCat]);
    return newCat;
  };

  const updateCategory = (id: string, data: Omit<Partial<Category>, 'id' | 'workspace_id' | 'created_at'>) => {
    const targetWsId = getActiveWsId();
    stateRef.current.allCategories = stateRef.current.allCategories.map((c) =>
      c.id === id && c.workspace_id === targetWsId
        ? { ...c, ...data, id: c.id, workspace_id: c.workspace_id, created_at: c.created_at }
        : c
    );
    setAllCategories((prev) =>
      prev.map((c) =>
        c.id === id && c.workspace_id === targetWsId
          ? { ...c, ...data, id: c.id, workspace_id: c.workspace_id, created_at: c.created_at }
          : c
      )
    );
  };

  // Funções de Transações (com adição atômica de fatura)
  const addTransaction = (txData: Omit<Transaction, 'id' | 'workspace_id' | 'created_at'>) => {
    const targetWsId = getActiveWsId();
    const effectiveAccountId = resolveTransactionAccountId(
      txData.payment_method_id,
      txData.account_id,
      stateRef.current.allPaymentMethods,
      targetWsId
    );

    validateTransactionBusinessRules(
      { ...txData, account_id: effectiveAccountId },
      stateRef.current.allPaymentMethods,
      targetWsId
    );
    validateTransactionSplits(txData.amount, targetWsId, txData.paid_by_member_id, txData.splits, txData.split_type);

    if (effectiveAccountId) {
      const a = stateRef.current.allAccounts.find((acc) => acc.id === effectiveAccountId && acc.workspace_id === targetWsId);
      if (!a) throw new Error('Conta bancária informada não pertence ao workspace ativo.');
      if (a.active === false) throw new Error('A conta bancária informada está inativa.');
    }

    const cardId = resolveAndValidateCreditCard(targetWsId, txData.payment_method_id, txData.credit_card_id);
    if (txData.type === 'income' && cardId) {
      throw new Error('Receitas não podem ser vinculadas a cartão de crédito ou faturas.');
    }
    validateActiveCategory(targetWsId, txData.category_id);

    let billId: string | null = txData.credit_card_bill_id || null;

    if (cardId && !billId) {
      const card = stateRef.current.allCreditCards.find((c) => c.id === cardId && c.workspace_id === targetWsId);
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
          targetWsId
        );
      }
    }

    const effectiveSplitType: SplitType = txData.split_type || 'individual';
    const effectiveSplits = effectiveSplitType !== 'individual' ? txData.splits : undefined;

    const newTx: Transaction = {
      ...txData,
      id: generateId('tx'),
      workspace_id: targetWsId,
      account_id: effectiveAccountId,
      credit_card_id: cardId,
      credit_card_bill_id: billId,
      split_type: effectiveSplitType,
      splits: effectiveSplits,
      paid_amount: txData.status === 'paid' ? txData.amount : (txData.paid_amount || 0),
      created_at: new Date().toISOString(),
    };

    stateRef.current.allTransactions = [newTx, ...stateRef.current.allTransactions];
    setAllTransactions((prev) => [newTx, ...prev]);

    const activeWs = stateRef.current.allWorkspaces.find((w) => w.id === targetWsId);
    const isExpenseTracker = activeWs?.tracking_mode === 'expense_tracker';

    if (newTx.status === 'paid' && !newTx.credit_card_id) {
      const shouldMutateAccount = !!(newTx.account_id && !isExpenseTracker);

      if (shouldMutateAccount) {
        const currentCents = toCents(
          stateRef.current.allAccounts.find((a) => a.id === newTx.account_id)?.current_balance || 0
        );
        const amountCents = toCents(newTx.amount);
        const diffCents = newTx.type === 'expense' ? -amountCents : amountCents;

        stateRef.current.allAccounts = stateRef.current.allAccounts.map((acc) => {
          if (acc.id === newTx.account_id) {
            return { ...acc, current_balance: fromCents(currentCents + diffCents) };
          }
          return acc;
        });

        setAllAccounts((prev) =>
          prev.map((acc) => {
            if (acc.id === newTx.account_id) {
              const accCents = toCents(acc.current_balance);
              return { ...acc, current_balance: fromCents(accCents + diffCents) };
            }
            return acc;
          })
        );
      }

      const newPay: Payment = {
        id: generateId('pay'),
        workspace_id: targetWsId,
        transaction_id: newTx.id,
        account_id: newTx.account_id || null,
        payment_method_id: newTx.payment_method_id || undefined,
        amount: newTx.amount,
        payment_date: format(new Date(), 'yyyy-MM-dd'),
        created_by: 'usr-1',
        created_at: new Date().toISOString(),
        affects_balance: shouldMutateAccount,
      };
      stateRef.current.allPayments = [newPay, ...stateRef.current.allPayments];
      setAllPayments((prev) => [newPay, ...prev]);
    }

    return newTx;
  };

  // Edição segura de transações através de DTO estrito (bloqueia alteração contábil/estrutural direta)
  const updateTransaction = (
    id: string,
    data: UpdateTransactionDTO
  ) => {
    const targetWsId = getActiveWsId();
    const existing = stateRef.current.allTransactions.find((t) => t.id === id && t.workspace_id === targetWsId);
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
      validateActiveCategory(targetWsId, data.category_id);
    }

    const willChangeAmount = data.amount !== undefined && data.amount !== existing.amount;
    const willChangeSplitType = data.split_type !== undefined && data.split_type !== existing.split_type;
    const willChangePayer = data.paid_by_member_id !== undefined && data.paid_by_member_id !== existing.paid_by_member_id;

    const targetAmount = data.amount !== undefined ? data.amount : existing.amount;
    const targetSplitType = data.split_type !== undefined ? data.split_type : existing.split_type;
    const targetPayer = data.paid_by_member_id !== undefined ? data.paid_by_member_id : existing.paid_by_member_id;

    let reconciledSplits: TransactionSplit[] | undefined = undefined;

    const isTargetDivided = targetSplitType && targetSplitType !== 'individual';

    if (data.splits !== undefined) {
      validateTransactionSplits(targetAmount, targetWsId, targetPayer, data.splits, targetSplitType);
      reconciledSplits = data.splits;
    } else if (!isTargetDivided) {
      reconciledSplits = [];
    } else if (targetSplitType === 'equal' || targetSplitType === 'full_other') {
      const wsMembers = stateRef.current.allWorkspaceMembers.filter((m) => m.workspace_id === targetWsId);
      const effectivePayer = targetPayer || wsMembers[0]?.id;
      if (willChangeAmount || willChangeSplitType || willChangePayer || !existing.splits || existing.splits.length === 0) {
        reconciledSplits = calculateExpenseSplits(targetAmount, targetSplitType, wsMembers, effectivePayer);
      } else {
        validateTransactionSplits(targetAmount, targetWsId, targetPayer, existing.splits, targetSplitType);
      }
    } else if (targetSplitType === 'custom') {
      if (willChangeAmount || willChangeSplitType || willChangePayer || !existing.splits || existing.splits.length === 0) {
        throw new Error(
          'Ao alterar o valor total, pagador ou regra de uma transação com divisão personalizada, é obrigatório fornecer os novos valores de rateio correspondentes.'
        );
      }
      validateTransactionSplits(targetAmount, targetWsId, targetPayer, existing.splits, targetSplitType);
    }

    const nextTxs = stateRef.current.allTransactions.map((t) => {
      if (t.id === id && t.workspace_id === targetWsId) {
        return {
          ...t,
          description: data.description !== undefined ? data.description.trim() : t.description,
          amount: data.amount !== undefined ? data.amount : t.amount,
          category_id: data.category_id !== undefined ? data.category_id : t.category_id,
          due_date: data.due_date !== undefined ? data.due_date : t.due_date,
          transaction_date: data.transaction_date !== undefined ? data.transaction_date : t.transaction_date,
          notes: data.notes !== undefined ? data.notes : t.notes,
          paid_by_member_id: data.paid_by_member_id !== undefined ? data.paid_by_member_id : t.paid_by_member_id,
          split_type: targetSplitType,
          splits: reconciledSplits !== undefined ? (reconciledSplits.length > 0 ? reconciledSplits : undefined) : t.splits,
          updated_at: new Date().toISOString(),
        };
      }
      return t;
    });

    stateRef.current.allTransactions = nextTxs;

    setAllTransactions((prev) =>
      prev.map((t) => {
        if (t.id === id && t.workspace_id === targetWsId) {
          return {
            ...t,
            description: data.description !== undefined ? data.description.trim() : t.description,
            amount: data.amount !== undefined ? data.amount : t.amount,
            category_id: data.category_id !== undefined ? data.category_id : t.category_id,
            due_date: data.due_date !== undefined ? data.due_date : t.due_date,
            transaction_date: data.transaction_date !== undefined ? data.transaction_date : t.transaction_date,
            notes: data.notes !== undefined ? data.notes : t.notes,
            paid_by_member_id: data.paid_by_member_id !== undefined ? data.paid_by_member_id : t.paid_by_member_id,
            split_type: targetSplitType,
            splits: reconciledSplits !== undefined ? (reconciledSplits.length > 0 ? reconciledSplits : undefined) : t.splits,
            updated_at: new Date().toISOString(),
          };
        }
        return t;
      })
    );
  };

  // Exclusão Transacional com Proteção Rigorosa Anti-Overpayment
  const deleteTransaction = (id: string) => {
    const targetWsId = getActiveWsId();
    const tx = stateRef.current.allTransactions.find((t) => t.id === id && t.workspace_id === targetWsId);
    if (!tx) return;

    if (tx.credit_card_bill_id) {
      const bill = stateRef.current.allCreditCards ? stateRef.current.allCreditCardBills.find((b) => b.id === tx.credit_card_bill_id) : undefined;
      if (bill) {
        const reconciled = reconcileBillAfterItemDeletion(bill, tx.amount);
        stateRef.current.allCreditCardBills = stateRef.current.allCreditCardBills.map((b) =>
          b.id === tx.credit_card_bill_id ? reconciled : b
        );
        setAllCreditCardBills((prev) =>
          prev.map((b) => (b.id === tx.credit_card_bill_id ? reconciled : b))
        );
      }
    }

    // Reversão rigorosa de saldo por conta baseada na proveniência contábil (P0-01):
    // Reverte cada Payment na conta bancária que recebeu o débito/crédito efetivo.
    // Se o pagamento registrou affects_balance=true, estorna a conta mesmo se o modo atual for tracker.
    // Se registrou affects_balance=false, nunca estorna a conta, mesmo se o modo atual for full.
    // Para pagamentos legados sem affects_balance, infere da presença de account_id.
    const txPayments = stateRef.current.allPayments.filter((p) => p.transaction_id === id);
    const accountAdjustments = new Map<string, number>();

    let recordedPaidCents = 0;
    for (const p of txPayments) {
      const didAffectBalance = p.affects_balance !== undefined ? p.affects_balance : Boolean(p.account_id);
      if (p.account_id && didAffectBalance) {
        const pCents = toCents(p.amount);
        recordedPaidCents += pCents;
        // Despesa debitou a conta do pagamento; estorno credita (+).
        // Receita creditou a conta do pagamento; estorno debita (-).
        const diff = tx.type === 'expense' ? pCents : -pCents;
        accountAdjustments.set(p.account_id, (accountAdjustments.get(p.account_id) || 0) + diff);
      }
    }

    // Suporte a dados legados (quando tx.status === 'paid' ou 'partially_paid' mas o valor pago não possui Payments registrados)
    // CRÍTICO P0-02: Só pode rodar se txPayments.length === 0!
    // Se a transação possui pagamentos registrados, eles são a fonte única da verdade contábil.
    if (txPayments.length === 0 && tx.account_id && !tx.credit_card_id && (tx.status === 'paid' || tx.status === 'partially_paid')) {
      const totalPaidCents = toCents(tx.paid_amount || (tx.status === 'paid' ? tx.amount : 0));
      const unrecordedPaidCents = Math.max(0, totalPaidCents - recordedPaidCents);
      if (unrecordedPaidCents > 0) {
        const diff = tx.type === 'expense' ? unrecordedPaidCents : -unrecordedPaidCents;
        accountAdjustments.set(tx.account_id, (accountAdjustments.get(tx.account_id) || 0) + diff);
      }
    }

    if (accountAdjustments.size > 0) {
      stateRef.current.allAccounts = stateRef.current.allAccounts.map((acc) => {
        const diff = accountAdjustments.get(acc.id);
        if (diff) {
          const currentCents = toCents(acc.current_balance);
          return { ...acc, current_balance: fromCents(currentCents + diff) };
        }
        return acc;
      });

      setAllAccounts((prev) =>
        prev.map((acc) => {
          const diff = accountAdjustments.get(acc.id);
          if (diff) {
            const currentCents = toCents(acc.current_balance);
            return { ...acc, current_balance: fromCents(currentCents + diff) };
          }
          return acc;
        })
      );
    }

    stateRef.current.allPayments = stateRef.current.allPayments.filter((p) => p.transaction_id !== id);
    stateRef.current.allTransactions = stateRef.current.allTransactions.filter((t) => t.id !== id);

    setAllPayments((prev) => prev.filter((p) => p.transaction_id !== id));
    setAllTransactions((prev) => prev.filter((t) => t.id !== id));
  };

  // Duplicação de Transação Atômica (passa pelas mesmas regras de negócio e validações de addTransaction)
  const duplicateTransaction = (id: string) => {
    const targetWsId = getActiveWsId();
    const tx = stateRef.current.allTransactions.find((t) => t.id === id && t.workspace_id === targetWsId);
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
      paid_by_member_id: tx.paid_by_member_id,
      split_type: tx.split_type,
      splits: tx.splits ? [...tx.splits] : undefined,
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
    paid_by_member_id?: string;
    split_type?: SplitType;
    splits?: TransactionSplit[];
  }) => {
    if (typeof data.total_amount !== 'number' || !Number.isFinite(data.total_amount) || data.total_amount <= 0) {
      throw new Error('O valor total da compra parcelada deve ser maior que zero.');
    }

    const targetWsId = getActiveWsId();
    const effectiveAccountId = resolveTransactionAccountId(
      data.payment_method_id,
      data.account_id,
      stateRef.current.allPaymentMethods,
      targetWsId
    );

    if (effectiveAccountId) {
      const a = stateRef.current.allAccounts.find((acc) => acc.id === effectiveAccountId && acc.workspace_id === targetWsId);
      if (!a) throw new Error('Conta bancária informada não pertence ao workspace ativo.');
      if (a.active === false) throw new Error('A conta bancária informada está inativa.');
    }

    const effectiveCardId = resolveAndValidateCreditCard(targetWsId, data.payment_method_id, data.credit_card_id);
    validateTransactionBusinessRules(
      {
        type: 'expense',
        credit_card_id: effectiveCardId || data.credit_card_id,
        payment_method_id: data.payment_method_id,
        account_id: effectiveAccountId,
      },
      stateRef.current.allPaymentMethods,
      targetWsId
    );
    validateActiveCategory(targetWsId, data.category_id);
    validateTransactionSplits(data.total_amount, targetWsId, data.paid_by_member_id, data.splits, data.split_type);

    const paidCount = Math.max(0, Math.min(data.installment_count, data.paid_installments_count || 0));
    const card = effectiveCardId ? stateRef.current.allCreditCards.find((c) => c.id === effectiveCardId && c.workspace_id === targetWsId) : undefined;
    const split = splitInstallments(data.total_amount, data.installment_count, data.purchase_date, card, paidCount);

    if (split.length === 0) {
      throw new Error('Parâmetros de parcelamento inválidos.');
    }

    const effectiveSplitType: SplitType = data.split_type || 'individual';
    const effectiveSplits = effectiveSplitType !== 'individual' ? data.splits : undefined;

    const newPurchase: Purchase = {
      ...data,
      id: generateId('pur'),
      workspace_id: targetWsId,
      paid_installments_count: paidCount,
      credit_card_id: effectiveCardId,
      account_id: effectiveAccountId,
      paid_by_member_id: data.paid_by_member_id,
      split_type: effectiveSplitType,
      splits: effectiveSplits,
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
          targetWsId,
          s.isPaid
        );
      }

      return {
        id: generateId('inst'),
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
    if (paidCount > 0) {
      generatedInstallments.forEach((inst, idx) => {
        if (split[idx]?.isPaid) {
          generatedPayments.push({
            id: generateId('pay'),
            workspace_id: targetWsId,
            installment_id: inst.id,
            account_id: effectiveAccountId || null,
            payment_method_id: data.payment_method_id,
            amount: inst.amount,
            payment_date: inst.paid_at || inst.due_date,
            notes: 'Quitação prévia de parcela importada',
            created_by: 'usr-1',
            created_at: new Date().toISOString(),
            affects_balance: false,
          });
        }
      });
    }

    stateRef.current.allPurchases = [newPurchase, ...stateRef.current.allPurchases];
    stateRef.current.allInstallments = [...stateRef.current.allInstallments, ...generatedInstallments];
    if (generatedPayments.length > 0) {
      stateRef.current.allPayments = [...generatedPayments, ...stateRef.current.allPayments];
    }

    setAllPurchases((prev) => [newPurchase, ...prev]);
    setAllInstallments((prev) => [...prev, ...generatedInstallments]);
    if (generatedPayments.length > 0) {
      setAllPayments((prev) => [...generatedPayments, ...prev]);
    }
    return newPurchase;
  };

  // Registro de Pagamento (com validação atômica sob batching V36 / P1-01 e P1-02)
  const recordPayment = (data: {
    transaction_id?: string;
    installment_id?: string;
    credit_card_bill_id?: string;
    account_id?: string | null;
    payment_method_id?: string;
    amount: number;
    payment_date: string;
    notes?: string;
  }): Payment => {
    const paymentCents = toCents(data.amount);
    if (!Number.isFinite(data.amount) || data.amount <= 0 || paymentCents <= 0 || !Number.isSafeInteger(paymentCents)) {
      throw new Error('O valor do pagamento deve ser estritamente maior que zero.');
    }

    const targetsCount =
      (data.transaction_id ? 1 : 0) +
      (data.installment_id ? 1 : 0) +
      (data.credit_card_bill_id ? 1 : 0);

    if (targetsCount !== 1) {
      throw new Error('Informe exatamente uma obrigação de destino para o pagamento.');
    }

    const targetWsId = getActiveWsId();
    const activeWs = stateRef.current.allWorkspaces.find((w) => w.id === targetWsId);
    const isExpenseTracker = activeWs?.tracking_mode === 'expense_tracker';
    const currentAccounts = stateRef.current.allAccounts;
    const acc = validatePaymentAccount(data.account_id, currentAccounts, targetWsId, isExpenseTracker);

    if (data.payment_method_id) {
      const pm = stateRef.current.allPaymentMethods.find((p) => p.id === data.payment_method_id && p.workspace_id === targetWsId);
      if (!pm) throw new Error('Método de pagamento não pertence ao workspace ativo.');
    }

    // 1. Transação avulsa
    if (data.transaction_id) {
      const currentTxs = stateRef.current.allTransactions;
      const tx = currentTxs.find((t) => t.id === data.transaction_id && t.workspace_id === targetWsId);
      if (!tx) throw new Error('Transação não encontrada no workspace ativo.');

      if (tx.credit_card_bill_id || tx.credit_card_id) {
        throw new Error('Itens vinculados a cartão de crédito devem ser quitados exclusivamente através da fatura correspondente.');
      }

      const totalCents = toCents(tx.amount);
      const paidCents = toCents(tx.paid_amount || 0);
      const remainingCents = Math.max(0, totalCents - paidCents);
      if (paymentCents > remainingCents) {
        throw new Error(
          `Valor do pagamento (R$ ${data.amount.toFixed(2)}) excede o saldo restante da transação (R$ ${(remainingCents / 100).toFixed(2)}).`
        );
      }

      const tCurrentPaidCents = paidCents + paymentCents;
      const tIsFull = tCurrentPaidCents >= totalCents;

      const finalAmount = fromCents(paymentCents);
      const shouldMutateAccount = !!(acc && data.account_id && !isExpenseTracker);
      const newPay: Payment = {
        id: generateId('pay'),
        workspace_id: targetWsId,
        transaction_id: data.transaction_id,
        account_id: data.account_id || null,
        payment_method_id: data.payment_method_id,
        amount: finalAmount,
        payment_date: data.payment_date,
        notes: data.notes,
        created_by: 'usr-1',
        created_at: new Date().toISOString(),
        affects_balance: shouldMutateAccount,
      };

      // Atualização síncrona imediata para consistência atômica
      const nextTxs = currentTxs.map((t) => {
        if (t.id === data.transaction_id) {
          return {
            ...t,
            paid_amount: fromCents(tCurrentPaidCents),
            status: tIsFull ? ('paid' as const) : ('partially_paid' as const),
            paid_at: tIsFull ? data.payment_date : t.paid_at,
          };
        }
        return t;
      });

      const nextAccounts = shouldMutateAccount
        ? currentAccounts.map((a) => {
            if (a.id === data.account_id) {
              const currentBalanceCents = toCents(a.current_balance);
              const diffCents = tx.type === 'expense' ? -paymentCents : paymentCents;
              return { ...a, current_balance: fromCents(currentBalanceCents + diffCents) };
            }
            return a;
          })
        : currentAccounts;

      stateRef.current.allTransactions = nextTxs;
      stateRef.current.allAccounts = nextAccounts;
      stateRef.current.allPayments = [newPay, ...stateRef.current.allPayments];

      setAllTransactions((prev) =>
        prev.map((t) => {
          if (t.id === data.transaction_id) {
            return {
              ...t,
              paid_amount: fromCents(tCurrentPaidCents),
              status: tIsFull ? 'paid' : 'partially_paid',
              paid_at: tIsFull ? data.payment_date : t.paid_at,
            };
          }
          return t;
        })
      );

      if (shouldMutateAccount) {
        setAllAccounts((prev) =>
          prev.map((a) => {
            if (a.id === data.account_id) {
              const currentBalanceCents = toCents(a.current_balance);
              const diffCents = tx.type === 'expense' ? -paymentCents : paymentCents;
              return { ...a, current_balance: fromCents(currentBalanceCents + diffCents) };
            }
            return a;
          })
        );
      }

      setAllPayments((prev) => [newPay, ...prev]);
      return newPay;
    }

    // 2. Parcela
    if (data.installment_id) {
      const currentInsts = stateRef.current.allInstallments;
      const inst = currentInsts.find((i) => i.id === data.installment_id);
      if (!inst) throw new Error('Parcela não encontrada.');

      const pur = stateRef.current.allPurchases.find((p) => p.id === inst.purchase_id && p.workspace_id === targetWsId);
      if (!pur) throw new Error('Compra associada à parcela não pertence ao workspace ativo.');

      if (inst.credit_card_bill_id || pur.credit_card_id) {
        throw new Error('Parcelas vinculadas a cartão de crédito devem ser quitadas exclusivamente através da fatura correspondente.');
      }

      const totalCents = toCents(inst.amount);
      const paidCents = toCents(inst.paid_amount || 0);
      const remainingCents = Math.max(0, totalCents - paidCents);
      if (paymentCents > remainingCents) {
        throw new Error(
          `Valor do pagamento (R$ ${data.amount.toFixed(2)}) excede o saldo restante da parcela (R$ ${(remainingCents / 100).toFixed(2)}).`
        );
      }

      const iCurrentPaidCents = paidCents + paymentCents;
      const iIsFull = iCurrentPaidCents >= totalCents;

      const finalAmount = fromCents(paymentCents);
      const shouldMutateAccount = !!(acc && data.account_id && !isExpenseTracker);
      const newPay: Payment = {
        id: generateId('pay'),
        workspace_id: targetWsId,
        installment_id: data.installment_id,
        account_id: data.account_id || null,
        payment_method_id: data.payment_method_id,
        amount: finalAmount,
        payment_date: data.payment_date,
        notes: data.notes,
        created_by: 'usr-1',
        created_at: new Date().toISOString(),
        affects_balance: shouldMutateAccount,
      };

      const nextInsts = currentInsts.map((i) => {
        if (i.id === data.installment_id) {
          return {
            ...i,
            paid_amount: fromCents(iCurrentPaidCents),
            status: iIsFull ? ('paid' as const) : ('partially_paid' as const),
            paid_at: iIsFull ? data.payment_date : i.paid_at,
          };
        }
        return i;
      });

      const nextAccounts = shouldMutateAccount
        ? currentAccounts.map((a) =>
            a.id === data.account_id
              ? { ...a, current_balance: fromCents(toCents(a.current_balance) - paymentCents) }
              : a
          )
        : currentAccounts;

      stateRef.current.allInstallments = nextInsts;
      stateRef.current.allAccounts = nextAccounts;
      stateRef.current.allPayments = [newPay, ...stateRef.current.allPayments];

      setAllInstallments((prev) =>
        prev.map((i) => {
          if (i.id === data.installment_id) {
            return {
              ...i,
              paid_amount: fromCents(iCurrentPaidCents),
              status: iIsFull ? 'paid' : 'partially_paid',
              paid_at: iIsFull ? data.payment_date : i.paid_at,
            };
          }
          return i;
        })
      );

      if (shouldMutateAccount) {
        setAllAccounts((prev) =>
          prev.map((a) =>
            a.id === data.account_id
              ? { ...a, current_balance: fromCents(toCents(a.current_balance) - paymentCents) }
              : a
          )
        );
      }

      setAllPayments((prev) => [newPay, ...prev]);
      return newPay;
    }

    // 3. Fatura de cartão
    if (data.credit_card_bill_id) {
      return payCreditCardBill(data.credit_card_bill_id, data.account_id, data.amount, data.payment_date, data.notes);
    }

    throw new Error('Tipo de pagamento não suportado.');
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

    const transferCents = toCents(amount);
    if (!Number.isFinite(amount) || amount <= 0 || transferCents <= 0 || !Number.isSafeInteger(transferCents)) {
      throw new Error('O valor da transferência deve ser de pelo menos R$ 0,01.');
    }

    const targetWsId = getActiveWsId();
    const activeWs = stateRef.current.allWorkspaces.find((w) => w.id === targetWsId);
    if (activeWs?.tracking_mode === 'expense_tracker') {
      throw new Error('Transferências entre contas não são permitidas no modo Apenas Despesas.');
    }

    const fromAcc = stateRef.current.allAccounts.find((a) => a.id === fromAccountId && a.workspace_id === targetWsId);
    const toAcc = stateRef.current.allAccounts.find((a) => a.id === toAccountId && a.workspace_id === targetWsId);
    if (!fromAcc || !toAcc) {
      throw new Error('As contas informadas devem pertencer ao workspace ativo.');
    }
    if (fromAcc.active === false || toAcc.active === false) {
      throw new Error('A conta bancária informada está inativa.');
    }

    const finalAmount = fromCents(transferCents);

    const newTransfer: Transfer = {
      id: generateId('trf'),
      workspace_id: targetWsId,
      from_account_id: fromAccountId,
      to_account_id: toAccountId,
      amount: finalAmount,
      transfer_date: date,
      notes: notes || undefined,
      created_by: 'usr-1',
      created_at: new Date().toISOString(),
      from_account: fromAcc,
      to_account: toAcc,
    };

    stateRef.current.allTransfers = [newTransfer, ...stateRef.current.allTransfers];
    setAllTransfers((prev) => [newTransfer, ...prev]);

    const nextAccounts = stateRef.current.allAccounts.map((acc) => {
      if (acc.id === fromAccountId) {
        return { ...acc, current_balance: fromCents(toCents(acc.current_balance) - transferCents) };
      }
      if (acc.id === toAccountId) {
        return { ...acc, current_balance: fromCents(toCents(acc.current_balance) + transferCents) };
      }
      return acc;
    });
    stateRef.current.allAccounts = nextAccounts;

    setAllAccounts((prev) =>
      prev.map((acc) => {
        if (acc.id === fromAccountId) {
          return { ...acc, current_balance: fromCents(toCents(acc.current_balance) - transferCents) };
        }
        if (acc.id === toAccountId) {
          return { ...acc, current_balance: fromCents(toCents(acc.current_balance) + transferCents) };
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
    const targetWsId = getActiveWsId();
    const effectiveAccountId = resolveTransactionAccountId(
      data.payment_method_id,
      data.account_id,
      stateRef.current.allPaymentMethods,
      targetWsId
    );

    if (effectiveAccountId) {
      const a = stateRef.current.allAccounts.find((acc) => acc.id === effectiveAccountId && acc.workspace_id === targetWsId);
      if (!a) throw new Error('Conta bancária informada não pertence ao workspace ativo.');
      if (a.active === false) throw new Error('A conta bancária informada está inativa.');
    }
    const effectiveCardId = resolveAndValidateCreditCard(targetWsId, data.payment_method_id, data.credit_card_id);
    validateTransactionBusinessRules(
      {
        type: data.type,
        credit_card_id: effectiveCardId || data.credit_card_id,
        payment_method_id: data.payment_method_id,
        account_id: effectiveAccountId,
      },
      stateRef.current.allPaymentMethods,
      targetWsId
    );
    validateActiveCategory(targetWsId, data.category_id);

    const newRec: RecurringTransaction = {
      ...data,
      id: generateId('rec'),
      workspace_id: targetWsId,
      account_id: effectiveAccountId,
      credit_card_id: effectiveCardId || undefined,
      active: true,
      suspended_reason: null,
      created_at: new Date().toISOString(),
    };
    stateRef.current.allRecurring = [...stateRef.current.allRecurring, newRec];
    setAllRecurring((prev) => [...prev, newRec]);
    setTimeout(() => processPendingRecurring(), 0);
    return newRec;
  };

  const toggleRecurring = (id: string) => {
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const targetWsId = getActiveWsId();
    const updateFn = (r: RecurringTransaction) => {
      if (r.id === id && r.workspace_id === targetWsId) {
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
    };
    stateRef.current.allRecurring = stateRef.current.allRecurring.map(updateFn);
    setAllRecurring((prev) => prev.map(updateFn));
    setTimeout(() => processPendingRecurring(), 0);
  };

  const deleteRecurring = (id: string) => {
    const targetWsId = getActiveWsId();
    stateRef.current.allRecurring = stateRef.current.allRecurring.filter(
      (r) => !(r.id === id && r.workspace_id === targetWsId)
    );
    setAllRecurring((prev) => prev.filter((r) => !(r.id === id && r.workspace_id === targetWsId)));
  };

  // Orçamentos
  const setBudget = (
    categoryId: string,
    plannedAmount: number,
    month: number = new Date().getMonth() + 1,
    year: number = new Date().getFullYear()
  ) => {
    const targetWsId = getActiveWsId();
    setAllBudgets((prev) => {
      const existingIndex = prev.findIndex(
        (b) => b.category_id === categoryId && b.month === month && b.year === year && b.workspace_id === targetWsId
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
          workspace_id: targetWsId,
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
    const targetWsId = getActiveWsId();
    const newGoal: FinancialGoal = {
      ...goalData,
      id: generateId('goal'),
      workspace_id: targetWsId,
      created_at: new Date().toISOString(),
    };
    stateRef.current.allGoals = [...stateRef.current.allGoals, newGoal];
    setAllGoals((prev) => [...prev, newGoal]);
    return newGoal;
  };

  const updateGoal = (id: string, data: Omit<Partial<FinancialGoal>, 'id' | 'workspace_id' | 'created_at'>) => {
    const targetWsId = getActiveWsId();
    stateRef.current.allGoals = stateRef.current.allGoals.map((g) =>
      g.id === id && g.workspace_id === targetWsId
        ? { ...g, ...data, id: g.id, workspace_id: g.workspace_id, created_at: g.created_at }
        : g
    );

    setAllGoals((prev) =>
      prev.map((g) =>
        g.id === id && g.workspace_id === targetWsId
          ? { ...g, ...data, id: g.id, workspace_id: g.workspace_id, created_at: g.created_at }
          : g
      )
    );
  };

  const depositGoal = (goalId: string, amount: number, accountId: string) => {
    const depositCents = toCents(amount);
    if (!Number.isFinite(amount) || amount <= 0 || depositCents <= 0 || !Number.isSafeInteger(depositCents)) {
      throw new Error('Valor inválido para depósito na meta.');
    }
    const targetWsId = getActiveWsId();
    const activeWs = stateRef.current.allWorkspaces.find((w) => w.id === targetWsId);
    if (activeWs?.tracking_mode === 'expense_tracker') {
      throw new Error('Aportes em metas financeiras não são permitidos no modo Apenas Despesas.');
    }

    const goal = stateRef.current.allGoals.find((g) => g.id === goalId && g.workspace_id === targetWsId);
    if (!goal) throw new Error('Meta financeira não encontrada no workspace ativo.');

    const acc = stateRef.current.allAccounts.find((a) => a.id === accountId && a.workspace_id === targetWsId);
    if (!acc) throw new Error('Conta bancária não encontrada no workspace ativo.');
    if (acc.active === false) throw new Error('A conta bancária informada está inativa.');

    const currentCents = toCents(goal.current_amount || 0);
    const targetCents = toCents(goal.target_amount);
    const newCurrentCents = currentCents + depositCents;
    const isCompleted = newCurrentCents >= targetCents;

    const nextGoals = stateRef.current.allGoals.map((g) => {
      if (g.id === goalId && g.workspace_id === targetWsId) {
        return {
          ...g,
          current_amount: fromCents(newCurrentCents),
          status: isCompleted ? ('completed' as const) : g.status,
        };
      }
      return g;
    });

    const nextAccounts = stateRef.current.allAccounts.map((a) =>
      a.id === accountId && a.workspace_id === targetWsId
        ? { ...a, current_balance: fromCents(toCents(a.current_balance) - depositCents) }
        : a
    );

    stateRef.current.allGoals = nextGoals;
    stateRef.current.allAccounts = nextAccounts;

    setAllGoals((prev) =>
      prev.map((g) => {
        if (g.id === goalId && g.workspace_id === targetWsId) {
          const gCurrentCents = toCents(g.current_amount || 0);
          const gTargetCents = toCents(g.target_amount);
          const gNewCurrentCents = gCurrentCents + depositCents;
          const gIsCompleted = gNewCurrentCents >= gTargetCents;
          return {
            ...g,
            current_amount: fromCents(gNewCurrentCents),
            status: gIsCompleted ? 'completed' : g.status,
          };
        }
        return g;
      })
    );
    setAllAccounts((prev) =>
      prev.map((a) =>
        a.id === accountId && a.workspace_id === targetWsId
          ? { ...a, current_balance: fromCents(toCents(a.current_balance) - depositCents) }
          : a
      )
    );
  };

  // Registro de Acerto de Contas / Quitação de Rateio
  const recordSettlement = (data: {
    from_member_id: string;
    to_member_id: string;
    amount: number;
    settlement_date?: string;
    notes?: string;
    payment_account_id?: string;
  }): Settlement => {
    const targetWsId = getActiveWsId();
    const { pairwiseDebts } = calculateMemberNetBalances(
      stateRef.current.allTransactions,
      stateRef.current.allSettlements,
      stateRef.current.allWorkspaceMembers,
      targetWsId,
      stateRef.current.allPurchases
    );

    if (data.payment_account_id) {
      const acc = stateRef.current.allAccounts.find(
        (a) => a.id === data.payment_account_id && a.workspace_id === targetWsId
      );
      if (!acc) {
        throw new Error('A conta bancária informada para o acerto não pertence ao workspace ativo.');
      }
      if (acc.active === false) {
        throw new Error('A conta bancária informada para o acerto está inativa.');
      }
    }

    validateSettlement(
      data.from_member_id,
      data.to_member_id,
      data.amount,
      stateRef.current.allWorkspaceMembers,
      targetWsId,
      pairwiseDebts
    );

    const newSettlement: Settlement = {
      id: generateId('set'),
      workspace_id: targetWsId,
      from_member_id: data.from_member_id,
      to_member_id: data.to_member_id,
      amount: roundCurrency(data.amount),
      settlement_date: data.settlement_date || format(new Date(), 'yyyy-MM-dd'),
      notes: data.notes,
      payment_account_id: data.payment_account_id,
      created_at: new Date().toISOString(),
    };

    stateRef.current.allSettlements = [newSettlement, ...stateRef.current.allSettlements];
    setAllSettlements((prev) => [newSettlement, ...prev]);

    return newSettlement;
  };

  const deleteSettlement = (id: string) => {
    const targetWsId = getActiveWsId();
    stateRef.current.allSettlements = stateRef.current.allSettlements.filter(
      (s) => !(s.id === id && s.workspace_id === targetWsId)
    );
    setAllSettlements((prev) => prev.filter((s) => !(s.id === id && s.workspace_id === targetWsId)));
  };

  return (
    <FinanceContext.Provider
      value={{
        isLoaded,
        workspaces: allWorkspaces,
        activeWorkspace,
        workspaceMembers,
        setActiveWorkspaceId: handleSetActiveWorkspaceId,
        createWorkspace,
        updateWorkspace,
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

        settlements,
        recordSettlement,
        deleteSettlement,

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
