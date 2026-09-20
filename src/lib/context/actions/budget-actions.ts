import { Budget } from '../../types';
import { FinanceActionDeps } from './types';

export function setBudget(
  deps: FinanceActionDeps,
  categoryId: string,
  plannedAmount: number,
  month: number = deps.now().getMonth() + 1,
  year: number = deps.now().getFullYear()
): Budget {
  const state = deps.getState();
  const targetWsId = state.activeWorkspaceId;
  const prev = state.allBudgets;
  const existingIndex = prev.findIndex(
    (b) => b.category_id === categoryId && b.month === month && b.year === year && b.workspace_id === targetWsId
  );

  let resultBudget: Budget;
  let nextBudgets: Budget[];

  if (existingIndex >= 0) {
    resultBudget = { ...prev[existingIndex], planned_amount: plannedAmount };
    nextBudgets = [...prev];
    nextBudgets[existingIndex] = resultBudget;
  } else {
    resultBudget = {
      id: deps.generateId('bud'),
      workspace_id: targetWsId,
      category_id: categoryId,
      month,
      year,
      planned_amount: plannedAmount,
    };
    nextBudgets = [...prev, resultBudget];
  }

  deps.commit({
    ...state,
    allBudgets: nextBudgets,
  });

  return resultBudget;
}
