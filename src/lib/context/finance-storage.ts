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
import { sanitizeLegacyRecurringState } from '../financial-engine';
import { FinanceState } from './finance-state';

export const STORAGE_PREFIX = 'fincontrol_v2_';
export const STORAGE_VERSION = 1;
export const CURRENT_STORAGE_VERSION = 1;

export const STORAGE_KEYS = {
  schemaVersion: `${STORAGE_PREFIX}schema_version`,
  workspaces: `${STORAGE_PREFIX}workspaces`,
  activeWorkspaceId: `${STORAGE_PREFIX}active_ws`,
  members: `${STORAGE_PREFIX}members`,
  accounts: `${STORAGE_PREFIX}accounts`,
  creditCards: `${STORAGE_PREFIX}creditCards`,
  bills: `${STORAGE_PREFIX}bills`,
  paymentMethods: `${STORAGE_PREFIX}paymentMethods`,
  categories: `${STORAGE_PREFIX}categories`,
  transactions: `${STORAGE_PREFIX}transactions`,
  purchases: `${STORAGE_PREFIX}purchases`,
  installments: `${STORAGE_PREFIX}installments`,
  payments: `${STORAGE_PREFIX}payments`,
  transfers: `${STORAGE_PREFIX}transfers`,
  recurring: `${STORAGE_PREFIX}recurring`,
  budgets: `${STORAGE_PREFIX}budgets`,
  goals: `${STORAGE_PREFIX}goals`,
  settlements: `${STORAGE_PREFIX}settlements`,
} as const;

export interface StorageParseError {
  key: string;
  raw: string;
  error: unknown;
}

export interface LoadFinanceSnapshotResult extends FinanceState {
  snapshot: FinanceState;
  errors: StorageParseError[];
  version: number;
  canPersist: boolean;
}

export interface MigratedSnapshot extends FinanceState {
  snapshot: FinanceState;
  version: number;
  migrated: boolean;
}

export function getInitialFinanceState(): FinanceState {
  return {
    allWorkspaces: mockWorkspaces,
    activeWorkspaceId: mockWorkspaces[0].id,
    allWorkspaceMembers: mockWorkspaceMembers,
    allAccounts: mockAccounts,
    allCreditCards: mockCreditCards,
    allCreditCardBills: mockCreditCardBills,
    allPaymentMethods: mockPaymentMethods,
    allCategories: mockCategories,
    allTransactions: mockTransactions,
    allPurchases: mockPurchases,
    allInstallments: mockInstallments,
    allPayments: mockPayments,
    allTransfers: [],
    allRecurring: mockRecurring,
    allBudgets: mockBudgets,
    allGoals: mockGoals,
    allSettlements: [],
  };
}

export function safeParseDomainKey<T>(
  storage: Storage,
  key: string,
  fallback: T,
  errors: StorageParseError[]
): T {
  let raw: string | null = null;
  try {
    raw = storage.getItem(key);
  } catch (err) {
    errors.push({
      key,
      raw: 'storage_access_error',
      error: err,
    });
    return fallback;
  }

  if (raw === null || raw === undefined) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    errors.push({
      key,
      raw,
      error: err,
    });
    return fallback;
  }
}

export function sanitizeFinanceSnapshot(state: FinanceState): FinanceState {
  const { sanitized: cleanRecs } = sanitizeLegacyRecurringState(
    state.allRecurring,
    state.allPaymentMethods
  );
  return {
    ...state,
    allRecurring: cleanRecs,
  };
}

export function migrateFinanceSnapshot(
  fromVersion: number | null | undefined,
  snapshot: FinanceState
): MigratedSnapshot {
  const sanitized = sanitizeFinanceSnapshot(snapshot);

  // Versão atual (1): idempotente
  if (fromVersion === CURRENT_STORAGE_VERSION) {
    return {
      ...sanitized,
      snapshot: sanitized,
      version: CURRENT_STORAGE_VERSION,
      migrated: false,
    };
  }

  // Versão futura desconhecida (> 1): preserva sem sobrescrever
  if (typeof fromVersion === 'number' && fromVersion > CURRENT_STORAGE_VERSION) {
    return {
      ...sanitized,
      snapshot: sanitized,
      version: fromVersion,
      migrated: false,
    };
  }

  // Legado / sem versão (null, undefined, 0): migra para CURRENT_STORAGE_VERSION
  return {
    ...sanitized,
    snapshot: sanitized,
    version: CURRENT_STORAGE_VERSION,
    migrated: true,
  };
}

