import { describe, it, expect } from 'vitest';
import {
  calculateCardBillDates,
  calculateDashboardSummary,
  calculateFutureCommitments,
  calculateIntegerPercentages,
  getActualDaysInMonth,
  getAnchoredOccurrenceDate,
  isRecurrenceActiveInMonth,
  isValidCustomInterval,
  resolveCategory,
  splitInstallments,
} from '../financial-engine';
import { Category, CreditCard, CreditCardBill, Installment, Payment, Purchase, RecurringTransaction, Transaction } from '../types';

describe('Financial Engine - Dias Reais do Mês', () => {
  it('deve retornar o número real de dias para meses de 28, 29, 30 e 31 dias', () => {
    expect(getActualDaysInMonth(2026, 1)).toBe(31);
    expect(getActualDaysInMonth(2026, 2)).toBe(28);
    expect(getActualDaysInMonth(2024, 2)).toBe(29);
    expect(getActualDaysInMonth(2026, 4)).toBe(30);
    expect(getActualDaysInMonth(2026, 8)).toBe(31);
  });
});

describe('Financial Engine - Cálculo de Faturas de Cartão (calculateCardBillDates)', () => {
  it('deve manter compra na fatura do mês atual se a compra foi antes do fechamento', () => {
    const result = calculateCardBillDates('2026-08-05', 10, 18);
    expect(result.referenceMonth).toBe('2026-08');
    expect(result.closingDate).toBe('2026-08-10');
    expect(result.dueDate).toBe('2026-08-18');
  });

  it('deve projetar para a fatura do mês seguinte se a compra ocorreu após o fechamento', () => {
    const result = calculateCardBillDates('2026-08-15', 10, 18);
    expect(result.referenceMonth).toBe('2026-09');
    expect(result.closingDate).toBe('2026-09-10');
    expect(result.dueDate).toBe('2026-09-18');
  });

  it('deve tratar vencimento no mês subsequente quando dueDay < closingDay', () => {
    const result = calculateCardBillDates('2026-08-10', 25, 5);
    expect(result.referenceMonth).toBe('2026-08');
    expect(result.closingDate).toBe('2026-08-25');
    expect(result.dueDate).toBe('2026-09-05');
  });

  it('deve tratar virada de ano em Dezembro tanto no fechamento quanto no vencimento subsequente', () => {
    const result1 = calculateCardBillDates('2026-12-28', 20, 28);
    expect(result1.referenceMonth).toBe('2027-01');
    expect(result1.closingDate).toBe('2027-01-20');
    expect(result1.dueDate).toBe('2027-01-28');

    const result2 = calculateCardBillDates('2026-12-10', 20, 5);
    expect(result2.referenceMonth).toBe('2026-12');
    expect(result2.closingDate).toBe('2026-12-20');
    expect(result2.dueDate).toBe('2027-01-05');
  });

  it('deve aplicar clamp seguro para fechamento nos dias 29, 30 e 31 em Fevereiro', () => {
    const result = calculateCardBillDates('2026-02-10', 31, 10);
    expect(result.referenceMonth).toBe('2026-02');
    expect(result.closingDate).toBe('2026-02-28');
    expect(result.dueDate).toBe('2026-03-10');
  });

  it('deve calcular corretamente a matriz de datas de fim de mês, bissexto e viradas de ano', () => {
    // 28/02/2026 após fechamento dia 25
    const r1 = calculateCardBillDates('2026-02-28', 25, 5);
    expect(r1.referenceMonth).toBe('2026-03');
    expect(r1.closingDate).toBe('2026-03-25');
    expect(r1.dueDate).toBe('2026-04-05');

    // 29/02/2028 (ano bissexto) após fechamento dia 28
    const r2 = calculateCardBillDates('2028-02-29', 28, 10);
    expect(r2.referenceMonth).toBe('2028-03');
    expect(r2.closingDate).toBe('2028-03-28');
    expect(r2.dueDate).toBe('2028-04-10');

    // 30/04/2026 após fechamento dia 25
    const r3 = calculateCardBillDates('2026-04-30', 25, 5);
    expect(r3.referenceMonth).toBe('2026-05');
    expect(r3.closingDate).toBe('2026-05-25');
    expect(r3.dueDate).toBe('2026-06-05');

    // 31/01/2026 após fechamento dia 30
    const r4 = calculateCardBillDates('2026-01-31', 30, 5);
    expect(r4.referenceMonth).toBe('2026-02');
    expect(r4.closingDate).toBe('2026-02-28');
    expect(r4.dueDate).toBe('2026-03-05');

    // 31/12/2026 após fechamento dia 20 (virada de ano)
    const r5 = calculateCardBillDates('2026-12-31', 20, 5);
    expect(r5.referenceMonth).toBe('2027-01');
    expect(r5.closingDate).toBe('2027-01-20');
    expect(r5.dueDate).toBe('2027-02-05');
  });

  it('deve usar valores defensivos se parâmetros forem inválidos', () => {
    const result1 = calculateCardBillDates('2026-08-10', 0, 40);
    expect(result1.referenceMonth).toBe('2026-09');
    expect(result1.closingDate).toBe('2026-09-01');
    expect(result1.dueDate).toBe('2026-09-30');

    const result2 = calculateCardBillDates('2026-08-05', 15, 0);
    expect(result2.referenceMonth).toBe('2026-08');
    expect(result2.closingDate).toBe('2026-08-15');
    expect(result2.dueDate).toBe('2026-09-10');

    expect(() => calculateCardBillDates('data-invalida', 10, 20)).toThrow('Data de compra inválida fornecida');
    expect(() => calculateCardBillDates('', 10, 20)).toThrow('Data de compra inválida');
  });
});

