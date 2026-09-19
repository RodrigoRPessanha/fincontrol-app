import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { FinanceProvider, useFinance } from '../context/finance-context';
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
} from '../financial-engine';
import { CreditCardBill } from '../types';

describe('FinanceProvider Wiring & Integracao Real React (P1-01 Obrigatorio V30)', () => {
  let storageMap: Map<string, string>;

  beforeEach(() => {
    class MockNode {
      nodeType = 1;
      childNodes: any[] = [];
      parentNode: any = null;
      ownerDocument: any = null;
      appendChild(child: any) { child.parentNode = this; this.childNodes.push(child); return child; }
      removeChild(child: any) { const idx = this.childNodes.indexOf(child); if (idx >= 0) this.childNodes.splice(idx, 1); return child; }
      insertBefore(child: any, ref: any) { const idx = this.childNodes.indexOf(ref); if (idx >= 0) this.childNodes.splice(idx, 0, child); else this.appendChild(child); return child; }
    }

    class MockElement extends MockNode {
      tagName = 'DIV';
      style = {};
      setAttribute() {}
      removeAttribute() {}
      addEventListener() {}
      removeEventListener() {}
    }

    const doc: any = new MockNode();
    doc.nodeType = 9;
    doc.defaultView = globalThis;
    doc.activeElement = null;
    doc.createElement = (tag: string) => {
      const el = new MockElement();
      el.tagName = tag.toUpperCase();
      el.ownerDocument = doc;
      return el;
    };
    doc.createElementNS = (_ns: string, tag: string) => doc.createElement(tag);
    doc.createTextNode = (val: string) => { const n: any = new MockNode(); n.nodeType = 3; n.nodeValue = val; n.ownerDocument = doc; return n; };
    doc.createComment = (val: string) => { const n: any = new MockNode(); n.nodeType = 8; n.nodeValue = val; n.ownerDocument = doc; return n; };
    doc.documentElement = doc.createElement('html');
    doc.head = doc.createElement('head');
    doc.body = doc.createElement('body');
    doc.addEventListener = () => {};
    doc.removeEventListener = () => {};

    (globalThis as any).document = doc;
    (globalThis as any).window = globalThis;
    (globalThis as any).Node = MockNode;
    (globalThis as any).Element = MockElement;
    (globalThis as any).HTMLElement = MockElement;
    (globalThis as any).HTMLIFrameElement = class extends MockElement {};
    (globalThis as any).HTMLInputElement = class extends MockElement {};
    (globalThis as any).HTMLTextAreaElement = class extends MockElement {};
    (globalThis as any).HTMLSelectElement = class extends MockElement {};
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

    storageMap = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => storageMap.get(k) ?? null,
      setItem: (k: string, v: string) => storageMap.set(k, v),
      removeItem: (k: string) => storageMap.delete(k),
      clear: () => storageMap.clear(),
    };
  });

  const activeRoots: any[] = [];

  afterEach(async () => {
    while (activeRoots.length > 0) {
      const root = activeRoots.pop();
      try {
        await act(async () => {
          root.unmount();
        });
      } catch {
        // cleanup silencioso
      }
    }
  });

  async function mountProvider(): Promise<{
    getCtx: () => ReturnType<typeof useFinance>;
    root: any;
    container: any;
  }> {
    let currentCtx!: ReturnType<typeof useFinance>;
    function Consumer() {
      currentCtx = useFinance();
      return null;
    }

    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);
    activeRoots.push(root);

    await act(async () => {
      root.render(React.createElement(FinanceProvider, null, React.createElement(Consumer)));
    });

    for (let i = 0; i < 25 && !currentCtx?.isLoaded; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
    }

    return { getCtx: () => currentCtx, root, container };
  }

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

  it('deve proteger campos imutaveis (workspace_id, id, created_at) via APIs reais do FinanceProvider (P2-02)', async () => {
    storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));

    const { getCtx } = await mountProvider();
    expect(getCtx().isLoaded).toBe(true);

    const acc = getCtx().accounts[0];
    expect(acc).toBeDefined();
    const originalAccId = acc.id;
    const originalWsId = acc.workspace_id;
    const originalCreatedAt = acc.created_at;

    await act(async () => {
      getCtx().updateAccount(originalAccId, {
        name: 'Nome Atualizado Pelo Provider',
        // Injetando campos que devem ser ignorados/protegidos
        ...({ workspace_id: 'ws-hacked', id: 'acc-hacked', created_at: '2099-01-01' } as any),
      });
    });

    const updatedAcc = getCtx().accounts.find((a) => a.id === originalAccId);
    expect(updatedAcc).toBeDefined();
    expect(updatedAcc?.name).toBe('Nome Atualizado Pelo Provider');
    expect(updatedAcc?.id).toBe(originalAccId);
    expect(updatedAcc?.workspace_id).toBe(originalWsId);
    expect(updatedAcc?.created_at).toBe(originalCreatedAt);
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

  describe('Aritmética Monetária em Centavos Inteiros e Proteção Contra IEEE 754 Float Drift (V34)', () => {
    it('deve converter e comparar valores monetários sem distorção de float', () => {
      // 10.10 + 20.20 no IEEE 754 cru é 30.299999999999997
      const rawFloatSum = 10.1 + 20.2;
      expect(rawFloatSum).not.toBe(30.3);
      expect(toCents(rawFloatSum)).toBe(3030);
      expect(fromCents(3030)).toBe(30.3);
      expect(roundCurrency(rawFloatSum)).toBe(30.3);

      // Comparações de centavos
      expect(compareCurrency(rawFloatSum, 30.3)).toBe(0);
      expect(compareCurrency(30.31, 30.3)).toBeGreaterThan(0);
      expect(compareCurrency(30.29, 30.3)).toBeLessThan(0);

      // 0.30 - 0.10 no IEEE 754 cru é 0.19999999999999998
      const rawFloatDiff = 0.3 - 0.1;
      expect(rawFloatDiff).not.toBe(0.2);
      expect(toCents(rawFloatDiff)).toBe(20);
      expect(fromCents(20)).toBe(0.2);
      expect(roundCurrency(rawFloatDiff)).toBe(0.2);
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

    it('deve aplicar precisão de centavos em recordPayment para transações e parcelas', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));

      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      // 1. Criar transação à vista com valor 30.30
      let tx: any;
      await act(async () => {
        tx = getCtx().addTransaction({
          description: 'Serviço pontual 30.30',
          amount: 30.3,
          type: 'expense',
          transaction_date: '2026-08-02',
          due_date: '2026-08-02',
          account_id: 'acc-1',
          category_id: getCtx().categories[0]?.id,
          status: 'pending',
        });
      });

      // Pagar parcial de 10.10
      await act(async () => {
        getCtx().recordPayment({
          transaction_id: tx.id,
          account_id: 'acc-1',
          amount: 10.1,
          payment_date: '2026-08-02',
        });
      });

      let currentTx = getCtx().transactions.find((t) => t.id === tx.id);
      expect(currentTx?.status).toBe('partially_paid');
      expect(currentTx?.paid_amount).toBe(10.1);

      // Pagar restante de 20.20 (total 30.30) - sem erro de float
      await act(async () => {
        getCtx().recordPayment({
          transaction_id: tx.id,
          account_id: 'acc-1',
          amount: 20.2,
          payment_date: '2026-08-02',
        });
      });

      currentTx = getCtx().transactions.find((t) => t.id === tx.id);
      expect(currentTx?.status).toBe('paid');
      expect(currentTx?.paid_amount).toBe(30.3);

      // Tentar pagar mais 0.01 deve ser rejeitado
      expect(() => {
        getCtx().recordPayment({
          transaction_id: tx.id,
          account_id: 'acc-1',
          amount: 0.01,
          payment_date: '2026-08-02',
        });
      }).toThrow(/excede o saldo restante da transação/i);

      // 2. Criar compra parcelada fora de cartão com parcela de 30.30 (V35 / P2-01)
      let pur: any;
      await act(async () => {
        pur = getCtx().createInstallmentPurchase({
          description: 'Parcelamento 30.30',
          total_amount: 30.3,
          installment_count: 1,
          purchase_date: '2026-08-02',
          account_id: 'acc-1',
          category_id: getCtx().categories[0]?.id,
        });
      });
      const inst = getCtx().installments.find((i) => i.purchase_id === pur.id);
      expect(inst).toBeDefined();
      const instId = inst!.id;

      // Pagar parcial de 10.10 na parcela
      await act(async () => {
        getCtx().recordPayment({
          installment_id: instId,
          account_id: 'acc-1',
          amount: 10.1,
          payment_date: '2026-08-02',
        });
      });
      let currentInst = getCtx().installments.find((i) => i.id === instId);
      expect(currentInst?.status).toBe('partially_paid');
      expect(currentInst?.paid_amount).toBe(10.1);

      // Pagar restante de 20.20 (total 30.30)
      await act(async () => {
        getCtx().recordPayment({
          installment_id: instId,
          account_id: 'acc-1',
          amount: 20.2,
          payment_date: '2026-08-02',
        });
      });
      currentInst = getCtx().installments.find((i) => i.id === instId);
      expect(currentInst?.status).toBe('paid');
      expect(currentInst?.paid_amount).toBe(30.3);

      // Tentar pagar 0.01 adicional deve ser rejeitado
      expect(() => {
        getCtx().recordPayment({
          installment_id: instId,
          account_id: 'acc-1',
          amount: 0.01,
          payment_date: '2026-08-02',
        });
      }).toThrow(/excede o saldo restante da parcela/i);
    });

    it('deve concluir meta financeira sem falha por float drift (0.30 + 0.60 = 0.90) (V35 / P1)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));

      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const accBefore = getCtx().accounts.find((a) => a.id === 'acc-1');
      const balanceBefore = accBefore?.current_balance || 0;

      // Criar meta com target de 0.90
      let goal: any;
      await act(async () => {
        goal = getCtx().addGoal({
          name: 'Meta Teste Float',
          target_amount: 0.9,
          current_amount: 0,
          target_date: '2026-12-31',
          status: 'in_progress',
          color: '#10b981',
          icon: 'piggy-bank',
        });
      });

      // Primeiro depósito de 0.30
      await act(async () => {
        getCtx().depositGoal(goal.id, 0.3, 'acc-1');
      });
      let currentGoal = getCtx().goals.find((g) => g.id === goal.id);
      expect(currentGoal?.current_amount).toBe(0.3);
      expect(currentGoal?.status).toBe('in_progress');

      // Segundo depósito de 0.60 (0.30 + 0.60 = 0.90; em float cru seria 0.8999999999999999)
      await act(async () => {
        getCtx().depositGoal(goal.id, 0.6, 'acc-1');
      });
      currentGoal = getCtx().goals.find((g) => g.id === goal.id);
      expect(currentGoal?.current_amount).toBe(0.9);
      expect(currentGoal?.status).toBe('completed');

      // Verificar que saldo da conta debitou exatamente 0.90 em centavos
      const accAfter = getCtx().accounts.find((a) => a.id === 'acc-1');
      expect(accAfter?.current_balance).toBe(fromCents(toCents(balanceBefore) - 90));
    });

    it('deve transferir valores decimais preservando saldos em centavos exatos (V35 / P1)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));

      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const acc1Before = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      const acc2Before = getCtx().accounts.find((a) => a.id === 'acc-2')!;
      const balance1Before = acc1Before.current_balance;
      const balance2Before = acc2Before.current_balance;

      // Transferência 1: 10.15
      await act(async () => {
        getCtx().createTransfer('acc-1', 'acc-2', 10.15);
      });

      // Transferência 2: 20.25
      await act(async () => {
        getCtx().createTransfer('acc-1', 'acc-2', 20.25);
      });

      const acc1After = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      const acc2After = getCtx().accounts.find((a) => a.id === 'acc-2')!;

      // 10.15 + 20.25 = 30.40
      expect(acc1After.current_balance).toBe(fromCents(toCents(balance1Before) - 3040));
      expect(acc2After.current_balance).toBe(fromCents(toCents(balance2Before) + 3040));
    });

    it('deve retornar saldo exatamente ao original após addTransaction paga e deleteTransaction (V35 / P1)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));

      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const accBefore = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      const originalBalance = accBefore.current_balance;

      let tx: any;
      await act(async () => {
        tx = getCtx().addTransaction({
          description: 'Despesa paga imediata',
          amount: 30.3,
          type: 'expense',
          transaction_date: '2026-08-02',
          due_date: '2026-08-02',
          account_id: 'acc-1',
          category_id: getCtx().categories[0]?.id,
          status: 'paid',
        });
      });

      const accDuring = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      expect(accDuring.current_balance).toBe(fromCents(toCents(originalBalance) - 3030));

      await act(async () => {
        getCtx().deleteTransaction(tx.id);
      });

      const accAfter = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      expect(accAfter.current_balance).toBe(originalBalance);
    });

    it('deve normalizar agregações de Dashboard e Previsões em centavos (V35 / P2-02)', () => {
      const mockTxs: any[] = [
        {
          id: 'tx-1',
          workspace_id: 'ws-1',
          amount: 10.1,
          type: 'expense',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        },
        {
          id: 'tx-2',
          workspace_id: 'ws-1',
          amount: 20.2,
          type: 'expense',
          transaction_date: '2026-08-02',
          due_date: '2026-08-02',
          status: 'pending',
        },
      ];

      const dashboard = calculateDashboardSummary(
        mockTxs,
        [],
        [],
        [{ current_balance: 100.1 }, { current_balance: 200.2 }],
        [],
        '2026-08'
      );
      expect(dashboard.planned.expense).toBe(30.3);
      expect(dashboard.planned.net).toBe(-30.3);
      expect(dashboard.totalBalance).toBe(300.3);

      const commitments = calculateFutureCommitments([], [], mockTxs, 1, new Date(2026, 7, 1));
      expect(commitments[0].pendingTransactionsAmount).toBe(30.3);
      expect(commitments[0].totalCommitment).toBe(30.3);
      expect(commitments[0].netForecast).toBe(-30.3);
    });

    it('deve formalizar política determinística de arredondamento para >2 casas decimais (V35 / P2-03)', () => {
      expect(roundCurrency(1.005)).toBe(1.01);
      expect(roundCurrency(1.004)).toBe(1.0);
      expect(toCents(1.005)).toBe(101);
      expect(toCents(1.004)).toBe(100);
      expect(fromCents(101)).toBe(1.01);
    });

    it('deve calcular toCents e roundCurrency com half-up exponencial imune a erros de escala IEEE 754 (V36 / P2-02)', () => {
      // 10.075 * 100 em float IEEE 754 dá 1007.499999999999886...
      // Com arredondamento exponencial comercial half-up:
      expect(toCents(10.075)).toBe(1008);
      expect(roundCurrency(10.075)).toBe(10.08);
      expect(toCents(10.074)).toBe(1007);
      expect(roundCurrency(10.074)).toBe(10.07);

      // Casos negativos simétricos
      expect(toCents(-10.075)).toBe(-1008);
      expect(roundCurrency(-10.075)).toBe(-10.08);
      expect(toCents(-10.074)).toBe(-1007);
      expect(roundCurrency(-10.074)).toBe(-10.07);

      // Tratamento defensivo de valores não-finitos
      expect(toCents(NaN)).toBe(0);
      expect(toCents(Infinity)).toBe(0);
      expect(toCents(-Infinity)).toBe(0);
      expect(fromCents(NaN)).toBe(0);
      expect(roundCurrency(NaN)).toBe(0);

      // Normalização de zero
      expect(Object.is(toCents(-0), 0)).toBe(true);
      expect(Object.is(fromCents(-0), 0)).toBe(true);
    });

    it('deve suportar chamadas agrupadas no mesmo lote (batching) em depositGoal preservando acumulador funcional (V36 / P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));

      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const accBefore = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      const balanceBefore = accBefore.current_balance;

      let goal: any;
      await act(async () => {
        goal = getCtx().addGoal({
          name: 'Meta Lote V36',
          target_amount: 0.9,
          current_amount: 0,
          target_date: '2026-12-31',
          status: 'in_progress',
          color: '#10b981',
          icon: 'target',
        });
      });

      // Duas chamadas seguidas no MESMO act/lote sem esperar renderização intermediária
      await act(async () => {
        getCtx().depositGoal(goal.id, 0.3, 'acc-1');
        getCtx().depositGoal(goal.id, 0.6, 'acc-1');
      });

      const updatedGoal = getCtx().goals.find((g) => g.id === goal.id);
      expect(updatedGoal?.current_amount).toBe(0.9);
      expect(updatedGoal?.status).toBe('completed');

      const accAfter = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      expect(accAfter.current_balance).toBe(fromCents(toCents(balanceBefore) - 90));
    });

    it('deve suportar chamadas agrupadas no mesmo lote (batching) em recordPayment preservando acumulador funcional (V36 / P1-02)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));

      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const accBefore = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      const balanceBefore = accBefore.current_balance;

      let tx: any;
      await act(async () => {
        tx = getCtx().addTransaction({
          type: 'expense',
          amount: 30.3,
          description: 'Despesa Parcelada V36',
          category_id: 'cat-1',
          account_id: 'acc-1',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
      });

      // Duas quitações parciais no MESMO act/lote: 10.10 + 20.20 = 30.30
      await act(async () => {
        getCtx().recordPayment({
          transaction_id: tx.id,
          account_id: 'acc-1',
          amount: 10.1,
          payment_date: '2026-08-01',
        });
        getCtx().recordPayment({
          transaction_id: tx.id,
          account_id: 'acc-1',
          amount: 20.2,
          payment_date: '2026-08-01',
        });
      });

      const updatedTx = getCtx().transactions.find((t) => t.id === tx.id);
      expect(updatedTx?.paid_amount).toBe(30.3);
      expect(updatedTx?.status).toBe('paid');

      // Saldo da conta foi debitado em 10.10 + 20.20 = 30.30
      const accAfter = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      expect(accAfter.current_balance).toBe(fromCents(toCents(balanceBefore) - 3030));
    });

    it('deve rejeitar transferência subcentavo (1e-7) sem zerar nem corromper contas (V36 / P0-02)', async () => {
      // Helper deve retornar 0 para representações científicas extremas em vez de NaN
      expect(toCents(1e-7)).toBe(0);
      expect(toCents(1e21)).toBe(0);
      expect(fromCents(NaN)).toBe(0);

      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const acc1Before = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      const acc2Before = getCtx().accounts.find((a) => a.id === 'acc-2')!;
      const balance1Before = acc1Before.current_balance;
      const balance2Before = acc2Before.current_balance;

      // Tentativa de transferir valor subcentavo (0.0000001 = 1e-7) deve ser rejeitada
      await act(async () => {
        expect(() => {
          getCtx().createTransfer('acc-1', 'acc-2', 0.0000001);
        }).toThrow(/pelo menos R\$ 0,01/i);
      });

      // Conservação estrita de saldos: NENHUM saldo foi zerado ou mutado
      const acc1After = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      const acc2After = getCtx().accounts.find((a) => a.id === 'acc-2')!;
      expect(acc1After.current_balance).toBe(balance1Before);
      expect(acc2After.current_balance).toBe(balance2Before);
    });

    it('deve rejeitar atomicamente sobrepagamento agrupado em transações no mesmo lote (V36 / P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const accBefore = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      const balanceBefore = accBefore.current_balance;

      let tx: any;
      await act(async () => {
        tx = getCtx().addTransaction({
          type: 'expense',
          amount: 30.3,
          description: 'Despesa Concorrente V36',
          category_id: 'cat-1',
          account_id: 'acc-1',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
      });

      // Duas chamadas de 20.20 no mesmo act/lote: a 1ª passa, a 2ª deve falhar
      await act(async () => {
        getCtx().recordPayment({
          transaction_id: tx.id,
          account_id: 'acc-1',
          amount: 20.2,
          payment_date: '2026-08-01',
        });

        expect(() => {
          getCtx().recordPayment({
            transaction_id: tx.id,
            account_id: 'acc-1',
            amount: 20.2,
            payment_date: '2026-08-01',
          });
        }).toThrow(/excede o saldo restante/i);
      });

      const updatedTx = getCtx().transactions.find((t) => t.id === tx.id);
      expect(updatedTx?.paid_amount).toBe(20.2);
      expect(updatedTx?.status).toBe('partially_paid');

      // Conta debitada estritamente em 20.20 (não 40.40)
      const accAfter = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      expect(accAfter.current_balance).toBe(fromCents(toCents(balanceBefore) - 2020));
    });

    it('deve rejeitar atomicamente sobrepagamento agrupado em parcelas no mesmo lote (V36 / P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const accBefore = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      const balanceBefore = accBefore.current_balance;

      // Criar compra parcelada avulsa (sem cartão)
      let pur: any;
      await act(async () => {
        pur = getCtx().createInstallmentPurchase({
          description: 'Curso Parcelado V36',
          total_amount: 30.3,
          category_id: 'cat-1',
          installment_count: 1,
          purchase_date: '2026-08-01',
          account_id: 'acc-1',
        });
      });

      const inst = getCtx().installments.find((i) => i.purchase_id === pur.id)!;
      expect(inst).toBeDefined();

      await act(async () => {
        getCtx().recordPayment({
          installment_id: inst.id,
          account_id: 'acc-1',
          amount: 20.2,
          payment_date: '2026-08-01',
        });

        expect(() => {
          getCtx().recordPayment({
            installment_id: inst.id,
            account_id: 'acc-1',
            amount: 20.2,
            payment_date: '2026-08-01',
          });
        }).toThrow(/excede o saldo restante/i);
      });

      const updatedInst = getCtx().installments.find((i) => i.id === inst.id);
      expect(updatedInst?.paid_amount).toBe(20.2);
      expect(updatedInst?.status).toBe('partially_paid');

      const accAfter = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      expect(accAfter.current_balance).toBe(fromCents(toCents(balanceBefore) - 2020));
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

    it('deve sincronizar estado entre updateTransaction e recordPayment no mesmo lote rejeitando excesso após edição (V36 / P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const accBefore = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      const balanceBefore = accBefore.current_balance;

      let tx: any;
      await act(async () => {
        tx = getCtx().addTransaction({
          type: 'expense',
          amount: 30.3,
          description: 'Transação Inicial 30.30',
          category_id: 'cat-1',
          account_id: 'acc-1',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
      });

      // No MESMO act/lote: edita o valor de 30.30 para 10.10 e tenta pagar 20.20
      await act(async () => {
        getCtx().updateTransaction(tx.id, { amount: 10.1 });

        // Como a transação foi reduzida para 10.10, tentar pagar 20.20 DEVE ser rejeitado
        expect(() => {
          getCtx().recordPayment({
            transaction_id: tx.id,
            account_id: 'acc-1',
            amount: 20.2,
            payment_date: '2026-08-01',
          });
        }).toThrow(/excede o saldo restante da transação/i);
      });

      // Transação deve manter amount 10.10 e paid_amount 0 (sem pagamento extra)
      const updatedTx = getCtx().transactions.find((t) => t.id === tx.id);
      expect(updatedTx?.amount).toBe(10.1);
      expect(updatedTx?.paid_amount || 0).toBe(0);
      expect(updatedTx?.status).toBe('pending');

      // Nenhum pagamento registrado
      const pay = getCtx().payments.find((p) => p.transaction_id === tx.id);
      expect(pay).toBeUndefined();

      // Saldo da conta permaneceu rigorosamente intacto
      const accAfter = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      expect(accAfter.current_balance).toBe(balanceBefore);
    });

    it('deve estornar na conta efetiva de pagamento ao excluir transação (Vínculo acc-1, Pagamento acc-2) (P0-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const acc1Before = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      const acc2Before = getCtx().accounts.find((a) => a.id === 'acc-2')!;
      const bal1Before = acc1Before.current_balance;
      const bal2Before = acc2Before.current_balance;

      let tx: any;
      await act(async () => {
        tx = getCtx().addTransaction({
          type: 'expense',
          amount: 30.30,
          description: 'Despesa Cruzada P0-01',
          category_id: 'cat-1',
          account_id: 'acc-1',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
      });

      await act(async () => {
        getCtx().recordPayment({
          transaction_id: tx.id,
          account_id: 'acc-2',
          amount: 30.30,
          payment_date: '2026-08-01',
        });
      });

      // acc-1 permanece intacta; acc-2 foi debitada em 30.30
      expect(getCtx().accounts.find((a) => a.id === 'acc-1')!.current_balance).toBe(bal1Before);
      expect(getCtx().accounts.find((a) => a.id === 'acc-2')!.current_balance).toBe(fromCents(toCents(bal2Before) - 3030));

      await act(async () => {
        getCtx().deleteTransaction(tx.id);
      });

      // Ambas as contas devem retornar exatamente aos seus saldos iniciais
      expect(getCtx().accounts.find((a) => a.id === 'acc-1')!.current_balance).toBe(bal1Before);
      expect(getCtx().accounts.find((a) => a.id === 'acc-2')!.current_balance).toBe(bal2Before);
      expect(getCtx().transactions.find((t) => t.id === tx.id)).toBeUndefined();
      expect(getCtx().payments.filter((p) => p.transaction_id === tx.id)).toHaveLength(0);
    });

    it('deve estornar na conta do pagamento ao excluir transação sem conta vinculada (P0-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const acc2Before = getCtx().accounts.find((a) => a.id === 'acc-2')!;
      const bal2Before = acc2Before.current_balance;

      let tx: any;
      await act(async () => {
        tx = getCtx().addTransaction({
          type: 'expense',
          amount: 30.30,
          description: 'Despesa Sem Conta P0-01',
          category_id: 'cat-1',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
      });

      await act(async () => {
        getCtx().recordPayment({
          transaction_id: tx.id,
          account_id: 'acc-2',
          amount: 30.30,
          payment_date: '2026-08-01',
        });
      });

      expect(getCtx().accounts.find((a) => a.id === 'acc-2')!.current_balance).toBe(fromCents(toCents(bal2Before) - 3030));

      await act(async () => {
        getCtx().deleteTransaction(tx.id);
      });

      expect(getCtx().accounts.find((a) => a.id === 'acc-2')!.current_balance).toBe(bal2Before);
    });

    it('deve estornar proporcionalmente para múltiplas contas de pagamento ao excluir transação (P0-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const acc1Before = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      const acc2Before = getCtx().accounts.find((a) => a.id === 'acc-2')!;
      const bal1Before = acc1Before.current_balance;
      const bal2Before = acc2Before.current_balance;

      let tx: any;
      await act(async () => {
        tx = getCtx().addTransaction({
          type: 'expense',
          amount: 30.30,
          description: 'Despesa Fracionada P0-01',
          category_id: 'cat-1',
          account_id: 'acc-1',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
      });

      await act(async () => {
        getCtx().recordPayment({
          transaction_id: tx.id,
          account_id: 'acc-1',
          amount: 10.10,
          payment_date: '2026-08-01',
        });
        getCtx().recordPayment({
          transaction_id: tx.id,
          account_id: 'acc-2',
          amount: 20.20,
          payment_date: '2026-08-01',
        });
      });

      expect(getCtx().accounts.find((a) => a.id === 'acc-1')!.current_balance).toBe(fromCents(toCents(bal1Before) - 1010));
      expect(getCtx().accounts.find((a) => a.id === 'acc-2')!.current_balance).toBe(fromCents(toCents(bal2Before) - 2020));

      await act(async () => {
        getCtx().deleteTransaction(tx.id);
      });

      expect(getCtx().accounts.find((a) => a.id === 'acc-1')!.current_balance).toBe(bal1Before);
      expect(getCtx().accounts.find((a) => a.id === 'acc-2')!.current_balance).toBe(bal2Before);
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

    it('deve rejeitar recordPayment com conta de outro workspace ou inativa preservando saldos (P1-02)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const customAccounts = [
        { id: 'acc-main', workspace_id: 'ws-1', name: 'Conta Principal', type: 'checking', institution: 'Nubank', initial_balance: 100, current_balance: 100, color: '#000', active: true, created_at: '2026-01-01' },
        { id: 'acc-ws2', workspace_id: 'ws-2', name: 'Conta WS2', type: 'checking', institution: 'Nubank', initial_balance: 100, current_balance: 100, color: '#000', active: true, created_at: '2026-01-01' },
        { id: 'acc-inactive', workspace_id: 'ws-1', name: 'Conta Inativa', type: 'checking', institution: 'Nubank', initial_balance: 100, current_balance: 100, color: '#000', active: false, created_at: '2026-01-01' },
      ];
      storageMap.set('fincontrol_v2_accounts', JSON.stringify(customAccounts));

      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      let tx: any;
      await act(async () => {
        tx = getCtx().addTransaction({
          type: 'expense',
          amount: 10.10,
          description: 'Despesa WS Validação',
          category_id: 'cat-1',
          account_id: 'acc-main',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
      });

      // Conta de outro workspace
      await act(async () => {
        expect(() => {
          getCtx().recordPayment({
            transaction_id: tx.id,
            account_id: 'acc-ws2',
            amount: 10.10,
            payment_date: '2026-08-01',
          });
        }).toThrow(/não encontrada no workspace ativo/i);
      });

      // Conta inativa
      await act(async () => {
        expect(() => {
          getCtx().recordPayment({
            transaction_id: tx.id,
            account_id: 'acc-inactive',
            amount: 10.10,
            payment_date: '2026-08-01',
          });
        }).toThrow(/está inativa/i);
      });

      // Nenhum pagamento criado e nenhum saldo alterado
      expect(getCtx().payments.filter((p) => p.transaction_id === tx.id)).toHaveLength(0);
      expect(getCtx().accounts.find((a) => a.id === 'acc-main')!.current_balance).toBe(100);
    });

    it('deve rejeitar pagamento após inativar conta no mesmo lote (P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const balBefore = getCtx().accounts.find((a) => a.id === 'acc-1')!.current_balance;

      let tx: any;
      await act(async () => {
        tx = getCtx().addTransaction({
          type: 'expense',
          amount: 10.10,
          description: 'Despesa Inativa Lote',
          category_id: 'cat-1',
          account_id: 'acc-1',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
      });

      await act(async () => {
        getCtx().updateAccount('acc-1', { active: false });
        expect(() => {
          getCtx().recordPayment({
            transaction_id: tx.id,
            account_id: 'acc-1',
            amount: 10.10,
            payment_date: '2026-08-01',
          });
        }).toThrow(/está inativa/i);
      });

      // Saldo inalterado e nenhum pagamento gerado
      expect(getCtx().allWorkspaceAccounts.find((a) => a.id === 'acc-1')!.current_balance).toBe(balBefore);
      expect(getCtx().payments.filter((p) => p.transaction_id === tx.id)).toHaveLength(0);
    });

    it('deve rejeitar pagamento após excluir conta no mesmo lote (P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      let cleanAcc: any;
      let tx: any;
      await act(async () => {
        cleanAcc = getCtx().addAccount({
          name: 'Conta para Exclusão Física',
          type: 'checking',
          institution: 'Nubank',
          initial_balance: 100.0,
          current_balance: 100.0,
          color: '#000',
          active: true,
        });

        tx = getCtx().addTransaction({
          type: 'expense',
          amount: 10.10,
          description: 'Despesa Excluída Lote',
          category_id: 'cat-1',
          account_id: cleanAcc.id,
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
      });

      await act(async () => {
        const delRes = getCtx().deleteAccount(cleanAcc.id);
        expect(delRes.action).toBe('deleted');

        expect(() => {
          getCtx().recordPayment({
            transaction_id: tx.id,
            account_id: cleanAcc.id,
            amount: 10.10,
            payment_date: '2026-08-01',
          });
        }).toThrow(/não encontrada/i);
      });

      expect(getCtx().payments.filter((p) => p.transaction_id === tx.id)).toHaveLength(0);
    });

    it('deve rejeitar transferência após inativar conta no mesmo lote (P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const bal1Before = getCtx().accounts.find((a) => a.id === 'acc-1')!.current_balance;
      const bal2Before = getCtx().accounts.find((a) => a.id === 'acc-2')!.current_balance;

      await act(async () => {
        getCtx().updateAccount('acc-1', { active: false });
        expect(() => {
          getCtx().createTransfer('acc-1', 'acc-2', 10.10);
        }).toThrow(/está inativa/i);
      });

      expect(getCtx().allWorkspaceAccounts.find((a) => a.id === 'acc-1')!.current_balance).toBe(bal1Before);
      expect(getCtx().allWorkspaceAccounts.find((a) => a.id === 'acc-2')!.current_balance).toBe(bal2Before);
    });

    it('deve executar soft-delete ao excluir conta de origem de transferência criada no mesmo lote (P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      let deleteResult: any;
      await act(async () => {
        getCtx().createTransfer('acc-1', 'acc-2', 10.10);
        deleteResult = getCtx().deleteAccount('acc-1');
      });

      expect(deleteResult.action).toBe('inactivated');
      const acc1 = getCtx().allWorkspaceAccounts.find((a) => a.id === 'acc-1')!;
      expect(acc1).toBeDefined();
      expect(acc1.active).toBe(false);
    });

    it('deve permitir usar conta imediatamente após criá-la no mesmo lote (P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      let newAcc: any;
      let tx: any;
      await act(async () => {
        newAcc = getCtx().addAccount({
          name: 'Nova Conta Imediata',
          type: 'checking',
          institution: 'Nubank',
          initial_balance: 500.0,
          current_balance: 500.0,
          color: '#3b82f6',
          active: true,
        });

        tx = getCtx().addTransaction({
          type: 'expense',
          amount: 50.0,
          description: 'Despesa em Nova Conta',
          category_id: 'cat-1',
          account_id: newAcc.id,
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
      });

      expect(tx).toBeDefined();
      expect(tx.account_id).toBe(newAcc.id);
      expect(getCtx().transactions.find((t) => t.id === tx.id)).toBeDefined();
    });

    it('deve rejeitar criação de recorrência vinculada a conta inativada no mesmo lote (P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const catId = getCtx().categories[0]?.id || 'cat-1';

      await act(async () => {
        getCtx().updateAccount('acc-1', { active: false });
        expect(() => {
          getCtx().addRecurring({
            description: 'Recorrência Conta Inativa Lote',
            amount: 10.10,
            type: 'expense',
            category_id: catId,
            account_id: 'acc-1',
            frequency: 'monthly',
            start_date: '2099-01-01',
            next_occurrence: '2099-01-01',
            auto_create: false,
            active: true,
          });
        }).toThrow(/está inativa/i);
      });

      expect(getCtx().recurring.find((r) => r.description === 'Recorrência Conta Inativa Lote')).toBeUndefined();
    });

    it('deve rejeitar criação de recorrência vinculada a conta excluída no mesmo lote (P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const catId = getCtx().categories[0]?.id || 'cat-1';
      let cleanAcc: any;

      await act(async () => {
        cleanAcc = getCtx().addAccount({
          name: 'Conta Limpa Para Recorrência',
          type: 'checking',
          institution: 'Nubank',
          initial_balance: 100.0,
          current_balance: 100.0,
          color: '#000',
          active: true,
        });
      });

      await act(async () => {
        const delRes = getCtx().deleteAccount(cleanAcc.id);
        expect(delRes.action).toBe('deleted');

        expect(() => {
          getCtx().addRecurring({
            description: 'Recorrência Conta Excluída Lote',
            amount: 10.10,
            type: 'expense',
            category_id: catId,
            account_id: cleanAcc.id,
            frequency: 'monthly',
            start_date: '2099-01-01',
            next_occurrence: '2099-01-01',
            auto_create: false,
            active: true,
          });
        }).toThrow(/não pertence ao workspace/i);
      });

      expect(getCtx().recurring.find((r) => r.description === 'Recorrência Conta Excluída Lote')).toBeUndefined();
    });

    it('deve permitir criação de recorrência vinculada a conta recém-criada no mesmo lote (P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const catId = getCtx().categories[0]?.id || 'cat-1';
      let newAcc: any;
      let rec: any;

      await act(async () => {
        newAcc = getCtx().addAccount({
          name: 'Conta Recorrente Nova Lote',
          type: 'checking',
          institution: 'Nubank',
          initial_balance: 500.0,
          current_balance: 500.0,
          color: '#3b82f6',
          active: true,
        });

        rec = getCtx().addRecurring({
          description: 'Recorrência Conta Nova Lote',
          amount: 10.10,
          type: 'expense',
          category_id: catId,
          account_id: newAcc.id,
          frequency: 'monthly',
          start_date: '2099-01-01',
          next_occurrence: '2099-01-01',
          auto_create: false,
          active: true,
        });
      });

      expect(rec).toBeDefined();
      expect(rec.account_id).toBe(newAcc.id);
      expect(getCtx().recurring.find((r) => r.id === rec.id)).toBeDefined();
    });

    it('deve manter coerência nos controles de recorrência com renderização intermediária (P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const catId = getCtx().categories[0]?.id || 'cat-1';

      // 1. Controle: Inativação com renderização intermediária
      await act(async () => {
        getCtx().updateAccount('acc-1', { active: false });
      });

      await act(async () => {
        expect(() => {
          getCtx().addRecurring({
            description: 'Recorrência Conta Inativa Controle',
            amount: 25.0,
            type: 'expense',
            category_id: catId,
            account_id: 'acc-1',
            frequency: 'monthly',
            start_date: '2099-01-01',
            next_occurrence: '2099-01-01',
            auto_create: false,
            active: true,
          });
        }).toThrow(/está inativa/i);
      });

      // 2. Controle: Criação de conta com renderização intermediária
      let newAcc: any;
      await act(async () => {
        newAcc = getCtx().addAccount({
          name: 'Conta Nova Controle',
          type: 'checking',
          institution: 'Nubank',
          initial_balance: 200.0,
          current_balance: 200.0,
          color: '#10b981',
          active: true,
        });
      });

      let rec: any;
      await act(async () => {
        rec = getCtx().addRecurring({
          description: 'Recorrência Conta Nova Controle',
          amount: 25.0,
          type: 'expense',
          category_id: catId,
          account_id: newAcc.id,
          frequency: 'monthly',
          start_date: '2099-01-01',
          next_occurrence: '2099-01-01',
          auto_create: false,
          active: true,
        });
      });

      expect(rec).toBeDefined();
      expect(rec.account_id).toBe(newAcc.id);
      expect(getCtx().recurring.find((r) => r.id === rec.id)).toBeDefined();
    });

    it('deve permitir usar método de pagamento recém-criado no mesmo lote (P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const catId = getCtx().categories[0]?.id || 'cat-1';
      let pm: any;
      let tx: any;

      await act(async () => {
        pm = getCtx().addPaymentMethod({
          name: 'Pix Banco Inter Lote',
          type: 'pix',
          linked_account_id: 'acc-1',
          active: true,
        });

        tx = getCtx().addTransaction({
          description: 'Compra Método Novo Lote',
          amount: 10.10,
          type: 'expense',
          category_id: catId,
          payment_method_id: pm.id,
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
      });

      expect(tx).toBeDefined();
      expect(tx.payment_method_id).toBe(pm.id);
      expect(tx.account_id).toBe('acc-1');
      expect(getCtx().transactions.find((t) => t.id === tx.id)).toBeDefined();
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

    it('deve permitir usar categoria recém-criada no mesmo lote (P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      let cat: any;
      let tx: any;

      await act(async () => {
        cat = getCtx().addCategory({
          name: 'Tecnologia e IA Lote',
          type: 'expense',
          color: '#8b5cf6',
          icon: 'Cpu',
          active: true,
        });

        tx = getCtx().addTransaction({
          description: 'Assinatura Software IA Lote',
          amount: 30.0,
          type: 'expense',
          category_id: cat.id,
          account_id: 'acc-1',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
      });

      expect(tx).toBeDefined();
      expect(tx.category_id).toBe(cat.id);
      expect(getCtx().transactions.find((t) => t.id === tx.id)).toBeDefined();
    });

    it('deve rejeitar transação vinculada a categoria inativada no mesmo lote (P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const catId = getCtx().categories[0]?.id || 'cat-1';

      await act(async () => {
        getCtx().updateCategory(catId, { active: false });
        expect(() => {
          getCtx().addTransaction({
            description: 'Transação Categoria Inativa Lote',
            amount: 40.0,
            type: 'expense',
            category_id: catId,
            account_id: 'acc-1',
            transaction_date: '2026-08-01',
            due_date: '2026-08-01',
            status: 'pending',
          });
        }).toThrow(/está inativa/i);
      });

      expect(getCtx().transactions.find((t) => t.description === 'Transação Categoria Inativa Lote')).toBeUndefined();
    });

    it('deve manter coerência nos controles de cartões, métodos e categorias com renderização intermediária', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const catId = getCtx().categories[0]?.id || 'cat-1';

      // 1. Controle de Cartão Inativo
      await act(async () => {
        getCtx().updateCreditCard('card-1', { active: false });
      });

      await act(async () => {
        expect(() => {
          getCtx().addTransaction({
            description: 'Compra Cartão Inativo Controle',
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

      // 2. Controle de Categoria Inativa
      await act(async () => {
        getCtx().updateCategory(catId, { active: false });
      });

      await act(async () => {
        expect(() => {
          getCtx().addTransaction({
            description: 'Transação Categoria Inativa Controle',
            amount: 40.0,
            type: 'expense',
            category_id: catId,
            account_id: 'acc-1',
            transaction_date: '2026-08-01',
            due_date: '2026-08-01',
            status: 'pending',
          });
        }).toThrow(/está inativa/i);
      });

      // 3. Controle de Método Novo
      let pm: any;
      await act(async () => {
        pm = getCtx().addPaymentMethod({
          name: 'Pix Banco Inter Controle',
          type: 'pix',
          linked_account_id: 'acc-1',
          active: true,
        });
      });

      let tx: any;
      await act(async () => {
        tx = getCtx().addTransaction({
          description: 'Compra Método Novo Controle',
          amount: 15.0,
          type: 'expense',
          payment_method_id: pm.id,
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
      });

      expect(tx).toBeDefined();
      expect(tx.payment_method_id).toBe(pm.id);
      expect(tx.account_id).toBe('acc-1');
    });
  });

  describe('Sincronização Atômica de Workspace e Acertos no mesmo lote (V36 / P1-01)', () => {
    it('deve associar conta ao novo workspace mesmo quando createWorkspace e addAccount são chamados no mesmo lote act', async () => {
      const { getCtx } = await mountProvider();

      let createdWs: any;
      let createdAcc: any;

      await act(async () => {
        createdWs = getCtx().createWorkspace('Workspace Startup V36');
        createdAcc = getCtx().addAccount({
          name: 'Conta PJ Startup',
          type: 'checking',
          institution: 'Banco do Brasil',
          initial_balance: 5000,
          current_balance: 5000,
          color: '#0066cc',
          active: true,
        });
      });

      expect(createdWs).toBeDefined();
      expect(createdAcc).toBeDefined();
      expect(createdAcc.workspace_id).toBe(createdWs.id);
    });

    it('deve associar membro e categoria ao workspace correto quando setActiveWorkspaceId é chamado no mesmo lote act', async () => {
      const { getCtx } = await mountProvider();

      let targetWs: any;
      await act(async () => {
        targetWs = getCtx().createWorkspace('Workspace Filial V36');
      });

      let createdCat: any;
      await act(async () => {
        // Altera workspace ativo e adiciona membro e categoria na mesma chamada/lote
        getCtx().setActiveWorkspaceId(targetWs.id);
        getCtx().addWorkspaceMember('gerente@filial.com', 'admin');
        createdCat = getCtx().addCategory({
          name: 'Despesas Operacionais Filial',
          type: 'expense',
          color: '#ff9900',
          icon: 'Briefcase',
          active: true,
        });
      });

      expect(createdCat.workspace_id).toBe(targetWs.id);
      const members = getCtx().workspaceMembers.filter((m) => m.workspace_id === targetWs.id);
      expect(members.some((m) => m.user?.email === 'gerente@filial.com')).toBe(true);
    });

    it('deve registrar acerto de contas (recordSettlement) e persistir em settlements', async () => {
      const { getCtx } = await mountProvider();

      let ws: any;
      await act(async () => {
        ws = getCtx().createWorkspace('República Compartilhada');
      });

      await act(async () => {
        getCtx().setActiveWorkspaceId(ws.id);
        getCtx().addWorkspaceMember('amigo1@teste.com', 'member');
      });

      const currentMembers = getCtx().workspaceMembers.filter((m) => m.workspace_id === ws.id);
      expect(currentMembers.length).toBeGreaterThanOrEqual(2);

      const m1 = currentMembers[0].id;
      const m2 = currentMembers[1].id;

      // Cria despesa rateada 50/50 onde m2 paga 100 (m1 deve 50 para m2)
      await act(async () => {
        getCtx().addTransaction({
          description: 'Almoço Compartilhado',
          amount: 100.0,
          type: 'expense',
          paid_by_member_id: m2,
          split_type: 'equal',
          splits: [
            { member_id: m1, amount: 50.0 },
            { member_id: m2, amount: 50.0 },
          ],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'paid',
        });
      });

      let settlement: any;
      await act(async () => {
        settlement = getCtx().recordSettlement({
          from_member_id: m1,
          to_member_id: m2,
          amount: 50.0,
          settlement_date: '2026-09-18',
          notes: 'Pix de quitação de almoço',
        });
      });

      expect(settlement).toBeDefined();
      expect(settlement.workspace_id).toBe(ws.id);
      expect(settlement.amount).toBe(50.0);
      expect(settlement.from_member_id).toBe(m1);
      expect(settlement.to_member_id).toBe(m2);

      // Rejeita acerto inválido (mesmo pagador e recebedor)
      await act(async () => {
        expect(() => {
          getCtx().recordSettlement({
            from_member_id: m1,
            to_member_id: m1,
            amount: 30.0,
          });
        }).toThrow(/não podem ser a mesma pessoa/i);
      });

      // Exclusão de acerto (deleteSettlement)
      await act(async () => {
        getCtx().deleteSettlement(settlement.id);
      });

      expect(getCtx().settlements.some((s) => s.id === settlement.id)).toBe(false);
    });

    it('deve suportar tracking_mode expense_tracker: updateWorkspace, pagamentos sem conta bancária e sem mutação de saldo', async () => {
      const { getCtx } = await mountProvider();

      let ws: any;
      await act(async () => {
        ws = getCtx().createWorkspace('Controle Despesas Sem Saldo', 'expense_tracker');
      });

      expect(ws.tracking_mode).toBe('expense_tracker');

      await act(async () => {
        getCtx().setActiveWorkspaceId(ws.id);
      });

      expect(getCtx().activeWorkspace.id).toBe(ws.id);
      expect(getCtx().activeWorkspace.tracking_mode).toBe('expense_tracker');

      // Testar updateWorkspace
      await act(async () => {
        getCtx().updateWorkspace(ws.id, { name: 'Despesas & Splits Atualizado' });
      });
      expect(getCtx().activeWorkspace.name).toBe('Despesas & Splits Atualizado');

      // Criar uma conta existente para provar que o saldo não muda
      let acc: any;
      await act(async () => {
        acc = getCtx().addAccount({
          name: 'Conta Teste Intocada',
          type: 'checking',
          institution: 'Banco X',
          initial_balance: 500,
          current_balance: 500,
          color: '#10b981',
          active: true,
        });
      });

      expect(acc.current_balance).toBe(500);

      // Adicionar transação pendente sem conta obrigatória
      let tx: any;
      await act(async () => {
        tx = getCtx().addTransaction({
          description: 'Conta de Energia',
          amount: 150,
          type: 'expense',
          status: 'pending',
          transaction_date: '2026-09-20',
          due_date: '2026-09-20',
        });
      });

      expect(tx.status).toBe('pending');
      expect(tx.paid_amount).toBe(0);

      // Quitar pagamento sem informar conta (account_id omitted/undefined)
      await act(async () => {
        getCtx().recordPayment({
          transaction_id: tx.id,
          amount: 150,
          payment_date: '2026-09-20',
        });
      });

      const updatedTx = getCtx().transactions.find((t) => t.id === tx.id);
      expect(updatedTx?.status).toBe('paid');
      expect(updatedTx?.paid_amount).toBe(150);

      // O saldo da conta criada não deve ter sido afetado
      const refreshedAcc = getCtx().accounts.find((a) => a.id === acc.id);
      expect(refreshedAcc?.current_balance).toBe(500);

      // Testar pagamento de fatura de cartão no modo expense_tracker sem exigir conta
      let card: any;
      await act(async () => {
        card = getCtx().addCreditCard({
          name: 'Cartão Despesas',
          institution: 'Nubank',
          credit_limit: 3000,
          closing_day: 10,
          due_day: 18,
          color: '#8b5cf6',
          active: true,
        });
      });

      // Adicionar despesa no cartão
      await act(async () => {
        getCtx().addTransaction({
          description: 'Supermercado',
          amount: 200,
          type: 'expense',
          credit_card_id: card.id,
          transaction_date: '2026-09-05',
          due_date: '2026-09-18',
          status: 'pending',
        });
      });

      const bill = getCtx().creditCardBills.find((b) => b.credit_card_id === card.id);
      expect(bill).toBeDefined();

      if (bill) {
        await act(async () => {
          getCtx().payCreditCardBill(bill.id, undefined, 200, '2026-09-18');
        });

        const updatedBill = getCtx().creditCardBills.find((b) => b.id === bill.id);
        expect(updatedBill?.status).toBe('paid');
      }

      // O saldo da conta bancária continua exatamente 500
      const finalAcc = getCtx().accounts.find((a) => a.id === acc.id);
      expect(finalAcc?.current_balance).toBe(500);
    });

    it('deve imunizar contra saldo artificial na alternância de modos full -> tracker -> full -> deleteTransaction (P0-02)', async () => {
      const { getCtx } = await mountProvider();

      // 1. Criar workspace full e conta com 8450.00
      let ws: any;
      await act(async () => {
        ws = getCtx().createWorkspace('Workspace Híbrido', 'full');
      });

      await act(async () => {
        getCtx().setActiveWorkspaceId(ws.id);
      });

      let acc: any;
      await act(async () => {
        acc = getCtx().addAccount({
          name: 'Conta Corrente P0-02',
          type: 'checking',
          institution: 'Banco Itaú',
          initial_balance: 8450.0,
          current_balance: 8450.0,
          color: '#3b82f6',
          active: true,
        });
      });
      expect(acc.current_balance).toBe(8450.0);

      // 2. Criar despesa pendente vinculada à conta
      let tx: any;
      await act(async () => {
        tx = getCtx().addTransaction({
          description: 'Despesa a pagar',
          amount: 10.1,
          type: 'expense',
          account_id: acc.id,
          status: 'pending',
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
        });
      });

      // 3. Trocar workspace para expense_tracker
      await act(async () => {
        getCtx().updateWorkspace(ws.id, { tracking_mode: 'expense_tracker' });
      });
      expect(getCtx().activeWorkspace.tracking_mode).toBe('expense_tracker');

      // 4. Pagar 10.10 sem account_id no tracker: saldo continua 8450.00
      await act(async () => {
        getCtx().recordPayment({
          transaction_id: tx.id,
          amount: 10.1,
          payment_date: '2026-09-18',
        });
      });

      let currentAcc = getCtx().accounts.find((a) => a.id === acc.id);
      expect(currentAcc?.current_balance).toBe(8450.0);

      // 5. Trocar novamente para full
      await act(async () => {
        getCtx().updateWorkspace(ws.id, { tracking_mode: 'full' });
      });
      expect(getCtx().activeWorkspace.tracking_mode).toBe('full');

      // 6. Excluir a transação
      await act(async () => {
        getCtx().deleteTransaction(tx.id);
      });

      // 7. Saldo DEVE permanecer exatamente em 8450.00 (sem estorno artificial!)
      const finalAcc = getCtx().accounts.find((a) => a.id === acc.id);
      expect(finalAcc?.current_balance).toBe(8450.0);
    });

    it('deve rejeitar createTransfer e depositGoal no domínio quando em expense_tracker (P1-01)', async () => {
      const { getCtx } = await mountProvider();

      let ws: any;
      await act(async () => {
        ws = getCtx().createWorkspace('Workspace Sem Saldo P1-01', 'expense_tracker');
      });

      await act(async () => {
        getCtx().setActiveWorkspaceId(ws.id);
      });

      let acc1: any;
      let acc2: any;
      await act(async () => {
        acc1 = getCtx().addAccount({
          name: 'Conta 1',
          type: 'checking',
          institution: 'Banco A',
          initial_balance: 500,
          current_balance: 500,
          color: '#10b981',
          active: true,
        });
        acc2 = getCtx().addAccount({
          name: 'Conta 2',
          type: 'checking',
          institution: 'Banco B',
          initial_balance: 300,
          current_balance: 300,
          color: '#3b82f6',
          active: true,
        });
      });

      // createTransfer deve ser rejeitado no domínio
      expect(() => {
        getCtx().createTransfer(acc1.id, acc2.id, 100);
      }).toThrow(/Transferências entre contas não são permitidas no modo Apenas Despesas/i);

      // depositGoal deve ser rejeitado no domínio
      let goal: any;
      await act(async () => {
        goal = getCtx().addGoal({
          name: 'Meta Viagem',
          target_amount: 1000,
          current_amount: 0,
          color: '#10b981',
          icon: 'target',
          status: 'in_progress',
        });
      });

      expect(() => {
        getCtx().depositGoal(goal.id, 50, acc1.id);
      }).toThrow(/Aportes em metas financeiras não são permitidos no modo Apenas Despesas/i);

      // Nenhum saldo foi alterado
      expect(getCtx().accounts.find((a) => a.id === acc1.id)?.current_balance).toBe(500);
      expect(getCtx().accounts.find((a) => a.id === acc2.id)?.current_balance).toBe(300);
    });

    it('deve estornar débito histórico do modo full ao excluir no modo expense_tracker (Full -> Tracker -> Delete)', async () => {
      const { getCtx } = await mountProvider();

      // 1. Workspace no modo full
      let ws: any;
      await act(async () => {
        ws = getCtx().createWorkspace('Workspace Proveniência Reauditoria', 'full');
      });

      await act(async () => {
        getCtx().setActiveWorkspaceId(ws.id);
      });

      // 2. Conta com saldo inicial de 8.450,00 e categoria
      let acc: any;
      let cat: any;
      await act(async () => {
        acc = getCtx().addAccount({
          name: 'Conta Corrente Principal',
          type: 'checking',
          institution: 'Banco Itaú',
          initial_balance: 8450.0,
          current_balance: 8450.0,
          color: '#3b82f6',
          active: true,
        });
        cat = getCtx().addCategory({
          name: 'Geral',
          color: '#3b82f6',
          icon: 'tag',
          type: 'expense',
          active: true,
        });
      });

      // 3. Cria despesa de 10,10 no modo full e quita com a conta
      let tx: any;
      await act(async () => {
        tx = getCtx().addTransaction({
          description: 'Despesa Full Histórica',
          amount: 10.10,
          type: 'expense',
          category_id: cat.id,
          account_id: acc.id,
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'pending',
        });
      });

      await act(async () => {
        getCtx().recordPayment({
          transaction_id: tx.id,
          account_id: acc.id,
          amount: 10.10,
          payment_date: '2026-09-18',
        });
      });

      // Saldo após pagamento no modo full: 8.450,00 - 10,10 = 8.439,90
      expect(getCtx().accounts.find((a) => a.id === acc.id)?.current_balance).toBe(8439.9);

      // 4. Alterna workspace para expense_tracker
      await act(async () => {
        getCtx().updateWorkspace(ws.id, { tracking_mode: 'expense_tracker' });
      });
      expect(getCtx().activeWorkspace.tracking_mode).toBe('expense_tracker');

      // 5. Exclui a transação enquanto o workspace está em expense_tracker
      await act(async () => {
        getCtx().deleteTransaction(tx.id);
      });

      // 6. O saldo contábil da conta DEVE ser estornado para 8.450,00 porque o Payment teve affects_balance = true!
      const finalAcc = getCtx().accounts.find((a) => a.id === acc.id);
      expect(finalAcc?.current_balance).toBe(8450.0);
    });
  });

  describe('FinanceProvider - Divisão de Despesas e Acertos (Splits & Settlements)', () => {
    it('deve validar liquidação direcional e teto de dívida em recordSettlement (P0-01 Local)', async () => {
      const { getCtx } = await mountProvider();

      // Ativa workspace ws-2 que possui wsm-2 (Rodrigo) e wsm-3 (Camila)
      await act(async () => {
        getCtx().setActiveWorkspaceId('ws-2');
      });

      // 1. Sem despesas rateadas, tentar liquidar deve ser rejeitado
      expect(() => {
        getCtx().recordSettlement({
          from_member_id: 'wsm-3',
          to_member_id: 'wsm-2',
          amount: 50,
          settlement_date: '2026-09-18',
        });
      }).toThrow(/Não há débito pendente registrado entre o pagador e o recebedor/i);

      // 2. Registra despesa dividida 50/50: Rodrigo (wsm-2) paga 100,00 (Camila wsm-3 deve 50,00)
      await act(async () => {
        getCtx().addTransaction({
          description: 'Jantar Compartilhado',
          amount: 100,
          type: 'expense',
          paid_by_member_id: 'wsm-2',
          split_type: 'equal',
          splits: [
            { member_id: 'wsm-2', amount: 50 },
            { member_id: 'wsm-3', amount: 50 },
          ],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'paid',
        });
      });

      // 3. Rodrigo tentar pagar Camila deve ser rejeitado (direção invertida)
      expect(() => {
        getCtx().recordSettlement({
          from_member_id: 'wsm-2',
          to_member_id: 'wsm-3',
          amount: 20,
          settlement_date: '2026-09-18',
        });
      }).toThrow(/Não há débito pendente registrado/i);

      // 4. Camila tentar pagar mais que o débito (50.01) deve ser rejeitado
      expect(() => {
        getCtx().recordSettlement({
          from_member_id: 'wsm-3',
          to_member_id: 'wsm-2',
          amount: 50.01,
          settlement_date: '2026-09-18',
        });
      }).toThrow(/excede a dívida pendente/i);

      // 5. Camila paga exatamente 50.00: sucesso!
      let s: any;
      await act(async () => {
        s = getCtx().recordSettlement({
          from_member_id: 'wsm-3',
          to_member_id: 'wsm-2',
          amount: 50.0,
          settlement_date: '2026-09-18',
        });
      });
      expect(s.id).toBeDefined();

      // 6. Após a quitação total, tentar pagar novamente deve ser rejeitado (dívida zerada)
      expect(() => {
        getCtx().recordSettlement({
          from_member_id: 'wsm-3',
          to_member_id: 'wsm-2',
          amount: 10,
          settlement_date: '2026-09-18',
        });
      }).toThrow(/Não há débito pendente registrado/i);
    });

    it('deve consolidar compra parcelada com rateio no balanço sem duplicação (P0-02 Local)', async () => {
      const { getCtx } = await mountProvider();

      await act(async () => {
        getCtx().setActiveWorkspaceId('ws-2');
      });

      // Rodrigo compra parcelada de R$ 600 em 3x dividida 50/50 com Camila
      await act(async () => {
        getCtx().createInstallmentPurchase({
          description: 'Mesa de Jantar 3x',
          total_amount: 600,
          installment_count: 3,
          purchase_date: '2026-09-18',
          paid_by_member_id: 'wsm-2',
          split_type: 'equal',
          splits: [
            { member_id: 'wsm-2', amount: 300 },
            { member_id: 'wsm-3', amount: 300 },
          ],
        });
      });

      // Camila deve agora R$ 300 para Rodrigo. Pagamento de R$ 300 deve ser aceito
      await act(async () => {
        getCtx().recordSettlement({
          from_member_id: 'wsm-3',
          to_member_id: 'wsm-2',
          amount: 300,
          settlement_date: '2026-09-18',
        });
      });

      // Nova tentativa de pagamento rejeitada (débito zerado)
      expect(() => {
        getCtx().recordSettlement({
          from_member_id: 'wsm-3',
          to_member_id: 'wsm-2',
          amount: 1,
          settlement_date: '2026-09-18',
        });
      }).toThrow(/Não há débito pendente registrado/i);
    });

    it('deve validar pertencimento de membros e duplicidade na borda do provider (P1-01 Local)', async () => {
      const { getCtx } = await mountProvider();

      await act(async () => {
        getCtx().setActiveWorkspaceId('ws-2');
      });

      // Membro inexistente
      expect(() => {
        getCtx().addTransaction({
          description: 'Membro Inexistente',
          amount: 100,
          type: 'expense',
          paid_by_member_id: 'm-ghost',
          split_type: 'equal',
          splits: [{ member_id: 'wsm-2', amount: 100 }],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'paid',
        });
      }).toThrow(/O membro pagador informado não pertence ao workspace ativo/i);

      // Membro de outro workspace (wsm-1 é de ws-1, não de ws-2)
      expect(() => {
        getCtx().addTransaction({
          description: 'Membro de Outro Workspace',
          amount: 100,
          type: 'expense',
          paid_by_member_id: 'wsm-2',
          split_type: 'equal',
          splits: [{ member_id: 'wsm-1', amount: 100 }],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'paid',
        });
      }).toThrow(/não pertence ao workspace ativo/i);

      // Membros duplicados na lista de splits
      expect(() => {
        getCtx().addTransaction({
          description: 'Membro Duplicado',
          amount: 100,
          type: 'expense',
          paid_by_member_id: 'wsm-2',
          split_type: 'custom',
          splits: [
            { member_id: 'wsm-3', amount: 50 },
            { member_id: 'wsm-3', amount: 50 },
          ],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'paid',
        });
      }).toThrow(/Membros duplicados identificados no rateio/i);

      // Split negativo direto (P1-01 Local Auditoria V36)
      expect(() => {
        getCtx().addTransaction({
          description: 'Split Negativo',
          amount: 100,
          type: 'expense',
          paid_by_member_id: 'wsm-2',
          split_type: 'custom',
          splits: [
            { member_id: 'wsm-2', amount: -50 },
            { member_id: 'wsm-3', amount: 150 },
          ],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'paid',
        });
      }).toThrow(/não pode ser negativo ou inválido/i);

      // Soma divergente do total em addTransaction (P1-01 Local Auditoria V36)
      expect(() => {
        getCtx().addTransaction({
          description: 'Soma Divergente',
          amount: 100,
          type: 'expense',
          paid_by_member_id: 'wsm-2',
          split_type: 'custom',
          splits: [
            { member_id: 'wsm-2', amount: 20 },
            { member_id: 'wsm-3', amount: 20 },
          ],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'paid',
        });
      }).toThrow(/diverge do valor total da despesa/i);

      // Soma divergente do total em createInstallmentPurchase (P1-01 Local Auditoria V36)
      expect(() => {
        getCtx().createInstallmentPurchase({
          description: 'Compra Soma Divergente',
          total_amount: 300,
          installment_count: 3,
          purchase_date: '2026-09-18',
          paid_by_member_id: 'wsm-2',
          split_type: 'custom',
          splits: [
            { member_id: 'wsm-2', amount: 50 },
            { member_id: 'wsm-3', amount: 50 },
          ],
        });
      }).toThrow(/diverge do valor total da despesa/i);

      // Reconciliação atômica em updateTransaction (P1-01 Local Auditoria V36)
      // 1. Despesa com divisão customizada: alterar total sem novos splits deve ser rejeitado
      let txCustom: any;
      await act(async () => {
        txCustom = getCtx().addTransaction({
          description: 'Despesa Custom Original',
          amount: 100,
          type: 'expense',
          paid_by_member_id: 'wsm-2',
          split_type: 'custom',
          splits: [
            { member_id: 'wsm-2', amount: 50 },
            { member_id: 'wsm-3', amount: 50 },
          ],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'pending',
        });
      });

      expect(() => {
        getCtx().updateTransaction(txCustom.id, { amount: 200 });
      }).toThrow(/Ao alterar o valor total.*divisão personalizada/i);

      // 2. Despesa com divisão igualitária (equal): alterar total de 100 para 200 recalcula atomicamente os splits
      let txEqual: any;
      await act(async () => {
        txEqual = getCtx().addTransaction({
          description: 'Despesa Equal Reconciliada',
          amount: 100,
          type: 'expense',
          paid_by_member_id: 'wsm-2',
          split_type: 'equal',
          splits: [
            { member_id: 'wsm-2', amount: 50 },
            { member_id: 'wsm-3', amount: 50 },
          ],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'pending',
        });
      });

      await act(async () => {
        getCtx().updateTransaction(txEqual.id, { amount: 200 });
      });

      const updated = getCtx().transactions.find((t) => t.id === txEqual.id);
      expect(updated?.amount).toBe(200);
      expect(updated?.splits).toEqual([
        { member_id: 'wsm-2', amount: 100, percentage: 50 },
        { member_id: 'wsm-3', amount: 100, percentage: 50 },
      ]);
    });

    it('deve validar regras de coerência e reconciliação dinâmica de splits na borda pública do Provider (Reauditoria V36)', async () => {
      const { getCtx } = await mountProvider();

      await act(async () => {
        getCtx().setActiveWorkspaceId('ws-2');
      });

      // Prova 1: Regra equal sem splits rejeitada
      expect(() => {
        getCtx().addTransaction({
          description: 'Equal sem splits',
          amount: 100,
          type: 'expense',
          paid_by_member_id: 'wsm-2',
          split_type: 'equal',
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'pending',
        });
      }).toThrow(/A regra de divisão selecionada exige o preenchimento das frações de rateio/i);

      // Prova 2: Regra individual com splits rejeitada
      expect(() => {
        getCtx().addTransaction({
          description: 'Individual com splits',
          amount: 100,
          type: 'expense',
          paid_by_member_id: 'wsm-2',
          split_type: 'individual',
          splits: [{ member_id: 'wsm-3', amount: 100 }],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'pending',
        });
      }).toThrow(/Transações individuais não devem possuir divisão de despesas/i);

      // Prova 3: updateTransaction trocando pagador em full_other recalcula splits transferindo a responsabilidade
      let txFullOther: any;
      await act(async () => {
        txFullOther = getCtx().addTransaction({
          description: 'Jantar Pago por Rodrigo para Camila',
          amount: 120,
          type: 'expense',
          paid_by_member_id: 'wsm-2',
          split_type: 'full_other',
          splits: [{ member_id: 'wsm-3', amount: 120, percentage: 100 }],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'pending',
        });
      });

      expect(txFullOther.splits).toEqual([{ member_id: 'wsm-3', amount: 120, percentage: 100 }]);

      // Rodrigo (wsm-2) passa a ser trocado por Camila (wsm-3) como pagadora
      await act(async () => {
        getCtx().updateTransaction(txFullOther.id, { paid_by_member_id: 'wsm-3' });
      });

      const updatedPayerTx = getCtx().transactions.find((t) => t.id === txFullOther.id);
      expect(updatedPayerTx?.paid_by_member_id).toBe('wsm-3');
      expect(updatedPayerTx?.splits).toEqual([{ member_id: 'wsm-2', amount: 120, percentage: 100 }]);

      // Prova 4: updateTransaction trocando regra equal -> full_other recalcula splits atomicamente
      let txEqual: any;
      await act(async () => {
        txEqual = getCtx().addTransaction({
          description: 'Despesa Inicial 50/50',
          amount: 200,
          type: 'expense',
          paid_by_member_id: 'wsm-2',
          split_type: 'equal',
          splits: [
            { member_id: 'wsm-2', amount: 100, percentage: 50 },
            { member_id: 'wsm-3', amount: 100, percentage: 50 },
          ],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'pending',
        });
      });

      await act(async () => {
        getCtx().updateTransaction(txEqual.id, { split_type: 'full_other' });
      });

      const updatedSplitTypeTx = getCtx().transactions.find((t) => t.id === txEqual.id);
      expect(updatedSplitTypeTx?.split_type).toBe('full_other');
      expect(updatedSplitTypeTx?.splits).toEqual([{ member_id: 'wsm-3', amount: 200, percentage: 100 }]);

      // Prova 5 (P1-01 V36 Semântica): split_type omitido/undefined com splits é rejeitado
      expect(() => {
        getCtx().addTransaction({
          description: 'Regra omitida com splits',
          amount: 100,
          type: 'expense',
          paid_by_member_id: 'wsm-2',
          splits: [
            { member_id: 'wsm-2', amount: 50 },
            { member_id: 'wsm-3', amount: 50 },
          ],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'pending',
        });
      }).toThrow(/Transações individuais não devem possuir divisão de despesas/i);

      expect(() => {
        getCtx().createInstallmentPurchase({
          description: 'Parcelamento Regra Omitida com splits',
          total_amount: 100,
          installment_count: 2,
          purchase_date: '2026-09-18',
          paid_by_member_id: 'wsm-2',
          splits: [
            { member_id: 'wsm-2', amount: 50 },
            { member_id: 'wsm-3', amount: 50 },
          ],
        });
      }).toThrow(/Transações individuais não devem possuir divisão de despesas/i);

      // Prova 6 (P1-01 V36 Semântica): split_type: 'equal' com distribuição divergente (30/70) é rejeitado
      expect(() => {
        getCtx().addTransaction({
          description: 'Equal com 30/70 divergente',
          amount: 100,
          type: 'expense',
          paid_by_member_id: 'wsm-2',
          split_type: 'equal',
          splits: [
            { member_id: 'wsm-2', amount: 30 },
            { member_id: 'wsm-3', amount: 70 },
          ],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'pending',
        });
      }).toThrow(/A distribuição de frações informada diverge do cálculo canônico para a regra 'equal'/i);

      expect(() => {
        getCtx().createInstallmentPurchase({
          description: 'Parcelamento Equal com 30/70 divergente',
          total_amount: 100,
          installment_count: 2,
          purchase_date: '2026-09-18',
          paid_by_member_id: 'wsm-2',
          split_type: 'equal',
          splits: [
            { member_id: 'wsm-2', amount: 30 },
            { member_id: 'wsm-3', amount: 70 },
          ],
        });
      }).toThrow(/A distribuição de frações informada diverge do cálculo canônico para a regra 'equal'/i);

      // Provas 7 e 8: Workspaces com 3 membros (P1-01 V36 Conjunto Canônico Completo)
      let ws3: any;
      await act(async () => {
        ws3 = getCtx().createWorkspace('Workspace Trio');
        getCtx().setActiveWorkspaceId(ws3.id);
        getCtx().addWorkspaceMember('membroB@teste.com', 'member');
        getCtx().addWorkspaceMember('membroC@teste.com', 'member');
      });

      const trioMembers = getCtx().workspaceMembers.filter((m) => m.workspace_id === ws3.id);
      expect(trioMembers).toHaveLength(3);
      const [mA, mB, mC] = trioMembers.map((m) => m.id);

      // Prova 7: equal omitindo terceiro membro (A=50, B=50; C omitido) deve ser rejeitado
      expect(() => {
        getCtx().addTransaction({
          description: 'Equal omitindo C',
          amount: 100,
          type: 'expense',
          paid_by_member_id: mA,
          split_type: 'equal',
          splits: [
            { member_id: mA, amount: 50 },
            { member_id: mB, amount: 50 },
          ],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'pending',
        });
      }).toThrow(/A distribuição de frações informada diverge do cálculo canônico para a regra 'equal'/i);

      expect(() => {
        getCtx().createInstallmentPurchase({
          description: 'Parcelamento Equal omitindo C',
          total_amount: 100,
          installment_count: 2,
          purchase_date: '2026-09-18',
          paid_by_member_id: mA,
          split_type: 'equal',
          splits: [
            { member_id: mA, amount: 50 },
            { member_id: mB, amount: 50 },
          ],
        });
      }).toThrow(/A distribuição de frações informada diverge do cálculo canônico para a regra 'equal'/i);

      // Prova 8: full_other omitindo outro não pagador (A paga, B=100; C omitido) deve ser rejeitado
      expect(() => {
        getCtx().addTransaction({
          description: 'Full Other omitindo C',
          amount: 100,
          type: 'expense',
          paid_by_member_id: mA,
          split_type: 'full_other',
          splits: [
            { member_id: mB, amount: 100 },
          ],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'pending',
        });
      }).toThrow(/A distribuição de frações informada diverge do cálculo canônico para a regra 'full_other'/i);

      expect(() => {
        getCtx().createInstallmentPurchase({
          description: 'Parcelamento Full Other omitindo C',
          total_amount: 100,
          installment_count: 2,
          purchase_date: '2026-09-18',
          paid_by_member_id: mA,
          split_type: 'full_other',
          splits: [
            { member_id: mB, amount: 100 },
          ],
        });
      }).toThrow(/A distribuição de frações informada diverge do cálculo canônico para a regra 'full_other'/i);
    });

    it('useFinance: deve lançar erro se invocado fora de um FinanceProvider', () => {
      let caughtError: any = null;
      function TestComponent() {
        try {
          useFinance();
        } catch (e) {
          caughtError = e;
        }
        return null;
      }
      const container = (globalThis as any).document.createElement('div');
      const root = createRoot(container);
      act(() => {
        root.render(React.createElement(TestComponent));
      });
      expect(caughtError).toBeDefined();
      expect(caughtError.message).toMatch(/useFinance deve ser usado dentro de um FinanceProvider/i);
    });

    it('deve hidratar todos os estados persistidos em localStorage no mount', async () => {
      storageMap.set('fincontrol_v2_workspaces', JSON.stringify([{ id: 'ws-hid', name: 'WS Hidratado', owner_id: 'usr-1', currency: 'BRL', tracking_mode: 'full', created_at: '2026-01-01' }]));
      storageMap.set('fincontrol_v2_active_ws', 'ws-hid');
      storageMap.set('fincontrol_v2_members', JSON.stringify([{ id: 'm-hid', workspace_id: 'ws-hid', user_id: 'usr-1', role: 'owner', created_at: '2026-01-01' }]));
      storageMap.set('fincontrol_v2_accounts', JSON.stringify([{ id: 'acc-hid', workspace_id: 'ws-hid', name: 'Conta Hidratada', type: 'checking', institution: 'Bank', initial_balance: 500, current_balance: 500, active: true, created_at: '2026-01-01' }]));
      storageMap.set('fincontrol_v2_categories', JSON.stringify([{ id: 'cat-hid', workspace_id: 'ws-hid', name: 'Cat Hidratada', icon: 'Tag', color: '#000', type: 'expense', active: true, created_at: '2026-01-01' }]));
      storageMap.set('fincontrol_v2_paymentMethods', JSON.stringify([{ id: 'pm-hid', workspace_id: 'ws-hid', name: 'PM Hid', type: 'pix', linked_account_id: 'acc-hid', active: true, created_at: '2026-01-01' }]));
      storageMap.set('fincontrol_v2_creditCards', JSON.stringify([{ id: 'cc-hid', workspace_id: 'ws-hid', name: 'Card Hid', brand: 'Visa', credit_limit: 5000, closing_day: 5, due_day: 15, active: true, created_at: '2026-01-01' }]));
      storageMap.set('fincontrol_v2_bills', JSON.stringify([{ id: 'bill-hid', workspace_id: 'ws-hid', credit_card_id: 'cc-hid', reference_month: '2026-09', closing_date: '2026-09-05', due_date: '2026-09-15', total_amount: 100, paid_amount: 0, status: 'open' }]));
      storageMap.set('fincontrol_v2_transactions', JSON.stringify([{ id: 'tx-hid', workspace_id: 'ws-hid', description: 'Tx Hid', amount: 100, type: 'expense', transaction_date: '2026-09-10', due_date: '2026-09-10', status: 'pending', created_at: '2026-09-10' }]));
      storageMap.set('fincontrol_v2_purchases', JSON.stringify([{ id: 'pur-hid', workspace_id: 'ws-hid', description: 'Pur Hid', total_amount: 200, installment_count: 2, purchase_date: '2026-09-10', created_at: '2026-09-10' }]));
      storageMap.set('fincontrol_v2_installments', JSON.stringify([{ id: 'inst-hid', workspace_id: 'ws-hid', purchase_id: 'pur-hid', installment_number: 1, total_installments: 2, amount: 100, due_date: '2026-09-15', status: 'pending', created_at: '2026-09-10' }]));
      storageMap.set('fincontrol_v2_payments', JSON.stringify([{ id: 'pay-hid', workspace_id: 'ws-hid', transaction_id: 'tx-hid', amount: 50, payment_date: '2026-09-10', created_by: 'usr-1', created_at: '2026-09-10', affects_balance: false }]));
      storageMap.set('fincontrol_v2_transfers', JSON.stringify([{ id: 'trf-hid', workspace_id: 'ws-hid', from_account_id: 'acc-hid', to_account_id: 'acc-hid-2', amount: 100, transfer_date: '2026-09-10', created_by: 'usr-1', created_at: '2026-09-10' }]));
      storageMap.set('fincontrol_v2_settlements', JSON.stringify([{ id: 'set-hid', workspace_id: 'ws-hid', from_member_id: 'm-hid', to_member_id: 'm-hid-2', amount: 50, settlement_date: '2026-09-10', created_at: '2026-09-10' }]));
      storageMap.set('fincontrol_v2_goals', JSON.stringify([{ id: 'goal-hid', workspace_id: 'ws-hid', name: 'Goal Hid', target_amount: 1000, current_amount: 200, target_date: '2026-12-31', status: 'in_progress', color: '#000', icon: 'star', created_at: '2026-01-01' }]));
      storageMap.set('fincontrol_v2_budgets', JSON.stringify([{ id: 'bud-hid', workspace_id: 'ws-hid', category_id: 'cat-hid', month: 9, year: 2026, planned_amount: 500 }]));
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));

      const { getCtx } = await mountProvider();

      expect(getCtx().activeWorkspace.id).toBe('ws-hid');
      expect(getCtx().accounts.some((a) => a.id === 'acc-hid')).toBe(true);
      expect(getCtx().categories.some((c) => c.id === 'cat-hid')).toBe(true);
      expect(getCtx().creditCards.some((c) => c.id === 'cc-hid')).toBe(true);
      expect(getCtx().purchases.some((p) => p.id === 'pur-hid')).toBe(true);
      expect(getCtx().installments.some((i) => i.id === 'inst-hid')).toBe(true);
      expect(getCtx().settlements.some((s) => s.id === 'set-hid')).toBe(true);
      expect(getCtx().transfers.some((t) => t.id === 'trf-hid')).toBe(true);
    });

    it('validação de categoria/subcategoria: rejeita categoria de outro workspace e subcategoria inativa', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();

      // Categoria inexistente ou de outro workspace
      expect(() => {
        getCtx().addTransaction({
          description: 'Teste Categoria Inválida',
          amount: 50,
          type: 'expense',
          category_id: 'cat-inexistente',
          transaction_date: '2026-09-19',
          due_date: '2026-09-19',
          status: 'pending',
        });
      }).toThrow(/Categoria informada não pertence ao workspace/i);

      // Categoria com subcategoria inativa
      await act(async () => {
        getCtx().addCategory({
          name: 'Categoria Teste Inativa',
          icon: 'tag',
          color: '#ff0000',
          type: 'expense',
          active: true,
          subcategories: [
            {
              id: 'sub-inativa-1',
              workspace_id: 'ws-1',
              parent_id: 'temp',
              name: 'Sub Inativa',
              icon: 'tag',
              color: '#ff0000',
              type: 'expense',
              active: false,
              created_at: '2026-01-01',
            },
          ],
        });
      });

      expect(() => {
        getCtx().addTransaction({
          description: 'Teste Subcategoria Inativa',
          amount: 50,
          type: 'expense',
          category_id: 'sub-inativa-1',
          transaction_date: '2026-09-19',
          due_date: '2026-09-19',
          status: 'pending',
        });
      }).toThrow(/A subcategoria informada está inativa/i);
    });

    it('transferência: validação de mesma conta, valor <= 0, e rejeição de conta inativa', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();

      // Mesma conta de origem e destino
      expect(() => {
        getCtx().createTransfer('acc-1', 'acc-1', 100);
      }).toThrow(/A conta de origem e destino devem ser diferentes/i);

      // Valor zero ou negativo
      expect(() => {
        getCtx().createTransfer('acc-1', 'acc-2', 0);
      }).toThrow(/O valor da transferência deve ser de pelo menos R\$ 0,01/i);

      // Inativação de conta de destino
      await act(async () => {
        getCtx().updateAccount('acc-2', { active: false });
      });

      expect(() => {
        getCtx().createTransfer('acc-1', 'acc-2', 100);
      }).toThrow(/A conta bancária informada está inativa/i);
    });

    it('recordSettlement com payment_account_id: valida que conta pertence ao workspace e está ativa', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      storageMap.set('fincontrol_v2_transactions', JSON.stringify([
        {
          id: 'tx-set-val',
          workspace_id: 'ws-1',
          description: 'Almoço rateado',
          amount: 100,
          type: 'expense',
          paid_by_member_id: 'wsm-1',
          split_type: 'equal',
          splits: [
            { member_id: 'wsm-1', amount: 50 },
            { member_id: 'wsm-2', amount: 50 },
          ],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'paid',
          created_at: '2026-09-18',
        },
      ]));
      const { getCtx } = await mountProvider();

      // Conta inexistente
      expect(() => {
        getCtx().recordSettlement({
          from_member_id: 'wsm-2',
          to_member_id: 'wsm-1',
          amount: 25,
          payment_account_id: 'acc-inexistente-123',
        });
      }).toThrow(/A conta bancária informada para o acerto não pertence ao workspace ativo/i);

      // Conta inativa
      await act(async () => {
        getCtx().updateAccount('acc-1', { active: false });
      });
      expect(() => {
        getCtx().recordSettlement({
          from_member_id: 'wsm-2',
          to_member_id: 'wsm-1',
          amount: 25,
          payment_account_id: 'acc-1',
        });
      }).toThrow(/A conta bancária informada para o acerto está inativa/i);
    });

    it('depositGoal: conclui meta e atualiza status para completed quando atinge o alvo', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();

      let newGoal: any;
      await act(async () => {
        newGoal = getCtx().addGoal({
          name: 'Notebook Novo',
          target_amount: 1000,
          current_amount: 800,
          target_date: '2026-12-31',
          status: 'in_progress',
          color: '#10b981',
          icon: 'laptop',
        });
      });

      const accBefore = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      const balBefore = accBefore.current_balance;

      // Depósito de 250 (ultrapassa 1000)
      await act(async () => {
        getCtx().depositGoal(newGoal.id, 250, 'acc-1');
      });

      const foundGoal = getCtx().goals.find((g) => g.id === newGoal.id)!;
      expect(foundGoal.current_amount).toBe(1050);
      expect(foundGoal.status).toBe('completed');

      const accAfter = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      expect(accAfter.current_balance).toBe(balBefore - 250);

      // Rejeita depósito com conta inativa
      await act(async () => {
        getCtx().updateAccount('acc-2', { active: false });
      });
      expect(() => {
        getCtx().depositGoal(newGoal.id, 50, 'acc-2');
      }).toThrow(/A conta bancária informada está inativa/i);
    });

    it('duplicateTransaction: deve duplicar transação com sufixo (Cópia) e status pendente', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();

      let duplicated: any;
      await act(async () => {
        duplicated = getCtx().duplicateTransaction('tx-1');
      });

      expect(duplicated).toBeDefined();
      expect(duplicated.description).toContain('(Cópia)');
      expect(duplicated.status).toBe('pending');
      expect(duplicated.paid_amount).toBe(0);
      expect(duplicated.paid_at).toBeNull();
      expect(getCtx().transactions.some((t) => t.id === duplicated.id)).toBe(true);
    });

    it('toggleRecurring e deleteRecurring: deve alternar status e excluir recorrência', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();

      let rec: any;
      await act(async () => {
        rec = getCtx().addRecurring({
          description: 'Internet Fibra 500MB',
          amount: 149.9,
          type: 'expense',
          frequency: 'monthly',
          start_date: '2026-01-01',
          next_occurrence: '2026-01-01',
          active: true,
          auto_create: true,
        });
      });

      expect(rec.active).toBe(true);

      // Desativa
      await act(async () => {
        getCtx().toggleRecurring(rec.id);
      });
      expect(getCtx().recurring.find((r) => r.id === rec.id)?.active).toBe(false);

      // Reativa com recálculo de catchup
      await act(async () => {
        getCtx().toggleRecurring(rec.id);
      });
      expect(getCtx().recurring.find((r) => r.id === rec.id)?.active).toBe(true);

      // Exclui
      await act(async () => {
        getCtx().deleteRecurring(rec.id);
      });
      expect(getCtx().recurring.some((r) => r.id === rec.id)).toBe(false);
    });

    it('setBudget: deve criar novo orçamento e atualizar orçamento existente no mesmo mês/categoria', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();

      await act(async () => {
        getCtx().setBudget('cat-1', 1200, 9, 2026);
      });

      const b1 = getCtx().budgets.find((b) => b.category_id === 'cat-1' && b.month === 9 && b.year === 2026);
      expect(b1).toBeDefined();
      expect(b1?.planned_amount).toBe(1200);

      // Atualização no mesmo mês
      await act(async () => {
        getCtx().setBudget('cat-1', 1800, 9, 2026);
      });

      const b2 = getCtx().budgets.find((b) => b.category_id === 'cat-1' && b.month === 9 && b.year === 2026);
      expect(b2?.planned_amount).toBe(1800);
    });

    it('updateGoal: deve atualizar nome e alvo de uma meta existente', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();

      let g: any;
      await act(async () => {
        g = getCtx().addGoal({
          name: 'Carro Antigo',
          target_amount: 40000,
          current_amount: 5000,
          target_date: '2027-12-31',
          status: 'in_progress',
          color: '#3b82f6',
          icon: 'car',
        });
      });

      await act(async () => {
        getCtx().updateGoal(g.id, {
          name: 'Carro Elétrico 0km',
          target_amount: 80000,
        });
      });

      const updated = getCtx().goals.find((item) => item.id === g.id);
      expect(updated?.name).toBe('Carro Elétrico 0km');
      expect(updated?.target_amount).toBe(80000);
    });

    it('hidratação resiliente: captura erro de JSON corrompido em localStorage sem quebrar', async () => {
      storageMap.set('fincontrol_v2_workspaces', '{invalid-json-string-corrompida');
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));

      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);
      expect(getCtx().workspaces.length).toBeGreaterThan(0);
    });

    it('guardas defensivas: validações de createInstallmentPurchase e updateTransaction', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();

      // Compra parcelada com valor <= 0
      expect(() => {
        getCtx().createInstallmentPurchase({
          description: 'Teste Valor Zero',
          total_amount: 0,
          installment_count: 2,
          purchase_date: '2026-09-19',
        });
      }).toThrow(/maior que zero/i);

      // Compra parcelada com conta de outro workspace
      expect(() => {
        getCtx().createInstallmentPurchase({
          description: 'Teste Conta Outro WS',
          total_amount: 100,
          installment_count: 2,
          purchase_date: '2026-09-19',
          account_id: 'acc-inexistente-ws999',
        });
      }).toThrow(/não pertence ao workspace ativo/i);

      // updateTransaction: alteração de valor em transação já quitada (tx-1 está paid nos mocks)
      expect(() => {
        getCtx().updateTransaction('tx-1', { amount: 9999 });
      }).toThrow(/transações já quitadas ou faturadas/i);

      // updateTransaction: alteração para valor inválido em transação pendente
      let pendTx: any;
      await act(async () => {
        pendTx = getCtx().addTransaction({
          description: 'Pendente',
          amount: 50,
          type: 'expense',
          transaction_date: '2026-09-19',
          due_date: '2026-09-19',
          status: 'pending',
        });
      });

      expect(() => {
        getCtx().updateTransaction(pendTx.id, { amount: -5 });
      }).toThrow(/maior que zero/i);
    });
  });
});