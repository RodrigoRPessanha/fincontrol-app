import { describe, it, expect } from 'vitest';
import { monthlyRepaymentPlan, applyMonthlyRepayments } from '../monthly-repayments';
import { monthlySharedExpenses, monthlySplitBalances } from '../financial-engine/monthly-splits';
import { Purchase, Installment, WorkspaceMember, Person } from '../types';

const purchase = { id: 'p', workspace_id: 'w', description: '600/3', total_amount: 600, installment_count: 3, split_type: 'equal', paid_by_member_id: 'a', repayment_version: 2, splits: [{ member_id: 'a', amount: 300 }, { person_id: 'b', amount: 300, repaid_installments_count: 0 }] } as Purchase;
const rows = [1,2,3].map(n => ({ id: `i${n}`, purchase_id: 'p', amount: 200, installment_number: n, due_date: `2026-${String(n+8).padStart(2,'0')}-10`, status: 'pending' })) as Installment[];
const members = [{ id: 'a', workspace_id: 'w' }] as WorkspaceMember[];
const people = [{ id: 'b', workspace_id: 'w', name: 'B' }] as Person[];

describe('Monthly repayments and compensation', () => {
  it('marks a prefix through October and keeps future installments and bank payments untouched', () => {
    const before = JSON.stringify(rows);
    const plan = monthlyRepaymentPlan('w', '2026-10', 'b', [purchase], rows);
    expect(plan).toEqual([{purchase_id:'p',expected_version:2,previous_count:0,count:2}]);
    const updated = applyMonthlyRepayments('w','2026-10','b',[purchase],rows,plan)[0];
    expect(updated.splits?.[1]).toMatchObject({repaid_installments_count:2,repaid_amount:200});
    expect(updated.repayment_version).toBe(3); expect(JSON.stringify(rows)).toBe(before);
    expect(monthlyRepaymentPlan('w','2026-10','b',[updated],rows)).toEqual([]);
    const october = monthlySharedExpenses('w','2026-10',[],[updated],rows,[]);
    expect(monthlySplitBalances('w',october.items,members,people).pairwiseDebts).toEqual([]);
    const november = monthlySharedExpenses('w','2026-11',[],[updated],rows,[]);
    expect(monthlySplitBalances('w',november.items,members,people).pairwiseDebts[0]).toMatchObject({from_member_id:'b',to_member_id:'a',amount:100});
  });
  it('preserves higher counts, payer shares, foreign workspaces and unrelated participant history', () => {
    const existing = {...purchase,splits:[...purchase.splits!,{person_id:'c',amount:0,repaid_installments_count:3,repaid_amount:0}]};
    const plan = monthlyRepaymentPlan('w','2026-09','b',[existing],rows);
    const updated = applyMonthlyRepayments('w','2026-09','b',[existing],rows,plan)[0];
    expect(updated.splits?.[2]).toMatchObject({repaid_installments_count:3,repaid_amount:0});
    expect(monthlyRepaymentPlan('w','2026-09','c',[updated],rows)).toEqual([]);
    expect(monthlyRepaymentPlan('w','2026-09','a',[purchase],rows)).toEqual([]);
    expect(monthlyRepaymentPlan('foreign','2026-09','b',[purchase],rows)).toEqual([]);
    expect(monthlyRepaymentPlan('w','2026-08','b',[purchase],rows)).toEqual([]);
  });
  it('rejects stale previews, invalid months, cancelled or out of order installments', () => {
    const plan = monthlyRepaymentPlan('w','2026-09','b',[purchase],rows);
    expect(() => applyMonthlyRepayments('w','2026-09','b',[{...purchase,repayment_version:3}],rows,plan)).toThrow(/alterados/);
    expect(() => monthlyRepaymentPlan('w','bad','b',[purchase],rows)).toThrow(/mês válido/);
    expect(() => monthlyRepaymentPlan('w','2026-10','b',[purchase],[{...rows[0],due_date:'2027-01-10'},...rows.slice(1)])).toThrow(/ordem/);
    expect(() => monthlyRepaymentPlan('w','2026-10','b',[purchase],[{...rows[0],status:'cancelled'},...rows.slice(1)])).toThrow(/Confira/);
  });
  it('does not invent repayments for unidentified participants, the payer or zero-valued shares',()=>{
    const item={id:'x',description:'X',amount:100,date:'2026-10-01',paid_by_person_id:'b',splits:[{person_id:'b',amount:100,repaid_installments_count:3},{member_id:'a',amount:0,repaid_installments_count:3},{amount:0,repaid_installments_count:3}],isPurchase:true,installmentCount:3,installmentNumber:1};
    expect(monthlySplitBalances('w',[item],members,people).pairwiseDebts).toEqual([]);
    expect(monthlySplitBalances('w',[{...item,paid_by_person_id:null}],members,people).balances).toHaveLength(2);
  });
  it('computes 42.59 in reciprocal obligations, but does not confuse equal shares with zero debt', () => {
    const items = [{id:'a',description:'A',amount:344.06,date:'2026-10-10',paid_by_member_id:'a',splits:[{person_id:'b',amount:344.06}],isPurchase:false,installmentCount:1}, {id:'b',description:'B',amount:301.47,date:'2026-10-10',paid_by_person_id:'b',splits:[{member_id:'a',amount:301.47}],isPurchase:false,installmentCount:1}];
    expect(monthlySplitBalances('w',items,members,people).pairwiseDebts[0]).toMatchObject({from_member_id:'b',to_member_id:'a',amount:42.59});
    const monthly = monthlySharedExpenses('w','2026-10',[],[purchase],rows,[]);
    expect([...monthly.responsibilities.values()]).toEqual([100,100]);
    expect(monthlySplitBalances('w',monthly.items,members,people).pairwiseDebts[0].amount).toBe(100);
  });
});
