import { describe,it,expect } from 'vitest';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import { setupFinanceHarness } from '../test-utils/finance-provider-harness';
import { STORAGE_KEYS } from '../../context/finance-storage';
import {FinanceProvider,useFinance} from '../../context/finance-context';
import BudgetsPage from '../../../app/(dashboard)/budgets/page';
import {format} from 'date-fns';
const props=(n:any):any=>{const k=Object.keys(n).find(k=>k.startsWith('__reactProps$'));return k?n[k]:{};};
const nodes=(n:any):any[]=>[n,...(n.childNodes??[]).flatMap(nodes)];
const text=(n:any):string=>n.nodeType===3?n.nodeValue??'':n.textContent||(n.childNodes??[]).map(text).join('');
describe('A5 revalidation nested budget',()=>{
 const harness=setupFinanceHarness();
 it.each([0,100])('includes a legacy child ceiling without duplicating a parent ceiling of %s',async(parentLimit)=>{
  harness.storageMap.set(STORAGE_KEYS.recurring,'[]');const h=await harness.mountProvider();const parent=h.getCtx().categories.find(c=>c.subcategories?.length)!;const child=parent.subcategories?.[0];expect(child).toBeDefined();
  const date=format(new Date(),'yyyy-MM-dd');await act(async()=>{h.getCtx().setBudget(child!.id,50);if(parentLimit)h.getCtx().setBudget(parent.id,parentLimit);h.getCtx().addTransaction({description:'Legacy child budget revalidation',category_id:child!.id,amount:100,type:'expense',status:'pending',transaction_date:date,due_date:date});});
  await act(async()=>h.root.unmount());
  const container=(globalThis as any).document.createElement('div');const root=createRoot(container);let ctx:any;
  function Capture(){ctx=useFinance();return <BudgetsPage/>;}
  await act(async()=>root.render(<FinanceProvider><Capture/></FinanceProvider>));for(let i=0;i<50&&!ctx?.isLoaded;i++)await act(async()=>{await new Promise(r=>setTimeout(r,10));});
  let planned=nodes(container).find(n=>n.tagName==='SPAN'&&text(n)==='Total Planejado');while(planned&&!props(planned).className?.includes('rounded-3xl'))planned=planned.parentNode;
  const childCard=nodes(container).find(n=>n.tagName==='H3'&&text(n)===child!.name);
  const actual=text(planned);const stored=ctx.budgets.find((b:any)=>b.category_id===child!.id)?.planned_amount;
  let childBudgetCard=childCard;while(childBudgetCard&&!props(childBudgetCard).className?.includes('flex flex-col justify-between'))childBudgetCard=childBudgetCard.parentNode;
  expect(text(childBudgetCard)).toContain('100,00');expect(text(childBudgetCard)).toContain('Estourou em');
  console.log('A5R_LEGACY_CHILD',JSON.stringify({stored,summary:actual,childCard:!!childCard}));await act(async()=>root.unmount());
  expect(stored).toBe(50);expect(actual).toContain(parentLimit?'100,00':'50,00');expect(childCard).toBeDefined();
 });
});