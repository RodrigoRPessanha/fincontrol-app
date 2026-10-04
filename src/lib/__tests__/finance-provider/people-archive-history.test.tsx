import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { setupFinanceHarness } from '../test-utils/finance-provider-harness';

describe('Pessoas arquivadas: novas associações e histórico', () => {
  const harness = setupFinanceHarness();
  it('bloqueia novas despesas/parcelamentos e mantém edição do rateio histórico', async () => {
    const { getCtx } = await harness.mountProvider();
    let id = '', tx = '';
    await act(async () => {
      id = getCtx().addPerson('Archive fixture').id;
      tx = getCtx().addTransaction({ description: 'History', amount: 10, type: 'expense', status: 'pending', transaction_date: '2026-01-01', due_date: '2026-01-01', paid_by_person_id: id, split_type: 'custom', splits: [{ person_id: id, amount: 10 }] }).id;
      getCtx().updatePerson(id, { archived: true });
    });
    expect(() => getCtx().addTransaction({ description: 'New', amount: 10, type: 'expense', status: 'pending', transaction_date: '2026-01-01', due_date: '2026-01-01', paid_by_person_id: id })).toThrow(/arquivada/);
    expect(() => getCtx().createInstallmentPurchase({ description: 'New', total_amount: 10, installment_count: 1, purchase_date: '2026-01-01', paid_by_person_id: id })).toThrow(/arquivada/);
    await act(async () => getCtx().updateTransaction(tx, { description: 'Edited history', splits: [{ person_id: id, amount: 10 }] }));
    expect(getCtx().transactions.find((t) => t.id === tx)?.description).toBe('Edited history');
    await act(async () => getCtx().updatePerson(id, { archived: false }));
    await act(async () => {
      expect(getCtx().addTransaction({ description: 'Restored', amount: 1, type: 'expense', status: 'pending', transaction_date: '2026-01-01', due_date: '2026-01-01', paid_by_person_id: id }).id).toBeTruthy();
    });
  });

  it('não trata outra pessoa arquivada como parte do histórico existente', async () => {
    const { getCtx } = await harness.mountProvider();
    let oldPerson = '', other = '', tx = '';
    await act(async () => {
      oldPerson = getCtx().addPerson('Original').id;
      other = getCtx().addPerson('Other').id;
      tx = getCtx().addTransaction({ description: 'History', amount: 10, type: 'expense', status: 'pending', transaction_date: '2026-01-01', due_date: '2026-01-01', paid_by_person_id: oldPerson, split_type: 'custom', splits: [{ person_id: oldPerson, amount: 10 }] }).id;
      getCtx().updatePerson(other, { archived: true });
    });
    expect(() => getCtx().updateTransaction(tx, { paid_by_person_id: other })).toThrow(/arquivada/);
    expect(() => getCtx().updateTransaction(tx, { splits: [{ person_id: other, amount: 10 }] })).toThrow(/arquivada/);
    expect(() => getCtx().addTransaction({ description: 'New split', amount: 10, type: 'expense', status: 'pending', transaction_date: '2026-01-01', due_date: '2026-01-01', split_type: 'custom', splits: [{ person_id: other, amount: 10 }] })).toThrow(/arquivada/);
  });
});
