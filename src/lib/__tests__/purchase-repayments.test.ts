import { describe, it, expect } from 'vitest';
import { withPurchaseRepayments } from '../purchase-repayments';
import { calculateMemberNetBalances } from '../financial-engine/splits';
import { Purchase, Installment } from '../types';

const purchase = { id: 'p', workspace_id: 'w', description: '600/3', total_amount: 600, installment_count: 3, purchase_date: '2026-01-01', paid_by_member_id: 'a', split_type: 'equal', splits: [{ member_id: 'a', amount: 300 }, { person_id: 'b', amount: 300 }] } as Purchase;
const rows = [1, 2, 3].map((n) => ({ id: `i${n}`, purchase_id: 'p', installment_number: n, amount: 200, due_date: `2026-0${n}-10`, status: 'pending' })) as Installment[];
describe('Historical purchase repayments', () => {
  it('reduces accumulated debt by 200 for two repaid installments without changing installment payments', () => {
    const updated = withPurchaseRepayments(purchase, rows, [{ participant_id: 'b', count: 2 }]);
    expect(updated.splits?.[1]).toMatchObject({ repaid_installments_count: 2, repaid_amount: 200 });
    expect(purchase.splits?.[1].repaid_amount).toBeUndefined(); expect(rows.every((row) => row.status === 'pending')).toBe(true);
    const balances = calculateMemberNetBalances([], [], [{ id: 'a', workspace_id: 'w' } as any], 'w', [updated], [{ id: 'b', workspace_id: 'w', name: 'B' } as any]);
    expect(balances.pairwiseDebts[0].amount).toBe(100);
  });
  it('replaces previous repayments, permits zero and full counts, and conserves rounded custom quotas', () => {
    const rounded = { ...purchase, total_amount: 100.01, splits: [{ member_id: 'a', amount: 70.01 }, { person_id: 'b', amount: 30 }] };
    const installments = rows.map((row, i) => ({ ...row, amount: i < 2 ? 33.34 : 33.33 }));
    const full = withPurchaseRepayments(rounded, installments, [{ participant_id: 'b', count: 3 }]);
    expect(full.splits?.[1].repaid_amount).toBe(30);
    expect(withPurchaseRepayments(full, installments, [{ participant_id: 'b', count: 1 }]).splits?.[1].repaid_amount).toBe(10);
    expect(withPurchaseRepayments(full, installments, []).splits?.[1].repaid_amount).toBe(0);
    expect(withPurchaseRepayments({ ...purchase, splits: undefined }, [], [])).toMatchObject({ splits: undefined });
  });
  it.each([[{ participant_id: 'b', count: -1 }], [{ participant_id: 'b', count: 4 }], [{ participant_id: 'b', count: 1.5 }], [{ participant_id: 'a', count: 1 }], [{ participant_id: 'foreign', count: 0 }], [{ participant_id: 'b', count: 1 }, { participant_id: 'b', count: 2 }]].map((counts) => [counts] as const))('rejects invalid, foreign, payer or duplicated counts (%j)', (counts) => {
    expect(() => withPurchaseRepayments(purchase, rows, counts)).toThrow(/quantidade válida/);
  });
  it('rejects repayments with inconsistent or cancelled installments and missing payer', () => {
    for (const invalid of [rows.slice(0, 2), [{ ...rows[0], status: 'cancelled' as const }, ...rows.slice(1)]]) expect(() => withPurchaseRepayments(purchase, invalid, [{ participant_id: 'b', count: 1 }])).toThrow(/Confira/);
    expect(() => withPurchaseRepayments({ ...purchase, paid_by_member_id: null }, rows, [{ participant_id: 'b', count: 1 }])).toThrow(/Confira/);
  });
});
