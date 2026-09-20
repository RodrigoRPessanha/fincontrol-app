import { Payment } from '../../types';
import {
  toCents,
  fromCents,
  validatePaymentAccount,
} from '../../financial-engine';
import { payCreditCardBill } from './credit-card-actions';
import { FinanceActionDeps } from './types';

export function recordPayment(
  deps: FinanceActionDeps,
  data: {
    transaction_id?: string;
    installment_id?: string;
    credit_card_bill_id?: string;
    account_id?: string | null;
    payment_method_id?: string;
    amount: number;
    payment_date: string;
    notes?: string;
  }
): Payment {
  const paymentCents = toCents(data.amount);
  if (!Number.isFinite(data.amount) || data.amount <= 0 || paymentCents <= 0 || !Number.isSafeInteger(paymentCents)) {
    throw new Error('O valor do pagamento deve ser estritamente maior que zero.');
  }

  const targetsCount =
    (data.transaction_id ? 1 : 0) +
    (data.installment_id ? 1 : 0) +
    (data.credit_card_bill_id ? 1 : 0);

  if (targetsCount !== 1) {
    throw new Error('Informe exatamente uma obrigação de destino para o pagamento.');
  }

  const state = deps.getState();
  const targetWsId = state.activeWorkspaceId;
  const activeWs = state.allWorkspaces.find((w) => w.id === targetWsId);
  const isExpenseTracker = activeWs?.tracking_mode === 'expense_tracker';
  const currentAccounts = state.allAccounts;
  const acc = validatePaymentAccount(data.account_id, currentAccounts, targetWsId, isExpenseTracker);

  if (data.payment_method_id) {
    const pm = state.allPaymentMethods.find((p) => p.id === data.payment_method_id && p.workspace_id === targetWsId);
    if (!pm) throw new Error('Método de pagamento não pertence ao workspace ativo.');
  }

  // 1. Transação avulsa
  if (data.transaction_id) {
    const currentTxs = state.allTransactions;
    const tx = currentTxs.find((t) => t.id === data.transaction_id && t.workspace_id === targetWsId);
    if (!tx) throw new Error('Transação não encontrada no workspace ativo.');

    if (tx.credit_card_bill_id || tx.credit_card_id) {
      throw new Error('Itens vinculados a cartão de crédito devem ser quitados exclusivamente através da fatura correspondente.');
    }

    const totalCents = toCents(tx.amount);
    const paidCents = toCents(tx.paid_amount || 0);
    const remainingCents = Math.max(0, totalCents - paidCents);
    if (paymentCents > remainingCents) {
      throw new Error(
        `Valor do pagamento (R$ ${data.amount.toFixed(2)}) excede o saldo restante da transação (R$ ${(remainingCents / 100).toFixed(2)}).`
      );
    }

    const tCurrentPaidCents = paidCents + paymentCents;
    const tIsFull = tCurrentPaidCents >= totalCents;

    const finalAmount = fromCents(paymentCents);
    const shouldMutateAccount = !!(acc && data.account_id && !isExpenseTracker);
    const newPay: Payment = {
      id: deps.generateId('pay'),
      workspace_id: targetWsId,
      transaction_id: data.transaction_id,
      account_id: data.account_id || null,
      payment_method_id: data.payment_method_id,
      amount: finalAmount,
      payment_date: data.payment_date,
      notes: data.notes,
      created_by: 'usr-1',
      created_at: deps.now().toISOString(),
      affects_balance: shouldMutateAccount,
    };

    const nextTxs = currentTxs.map((t) => {
      if (t.id === data.transaction_id) {
        return {
          ...t,
          paid_amount: fromCents(tCurrentPaidCents),
          status: tIsFull ? ('paid' as const) : ('partially_paid' as const),
          paid_at: tIsFull ? data.payment_date : t.paid_at,
        };
      }
      return t;
    });

    const nextAccounts = shouldMutateAccount
      ? currentAccounts.map((a) => {
          if (a.id === data.account_id) {
            const currentBalanceCents = toCents(a.current_balance);
            const diffCents = tx.type === 'expense' ? -paymentCents : paymentCents;
            return { ...a, current_balance: fromCents(currentBalanceCents + diffCents) };
          }
          return a;
        })
      : currentAccounts;

    deps.commit({
      ...state,
      allTransactions: nextTxs,
      allAccounts: nextAccounts,
      allPayments: [newPay, ...state.allPayments],
    });

    return newPay;
  }

  // 2. Parcela
  if (data.installment_id) {
    const currentInsts = state.allInstallments;
    const inst = currentInsts.find((i) => i.id === data.installment_id);
    if (!inst) throw new Error('Parcela não encontrada.');

    const pur = state.allPurchases.find((p) => p.id === inst.purchase_id && p.workspace_id === targetWsId);
    if (!pur) throw new Error('Compra associada à parcela não pertence ao workspace ativo.');

    if (inst.credit_card_bill_id || pur.credit_card_id) {
      throw new Error('Parcelas vinculadas a cartão de crédito devem ser quitadas exclusivamente através da fatura correspondente.');
    }

    const totalCents = toCents(inst.amount);
    const paidCents = toCents(inst.paid_amount || 0);
    const remainingCents = Math.max(0, totalCents - paidCents);
    if (paymentCents > remainingCents) {
      throw new Error(
        `Valor do pagamento (R$ ${data.amount.toFixed(2)}) excede o saldo restante da parcela (R$ ${(remainingCents / 100).toFixed(2)}).`
      );
    }

    const iCurrentPaidCents = paidCents + paymentCents;
    const iIsFull = iCurrentPaidCents >= totalCents;

    const finalAmount = fromCents(paymentCents);
    const shouldMutateAccount = !!(acc && data.account_id && !isExpenseTracker);
    const newPay: Payment = {
      id: deps.generateId('pay'),
      workspace_id: targetWsId,
      installment_id: data.installment_id,
      account_id: data.account_id || null,
      payment_method_id: data.payment_method_id,
      amount: finalAmount,
      payment_date: data.payment_date,
      notes: data.notes,
      created_by: 'usr-1',
      created_at: deps.now().toISOString(),
      affects_balance: shouldMutateAccount,
    };

    const nextInsts = currentInsts.map((i) => {
      if (i.id === data.installment_id) {
        return {
          ...i,
          paid_amount: fromCents(iCurrentPaidCents),
          status: iIsFull ? ('paid' as const) : ('partially_paid' as const),
          paid_at: iIsFull ? data.payment_date : i.paid_at,
        };
      }
      return i;
    });

    const nextAccounts = shouldMutateAccount
      ? currentAccounts.map((a) =>
          a.id === data.account_id
            ? { ...a, current_balance: fromCents(toCents(a.current_balance) - paymentCents) }
            : a
        )
      : currentAccounts;

    deps.commit({
      ...state,
      allInstallments: nextInsts,
      allAccounts: nextAccounts,
      allPayments: [newPay, ...state.allPayments],
    });

    return newPay;
  }

  // 3. Fatura de cartão
  if (data.credit_card_bill_id) {
    return payCreditCardBill(deps, data.credit_card_bill_id, data.account_id, data.amount, data.payment_date, data.notes);
  }

  throw new Error('Tipo de pagamento não suportado.');
}