describe('Financial Engine - splitInstallments', () => {
  it('deve lançar erro se a data de compra for inválida no parcelamento', () => {
    expect(() => splitInstallments(100, 3, 'data-invalida')).toThrow('Data de compra inválida fornecida');
    expect(() => splitInstallments(100, 3, '')).toThrow('Data de compra inválida');
  });

  it('deve rejeitar parcelamento com quantidade inválida, decimal ou negativa', () => {
    expect(splitInstallments(100, 0, '2026-08-01')).toEqual([]);
    expect(splitInstallments(100, -3, '2026-08-01')).toEqual([]);
    expect(splitInstallments(100, 2.5, '2026-08-01')).toEqual([]);
    expect(splitInstallments(100, 150, '2026-08-01')).toEqual([]);
    expect(splitInstallments(100, '3' as any, '2026-08-01')).toEqual([]);
  });

  it('deve rejeitar valores monetários inválidos ou parcelas menores que 1 centavo', () => {
    expect(splitInstallments(0, 3, '2026-08-01')).toEqual([]);
    expect(splitInstallments(-50, 3, '2026-08-01')).toEqual([]);
    expect(splitInstallments(NaN, 3, '2026-08-01')).toEqual([]);
    expect(splitInstallments(Infinity, 3, '2026-08-01')).toEqual([]);
    expect(splitInstallments(0.02, 5, '2026-08-01')).toEqual([]);
  });

  it('deve dividir R$ 100,00 em 3x sem perda de centavos (33,34 + 33,33 + 33,33)', () => {
    const split = splitInstallments(100, 3, '2026-08-15');
    expect(split).toHaveLength(3);
    expect(split[0].amount).toBe(33.34);
    expect(split[1].amount).toBe(33.33);
    expect(split[2].amount).toBe(33.33);
    expect(split[0].dueDate).toBe('2026-08-15');
    expect(split[1].dueDate).toBe('2026-09-15');
    expect(split[2].dueDate).toBe('2026-10-15');
  });

  it('deve associar datas de fatura quando fornecido cartão de crédito', () => {
    const card: CreditCard = {
      id: 'card-1',
      workspace_id: 'ws-1',
      name: 'Itaú',
      institution: 'Itaú',
      credit_limit: 5000,
      closing_day: 10,
      due_day: 18,
      color: '#000',
      active: true,
      created_at: '2026-01-01',
    };

    const split = splitInstallments(300, 2, '2026-08-15', card);
    expect(split).toHaveLength(2);
    expect(split[0].referenceMonth).toBe('2026-09');
    expect(split[0].dueDate).toBe('2026-09-18');
    expect(split[1].referenceMonth).toBe('2026-10');
    expect(split[1].dueDate).toBe('2026-10-18');
  });

  it('deve gerar faturas consecutivas para compra em fim de mês (31/01, fechamento 30, 3x) sem duplicar ciclo nem pular mês', () => {
    const cardEndMonth: CreditCard = {
      id: 'card-end',
      workspace_id: 'ws-1',
      name: 'Nubank',
      institution: 'Nubank',
      credit_limit: 10000,
      closing_day: 30,
      due_day: 5,
      color: '#820ad1',
      active: true,
      created_at: '2026-01-01',
    };

    const split = splitInstallments(300, 3, '2026-01-31', cardEndMonth);
    expect(split).toHaveLength(3);
    // Parcela 1: cai na fatura de fevereiro (fechamento de janeiro no dia 30 já havia passado)
    expect(split[0].referenceMonth).toBe('2026-02');
    expect(split[0].closingDate).toBe('2026-02-28');
    expect(split[0].dueDate).toBe('2026-03-05');

    // Parcela 2: fatura de março consecutiva (sem pular mês!)
    expect(split[1].referenceMonth).toBe('2026-03');
    expect(split[1].closingDate).toBe('2026-03-30');
    expect(split[1].dueDate).toBe('2026-04-05');

    // Parcela 3: fatura de abril consecutiva
    expect(split[2].referenceMonth).toBe('2026-04');
    expect(split[2].closingDate).toBe('2026-04-30');
    expect(split[2].dueDate).toBe('2026-05-05');
  });

  it('deve suportar paidInstallmentsCount e marcar parcelas já quitadas', () => {
    const split = splitInstallments(1000, 10, '2026-01-10', undefined, 3);
    expect(split).toHaveLength(10);
    expect(split[0].isPaid).toBe(true);
    expect(split[1].isPaid).toBe(true);
    expect(split[2].isPaid).toBe(true);
    expect(split[3].isPaid).toBe(false);
    expect(split[9].isPaid).toBe(false);
  });

  it('deve cruzar virada de ano em parcelamento de 12x no cartão com vencimento no mês seguinte', () => {
    const cardYearTurn: CreditCard = {
      id: 'card-yt',
      workspace_id: 'ws-1',
      name: 'Itaú',
      institution: 'Itaú',
      credit_limit: 15000,
      closing_day: 25,
      due_day: 5,
      color: '#ff6600',
      active: true,
      created_at: '2026-01-01',
    };

    const split = splitInstallments(1200, 12, '2026-11-28', cardYearTurn, 2);
    expect(split).toHaveLength(12);
    // Parcela 1: Dezembro 2026 (vencimento Jan 2027)
    expect(split[0].referenceMonth).toBe('2026-12');
    expect(split[0].dueDate).toBe('2027-01-05');
    expect(split[0].isPaid).toBe(true);

    // Parcela 2: Janeiro 2027 (vencimento Fev 2027)
    expect(split[1].referenceMonth).toBe('2027-01');
    expect(split[1].dueDate).toBe('2027-02-05');
    expect(split[1].isPaid).toBe(true);

    // Parcela 12: Novembro 2027 (vencimento Dez 2027)
    expect(split[11].referenceMonth).toBe('2027-11');
    expect(split[11].dueDate).toBe('2027-12-05');
    expect(split[11].isPaid).toBe(false);
  });
});

describe('Financial Engine - getAnchoredOccurrenceDate', () => {
  it('deve preservar a âncora do dia 31 ao longo dos meses sem sofrer drift permanente', () => {
    const start = '2026-01-31';
    expect(getAnchoredOccurrenceDate(start, 0)).toBe('2026-01-31');
    expect(getAnchoredOccurrenceDate(start, 1)).toBe('2026-02-28');
    expect(getAnchoredOccurrenceDate(start, 2)).toBe('2026-03-31');
    expect(getAnchoredOccurrenceDate(start, 3)).toBe('2026-04-30');
    expect(getAnchoredOccurrenceDate(start, 4)).toBe('2026-05-31');
    expect(getAnchoredOccurrenceDate(start, 12)).toBe('2027-01-31');

    expect(() => getAnchoredOccurrenceDate('data-invalida', 2)).toThrow('Data de início de recorrência inválida');
    expect(() => getAnchoredOccurrenceDate('', 2)).toThrow('Data inicial de recorrência inválida');
  });
});

