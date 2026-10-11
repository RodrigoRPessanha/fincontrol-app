import { describe,it,expect,vi } from 'vitest';
import { purchaseDateFixture } from './test-utils/purchase-date-fixture';
import { purchaseDateSchedule,reschedulePurchaseState,assertPurchaseDateMove,PurchaseDateChange } from '../financial-engine/purchase-dates';

function request(state= purchaseDateFixture(),date='2049-12-10'):PurchaseDateChange{return {purchase_date:date,expected_version:state.allPurchases[0].repayment_version||0,expected_schedule:purchaseDateSchedule(state,state.allPurchases[0],date)};}
describe('Purchase date rescheduling',()=>{
  it('moves imported paid installments and repayments without changing payments, amounts, account balances or identities',()=>{
    const state=purchaseDateFixture();const before=JSON.stringify(state);const makeId=vi.fn().mockReturnValue('new-bill');
    const updated=reschedulePurchaseState(state,'p',request(state),makeId,'2049-12-05T10:00:00Z');
    expect(state.allPurchases[0].purchase_date).toBe('2050-01-10');expect(JSON.stringify(state)).toBe(before);
    expect(updated.allPurchases[0]).toMatchObject({purchase_date:'2049-12-10',repayment_version:4,splits:state.allPurchases[0].splits});
    expect(updated.allInstallments.map((i)=>i.id)).toEqual(['i1','i2','i3']);
    expect(updated.allInstallments.map((i)=>i.due_date)).toEqual(['2050-01-10','2050-02-10','2050-03-10']);
    expect(updated.allInstallments[0]).toMatchObject({status:'paid',paid_amount:200,paid_at:'2049-12-01',credit_card_bill_id:'new-bill'});
    expect(updated.allCreditCardBills.reduce((sum,b)=>sum+b.total_amount,0)).toBe(600);
    expect(updated.allCreditCardBills.reduce((sum,b)=>sum+b.paid_amount,0)).toBe(200);
    expect(updated.allCreditCardBills.find((b)=>b.id==='bill3')).toMatchObject({total_amount:0,paid_amount:0,status:'open'});
    expect(updated.allCreditCardBills.find((b)=>b.id==='new-bill')).toMatchObject({status:'paid',paid_at:'2049-12-01'});
    expect(updated.allAccounts).toBe(state.allAccounts);expect(updated.allPayments).toBe(state.allPayments);expect(updated.allSettlements).toBe(state.allSettlements);
  });
  it('preserves real non-card payment history while clamping month-end dates in a leap year',()=>{
    const state=purchaseDateFixture();state.allPurchases[0].credit_card_id=null;state.allCreditCardBills=[];
    state.allInstallments=state.allInstallments.map((i)=>({...i,credit_card_bill_id:null}));
    state.allPayments=[{id:'pay',workspace_id:'w',installment_id:'i1',amount:200,payment_date:'2049-12-01',created_at:'2049-12-01'}];
    const makeId=vi.fn();const updated=reschedulePurchaseState(state,'p',request(state,'2052-01-31'),makeId,'2052-01-01T00:00:00Z');
    expect(updated.allInstallments.map((i)=>i.due_date)).toEqual(['2052-01-31','2052-02-29','2052-03-31']);expect(updated.allPayments).toBe(state.allPayments);expect(makeId).not.toHaveBeenCalled();
  });
  it('uses canonical closing-day cutoffs and honors dates of an existing target bill',()=>{
    const state=purchaseDateFixture();expect(request(state,'2050-01-20').expected_schedule[0].due_date).toBe('2050-03-10');
    expect(request(state,'2050-01-19').expected_schedule[0].due_date).toBe('2050-02-10');
    state.allCreditCardBills[0].due_date='2050-02-12';expect(request(state,'2050-01-19').expected_schedule[0].due_date).toBe('2050-02-12');
  });
  it('rejects missing/foreign purchases, stale versions and changed installment previews',()=>{
    const state=purchaseDateFixture();expect(()=>reschedulePurchaseState(state,'missing',request(state),String,'2049-12-01')).toThrow(/workspace/);
    expect(()=>reschedulePurchaseState({...state,activeWorkspaceId:'foreign'},'p',request(state),String,'2049-12-01')).toThrow(/workspace/);
    expect(()=>reschedulePurchaseState(state,'p',{...request(state),expected_version:2},String,'2049-12-01')).toThrow(/alterada/);
    const change=request(state);state.allInstallments[0].paid_at='2049-12-02';state.allInstallments[0].due_date='2050-02-11';
    expect(()=>reschedulePurchaseState(state,'p',change,String,'2049-12-01')).toThrow(/prévia/);
  });
  it.each(['','2050-1-1','2050-02-30'])('rejects invalid date %s',(date)=>{expect(()=>request(purchaseDateFixture(),date)).toThrow();});
  it.each(['card','bill','missing-bill','count','duplicate','cancelled','paid','total'])('rejects inconsistent calendar inputs (%s)',(kind)=>{
    const state=purchaseDateFixture();if(kind==='card')state.allCreditCards=[];
    if(kind==='bill')state.allCreditCardBills[0].workspace_id='foreign';if(kind==='missing-bill')state.allInstallments[0].credit_card_bill_id=null;
    if(kind==='count')state.allInstallments.pop();if(kind==='duplicate')state.allInstallments[1].installment_number=1;
    if(kind==='cancelled')state.allInstallments[1].status='cancelled';if(kind==='paid')state.allInstallments[0].paid_amount=0;
    if(kind==='total')state.allInstallments[1].amount=201;
    expect(()=>request(state)).toThrow();
  });
  it.each(['bill','installment','transaction'])('blocks moving bills with recorded payments through %s',(kind)=>{
    const state=purchaseDateFixture();state.allTransactions=[{id:'tx',workspace_id:'w',credit_card_bill_id:'bill1'} as any];
    state.allPayments=[{id:'pay',workspace_id:'w',credit_card_bill_id:kind==='bill'?'bill1':undefined,installment_id:kind==='installment'?'i1':undefined,transaction_id:kind==='transaction'?'tx':undefined} as any];
    expect(()=>reschedulePurchaseState(state,'p',request(state),String,'2049-12-01')).toThrow(/baixa registrada/);
    const sameCycle=request(state,'2050-01-11');expect(()=>assertPurchaseDateMove(state,state.allPurchases[0],sameCycle.expected_schedule)).not.toThrow();
  });
  it('blocks cancelled target bills and leaves the state intact if reconciliation is inconsistent',()=>{
    const state=purchaseDateFixture();state.allCreditCardBills[0].status='cancelled';expect(()=>reschedulePurchaseState(state,'p',request(state),String,'2049-12-01')).toThrow(/cancelada/);
    state.allCreditCardBills[0].status='paid';state.allCreditCardBills[2].total_amount=0;const before=JSON.stringify(state);
    expect(()=>reschedulePurchaseState(state,'p',request(state),()=> 'new','2049-12-01')).toThrow(/inconsistentes/);expect(JSON.stringify(state)).toBe(before);
  });
  it('updates only due states for open installments, preserves partial payments and handles existing imported balances',()=>{
    const state=purchaseDateFixture();state.allInstallments[1].status='partially_paid';state.allInstallments[1].paid_amount=20;state.allCreditCardBills[1].paid_amount=20;
    const result=reschedulePurchaseState(state,'p',request(state,'2040-01-01'),()=>`new-${Math.random()}`,'2049-12-05T00:00:00Z');
    expect(result.allInstallments[0].status).toBe('paid');expect(result.allInstallments[1].status).toBe('partially_paid');expect(result.allInstallments[2].status).toBe('overdue');
    expect(result.allCreditCardBills.some((b)=>b.status==='partially_paid')).toBe(true);expect(result.allCreditCardBills.some((b)=>b.status==='overdue')).toBe(true);
  });
});
