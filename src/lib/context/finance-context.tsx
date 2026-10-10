'use client';

import { isOperationReplay } from '../repositories/operation-result';
import { normalizeMoney } from '../financial-engine';
import React, { createContext, useContext, useEffect, useLayoutEffect, useState, useMemo, useCallback, useRef } from 'react';
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
  Transaction,
  Transfer,
  UpdateTransactionDTO,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
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

const emptyWorkspace: Workspace = {
  id: '',
  name: 'Nenhum workspace',
  owner_id: '',
  currency: 'BRL',
  created_at: '',
};

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
    'allWorkspaces',
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
    'allPeople',
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

function discardProvisionalWorkspace(state: FinanceState, id: string, previousId: string): FinanceState {
  const workspaces = state.allWorkspaces.filter((workspace) => workspace.id !== id);
  const removedPurchases = new Set(state.allPurchases.filter((purchase) => purchase.workspace_id === id).map((purchase) => purchase.id));
  const next: FinanceState = {
    ...state,
    allWorkspaces: workspaces,
    activeWorkspaceId: state.activeWorkspaceId === id
      ? (workspaces.some((workspace) => workspace.id === previousId) ? previousId : workspaces[0]?.id ?? '')
      : state.activeWorkspaceId,
    allInstallments: state.allInstallments.filter((installment) => !removedPurchases.has(installment.purchase_id)),
  };
  const keys = ['allWorkspaceMembers', 'allAccounts', 'allCreditCards', 'allCreditCardBills', 'allPaymentMethods',
    'allCategories', 'allTransactions', 'allPurchases', 'allPayments', 'allTransfers', 'allRecurring',
    'allBudgets', 'allGoals', 'allSettlements', 'allPeople'] as const;
  for (const key of keys) {
    (next[key] as { workspace_id: string }[]) = state[key].filter((entity) => entity.workspace_id !== id);
  }
  return next;
}