describe('Financial Engine - isRecurrenceActiveInMonth', () => {
  it('deve retornar inativo se a recorrência estiver desativada ou fora do intervalo de datas', () => {
    const recInactive: RecurringTransaction = {
      id: 'r1',
      workspace_id: 'ws-1',
      description: 'Inativo',
      amount: 100,
      type: 'expense',
      frequency: 'monthly',
      start_date: '2026-01-01',
      next_occurrence: '2026-01-01',
      auto_create: true,
      active: false,
      created_at: '2026-01-01',
    };
    expect(isRecurrenceActiveInMonth(recInactive, 2026, 8)).toEqual({ active: false, multiplier: 0 });

    const recFuture: RecurringTransaction = {
      ...recInactive,
      active: true,
      start_date: '2026-10-01',
    };
    expect(isRecurrenceActiveInMonth(recFuture, 2026, 8)).toEqual({ active: false, multiplier: 0 });

    const recEnded: RecurringTransaction = {
      ...recInactive,
      active: true,
      start_date: '2026-01-01',
      end_date: '2026-05-15',
    };
    expect(isRecurrenceActiveInMonth(recEnded, 2026, 8)).toEqual({ active: false, multiplier: 0 });
  });

  it('deve validar frequências bimonthly, quarterly, semiannual e annual', () => {
    const base: RecurringTransaction = {
      id: 'r-freq',
      workspace_id: 'ws-1',
      description: 'Freq Test',
      amount: 200,
      type: 'expense',
      frequency: 'bimonthly',
      start_date: '2026-02-10',
      next_occurrence: '2026-02-10',
      auto_create: true,
      active: true,
      created_at: '2026-01-01',
    };

    expect(isRecurrenceActiveInMonth(base, 2026, 2).active).toBe(true);
    expect(isRecurrenceActiveInMonth(base, 2026, 3).active).toBe(false);
    expect(isRecurrenceActiveInMonth(base, 2026, 4).active).toBe(true);

    const quarterly = { ...base, frequency: 'quarterly' as const };
    expect(isRecurrenceActiveInMonth(quarterly, 2026, 2).active).toBe(true);
    expect(isRecurrenceActiveInMonth(quarterly, 2026, 5).active).toBe(true);
    expect(isRecurrenceActiveInMonth(quarterly, 2026, 6).active).toBe(false);

    const semiannual = { ...base, frequency: 'semiannual' as const };
    expect(isRecurrenceActiveInMonth(semiannual, 2026, 2).active).toBe(true);
    expect(isRecurrenceActiveInMonth(semiannual, 2026, 8).active).toBe(true);
    expect(isRecurrenceActiveInMonth(semiannual, 2026, 5).active).toBe(false);

    const annual = { ...base, frequency: 'annual' as const };
    expect(isRecurrenceActiveInMonth(annual, 2026, 2).active).toBe(true);
    expect(isRecurrenceActiveInMonth(annual, 2027, 2).active).toBe(true);
    expect(isRecurrenceActiveInMonth(annual, 2026, 3).active).toBe(false);
  });

  it('deve calcular recorrência customizada por intervalo de dias', () => {
    const customRec: RecurringTransaction = {
      id: 'r-custom',
      workspace_id: 'ws-1',
      description: 'A cada 10 dias',
      amount: 50,
      type: 'expense',
      frequency: 'custom',
      interval_days: 10,
      start_date: '2026-08-01',
      next_occurrence: '2026-08-01',
      auto_create: true,
      active: true,
      created_at: '2026-08-01',
    };

    const check = isRecurrenceActiveInMonth(customRec, 2026, 8);
    expect(check.active).toBe(true);
    expect(check.multiplier).toBe(4);

    // Rejeição estrita de intervalos inválidos
    expect(isRecurrenceActiveInMonth({ ...customRec, interval_days: -5 }, 2026, 8)).toEqual({ active: false, multiplier: 0 });
    expect(isRecurrenceActiveInMonth({ ...customRec, interval_days: 0 }, 2026, 8)).toEqual({ active: false, multiplier: 0 });
    expect(isRecurrenceActiveInMonth({ ...customRec, interval_days: NaN }, 2026, 8)).toEqual({ active: false, multiplier: 0 });
    expect(isRecurrenceActiveInMonth({ ...customRec, interval_days: Infinity }, 2026, 8)).toEqual({ active: false, multiplier: 0 });
    expect(isRecurrenceActiveInMonth({ ...customRec, interval_days: 5.5 }, 2026, 8)).toEqual({ active: false, multiplier: 0 });
    expect(isRecurrenceActiveInMonth({ ...customRec, interval_days: 3651 }, 2026, 8)).toEqual({ active: false, multiplier: 0 });

    expect(isValidCustomInterval(10)).toBe(true);
    expect(isValidCustomInterval(1)).toBe(true);
    expect(isValidCustomInterval(3650)).toBe(true);
    expect(isValidCustomInterval(5.5)).toBe(false);
    expect(isValidCustomInterval(3651)).toBe(false);
    expect(isValidCustomInterval(-5)).toBe(false);
    expect(isValidCustomInterval(0)).toBe(false);
    expect(isValidCustomInterval(NaN)).toBe(false);
    expect(isValidCustomInterval(Infinity)).toBe(false);

    const weeklyEndDate: RecurringTransaction = {
      id: 'r-weekly-end',
      workspace_id: 'ws-1',
      description: 'Semanal Limitado',
      amount: 100,
      type: 'expense',
      frequency: 'weekly',
      start_date: '2026-08-01',
      end_date: '2026-08-10',
      next_occurrence: '2026-08-01',
      auto_create: true,
      active: true,
      created_at: '2026-08-01',
    };
    const checkWeeklyEnd = isRecurrenceActiveInMonth(weeklyEndDate, 2026, 8);
    expect(checkWeeklyEnd.active).toBe(true);
    expect(checkWeeklyEnd.multiplier).toBe(2); // Dias 01 e 08 apenas
  });

  it('deve avançar corretamente ocorrências semanais e customizadas iniciadas em meses anteriores', () => {
    const weeklyOld: RecurringTransaction = {
      id: 'r-w-old',
      workspace_id: 'ws-1',
      description: 'Semanal Antigo',
      amount: 100,
      type: 'expense',
      frequency: 'weekly',
      start_date: '2026-01-01',
      next_occurrence: '2026-08-01',
      auto_create: true,
      active: true,
      created_at: '2026-01-01',
    };

    const customOld: RecurringTransaction = {
      id: 'r-c-old',
      workspace_id: 'ws-1',
      description: 'Custom Antigo',
      amount: 100,
      type: 'expense',
      frequency: 'custom',
      interval_days: 14,
      start_date: '2026-01-01',
      next_occurrence: '2026-08-01',
      auto_create: true,
      active: true,
      created_at: '2026-01-01',
    };

    expect(isRecurrenceActiveInMonth(weeklyOld, 2026, 8).active).toBe(true);
    expect(isRecurrenceActiveInMonth(customOld, 2026, 8).active).toBe(true);
  });

  it('deve respeitar fallback padrão para frequência desconhecida', () => {
    const unknownRec: RecurringTransaction = {
      id: 'r-unk',
      workspace_id: 'ws-1',
      description: 'Unknown',
      amount: 100,
      type: 'expense',
      frequency: 'other' as any,
      start_date: '2026-01-01',
      next_occurrence: '2026-01-01',
      auto_create: true,
      active: true,
      created_at: '2026-01-01',
    };
    expect(isRecurrenceActiveInMonth(unknownRec, 2026, 8)).toEqual({ active: true, multiplier: 1 });
  });
});

