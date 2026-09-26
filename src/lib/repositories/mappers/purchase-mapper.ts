import { Database } from '../../supabase/database.types';
import {
  Installment,
  Purchase,
  SplitType,
  TransactionSplit,
  TransactionStatus,
} from '../../types';
import { roundCurrency } from '../../financial-engine';

type PurchaseRow = Database['public']['Tables']['purchases']['Row'];
type PurchaseInsert = Database['public']['Tables']['purchases']['Insert'];
type PurchaseSplitRow = Database['public']['Tables']['purchase_splits']['Row'];
type PurchaseSplitInsert = Database['public']['Tables']['purchase_splits']['Insert'];
type InstallmentRow = Database['public']['Tables']['installments']['Row'];
type InstallmentInsert = Database['public']['Tables']['installments']['Insert'];

export function mapPurchaseSplitsToDomain(rows: PurchaseSplitRow[]): TransactionSplit[] {
  return rows.map((r) => ({
    member_id: r.member_id,
    amount: roundCurrency(Number(r.amount ?? 0)),
    percentage: r.percentage !== null && r.percentage !== undefined ? Number(r.percentage) : undefined,
  }));
}

export function mapDomainPurchaseSplitsToInsert(
  purchaseId: string,
  workspaceId: string,
  splits: TransactionSplit[]
): PurchaseSplitInsert[] {
  return splits.map((s) => ({
    purchase_id: purchaseId,
    workspace_id: workspaceId,
    member_id: s.member_id,
    amount: roundCurrency(s.amount),
    percentage: s.percentage !== undefined ? s.percentage : null,
  }));
}

export function mapInstallmentRowToDomain(row: InstallmentRow): Installment {
  return {
    id: row.id,
    purchase_id: row.purchase_id,
    installment_number: row.installment_number,
    amount: roundCurrency(Number(row.amount ?? 0)),
    due_date: row.due_date,
    credit_card_bill_id: row.credit_card_bill_id ?? undefined,
    status: (row.status as TransactionStatus) ?? 'pending',
    paid_amount: roundCurrency(Number(row.paid_amount ?? 0)),
    paid_at: row.paid_at,
    created_at: row.created_at,
  };
}

export function mapDomainToInstallmentInsert(
  domain: Omit<Installment, 'id' | 'created_at'> & { id?: string }
): InstallmentInsert {
  return {
    id: domain.id,
    purchase_id: domain.purchase_id,
    installment_number: domain.installment_number,
    amount: roundCurrency(domain.amount),
    due_date: domain.due_date,
    credit_card_bill_id: domain.credit_card_bill_id ?? null,
    status: domain.status,
    paid_amount: roundCurrency(domain.paid_amount),
    paid_at: domain.paid_at ?? null,
  };
}

export function mapPurchaseRowToDomain(
  row: PurchaseRow,
  splits?: PurchaseSplitRow[],
  installments?: InstallmentRow[]
): Purchase {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    account_id: row.account_id ?? undefined,
    credit_card_id: row.credit_card_id ?? undefined,
    category_id: row.category_id ?? undefined,
    payment_method_id: row.payment_method_id ?? undefined,
    description: row.description,
    total_amount: roundCurrency(Number(row.total_amount ?? 0)),
    installment_count: row.installment_count,
    paid_installments_count: row.paid_installments_count ?? 0,
    paid_by_member_id: row.paid_by_member_id ?? undefined,
    split_type: (row.split_type as SplitType) ?? undefined,
    splits: splits && splits.length > 0 ? mapPurchaseSplitsToDomain(splits) : undefined,
    purchase_date: row.purchase_date,
    created_by: row.created_by ?? undefined,
    created_at: row.created_at,
    installments: installments ? installments.map(mapInstallmentRowToDomain) : undefined,
  };
}

export function mapDomainToPurchaseInsert(
  domain: Omit<Purchase, 'id' | 'created_at'> & { id?: string }
): PurchaseInsert {
  return {
    id: domain.id,
    workspace_id: domain.workspace_id,
    account_id: domain.account_id ?? null,
    credit_card_id: domain.credit_card_id ?? null,
    category_id: domain.category_id ?? null,
    payment_method_id: domain.payment_method_id ?? null,
    description: domain.description,
    total_amount: roundCurrency(domain.total_amount),
    installment_count: domain.installment_count,
    paid_installments_count: domain.paid_installments_count ?? 0,
    paid_by_member_id: domain.paid_by_member_id ?? null,
    split_type: domain.split_type ?? 'individual',
    purchase_date: domain.purchase_date,
    created_by: domain.created_by ?? null,
  };
}
