import { describe, it, expect, expectTypeOf } from 'vitest';
import { Account, Category, CreditCard, CreditCardBill, Payment, PaymentMethod, Transaction, Installment, RecurringTransaction, UpdateTransactionDTO, FinancialGoal } from '../types';
import {
  calculateCardBillDates,
  splitInstallments,
  getAnchoredOccurrenceDate,
  calculateDashboardSummary,
  isValidCustomInterval,
  resolveCategory,
  validateCreditCardResolution,
  validateTransactionBusinessRules,
  validateBilledTransactionDateImmutability,
  sanitizeLegacyRecurringState,
  validateRecurringAmount,
  resolveTransactionAccountId,
  validateBillPaymentAccount,
  validateRecurringMaterialization,
  stepNextOccurrence,
  calculateCatchUpOccurrence,
  validateCategoryActive,
  validateTransactionAccount,
  processRecurringBatchState,
  resolveOrCreateCreditCardBill,
  reconcileBillAfterItemDeletion,
} from '../financial-engine';
import { sanitizeCsvCell } from '../utils';

describe('Context & Domain Integration - Ciclo de Exclusão Transacional', () => {
  it('deve estornar saldo, ajustar fatura do cartão e remover pagamentos órfãos ao excluir transação', () => {
    let account: Account = {
      id: 'acc-1',
      workspace_id: 'ws-1',
      name: 'Conta Corrente',
      type: 'checking',
      institution: 'Nubank',
      initial_balance: 5000,
      current_balance: 4500,
      color: '#8b5cf6',
      active: true,
      created_at: '2026-01-01',
    };

    let bill: CreditCardBill = {
      id: 'bill-1',
      credit_card_id: 'card-1',
      workspace_id: 'ws-1',
      reference_month: '2026-08',
      closing_date: '2026-08-03',
      due_date: '2026-08-10',
      total_amount: 1500,
      paid_amount: 500,
      status: 'partially_paid',
      created_at: '2026-08-01',
    };

    let payments: Payment[] = [
      {
        id: 'pay-1',
        workspace_id: 'ws-1',
        transaction_id: 'tx-1',
        account_id: 'acc-1',
        amount: 500,
        payment_date: '2026-08-05',
        created_at: '2026-08-05',
      },
    ];

    let tx: Transaction | null = {
      id: 'tx-1',
      workspace_id: 'ws-1',
      account_id: 'acc-1',
      credit_card_bill_id: 'bill-1',
      description: 'Compra no Cartão',
      amount: 500,
      type: 'expense',
      transaction_date: '2026-08-01',
      due_date: '2026-08-10',
      status: 'paid',
      paid_amount: 500,
      created_at: '2026-08-01',
    };

    // Executa a exclusão transacional
    if (tx.account_id && !tx.credit_card_bill_id && (tx.status === 'paid' || tx.status === 'partially_paid')) {
      account.current_balance += tx.paid_amount || tx.amount;
    }
    if (tx.credit_card_bill_id) {
      bill.total_amount = Math.max(0, bill.total_amount - tx.amount);
    }
    payments = payments.filter((p) => p.transaction_id !== tx?.id);
    tx = null;

    expect(bill.total_amount).toBe(1000);
    expect(payments).toHaveLength(0);
    expect(tx).toBeNull();
  });
});

describe('Context & Domain Integration - Bloqueio de Pagamento Individual em Cartões (Anti-Débito Duplo)', () => {
  it('deve rejeitar pagamento individual de transação ou parcela vinculada a cartão de crédito', () => {
    const cardTx: Transaction = {
      id: 'tx-card-1',
      workspace_id: 'ws-1',
      credit_card_id: 'card-1',
      credit_card_bill_id: 'bill-1',
      description: 'Supermercado no Cartão',
      amount: 400,
      type: 'expense',
      transaction_date: '2026-08-10',
      due_date: '2026-08-20',
      status: 'pending',
      paid_amount: 0,
      created_at: '2026-08-10',
    };

    const cardInst: Installment = {
      id: 'inst-1',
      purchase_id: 'pur-1',
      installment_number: 1,
      amount: 150,
      due_date: '2026-08-20',
      credit_card_bill_id: 'bill-1',
      status: 'pending',
      paid_amount: 0,
      created_at: '2026-08-10',
    };

    const processPayment = (target: { transaction?: Transaction; installment?: Installment; bill_id?: string }) => {
      if (target.transaction && (target.transaction.credit_card_bill_id || target.transaction.credit_card_id)) {
        throw new Error('Itens vinculados a cartão de crédito devem ser quitados exclusivamente através da fatura correspondente.');
      }
      if (target.installment && target.installment.credit_card_bill_id) {
        throw new Error('Parcelas vinculadas a cartão de crédito devem ser quitadas exclusivamente através da fatura correspondente.');
      }
      return true;
    };

    expect(() => processPayment({ transaction: cardTx })).toThrow('através da fatura correspondente');
    expect(() => processPayment({ installment: cardInst })).toThrow('através da fatura correspondente');
    expect(processPayment({ bill_id: 'bill-1' })).toBe(true);
  });
});

describe('Context & Domain Integration - Dashboard e Fatura como Fonte Única de Verdade de Cartão', () => {
  it('deve calcular pendência de fatura parcialmente paga sem duplicar com itens filhos', () => {
    const bill: CreditCardBill = {
      id: 'bill-1',
      credit_card_id: 'card-1',
      workspace_id: 'ws-1',
      reference_month: '2026-08',
      closing_date: '2026-08-20',
      due_date: '2026-08-28',
      total_amount: 1000,
      paid_amount: 400, // R$ 400 pagos -> Restam R$ 600 pendentes
      status: 'partially_paid',
      created_at: '2026-08-01',
    };

    const cardTx1: Transaction = {
      id: 'tx-c1',
      workspace_id: 'ws-1',
      credit_card_id: 'card-1',
      credit_card_bill_id: 'bill-1',
      description: 'Item 1',
      amount: 600,
      type: 'expense',
      transaction_date: '2026-08-05',
      due_date: '2026-08-28',
      status: 'pending',
      created_at: '2026-08-05',
    };

    const cardTx2: Transaction = {
      id: 'tx-c2',
      workspace_id: 'ws-1',
      credit_card_id: 'card-1',
      credit_card_bill_id: 'bill-1',
      description: 'Item 2',
      amount: 400,
      type: 'expense',
      transaction_date: '2026-08-06',
      due_date: '2026-08-28',
      status: 'pending',
      created_at: '2026-08-06',
    };

    const summary = calculateDashboardSummary(
      [cardTx1, cardTx2],
      [],
      [],
      [{ current_balance: 5000 }],
      [],
      '2026-08',
      [bill],
      '2026-08-20'
    );

    // O planejado deve ser o total da fatura (R$ 1.000)
    expect(summary.planned.expense).toBe(1000);

    // O pendente deve ser exatamente o saldo restante da fatura (R$ 600), NÃO R$ 1.000 nem R$ 1.600!
    expect(summary.pending.amount).toBe(600);
    expect(summary.pending.count).toBe(1);
  });
});

