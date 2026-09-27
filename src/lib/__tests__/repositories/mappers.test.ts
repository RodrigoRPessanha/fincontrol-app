import { describe, it, expect } from 'vitest';
import {
  mapAccountRowToDomain,
  mapDomainToAccountInsert,
  buildCategoryTree,
  mapCategoryRowToDomain,
  mapDomainToCategoryInsert,
  mapCreditCardRowToDomain,
  mapDomainToCreditCardInsert,
  mapCreditCardBillRowToDomain,
  mapDomainToCreditCardBillInsert,
  mapDomainToFinancialGoalInsert,
  mapFinancialGoalRowToDomain,
  mapDomainToBudgetInsert,
  mapBudgetRowToDomain,
  mapPaymentMethodRowToDomain,
  mapDomainToPaymentMethodInsert,
  mapPaymentRowToDomain,
  mapDomainToPaymentInsert,
  mapPurchaseRowToDomain,
  mapDomainToPurchaseInsert,
  mapPurchaseSplitsToDomain,
  mapDomainPurchaseSplitsToInsert,
  mapInstallmentRowToDomain,
  mapDomainToInstallmentInsert,
  mapRecurringRowToDomain,
  mapDomainToRecurringInsert,
  mapSettlementRowToDomain,
  mapDomainToSettlementInsert,
  mapTransactionRowToDomain,
  mapDomainToTransactionInsert,
  mapTransactionSplitsToDomain,
  mapDomainSplitsToInsert,
  mapTransferRowToDomain,
  mapDomainToTransferInsert,
  mapWorkspaceRowToDomain,
  mapDomainToWorkspaceInsert,
  mapWorkspaceMemberRowToDomain,
  mapDomainToWorkspaceMemberInsert,
} from '../../repositories/mappers';
import { RepositoryError } from '../../repositories/repository-errors';

describe('Repository Errors & PostgREST Code Mapping', () => {
  it('instantiates RepositoryError with default values', () => {
    const err = new RepositoryError('Erro simples');
    expect(err.name).toBe('RepositoryError');
    expect(err.code).toBe('UNKNOWN');
    expect(err.entity).toBeUndefined();
    expect(err.originalError).toBeUndefined();
    expect(err.message).toBe('Erro simples');
    expect(err instanceof Error).toBe(true);
    expect(err instanceof RepositoryError).toBe(true);
  });

  it('maps PGRST116 and 42P01 to NOT_FOUND', () => {
    const err1 = RepositoryError.fromPostgrestError({ code: 'PGRST116', message: 'Not found' }, 'accounts');
    expect(err1.code).toBe('NOT_FOUND');
    expect(err1.entity).toBe('accounts');

    const err2 = RepositoryError.fromPostgrestError({ code: '42P01', message: 'Relation not found' });
    expect(err2.code).toBe('NOT_FOUND');
  });

  it('maps 42501 to FORBIDDEN', () => {
    const err = RepositoryError.fromPostgrestError({ code: '42501', message: 'Permission denied' });
    expect(err.code).toBe('FORBIDDEN');
  });

  it('maps 23505 to CONFLICT', () => {
    const err = RepositoryError.fromPostgrestError({ code: '23505', message: 'Unique violation' });
    expect(err.code).toBe('CONFLICT');
  });

  it('maps 23514, 23502, 22P02 to VALIDATION_FAILED', () => {
    const codes = ['23514', '23502', '22P02'];
    for (const code of codes) {
      const err = RepositoryError.fromPostgrestError({ code, message: 'Check constraint' });
      expect(err.code).toBe('VALIDATION_FAILED');
    }
  });

  it('maps unhandled codes to DATABASE_ERROR', () => {
    const err = RepositoryError.fromPostgrestError({ code: '99999', message: 'Other failure' });
    expect(err.code).toBe('DATABASE_ERROR');

    const errNoCode = RepositoryError.fromPostgrestError({ message: 'No code' });
    expect(errNoCode.code).toBe('DATABASE_ERROR');
  });
});

