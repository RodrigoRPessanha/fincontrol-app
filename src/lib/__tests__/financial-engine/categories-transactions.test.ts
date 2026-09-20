import { describe, it, expect } from 'vitest';
import {
  resolveCategory,
  validateCategoryActive,
  validatePaymentAccount,
  validateBillPaymentAccount,
  validateTransactionAccount,
  resolveOrCreateCreditCardBill,
  reconcileBillAfterItemDeletion,
  splitInstallments,
  validateCreditCardResolution,
  validateCreditCardBillIntegrity,
} from '../../financial-engine';
import { Account, Category, CreditCard, CreditCardBill, Installment, Payment, Purchase, RecurringTransaction, Transaction, Settlement, WorkspaceMember } from '../../types';

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


describe('Financial Engine - Validação de Contas para Pagamento e Modo Expense Tracker', () => {
  const accounts: Account[] = [
    { id: 'acc-1', workspace_id: 'ws-1', name: 'Conta Corrente', type: 'checking', institution: 'Nubank', initial_balance: 100, current_balance: 100, color: '#000', active: true, created_at: '2026-01-01' },
    { id: 'acc-inactive', workspace_id: 'ws-1', name: 'Conta Inativa', type: 'checking', institution: 'Nubank', initial_balance: 100, current_balance: 100, color: '#000', active: false, created_at: '2026-01-01' },
  ];

  it('validatePaymentAccount deve permitir ausência de conta bancária se isExpenseTrackerMode for true', () => {
    expect(validatePaymentAccount(undefined, accounts, 'ws-1', true)).toBeNull();
    expect(validatePaymentAccount(null, accounts, 'ws-1', true)).toBeNull();
    expect(validatePaymentAccount('', accounts, 'ws-1', true)).toBeNull();
  });

  it('validatePaymentAccount deve validar conta normalmente se informada mesmo no modo isExpenseTrackerMode', () => {
    const acc = validatePaymentAccount('acc-1', accounts, 'ws-1', true);
    expect(acc).not.toBeNull();
    expect(acc?.id).toBe('acc-1');

    expect(() => validatePaymentAccount('acc-inactive', accounts, 'ws-1', true)).toThrow(
      'A conta bancária informada está inativa.'
    );
  });

  it('validatePaymentAccount deve exigir conta bancária no modo full', () => {
    expect(() => validatePaymentAccount(undefined, accounts, 'ws-1', false)).toThrow(
      'Conta bancária não encontrada no workspace ativo.'
    );
  });

  it('validateBillPaymentAccount deve permitir ausência de conta se isExpenseTrackerMode for true', () => {
    expect(() => validateBillPaymentAccount(undefined, accounts, 'ws-1', true)).not.toThrow();
    expect(() => validateBillPaymentAccount(null, accounts, 'ws-1', true)).not.toThrow();
  });

  it('validateBillPaymentAccount deve validar conta se informada no modo isExpenseTrackerMode', () => {
    expect(() => validateBillPaymentAccount('acc-inactive', accounts, 'ws-1', true)).toThrow(
      'A conta bancária selecionada para pagamento da fatura está inativa.'
    );
  });

  it('validateBillPaymentAccount deve lançar erro se conta for ausente no modo normal ou não pertencer ao workspace', () => {
    expect(() => validateBillPaymentAccount(undefined, accounts, 'ws-1', false)).toThrow(
      'Conta bancária não encontrada no workspace ativo.'
    );
    expect(() => validateBillPaymentAccount('acc-inexistente', accounts, 'ws-1', false)).toThrow(
      'Conta bancária não encontrada no workspace ativo.'
    );
  });
});

