import { Database } from '../../supabase/database.types';
import { Account, AccountType } from '../../types';
import { normalizeMoney, readMoney } from '../../financial-engine';

type AccountRow = Database['public']['Tables']['accounts']['Row'];
type AccountInsert = Database['public']['Tables']['accounts']['Insert'];

export function mapAccountRowToDomain(row: AccountRow): Account {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    name: row.name,
    type: (row.type as AccountType) ?? 'checking',
    institution: row.institution ?? 'Banco',
    initial_balance: readMoney(row.initial_balance),
    current_balance: readMoney(row.current_balance),
    color: row.color ?? '#10b981',
    active: row.active ?? true,
    created_at: row.created_at,
  };
}

export function mapDomainToAccountInsert(
  domain: Omit<Account, 'id' | 'created_at'> & { id?: string }
): AccountInsert {
  return {
    id: domain.id,
    workspace_id: domain.workspace_id,
    name: domain.name,
    type: domain.type,
    institution: domain.institution,
    initial_balance: domain.initial_balance !== undefined ? normalizeMoney(domain.initial_balance, 'Valor monetário', 'signed') : (undefined as any),
    current_balance: domain.current_balance !== undefined ? normalizeMoney(domain.current_balance, 'Valor monetário', 'signed') : (undefined as any),
    color: domain.color,
    active: domain.active,
  };
}
