import {
  Purchase,
  Installment,
  Payment,
  SplitType,
  TransactionSplit,
} from '../../types';
import {
  resolveTransactionAccountId,
  validateTransactionBusinessRules,
  splitInstallments,
} from '../../financial-engine';
import {
  getOrCreateAndAddItemToBill,
  validateActiveCategory,
  resolveAndValidateCreditCard,
  validateTransactionSplits,
} from './action-helpers';
import { FinanceActionDeps } from './types';

export function createInstallmentPurchase(
  deps: FinanceActionDeps,
  data: {
    description: string;
    total_amount: number;
    installment_count: number;
    purchase_date: string;
    credit_card_id?: string;
    category_id?: string;
    account_id?: string;
    payment_method_id?: string;
    paid_installments_count?: number;
    paid_by_member_id?: string;
    split_type?: SplitType;
    splits?: TransactionSplit[];
  }
): Purchase {
  if (typeof data.total_amount !== 'number' || !Number.isFinite(data.total_amount) || data.total_amount <= 0) {
    throw new Error('O valor total da compra parcelada deve ser maior que zero.');
  }

  const state = deps.getState();
  const targetWsId = state.activeWorkspaceId;
  const effectiveAccountId = resolveTransactionAccountId(
    data.payment_method_id,
    data.account_id,
    state.allPaymentMethods,
    targetWsId
  );

  if (effectiveAccountId) {
    const a = state.allAccounts.find((acc) => acc.id === effectiveAccountId && acc.workspace_id === targetWsId);
    if (!a) throw new Error('Conta bancária informada não pertence ao workspace ativo.');
    if (a.active === false) throw new Error('A conta bancária informada está inativa.');
  }

  const effectiveCardId = resolveAndValidateCreditCard(deps, targetWsId, data.payment_method_id, data.credit_card_id);
  validateTransactionBusinessRules(
    {
      type: 'expense',
      credit_card_id: effectiveCardId || data.credit_card_id,
      payment_method_id: data.payment_method_id,
      account_id: effectiveAccountId,
    },
    state.allPaymentMethods,
    targetWsId
  );
  validateActiveCategory(deps, targetWsId, data.category_id);
  validateTransactionSplits(deps, data.total_amount, targetWsId, data.paid_by_member_id, data.splits, data.split_type);

  const paidCount = Math.max(0, Math.min(data.installment_count, data.paid_installments_count || 0));
  const card = effectiveCardId ? state.allCreditCards.find((c) => c.id === effectiveCardId && c.workspace_id === targetWsId) : undefined;
  const split = splitInstallments(data.total_amount, data.installment_count, data.purchase_date, card, paidCount);

  if (split.length === 0) {
    throw new Error('Parâmetros de parcelamento inválidos.');
  }

  const effectiveSplitType: SplitType = data.split_type || 'individual';
  const effectiveSplits = effectiveSplitType !== 'individual' ? data.splits : undefined;

  const newPurchase: Purchase = {
    ...data,
    id: deps.generateId('pur'),
    workspace_id: targetWsId,
    paid_installments_count: paidCount,
    credit_card_id: effectiveCardId,
    account_id: effectiveAccountId,
    paid_by_member_id: data.paid_by_member_id,
    split_type: effectiveSplitType,
    splits: effectiveSplits,
    created_by: 'usr-1',
    created_at: deps.now().toISOString(),
  };

  const generatedInstallments: Installment[] = split.map((s) => {
    let billId: string | null = null;
    if (card && s.referenceMonth && s.closingDate) {
      billId = getOrCreateAndAddItemToBill(
        deps,
        card.id,
        s.referenceMonth,
        s.closingDate,
        s.dueDate,
        s.amount,
        targetWsId,
        s.isPaid
      );
    }

    return {
      id: deps.generateId('inst'),
      purchase_id: newPurchase.id,
      installment_number: s.installmentNumber,
      amount: s.amount,
      due_date: s.dueDate,
      credit_card_bill_id: billId,
      status: s.isPaid ? 'paid' : 'pending',
      paid_amount: s.isPaid ? s.amount : 0,
      paid_at: s.isPaid ? s.dueDate : null,
      created_at: deps.now().toISOString(),
    };
  });

  const generatedPayments: Payment[] = [];
  if (paidCount > 0) {
    generatedInstallments.forEach((inst, idx) => {
      if (split[idx]?.isPaid) {
        generatedPayments.push({
          id: deps.generateId('pay'),
          workspace_id: targetWsId,
          installment_id: inst.id,
          account_id: effectiveAccountId || null,
          payment_method_id: data.payment_method_id,
          amount: inst.amount,
          payment_date: inst.paid_at || inst.due_date,
          notes: 'Quitação prévia de parcela importada',
          created_by: 'usr-1',
          created_at: deps.now().toISOString(),
          affects_balance: false,
        });
      }
    });
  }

  // Obter o estado atualizado após possíveis getOrCreateAndAddItemToBill
  const currentState = deps.getState();
  deps.commit({
    ...currentState,
    allPurchases: [newPurchase, ...currentState.allPurchases],
    allInstallments: [...currentState.allInstallments, ...generatedInstallments],
    allPayments: generatedPayments.length > 0
      ? [...generatedPayments, ...currentState.allPayments]
      : currentState.allPayments,
  });

  return newPurchase;
}