describe('Workspace & Member Mappers', () => {
  it('maps workspace row to domain and back with fallback values', () => {
    const row = {
      id: 'ws-1',
      name: 'Pessoal',
      owner_id: 'user-1',
      currency: null as any,
      tracking_mode: null as any,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const domain = mapWorkspaceRowToDomain(row);
    expect(domain.id).toBe('ws-1');
    expect(domain.currency).toBe('BRL');
    expect(domain.tracking_mode).toBe('full');

    const insert = mapDomainToWorkspaceInsert(domain);
    expect(insert.name).toBe('Pessoal');
    expect(insert.currency).toBe('BRL');
  });

  it('maps workspace member row to domain with profile', () => {
    const memberRow = {
      id: 'mem-1',
      workspace_id: 'ws-1',
      user_id: 'usr-1',
      role: 'admin',
      created_at: '2026-01-01T00:00:00Z',
    };
    const profileRow = {
      id: 'usr-1',
      name: 'Rodrigo',
      email: 'rodrigo@example.com',
      avatar_url: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const domain = mapWorkspaceMemberRowToDomain(memberRow, profileRow);
    expect(domain.role).toBe('admin');
    expect(domain.user?.name).toBe('Rodrigo');
    expect(domain.user?.avatar_url).toBeUndefined();

    const domainWithoutProfile = mapWorkspaceMemberRowToDomain(memberRow, null);
    expect(domainWithoutProfile.user).toBeUndefined();

    const insert = mapDomainToWorkspaceMemberInsert(domain);
    expect(insert.user_id).toBe('usr-1');
    expect(insert.role).toBe('admin');
  });
});

describe('Account Mapper', () => {
  it('maps account bidirectional with roundCurrency', () => {
    const row = {
      id: 'acc-1',
      workspace_id: 'ws-1',
      name: 'Nubank',
      institution: 'Nu Pagamentos',
      type: 'checking',
      current_balance: 100.456,
      initial_balance: 50.1,
      color: '#820ad1',
      active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const domain = mapAccountRowToDomain(row);
    expect(domain.current_balance).toBe(100.46);
    expect(domain.initial_balance).toBe(50.1);

    const insert = mapDomainToAccountInsert(domain);
    expect(insert.current_balance).toBe(100.46);
    expect(insert.name).toBe('Nubank');
  });
});

describe('Category Mapper', () => {
  it('maps category bidirectional', () => {
    const row = {
      id: 'cat-1',
      workspace_id: 'ws-1',
      name: 'Alimentação',
      parent_id: null,
      type: 'expense',
      color: '#ff5722',
      icon: 'utensils',
      active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const domain = mapCategoryRowToDomain(row);
    expect(domain.parent_id).toBeNull();
    expect(domain.name).toBe('Alimentação');

    const insert = mapDomainToCategoryInsert(domain);
    expect(insert.parent_id).toBeNull();
  });
});

describe('Card & Bill Mappers', () => {
  it('maps credit card and credit card bill bidirectional', () => {
    const cardRow = {
      id: 'card-1',
      workspace_id: 'ws-1',
      name: 'Nubank Ultravioleta',
      institution: 'Nubank',
      last_four_digits: '1234',
      credit_limit: 5000,
      closing_day: 10,
      due_day: 17,
      linked_payment_account_id: 'acc-1',
      color: '#820ad1',
      active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const card = mapCreditCardRowToDomain(cardRow);
    expect(card.credit_limit).toBe(5000);
    const cardInsert = mapDomainToCreditCardInsert(card);
    expect(cardInsert.name).toBe('Nubank Ultravioleta');

    const billRow = {
      id: 'bill-1',
      credit_card_id: 'card-1',
      workspace_id: 'ws-1',
      reference_month: '2026-04',
      closing_date: '2026-04-10',
      due_date: '2026-04-17',
      total_amount: 150.75,
      paid_amount: 0,
      status: 'open',
      paid_at: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const bill = mapCreditCardBillRowToDomain(billRow);
    expect(bill.status).toBe('open');
    const billInsert = mapDomainToCreditCardBillInsert(bill);
    expect(billInsert.paid_at).toBeNull();
  });
});

describe('Transaction & Split Mappers', () => {
  it('maps transaction row and its splits to domain and back', () => {
    const txRow = {
      id: 'tx-1',
      workspace_id: 'ws-1',
      description: 'Supermercado',
      amount: 250,
      transaction_date: '2026-04-01',
      type: 'expense',
      status: 'paid',
      category_id: 'cat-1',
      account_id: 'acc-1',
      payment_method_id: 'pm-1',
      credit_card_id: null,
      credit_card_bill_id: null,
      notes: 'Compras do mês',
      created_by: 'usr-1',
      paid_by_member_id: 'mem-1',
      split_type: 'custom',
      recurring_transaction_id: null,
      due_date: '2026-04-01',
      paid_at: null,
      is_recurring: false,
      metadata: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const splitRows = [
      {
        id: 's-1',
        transaction_id: 'tx-1',
        workspace_id: 'ws-1',
        member_id: 'mem-1',
        amount: 150,
        percentage: 60,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 's-2',
        transaction_id: 'tx-1',
        workspace_id: 'ws-1',
        member_id: 'mem-2',
        amount: 100,
        percentage: 40,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ];

    const domain = mapTransactionRowToDomain(txRow, splitRows);
    expect(domain.splits?.length).toBe(2);
    expect(domain.splits?.[0].percentage).toBe(60);

    const insert = mapDomainToTransactionInsert(domain);
    expect(insert.amount).toBe(250);

    const mappedSplits = mapDomainSplitsToInsert('ws-1', 'tx-1', domain.splits!);
    expect(mappedSplits.length).toBe(2);
    expect(mappedSplits[0].amount).toBe(150);

    const directSplits = mapTransactionSplitsToDomain(splitRows);
    expect(directSplits.length).toBe(2);
  });
});

describe('Purchase, Installment & Settlement Mappers', () => {
  it('maps purchase, splits and installments bidirectional', () => {
    const purchaseRow = {
      id: 'pur-1',
      workspace_id: 'ws-1',
      description: 'Notebook',
      total_amount: 3000,
      installment_count: 10,
      paid_installments_count: 2,
      purchase_date: '2026-01-01',
      category_id: 'cat-1',
      credit_card_id: 'card-1',
      account_id: null,
      payment_method_id: null,
      created_by: 'usr-1',
      paid_by_member_id: 'mem-1',
      split_type: 'equal',
      metadata: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const pSplitRows = [
      {
        id: 'ps-1',
        purchase_id: 'pur-1',
        workspace_id: 'ws-1',
        member_id: 'mem-1',
        amount: 1500,
        percentage: 50,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ];

    const purchase = mapPurchaseRowToDomain(purchaseRow, pSplitRows);
    expect(purchase.total_amount).toBe(3000);
    expect(purchase.splits?.length).toBe(1);

    const pInsert = mapDomainToPurchaseInsert(purchase);
    expect(pInsert.installment_count).toBe(10);

    const pSplitsInsert = mapDomainPurchaseSplitsToInsert('ws-1', 'pur-1', purchase.splits!);
    expect(pSplitsInsert.length).toBe(1);

    const directPSplits = mapPurchaseSplitsToDomain(pSplitRows);
    expect(directPSplits.length).toBe(1);

    const instRow = {
      id: 'inst-1',
      purchase_id: 'pur-1',
      installment_number: 1,
      amount: 300,
      due_date: '2026-02-01',
      credit_card_bill_id: 'bill-1',
      status: 'completed',
      paid_amount: 300,
      paid_at: '2026-02-01T00:00:00Z',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const inst = mapInstallmentRowToDomain(instRow);
    expect(inst.installment_number).toBe(1);
    const instInsert = mapDomainToInstallmentInsert(inst);
    expect(instInsert.amount).toBe(300);

    const instInsertNulls = mapDomainToInstallmentInsert({
      purchase_id: 'pur-1',
      installment_number: 2,
      amount: 300,
      due_date: '2026-03-01',
      status: 'pending',
      paid_amount: 0,
    });
    expect(instInsertNulls.credit_card_bill_id).toBeNull();
    expect(instInsertNulls.paid_at).toBeNull();

    const splitsWithNullAmount = mapPurchaseSplitsToDomain([
      { id: 'ps-1', workspace_id: 'ws-1', updated_at: '2026-01-01', purchase_id: 'pur-1', member_id: 'm-1', amount: null as any, percentage: null, created_at: '2026-01-01' },
      { id: 'ps-2', workspace_id: 'ws-1', updated_at: '2026-01-01', purchase_id: 'pur-1', member_id: 'm-2', amount: 50, percentage: 50, created_at: '2026-01-01' },
    ]);
    expect(splitsWithNullAmount[0].amount).toBe(0);
    expect(splitsWithNullAmount[0].percentage).toBeUndefined();
    expect(splitsWithNullAmount[1].percentage).toBe(50);
  });

  it('maps settlement, payment, transfer, recurring, budget, and goal', () => {
    const sRow = {
      id: 'set-1',
      workspace_id: 'ws-1',
      from_member_id: 'mem-1',
      to_member_id: 'mem-2',
      amount: 50,
      settlement_date: '2026-04-01',
      payment_account_id: 'acc-1',
      notes: 'Acerto de contas',
      created_by: 'usr-1',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const settlement = mapSettlementRowToDomain(sRow);
    expect(settlement.amount).toBe(50);
    const sInsert = mapDomainToSettlementInsert(settlement);
    expect(sInsert.from_member_id).toBe('mem-1');

    const payRow = {
      id: 'pay-1',
      workspace_id: 'ws-1',
      payment_date: '2026-04-01',
      amount: 100,
      account_id: 'acc-1',
      credit_card_bill_id: null,
      installment_id: null,
      transaction_id: null,
      payment_method_id: null,
      notes: 'Pagamento avulso',
      affects_balance: true,
      created_by: 'usr-1',
      created_at: '2026-01-01T00:00:00Z',
    };
    const payment = mapPaymentRowToDomain(payRow);
    expect(payment.amount).toBe(100);
    const payInsert = mapDomainToPaymentInsert(payment);
    expect(payInsert.affects_balance).toBe(true);

    const transRow = {
      id: 'tr-1',
      workspace_id: 'ws-1',
      from_account_id: 'acc-1',
      to_account_id: 'acc-2',
      amount: 200,
      transfer_date: '2026-04-01',
      notes: 'Reserva',
      idempotency_key: null,
      created_by: 'usr-1',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const transfer = mapTransferRowToDomain(transRow);
    expect(transfer.amount).toBe(200);
    const trInsert = mapDomainToTransferInsert(transfer);
    expect(trInsert.to_account_id).toBe('acc-2');

    const recRow = {
      id: 'rec-1',
      workspace_id: 'ws-1',
      description: 'Netflix',
      amount: 55.9,
      type: 'expense',
      category_id: 'cat-1',
      account_id: null,
      credit_card_id: null,
      payment_method_id: 'pm-1',
      frequency: 'monthly',
      interval_days: null,
      start_date: '2026-01-01',
      end_date: null,
      next_occurrence: '2026-05-15',
      auto_create: false,
      active: true,
      suspended_reason: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const rec = mapRecurringRowToDomain(recRow);
    expect(rec.description).toBe('Netflix');
    const recInsert = mapDomainToRecurringInsert(rec);
    expect(recInsert.frequency).toBe('monthly');

    const bRow = {
      id: 'b-1',
      workspace_id: 'ws-1',
      category_id: 'cat-1',
      planned_amount: 800,
      month: 4,
      year: 2026,
      created_at: '2026-01-01T00:00:00Z',
    };
    const budget = mapBudgetRowToDomain(bRow);
    expect(budget.planned_amount).toBe(800);
    const bInsert = mapDomainToBudgetInsert(budget);
    expect(bInsert.year).toBe(2026);

    const gRow = {
      id: 'g-1',
      workspace_id: 'ws-1',
      name: 'Reserva Emergência',
      target_amount: 10000,
      current_amount: 2500,
      target_date: '2026-12-31',
      status: 'in_progress',
      color: '#10b981',
      icon: 'piggy-bank',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const goal = mapFinancialGoalRowToDomain(gRow);
    expect(goal.target_amount).toBe(10000);
    const gInsert = mapDomainToFinancialGoalInsert(goal);
    expect(gInsert.current_amount).toBe(2500);

    const pmRow = {
      id: 'pm-1',
      workspace_id: 'ws-1',
      name: 'Cartão Virtual',
      type: 'credit',
      linked_account_id: 'acc-1',
      credit_card_id: null,
      active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const pm = mapPaymentMethodRowToDomain(pmRow);
    expect(pm.name).toBe('Cartão Virtual');
    const pmInsert = mapDomainToPaymentMethodInsert(pm);
    expect(pmInsert.type).toBe('credit');
  });

  it('builds category tree correctly from flat categories', () => {
    const flatCats = [
      { id: 'parent-1', workspace_id: 'ws-1', name: 'Alimentação', parent_id: null, type: 'expense' as const, color: '#f00', icon: 'food', active: true, created_at: '2026-01-01' },
      { id: 'child-1', workspace_id: 'ws-1', name: 'Restaurante', parent_id: 'parent-1', type: 'expense' as const, color: '#f00', icon: 'food', active: true, created_at: '2026-01-01' },
      { id: 'root-2', workspace_id: 'ws-1', name: 'Transporte', parent_id: null, type: 'expense' as const, color: '#0f0', icon: 'car', active: true, created_at: '2026-01-01' },
    ];
    const tree = buildCategoryTree(flatCats);
    expect(tree.length).toBe(2);
    expect(tree[0].subcategories?.length).toBe(1);
    expect(tree[0].subcategories?.[0].id).toBe('child-1');
    expect(tree[1].subcategories?.length).toBe(0);
  });

  it('covers fallback branches across all mappers for nullish database fields', () => {
    // Category fallbacks
    const catFallback = mapCategoryRowToDomain({
      id: 'c-null',
      workspace_id: 'ws-1',
      name: 'Sem detalhes',
      icon: null,
      color: null,
      type: null as any,
      active: null,
      parent_id: null,
      created_at: '2026-01-01',
    } as any);
    expect(catFallback.icon).toBe('tag');
    expect(catFallback.color).toBe('#6b7280');
    expect(catFallback.type).toBe('expense');
    expect(catFallback.active).toBe(true);

    // Credit Card fallbacks
    const cardFallback = mapCreditCardRowToDomain({
      id: 'card-null',
      workspace_id: 'ws-1',
      name: 'Cartao Null',
      institution: null,
      last_four_digits: null,
      credit_limit: null as any,
      closing_day: 1,
      due_day: 10,
      linked_payment_account_id: null,
      color: null,
      active: null,
      created_at: '2026-01-01',
    } as any);
    expect(cardFallback.institution).toBe('Instituição');
    expect(cardFallback.last_four_digits).toBeUndefined();
    expect(cardFallback.credit_limit).toBe(0);
    expect(cardFallback.color).toBe('#6366f1');
    expect(cardFallback.active).toBe(true);

    // Bill fallbacks
    const billFallback = mapCreditCardBillRowToDomain({
      id: 'b-null',
      credit_card_id: 'card-null',
      workspace_id: 'ws-1',
      reference_month: '2026-04',
      closing_date: '2026-04-01',
      due_date: '2026-04-10',
      total_amount: null as any,
      paid_amount: null as any,
      status: null as any,
      paid_at: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    } as any);
    expect(billFallback.total_amount).toBe(0);
    expect(billFallback.paid_amount).toBe(0);
    expect(billFallback.status).toBe('open');

    // Account fallbacks
    const accFallback = mapAccountRowToDomain({
      id: 'acc-null',
      workspace_id: 'ws-1',
      name: 'Conta Null',
      institution: null,
      type: null as any,
      current_balance: null as any,
      initial_balance: null as any,
      color: null,
      active: null,
      created_at: '2026-01-01',
    } as any);
    expect(accFallback.institution).toBe('Banco');
    expect(accFallback.type).toBe('checking');
    expect(accFallback.current_balance).toBe(0);
    expect(accFallback.initial_balance).toBe(0);
    expect(accFallback.color).toBe('#10b981');
    expect(accFallback.active).toBe(true);

    // Payment method fallbacks
    const pmFallback = mapPaymentMethodRowToDomain({
      id: 'pm-null',
      workspace_id: 'ws-1',
      name: 'Metodo Null',
      type: null as any,
      linked_account_id: null,
      credit_card_id: null,
      active: null,
      created_at: '2026-01-01',
    } as any);
    expect(pmFallback.type).toBe('other');
    expect(pmFallback.active).toBe(true);

    // Recurring fallbacks
    const recFallback = mapRecurringRowToDomain({
      id: 'rec-null',
      workspace_id: 'ws-1',
      description: 'Rec Null',
      amount: null as any,
      type: null as any,
      category_id: null,
      account_id: null,
      credit_card_id: null,
      payment_method_id: null,
      frequency: null as any,
      interval_days: null,
      start_date: '2026-01-01',
      end_date: null,
      next_occurrence: '2026-02-01',
      auto_create: null,
      active: null,
      suspended_reason: null,
      created_at: '2026-01-01',
    } as any);
    expect(recFallback.amount).toBe(0);
    expect(recFallback.type).toBe('expense');
    expect(recFallback.frequency).toBe('monthly');
    expect(recFallback.auto_create).toBe(false);
    expect(recFallback.active).toBe(true);

    // Transaction fallbacks
    const txFallback = mapTransactionRowToDomain({
      id: 'tx-null',
      workspace_id: 'ws-1',
      description: 'Tx Null',
      amount: null as any,
      transaction_date: '2026-04-01',
      due_date: null as any,
      type: null as any,
      status: null as any,
      category_id: null,
      account_id: null,
      payment_method_id: null,
      credit_card_id: null,
      credit_card_bill_id: null,
      notes: null,
      created_by: null,
      paid_by_member_id: null,
      split_type: null,
      recurring_transaction_id: null,
      paid_at: null,
      metadata: null,
      created_at: '2026-01-01',
    } as any);
    expect(txFallback.amount).toBe(0);
    expect(txFallback.type).toBe('expense');
    expect(txFallback.status).toBe('pending');
    expect(txFallback.split_type).toBeUndefined();

    // Purchase fallbacks
    const pFallback = mapPurchaseRowToDomain({
      id: 'p-null',
      workspace_id: 'ws-1',
      description: 'P Null',
      total_amount: null as any,
      installment_count: 1,
      paid_installments_count: null,
      purchase_date: '2026-04-01',
      category_id: null,
      credit_card_id: null,
      account_id: null,
      payment_method_id: null,
      created_by: null,
      paid_by_member_id: null,
      split_type: null,
      metadata: null,
      created_at: '2026-01-01',
    } as any);
    expect(pFallback.total_amount).toBe(0);
    expect(pFallback.installment_count).toBe(1);
    expect(pFallback.paid_installments_count).toBe(0);
    expect(pFallback.split_type).toBeUndefined();

    // Installment fallbacks
    const instFallback = mapInstallmentRowToDomain({
      id: 'i-null',
      purchase_id: 'p-null',
      installment_number: 1,
      amount: null as any,
      due_date: '2026-05-01',
      credit_card_bill_id: null,
      status: null as any,
      paid_amount: null,
      paid_at: null,
      created_at: '2026-01-01',
    } as any);
    expect(instFallback.amount).toBe(0);
    expect(instFallback.status).toBe('pending');
    expect(instFallback.paid_amount).toBe(0);

    // Goal fallbacks
    const goalFallback = mapFinancialGoalRowToDomain({
      id: 'g-null',
      workspace_id: 'ws-1',
      name: 'Goal Null',
      target_amount: null as any,
      current_amount: null as any,
      target_date: null,
      status: null as any,
      color: null,
      icon: null,
      created_at: '2026-01-01',
    } as any);
    expect(goalFallback.target_amount).toBe(0);
    expect(goalFallback.current_amount).toBe(0);
    expect(goalFallback.status).toBe('in_progress');
    expect(goalFallback.color).toBe('#10b981');
    expect(goalFallback.icon).toBe('target');

    // Transfer fallbacks
    const trFallback = mapTransferRowToDomain({
      id: 'tr-null',
      workspace_id: 'ws-1',
      from_account_id: 'a-1',
      to_account_id: 'a-2',
      amount: null as any,
      transfer_date: '2026-04-01',
      notes: null,
      idempotency_key: null,
      created_by: null,
      created_at: '2026-01-01',
    } as any);
    expect(trFallback.amount).toBe(0);
  });

  it('covers all optional and fallback branches across mappers', () => {
    // 1. Workspace & Members
    const wsInsert = mapDomainToWorkspaceInsert({
      id: 'ws-empty',
      name: 'Default WS',
      owner_id: 'u-1',
      currency: undefined as any,
      tracking_mode: undefined as any,
    });
    expect(wsInsert.currency).toBe('BRL');
    expect(wsInsert.tracking_mode).toBe('full');

    const memberRoleFallback = mapWorkspaceMemberRowToDomain({
      id: 'mem-role',
      workspace_id: 'ws-1',
      user_id: 'u-1',
      role: null as any,
      created_at: '2026-01-01',
    });
    expect(memberRoleFallback.role).toBe('member');

    const memberProfileNulls = mapWorkspaceMemberRowToDomain(
      {
        id: 'mem-prof',
        workspace_id: 'ws-1',
        user_id: 'u-2',
        role: 'admin',
        created_at: '2026-01-01',
      },
      {
        id: 'u-2',
        name: null,
        email: null,
        avatar_url: 'https://example.com/avatar.png',
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      } as any
    );
    expect(memberProfileNulls.user?.name).toBe('Membro');
    expect(memberProfileNulls.user?.email).toBe('');
    expect(memberProfileNulls.user?.avatar_url).toBe('https://example.com/avatar.png');

    // 2. Transfers
    const trInsert = mapDomainToTransferInsert({
      workspace_id: 'ws-1',
      from_account_id: 'a-1',
      to_account_id: 'a-2',
      amount: 50,
      transfer_date: '2026-04-01',
      notes: undefined,
      created_by: undefined,
    });
    expect(trInsert.notes).toBeNull();
    expect(trInsert.created_by).toBeNull();

    // 3. Settlements
    const settlementRowNull = mapSettlementRowToDomain({
      id: 's-null',
      workspace_id: 'ws-1',
      from_member_id: 'm-1',
      to_member_id: 'm-2',
      amount: null as any,
      settlement_date: '2026-04-01',
      notes: null,
      payment_account_id: null,
      created_at: '2026-01-01',
    } as any);
    expect(settlementRowNull.amount).toBe(0);

    const settlementInsert = mapDomainToSettlementInsert({
      workspace_id: 'ws-1',
      from_member_id: 'm-1',
      to_member_id: 'm-2',
      amount: 40,
      settlement_date: '2026-04-01',
      notes: undefined,
      payment_account_id: undefined,
    });
    expect(settlementInsert.notes).toBeNull();
    expect(settlementInsert.payment_account_id).toBeNull();

    // 4. Budget & Goal
    const budgetRowNull = mapBudgetRowToDomain({
      id: 'b-null',
      workspace_id: 'ws-1',
      category_id: 'cat-1',
      month: 4,
      year: 2026,
      planned_amount: null as any,
      created_at: '2026-01-01',
    });
    expect(budgetRowNull.planned_amount).toBe(0);

    const goalInsert = mapDomainToFinancialGoalInsert({
      workspace_id: 'ws-1',
      name: 'Carro',
      target_amount: 1000,
      current_amount: 100,
      status: 'in_progress',
      color: '#10b981',
      icon: 'target',
      target_date: undefined,
    });
    expect(goalInsert.target_date).toBeNull();

    // 5. Card & Bills
    const cardInsert = mapDomainToCreditCardInsert({
      workspace_id: 'ws-1',
      name: 'Cartao',
      institution: 'Banco',
      credit_limit: 1000,
      closing_day: 1,
      due_day: 10,
      color: '#000',
      active: true,
      last_four_digits: undefined,
      linked_payment_account_id: undefined,
    });
    expect(cardInsert.last_four_digits).toBeNull();
    expect(cardInsert.linked_payment_account_id).toBeNull();

    const billRowNull = mapCreditCardBillRowToDomain({
      id: 'bill-null',
      credit_card_id: 'c-1',
      workspace_id: 'ws-1',
      reference_month: '2026-04',
      closing_date: '2026-04-01',
      due_date: '2026-04-10',
      total_amount: null as any,
      paid_amount: null as any,
      status: null as any,
      paid_at: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    });
    expect(billRowNull.total_amount).toBe(0);
    expect(billRowNull.paid_amount).toBe(0);
    expect(billRowNull.status).toBe('open');

    // 6. Payments
    const payRowNull = mapPaymentRowToDomain({
      id: 'pay-null',
      workspace_id: 'ws-1',
      amount: null as any,
      payment_date: '2026-04-01',
      transaction_id: null,
      installment_id: null,
      credit_card_bill_id: null,
      account_id: null,
      payment_method_id: null,
      notes: null,
      created_by: null,
      created_at: '2026-01-01',
      affects_balance: null as any,
    });
    expect(payRowNull.amount).toBe(0);
    expect(payRowNull.affects_balance).toBe(true);

    const payInsert = mapDomainToPaymentInsert({
      workspace_id: 'ws-1',
      amount: 100,
      payment_date: '2026-04-01',
      transaction_id: undefined,
      installment_id: undefined,
      credit_card_bill_id: undefined,
      account_id: undefined,
      payment_method_id: undefined,
      notes: undefined,
      created_by: undefined,
      affects_balance: undefined as any,
    });
    expect(payInsert.transaction_id).toBeNull();
    expect(payInsert.notes).toBeNull();
    expect(payInsert.affects_balance).toBe(true);

    // 7. Payment Methods
    const pmInsert = mapDomainToPaymentMethodInsert({
      workspace_id: 'ws-1',
      name: 'Pix',
      type: 'pix',
      active: true,
      linked_account_id: undefined,
      credit_card_id: undefined,
    });
    expect(pmInsert.linked_account_id).toBeNull();
    expect(pmInsert.credit_card_id).toBeNull();

    // 8. Recurring
    const recInsert = mapDomainToRecurringInsert({
      workspace_id: 'ws-1',
      description: 'Rec',
      amount: 10,
      type: 'expense',
      frequency: 'monthly',
      start_date: '2026-01-01',
      next_occurrence: '2026-05-01',
      auto_create: false,
      active: true,
      category_id: undefined,
      account_id: undefined,
      payment_method_id: undefined,
      credit_card_id: undefined,
      interval_days: undefined,
      end_date: undefined,
      suspended_reason: undefined,
    });
    expect(recInsert.category_id).toBeNull();
    expect(recInsert.account_id).toBeNull();
    expect(recInsert.payment_method_id).toBeNull();
    expect(recInsert.credit_card_id).toBeNull();
    expect(recInsert.interval_days).toBeNull();
    expect(recInsert.end_date).toBeNull();
    expect(recInsert.suspended_reason).toBeNull();

    // 9. Purchases & Splits
    const pSplitsToInsert = mapDomainPurchaseSplitsToInsert('p-1', 'ws-1', [
      { member_id: 'm-1', amount: 50, percentage: undefined },
    ]);
    expect(pSplitsToInsert[0].percentage).toBeNull();

    const pInsert = mapDomainToPurchaseInsert({
      workspace_id: 'ws-1',
      description: 'Purchase with optionals',
      total_amount: 100,
      installment_count: 2,
      purchase_date: '2026-04-01',
      credit_card_id: undefined,
      category_id: undefined,
      paid_installments_count: undefined,
      paid_by_member_id: undefined,
      split_type: undefined,
      created_by: undefined,
    });
    expect(pInsert.credit_card_id).toBeNull();
    expect(pInsert.category_id).toBeNull();
    expect(pInsert.paid_installments_count).toBe(0);
    expect(pInsert.paid_by_member_id).toBeNull();
    expect(pInsert.split_type).toBe('individual');
    expect(pInsert.created_by).toBeNull();

    // 10. Transactions & Splits
    const txSplitsToInsert = mapDomainSplitsToInsert('tx-1', 'ws-1', [
      { member_id: 'm-1', amount: 50, percentage: undefined },
      { member_id: 'm-2', amount: 50, percentage: 50 },
    ]);
    expect(txSplitsToInsert[0].percentage).toBeNull();
    expect(txSplitsToInsert[1].percentage).toBe(50);

    const txSplitsWithPercentage = mapTransactionSplitsToDomain([
      { id: 'ts-p', transaction_id: 'tx-1', workspace_id: 'ws-1', member_id: 'm-1', amount: 50, percentage: 50, created_at: '2026-01-01', updated_at: '2026-01-01' },
      { id: 'ts-np', transaction_id: 'tx-1', workspace_id: 'ws-1', member_id: 'm-2', amount: 50, percentage: null, created_at: '2026-01-01', updated_at: '2026-01-01' },
    ]);
    expect(txSplitsWithPercentage[0].percentage).toBe(50);
    expect(txSplitsWithPercentage[1].percentage).toBeUndefined();

    const pSplitsWithPercentage = mapPurchaseSplitsToDomain([
      { id: 'ps-p', purchase_id: 'p-1', workspace_id: 'ws-1', member_id: 'm-1', amount: 50, percentage: 50, created_at: '2026-01-01', updated_at: '2026-01-01' },
      { id: 'ps-np', purchase_id: 'p-1', workspace_id: 'ws-1', member_id: 'm-2', amount: 50, percentage: null, created_at: '2026-01-01', updated_at: '2026-01-01' },
    ]);
    expect(pSplitsWithPercentage[0].percentage).toBe(50);
    expect(pSplitsWithPercentage[1].percentage).toBeUndefined();

    const pWithInstallments = mapPurchaseRowToDomain(
      {
        id: 'p-insts',
        workspace_id: 'ws-1',
        description: 'With Insts',
        total_amount: 100,
        installment_count: 1,
        purchase_date: '2026-04-01',
        paid_installments_count: 1,
        account_id: null,
        credit_card_id: null,
        category_id: null,
        payment_method_id: null,
        paid_by_member_id: null,
        split_type: 'individual',
        created_by: null,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
      undefined,
      [
        {
          id: 'i-1',
          purchase_id: 'p-insts',
          installment_number: 1,
          amount: 100,
          due_date: '2026-05-01',
          credit_card_bill_id: 'bill-1',
          status: 'paid',
          paid_amount: 100,
          paid_at: '2026-05-01',
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
        },
      ]
    );
    expect(pWithInstallments.installments?.length).toBe(1);

    const instInsertWithOptionals = mapDomainToInstallmentInsert({
      id: 'i-full',
      purchase_id: 'p-1',
      installment_number: 1,
      amount: 100,
      due_date: '2026-05-01',
      credit_card_bill_id: 'bill-1',
      status: 'paid',
      paid_amount: 100,
      paid_at: '2026-05-01',
    });
    expect(instInsertWithOptionals.credit_card_bill_id).toBe('bill-1');
    expect(instInsertWithOptionals.paid_at).toBe('2026-05-01');

    const txInsert = mapDomainToTransactionInsert({
      workspace_id: 'ws-1',
      description: 'Tx with optionals',
      amount: 100,
      type: 'expense',
      transaction_date: '2026-04-01',
      due_date: '2026-04-01',
      status: 'pending',
      payment_method_id: undefined,
      paid_by_member_id: undefined,
      split_type: undefined,
      notes: undefined,
      created_by: undefined,
      paid_at: undefined,
    });
    expect(txInsert.payment_method_id).toBeNull();
    expect(txInsert.paid_by_member_id).toBeNull();
    expect(txInsert.split_type).toBe('individual');
    expect(txInsert.notes).toBeNull();
    expect(txInsert.created_by).toBeNull();
    expect(txInsert.paid_at).toBeNull();
  });

  it('preserves undefined in insert mappers when optional monetary fields are omitted', () => {
    const acc = mapDomainToAccountInsert({ name: 'A', workspace_id: 'ws-1' } as any);
    expect(acc.initial_balance).toBeUndefined();
    expect(acc.current_balance).toBeUndefined();

    const card = mapDomainToCreditCardInsert({ name: 'C', workspace_id: 'ws-1' } as any);
    expect(card.credit_limit).toBeUndefined();

    const budget = mapDomainToBudgetInsert({ category_id: 'cat-1', workspace_id: 'ws-1', month: 1, year: 2026 } as any);
    expect(budget.planned_amount).toBeUndefined();

    const goal = mapDomainToFinancialGoalInsert({ name: 'G', workspace_id: 'ws-1' } as any);
    expect(goal.target_amount).toBeUndefined();
    expect(goal.current_amount).toBeUndefined();
  });
});