function applyConfirmedEntities(
  targetState: FinanceState,
  sourceState: FinanceState,
  changedIds: Set<string>,
  aliases: ReadonlyMap<string, string>
): FinanceState {
  const next: FinanceState = { ...targetState };
  const keys: (keyof FinanceState)[] = [
    'allWorkspaces',
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
    'allPeople',
  ];
  const canonicalChangedIds = new Set([...changedIds].map((id) => aliases.get(id) ?? id));
  const canonicalize = (item: { id: string; workspace_id?: string }) => {
    const id = aliases.get(item.id) ?? item.id;
    const workspaceId = item.workspace_id ? aliases.get(item.workspace_id) ?? item.workspace_id : undefined;
    if (id === item.id && workspaceId === item.workspace_id) return item;
    return { ...item, id, ...('workspace_id' in item ? { workspace_id: workspaceId } : {}) };
  };
  for (let k = 0; k < keys.length; k++) {
    const key = keys[k];
    const targetList = targetState[key] as { id: string }[];
    const sourceList = sourceState[key] as { id: string }[];
    if (targetList !== sourceList) {
      const sourceMap = new Map<string, { id: string }>();
      for (let i = 0; i < sourceList.length; i++) {
        const item = canonicalize(sourceList[i]);
        sourceMap.set(item.id, item);
      }
      const updatedList: { id: string }[] = [];
      const handled = new Set<string>();
      for (let i = 0; i < targetList.length; i++) {
        const item = canonicalize(targetList[i]);
        if (canonicalChangedIds.has(item.id)) {
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
        const item = canonicalize(sourceList[i]);
        if (canonicalChangedIds.has(item.id) && !handled.has(item.id)) {
          updatedList.push(item);
          handled.add(item.id);
        }
      }
      (next as any)[key] = updatedList;
    }
  }
  return next;
}

function mergeSnapshotWithPendingState(
  snapshot: FinanceState,
  currentState: FinanceState,
  pendingIds: Map<string, number>
): FinanceState {
  if (pendingIds.size === 0) return snapshot;

  const merged: FinanceState = { ...snapshot };
  const keys: (keyof FinanceState)[] = [
    'allWorkspaces',
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
    'allPeople',
  ];

  for (let k = 0; k < keys.length; k++) {
    const key = keys[k];
    const remoteList = snapshot[key] as { id: string }[];
    const currentList = currentState[key] as { id: string }[];
    const currentMap = new Map<string, { id: string }>();
    for (let i = 0; i < currentList.length; i++) {
      currentMap.set(currentList[i].id, currentList[i]);
    }

    const resultList: { id: string }[] = [];
    const includedIds = new Set<string>();

    for (let i = 0; i < remoteList.length; i++) {
      const item = remoteList[i];
      if (pendingIds.has(item.id)) {
        const currentItem = currentMap.get(item.id);
        if (currentItem) {
          resultList.push(currentItem);
          includedIds.add(item.id);
        }
      } else {
        resultList.push(item);
        includedIds.add(item.id);
      }
    }

    for (let i = 0; i < currentList.length; i++) {
      const item = currentList[i];
      if (pendingIds.has(item.id) && !includedIds.has(item.id)) {
        resultList.push(item);
        includedIds.add(item.id);
      }
    }

    (merged as any)[key] = resultList;
  }

  return merged;
}

interface FinanceSessionBoundary {
  assertCurrent: () => void;
}

export function FinanceProvider(props: FinanceProviderProps) {
  const auth = useOptionalAuth();
  const mode = props.initialDataMode ??
    (props.repository instanceof SupabaseFinanceRepository ? 'supabase' :
      props.repository instanceof LocalFinanceRepository ? 'local' :
        auth?.dataMode ?? (process.env.NEXT_PUBLIC_DATA_MODE === 'supabase' ? 'supabase' : 'local'));
  const identity = mode === 'supabase' ? auth?.user?.id ?? 'signed-out' : 'local';
  const token = useMemo(() => ({ mode, identity }), [mode, identity]);
  const currentToken = useRef<object | null>(token);
  // No commit da nova identidade, invalida a anterior antes dos efeitos passivos.
  useLayoutEffect(() => {
    currentToken.current = token;
    return () => { currentToken.current = null; };
  }, [token]);
  const boundary = useMemo<FinanceSessionBoundary>(() => ({
    assertCurrent: () => {
      if (currentToken.current !== token) throw new Error('Sessão alterada: operação da identidade anterior descartada.');
    },
  }), [token]);
  return <FinanceProviderSession key={`${mode}:${identity}`} {...props} initialDataMode={mode} boundary={boundary} />;
}

function FinanceProviderSession({ children, repository, initialDataMode, initialWorkspaceId, boundary }: Omit<FinanceProviderProps, 'initialDataMode'> & { initialDataMode: 'local' | 'supabase'; boundary: FinanceSessionBoundary }) {
  const auth = useOptionalAuth();
  const authUserId = auth?.user?.id;

  const dataMode = initialDataMode;

  const effectiveRepository = useMemo<FinanceRepository>(() => {
    let base: FinanceRepository;
    if (repository) base = repository;
    else if (dataMode === 'supabase') {
      const client = createClient({ userId: auth?.user?.id, assertCurrent: boundary.assertCurrent });
      if (client) {
        base = new SupabaseFinanceRepository(client as any);
      } else base = createFailingRepository('Supabase client não pôde ser inicializado no modo supabase.');
    } else {
      base = new LocalFinanceRepository(typeof window !== 'undefined' ? window.localStorage : undefined);
    }
    if (dataMode === 'local') return base;
    return new Proxy(base, {
      get: (target, key) => {
        const method = Reflect.get(target, key);
        if (typeof method !== 'function') return method;
        return async (...args: unknown[]) => {
          boundary.assertCurrent();
          const result = await method.apply(target, args);
          boundary.assertCurrent();
          return result;
        };
      },
    });
  }, [repository, dataMode, boundary, auth?.user?.id]);

  const [isLoaded, setIsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(dataMode === 'supabase');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const savingCountRef = useRef(0);
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingEntityIdsRef = useRef<Map<string, number>>(new Map());

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
  const [allPeople, setAllPeople] = useState<Person[]>([]);

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
    allPeople,
  });
  const canPersistRef = useRef<boolean>(true);
  const localReadyRef = useRef(false);
  const localDraftRef = useRef<FinanceState | null>(null);

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
      allPeople,
    };
  });

  const commitState = useCallback((next: FinanceState) => {
    if (dataMode === 'local' && localReadyRef.current && canPersistRef.current) {
      try { saveFinanceSnapshot(localStorage, next); }
      catch (err) { setError(err instanceof Error ? err : new Error(String(err))); throw err; }
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
    if (next.allPeople !== prev.allPeople) setAllPeople(next.allPeople || []);
  }, [dataMode]);

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
        localReadyRef.current = true;
      } catch (e) {
        console.error('Erro ao hidratar dados locais:', e);
        canPersistRef.current = false;
        setError(e instanceof Error ? e : new Error(String(e)));
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
        if (!userId) {
          throw new Error('Sessão não encontrada: usuário não autenticado no modo Supabase.');
        }
        let workspaces = await effectiveRepository.getWorkspaces(userId);

        if (!isMounted) return;

        if (!workspaces || workspaces.length === 0) {
          const created = await effectiveRepository.createWorkspace({
            name: 'Meu Workspace',
            owner_id: userId,
            currency: 'BRL',
            tracking_mode: 'full',
          });
          workspaces = [created];
        }

        if (!isMounted) return;

        let savedWorkspaceId: string | null = null;
        try {
          savedWorkspaceId = localStorage.getItem(`fincontrol_active_workspace:${userId}`);
        } catch {
          // The first workspace remains available when browser storage is disabled.
        }
        const currentWsId =
          initialWorkspaceId || savedWorkspaceId || stateRef.current.activeWorkspaceId;
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

  const idMapRef = useRef<Map<string, string>>(new Map());
  const resolveCanonicalId = useCallback(<T extends string | null | undefined>(id: T): T => {
    if (!id) return id;
    return (idMapRef.current.get(id) ?? id) as T;
  }, []);

  const registerCanonicalId = useCallback((tempId: string, canonicalId: string) => {
    idMapRef.current.set(tempId, canonicalId);
    const count = pendingEntityIdsRef.current.get(tempId);
    if (count) {
      pendingEntityIdsRef.current.set(canonicalId, count);
    }
  }, []);

  const unresolvedWorkspacesRef = useRef(new Set<string>());
  const pendingWorkspaceEditsRef = useRef(new Set<{ workspaceId: string; patch: Partial<Workspace> }>());
  const withPendingWorkspaceEdits = useCallback((workspace: Workspace): Workspace => {
    let merged = workspace;
    for (const edit of pendingWorkspaceEditsRef.current) {
      if (resolveCanonicalId(edit.workspaceId) === workspace.id) {
        for (const key of ['name', 'currency', 'tracking_mode'] as const) {
          if (edit.patch[key] !== undefined) merged = { ...merged, [key]: edit.patch[key] };
        }
      }
    }
    return merged;
  }, [resolveCanonicalId]);

  const refreshData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (dataMode === 'supabase') {
        const targetId = stateRef.current.activeWorkspaceId;
        const snapshot = await effectiveRepository.loadSnapshot(targetId);
        const reconciled = mergeSnapshotWithPendingState(snapshot, stateRef.current, pendingEntityIdsRef.current);
        if (snapshot.allWorkspaceMembers.some((m) => m.workspace_id === targetId && m.user_id === auth?.user?.id)) {
          unresolvedWorkspacesRef.current.delete(targetId);
        }
        commitState({ ...reconciled, allWorkspaces: reconciled.allWorkspaces.map(withPendingWorkspaceEdits) });
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
  }, [dataMode, effectiveRepository, commitState, auth?.user?.id, withPendingWorkspaceEdits]);

  // Contrato desacoplado de dependências para actions de domínio
  const currentUserId = auth?.user?.id;
  const deps: FinanceActionDeps = useMemo(
    () => ({
      getState: () => localDraftRef.current ?? stateRef.current,
      commit: (next: FinanceState) => {
        if (!canPersistRef.current) {
          throw new Error('Operação bloqueada: o aplicativo está em modo somente leitura para proteger dados de uma versão futura.');
        }
        if (localDraftRef.current) { localDraftRef.current = next; return; }
        commitState(next);
      },
      generateId: (prefix: string) => generateId(prefix, dataMode),
      now: () => new Date(),
      getUserId: () => {
        if (dataMode === 'supabase') {
          return currentUserId as string;
        }
        return currentUserId || 'usr-1';
      },
    }),
    [commitState, dataMode, currentUserId]
  );

  const pendingMutationsCountRef = useRef(0);
  const failedWorkspacesRef = useRef<Set<string>>(new Set());
  const rollbackBaseStateRef = useRef<FinanceState | null>(null);
  const hasSuccessfulMutationsRef = useRef(false);
  const failedEntityIdsRef = useRef<Set<string>>(new Set());
  const workspaceSwitchSeqRef = useRef(0);

  const runMutationInternal = useCallback(
    <T,>(
      localAction: () => T,
      remotePersist?: (result: T, confirmPending?: (confirmed?: Partial<FinanceState>) => void) => Promise<unknown>,
      targetWorkspaceId?: string | ((result: T) => string),
      entityId?: string
    ): { result: T; done: Promise<T> } => {
      if (dataMode === 'supabase') boundary.assertCurrent();
      if (dataMode === 'supabase' && !currentUserId) {
        throw new Error('Operação não permitida: usuário não autenticado no modo Supabase.');
      }
      if (dataMode === 'supabase' && typeof targetWorkspaceId !== 'function' &&
        unresolvedWorkspacesRef.current.has(resolveCanonicalId(targetWorkspaceId ?? stateRef.current.activeWorkspaceId))) {
        throw new Error('Workspace aguardando confirmação de acesso. Sincronize os dados antes de gravar.');
      }

      if (dataMode === 'local' || !remotePersist) {
        localDraftRef.current = stateRef.current;
        try {
          const res = localAction();
          const next = localDraftRef.current;
          localDraftRef.current = null;
          commitState(next);
          return { result: res, done: Promise.resolve(res) };
        } catch (err) {
          localDraftRef.current = null;
          throw err;
        }
      }

      let resolveRemote!: (value: T) => void;
      let rejectRemote!: (reason: any) => void;
      const done = new Promise<T>((resolve, reject) => {
        resolveRemote = resolve;
        rejectRemote = reject;
      });
      done.catch(() => {});

      if (pendingMutationsCountRef.current === 0) {
        rollbackBaseStateRef.current = stateRef.current;
        hasSuccessfulMutationsRef.current = false;
        failedEntityIdsRef.current.clear();
      }
      const previousState = stateRef.current;
      let result: T;
      try {
        result = localAction();
      } catch (err) {
        rejectRemote(err);
        throw err;
      }
      const afterState = stateRef.current;
      const wsId = typeof targetWorkspaceId === 'function' ? targetWorkspaceId(result) : targetWorkspaceId ?? previousState.activeWorkspaceId;
      const workspaceName = afterState.allWorkspaces.find((w) => resolveCanonicalId(w.id) === resolveCanonicalId(wsId))?.name;
      const changedIds = collectChangedIds(previousState, afterState);
      if (entityId) {
        changedIds.add(entityId);
      }
      if (result && typeof (result as any).id === 'string') {
        changedIds.add((result as any).id);
      }

      for (const id of changedIds) {
        pendingEntityIdsRef.current.set(id, (pendingEntityIdsRef.current.get(id) || 0) + 1);
      }

      let isPendingConfirmed = false;
      const confirmPending = () => {
        if (isPendingConfirmed) return;
        isPendingConfirmed = true;
        for (const id of changedIds) {
          const canonical = idMapRef.current.get(id);
          const idsToClean = canonical && canonical !== id ? [id, canonical] : [id];
          for (const targetId of idsToClean) {
            const currentCount = pendingEntityIdsRef.current.get(targetId) || 1;
            if (currentCount <= 1) {
              pendingEntityIdsRef.current.delete(targetId);
            } else {
              pendingEntityIdsRef.current.set(targetId, currentCount - 1);
            }
          }
        }
      };
      let remoteConfirmed = false;
      let confirmedOverrides: Partial<FinanceState> = {};
      const acknowledge = (confirmed?: Partial<FinanceState>) => {
        remoteConfirmed = true;
        confirmedOverrides = { ...confirmedOverrides, ...confirmed };
        hasSuccessfulMutationsRef.current = true;
        if (rollbackBaseStateRef.current) {
          rollbackBaseStateRef.current = applyConfirmedEntities(
            rollbackBaseStateRef.current, { ...afterState, ...confirmedOverrides }, changedIds, idMapRef.current
          );
        }
        confirmPending();
      };

      savingCountRef.current += 1;
      pendingMutationsCountRef.current += 1;
      setIsSaving(true);

      // Serializa as mutações em fila ordenada (mutex/queue assíncrona)
      mutationQueueRef.current = mutationQueueRef.current
        .then(async () => {
          try {
            const persisted = await remotePersist(result, acknowledge);
            acknowledge();
            if (failedWorkspacesRef.current.size === 0) {
              setError(null);
            }
            resolveRemote(persisted && typeof persisted === 'object' && 'id' in persisted ? persisted as T : result);
          } catch (err) {
            console.error('Falha na persistência remota, reconciliando estado com repositório:', err);
            const errorObj = err instanceof Error ? err : new Error(String(err));
            const canonicalWorkspaceId = resolveCanonicalId(wsId);
            Object.assign(errorObj, { workspace_id: canonicalWorkspaceId, workspace_name: workspaceName });
            setError(errorObj);
            failedWorkspacesRef.current.add(canonicalWorkspaceId);
            if (!remoteConfirmed) for (const id of changedIds) {
              failedEntityIdsRef.current.add(resolveCanonicalId(id));
            }
            rejectRemote(errorObj);
          } finally {
            confirmPending();
            pendingMutationsCountRef.current = Math.max(0, pendingMutationsCountRef.current - 1);
            // Se todas as mutações da fila terminaram e houve alguma falha, reconcilia o workspace ativo
            if (pendingMutationsCountRef.current === 0) {
              if (failedWorkspacesRef.current.size > 0) {
                const currentActiveWs = stateRef.current.activeWorkspaceId;
                const shouldReconcile = [...failedWorkspacesRef.current].some((id) => resolveCanonicalId(id) === resolveCanonicalId(currentActiveWs));
                failedWorkspacesRef.current.clear();
                if (shouldReconcile) {
                  try {
                    let confirmed = await effectiveRepository.loadSnapshot(resolveCanonicalId(currentActiveWs));
                    if (!confirmed.allWorkspaces.some((w) => w.id === confirmed.activeWorkspaceId)) {
                      const fallback = confirmed.allWorkspaces.find((w) => w.id === previousState.activeWorkspaceId) ?? confirmed.allWorkspaces[0];
                      confirmed = fallback ? await effectiveRepository.loadSnapshot(fallback.id) : { ...confirmed, activeWorkspaceId: '' };
                    }
                    if (stateRef.current.activeWorkspaceId === currentActiveWs) {
                      if (confirmed.allWorkspaceMembers.some((m) => m.workspace_id === confirmed.activeWorkspaceId && m.user_id === currentUserId)) {
                        unresolvedWorkspacesRef.current.delete(confirmed.activeWorkspaceId);
                      }
                      commitState({ ...confirmed, allWorkspaces: confirmed.allWorkspaces.map(withPendingWorkspaceEdits) });
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
                          allWorkspaces: reconcileFailedEntities(s.allWorkspaces, base?.allWorkspaces, failedIds),
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
                          allPeople: reconcileFailedEntities(s.allPeople || [], base?.allPeople || [], failedIds),
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

      return { result, done };
    },
    [dataMode, effectiveRepository, commitState, currentUserId, boundary, resolveCanonicalId, withPendingWorkspaceEdits]
  );

  const runMutation = useCallback(
    <T,>(
      localAction: () => T,
      remotePersist?: (result: T, confirmPending?: (confirmed?: Partial<FinanceState>) => void) => Promise<unknown>,
      targetWorkspaceId?: string | ((result: T) => string),
      entityId?: string
    ): T => {
      return runMutationInternal(localAction, remotePersist, targetWorkspaceId, entityId).result;
    },
    [runMutationInternal]
  );

  const activeWorkspace = useMemo(() => {
    return (
      allWorkspaces.find((w) => w.id === activeWorkspaceId) ||
      allWorkspaces[0] ||
      (isSupabaseMode ? emptyWorkspace : mockWorkspaces[0])
    );
  }, [allWorkspaces, activeWorkspaceId, isSupabaseMode]);

  useEffect(() => {
    if (
      dataMode !== 'supabase' ||
      !isLoaded ||
      !authUserId ||
      !allWorkspaces.some((workspace) => workspace.id === activeWorkspaceId)
    ) {
      return;
    }
    try {
      localStorage.setItem(`fincontrol_active_workspace:${authUserId}`, activeWorkspaceId);
    } catch {
      // The current session still keeps its active workspace if storage is unavailable.
    }
  }, [dataMode, isLoaded, authUserId, allWorkspaces, activeWorkspaceId]);

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

  const currentWorkspaceRole = useMemo<WorkspaceRole | null>(() => {
    const userId = auth?.user?.id;
    if (!userId) return null;
    return workspaceMembers.find((member) => member.user_id === userId)?.role ?? null;
  }, [auth?.user?.id, workspaceMembers]);
  const isWorkspaceReadOnly = dataMode === 'supabase' && (
    isLoading || !auth?.user?.id || currentWorkspaceRole === null || currentWorkspaceRole === 'viewer'
  );

  const settlements = useMemo(
    () => allSettlements.filter((s) => s.workspace_id === activeWorkspace.id),
    [allSettlements, activeWorkspace.id]
  );

  const people = useMemo(
    () => (allPeople || []).filter((p) => p.workspace_id === activeWorkspace.id && !p.archived),
    [allPeople, activeWorkspace.id]
  );

  const allWorkspacePeople = useMemo(
    () => (allPeople || []).filter((p) => p.workspace_id === activeWorkspace.id),
    [allPeople, activeWorkspace.id]
  );

  // Executa processamento de recorrências
  const processPendingRecurring = useCallback(() => {
    if (!isLoaded) return;
    if (dataMode === 'supabase') {
      effectiveRepository
        .materializeRecurring(stateRef.current.activeWorkspaceId)
        .then(() => refreshData())
        .catch((err) => {
          console.error('Falha ao materializar recorrências no Supabase:', err);
        });
      return;
    }
    if (!canPersistRef.current) {
      throw new Error('Operação bloqueada: o aplicativo está em modo somente leitura para proteger dados de uma versão futura.');
    }
    actions.processPendingRecurring(deps);
  }, [deps, isLoaded, dataMode, effectiveRepository, refreshData]);

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
        const workspaceId = resolveCanonicalId(id);
        setActiveWorkspaceId(workspaceId);
        stateRef.current.activeWorkspaceId = workspaceId;
        setIsLoading(true);
        try {
          const snapshot = await effectiveRepository.loadSnapshot(workspaceId);
          if (workspaceSwitchSeqRef.current === seq) {
            if (snapshot.allWorkspaceMembers.some((m) => m.workspace_id === workspaceId && m.user_id === currentUserId)) {
              unresolvedWorkspacesRef.current.delete(workspaceId);
            }
            commitState({ ...snapshot, allWorkspaces: snapshot.allWorkspaces.map(withPendingWorkspaceEdits) });
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
        actions.setActiveWorkspaceId(deps, resolveCanonicalId(id));
      }
    },
    [dataMode, deps, effectiveRepository, commitState, resolveCanonicalId, currentUserId, withPendingWorkspaceEdits]
  );

  const handleCreateWorkspace = useCallback(
    (name: string, tracking_mode?: WorkspaceTrackingMode) => {
      let provisionalOwnerId = '';
      let previousWorkspaceId = '';
      return runMutation(
        () => {
          previousWorkspaceId = stateRef.current.activeWorkspaceId;
          const created = actions.createWorkspace(deps, name, tracking_mode);
          provisionalOwnerId = deps.getState().allWorkspaceMembers.find((m) => m.workspace_id === created.id && m.user_id === created.owner_id)!.id;
          return created;
        },
        async (createdWs, confirmPending) => {
          let remoteWs: Workspace;
          try {
            remoteWs = await effectiveRepository.createWorkspace({
              name: createdWs.name,
              owner_id: createdWs.owner_id,
              currency: createdWs.currency,
              tracking_mode: createdWs.tracking_mode,
            });
          } catch (err) {
            commitState(discardProvisionalWorkspace(stateRef.current, createdWs.id, previousWorkspaceId));
            throw err;
          }
          registerCanonicalId(createdWs.id, remoteWs.id);
          unresolvedWorkspacesRef.current.add(remoteWs.id);
          const partial = stateRef.current;
          commitState({
            ...partial,
            activeWorkspaceId: partial.activeWorkspaceId === createdWs.id ? remoteWs.id : partial.activeWorkspaceId,
            allWorkspaces: [...partial.allWorkspaces.filter((w) => w.id !== createdWs.id && w.id !== remoteWs.id), withPendingWorkspaceEdits(remoteWs)],
            allWorkspaceMembers: partial.allWorkspaceMembers.filter((m) => m.workspace_id !== createdWs.id && m.workspace_id !== remoteWs.id),
          });
          confirmPending?.({ allWorkspaces: [remoteWs], allWorkspaceMembers: [] });
          let members: WorkspaceMember[];
          try {
            members = await effectiveRepository.getWorkspaceMembers(remoteWs.id);
          } catch {
            const recovered = await effectiveRepository.loadSnapshot(remoteWs.id);
            members = recovered.allWorkspaceMembers.filter((m) => m.workspace_id === remoteWs.id);
          }
          const owner = members.find((m) => m.workspace_id === remoteWs.id && m.user_id === remoteWs.owner_id && m.role === 'owner');
          if (!owner) throw new Error('Não foi possível confirmar o membro proprietário do novo workspace.');
          registerCanonicalId(provisionalOwnerId, owner.id);
          unresolvedWorkspacesRef.current.delete(remoteWs.id);
          confirmPending?.({ allWorkspaceMembers: members });
          const current = stateRef.current;
          const remapWorkspace = <T extends { workspace_id: string }>(entities: T[]): T[] =>
            entities.map((entity) => entity.workspace_id === createdWs.id ? { ...entity, workspace_id: remoteWs.id } : entity);
          commitState({
            ...current,
            activeWorkspaceId: current.activeWorkspaceId === createdWs.id ? remoteWs.id : current.activeWorkspaceId,
            allWorkspaces: [...current.allWorkspaces.filter((w) => w.id !== createdWs.id && w.id !== remoteWs.id), withPendingWorkspaceEdits(remoteWs)],
            allWorkspaceMembers: [
              ...current.allWorkspaceMembers.filter((m) => m.workspace_id !== createdWs.id && m.workspace_id !== remoteWs.id),
              ...members.filter((m) => m.workspace_id === remoteWs.id),
            ],
            allTransactions: current.allTransactions.map((t) => t.workspace_id === createdWs.id ? {
              ...t,
              workspace_id: remoteWs.id,
              paid_by_member_id: resolveCanonicalId(t.paid_by_member_id),
              splits: t.splits?.map((s) => ({ ...s, member_id: resolveCanonicalId(s.member_id) })),
            } : t),
            allAccounts: remapWorkspace(current.allAccounts),
            allCreditCards: remapWorkspace(current.allCreditCards),
            allCreditCardBills: remapWorkspace(current.allCreditCardBills),
            allPaymentMethods: remapWorkspace(current.allPaymentMethods),
            allCategories: remapWorkspace(current.allCategories),
            allPurchases: remapWorkspace(current.allPurchases).map((p) => p.workspace_id === remoteWs.id ? {
              ...p,
              paid_by_member_id: resolveCanonicalId(p.paid_by_member_id),
              splits: p.splits?.map((s) => ({ ...s, member_id: resolveCanonicalId(s.member_id) })),
            } : p),
            allPayments: remapWorkspace(current.allPayments),
            allTransfers: remapWorkspace(current.allTransfers),
            allRecurring: remapWorkspace(current.allRecurring),
            allBudgets: remapWorkspace(current.allBudgets),
            allGoals: remapWorkspace(current.allGoals),
            allPeople: remapWorkspace(current.allPeople),
            allSettlements: remapWorkspace(current.allSettlements).map((s) => s.workspace_id === remoteWs.id ? {
              ...s,
              from_member_id: resolveCanonicalId(s.from_member_id),
              to_member_id: resolveCanonicalId(s.to_member_id),
            } : s),
          });
          return remoteWs;
        },
        (createdWs) => createdWs.id
      );
    },
    [deps, effectiveRepository, runMutation, commitState, registerCanonicalId, resolveCanonicalId, withPendingWorkspaceEdits]
  );

  const handleUpdateWorkspace = useCallback(
    (id: string, data: Partial<Workspace>) => {
      const edit = { workspaceId: id, patch: data };
      return runMutation(
        () => {
          actions.updateWorkspace(deps, resolveCanonicalId(id), data);
          if (dataMode === 'supabase') pendingWorkspaceEditsRef.current.add(edit);
        },
        async (_result, confirmPending) => {
          try {
            const saved = await effectiveRepository.updateWorkspace(resolveCanonicalId(id), data);
            pendingWorkspaceEditsRef.current.delete(edit);
            const current = stateRef.current;
            commitState({ ...current, allWorkspaces: current.allWorkspaces.map((w) => w.id === saved.id ? withPendingWorkspaceEdits(saved) : w) });
            confirmPending?.({ allWorkspaces: [saved] });
            return saved;
          } finally {
            pendingWorkspaceEditsRef.current.delete(edit);
          }
        },
        id,
        id
      );
    },
    [deps, effectiveRepository, runMutation, resolveCanonicalId, dataMode, commitState, withPendingWorkspaceEdits]
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
            workspace_id: resolveCanonicalId(targetWorkspaceId),
            user_id: resolvedUserId,
            role,
          });
          const fresh = await effectiveRepository.loadSnapshot(resolveCanonicalId(targetWorkspaceId));
          if (stateRef.current.activeWorkspaceId === resolveCanonicalId(targetWorkspaceId)) {
            commitState(fresh);
          }
        },
        targetWorkspaceId
      );
    },
    [deps, effectiveRepository, runMutation, commitState, resolveCanonicalId]
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
            workspace_id: resolveCanonicalId(targetWorkspaceId),
          });
          registerCanonicalId(res.id, saved.id);
          const current = stateRef.current;
          if (current.activeWorkspaceId === resolveCanonicalId(targetWorkspaceId)) {
            commitState({
              ...current,
              allAccounts: current.allAccounts.map((a) => (a.id === res.id ? (pendingEntityIdsRef.current.get(res.id)! > 1 ? { ...saved, ...a, id: saved.id } : saved) : a)),
            });
          }
        },
        targetWorkspaceId
      );
    },
    [deps, effectiveRepository, runMutation, commitState, registerCanonicalId, resolveCanonicalId]
  );

  const handleUpdateAccount = useCallback(
    (id: string, data: Omit<Partial<Account>, 'id' | 'workspace_id' | 'created_at'>) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      return runMutation(
        () => actions.updateAccount(deps, resolveCanonicalId(id), data),
        async () => {
          const saved = await effectiveRepository.saveAccount({
            ...data,
            id: resolveCanonicalId(id),
            workspace_id: resolveCanonicalId(targetWorkspaceId),
          } as any);
          const current = stateRef.current;
          if (current.activeWorkspaceId === resolveCanonicalId(targetWorkspaceId)) {
            commitState({
              ...current,
              allAccounts: current.allAccounts.map((a) => (resolveCanonicalId(a.id) === resolveCanonicalId(id) ? { ...a, ...saved } : a)),
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
      return runMutation(
        () => actions.deleteAccount(deps, resolveCanonicalId(id)),
        () => effectiveRepository.deleteAccount(resolveCanonicalId(id)),
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
            workspace_id: resolveCanonicalId(targetWorkspaceId),
          });
          registerCanonicalId(res.id, saved.id);
          const current = stateRef.current;
          if (current.activeWorkspaceId === resolveCanonicalId(targetWorkspaceId)) {
            commitState({
              ...current,
              allCreditCards: current.allCreditCards.map((c) => (c.id === res.id ? (pendingEntityIdsRef.current.get(res.id)! > 1 ? { ...saved, ...c, id: saved.id } : saved) : c)),
            });
          }
        },
        targetWorkspaceId
      );
    },
    [deps, effectiveRepository, runMutation, commitState, registerCanonicalId, resolveCanonicalId]
  );

  const handleUpdateCreditCard = useCallback(
    (id: string, data: Omit<Partial<CreditCard>, 'id' | 'workspace_id' | 'created_at'>) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      return runMutation(
        () => actions.updateCreditCard(deps, resolveCanonicalId(id), data),
        async () => {
          const saved = await effectiveRepository.saveCreditCard({
            ...data,
            id: resolveCanonicalId(id),
            workspace_id: resolveCanonicalId(targetWorkspaceId),
          } as any);
          const current = stateRef.current;
          if (current.activeWorkspaceId === resolveCanonicalId(targetWorkspaceId)) {
            commitState({
              ...current,
              allCreditCards: current.allCreditCards.map((c) => (resolveCanonicalId(c.id) === resolveCanonicalId(id) ? { ...c, ...saved } : c)),
            });
          }
        },
        targetWorkspaceId,
        id
      );
    },
    [deps, effectiveRepository, runMutation, resolveCanonicalId, commitState]
  );

  const executePayCreditCardBill = useCallback(
    (billId: string, accountId?: string | null, amount?: number, paymentDate?: string, notes?: string, operationKey?: string) => {
      operationKey = operationKey ?? deps.generateId('operation');
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      return runMutationInternal(
        () => actions.payCreditCardBill(deps, resolveCanonicalId(billId), resolveCanonicalId(accountId), amount, paymentDate, notes, operationKey),
        async (res, confirmPending) => {
          const saved = await effectiveRepository.savePayment({
            operation_key: operationKey,
            workspace_id: resolveCanonicalId(targetWorkspaceId),
            credit_card_bill_id: resolveCanonicalId(billId),
            account_id: (resolveCanonicalId(accountId) ?? res.account_id ?? null) as string | null,
            affects_balance: res.affects_balance,
            amount: res.amount,
            payment_date: res.payment_date,
            notes: res.notes,
          });
          if (isOperationReplay(saved)) {
            const fresh = await effectiveRepository.loadSnapshot(resolveCanonicalId(targetWorkspaceId));
            confirmPending?.();
            if (stateRef.current.activeWorkspaceId === resolveCanonicalId(targetWorkspaceId)) commitState(mergeSnapshotWithPendingState(fresh, stateRef.current, pendingEntityIdsRef.current));
          }
          return saved;
        },
        targetWorkspaceId
      );
    },
    [deps, effectiveRepository, runMutationInternal, resolveCanonicalId, commitState]
  );

  const handlePayCreditCardBill = useCallback(
    (billId: string, accountId?: string | null, amount?: number, paymentDate?: string, notes?: string, operationKey?: string): Payment => {
      return executePayCreditCardBill(billId, accountId, amount, paymentDate, notes, operationKey).result;
    },
    [executePayCreditCardBill]
  );

  const handlePayCreditCardBillAsync = useCallback(
    async (billId: string, accountId?: string | null, amount?: number, paymentDate?: string, notes?: string, operationKey?: string): Promise<Payment> => {
      return executePayCreditCardBill(billId, accountId, amount, paymentDate, notes, operationKey).done;
    },
    [executePayCreditCardBill]
  );

  const executeAddPaymentMethod = useCallback(
    (pmData: Omit<PaymentMethod, 'id' | 'workspace_id' | 'created_at'>) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      return runMutationInternal(
        () => actions.addPaymentMethod(deps, pmData),
        async (res, acknowledge) => {
          const saved = await effectiveRepository.savePaymentMethod({
            ...res,
            id: undefined,
            workspace_id: resolveCanonicalId(targetWorkspaceId),
          });
          registerCanonicalId(res.id, saved.id);
          const current = stateRef.current;
          if (current.activeWorkspaceId === resolveCanonicalId(targetWorkspaceId)) {
            commitState({
              ...current,
              allPaymentMethods: current.allPaymentMethods.map((p) => (p.id === res.id ?
                (pendingEntityIdsRef.current.get(res.id)! > 1 ? { ...saved, ...p, id: saved.id, workspace_id: saved.workspace_id } : saved) : p)),
            });
          }
          acknowledge?.({ allPaymentMethods: [saved] });
          return saved;
        },
        targetWorkspaceId
      );
    },
    [deps, effectiveRepository, runMutationInternal, commitState, registerCanonicalId, resolveCanonicalId]
  );

  const handleAddPaymentMethod = useCallback(
    (data: Omit<PaymentMethod, 'id' | 'workspace_id' | 'created_at'>) => executeAddPaymentMethod(data).result,
    [executeAddPaymentMethod]
  );
  const handleAddPaymentMethodAsync = useCallback(
    async (data: Omit<PaymentMethod, 'id' | 'workspace_id' | 'created_at'>) => executeAddPaymentMethod(data).done,
    [executeAddPaymentMethod]
  );
  const handleUpdatePaymentMethodAsync = useCallback(
    async (id: string, data: Partial<Pick<PaymentMethod, 'name' | 'type' | 'active'>>) => {
      const workspaceId = stateRef.current.activeWorkspaceId;
      return runMutationInternal(
        () => actions.updatePaymentMethod(deps, resolveCanonicalId(id), data),
        async (result, acknowledge) => {
          const saved = await effectiveRepository.updatePaymentMethod(resolveCanonicalId(id), resolveCanonicalId(workspaceId), {
            ...data, ...(data.name !== undefined ? { name: result.name } : {}),
          });
          const current = stateRef.current;
          if (current.activeWorkspaceId === resolveCanonicalId(workspaceId)) {
            commitState({ ...current, allPaymentMethods: current.allPaymentMethods.map((pm) =>
              resolveCanonicalId(pm.id) === saved.id ? (pendingEntityIdsRef.current.get(id)! > 1 ? { ...saved, ...pm, id: saved.id } : saved) : pm) });
          }
          acknowledge?.({ allPaymentMethods: [saved] });
          return saved;
        }, workspaceId, id
      ).done;
    }, [deps, effectiveRepository, runMutationInternal, resolveCanonicalId, commitState]
  );
  const handleDeletePaymentMethodAsync = useCallback(
    async (id: string) => runMutationInternal(
      () => actions.deletePaymentMethod(deps, resolveCanonicalId(id)),
      () => effectiveRepository.deletePaymentMethod(resolveCanonicalId(id)),
      stateRef.current.activeWorkspaceId, id
    ).done,
    [deps, effectiveRepository, runMutationInternal, resolveCanonicalId]
  );

  const handleAddCategory = useCallback(
    (catData: Omit<Category, 'id' | 'workspace_id' | 'created_at'>) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      return runMutation(
        () => actions.addCategory(deps, catData),
        async (res) => {
          const saved = await effectiveRepository.saveCategory({
            ...catData,
            workspace_id: resolveCanonicalId(targetWorkspaceId),
          });
          registerCanonicalId(res.id, saved.id);
          const current = stateRef.current;
          if (current.activeWorkspaceId === resolveCanonicalId(targetWorkspaceId)) {
            commitState({
              ...current,
              allCategories: current.allCategories.map((c) => (c.id === res.id ? (pendingEntityIdsRef.current.get(res.id)! > 1 ? { ...saved, ...c, id: saved.id } : saved) : c)),
            });
          }
        },
        targetWorkspaceId
      );
    },
    [deps, effectiveRepository, runMutation, commitState, registerCanonicalId, resolveCanonicalId]
  );

  const handleUpdateCategory = useCallback(
    (id: string, data: Omit<Partial<Category>, 'id' | 'workspace_id' | 'created_at'>) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      return runMutation(
        () => actions.updateCategory(deps, resolveCanonicalId(id), data),
        async () => {
          const saved = await effectiveRepository.saveCategory({
            ...data,
            id: resolveCanonicalId(id),
            workspace_id: resolveCanonicalId(targetWorkspaceId),
          } as any);
          const current = stateRef.current;
          if (current.activeWorkspaceId === resolveCanonicalId(targetWorkspaceId)) {
            commitState({
              ...current,
              allCategories: current.allCategories.map((c) => (resolveCanonicalId(c.id) === resolveCanonicalId(id) ? { ...c, ...saved } : c)),
            });
          }
        },
        targetWorkspaceId,
        id
      );
    },
    [deps, effectiveRepository, runMutation, resolveCanonicalId, commitState]
  );

  const executeAddTransaction = useCallback(
    (txData: Omit<Transaction, 'id' | 'workspace_id' | 'created_at'>) => {
      txData = { ...txData, operation_key: txData.operation_key ?? deps.generateId('operation') };
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      return runMutationInternal(
        () => actions.addTransaction(deps, txData),
        async (res, confirmPending) => {
          const saved = await effectiveRepository.saveTransaction({
            ...txData,
            account_id: resolveCanonicalId(txData.account_id),
            category_id: resolveCanonicalId(txData.category_id),
            payment_method_id: resolveCanonicalId(txData.payment_method_id),
            credit_card_id: resolveCanonicalId(txData.credit_card_id),
            credit_card_bill_id: resolveCanonicalId(txData.credit_card_bill_id),
            paid_by_member_id: resolveCanonicalId(txData.paid_by_member_id),
            paid_by_person_id: resolveCanonicalId(txData.paid_by_person_id),
            splits: txData.splits?.map((s) => ({
              ...s,
              member_id: resolveCanonicalId(s.member_id),
              person_id: resolveCanonicalId(s.person_id),
            })),
            workspace_id: resolveCanonicalId(targetWorkspaceId),
          });
          registerCanonicalId(res.id, saved.id);
          if (isOperationReplay(saved)) {
            const fresh = await effectiveRepository.loadSnapshot(resolveCanonicalId(targetWorkspaceId));
            confirmPending?.();
            if (stateRef.current.activeWorkspaceId === resolveCanonicalId(targetWorkspaceId)) {
              commitState(mergeSnapshotWithPendingState(fresh, stateRef.current, pendingEntityIdsRef.current));
            }
            return saved;
          }
          if (res.credit_card_bill_id && saved.credit_card_bill_id) {
            idMapRef.current.set(res.credit_card_bill_id, saved.credit_card_bill_id);
            const fresh = await effectiveRepository.loadSnapshot(resolveCanonicalId(targetWorkspaceId));
            confirmPending?.();
            if (stateRef.current.activeWorkspaceId === resolveCanonicalId(targetWorkspaceId)) {
              const current = stateRef.current;
              const reconciled = {
                ...current,
                allTransactions: current.allTransactions.map((t) => t.id === res.id ? saved : t),
                allCreditCardBills: current.allCreditCardBills.map((b) => b.id === res.credit_card_bill_id ? { ...b, id: saved.credit_card_bill_id! } : b),
              };
              commitState(mergeSnapshotWithPendingState(fresh, reconciled, pendingEntityIdsRef.current));
            }
            return saved;
          }
          const current = stateRef.current;
          if (current.activeWorkspaceId === resolveCanonicalId(targetWorkspaceId)) {
            commitState({
              ...current,
              allTransactions: current.allTransactions.map((t) => (t.id === res.id ? (pendingEntityIdsRef.current.get(res.id)! > 1 ? { ...saved, ...t, id: saved.id } : saved) : t)),
            });
          }
          return saved;
        },
        targetWorkspaceId
      );
    },
    [deps, effectiveRepository, runMutationInternal, commitState, resolveCanonicalId, registerCanonicalId]
  );

  const handleAddTransaction = useCallback((data: Parameters<typeof actions.addTransaction>[1]) => executeAddTransaction(data).result, [executeAddTransaction]);
  const handleAddTransactionAsync = useCallback(async (data: Parameters<typeof actions.addTransaction>[1]) => executeAddTransaction(data).done, [executeAddTransaction]);

  const handleUpdateTransaction = useCallback(
    (id: string, data: UpdateTransactionDTO) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      return runMutation(
        () => actions.updateTransaction(deps, resolveCanonicalId(id), data),
        () => {
          const item = stateRef.current.allTransactions.find((t) => resolveCanonicalId(t.id) === resolveCanonicalId(id));
          return effectiveRepository.saveTransaction({
            ...item,
            ...data,
            id: resolveCanonicalId(id),
            category_id: data.category_id !== undefined ? resolveCanonicalId(data.category_id) : item!.category_id,
            paid_by_member_id: data.paid_by_member_id !== undefined ? resolveCanonicalId(data.paid_by_member_id) : item!.paid_by_member_id,
            paid_by_person_id: data.paid_by_person_id !== undefined ? resolveCanonicalId(data.paid_by_person_id) : item!.paid_by_person_id,
            splits: (data.splits !== undefined ? data.splits : item?.splits)?.map((s) => ({
              ...s,
              member_id: resolveCanonicalId(s.member_id),
              person_id: resolveCanonicalId(s.person_id),
            })),
            workspace_id: resolveCanonicalId(targetWorkspaceId),
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
      return runMutation(
        () => actions.deleteTransaction(deps, resolveCanonicalId(id)),
        () => effectiveRepository.deleteTransaction(resolveCanonicalId(id)),
        targetWorkspaceId,
        id
      );
    },
    [deps, effectiveRepository, runMutation, resolveCanonicalId]
  );

  const handleDuplicateTransaction = useCallback(
    (id: string) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      return runMutation(
        () => actions.duplicateTransaction(deps, resolveCanonicalId(id)),
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
            paid_by_person_id: resolveCanonicalId(res.paid_by_person_id),
            splits: res.splits?.map((split) => ({
              ...split, member_id: resolveCanonicalId(split.member_id), person_id: resolveCanonicalId(split.person_id),
            })),
            workspace_id: resolveCanonicalId(targetWorkspaceId),
          });
          registerCanonicalId(res.id, saved.id);
          const current = stateRef.current;
          if (current.activeWorkspaceId === resolveCanonicalId(targetWorkspaceId)) {
            commitState({
              ...current,
              allTransactions: current.allTransactions.map((t) => (t.id === res.id ? (pendingEntityIdsRef.current.get(res.id)! > 1 ? { ...saved, ...t, id: saved.id } : saved) : t)),
            });
          }
        },
        targetWorkspaceId
      );
    },
    [deps, effectiveRepository, runMutation, commitState, resolveCanonicalId, registerCanonicalId]
  );

  const executeCreateInstallmentPurchase = useCallback(
    (data: Parameters<typeof actions.createInstallmentPurchase>[1]) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      data = { ...data, operation_key: data.operation_key ?? deps.generateId('operation') };
      return runMutationInternal(
        () => actions.createInstallmentPurchase(deps, data),
        async (localPurchase, confirmPending) => {
          const localInsts = stateRef.current.allInstallments.filter(
            (i) => i.purchase_id === localPurchase.id
          );
          const canonicalCardId = resolveCanonicalId(data.credit_card_id);
          const canonicalCategoryId = resolveCanonicalId(data.category_id);
          const canonicalPaymentMethodId = resolveCanonicalId(data.payment_method_id);
          const canonicalPaidByMemberId = resolveCanonicalId(data.paid_by_member_id);
          const canonicalPaidByPersonId = resolveCanonicalId(data.paid_by_person_id);

          const remotePurchase = await effectiveRepository.savePurchase({
            ...data,
            credit_card_id: canonicalCardId,
            account_id: resolveCanonicalId(data.account_id),
            category_id: canonicalCategoryId,
            payment_method_id: canonicalPaymentMethodId,
            paid_by_member_id: canonicalPaidByMemberId,
            paid_by_person_id: canonicalPaidByPersonId,
            splits: data.splits?.map((s) => ({
              ...s,
              member_id: resolveCanonicalId(s.member_id),
              person_id: resolveCanonicalId(s.person_id),
            })),
            workspace_id: resolveCanonicalId(targetWorkspaceId),
          });

          registerCanonicalId(localPurchase.id, remotePurchase.id);

          const fresh = await effectiveRepository.loadSnapshot(resolveCanonicalId(targetWorkspaceId));
          const remoteInsts = fresh.allInstallments.filter((ri) => ri.purchase_id === remotePurchase.id);
          localInsts.forEach((li) => {
            const ri = remoteInsts.find((r) => r.installment_number === li.installment_number);
            if (ri) {
              registerCanonicalId(li.id, ri.id);
              if (li.credit_card_bill_id && ri.credit_card_bill_id) {
                registerCanonicalId(li.credit_card_bill_id, ri.credit_card_bill_id);
              }
            }
          });

          confirmPending?.();
          const current = stateRef.current;
          if (current.activeWorkspaceId === resolveCanonicalId(targetWorkspaceId)) {
            const reconciled = {
              ...current,
              allPurchases: current.allPurchases.map((p) => (p.id === localPurchase.id ? remotePurchase : p)),
              allCreditCardBills: current.allCreditCardBills.map((bill) => ({
                ...bill, id: resolveCanonicalId(bill.id),
              })),
              allInstallments: current.allInstallments.map((inst) => {
                if (inst.purchase_id === localPurchase.id) {
                  const ri = remoteInsts.find((r) => r.installment_number === inst.installment_number);
                  return ri ? {
                    ...(pendingEntityIdsRef.current.get(ri.id) ? { ...ri, ...inst } : { ...inst, ...ri }),
                    id: ri.id, purchase_id: remotePurchase.id, credit_card_bill_id: ri.credit_card_bill_id,
                  } : inst;
                }
                return inst;
              }),
            };
            const confirmed = {
              ...fresh,
              allPurchases: fresh.allPurchases.some((p) => p.id === remotePurchase.id)
                ? fresh.allPurchases : [...fresh.allPurchases, remotePurchase],
            };
            commitState(mergeSnapshotWithPendingState(confirmed, reconciled, pendingEntityIdsRef.current));
          }
          return remotePurchase;
        },
        targetWorkspaceId
      );
    },
    [deps, effectiveRepository, runMutationInternal, commitState, resolveCanonicalId, registerCanonicalId]
  );

  const handleCreateInstallmentPurchase = useCallback((data: Parameters<typeof actions.createInstallmentPurchase>[1]) => executeCreateInstallmentPurchase(data).result, [executeCreateInstallmentPurchase]);
  const handleCreateInstallmentPurchaseAsync = useCallback(async (data: Parameters<typeof actions.createInstallmentPurchase>[1]) => executeCreateInstallmentPurchase(data).done, [executeCreateInstallmentPurchase]);

  const executeRecordPayment = useCallback(
    (data: Parameters<typeof actions.recordPayment>[1]) => {
      data = { ...data, operation_key: data.operation_key ?? deps.generateId('operation') };
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      return runMutationInternal(
        () => actions.recordPayment(deps, data),
        async (res, confirmPending) => {
          const canonicalInstallmentId = resolveCanonicalId(data.installment_id);
          const canonicalTransactionId = resolveCanonicalId(data.transaction_id);
          const canonicalPaymentMethodId = resolveCanonicalId(data.payment_method_id);

          const saved = await effectiveRepository.savePayment({
            ...data,
            installment_id: canonicalInstallmentId ?? null,
            transaction_id: canonicalTransactionId ?? null,
            credit_card_bill_id: resolveCanonicalId(data.credit_card_bill_id) ?? null,
            account_id: (resolveCanonicalId(res.account_id) ?? null) as string | null,
            payment_method_id: (canonicalPaymentMethodId ?? null) as string | null,
            affects_balance: res.affects_balance,
            workspace_id: resolveCanonicalId(targetWorkspaceId),
          });
          registerCanonicalId(res.id, saved.id);
          const current = stateRef.current;
          if (current.activeWorkspaceId === resolveCanonicalId(targetWorkspaceId)) {
            commitState({
              ...current,
              allPayments: current.allPayments.map((p) => (p.id === res.id ? saved : p)),
            });
          }
          if (isOperationReplay(saved)) {
            const fresh = await effectiveRepository.loadSnapshot(resolveCanonicalId(targetWorkspaceId));
            confirmPending?.();
            if (stateRef.current.activeWorkspaceId === resolveCanonicalId(targetWorkspaceId)) commitState(mergeSnapshotWithPendingState(fresh, stateRef.current, pendingEntityIdsRef.current));
          }
          return saved;
        },
        targetWorkspaceId
      );
    },
    [deps, effectiveRepository, runMutationInternal, commitState, resolveCanonicalId, registerCanonicalId]
  );

  const handleRecordPayment = useCallback(
    (data: Parameters<typeof actions.recordPayment>[1]): Payment => {
      return executeRecordPayment(data).result;
    },
    [executeRecordPayment]
  );

  const handleRecordPaymentAsync = useCallback(
    async (data: Parameters<typeof actions.recordPayment>[1]): Promise<Payment> => {
      return executeRecordPayment(data).done;
    },
    [executeRecordPayment]
  );

  const executeCreateTransfer = useCallback(
    (fromAccountId: string, toAccountId: string, amount: number, date?: string, notes?: string, operationKey?: string) => {
      operationKey = operationKey ?? deps.generateId('operation');
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      return runMutationInternal(
        () => actions.createTransfer(deps, resolveCanonicalId(fromAccountId), resolveCanonicalId(toAccountId), amount, date, notes, operationKey),
        async (res, confirmPending) => {
          const saved = await effectiveRepository.saveTransfer({
            operation_key: operationKey,
            workspace_id: resolveCanonicalId(targetWorkspaceId),
            from_account_id: resolveCanonicalId(fromAccountId),
            to_account_id: resolveCanonicalId(toAccountId),
            amount,
            transfer_date: res.transfer_date,
            notes,
          });
          registerCanonicalId(res.id, saved.id);
          const current = stateRef.current;
          if (current.activeWorkspaceId === resolveCanonicalId(targetWorkspaceId)) commitState({ ...current, allTransfers: current.allTransfers.map((item) => item.id === res.id ? saved : item) });
          if (isOperationReplay(saved)) {
            const fresh = await effectiveRepository.loadSnapshot(resolveCanonicalId(targetWorkspaceId));
            confirmPending?.();
            if (stateRef.current.activeWorkspaceId === resolveCanonicalId(targetWorkspaceId)) commitState(mergeSnapshotWithPendingState(fresh, stateRef.current, pendingEntityIdsRef.current));
          }
          return saved;
        },
        targetWorkspaceId
      );
    },
    [deps, effectiveRepository, runMutationInternal, resolveCanonicalId, commitState, registerCanonicalId]
  );

  const handleCreateTransfer = useCallback((...args: Parameters<typeof executeCreateTransfer>) => executeCreateTransfer(...args).result, [executeCreateTransfer]);
  const handleCreateTransferAsync = useCallback(async (...args: Parameters<typeof executeCreateTransfer>) => executeCreateTransfer(...args).done, [executeCreateTransfer]);

  const executeRecordSettlement = useCallback(
    (data: Parameters<typeof actions.recordSettlement>[1]) => {
      data = { ...data, operation_key: data.operation_key ?? deps.generateId('operation') };
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      return runMutationInternal(
        () => actions.recordSettlement(deps, data),
        async (res, confirmPending) => {
          const saved = await effectiveRepository.saveSettlement({
            ...data,
            from_member_id: resolveCanonicalId(data.from_member_id) ?? res.from_member_id,
            to_member_id: resolveCanonicalId(data.to_member_id) ?? res.to_member_id,
            from_person_id: resolveCanonicalId(data.from_person_id) ?? res.from_person_id,
            to_person_id: resolveCanonicalId(data.to_person_id) ?? res.to_person_id,
            payment_account_id: (resolveCanonicalId(data.payment_account_id) ?? null) as string | null,
            settlement_date: res.settlement_date,
            workspace_id: resolveCanonicalId(targetWorkspaceId),
          });
          registerCanonicalId(res.id, saved.id);
          registerCanonicalId(res.id, saved.id);
          const current = stateRef.current;
          if (current.activeWorkspaceId === resolveCanonicalId(targetWorkspaceId)) commitState({ ...current, allSettlements: current.allSettlements.map((item) => item.id === res.id ? saved : item) });
          if (isOperationReplay(saved)) {
            const fresh = await effectiveRepository.loadSnapshot(resolveCanonicalId(targetWorkspaceId));
            confirmPending?.();
            if (stateRef.current.activeWorkspaceId === resolveCanonicalId(targetWorkspaceId)) commitState(mergeSnapshotWithPendingState(fresh, stateRef.current, pendingEntityIdsRef.current));
          }
          return saved;
        },
        targetWorkspaceId
      );
    },
    [deps, effectiveRepository, runMutationInternal, resolveCanonicalId, registerCanonicalId, commitState]
  );

  const handleRecordSettlement = useCallback((data: Parameters<typeof executeRecordSettlement>[0]) => executeRecordSettlement(data).result, [executeRecordSettlement]);
  const handleRecordSettlementAsync = useCallback(async (data: Parameters<typeof executeRecordSettlement>[0]) => executeRecordSettlement(data).done, [executeRecordSettlement]);

  const handleDeleteSettlement = useCallback(
    (id: string) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      return runMutation(
        () => actions.deleteSettlement(deps, resolveCanonicalId(id)),
        () => effectiveRepository.deleteSettlement(resolveCanonicalId(id)),
        targetWorkspaceId,
        id
      );
    },
    [deps, effectiveRepository, runMutation, resolveCanonicalId]
  );

  const handleAddPerson = useCallback(
    (nameOrData: string | { name: string; workspace_id?: string }) => {
      const data = typeof nameOrData === 'string' ? { name: nameOrData } : nameOrData;
      const targetWorkspaceId = data.workspace_id || stateRef.current.activeWorkspaceId;
      return runMutation(
        () => actions.addPerson(deps, data),
        async (res) => {
          const saved = await effectiveRepository.savePerson({
            workspace_id: resolveCanonicalId(targetWorkspaceId),
            name: res.name,
            archived: res.archived,
          });
          registerCanonicalId(res.id, saved.id);
          const current = stateRef.current;
          if (current.activeWorkspaceId === resolveCanonicalId(targetWorkspaceId)) {
            commitState({
              ...current,
              allPeople: (current.allPeople || []).map((p) => (p.id === res.id ? saved : p)),
            });
          }
        },
        targetWorkspaceId
      );
    },
    [deps, effectiveRepository, runMutation, commitState, registerCanonicalId, resolveCanonicalId]
  );

  const handleUpdatePerson = useCallback(
    (id: string, data: { name?: string; archived?: boolean }) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      const targetId = (stateRef.current.allPeople || []).some((p) => p.id === resolveCanonicalId(id)) ? resolveCanonicalId(id) : id;
      return runMutation(
        () => actions.updatePerson(deps, targetId, data),
        async (res) => {
          await effectiveRepository.savePerson({
            id: resolveCanonicalId(id),
            workspace_id: resolveCanonicalId(targetWorkspaceId),
            name: res.name,
            archived: res.archived,
          });
        },
        targetWorkspaceId,
        resolveCanonicalId(id)
      );
    },
    [deps, effectiveRepository, runMutation, resolveCanonicalId]
  );

  const handleDeletePerson = useCallback(
    (id: string) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      const targetId = (stateRef.current.allPeople || []).some((p) => p.id === resolveCanonicalId(id)) ? resolveCanonicalId(id) : id;
      return runMutation(
        () => actions.deletePerson(deps, targetId),
        () => effectiveRepository.deletePerson(resolveCanonicalId(id)),
        targetWorkspaceId,
        resolveCanonicalId(id)
      );
    },
    [deps, effectiveRepository, runMutation, resolveCanonicalId]
  );

  const handleAddRecurring = useCallback(
    (data: Omit<RecurringTransaction, 'id' | 'workspace_id' | 'created_at'>) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      // No modo Supabase, não dispara processPendingRecurring de forma prematura durante a ação otimista
      // para evitar corrida entre a recarga do snapshot e a persistência remota
      const onProcessed = dataMode === 'supabase' ? () => {} : processPendingRecurring;
      return runMutation(
        () => actions.addRecurring(deps, data, onProcessed),
        async (res, confirmPending) => {
          const saved = await effectiveRepository.saveRecurring({
            ...data,
            account_id: resolveCanonicalId(data.account_id),
            category_id: resolveCanonicalId(data.category_id),
            payment_method_id: resolveCanonicalId(data.payment_method_id),
            credit_card_id: resolveCanonicalId(data.credit_card_id),
            workspace_id: resolveCanonicalId(targetWorkspaceId),
          });
          registerCanonicalId(res.id, saved.id);
          const current = stateRef.current;
          if (current.activeWorkspaceId === resolveCanonicalId(targetWorkspaceId)) {
            commitState({
              ...current,
              allRecurring: current.allRecurring.map((r) => (r.id === res.id ? { ...r, id: saved.id } : r)),
            });
          }
          await effectiveRepository.materializeRecurring(resolveCanonicalId(targetWorkspaceId));
          confirmPending?.();
          await refreshData();
        },
        targetWorkspaceId
      );
    },
    [deps, processPendingRecurring, effectiveRepository, runMutation, commitState, resolveCanonicalId, registerCanonicalId, dataMode, refreshData]
  );

  const handleToggleRecurring = useCallback(
    (id: string) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      const onProcessed = dataMode === 'supabase' ? () => {} : processPendingRecurring;
      return runMutation(
        () => actions.toggleRecurring(deps, resolveCanonicalId(id), onProcessed),
        async (toggledItem, confirmPending) => {
          if (!toggledItem) return;
          const currentItem = stateRef.current.allRecurring.find(
            (r) => r.id === resolveCanonicalId(id) || resolveCanonicalId(r.id) === resolveCanonicalId(id)
          ) ?? toggledItem;
          await effectiveRepository.saveRecurring({
            ...currentItem,
            id: resolveCanonicalId(id),
            account_id: resolveCanonicalId(currentItem.account_id),
            category_id: resolveCanonicalId(currentItem.category_id),
            payment_method_id: resolveCanonicalId(currentItem.payment_method_id),
            credit_card_id: resolveCanonicalId(currentItem.credit_card_id),
            workspace_id: resolveCanonicalId(targetWorkspaceId),
          });
          await effectiveRepository.materializeRecurring(resolveCanonicalId(targetWorkspaceId));
          confirmPending?.();
          await refreshData();
        },
        targetWorkspaceId,
        id
      );
    },
    [deps, processPendingRecurring, effectiveRepository, runMutation, resolveCanonicalId, dataMode, refreshData]
  );

  const handleDeleteRecurring = useCallback(
    (id: string) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      return runMutation(
        () => actions.deleteRecurring(deps, resolveCanonicalId(id)),
        async () => {
          await effectiveRepository.deleteRecurring(resolveCanonicalId(id));
        },
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
            workspace_id: resolveCanonicalId(targetWorkspaceId),
            category_id: canonicalCategoryId,
            month: res.month,
            year: res.year,
            planned_amount: plannedAmount,
          });
          registerCanonicalId(res.id, saved.id);
          const current = stateRef.current;
          if (current.activeWorkspaceId === resolveCanonicalId(targetWorkspaceId)) {
            commitState({
              ...current,
              allBudgets: current.allBudgets.map((bg) => (bg.id === res.id ? saved : bg)),
            });
          }
        },
        targetWorkspaceId
      );
    },
    [deps, effectiveRepository, runMutation, commitState, resolveCanonicalId, registerCanonicalId]
  );

  const handleAddGoal = useCallback(
    (goalData: Omit<FinancialGoal, 'id' | 'workspace_id' | 'created_at'>) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      return runMutation(
        () => actions.addGoal(deps, goalData),
        async (res) => {
          const saved = await effectiveRepository.saveGoal({
            ...goalData,
            workspace_id: resolveCanonicalId(targetWorkspaceId),
          });
          registerCanonicalId(res.id, saved.id);
          const current = stateRef.current;
          if (current.activeWorkspaceId === resolveCanonicalId(targetWorkspaceId)) {
            commitState({
              ...current,
              allGoals: current.allGoals.map((g) => (g.id === res.id ? (pendingEntityIdsRef.current.get(res.id)! > 1 ? { ...saved, ...g, id: saved.id } : saved) : g)),
            });
          }
        },
        targetWorkspaceId
      );
    },
    [deps, effectiveRepository, runMutation, commitState, registerCanonicalId, resolveCanonicalId]
  );

  const handleUpdateGoal = useCallback(
    (id: string, data: Omit<Partial<FinancialGoal>, 'id' | 'workspace_id' | 'created_at'>) => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      return runMutation(
        () => actions.updateGoal(deps, resolveCanonicalId(id), data),
        async () => {
          const saved = await effectiveRepository.saveGoal({
            ...data,
            id: resolveCanonicalId(id),
            workspace_id: resolveCanonicalId(targetWorkspaceId),
          } as any);
          const current = stateRef.current;
          if (current.activeWorkspaceId === resolveCanonicalId(targetWorkspaceId)) {
            commitState({
              ...current,
              allGoals: current.allGoals.map((g) => (resolveCanonicalId(g.id) === resolveCanonicalId(id) ? { ...g, ...saved } : g)),
            });
          }
        },
        targetWorkspaceId,
        id
      );
    },
    [deps, effectiveRepository, runMutation, resolveCanonicalId, commitState]
  );

  const goalDepositOperationsRef = useRef(new Map<string, { signature: string; done: Promise<void> }>());
  const handleDepositGoalAsync = useCallback(
    (goalId: string, amount: number, accountId: string, idempotencyKey?: string): Promise<void> => {
      const targetWorkspaceId = stateRef.current.activeWorkspaceId;
      amount = normalizeMoney(amount, 'Valor inválido para depósito na meta');
      const key = idempotencyKey ?? deps.generateId('goal-deposit');
      const operationKey = `${targetWorkspaceId}:${key}`;
      const signature = JSON.stringify([goalId, accountId, amount]);
      const previous = goalDepositOperationsRef.current.get(operationKey);
      if (previous) {
        if (previous.signature !== signature) throw new Error('Chave de aporte reutilizada com dados diferentes.');
        return previous.done;
      }
      const operation = runMutationInternal(
        () => actions.depositGoal(deps, goalId, amount, accountId),
        async (_, confirmPending) => {
          if (!effectiveRepository.recordGoalDeposit) throw new Error('O repositório não suporta aportes atômicos.');
          await effectiveRepository.recordGoalDeposit(resolveCanonicalId(targetWorkspaceId), resolveCanonicalId(goalId), resolveCanonicalId(accountId), amount, key);
          const fresh = await effectiveRepository.loadSnapshot(resolveCanonicalId(targetWorkspaceId));
          confirmPending?.();
          if (stateRef.current.activeWorkspaceId === resolveCanonicalId(targetWorkspaceId)) {
            commitState(mergeSnapshotWithPendingState(fresh, stateRef.current, pendingEntityIdsRef.current));
          }
        },
        targetWorkspaceId,
        goalId
      );
      goalDepositOperationsRef.current.set(operationKey, { signature, done: operation.done });
      void operation.done.catch(() => goalDepositOperationsRef.current.delete(operationKey));
      return operation.done;
    },
    [deps, effectiveRepository, runMutationInternal, resolveCanonicalId, commitState]
  );
  const handleDepositGoal = useCallback((goalId: string, amount: number, accountId: string) => {
    void handleDepositGoalAsync(goalId, amount, accountId).catch(() => {});
  }, [handleDepositGoalAsync]);

  return (
    <FinanceContext.Provider
      value={{
        isLoaded,
        isLoading,
        isSaving,
        isWorkspaceReadOnly,
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
        payCreditCardBillAsync: handlePayCreditCardBillAsync,

        paymentMethods,
        allWorkspacePaymentMethods,
        addPaymentMethod: handleAddPaymentMethod,
        addPaymentMethodAsync: handleAddPaymentMethodAsync,
        updatePaymentMethodAsync: handleUpdatePaymentMethodAsync,
        deletePaymentMethodAsync: handleDeletePaymentMethodAsync,

        categories,
        allWorkspaceCategories,
        addCategory: handleAddCategory,
        updateCategory: handleUpdateCategory,

        transactions,
        addTransaction: handleAddTransaction,
        addTransactionAsync: handleAddTransactionAsync,
        updateTransaction: handleUpdateTransaction,
        deleteTransaction: handleDeleteTransaction,
        duplicateTransaction: handleDuplicateTransaction,

        purchases,
        installments,
        createInstallmentPurchase: handleCreateInstallmentPurchase,
        createInstallmentPurchaseAsync: handleCreateInstallmentPurchaseAsync,

        payments,
        recordPayment: handleRecordPayment,
        recordPaymentAsync: handleRecordPaymentAsync,

        transfers,
        createTransfer: handleCreateTransfer,
        createTransferAsync: handleCreateTransferAsync,

        settlements,
        recordSettlement: handleRecordSettlement,
        recordSettlementAsync: handleRecordSettlementAsync,
        deleteSettlement: handleDeleteSettlement,

        people,
        allWorkspacePeople,
        addPerson: handleAddPerson,
        updatePerson: handleUpdatePerson,
        deletePerson: handleDeletePerson,

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
        depositGoalAsync: handleDepositGoalAsync,

        viewPerspective,
        setViewPerspective,
        waitForPendingMutations: useCallback(() => mutationQueueRef.current, []),
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
