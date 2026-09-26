import { Database } from '../../supabase/database.types';
import { Transfer } from '../../types';
import { roundCurrency } from '../../financial-engine';

type TransferRow = Database['public']['Tables']['transfers']['Row'];
type TransferInsert = Database['public']['Tables']['transfers']['Insert'];

export function mapTransferRowToDomain(row: TransferRow): Transfer {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    from_account_id: row.from_account_id,
    to_account_id: row.to_account_id,
    amount: roundCurrency(Number(row.amount ?? 0)),
    transfer_date: row.transfer_date,
    notes: row.notes,
    created_by: row.created_by ?? undefined,
    created_at: row.created_at,
  };
}

export function mapDomainToTransferInsert(
  domain: Omit<Transfer, 'id' | 'created_at'> & { id?: string }
): TransferInsert {
  return {
    id: domain.id,
    workspace_id: domain.workspace_id,
    from_account_id: domain.from_account_id,
    to_account_id: domain.to_account_id,
    amount: roundCurrency(domain.amount),
    transfer_date: domain.transfer_date,
    notes: domain.notes ?? null,
    created_by: domain.created_by ?? null,
  };
}
