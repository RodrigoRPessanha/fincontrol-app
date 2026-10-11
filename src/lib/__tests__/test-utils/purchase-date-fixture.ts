import { FinanceState } from '../../context/finance-state';

export function purchaseDateFixture(): FinanceState {
  const state = { activeWorkspaceId:'w',allWorkspaces:[],allWorkspaceMembers:[],allAccounts:[{id:'account',workspace_id:'w',current_balance:1000}],allPaymentMethods:[],allCategories:[],allTransactions:[],allPayments:[],allTransfers:[],allRecurring:[],allBudgets:[],allGoals:[],allSettlements:[],allPeople:[],allCreditCards:[{id:'card',workspace_id:'w',closing_day:20,due_day:10,active:true}],allCreditCardBills:[],allPurchases:[],allInstallments:[] } as unknown as FinanceState;
  state.allPurchases=[{id:'p',workspace_id:'w',description:'600/3 imported',total_amount:600,installment_count:3,purchase_date:'2050-01-10',credit_card_id:'card',repayment_version:3,paid_by_member_id:'a',split_type:'equal',splits:[{member_id:'a',amount:300},{person_id:'b',amount:300,repaid_installments_count:1,repaid_amount:100}]} as any];
  state.allCreditCardBills=[1,2,3].map((n)=>({id:`bill${n}`,workspace_id:'w',credit_card_id:'card',reference_month:`2050-0${n}`,closing_date:`2050-0${n}-20`,due_date:`2050-0${n+1}-10`,total_amount:200,paid_amount:n===1?200:0,status:n===1?'paid':'open',paid_at:n===1?'2049-12-01':null,created_at:'2049-12-01'} as any));
  state.allInstallments=[1,2,3].map((n)=>({id:`i${n}`,purchase_id:'p',installment_number:n,amount:200,due_date:`2050-0${n+1}-10`,credit_card_bill_id:`bill${n}`,status:n===1?'paid':'pending',paid_amount:n===1?200:0,paid_at:n===1?'2049-12-01':null,created_at:'2049-12-01'}));
  return state;
}
