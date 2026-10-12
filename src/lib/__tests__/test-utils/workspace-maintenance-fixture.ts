import { purchaseDateFixture } from './purchase-date-fixture';
import type { FinanceState } from '../../context/finance-state';

export function workspaceMaintenanceFixture(): FinanceState {
  const state = purchaseDateFixture();
  state.allWorkspaces = [{id:'w',name:'Meu Workspace',owner_id:'usr-1',tracking_mode:'full',currency:'BRL',created_at:'2050-01-01'}, {id:'other',name:'Outro meu',owner_id:'usr-1',tracking_mode:'expense_tracker',currency:'BRL',created_at:'2050-01-01'}, {id:'foreign',name:'Terceiro',owner_id:'usr-2',tracking_mode:'full',currency:'BRL',created_at:'2050-01-01'}];
  state.allWorkspaceMembers = [{id:'a',workspace_id:'w',user_id:'usr-1',role:'owner',created_at:'2050-01-01'}, {id:'other-member',workspace_id:'other',user_id:'usr-1',role:'owner',created_at:'2050-01-01'}];
  state.allAccounts = [{id:'account',workspace_id:'w',name:'Conta',type:'checking',institution:'QA',initial_balance:1000,current_balance:700,color:'#000000',active:true,created_at:'2050-01-01'}, {id:'target-second',workspace_id:'w',name:'Segunda',type:'checking',institution:'QA',initial_balance:100,current_balance:150,color:'#000000',active:true,created_at:'2050-01-01'}, {id:'other-account',workspace_id:'foreign',name:'Outra conta',type:'checking',institution:'QA',initial_balance:50,current_balance:40,color:'#000000',active:true,created_at:'2050-01-01'}];
  state.allPeople = [{id:'b',workspace_id:'w',name:'Pessoa',archived:true,created_at:'2050-01-01'}];
  state.allCreditCards = [{id:'card',workspace_id:'w',name:'Cartão',institution:'QA',credit_limit:1000,closing_day:20,due_day:10,active:true,color:'#000000',created_at:'2050-01-01'}];
  state.allPaymentMethods = [{id:'pm',workspace_id:'w',name:'Pix',type:'pix',active:true,created_at:'2050-01-01'}];
  state.allCategories = [{id:'cat',workspace_id:'w',name:'Categoria',type:'expense',icon:'tag',color:'#000000',active:true,created_at:'2050-01-01'}];
  state.allTransactions = [{id:'tx',workspace_id:'w',description:'Teste',amount:10,type:'expense',status:'pending',transaction_date:'2050-01-10',due_date:'2050-01-10',created_at:'2050-01-01'}, {id:'foreign-tx',workspace_id:'foreign',description:'Outra',amount:20,type:'expense',status:'pending',transaction_date:'2050-01-10',due_date:'2050-01-10',created_at:'2050-01-01'}];
  state.allRecurring = [{id:'rec',workspace_id:'w',description:'Recorrência',amount:10,type:'expense',frequency:'monthly',interval:1,start_date:'2050-01-01',next_occurrence:'2050-02-01',active:true,auto_create:false,created_at:'2050-01-01'} as any];
  state.allBudgets = [{id:'budget',workspace_id:'w',category_id:'cat',month:1,year:2050,planned_amount:100,created_at:'2050-01-01'} as any];
  state.allGoals = [{id:'goal',workspace_id:'w',name:'Meta',status:'in_progress',icon:'flag',target_amount:100,current_amount:50,color:'#000000',created_at:'2050-01-01'}];
  state.allPayments = [{id:'pay',workspace_id:'w',installment_id:'i1',account_id:'account',amount:200,payment_date:'2049-12-01',affects_balance:true,created_at:'2050-01-01'}];
  state.allTransfers = [{id:'transfer',workspace_id:'w',from_account_id:'account',to_account_id:'target-second',amount:10,transfer_date:'2050-01-01',created_at:'2050-01-01'} as any];
  state.allSettlements = [{id:'settlement',workspace_id:'w',from_person_id:'b',to_member_id:'a',amount:10,settlement_date:'2050-01-01',created_at:'2050-01-01'}];
  return state;
}
