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
    });
  });
});