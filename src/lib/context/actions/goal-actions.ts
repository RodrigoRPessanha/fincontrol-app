import { FinancialGoal } from '../../types';
import { toCents, fromCents, normalizeMoney } from '../../financial-engine';
import { FinanceActionDeps } from './types';

export function addGoal(
  deps: FinanceActionDeps,
  goalData: Omit<FinancialGoal, 'id' | 'workspace_id' | 'created_at'>
): FinancialGoal {
  goalData = { ...goalData, target_amount: normalizeMoney(goalData.target_amount, 'Valor da meta'), current_amount: normalizeMoney(goalData.current_amount ?? 0, 'Valor acumulado', 'nonnegative') };
  const state = deps.getState();
  const targetWsId = state.activeWorkspaceId;
  const newGoal: FinancialGoal = {
    ...goalData,
    id: deps.generateId('goal'),
    workspace_id: targetWsId,
    created_at: deps.now().toISOString(),
  };

  deps.commit({
    ...state,
    allGoals: [...state.allGoals, newGoal],
  });

  return newGoal;
}

export function updateGoal(
  deps: FinanceActionDeps,
  id: string,
  data: Omit<Partial<FinancialGoal>, 'id' | 'workspace_id' | 'created_at'>
): void {
  data = { ...data };
  if (data.target_amount !== undefined) data.target_amount = normalizeMoney(data.target_amount, 'Valor da meta');
  if (data.current_amount !== undefined) data.current_amount = normalizeMoney(data.current_amount, 'Valor acumulado', 'nonnegative');
  const state = deps.getState();
  const targetWsId = state.activeWorkspaceId;
  deps.commit({
    ...state,
    allGoals: state.allGoals.map((g) =>
      g.id === id && g.workspace_id === targetWsId
        ? { ...g, ...data, id: g.id, workspace_id: g.workspace_id, created_at: g.created_at }
        : g
    ),
  });
}

export function depositGoal(
  deps: FinanceActionDeps,
  goalId: string,
  amount: number,
  accountId: string
): void {
  amount = normalizeMoney(amount, 'Valor inválido para depósito na meta');
  const depositCents = toCents(amount);

  const state = deps.getState();
  const targetWsId = state.activeWorkspaceId;
  const activeWs = state.allWorkspaces.find((w) => w.id === targetWsId);
  if (activeWs?.tracking_mode === 'expense_tracker') {
    throw new Error('Aportes em metas financeiras não são permitidos no modo Apenas Despesas.');
  }

  const goal = state.allGoals.find((g) => g.id === goalId && g.workspace_id === targetWsId);
  if (!goal) throw new Error('Meta financeira não encontrada no workspace ativo.');

  const acc = state.allAccounts.find((a) => a.id === accountId && a.workspace_id === targetWsId);
  if (!acc) throw new Error('Conta bancária não encontrada no workspace ativo.');
  if (acc.active === false) throw new Error('A conta bancária informada está inativa.');

  const currentCents = toCents(goal.current_amount || 0);
  const targetCents = toCents(goal.target_amount);
  const newCurrentCents = currentCents + depositCents;
  const isCompleted = newCurrentCents >= targetCents;

  const nextGoals = state.allGoals.map((g) => {
    if (g.id === goalId && g.workspace_id === targetWsId) {
      return {
        ...g,
        current_amount: normalizeMoney(fromCents(newCurrentCents), 'Valor acumulado', 'nonnegative'),
        status: isCompleted ? ('completed' as const) : g.status,
      };
    }
    return g;
  });

  const nextAccounts = state.allAccounts.map((a) =>
    a.id === accountId && a.workspace_id === targetWsId
      ? { ...a, current_balance: normalizeMoney(fromCents(toCents(normalizeMoney(a.current_balance, 'Saldo', 'signed')) - depositCents), 'Saldo', 'signed') }
      : a
  );

  deps.commit({
    ...state,
    allGoals: nextGoals,
    allAccounts: nextAccounts,
  });
}
