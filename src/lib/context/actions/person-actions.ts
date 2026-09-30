import { Person } from '../../types';
import { FinanceActionDeps } from './types';

export function addPerson(
  deps: FinanceActionDeps,
  data: {
    name: string;
    workspace_id?: string;
  }
): Person {
  const trimmedName = data.name?.trim();
  if (!trimmedName) {
    throw new Error('Nome da pessoa não pode ser vazio.');
  }

  const state = deps.getState();
  const targetWsId = data.workspace_id || state.activeWorkspaceId;

  // Verifica nome duplicado entre pessoas ativas deste workspace
  const existsActive = (state.allPeople || []).some(
    (p) =>
      p.workspace_id === targetWsId &&
      !p.archived &&
      p.name.trim().toLowerCase() === trimmedName.toLowerCase()
  );
  if (existsActive) {
    throw new Error(`Já existe uma pessoa ativa com o nome "${trimmedName}" neste workspace.`);
  }

  const nowIso = deps.now().toISOString();
  const newPerson: Person = {
    id: deps.generateId('per'),
    workspace_id: targetWsId,
    name: trimmedName,
    archived: false,
    created_at: nowIso,
    updated_at: nowIso,
  };

  deps.commit({
    ...state,
    allPeople: [...(state.allPeople || []), newPerson],
  });

  return newPerson;
}

export function updatePerson(
  deps: FinanceActionDeps,
  id: string,
  data: {
    name?: string;
    archived?: boolean;
  }
): Person {
  const state = deps.getState();
  const people = state.allPeople || [];
  const existing = people.find((p) => p.id === id);
  if (!existing) {
    throw new Error(`Pessoa com id ${id} não encontrada.`);
  }

  let finalName = existing.name;
  if (data.name !== undefined) {
    const trimmed = data.name.trim();
    if (!trimmed) {
      throw new Error('Nome da pessoa não pode ser vazio.');
    }
    finalName = trimmed;
  }

  const finalArchived = data.archived !== undefined ? data.archived : existing.archived;

  // Se ativa (ou permanecendo ativa), valida duplicidade
  if (!finalArchived) {
    const duplicate = people.some(
      (p) =>
        p.workspace_id === existing.workspace_id &&
        p.id !== id &&
        !p.archived &&
        p.name.trim().toLowerCase() === finalName.toLowerCase()
    );
    if (duplicate) {
      throw new Error(`Já existe uma pessoa ativa com o nome "${finalName}" neste workspace.`);
    }
  }

  const nowIso = deps.now().toISOString();
  const updated: Person = {
    ...existing,
    name: finalName,
    archived: finalArchived,
    updated_at: nowIso,
  };

  deps.commit({
    ...state,
    allPeople: people.map((p) => (p.id === id ? updated : p)),
  });

  return updated;
}

export function deletePerson(deps: FinanceActionDeps, id: string): void {
  const state = deps.getState();
  const people = state.allPeople || [];
  const person = people.find((p) => p.id === id);
  if (!person) {
    throw new Error(`Pessoa com id ${id} não encontrada.`);
  }

  // RESTRICT: Não permitir exclusão se houver histórico vinculado
  const hasTxPayer = state.allTransactions.some((t) => t.paid_by_person_id === id);
  const hasTxSplit = state.allTransactions.some((t) => (t.splits || []).some((s) => s.person_id === id));
  const hasPurPayer = state.allPurchases.some((p) => p.paid_by_person_id === id);
  const hasPurSplit = state.allPurchases.some((p) => (p.splits || []).some((s) => s.person_id === id));
  const hasSettlement = (state.allSettlements || []).some(
    (s) => s.from_person_id === id || s.to_person_id === id
  );

  if (hasTxPayer || hasTxSplit || hasPurPayer || hasPurSplit || hasSettlement) {
    throw new Error(
      'Esta pessoa possui histórico financeiro vinculado e não pode ser excluída. Em vez disso, arquive-a.'
    );
  }

  deps.commit({
    ...state,
    allPeople: people.filter((p) => p.id !== id),
  });
}