export function loadFinanceSnapshot(storage: Storage): LoadFinanceSnapshotResult {
  const initial = getInitialFinanceState();
  const errors: StorageParseError[] = [];

  let fromVersion: number | null = null;
  try {
    const rawVersion = storage.getItem(STORAGE_KEYS.schemaVersion);
    if (rawVersion !== null && rawVersion !== undefined) {
      const parsed = parseInt(rawVersion, 10);
      if (!Number.isNaN(parsed)) {
        fromVersion = parsed;
      }
    }
  } catch (err) {
    errors.push({
      key: STORAGE_KEYS.schemaVersion,
      raw: 'storage_access_error',
      error: err,
    });
  }

  let activeWsId = initial.activeWorkspaceId;
  try {
    const savedActiveWs = storage.getItem(STORAGE_KEYS.activeWorkspaceId);
    if (savedActiveWs && typeof savedActiveWs === 'string' && savedActiveWs.trim() !== '') {
      activeWsId = savedActiveWs;
    }
  } catch (err) {
    errors.push({
      key: STORAGE_KEYS.activeWorkspaceId,
      raw: 'storage_access_error',
      error: err,
    });
  }

  const rawState: FinanceState = {
    allWorkspaces: safeParseDomainKey<Workspace[]>(storage, STORAGE_KEYS.workspaces, initial.allWorkspaces, errors),
    activeWorkspaceId: activeWsId,
    allWorkspaceMembers: safeParseDomainKey<WorkspaceMember[]>(storage, STORAGE_KEYS.members, initial.allWorkspaceMembers, errors),
    allAccounts: safeParseDomainKey<Account[]>(storage, STORAGE_KEYS.accounts, initial.allAccounts, errors),
    allCreditCards: safeParseDomainKey<CreditCard[]>(storage, STORAGE_KEYS.creditCards, initial.allCreditCards, errors),
    allCreditCardBills: safeParseDomainKey<CreditCardBill[]>(storage, STORAGE_KEYS.bills, initial.allCreditCardBills, errors),
    allPaymentMethods: safeParseDomainKey<PaymentMethod[]>(storage, STORAGE_KEYS.paymentMethods, initial.allPaymentMethods, errors),
    allCategories: safeParseDomainKey<Category[]>(storage, STORAGE_KEYS.categories, initial.allCategories, errors),
    allTransactions: safeParseDomainKey<Transaction[]>(storage, STORAGE_KEYS.transactions, initial.allTransactions, errors),
    allPurchases: safeParseDomainKey<Purchase[]>(storage, STORAGE_KEYS.purchases, initial.allPurchases, errors),
    allInstallments: safeParseDomainKey<Installment[]>(storage, STORAGE_KEYS.installments, initial.allInstallments, errors),
    allPayments: safeParseDomainKey<Payment[]>(storage, STORAGE_KEYS.payments, initial.allPayments, errors),
    allTransfers: safeParseDomainKey<Transfer[]>(storage, STORAGE_KEYS.transfers, initial.allTransfers, errors),
    allRecurring: safeParseDomainKey<RecurringTransaction[]>(storage, STORAGE_KEYS.recurring, initial.allRecurring, errors),
    allBudgets: safeParseDomainKey<Budget[]>(storage, STORAGE_KEYS.budgets, initial.allBudgets, errors),
    allGoals: safeParseDomainKey<FinancialGoal[]>(storage, STORAGE_KEYS.goals, initial.allGoals, errors),
    allSettlements: safeParseDomainKey<Settlement[]>(storage, STORAGE_KEYS.settlements, initial.allSettlements, errors),
  };

  const migration = migrateFinanceSnapshot(fromVersion, rawState);
  const cleanSnapshot = migration.snapshot;
  const canPersist = !(fromVersion !== null && fromVersion > CURRENT_STORAGE_VERSION);

  return {
    ...cleanSnapshot,
    snapshot: cleanSnapshot,
    errors,
    version: migration.version,
    canPersist,
  };
}

export function saveFinanceSnapshot(storage: Storage, state: FinanceState): void {
  try {
    const existingVersionRaw = storage.getItem(STORAGE_KEYS.schemaVersion);
    if (existingVersionRaw !== null && existingVersionRaw !== undefined) {
      const existingVersion = parseInt(existingVersionRaw, 10);
      if (!Number.isNaN(existingVersion) && existingVersion > CURRENT_STORAGE_VERSION) {
        console.warn('FinControl: save abortado para proteger schema de versão futura:', existingVersion);
        return;
      }
    }

    storage.setItem(STORAGE_KEYS.schemaVersion, String(CURRENT_STORAGE_VERSION));
    storage.setItem(STORAGE_KEYS.workspaces, JSON.stringify(state.allWorkspaces));
    storage.setItem(STORAGE_KEYS.activeWorkspaceId, state.activeWorkspaceId);
    storage.setItem(STORAGE_KEYS.members, JSON.stringify(state.allWorkspaceMembers));
    storage.setItem(STORAGE_KEYS.accounts, JSON.stringify(state.allAccounts));
    storage.setItem(STORAGE_KEYS.creditCards, JSON.stringify(state.allCreditCards));
    storage.setItem(STORAGE_KEYS.bills, JSON.stringify(state.allCreditCardBills));
    storage.setItem(STORAGE_KEYS.paymentMethods, JSON.stringify(state.allPaymentMethods));
    storage.setItem(STORAGE_KEYS.categories, JSON.stringify(state.allCategories));
    storage.setItem(STORAGE_KEYS.transactions, JSON.stringify(state.allTransactions));
    storage.setItem(STORAGE_KEYS.purchases, JSON.stringify(state.allPurchases));
    storage.setItem(STORAGE_KEYS.installments, JSON.stringify(state.allInstallments));
    storage.setItem(STORAGE_KEYS.payments, JSON.stringify(state.allPayments));
    storage.setItem(STORAGE_KEYS.transfers, JSON.stringify(state.allTransfers));
    storage.setItem(STORAGE_KEYS.recurring, JSON.stringify(state.allRecurring));
    storage.setItem(STORAGE_KEYS.budgets, JSON.stringify(state.allBudgets));
    storage.setItem(STORAGE_KEYS.goals, JSON.stringify(state.allGoals));
    storage.setItem(STORAGE_KEYS.settlements, JSON.stringify(state.allSettlements));
  } catch (err) {
    console.error('Erro ao persistir dados locais no storage:', err);
  }
}