describe('Financial Engine - Validação de Categorias e Subcategorias (validateCategory)', () => {
  const categories: Category[] = [
    {
      id: 'cat-1',
      workspace_id: 'ws-1',
      name: 'Transporte',
      icon: 'Car',
      color: '#3b82f6',
      type: 'expense',
      active: true,
      created_at: '2026-01-01',
      subcategories: [
        {
          id: 'sub-active',
          workspace_id: 'ws-1',
          name: 'Combustível',
          icon: 'Fuel',
          color: '#3b82f6',
          type: 'expense',
          active: true,
          parent_id: 'cat-1',
          created_at: '2026-01-01',
        },
        {
          id: 'sub-inactive',
          workspace_id: 'ws-1',
          name: 'Estacionamento',
          icon: 'Parking',
          color: '#3b82f6',
          type: 'expense',
          active: false,
          parent_id: 'cat-1',
          created_at: '2026-01-01',
        },
      ],
    },
    {
      id: 'cat-inactive',
      workspace_id: 'ws-1',
      name: 'Lazer',
      icon: 'Smile',
      color: '#f43f5e',
      type: 'expense',
      active: false,
      created_at: '2026-01-01',
    },
  ];

  it('validateCategoryActive deve aceitar categoria ou subcategoria ativa do workspace', () => {
    expect(() => validateCategoryActive('cat-1', categories, 'ws-1')).not.toThrow();
    expect(() => validateCategoryActive('sub-active', categories, 'ws-1')).not.toThrow();
  });

  it('validateCategoryActive deve lançar erro se categoria não pertencer ao workspace', () => {
    expect(() => validateCategoryActive('cat-outra', categories, 'ws-1')).toThrow(
      'Categoria informada não pertence ao workspace ativo.'
    );
    expect(() => validateCategoryActive('cat-1', categories, 'ws-outro')).toThrow(
      'Categoria informada não pertence ao workspace ativo.'
    );
  });

  it('validateCategoryActive deve lançar erro se categoria ou subcategoria for inativa', () => {
    expect(() => validateCategoryActive('cat-inactive', categories, 'ws-1')).toThrow(
      'A categoria informada está inativa.'
    );
    expect(() => validateCategoryActive('sub-inactive', categories, 'ws-1')).toThrow(
      'A subcategoria informada está inativa.'
    );
  });
});

describe('Financial Engine - Faturas de Cartão e Reconciliação (credit-cards.ts)', () => {
  it('resolveOrCreateCreditCardBill deve criar fatura quitada quando isPaid for true', () => {
    const res = resolveOrCreateCreditCardBill({
      bills: [],
      cardId: 'card-1',
      workspaceId: 'ws-1',
      amount: 250,
      referenceMonth: '2026-08',
      closingDate: '2026-08-03',
      dueDate: '2026-08-10',
      nowIso: '2026-08-01T12:00:00Z',
      isPaid: true,
    });
    expect(res.isNew).toBe(true);
    const bill = res.updatedBills[0];
    expect(bill.status).toBe('paid');
    expect(bill.paid_amount).toBe(250);
    expect(bill.paid_at).toBe('2026-08-10');
  });

  it('reconcileBillAfterItemDeletion deve atualizar status para open quando o saldo for zerado', () => {
    const bill: CreditCardBill = {
      id: 'bill-1',
      credit_card_id: 'card-1',
      workspace_id: 'ws-1',
      reference_month: '2026-08',
      closing_date: '2026-08-03',
      due_date: '2026-08-10',
      total_amount: 100,
      paid_amount: 0,
      status: 'open',
      paid_at: null,
      created_at: '2026-08-01',
    };
    const reconciled = reconcileBillAfterItemDeletion(bill, 100);
    expect(reconciled.total_amount).toBe(0);
    expect(reconciled.status).toBe('open');
  });

  it('reconcileBillAfterItemDeletion deve atualizar para partially_paid se houver valor pago remanescente', () => {
    const bill: CreditCardBill = {
      id: 'bill-1',
      credit_card_id: 'card-1',
      workspace_id: 'ws-1',
      reference_month: '2026-08',
      closing_date: '2026-08-03',
      due_date: '2026-08-10',
      total_amount: 200,
      paid_amount: 50,
      status: 'partially_paid',
      paid_at: null,
      created_at: '2026-08-01',
    };
    const reconciled = reconcileBillAfterItemDeletion(bill, 50);
    expect(reconciled.total_amount).toBe(150);
    expect(reconciled.paid_amount).toBe(50);
    expect(reconciled.status).toBe('partially_paid');
  });

  it('resolveOrCreateCreditCardBill deve atualizar fatura existente como quitada quando isPaid for true', () => {
    const existingBill: CreditCardBill = {
      id: 'bill-existente',
      credit_card_id: 'card-1',
      workspace_id: 'ws-1',
      reference_month: '2026-08',
      closing_date: '2026-08-03',
      due_date: '2026-08-10',
      total_amount: 100,
      paid_amount: 100,
      status: 'paid',
      paid_at: '2026-08-10',
      created_at: '2026-08-01',
    };
    const res = resolveOrCreateCreditCardBill({
      bills: [existingBill],
      cardId: 'card-1',
      workspaceId: 'ws-1',
      amount: 50,
      referenceMonth: '2026-08',
      closingDate: '2026-08-03',
      dueDate: '2026-08-10',
      nowIso: '2026-08-01T12:00:00Z',
      isPaid: true,
    });
    expect(res.isNew).toBe(false);
    expect(res.updatedBills[0].status).toBe('paid');
    expect(res.updatedBills[0].paid_at).toBe('2026-08-10');
  });

  it('reconcileBillAfterItemDeletion deve marcar fatura como quitada (isNowPaid) quando novo total igualar ao valor pago', () => {
    const bill: CreditCardBill = {
      id: 'bill-now-paid',
      credit_card_id: 'card-1',
      workspace_id: 'ws-1',
      reference_month: '2026-08',
      closing_date: '2026-08-03',
      due_date: '2026-08-10',
      total_amount: 100,
      paid_amount: 60,
      status: 'partially_paid',
      paid_at: '2026-08-10',
      created_at: '2026-08-01',
    };
    const reconciled = reconcileBillAfterItemDeletion(bill, 40);
    expect(reconciled.total_amount).toBe(60);
    expect(reconciled.paid_amount).toBe(60);
    expect(reconciled.status).toBe('paid');
    expect(reconciled.paid_at).toBe('2026-08-10');
  });
});

