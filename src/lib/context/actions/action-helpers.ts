import {
  resolveOrCreateCreditCardBill,
  validateCreditCardResolution,
  toCents,
  calculateExpenseSplits,
} from '../../financial-engine';
import { SplitType, TransactionSplit } from '../../types';
import { FinanceActionDeps } from './types';

export function getOrCreateAndAddItemToBill(
  deps: FinanceActionDeps,
  cardId: string,
  referenceMonth: string,
  closingDate: string,
  dueDate: string,
  amount: number,
  wsId?: string,
  isPaid: boolean = false
): string {
  const state = deps.getState();
  const targetWsId = wsId || state.activeWorkspaceId;

  const preview = resolveOrCreateCreditCardBill({
    bills: state.allCreditCardBills,
    cardId,
    referenceMonth,
    closingDate,
    dueDate,
    amount,
    workspaceId: targetWsId,
    isPaid,
  });

  deps.commit({
    ...state,
    allCreditCardBills: preview.updatedBills,
  });

  return preview.billId;
}

export function validateActiveCategory(
  deps: FinanceActionDeps,
  workspaceId: string,
  categoryId?: string | null
): void {
  if (!categoryId) return;
  const categories = deps.getState().allCategories;
  const parent = categories.find(
    (c) =>
      (c.id === categoryId || c.subcategories?.some((s) => s.id === categoryId)) &&
      c.workspace_id === workspaceId
  );
  if (!parent) {
    throw new Error('Categoria informada não pertence ao workspace.');
  }
  if (parent.active === false) {
    throw new Error('A categoria informada está inativa.');
  }
  if (parent.id !== categoryId) {
    const sub = parent.subcategories?.find((s) => s.id === categoryId);
    if (sub && sub.active === false) {
      throw new Error('A subcategoria informada está inativa.');
    }
  }
}

export function resolveAndValidateCreditCard(
  deps: FinanceActionDeps,
  workspaceId: string,
  pmId?: string | null,
  explicitCardId?: string | null
): string | null {
  const state = deps.getState();
  return validateCreditCardResolution(
    workspaceId,
    state.allPaymentMethods,
    state.allCreditCards,
    state.allAccounts,
    pmId,
    explicitCardId
  );
}

