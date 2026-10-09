import { Category } from '../types';

/** Enumerates flat and legacy nested categories once per ID, preserving explicit rows. */
export function flattenCategories(categories: Category[]): Category[] {
  const index = new Map<string, Category>();
  const pending = [...categories];
  for (let i = 0; i < pending.length; i++) {
    const category = pending[i];
    if (index.has(category.id)) continue;
    index.set(category.id, category);
    for (const child of category.subcategories ?? []) {
      if (child.workspace_id && child.workspace_id !== category.workspace_id) continue;
      pending.push({ ...child, workspace_id: child.workspace_id ?? category.workspace_id, parent_id: child.parent_id ?? category.id });
    }
  }
  return [...index.values()];
}

/** Returns target-to-root ancestry for flat Cloud rows and legacy nested categories. */
export function getCategoryLineage(categories: Category[], categoryId?: string | null): Category[] {
  const index = new Map(flattenCategories(categories).map((category) => [category.id, category]));
  const lineage: Category[] = [];
  const seen = new Set<string>();
  let current = categoryId ? index.get(categoryId) : undefined;
  while (current) {
    if (seen.has(current.id)) return []; // Invalid cycles must not fabricate a root.
    seen.add(current.id);
    lineage.push(current);
    if (!current.parent_id) break;
    const parent = index.get(current.parent_id);
    if (!parent || parent.workspace_id !== current.workspace_id) return [];
    current = parent;
  }
  return lineage;
}

export function resolveCategory(
  categories: Category[], categoryId?: string | null
): { isFound: boolean; displayName: string; rootId?: string; rootCategory?: Category } {
  const lineage = getCategoryLineage(categories, categoryId);
  if (!lineage.length) return { isFound: false, displayName: 'Sem Categoria', rootId: undefined };
  const root = lineage[lineage.length - 1];
  return { isFound: true, displayName: [...lineage].reverse().map((c) => c.name).join(' > '), rootId: root.id, rootCategory: root };
}

/**
 * Validação de integridade e atividade de categoria ou subcategoria.
 */
export function validateCategoryActive(
  categoryId: string,
  categories: Category[],
  workspaceId: string
): void {
  const parent = categories.find(
    (c) =>
      (c.id === categoryId || c.subcategories?.some((s) => s.id === categoryId)) &&
      c.workspace_id === workspaceId
  );
  if (!parent) throw new Error('Categoria informada não pertence ao workspace ativo.');
  if (parent.active === false) throw new Error('A categoria informada está inativa.');
  if (parent.id !== categoryId) {
    const sub = parent.subcategories?.find((s) => s.id === categoryId);
    if (sub && sub.active === false) throw new Error('A subcategoria informada está inativa.');
  }
}