describe('Financial Engine - calculateFutureCommitments', () => {
  it('deve projetar compromissos futuros integrando parcelas, faturas, recorrências e transações', () => {
    const bill: CreditCardBill = {
      id: 'bill-1',
      credit_card_id: 'card-1',
      workspace_id: 'ws-1',
      reference_month: '2026-08',
      closing_date: '2026-08-20',
      due_date: '2026-08-28',
      total_amount: 1200,
      paid_amount: 200,
      status: 'partially_paid',
      created_at: '2026-08-01',
    };

    const purchase: Purchase = {
      id: 'pur-1',
      workspace_id: 'ws-1',
      description: 'Notebook',
      total_amount: 3000,
      installment_count: 10,
      purchase_date: '2026-08-01',
      created_at: '2026-08-01',
    };

    const instNonCard: Installment & { purchase: Purchase } = {
      id: 'inst-nc-1',
      purchase_id: 'pur-1',
      installment_number: 1,
      amount: 300,
      due_date: '2026-08-10',
      status: 'pending',
      paid_amount: 0,
      created_at: '2026-08-01',
      purchase,
    };

    const recWeekly: RecurringTransaction = {
      id: 'rec-w',
      workspace_id: 'ws-1',
      description: 'Feira',
      amount: 100,
      type: 'expense',
      frequency: 'weekly',
      start_date: '2026-08-01',
      next_occurrence: '2026-08-01',
      auto_create: true,
      active: true,
      created_at: '2026-08-01',
    };

    const recMonthlyExp: RecurringTransaction = {
      id: 'rec-rent',
      workspace_id: 'ws-1',
      description: 'Aluguel',
      amount: 2000,
      type: 'expense',
      frequency: 'monthly',
      start_date: '2026-08-01',
      next_occurrence: '2026-08-10',
      auto_create: true,
      active: true,
      created_at: '2026-08-01',
    };

    const recIncome: RecurringTransaction = {
      id: 'rec-inc',
      workspace_id: 'ws-1',
      description: 'Salário',
      amount: 7000,
      type: 'income',
      frequency: 'monthly',
      start_date: '2026-01-01',
      next_occurrence: '2026-08-05',
      auto_create: true,
      active: true,
      created_at: '2026-01-01',
    };

    const nonCardTx: Transaction = {
      id: 'tx-1',
      workspace_id: 'ws-1',
      description: 'Energia Elétrica',
      amount: 300,
      type: 'expense',
      transaction_date: '2026-08-01',
      due_date: '2026-08-15',
      status: 'pending',
      created_at: '2026-08-01',
    };

    const incomeTx: Transaction = {
      id: 'tx-extra',
      workspace_id: 'ws-1',
      description: 'Freela',
      amount: 1200,
      type: 'income',
      transaction_date: '2026-08-10',
      due_date: '2026-08-20',
      status: 'pending',
      created_at: '2026-08-10',
    };

    const billOtherMonth: CreditCardBill = {
      id: 'bill-other-month',
      credit_card_id: 'card-1',
      workspace_id: 'ws-1',
      reference_month: '2026-09',
      closing_date: '2026-09-20',
      due_date: '2026-09-28',
      total_amount: 800,
      paid_amount: 0,
      status: 'open',
      created_at: '2026-08-01',
    };

    const result = calculateFutureCommitments(
      [instNonCard],
      [recWeekly, recMonthlyExp, recIncome],
      [nonCardTx, incomeTx],
      1,
      new Date(2026, 7, 1),
      [bill, billOtherMonth]
    );

    expect(result).toHaveLength(1);
    expect(result[0].monthKey).toBe('2026-08');
    expect(result[0].installmentsAmount).toBe(1300);
    expect(result[0].recurringAmount).toBe(2500); // 500 (feira) + 2000 (aluguel 1x)
    expect(result[0].pendingTransactionsAmount).toBe(300);
    expect(result[0].expectedIncome).toBe(8200);
    expect(result[0].totalCommitment).toBe(4100);
    expect(result[0].netForecast).toBe(4100);
  });

  it('deve cobrir branches de filtros de parcelas, faturas, recorrências deduplicadas e transações ignoradas', () => {
    // Parcela paga, parcela cancelada, parcela com fatura de cartão, e parcela sem purchase
    const instPaid: Installment = {
      id: 'i-paid',
      purchase_id: 'p-1',
      installment_number: 1,
      amount: 100,
      due_date: '2026-08-10',
      status: 'paid',
      paid_amount: 100,
      created_at: '2026-08-01',
    };
    const instCancelled: Installment = {
      id: 'i-canc',
      purchase_id: 'p-1',
      installment_number: 2,
      amount: 100,
      due_date: '2026-08-10',
      status: 'cancelled',
      paid_amount: 0,
      created_at: '2026-08-01',
    };
    const instCard: Installment = {
      id: 'i-card',
      purchase_id: 'p-1',
      installment_number: 3,
      amount: 100,
      due_date: '2026-08-10',
      credit_card_bill_id: 'b-1',
      status: 'pending',
      paid_amount: 0,
      created_at: '2026-08-01',
    };
    const instNoPurchase: Installment = {
      id: 'i-nopur',
      purchase_id: 'p-none',
      installment_number: 1,
      amount: 250,
      due_date: '2026-08-10',
      status: 'pending',
      paid_amount: 0,
      created_at: '2026-08-01',
    };
    const instNoDueDate: Installment = {
      id: 'i-nodue',
      purchase_id: 'p-none',
      installment_number: 2,
      amount: 50,
      due_date: '',
      status: 'pending',
      paid_amount: 0,
      created_at: '2026-08-01',
    };

    // Fatura cancelada, paga, e fatura já totalmente paga
    const billCanc: CreditCardBill = {
      id: 'b-canc',
      credit_card_id: 'c-1',
      workspace_id: 'ws-1',
      reference_month: '2026-08',
      closing_date: '2026-08-10',
      due_date: '2026-08-20',
      total_amount: 500,
      paid_amount: 0,
      status: 'cancelled',
      created_at: '2026-08-01',
    };
    const billPaid: CreditCardBill = {
      id: 'b-paid',
      credit_card_id: 'c-1',
      workspace_id: 'ws-1',
      reference_month: '2026-08',
      closing_date: '2026-08-10',
      due_date: '2026-08-20',
      total_amount: 500,
      paid_amount: 500,
      status: 'paid',
      created_at: '2026-08-01',
    };
    const billZeroRem: CreditCardBill = {
      id: 'b-zerorem',
      credit_card_id: 'c-1',
      workspace_id: 'ws-1',
      reference_month: '2026-08',
      closing_date: '2026-08-10',
      due_date: '2026-08-20',
      total_amount: 300,
      paid_amount: 300,
      status: 'open',
      created_at: '2026-08-01',
    };

    // Recorrência totalmente materializada e transação de recorrência cancelada
    const recFull: RecurringTransaction = {
      id: 'r-full',
      workspace_id: 'ws-1',
      description: 'Plano',
      amount: 150,
      type: 'expense',
      frequency: 'monthly',
      start_date: '2026-08-01',
      next_occurrence: '2026-08-01',
      auto_create: true,
      active: true,
      created_at: '2026-08-01',
    };
    const txMaterialized: Transaction = {
      id: 'tx-mat',
      workspace_id: 'ws-1',
      recurring_transaction_id: 'r-full',
      description: 'Plano Pago',
      amount: 150,
      type: 'expense',
      transaction_date: '2026-08-01',
      due_date: '2026-08-01',
      status: 'paid',
      created_at: '2026-08-01',
    };
    const txCancelledRec: Transaction = {
      id: 'tx-canc-rec',
      workspace_id: 'ws-1',
      recurring_transaction_id: 'r-full',
      description: 'Cancelado Rec',
      amount: 150,
      type: 'expense',
      transaction_date: '2026-08-01',
      due_date: '2026-08-01',
      status: 'cancelled',
      created_at: '2026-08-01',
    };

    // Transação paga, cancelada, de cartão, e sem due_date
    const txPaid: Transaction = {
      id: 'tx-p',
      workspace_id: 'ws-1',
      description: 'Paga',
      amount: 50,
      type: 'expense',
      transaction_date: '2026-08-01',
      due_date: '2026-08-01',
      status: 'paid',
      created_at: '2026-08-01',
    };
    const txCanc: Transaction = {
      id: 'tx-c',
      workspace_id: 'ws-1',
      description: 'Canc',
      amount: 50,
      type: 'expense',
      transaction_date: '2026-08-01',
      due_date: '2026-08-01',
      status: 'cancelled',
      created_at: '2026-08-01',
    };
    const txCard: Transaction = {
      id: 'tx-card',
      workspace_id: 'ws-1',
      credit_card_id: 'c-1',
      description: 'Card',
      amount: 50,
      type: 'expense',
      transaction_date: '2026-08-01',
      due_date: '2026-08-01',
      status: 'pending',
      created_at: '2026-08-01',
    };
    const txNoDueDate: Transaction = {
      id: 'tx-nodue',
      workspace_id: 'ws-1',
      description: 'Sem Due Date',
      amount: 120,
      type: 'expense',
      transaction_date: '2026-08-05',
      due_date: '' as any,
      status: 'pending',
      created_at: '2026-08-05',
    };

    const res = calculateFutureCommitments(
      [instPaid, instCancelled, instCard, instNoPurchase, instNoDueDate],
      [recFull],
      [txMaterialized, txCancelledRec, txPaid, txCanc, txCard, txNoDueDate],
      1,
      new Date(2026, 7, 1),
      [billCanc, billPaid, billZeroRem]
    );

    expect(res).toHaveLength(1);
    expect(res[0].installmentsAmount).toBe(250); // instNoPurchase
    expect(res[0].pendingTransactionsAmount).toBe(120); // txNoDueDate
    expect(res[0].recurringAmount).toBe(0); // Totalmente materializada
  });
});

