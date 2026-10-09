import { Database } from '../../supabase/database.types';
import {
  SplitType,
  Transaction,
  TransactionSplit,
  TransactionStatus,
  TransactionType,
} from '../../types';
import { normalizeMoney, readMoney } from '../../financial-engine';

type TransactionRow = Database['public']['Tables']['transactions']['Row'];
type TransactionInsert = Database['public']['Tables']['transactions']['Insert'];
type TransactionSplitRow = Database['public']['Tables']['transaction_splits']['Row'];
type TransactionSplitInsert = Database['public']['Tables']['transaction_splits']['Insert'];

export function mapTransactionSplitsToDomain(rows: TransactionSplitRow[]): TransactionSplit[] {
  return rows.map((r) => ({
    id: r.id,
    workspace_id: r.workspace_id,
    transaction_id: r.transaction_id,
    member_id: r.member_id ?? undefined,
    person_id: r.person_id ?? undefined,
    amount: readMoney(r.amount),
    percentage: r.percentage !== null && r.percentage !== undefined ? Number(r.percentage) : undefined,
  }));
}

export function mapDomainSplitsToInsert(
  transactionId: string,
  workspaceId: string,
  splits: TransactionSplit[]
): TransactionSplitInsert[] {
  return splits.map((s) => ({
    transaction_id: transactionId,
    workspace_id: workspaceId,
    member_id: s.member_id ?? null,
    person_id: s.person_id ?? null,
    amount: normalizeMoney(s.amount, 'Valor monetário', 'nonnegative'),
    percentage: s.percentage !== undefined ? s.percentage : null,
  }));
}

export function mapTransactionRowToDomain(
  row: TransactionRow,
  splits?: TransactionSplitRow[],
  payments?: { amount: number | string | null }[] | number
): Transaction {
  const paidAmount =
    typeof payments === 'number'
      ? readMoney(payments)
      : payments && payments.length > 0
      ? readMoney(payments.reduce((sum, p) => sum + readMoney(p.amount), 0))
      : row.status === 'paid'
      ? readMoney(row.amount)
      : 0;

  return {
    operation_key: row.operation_key ?? undefined,
    id: row.id,
    workspace_id: row.workspace_id,
    account_id: row.account_id ?? undefined,
    category_id: row.category_id ?? undefined,
    payment_method_id: row.payment_method_id ?? undefined,
    credit_card_id: row.credit_card_id ?? undefined,
    credit_card_bill_id: row.credit_card_bill_id ?? undefined,
    recurring_transaction_id: row.recurring_transaction_id ?? undefined,
    paid_by_member_id: row.paid_by_member_id ?? undefined,
    paid_by_person_id: row.paid_by_person_id ?? undefined,
    split_type: (row.split_type as SplitType) ?? undefined,
    splits: splits && splits.length > 0 ? mapTransactionSplitsToDomain(splits) : undefined,
    description: row.description,
    amount: readMoney(row.amount),
    paid_amount: paidAmount,
    type: (row.type as TransactionType) ?? 'expense',
    transaction_date: row.transaction_date,
    due_date: row.due_date,
    paid_at: row.paid_at,
    status: (row.status as TransactionStatus) ?? 'pending',
    notes: row.notes,
    created_by: row.created_by ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function mapDomainToTransactionInsert(
  domain: Omit<Transaction, 'id' | 'created_at'> & { id?: string }
): TransactionInsert {
  return {
    id: domain.id,
    workspace_id: domain.workspace_id,
    account_id: domain.account_id ?? null,
    category_id: domain.category_id ?? null,
    payment_method_id: domain.payment_method_id ?? null,
    credit_card_id: domain.credit_card_id ?? null,
    credit_card_bill_id: domain.credit_card_bill_id ?? null,
    recurring_transaction_id: domain.recurring_transaction_id ?? null,
    paid_by_member_id: domain.paid_by_member_id ?? null,
    paid_by_person_id: domain.paid_by_person_id ?? null,
    split_type: domain.split_type ?? 'individual',
    description: domain.description,
    amount: normalizeMoney(domain.amount, 'Valor monetário', 'positive'),
    type: domain.type,
    transaction_date: domain.transaction_date,
    due_date: domain.due_date,
    paid_at: domain.paid_at ?? null,
    status: domain.status,
    notes: domain.notes ?? null,
    created_by: domain.created_by ?? null,
  };
}
