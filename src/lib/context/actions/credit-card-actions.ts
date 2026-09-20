import { format } from 'date-fns';
import { CreditCard, Payment } from '../../types';
import {
  toCents,
  fromCents,
  validateCreditCardBillIntegrity,
  validateBillPaymentAccount,
} from '../../financial-engine';
import { FinanceActionDeps } from './types';

export function addCreditCard(
  deps: FinanceActionDeps,
  cardData: Omit<CreditCard, 'id' | 'workspace_id' | 'created_at'>
): CreditCard {
  const state = deps.getState();
  const targetWsId = state.activeWorkspaceId;
  if (cardData.linked_payment_account_id) {
    const acc = state.allAccounts.find(
      (a) => a.id === cardData.linked_payment_account_id && a.workspace_id === targetWsId
    );
    if (!acc) throw new Error('Conta vinculada ao cartão não pertence ao workspace ativo.');
    if (acc.active === false) throw new Error('A conta bancária vinculada ao cartão está inativa.');
  }
  const newCard: CreditCard = {
    ...cardData,
    id: deps.generateId('card'),
    workspace_id: targetWsId,
    created_at: deps.now().toISOString(),
  };

  deps.commit({
    ...state,
    allCreditCards: [...state.allCreditCards, newCard],
  });

  return newCard;
}

export function updateCreditCard(
  deps: FinanceActionDeps,
  id: string,
  data: Omit<Partial<CreditCard>, 'id' | 'workspace_id' | 'created_at'>
): void {
  const state = deps.getState();
  const targetWsId = state.activeWorkspaceId;
  if (data.linked_payment_account_id) {
    const acc = state.allAccounts.find(
      (a) => a.id === data.linked_payment_account_id && a.workspace_id === targetWsId
    );
    if (!acc) throw new Error('Conta vinculada ao cartão não pertence ao workspace ativo.');
    if (acc.active === false) throw new Error('A conta bancária vinculada ao cartão está inativa.');
  }

  deps.commit({
    ...state,
    allCreditCards: state.allCreditCards.map((c) =>
      c.id === id && c.workspace_id === targetWsId
        ? { ...c, ...data, id: c.id, workspace_id: c.workspace_id, created_at: c.created_at }
        : c
    ),
  });
}

export function payCreditCardBill(
  deps: FinanceActionDeps,
  billId: string,
  accountId?: string | null,
  amount?: number,
  paymentDate: string = format(deps.now(), 'yyyy-MM-dd'),
  notes?: string
): Payment {
  const state = deps.getState();
  const targetWsId = state.activeWorkspaceId;
  const currentBills = state.allCreditCardBills;
  const currentAccounts = state.allAccounts;

  const bill = currentBills.find((b) => b.id === billId && b.workspace_id === targetWsId);
  if (!bill) throw new Error('Fatura não encontrada no workspace ativo.');

  const activeWs = state.allWorkspaces.find((w) => w.id === targetWsId);
  const isExpenseTracker = activeWs?.tracking_mode === 'expense_tracker';

  validateCreditCardBillIntegrity(bill);
  validateBillPaymentAccount(accountId, currentAccounts, targetWsId, isExpenseTracker);

  const payAmount = typeof amount === 'number' ? amount : bill.total_amount - (bill.paid_amount || 0);
  const paymentCents = toCents(payAmount);
  if (!Number.isFinite(payAmount) || payAmount <= 0 || paymentCents <= 0 || !Number.isSafeInteger(paymentCents)) {
    throw new Error('Valor inválido para pagamento.');
  }

  const totalCents = toCents(bill.total_amount);
  const paidCents = toCents(bill.paid_amount || 0);
  const remainingCents = Math.max(0, totalCents - paidCents);

  if (paymentCents > remainingCents) {
    throw new Error(
      `Valor do pagamento (R$ ${payAmount.toFixed(2)}) excede o saldo restante da fatura (R$ ${(remainingCents / 100).toFixed(2)}).`
    );
  }

  const finalAmount = fromCents(paymentCents);
  const shouldMutateAccount = !!(accountId && !isExpenseTracker);
  const newPay: Payment = {
    id: deps.generateId('pay'),
    workspace_id: targetWsId,
    credit_card_bill_id: billId,
    account_id: accountId || null,
    amount: finalAmount,
    payment_date: paymentDate,
    notes: notes || `Pagamento de fatura ${bill.reference_month}`,
    created_by: 'usr-1',
    created_at: deps.now().toISOString(),
    affects_balance: shouldMutateAccount,
  };

  const bNewPaidCents = paidCents + paymentCents;
  const bIsPaid = bNewPaidCents >= totalCents;

  const nextBills = currentBills.map((b) => {
    if (b.id === billId) {
      return {
        ...b,
        paid_amount: fromCents(bNewPaidCents),
        status: bIsPaid ? ('paid' as const) : ('partially_paid' as const),
        paid_at: bIsPaid ? paymentDate : b.paid_at,
      };
    }
    return b;
  });

  const nextAccounts = accountId && !isExpenseTracker
    ? currentAccounts.map((a) =>
        a.id === accountId
          ? { ...a, current_balance: fromCents(toCents(a.current_balance) - paymentCents) }
          : a
      )
    : currentAccounts;

  let nextInstallments = state.allInstallments;
  let nextTransactions = state.allTransactions;

  if (bIsPaid) {
    nextInstallments = nextInstallments.map((inst) =>
      inst.credit_card_bill_id === billId
        ? { ...inst, status: 'paid', paid_amount: inst.amount, paid_at: paymentDate }
        : inst
    );
    nextTransactions = nextTransactions.map((t) =>
      t.credit_card_bill_id === billId
        ? { ...t, status: 'paid', paid_amount: t.amount, paid_at: paymentDate }
        : t
    );
  }

  deps.commit({
    ...state,
    allCreditCardBills: nextBills,
    allAccounts: nextAccounts,
    allPayments: [newPay, ...state.allPayments],
    allInstallments: nextInstallments,
    allTransactions: nextTransactions,
  });

  return newPay;
}
