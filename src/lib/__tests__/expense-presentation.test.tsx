import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {describe,it,expect,vi,afterEach,beforeEach} from 'vitest';
import {setupFinanceHarness} from './test-utils/finance-provider-harness';
import * as Finance from '../context/finance-context';
import TransactionsPage from '@/app/(dashboard)/transactions/page';
import {MemberBalances} from '@/components/splits/MemberBalances';
import {calculateMemberNetBalances} from '../financial-engine/splits';

vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams()}));
vi.mock('next/link',()=>({default:({children,...props}:any)=><a {...props}>{children}</a>}));
function props(n:any):any{const k=Object.keys(n||{}).find((k)=>k.startsWith('__reactProps$'));return k?n[k]:{};}
function nodes(n:any,p:(n:any)=>boolean):any[]{return [...(p(n)?[n]:[]),...(n.childNodes||[]).flatMap((c:any)=>nodes(c,p))];}
function text(n:any):string{return n.nodeValue||n.textContent||(n.childNodes||[]).map(text).join('');}
const tx={id:'t',workspace_id:'w',description:'Avulsa setembro',amount:40,type:'expense',transaction_date:'2026-09-29',due_date:'2026-09-29',status:'pending',paid_by_member_id:'a',splits:[{member_id:'a',amount:30},{person_id:'b',amount:10}]};
const purchase={id:'p',workspace_id:'w',description:'Compra parcelada',total_amount:124,installment_count:3,purchase_date:'2026-09-10',credit_card_id:'card',paid_by_member_id:'a',splits:[{member_id:'a',amount:62},{person_id:'b',amount:62,repaid_installments_count:1,repaid_amount:20.67}]};
const installments=[41.34,41.33,41.33].map((amount,i)=>({id:`i${i}`,purchase_id:'p',installment_number:i+1,amount,due_date:`2026-${i+10}-28`,status:i===0?'paid':'pending',paid_amount:i===0?amount:0,created_at:'2026-09-10'}));
describe('Expense consultation and balance presentation',()=>{
 setupFinanceHarness();const roots:any[]=[];let context:any;
 beforeEach(()=>{context={isLoaded:true,isWorkspaceReadOnly:false,activeWorkspace:{id:'w',tracking_mode:'expense_tracker'},transactions:[tx],purchases:[purchase],installments,allWorkspaceCategories:[],allWorkspacePaymentMethods:[],allWorkspaceAccounts:[],allWorkspaceCreditCards:[{id:'card',name:'Cartão QA'}],categories:[],paymentMethods:[],accounts:[],creditCards:[],workspaceMembers:[],people:[],deleteTransaction:vi.fn(),duplicateTransaction:vi.fn()};vi.spyOn(Finance,'useFinance').mockImplementation(()=>context);});
 afterEach(async()=>{await act(async()=>roots.splice(0).forEach((r)=>r.unmount()));vi.restoreAllMocks();});
 async function mount(element:React.ReactNode){const container=document.createElement('div');const root=createRoot(container);roots.push(root);await act(async()=>root.render(element));return {container,root};}
 it('lists the paid installment in its due month and never exposes transaction mutation actions for it',async()=>{
  const {container}=await mount(<TransactionsPage/>);const month=nodes(container,(n)=>props(n).id==='transaction-list-month')[0];
  await act(async()=>props(month).onChange({target:{value:'2026-10'}}));
  expect(text(container)).toContain('Parcela 1/3');expect(text(container)).toContain('41,34');expect(text(container)).toContain('Cartão QA');expect(text(container)).not.toContain('Avulsa setembro');
  expect(nodes(container,(n)=>props(n)['aria-label']?.startsWith('Editar '))).toHaveLength(0);
  expect(nodes(container,(n)=>props(n).title==='Duplicar Transação'||props(n).title==='Excluir Transação')).toHaveLength(0);
  expect(nodes(container,(n)=>n.tagName==='A'&&props(n).href==='/installments').length).toBeGreaterThan(0);
  const all=nodes(container,(n)=>n.tagName==='BUTTON'&&props(n).children==='Todos os meses')[0];await act(async()=>props(all).onClick());
  expect(text(container)).toContain('Avulsa setembro');expect(text(container)).toContain('Parcela 3/3');expect(text(container)).toContain('164,00');
  expect(context.deleteTransaction).not.toHaveBeenCalled();expect(context.duplicateTransaction).not.toHaveBeenCalled();
 });
 it('keeps a chosen status filter and offers reset from an empty period',async()=>{
  const {container}=await mount(<TransactionsPage/>);const month=nodes(container,(n)=>props(n).id==='transaction-list-month')[0];
  await act(async()=>props(month).onChange({target:{value:'2026-10'}}));
  const option=nodes(container,(n)=>n.tagName==='OPTION'&&props(n).value==='paid')[0];
  await act(async()=>{props(option.parentNode).onChange({target:{value:'paid'}});await new Promise((resolve)=>setTimeout(resolve,5));});
  expect(props(option.parentNode).value).toBe('paid');
  await act(async()=>props(month).onChange({target:{value:'2027-01'}}));expect(text(container)).toContain('Nenhum registro encontrado neste período');
  const reset=nodes(container,(n)=>props(n).children==='Limpar filtros e ver todos os registros')[0];await act(async()=>props(reset).onClick());
  expect(text(container)).toContain('Avulsa setembro');expect(props(option.parentNode).value).toBe('all');
 });
 it('explains the real balance with repayments and purchase counts rather than implying all expenses were paid',async()=>{
  const result=calculateMemberNetBalances([tx] as any,[],[{id:'a',workspace_id:'w'}] as any,'w',[purchase] as any,[{id:'b',workspace_id:'w',name:'Pessoa B'}] as any);
  const {container}=await mount(<MemberBalances balances={result.balances} currentMembers={[]} getMemberName={String} purchases={[purchase] as any}/>);
  expect(text(container)).toContain('Despesas atribuídas:');expect(text(container)).not.toContain('Total pago nos registros');
  expect(text(container)).toContain('Repasses enviados:');expect(text(container)).toContain('Repasses recebidos:');expect(text(container)).toContain('20,67');expect(text(container)).toContain('1 de 3 parcelas repassadas');expect(text(container)).toContain('51,33');expect(text(container)).toContain('não são o total quitado');
 });
});
