import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
import {setupFinanceHarness} from './test-utils/finance-provider-harness';
import {purchaseDateFixture} from './test-utils/purchase-date-fixture';
import * as Finance from '../context/finance-context';
import {EditPurchaseDateModal} from '@/components/installments/EditPurchaseDateModal';
import InstallmentsPage from '@/app/(dashboard)/installments/page';

function props(n:any):any{const key=Object.keys(n||{}).find((k)=>k.startsWith('__reactProps$'));return key?n[key]:{};}
function nodes(n:any,p:(n:any)=>boolean):any[]{return [...(p(n)?[n]:[]),...(n.childNodes||[]).flatMap((c:any)=>nodes(c,p))];}
function text(n:any):string{return n.nodeValue||n.textContent||(n.childNodes||[]).map(text).join('');}

describe('Purchase date correction interface',()=>{
  setupFinanceHarness(); const roots:any[]=[];let context:any;let state:ReturnType<typeof purchaseDateFixture>;let update:any;let close:any;let refresh:any;
  beforeEach(()=>{state=purchaseDateFixture();update=vi.fn().mockResolvedValue(undefined);close=vi.fn();refresh=vi.fn().mockResolvedValue(undefined);
  context={activeWorkspace:{id:'w'},isWorkspaceReadOnly:false,purchases:state.allPurchases,installments:state.allInstallments,allWorkspaceCreditCards:state.allCreditCards,creditCardBills:state.allCreditCardBills,payments:state.allPayments,transactions:state.allTransactions,reschedulePurchaseDateAsync:update,refreshData:refresh,allWorkspaceCategories:[],categories:[],creditCards:state.allCreditCards,paymentMethods:[],accounts:state.allAccounts,workspaceMembers:[],people:[]};vi.spyOn(Finance,'useFinance').mockImplementation(()=>context);});
  afterEach(async()=>{await act(async()=>roots.splice(0).forEach((r)=>r.unmount()));vi.restoreAllMocks();});
  async function mount(element?:React.ReactNode){const container=document.createElement('div');const root=createRoot(container);roots.push(root);await act(async()=>root.render(element||<EditPurchaseDateModal purchase={state.allPurchases[0]} onClose={close}/>));return {container,root};}
  const dateInput=(c:any)=>nodes(c,(n)=>props(n).id==='purchase-date-input')[0];const form=(c:any)=>nodes(c,(n)=>n.tagName==='FORM')[0];
  it('previews paid imported installments and awaits one save without losing the opening version',async()=>{
    let release!:()=>void;update.mockImplementationOnce(()=>new Promise<void>((resolve)=>{release=resolve;}));const {container}=await mount();
    await act(async()=>props(dateInput(container)).onChange({target:{value:'2049-12-10'}}));
    expect(text(container)).toContain('10/02/2050');expect(text(container)).toContain('10/01/2050');expect(text(container)).toContain('datas dos pagamentos e repasses serão preservados');
    let pending!:Promise<void>;await act(async()=>{pending=props(form(container)).onSubmit({preventDefault(){}});await props(form(container)).onSubmit({preventDefault(){}});});
    expect(update).toHaveBeenCalledOnce();expect(update).toHaveBeenCalledWith('p',expect.objectContaining({purchase_date:'2049-12-10',expected_version:3,expected_schedule:expect.arrayContaining([expect.objectContaining({installment_id:'i1',paid_amount:200,status:'paid'})])}));expect(close).not.toHaveBeenCalled();
    await act(async()=>{release();await pending;});expect(close).toHaveBeenCalledOnce();
  });
  it('blocks a move involving a recorded bill payment while still showing the proposed dates',async()=>{
    context.payments=[{id:'pay',workspace_id:'w',credit_card_bill_id:'bill1'}];const {container}=await mount();
    await act(async()=>props(dateInput(container)).onChange({target:{value:'2049-12-10'}}));
    expect(text(container)).toContain('baixa registrada');expect(text(container)).toContain('10/01/2050');
    const save=nodes(container,(n)=>props(n).children==='Confirmar novos vencimentos')[0];expect(props(save).disabled).toBe(true);
    await act(async()=>props(form(container)).onSubmit({preventDefault(){}}));expect(update).not.toHaveBeenCalled();
  });
  it('keeps a conflicting edit open and lets the user recover by refreshing',async()=>{
    update.mockRejectedValueOnce(new Error('Compra alterada'));const {container}=await mount();await act(async()=>props(dateInput(container)).onChange({target:{value:'2049-12-10'}}));
    await act(async()=>props(form(container)).onSubmit({preventDefault(){}}));expect(text(container)).toContain('Compra alterada');expect(close).not.toHaveBeenCalled();
    const button=()=>nodes(container,(n)=>props(n).children==='Atualizar dados e fechar edição')[0];refresh.mockRejectedValueOnce(new Error('Offline'));
    await act(async()=>props(button()).onClick());expect(text(container)).toContain('Não foi possível atualizar');await act(async()=>props(button()).onClick());expect(close).toHaveBeenCalledOnce();
  });
  it('does not save an unchanged or invalid date and hides editors for viewers or foreign workspaces',async()=>{
    const {container}=await mount();await act(async()=>props(form(container)).onSubmit({preventDefault(){}}));expect(update).not.toHaveBeenCalled();
    await act(async()=>props(dateInput(container)).onChange({target:{value:''}}));expect(text(container)).toContain('data de compra válida');
    context.isWorkspaceReadOnly=true;expect(text((await mount()).container)).toBe('');context.isWorkspaceReadOnly=false;context.activeWorkspace={id:'foreign'};expect(text((await mount()).container)).toBe('');
  });
  it('opens correction from a purchase card or its details without two dialogs remaining open',async()=>{
    const {container}=await mount(<InstallmentsPage/>);const direct=nodes(container,(n)=>props(n)['aria-label']==='Corrigir data de 600/3 imported')[0];const stop=vi.fn();
    await act(async()=>props(direct).onClick({stopPropagation:stop}));expect(stop).toHaveBeenCalledOnce();expect(text(container)).toContain('Corrigir data da compra');
    await act(async()=>props(nodes(container,(n)=>props(n).children==='Cancelar')[0]).onClick());
    const card=nodes(container,(n)=>n.tagName==='DIV'&&typeof props(n).onClick==='function')[0];await act(async()=>props(card).onClick());
    expect(text(container)).toContain('Detalhamento das Parcelas');const edit=nodes(container,(n)=>n.tagName==='BUTTON'&&props(n).children==='Corrigir data da compra').at(-1);
    await act(async()=>props(edit).onClick());expect(text(container)).not.toContain('Detalhamento das Parcelas');expect(text(container)).toContain('Prévia dos vencimentos');
  });
});
