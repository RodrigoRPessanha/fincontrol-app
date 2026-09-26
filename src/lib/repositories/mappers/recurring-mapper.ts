import { Database } from '../../supabase/database.types';
import { RecurrenceFrequency, RecurringTransaction, TransactionType } from '../../types';
import { roundCurrency } from '../../financial-engine';

type RecurringRow = Database['public']['Tables']['recurring_transactions']['Row'];
type RecurringInsert = Database['public']['Tables']['recurring_transactions']['Insert'];

export function mapRecurringRowToDomain(row: RecurringRow): RecurringTransaction {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    description: row.description,
    amount: roundCurrency(Number(row.amount ?? 0)),
    type: (row.type as TransactionType) ?? 'expense',
    category_id: row.category_id ?? undefined,
    account_id: row.account_id ?? undefined,
    payment_method_id: row.payment_method_id ?? undefined,
    credit_card_id: row.credit_card_id ?? undefined,
    frequency: (row.frequency as RecurrenceFrequency) ?? 'monthly',
    interval_days: row.interval_days,
    start_date: row.start_date,
    end_date: row.end_date,
    next_occurrence: row.next_occurrence,
    auto_create: row.auto_create ?? false,
    active: row.active ?? true,
    suspended_reason: row.suspended_reason,
    created_at: row.created_at,
  };
}

export function mapDomainToRecurringInsert(
  domain: Omit<RecurringTransaction, 'id' | 'created_at'> & { id?: string }
): RecurringInsert {
  return {
    id: domain.id,
    workspace_id: domain.workspace_id,
    description: domain.description,
    amount: roundCurrency(domain.amount),
    type: domain.type,
    category_id: domain.category_id ?? null,
    account_id: domain.account_id ?? null,
    payment_method_id: domain.payment_method_id ?? null,
    credit_card_id: domain.credit_card_id ?? null,
    frequency: domain.frequency,
    interval_days: domain.interval_days ?? null,
    start_date: domain.start_date,
    end_date: domain.end_date ?? null,
    next_occurrence: domain.next_occurrence,
    auto_create: domain.auto_create,
    active: domain.active,
    suspended_reason: domain.suspended_reason ?? null,
  };
}
