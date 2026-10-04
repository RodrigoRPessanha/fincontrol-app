import { Database } from '../../supabase/database.types';
import { Settlement } from '../../types';
import { normalizeMoney, readMoney } from '../../financial-engine';

type SettlementRow = Database['public']['Tables']['settlements']['Row'];
type SettlementInsert = Database['public']['Tables']['settlements']['Insert'];

export function mapSettlementRowToDomain(row: SettlementRow): Settlement {
  return {
    operation_key: row.operation_key ?? undefined,
    id: row.id,
    workspace_id: row.workspace_id,
    from_member_id: row.from_member_id ?? null,
    to_member_id: row.to_member_id ?? null,
    from_person_id: row.from_person_id ?? null,
    to_person_id: row.to_person_id ?? null,
    amount: readMoney(row.amount),
    settlement_date: row.settlement_date,
    notes: row.notes,
    payment_account_id: row.payment_account_id,
    created_at: row.created_at,
  };
}

export function mapDomainToSettlementInsert(
  domain: Omit<Settlement, 'id' | 'created_at'> & { id?: string }
): SettlementInsert {
  return {
    id: domain.id,
    workspace_id: domain.workspace_id,
    from_member_id: domain.from_member_id ?? null,
    to_member_id: domain.to_member_id ?? null,
    from_person_id: domain.from_person_id ?? null,
    to_person_id: domain.to_person_id ?? null,
    amount: normalizeMoney(domain.amount, 'Valor monetário', 'positive'),
    settlement_date: domain.settlement_date,
    notes: domain.notes ?? null,
    payment_account_id: domain.payment_account_id ?? null,
  };
}
