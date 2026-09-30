import { Database } from '../../supabase/database.types';
import { Person } from '../../types';

type PersonRow = Database['public']['Tables']['people']['Row'];
type PersonInsert = Database['public']['Tables']['people']['Insert'];

export function mapPersonRowToDomain(row: PersonRow): Person {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    name: row.name,
    archived: Boolean(row.archived),
    created_at: row.created_at,
    updated_at: row.updated_at ?? undefined,
  };
}

export function mapDomainToPersonInsert(
  domain: Omit<Person, 'id' | 'created_at'> & { id?: string }
): PersonInsert {
  return {
    id: domain.id,
    workspace_id: domain.workspace_id,
    name: domain.name.trim(),
    archived: domain.archived ?? false,
  };
}
