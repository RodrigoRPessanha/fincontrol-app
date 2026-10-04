import { describe, expect, it } from 'vitest';
import { allocateBillPayments, calculateDashboardSummary, getCategoryLineage, flattenCategories, resolveCategory, toCents } from '../../financial-engine';
import { Category } from '../../types';

const category = (id: string, parent_id?: string, workspace_id = 'ws'): Category => ({ id, parent_id, workspace_id, name: id, type: 'expense', icon: 'tag', color: '#000000', active: true, created_at: '2026-01-01' });
const tx = (id: string, amount: number, extras = {}): any => ({ id, amount, type: 'expense', status: 'pending', credit_card_bill_id: 'bill', ...extras });
const bill = (total_amount = 100, paid_amount = 40, extras = {}): any => ({ id: 'bill', total_amount, paid_amount, status: 'partially_paid', ...extras });

describe('category hierarchy and proportional bill reporting', () => {
  it('enumerates nested categories once, preserves explicit metadata and rejects foreign children', () => {
    const child = { ...category('child'), active: false };
    const root = { ...category('root'), subcategories: [child, category('foreign', undefined, 'other')] };
    const result = flattenCategories([root, category('child', 'root')]);
    expect(result.map((c) => c.id)).toEqual(['root', 'child']);
    expect(result[1].active).toBe(true);
    expect(flattenCategories([root])[1]).toMatchObject({ id: 'child', parent_id: 'root', active: false });
    const legacyWithoutWorkspace = { ...category('old'), workspace_id: undefined } as unknown as Category;
    expect(flattenCategories([{ ...category('root'), subcategories: [legacyWithoutWorkspace] }])[1].workspace_id).toBe('ws');
  });
  it('resolves flat ancestry regardless of input order and retains inactive history', () => {
    const root = { ...category('root'), active: false };
    const cats = [category('grandchild', 'child'), root, category('child', 'root')];
    expect(resolveCategory(cats, 'grandchild')).toMatchObject({ isFound: true, rootId: 'root', displayName: 'root > child > grandchild' });
    expect(getCategoryLineage(cats, 'grandchild').map((c) => c.id)).toEqual(['grandchild', 'child', 'root']);
  });
  it('supports legacy nested children and prefers explicit flat rows over duplicates', () => {
    const child = category('child');
    const root = { ...category('root'), subcategories: [child, { ...category('explicit'), parent_id: 'root' }] };
    expect(resolveCategory([root], 'child').rootId).toBe('root');
    expect(resolveCategory([root, category('explicit')], 'explicit').rootId).toBe('explicit');
    expect(resolveCategory([root], 'root').displayName).toBe('root');
  });
  it.each([undefined, null, 'unknown'])('keeps absent categories in the uncategorized bucket: %s', (id) => {
    expect(resolveCategory([category('root')], id).isFound).toBe(false);
  });
  it.each([
    [category('a', 'missing')],
    [category('a', 'b'), category('b', undefined, 'foreign')],
    [category('a', 'b'), category('b', 'a')],
  ].map((cats) => ({ cats })))('rejects missing, foreign or cyclic ancestry', ({ cats }) => {
    expect(getCategoryLineage(cats, 'a')).toEqual([]);
  });
  it('attributes a single-item partial payment without changing source obligations', () => {
    const transactions = [tx('a', 100)]; const before = JSON.stringify(transactions);
    expect(allocateBillPayments(transactions, [], [bill()]).transactions.get('a')).toBe(40);
    expect(JSON.stringify(transactions)).toBe(before);
  });
  it('shares payments between transactions and installments', () => {
    const result = allocateBillPayments([tx('a', 60)], [{ id: 'i', amount: 40, credit_card_bill_id: 'bill', status: 'pending' } as any], [bill(100, 25)]);
    expect(result.transactions.get('a')).toBe(15); expect(result.installments.get('i')).toBe(10);
  });
  it.each([['a', 'b', 'c'], ['c', 'b', 'a']])('keeps rounding stable across reload ordering: %j', (...ids) => {
    const result = allocateBillPayments(ids.map((id) => tx(id, 1)), [], [bill(3, 1)]);
    expect(result.transactions.get('a')).toBe(0.34); expect(result.transactions.get('b')).toBe(0.33); expect(result.transactions.get('c')).toBe(0.33);
  });
  it.each([['a', 'b'], ['b', 'a']])('allocates a weighted single cent independently of input order: %j', (...ids) => {
    const result = allocateBillPayments(ids.map((id) => tx(id, id === 'a' ? 2 : 1)), [], [bill(3, 0.01)]);
    expect(result.transactions.get('a')).toBe(0.01); expect(result.transactions.get('b')).toBe(0);
  });
  it('separates transaction and installment identities even for equal UUIDs', () => {
    const result = allocateBillPayments([tx('same', 0.5)], [{ id: 'same', amount: 0.5, status: 'pending', credit_card_bill_id: 'bill' } as any], [bill(1, 0.01)]);
    expect(result.installments.get('same')).toBe(0.01); expect(result.transactions.get('same')).toBe(0);
  });
  it('does not fabricate allocation for absent, cancelled or zero-sized bills', () => {
    const result = allocateBillPayments([tx('a', 100, { status: 'cancelled' }), tx('income', 100, { type: 'income' }), tx('other', 10, { credit_card_bill_id: undefined }), tx('zero', 0, { credit_card_bill_id: 'zero' })], [{ id: 'cancelled', amount: 10, status: 'cancelled', credit_card_bill_id: 'bill' }, { id: 'unbilled', amount: 10, status: 'pending' }] as any, [bill(), bill(10, 2, { id: 'absent' }), bill(0, 0, { id: 'zero' })]);
    expect(result.transactions.size).toBe(0); expect(result.installments.size).toBe(0);
    expect(allocateBillPayments([tx('a', 100)], [], [bill(100, 40, { status: 'cancelled' })]).transactions.size).toBe(0);
  });
  it('reserves missing-item shares and caps overpaid historical data', () => {
    expect(allocateBillPayments([tx('a', 50)], [], [bill(100, 40)]).transactions.get('a')).toBe(20);
    expect(allocateBillPayments([tx('a', 100)], [], [bill(100, 120)]).transactions.get('a')).toBe(100);
    expect(allocateBillPayments([tx('a', 100)], [], [bill(100, -10)]).transactions.get('a')).toBe(0);
  });
  it('uses exact integer products at the monetary limit', () => {
    const result = allocateBillPayments([tx('a', 8000000000.01), tx('b', 1999999999.98)], [], [bill(9999999999.99, 9999999999.98)]);
    expect(result.transactions.get('a')).toBe(8000000000); expect(result.transactions.get('b')).toBe(1999999999.98);
    expect([...result.transactions.values()].reduce((sum, value) => sum + toCents(value), 0)).toBe(999999999998);
  });
  it('includes overdue transaction and installment remainders while excluding paid/cancelled', () => {
    const summary = calculateDashboardSummary([tx('overdue', 100, { status: 'overdue', paid_amount: 30, credit_card_bill_id: null, due_date: '2020-01-01', transaction_date: '2020-01-01' })], [{ id: 'i', amount: 50, paid_amount: 10, status: 'overdue', due_date: '2020-01-01' } as any], [], [], [], '2026-10', [], '2026-10-04');
    expect(summary.overdue).toEqual({ count: 2, amount: 110 });
  });
});
