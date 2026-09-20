import { Category } from '../types';

/**
 * Resolve e localiza uma categoria ou subcategoria na árvore de categorias.
 * Retorna se foi encontrada, o nome de exibição (composto se subcategoria) e o ID da categoria raiz.
 */
export function resolveCategory(
  categories: Category[],
  categoryId?: string | null
): { isFound: boolean; displayName: string; rootId?: string; rootCategory?: Category } {
  if (!categoryId) return { isFound: false, displayName: 'Sem Categoria', rootId: undefined };
  for (const c of categories) {
    if (c.id === categoryId) {
      return { isFound: true, displayName: c.name, rootId: c.id, rootCategory: c };
    }
    if (c.subcategories && c.subcategories.length > 0) {
      const sub = c.subcategories.find((s) => s.id === categoryId);
      if (sub) {
        return { isFound: true, displayName: `${c.name} > ${sub.name}`, rootId: c.id, rootCategory: c };
      }
    }
  }
  return { isFound: false, displayName: 'Sem Categoria', rootId: undefined };
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