describe('Financial Engine - calculateDashboardSummary', () => {
  it('deve calcular visão realizada via pagamentos e prevista via faturas e obrigações', () => {
    const bill: CreditCardBill = {
      id: 'b1',
      credit_card_id: 'c1',
      workspace_id: 'ws-1',
      reference_month: '2026-08',
      closing_date: '2026-08-20',
      due_date: '2026-08-28',
      total_amount: 1500,
      paid_amount: 500,
      status: 'partially_paid',
      created_at: '2026-08-01',
    };

    const txIncome: Transaction = {
      id: 'tx-sal',
      workspace_id: 'ws-1',
      description: 'Salário',
      amount: 8000,
      type: 'income',
      transaction_date: '2026-08-05',
      due_date: '2026-08-05',
      status: 'paid',
      paid_amount: 8000,
      created_at: '2026-08-05',
    };

    const txExpense: Transaction = {
      id: 'tx-exp-1',
      workspace_id: 'ws-1',
      description: 'Luz',
      amount: 200,
      type: 'expense',
      transaction_date: '2026-08-05',
      due_date: '2026-08-05',
      status: 'paid',
      paid_amount: 200,
      created_at: '2026-08-05',
    };

    const payment1: Payment = {
      id: 'p1',
      workspace_id: 'ws-1',
      transaction_id: 'tx-sal',
      account_id: 'acc-1',
      amount: 8000,
      payment_date: '2026-08-05',
      created_at: '2026-08-05',
    };

    const payment2: Payment = {
      id: 'p2',
      workspace_id: 'ws-1',
      credit_card_bill_id: 'b1',
      account_id: 'acc-1',
      amount: 500,
      payment_date: '2026-08-10',
      created_at: '2026-08-10',
    };

    const payment3: Payment = {
      id: 'p3',
      workspace_id: 'ws-1',
      transaction_id: 'tx-exp-1',
      account_id: 'acc-1',
      amount: 200,
      payment_date: '2026-08-12',
      created_at: '2026-08-12',
    };

    // Pagamento em outro mês e pagamento sem transação encontrada
    const paymentOtherMonth: Payment = {
      id: 'p-other',
      workspace_id: 'ws-1',
      account_id: 'acc-1',
      amount: 300,
      payment_date: '2026-05-10',
      created_at: '2026-05-10',
    };
    const paymentOrphanTx: Payment = {
      id: 'p-orph',
      workspace_id: 'ws-1',
      transaction_id: 'tx-nao-existe',
      account_id: 'acc-1',
      amount: 100,
      payment_date: '2026-08-15',
      created_at: '2026-08-15',
    };

    const summary = calculateDashboardSummary(
      [txIncome, txExpense],
      [],
      [],
      [{ current_balance: 12500 }, { current_balance: 0 }],
      [payment1, payment2, payment3, paymentOtherMonth, paymentOrphanTx],
      '2026-08',
      [bill],
      '2026-08-20'
    );

    expect(summary.totalBalance).toBe(12500);
    expect(summary.realized.income).toBe(8000);
    expect(summary.realized.expense).toBe(800); // 500 bill + 200 tx + 100 orphan
    expect(summary.realized.net).toBe(7200);

    expect(summary.planned.income).toBe(8000);
    expect(summary.planned.expense).toBe(1700);
    expect(summary.pending.amount).toBe(1000);
    expect(summary.pending.count).toBe(1);
  });

  it('deve usar fallback para transações pagas quando não houver registros em payments', () => {
    const txPaidExp: Transaction = {
      id: 'tx-p-exp',
      workspace_id: 'ws-1',
      description: 'Mercado',
      amount: 250,
      type: 'expense',
      transaction_date: '2026-08-02',
      due_date: '2026-08-02',
      paid_at: '2026-08-02',
      status: 'paid',
      created_at: '2026-08-02',
    };

    const txPaidInc: Transaction = {
      id: 'tx-p-inc',
      workspace_id: 'ws-1',
      description: 'Salário Pago',
      amount: 4000,
      type: 'income',
      transaction_date: '2026-08-01',
      due_date: '2026-08-01',
      paid_at: '2026-08-01',
      status: 'paid',
      created_at: '2026-08-01',
    };

    const txPartExp: Transaction = {
      id: 'tx-part-exp',
      workspace_id: 'ws-1',
      description: 'Dentista',
      amount: 500,
      paid_amount: 150,
      type: 'expense',
      transaction_date: '2026-08-04',
      due_date: '2026-08-04',
      paid_at: '2026-08-04',
      status: 'partially_paid',
      created_at: '2026-08-04',
    };

    const txPartInc: Transaction = {
      id: 'tx-part-inc',
      workspace_id: 'ws-1',
      description: 'Venda',
      amount: 1000,
      paid_amount: 600,
      type: 'income',
      transaction_date: '2026-08-03',
      due_date: '2026-08-03',
      paid_at: '2026-08-03',
      status: 'partially_paid',
      created_at: '2026-08-03',
    };

    const txPartExpZero: Transaction = {
      id: 'tx-part-exp-zero',
      workspace_id: 'ws-1',
      description: 'Consulta',
      amount: 300,
      type: 'expense',
      transaction_date: '2026-08-05',
      due_date: '2026-08-05',
      paid_at: '2026-08-05',
      status: 'partially_paid',
      created_at: '2026-08-05',
    };

    const txPartIncZero: Transaction = {
      id: 'tx-part-inc-zero',
      workspace_id: 'ws-1',
      description: 'Bônus',
      amount: 800,
      type: 'income',
      transaction_date: '2026-08-05',
      due_date: '2026-08-05',
      paid_at: '2026-08-05',
      status: 'partially_paid',
      created_at: '2026-08-05',
    };

    const txCanc: Transaction = {
      id: 'tx-canc-fb',
      workspace_id: 'ws-1',
      description: 'Cancelado FB',
      amount: 500,
      type: 'expense',
      transaction_date: '2026-08-01',
      due_date: '2026-08-01',
      status: 'cancelled',
      created_at: '2026-08-01',
    };

    const txOtherMonth: Transaction = {
      id: 'tx-other-m',
      workspace_id: 'ws-1',
      description: 'Outro Mês',
      amount: 100,
      type: 'expense',
      transaction_date: '2026-01-01',
      due_date: '2026-01-01',
      status: 'paid',
      created_at: '2026-01-01',
    };

    const zeroRemainingBill: CreditCardBill = {
      id: 'b-zero-rem',
      credit_card_id: 'c-1',
      workspace_id: 'ws-1',
      reference_month: '2026-08',
      closing_date: '2026-08-10',
      due_date: '2026-08-20',
      total_amount: 0,
      paid_amount: 0,
      status: 'open',
      created_at: '2026-08-01',
    };

    const summary = calculateDashboardSummary(
      [txPaidExp, txPaidInc, txPartExp, txPartInc, txPartExpZero, txPartIncZero, txCanc, txOtherMonth],
      [],
      [],
      [{ current_balance: 3000 }],
      [],
      '2026-08',
      [zeroRemainingBill]
    );

    expect(summary.realized.expense).toBe(400); // 250 + 150 + 0
    expect(summary.realized.income).toBe(4600); // 4000 + 600 + 0
    expect(summary.realized.net).toBe(4200);
  });

  it('deve contabilizar a fatura paga no Caixa Realizado sem duplicar suas transações pagas no fallback', () => {
    const cardTx1: Transaction = {
      id: 'tx-c1',
      workspace_id: 'ws-1',
      credit_card_id: 'card-1',
      credit_card_bill_id: 'bill-1',
      description: 'Compra Cartão 1',
      amount: 600,
      type: 'expense',
      transaction_date: '2026-08-01',
      due_date: '2026-08-10',
      status: 'paid',
      paid_amount: 600,
      paid_at: '2026-08-10',
      created_at: '2026-08-01',
    };

    const cardTx2: Transaction = {
      id: 'tx-c2',
      workspace_id: 'ws-1',
      credit_card_id: 'card-1',
      credit_card_bill_id: 'bill-1',
      description: 'Compra Cartão 2',
      amount: 400,
      type: 'expense',
      transaction_date: '2026-08-05',
      due_date: '2026-08-10',
      status: 'paid',
      paid_amount: 400,
      paid_at: '2026-08-10',
      created_at: '2026-08-05',
    };

    const bill: CreditCardBill = {
      id: 'bill-1',
      credit_card_id: 'card-1',
      workspace_id: 'ws-1',
      reference_month: '2026-08',
      closing_date: '2026-08-05',
      due_date: '2026-08-10',
      total_amount: 1000,
      paid_amount: 1000,
      status: 'paid',
      paid_at: '2026-08-10',
      created_at: '2026-08-01',
    };

    const billPayment: Payment = {
      id: 'pay-bill-1',
      workspace_id: 'ws-1',
      credit_card_bill_id: 'bill-1',
      account_id: 'acc-1',
      amount: 1000,
      payment_date: '2026-08-10',
      created_at: '2026-08-10',
    };

    const summary = calculateDashboardSummary(
      [cardTx1, cardTx2],
      [],
      [],
      [{ current_balance: 5000 }],
      [billPayment],
      '2026-08',
      [bill]
    );

    // O valor realizado deve ser exatamente 1000 da fatura, e NUNCA 2000 (1000 fatura + 1000 itens)
    expect(summary.realized.expense).toBe(1000);
    expect(summary.realized.net).toBe(-1000);
    expect(summary.planned.expense).toBe(1000);
  });

  it('deve calcular obrigações vencidas (overdue) e pendências de parcelas e recorrências', () => {
    const overdueTx: Transaction = {
      id: 'tx-overdue',
      workspace_id: 'ws-1',
      description: 'Conta Vencida',
      amount: 400,
      type: 'expense',
      transaction_date: '2026-01-01',
      due_date: '2026-01-05',
      status: 'pending',
      created_at: '2026-01-01',
    };

    const overdueInst: Installment = {
      id: 'inst-overdue',
      purchase_id: 'pur-1',
      installment_number: 1,
      amount: 200,
      due_date: '2026-01-10',
      status: 'pending',
      paid_amount: 0,
      created_at: '2026-01-01',
    };

    const futureInst: Installment = {
      id: 'inst-future',
      purchase_id: 'pur-2',
      installment_number: 2,
      amount: 350,
      due_date: '2026-08-30',
      status: 'pending',
      paid_amount: 0,
      created_at: '2026-08-01',
    };

    const recInc: RecurringTransaction = {
      id: 'r-inc',
      workspace_id: 'ws-1',
      description: 'Renda',
      amount: 5000,
      type: 'income',
      frequency: 'monthly',
      start_date: '2026-01-01',
      next_occurrence: '2026-08-01',
      auto_create: true,
      active: true,
      created_at: '2026-01-01',
    };

    const recExp: RecurringTransaction = {
      id: 'r-exp',
      workspace_id: 'ws-1',
      description: 'Condomínio',
      amount: 800,
      type: 'expense',
      frequency: 'monthly',
      start_date: '2026-01-01',
      next_occurrence: '2026-08-10',
      auto_create: true,
      active: true,
      created_at: '2026-01-01',
    };

    const futureTx: Transaction = {
      id: 'tx-future',
      workspace_id: 'ws-1',
      description: 'Conta Futura',
      amount: 150,
      type: 'expense',
      transaction_date: '2026-08-01',
      due_date: '2026-08-30',
      status: 'pending',
      created_at: '2026-08-01',
    };

    const overdueBill: CreditCardBill = {
      id: 'bill-overdue',
      credit_card_id: 'card-1',
      workspace_id: 'ws-1',
      reference_month: '2026-01',
      closing_date: '2026-01-05',
      due_date: '2026-01-10',
      total_amount: 500,
      paid_amount: 0,
      status: 'open',
      created_at: '2026-01-01',
    };

    const summary = calculateDashboardSummary(
      [overdueTx, futureTx],
      [overdueInst, futureInst],
      [recInc, recExp],
      [{ current_balance: 1000 }],
      [],
      '2026-08',
      [overdueBill],
      '2026-08-20'
    );

    expect(summary.overdue.count).toBe(3);
    expect(summary.overdue.amount).toBe(1100);
    expect(summary.pending.count).toBe(2);
    expect(summary.pending.amount).toBe(500);
    expect(summary.planned.income).toBe(5000);
    expect(summary.planned.expense).toBe(1300);
  });

  it('deve cobrir branches de parcelas canceladas/cartão/pagas e recorrências inativas/materializadas no Dashboard', () => {
    const instCanc: Installment = {
      id: 'i-canc',
      purchase_id: 'p-1',
      installment_number: 1,
      amount: 100,
      due_date: '2026-08-10',
      status: 'cancelled',
      paid_amount: 0,
      created_at: '2026-08-01',
    };

    const instCard: Installment = {
      id: 'i-card',
      purchase_id: 'p-1',
      installment_number: 2,
      amount: 100,
      due_date: '2026-08-10',
      credit_card_bill_id: 'b-1',
      status: 'pending',
      paid_amount: 0,
      created_at: '2026-08-01',
    };

    const instPaid: Installment = {
      id: 'i-paid',
      purchase_id: 'p-1',
      installment_number: 3,
      amount: 100,
      due_date: '2026-08-10',
      status: 'paid',
      paid_amount: 100,
      created_at: '2026-08-01',
    };

    const instOtherMonth: Installment = {
      id: 'i-other',
      purchase_id: 'p-1',
      installment_number: 4,
      amount: 100,
      due_date: '2026-11-10',
      status: 'pending',
      paid_amount: 0,
      created_at: '2026-08-01',
    };

    const recInactive: RecurringTransaction = {
      id: 'r-inact',
      workspace_id: 'ws-1',
      description: 'Inativo',
      amount: 100,
      type: 'expense',
      frequency: 'monthly',
      start_date: '2026-08-01',
      next_occurrence: '2026-08-01',
      auto_create: true,
      active: false,
      created_at: '2026-08-01',
    };

    const recFullyMaterialized: RecurringTransaction = {
      id: 'r-mat',
      workspace_id: 'ws-1',
      description: 'Materializado',
      amount: 200,
      type: 'expense',
      frequency: 'monthly',
      start_date: '2026-08-01',
      next_occurrence: '2026-08-01',
      auto_create: true,
      active: true,
      created_at: '2026-08-01',
    };

    const txMat: Transaction = {
      id: 't-mat',
      workspace_id: 'ws-1',
      recurring_transaction_id: 'r-mat',
      description: 'Tx Mat',
      amount: 200,
      type: 'expense',
      transaction_date: '2026-08-01',
      due_date: '2026-08-01',
      status: 'paid',
      created_at: '2026-08-01',
    };

    const txCancRec: Transaction = {
      id: 't-canc-rec',
      workspace_id: 'ws-1',
      recurring_transaction_id: 'r-mat',
      description: 'Tx Canc Rec',
      amount: 200,
      type: 'expense',
      transaction_date: '2026-08-01',
      due_date: '2026-08-01',
      status: 'cancelled',
      created_at: '2026-08-01',
    };

    const billCanc: CreditCardBill = {
      id: 'b-canc-dash',
      credit_card_id: 'c-1',
      workspace_id: 'ws-1',
      reference_month: '2026-08',
      closing_date: '2026-08-10',
      due_date: '2026-08-20',
      total_amount: 500,
      paid_amount: 0,
      status: 'cancelled',
      created_at: '2026-08-01',
    };

    const billClosedOtherMonth: CreditCardBill = {
      id: 'b-closed-other',
      credit_card_id: 'c-1',
      workspace_id: 'ws-1',
      reference_month: '2026-09',
      closing_date: '2026-09-10',
      due_date: '2026-09-20',
      total_amount: 500,
      paid_amount: 500,
      status: 'closed',
      created_at: '2026-08-01',
    };

    const summary = calculateDashboardSummary(
      [txMat, txCancRec],
      [instCanc, instCard, instPaid, instOtherMonth],
      [recInactive, recFullyMaterialized],
      [{ current_balance: 5000 }],
      [],
      '2026-08',
      [billCanc, billClosedOtherMonth]
    );

    expect(summary.totalBalance).toBe(5000);
    expect(summary.planned.expense).toBe(300); // txMat (200) + instPaid (100)
    expect(summary.pending.count).toBe(1); // instOtherMonth futura
  });
});

