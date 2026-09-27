import { Database } from '../../supabase/database.types';
import { Payment } from '../../types';
import { roundCurrency } from '../../financial-engine';

type PaymentRow = Database['public']['Tables']['payments']['Row'];
type PaymentInsert = Database['public']['Tables']['payments']['Insert'];

export function mapPaymentRowToDomain(row: PaymentRow): Payment {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    transaction_id: row.transaction_id ?? undefined,
    installment_id: row.installment_id ?? undefined,
    credit_card_bill_id: row.credit_card_bill_id ?? undefined,
    account_id: row.account_id ?? undefined,
    payment_method_id: row.payment_method_id ?? undefined,
    amount: roundCurrency(Number(row.amount ?? 0)),
    payment_date: row.payment_date,
    notes: row.notes,
    created_by: row.created_by ?? undefined,
    created_at: row.created_at,
    affects_balance: row.affects_balance ?? true,
  };
}

export function mapDomainToPaymentInsert(
  domain: Omit<Payment, 'id' | 'created_at'> & { id?: string }
): PaymentInsert {
  return {
    id: domain.id,
    workspace_id: domain.workspace_id,
    transaction_id: domain.transaction_id ?? null,
    installment_id: domain.installment_id ?? null,
    credit_card_bill_id: domain.credit_card_bill_id ?? null,
    account_id: domain.account_id ?? null,
    payment_method_id: domain.payment_method_id ?? null,
    amount: roundCurrency(domain.amount),
    payment_date: domain.payment_date,
    notes: domain.notes ?? null,
    created_by: domain.created_by ?? null,
    affects_balance: domain.affects_balance ?? true,
  };
}