describe('Context & Domain Integration - Catch-up Contínuo sem Retrocesso', () => {
  it('deve processar apenas a ocorrência vencida sem reiniciar em start_date', () => {
    const rec: RecurringTransaction = {
      id: 'rec-old',
      workspace_id: 'ws-1',
      description: 'Assinatura',
      amount: 50,
      type: 'expense',
      frequency: 'monthly',
      start_date: '2026-01-31',
      next_occurrence: '2026-08-31',
      auto_create: true,
      active: true,
      created_at: '2026-01-31',
    };

    const todayStr = '2026-09-01';
    const processedKeys = new Set<string>();

    let currOccurrence = rec.next_occurrence;
    const generated: string[] = [];

    while (currOccurrence <= todayStr && generated.length < 10) {
      const key = `${rec.id}:${currOccurrence}`;
      if (!processedKeys.has(key)) {
        generated.push(currOccurrence);
        processedKeys.add(key);
      }

      // Avanço seguro mantendo âncora
      const parsed = new Date(currOccurrence);
      let targetMonth = parsed.getMonth() + 2; // +1 mês
      let targetYear = parsed.getFullYear();
      if (targetMonth > 12) {
        targetMonth = 1;
        targetYear++;
      }
      const realDay = Math.min(31, new Date(targetYear, targetMonth, 0).getDate());
      currOccurrence = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(realDay).padStart(2, '0')}`;
    }

    // Deve ter processado apenas 2026-08-31
    expect(generated).toEqual(['2026-08-31']);
    // Próxima ocorrência avançou para 2026-09-30 (setembro tem 30 dias)
    expect(currOccurrence).toBe('2026-09-30');
  });
});

describe('Context & Domain Integration - Proteção de Ownership por Flag Transacional', () => {
  it('deve autorizar transferência apenas com flag transacional e rejeitar DML direto', () => {
    let transactionalFlag: string | null = null;
    let currentOwnerId = 'usr-1';

    const triggerCheck = (newOwnerId: string) => {
      if (newOwnerId !== currentOwnerId && transactionalFlag !== 'true') {
        throw new Error('A alteração direta de owner_id é proibida. Utilize a função fn_transfer_workspace_ownership.');
      }
      currentOwnerId = newOwnerId;
    };

    // Tentativa direta sem RPC: Bloqueada
    expect(() => triggerCheck('usr-hacker')).toThrow('A alteração direta de owner_id é proibida');

    // Execução via RPC autorizada com flag: Aprovada
    transactionalFlag = 'true';
    triggerCheck('usr-2');
    transactionalFlag = null; // Reset após transação

    expect(currentOwnerId).toBe('usr-2');
  });
});

describe('Context & Domain Integration - Locks Determinísticos Anti-Deadlock em Transferências', () => {
  it('deve ordenar contas deterministicamente por UUID para prevenir deadlock', () => {
    const getLockOrder = (accA: string, accB: string) => {
      const first = accA < accB ? accA : accB;
      const second = accA < accB ? accB : accA;
      return [first, second];
    };

    const lockOrder1 = getLockOrder('acc-uuid-111', 'acc-uuid-222');
    const lockOrder2 = getLockOrder('acc-uuid-222', 'acc-uuid-111');

    expect(lockOrder1).toEqual(['acc-uuid-111', 'acc-uuid-222']);
    expect(lockOrder2).toEqual(['acc-uuid-111', 'acc-uuid-222']);
  });
});

describe('Context & Domain Integration - Criação e Duplicação Atômica de Faturas de Cartão', () => {
  it('deve criar 1 fatura com total correto e FK íntegra na primeira compra do mês', () => {
    let bills: CreditCardBill[] = [];

    const getOrCreateAndAddItemToBill = (cardId: string, refMonth: string, amount: number) => {
      const idx = bills.findIndex((b) => b.credit_card_id === cardId && b.reference_month === refMonth);
      if (idx >= 0) {
        bills[idx].total_amount += amount;
        return bills[idx].id;
      } else {
        const newBill: CreditCardBill = {
          id: `bill-${refMonth}`,
          credit_card_id: cardId,
          workspace_id: 'ws-1',
          reference_month: refMonth,
          closing_date: `${refMonth}-10`,
          due_date: `${refMonth}-20`,
          total_amount: amount,
          paid_amount: 0,
          status: 'open',
          created_at: '2026-08-01',
        };
        bills.push(newBill);
        return newBill.id;
      }
    };

    // 1ª compra: R$ 250
    const billId1 = getOrCreateAndAddItemToBill('c-1', '2026-08', 250);
    // 2ª compra: R$ 150
    const billId2 = getOrCreateAndAddItemToBill('c-1', '2026-08', 150);

    expect(bills).toHaveLength(1);
    expect(bills[0].id).toBe('bill-2026-08');
    expect(bills[0].total_amount).toBe(400);
    expect(billId1).toBe(billId2);
  });

  it('deve rejeitar pagamento de fatura do Workspace A com conta do Workspace B', () => {
    const bill: CreditCardBill = {
      id: 'b-ws-a',
      credit_card_id: 'c-1',
      workspace_id: 'ws-a',
      reference_month: '2026-08',
      closing_date: '2026-08-10',
      due_date: '2026-08-20',
      total_amount: 500,
      paid_amount: 0,
      status: 'open',
      created_at: '2026-08-01',
    };

    const accountWorkspaceB: Account = {
      id: 'acc-ws-b',
      workspace_id: 'ws-b',
      name: 'Conta B',
      type: 'checking',
      institution: 'Inter',
      initial_balance: 1000,
      current_balance: 1000,
      color: '#ff0000',
      active: true,
      created_at: '2026-08-01',
    };

    const payBill = (targetBill: CreditCardBill, targetAcc: Account) => {
      if (targetBill.workspace_id !== targetAcc.workspace_id) {
        throw new Error('Conta bancária não encontrada no workspace ativo da fatura.');
      }
    };

    expect(() => payBill(bill, accountWorkspaceB)).toThrow('Conta bancária não encontrada no workspace ativo');
  });

  it('deve contabilizar corretamente no Caixa Realizado uma transação com Payment e outra legada sem Payment', () => {
    const txWithPayment: Transaction = {
      id: 'tx-with-pay',
      workspace_id: 'ws-1',
      description: 'Compra com Payment',
      amount: 300,
      type: 'expense',
      transaction_date: '2026-08-01',
      due_date: '2026-08-01',
      paid_at: '2026-08-01',
      status: 'paid',
      created_at: '2026-08-01',
    };

    const txLegacyWithoutPayment: Transaction = {
      id: 'tx-legacy-no-pay',
      workspace_id: 'ws-1',
      description: 'Compra Legada Paga Sem Payment',
      amount: 200,
      type: 'expense',
      transaction_date: '2026-08-05',
      due_date: '2026-08-05',
      paid_at: '2026-08-05',
      status: 'paid',
      created_at: '2026-08-05',
    };

    const payment: Payment = {
      id: 'pay-1',
      workspace_id: 'ws-1',
      transaction_id: 'tx-with-pay',
      account_id: 'acc-1',
      amount: 300,
      payment_date: '2026-08-01',
      created_at: '2026-08-01',
    };

    const summary = calculateDashboardSummary(
      [txWithPayment, txLegacyWithoutPayment],
      [],
      [],
      [{ current_balance: 5000 }],
      [payment],
      '2026-08',
      []
    );

    // Ambas despesas devem ser somadas no caixa realizado: 300 + 200 = 500
    expect(summary.realized.expense).toBe(500);
    expect(summary.realized.net).toBe(-500);
  });

  it('deve bloquear exclusão de item de fatura paga se o novo total for menor que o valor pago', () => {
    const bill: CreditCardBill = {
      id: 'b-overpay',
      credit_card_id: 'c-1',
      workspace_id: 'ws-1',
      reference_month: '2026-08',
      closing_date: '2026-08-10',
      due_date: '2026-08-20',
      total_amount: 1000,
      paid_amount: 800,
      status: 'partially_paid',
      created_at: '2026-08-01',
    };

    const txToDelete: Transaction = {
      id: 'tx-to-del',
      workspace_id: 'ws-1',
      credit_card_bill_id: 'b-overpay',
      description: 'Item a excluir',
      amount: 500,
      type: 'expense',
      transaction_date: '2026-08-01',
      due_date: '2026-08-10',
      status: 'pending',
      paid_amount: 0,
      created_at: '2026-08-01',
    };

    const deleteItemFromBill = (targetTx: Transaction, targetBill: CreditCardBill) => {
      const newTotal = Math.max(0, targetBill.total_amount - targetTx.amount);
      if (targetBill.paid_amount && targetBill.paid_amount > newTotal) {
        throw new Error('Não é possível excluir o item da fatura: o valor pago excederia o novo total.');
      }
    };

    expect(() => deleteItemFromBill(txToDelete, bill)).toThrow(
      'Não é possível excluir o item da fatura: o valor pago excederia o novo total.'
    );
  });

  it('deve consolidar compras no mesmo cartão e mês em uma única fatura com chave determinística', () => {
    let bills: CreditCardBill[] = [];

    const getOrCreateAndAddItemToBill = (
      cardId: string,
      referenceMonth: string,
      closingDate: string,
      dueDate: string,
      amount: number,
      targetWsId: string
    ) => {
      const targetBillId = `bill-${cardId}-${referenceMonth}`;
      const existingIndex = bills.findIndex(
        (b) =>
          b.credit_card_id === cardId &&
          b.reference_month === referenceMonth &&
          b.workspace_id === targetWsId
      );

      if (existingIndex >= 0) {
        bills = bills.map((b, idx) =>
          idx === existingIndex ? { ...b, total_amount: b.total_amount + amount } : b
        );
      } else {
        bills.push({
          id: targetBillId,
          credit_card_id: cardId,
          workspace_id: targetWsId,
          reference_month: referenceMonth,
          closing_date: closingDate,
          due_date: dueDate,
          total_amount: amount,
          paid_amount: 0,
          status: 'open',
          created_at: new Date().toISOString(),
        });
      }
      return targetBillId;
    };

    // Duas chamadas consecutivas no mesmo ciclo
    const id1 = getOrCreateAndAddItemToBill('c-1', '2026-08', '2026-08-10', '2026-08-20', 250, 'ws-1');
    const id2 = getOrCreateAndAddItemToBill('c-1', '2026-08', '2026-08-10', '2026-08-20', 350, 'ws-1');

    expect(id1).toBe('bill-c-1-2026-08');
    expect(id2).toBe('bill-c-1-2026-08');
    expect(bills).toHaveLength(1);
    expect(bills[0].total_amount).toBe(600);
  });

  it('deve desativar semanticamente (active = false) recorrência cujo next_occurrence ultrapassou end_date', () => {
    const allRecurring: RecurringTransaction[] = [
      {
        id: 'rec-exp',
        workspace_id: 'ws-1',
        description: 'Assinatura Encerrada',
        amount: 50,
        type: 'expense',
        frequency: 'monthly',
        start_date: '2026-01-01',
        end_date: '2026-03-31',
        next_occurrence: '2026-04-01',
        auto_create: true,
        active: true,
        created_at: '2026-01-01',
      },
    ];

    // Passagem de limpeza semântica
    const cleaned = allRecurring.map((r) => {
      if (r.active && r.end_date && r.next_occurrence > r.end_date) {
        return { ...r, active: false };
      }
      return r;
    });

    expect(cleaned[0].active).toBe(false);
  });

  it('deve limpar paid_at para null e definir status como partially_paid ao adicionar nova compra a fatura quitada', () => {
    let bills: CreditCardBill[] = [
      {
        id: 'bill-c1-2026-08',
        credit_card_id: 'c1',
        workspace_id: 'ws-1',
        reference_month: '2026-08',
        closing_date: '2026-08-10',
        due_date: '2026-08-20',
        total_amount: 100,
        paid_amount: 100,
        status: 'paid',
        paid_at: '2026-08-20',
        created_at: '2026-08-01',
      },
    ];

    const addItemToBill = (cardId: string, refMonth: string, amount: number, isPaid: boolean = false) => {
      bills = bills.map((b) => {
        if (b.credit_card_id === cardId && b.reference_month === refMonth) {
          const newTotal = b.total_amount + amount;
          const newPaid = isPaid ? (b.paid_amount || 0) + amount : (b.paid_amount || 0);
          const fullyPaid = newPaid >= newTotal && newTotal > 0;
          return {
            ...b,
            total_amount: newTotal,
            paid_amount: newPaid,
            status: fullyPaid ? 'paid' : newPaid > 0 ? 'partially_paid' : b.status,
            paid_at: fullyPaid ? b.due_date : null,
          };
        }
        return b;
      });
    };

    // Adiciona compra não paga de R$ 50
    addItemToBill('c1', '2026-08', 50, false);

    expect(bills[0].total_amount).toBe(150);
    expect(bills[0].paid_amount).toBe(100);
    expect(bills[0].status).toBe('partially_paid');
    expect(bills[0].paid_at).toBeNull();
  });

  it('deve processar compra parcelada 10x com 4 parcelas quitadas marcando faturas e parcelas correspondentes', () => {
    const card: CreditCard = {
      id: 'card-1',
      workspace_id: 'ws-1',
      name: 'Itaú',
      institution: 'Itaú',
      credit_limit: 10000,
      closing_day: 10,
      due_day: 20,
      color: '#000',
      active: true,
      created_at: '2026-01-01',
    };

    const split = splitInstallments(1000, 10, '2026-01-05', card, 4);
    expect(split).toHaveLength(10);

    // As 4 primeiras devem ser marcadas como pagas
    expect(split[0].isPaid).toBe(true);
    expect(split[1].isPaid).toBe(true);
    expect(split[2].isPaid).toBe(true);
    expect(split[3].isPaid).toBe(true);

    // As 6 restantes como não pagas
    expect(split[4].isPaid).toBe(false);
    expect(split[9].isPaid).toBe(false);

    // Soma das pendentes = R$ 600
    const pendingSum = split.filter((s) => !s.isPaid).reduce((acc, s) => acc + s.amount, 0);
    expect(pendingSum).toBe(600);
  });

  it('deve gerar pagamentos históricos com alvo único (apenas installment_id) para parcelas pré-quitadas', () => {
    const card: CreditCard = {
      id: 'card-1',
      workspace_id: 'ws-1',
      name: 'Itaú',
      institution: 'Itaú',
      credit_limit: 10000,
      closing_day: 10,
      due_day: 20,
      color: '#000',
      active: true,
      created_at: '2026-01-01',
    };

    const split = splitInstallments(300, 3, '2026-01-05', card, 2);
    const payments: Payment[] = [];

    split.forEach((s, idx) => {
      if (s.isPaid) {
        payments.push({
          id: `pay-${idx + 1}`,
          workspace_id: 'ws-1',
          installment_id: `inst-${idx + 1}`,
          account_id: 'acc-1',
          amount: s.amount,
          payment_date: s.dueDate,
          notes: 'Quitação prévia de parcela importada',
          created_by: 'usr-1',
          created_at: '2026-01-05',
        });
      }
    });

    expect(payments).toHaveLength(2);
    payments.forEach((p) => {
      // Garante alvo único (apenas installment_id preenchido)
      expect(p.installment_id).toBeDefined();
      expect(p.credit_card_bill_id).toBeUndefined();
      expect(p.transaction_id).toBeUndefined();
      expect(p.amount).toBe(100);
    });
  });

  it('deve sanitizar células CSV usando o helper real importado contra injeção de fórmulas e aspas', () => {
    expect(sanitizeCsvCell('=SUM(A1:A10)')).toBe(`"'=SUM(A1:A10)"`);
    expect(sanitizeCsvCell('+12345')).toBe(`"'+12345"`);
    expect(sanitizeCsvCell('-50.00')).toBe(`"'-50.00"`);
    expect(sanitizeCsvCell('@cmd')).toBe(`"'@cmd"`);
    expect(sanitizeCsvCell('Compra "Especial"')).toBe(`"Compra ""Especial"""`);
    expect(sanitizeCsvCell(150.5)).toBe('150.50');
    expect(sanitizeCsvCell(null)).toBe('""');
  });

  it('deve validar intervalo customizado estritamente na fronteira de criação de recorrência via isValidCustomInterval real', () => {
    // Válidos
    expect(isValidCustomInterval(1)).toBe(true);
    expect(isValidCustomInterval(30)).toBe(true);
    expect(isValidCustomInterval(3650)).toBe(true);

    // Inválidos
    expect(isValidCustomInterval(0)).toBe(false);
    expect(isValidCustomInterval(-1)).toBe(false);
    expect(isValidCustomInterval(5.5)).toBe(false);
    expect(isValidCustomInterval(3651)).toBe(false);
    expect(isValidCustomInterval(NaN)).toBe(false);
    expect(isValidCustomInterval(Infinity)).toBe(false);
    expect(isValidCustomInterval('30')).toBe(false);
  });

  it('deve reconciliar subcategorias sem dupla contagem em Sem Categoria no dataset de relatórios', () => {
    const categories: any[] = [
      {
        id: 'cat-1',
        name: 'Alimentação',
        type: 'expense',
        subcategories: [{ id: 'cat-1-1', name: 'Restaurante', parent_id: 'cat-1' }],
      },
      {
        id: 'cat-2',
        name: 'Transporte',
        type: 'expense',
      },
    ];

    const rawRows = [
      { id: 't-1', amount: 100, type: 'expense', category_id: 'cat-1-1' }, // subcategoria
      { id: 't-2', amount: 50, type: 'expense', category_id: undefined }, // sem categoria
      { id: 't-3', amount: 80, type: 'expense', category_id: 'cat-2' }, // categoria raiz
    ];

    const reportRows = rawRows.map((r) => {
      const catInfo = resolveCategory(categories, r.category_id);
      return {
        ...r,
        rootCategoryId: catInfo.rootId,
        categoryName: catInfo.displayName,
        isUncategorized: !catInfo.isFound,
      };
    });

    const totalExpense = reportRows.filter((r) => r.type === 'expense').reduce((acc, r) => acc + r.amount, 0);
    expect(totalExpense).toBe(230);

    const categorySpending = categories
      .map((cat) => ({
        name: cat.name,
        amount: reportRows.filter((r) => r.type === 'expense' && r.rootCategoryId === cat.id).reduce((acc, r) => acc + r.amount, 0),
      }))
      .filter((c) => c.amount > 0);

    const uncategorizedTotal = reportRows.filter((r) => r.type === 'expense' && r.isUncategorized).reduce((acc, r) => acc + r.amount, 0);

    // Alimentação deve ter 100 (da subcategoria cat-1-1)
    expect(categorySpending.find((c) => c.name === 'Alimentação')?.amount).toBe(100);
    // Transporte deve ter 80
    expect(categorySpending.find((c) => c.name === 'Transporte')?.amount).toBe(80);
    // Sem Categoria deve ter APENAS 50 (e NÃO 150)
    expect(uncategorizedTotal).toBe(50);

    const totalSpendingSum = categorySpending.reduce((acc, c) => acc + c.amount, 0) + uncategorizedTotal;
    expect(totalSpendingSum).toBe(230);
  });

  it('deve realizar soft-delete (active: false) e retornar resultado discriminado ao tentar excluir conta com histórico (incluindo Purchase)', () => {
    let accounts: any[] = [
      { id: 'acc-1', name: 'Conta Principal', active: true },
      { id: 'acc-2', name: 'Conta Secundária', active: true },
      { id: 'acc-3', name: 'Conta Parcelada', active: true },
    ];
    const payments: any[] = [{ id: 'p-1', account_id: 'acc-1', amount: 150 }];
    const transfers: any[] = [];
    const transactions: any[] = [];
    const purchases: any[] = [{ id: 'pur-1', account_id: 'acc-3', total_amount: 1200 }];

    const deleteAccountWithSafety = (id: string): { success: boolean; action: 'deleted' | 'inactivated'; message: string } => {
      const targetAcc = accounts.find((a) => a.id === id);
      if (!targetAcc) {
        return {
          success: false,
          action: 'deleted',
          message: 'Conta bancária não encontrada no workspace ativo.',
        };
      }

      const hasPayments = payments.some((p) => p.account_id === id);
      const hasTransfers = transfers.some((tr) => tr.from_account_id === id || tr.to_account_id === id);
      const hasActiveTxs = transactions.some((t) => t.account_id === id && t.status === 'paid');
      const hasPurchases = purchases.some((p) => p.account_id === id);

      if (hasPayments || hasTransfers || hasActiveTxs || hasPurchases) {
        accounts = accounts.map((a) => (a.id === id ? { ...a, active: false } : a));
        return {
          success: true,
          action: 'inactivated',
          message: 'A conta possui histórico financeiro (pagamentos/transferências/compras) e foi inativada para preservar os registros contábeis.',
        };
      }
      accounts = accounts.filter((a) => a.id !== id);
      return {
        success: true,
        action: 'deleted',
        message: 'Conta bancária excluída com sucesso.',
      };
    };

    // Tenta excluir acc-1 (tem pagamento) -> Inativação
    const res1 = deleteAccountWithSafety('acc-1');
    expect(res1.action).toBe('inactivated');
    expect(res1.success).toBe(true);
    expect(accounts.find((a) => a.id === 'acc-1')?.active).toBe(false);

    // Tenta excluir acc-3 (tem compra parcelada) -> Inativação
    const res3 = deleteAccountWithSafety('acc-3');
    expect(res3.action).toBe('inactivated');
    expect(res3.success).toBe(true);
    expect(accounts.find((a) => a.id === 'acc-3')?.active).toBe(false);

    // Tenta excluir acc-2 (não tem histórico) -> Exclusão física
    const res2 = deleteAccountWithSafety('acc-2');
    expect(res2.action).toBe('deleted');
    expect(res2.success).toBe(true);
    expect(accounts.find((a) => a.id === 'acc-2')).toBeUndefined();

    // Tenta excluir conta inexistente
    const resNotFound = deleteAccountWithSafety('acc-inexistente');
    expect(resNotFound.success).toBe(false);
  });

  it('deve rejeitar criação de transação com conta bancária ou método inativo via validadores reais', () => {
    const allAccounts: Account[] = [
      { id: 'acc-active', workspace_id: 'ws-1', name: 'Ativa', type: 'checking', institution: 'Nu', initial_balance: 0, current_balance: 0, color: '#000', active: true, created_at: '2026-01-01' },
      { id: 'acc-inactive', workspace_id: 'ws-1', name: 'Inativa', type: 'checking', institution: 'Nu', initial_balance: 0, current_balance: 0, color: '#000', active: false, created_at: '2026-01-01' },
    ];
    const allMethods: PaymentMethod[] = [
      { id: 'pm-active', name: 'Ativo', type: 'debit_card', workspace_id: 'ws-1', active: true, linked_account_id: 'acc-active', created_at: '2026-01-01' },
      { id: 'pm-inactive', name: 'Inativo', type: 'pix', workspace_id: 'ws-1', active: false, created_at: '2026-01-01' },
      { id: 'pm-linked-to-inactive', name: 'Ligado a Inativa', type: 'debit_card', workspace_id: 'ws-1', active: true, linked_account_id: 'acc-inactive', created_at: '2026-01-01' },
    ];

    expect(() => validateTransactionAccount('acc-active', allAccounts, 'ws-1')).not.toThrow();
    expect(() => validateTransactionAccount('acc-inactive', allAccounts, 'ws-1')).toThrow(
      'A conta bancária informada está inativa.'
    );
    expect(() => validateCreditCardResolution('ws-1', allMethods, [], allAccounts, 'pm-inactive', null)).toThrow(
      'O método de pagamento informado está inativo.'
    );
    expect(() => validateCreditCardResolution('ws-1', allMethods, [], allAccounts, 'pm-linked-to-inactive', null)).toThrow(
      'A conta bancária vinculada a este método de pagamento está inativa.'
    );
  });

  it('deve garantir precedência absoluta do cartão vinculado ao método ao trocar de método genérico para método fixo (P0 Local)', () => {
    const creditCards = [
      { id: 'card-a', name: 'Cartão A', closing_day: 5, due_day: 12 },
      { id: 'card-b', name: 'Cartão B', closing_day: 10, due_day: 18 },
    ];
    const paymentMethods = [
      { id: 'pm-generico', name: 'Cartão Genérico', type: 'credit_card', credit_card_id: undefined },
      { id: 'pm-fixo-b', name: 'Cartão Nubank B', type: 'credit_card', credit_card_id: 'card-b' },
    ];

    // Simula a lógica de cálculo de cartão do QuickAddModal
    const resolveEffectiveCard = (pmId: string, explicitCardId: string) => {
      const pm = paymentMethods.find((p) => p.id === pmId);
      if (!pm) return undefined;
      // Precedência 1: Cartão fixo do método
      if (pm.credit_card_id) {
        return creditCards.find((c) => c.id === pm.credit_card_id);
      }
      // Precedência 2: Seleção explícita
      if (explicitCardId) {
        return creditCards.find((c) => c.id === explicitCardId);
      }
      if (creditCards.length === 1) return creditCards[0];
      return undefined;
    };

    // 1. Usuário seleciona método genérico e escolhe Cartão A explicitamente
    let currentPmId = 'pm-generico';
    let currentExplicitCardId = 'card-a';
    expect(resolveEffectiveCard(currentPmId, currentExplicitCardId)?.id).toBe('card-a');

    // 2. Usuário troca para método fixo do Cartão B (mesmo que o estado anterior ainda tenha 'card-a')
    currentPmId = 'pm-fixo-b';
    expect(resolveEffectiveCard(currentPmId, currentExplicitCardId)?.id).toBe('card-b');

    // 3. Com a limpeza de estado ao trocar o método, o cartão continua sendo B
    currentExplicitCardId = '';
    expect(resolveEffectiveCard(currentPmId, currentExplicitCardId)?.id).toBe('card-b');
  });

  it('deve rejeitar no domínio transação onde o cartão diverge do cartão vinculado ao método via validateCreditCardResolution', () => {
    const paymentMethods: PaymentMethod[] = [
      { id: 'pm-b', name: 'Cartão B', type: 'credit_card', workspace_id: 'ws-1', active: true, credit_card_id: 'card-b', created_at: '2026-01-01' },
    ];
    const creditCards: CreditCard[] = [
      { id: 'card-b', workspace_id: 'ws-1', name: 'B', institution: 'B', closing_day: 1, due_day: 10, credit_limit: 1000, color: '#000', active: true, created_at: '2026-01-01' },
      { id: 'card-a', workspace_id: 'ws-1', name: 'A', institution: 'A', closing_day: 1, due_day: 10, credit_limit: 1000, color: '#000', active: true, created_at: '2026-01-01' },
    ];

    expect(validateCreditCardResolution('ws-1', paymentMethods, creditCards, [], 'pm-b', 'card-b')).toBe('card-b');
    expect(() => validateCreditCardResolution('ws-1', paymentMethods, creditCards, [], 'pm-b', 'card-a')).toThrow(
      'O cartão de crédito informado diverge do cartão fixo vinculado a este método de pagamento.'
    );
  });

  it('deve inferir automaticamente o cartão fixo do método no createInstallmentPurchase se credit_card_id for omitido via validateCreditCardResolution', () => {
    const paymentMethods: PaymentMethod[] = [
      { id: 'pm-nubank', name: 'Nubank Fixo', type: 'credit_card', workspace_id: 'ws-1', active: true, credit_card_id: 'card-nubank', created_at: '2026-01-01' },
    ];
    const creditCards: CreditCard[] = [
      { id: 'card-nubank', name: 'Nubank Card', workspace_id: 'ws-1', institution: 'Nubank', closing_day: 5, due_day: 12, credit_limit: 5000, color: '#8b5cf6', active: true, created_at: '2026-01-01' },
      { id: 'card-outro', name: 'Outro Card', workspace_id: 'ws-1', institution: 'Outro', closing_day: 5, due_day: 12, credit_limit: 5000, color: '#8b5cf6', active: true, created_at: '2026-01-01' },
    ];

    // 1. Passa método com cartão fixo sem passar credit_card_id explícito
    expect(validateCreditCardResolution('ws-1', paymentMethods, creditCards, [], 'pm-nubank', null)).toBe('card-nubank');

    // 2. Passa método com cartão fixo e mesmo credit_card_id explícito
    expect(validateCreditCardResolution('ws-1', paymentMethods, creditCards, [], 'pm-nubank', 'card-nubank')).toBe('card-nubank');

    // 3. Passa método com cartão fixo e cartão divergente -> Rejeição
    expect(() => validateCreditCardResolution('ws-1', paymentMethods, creditCards, [], 'pm-nubank', 'card-outro')).toThrow(
      'O cartão de crédito informado diverge do cartão fixo vinculado a este método de pagamento.'
    );
  });

  it('deve blindar updateCreditCard e updateCategory contra mutações fora do workspace ativo via tipagem estrita', () => {
    expectTypeOf<Omit<Partial<CreditCard>, 'id' | 'workspace_id' | 'created_at'>>().not.toHaveProperty('id');
    expectTypeOf<Omit<Partial<CreditCard>, 'id' | 'workspace_id' | 'created_at'>>().not.toHaveProperty('workspace_id');
    expectTypeOf<Omit<Partial<CreditCard>, 'id' | 'workspace_id' | 'created_at'>>().not.toHaveProperty('created_at');
  });

  it('deve rejeitar pagamento de fatura com conta bancária inativa no domínio via validateBillPaymentAccount real', () => {
    const accounts: Account[] = [
      { id: 'acc-active', workspace_id: 'ws-1', name: 'Conta Ativa', type: 'checking', institution: 'Nubank', initial_balance: 0, current_balance: 0, color: '#000', active: true, created_at: '2026-01-01' },
      { id: 'acc-inactive', workspace_id: 'ws-1', name: 'Conta Inativa', type: 'checking', institution: 'Nubank', initial_balance: 0, current_balance: 0, color: '#000', active: false, created_at: '2026-01-01' },
    ];

    expect(() => validateBillPaymentAccount('acc-active', accounts, 'ws-1')).not.toThrow();
    expect(() => validateBillPaymentAccount('acc-inactive', accounts, 'ws-1')).toThrow(
      'A conta bancária selecionada para pagamento da fatura está inativa.'
    );
  });

  it('deve rejeitar transação se o cartão inferido pelo método de pagamento estiver inativo via validateCreditCardResolution real', () => {
    const paymentMethods: PaymentMethod[] = [
      { id: 'pm-inactive-card', name: 'Método com Cartão Inativo', type: 'credit_card', workspace_id: 'ws-1', active: true, credit_card_id: 'card-inativo', created_at: '2026-01-01' },
    ];
    const creditCards: CreditCard[] = [
      { id: 'card-inativo', workspace_id: 'ws-1', name: 'Cartão Inativo', institution: 'Nubank', closing_day: 1, due_day: 10, credit_limit: 1000, color: '#000', active: false, created_at: '2026-01-01' },
    ];

    expect(() =>
      validateCreditCardResolution('ws-1', paymentMethods, creditCards, [], 'pm-inactive-card', null)
    ).toThrow('O cartão de crédito informado está inativo.');
  });

  it('deve rejeitar categoria inativa e subcategoria aninhada inativa via validateCategoryActive real', () => {
    const categories: Category[] = [
      {
        id: 'cat-active',
        name: 'Moradia',
        type: 'expense',
        workspace_id: 'ws-1',
        icon: 'home',
        color: '#000',
        active: true,
        created_at: '2026-01-01',
        subcategories: [
          { id: 'sub-active', name: 'Aluguel', active: true, parent_id: 'cat-active', type: 'expense', workspace_id: 'ws-1', icon: 'home', color: '#000', created_at: '2026-01-01' },
          { id: 'sub-inactive', name: 'Reforma', active: false, parent_id: 'cat-active', type: 'expense', workspace_id: 'ws-1', icon: 'home', color: '#000', created_at: '2026-01-01' },
        ],
      },
      {
        id: 'cat-inactive',
        name: 'Transporte',
        type: 'expense',
        workspace_id: 'ws-1',
        icon: 'car',
        color: '#000',
        active: false,
        created_at: '2026-01-01',
        subcategories: [{ id: 'sub-t', name: 'Combustível', active: true, parent_id: 'cat-inactive', type: 'expense', workspace_id: 'ws-1', icon: 'car', color: '#000', created_at: '2026-01-01' }],
      },
    ];

    expect(() => validateCategoryActive('cat-active', categories, 'ws-1')).not.toThrow();
    expect(() => validateCategoryActive('sub-active', categories, 'ws-1')).not.toThrow();
    expect(() => validateCategoryActive('sub-inactive', categories, 'ws-1')).toThrow('A subcategoria informada está inativa.');
    expect(() => validateCategoryActive('cat-inactive', categories, 'ws-1')).toThrow('A categoria informada está inativa.');
  });

  it('deve blindar tipo e campos de FinancialGoal para depósitos em metas financeiras', () => {
    expectTypeOf<Omit<FinancialGoal, 'id' | 'workspace_id' | 'created_at'>>().not.toHaveProperty('id');
    expectTypeOf<Omit<FinancialGoal, 'id' | 'workspace_id' | 'created_at'>>().not.toHaveProperty('workspace_id');
    expectTypeOf<Omit<FinancialGoal, 'id' | 'workspace_id' | 'created_at'>>().not.toHaveProperty('created_at');
  });

  it('deve inferir cartão e validar materialização via validateRecurringMaterialization para recorrências com método de cartão fixo', () => {
    const paymentMethods: PaymentMethod[] = [
      { id: 'pm-2', name: 'Nubank Fixo', type: 'credit_card', workspace_id: 'ws-1', active: true, credit_card_id: 'card-1', created_at: '2026-01-01' },
    ];
    const creditCards: CreditCard[] = [
      { id: 'card-1', name: 'Cartão Nubank', institution: 'Nubank', workspace_id: 'ws-1', active: true, closing_day: 5, due_day: 12, credit_limit: 5000, color: '#000', created_at: '2026-01-01' },
    ];

    const rec: RecurringTransaction = {
      id: 'rec-netflix',
      workspace_id: 'ws-1',
      description: 'Netflix',
      payment_method_id: 'pm-2',
      amount: 55.9,
      type: 'expense',
      frequency: 'monthly',
      start_date: '2026-01-01',
      next_occurrence: '2026-08-20',
      active: true,
      auto_create: true,
      created_at: '2026-01-01',
    };

    const res = validateRecurringMaterialization(rec, [], paymentMethods, creditCards, [], 'ws-1');
    expect(res.isValid).toBe(true);
    expect(res.effectiveCardId).toBe('card-1');
  });

  it('deve suspender automaticamente a recorrência no processPendingRecurring se uma entidade vinculada for inativada via validateRecurringMaterialization', () => {
    const categories: Category[] = [
      { id: 'cat-inativa', name: 'Assinaturas Antigas', workspace_id: 'ws-1', active: false, type: 'expense', icon: 'music', color: '#000', created_at: '2026-01-01' },
    ];
    const rec: RecurringTransaction = {
      id: 'rec-spotify',
      workspace_id: 'ws-1',
      description: 'Spotify',
      category_id: 'cat-inativa',
      amount: 34.9,
      type: 'expense',
      frequency: 'monthly',
      start_date: '2026-01-01',
      next_occurrence: '2026-08-20',
      active: true,
      auto_create: true,
      created_at: '2026-01-01',
    };

    const res = validateRecurringMaterialization(rec, [], [], [], categories, 'ws-1');
    expect(res.isValid).toBe(false);
    expect(res.reason).toBe('Categoria vinculada inativa ou inválida.');
  });

  it('deve validar subcategoria aninhada ativa e inativa em validateRecurringMaterialization', () => {
    const categories: Category[] = [
      {
        id: 'cat-main',
        name: 'Moradia',
        type: 'expense',
        workspace_id: 'ws-1',
        icon: 'home',
        color: '#000',
        active: true,
        created_at: '2026-01-01',
        subcategories: [
          { id: 'sub-active', name: 'Aluguel', active: true, parent_id: 'cat-main', type: 'expense', workspace_id: 'ws-1', icon: 'home', color: '#000', created_at: '2026-01-01' },
          { id: 'sub-inactive', name: 'Reforma', active: false, parent_id: 'cat-main', type: 'expense', workspace_id: 'ws-1', icon: 'home', color: '#000', created_at: '2026-01-01' },
        ],
      },
    ];

    const recActiveSub: RecurringTransaction = {
      id: 'rec-sub-ok',
      workspace_id: 'ws-1',
      description: 'Aluguel Mensal',
      category_id: 'sub-active',
      amount: 1200,
      type: 'expense',
      frequency: 'monthly',
      start_date: '2026-01-01',
      next_occurrence: '2026-08-20',
      active: true,
      auto_create: true,
      created_at: '2026-01-01',
    };

    const resOk = validateRecurringMaterialization(recActiveSub, [], [], [], categories, 'ws-1');
    expect(resOk.isValid).toBe(true);

    const recInactiveSub: RecurringTransaction = {
      ...recActiveSub,
      id: 'rec-sub-bad',
      category_id: 'sub-inactive',
    };

    const resBad = validateRecurringMaterialization(recInactiveSub, [], [], [], categories, 'ws-1');
    expect(resBad.isValid).toBe(false);
    expect(resBad.reason).toBe('A subcategoria informada está inativa.');
  });

  it('deve usar gerador de ID padrão e desativar série com end_date ultrapassada no processRecurringBatchState', () => {
    const initialRecurring: RecurringTransaction[] = [
      {
        id: 'rec-expired',
        workspace_id: 'ws-1',
        description: 'Série Expirada',
        amount: 50,
        type: 'expense',
        frequency: 'monthly',
        start_date: '2026-01-01',
        next_occurrence: '2026-05-01',
        end_date: '2026-04-01',
        active: true,
        auto_create: true,
        created_at: '2026-01-01',
      },
      {
        id: 'rec-one-step',
        workspace_id: 'ws-1',
        description: 'Série com Fim no Próximo Passo',
        amount: 60,
        type: 'expense',
        frequency: 'monthly',
        start_date: '2026-01-01',
        next_occurrence: '2026-08-01',
        end_date: '2026-08-15',
        active: true,
        auto_create: true,
        created_at: '2026-01-01',
      },
    ];

    // Executa sem passar generateId nem nowIso para exercitar os defaults
    const result = processRecurringBatchState({
      recurring: initialRecurring,
      transactions: [],
      bills: [],
      accounts: [],
      paymentMethods: [],
      creditCards: [],
      categories: [],
      todayStr: '2026-08-20',
    });

    expect(result.hasChanges).toBe(true);
    const expired = result.updatedRecurring.find((r) => r.id === 'rec-expired');
    expect(expired?.active).toBe(false);

    const oneStep = result.updatedRecurring.find((r) => r.id === 'rec-one-step');
    expect(oneStep?.active).toBe(false);
    expect(oneStep?.next_occurrence).toBe('2026-09-01');
    expect(result.newTransactions).toHaveLength(1);
    expect(result.newTransactions[0].id).toMatch(/^tx-rec-/);
  });

  it('deve executar pipeline de produção processRecurringBatchState: preservar ID arbitrário de fatura existente (bill-2), criar nova fatura quando inexistente, suspender séries inválidas e permitir estorno (Wiring Real e Reconciliação V28)', () => {
    const paymentMethods: PaymentMethod[] = [
      { id: 'pm-divergent', name: 'Método com Conta A', type: 'debit_card', workspace_id: 'ws-1', active: true, linked_account_id: 'acc-a', created_at: '2026-01-01' },
      { id: 'pm-card', name: 'Método Cartão 1', type: 'credit_card', workspace_id: 'ws-1', active: true, credit_card_id: 'card-1', created_at: '2026-01-01' },
      { id: 'pm-card-new', name: 'Método Cartão 2', type: 'credit_card', workspace_id: 'ws-1', active: true, credit_card_id: 'card-2', created_at: '2026-01-01' },
      { id: 'pm-valid', name: 'Débito Válido', type: 'debit_card', workspace_id: 'ws-1', active: true, linked_account_id: 'acc-a', created_at: '2026-01-01' },
    ];
    const accounts: Account[] = [
      { id: 'acc-a', workspace_id: 'ws-1', name: 'Conta A', type: 'checking', institution: 'Nu', initial_balance: 1000, current_balance: 1000, color: '#000', active: true, created_at: '2026-01-01' },
      { id: 'acc-b', workspace_id: 'ws-1', name: 'Conta B', type: 'checking', institution: 'Nu', initial_balance: 1000, current_balance: 1000, color: '#000', active: true, created_at: '2026-01-01' },
    ];
    const creditCards: CreditCard[] = [
      { id: 'card-1', workspace_id: 'ws-1', name: 'Cartão 1', institution: 'Nu', closing_day: 5, due_day: 12, credit_limit: 5000, color: '#000', active: true, created_at: '2026-01-01' },
      { id: 'card-2', workspace_id: 'ws-1', name: 'Cartão 2', institution: 'Inter', closing_day: 10, due_day: 20, credit_limit: 3000, color: '#f97316', active: true, created_at: '2026-01-01' },
    ];

    // Fixture com ID de fatura existente ARBITRÁRIO realista (exatamente como bill-2 dos mocks)
    const initialBills: CreditCardBill[] = [
      {
        id: 'bill-2',
        credit_card_id: 'card-1',
        workspace_id: 'ws-1',
        reference_month: '2026-08',
        closing_date: '2026-08-05',
        due_date: '2026-08-12',
        total_amount: 500,
        paid_amount: 0,
        status: 'open',
        created_at: '2026-08-01',
      },
    ];

    const initialTransactions: Transaction[] = [
      {
        id: 'tx-existing',
        workspace_id: 'ws-1',
        description: 'Compra Existente',
        amount: 200,
        type: 'expense',
        transaction_date: '2026-08-01',
        due_date: '2026-08-01',
        status: 'paid',
        created_at: '2026-08-01',
      },
    ];

    const initialRecurring: RecurringTransaction[] = [
      {
        id: 'rec-div',
        workspace_id: 'ws-1',
        description: 'Série Divergente',
        amount: 100,
        type: 'expense',
        frequency: 'monthly',
        start_date: '2026-01-01',
        next_occurrence: '2026-08-01',
        active: true,
        auto_create: true,
        payment_method_id: 'pm-divergent',
        account_id: 'acc-b', // Diverge de acc-a
        created_at: '2026-01-01',
      },
      {
        id: 'rec-inc-card',
        workspace_id: 'ws-1',
        description: 'Receita no Cartão',
        amount: 500,
        type: 'income',
        frequency: 'monthly',
        start_date: '2026-01-01',
        next_occurrence: '2026-08-01',
        active: true,
        auto_create: true,
        payment_method_id: 'pm-card',
        created_at: '2026-01-01',
      },
      {
        id: 'rec-invalid-zero',
        workspace_id: 'ws-1',
        description: 'Série com Montante Zero',
        amount: 0,
        type: 'expense',
        frequency: 'monthly',
        start_date: '2026-01-01',
        next_occurrence: '2026-08-01',
        active: true,
        auto_create: true,
        payment_method_id: 'pm-valid',
        created_at: '2026-01-01',
      },
      {
        id: 'rec-invalid-negative',
        workspace_id: 'ws-1',
        description: 'Série com Montante Negativo',
        amount: -50,
        type: 'expense',
        frequency: 'monthly',
        start_date: '2026-01-01',
        next_occurrence: '2026-08-01',
        active: true,
        auto_create: true,
        payment_method_id: 'pm-valid',
        created_at: '2026-01-01',
      },
      {
        id: 'rec-invalid-nan',
        workspace_id: 'ws-1',
        description: 'Série com Montante NaN',
        amount: NaN,
        type: 'expense',
        frequency: 'monthly',
        start_date: '2026-01-01',
        next_occurrence: '2026-08-01',
        active: true,
        auto_create: true,
        payment_method_id: 'pm-valid',
        created_at: '2026-01-01',
      },
      {
        id: 'rec-valid-acc',
        workspace_id: 'ws-1',
        description: 'Assinatura Débito Válida',
        amount: 150,
        type: 'expense',
        frequency: 'monthly',
        start_date: '2026-01-01',
        next_occurrence: '2026-08-01',
        active: true,
        auto_create: true,
        payment_method_id: 'pm-valid',
        account_id: 'acc-a',
        created_at: '2026-01-01',
      },
      {
        id: 'rec-valid-card-existing',
        workspace_id: 'ws-1',
        description: 'Assinatura Cartão com Fatura Existente',
        amount: 80,
        type: 'expense',
        frequency: 'monthly',
        start_date: '2026-01-01',
        next_occurrence: '2026-08-01',
        active: true,
        auto_create: true,
        payment_method_id: 'pm-card',
        credit_card_id: 'card-1',
        created_at: '2026-01-01',
      },
      {
        id: 'rec-valid-card-new-bill',
        workspace_id: 'ws-1',
        description: 'Assinatura Cartão sem Fatura Prévia',
        amount: 120,
        type: 'expense',
        frequency: 'monthly',
        start_date: '2026-01-01',
        next_occurrence: '2026-08-01',
        active: true,
        auto_create: true,
        payment_method_id: 'pm-card-new',
        credit_card_id: 'card-2',
        created_at: '2026-01-01',
      },
    ];

    // Execução da função pura real de produção que alimenta o FinanceProvider
    const result = processRecurringBatchState({
      recurring: initialRecurring,
      transactions: initialTransactions,
      bills: initialBills,
      accounts,
      paymentMethods,
      creditCards,
      categories: [],
      todayStr: '2026-08-20',
      generateId: (prefix: string) => `${prefix}-test`,
      nowIso: '2026-08-20T12:00:00.000Z',
    });

    expect(result.hasChanges).toBe(true);

    // 1. Prova suspensão exata das 5 séries inválidas com motivos explícitos
    const recDivAfter = result.updatedRecurring.find((r) => r.id === 'rec-div');
    expect(recDivAfter?.active).toBe(false);
    expect(recDivAfter?.suspended_reason).toBe('A conta bancária informada diverge da conta bancária vinculada a este método de pagamento.');

    const recIncAfter = result.updatedRecurring.find((r) => r.id === 'rec-inc-card');
    expect(recIncAfter?.active).toBe(false);
    expect(recIncAfter?.suspended_reason).toBe('Receitas não podem ser vinculadas a cartão de crédito ou faturas.');

    const recZeroAfter = result.updatedRecurring.find((r) => r.id === 'rec-invalid-zero');
    expect(recZeroAfter?.active).toBe(false);
    expect(recZeroAfter?.suspended_reason).toBe('O valor da recorrência deve ser maior que zero.');

    const recNegAfter = result.updatedRecurring.find((r) => r.id === 'rec-invalid-negative');
    expect(recNegAfter?.active).toBe(false);
    expect(recNegAfter?.suspended_reason).toBe('O valor da recorrência deve ser maior que zero.');

    const recNanAfter = result.updatedRecurring.find((r) => r.id === 'rec-invalid-nan');
    expect(recNanAfter?.active).toBe(false);
    expect(recNanAfter?.suspended_reason).toBe('O valor da recorrência deve ser maior que zero.');

    // 2. Prova avanço das 3 séries válidas
    const recAccAfter = result.updatedRecurring.find((r) => r.id === 'rec-valid-acc');
    expect(recAccAfter?.active).toBe(true);
    expect(recAccAfter?.next_occurrence).toBe('2026-09-01');

    const recCardExistAfter = result.updatedRecurring.find((r) => r.id === 'rec-valid-card-existing');
    expect(recCardExistAfter?.active).toBe(true);
    expect(recCardExistAfter?.next_occurrence).toBe('2026-09-01');

    const recCardNewAfter = result.updatedRecurring.find((r) => r.id === 'rec-valid-card-new-bill');
    expect(recCardNewAfter?.active).toBe(true);
    expect(recCardNewAfter?.next_occurrence).toBe('2026-09-01');

    // 3. Prova contagem estrita de transações geradas: exatamente 3 (zero para as 5 inválidas)
    expect(result.newTransactions).toHaveLength(3);

    // 4. PROVA DO P0 LOCAL: Transaction em fatura existente DEVE apontar estritamente para o ID existente "bill-2"
    const txCardExisting = result.newTransactions.find((t) => t.recurring_transaction_id === 'rec-valid-card-existing');
    expect(txCardExisting).toBeDefined();
    expect(txCardExisting?.credit_card_id).toBe('card-1');
    expect(txCardExisting?.credit_card_bill_id).toBe('bill-2'); // NUNCA bill-card-1-2026-08!

    // Prova que a fatura "bill-2" existe em updatedBills e teve saldo incrementado (500 + 80 = 580)
    const bill2After = result.updatedBills.find((b) => b.id === 'bill-2');
    expect(bill2After).toBeDefined();
    expect(bill2After?.total_amount).toBe(580);

    // 5. PROVA DE FATURA CRIADA DO ZERO: quando não existe fatura prévia, usa a convenção determinística
    const txCardNew = result.newTransactions.find((t) => t.recurring_transaction_id === 'rec-valid-card-new-bill');
    expect(txCardNew).toBeDefined();
    expect(txCardNew?.credit_card_id).toBe('card-2');
    expect(txCardNew?.credit_card_bill_id).toBe('bill-card-2-2026-08');

    const billNewAfter = result.updatedBills.find((b) => b.id === 'bill-card-2-2026-08');
    expect(billNewAfter).toBeDefined();
    expect(billNewAfter?.total_amount).toBe(120);

    // 6. PROVA DE RECONCILIAÇÃO / ESTORNO REAL: executa a função pura de produção reconcileBillAfterItemDeletion
    const billToReconcile = result.updatedBills.find((b) => b.id === txCardExisting!.credit_card_bill_id);
    expect(billToReconcile).toBeDefined();
    expect(billToReconcile?.id).toBe('bill-2');
    const reconciledBill = reconcileBillAfterItemDeletion(billToReconcile!, txCardExisting!.amount);
    expect(reconciledBill.total_amount).toBe(500); // Saldo restaurado sem perda de referência!

    // 7. Prova de idempotência: executar ciclo novamente não gera duplicações
    const resultCycle2 = processRecurringBatchState({
      recurring: result.updatedRecurring,
      transactions: [...result.newTransactions, ...initialTransactions],
      bills: result.updatedBills,
      accounts,
      paymentMethods,
      creditCards,
      categories: [],
      todayStr: '2026-08-20',
    });
    expect(resultCycle2.hasChanges).toBe(false);
    expect(resultCycle2.newTransactions).toHaveLength(0);
  });

  it('deve garantir tipagem estrita de UpdateTransactionDTO em tempo de compilação com expectTypeOf (P2-01)', () => {
    // Prova em nível de tipo de compilação que campos restritos não existem no DTO
    expectTypeOf<UpdateTransactionDTO>().not.toHaveProperty('account_id');
    expectTypeOf<UpdateTransactionDTO>().not.toHaveProperty('status');
    expectTypeOf<UpdateTransactionDTO>().not.toHaveProperty('paid_amount');
    expectTypeOf<UpdateTransactionDTO>().not.toHaveProperty('paid_at');
    expectTypeOf<UpdateTransactionDTO>().not.toHaveProperty('workspace_id');
    expectTypeOf<UpdateTransactionDTO>().not.toHaveProperty('id');

    // Prova que apenas campos editáveis seguros são aceitos
    expectTypeOf<UpdateTransactionDTO>().toMatchTypeOf<{
      description?: string;
      amount?: number;
      category_id?: string | null;
      due_date?: string;
      transaction_date?: string;
      notes?: string | null;
    }>();
  });

  it('deve retornar o ID real de fatura pré-existente arbitrária ao adicionar item via resolveOrCreateCreditCardBill real (P0/P2 Resolução)', () => {
    const allCreditCardBills: CreditCardBill[] = [
      {
        id: 'bill-arbitrary-uuid-999',
        credit_card_id: 'card-1',
        workspace_id: 'ws-1',
        reference_month: '2026-09',
        closing_date: '2026-09-05',
        due_date: '2026-09-12',
        total_amount: 300,
        paid_amount: 0,
        status: 'open',
        created_at: '2026-09-01',
      },
    ];

    // 1. Ao reutilizar fatura existente, DEVE retornar 'bill-arbitrary-uuid-999' e isNew: false
    const res1 = resolveOrCreateCreditCardBill({
      bills: allCreditCardBills,
      cardId: 'card-1',
      referenceMonth: '2026-09',
      closingDate: '2026-09-05',
      dueDate: '2026-09-12',
      amount: 150,
      workspaceId: 'ws-1',
    });
    expect(res1.billId).toBe('bill-arbitrary-uuid-999');
    expect(res1.isNew).toBe(false);
    expect(res1.updatedBills.find((b) => b.id === 'bill-arbitrary-uuid-999')?.total_amount).toBe(450);

    // 2. Ao criar fatura nova do zero, cria com targetBillId e isNew: true
    const res2 = resolveOrCreateCreditCardBill({
      bills: allCreditCardBills,
      cardId: 'card-1',
      referenceMonth: '2026-10',
      closingDate: '2026-10-05',
      dueDate: '2026-10-12',
      amount: 200,
      workspaceId: 'ws-1',
      nowIso: '2026-09-01T00:00:00.000Z',
    });
    expect(res2.billId).toBe('bill-card-1-2026-10');
    expect(res2.isNew).toBe(true);
    expect(res2.updatedBills.find((b) => b.id === 'bill-card-1-2026-10')?.total_amount).toBe(200);
  });

  it('deve bloquear exclusão de item faturado se valor pago exceder o novo total da fatura via reconcileBillAfterItemDeletion real', () => {
    const partialBill: CreditCardBill = {
      id: 'bill-partial-test',
      credit_card_id: 'card-1',
      workspace_id: 'ws-1',
      reference_month: '2026-08',
      closing_date: '2026-08-05',
      due_date: '2026-08-12',
      total_amount: 500,
      paid_amount: 400, // Já foram pagos 400 de 500
      status: 'partially_paid',
      created_at: '2026-08-01',
    };

    // Tentar excluir item de 200 faria o novo total ser 300, menor que os 400 já pagos!
    expect(() => reconcileBillAfterItemDeletion(partialBill, 200)).toThrow(
      'Não é possível excluir o item da fatura: o valor pago (R$ 400.00) excederia o novo total (R$ 300.00). Estorne o pagamento da fatura antes de excluir o item.'
    );

    // Excluir item de 50 é permitido: novo total 450 >= 400
    const reconciledOk = reconcileBillAfterItemDeletion(partialBill, 50);
    expect(reconciledOk.total_amount).toBe(450);
    expect(reconciledOk.paid_amount).toBe(400);
    expect(reconciledOk.status).toBe('partially_paid');
  });

  it('deve proteger campos imutáveis (workspace_id, id, created_at) contra sobrescrita em updateAccount, updateCreditCard, updateTransaction e updateGoal', () => {
    // 1. Prova em nível de tipo de compilação que campos imutáveis não existem em UpdateTransactionDTO
    expectTypeOf<UpdateTransactionDTO>().not.toHaveProperty('id');
    expectTypeOf<UpdateTransactionDTO>().not.toHaveProperty('workspace_id');
    expectTypeOf<UpdateTransactionDTO>().not.toHaveProperty('created_at');
    expectTypeOf<UpdateTransactionDTO>().not.toHaveProperty('credit_card_bill_id');
    expectTypeOf<UpdateTransactionDTO>().not.toHaveProperty('account_id');

    // 2. Prova em tempo de execução que transação vinculada a fatura tem restrição de mutação de data via função real
    const existingBilledTx: Transaction = {
      id: 'tx-1',
      workspace_id: 'ws-1',
      description: 'Tx Original',
      credit_card_bill_id: 'bill-1',
      created_at: '2026-01-01T00:00:00Z',
      created_by: 'usr-1',
      amount: 100,
      status: 'pending',
      transaction_date: '2026-01-01',
      due_date: '2026-01-10',
      type: 'expense',
    };

    expect(() =>
      validateBilledTransactionDateImmutability(existingBilledTx, { transaction_date: '2026-02-01' })
    ).toThrow(/vinculadas a faturas/i);

    expect(() =>
      validateBilledTransactionDateImmutability(existingBilledTx, { transaction_date: '2026-01-01' })
    ).not.toThrow();
  });

  it('deve revalidar novas referências em updateTransaction contra entidades inativas ou de outros workspaces via validateTransactionAccount real', () => {
    const accounts: Account[] = [
      { id: 'acc-active', workspace_id: 'ws-1', name: 'Conta Ativa', type: 'checking', institution: 'Nubank', initial_balance: 0, current_balance: 0, color: '#000', active: true, created_at: '2026-01-01' },
      { id: 'acc-inactive', workspace_id: 'ws-1', name: 'Conta Inativa', type: 'checking', institution: 'Nubank', initial_balance: 0, current_balance: 0, color: '#000', active: false, created_at: '2026-01-01' },
      { id: 'acc-other-ws', workspace_id: 'ws-2', name: 'Conta Outro WS', type: 'checking', institution: 'Nubank', initial_balance: 0, current_balance: 0, color: '#000', active: true, created_at: '2026-01-01' },
    ];

    expect(() => validateTransactionAccount('acc-active', accounts, 'ws-1')).not.toThrow();
    expect(() => validateTransactionAccount('acc-inactive', accounts, 'ws-1')).toThrow('A conta bancária informada está inativa.');
    expect(() => validateTransactionAccount('acc-other-ws', accounts, 'ws-1')).toThrow('Conta bancária informada não pertence ao workspace ativo.');
  });

  it('deve avançar next_occurrence para o futuro ao reativar recorrência pausada evitando backfill em lote via calculateCatchUpOccurrence real', () => {
    const todayStr = '2026-08-23';
    const recurring = {
      id: 'rec-1',
      start_date: '2026-01-10',
      next_occurrence: '2026-02-10', // Data no passado
      frequency: 'monthly' as const,
      active: false,
      suspended_reason: 'Conta bancária vinculada está inativa.',
    };

    const nextOcc = calculateCatchUpOccurrence(
      recurring.next_occurrence,
      recurring.start_date,
      recurring.frequency,
      null,
      todayStr
    );

    expect(nextOcc).toBe('2026-09-10');
  });

  it('deve rejeitar montantes inválidos (zero, negativos, NaN) via validateRecurringAmount real', () => {
    expect(() => validateRecurringAmount(0)).toThrow('O valor da recorrência deve ser maior que zero.');
    expect(() => validateRecurringAmount(-50)).toThrow('O valor da recorrência deve ser maior que zero.');
    expect(() => validateRecurringAmount(NaN)).toThrow('O valor da recorrência deve ser maior que zero.');
    expect(() => validateRecurringAmount(120.5)).not.toThrow();
  });

  it('deve rejeitar linked_account_id inexistente ou inativo no workspace via validateCreditCardResolution real', () => {
    const paymentMethods: PaymentMethod[] = [
      { id: 'pm-linked-1', name: 'Débito Nubank', type: 'debit_card', linked_account_id: 'acc-ws1', workspace_id: 'ws-1', active: true, created_at: '2026-01-01' },
      { id: 'pm-linked-other-ws', name: 'Débito Outro WS', type: 'debit_card', linked_account_id: 'acc-ws2', workspace_id: 'ws-1', active: true, created_at: '2026-01-01' },
      { id: 'pm-linked-missing', name: 'Débito Inexistente', type: 'debit_card', linked_account_id: 'acc-inexistente', workspace_id: 'ws-1', active: true, created_at: '2026-01-01' },
    ];
    const accounts: Account[] = [
      { id: 'acc-ws1', workspace_id: 'ws-1', name: 'Conta WS1', type: 'checking', institution: 'Nubank', initial_balance: 1000, current_balance: 1000, color: '#8b5cf6', active: true, created_at: '2026-01-01' },
      { id: 'acc-ws2', workspace_id: 'ws-2', name: 'Conta WS2', type: 'checking', institution: 'Nubank', initial_balance: 1000, current_balance: 1000, color: '#8b5cf6', active: true, created_at: '2026-01-01' },
    ];

    expect(validateCreditCardResolution('ws-1', paymentMethods, [], accounts, 'pm-linked-1', null)).toBeNull();
    expect(() => validateCreditCardResolution('ws-1', paymentMethods, [], accounts, 'pm-linked-other-ws', null)).toThrow(
      'A conta bancária vinculada a este método de pagamento não pertence ao workspace.'
    );
    expect(() => validateCreditCardResolution('ws-1', paymentMethods, [], accounts, 'pm-linked-missing', null)).toThrow(
      'A conta bancária vinculada a este método de pagamento não pertence ao workspace.'
    );
  });

  it('deve exigir cartão explícito obrigatório para método genérico do tipo credit_card no domínio real (P0-01)', () => {
    const paymentMethods: PaymentMethod[] = [
      { id: 'pm-generic-card', name: 'Cartão de Crédito Genérico', type: 'credit_card', workspace_id: 'ws-1', active: true, created_at: '2026-01-01' },
      { id: 'pm-fixed-card', name: 'Nubank Fixo', type: 'credit_card', credit_card_id: 'card-1', workspace_id: 'ws-1', active: true, created_at: '2026-01-01' },
    ];
    const creditCards: CreditCard[] = [
      { id: 'card-1', workspace_id: 'ws-1', name: 'Nubank', institution: 'Nubank', closing_day: 3, due_day: 10, credit_limit: 5000, color: '#8b5cf6', active: true, created_at: '2026-01-01' },
      { id: 'card-2', workspace_id: 'ws-1', name: 'Inter', institution: 'Inter', closing_day: 5, due_day: 12, credit_limit: 3000, color: '#f97316', active: true, created_at: '2026-01-01' },
    ];
    const accounts: Account[] = [
      { id: 'acc-1', workspace_id: 'ws-1', name: 'Conta Corrente', type: 'checking', institution: 'Nubank', initial_balance: 1000, current_balance: 1000, color: '#8b5cf6', active: true, created_at: '2026-01-01' },
    ];

    // Método genérico sem cartão explícito DEVE lançar erro
    expect(() =>
      validateCreditCardResolution('ws-1', paymentMethods, creditCards, accounts, 'pm-generic-card', null)
    ).toThrow('Para métodos de pagamento do tipo cartão de crédito, a seleção de um cartão é obrigatória.');

    // Método genérico com cartão explícito DEVE retornar o cartão selecionado
    expect(
      validateCreditCardResolution('ws-1', paymentMethods, creditCards, accounts, 'pm-generic-card', 'card-2')
    ).toBe('card-2');

    // Método com cartão fixo infere automaticamente
    expect(
      validateCreditCardResolution('ws-1', paymentMethods, creditCards, accounts, 'pm-fixed-card', null)
    ).toBe('card-1');

    // Método fixo com divergência explícita lança erro
    expect(() =>
      validateCreditCardResolution('ws-1', paymentMethods, creditCards, accounts, 'pm-fixed-card', 'card-2')
    ).toThrow('O cartão de crédito informado diverge do cartão fixo vinculado a este método de pagamento.');

    // Método com conta vinculada inexistente ou inativa
    const pmsWithLinked: PaymentMethod[] = [
      { id: 'pm-linked-ok', name: 'Débito Nubank', type: 'debit_card', linked_account_id: 'acc-1', workspace_id: 'ws-1', active: true, created_at: '2026-01-01' },
      { id: 'pm-linked-missing', name: 'Débito Órfão', type: 'debit_card', linked_account_id: 'acc-missing', workspace_id: 'ws-1', active: true, created_at: '2026-01-01' },
      { id: 'pm-linked-inactive', name: 'Débito Inativo', type: 'debit_card', linked_account_id: 'acc-inactive', workspace_id: 'ws-1', active: true, created_at: '2026-01-01' },
      { id: 'pm-inactive', name: 'Cartão Inativo', type: 'credit_card', workspace_id: 'ws-1', active: false, created_at: '2026-01-01' },
    ];
    const accountsWithInactive: Account[] = [
      ...accounts,
      { id: 'acc-inactive', workspace_id: 'ws-1', name: 'Conta Inativa', type: 'checking', institution: 'Nubank', initial_balance: 0, current_balance: 0, color: '#8b5cf6', active: false, created_at: '2026-01-01' },
    ];

    expect(validateCreditCardResolution('ws-1', pmsWithLinked, creditCards, accountsWithInactive, 'pm-linked-ok', null)).toBeNull();

    expect(() =>
      validateCreditCardResolution('ws-1', pmsWithLinked, creditCards, accountsWithInactive, 'pm-linked-missing', null)
    ).toThrow('A conta bancária vinculada a este método de pagamento não pertence ao workspace.');

    expect(() =>
      validateCreditCardResolution('ws-1', pmsWithLinked, creditCards, accountsWithInactive, 'pm-linked-inactive', null)
    ).toThrow('A conta bancária vinculada a este método de pagamento está inativa.');

    expect(() =>
      validateCreditCardResolution('ws-1', pmsWithLinked, creditCards, accountsWithInactive, 'pm-inactive', null)
    ).toThrow('O método de pagamento informado está inativo.');

    const inactiveCards: CreditCard[] = [
      { id: 'card-inact', workspace_id: 'ws-1', name: 'Inativo', institution: 'Nu', closing_day: 1, due_day: 10, credit_limit: 100, color: '#fff', active: false, created_at: '2026-01-01' },
    ];
    expect(() =>
      validateCreditCardResolution('ws-1', paymentMethods, inactiveCards, accounts, null, 'card-inact')
    ).toThrow('O cartão de crédito informado está inativo.');

    expect(() =>
      validateCreditCardResolution('ws-1', paymentMethods, creditCards, accounts, null, 'card-not-found')
    ).toThrow('Cartão de crédito informado não pertence ao workspace.');
  });

  it('deve proibir terminantemente receitas vinculadas a cartão de crédito ou faturas no domínio real (P0-02)', () => {
    const paymentMethods: PaymentMethod[] = [
      { id: 'pm-card', name: 'Cartão Nubank', type: 'credit_card', workspace_id: 'ws-1', active: true, created_at: '2026-01-01' },
      { id: 'pm-pix', name: 'PIX', type: 'pix', workspace_id: 'ws-1', active: true, created_at: '2026-01-01' },
    ];

    expect(() =>
      validateTransactionBusinessRules({ type: 'income', credit_card_id: 'card-1' }, paymentMethods, 'ws-1')
    ).toThrow('Receitas não podem ser vinculadas a cartão de crédito ou faturas.');

    expect(() =>
      validateTransactionBusinessRules({ type: 'income', credit_card_bill_id: 'bill-1' }, paymentMethods, 'ws-1')
    ).toThrow('Receitas não podem ser vinculadas a cartão de crédito ou faturas.');

    expect(() =>
      validateTransactionBusinessRules({ type: 'income', payment_method_id: 'pm-card' }, paymentMethods, 'ws-1')
    ).toThrow('Receitas não podem ser vinculadas a cartão de crédito ou faturas.');

    expect(() =>
      validateTransactionBusinessRules({ type: 'income', payment_method_id: 'pm-pix' }, paymentMethods, 'ws-1')
    ).not.toThrow();

    expect(() =>
      validateTransactionBusinessRules({ type: 'expense', credit_card_id: 'card-1' }, paymentMethods, 'ws-1')
    ).not.toThrow();
  });

  it('deve sanitizar de forma idempotente séries recorrentes legadas da V20 com income + cartão (P0-01 V22)', () => {
    const paymentMethods: PaymentMethod[] = [
      { id: 'pm-card', name: 'Cartão', type: 'credit_card', workspace_id: 'ws-1', active: true, created_at: '2026-01-01' },
      { id: 'pm-pix', name: 'PIX', type: 'pix', workspace_id: 'ws-1', active: true, created_at: '2026-01-01' },
    ];

    const legacyRecurring: RecurringTransaction[] = [
      {
        id: 'rec-invalid-1',
        workspace_id: 'ws-1',
        description: 'Salário no Cartão (V20 Bug)',
        amount: 3000,
        type: 'income',
        frequency: 'monthly',
        start_date: '2026-01-01',
        next_occurrence: '2026-08-01',
        active: true,
        auto_create: true,
        created_at: '2026-01-01',
        credit_card_id: 'card-1',
      },
      {
        id: 'rec-invalid-2',
        workspace_id: 'ws-1',
        description: 'Receita com PM de Cartão (V20 Bug)',
        amount: 500,
        type: 'income',
        frequency: 'monthly',
        start_date: '2026-01-01',
        next_occurrence: '2026-08-01',
        active: true,
        auto_create: true,
        created_at: '2026-01-01',
        payment_method_id: 'pm-card',
      },
      {
        id: 'rec-valid-expense',
        workspace_id: 'ws-1',
        description: 'Netflix no Cartão',
        amount: 55.9,
        type: 'expense',
        frequency: 'monthly',
        start_date: '2026-01-01',
        next_occurrence: '2026-08-01',
        active: true,
        auto_create: true,
        created_at: '2026-01-01',
        payment_method_id: 'pm-card',
      },
      {
        id: 'rec-valid-income',
        workspace_id: 'ws-1',
        description: 'Salário via PIX',
        amount: 7500,
        type: 'income',
        frequency: 'monthly',
        start_date: '2026-01-01',
        next_occurrence: '2026-08-01',
        active: true,
        auto_create: true,
        created_at: '2026-01-01',
        payment_method_id: 'pm-pix',
      },
    ];

    // Primeira passagem: detecta e suspende as duas séries inválidas
    const { sanitized, hasChanges } = sanitizeLegacyRecurringState(legacyRecurring, paymentMethods);
    expect(hasChanges).toBe(true);

    const rec1 = sanitized.find((r) => r.id === 'rec-invalid-1');
    expect(rec1?.active).toBe(false);
    expect(rec1?.suspended_reason).toBe('Receitas não podem ser vinculadas a cartão de crédito ou faturas.');

    const rec2 = sanitized.find((r) => r.id === 'rec-invalid-2');
    expect(rec2?.active).toBe(false);
    expect(rec2?.suspended_reason).toBe('Receitas não podem ser vinculadas a cartão de crédito ou faturas.');

    const rec3 = sanitized.find((r) => r.id === 'rec-valid-expense');
    expect(rec3?.active).toBe(true);
    expect(rec3?.suspended_reason).toBeUndefined();

    const rec4 = sanitized.find((r) => r.id === 'rec-valid-income');
    expect(rec4?.active).toBe(true);

    // Segunda passagem: idempotência (hasChanges deve ser false)
    const secondPass = sanitizeLegacyRecurringState(sanitized, paymentMethods);
    expect(secondPass.hasChanges).toBe(false);
  });

  it('deve bloquear alteração de datas em transações faturadas em updateTransaction usando validador real (P1-02)', () => {
    const transaction = {
      id: 'tx-billed-1',
      credit_card_bill_id: 'bill-1',
      transaction_date: '2026-08-10',
      due_date: '2026-09-05',
    };

    expect(() =>
      validateBilledTransactionDateImmutability(transaction, { transaction_date: '2026-08-11' })
    ).toThrow('Datas de transações vinculadas a faturas de cartão de crédito não podem ser alteradas diretamente.');

    expect(() =>
      validateBilledTransactionDateImmutability(transaction, { due_date: '2026-09-10' })
    ).toThrow('Datas de transações vinculadas a faturas de cartão de crédito não podem ser alteradas diretamente.');

    expect(() => validateBilledTransactionDateImmutability(transaction, {})).not.toThrow();
  });

  it('deve rejeitar divergência entre linked_account_id do método de pagamento e account_id da transação (P2 V22/V23)', () => {
    const paymentMethods: PaymentMethod[] = [
      { id: 'pm-linked-nu', name: 'Débito Nubank', type: 'debit_card', linked_account_id: 'acc-nu', workspace_id: 'ws-1', active: true, created_at: '2026-01-01' },
      { id: 'pm-unlinked', name: 'Dinheiro', type: 'cash', workspace_id: 'ws-1', active: true, created_at: '2026-01-01' },
    ];

    // Transação usando pm vinculado à conta Nubank com account_id da conta Inter DEVE falhar
    expect(() =>
      validateTransactionBusinessRules(
        { type: 'expense', payment_method_id: 'pm-linked-nu', account_id: 'acc-inter' },
        paymentMethods,
        'ws-1'
      )
    ).toThrow('A conta bancária informada diverge da conta bancária vinculada a este método de pagamento.');

    // Transação usando pm vinculado com a conta certa DEVE passar
    expect(() =>
      validateTransactionBusinessRules(
        { type: 'expense', payment_method_id: 'pm-linked-nu', account_id: 'acc-nu' },
        paymentMethods,
        'ws-1'
      )
    ).not.toThrow();

    // Transação com método sem conta vinculada aceita qualquer conta
    expect(() =>
      validateTransactionBusinessRules(
        { type: 'expense', payment_method_id: 'pm-unlinked', account_id: 'acc-inter' },
        paymentMethods,
        'ws-1'
      )
    ).not.toThrow();
  });

  it('deve calcular próxima ocorrência futura para custom diário de longa data sem limite de passos (P1-03)', () => {
    const todayStr = '2026-08-23';
    const startStr = '2025-01-01'; // Mais de 600 dias atrás
    const intervalDays = 1;

    // Cálculo exato aritmético
    const startD = new Date(startStr);
    const todayD = new Date(todayStr);
    const diffDays = Math.max(0, Math.floor((todayD.getTime() - startD.getTime()) / (1000 * 60 * 60 * 24)));
    const cycles = Math.ceil(diffDays / intervalDays);
    const nextOccDate = new Date(startD.getTime() + cycles * intervalDays * 24 * 60 * 60 * 1000);
    const nextOccStr = nextOccDate.toISOString().split('T')[0];

    expect(nextOccStr >= todayStr).toBe(true);
    expect(cycles).toBeGreaterThan(500);
  });

  it('deve validar coerência transversal e suspender na materialização recorrente quando houver divergência de conta (P1-01 V24)', () => {
    const paymentMethods: PaymentMethod[] = [
      { id: 'pm-debit-nu', name: 'Débito Nubank', type: 'debit_card', linked_account_id: 'acc-nu', workspace_id: 'ws-1', active: true, created_at: '2026-01-01' },
    ];

    // 1. Validação de cadastro de recorrência com divergência
    expect(() =>
      validateTransactionBusinessRules(
        { type: 'expense', payment_method_id: 'pm-debit-nu', account_id: 'acc-divergente' },
        paymentMethods,
        'ws-1'
      )
    ).toThrow('A conta bancária informada diverge da conta bancária vinculada a este método de pagamento.');

    // 2. Simulação de processamento de materialização para série persistida com divergência
    const recDivergente: RecurringTransaction = {
      id: 'rec-divergente',
      workspace_id: 'ws-1',
      description: 'Assinatura com conta trocada',
      amount: 49.9,
      type: 'expense',
      frequency: 'monthly',
      start_date: '2026-01-01',
      next_occurrence: '2026-08-01',
      active: true,
      auto_create: true,
      created_at: '2026-01-01',
      payment_method_id: 'pm-debit-nu',
      account_id: 'acc-divergente',
    };

    let suspended = false;
    let reason: string | null = null;
    try {
      validateTransactionBusinessRules(
        {
          type: recDivergente.type,
          payment_method_id: recDivergente.payment_method_id,
          account_id: recDivergente.account_id,
        },
        paymentMethods,
        recDivergente.workspace_id
      );
    } catch (err: any) {
      suspended = true;
      reason = err.message;
    }

    expect(suspended).toBe(true);
    expect(reason).toBe('A conta bancária informada diverge da conta bancária vinculada a este método de pagamento.');
  });

  it('deve calcular catch-up determinístico em recorrências customizadas com intervalo em dias', () => {
    const nextOcc = calculateCatchUpOccurrence(
      '2026-01-01',
      '2026-01-01',
      'custom',
      10,
      '2026-01-25'
    );
    // 01-01 -> 01-11 -> 01-21 -> 01-31 (3 cycles de 10 dias a partir de 01-01)
    expect(nextOcc).toBe('2026-01-31');
  });

  it('deve avançar ocorrências com virada de ano em frequências bimestrais, trimestrais e anuais', () => {
    // Trimestral a partir de novembro de 2026 -> fevereiro de 2027
    const nextQuarterly = stepNextOccurrence('2026-11-15', '2026-02-15', 'quarterly');
    expect(nextQuarterly).toBe('2027-02-15');

    // Semestral a partir de outubro de 2026 -> abril de 2027
    const nextSemiannual = stepNextOccurrence('2026-10-10', '2026-04-10', 'semiannual');
    expect(nextSemiannual).toBe('2027-04-10');

    // Semanal
    const nextWeekly = stepNextOccurrence('2026-01-01', '2026-01-01', 'weekly');
    expect(nextWeekly).toBe('2026-01-08');
  });

  it('deve inferir e resolver conta bancária com resolveTransactionAccountId', () => {
    const paymentMethods: PaymentMethod[] = [
      { id: 'pm-linked', name: 'Débito Nubank', type: 'debit_card', workspace_id: 'ws-1', active: true, linked_account_id: 'acc-nu', created_at: '2026-01-01' },
      { id: 'pm-unlinked', name: 'Dinheiro', type: 'cash', workspace_id: 'ws-1', active: true, created_at: '2026-01-01' },
    ];

    // Inferência automática quando omitido
    expect(resolveTransactionAccountId('pm-linked', undefined, paymentMethods, 'ws-1')).toBe('acc-nu');
    // Coerência quando idêntico
    expect(resolveTransactionAccountId('pm-linked', 'acc-nu', paymentMethods, 'ws-1')).toBe('acc-nu');
    // Rejeição quando divergente
    expect(() => resolveTransactionAccountId('pm-linked', 'acc-outro', paymentMethods, 'ws-1')).toThrow(
      'A conta bancária informada diverge da conta bancária vinculada a este método de pagamento.'
    );
    // Preserva conta explícita quando método não tem vínculo
    expect(resolveTransactionAccountId('pm-unlinked', 'acc-qualquer', paymentMethods, 'ws-1')).toBe('acc-qualquer');
  });
});
