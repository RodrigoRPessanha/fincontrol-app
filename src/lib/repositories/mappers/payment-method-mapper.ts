import { Database } from '../../supabase/database.types';
import { PaymentMethod, PaymentMethodType } from '../../types';

type PaymentMethodRow = Database['public']['Tables']['payment_methods']['Row'];
type PaymentMethodInsert = Database['public']['Tables']['payment_methods']['Insert'];

export function mapPaymentMethodRowToDomain(row: PaymentMethodRow): PaymentMethod {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    name: row.name,
    type: (row.type as PaymentMethodType) ?? 'other',
    linked_account_id: row.linked_account_id ?? undefined,
    credit_card_id: row.credit_card_id ?? undefined,
    active: row.active ?? true,
    created_at: row.created_at,
  };
}

export function mapDomainToPaymentMethodInsert(
  domain: Omit<PaymentMethod, 'id' | 'created_at'> & { id?: string }
): PaymentMethodInsert {
  return {
    id: domain.id,
    workspace_id: domain.workspace_id,
    name: domain.name,
    type: domain.type,
    linked_account_id: domain.linked_account_id ?? null,
    credit_card_id: domain.credit_card_id ?? null,
    active: domain.active,
  };
}
