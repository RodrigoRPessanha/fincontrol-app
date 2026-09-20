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
import { FinanceState, FinanceContextType } from './finance-state';
import { loadFinanceSnapshot, saveFinanceSnapshot } from './finance-storage';
import { FinanceActionDeps } from './actions/types';
import * as actions from './actions';

export type { FinanceContextType };

const FinanceContext = createContext<FinanceContextType | undefined>(undefined);

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
  const stateRef = useRef<FinanceState>({
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
    allBudgets,
    allSettlements,
  });
  const canPersistRef = useRef<boolean>(true);

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
      allBudgets,
      allSettlements,
    };
  });

  // Carregamento Determinístico Seguro no Mount + Saneamento Idempotente de Dados Legados V20 (P0-01)
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const { snapshot: loaded, errors, canPersist } = loadFinanceSnapshot(localStorage);
        canPersistRef.current = canPersist;
        if (!canPersist) {
          console.warn('FinControl: operando em modo somente-leitura (schema de versão futura detectado).');
        }
        if (errors.length > 0) {
          console.warn('FinControl: aviso na recuperação do localStorage:', errors);
        }
        stateRef.current = loaded;
        setAllWorkspaces(loaded.allWorkspaces);
        setActiveWorkspaceId(loaded.activeWorkspaceId);
        setAllWorkspaceMembers(loaded.allWorkspaceMembers);
        setAllAccounts(loaded.allAccounts);
        setAllCreditCards(loaded.allCreditCards);
        setAllCreditCardBills(loaded.allCreditCardBills);
        setAllPaymentMethods(loaded.allPaymentMethods);
        setAllCategories(loaded.allCategories);
        setAllTransactions(loaded.allTransactions);
        setAllPurchases(loaded.allPurchases);
        setAllInstallments(loaded.allInstallments);
        setAllPayments(loaded.allPayments);
        setAllTransfers(loaded.allTransfers);
        setAllRecurring(loaded.allRecurring);
        setAllBudgets(loaded.allBudgets);
        setAllGoals(loaded.allGoals);
        setAllSettlements(loaded.allSettlements);
      } catch (e) {
        console.error('Erro ao hidratar dados locais:', e);
      } finally {
        setIsLoaded(true);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // Sincronização com LocalStorage (SOMENTE após isLoaded = true e se canPersist = true)
  useEffect(() => {
    if (!isLoaded || typeof window === 'undefined' || !canPersistRef.current) return;
    saveFinanceSnapshot(localStorage, stateRef.current);
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

  // Contrato desacoplado de dependências para actions de domínio
  const deps: FinanceActionDeps = useMemo(
    () => ({
      getState: () => stateRef.current,
      commit: (next: FinanceState) => {
        if (!canPersistRef.current) {
          throw new Error('Operação bloqueada: o aplicativo está em modo somente leitura para proteger dados de uma versão futura.');
        }
        const prev = stateRef.current;
        stateRef.current = next;
        if (next.allWorkspaces !== prev.allWorkspaces) setAllWorkspaces(next.allWorkspaces);
        if (next.activeWorkspaceId !== prev.activeWorkspaceId) setActiveWorkspaceId(next.activeWorkspaceId);
        if (next.allWorkspaceMembers !== prev.allWorkspaceMembers) setAllWorkspaceMembers(next.allWorkspaceMembers);
        if (next.allAccounts !== prev.allAccounts) setAllAccounts(next.allAccounts);
        if (next.allCreditCards !== prev.allCreditCards) setAllCreditCards(next.allCreditCards);
        if (next.allCreditCardBills !== prev.allCreditCardBills) setAllCreditCardBills(next.allCreditCardBills);
        if (next.allPaymentMethods !== prev.allPaymentMethods) setAllPaymentMethods(next.allPaymentMethods);
        if (next.allCategories !== prev.allCategories) setAllCategories(next.allCategories);
        if (next.allTransactions !== prev.allTransactions) setAllTransactions(next.allTransactions);
        if (next.allPurchases !== prev.allPurchases) setAllPurchases(next.allPurchases);
        if (next.allInstallments !== prev.allInstallments) setAllInstallments(next.allInstallments);
        if (next.allPayments !== prev.allPayments) setAllPayments(next.allPayments);
        if (next.allTransfers !== prev.allTransfers) setAllTransfers(next.allTransfers);
        if (next.allRecurring !== prev.allRecurring) setAllRecurring(next.allRecurring);
        if (next.allBudgets !== prev.allBudgets) setAllBudgets(next.allBudgets);
        if (next.allGoals !== prev.allGoals) setAllGoals(next.allGoals);
        if (next.allSettlements !== prev.allSettlements) setAllSettlements(next.allSettlements);
      },
      generateId,
      now: () => new Date(),
    }),
    []
  );

  const activeWorkspace = useMemo(() => {
    return allWorkspaces.find((w) => w.id === activeWorkspaceId) || allWorkspaces[0] || mockWorkspaces[0];
  }, [allWorkspaces, activeWorkspaceId]);

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

  // Executa processamento de recorrências SOMENTE após a conclusão da hidratação local e se canPersist = true
  const processPendingRecurring = useCallback(() => {
    if (!isLoaded) return;
    if (!canPersistRef.current) {
      throw new Error('Operação bloqueada: o aplicativo está em modo somente leitura para proteger dados de uma versão futura.');
    }
    actions.processPendingRecurring(deps);
  }, [deps, isLoaded]);

  useEffect(() => {
    if (!isLoaded || !canPersistRef.current) return;
    const timer = setTimeout(() => {
      processPendingRecurring();
    }, 0);
    return () => clearTimeout(timer);
  }, [isLoaded, processPendingRecurring]);

  // Handlers que delegam para os módulos de domínio
  const handleSetActiveWorkspaceId = useCallback(
    (id: string) => actions.setActiveWorkspaceId(deps, id),
    [deps]
  );
  const handleCreateWorkspace = useCallback(
    (name: string, tracking_mode?: WorkspaceTrackingMode) => actions.createWorkspace(deps, name, tracking_mode),
    [deps]
  );
  const handleUpdateWorkspace = useCallback(
    (id: string, data: Partial<Workspace>) => actions.updateWorkspace(deps, id, data),
    [deps]
  );
  const handleAddWorkspaceMember = useCallback(
    (email: string, role: 'admin' | 'member' | 'viewer') => actions.addWorkspaceMember(deps, email, role),
    [deps]
  );

  const handleAddAccount = useCallback(
    (accountData: Omit<Account, 'id' | 'workspace_id' | 'created_at'>) => actions.addAccount(deps, accountData),
    [deps]
  );
  const handleUpdateAccount = useCallback(
    (id: string, data: Omit<Partial<Account>, 'id' | 'workspace_id' | 'created_at'>) => actions.updateAccount(deps, id, data),
    [deps]
  );
  const handleDeleteAccount = useCallback(
    (id: string) => actions.deleteAccount(deps, id),
    [deps]
  );

  const handleAddCreditCard = useCallback(
    (cardData: Omit<CreditCard, 'id' | 'workspace_id' | 'created_at'>) => actions.addCreditCard(deps, cardData),
    [deps]
  );
  const handleUpdateCreditCard = useCallback(
    (id: string, data: Omit<Partial<CreditCard>, 'id' | 'workspace_id' | 'created_at'>) => actions.updateCreditCard(deps, id, data),
    [deps]
  );
  const handlePayCreditCardBill = useCallback(
    (billId: string, accountId?: string | null, amount?: number, paymentDate?: string, notes?: string) =>
      actions.payCreditCardBill(deps, billId, accountId, amount, paymentDate, notes),
    [deps]
  );

  const handleAddPaymentMethod = useCallback(
    (pmData: Omit<PaymentMethod, 'id' | 'workspace_id' | 'created_at'>) => actions.addPaymentMethod(deps, pmData),
    [deps]
  );

  const handleAddCategory = useCallback(
    (catData: Omit<Category, 'id' | 'workspace_id' | 'created_at'>) => actions.addCategory(deps, catData),
    [deps]
  );
  const handleUpdateCategory = useCallback(
    (id: string, data: Omit<Partial<Category>, 'id' | 'workspace_id' | 'created_at'>) => actions.updateCategory(deps, id, data),
    [deps]
  );

  const handleAddTransaction = useCallback(
    (txData: Omit<Transaction, 'id' | 'workspace_id' | 'created_at'>) => actions.addTransaction(deps, txData),
    [deps]
  );
  const handleUpdateTransaction = useCallback(
    (id: string, data: UpdateTransactionDTO) => actions.updateTransaction(deps, id, data),
    [deps]
  );
  const handleDeleteTransaction = useCallback(
    (id: string) => actions.deleteTransaction(deps, id),
    [deps]
  );
  const handleDuplicateTransaction = useCallback(
    (id: string) => actions.duplicateTransaction(deps, id),
    [deps]
  );

  const handleCreateInstallmentPurchase = useCallback(
    (data: Parameters<typeof actions.createInstallmentPurchase>[1]) => actions.createInstallmentPurchase(deps, data),
    [deps]
  );

  const handleRecordPayment = useCallback(
    (data: Parameters<typeof actions.recordPayment>[1]) => actions.recordPayment(deps, data),
    [deps]
  );

  const handleCreateTransfer = useCallback(
    (fromAccountId: string, toAccountId: string, amount: number, date?: string, notes?: string) =>
      actions.createTransfer(deps, fromAccountId, toAccountId, amount, date, notes),
    [deps]
  );

  const handleRecordSettlement = useCallback(
    (data: Parameters<typeof actions.recordSettlement>[1]) => actions.recordSettlement(deps, data),
    [deps]
  );
  const handleDeleteSettlement = useCallback(
    (id: string) => actions.deleteSettlement(deps, id),
    [deps]
  );

  const handleAddRecurring = useCallback(
    (data: Omit<RecurringTransaction, 'id' | 'workspace_id' | 'created_at'>) =>
      actions.addRecurring(deps, data, processPendingRecurring),
    [deps, processPendingRecurring]
  );
  const handleToggleRecurring = useCallback(
    (id: string) => actions.toggleRecurring(deps, id, processPendingRecurring),
    [deps, processPendingRecurring]
  );
  const handleDeleteRecurring = useCallback(
    (id: string) => actions.deleteRecurring(deps, id),
    [deps]
  );

  const handleSetBudget = useCallback(
    (categoryId: string, plannedAmount: number, month?: number, year?: number) =>
      actions.setBudget(deps, categoryId, plannedAmount, month, year),
    [deps]
  );

  const handleAddGoal = useCallback(
    (goalData: Omit<FinancialGoal, 'id' | 'workspace_id' | 'created_at'>) => actions.addGoal(deps, goalData),
    [deps]
  );
  const handleUpdateGoal = useCallback(
    (id: string, data: Omit<Partial<FinancialGoal>, 'id' | 'workspace_id' | 'created_at'>) => actions.updateGoal(deps, id, data),
    [deps]
  );
  const handleDepositGoal = useCallback(
    (goalId: string, amount: number, accountId: string) => actions.depositGoal(deps, goalId, amount, accountId),
    [deps]
  );

  return (
    <FinanceContext.Provider
      value={{
        isLoaded,
        workspaces: allWorkspaces,
        activeWorkspace,
        workspaceMembers,
        setActiveWorkspaceId: handleSetActiveWorkspaceId,
        createWorkspace: handleCreateWorkspace,
        updateWorkspace: handleUpdateWorkspace,
        addWorkspaceMember: handleAddWorkspaceMember,

        accounts,
        allWorkspaceAccounts,
        addAccount: handleAddAccount,
        updateAccount: handleUpdateAccount,
        deleteAccount: handleDeleteAccount,

        creditCards,
        allWorkspaceCreditCards,
        creditCardBills,
        addCreditCard: handleAddCreditCard,
        updateCreditCard: handleUpdateCreditCard,
        payCreditCardBill: handlePayCreditCardBill,

        paymentMethods,
        allWorkspacePaymentMethods,
        addPaymentMethod: handleAddPaymentMethod,

        categories,
        allWorkspaceCategories,
        addCategory: handleAddCategory,
        updateCategory: handleUpdateCategory,

        transactions,
        addTransaction: handleAddTransaction,
        updateTransaction: handleUpdateTransaction,
        deleteTransaction: handleDeleteTransaction,
        duplicateTransaction: handleDuplicateTransaction,

        purchases,
        installments,
        createInstallmentPurchase: handleCreateInstallmentPurchase,

        payments,
        recordPayment: handleRecordPayment,

        transfers,
        createTransfer: handleCreateTransfer,

        settlements,
        recordSettlement: handleRecordSettlement,
        deleteSettlement: handleDeleteSettlement,

        recurring,
        addRecurring: handleAddRecurring,
        toggleRecurring: handleToggleRecurring,
        deleteRecurring: handleDeleteRecurring,
        processPendingRecurring,

        budgets,
        setBudget: handleSetBudget,

        goals,
        addGoal: handleAddGoal,
        updateGoal: handleUpdateGoal,
        depositGoal: handleDepositGoal,

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
