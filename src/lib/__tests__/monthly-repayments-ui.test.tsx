import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { setupFinanceHarness } from './test-utils/finance-provider-harness';
import * as Finance from '../context/finance-context';
import { MonthlyRepaymentModal } from '@/components/splits/MonthlyRepaymentModal';
import { MonthlySplitOverview } from '@/components/splits/MonthlySplitOverview';
import { purchaseDateFixture } from './test-utils/purchase-date-fixture';

function props(node: any): any { const key = Object.keys(node || {}).find(k => k.startsWith('__reactProps$')); return key ? node[key] : {}; }
function nodes(node: any, predicate: (n: any) => boolean): any[] { return [...(predicate(node) ? [node] : []), ...(node.childNodes || []).flatMap((child: any) => nodes(child,predicate))]; }
function text(node: any): string { return node.nodeValue || node.textContent || (node.childNodes || []).map(text).join(''); }
describe('Monthly repayment interface', () => {
  setupFinanceHarness(); const roots: any[] = []; let context: any; let update: any; let refresh: any; let close: any;
  beforeEach(() => { const state = purchaseDateFixture(); update=vi.fn().mockResolvedValue(undefined);refresh=vi.fn().mockResolvedValue(undefined);close=vi.fn(); context={activeWorkspace:{id:'w'},purchases:state.allPurchases,installments:state.allInstallments,isWorkspaceReadOnly:false,markMonthlyRepaymentsAsync:update,refreshData:refresh}; vi.spyOn(Finance,'useFinance').mockImplementation(() => context); });
  afterEach(async () => { await act(async () => roots.splice(0).forEach(r => r.unmount())); vi.restoreAllMocks(); });
  async function mount(element: React.ReactNode = <MonthlyRepaymentModal month="2050-03" participants={['b','a']} getName={String} onClose={close} />) { const container=document.createElement('div');const root=createRoot(container);roots.push(root);await act(async()=>root.render(element));return {container,root}; }
  const select=(c:any)=>nodes(c,n=>n.tagName==='SELECT')[0]; const form=(c:any)=>nodes(c,n=>n.tagName==='FORM')[0]; const check=(c:any)=>nodes(c,n=>props(n).type==='checkbox')[0];
  async function prepare(c:any) { await act(async()=>props(select(c)).onChange({target:{value:'b'}}));await act(async()=>props(check(c)).onChange({target:{checked:true}})); }
  it('shows an explicit preview, waits for the batch and blocks duplicate and unconfirmed submissions',async()=>{
    const {container}=await mount();await act(async()=>props(form(container)).onSubmit({preventDefault(){}}));expect(update).not.toHaveBeenCalled();
    await act(async()=>props(select(container)).onChange({target:{value:'b'}}));expect(text(container)).toContain('1 → 2');expect(text(container)).toContain('100,00');
    await act(async()=>props(form(container)).onSubmit({preventDefault(){}}));expect(update).not.toHaveBeenCalled();
    await act(async()=>props(check(container)).onChange({target:{checked:true}}));let release!:()=>void;update.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve;}));let pending!:Promise<void>;
    await act(async()=>{pending=props(form(container)).onSubmit({preventDefault(){}});await props(form(container)).onSubmit({preventDefault(){}});});expect(update).toHaveBeenCalledExactlyOnceWith('2050-03','b',[{purchase_id:'p',expected_version:3,previous_count:1,count:2}]);expect(close).not.toHaveBeenCalled();await act(async()=>{release();await pending;});expect(close).toHaveBeenCalledOnce();
  });
  it('reports remote and refresh failures, permits refresh retry and keeps future or payer shares out',async()=>{
    const {container}=await mount();await act(async()=>props(select(container)).onChange({target:{value:'a'}}));expect(text(container)).toContain('Nenhuma parcela pendente');await prepare(container);update.mockRejectedValueOnce(new Error('Conflict'));await act(async()=>props(form(container)).onSubmit({preventDefault(){}}));expect(text(container)).toContain('Conflict');expect(close).not.toHaveBeenCalled();
    const retry=()=>nodes(container,n=>props(n).children==='Atualizar dados e fechar')[0];refresh.mockRejectedValueOnce(new Error('Offline'));await act(async()=>props(retry()).onClick());expect(text(container)).toContain('Não foi possível atualizar');await act(async()=>props(retry()).onClick());expect(close).toHaveBeenCalledOnce();
  });
  it('blocks invalid calendars and hides the editor for viewers or foreign workspaces',async()=>{
    context.installments=context.installments.slice(0,2);const {container}=await mount();await act(async()=>props(select(container)).onChange({target:{value:'b'}}));expect(text(container)).toContain('Confira');await act(async()=>props(form(container)).onSubmit({preventDefault(){}}));expect(update).not.toHaveBeenCalled();context.isWorkspaceReadOnly=true;expect(text((await mount()).container)).toBe('');
    context.isWorkspaceReadOnly=false;const {container:c,root}=await mount();context.activeWorkspace={id:'other'};await act(async()=>root.render(<MonthlyRepaymentModal month="2050-03" participants={['b']} getName={String} onClose={close}/>));expect(text(c)).toBe('');
  });
  it('supports cancel, Escape and keyboard focus containment',async()=>{
    const {container}=await mount();const dialog=nodes(container,n=>props(n).role==='dialog')[0];await act(async()=>props(dialog).onKeyDown({key:'Escape'}));expect(close).toHaveBeenCalledOnce();
    await act(async()=>props(nodes(container,n=>props(n).children==='Cancelar')[0]).onClick());expect(close).toHaveBeenCalledTimes(2);
    const first={focus:vi.fn()},last={focus:vi.fn()};dialog.querySelectorAll=()=>[first,last];const preventDefault=vi.fn();(document as any).activeElement=first;await act(async()=>props(dialog).onKeyDown({key:'Tab',currentTarget:dialog,shiftKey:true,preventDefault}));expect(last.focus).toHaveBeenCalled();(document as any).activeElement=last;await act(async()=>props(dialog).onKeyDown({key:'Tab',currentTarget:dialog,shiftKey:false,preventDefault}));expect(first.focus).toHaveBeenCalled();
  });
  it.each([false,true])('does not close an unmounted pending editor (reject=%s)',async reject=>{
    const {container,root}=await mount();await prepare(container);let finish!:()=>void;update.mockImplementationOnce(()=>new Promise<void>((resolve,fail)=>{finish=()=>reject?fail('Offline'):resolve();}));let pending!:Promise<void>;await act(async()=>{pending=props(form(container)).onSubmit({preventDefault(){}});});await act(async()=>root.unmount());roots.splice(roots.indexOf(root),1);await act(async()=>{finish();await pending;});expect(close).not.toHaveBeenCalled();
  });
  it('handles legacy zero counts and preserves other participants in the preview, including failed save recovery',async()=>{
    context.purchases=context.purchases.map((p:any)=>({...p,splits:[p.splits[0],{person_id:'b',amount:300},{person_id:'c',amount:0}]}));
    const {container}=await mount();await prepare(container);expect(text(container)).toContain('0 → 2');expect(text(container)).toContain('200,00');update.mockRejectedValueOnce('Offline');await act(async()=>props(form(container)).onSubmit({preventDefault(){}}));expect(text(container)).toContain('Não foi possível registrar');
  });
  it.each([false,true])('does not close after unmount during refresh (reject=%s)',async reject=>{
    const {container,root}=await mount();await prepare(container);update.mockRejectedValueOnce(new Error('Conflict'));await act(async()=>props(form(container)).onSubmit({preventDefault(){}}));let finish!:()=>void;refresh.mockImplementationOnce(()=>new Promise<void>((resolve,fail)=>{finish=()=>reject?fail(new Error('Offline')):resolve();}));let pending!:Promise<void>;await act(async()=>{pending=props(nodes(container,n=>props(n).children==='Atualizar dados e fechar')[0]).onClick();});await act(async()=>root.unmount());roots.splice(roots.indexOf(root),1);await act(async()=>{finish();await pending;});expect(close).not.toHaveBeenCalled();
  });
  it('supports a member repaying an external payer and zero-valued custom shares',async()=>{
    context.purchases=context.purchases.map((p:any)=>({...p,paid_by_member_id:null,paid_by_person_id:'b',splits:[{person_id:'b',amount:300},{member_id:'a',amount:300},{person_id:'c',amount:0}]}));
    const {container}=await mount(<MonthlyRepaymentModal month="2050-03" participants={['a','c']} getName={String} onClose={close}/>);
    await act(async()=>props(select(container)).onChange({target:{value:'a'}}));expect(text(container)).toContain('200,00');
    await act(async()=>props(select(container)).onChange({target:{value:'c'}}));expect(text(container)).toContain('0 → 2');expect(text(container)).toContain('0,00');
  });
  it('renders the arithmetic difference separately from who actually owes whom',async()=>{
    const change=vi.fn(),open=vi.fn();const {container}=await mount(<MonthlySplitOverview month="2026-10" onMonthChange={change} items={[{id:'x',description:'X',amount:645.53,date:'2026-10-01',splits:[],isPurchase:false,installmentCount:1}]} responsibilities={new Map([['a',301.47],['b',344.06]])} warnings={[]} getName={String} debts={[{from_member_id:'b',to_member_id:'a',amount:42.59}]} onMarkRepayments={open}/>);
    expect(text(container)).toContain('42,59');expect(text(container)).toContain('deve pagar');await act(async()=>props(nodes(container,n=>props(n).id==='split-month')[0]).onChange({target:{value:'2026-11'}}));expect(change).toHaveBeenCalledWith('2026-11');await act(async()=>props(nodes(container,n=>props(n).children==='Marcar parcelas repassadas até este mês')[0]).onClick());expect(open).toHaveBeenCalledOnce();
  });
});
