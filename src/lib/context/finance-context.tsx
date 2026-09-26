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
import { useOptionalAuth } from './auth-context';
import { FinanceRepository } from '../repositories/finance-repository';
import { LocalFinanceRepository } from '../repositories/local-finance-repository';
import { SupabaseFinanceRepository } from '../repositories/supabase-finance-repository';
import { createClient } from '../supabase/client';

export type { FinanceContextType };

export interface FinanceProviderProps {
  children: React.ReactNode;
  repository?: FinanceRepository;
  initialDataMode?: 'local' | 'supabase';
  initialWorkspaceId?: string;
}

const FinanceContext = createContext<FinanceContextType | undefined>(undefined);

function generateId(prefix: string, dataMode?: 'local' | 'supabase'): string {
  if (dataMode === 'supabase') {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  }
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
}

function createFailingRepository(message: string): FinanceRepository {
  return new Proxy({} as FinanceRepository, {
    get: (_, prop) => () => Promise.reject(new Error(message)),
  });
}

function reconcileFailedEntities<T extends { id: string }>(
  currentList: T[],
  baseList: T[] | undefined,
  failedIds: Set<string>
): T[] {
  if (failedIds.size === 0) return currentList;
  const baseMap = new Map<string, T>();
  if (baseList) {
    for (let i = 0; i < baseList.length; i++) {
      baseMap.set(baseList[i].id, baseList[i]);
    }
  }
  const result: T[] = [];
  const resultSet = new Set<string>();

  for (let i = 0; i < currentList.length; i++) {
    const item = currentList[i];
    if (!failedIds.has(item.id)) {
      result.push(item);
      resultSet.add(item.id);
    } else {
      const baseItem = baseMap.get(item.id);
      if (baseItem) {
        result.push(baseItem);
        resultSet.add(item.id);
      }
    }
  }

  for (const [id, baseItem] of baseMap.entries()) {
    if (failedIds.has(id) && !resultSet.has(id)) {
      result.push(baseItem);
      resultSet.add(id);
    }
  }

  return result;
}

function collectChangedIds(before: FinanceState, after: FinanceState): Set<string> {
  const ids = new Set<string>();
  const keys: (keyof FinanceState)[] = [
    'allAccounts',
    'allCreditCards',
    'allCreditCardBills',
    'allPaymentMethods',
    'allCategories',
    'allTransactions',
    'allPurchases',
    'allInstallments',
    'allPayments',
    'allTransfers',
    'allRecurring',
    'allBudgets',
    'allGoals',
    'allSettlements',
    'allWorkspaceMembers',
  ];
  for (let k = 0; k < keys.length; k++) {
    const key = keys[k];
    const bList = before[key] as { id: string }[];
    const aList = after[key] as { id: string }[];
    if (bList !== aList) {
      const bMap = new Map<string, { id: string }>();
      const aMap = new Map<string, { id: string }>();
      for (let i = 0; i < bList.length; i++) {
        bMap.set(bList[i].id, bList[i]);
      }
      for (let i = 0; i < aList.length; i++) {
        const item = aList[i];
        aMap.set(item.id, item);
        if (bMap.get(item.id) !== item) {
          ids.add(item.id);
        }
      }
      for (let i = 0; i < bList.length; i++) {
        const item = bList[i];
        if (!aMap.has(item.id)) {
          ids.add(item.id);
        }
      }
    }
  }
  return ids;
}

function applyConfirmedEntities(
  targetState: FinanceState,
  sourceState: FinanceState,
  changedIds: Set<string>
): FinanceState {
  const next: FinanceState = { ...targetState };
  const keys: (keyof FinanceState)[] = [
    'allAccounts',
    'allCreditCards',
    'allCreditCardBills',
    'allPaymentMethods',
    'allCategories',
    'allTransactions',
    'allPurchases',
    'allInstallments',
    'allPayments',
    'allTransfers',
    'allRecurring',
    'allBudgets',
    'allGoals',
    'allSettlements',
    'allWorkspaceMembers',
  ];
  for (let k = 0; k < keys.length; k++) {
    const key = keys[k];
    const targetList = targetState[key] as { id: string }[];
    const sourceList = sourceState[key] as { id: string }[];
    if (targetList !== sourceList) {
      const sourceMap = new Map<string, { id: string }>();
      for (let i = 0; i < sourceList.length; i++) {
        sourceMap.set(sourceList[i].id, sourceList[i]);
      }
      const updatedList: { id: string }[] = [];
      const handled = new Set<string>();
      for (let i = 0; i < targetList.length; i++) {
        const item = targetList[i];
        if (changedIds.has(item.id)) {
          handled.add(item.id);
          const sItem = sourceMap.get(item.id);
          if (sItem) {
            updatedList.push(sItem);
          }
        } else {
          updatedList.push(item);
        }
      }
      for (let i = 0; i < sourceList.length; i++) {
        const item = sourceList[i];
        if (changedIds.has(item.id) && !handled.has(item.id)) {
          updatedList.push(item);
          handled.add(item.id);
        }
      }
      (next as any)[key] = updatedList;
    }
  }
  return next;
}

