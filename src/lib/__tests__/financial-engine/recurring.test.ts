import { describe, it, expect } from 'vitest';
import {
  getAnchoredOccurrenceDate,
  isRecurrenceActiveInMonth,
  isValidCustomInterval,
  validateRecurringMaterialization,
  stepNextOccurrence,
  processRecurringBatchState,
} from '../../financial-engine';
import { Account, Category, CreditCard, CreditCardBill, Installment, Payment, Purchase, RecurringTransaction, Transaction, Settlement, WorkspaceMember, PaymentMethod } from '../../types';

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

describe('Financial Engine - Validação de Materialização de Recorrência (validateRecurringMaterialization)', () => {
  const accounts: Account[] = [
    { id: 'acc-active', workspace_id: 'ws-1', name: 'Conta Ativa', type: 'checking', institution: 'Banco', initial_balance: 0, current_balance: 0, color: '#000', active: true, created_at: '2026-01-01' },
    { id: 'acc-inactive', workspace_id: 'ws-1', name: 'Conta Inativa', type: 'checking', institution: 'Banco', initial_balance: 0, current_balance: 0, color: '#000', active: false, created_at: '2026-01-01' },
  ];

  const categories: Category[] = [
    { id: 'cat-1', workspace_id: 'ws-1', name: 'Geral', icon: 'Tag', color: '#000', type: 'expense', active: true, created_at: '2026-01-01' },
  ];

  it('deve rejeitar materialização quando a conta associada não existir no workspace', () => {
    const rec: RecurringTransaction = {
      id: 'rec-1',
      workspace_id: 'ws-1',
      account_id: 'acc-inexistente',
      description: 'Assinatura',
      amount: 50,
      type: 'expense',
      frequency: 'monthly',
      start_date: '2026-01-01',
      next_occurrence: '2026-08-01',
      auto_create: true,
      active: true,
      created_at: '2026-01-01',
    };
    const res = validateRecurringMaterialization(rec, accounts, [], [], categories, 'ws-1');
    expect(res.isValid).toBe(false);
    expect(res.reason).toBe('Conta bancária associada não encontrada no workspace.');
  });

  it('deve rejeitar materialização quando a conta associada estiver inativa', () => {
    const rec: RecurringTransaction = {
      id: 'rec-2',
      workspace_id: 'ws-1',
      account_id: 'acc-inactive',
      description: 'Assinatura',
      amount: 50,
      type: 'expense',
      frequency: 'monthly',
      start_date: '2026-01-01',
      next_occurrence: '2026-08-01',
      auto_create: true,
      active: true,
      created_at: '2026-01-01',
    };
    const res = validateRecurringMaterialization(rec, accounts, [], [], categories, 'ws-1');
    expect(res.isValid).toBe(false);
    expect(res.reason).toBe('Conta bancária vinculada está inativa.');
  });
});

describe('Financial Engine - Cálculo de Próxima Ocorrência (stepNextOccurrence)', () => {
  it('deve avançar corretamente frequência customizada com intervalo válido', () => {
    const next = stepNextOccurrence('2026-08-01', '2026-08-01', 'custom', 15);
    expect(next).toBe('2026-08-16');
  });

  it('deve lançar erro se o intervalo da frequência customizada for inválido', () => {
    expect(() => stepNextOccurrence('2026-08-01', '2026-08-01', 'custom', -5)).toThrow(
      'Intervalo em dias inválido para recorrência personalizada'
    );
    expect(() => stepNextOccurrence('2026-08-01', '2026-08-01', 'custom', 5000)).toThrow(
      'Intervalo em dias inválido para recorrência personalizada'
    );
  });
});

