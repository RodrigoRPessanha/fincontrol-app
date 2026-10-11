import { describe, it, expect } from 'vitest';
import { expenseListRows } from '../expense-list';
import { calculateMemberNetBalances } from '../financial-engine/splits';
import { Transaction, Purchase, Installment } from '../types';

const tx = { id: 't', workspace_id: 'w', description: 'Avulsa', amount: 40, type: 'expense', transaction_date: '2026-09-29', due_date: '2026-09-29', status: 'pending', paid_by_member_id: 'a', splits: [{ member_id: 'a', amount: 30 }, { person_id: 'b', amount: 10 }] } as Transaction;
const purchase = { id: 'p', workspace_id: 'w', description: 'Compra 124/3', total_amount: 124, installment_count: 3, purchase_date: '2026-09-10', credit_card_id: 'card', paid_by_member_id: 'a', splits: [{ member_id: 'a', amount: 62 }, { person_id: 'b', amount: 62, repaid_installments_count: 1, repaid_amount: 20.67 }] } as Purchase;
const installments = [41.34,41.33,41.33].map((amount, i) => ({ id: `i${i}`, purchase_id: 'p', installment_number: i+1, amount, due_date: `2026-${i+10}-28`, status: i===0?'paid':'pending', paid_amount: i===0?amount:0, created_at: '2026-09-10' })) as Installment[];

describe('Expense list read model and balance composition',()=>{
  it('includes each installment once, filters by due period and never counts the purchase total again',()=>{
    const original=JSON.stringify({tx,purchase,installments});
    const rows=expenseListRows('w',[tx],[purchase],installments);
    expect(rows).toHaveLength(4);
    expect(rows.reduce((sum,row)=>sum+Math.round(row.amount*100),0)).toBe(16400);
    const october=rows.filter((row)=>row.period_date.startsWith('2026-10'));
    expect(october).toHaveLength(1); expect(october[0]).toMatchObject({record_kind:'installment', amount:41.34, status:'paid', paid_amount:41.34, installment_number:1, installment_count:3, purchase_id:'p', transaction_date:'2026-09-10', credit_card_id:'card'});
    expect(JSON.stringify({tx,purchase,installments})).toBe(original);
  });
  it('excludes foreign workspaces and orphan installments and retains partial payment status',()=>{
    expect(expenseListRows('other',[tx],[purchase],installments)).toHaveLength(0);
    const rows=expenseListRows('w',[tx,{...tx,id:'income',type:'income'}],[purchase],[{...installments[0],id:'partial',status:'partially_paid',paid_amount:10},{...installments[1],purchase_id:'unknown'}]);
    expect(rows).toHaveLength(3);expect(rows.find((row)=>row.id==='partial')).toMatchObject({status:'partially_paid',paid_amount:10});
  });
  it('shows historical repayments and manual settlements separately while preserving the existing net debt',()=>{
    const members=[{id:'a',workspace_id:'w'}] as any; const people=[{id:'b',workspace_id:'w',name:'Pessoa B'}] as any;
    const manual=[{workspace_id:'w',from_person_id:'b',to_member_id:'a',amount:5}] as any;
    const result=calculateMemberNetBalances([tx],manual,members,'w',[purchase],people);
    expect(result.balances.find((b)=>b.participant_id==='b')).toMatchObject({total_share:72,repayments_sent:20.67,repayments_received:0,settlements_sent:5,settlements_received:0,net_balance:-46.33});
    expect(result.balances.find((b)=>b.participant_id==='a')).toMatchObject({total_paid:164,total_share:92,repayments_sent:0,repayments_received:20.67,settlements_sent:0,settlements_received:5,net_balance:46.33});
  });
});
