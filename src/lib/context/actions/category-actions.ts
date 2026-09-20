import { Category } from '../../types';
import { FinanceActionDeps } from './types';

export function addCategory(
  deps: FinanceActionDeps,
  catData: Omit<Category, 'id' | 'workspace_id' | 'created_at'>
): Category {
  const state = deps.getState();
  const targetWsId = state.activeWorkspaceId;
  const newCat: Category = {
    ...catData,
    id: deps.generateId('cat'),
    workspace_id: targetWsId,
    created_at: deps.now().toISOString(),
  };

  deps.commit({
    ...state,
    allCategories: [...state.allCategories, newCat],
  });

  return newCat;
}

export function updateCategory(
  deps: FinanceActionDeps,
  id: string,
  data: Omit<Partial<Category>, 'id' | 'workspace_id' | 'created_at'>
): void {
  const state = deps.getState();
  const targetWsId = state.activeWorkspaceId;
  deps.commit({
    ...state,
    allCategories: state.allCategories.map((c) =>
      c.id === id && c.workspace_id === targetWsId
        ? { ...c, ...data, id: c.id, workspace_id: c.workspace_id, created_at: c.created_at }
        : c
    ),
  });
}