export function validateTransactionSplits(
  deps: FinanceActionDeps,
  totalAmount: number,
  targetWsId: string,
  paidByMemberId?: string | null,
  splits?: TransactionSplit[],
  splitType?: SplitType | null,
  paidByPersonId?: string | null,
  historical?: { paid_by_person_id?: string | null; splits?: TransactionSplit[] }
): void {
  const state = deps.getState();
  const wsMembers = state.allWorkspaceMembers.filter((m) => m.workspace_id === targetWsId);
  const memberIds = new Set(wsMembers.map((m) => m.id));
  const wsPeople = (state.allPeople || []).filter((p) => p.workspace_id === targetWsId);
  const personIds = new Set(wsPeople.map((p) => p.id));

  if (paidByMemberId && paidByPersonId) {
    throw new Error('Transação não pode ter pagador membro e pagador pessoa simultaneamente.');
  }

  if (paidByMemberId && !memberIds.has(paidByMemberId)) {
    throw new Error('O membro pagador informado não pertence ao workspace ativo.');
  }

  if (paidByPersonId && !personIds.has(paidByPersonId)) {
    throw new Error('A pessoa pagadora informada não pertence ao workspace ativo.');
  }
  if (paidByPersonId && wsPeople.find((p) => p.id === paidByPersonId)?.archived &&
      paidByPersonId !== historical?.paid_by_person_id) {
    throw new Error('Pessoa arquivada não pode receber nova associação como pagadora.');
  }

  const effectiveSplitType: SplitType = splitType || 'individual';

  // Regra individual ou ausente: não pode ter splits
  if (effectiveSplitType === 'individual') {
    if (splits && splits.length > 0) {
      throw new Error('Transações individuais não devem possuir divisão de despesas.');
    }
    return;
  }

  // Regras de rateio ('equal', 'full_other', 'custom'): OBRIGATÓRIO ter splits
  if (!splits || splits.length === 0) {
    throw new Error('A regra de divisão selecionada exige o preenchimento das frações de rateio.');
  }

  const seen = new Set<string>();
  let sumCents = 0;
  const totalCents = toCents(totalAmount);

  for (const split of splits) {
    const hasMember = Boolean(split.member_id);
    const hasPerson = Boolean(split.person_id);

    if (hasMember && hasPerson) {
      throw new Error('Divisão de despesa não pode ter membro e pessoa simultaneamente.');
    }
    if (!hasMember && !hasPerson) {
      throw new Error('Membro informado no rateio não pertence ao workspace ativo.');
    }

    const participantKey = hasPerson ? `person:${split.person_id}` : `member:${split.member_id}`;
    if (hasMember && !memberIds.has(split.member_id!)) {
      throw new Error('Membro informado no rateio não pertence ao workspace ativo.');
    }
    if (hasPerson && !personIds.has(split.person_id!)) {
      throw new Error('Pessoa informada no rateio não pertence ao workspace ativo.');
    }
    if (hasPerson && wsPeople.find((p) => p.id === split.person_id)?.archived &&
        !historical?.splits?.some((previous) => previous.person_id === split.person_id)) {
      throw new Error('Pessoa arquivada não pode receber nova associação no rateio.');
    }

    if (seen.has(participantKey)) {
      throw new Error('Membros duplicados identificados no rateio.');
    }
    seen.add(participantKey);

    if (typeof split.amount !== 'number' || !Number.isFinite(split.amount) || split.amount < 0) {
      throw new Error('O valor de rateio atribuído a cada membro não pode ser negativo ou inválido.');
    }

    // Na regra 100% de outra pessoa: o pagador não pode possuir fração atribuída a si mesmo
    if (effectiveSplitType === 'full_other') {
      if (paidByMemberId && split.member_id === paidByMemberId && split.amount > 0) {
        throw new Error('Na regra 100% de outra pessoa, o pagador não pode possuir fração atribuída a si mesmo.');
      }
      if (paidByPersonId && split.person_id === paidByPersonId && split.amount > 0) {
        throw new Error('Na regra 100% de outra pessoa, o pagador não pode possuir fração atribuída a si mesmo.');
      }
    }

    sumCents += toCents(split.amount);
  }

  if (sumCents !== totalCents) {
    throw new Error(
      `A soma das frações do rateio (R$ ${(sumCents / 100).toFixed(2)}) diverge do valor total da despesa (R$ ${(totalCents / 100).toFixed(2)}).`
    );
  }

  // Validação canônica estrita para 'equal' e 'full_other' (apenas se todos forem membros e nenhum person_id estiver envolvido)
  const hasAnyPerson = splits.some((s) => s.person_id) || Boolean(paidByPersonId);
  if (!hasAnyPerson) {
    if (effectiveSplitType === 'equal') {
      const effectivePayer = paidByMemberId || wsMembers[0]?.id;
      const selectedMembers = wsMembers.filter((m) => splits.some((split) => split.member_id === m.id));
      const canonical = calculateExpenseSplits(totalAmount, 'equal', selectedMembers, effectivePayer);

      if (splits.length !== canonical.length) {
        throw new Error(
          `A distribuição de frações informada diverge do cálculo canônico para a regra 'equal'.`
        );
      }

      for (const c of canonical) {
        const received = splits.find((s) => s.member_id === c.member_id)!;
        if (toCents(received.amount) !== toCents(c.amount)) {
          throw new Error(
            `A distribuição de frações informada diverge do cálculo canônico para a regra 'equal'.`
          );
        }
      }
    } else if (effectiveSplitType === 'full_other') {
      const effectivePayer = paidByMemberId || wsMembers[0]?.id;
      const selectedMembers = wsMembers.filter((m) => m.id === effectivePayer || splits.some((split) => split.member_id === m.id));
      const canonical = calculateExpenseSplits(totalAmount, 'full_other', selectedMembers, effectivePayer);

      if (splits.length !== canonical.length) {
        throw new Error(
          `A distribuição de frações informada diverge do cálculo canônico para a regra 'full_other'.`
        );
      }

      for (const c of canonical) {
        const received = splits.find((s) => s.member_id === c.member_id)!;
        if (toCents(received.amount) !== toCents(c.amount)) {
          throw new Error(
            `A distribuição de frações informada diverge do cálculo canônico para a regra 'full_other'.`
          );
        }
      }
    }
  }
}
