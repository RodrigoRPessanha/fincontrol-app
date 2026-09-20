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
  splitType?: SplitType | null
): void {
  const state = deps.getState();
  const wsMembers = state.allWorkspaceMembers.filter((m) => m.workspace_id === targetWsId);
  const memberIds = new Set(wsMembers.map((m) => m.id));

  if (paidByMemberId && !memberIds.has(paidByMemberId)) {
    throw new Error('O membro pagador informado não pertence ao workspace ativo.');
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
    if (!split.member_id || !memberIds.has(split.member_id)) {
      throw new Error('Membro informado no rateio não pertence ao workspace ativo.');
    }
    if (seen.has(split.member_id)) {
      throw new Error('Membros duplicados identificados no rateio.');
    }
    seen.add(split.member_id);

    if (typeof split.amount !== 'number' || !Number.isFinite(split.amount) || split.amount < 0) {
      throw new Error('O valor de rateio atribuído a cada membro não pode ser negativo ou inválido.');
    }

    // Na regra 100% de outra pessoa: o pagador não pode possuir fração atribuída a si mesmo
    if (effectiveSplitType === 'full_other' && paidByMemberId && split.member_id === paidByMemberId && split.amount > 0) {
      throw new Error('Na regra 100% de outra pessoa, o pagador não pode possuir fração atribuída a si mesmo.');
    }

    sumCents += toCents(split.amount);
  }

  if (sumCents !== totalCents) {
    throw new Error(
      `A soma das frações do rateio (R$ ${(sumCents / 100).toFixed(2)}) diverge do valor total da despesa (R$ ${(totalCents / 100).toFixed(2)}).`
    );
  }

  // Validação canônica estrita para 'equal' e 'full_other' (P1-01 V36 Semântica)
  if (effectiveSplitType === 'equal') {
    const effectivePayer = paidByMemberId || wsMembers[0]?.id;
    const canonical = calculateExpenseSplits(totalAmount, 'equal', wsMembers, effectivePayer);

    if (splits.length !== canonical.length) {
      throw new Error(
        `A distribuição de frações informada diverge do cálculo canônico para a regra 'equal'.`
      );
    }

    for (const c of canonical) {
      const received = splits.find((s) => s.member_id === c.member_id);
      const receivedCents = received ? toCents(received.amount) : 0;
      if (receivedCents !== toCents(c.amount)) {
        throw new Error(
          `A distribuição de frações informada diverge do cálculo canônico para a regra 'equal'.`
        );
      }
    }
  } else if (effectiveSplitType === 'full_other') {
    const effectivePayer = paidByMemberId || wsMembers[0]?.id;
    if (effectivePayer && wsMembers.length > 0) {
      const canonical = calculateExpenseSplits(totalAmount, 'full_other', wsMembers, effectivePayer);

      if (splits.length !== canonical.length) {
        throw new Error(
          `A distribuição de frações informada diverge do cálculo canônico para a regra 'full_other'.`
        );
      }

      for (const c of canonical) {
        const received = splits.find((s) => s.member_id === c.member_id);
        const receivedCents = received ? toCents(received.amount) : 0;
        if (receivedCents !== toCents(c.amount)) {
          throw new Error(
            `A distribuição de frações informada diverge do cálculo canônico para a regra 'full_other'.`
          );
        }
      }
    }
  }
}
