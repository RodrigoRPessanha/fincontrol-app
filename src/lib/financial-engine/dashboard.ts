import {
  Account,
  CreditCard,
  CreditCardBill,
  Installment,
  MonthlyCommitment,
  Payment,
  Purchase,
  RecurringTransaction,
  Transaction,
} from '../types';
import { format, parseISO, isSameDay, addMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toCents, fromCents, roundCurrency } from './money';
import { isRecurrenceActiveInMonth, stepNextOccurrence } from './recurring';

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
