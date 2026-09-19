import {
  Account,
  Category,
  CreditCard,
  CreditCardBill,
  Installment,
  MonthlyCommitment,
  Payment,
  PaymentMethod,
  Purchase,
  RecurringTransaction,
  Settlement,
  SplitType,
  Transaction,
  TransactionSplit,
  WorkspaceMember,
} from './types';
import {
  format,
  parseISO,
  isValid,
  addMonths,
  addDays,
  startOfMonth,
  endOfMonth,
  isBefore,
  isSameDay,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';

/**
 * Valida de forma estrita o intervalo em dias para recorrências customizadas.
 * Exige número finito, inteiro positivo e limite máximo de 3.650 dias (10 anos).
 */
export function isValidCustomInterval(days: unknown): boolean {
  return typeof days === 'number' && Number.isFinite(days) && Number.isInteger(days) && days > 0 && days <= 3650;
}

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
 * Distribui percentuais inteiros garantindo matematicamente que a soma resulte em exatamente 100%
 * através do Largest Remainder Method (Método do Maior Resto / Hamilton-Hare).
 */
export function calculateIntegerPercentages(
  items: { id: string; amount: number }[],
  totalAmount: number
): Map<string, number> {
  const resultMap = new Map<string, number>();
  if (!items || items.length === 0) {
    return resultMap;
  }

  // Sanitiza montantes: filtra valores não finitos ou negativos tratando como 0
  const validItems = items.map((i) => ({
    id: i.id,
    amount: Number.isFinite(i.amount) && i.amount > 0 ? i.amount : 0,
  }));

  const sumAmounts = validItems.reduce((acc, i) => acc + i.amount, 0);

  // Se a soma de todos os itens for 0 ou o total for inválido, retorna 0 para todos
  if (sumAmounts <= 0 || !Number.isFinite(totalAmount) || totalAmount <= 0) {
    validItems.forEach((i) => resultMap.set(i.id, 0));
    return resultMap;
  }

  // Base de cálculo: se a soma das fatias divergir do totalAmount além de tolerância de 5 centavos,
  // normaliza pela soma real das fatias para garantir partição estrita de 100%
  const effectiveTotal = Math.abs(sumAmounts - totalAmount) > 0.05 ? sumAmounts : totalAmount;

  // 1. Calcula piso inteiro e resto fracionário de cada item
  const withRemainders = validItems.map((item) => {
    const exact = (item.amount / effectiveTotal) * 100;
    const floorVal = Math.floor(exact);
    const remainder = exact - floorVal;
    return { id: item.id, floorVal, remainder };
  });

  const floorSum = withRemainders.reduce((acc, i) => acc + i.floorVal, 0);
  let diff = 100 - floorSum;

  // 2. Ordena pelos maiores restos decrescentes e distribui a diferença
  const sorted = [...withRemainders].sort((a, b) => b.remainder - a.remainder);
  for (const item of sorted) {
    let finalVal = item.floorVal;
    if (diff > 0) {
      finalVal += 1;
      diff -= 1;
    }
    resultMap.set(item.id, finalVal);
  }

  return resultMap;
}

/**
 * Retorna o número real de dias em um determinado mês e ano (respeitando 28, 29, 30 e 31 dias).
 */
export function getActualDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
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

/**
 * Calcula a data exata da ocorrência N a partir da data âncora inicial,
 * preservando o dia original (ex: dia 31) com clamp seguro nos meses menores (sem drift permanente).
 */
export function getAnchoredOccurrenceDate(startDateStr: string, monthsToAdd: number): string {
  if (!startDateStr || typeof startDateStr !== 'string') {
    throw new Error('Data inicial de recorrência inválida.');
  }

  const startDate = parseISO(startDateStr);
  if (!isValid(startDate)) {
    throw new Error(`Data de início de recorrência inválida: "${startDateStr}".`);
  }

  const safeMonths = Math.max(0, Math.floor(monthsToAdd || 0));
  const startYear = startDate.getFullYear();
  const startMonth = startDate.getMonth() + 1; // 1-12
  const anchorDay = startDate.getDate();

  let targetYear = startYear + Math.floor((startMonth - 1 + safeMonths) / 12);
  let targetMonth = ((startMonth - 1 + safeMonths) % 12) + 1;

  const maxDays = getActualDaysInMonth(targetYear, targetMonth);
  const realDay = Math.min(anchorDay, maxDays);

  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(realDay).padStart(2, '0')}`;
}

/**
 * Calcula a quantidade real de ocorrências de uma recorrência em um mês específico
 * utilizando datas civis reais e comparação rigorosa de end_date no nível de dia.
 */
export function isRecurrenceActiveInMonth(
  rec: RecurringTransaction,
  targetYear: number,
  targetMonth: number // 1-12
): { active: boolean; multiplier: number } {
  if (!rec.active) return { active: false, multiplier: 0 };

  const targetMonthKey = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
  const startMonthKey = rec.start_date.slice(0, 7);

  if (targetMonthKey < startMonthKey) return { active: false, multiplier: 0 };

  const startDate = parseISO(rec.start_date);
  const startYear = startDate.getFullYear();
  const startMonth = startDate.getMonth() + 1;
  const monthsDiff = (targetYear - startYear) * 12 + (targetMonth - startMonth);

  const monthStart = startOfMonth(new Date(targetYear, targetMonth - 1, 1));
  const monthEnd = endOfMonth(new Date(targetYear, targetMonth - 1, 1));

  switch (rec.frequency) {
    case 'weekly': {
      let occurrences = 0;
      let curr = parseISO(rec.start_date);

      while (isBefore(curr, monthStart)) {
        curr = addDays(curr, 7);
      }

      while (
        (isBefore(curr, monthEnd) || isSameDay(curr, monthEnd)) &&
        (!rec.end_date || isBefore(curr, parseISO(rec.end_date)) || isSameDay(curr, parseISO(rec.end_date)))
      ) {
        occurrences++;
        curr = addDays(curr, 7);
      }

      return { active: occurrences > 0, multiplier: occurrences };
    }

    case 'monthly':
    case 'bimonthly':
    case 'quarterly':
    case 'semiannual':
    case 'annual': {
      const step =
        rec.frequency === 'monthly'
          ? 1
          : rec.frequency === 'bimonthly'
          ? 2
          : rec.frequency === 'quarterly'
          ? 3
          : rec.frequency === 'semiannual'
          ? 6
          : 12;

      if (monthsDiff < 0 || monthsDiff % step !== 0) {
        return { active: false, multiplier: 0 };
      }

      const occurrenceDateStr = getAnchoredOccurrenceDate(rec.start_date, monthsDiff);
      if (rec.end_date && occurrenceDateStr > rec.end_date) {
        return { active: false, multiplier: 0 };
      }

      return { active: true, multiplier: 1 };
    }

    case 'custom': {
      if (!isValidCustomInterval(rec.interval_days)) {
        return { active: false, multiplier: 0 };
      }
      const interval = rec.interval_days as number;
      let occurrences = 0;
      let curr = parseISO(rec.start_date);

      while (isBefore(curr, monthStart)) {
        curr = addDays(curr, interval);
      }

      while (
        (isBefore(curr, monthEnd) || isSameDay(curr, monthEnd)) &&
        (!rec.end_date || isBefore(curr, parseISO(rec.end_date)) || isSameDay(curr, parseISO(rec.end_date)))
      ) {
        occurrences++;
        curr = addDays(curr, interval);
      }

      return { active: occurrences > 0, multiplier: occurrences };
    }

    default:
      return { active: true, multiplier: 1 };
  }
}

/**
 * Projeta o comprometimento financeiro futuro mês a mês (3, 6, 12 meses)
 * respeitando frequências de recorrência e deduplicando por contagem real de ocorrências.
 */
export function calculateFutureCommitments(
  installments: (Installment & { purchase?: Purchase; bill?: CreditCardBill })[],
  recurring: RecurringTransaction[],
  transactions: Transaction[],
  monthsAhead: number = 12,
  startDate: Date = new Date(),
  creditCardBills: CreditCardBill[] = []
): MonthlyCommitment[] {
  const result: MonthlyCommitment[] = [];

  for (let i = 0; i < monthsAhead; i++) {
    const targetDate = addMonths(startDate, i);
    const targetYear = targetDate.getFullYear();
    const targetMonth = targetDate.getMonth() + 1;
    const monthKey = format(targetDate, 'yyyy-MM');
    const monthLabelRaw = format(targetDate, 'MMMM yyyy', { locale: ptBR });
    const monthLabel = monthLabelRaw.charAt(0).toUpperCase() + monthLabelRaw.slice(1);

    const items: MonthlyCommitment['items'] = [];
    let installmentsAmountCents = 0;
    let installmentsCount = 0;
    let recurringAmountCents = 0;
    let pendingTransactionsAmountCents = 0;
    let expectedIncomeCents = 0;

    // 1. Parcelas ativas fora de cartão
    for (const inst of installments) {
      if (inst.status === 'paid' || inst.status === 'cancelled' || inst.credit_card_bill_id) continue;

      const instMonth = inst.due_date ? inst.due_date.slice(0, 7) : '';
      if (instMonth === monthKey) {
        const remainingCents = Math.max(0, toCents(inst.amount) - toCents(inst.paid_amount || 0));
        installmentsAmountCents += remainingCents;
        installmentsCount += 1;
        items.push({
          title: `${inst.purchase?.description || 'Compra Parcelada'} (${inst.installment_number}/${inst.purchase?.installment_count || '?'})`,
          amount: fromCents(remainingCents),
          type: 'installment',
          dueDate: inst.due_date,
          categoryName: inst.purchase?.category?.name,
        });
      }
    }

    // 2. Faturas de cartão de crédito do mês (fonte única de verdade)
    for (const bill of creditCardBills) {
      if (bill.status === 'cancelled' || bill.status === 'paid') continue;
      if (bill.reference_month === monthKey) {
        const remainingCents = Math.max(0, toCents(bill.total_amount) - toCents(bill.paid_amount || 0));
        if (remainingCents > 0) {
          installmentsAmountCents += remainingCents;
          installmentsCount += 1;
          items.push({
            title: `Fatura Cartão (${bill.reference_month})`,
            amount: fromCents(remainingCents),
            type: 'installment',
            dueDate: bill.due_date,
          });
        }
      }
    }

    // 3. Recorrências ativas (com deduplicação precisa por contagem de ocorrências)
    for (const rec of recurring) {
      const { active, multiplier } = isRecurrenceActiveInMonth(rec, targetYear, targetMonth);
      if (!active || multiplier <= 0) continue;

      const materializedCount = transactions.filter(
        (t) =>
          t.recurring_transaction_id === rec.id &&
          t.transaction_date.slice(0, 7) === monthKey &&
          t.status !== 'cancelled'
      ).length;

      const remainingOccurrences = Math.max(0, multiplier - materializedCount);
      if (remainingOccurrences <= 0) continue;

      const recTotalCents = toCents(rec.amount) * remainingOccurrences;

      if (rec.type === 'expense') {
        recurringAmountCents += recTotalCents;
        items.push({
          title: remainingOccurrences > 1 ? `${rec.description} (${remainingOccurrences}x)` : rec.description,
          amount: fromCents(recTotalCents),
          type: 'recurring',
          dueDate: `${monthKey}-10`,
          categoryName: rec.category?.name,
        });
      } else {
        expectedIncomeCents += recTotalCents;
      }
    }

    // 4. Transações avulsas pendentes do mês (exclui canceladas, pagas e itens de cartão já contados na fatura)
    for (const tx of transactions) {
      if (tx.status === 'paid' || tx.status === 'cancelled' || tx.credit_card_bill_id || tx.credit_card_id) continue;

      const txMonth = tx.due_date ? tx.due_date.slice(0, 7) : tx.transaction_date.slice(0, 7);
      if (txMonth === monthKey) {
        const remainingCents = Math.max(0, toCents(tx.amount) - toCents(tx.paid_amount || 0));
        if (tx.type === 'expense') {
          pendingTransactionsAmountCents += remainingCents;
          items.push({
            title: tx.description,
            amount: fromCents(remainingCents),
            type: 'transaction',
            dueDate: tx.due_date,
            categoryName: tx.category?.name,
          });
        } else {
          expectedIncomeCents += remainingCents;
        }
      }
    }

    const totalCommitmentCents = installmentsAmountCents + recurringAmountCents + pendingTransactionsAmountCents;
    const netForecastCents = expectedIncomeCents - totalCommitmentCents;

    result.push({
      monthKey,
      monthLabel,
      installmentsAmount: fromCents(installmentsAmountCents),
      recurringAmount: fromCents(recurringAmountCents),
      pendingTransactionsAmount: fromCents(pendingTransactionsAmountCents),
      expectedIncome: fromCents(expectedIncomeCents),
      totalCommitment: fromCents(totalCommitmentCents),
      netForecast: fromCents(netForecastCents),
      installmentsCount,
      items,
    });
  }

  return result;
}

/**
 * Calcula os totais do Dashboard com a Fatura como Fonte Única de Verdade de Cartão:
 * - Realizado (Caixa): Baseado em registros de Payment com fallback exclusivo para transações NÃO-CARTÃO sem Payment
 * - Previsto (Competência): Faturas + Transações não-cartão + Recorrências não materializadas
 */
export function calculateDashboardSummary(
  transactions: Transaction[],
  installments: (Installment & { purchase?: Purchase })[],
  recurring: RecurringTransaction[],
  accounts: { current_balance: number }[],
  payments: Payment[] = [],
  referenceMonth: string = format(new Date(), 'yyyy-MM'),
  creditCardBills: CreditCardBill[] = [],
  currentDateStr?: string
) {
  const totalBalanceCents = accounts.reduce((acc, a) => acc + toCents(a.current_balance || 0), 0);

  let realizedIncomeCents = 0;
  let realizedExpenseCents = 0;

  // 1. Visão de Caixa Realizado (via pagamentos da competência)
  // Coletamos todos os IDs de transações com pagamento na história toda para evitar fallback duplo
  const allPaidTransactionIds = new Set<string>();
  for (const pay of payments) {
    if (pay.transaction_id) {
      allPaidTransactionIds.add(pay.transaction_id);
    }
  }

  for (const pay of payments) {
    if (pay.payment_date && pay.payment_date.slice(0, 7) === referenceMonth) {
      const payAmountCents = toCents(pay.amount);
      if (pay.transaction_id) {
        const tx = transactions.find((t) => t.id === pay.transaction_id);
        if (tx && tx.type === 'income') {
          realizedIncomeCents += payAmountCents;
        } else {
          realizedExpenseCents += payAmountCents;
        }
      } else {
        // Pagamento de fatura de cartão ou parcela direta
        realizedExpenseCents += payAmountCents;
      }
    }
  }

  // Fallback por obrigação: contabiliza APENAS transações avulsas NÃO-CARTÃO pagas que não possuem registro em payments
  for (const tx of transactions) {
    // ITENS DE CARTÃO SÃO EXCLUÍDOS DO FALLBACK POIS SÃO PAGOS VIA FATURA
    if (tx.status === 'cancelled' || tx.credit_card_bill_id || tx.credit_card_id) continue;
    if (allPaidTransactionIds.has(tx.id)) continue;

    const paidDate = tx.paid_at ? tx.paid_at.slice(0, 7) : tx.transaction_date.slice(0, 7);
    if (paidDate === referenceMonth) {
      if (tx.status === 'paid') {
        const txCents = toCents(tx.amount);
        if (tx.type === 'income') realizedIncomeCents += txCents;
        else realizedExpenseCents += txCents;
      } else if (tx.status === 'partially_paid') {
        const txPaidCents = toCents(tx.paid_amount || 0);
        if (tx.type === 'income') realizedIncomeCents += txPaidCents;
        else realizedExpenseCents += txPaidCents;
      }
    }
  }

  // 2. Visão Prevista e Pendências para o mês
  let plannedIncomeCents = 0;
  let plannedExpenseCents = 0;

  let overdueCount = 0;
  let overdueAmountCents = 0;
  let pendingCount = 0;
  let pendingAmountCents = 0;

  const todayStr = currentDateStr || format(new Date(), 'yyyy-MM-dd');

  // A. Faturas de Cartão (Fonte Única de Verdade de Cartão)
  for (const bill of creditCardBills) {
    if (bill.status === 'cancelled') continue;

    if (bill.reference_month === referenceMonth) {
      plannedExpenseCents += toCents(bill.total_amount);
    }

    if (bill.status === 'open' || bill.status === 'partially_paid' || bill.status === 'overdue') {
      const remainingCents = Math.max(0, toCents(bill.total_amount) - toCents(bill.paid_amount || 0));
      if (remainingCents > 0) {
        if (bill.due_date < todayStr) {
          overdueCount += 1;
          overdueAmountCents += remainingCents;
        } else {
          pendingCount += 1;
          pendingAmountCents += remainingCents;
        }
      }
    }
  }

  // B. Transações Avulsas (Exclui itens de cartão de crédito para evitar dupla contagem)
  for (const tx of transactions) {
    if (tx.status === 'cancelled' || tx.credit_card_bill_id || tx.credit_card_id) continue;

    const txDueMonth = tx.due_date ? tx.due_date.slice(0, 7) : tx.transaction_date.slice(0, 7);

    if (txDueMonth === referenceMonth) {
      const txCents = toCents(tx.amount);
      if (tx.type === 'income') {
        plannedIncomeCents += txCents;
      } else {
        plannedExpenseCents += txCents;
      }
    }

    if (tx.status === 'pending' || tx.status === 'partially_paid') {
      const remainingCents = Math.max(0, toCents(tx.amount) - toCents(tx.paid_amount || 0));
      if (tx.due_date && tx.due_date < todayStr) {
        overdueCount += 1;
        overdueAmountCents += remainingCents;
      } else {
        pendingCount += 1;
        pendingAmountCents += remainingCents;
      }
    }
  }

  // C. Parcelas (Exclui parcelas de cartão para evitar dupla contagem com a fatura)
  for (const inst of installments) {
    if (inst.status === 'cancelled' || inst.credit_card_bill_id) continue;

    const instMonth = inst.due_date ? inst.due_date.slice(0, 7) : '';
    if (instMonth === referenceMonth) {
      plannedExpenseCents += toCents(inst.amount);
    }

    if (inst.status === 'pending' || inst.status === 'partially_paid') {
      const remainingCents = Math.max(0, toCents(inst.amount) - toCents(inst.paid_amount || 0));
      if (inst.due_date && inst.due_date < todayStr) {
        overdueCount += 1;
        overdueAmountCents += remainingCents;
      } else {
        pendingCount += 1;
        pendingAmountCents += remainingCents;
      }
    }
  }

  // D. Recorrências do mês (deduplicadas contra transações já materializadas)
  const [refYear, refMonthNum] = referenceMonth.split('-').map(Number);
  for (const rec of recurring) {
    const { active, multiplier } = isRecurrenceActiveInMonth(rec, refYear, refMonthNum);
    if (!active || multiplier <= 0) continue;

    const materializedCount = transactions.filter(
      (t) =>
        t.recurring_transaction_id === rec.id &&
        t.transaction_date.slice(0, 7) === referenceMonth &&
        t.status !== 'cancelled'
    ).length;

    const remainingOccurrences = Math.max(0, multiplier - materializedCount);
    if (remainingOccurrences <= 0) continue;

    const recTotalCents = toCents(rec.amount) * remainingOccurrences;
    if (rec.type === 'income') {
      plannedIncomeCents += recTotalCents;
    } else {
      plannedExpenseCents += recTotalCents;
    }
  }

  const realizedIncome = fromCents(realizedIncomeCents);
  const realizedExpense = fromCents(realizedExpenseCents);
  const plannedIncome = fromCents(plannedIncomeCents);
  const plannedExpense = fromCents(plannedExpenseCents);

  return {
    totalBalance: fromCents(totalBalanceCents),
    realized: {
      income: realizedIncome,
      expense: realizedExpense,
      net: fromCents(realizedIncomeCents - realizedExpenseCents),
    },
    planned: {
      income: plannedIncome,
      expense: plannedExpense,
      net: fromCents(plannedIncomeCents - plannedExpenseCents),
    },
    overdue: {
      count: overdueCount,
      amount: fromCents(overdueAmountCents),
    },
    pending: {
      count: pendingCount,
      amount: fromCents(pendingAmountCents),
    },
  };
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
 * Validação de invariantes de transação (proíbe receitas com cartão ou faturas e valida coerência de contas).
 */
export function validateTransactionBusinessRules(
  tx: {
    type: string;
    credit_card_id?: string | null;
    credit_card_bill_id?: string | null;
    payment_method_id?: string | null;
    account_id?: string | null;
  },
  paymentMethods: PaymentMethod[],
  workspaceId: string
): void {
  if (tx.type === 'income') {
    if (tx.credit_card_id || tx.credit_card_bill_id) {
      throw new Error('Receitas não podem ser vinculadas a cartão de crédito ou faturas.');
    }
    if (tx.payment_method_id) {
      const pm = paymentMethods.find((p) => p.id === tx.payment_method_id && p.workspace_id === workspaceId);
      if (pm && (pm.type === 'credit_card' || pm.credit_card_id)) {
        throw new Error('Receitas não podem ser vinculadas a cartão de crédito ou faturas.');
      }
    }
  }

  // Coerência estrita entre linked_account_id do método de pagamento e account_id da transação (P2 V22/V23)
  if (tx.payment_method_id && tx.account_id) {
    const pm = paymentMethods.find((p) => p.id === tx.payment_method_id && p.workspace_id === workspaceId);
    if (pm?.linked_account_id && pm.linked_account_id !== tx.account_id) {
      throw new Error('A conta bancária informada diverge da conta bancária vinculada a este método de pagamento.');
    }
  }
}

/**
 * Validação de imutabilidade de datas em transações vinculadas a fatura de cartão de crédito.
 */
export function validateBilledTransactionDateImmutability(
  tx: { credit_card_bill_id?: string | null; transaction_date: string; due_date: string },
  data: { transaction_date?: string; due_date?: string }
): void {
  if (tx.credit_card_bill_id) {
    if (
      (data.transaction_date !== undefined && data.transaction_date !== tx.transaction_date) ||
      (data.due_date !== undefined && data.due_date !== tx.due_date)
    ) {
      throw new Error(
        'Datas de transações vinculadas a faturas de cartão de crédito não podem ser alteradas diretamente.'
      );
    }
  }
}

/**
 * Saneamento idempotente de séries recorrentes legadas (ex: V20 com income + cartão).
 * Marca qualquer série inválida como inativa com suspended_reason.
 */
export function sanitizeLegacyRecurringState(
  recurring: RecurringTransaction[],
  paymentMethods: PaymentMethod[]
): { sanitized: RecurringTransaction[]; hasChanges: boolean } {
  let hasChanges = false;
  const sanitized = recurring.map((rec) => {
    if (rec.type === 'income') {
      const pm = rec.payment_method_id
        ? paymentMethods.find((p) => p.id === rec.payment_method_id && p.workspace_id === rec.workspace_id)
        : null;
      const isCardMethod = pm && (pm.type === 'credit_card' || pm.credit_card_id);
      if (rec.credit_card_id || isCardMethod) {
        if (rec.active || !rec.suspended_reason) {
          hasChanges = true;
          return {
            ...rec,
            active: false,
            suspended_reason: 'Receitas não podem ser vinculadas a cartão de crédito ou faturas.',
          };
        }
      }
    }
    return rec;
  });

  return { sanitized, hasChanges };
}

/**
 * Validação estrita do valor monetário de recorrência.
 */
export function validateRecurringAmount(amount: unknown): void {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw new Error('O valor da recorrência deve ser maior que zero.');
  }
}

/**
 * Resolução e inferência estrita de conta bancária para transações com base no método de pagamento.
 */
export function resolveTransactionAccountId(
  paymentMethodId: string | null | undefined,
  explicitAccountId: string | null | undefined,
  paymentMethods: PaymentMethod[],
  workspaceId: string
): string | undefined {
  if (!paymentMethodId) return explicitAccountId || undefined;
  const pm = paymentMethods.find((p) => p.id === paymentMethodId && p.workspace_id === workspaceId);
  if (pm?.linked_account_id) {
    if (explicitAccountId && explicitAccountId !== pm.linked_account_id) {
      throw new Error('A conta bancária informada diverge da conta bancária vinculada a este método de pagamento.');
    }
    return pm.linked_account_id;
  }
  return explicitAccountId || undefined;
}

/**
 * Validação de conta bancária para liquidação de fatura de cartão de crédito.
 * No modo sem saldo (isExpenseTrackerMode), a conta bancária é opcional.
 */
export function validateBillPaymentAccount(
  accountId: string | undefined | null,
  accounts: Account[],
  workspaceId: string,
  isExpenseTrackerMode?: boolean
): void {
  if (isExpenseTrackerMode && !accountId) {
    return;
  }
  if (!accountId) {
    throw new Error('Conta bancária não encontrada no workspace ativo.');
  }
  const acc = accounts.find((a) => a.id === accountId && a.workspace_id === workspaceId);
  if (!acc) {
    throw new Error('Conta bancária não encontrada no workspace ativo.');
  }
  if (acc.active === false) {
    throw new Error('A conta bancária selecionada para pagamento da fatura está inativa.');
  }
}

/**
 * Validação centralizada de conta bancária para liquidação de obrigações (transações e parcelas).
 * No modo sem saldo (isExpenseTrackerMode), a conta é opcional e não gera erro se omitida.
 */
export function validatePaymentAccount(
  accountId: string | undefined | null,
  accounts: Account[],
  workspaceId: string,
  isExpenseTrackerMode?: boolean
): Account | null {
  if (isExpenseTrackerMode && !accountId) {
    return null;
  }
  if (!accountId) {
    throw new Error('Conta bancária não encontrada no workspace ativo.');
  }
  const acc = accounts.find((a) => a.id === accountId && a.workspace_id === workspaceId);
  if (!acc) {
    throw new Error('Conta bancária não encontrada no workspace ativo.');
  }
  if (acc.active === false) {
    throw new Error('A conta bancária informada está inativa.');
  }
  return acc;
}

export interface RecurringMaterializationValidationResult {
  isValid: boolean;
  effectiveCardId?: string | null;
  effectiveAccountId?: string | null;
  reason?: string | null;
}

/**
 * Validação pura de integridade para materialização de recorrência.
 */
export function validateRecurringMaterialization(
  rec: RecurringTransaction,
  accounts: Account[],
  paymentMethods: PaymentMethod[],
  creditCards: CreditCard[],
  categories: Category[],
  workspaceId: string
): RecurringMaterializationValidationResult {
  try {
    validateRecurringAmount(rec.amount);

    const effectiveAccountId = resolveTransactionAccountId(
      rec.payment_method_id,
      rec.account_id,
      paymentMethods,
      workspaceId
    );

    if (effectiveAccountId) {
      const acc = accounts.find((a) => a.id === effectiveAccountId && a.workspace_id === workspaceId);
      if (!acc) {
        return { isValid: false, reason: 'Conta bancária associada não encontrada no workspace.' };
      }
      if (acc.active === false) {
        return { isValid: false, reason: 'Conta bancária vinculada está inativa.' };
      }
    }

    if (rec.category_id) {
      const cat = categories.find(
        (c) =>
          (c.id === rec.category_id || c.subcategories?.some((s) => s.id === rec.category_id)) &&
          c.workspace_id === workspaceId
      );
      if (!cat || cat.active === false) {
        return { isValid: false, reason: 'Categoria vinculada inativa ou inválida.' };
      }
      if (cat.id !== rec.category_id) {
        const sub = cat.subcategories?.find((s) => s.id === rec.category_id);
        if (sub && sub.active === false) {
          return { isValid: false, reason: 'A subcategoria informada está inativa.' };
        }
      }
    }

    const effectiveCardId = validateCreditCardResolution(
      workspaceId,
      paymentMethods,
      creditCards,
      accounts,
      rec.payment_method_id,
      rec.credit_card_id
    );

    validateTransactionBusinessRules(
      {
        type: rec.type,
        credit_card_id: effectiveCardId || rec.credit_card_id,
        payment_method_id: rec.payment_method_id,
        account_id: effectiveAccountId || rec.account_id,
      },
      paymentMethods,
      workspaceId
    );

    return { isValid: true, effectiveCardId, effectiveAccountId };
  } catch (err: any) {
    return {
      isValid: false,
      reason: err?.message || 'Inconsistência de integridade nas regras financeiras da recorrência.',
    };
  }
}

/**
 * Avança uma ocorrência de recorrência preservando âncora de dia do mês.
 */
export function stepNextOccurrence(
  currDateStr: string,
  startDateStr: string,
  frequency: string,
  intervalDays?: number | null
): string {
  const curr = parseISO(currDateStr);
  if (frequency === 'weekly') {
    return format(addDays(curr, 7), 'yyyy-MM-dd');
  }
  if (frequency === 'custom') {
    if (!isValidCustomInterval(intervalDays)) {
      throw new Error('Intervalo em dias inválido para recorrência personalizada (deve ser número inteiro entre 1 e 3650 dias).');
    }
    return format(addDays(curr, intervalDays as number), 'yyyy-MM-dd');
  }

  const start = parseISO(startDateStr);
  const anchorDay = start.getDate();

  const stepMonths =
    frequency === 'monthly'
      ? 1
      : frequency === 'bimonthly'
      ? 2
      : frequency === 'quarterly'
      ? 3
      : frequency === 'semiannual'
      ? 6
      : 12;

  let targetYear = curr.getFullYear();
  let targetMonth = curr.getMonth() + 1 + stepMonths;
  while (targetMonth > 12) {
    targetMonth -= 12;
    targetYear += 1;
  }

  const maxDays = getActualDaysInMonth(targetYear, targetMonth);
  const realDay = Math.min(anchorDay, maxDays);

  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(realDay).padStart(2, '0')}`;
}

