import { Account, CreditCard, CreditCardBill, PaymentMethod } from '../types';
import { format, parseISO, isValid, addMonths } from 'date-fns';
import { toCents, fromCents, roundCurrency, getActualDaysInMonth } from './money';

export interface ResolveOrCreateBillParams {
  bills: CreditCardBill[];
  cardId: string;
  referenceMonth: string;
  closingDate: string;
  dueDate: string;
  amount: number;
  workspaceId: string;
  isPaid?: boolean;
  nowIso?: string;
}

export interface ResolveOrCreateBillResult {
  updatedBills: CreditCardBill[];
  billId: string;
  isNew: boolean;
}

/**
 * Calcula em qual mês de fatura uma compra de cartão de crédito cai,
 * validando parâmetros de dia (1-31) e respeitando anos bissextos e viradas de ano.
 * Lança erro explícito para datas inválidas.
 */
export function calculateCardBillDates(
  purchaseDateStr: string,
  closingDay: number,
  dueDay: number
): { referenceMonth: string; closingDate: string; dueDate: string } {
  if (!purchaseDateStr || typeof purchaseDateStr !== 'string') {
    throw new Error('Data de compra inválida: string de data obrigatória.');
  }

  const pDate = parseISO(purchaseDateStr);
  if (!isValid(pDate)) {
    throw new Error(`Data de compra inválida fornecida: "${purchaseDateStr}".`);
  }

  const safeClosing = Math.max(1, Math.min(31, Math.floor(closingDay || 1)));
  const safeDue = Math.max(1, Math.min(31, Math.floor(dueDay || 10)));

  const pDay = pDate.getDate();
  let billYear = pDate.getFullYear();
  let billMonth = pDate.getMonth() + 1; // 1-12

  if (pDay > safeClosing) {
    billMonth += 1;
    if (billMonth > 12) {
      billMonth = 1;
      billYear += 1;
    }
  }

  const monthStr = String(billMonth).padStart(2, '0');
  const referenceMonth = `${billYear}-${monthStr}`;

  const maxClosingDays = getActualDaysInMonth(billYear, billMonth);
  const realClosingDay = Math.min(safeClosing, maxClosingDays);
  const closingDate = `${billYear}-${monthStr}-${String(realClosingDay).padStart(2, '0')}`;

  let dueYear = billYear;
  let dueMonth = billMonth;
  if (safeDue < safeClosing) {
    dueMonth += 1;
    if (dueMonth > 12) {
      dueMonth = 1;
      dueYear += 1;
    }
  }
  const maxDueDays = getActualDaysInMonth(dueYear, dueMonth);
  const realDueDay = Math.min(safeDue, maxDueDays);
  const dueDate = `${dueYear}-${String(dueMonth).padStart(2, '0')}-${String(realDueDay).padStart(2, '0')}`;

  return { referenceMonth, closingDate, dueDate };
}

/**
 * Validação centralizada e estrita de resolução de cartão de crédito no domínio.
 */
export function validateCreditCardResolution(
  workspaceId: string,
  paymentMethods: PaymentMethod[],
  creditCards: CreditCard[],
  accounts: Account[],
  pmId?: string | null,
  explicitCardId?: string | null
): string | null {
  let effectiveCardId = explicitCardId || null;

  if (pmId) {
    const pm = paymentMethods.find((p) => p.id === pmId && p.workspace_id === workspaceId);
    if (!pm) throw new Error('Método de pagamento informado não pertence ao workspace.');
    if (pm.active === false) throw new Error('O método de pagamento informado está inativo.');
    if (pm.linked_account_id) {
      const linkedAcc = accounts.find((a) => a.id === pm.linked_account_id && a.workspace_id === workspaceId);
      if (!linkedAcc) {
        throw new Error('A conta bancária vinculada a este método de pagamento não pertence ao workspace.');
      }
      if (linkedAcc.active === false) {
        throw new Error('A conta bancária vinculada a este método de pagamento está inativa.');
      }
    }
    if (pm.credit_card_id) {
      if (explicitCardId && explicitCardId !== pm.credit_card_id) {
        throw new Error('O cartão de crédito informado diverge do cartão fixo vinculado a este método de pagamento.');
      }
      effectiveCardId = pm.credit_card_id;
    } else if (pm.type === 'credit_card') {
      if (!explicitCardId) {
        throw new Error('Para métodos de pagamento do tipo cartão de crédito, a seleção de um cartão é obrigatória.');
      }
      effectiveCardId = explicitCardId;
    }
  }

  if (effectiveCardId) {
    const c = creditCards.find((card) => card.id === effectiveCardId && card.workspace_id === workspaceId);
    if (!c) throw new Error('Cartão de crédito informado não pertence ao workspace.');
    if (c.active === false) throw new Error('O cartão de crédito informado está inativo.');
  }

  return effectiveCardId;
}

/**
 * Validação pura de integridade contábil e estrutural de uma fatura de cartão.
 * Garante que total_amount e paid_amount sejam finitos e não-negativos,
 * e que paid_amount não exceda total_amount em centavos (proteção contra sobrepagamento corrompido).
 */
