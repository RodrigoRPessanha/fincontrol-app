import { Database } from '../../supabase/database.types';
import { Category } from '../../types';

type CategoryRow = Database['public']['Tables']['categories']['Row'];
type CategoryInsert = Database['public']['Tables']['categories']['Insert'];

export function mapCategoryRowToDomain(row: CategoryRow): Category {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    parent_id: row.parent_id,
    name: row.name,
    icon: row.icon ?? 'tag',
    color: row.color ?? '#6b7280',
    type: (row.type as 'income' | 'expense') ?? 'expense',
    active: row.active ?? true,
    created_at: row.created_at,
  };
}

export function mapDomainToCategoryInsert(
  domain: Omit<Category, 'id' | 'created_at'> & { id?: string }
): CategoryInsert {
  return {
    id: domain.id,
    workspace_id: domain.workspace_id,
    parent_id: domain.parent_id ?? null,
    name: domain.name,
    icon: domain.icon,
    color: domain.color,
    type: domain.type,
    active: domain.active,
  };
}

/**
 * Organiza uma lista plana de categorias em árvore com subcategories populadas.
 */
export function buildCategoryTree(flatCategories: Category[]): Category[] {
  const map = new Map<string, Category>();
  const roots: Category[] = [];

  for (const cat of flatCategories) {
    map.set(cat.id, { ...cat, subcategories: [] });
  }

  for (const cat of flatCategories) {
    const node = map.get(cat.id)!;
    if (cat.parent_id && map.has(cat.parent_id)) {
      map.get(cat.parent_id)!.subcategories!.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}
