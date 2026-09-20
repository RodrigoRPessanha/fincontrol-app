import { describe, it, expect } from 'vitest';
import {
  calculateFutureCommitments,
  calculateDashboardSummary
} from '../../financial-engine';
import { Account, Category, CreditCard, CreditCardBill, Installment, Payment, Purchase, RecurringTransaction, Transaction, Settlement, WorkspaceMember } from '../../types';

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

  it('deve cobrir branches de transação e parcela sem due_date e fatura com remainingCents zero', () => {
    const txNoDueDate: Transaction = {
      id: 'tx-no-due',
      workspace_id: 'ws-1',
      description: 'Sem due date',
      amount: 150,
      type: 'expense',
      transaction_date: '2026-08-10',
      due_date: undefined as any,
      status: 'pending',
      created_at: '2026-08-01',
    };

    const instNoDueDate: Installment = {
      id: 'inst-no-due',
      purchase_id: 'pur-1',
      installment_number: 1,
      amount: 80,
      due_date: undefined as any,
      status: 'pending',
      paid_amount: 0,
      created_at: '2026-08-01',
    };

    const zeroRemainingBill: CreditCardBill = {
      id: 'bill-zero-rem-2',
      credit_card_id: 'card-1',
      workspace_id: 'ws-1',
      reference_month: '2026-08',
      closing_date: '2026-08-05',
      due_date: '2026-08-10',
      total_amount: 500,
      paid_amount: 500,
      status: 'open',
      created_at: '2026-08-01',
    };

    const summary = calculateDashboardSummary(
      [txNoDueDate],
      [instNoDueDate],
      [],
      [{ current_balance: 1000 }],
      [],
      '2026-08',
      [zeroRemainingBill],
      '2026-08-20'
    );

    expect(summary.planned.expense).toBe(650); // 500 (fatura) + 150 (transação)
    expect(summary.pending.count).toBe(2);
  });

  it('deve cobrir faturas com paid_amount indefinido e recorrência inativa em calculateFutureCommitments', () => {
    const unpaidBill: CreditCardBill = {
      id: 'bill-unpaid-no-prop',
      credit_card_id: 'card-1',
      workspace_id: 'ws-1',
      reference_month: '2026-08',
      closing_date: '2026-08-05',
      due_date: '2026-08-10',
      total_amount: 450,
      paid_amount: undefined as any,
      status: 'open',
      created_at: '2026-08-01',
    };

    const inactiveRec: RecurringTransaction = {
      id: 'rec-inactive',
      workspace_id: 'ws-1',
      description: 'Academia Inativa',
      amount: 120,
      type: 'expense',
      frequency: 'monthly',
      start_date: '2026-01-01',
      end_date: '2026-06-01',
      next_occurrence: '2026-06-01',
      auto_create: false,
      active: false,
      created_at: '2026-01-01',
    };

    const result = calculateFutureCommitments([], [inactiveRec], [], 1, new Date(2026, 7, 1), [unpaidBill]);

    expect(result[0].installmentsAmount).toBe(450);
    expect(result[0].recurringAmount).toBe(0);
    expect(result[0].items.some((i) => i.title.includes('Fatura Cartão'))).toBe(true);
  });
});

