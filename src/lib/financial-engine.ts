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
  Transaction,
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

  const baseAmount = Math.floor((totalAmount / installmentCount) * 100) / 100;
  const remainder = Math.round((totalAmount - baseAmount * installmentCount) * 100) / 100;
  const firstAmount = Math.round((baseAmount + remainder) * 100) / 100;

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
    let installmentsAmount = 0;
    let installmentsCount = 0;
    let recurringAmount = 0;
    let pendingTransactionsAmount = 0;
    let expectedIncome = 0;

    // 1. Parcelas ativas fora de cartão
    for (const inst of installments) {
      if (inst.status === 'paid' || inst.status === 'cancelled' || inst.credit_card_bill_id) continue;

      const instMonth = inst.due_date ? inst.due_date.slice(0, 7) : '';
      if (instMonth === monthKey) {
        const remaining = Math.max(0, inst.amount - (inst.paid_amount || 0));
        installmentsAmount += remaining;
        installmentsCount += 1;
        items.push({
          title: `${inst.purchase?.description || 'Compra Parcelada'} (${inst.installment_number}/${inst.purchase?.installment_count || '?'})`,
          amount: remaining,
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
        const remaining = Math.max(0, bill.total_amount - (bill.paid_amount || 0));
        if (remaining > 0) {
          installmentsAmount += remaining;
          installmentsCount += 1;
          items.push({
            title: `Fatura Cartão (${bill.reference_month})`,
            amount: remaining,
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

      const recTotal = rec.amount * remainingOccurrences;

      if (rec.type === 'expense') {
        recurringAmount += recTotal;
        items.push({
          title: remainingOccurrences > 1 ? `${rec.description} (${remainingOccurrences}x)` : rec.description,
          amount: recTotal,
          type: 'recurring',
          dueDate: `${monthKey}-10`,
          categoryName: rec.category?.name,
        });
      } else {
        expectedIncome += recTotal;
      }
    }

    // 4. Transações avulsas pendentes do mês (exclui canceladas, pagas e itens de cartão já contados na fatura)
    for (const tx of transactions) {
      if (tx.status === 'paid' || tx.status === 'cancelled' || tx.credit_card_bill_id || tx.credit_card_id) continue;

      const txMonth = tx.due_date ? tx.due_date.slice(0, 7) : tx.transaction_date.slice(0, 7);
      if (txMonth === monthKey) {
        const remaining = Math.max(0, tx.amount - (tx.paid_amount || 0));
        if (tx.type === 'expense') {
          pendingTransactionsAmount += remaining;
          items.push({
            title: tx.description,
            amount: remaining,
            type: 'transaction',
            dueDate: tx.due_date,
            categoryName: tx.category?.name,
          });
        } else {
          expectedIncome += remaining;
        }
      }
    }

    const totalCommitment = installmentsAmount + recurringAmount + pendingTransactionsAmount;
    const netForecast = expectedIncome - totalCommitment;

    result.push({
      monthKey,
      monthLabel,
      installmentsAmount,
      recurringAmount,
      pendingTransactionsAmount,
      expectedIncome,
      totalCommitment,
      netForecast,
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
  const totalBalance = accounts.reduce((acc, a) => acc + (a.current_balance || 0), 0);

  let realizedIncome = 0;
  let realizedExpense = 0;

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
      if (pay.transaction_id) {
        const tx = transactions.find((t) => t.id === pay.transaction_id);
        if (tx && tx.type === 'income') {
          realizedIncome += pay.amount;
        } else {
          realizedExpense += pay.amount;
        }
      } else {
        // Pagamento de fatura de cartão ou parcela direta
        realizedExpense += pay.amount;
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
        if (tx.type === 'income') realizedIncome += tx.amount;
        else realizedExpense += tx.amount;
      } else if (tx.status === 'partially_paid') {
        if (tx.type === 'income') realizedIncome += tx.paid_amount || 0;
        else realizedExpense += tx.paid_amount || 0;
      }
    }
  }

  // 2. Visão Prevista e Pendências para o mês
  let plannedIncome = 0;
  let plannedExpense = 0;

  let overdueCount = 0;
  let overdueAmount = 0;
  let pendingCount = 0;
  let pendingAmount = 0;

  const todayStr = currentDateStr || format(new Date(), 'yyyy-MM-dd');

  // A. Faturas de Cartão (Fonte Única de Verdade de Cartão)
  for (const bill of creditCardBills) {
    if (bill.status === 'cancelled') continue;

    if (bill.reference_month === referenceMonth) {
      plannedExpense += bill.total_amount;
    }

    if (bill.status === 'open' || bill.status === 'partially_paid' || bill.status === 'overdue') {
      const remaining = Math.max(0, bill.total_amount - (bill.paid_amount || 0));
      if (remaining > 0) {
        if (bill.due_date < todayStr) {
          overdueCount += 1;
          overdueAmount += remaining;
        } else {
          pendingCount += 1;
          pendingAmount += remaining;
        }
      }
    }
  }

  // B. Transações Avulsas (Exclui itens de cartão de crédito para evitar dupla contagem)
  for (const tx of transactions) {
    if (tx.status === 'cancelled' || tx.credit_card_bill_id || tx.credit_card_id) continue;

    const txDueMonth = tx.due_date ? tx.due_date.slice(0, 7) : tx.transaction_date.slice(0, 7);

    if (txDueMonth === referenceMonth) {
      if (tx.type === 'income') {
        plannedIncome += tx.amount;
      } else {
        plannedExpense += tx.amount;
      }
    }

    if (tx.status === 'pending' || tx.status === 'partially_paid') {
      const remaining = Math.max(0, tx.amount - (tx.paid_amount || 0));
      if (tx.due_date && tx.due_date < todayStr) {
        overdueCount += 1;
        overdueAmount += remaining;
      } else {
        pendingCount += 1;
        pendingAmount += remaining;
      }
    }
  }

  // C. Parcelas (Exclui parcelas de cartão para evitar dupla contagem com a fatura)
  for (const inst of installments) {
    if (inst.status === 'cancelled' || inst.credit_card_bill_id) continue;

    const instMonth = inst.due_date ? inst.due_date.slice(0, 7) : '';
    if (instMonth === referenceMonth) {
      plannedExpense += inst.amount;
    }

    if (inst.status === 'pending' || inst.status === 'partially_paid') {
      const remaining = Math.max(0, inst.amount - (inst.paid_amount || 0));
      if (inst.due_date && inst.due_date < todayStr) {
        overdueCount += 1;
        overdueAmount += remaining;
      } else {
        pendingCount += 1;
        pendingAmount += remaining;
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

    const recTotal = rec.amount * remainingOccurrences;
    if (rec.type === 'income') {
      plannedIncome += recTotal;
    } else {
      plannedExpense += recTotal;
    }
  }

  return {
    totalBalance,
    realized: {
      income: realizedIncome,
      expense: realizedExpense,
      net: realizedIncome - realizedExpense,
    },
    planned: {
      income: plannedIncome,
      expense: plannedExpense,
      net: plannedIncome - plannedExpense,
    },
    overdue: {
      count: overdueCount,
      amount: overdueAmount,
    },
    pending: {
      count: pendingCount,
      amount: pendingAmount,
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
 */
export function validateBillPaymentAccount(
  accountId: string,
  accounts: Account[],
  workspaceId: string
): void {
  const acc = accounts.find((a) => a.id === accountId && a.workspace_id === workspaceId);
  if (!acc) {
    throw new Error('Conta bancária não encontrada no workspace ativo.');
  }
  if (acc.active === false) {
    throw new Error('A conta bancária selecionada para pagamento da fatura está inativa.');
  }
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

  const getOrCreateAndAddBill = (
    cardId: string,
    refMonth: string,
    closingDate: string,
    dueDate: string,
    amount: number,
    wsId: string
  ): string => {
    const existingIdx = updatedBills.findIndex(
      (b) => b.credit_card_id === cardId && b.reference_month === refMonth && b.workspace_id === wsId
    );

    if (existingIdx >= 0) {
      const b = updatedBills[existingIdx];
      const newTotal = b.total_amount + amount;
      const newPaid = b.paid_amount || 0;
      const fullyPaid = newPaid >= newTotal && newTotal > 0;
      updatedBills = updatedBills.map((item, idx) =>
        idx === existingIdx
          ? {
              ...item,
              total_amount: newTotal,
              status: fullyPaid ? 'paid' : newPaid > 0 ? 'partially_paid' : item.status,
              paid_at: fullyPaid ? item.due_date : null,
            }
          : item
      );
      hasChanges = true;
      return b.id;
    } else {
      const targetBillId = `bill-${cardId}-${refMonth}`;
      updatedBills = [
        ...updatedBills,
        {
          id: targetBillId,
          credit_card_id: cardId,
          workspace_id: wsId,
          reference_month: refMonth,
          closing_date: closingDate,
          due_date: dueDate,
          total_amount: amount,
          paid_amount: 0,
          status: 'open',
          paid_at: null,
          created_at: nowIso,
        },
      ];
      hasChanges = true;
      return targetBillId;
    }
  };

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
            billId = getOrCreateAndAddBill(
              card.id,
              billDates.referenceMonth,
              billDates.closingDate,
              billDates.dueDate,
              rec.amount,
              rec.workspace_id
            );
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

