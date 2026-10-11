import type { FinanceState } from './context/finance-state';
import { fromCents, normalizeMoney, toCents } from './financial-engine/money';

export type WorkspaceMaintenanceAction = 'clear' | 'delete';
export interface WorkspaceMaintenancePreview {
  workspace_id: string;
  name: string;
  fingerprint: string;
  can_delete: boolean;
  counts: Record<string, number>;
  retained: Record<string, number>;
  initial_balance_total: number;
}
export interface WorkspaceMaintenanceRequest {
  action: WorkspaceMaintenanceAction;
  confirmation_name: string;
  expected_fingerprint: string;
  operation_key: string;
}
export interface WorkspaceMaintenanceResult { replayed: boolean; snapshot?: FinanceState }

const removedKeys = ['allTransactions', 'allPurchases', 'allPayments', 'allTransfers', 'allRecurring', 'allBudgets', 'allGoals', 'allSettlements', 'allCreditCardBills'] as const;
const retainedKeys = ['allAccounts', 'allCreditCards', 'allPaymentMethods', 'allCategories', 'allPeople', 'allWorkspaceMembers'] as const;

export function assertWorkspaceOwner(state: FinanceState, workspaceId: string, userId: string): void {
  if (!userId || !state.allWorkspaces.some(w => w.id === workspaceId && w.owner_id === userId) ||
    !state.allWorkspaceMembers.some(m => m.workspace_id === workspaceId && m.user_id === userId && m.role === 'owner')) throw new Error('Somente o proprietário pode limpar ou excluir este workspace.');
}

export function localWorkspaceMaintenancePreview(state: FinanceState, workspaceId: string): WorkspaceMaintenancePreview {
  const ws = state.allWorkspaces.find(w => w.id === workspaceId);
  if (!ws) throw new Error('Workspace não encontrado.');
  const purchaseIds = new Set(state.allPurchases.filter(p => p.workspace_id === workspaceId).map(p => p.id));
  const records = Object.fromEntries([...removedKeys, ...retainedKeys].map(key => [key, state[key].filter(r => r.workspace_id === workspaceId).toSorted((a,b) => a.id.localeCompare(b.id))]));
  const installments = state.allInstallments.filter(i => purchaseIds.has(i.purchase_id)).toSorted((a,b) => a.id.localeCompare(b.id));
  const ownOthers = state.allWorkspaces.filter(w => w.owner_id === ws.owner_id && w.id !== workspaceId && state.allWorkspaceMembers.some(m => m.workspace_id === w.id && m.user_id === ws.owner_id && m.role === 'owner')).map(w => w.id).sort();
  return { workspace_id: workspaceId, name: ws.name, can_delete: ownOthers.length > 0,
    fingerprint: JSON.stringify({ ws, records, installments, ownOthers }),
    counts: { transactions: records.allTransactions.length, purchases: records.allPurchases.length, installments: installments.length, payments: records.allPayments.length, transfers: records.allTransfers.length, recurring: records.allRecurring.length, budgets: records.allBudgets.length, goals: records.allGoals.length, settlements: records.allSettlements.length, bills: records.allCreditCardBills.length },
    retained: { accounts: records.allAccounts.length, cards: records.allCreditCards.length, methods: records.allPaymentMethods.length, categories: records.allCategories.length, people: records.allPeople.length, members: records.allWorkspaceMembers.length },
    initial_balance_total: fromCents(state.allAccounts.filter(a => a.workspace_id === workspaceId).reduce((sum,a) => sum + toCents(normalizeMoney(a.initial_balance, 'Saldo inicial', 'signed')),0)),
  };
}

export function validateWorkspaceMaintenance(preview: WorkspaceMaintenancePreview, request: WorkspaceMaintenanceRequest): void {
  if (!['clear','delete'].includes(request.action)) throw new Error('Operação de workspace inválida.');
  if (!request.operation_key || request.operation_key.length > 200) throw new Error('Identificação da tentativa inválida.');
  if (request.confirmation_name !== preview.name) throw new Error('Digite o nome exato do workspace para confirmar.');
  if (request.expected_fingerprint !== preview.fingerprint) throw new Error('Os dados do workspace mudaram. Atualize a prévia antes de confirmar.');
  if (request.action === 'delete' && !preview.can_delete) throw new Error('Crie outro workspace seu antes de excluir este, ou use Limpar lançamentos.');
}

/** No other workspace is changed. Deletion also removes child rows without workspace_id. */
export function applyWorkspaceMaintenance(state: FinanceState, workspaceId: string, action: WorkspaceMaintenanceAction): FinanceState {
  const purchaseIds = new Set(state.allPurchases.filter(p => p.workspace_id === workspaceId).map(p => p.id));
  const next = { ...state, allInstallments: state.allInstallments.filter(i => !purchaseIds.has(i.purchase_id)) };
  for (const key of removedKeys) (next[key] as {workspace_id:string}[]) = state[key].filter(r => r.workspace_id !== workspaceId);
  if (action === 'clear') next.allAccounts = state.allAccounts.map(a => a.workspace_id === workspaceId ? { ...a, current_balance: normalizeMoney(a.initial_balance,'Saldo inicial','signed') } : a);
  else {
    next.allWorkspaces = state.allWorkspaces.filter(w => w.id !== workspaceId);
    for (const key of retainedKeys) (next[key] as {workspace_id:string}[]) = state[key].filter(r => r.workspace_id !== workspaceId);
    if (next.activeWorkspaceId === workspaceId) next.activeWorkspaceId = next.allWorkspaces[0]?.id || '';
  }
  return next;
}