describe('Financial Engine - Resolução Canônica de Categorias e Subcategorias (resolveCategory)', () => {
  const sampleCategories: Category[] = [
    {
      id: 'cat-alimentacao',
      workspace_id: 'ws-1',
      name: 'Alimentação',
      icon: 'Utensils',
      color: '#f59e0b',
      type: 'expense',
      active: true,
      created_at: '2026-08-01',
      subcategories: [
        {
          id: 'sub-restaurante',
          workspace_id: 'ws-1',
          name: 'Restaurante',
          icon: 'Coffee',
          color: '#f59e0b',
          type: 'expense',
          active: true,
          parent_id: 'cat-alimentacao',
          created_at: '2026-08-01',
        },
        {
          id: 'sub-mercado',
          workspace_id: 'ws-1',
          name: 'Supermercado',
          icon: 'ShoppingBag',
          color: '#f59e0b',
          type: 'expense',
          active: true,
          parent_id: 'cat-alimentacao',
          created_at: '2026-08-01',
        },
      ],
    },
    {
      id: 'cat-moradia',
      workspace_id: 'ws-1',
      name: 'Moradia',
      icon: 'Home',
      color: '#3b82f6',
      type: 'expense',
      active: true,
      created_at: '2026-08-01',
    },
  ];

  it('deve resolver categoria raiz corretamente', () => {
    const res = resolveCategory(sampleCategories, 'cat-moradia');
    expect(res.isFound).toBe(true);
    expect(res.displayName).toBe('Moradia');
    expect(res.rootId).toBe('cat-moradia');
    expect(res.rootCategory?.id).toBe('cat-moradia');
  });

  it('deve resolver subcategoria com nome composto e mapear para a categoria raiz', () => {
    const res = resolveCategory(sampleCategories, 'sub-restaurante');
    expect(res.isFound).toBe(true);
    expect(res.displayName).toBe('Alimentação > Restaurante');
    expect(res.rootId).toBe('cat-alimentacao');
    expect(res.rootCategory?.id).toBe('cat-alimentacao');
  });

  it('deve retornar Sem Categoria para IDs nulos, indefinidos ou inexistentes', () => {
    expect(resolveCategory(sampleCategories, undefined)).toEqual({
      isFound: false,
      displayName: 'Sem Categoria',
      rootId: undefined,
    });
    expect(resolveCategory(sampleCategories, null)).toEqual({
      isFound: false,
      displayName: 'Sem Categoria',
      rootId: undefined,
    });
    expect(resolveCategory(sampleCategories, 'cat-inexistente')).toEqual({
      isFound: false,
      displayName: 'Sem Categoria',
      rootId: undefined,
    });
  });
});

