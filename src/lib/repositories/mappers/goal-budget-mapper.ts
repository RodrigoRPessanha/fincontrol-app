import { Database } from '../../supabase/database.types';
import { Budget, FinancialGoal } from '../../types';
import { roundCurrency } from '../../financial-engine';

type BudgetRow = Database['public']['Tables']['budgets']['Row'];
type BudgetInsert = Database['public']['Tables']['budgets']['Insert'];
type GoalRow = Database['public']['Tables']['financial_goals']['Row'];
type GoalInsert = Database['public']['Tables']['financial_goals']['Insert'];

export function mapBudgetRowToDomain(row: BudgetRow): Budget {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    category_id: row.category_id,
    month: row.month,
    year: row.year,
    planned_amount: roundCurrency(Number(row.planned_amount ?? 0)),
  };
}

export function mapDomainToBudgetInsert(
  domain: Omit<Budget, 'id'> & { id?: string }
): BudgetInsert {
  return {
    id: domain.id,
    workspace_id: domain.workspace_id,
    category_id: domain.category_id,
    month: domain.month,
    year: domain.year,
    planned_amount: domain.planned_amount !== undefined ? roundCurrency(domain.planned_amount) : (undefined as any),
  };
}

export function mapFinancialGoalRowToDomain(row: GoalRow): FinancialGoal {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    name: row.name,
    target_amount: roundCurrency(Number(row.target_amount ?? 0)),
    current_amount: roundCurrency(Number(row.current_amount ?? 0)),
    target_date: row.target_date,
    status: (row.status as 'in_progress' | 'completed' | 'paused') ?? 'in_progress',
    color: row.color ?? '#10b981',
    icon: row.icon ?? 'target',
    created_at: row.created_at,
  };
}

export function mapDomainToFinancialGoalInsert(
  domain: Omit<FinancialGoal, 'id' | 'created_at'> & { id?: string }
): GoalInsert {
  return {
    id: domain.id,
    workspace_id: domain.workspace_id,
    name: domain.name,
    target_amount: domain.target_amount !== undefined ? roundCurrency(domain.target_amount) : (undefined as any),
    current_amount: domain.current_amount !== undefined ? roundCurrency(domain.current_amount) : (undefined as any),
    target_date: domain.target_date ?? null,
    status: domain.status,
    color: domain.color,
    icon: domain.icon,
  };
}
