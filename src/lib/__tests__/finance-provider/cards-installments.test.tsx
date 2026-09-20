import { describe, it, expect } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useFinance } from '../../context/finance-context';
import { setupFinanceHarness } from '../test-utils/finance-provider-harness';
import {
  resolveOrCreateCreditCardBill,
  reconcileBillAfterItemDeletion,
  validateCreditCardBillIntegrity,
  toCents,
  fromCents,
  roundCurrency,
  compareCurrency,
  calculateDashboardSummary,
  calculateFutureCommitments,
} from '../../financial-engine';
import { CreditCardBill, Transaction, Settlement } from '../../types';

describe('FinanceProvider - Cartões e Parcelamento', () => {
  const { storageMap, mountProvider } = setupFinanceHarness();

  it('deve montar FinanceProvider com fatura existente de ID arbitrario bill-2, vincular via addTransaction e reconciliar estorno ao excluir', async () => {
    storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));

    const arbitraryBill: CreditCardBill = {
      id: 'bill-2',
      credit_card_id: 'card-1',
      workspace_id: 'ws-1',
      reference_month: '2026-08',
      closing_date: '2026-08-05',
      due_date: '2026-08-12',
      total_amount: 500,
      paid_amount: 0,
      status: 'open',
      created_at: '2026-08-01T00:00:00Z',
    };
    storageMap.set('fincontrol_v2_bills', JSON.stringify([arbitraryBill]));

    const { getCtx } = await mountProvider();
    expect(getCtx().isLoaded).toBe(true);

    const targetBillBefore = getCtx().creditCardBills.find((b) => b.id === 'bill-2');
    expect(targetBillBefore).toBeDefined();
    expect(targetBillBefore?.total_amount).toBe(500);

    // 1. Invocar o fluxo publico de addTransaction com despesa de cartao
    let createdTx: any;
    await act(async () => {
      createdTx = getCtx().addTransaction({
        description: 'Despesa com Cartao Fatura Previa',
        amount: 120,
        type: 'expense',
        transaction_date: '2026-08-02',
        due_date: '2026-08-12',
        credit_card_id: 'card-1',
        payment_method_id: getCtx().paymentMethods.find((p) => p.type === 'credit_card')?.id || null,
        category_id: getCtx().categories[0]?.id,
        status: 'pending',
      });
    });

    // 2. Comprovar que a Transaction criada possui credit_card_bill_id === 'bill-2'
    expect(createdTx.credit_card_bill_id).toBe('bill-2');

    // 3. Comprovar que a fatura foi incrementada no estado real (500 + 120 = 620)
    const billAfterAdd = getCtx().creditCardBills.find((b) => b.id === 'bill-2');
    expect(billAfterAdd).toBeDefined();
    expect(billAfterAdd?.total_amount).toBe(620);

    // 4. Excluir a transacao pelo fluxo publico do Provider e comprovar restauracao exata
    await act(async () => {
      getCtx().deleteTransaction(createdTx.id);
    });

    const billAfterDelete = getCtx().creditCardBills.find((b) => b.id === 'bill-2');
    expect(billAfterDelete).toBeDefined();
    expect(billAfterDelete?.total_amount).toBe(500);
  });

  it('deve vincular parcelas de createInstallmentPurchase a fatura existente e faturas dos meses subsequentes', async () => {
    storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));

    const arbitraryBill: CreditCardBill = {
      id: 'bill-2',
      credit_card_id: 'card-1',
      workspace_id: 'ws-1',
      reference_month: '2026-08',
      closing_date: '2026-08-05',
      due_date: '2026-08-12',
      total_amount: 300,
      paid_amount: 0,
      status: 'open',
      created_at: '2026-08-01T00:00:00Z',
    };
    storageMap.set('fincontrol_v2_bills', JSON.stringify([arbitraryBill]));

    const { getCtx } = await mountProvider();
    expect(getCtx().isLoaded).toBe(true);

    const card = getCtx().creditCards.find((c) => c.id === 'card-1');
    expect(card).toBeDefined();

    let createdPurchase: any;
    await act(async () => {
      createdPurchase = getCtx().createInstallmentPurchase({
        description: 'Notebook Parcelado em 3x',
        total_amount: 300,
        installment_count: 3,
        purchase_date: '2026-08-01',
        credit_card_id: 'card-1',
        payment_method_id: getCtx().paymentMethods.find((p) => p.type === 'credit_card')?.id || undefined,
        category_id: getCtx().categories[0]?.id,
      });
    });

    expect(createdPurchase).toBeDefined();

    const purchaseInstallments = getCtx().installments.filter((i) => i.purchase_id === createdPurchase.id);
    expect(purchaseInstallments).toHaveLength(3);

    // Parcela 1: fatura existente 'bill-2'
    expect(purchaseInstallments[0].credit_card_bill_id).toBe('bill-2');

    const bill2 = getCtx().creditCardBills.find((b) => b.id === 'bill-2');
    expect(bill2?.total_amount).toBe(400);

    // Parcelas 2 e 3: faturas deterministicas
    expect(purchaseInstallments[1].credit_card_bill_id).toBe('bill-card-1-2026-09');
    expect(purchaseInstallments[2].credit_card_bill_id).toBe('bill-card-1-2026-10');
  });

  it('deve criar fatura deterministica e vincular imediatamente em addTransaction quando nao ha fatura previa', async () => {
    storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
    storageMap.set('fincontrol_v2_bills', JSON.stringify([]));

    const { getCtx } = await mountProvider();
    expect(getCtx().isLoaded).toBe(true);

    let createdTx: any;
    await act(async () => {
      createdTx = getCtx().addTransaction({
        description: 'Compra Sem Fatura Previa',
        amount: 250,
        type: 'expense',
        transaction_date: '2026-11-01',
        due_date: '2026-11-12',
        credit_card_id: 'card-1',
        payment_method_id: getCtx().paymentMethods.find((p) => p.type === 'credit_card')?.id || null,
        category_id: getCtx().categories[0]?.id,
        status: 'pending',
      });
    });

    expect(createdTx.credit_card_bill_id).toBe('bill-card-1-2026-11');

    const createdBill = getCtx().creditCardBills.find((b) => b.id === 'bill-card-1-2026-11');
    expect(createdBill).toBeDefined();
    expect(createdBill?.total_amount).toBe(250);
  });

  it('deve disparar erro defensivo (P2-01) ao passar valores invalidos para resolveOrCreateCreditCardBill e reconcileBillAfterItemDeletion', () => {
    // 1. resolveOrCreateCreditCardBill rejeita montante <= 0, NaN e Infinity
    expect(() =>
      resolveOrCreateCreditCardBill({
        bills: [],
        cardId: 'card-1',
        referenceMonth: '2026-08',
        closingDate: '2026-08-05',
        dueDate: '2026-08-12',
        amount: 0,
        workspaceId: 'ws-1',
      })
    ).toThrow(/positivo e finito/i);

    expect(() =>
      resolveOrCreateCreditCardBill({
        bills: [],
        cardId: 'card-1',
        referenceMonth: '2026-08',
        closingDate: '2026-08-05',
        dueDate: '2026-08-12',
        amount: -50,
        workspaceId: 'ws-1',
      })
    ).toThrow(/positivo e finito/i);

    expect(() =>
      resolveOrCreateCreditCardBill({
        bills: [],
        cardId: 'card-1',
        referenceMonth: '2026-08',
        closingDate: '2026-08-05',
        dueDate: '2026-08-12',
        amount: NaN,
        workspaceId: 'ws-1',
      })
    ).toThrow(/positivo e finito/i);

    expect(() =>
      resolveOrCreateCreditCardBill({
        bills: [],
        cardId: 'card-1',
        referenceMonth: '2026-08',
        closingDate: '2026-08-05',
        dueDate: '2026-08-12',
        amount: Infinity,
        workspaceId: 'ws-1',
      })
    ).toThrow(/positivo e finito/i);

    // 2. reconcileBillAfterItemDeletion rejeita itemAmount <= 0, NaN, Infinity, fatura nula e fatura com total_amount invalido
    const sampleBill: CreditCardBill = {
      id: 'b-1',
      credit_card_id: 'card-1',
      workspace_id: 'ws-1',
      reference_month: '2026-08',
      closing_date: '2026-08-05',
      due_date: '2026-08-12',
      total_amount: 200,
      paid_amount: 0,
      status: 'open',
      created_at: '2026-08-01',
    };

    expect(() => reconcileBillAfterItemDeletion(sampleBill, 0)).toThrow(/positivo e finito/i);
    expect(() => reconcileBillAfterItemDeletion(sampleBill, -10)).toThrow(/positivo e finito/i);
    expect(() => reconcileBillAfterItemDeletion(sampleBill, NaN)).toThrow(/positivo e finito/i);
    expect(() => reconcileBillAfterItemDeletion(sampleBill, Infinity)).toThrow(/positivo e finito/i);
    expect(() => reconcileBillAfterItemDeletion(null as any, 50)).toThrow(/Fatura/i);
    expect(() => reconcileBillAfterItemDeletion({ ...sampleBill, total_amount: NaN }, 50)).toThrow(
      /Valor total da fatura/i
    );

    // 3. Robustez contra paid_amount corrompido em faturas legadas (reconcileBillAfterItemDeletion)
    expect(() => reconcileBillAfterItemDeletion({ ...sampleBill, paid_amount: NaN }, 50)).toThrow(
      /Valor pago da fatura corrompido/i
    );
    expect(() => reconcileBillAfterItemDeletion({ ...sampleBill, paid_amount: -20 }, 50)).toThrow(
      /Valor pago da fatura corrompido/i
    );
  });

  it('deve rejeitar paid_amount corrompido e impedir status pago com saldo zero em resolveOrCreateCreditCardBill (P1-01 V32)', () => {
    const corruptedPaidBill: CreditCardBill = {
      id: 'b-corrupted',
      credit_card_id: 'card-1',
      workspace_id: 'ws-1',
      reference_month: '2026-08',
      closing_date: '2026-08-05',
      due_date: '2026-08-12',
      total_amount: 200,
      paid_amount: NaN,
      status: 'paid',
      created_at: '2026-08-01',
    };

    // Teste regressivo mínimo exigido pela auditoria V31 (P1):
    // 1. Rejeição explícita de fatura com paid_amount = NaN
    expect(() =>
      resolveOrCreateCreditCardBill({
        bills: [corruptedPaidBill],
        cardId: 'card-1',
        referenceMonth: '2026-08',
        closingDate: '2026-08-05',
        dueDate: '2026-08-12',
        amount: 100,
        workspaceId: 'ws-1',
      })
    ).toThrow(/Valor pago da fatura corrompido/i);

    // 2. Rejeição explícita de fatura com paid_amount negativo (-1)
    expect(() =>
      resolveOrCreateCreditCardBill({
        bills: [{ ...corruptedPaidBill, paid_amount: -1, status: 'partially_paid' }],
        cardId: 'card-1',
        referenceMonth: '2026-08',
        closingDate: '2026-08-05',
        dueDate: '2026-08-12',
        amount: 100,
        workspaceId: 'ws-1',
      })
    ).toThrow(/Valor pago da fatura corrompido/i);

    // 3. Garantia anti-status inconsistente: se paid_amount for 0 mas status legado for 'paid',
    // ao adicionar nova despesa unpaid, o status NÃO PODE ser 'paid' nem 'partially_paid'
    const legacyZeroPaidBill: CreditCardBill = {
      ...corruptedPaidBill,
      paid_amount: 0,
      status: 'paid', // Status inconsistente com paid_amount = 0
    };
    const resSanitized = resolveOrCreateCreditCardBill({
      bills: [legacyZeroPaidBill],
      cardId: 'card-1',
      referenceMonth: '2026-08',
      closingDate: '2026-08-05',
      dueDate: '2026-08-12',
      amount: 100,
      workspaceId: 'ws-1',
      isPaid: false,
    });
    expect(resSanitized.updatedBills[0].total_amount).toBe(300);
    expect(resSanitized.updatedBills[0].paid_amount).toBe(0);
    expect(resSanitized.updatedBills[0].status).toBe('open'); // Normalizado com sucesso!
  });

  it('deve executar updateCreditCard e depositGoal através das APIs reais do FinanceProvider (P2-01)', async () => {
    storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));

    const { getCtx } = await mountProvider();
    expect(getCtx().isLoaded).toBe(true);

    // 1. updateCreditCard real no Provider
    const card = getCtx().creditCards[0];
    expect(card).toBeDefined();
    await act(async () => {
      getCtx().updateCreditCard(card.id, {
        name: 'Cartão Atualizado Real',
        credit_limit: 9500,
      });
    });
    const updatedCard = getCtx().creditCards.find((c) => c.id === card.id);
    expect(updatedCard?.name).toBe('Cartão Atualizado Real');
    expect(updatedCard?.credit_limit).toBe(9500);

    // 2. depositGoal real no Provider
    const acc = getCtx().accounts.find((a) => a.active);
    expect(acc).toBeDefined();
    const initialBalance = acc!.current_balance;

    let createdGoal: any;
    await act(async () => {
      createdGoal = getCtx().addGoal({
        name: 'Viagem dos Sonhos',
        target_amount: 5000,
        current_amount: 1000,
        color: '#10b981',
        icon: 'plane',
        status: 'in_progress',
      });
    });

    // Depósito válido de 500 na meta debitando da conta
    await act(async () => {
      getCtx().depositGoal(createdGoal.id, 500, acc!.id);
    });

    const goalAfter = getCtx().goals.find((g) => g.id === createdGoal.id);
    expect(goalAfter?.current_amount).toBe(1500);

    const accAfter = getCtx().accounts.find((a) => a.id === acc!.id);
    expect(accAfter?.current_balance).toBe(initialBalance - 500);

    // Depósito com valor inválido deve rejeitar
    expect(() => getCtx().depositGoal(createdGoal.id, 0, acc!.id)).toThrow(/Valor inválido/i);
    expect(() => getCtx().depositGoal(createdGoal.id, -100, acc!.id)).toThrow(/Valor inválido/i);
  });

  it('deve validar integridade contábil completa de faturas com validateCreditCardBillIntegrity (P1 V33)', () => {
    const validBill: CreditCardBill = {
      id: 'bill-ok',
      credit_card_id: 'card-1',
      workspace_id: 'ws-1',
      reference_month: '2026-08',
      closing_date: '2026-08-05',
      due_date: '2026-08-12',
      total_amount: 500,
      paid_amount: 200,
      status: 'partially_paid',
      created_at: '2026-08-01',
    };

    // 1. Fatura íntegra não lança erro
    expect(() => validateCreditCardBillIntegrity(validBill)).not.toThrow();

    // 2. Fatura nula ou não-objeto
    expect(() => validateCreditCardBillIntegrity(null as any)).toThrow(/Fatura inválida/i);
    expect(() => validateCreditCardBillIntegrity('string' as any)).toThrow(/Fatura inválida/i);

    // 3. total_amount NaN ou negativo
    expect(() => validateCreditCardBillIntegrity({ ...validBill, total_amount: NaN })).toThrow(
      /Valor total da fatura inválido ou negativo/i
    );
    expect(() => validateCreditCardBillIntegrity({ ...validBill, total_amount: -50 })).toThrow(
      /Valor total da fatura inválido ou negativo/i
    );
    expect(() => validateCreditCardBillIntegrity({ ...validBill, total_amount: Infinity })).toThrow(
      /Valor total da fatura inválido ou negativo/i
    );

    // 4. paid_amount NaN ou negativo
    expect(() => validateCreditCardBillIntegrity({ ...validBill, paid_amount: NaN })).toThrow(
      /Valor pago da fatura corrompido ou inválido/i
    );
    expect(() => validateCreditCardBillIntegrity({ ...validBill, paid_amount: -10 })).toThrow(
      /Valor pago da fatura corrompido ou inválido/i
    );

    // 5. Inconsistência contábil: sobrepagamento corrompido (paid_amount > total_amount)
    expect(() => validateCreditCardBillIntegrity({ ...validBill, total_amount: 200, paid_amount: 500 })).toThrow(
      /Inconsistência contábil na fatura: valor pago .* excede o valor total/i
    );

    // 6. Prova de proteção simétrica em resolveOrCreateCreditCardBill com fatura corrompida
    expect(() =>
      resolveOrCreateCreditCardBill({
        bills: [{ ...validBill, total_amount: NaN }],
        cardId: 'card-1',
        referenceMonth: '2026-08',
        closingDate: '2026-08-05',
        dueDate: '2026-08-12',
        amount: 100,
        workspaceId: 'ws-1',
      })
    ).toThrow(/Valor total da fatura inválido ou negativo/i);

    expect(() =>
      resolveOrCreateCreditCardBill({
        bills: [{ ...validBill, total_amount: -100 }],
        cardId: 'card-1',
        referenceMonth: '2026-08',
        closingDate: '2026-08-05',
        dueDate: '2026-08-12',
        amount: 100,
        workspaceId: 'ws-1',
      })
    ).toThrow(/Valor total da fatura inválido ou negativo/i);

    expect(() =>
      resolveOrCreateCreditCardBill({
        bills: [{ ...validBill, total_amount: 200, paid_amount: 500 }],
        cardId: 'card-1',
        referenceMonth: '2026-08',
        closingDate: '2026-08-05',
        dueDate: '2026-08-12',
        amount: 100,
        workspaceId: 'ws-1',
      })
    ).toThrow(/Inconsistência contábil na fatura/i);

    // 7. Prova de proteção simétrica em reconcileBillAfterItemDeletion com sobrepagamento
    expect(() => reconcileBillAfterItemDeletion({ ...validBill, total_amount: 200, paid_amount: 500 }, 50)).toThrow(
      /Inconsistência contábil na fatura/i
    );
  });

    it('deve realizar pagamento total de fatura com soma decimal (10.10 + 20.20 = 30.30) sem falso bloqueio de overpayment', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));

      // Fatura resultante de duas transações: 10.10 + 20.20
      const floatBill: CreditCardBill = {
        id: 'bill-float-1',
        credit_card_id: 'card-1',
        workspace_id: 'ws-1',
        reference_month: '2026-08',
        closing_date: '2026-08-05',
        due_date: '2026-08-12',
        total_amount: 30.3,
        paid_amount: 0,
        status: 'open',
        created_at: '2026-08-01T00:00:00Z',
      };
      storageMap.set('fincontrol_v2_bills', JSON.stringify([floatBill]));

      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const accBefore = getCtx().accounts.find((a) => a.id === 'acc-1');
      const balanceBefore = accBefore?.current_balance || 0;

      // Pagar o valor total exato de 30.30 não deve estourar erro de overpayment
      let paymentRes: any;
      await act(async () => {
        paymentRes = getCtx().payCreditCardBill('bill-float-1', 'acc-1', 30.3);
      });

      expect(paymentRes).toBeDefined();
      expect(paymentRes.amount).toBe(30.3);

      const updatedBill = getCtx().creditCardBills.find((b) => b.id === 'bill-float-1');
      expect(updatedBill?.status).toBe('paid');
      expect(updatedBill?.paid_amount).toBe(30.3);

      const accAfter = getCtx().accounts.find((a) => a.id === 'acc-1');
      expect(accAfter?.current_balance).toBe(fromCents(toCents(balanceBefore) - 3030));
    });

    it('deve realizar pagamento parcial e quitação subsequente em fatura com float drift (0.30 total, 0.10 pago, 0.20 restante)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));

      const floatBill: CreditCardBill = {
        id: 'bill-float-2',
        credit_card_id: 'card-1',
        workspace_id: 'ws-1',
        reference_month: '2026-08',
        closing_date: '2026-08-05',
        due_date: '2026-08-12',
        total_amount: 0.3,
        paid_amount: 0.1,
        status: 'partially_paid',
        created_at: '2026-08-01T00:00:00Z',
      };
      storageMap.set('fincontrol_v2_bills', JSON.stringify([floatBill]));

      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      // Pagar restante 0.20 (0.30 - 0.10) não deve ser bloqueado
      await act(async () => {
        getCtx().payCreditCardBill('bill-float-2', 'acc-1', 0.2);
      });

      const updatedBill = getCtx().creditCardBills.find((b) => b.id === 'bill-float-2');
      expect(updatedBill?.status).toBe('paid');
      expect(updatedBill?.paid_amount).toBe(0.3);
    });

    it('deve rejeitar pagamento que exceda o saldo restante em 1 centavo (30.31 em fatura de 30.30)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));

      const floatBill: CreditCardBill = {
        id: 'bill-float-3',
        credit_card_id: 'card-1',
        workspace_id: 'ws-1',
        reference_month: '2026-08',
        closing_date: '2026-08-05',
        due_date: '2026-08-12',
        total_amount: 30.3,
        paid_amount: 0,
        status: 'open',
        created_at: '2026-08-01T00:00:00Z',
      };
      storageMap.set('fincontrol_v2_bills', JSON.stringify([floatBill]));

      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      expect(() => {
        getCtx().payCreditCardBill('bill-float-3', 'acc-1', 30.31);
      }).toThrow(/Valor do pagamento \(R\$ 30\.31\) excede o saldo restante da fatura \(R\$ 30\.30\)/i);
    });

    it('deve validar integridade contábil e rejeitar payCreditCardBill em fatura corrompida', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));

      const corruptedBill: CreditCardBill = {
        id: 'bill-corrupt-1',
        credit_card_id: 'card-1',
        workspace_id: 'ws-1',
        reference_month: '2026-08',
        closing_date: '2026-08-05',
        due_date: '2026-08-12',
        total_amount: 100,
        paid_amount: 150, // sobrepagamento corrompido
        status: 'paid',
        created_at: '2026-08-01T00:00:00Z',
      };
      storageMap.set('fincontrol_v2_bills', JSON.stringify([corruptedBill]));

      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      expect(() => {
        getCtx().payCreditCardBill('bill-corrupt-1', 'acc-1', 10);
      }).toThrow(/Inconsistência contábil na fatura/i);
    });

    it('deve rejeitar atomicamente sobrepagamento agrupado em faturas no mesmo lote (V36 / P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));

      const arbitraryBill: CreditCardBill = {
        id: 'bill-batch-test',
        credit_card_id: 'card-1',
        workspace_id: 'ws-1',
        reference_month: '2026-08',
        closing_date: '2026-08-05',
        due_date: '2026-08-12',
        total_amount: 30.3,
        paid_amount: 0,
        status: 'open',
        created_at: '2026-08-01T00:00:00Z',
      };
      storageMap.set('fincontrol_v2_bills', JSON.stringify([arbitraryBill]));

      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const accBefore = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      const balanceBefore = accBefore.current_balance;

      await act(async () => {
        getCtx().payCreditCardBill('bill-batch-test', 'acc-1', 20.2, '2026-08-01');

        expect(() => {
          getCtx().payCreditCardBill('bill-batch-test', 'acc-1', 20.2, '2026-08-01');
        }).toThrow(/excede o saldo restante da fatura/i);
      });

      const updatedBill = getCtx().creditCardBills.find((b) => b.id === 'bill-batch-test');
      expect(updatedBill?.paid_amount).toBe(20.2);
      expect(updatedBill?.status).toBe('partially_paid');

      const accAfter = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      expect(accAfter.current_balance).toBe(fromCents(toCents(balanceBefore) - 2020));
    });

    it('deve preservar total da fatura ao adicionar e excluir compra de cartão no mesmo lote (P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const initialBill: CreditCardBill = {
        id: 'bill-sync-1',
        credit_card_id: 'card-1',
        workspace_id: 'ws-1',
        reference_month: '2026-08',
        closing_date: '2026-08-05',
        due_date: '2026-08-12',
        total_amount: 100.00,
        paid_amount: 0,
        status: 'open',
        created_at: '2026-08-01T00:00:00Z',
      };
      storageMap.set('fincontrol_v2_bills', JSON.stringify([initialBill]));

      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      await act(async () => {
        const tx = getCtx().addTransaction({
          type: 'expense',
          amount: 10.10,
          description: 'Compra Cartão Lote',
          category_id: 'cat-1',
          credit_card_id: 'card-1',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
        getCtx().deleteTransaction(tx.id);
      });

      const billAfter = getCtx().creditCardBills.find((b) => b.id === 'bill-sync-1')!;
      expect(billAfter.total_amount).toBe(100.00);
    });

    it('deve permitir quitar novo total da fatura após adicionar compra no mesmo lote (P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const initialBill: CreditCardBill = {
        id: 'bill-sync-2',
        credit_card_id: 'card-1',
        workspace_id: 'ws-1',
        reference_month: '2026-08',
        closing_date: '2026-08-05',
        due_date: '2026-08-12',
        total_amount: 100.00,
        paid_amount: 0,
        status: 'open',
        created_at: '2026-08-01T00:00:00Z',
      };
      storageMap.set('fincontrol_v2_bills', JSON.stringify([initialBill]));

      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      await act(async () => {
        getCtx().addTransaction({
          type: 'expense',
          amount: 10.10,
          description: 'Compra Cartão Lote Quitação',
          category_id: 'cat-1',
          credit_card_id: 'card-1',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
        getCtx().payCreditCardBill('bill-sync-2', 'acc-1', 110.10);
      });

      const billAfter = getCtx().creditCardBills.find((b) => b.id === 'bill-sync-2')!;
      expect(billAfter.total_amount).toBe(110.10);
      expect(billAfter.paid_amount).toBe(110.10);
      expect(billAfter.status).toBe('paid');
    });

    it('deve permitir usar cartão de crédito recém-criado no mesmo lote (P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const catId = getCtx().categories[0]?.id || 'cat-1';
      let card: any;
      let tx: any;

      await act(async () => {
        card = getCtx().addCreditCard({
          name: 'Novo Cartão Platinum Lote',
          institution: 'Nubank',
          credit_limit: 5000,
          closing_day: 5,
          due_day: 12,
          color: '#3b82f6',
          active: true,
        });

        tx = getCtx().addTransaction({
          description: 'Compra Cartão Novo Lote',
          amount: 80.0,
          type: 'expense',
          category_id: catId,
          credit_card_id: card.id,
          transaction_date: '2026-08-01',
          due_date: '2026-08-12',
          status: 'pending',
        });
      });

      expect(tx).toBeDefined();
      expect(tx.credit_card_id).toBe(card.id);
      expect(tx.credit_card_bill_id).toBeDefined();
      expect(getCtx().transactions.find((t) => t.id === tx.id)).toBeDefined();
    });

    it('deve rejeitar compra vinculada a cartão inativado no mesmo lote (P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const catId = getCtx().categories[0]?.id || 'cat-1';

      await act(async () => {
        getCtx().updateCreditCard('card-1', { active: false });
        expect(() => {
          getCtx().addTransaction({
            description: 'Compra Cartão Inativo Lote',
            amount: 50.0,
            type: 'expense',
            category_id: catId,
            credit_card_id: 'card-1',
            transaction_date: '2026-08-01',
            due_date: '2026-08-12',
            status: 'pending',
          });
        }).toThrow(/está inativo/i);
      });

      expect(getCtx().transactions.find((t) => t.description === 'Compra Cartão Inativo Lote')).toBeUndefined();
    });

    it('deve validar conta vinculada inexistente ou inativa ao adicionar/atualizar cartão ou método de pagamento', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      await act(async () => {
        getCtx().updateAccount('acc-1', { active: false });
      });

      // 1. addCreditCard com conta inexistente ou inativa
      expect(() => {
        getCtx().addCreditCard({
          name: 'Cartão Teste Inexistente',
          institution: 'Nubank',
          color: '#000',
          active: true,
          credit_limit: 1000,
          closing_day: 5,
          due_day: 15,
          linked_payment_account_id: 'acc-inexistente',
        });
      }).toThrow('Conta vinculada ao cartão não pertence ao workspace ativo.');

      expect(() => {
        getCtx().addCreditCard({
          name: 'Cartão Teste Inativa',
          institution: 'Nubank',
          color: '#000',
          active: true,
          credit_limit: 1000,
          closing_day: 5,
          due_day: 15,
          linked_payment_account_id: 'acc-1',
        });
      }).toThrow('A conta bancária vinculada ao cartão está inativa.');

      // 2. updateCreditCard com conta inexistente ou inativa
      expect(() => {
        getCtx().updateCreditCard('card-1', {
          linked_payment_account_id: 'acc-inexistente',
        });
      }).toThrow('Conta vinculada ao cartão não pertence ao workspace ativo.');

      expect(() => {
        getCtx().updateCreditCard('card-1', {
          linked_payment_account_id: 'acc-1',
        });
      }).toThrow('A conta bancária vinculada ao cartão está inativa.');

      // 3. addPaymentMethod com conta inexistente ou inativa
      expect(() => {
        getCtx().addPaymentMethod({
          name: 'PM Teste Inexistente',
          type: 'debit_card',
          active: true,
          linked_account_id: 'acc-inexistente',
        });
      }).toThrow('Conta vinculada ao método de pagamento não pertence ao workspace ativo.');

      expect(() => {
        getCtx().addPaymentMethod({
          name: 'PM Teste Inativa',
          type: 'debit_card',
          active: true,
          linked_account_id: 'acc-1',
        });
      }).toThrow('A conta bancária vinculada ao método de pagamento está inativa.');

      // 4. payCreditCardBill com valor inválido
      const bill = getCtx().creditCardBills[0];
      if (bill) {
        expect(() => {
          getCtx().payCreditCardBill(bill.id, 'acc-1', 0);
        }).toThrow();
      }
    });

    it('createInstallmentPurchase: gera pagamentos de parcelas pré-pagas (linha 127) e valida regras de negócio', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      // 1. Compra com parcelas pré-pagas (paid_installments_count = 1) -> exercita linha 127 de installment-actions.ts
      let purWithPaid: any;
      await act(async () => {
        purWithPaid = getCtx().createInstallmentPurchase({
          description: 'Notebook Parcelado Pré-pago',
          total_amount: 3000,
          installment_count: 3,
          paid_installments_count: 1,
          purchase_date: '2026-08-01',
          payment_method_id: 'pm-1',
          category_id: getCtx().categories[0]?.id,
        });
      });

      expect(purWithPaid).toBeDefined();
      expect(purWithPaid.paid_installments_count).toBe(1);

      // Verificar parcelas geradas
      const installments = getCtx().installments.filter((i) => i.purchase_id === purWithPaid.id);
      expect(installments).toHaveLength(3);
      expect(installments[0].status).toBe('paid');
      expect(installments[0].paid_amount).toBe(1000);
      expect(installments[1].status).toBe('pending');
      expect(installments[2].status).toBe('pending');

      // Verificar pagamento gerado para a parcela pré-paga
      const payments = getCtx().payments.filter((p) => p.installment_id === installments[0].id);
      expect(payments).toHaveLength(1);
      expect(payments[0].amount).toBe(1000);
      expect(payments[0].notes).toContain('Quitação prévia');

      // 2. Parâmetros inválidos de parcelamento (splitInstallments retorna vazio)
      expect(() => {
        getCtx().createInstallmentPurchase({
          description: 'Parcelas Inválidas',
          total_amount: 500,
          installment_count: 0,
          purchase_date: '2026-08-01',
        });
      }).toThrow('Parâmetros de parcelamento inválidos.');

      // 3. Valor total inválido (<= 0)
      expect(() => {
        getCtx().createInstallmentPurchase({
          description: 'Valor Inválido',
          total_amount: -50,
          installment_count: 3,
          purchase_date: '2026-08-01',
        });
      }).toThrow('O valor total da compra parcelada deve ser maior que zero.');

      // 4. Conta bancária inexistente
      expect(() => {
        getCtx().createInstallmentPurchase({
          description: 'Conta Inexistente',
          total_amount: 100,
          installment_count: 2,
          purchase_date: '2026-08-01',
          account_id: 'acc-inexistente-ws999',
        });
      }).toThrow('Conta bancária informada não pertence ao workspace ativo.');

      // 5. Conta bancária inativa
      await act(async () => {
        getCtx().updateAccount('acc-1', { active: false });
      });

      expect(() => {
        getCtx().createInstallmentPurchase({
          description: 'Conta Inativa',
          total_amount: 100,
          installment_count: 2,
          purchase_date: '2026-08-01',
          account_id: 'acc-1',
        });
      }).toThrow('A conta bancária informada está inativa.');
    });

    it('payCreditCardBill deve aplicar fallbacks padrão quando amount, paymentDate ou notes forem omitidos e rejeitar valor <= 0', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));

      const billToPay: CreditCardBill = {
        id: 'bill-default-args',
        credit_card_id: 'card-1',
        workspace_id: 'ws-1',
        reference_month: '2026-08',
        closing_date: '2026-08-05',
        due_date: '2026-08-12',
        total_amount: 500,
        paid_amount: 100,
        status: 'partially_paid',
        created_at: '2026-08-01T00:00:00Z',
      };
      storageMap.set('fincontrol_v2_bills', JSON.stringify([billToPay]));

      const { getCtx } = await mountProvider();

      // 1. Rejeita valor inválido (<= 0)
      expect(() => {
        getCtx().payCreditCardBill('bill-default-args', 'acc-1', -10);
      }).toThrow('Valor inválido para pagamento.');

      expect(() => {
        getCtx().payCreditCardBill('bill-default-args', 'acc-1', 0);
      }).toThrow('Valor inválido para pagamento.');

      // 2. Chama payCreditCardBill omitindo amount (deve pagar os 400 restantes), paymentDate (hoje) e notes (default)
      await act(async () => {
        getCtx().payCreditCardBill('bill-default-args', 'acc-1');
      });

      const updatedBill = getCtx().creditCardBills.find((b) => b.id === 'bill-default-args');
      expect(updatedBill?.status).toBe('paid');
      expect(updatedBill?.paid_amount).toBe(500);

      const payment = getCtx().payments.find((p) => p.credit_card_bill_id === 'bill-default-args');
      expect(payment?.amount).toBe(400);
      expect(payment?.notes).toBe('Pagamento de fatura 2026-08');
      expect(payment?.payment_date).toBeDefined();
    });

    it('validações de conta vinculada em addCreditCard e updateCreditCard, fatura inexistente e validações em depositGoal', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();

      // 1. addCreditCard com conta vinculada inexistente e inativa
      expect(() => {
        getCtx().addCreditCard({
          name: 'Cartão Inválido',
          institution: 'Banco X',
          credit_limit: 5000,
          closing_day: 5,
          due_day: 12,
          color: '#123',
          active: true,
          linked_payment_account_id: 'acc-inexistente-ws999',
        });
      }).toThrow('Conta vinculada ao cartão não pertence ao workspace ativo.');

      await act(async () => {
        getCtx().updateAccount('acc-1', { active: false });
      });

      expect(() => {
        getCtx().addCreditCard({
          name: 'Cartão Inválido',
          institution: 'Banco X',
          credit_limit: 5000,
          closing_day: 5,
          due_day: 12,
          color: '#123',
          active: true,
          linked_payment_account_id: 'acc-1',
        });
      }).toThrow('A conta bancária vinculada ao cartão está inativa.');

      // 2. updateCreditCard com conta vinculada inexistente e inativa
      expect(() => {
        getCtx().updateCreditCard('card-1', {
          linked_payment_account_id: 'acc-inexistente-ws999',
        });
      }).toThrow('Conta vinculada ao cartão não pertence ao workspace ativo.');

      expect(() => {
        getCtx().updateCreditCard('card-1', {
          linked_payment_account_id: 'acc-1',
        });
      }).toThrow('A conta bancária vinculada ao cartão está inativa.');

      // Reativa acc-1
      await act(async () => {
        getCtx().updateAccount('acc-1', { active: true });
      });

      // 3. payCreditCardBill com fatura inexistente
      expect(() => {
        getCtx().payCreditCardBill('bill-inexistente', 'acc-1', 100);
      }).toThrow('Fatura não encontrada no workspace ativo.');

      // 4. depositGoal com meta inexistente, conta inexistente e conta inativa
      expect(() => {
        getCtx().depositGoal('goal-inexistente', 100, 'acc-1');
      }).toThrow('Meta financeira não encontrada no workspace ativo.');

      // Adiciona uma meta válida
      let createdGoal: any;
      await act(async () => {
        createdGoal = getCtx().addGoal({
          name: 'Viagem',
          target_amount: 5000,
          current_amount: 0,
          target_date: '2027-01-01',
          status: 'in_progress',
          color: '#10b981',
          icon: 'Plane',
        });
      });

      expect(() => {
        getCtx().depositGoal(createdGoal.id, 100, 'acc-inexistente');
      }).toThrow('Conta bancária não encontrada no workspace ativo.');

      await act(async () => {
        getCtx().updateAccount('acc-1', { active: false });
      });

      expect(() => {
        getCtx().depositGoal(createdGoal.id, 100, 'acc-1');
      }).toThrow('A conta bancária informada está inativa.');

      // Reativa acc-1
      await act(async () => {
        getCtx().updateAccount('acc-1', { active: true });
      });

      // 5. updateCreditCard com conta vinculada ATIVA (cobre branch false de acc.active === false na linha 51)
      await act(async () => {
        getCtx().updateCreditCard('card-1', {
          linked_payment_account_id: 'acc-1',
        });
      });
      expect(getCtx().creditCards.find((c) => c.id === 'card-1')?.linked_payment_account_id).toBe('acc-1');

      // 6. payCreditCardBill em fatura com paid_amount = 0 omitindo o argumento amount (cobre linha 86 fallback)
      // Cria fatura e quita integralmente sem passar amount
      const billZero: CreditCardBill = {
        id: 'bill-sem-paid-amount',
        credit_card_id: 'card-1',
        workspace_id: 'ws-1',
        reference_month: '2026-09',
        closing_date: '2026-09-05',
        due_date: '2026-09-12',
        total_amount: 300,
        paid_amount: 0,
        status: 'open',
        created_at: '2026-09-01T00:00:00Z',
      };
      storageMap.set('fincontrol_v2_bills', JSON.stringify([billZero]));

      const { getCtx: getFreshCtx } = await mountProvider();
      await act(async () => {
        getFreshCtx().payCreditCardBill('bill-sem-paid-amount', 'acc-1');
      });
      const paidRes = getFreshCtx().creditCardBills.find((b) => b.id === 'bill-sem-paid-amount');
      expect(paidRes?.status).toBe('paid');
      expect(paidRes?.paid_amount).toBe(300);

      // 7. createInstallmentPurchase com paid_installments_count > 0 e account_id explícito (cobre linha 133)
      let purExplicitAcc: any;
      await act(async () => {
        purExplicitAcc = getFreshCtx().createInstallmentPurchase({
          description: 'Notebook Parcela Paga Com Conta',
          total_amount: 1500,
          installment_count: 3,
          paid_installments_count: 1,
          account_id: 'acc-1',
          purchase_date: '2026-08-01',
        });
      });
      expect(purExplicitAcc).toBeDefined();
      const linkedPayment = getFreshCtx().payments.find((p) => p.account_id === 'acc-1' && p.installment_id);
      expect(linkedPayment).toBeDefined();

      // 8. createInstallmentPurchase com paid_installments_count > 0 sem account_id (cobre linha 133: null e linha 136: inst.due_date)
      let purNoAcc: any;
      await act(async () => {
        purNoAcc = getFreshCtx().createInstallmentPurchase({
          description: 'Móveis Sem Conta Vinculada',
          total_amount: 900,
          installment_count: 3,
          paid_installments_count: 1,
          purchase_date: '2026-08-01',
        });
      });
      expect(purNoAcc).toBeDefined();
      const unlinkedPay = getFreshCtx().payments.find(
        (p) => p.account_id === null && p.installment_id
      );
      expect(unlinkedPay).toBeDefined();

      // 9. recordPayment com número inválido de alvos (cobre linha 33 de payment-actions.ts)
      expect(() => {
        getFreshCtx().recordPayment({
          account_id: 'acc-1',
          amount: 50,
          payment_date: '2026-08-01',
        } as any);
      }).toThrow('Informe exatamente uma obrigação de destino para o pagamento.');
    });
});