describe('Financial Engine - Distribuição Exata de Percentuais (Largest Remainder Method)', () => {
  it('deve fechar a soma em exatamente 100% no caso clássico de três partes iguais (1/3 + 1/3 + 1/3)', () => {
    const items = [
      { id: 'item-1', amount: 100 },
      { id: 'item-2', amount: 100 },
      { id: 'item-3', amount: 100 },
    ];
    const total = 300;
    const res = calculateIntegerPercentages(items, total);

    const p1 = res.get('item-1')!;
    const p2 = res.get('item-2')!;
    const p3 = res.get('item-3')!;

    expect(p1 + p2 + p3).toBe(100);
    expect([p1, p2, p3].sort()).toEqual([33, 33, 34]);
  });

  it('deve distribuir percentuais proporcionais em dízimas e múltiplos itens', () => {
    const items = [
      { id: 'a', amount: 70 },
      { id: 'b', amount: 20 },
      { id: 'c', amount: 10 },
    ];
    const res = calculateIntegerPercentages(items, 100);
    expect(res.get('a')).toBe(70);
    expect(res.get('b')).toBe(20);
    expect(res.get('c')).toBe(10);
    expect(res.get('a')! + res.get('b')! + res.get('c')!).toBe(100);
  });

  it('deve retornar 0 para todos os itens quando o totalAmount for zero ou negativo', () => {
    const items = [
      { id: 'a', amount: 0 },
      { id: 'b', amount: 0 },
    ];
    const res = calculateIntegerPercentages(items, 0);
    expect(res.get('a')).toBe(0);
    expect(res.get('b')).toBe(0);

    const resNeg = calculateIntegerPercentages([{ id: 'a', amount: 50 }], -100);
    expect(resNeg.get('a')).toBe(0);
  });

  it('deve lidar com lista vazia sem quebrar', () => {
    const res = calculateIntegerPercentages([], 100);
    expect(res.size).toBe(0);
  });

  it('deve distribuir saldo restante quando itens somam menos que o total com restos zero', () => {
    const items = [
      { id: 'a', amount: 50 },
      { id: 'b', amount: 0 },
    ];
    const res = calculateIntegerPercentages(items, 100);
    expect(res.get('a')).toBe(100);
    expect(res.get('b')).toBe(0);
  });

  it('deve normalizar proporcionalmente quando a soma das fatias divergir do total informado', () => {
    // Caso da auditoria: 60 + 60 com total 100 deve normalizar para 50% e 50% (soma 100%)
    const items = [
      { id: 'item-1', amount: 60 },
      { id: 'item-2', amount: 60 },
    ];
    const res = calculateIntegerPercentages(items, 100);
    expect(res.get('item-1')).toBe(50);
    expect(res.get('item-2')).toBe(50);
    expect(res.get('item-1')! + res.get('item-2')!).toBe(100);
  });

  it('deve tratar com segurança valores NaN, Infinity, negativos e centavos residuais', () => {
    const items = [
      { id: 'a', amount: 100 },
      { id: 'b', amount: -20 },
      { id: 'c', amount: NaN },
      { id: 'd', amount: Infinity },
    ];
    const res = calculateIntegerPercentages(items, 100);
    expect(res.get('a')).toBe(100);
    expect(res.get('b')).toBe(0);
    expect(res.get('c')).toBe(0);
    expect(res.get('d')).toBe(0);
    expect(res.get('a')! + res.get('b')! + res.get('c')! + res.get('d')!).toBe(100);
  });
});