export function validateCreditCardBillIntegrity(bill: CreditCardBill): void {
  if (!bill || typeof bill !== 'object') {
    throw new Error('Fatura inválida para operação.');
  }
  if (!Number.isFinite(bill.total_amount) || bill.total_amount < 0) {
    throw new Error('Valor total da fatura inválido ou negativo.');
  }
  if (bill.paid_amount !== undefined && bill.paid_amount !== null) {
    if (!Number.isFinite(bill.paid_amount) || bill.paid_amount < 0) {
      throw new Error('Valor pago da fatura corrompido ou inválido.');
    }
    if (toCents(bill.paid_amount) > toCents(bill.total_amount)) {
      throw new Error(
        `Inconsistência contábil na fatura: valor pago (R$ ${bill.paid_amount.toFixed(2)}) excede o valor total (R$ ${bill.total_amount.toFixed(2)}).`
      );
    }
  }
}

export function resolveOrCreateCreditCardBill(
  params: ResolveOrCreateBillParams
): ResolveOrCreateBillResult {
  const {
    bills,
    cardId,
    referenceMonth,
    closingDate,
    dueDate,
    amount,
    workspaceId,
    isPaid = false,
    nowIso = new Date().toISOString(),
  } = params;

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('O valor a ser adicionado à fatura deve ser um número positivo e finito.');
  }

  const existingIdx = bills.findIndex(
    (b) =>
      b.credit_card_id === cardId &&
      b.reference_month === referenceMonth &&
      b.workspace_id === workspaceId
  );

  if (existingIdx >= 0) {
    const existing = bills[existingIdx];
    validateCreditCardBillIntegrity(existing);

    const safePaidAmount = existing.paid_amount || 0;
    const newTotalCents = toCents(existing.total_amount) + toCents(amount);
    const newPaidCents = isPaid ? toCents(safePaidAmount) + toCents(amount) : toCents(safePaidAmount);
    const fullyPaid = newPaidCents >= newTotalCents && newTotalCents > 0;
    const newTotal = fromCents(newTotalCents);
    const newPaid = fromCents(newPaidCents);

    const updatedBills = bills.map((b, idx) =>
      idx === existingIdx
        ? {
            ...b,
            total_amount: newTotal,
            paid_amount: newPaid,
            status: fullyPaid
              ? ('paid' as const)
              : newPaidCents > 0
              ? ('partially_paid' as const)
              : b.status === 'paid' || b.status === 'partially_paid'
              ? ('open' as const)
              : b.status,
            paid_at: fullyPaid ? dueDate : null,
          }
        : b
    );
    return {
      updatedBills,
      billId: existing.id,
      isNew: false,
    };
  }

  const targetBillId = `bill-${cardId}-${referenceMonth}`;
  const roundedAmount = roundCurrency(amount);
  const newBill: CreditCardBill = {
    id: targetBillId,
    credit_card_id: cardId,
    workspace_id: workspaceId,
    reference_month: referenceMonth,
    closing_date: closingDate,
    due_date: dueDate,
    total_amount: roundedAmount,
    paid_amount: isPaid ? roundedAmount : 0,
    status: isPaid ? 'paid' : 'open',
    paid_at: isPaid ? dueDate : null,
    created_at: nowIso,
  };

  return {
    updatedBills: [...bills, newBill],
    billId: targetBillId,
    isNew: true,
  };
}

/**
 * Reconciliação pura de fatura de cartão após exclusão de item faturado.
 * Subtrai o valor do item e garante que o novo total nunca seja inferior
 * ao valor já pago da fatura (proteção anti-overpayment com precisão de centavos).
 */
export function reconcileBillAfterItemDeletion(
  bill: CreditCardBill,
  itemAmount: number
): CreditCardBill {
  validateCreditCardBillIntegrity(bill);

  if (!Number.isFinite(itemAmount) || itemAmount <= 0) {
    throw new Error('O valor do item a ser estornado deve ser um número positivo e finito.');
  }

  const safePaidCents = toCents(bill.paid_amount || 0);
  const newTotalCents = Math.max(0, toCents(bill.total_amount) - toCents(itemAmount));

  if (safePaidCents > newTotalCents) {
    throw new Error(
      `Não é possível excluir o item da fatura: o valor pago (R$ ${(safePaidCents / 100).toFixed(2)}) excederia o novo total (R$ ${(newTotalCents / 100).toFixed(2)}). Estorne o pagamento da fatura antes de excluir o item.`
    );
  }
  const newPaidCents = Math.min(safePaidCents, newTotalCents);
  const isNowPaid = newPaidCents >= newTotalCents && newTotalCents > 0;
  const newTotal = fromCents(newTotalCents);
  const newPaid = fromCents(newPaidCents);

  return {
    ...bill,
    total_amount: newTotal,
    paid_amount: newPaid,
    status: newTotal === 0 ? 'open' : isNowPaid ? 'paid' : newPaid > 0 ? 'partially_paid' : 'open',
    paid_at: isNowPaid ? bill.paid_at : null,
  };
}
