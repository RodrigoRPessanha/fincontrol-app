import { describe,it,expect } from 'vitest';
import { act } from 'react';
import { setupFinanceHarness } from '../test-utils/finance-provider-harness';
import { STORAGE_KEYS } from '../../context/finance-storage';
describe('A4 local domain probes',()=>{
 const harness=setupFinanceHarness();
 it('does not let local settlement bypass archived-person restrictions used by Cloud',async()=>{
  harness.storageMap.set(STORAGE_KEYS.recurring,'[]');const h=await harness.mountProvider();let member='',person='';
  await act(async()=>{h.getCtx().createWorkspace('A4 archive','expense_tracker');});await act(async()=>{member=h.getCtx().workspaceMembers[0].id;person=h.getCtx().addPerson('A4 Archive Person').id;h.getCtx().addTransaction({description:'A4 Archived Debt',amount:100,type:'expense',status:'pending',transaction_date:'2050-10-01',due_date:'2050-10-01',paid_by_member_id:member,split_type:'equal',splits:[{member_id:member,amount:50},{person_id:person,amount:50}]});h.getCtx().updatePerson(person,{archived:true});});
  let failure='';await act(async()=>{try{await h.getCtx().recordSettlementAsync({from_person_id:person,to_member_id:member,amount:20,settlement_date:'2050-10-01'});}catch(e:any){failure=e.message;}});
  console.log('A4_LOCAL_ARCHIVE',JSON.stringify({failure,settlements:h.getCtx().settlements.length}));expect(failure).toMatch(/arquiv/);
 });
 it('runs expense tracker locally without bank accounts or a balance',async()=>{
  harness.storageMap.set(STORAGE_KEYS.recurring,'[]');const h=await harness.mountProvider();let member='',person='',tx:any,purchase:any;
  await act(async()=>{h.getCtx().createWorkspace('A4 zero accounts','expense_tracker');});await act(async()=>{member=h.getCtx().workspaceMembers[0].id;person=h.getCtx().addPerson('A4 zero person').id;tx=h.getCtx().addTransaction({description:'A4 zero expense',amount:100,type:'expense',status:'pending',transaction_date:'2050-10-01',due_date:'2050-10-01',paid_by_member_id:member,split_type:'equal',splits:[{member_id:member,amount:50},{person_id:person,amount:50}]});await h.getCtx().recordPaymentAsync({transaction_id:tx.id,amount:30,payment_date:'2050-10-01'});await h.getCtx().recordSettlementAsync({from_person_id:person,to_member_id:member,amount:20,settlement_date:'2050-10-01'});const card=h.getCtx().addCreditCard({name:'A4 card',institution:'Fixture',color:'#000000',credit_limit:1000,closing_day:25,due_day:5,active:true});purchase=await h.getCtx().createInstallmentPurchaseAsync({description:'A4 zero purchase',total_amount:120,installment_count:3,purchase_date:'2050-10-01',credit_card_id:card.id});});const bill=h.getCtx().creditCardBills[0];await act(async()=>{await h.getCtx().payCreditCardBillAsync(bill.id,undefined,bill.total_amount,'2050-10-01');});
  expect(h.getCtx().accounts).toHaveLength(0);expect(h.getCtx().payments.every(p=>p.affects_balance===false&&!p.account_id)).toBe(true);expect(h.getCtx().installments.filter(i=>i.purchase_id===purchase.id)).toHaveLength(3);expect(h.getCtx().settlements).toHaveLength(1);console.log('A4_LOCAL_TRACKER',JSON.stringify({accounts:0,payments:h.getCtx().payments.length,settlements:1}));
 });
 it('recalculates a new equal rule and retains a person payer across later edits', async () => {
  const h = await harness.mountProvider(); let tx = '', person = '';
  await act(async () => { person = h.getCtx().addPerson('Recalculation Person').id;
   tx = h.getCtx().addTransaction({ description: 'New rule', amount: 100, type: 'expense', status: 'pending', transaction_date: '2050-10-01', due_date: '2050-10-01' }).id;
   h.getCtx().updateTransaction(tx, { split_type: 'equal' });
  });
  expect(h.getCtx().transactions.find(t => t.id === tx)?.splits?.reduce((sum, s) => sum + s.amount, 0)).toBe(100);
  await act(async () => { h.getCtx().updateTransaction(tx, { paid_by_member_id: null, paid_by_person_id: person }); });
  const changed = h.getCtx().transactions.find(t => t.id === tx)!;
  expect(changed.splits?.some(s => s.person_id === person)).toBe(true);
 });
 it('keeps deterministic cents when changing full_other to equal among three members', async () => {
  const h = await harness.mountProvider();
  await act(async () => { h.getCtx().createWorkspace('A4 cents'); h.getCtx().addWorkspaceMember('fixture-b@example.test', 'member'); h.getCtx().addWorkspaceMember('fixture-c@example.test', 'member'); });
  const [a, b, c] = h.getCtx().workspaceMembers;
  let tx = '';
  await act(async () => { tx = h.getCtx().addTransaction({ description: 'Three-person cents', amount: 100, type: 'expense', status: 'pending', paid_by_member_id: a.id, split_type: 'full_other', splits: [{ member_id: b.id, amount: 50 }, { member_id: c.id, amount: 50 }], transaction_date: '2050-10-01', due_date: '2050-10-01' }).id; h.getCtx().updateTransaction(tx, { split_type: 'equal' }); });
  expect(h.getCtx().transactions.find(t => t.id === tx)?.splits?.map(s => s.amount)).toEqual([33.34, 33.33, 33.33]);
 });
});