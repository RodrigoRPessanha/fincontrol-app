import { describe, expect, it } from 'vitest';
import React, { act } from 'react';
import { FinanceProvider, useFinance } from '../../context/finance-context';
import { setupFinanceHarness } from '../test-utils/finance-provider-harness';
import { QuickAddModal } from '../../../components/transactions/QuickAddModal';
import { MAX_MONEY } from '../../financial-engine';

function props(n: any): any { const k = Object.keys(n).find((key) => key.startsWith('__reactProps$')); return k ? n[k] : {}; }
function nodes(n: any): any[] { return [n, ...(n.childNodes ?? []).flatMap(nodes)]; }
function text(n: any): string { return n.nodeType === 3 ? n.nodeValue ?? '' : n.textContent || (n.childNodes ?? []).map(text).join(''); }

describe('Regressões A2-R1/R2/R3: cartão e fronteiras locais', () => {
  const harness = setupFinanceHarness();
  async function fixture(balance = 1000) {
    harness.storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
    const h = await harness.mountProvider();
    let cardId = ''; let accountId = '';
    await act(async () => {
      cardId = h.getCtx().addCreditCard({ name: 'Isolated card', institution: 'Fixture', credit_limit: 1000, closing_day: 25, due_day: 5, color: '#000000', active: true }).id;
      accountId = h.getCtx().addAccount({ name: 'Isolated bank', institution: 'Fixture', type: 'cash', initial_balance: balance, current_balance: balance, color: '#000000', active: true }).id;
    });
    return { ...h, cardId, accountId };
  }
  const expense = { description: 'One-off', amount: 10, type: 'expense' as const, status: 'pending' as const, transaction_date: '2050-10-01', due_date: '2050-10-01' };

  it.each([false, true])('soma uma única vez a fatura explícita (inferir cartão=%s), exclui, paga e recarrega', async (infer) => {
    const h = await fixture();
    let first!: ReturnType<ReturnType<typeof useFinance>['addTransaction']>;
    let secondId = '';
    await act(async () => { first = h.getCtx().addTransaction({ ...expense, credit_card_id: h.cardId, account_id: h.accountId }); });
    await act(async () => { secondId = h.getCtx().addTransaction({ ...expense, amount: 25, credit_card_id: infer ? undefined : h.cardId, credit_card_bill_id: first.credit_card_bill_id }).id; });
    expect(h.getCtx().creditCardBills.find((b) => b.id === first.credit_card_bill_id)?.total_amount).toBe(35);
    expect(h.getCtx().transactions.find((t) => t.id === secondId)?.due_date).toBe('2050-11-05');
    expect(h.getCtx().accounts.find((a) => a.id === h.accountId)?.current_balance).toBe(1000);
    await act(async () => { h.getCtx().deleteTransaction(secondId); });
    expect(h.getCtx().creditCardBills.find((b) => b.id === first.credit_card_bill_id)?.total_amount).toBe(10);
    await act(async () => { h.getCtx().payCreditCardBill(first.credit_card_bill_id!, h.accountId, 10); });
    expect(h.getCtx().transactions.find((t) => t.id === first.id)?.status).toBe('paid');
    await act(async () => h.root.unmount());
    const reloaded = await harness.mountProvider();
    expect(reloaded.getCtx().creditCardBills.find((b) => b.id === first.credit_card_bill_id)?.total_amount).toBe(10);
    expect(reloaded.getCtx().accounts.find((a) => a.id === h.accountId)?.current_balance).toBe(990);
  });

  it('rejeita fatura ausente, estrangeira, de outro cartão/ciclo ou pagamento direto sem efeito parcial', async () => {
    const h = await fixture();
    let bill = '';
    await act(async () => { bill = h.getCtx().addTransaction({ ...expense, credit_card_id: h.cardId }).credit_card_bill_id!; });
    const snapshot = () => JSON.stringify([h.getCtx().accounts, h.getCtx().creditCardBills, h.getCtx().transactions, h.getCtx().payments]);
    const before = snapshot();
    for (const overrides of [
      { credit_card_bill_id: 'missing' },
      { credit_card_bill_id: bill, credit_card_id: 'card-1' },
      { credit_card_bill_id: bill, transaction_date: '2050-12-01' },
      { status: 'paid' as const },
    ]) {
      expect(() => h.getCtx().addTransaction({ ...expense, credit_card_id: h.cardId, ...overrides })).toThrow();
      expect(snapshot()).toBe(before);
    }
    await act(async () => { h.getCtx().createWorkspace('Foreign workspace'); });
    expect(() => h.getCtx().addTransaction({ ...expense, credit_card_bill_id: bill })).toThrow(/workspace/);
  });

  it('recusa overflow de total da fatura antes de publicar transação ou fatura', async () => {
    const h = await fixture();
    await act(async () => { h.getCtx().addTransaction({ ...expense, amount: MAX_MONEY, credit_card_id: h.cardId }); });
    const before = JSON.stringify([h.getCtx().creditCardBills, h.getCtx().transactions]);
    expect(() => h.getCtx().addTransaction({ ...expense, amount: 0.01, credit_card_id: h.cardId })).toThrow(/intervalo/);
    expect(JSON.stringify([h.getCtx().creditCardBills, h.getCtx().transactions])).toBe(before);
  });

  it.each([-MAX_MONEY, -100])('pagamento valida saldo resultante %s e conserva negativo legítimo', async (balance) => {
    const h = await fixture(balance);
    let bill = '';
    await act(async () => { bill = h.getCtx().addTransaction({ ...expense, amount: 100, credit_card_id: h.cardId }).credit_card_bill_id!; });
    const before = JSON.stringify([h.getCtx().accounts, h.getCtx().creditCardBills, h.getCtx().transactions, h.getCtx().payments]);
    if (balance === -MAX_MONEY) {
      expect(() => h.getCtx().payCreditCardBill(bill, h.accountId, 100)).toThrow(/intervalo/);
      expect(JSON.stringify([h.getCtx().accounts, h.getCtx().creditCardBills, h.getCtx().transactions, h.getCtx().payments])).toBe(before);
    } else {
      await act(async () => { h.getCtx().payCreditCardBill(bill, h.accountId, 10.075); });
      expect(h.getCtx().accounts.find((a) => a.id === h.accountId)?.current_balance).toBe(-110.08);
    }
  });

  it('QuickAdd mantém conta contextual ao trocar método para cartão, sem debitar a conta', async () => {
    harness.storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
    const h = await harness.mountProvider();
    let ctx!: ReturnType<typeof useFinance>;
    function Capture() { ctx = useFinance(); return null; }
    await act(async () => h.root.render(<FinanceProvider><Capture /><QuickAddModal isOpen onClose={() => {}} /></FinanceProvider>));
    const beforeIds = new Set(ctx.transactions.map((t) => t.id));
    const before = ctx.accounts.find((a) => a.id === 'acc-1')!.current_balance;
    await act(async () => props(nodes(h.container).find((n) => n.tagName === 'BUTTON' && text(n).includes('Mais opções'))).onClick());
    const account = nodes(h.container).find((n) => n.tagName === 'SELECT' && nodes(n).some((o) => o.tagName === 'OPTION' && props(o).value === 'acc-1'));
    await act(async () => props(account).onChange({ target: { value: 'acc-1' } }));
    const method = nodes(h.container).find((n) => n.tagName === 'SELECT' && nodes(n).some((o) => o.tagName === 'OPTION' && props(o).value === 'pm-2'));
    await act(async () => {
      props(method).onChange({ target: { value: 'pm-2' } });
      props(nodes(h.container).find((n) => n.tagName === 'INPUT' && props(n).placeholder === '0,00')).onChange({ target: { value: '25' } });
    });
    expect(nodes(h.container).some((n) => n.tagName === 'P' && text(n).includes('não será debitada agora'))).toBe(true);
    await act(async () => props(nodes(h.container).find((n) => n.tagName === 'FORM')).onSubmit({ preventDefault() {} }));
    const added = ctx.transactions.find((t) => !beforeIds.has(t.id))!;
    expect(added.account_id).toBe('acc-1');
    expect(added.credit_card_bill_id).toBeTruthy();
    expect(ctx.accounts.find((a) => a.id === 'acc-1')?.current_balance).toBe(before);
  });
});