/**
 * Avança ocorrência atrasada para o futuro de forma determinística sem backfill excessivo.
 */
export function calculateCatchUpOccurrence(
  currentNextOccurrence: string,
  startDate: string,
  frequency: string,
  intervalDays?: number | null,
  targetDateStr: string = format(new Date(), 'yyyy-MM-dd')
): string {
  if (currentNextOccurrence >= targetDateStr) return currentNextOccurrence;
  if (frequency === 'custom' && intervalDays && intervalDays > 0) {
    const startD = parseISO(startDate);
    const todayD = parseISO(targetDateStr);
    const diffDays = Math.max(0, Math.floor((todayD.getTime() - startD.getTime()) / (1000 * 60 * 60 * 24)));
    const cycles = Math.ceil(diffDays / intervalDays);
    return format(addDays(startD, cycles * intervalDays), 'yyyy-MM-dd');
  }
  let curr = currentNextOccurrence;
  let count = 0;
  while (curr < targetDateStr && count < 1200) {
    curr = stepNextOccurrence(curr, startDate, frequency, intervalDays);
    count++;
  }
  return curr;
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

/**
 * Validação de conta bancária ativa para transação ou atualização.
 */
export function validateTransactionAccount(
  accountId: string | null | undefined,
  accounts: Account[],
  workspaceId: string
): void {
  if (accountId) {
    const a = accounts.find((acc) => acc.id === accountId && acc.workspace_id === workspaceId);
    if (!a) throw new Error('Conta bancária informada não pertence ao workspace ativo.');
    if (a.active === false) throw new Error('A conta bancária informada está inativa.');
  }
}

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
 * Resolve ou cria fatura de cartão de crédito deterministicamente.
 * Se a fatura já existe pelo par (cardId, referenceMonth, workspaceId),
 * incrementa o total e retorna o ID real existente (b.id).
 * Se não existir, cria a nova fatura e retorna targetBillId.
 */
/**
 * Converte um valor monetário (em reais/unidade principal) para centavos inteiros.
 * Política de Decimais (V36 / P0-02): Adota arredondamento determinístico comercial (half-up / round-to-nearest)
 * universal através de notação exponencial decimal (`Math.round(Number(base + 'e' + targetExp))`),
 * imune a variações de escala de float drift IEEE 754 (ex: 10.075 -> 1008 centavos / R$ 10,08; 1.005 -> 101 centavos / R$ 1,01).
 * Trata nativamente notações científicas existentes (ex: 1e-7, 1e21) sem gerar NaN, normaliza valores subcentavos
 * (< 0.005) para 0 centavos, valida Number.isSafeInteger e normaliza -0 para 0.
 */
export function toCents(amount: number): number {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount === 0) return 0;
  const sign = amount < 0 ? -1 : 1;
  const abs = Math.abs(amount);

  // Valores subcentavos (< 0.005) arredondam para 0 centavos
  if (abs < 0.005) return 0;

  // Limite de segurança de representação inteira em centavos
  if (abs * 100 > Number.MAX_SAFE_INTEGER) return 0;

  // Deslocamento de escala decimal imune a números já formatados em notação científica (ex: 1e-7)
  const parts = String(abs).split(/[eE]/);
  const base = parts[0];
  const exp = parts[1] ? Number(parts[1]) : 0;
  const targetExp = exp + 2;
  const num = Number(`${base}e${targetExp >= 0 ? '+' : ''}${targetExp}`);

  if (!Number.isFinite(num)) return 0;
  const rounded = sign * Math.round(num);

  return !Number.isFinite(rounded) || !Number.isSafeInteger(rounded) || Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Converte centavos inteiros de volta para valor monetário float com até 2 casas decimais.
 */
export function fromCents(cents: number): number {
  if (typeof cents !== 'number' || !Number.isFinite(cents) || cents === 0) return 0;
  const roundedCents = Math.round(cents);
  if (!Number.isSafeInteger(roundedCents)) return 0;
  const val = roundedCents / 100;
  return Object.is(val, -0) ? 0 : val;
}

/**
 * Arredonda de forma pura e determinística qualquer montante monetário para 2 casas decimais.
 * Utiliza a política institucional de centavos inteiros half-up.
 */
export function roundCurrency(amount: number): number {
  return fromCents(toCents(amount));
}

/**
 * Compara dois valores monetários operando estritamente em centavos inteiros.
 * Retorna > 0 se a > b, < 0 se a < b, e 0 se a === b dentro da precisão de centavos.
 */
export function compareCurrency(a: number, b: number): number {
  return toCents(a) - toCents(b);
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

export interface ProcessRecurringBatchParams {
  recurring: RecurringTransaction[];
  transactions: Transaction[];
  bills: CreditCardBill[];
  accounts: Account[];
  paymentMethods: PaymentMethod[];
  creditCards: CreditCard[];
  categories: Category[];
  todayStr: string;
  generateId?: (prefix: string) => string;
  nowIso?: string;
}

export interface ProcessRecurringBatchResult {
  updatedRecurring: RecurringTransaction[];
  newTransactions: Transaction[];
  updatedBills: CreditCardBill[];
  hasChanges: boolean;
}

/**
 * Função pura de transição de estado para processamento em lote de recorrências.
 * Utilizada como única fonte de verdade tanto pelo FinanceProvider quanto pela suíte de testes.
 */
export function processRecurringBatchState(
  params: ProcessRecurringBatchParams
): ProcessRecurringBatchResult {
  const {
    recurring,
    transactions,
    bills,
    accounts,
    paymentMethods,
    creditCards,
    categories,
    todayStr,
    generateId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    nowIso = new Date().toISOString(),
  } = params;

  let updatedBills = [...bills];
  let updatedRecurring = [...recurring];
  const newTransactions: Transaction[] = [];
  let hasChanges = false;

  const processedSet = new Set<string>(
    transactions.map((t) => `${t.recurring_transaction_id || ''}:${t.transaction_date}`)
  );

  // Desativação semântica para qualquer série cujo next_occurrence já ultrapassou end_date
  updatedRecurring = updatedRecurring.map((r) => {
    if (r.active && r.end_date && r.next_occurrence > r.end_date) {
      hasChanges = true;
      return { ...r, active: false };
    }
    return r;
  });

  for (const rec of updatedRecurring) {
    if (!rec.active || !rec.auto_create || rec.next_occurrence > todayStr) continue;

    let currOccurrence = rec.next_occurrence;
    let iterations = 0;
    let shouldDeactivate = false;

    const validation = validateRecurringMaterialization(
      rec,
      accounts,
      paymentMethods,
      creditCards,
      categories,
      rec.workspace_id
    );

    if (!validation.isValid) {
      shouldDeactivate = true;
      hasChanges = true;
      updatedRecurring = updatedRecurring.map((r) =>
        r.id === rec.id ? { ...r, active: false, suspended_reason: validation.reason } : r
      );
      continue;
    }

    const effectiveCardId = validation.effectiveCardId || null;
    const effectiveAccountId = validation.effectiveAccountId || rec.account_id;

    while (
      currOccurrence <= todayStr &&
      (!rec.end_date || currOccurrence <= rec.end_date) &&
      iterations < 120
    ) {
      iterations++;
      const itemKey = `${rec.id}:${currOccurrence}`;

      if (!processedSet.has(itemKey)) {
        let billId: string | null = null;
        let calculatedDueDate = currOccurrence;

        if (effectiveCardId) {
          const card = creditCards.find((c) => c.id === effectiveCardId && c.workspace_id === rec.workspace_id);
          if (card) {
            const billDates = calculateCardBillDates(currOccurrence, card.closing_day, card.due_day);
            const billRes = resolveOrCreateCreditCardBill({
              bills: updatedBills,
              cardId: card.id,
              referenceMonth: billDates.referenceMonth,
              closingDate: billDates.closingDate,
              dueDate: billDates.dueDate,
              amount: rec.amount,
              workspaceId: rec.workspace_id,
              isPaid: false,
              nowIso,
            });
            updatedBills = billRes.updatedBills;
            billId = billRes.billId;
            hasChanges = true;
            calculatedDueDate = billDates.dueDate;
          }
        }

        const newTx: Transaction = {
          id: generateId('tx-rec'),
          workspace_id: rec.workspace_id,
          account_id: effectiveAccountId,
          category_id: rec.category_id,
          payment_method_id: rec.payment_method_id,
          credit_card_id: effectiveCardId || undefined,
          credit_card_bill_id: billId || undefined,
          recurring_transaction_id: rec.id,
          description: rec.description,
          amount: rec.amount,
          type: rec.type,
          transaction_date: currOccurrence,
          due_date: calculatedDueDate,
          status: 'pending',
          paid_amount: 0,
          created_at: nowIso,
        };
        newTransactions.push(newTx);
        processedSet.add(itemKey);
        hasChanges = true;
      }

      const nextStep = stepNextOccurrence(currOccurrence, rec.start_date, rec.frequency, rec.interval_days);
      if (rec.end_date && nextStep > rec.end_date) {
        shouldDeactivate = true;
        currOccurrence = nextStep;
        break;
      }
      currOccurrence = nextStep;
    }

    if (rec.next_occurrence !== currOccurrence || shouldDeactivate) {
      hasChanges = true;
      updatedRecurring = updatedRecurring.map((r) =>
        r.id === rec.id
          ? {
              ...r,
              next_occurrence: currOccurrence,
              active: shouldDeactivate ? false : r.active,
            }
          : r
      );
    }
  }

  return {
    updatedRecurring,
    newTransactions,
    updatedBills,
    hasChanges,
  };
}

/**
 * Calcula a divisão determinística de uma despesa entre membros do workspace sem perda de centavos.
 */
export function calculateExpenseSplits(
  totalAmount: number,
  splitType: SplitType,
  members: { id: string }[],
  payerMemberId: string,
  customSplits?: { member_id: string; amount: number }[]
): TransactionSplit[] {
  if (typeof totalAmount !== 'number' || !Number.isFinite(totalAmount) || totalAmount <= 0) {
    throw new Error('O valor total da despesa para rateio deve ser maior que zero.');
  }
  if (!members || members.length === 0) {
    throw new Error('A lista de membros do workspace não pode estar vazia.');
  }

  const memberIds = new Set(members.map((m) => m.id));
  if (!memberIds.has(payerMemberId)) {
    throw new Error('O membro pagador deve pertencer à lista de membros do workspace.');
  }

  const totalCents = toCents(totalAmount);

  if (splitType === 'individual') {
    return [{ member_id: payerMemberId, amount: fromCents(totalCents), percentage: 100 }];
  }

  if (splitType === 'equal') {
    const count = members.length;
    const baseCents = Math.floor(totalCents / count);
    const remainderCents = totalCents - baseCents * count;

    return members.map((m, idx) => {
      const cents = idx < remainderCents ? baseCents + 1 : baseCents;
      const pct = Math.round((cents / totalCents) * 1000) / 10;
      return {
        member_id: m.id,
        amount: fromCents(cents),
        percentage: pct,
      };
    });
  }

  if (splitType === 'full_other') {
    const otherMembers = members.filter((m) => m.id !== payerMemberId);
    if (otherMembers.length === 0) {
      return [{ member_id: payerMemberId, amount: fromCents(totalCents), percentage: 100 }];
    }
    const count = otherMembers.length;
    const baseCents = Math.floor(totalCents / count);
    const remainderCents = totalCents - baseCents * count;

    return otherMembers.map((m, idx) => {
      const cents = idx < remainderCents ? baseCents + 1 : baseCents;
      const pct = Math.round((cents / totalCents) * 1000) / 10;
      return {
        member_id: m.id,
        amount: fromCents(cents),
        percentage: pct,
      };
    });
  }

  if (splitType === 'custom') {
    if (!customSplits || customSplits.length === 0) {
      return [{ member_id: payerMemberId, amount: fromCents(totalCents), percentage: 100 }];
    }

    const seenMembers = new Set<string>();
    const sanitized = customSplits.map((cs) => {
      if (!cs.member_id || !memberIds.has(cs.member_id)) {
        throw new Error('Todos os participantes do rateio devem pertencer aos membros do workspace.');
      }
      if (seenMembers.has(cs.member_id)) {
        throw new Error('Membros duplicados identificados no rateio customizado.');
      }
      seenMembers.add(cs.member_id);

      if (typeof cs.amount !== 'number' || !Number.isFinite(cs.amount) || cs.amount < 0) {
        throw new Error('O valor atribuído a cada membro no rateio não pode ser negativo.');
      }

      const cents = toCents(cs.amount);
      if (cents < 0) {
        throw new Error('O valor atribuído a cada membro no rateio não pode ser negativo.');
      }

      return {
        member_id: cs.member_id,
        cents,
      };
    });

    const sumCents = sanitized.reduce((acc, c) => acc + c.cents, 0);
    if (sumCents !== totalCents) {
      throw new Error(
        `A soma das divisões (R$ ${(sumCents / 100).toFixed(2)}) diverge do valor total da despesa (R$ ${(totalCents / 100).toFixed(2)}).`
      );
    }
    return sanitized.map((s) => ({
      member_id: s.member_id,
      amount: fromCents(s.cents),
      percentage: totalCents > 0 ? Math.round((s.cents / totalCents) * 1000) / 10 : 0,
    }));
  }

  return [{ member_id: payerMemberId, amount: fromCents(totalCents), percentage: 100 }];
}

export interface MemberNetBalance {
  member_id: string;
  total_paid: number;
  total_share: number;
  net_balance: number; // > 0: a receber (credor); < 0: a pagar (devedor)
}

export interface PairwiseDebt {
  from_member_id: string;
  to_member_id: string;
  amount: number;
}

/**
 * Calcula o balanço líquido de cada membro e consolida dívidas recíprocas (estilo Splitwise).
 */
export function calculateMemberNetBalances(
  transactions: Transaction[],
  settlements: Settlement[],
  members: WorkspaceMember[],
  workspaceId: string,
  purchases?: Purchase[]
): {
  balances: MemberNetBalance[];
  pairwiseDebts: PairwiseDebt[];
} {
  const wsMembers = members.filter((m) => m.workspace_id === workspaceId);

  const paidMap = new Map<string, number>();
  const shareMap = new Map<string, number>();
  const settledOutMap = new Map<string, number>();
  const settledInMap = new Map<string, number>();

  wsMembers.forEach((m) => {
    paidMap.set(m.id, 0);
    shareMap.set(m.id, 0);
    settledOutMap.set(m.id, 0);
    settledInMap.set(m.id, 0);
  });

  // 1. Despesas avulsas com rateio
  const wsTransactions = transactions.filter(
    (t) => t.workspace_id === workspaceId && t.status !== 'cancelled' && t.type === 'expense'
  );

  for (const tx of wsTransactions) {
    if (!tx.splits || tx.splits.length === 0) {
      continue;
    }

    const payerId = tx.paid_by_member_id || wsMembers[0]?.id;
    if (!payerId) continue;

    const txTotalCents = toCents(tx.amount);
    paidMap.set(payerId, (paidMap.get(payerId) || 0) + txTotalCents);

    for (const split of tx.splits) {
      if (split.member_id) {
        const splitCents = toCents(split.amount);
        shareMap.set(split.member_id, (shareMap.get(split.member_id) || 0) + splitCents);
      }
    }
  }

  // 2. Compras parceladas com rateio (P0-02: consolidada no total da compra uma única vez, sem duplicar por parcela)
  const wsPurchases = (purchases || []).filter(
    (p) => p.workspace_id === workspaceId && p.splits && p.splits.length > 0
  );

  for (const pur of wsPurchases) {
    const payerId = pur.paid_by_member_id || wsMembers[0]?.id;
    if (!payerId) continue;

    const purTotalCents = toCents(pur.total_amount);
    paidMap.set(payerId, (paidMap.get(payerId) || 0) + purTotalCents);

    for (const split of pur.splits || []) {
      if (split.member_id) {
        const splitCents = toCents(split.amount);
        shareMap.set(split.member_id, (shareMap.get(split.member_id) || 0) + splitCents);
      }
    }
  }

  // 3. Liquidações e acertos consolidados
  const wsSettlements = settlements.filter((s) => s.workspace_id === workspaceId);
  for (const s of wsSettlements) {
    const sCents = toCents(s.amount);
    settledOutMap.set(s.from_member_id, (settledOutMap.get(s.from_member_id) || 0) + sCents);
    settledInMap.set(s.to_member_id, (settledInMap.get(s.to_member_id) || 0) + sCents);
  }

  const balances: MemberNetBalance[] = wsMembers.map((m) => {
    const paid = paidMap.get(m.id) || 0;
    const share = shareMap.get(m.id) || 0;
    const settledOut = settledOutMap.get(m.id) || 0;
    const settledIn = settledInMap.get(m.id) || 0;

    const netCents = (paid - share) + (settledOut - settledIn);

    return {
      member_id: m.id,
      total_paid: fromCents(paid),
      total_share: fromCents(share),
      net_balance: fromCents(netCents),
    };
  });

  const creditors = balances
    .filter((b) => toCents(b.net_balance) > 0)
    .map((b) => ({ id: b.member_id, cents: toCents(b.net_balance) }))
    .sort((a, b) => b.cents - a.cents);

  const debtors = balances
    .filter((b) => toCents(b.net_balance) < 0)
    .map((b) => ({ id: b.member_id, cents: Math.abs(toCents(b.net_balance)) }))
    .sort((a, b) => b.cents - a.cents);

  const pairwiseDebts: PairwiseDebt[] = [];
  let cIdx = 0;
  let dIdx = 0;

  while (cIdx < creditors.length && dIdx < debtors.length) {
    const creditor = creditors[cIdx];
    const debtor = debtors[dIdx];

    const settleCents = Math.min(creditor.cents, debtor.cents);
    if (settleCents > 0) {
      pairwiseDebts.push({
        from_member_id: debtor.id,
        to_member_id: creditor.id,
        amount: fromCents(settleCents),
      });
      creditor.cents -= settleCents;
      debtor.cents -= settleCents;
    }

    if (creditor.cents === 0) cIdx++;
    if (debtor.cents === 0) dIdx++;
  }

  return { balances, pairwiseDebts };
}

/**
 * Validação rigorosa de registro de liquidação de acerto de contas.
 */
export function validateSettlement(
  fromMemberId: string,
  toMemberId: string,
  amount: number,
  members: WorkspaceMember[],
  workspaceId: string,
  pairwiseDebts?: PairwiseDebt[]
): void {
  if (!fromMemberId || !toMemberId) {
    throw new Error('Membros devedor e credor devem ser informados para o acerto.');
  }
  if (fromMemberId === toMemberId) {
    throw new Error('O membro pagador e o recebedor do acerto não podem ser a mesma pessoa.');
  }
  const amountCents = toCents(amount);
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amountCents <= 0) {
    throw new Error('O valor do acerto deve ser maior que zero.');
  }
  const wsMembers = members.filter((m) => m.workspace_id === workspaceId);
  const m1 = wsMembers.find((m) => m.id === fromMemberId);
  const m2 = wsMembers.find((m) => m.id === toMemberId);
  if (!m1 || !m2) {
    throw new Error('Os membros participantes do acerto devem pertencer ao workspace ativo.');
  }

  if (pairwiseDebts) {
    const existingDebt = pairwiseDebts.find(
      (d) => d.from_member_id === fromMemberId && d.to_member_id === toMemberId
    );
    const maxCents = existingDebt ? toCents(existingDebt.amount) : 0;
    if (maxCents <= 0) {
      throw new Error('Não há débito pendente registrado entre o pagador e o recebedor informados.');
    }
    if (amountCents > maxCents) {
      throw new Error(
        `O valor do acerto (R$ ${(amountCents / 100).toFixed(2)}) excede a dívida pendente de R$ ${(maxCents / 100).toFixed(2)}.`
      );
    }
  }
}