describe('Financial Engine - Materialização Completa de Recorrências (materializePendingRecurring)', () => {
  const accounts: Account[] = [
    { id: 'acc-1', workspace_id: 'ws-1', name: 'Conta Corrente', type: 'checking', institution: 'Banco', initial_balance: 1000, current_balance: 1000, color: '#000', active: true, created_at: '2026-01-01' },
  ];

  const cards: CreditCard[] = [
    { id: 'card-1', workspace_id: 'ws-1', name: 'Nubank', institution: 'Nubank', credit_limit: 5000, closing_day: 5, due_day: 12, color: '#8b5cf6', active: true, created_at: '2026-01-01' },
  ];

  const paymentMethods: PaymentMethod[] = [
    { id: 'pm-card', workspace_id: 'ws-1', name: 'Cartão de Crédito', type: 'credit_card', credit_card_id: 'card-1', active: true, created_at: '2026-01-01' },
  ];

  const categories: Category[] = [
    { id: 'cat-1', workspace_id: 'ws-1', name: 'Assinaturas', icon: 'Tv', color: '#000', type: 'expense', active: true, created_at: '2026-01-01' },
  ];

  it('deve materializar recorrência vinculada a cartão de crédito gerando fatura correspondente', () => {
    const recCard: RecurringTransaction = {
      id: 'rec-card-1',
      workspace_id: 'ws-1',
      description: 'Streaming no Cartão',
      amount: 45.90,
      type: 'expense',
      category_id: 'cat-1',
      payment_method_id: 'pm-card',
      frequency: 'monthly',
      start_date: '2026-08-01',
      next_occurrence: '2026-08-01',
      auto_create: true,
      active: true,
      created_at: '2026-08-01',
    };

    const res = processRecurringBatchState({
      recurring: [recCard],
      accounts,
      paymentMethods,
      creditCards: cards,
      categories,
      transactions: [],
      bills: [],
      todayStr: '2026-08-05',
    });

    expect(res.hasChanges).toBe(true);
    expect(res.newTransactions).toHaveLength(1);
    expect(res.newTransactions[0].credit_card_id).toBe('card-1');
    expect(res.newTransactions[0].credit_card_bill_id).toBeDefined();
    expect(res.updatedBills).toHaveLength(1);
    expect(res.updatedBills[0].total_amount).toBe(45.9);
  });

  it('deve respeitar end_date e desativar série ao atingir a data final ou se next_occurrence for retroativo', () => {
    // 1. Desativação prévia por next_occurrence > end_date (linhas 416-419)
    const recExpired: RecurringTransaction = {
      id: 'rec-exp',
      workspace_id: 'ws-1',
      description: 'Plano Expirado',
      amount: 100,
      type: 'expense',
      category_id: 'cat-1',
      frequency: 'monthly',
      start_date: '2026-01-01',
      end_date: '2026-05-01',
      next_occurrence: '2026-06-01',
      auto_create: true,
      active: true,
      created_at: '2026-01-01',
    };

    const resExp = processRecurringBatchState({
      recurring: [recExpired],
      accounts,
      paymentMethods: [],
      creditCards: [],
      categories,
      transactions: [],
      bills: [],
      todayStr: '2026-08-01',
    });
    expect(resExp.updatedRecurring[0].active).toBe(false);

    // 2. Desativação no loop ao ultrapassar end_date (linhas 509-513)
    const recEnding: RecurringTransaction = {
      id: 'rec-ending',
      workspace_id: 'ws-1',
      description: 'Curso 2 Meses',
      amount: 200,
      type: 'expense',
      category_id: 'cat-1',
      account_id: 'acc-1',
      frequency: 'monthly',
      start_date: '2026-07-01',
      end_date: '2026-08-05',
      next_occurrence: '2026-08-01',
      auto_create: true,
      active: true,
      created_at: '2026-07-01',
    };

    const resEnding = processRecurringBatchState({
      recurring: [recEnding],
      accounts,
      paymentMethods: [],
      creditCards: [],
      categories,
      transactions: [],
      bills: [],
      todayStr: '2026-08-10',
    });
    expect(resEnding.updatedRecurring[0].active).toBe(false);
  });

  it('não deve duplicar transações quando itemKey já tiver sido processado', () => {
    const recMonthly: RecurringTransaction = {
      id: 'rec-dup-check',
      workspace_id: 'ws-1',
      description: 'Aluguel Já Criado',
      amount: 1500,
      type: 'expense',
      category_id: 'cat-1',
      account_id: 'acc-1',
      frequency: 'monthly',
      start_date: '2026-08-01',
      next_occurrence: '2026-08-01',
      auto_create: true,
      active: true,
      created_at: '2026-08-01',
    };

    const existingTx: Transaction = {
      id: 'tx-dup-1',
      workspace_id: 'ws-1',
      recurring_transaction_id: 'rec-dup-check',
      description: 'Aluguel Já Criado',
      amount: 1500,
      type: 'expense',
      transaction_date: '2026-08-01',
      due_date: '2026-08-01',
      status: 'pending',
      created_at: '2026-08-01',
    };

    const res = processRecurringBatchState({
      recurring: [recMonthly],
      accounts,
      paymentMethods: [],
      creditCards: [],
      categories,
      transactions: [existingTx],
      bills: [],
      todayStr: '2026-08-01',
    });

    // Não deve recriar transação para o mesmo itemKey
    expect(res.newTransactions).toHaveLength(0);
  });

  it('não deve avançar nem modificar recorrência quando next_occurrence for posterior a todayStr', () => {
    const futureRec: RecurringTransaction = {
      id: 'rec-future-1',
      workspace_id: 'ws-1',
      description: 'Conta Futura',
      amount: 200,
      type: 'expense',
      category_id: 'cat-1',
      account_id: 'acc-1',
      frequency: 'monthly',
      start_date: '2026-08-15',
      next_occurrence: '2026-08-15',
      auto_create: true,
      active: true,
      created_at: '2026-08-01',
    };

    const res = processRecurringBatchState({
      recurring: [futureRec],
      accounts,
      paymentMethods: [],
      creditCards: [],
      categories,
      transactions: [],
      bills: [],
      todayStr: '2026-08-01',
    });

    expect(res.hasChanges).toBe(false);
    expect(res.newTransactions).toHaveLength(0);
    expect(res.updatedRecurring[0].next_occurrence).toBe('2026-08-15');
    expect(res.updatedRecurring[0].active).toBe(true);
  });
});