export function FinanceProvider({ children, repository, initialDataMode, initialWorkspaceId }: FinanceProviderProps) {
  const auth = useOptionalAuth();

  const dataMode = useMemo<'local' | 'supabase'>(() => {
    if (initialDataMode) return initialDataMode;
    if (repository instanceof SupabaseFinanceRepository) return 'supabase';
    if (repository instanceof LocalFinanceRepository) return 'local';
    if (auth?.dataMode) return auth.dataMode;
    return process.env.NEXT_PUBLIC_DATA_MODE === 'supabase' ? 'supabase' : 'local';
  }, [initialDataMode, repository, auth?.dataMode]);

  const effectiveRepository = useMemo<FinanceRepository>(() => {
    if (repository) return repository;
    if (dataMode === 'supabase') {
      const client = createClient();
      if (client) {
        return new SupabaseFinanceRepository(client as any);
      }
      return createFailingRepository('Supabase client não pôde ser inicializado no modo supabase.');
    }
    return new LocalFinanceRepository(typeof window !== 'undefined' ? window.localStorage : undefined);
  }, [repository, dataMode]);

  const [isLoaded, setIsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(dataMode === 'supabase');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const savingCountRef = useRef(0);
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const isSupabaseMode = dataMode === 'supabase';

  const [allWorkspaces, setAllWorkspaces] = useState<Workspace[]>(() => isSupabaseMode ? [] : mockWorkspaces);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(() =>
    initialWorkspaceId || (isSupabaseMode ? '' : mockWorkspaces[0].id)
  );
  const [allWorkspaceMembers, setAllWorkspaceMembers] = useState<WorkspaceMember[]>(() => isSupabaseMode ? [] : mockWorkspaceMembers);
  const [allAccounts, setAllAccounts] = useState<Account[]>(() => isSupabaseMode ? [] : mockAccounts);
  const [allCreditCards, setAllCreditCards] = useState<CreditCard[]>(() => isSupabaseMode ? [] : mockCreditCards);
  const [allCreditCardBills, setAllCreditCardBills] = useState<CreditCardBill[]>(() => isSupabaseMode ? [] : mockCreditCardBills);
  const [allPaymentMethods, setAllPaymentMethods] = useState<PaymentMethod[]>(() => isSupabaseMode ? [] : mockPaymentMethods);
  const [allCategories, setAllCategories] = useState<Category[]>(() => isSupabaseMode ? [] : mockCategories);
  const [allTransactions, setAllTransactions] = useState<Transaction[]>(() => isSupabaseMode ? [] : mockTransactions);
  const [allPurchases, setAllPurchases] = useState<Purchase[]>(() => isSupabaseMode ? [] : mockPurchases);
  const [allInstallments, setAllInstallments] = useState<Installment[]>(() => isSupabaseMode ? [] : mockInstallments);
  const [allPayments, setAllPayments] = useState<Payment[]>(() => isSupabaseMode ? [] : mockPayments);
  const [allTransfers, setAllTransfers] = useState<Transfer[]>([]);
  const [allRecurring, setAllRecurring] = useState<RecurringTransaction[]>(() => isSupabaseMode ? [] : mockRecurring);
  const [allBudgets, setAllBudgets] = useState<Budget[]>(() => isSupabaseMode ? [] : mockBudgets);
  const [allGoals, setAllGoals] = useState<FinancialGoal[]>(() => isSupabaseMode ? [] : mockGoals);
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

  const commitState = useCallback((next: FinanceState) => {
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
  }, []);

  // Carregamento Determinístico Seguro no Mount + Saneamento Idempotente de Dados Legados V20 (P0-01) - Modo Local
  useEffect(() => {
    if (dataMode !== 'local') return;
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
        commitState(loaded);
      } catch (e) {
        console.error('Erro ao hidratar dados locais:', e);
      } finally {
        setIsLoaded(true);
        setIsLoading(false);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [dataMode, commitState]);

  // Carregamento Assíncrono Seguro no Mount - Modo Supabase
  useEffect(() => {
    if (dataMode !== 'supabase') return;

    if (auth?.isLoading) {
      return;
    }

    let isMounted = true;

    async function initSupabaseData() {
      setIsLoading(true);
      setError(null);
      try {
        const userId = auth?.user?.id;
        let workspaces = await effectiveRepository.getWorkspaces(userId);

        if (!isMounted) return;

        if (!workspaces || workspaces.length === 0) {
          const created = await effectiveRepository.createWorkspace({
            name: 'Meu Workspace',
            owner_id: userId || 'usr-1',
            currency: 'BRL',
            tracking_mode: 'full',
          });
          workspaces = [created];
        }

        if (!isMounted) return;

        const currentWsId = stateRef.current.activeWorkspaceId || initialWorkspaceId;
        const targetWorkspaceId =
          workspaces.find((w) => w.id === currentWsId)?.id ?? workspaces[0].id;

        const snapshot = await effectiveRepository.loadSnapshot(targetWorkspaceId);

        if (!isMounted) return;

        commitState(snapshot);
        setIsLoaded(true);
      } catch (err: unknown) {
        if (isMounted) {
          console.error('Erro ao carregar dados do Supabase:', err);
          setError(err instanceof Error ? err : new Error(String(err)));
          setIsLoaded(true);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    initSupabaseData();

    return () => {
      isMounted = false;
    };
  }, [dataMode, auth?.isLoading, auth?.user?.id, effectiveRepository, commitState, initialWorkspaceId]);

  // Sincronização com LocalStorage (SOMENTE após isLoaded = true, canPersist = true e em modo local)
  useEffect(() => {
    if (dataMode !== 'local' || !isLoaded || typeof window === 'undefined' || !canPersistRef.current) return;
    saveFinanceSnapshot(localStorage, stateRef.current);
  }, [
    dataMode,
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

  const refreshData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (dataMode === 'supabase') {
        const targetId = stateRef.current.activeWorkspaceId;
        const snapshot = await effectiveRepository.loadSnapshot(targetId);
        commitState(snapshot);
      } else {
        const { snapshot } = loadFinanceSnapshot(localStorage);
        commitState(snapshot);
      }
    } catch (err: unknown) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      setError(errorObj);
      throw errorObj;
    } finally {
      setIsLoading(false);
    }
  }, [dataMode, effectiveRepository, commitState]);

  // Contrato desacoplado de dependências para actions de domínio
  const deps: FinanceActionDeps = useMemo(
    () => ({
      getState: () => stateRef.current,
      commit: (next: FinanceState) => {
        if (!canPersistRef.current) {
          throw new Error('Operação bloqueada: o aplicativo está em modo somente leitura para proteger dados de uma versão futura.');
        }
        commitState(next);
      },
      generateId: (prefix: string) => generateId(prefix, dataMode),
      now: () => new Date(),
    }),
    [commitState, dataMode]
  );

  const idMapRef = useRef<Map<string, string>>(new Map());
  const resolveCanonicalId = useCallback(<T extends string | null | undefined>(id: T): T => {
    if (!id) return id;
    return (idMapRef.current.get(id) ?? id) as T;
  }, []);

  const pendingMutationsCountRef = useRef(0);
  const failedWorkspacesRef = useRef<Set<string>>(new Set());
  const rollbackBaseStateRef = useRef<FinanceState | null>(null);
  const hasSuccessfulMutationsRef = useRef(false);
  const failedEntityIdsRef = useRef<Set<string>>(new Set());
  const workspaceSwitchSeqRef = useRef(0);

  const runMutation = useCallback(
    <T,>(
      localAction: () => T,
      remotePersist?: (result: T) => Promise<unknown>,
      targetWorkspaceId?: string,
      entityId?: string
    ): T => {
      if (dataMode === 'local' || !remotePersist) {
        return localAction();
      }

      const wsId = targetWorkspaceId ?? stateRef.current.activeWorkspaceId;
      if (pendingMutationsCountRef.current === 0) {
        rollbackBaseStateRef.current = stateRef.current;
        hasSuccessfulMutationsRef.current = false;
        failedEntityIdsRef.current.clear();
      }
      const previousState = stateRef.current;
      const result = localAction();
      const afterState = stateRef.current;
      const changedIds = collectChangedIds(previousState, afterState);
      if (entityId) {
        changedIds.add(entityId);
      }
      if (result && typeof (result as any).id === 'string') {
        changedIds.add((result as any).id);
      }

      savingCountRef.current += 1;
      pendingMutationsCountRef.current += 1;
      setIsSaving(true);

      // Serializa as mutações em fila ordenada (mutex/queue assíncrona)
      mutationQueueRef.current = mutationQueueRef.current
        .then(async () => {
          try {
            await remotePersist(result);
            hasSuccessfulMutationsRef.current = true;
            if (rollbackBaseStateRef.current) {
              rollbackBaseStateRef.current = applyConfirmedEntities(
                rollbackBaseStateRef.current,
                afterState,
                changedIds
              );
            }
            if (failedWorkspacesRef.current.size === 0) {
              setError(null);
            }
          } catch (err) {
            console.error('Falha na persistência remota, reconciliando estado com repositório:', err);
            const errorObj = err instanceof Error ? err : new Error(String(err));
            setError(errorObj);
            failedWorkspacesRef.current.add(wsId);
            for (const id of changedIds) {
              failedEntityIdsRef.current.add(id);
            }
          } finally {
            pendingMutationsCountRef.current = Math.max(0, pendingMutationsCountRef.current - 1);
            // Se todas as mutações da fila terminaram e houve alguma falha, reconcilia o workspace ativo
            if (pendingMutationsCountRef.current === 0) {
              if (failedWorkspacesRef.current.size > 0) {
                const currentActiveWs = stateRef.current.activeWorkspaceId;
                const shouldReconcile = failedWorkspacesRef.current.has(currentActiveWs);
                failedWorkspacesRef.current.clear();
                if (shouldReconcile) {
                  try {
                    const confirmed = await effectiveRepository.loadSnapshot(currentActiveWs);
                    if (stateRef.current.activeWorkspaceId === currentActiveWs) {
                      commitState(confirmed);
                    }
                  } catch (reconcileErr) {
                    console.error('Falha ao recarregar snapshot após erro de persistência:', reconcileErr);
                    if (stateRef.current.activeWorkspaceId === currentActiveWs) {
                      if (hasSuccessfulMutationsRef.current) {
                        const failedIds = failedEntityIdsRef.current;
                        const base = rollbackBaseStateRef.current;
                        const s = stateRef.current;
                        commitState({
                          ...s,
                          allAccounts: reconcileFailedEntities(s.allAccounts, base?.allAccounts, failedIds),
                          allCreditCards: reconcileFailedEntities(s.allCreditCards, base?.allCreditCards, failedIds),
                          allCreditCardBills: reconcileFailedEntities(s.allCreditCardBills, base?.allCreditCardBills, failedIds),
                          allPaymentMethods: reconcileFailedEntities(s.allPaymentMethods, base?.allPaymentMethods, failedIds),
                          allCategories: reconcileFailedEntities(s.allCategories, base?.allCategories, failedIds),
                          allTransactions: reconcileFailedEntities(s.allTransactions, base?.allTransactions, failedIds),
                          allPurchases: reconcileFailedEntities(s.allPurchases, base?.allPurchases, failedIds),
                          allInstallments: reconcileFailedEntities(s.allInstallments, base?.allInstallments, failedIds),
                          allPayments: reconcileFailedEntities(s.allPayments, base?.allPayments, failedIds),
                          allTransfers: reconcileFailedEntities(s.allTransfers, base?.allTransfers, failedIds),
                          allRecurring: reconcileFailedEntities(s.allRecurring, base?.allRecurring, failedIds),
                          allBudgets: reconcileFailedEntities(s.allBudgets, base?.allBudgets, failedIds),
                          allGoals: reconcileFailedEntities(s.allGoals, base?.allGoals, failedIds),
                          allSettlements: reconcileFailedEntities(s.allSettlements, base?.allSettlements, failedIds),
                          allWorkspaceMembers: reconcileFailedEntities(s.allWorkspaceMembers, base?.allWorkspaceMembers, failedIds),
                        });
                      } else if (rollbackBaseStateRef.current) {
                        commitState(rollbackBaseStateRef.current);
                      }
                    }
                  }
                }
              }
              hasSuccessfulMutationsRef.current = false;
              failedEntityIdsRef.current.clear();
              rollbackBaseStateRef.current = null;
            }
          }
        })
        .finally(() => {
          savingCountRef.current = Math.max(0, savingCountRef.current - 1);
          if (savingCountRef.current === 0) {
            setIsSaving(false);
          }
        });

      return result;
    },
    [dataMode, effectiveRepository, commitState]
  );

  const activeWorkspace = useMemo(() => {
    return (
      allWorkspaces.find((w) => w.id === activeWorkspaceId) ||
      allWorkspaces[0] ||
      (isSupabaseMode ? ({} as Workspace) : mockWorkspaces[0])
    );
  }, [allWorkspaces, activeWorkspaceId, isSupabaseMode]);

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

  // Executa processamento de recorrências SOMENTE em modo local após a conclusão da hidratação local e se canPersist = true
  const processPendingRecurring = useCallback(() => {
    if (!isLoaded) return;
    if (dataMode === 'supabase') return;
    if (!canPersistRef.current) {
      throw new Error('Operação bloqueada: o aplicativo está em modo somente leitura para proteger dados de uma versão futura.');
    }
    actions.processPendingRecurring(deps);
  }, [deps, isLoaded, dataMode]);

  useEffect(() => {
    if (!isLoaded || !canPersistRef.current || dataMode === 'supabase') return;
    const timer = setTimeout(() => {
      processPendingRecurring();
    }, 0);
    return () => clearTimeout(timer);
  }, [isLoaded, processPendingRecurring, dataMode]);

  // Handlers que delegam para os módulos de domínio com mutação otimista
  const handleSetActiveWorkspaceId = useCallback(
    async (id: string) => {
      const seq = ++workspaceSwitchSeqRef.current;
      if (dataMode === 'supabase') {
        setActiveWorkspaceId(id);
        stateRef.current.activeWorkspaceId = id;
        setIsLoading(true);
        try {
          const snapshot = await effectiveRepository.loadSnapshot(id);
          if (workspaceSwitchSeqRef.current === seq) {
            commitState(snapshot);
          }
        } catch (err) {
          if (workspaceSwitchSeqRef.current === seq) {
            console.error('Erro ao trocar workspace:', err);
            setError(err instanceof Error ? err : new Error(String(err)));
          }
        } finally {
          if (workspaceSwitchSeqRef.current === seq) {
            setIsLoading(false);
          }
        }
      } else {
        actions.setActiveWorkspaceId(deps, id);
      }
    },
    [dataMode, deps, effectiveRepository, commitState]
  );

  const handleCreateWorkspace = useCallback(
    (name: string, tracking_mode?: WorkspaceTrackingMode) =>
      runMutation(
        () => actions.createWorkspace(deps, name, tracking_mode),
        async (createdWs) => {
          const remoteWs = await effectiveRepository.createWorkspace({
            name: createdWs.name,
            owner_id: createdWs.owner_id,
            currency: createdWs.currency,
            tracking_mode: createdWs.tracking_mode,
          });
          idMapRef.current.set(createdWs.id, remoteWs.id);
          const current = stateRef.current;
          commitState({
            ...current,
            activeWorkspaceId: remoteWs.id,
            allWorkspaces: current.allWorkspaces.map((w) => (w.id === createdWs.id ? remoteWs : w)),
            allWorkspaceMembers: current.allWorkspaceMembers.map((m) =>
              m.workspace_id === createdWs.id ? { ...m, workspace_id: remoteWs.id } : m
            ),
          });
        }
      ),
    [deps, effectiveRepository, runMutation, commitState]
  );

  const handleUpdateWorkspace = useCallback(
    (id: string, data: Partial<Workspace>) => {
      const canonicalId = resolveCanonicalId(id);
      return runMutation(
        () => actions.updateWorkspace(deps, id, data),
        () => effectiveRepository.updateWorkspace(canonicalId, data)
      );
    },
    [deps, effectiveRepository, runMutation, resolveCanonicalId]
  );

  const handleAddWorkspaceMember = useCallback(
    (emailOrUserId: string, role: 'admin' | 'member' | 'viewer') => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      const existingMember = stateRef.current.allWorkspaceMembers.find(
        (m) => m.user?.email === emailOrUserId || m.user_id === emailOrUserId
      );
      const resolvedUserId = existingMember?.user_id ?? emailOrUserId;

      return runMutation(
        () => actions.addWorkspaceMember(deps, emailOrUserId, role),
        async () => {
          await effectiveRepository.addWorkspaceMember({
            workspace_id: targetWorkspaceId,
            user_id: resolvedUserId,
            role,
          });
          const fresh = await effectiveRepository.loadSnapshot(targetWorkspaceId);
          if (stateRef.current.activeWorkspaceId === targetWorkspaceId) {
            commitState(fresh);
          }
        },
        targetWorkspaceId
      );
    },
    [deps, effectiveRepository, runMutation, commitState]
  );


  const handleAddAccount = useCallback(
    (accountData: Omit<Account, 'id' | 'workspace_id' | 'created_at'>) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      return runMutation(
        () => actions.addAccount(deps, accountData),
        async (res) => {
          const saved = await effectiveRepository.saveAccount({
            ...accountData,
            active: res.active,
            workspace_id: targetWorkspaceId,
          });
          idMapRef.current.set(res.id, saved.id);
          const current = stateRef.current;
          if (current.activeWorkspaceId === targetWorkspaceId) {
            commitState({
              ...current,
              allAccounts: current.allAccounts.map((a) => (a.id === res.id ? saved : a)),
            });
          }
        },
        targetWorkspaceId
      );
    },
    [deps, effectiveRepository, runMutation, commitState]
  );

  const handleUpdateAccount = useCallback(
    (id: string, data: Omit<Partial<Account>, 'id' | 'workspace_id' | 'created_at'>) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      const canonicalId = resolveCanonicalId(id);
      return runMutation(
        () => actions.updateAccount(deps, id, data),
        async () => {
          const saved = await effectiveRepository.saveAccount({
            ...data,
            id: canonicalId,
            workspace_id: targetWorkspaceId,
          } as any);
          const current = stateRef.current;
          if (current.activeWorkspaceId === targetWorkspaceId) {
            commitState({
              ...current,
              allAccounts: current.allAccounts.map((a) => (a.id === id ? { ...a, ...saved } : a)),
            });
          }
        },
        targetWorkspaceId,
        id
      );
    },
    [deps, effectiveRepository, runMutation, resolveCanonicalId, commitState]
  );

  const handleDeleteAccount = useCallback(
    (id: string) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      const canonicalId = resolveCanonicalId(id);
      return runMutation(
        () => actions.deleteAccount(deps, id),
        () => effectiveRepository.deleteAccount(canonicalId),
        targetWorkspaceId,
        id
      );
    },
    [deps, effectiveRepository, runMutation, resolveCanonicalId]
  );

  const handleAddCreditCard = useCallback(
    (cardData: Omit<CreditCard, 'id' | 'workspace_id' | 'created_at'>) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      return runMutation(
        () => actions.addCreditCard(deps, cardData),
        async (res) => {
          const saved = await effectiveRepository.saveCreditCard({
            ...cardData,
            workspace_id: targetWorkspaceId,
          });
          idMapRef.current.set(res.id, saved.id);
          const current = stateRef.current;
          if (current.activeWorkspaceId === targetWorkspaceId) {
            commitState({
              ...current,
              allCreditCards: current.allCreditCards.map((c) => (c.id === res.id ? saved : c)),
            });
          }
        },
        targetWorkspaceId
      );
    },
    [deps, effectiveRepository, runMutation, commitState]
  );

  const handleUpdateCreditCard = useCallback(
    (id: string, data: Omit<Partial<CreditCard>, 'id' | 'workspace_id' | 'created_at'>) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      const canonicalId = resolveCanonicalId(id);
      return runMutation(
        () => actions.updateCreditCard(deps, id, data),
        async () => {
          const saved = await effectiveRepository.saveCreditCard({
            ...data,
            id: canonicalId,
            workspace_id: targetWorkspaceId,
          } as any);
          const current = stateRef.current;
          if (current.activeWorkspaceId === targetWorkspaceId) {
            commitState({
              ...current,
              allCreditCards: current.allCreditCards.map((c) => (c.id === id ? { ...c, ...saved } : c)),
            });
          }
        },
        targetWorkspaceId,
        id
      );
    },
    [deps, effectiveRepository, runMutation, resolveCanonicalId, commitState]
  );

  const handlePayCreditCardBill = useCallback(
    (billId: string, accountId?: string | null, amount?: number, paymentDate?: string, notes?: string) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      const canonicalBillId = resolveCanonicalId(billId);
      const canonicalAccountId = resolveCanonicalId(accountId);
      return runMutation(
        () => actions.payCreditCardBill(deps, billId, accountId, amount, paymentDate, notes),
        async (res) => {
          await effectiveRepository.savePayment({
            workspace_id: targetWorkspaceId,
            credit_card_bill_id: canonicalBillId,
            account_id: (canonicalAccountId ?? res.account_id ?? null) as string | null,
            affects_balance: res.affects_balance,
            amount: res.amount,
            payment_date: res.payment_date,
            notes: res.notes,
          });
        },
        targetWorkspaceId
      );
    },
    [deps, effectiveRepository, runMutation, resolveCanonicalId]
  );

  const handleAddPaymentMethod = useCallback(
    (pmData: Omit<PaymentMethod, 'id' | 'workspace_id' | 'created_at'>) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      return runMutation(
        () => actions.addPaymentMethod(deps, pmData),
        async (res) => {
          const saved = await effectiveRepository.savePaymentMethod({
            ...pmData,
            workspace_id: targetWorkspaceId,
          });
          idMapRef.current.set(res.id, saved.id);
          const current = stateRef.current;
          if (current.activeWorkspaceId === targetWorkspaceId) {
            commitState({
              ...current,
              allPaymentMethods: current.allPaymentMethods.map((p) => (p.id === res.id ? saved : p)),
            });
          }
        },
        targetWorkspaceId
      );
    },
    [deps, effectiveRepository, runMutation, commitState]
  );

  const handleAddCategory = useCallback(
    (catData: Omit<Category, 'id' | 'workspace_id' | 'created_at'>) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      return runMutation(
        () => actions.addCategory(deps, catData),
        async (res) => {
          const saved = await effectiveRepository.saveCategory({
            ...catData,
            workspace_id: targetWorkspaceId,
          });
          idMapRef.current.set(res.id, saved.id);
          const current = stateRef.current;
          if (current.activeWorkspaceId === targetWorkspaceId) {
            commitState({
              ...current,
              allCategories: current.allCategories.map((c) => (c.id === res.id ? saved : c)),
            });
          }
        },
        targetWorkspaceId
      );
    },
    [deps, effectiveRepository, runMutation, commitState]
  );

  const handleUpdateCategory = useCallback(
    (id: string, data: Omit<Partial<Category>, 'id' | 'workspace_id' | 'created_at'>) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      const canonicalId = resolveCanonicalId(id);
      return runMutation(
        () => actions.updateCategory(deps, id, data),
        async () => {
          const saved = await effectiveRepository.saveCategory({
            ...data,
            id: canonicalId,
            workspace_id: targetWorkspaceId,
          } as any);
          const current = stateRef.current;
          if (current.activeWorkspaceId === targetWorkspaceId) {
            commitState({
              ...current,
              allCategories: current.allCategories.map((c) => (c.id === id ? { ...c, ...saved } : c)),
            });
          }
        },
        targetWorkspaceId,
        id
      );
    },
    [deps, effectiveRepository, runMutation, resolveCanonicalId, commitState]
  );

  const handleAddTransaction = useCallback(
    (txData: Omit<Transaction, 'id' | 'workspace_id' | 'created_at'>) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      return runMutation(
        () => actions.addTransaction(deps, txData),
        async (res) => {
          const saved = await effectiveRepository.saveTransaction({
            ...txData,
            account_id: resolveCanonicalId(txData.account_id),
            category_id: resolveCanonicalId(txData.category_id),
            payment_method_id: resolveCanonicalId(txData.payment_method_id),
            credit_card_id: resolveCanonicalId(txData.credit_card_id),
            credit_card_bill_id: resolveCanonicalId(txData.credit_card_bill_id),
            paid_by_member_id: resolveCanonicalId(txData.paid_by_member_id),
            workspace_id: targetWorkspaceId,
          });
          idMapRef.current.set(res.id, saved.id);
          const current = stateRef.current;
          if (current.activeWorkspaceId === targetWorkspaceId) {
            commitState({
              ...current,
              allTransactions: current.allTransactions.map((t) => (t.id === res.id ? saved : t)),
            });
          }
        },
        targetWorkspaceId
      );
    },
    [deps, effectiveRepository, runMutation, commitState, resolveCanonicalId]
  );

  const handleUpdateTransaction = useCallback(
    (id: string, data: UpdateTransactionDTO) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      const canonicalId = resolveCanonicalId(id);
      return runMutation(
        () => actions.updateTransaction(deps, id, data),
        () => {
          const item = stateRef.current.allTransactions.find((t) => t.id === id);
          return effectiveRepository.saveTransaction({
            ...item,
            ...data,
            id: canonicalId,
            category_id: data.category_id !== undefined ? resolveCanonicalId(data.category_id) : item!.category_id,
            paid_by_member_id: data.paid_by_member_id !== undefined ? resolveCanonicalId(data.paid_by_member_id) : item!.paid_by_member_id,
            workspace_id: targetWorkspaceId,
          } as any);
        },
        targetWorkspaceId,
        id
      );
    },
    [deps, effectiveRepository, runMutation, resolveCanonicalId]
  );

  const handleDeleteTransaction = useCallback(
    (id: string) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      const canonicalId = resolveCanonicalId(id);
      return runMutation(
        () => actions.deleteTransaction(deps, id),
        () => effectiveRepository.deleteTransaction(canonicalId),
        targetWorkspaceId,
        id
      );
    },
    [deps, effectiveRepository, runMutation, resolveCanonicalId]
  );

  const handleDuplicateTransaction = useCallback(
    (id: string) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      const canonicalId = resolveCanonicalId(id);
      return runMutation(
        () => actions.duplicateTransaction(deps, id),
        async (res) => {
          if (!res) return;
          const saved = await effectiveRepository.saveTransaction({
            ...res,
            id: undefined,
            account_id: resolveCanonicalId(res.account_id),
            category_id: resolveCanonicalId(res.category_id),
            payment_method_id: resolveCanonicalId(res.payment_method_id),
            credit_card_id: resolveCanonicalId(res.credit_card_id),
            credit_card_bill_id: resolveCanonicalId(res.credit_card_bill_id),
            paid_by_member_id: resolveCanonicalId(res.paid_by_member_id),
            workspace_id: targetWorkspaceId,
          });
          idMapRef.current.set(res.id, saved.id);
          const current = stateRef.current;
          if (current.activeWorkspaceId === targetWorkspaceId) {
            commitState({
              ...current,
              allTransactions: current.allTransactions.map((t) => (t.id === res.id ? saved : t)),
            });
          }
        },
        targetWorkspaceId
      );
    },
    [deps, effectiveRepository, runMutation, commitState, resolveCanonicalId]
  );

  const handleCreateInstallmentPurchase = useCallback(
    (data: Parameters<typeof actions.createInstallmentPurchase>[1]) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      return runMutation(
        () => actions.createInstallmentPurchase(deps, data),
        async (localPurchase) => {
          const localInsts = stateRef.current.allInstallments.filter(
            (i) => i.purchase_id === localPurchase.id
          );
          const canonicalCardId = resolveCanonicalId(data.credit_card_id);
          const canonicalAccountId = resolveCanonicalId(data.account_id);
          const canonicalCategoryId = resolveCanonicalId(data.category_id);
          const canonicalPaymentMethodId = resolveCanonicalId(data.payment_method_id);
          const canonicalPaidByMemberId = resolveCanonicalId(data.paid_by_member_id);

          const remotePurchase = await effectiveRepository.savePurchase({
            ...data,
            credit_card_id: canonicalCardId,
            account_id: canonicalAccountId,
            category_id: canonicalCategoryId,
            payment_method_id: canonicalPaymentMethodId,
            paid_by_member_id: canonicalPaidByMemberId,
            workspace_id: targetWorkspaceId,
          });

          idMapRef.current.set(localPurchase.id, remotePurchase.id);

          const fresh = await effectiveRepository.loadSnapshot(targetWorkspaceId);
          const remoteInsts = fresh.allInstallments.filter((ri) => ri.purchase_id === remotePurchase.id);
          localInsts.forEach((li) => {
            const ri = remoteInsts.find((r) => r.installment_number === li.installment_number);
            if (ri) {
              idMapRef.current.set(li.id, ri.id);
            }
          });

          const current = stateRef.current;
          if (current.activeWorkspaceId === targetWorkspaceId) {
            commitState({
              ...current,
              allPurchases: current.allPurchases.map((p) => (p.id === localPurchase.id ? remotePurchase : p)),
              allInstallments: current.allInstallments.map((inst) => {
                if (inst.purchase_id === localPurchase.id) {
                  const ri = remoteInsts.find((r) => r.installment_number === inst.installment_number);
                  return ri ? { ...inst, id: ri.id, purchase_id: remotePurchase.id } : inst;
                }
                return inst;
              }),
            });
          }
        },
        targetWorkspaceId
      );
    },
    [deps, effectiveRepository, runMutation, commitState, resolveCanonicalId]
  );

  const handleRecordPayment = useCallback(
    (data: Parameters<typeof actions.recordPayment>[1]) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      return runMutation(
        () => actions.recordPayment(deps, data),
        async (res) => {
          const canonicalInstallmentId = resolveCanonicalId(data.installment_id);
          const canonicalTransactionId = resolveCanonicalId(data.transaction_id);
          const canonicalBillId = resolveCanonicalId(data.credit_card_bill_id);
          const canonicalAccountId = resolveCanonicalId(res.account_id);
          const canonicalPaymentMethodId = resolveCanonicalId(data.payment_method_id);

          const saved = await effectiveRepository.savePayment({
            ...data,
            installment_id: canonicalInstallmentId ?? null,
            transaction_id: canonicalTransactionId ?? null,
            credit_card_bill_id: canonicalBillId ?? null,
            account_id: (canonicalAccountId ?? null) as string | null,
            payment_method_id: (canonicalPaymentMethodId ?? null) as string | null,
            affects_balance: res.affects_balance,
            workspace_id: targetWorkspaceId,
          });
          idMapRef.current.set(res.id, saved.id);
          const current = stateRef.current;
          if (current.activeWorkspaceId === targetWorkspaceId) {
            commitState({
              ...current,
              allPayments: current.allPayments.map((p) => (p.id === res.id ? saved : p)),
            });
          }
        },
        targetWorkspaceId
      );
    },
    [deps, effectiveRepository, runMutation, commitState, resolveCanonicalId]
  );

  const handleCreateTransfer = useCallback(
    (fromAccountId: string, toAccountId: string, amount: number, date?: string, notes?: string) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      const canonicalFrom = resolveCanonicalId(fromAccountId);
      const canonicalTo = resolveCanonicalId(toAccountId);
      return runMutation(
        () => actions.createTransfer(deps, fromAccountId, toAccountId, amount, date, notes),
        async (res) => {
          await effectiveRepository.saveTransfer({
            workspace_id: targetWorkspaceId,
            from_account_id: canonicalFrom,
            to_account_id: canonicalTo,
            amount,
            transfer_date: res.transfer_date,
            notes,
          });
        },
        targetWorkspaceId
      );
    },
    [deps, effectiveRepository, runMutation, resolveCanonicalId]
  );

  const handleRecordSettlement = useCallback(
    (data: Parameters<typeof actions.recordSettlement>[1]) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      const canonicalFrom = resolveCanonicalId(data.from_member_id);
      const canonicalTo = resolveCanonicalId(data.to_member_id);
      const canonicalAccount = resolveCanonicalId(data.payment_account_id);
      return runMutation(
        () => actions.recordSettlement(deps, data),
        async (res) => {
          const saved = await effectiveRepository.saveSettlement({
            ...data,
            from_member_id: canonicalFrom,
            to_member_id: canonicalTo,
            payment_account_id: (canonicalAccount ?? null) as string | null,
            settlement_date: res.settlement_date,
            workspace_id: targetWorkspaceId,
          });
          idMapRef.current.set(res.id, saved.id);
        },
        targetWorkspaceId
      );
    },
    [deps, effectiveRepository, runMutation, resolveCanonicalId]
  );

  const handleDeleteSettlement = useCallback(
    (id: string) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      const canonicalId = resolveCanonicalId(id);
      return runMutation(
        () => actions.deleteSettlement(deps, id),
        () => effectiveRepository.deleteSettlement(canonicalId),
        targetWorkspaceId,
        id
      );
    },
    [deps, effectiveRepository, runMutation, resolveCanonicalId]
  );

  const handleAddRecurring = useCallback(
    (data: Omit<RecurringTransaction, 'id' | 'workspace_id' | 'created_at'>) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      return runMutation(
        () => actions.addRecurring(deps, data, processPendingRecurring),
        async (res) => {
          const saved = await effectiveRepository.saveRecurring({
            ...data,
            account_id: resolveCanonicalId(data.account_id),
            category_id: resolveCanonicalId(data.category_id),
            payment_method_id: resolveCanonicalId(data.payment_method_id),
            credit_card_id: resolveCanonicalId(data.credit_card_id),
            workspace_id: targetWorkspaceId,
          });
          idMapRef.current.set(res.id, saved.id);
          const current = stateRef.current;
          if (current.activeWorkspaceId === targetWorkspaceId) {
            commitState({
              ...current,
              allRecurring: current.allRecurring.map((r) => (r.id === res.id ? saved : r)),
            });
          }
        },
        targetWorkspaceId
      );
    },
    [deps, processPendingRecurring, effectiveRepository, runMutation, commitState, resolveCanonicalId]
  );

  const handleToggleRecurring = useCallback(
    (id: string) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      const canonicalId = resolveCanonicalId(id);
      return runMutation(
        () => actions.toggleRecurring(deps, id, processPendingRecurring),
        () => {
          const item = stateRef.current.allRecurring.find((r) => r.id === id)!;
          return effectiveRepository.saveRecurring({ ...item, id: canonicalId, workspace_id: targetWorkspaceId });
        },
        targetWorkspaceId,
        id
      );
    },
    [deps, processPendingRecurring, effectiveRepository, runMutation, resolveCanonicalId]
  );

  const handleDeleteRecurring = useCallback(
    (id: string) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      const canonicalId = resolveCanonicalId(id);
      return runMutation(
        () => actions.deleteRecurring(deps, id),
        () => effectiveRepository.deleteRecurring(canonicalId),
        targetWorkspaceId,
        id
      );
    },
    [deps, effectiveRepository, runMutation, resolveCanonicalId]
  );

  const handleSetBudget = useCallback(
    (categoryId: string, plannedAmount: number, month?: number, year?: number) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      return runMutation(
        () => actions.setBudget(deps, categoryId, plannedAmount, month, year),
        async (res) => {
          const canonicalCategoryId = resolveCanonicalId(categoryId);
          const canonicalBudgetId = idMapRef.current.get(res.id);
          const saved = await effectiveRepository.saveBudget({
            id: canonicalBudgetId,
            workspace_id: targetWorkspaceId,
            category_id: canonicalCategoryId,
            month: res.month,
            year: res.year,
            planned_amount: plannedAmount,
          });
          idMapRef.current.set(res.id, saved.id);
          const current = stateRef.current;
          if (current.activeWorkspaceId === targetWorkspaceId) {
            commitState({
              ...current,
              allBudgets: current.allBudgets.map((bg) => (bg.id === res.id ? saved : bg)),
            });
          }
        },
        targetWorkspaceId
      );
    },
    [deps, effectiveRepository, runMutation, commitState, resolveCanonicalId]
  );

  const handleAddGoal = useCallback(
    (goalData: Omit<FinancialGoal, 'id' | 'workspace_id' | 'created_at'>) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      return runMutation(
        () => actions.addGoal(deps, goalData),
        async (res) => {
          const saved = await effectiveRepository.saveGoal({
            ...goalData,
            workspace_id: targetWorkspaceId,
          });
          idMapRef.current.set(res.id, saved.id);
          const current = stateRef.current;
          if (current.activeWorkspaceId === targetWorkspaceId) {
            commitState({
              ...current,
              allGoals: current.allGoals.map((g) => (g.id === res.id ? saved : g)),
            });
          }
        },
        targetWorkspaceId
      );
    },
    [deps, effectiveRepository, runMutation, commitState]
  );

  const handleUpdateGoal = useCallback(
    (id: string, data: Omit<Partial<FinancialGoal>, 'id' | 'workspace_id' | 'created_at'>) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      const canonicalId = resolveCanonicalId(id);
      return runMutation(
        () => actions.updateGoal(deps, id, data),
        async () => {
          const saved = await effectiveRepository.saveGoal({
            ...data,
            id: canonicalId,
            workspace_id: targetWorkspaceId,
          } as any);
          const current = stateRef.current;
          if (current.activeWorkspaceId === targetWorkspaceId) {
            commitState({
              ...current,
              allGoals: current.allGoals.map((g) => (g.id === id ? { ...g, ...saved } : g)),
            });
          }
        },
        targetWorkspaceId,
        id
      );
    },
    [deps, effectiveRepository, runMutation, resolveCanonicalId, commitState]
  );

  const handleDepositGoal = useCallback(
    (goalId: string, amount: number, accountId: string) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      const canonicalGoalId = resolveCanonicalId(goalId);
      const canonicalAccountId = resolveCanonicalId(accountId);
      return runMutation(
        () => actions.depositGoal(deps, goalId, amount, accountId),
        () => {
          const g = stateRef.current.allGoals.find((gl) => gl.id === goalId)!;
          return effectiveRepository.saveGoal({ ...g, id: canonicalGoalId, workspace_id: targetWorkspaceId });
        },
        targetWorkspaceId,
        goalId
      );
    },
    [deps, effectiveRepository, runMutation, resolveCanonicalId]
  );

  return (
    <FinanceContext.Provider
      value={{
        isLoaded,
        isLoading,
        isSaving,
        error,
        clearError,
        refreshData,
        dataMode,

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
