import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { setupFinanceHarness } from '../test-utils/finance-provider-harness';
import { MAX_MONEY } from '../../financial-engine';

describe('Validação financeira antes da mutation local', () => {
  const harness = setupFinanceHarness();
  it.each([-100, 0, 0.004, NaN, Infinity, 1e30])('transações de quantia %s preservam estado', async (amount) => {
    const { getCtx } = await harness.mountProvider();
    const before = JSON.stringify({ accounts: getCtx().accounts, transactions: getCtx().transactions, payments: getCtx().payments });
    const tx = { description: 'Invalid paid expense', type: 'expense' as const, amount, status: 'paid' as const, account_id: 'acc-1', transaction_date: '2026-01-01', due_date: '2026-01-01' };
    expect(() => getCtx().addTransaction(tx)).toThrow();
    expect(() => getCtx().updateTransaction(getCtx().transactions[0].id, { amount })).toThrow();
    expect(JSON.stringify({ accounts: getCtx().accounts, transactions: getCtx().transactions, payments: getCtx().payments })).toBe(before);
  });

  it('permite saldos assinados e limites zero; valida criação e edição de cadastros', async () => {
    const { getCtx } = await harness.mountProvider();
    await act(async () => {
      const account = getCtx().addAccount({ name: 'Signed', type: 'cash', institution: 'Fixture', color: '#000000', initial_balance: -12.345, current_balance: -12.345, active: true });
      getCtx().updateAccount(account.id, { initial_balance: -1.005, current_balance: -1.005 });
      getCtx().addAccount({ name: 'Default', type: 'cash', active: true } as any);
      const goal = getCtx().addGoal({ name: 'Default goal', target_amount: 100, status: 'in_progress' } as any);
      getCtx().updateGoal(goal.id, { target_amount: 200, current_amount: 0 });
      getCtx().updateCreditCard(getCtx().creditCards[0].id, { credit_limit: 0 });
      getCtx().setBudget(getCtx().categories[0].id, 0, 10, 2026);
    });
    expect(getCtx().accounts.find((a) => a.name === 'Signed')?.current_balance).toBe(-1.01);
    expect(getCtx().accounts.find((a) => a.name === 'Default')?.initial_balance).toBe(0);
    expect(getCtx().goals.find((g) => g.name === 'Default goal')?.current_amount).toBe(0);
    for (const amount of [NaN, Infinity, 1e30]) {
      const before = JSON.stringify([getCtx().accounts, getCtx().goals, getCtx().creditCards, getCtx().budgets]);
      expect(() => getCtx().addAccount({ name: 'Invalid', type: 'cash', institution: 'Fixture', color: '#000000', initial_balance: amount, current_balance: amount, active: true })).toThrow();
      expect(() => getCtx().updateAccount('acc-1', { current_balance: amount })).toThrow();
      expect(() => getCtx().updateGoal(getCtx().goals[0].id, { current_amount: amount })).toThrow();
      expect(() => getCtx().updateCreditCard(getCtx().creditCards[0].id, { credit_limit: amount })).toThrow();
      expect(() => getCtx().setBudget(getCtx().categories[0].id, amount, 10, 2026)).toThrow();
      expect(JSON.stringify([getCtx().accounts, getCtx().goals, getCtx().creditCards, getCtx().budgets])).toBe(before);
    }
  });

  it('normaliza transação de três decimais e rejeita saldo resultante fora da faixa sem efeito parcial', async () => {
    const { getCtx } = await harness.mountProvider();
    let id = '';
    await act(async () => { id = getCtx().addAccount({ name: 'Limit', type: 'cash', institution: 'Fixture', color: '#000000', initial_balance: MAX_MONEY, current_balance: MAX_MONEY, active: true }).id; });
    const tx = { description: 'Canonical', type: 'income' as const, amount: 0.005, status: 'paid' as const, account_id: id, transaction_date: '2026-01-01', due_date: '2026-01-01' };
    expect(() => getCtx().addTransaction(tx)).toThrow(/intervalo/);
    expect(getCtx().accounts.find((a) => a.id === id)?.current_balance).toBe(MAX_MONEY);
    expect(getCtx().transactions.some((t) => t.description === 'Canonical')).toBe(false);
    await act(async () => { getCtx().addTransaction({ ...tx, type: 'expense', amount: 10.075 }); });
    expect(getCtx().transactions.find((t) => t.description === 'Canonical')?.amount).toBe(10.08);
  });
});
