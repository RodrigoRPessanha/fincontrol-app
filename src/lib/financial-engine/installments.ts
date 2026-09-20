import { CreditCard, Installment, Purchase } from '../types';
import { format, parseISO, isValid, addMonths } from 'date-fns';
import { toCents, fromCents, getActualDaysInMonth } from './money';
import { calculateCardBillDates } from './credit-cards';

/**
 * Divide o valor total de uma compra em N parcelas sem perder centavos.
 * A diferença de centavos é absorvida na 1ª parcela.
 * Em compras no cartão: calcula a fatura da 1ª parcela e avança ciclo a ciclo consecutivamente
 * (resolvendo compras em fins de mês como 31/01 com fechamento dia 30).
 * Suporta `paidInstallmentsCount` para marcar parcelas pré-quitadas.
 */
export function splitInstallments(
  totalAmount: number,
  installmentCount: number,
  purchaseDateStr: string,
  creditCard?: CreditCard,
  paidInstallmentsCount: number = 0
): {
  installmentNumber: number;
  amount: number;
  dueDate: string;
  closingDate?: string;
  referenceMonth?: string;
  isPaid: boolean;
}[] {
  if (
    typeof installmentCount !== 'number' ||
    !Number.isInteger(installmentCount) ||
    installmentCount <= 0 ||
    installmentCount > 120
  ) {
    return [];
  }

  if (
    typeof totalAmount !== 'number' ||
    !Number.isFinite(totalAmount) ||
    totalAmount <= 0 ||
    totalAmount > 100_000_000
  ) {
    return [];
  }

  if (totalAmount < installmentCount * 0.01) {
    return [];
  }

  if (!purchaseDateStr || typeof purchaseDateStr !== 'string') {
    throw new Error('Data de compra inválida para parcelamento.');
  }

  const pDate = parseISO(purchaseDateStr);
  if (!isValid(pDate)) {
    throw new Error(`Data de compra inválida fornecida: "${purchaseDateStr}".`);
  }

  const totalCents = toCents(totalAmount);
  const baseCents = Math.floor(totalCents / installmentCount);
  const remainderCents = totalCents - baseCents * installmentCount;
  const firstCents = baseCents + remainderCents;
  const baseAmount = fromCents(baseCents);
  const firstAmount = fromCents(firstCents);

  const results = [];

  if (creditCard) {
    // 1. Calcula o ciclo inicial da 1ª parcela
    const firstBill = calculateCardBillDates(
      purchaseDateStr,
      creditCard.closing_day,
      creditCard.due_day
    );
    const [firstYearStr, firstMonthStr] = firstBill.referenceMonth.split('-');
    let startYear = parseInt(firstYearStr, 10);
    let startMonth = parseInt(firstMonthStr, 10); // 1-12

    const safeClosing = Math.max(1, Math.min(31, Math.floor(creditCard.closing_day || 1)));
    const safeDue = Math.max(1, Math.min(31, Math.floor(creditCard.due_day || 10)));

    for (let i = 1; i <= installmentCount; i++) {
      const amount = i === 1 ? firstAmount : baseAmount;

      // Avança ciclo a ciclo a partir do mês da 1ª fatura
      let cycleMonth = startMonth + (i - 1);
      let cycleYear = startYear;
      while (cycleMonth > 12) {
        cycleMonth -= 12;
        cycleYear += 1;
      }

      const cycleMonthStr = String(cycleMonth).padStart(2, '0');
      const referenceMonth = `${cycleYear}-${cycleMonthStr}`;

      const maxClosingDays = getActualDaysInMonth(cycleYear, cycleMonth);
      const realClosingDay = Math.min(safeClosing, maxClosingDays);
      const closingDate = `${cycleYear}-${cycleMonthStr}-${String(realClosingDay).padStart(2, '0')}`;

      let dueYear = cycleYear;
      let dueMonth = cycleMonth;
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

      results.push({
        installmentNumber: i,
        amount,
        dueDate,
        closingDate,
        referenceMonth,
        isPaid: i <= paidInstallmentsCount,
      });
    }
  } else {
    // Não-cartão: avanço mensal tradicional
    for (let i = 1; i <= installmentCount; i++) {
      const instBaseDate = addMonths(pDate, i - 1);
      const instBaseDateStr = format(instBaseDate, 'yyyy-MM-dd');
      const amount = i === 1 ? firstAmount : baseAmount;

      results.push({
        installmentNumber: i,
        amount,
        dueDate: instBaseDateStr,
        isPaid: i <= paidInstallmentsCount,
      });
    }
  }

  return results;
}
