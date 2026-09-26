import { Database } from '../../supabase/database.types';
import { BillStatus, CreditCard, CreditCardBill } from '../../types';
import { roundCurrency } from '../../financial-engine';

type CreditCardRow = Database['public']['Tables']['credit_cards']['Row'];
type CreditCardInsert = Database['public']['Tables']['credit_cards']['Insert'];
type CreditCardBillRow = Database['public']['Tables']['credit_card_bills']['Row'];
type CreditCardBillInsert = Database['public']['Tables']['credit_card_bills']['Insert'];

export function mapCreditCardRowToDomain(row: CreditCardRow): CreditCard {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    name: row.name,
    institution: row.institution ?? 'Instituição',
    last_four_digits: row.last_four_digits ?? undefined,
    credit_limit: roundCurrency(Number(row.credit_limit ?? 0)),
    closing_day: row.closing_day,
    due_day: row.due_day,
    linked_payment_account_id: row.linked_payment_account_id ?? undefined,
    color: row.color ?? '#6366f1',
    active: row.active ?? true,
    created_at: row.created_at,
  };
}

export function mapDomainToCreditCardInsert(
  domain: Omit<CreditCard, 'id' | 'created_at'> & { id?: string }
): CreditCardInsert {
  return {
    id: domain.id,
    workspace_id: domain.workspace_id,
    name: domain.name,
    institution: domain.institution,
    last_four_digits: domain.last_four_digits ?? null,
    credit_limit: roundCurrency(domain.credit_limit),
    closing_day: domain.closing_day,
    due_day: domain.due_day,
    linked_payment_account_id: domain.linked_payment_account_id ?? null,
    color: domain.color,
    active: domain.active,
  };
}

export function mapCreditCardBillRowToDomain(row: CreditCardBillRow): CreditCardBill {
  return {
    id: row.id,
    credit_card_id: row.credit_card_id,
    workspace_id: row.workspace_id,
    reference_month: row.reference_month,
    closing_date: row.closing_date,
    due_date: row.due_date,
    total_amount: roundCurrency(Number(row.total_amount ?? 0)),
    paid_amount: roundCurrency(Number(row.paid_amount ?? 0)),
    status: (row.status as BillStatus) ?? 'open',
    paid_at: row.paid_at,
    created_at: row.created_at,
  };
}

export function mapDomainToCreditCardBillInsert(
  domain: Omit<CreditCardBill, 'id' | 'created_at'> & { id?: string }
): CreditCardBillInsert {
  return {
    id: domain.id,
    credit_card_id: domain.credit_card_id,
    workspace_id: domain.workspace_id,
    reference_month: domain.reference_month,
    closing_date: domain.closing_date,
    due_date: domain.due_date,
    total_amount: roundCurrency(domain.total_amount),
    paid_amount: roundCurrency(domain.paid_amount),
    status: domain.status,
    paid_at: domain.paid_at ?? null,
  };
}
