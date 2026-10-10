import { describe, expect, it } from 'vitest';
import { monthlySharedExpenses } from '../../financial-engine/monthly-splits';
import { toCents } from '../../financial-engine';
import { Transaction, Purchase, Installment, CreditCardBill } from '../../types';

function purchaseFixture(total = 600, amounts = [200, 200, 200], shares = [300, 300]) {
  const purchase = { id: 'p', workspace_id: 'w', description: 'Compra dividida', total_amount: total,
    installment_count: amounts.length, purchase_date: '2026-09-01', split_type: 'custom', paid_by_member_id: 'a',
    splits: [{ member_id: 'a', amount: shares[0] }, { person_id: 'b', amount: shares[1] }] } as Purchase;
  const installments = amounts.map((amount, index) => ({ id: `i${index}`, purchase_id: 'p', installment_number: index + 1,
    amount, due_date: `2026-${String(index + 9).padStart(2, '0')}-10`, status: 'pending' })) as Installment[];
  return { purchase, installments };
}

describe('Monthly shared expenses', () => {
  it('shows 100 per person each month for a 600 purchase in three 200 installments', () => {
    const { purchase, installments } = purchaseFixture(); const original = JSON.stringify(purchase);
    for (const month of ['2026-09', '2026-10', '2026-11']) {
      const result = monthlySharedExpenses('w', month, [], [purchase], installments, []);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].amount).toBe(200);
      expect([...result.responsibilities]).toEqual([['a', 100], ['b', 100]]);
    }
    expect(JSON.stringify(purchase)).toBe(original);
  });

  it('conserves row cents and every custom share across all months, independent of input ordering', () => {
    const { purchase, installments } = purchaseFixture(100.01, [33.34, 33.34, 33.33], [70.01, 30]);
    const sums = { a: 0, b: 0 };
    for (const month of ['2026-09', '2026-10', '2026-11']) {
      const first = monthlySharedExpenses('w', month, [], [purchase], installments, []);
      const reordered = monthlySharedExpenses('w', month, [], [{ ...purchase, splits: [...purchase.splits!].reverse() }], [...installments].reverse(), []);
      expect(first.items).toEqual(reordered.items);
      expect(first.items[0].splits.reduce((sum, split) => sum + toCents(split.amount), 0)).toBe(toCents(first.items[0].amount));
      sums.a += toCents(first.responsibilities.get('a')!); sums.b += toCents(first.responsibilities.get('b')!);
    }
    expect(sums).toEqual({ a: 7001, b: 3000 });
  });

  it('keeps one-cent and zero shares exact and sums two installments in the same month', () => {
    const { purchase, installments } = purchaseFixture(0.02, [0.01, 0.01], [0.01, 0.01]);
    installments[1].due_date = '2026-09-20';
    const result = monthlySharedExpenses('w', '2026-09', [], [purchase], installments, []);
    expect(result.items).toHaveLength(2);
    expect([...result.responsibilities]).toEqual([['a', 0.01], ['b', 0.01]]);
    expect(result.items[0].splits.map((split) => split.amount)).toEqual([0.01, 0]);
  });

  it('uses BigInt for amounts whose proportional products exceed safe integer precision', () => {
    const { purchase, installments } = purchaseFixture(9000000000, [3000000000, 3000000000, 3000000000], [4500000000, 4500000000]);
    const result = monthlySharedExpenses('w', '2026-10', [], [purchase], installments, []);
    expect(result.responsibilities.get('a')).toBe(1500000000);
    expect(result.responsibilities.get('b')).toBe(1500000000);
  });
  it('allocates a larger remainder to either participant and deterministically orders same-date expenses', () => {
    const { purchase, installments } = purchaseFixture(600, [200, 200, 200], [100, 500]);
    expect([...monthlySharedExpenses('w', '2026-09', [], [purchase], installments, []).responsibilities.values()]).toEqual([33.33, 166.67]);
    const base = { workspace_id: 'w', type: 'expense', status: 'pending', split_type: 'equal', amount: 10, transaction_date: '2026-10-01', splits: [{ member_id: 'a', amount: 10 }] } as Transaction;
    expect(monthlySharedExpenses('w', '2026-10', [{ ...base, id: 'b' }, { ...base, id: 'a' }], [], [], []).items.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('uses competence for ordinary expenses and bill due date for card purchases', () => {
    const tx = { id: 'tx', workspace_id: 'w', type: 'expense', status: 'pending', split_type: 'equal', amount: 40,
      transaction_date: '2026-09-01', due_date: '2026-11-10', splits: [{ member_id: 'a', amount: 20 }, { person_id: 'b', amount: 20 }] } as Transaction;
    const card = { ...tx, id: 'card', credit_card_bill_id: 'bill' };
    const bills = [{ id: 'bill', workspace_id: 'w', status: 'open', due_date: '2026-10-10' }] as CreditCardBill[];
    expect(monthlySharedExpenses('w', '2026-09', [tx, card], [], [], bills).items.map((item) => item.id)).toEqual(['tx']);
    expect(monthlySharedExpenses('w', '2026-10', [tx, card], [], [], bills).items.map((item) => item.id)).toEqual(['card']);
    expect(monthlySharedExpenses('w', '2026-11', [card], [], [], []).items).toHaveLength(1);
    expect(monthlySharedExpenses('w', '2026-11', [card], [], [], [{ ...bills[0], workspace_id: 'foreign' }]).items).toHaveLength(1);
    expect(monthlySharedExpenses('w', '2026-10', [card], [], [], [{ ...bills[0], status: 'cancelled' }]).items).toEqual([]);
    expect(monthlySharedExpenses('w', '2026-09', [{ ...tx, transaction_date: undefined } as any], [], [], []).items).toEqual([]);
  });

  it('excludes cancelled, individual, foreign and income entries without counting purchases twice', () => {
    const { purchase, installments } = purchaseFixture();
    installments[1].status = 'cancelled';
    expect(monthlySharedExpenses('w', '2026-10', [], [purchase], installments, []).items).toEqual([]);
    installments[1].status = 'paid'; installments[1].credit_card_bill_id = 'bill';
    expect(monthlySharedExpenses('w', '2026-10', [], [purchase], installments, [{ id: 'bill', workspace_id: 'w', status: 'cancelled' } as any]).items).toEqual([]);
    const tx = { workspace_id: 'w', type: 'expense', status: 'cancelled', split_type: 'equal' } as Transaction;
    expect(monthlySharedExpenses('w', '2026-10', [tx, { ...tx, status: 'pending', type: 'income' }, { ...tx, workspace_id: 'other' }, { ...tx, status: 'paid', split_type: 'individual' }, { ...tx, status: 'paid', split_type: null }, { ...tx, status: 'paid', splits: [] }],
      [{ ...purchase, workspace_id: 'other' }, { ...purchase, split_type: 'individual' }, { ...purchase, split_type: null }, { ...purchase, splits: [] }], installments, []).items).toEqual([]);
  });

  it.each(['', '2026-13', 'wrong'])('rejects an invalid period %s without inventing a total', (month) => {
    const { purchase, installments } = purchaseFixture();
    expect(monthlySharedExpenses('w', month, [], [purchase], installments, []).items).toEqual([]);
  });

  it.each(['missing', 'amount', 'negative', 'share_sum', 'duplicate', 'zero'])('warns on inconsistent purchase rows (%s)', (kind) => {
    const { purchase, installments } = purchaseFixture();
    if (kind === 'missing') installments.pop();
    if (kind === 'amount') installments[0].amount = 199;
    if (kind === 'negative') { purchase.splits![0].amount = -1; purchase.splits![1].amount = 601; }
    if (kind === 'share_sum') purchase.splits![0].amount = 299;
    if (kind === 'duplicate') installments[0].installment_number = 2;
    if (kind === 'zero') { installments[0].amount = 0; installments[1].amount = 400; }
    const result = monthlySharedExpenses('w', '2026-10', [], [purchase], installments, []);
    expect(result.items).toEqual([]); expect(result.warnings).toEqual(['Compra dividida']);
  });
});