describe('Financial Engine - Parcelas e Contas de Transação (installments.ts e transactions.ts)', () => {
  it('splitInstallments deve aplicar fallbacks quando cartão possuir closing_day ou due_day zerados', () => {
    const card: CreditCard = {
      id: 'card-fallback',
      workspace_id: 'ws-1',
      name: 'Cartão Fallback',
      institution: 'Banco',
      credit_limit: 1000,
      closing_day: 0,
      due_day: 0,
      color: '#000',
      active: true,
      created_at: '2026-01-01',
    };
    const installments = splitInstallments(300, 3, '2026-08-15', card);
    expect(installments).toHaveLength(3);
    expect(installments[0].dueDate).toBeDefined();
  });

  it('validateTransactionAccount deve aceitar accountId nulo ou indefinido sem erro', () => {
    const accounts: Account[] = [
      { id: 'acc-1', workspace_id: 'ws-1', name: 'Conta', type: 'checking', institution: 'Banco', initial_balance: 0, current_balance: 0, color: '#000', active: true, created_at: '2026-01-01' },
    ];
    expect(() => validateTransactionAccount(undefined, accounts, 'ws-1')).not.toThrow();
    expect(() => validateTransactionAccount(null, accounts, 'ws-1')).not.toThrow();
    expect(() => validateTransactionAccount('acc-1', accounts, 'ws-1')).not.toThrow();
    expect(() => validateTransactionAccount('acc-inexistente', accounts, 'ws-1')).toThrow(
      'Conta bancária informada não pertence ao workspace ativo.'
    );
  });

  it('credit-cards: deve cobrir método de pagamento inexistente e fatura sem paid_amount (linhas 95 e 140)', () => {
    // Linha 95: método não encontrado no workspace
    expect(() => {
      validateCreditCardResolution('ws-1', [], [], [], 'pm-inexistente', null);
    }).toThrow('Método de pagamento informado não pertence ao workspace.');

    // Linha 140: fatura com paid_amount indefinido (avalia false na verificação de paid_amount)
    const billWithoutPaidAmount: CreditCardBill = {
      id: 'bill-no-paid-amount',
      credit_card_id: 'card-1',
      workspace_id: 'ws-1',
      reference_month: '2026-08',
      closing_date: '2026-08-05',
      due_date: '2026-08-12',
      total_amount: 500,
      paid_amount: undefined as any,
      status: 'open',
      created_at: '2026-08-01',
    };
    expect(() => validateCreditCardBillIntegrity(billWithoutPaidAmount)).not.toThrow();
  });
});


