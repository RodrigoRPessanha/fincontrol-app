import { loadCloudEnvironment, getStagingServiceRoleKey } from '../../../../scripts/cloud-test-safety.mjs';
import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { useFinance } from '../../context/finance-context';
import { AuthContext } from '../../context/auth-context';
import { SupabaseFinanceRepository } from '../../repositories/supabase-finance-repository';
import { setupFinanceHarness } from '../test-utils/finance-provider-harness';
import BudgetsPage from '../../../app/(dashboard)/budgets/page';
import ReportsPage from '../../../app/(dashboard)/reports/page';
import { calculateDashboardSummary, calculateFutureCommitments } from '../../financial-engine';
import { format } from 'date-fns';
import { QuickAddModal } from '../../../components/transactions/QuickAddModal';
import { calculateMemberNetBalances } from '../../financial-engine';
import { PaymentModal } from '../../../components/transactions/PaymentModal';

import { FinanceSessionHost } from '../../../components/layout/FinanceSessionHost';
const route = vi.hoisted(() => ({ path: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.path }));

const observations: Record<string, unknown> = {};
function observe(name: string, value: unknown) { observations[name] = value; }
function decorate(base: any, methods: Record<string, any>) {
  return new Proxy(base, { get(target, key) { if (key in methods) return methods[key as string]; const value = target[key]; return typeof value === 'function' ? value.bind(target) : value; } });
}
function gate() { let release!: () => void; const wait = new Promise<void>((r) => { release = r; }); return { wait, release }; }

describe.runIf(process.env.TEST_CLOUD === 'true')('Agent 5: recurrence and analytics probes', { timeout: 60000 }, () => {
  setupFinanceHarness();
  let admin: any; let repo1: any; let repo2: any;
  const users: string[] = []; const roots: any[] = []; let workspace = ''; let account = ''; let email = '';
  beforeAll(async () => {
    const config = loadCloudEnvironment();
    const serviceRoleKey = getStagingServiceRoleKey(config);
    const supabaseUrl = config.NEXT_PUBLIC_SUPABASE_URL!;
    const publicKey = (config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || config.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
    admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const repositories = [];
    for (let i = 0; i < 2; i++) {
      const address = `test.agent3.${Date.now()}.${i}@fincontrol.app`; const password = `Fixture!${crypto.randomUUID()}A`;
      const created = await admin.auth.admin.createUser({ email: address, password, email_confirm: true });
      if (created.error) throw created.error;
      users.push(created.data.user.id); if (i === 0) email = address;
      const client = createClient(supabaseUrl, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const login = await client.auth.signInWithPassword({ email: address, password }); if (login.error) throw login.error;
      repositories.push(new SupabaseFinanceRepository(client));
    }
    [repo1, repo2] = repositories;
    workspace = (await repo1.createWorkspace({ name: 'Agent 3 isolated', owner_id: users[0], currency: 'BRL', tracking_mode: 'full' })).id;
    await repo1.addWorkspaceMember({ workspace_id: workspace, user_id: users[1], role: 'member' });
    account = (await repo1.saveAccount({ workspace_id: workspace, name: 'Agent 3 bank', institution: 'Fixture', type: 'cash', initial_balance: 1000, current_balance: 1000, color: '#000000', active: true })).id;
  }, 60000);
  afterAll(async () => {
    for (const root of roots) await act(async () => root.unmount());
    for (const uid of users) {
      const result = await admin.from('workspaces').delete().eq('owner_id', uid); if (result.error) throw result.error;
      const removed = await admin.auth.admin.deleteUser(uid); if (removed.error) throw removed.error;
    }
  }, 60000);
  async function mount(repository: any, children?: React.ReactNode, actorIndex = 0) {
    route.path = '/';
    let ctx!: ReturnType<typeof useFinance>;
    function Capture() { ctx = useFinance(); return null; }
    const container = (globalThis as any).document.createElement('div'); const root = createRoot(container); roots.push(root);
    const auth: any = { user: { id: users[actorIndex], name: 'Fixture', email: actorIndex === 0 ? email : 'fixture-member@example.test', created_at: '2026-01-01' }, isLoading: false, dataMode: 'supabase' };
    const render = (financial: boolean) => { route.path = financial ? '/' : '/ajuda'; root.render(<AuthContext.Provider value={auth}><FinanceSessionHost providerProps={{ repository, initialDataMode: "supabase", initialWorkspaceId: workspace }}>{financial ? <><Capture />{children}</> : <div>Public help</div>}</FinanceSessionHost></AuthContext.Provider>); };
    await act(async () => render(true));
    for (let i = 0; i < 300 && (!ctx?.isLoaded || ctx.isLoading); i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(ctx.error).toBeNull(); expect(ctx.activeWorkspace.id).toBe(workspace);
    return { get: () => ctx, root, render, container };
  }
  async function drain(h: any) { for (let i = 0; i < 400 && h.get().isSaving; i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); }); expect(h.get().isSaving).toBe(false); }
  const transaction = (description: string, amount = 100) => ({ workspace_id: workspace, description, amount, type: 'expense', status: 'pending', transaction_date: '2050-10-01', due_date: '2050-10-01' });


 const props=(n:any):any=>{const k=Object.keys(n).find(k=>k.startsWith('__reactProps$'));return k?n[k]:{};};
 const nodes=(n:any):any[]=>[n,...(n.childNodes??[]).flatMap(nodes)];
 const text=(n:any):string=>n.nodeType===3?n.nodeValue??'':n.textContent||(n.childNodes??[]).map(text).join('');
 async function fresh(mode='expense_tracker'){workspace=(await repo1.createWorkspace({name:'A5 isolated fixture',owner_id:users[0],currency:'BRL',tracking_mode:mode})).id;}
 it('includes a real Cloud overdue transaction in dashboard overdue counts',async()=>{
   await fresh('full');account=(await repo1.saveAccount({workspace_id:workspace,name:'Overdue bank fixture',type:'cash',institution:'Fixture',initial_balance:1000,current_balance:1000,color:'#000000',active:true})).id;
   const tx=await repo1.saveTransaction({...transaction('A5 Overdue',100),transaction_date:'2020-01-01',due_date:'2020-01-01'});
   const payment=await repo1.savePayment({workspace_id:workspace,transaction_id:tx.id,account_id:account,amount:30,payment_date:'2020-01-01',affects_balance:true});await repo1.deletePayment(payment.id);
   const st=await repo1.loadSnapshot(workspace);const row=st.allTransactions.find((t:any)=>t.id===tx.id);expect(row.status).toBe('overdue');
   const result=calculateDashboardSummary(st.allTransactions,st.allInstallments,st.allRecurring,st.allAccounts,st.allPayments,format(new Date(),'yyyy-MM'),st.allCreditCardBills);
   console.log('A5_OVERDUE',JSON.stringify({status:row.status,overdue:result.overdue,pending:result.pending}));expect(result.overdue).toEqual({count:1,amount:100});
 });
 it('charges a Cloud subcategory expense against its parent budget',async()=>{
   await fresh();const parent=await repo1.saveCategory({workspace_id:workspace,name:'A5 Parent Budget',type:'expense',color:'#000000',icon:'tag',active:true});
   const child=await repo1.saveCategory({workspace_id:workspace,parent_id:parent.id,name:'A5 Child Budget',type:'expense',color:'#000000',icon:'tag',active:true});
   const date=format(new Date(),'yyyy-MM-dd');await repo1.saveBudget({workspace_id:workspace,category_id:parent.id,month:new Date().getMonth()+1,year:new Date().getFullYear(),planned_amount:50});
   await repo1.saveTransaction({...transaction('A5 Child Expense',100),category_id:child.id,transaction_date:date,due_date:date});
   const h=await mount(repo1,<BudgetsPage/>);const card=nodes(h.container).find(n=>n.tagName==='DIV'&&props(n).className?.includes('flex flex-col justify-between')&&nodes(n).some(c=>c.tagName==='H3'&&text(c)==='A5 Parent Budget'));
   console.log('A5_PARENT_BUDGET',JSON.stringify({text:text(card),flatParent:h.get().categories.find((c:any)=>c.id===parent.id)!.subcategories??null}));expect(text(card)).toContain('Gasto: R$');expect(text(card)).toContain('100,00');
 });
 it('reports the known partial payment of a single-item card bill',async()=>{
   await fresh();const card=await repo1.saveCreditCard({workspace_id:workspace,name:'A5 Report Card',institution:'Fixture',credit_limit:1000,closing_day:25,due_day:5,color:'#000000',active:true});
   const date=format(new Date(),'yyyy-MM-dd');const tx=await repo1.saveTransaction({...transaction('A5 Only Bill Item',100),credit_card_id:card.id,transaction_date:date,due_date:date});
   await repo1.savePayment({workspace_id:workspace,credit_card_bill_id:tx.credit_card_bill_id,amount:40,payment_date:date,affects_balance:false});
   const h=await mount(repo1,<ReportsPage/>);let paid=nodes(h.container).find(n=>n.tagName==='SPAN'&&text(n)==='Já Quitado');while(paid&&!props(paid).className?.includes('rounded-3xl'))paid=paid.parentNode;
   let pending=nodes(h.container).find(n=>n.tagName==='SPAN'&&text(n)==='Pendente a Pagar');while(pending&&!props(pending).className?.includes('rounded-3xl'))pending=pending.parentNode;
   const st=await repo1.loadSnapshot(workspace);console.log('A5_REPORT_PARTIAL',JSON.stringify({billPaid:st.allCreditCardBills[0].paid_amount,rowPaid:st.allTransactions[0].paid_amount,paidText:text(paid),pendingText:text(pending)}));expect(text(paid)).toContain('40,00');expect(text(pending)).toContain('60,00');
 });
 it('deduplicates concurrent recurring materialization and allows pause/delete after generation',async()=>{
   await fresh();await repo1.addWorkspaceMember({workspace_id:workspace,user_id:users[1],role:'member'});
   const date=format(new Date(),'yyyy-MM-dd');const rec=await repo1.saveRecurring({workspace_id:workspace,description:'A5 Concurrent Recurring',amount:10,type:'expense',frequency:'monthly',start_date:date,next_occurrence:date,active:true,auto_create:true});
   const results=await Promise.allSettled([repo1.materializeRecurring(workspace),repo2.materializeRecurring(workspace)]);expect(results.every(r=>r.status==='fulfilled')).toBe(true);
   let st=await repo1.loadSnapshot(workspace);expect(st.allTransactions.filter((t:any)=>t.recurring_transaction_id===rec.id)).toHaveLength(1);
   const current=st.allRecurring.find((r:any)=>r.id===rec.id);await repo1.saveRecurring({...current,active:false});await repo1.materializeRecurring(workspace);st=await repo1.loadSnapshot(workspace);expect(st.allTransactions).toHaveLength(1);
   await repo1.deleteRecurring(rec.id);st=await repo1.loadSnapshot(workspace);expect(st.allTransactions).toHaveLength(1);expect(st.allRecurring).toHaveLength(0);console.log('A5_RECURRING_RACE',JSON.stringify({parallelCalls:2,rows:1,pauseAndDeletePreserveHistory:true}));
 });
 it('exports CSV and JSON for the displayed filtered rows with formula sanitization',async()=>{
   await fresh();const date=format(new Date(),'yyyy-MM-dd');await repo1.saveTransaction({...transaction('=2+2; "fixture"',10),transaction_date:date,due_date:date});
   await repo1.saveTransaction({...transaction('Previous year excluded',99),transaction_date:'2020-01-01',due_date:'2020-01-01'});
   const year=new Date().getFullYear(),month=new Date().getMonth(),q=Math.floor(month/3)*3;
   const inside=format(new Date(year,q+((month-q+1)%3),15),'yyyy-MM-dd');const outside=format(new Date(year,(q+3)%12,15),'yyyy-MM-dd');
   await repo1.saveTransaction({...transaction('Quarter fixture',20),transaction_date:inside,due_date:inside});await repo1.saveTransaction({...transaction('Year fixture',30),transaction_date:outside,due_date:outside});
   const h=await mount(repo1,<ReportsPage/>);const document=(globalThis as any).document;const create=document.createElement.bind(document);const attrs:any[]=[];let csvBlob:any;
   document.createElement=(tag:string)=>{const node=create(tag);if(tag==='a'){const record:any={};attrs.push(record);node.setAttribute=(k:string,v:string)=>{record[k]=v;};node.click=()=>{};node.remove=()=>node.parentNode?.removeChild(node);}return node;};
   const oldCreate=URL.createObjectURL;const oldRevoke=URL.revokeObjectURL;URL.createObjectURL=(blob:any)=>{csvBlob=blob;return 'blob:fixture';};URL.revokeObjectURL=()=>{};
   try{await act(async()=>{props(nodes(h.container).find(n=>n.tagName==='BUTTON'&&text(n)==='CSV')).onClick();});await act(async()=>{props(nodes(h.container).find(n=>n.tagName==='BUTTON'&&text(n)==='JSON')).onClick();});const csv=await csvBlob.text();const json=JSON.parse(decodeURIComponent(attrs.find(a=>a.href?.startsWith('data:')).href.split(',').slice(1).join(',')));expect(json.dataset).toHaveLength(1);expect(json.dataset[0].amount).toBe(10);expect(csv).toContain("'=2+2");expect(csv).not.toContain('Previous year excluded');
     for(const [label,period,count,total] of [['Trimestre','quarter',2,30],['Ano','year',3,60]] as const){
       await act(async()=>{props(nodes(h.container).find(n=>n.tagName==='BUTTON'&&text(n)===label)).onClick();});
       await act(async()=>{props(nodes(h.container).find(n=>n.tagName==='BUTTON'&&text(n)==='JSON')).onClick();props(nodes(h.container).find(n=>n.tagName==='BUTTON'&&text(n)==='CSV')).onClick();});
       const out=JSON.parse(decodeURIComponent([...attrs].reverse().find(a=>a.href?.startsWith('data:')).href.split(',').slice(1).join(',')));expect(out.period).toBe(period);expect(out.dataset).toHaveLength(count);expect(out.dataset.reduce((sum:number,r:any)=>sum+r.amount,0)).toBe(total);expect(await csvBlob.text()).not.toContain('Previous year excluded');
     }
     console.log('A5_EXPORTS',JSON.stringify({jsonRows:1,csvFormulaProtected:true,excludedPreviousYear:true}));}
   finally{document.createElement=create;URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;}
 });

 it('conserves goal deposits, idempotent replay and reversal in full mode',async()=>{
  await fresh('full');const bank=await repo1.saveAccount({workspace_id:workspace,name:'A5 Goal Bank',type:'cash',institution:'Fixture',initial_balance:1000,current_balance:1000,color:'#000000',active:true});
  const goal=await repo1.saveGoal({workspace_id:workspace,name:'A5 Goal',target_amount:100,current_amount:0,status:'in_progress',icon:'target',color:'#000000'});
  await repo1.recordGoalDeposit(workspace,goal.id,bank.id,30,'a5-goal-key');await repo1.recordGoalDeposit(workspace,goal.id,bank.id,30,'a5-goal-key');let st=await repo1.loadSnapshot(workspace);expect(st.allAccounts[0].current_balance).toBe(970);expect(st.allGoals[0].current_amount).toBe(30);
  const receipt=await repo1.client.from('goal_deposits').select('id').eq('workspace_id',workspace).eq('idempotency_key','a5-goal-key').single();if(receipt.error)throw receipt.error;
  const reversed=await repo1.client.rpc('fn_reverse_goal_deposit',{p_workspace_id:workspace,p_deposit_id:receipt.data.id});if(reversed.error)throw reversed.error;
  st=await repo1.loadSnapshot(workspace);expect(st.allAccounts[0].current_balance).toBe(1000);expect(st.allGoals[0].current_amount).toBe(0);console.log('A5_GOAL',JSON.stringify({idempotent:true,afterDeposit:970,afterReverse:1000,goalAfterReverse:0}));
 });
 it.each(['edit','pause','delete'])('materialization racing with %s cannot duplicate or lose confirmed history',async(kind)=>{
  await fresh();await repo1.addWorkspaceMember({workspace_id:workspace,user_id:users[1],role:'member'});const date=format(new Date(),'yyyy-MM-dd');
  const rec=await repo1.saveRecurring({workspace_id:workspace,description:`A5 Race ${kind}`,amount:10,type:'expense',frequency:'monthly',start_date:date,next_occurrence:date,active:true,auto_create:true});
  const mutation=kind==='delete'?()=>repo1.deleteRecurring(rec.id):()=>repo2.saveRecurring({...rec,...(kind==='pause'?{active:false}:{amount:15})});
  const result=await Promise.allSettled([repo2.materializeRecurring(workspace),mutation()]);expect(result.every(r=>r.status==='fulfilled')).toBe(true);
  const st=await repo1.loadSnapshot(workspace);const rows=st.allTransactions.filter((t:any)=>t.description===`A5 Race ${kind}`);expect(rows.length).toBeLessThanOrEqual(1);if(rows.length)expect([10,15]).toContain(rows[0].amount);if(kind==='pause')expect(st.allRecurring[0].active).toBe(false);if(kind==='delete')expect(st.allRecurring).toHaveLength(0);
  console.log('A5_REAL_RACE',JSON.stringify({kind,rows:rows.length,fulfilled:result.every(r=>r.status==='fulfilled')}));
 });

 it('does not acknowledge a recurring deletion refused by member RLS',async()=>{
  await fresh();await repo1.addWorkspaceMember({workspace_id:workspace,user_id:users[1],role:'member'});
  const rec=await repo1.saveRecurring({workspace_id:workspace,description:'A5 Protected Recurring',amount:10,type:'expense',frequency:'monthly',start_date:'2050-01-01',next_occurrence:'2050-01-01',active:true,auto_create:true});
  const logged=await repo2.client.auth.getUser();expect(logged.data.user.id).toBe(users[1]);
  const h=await mount(repo2,undefined,1);await act(async()=>h.get().deleteRecurring(rec.id));await drain(h);
  const remaining=await repo1.getRecurring(workspace);console.log('A5_DELETE_FEEDBACK',JSON.stringify({error:h.get().error?.message??null,shown:h.get().recurring.some((r:any)=>r.id===rec.id),serverExists:remaining.some((r:any)=>r.id===rec.id),serverActive:remaining.find((r:any)=>r.id===rec.id)?.active}));
  expect(remaining.some((r:any)=>r.id===rec.id)).toBe(true);expect(h.get().error).not.toBeNull();expect(h.get().recurring.some((r:any)=>r.id===rec.id)).toBe(true);
 });

 it('counts parent and child spending once in the summary while enforcing both ceilings',async()=>{
  await fresh();const parent=await repo1.saveCategory({workspace_id:workspace,name:'Overlap parent',type:'expense',icon:'tag',color:'#000000',active:true});const child=await repo1.saveCategory({workspace_id:workspace,parent_id:parent.id,name:'Overlap child',type:'expense',icon:'tag',color:'#000000',active:true});const date=format(new Date(),'yyyy-MM-dd');
  for(const [id,limit] of [[parent.id,50],[child.id,30]])await repo1.saveBudget({workspace_id:workspace,category_id:id,planned_amount:limit,month:new Date().getMonth()+1,year:new Date().getFullYear()});
  await repo1.saveTransaction({...transaction('Overlap expense',100),category_id:child.id,transaction_date:date,due_date:date});
  const h=await mount(repo1,<BudgetsPage/>);
  const card=(label:string)=>{let n=nodes(h.container).find(n=>n.tagName==='SPAN'&&text(n)===label);while(n&&!props(n).className?.includes('rounded-3xl'))n=n.parentNode;return text(n);};
  expect(card('Total Gasto Até Agora')).toContain('100,00');expect(card('Total Planejado')).toContain('50,00');
  const parentCard=nodes(h.container).find(n=>n.tagName==='DIV'&&props(n).className?.includes('flex flex-col justify-between')&&nodes(n).some(c=>c.tagName==='H3'&&text(c)==='Overlap parent'));expect(text(parentCard)).toContain('100,00');
  console.log('A5_BUDGET_SUMMARY',JSON.stringify({spent:100,ceiling:50,parentAndChildTracked:true}));
 });
 it('attributes a shared bill before filtering the report period and exports the same paid amounts',async()=>{
  await fresh();const card=await repo1.saveCreditCard({workspace_id:workspace,name:'Period allocation fixture',institution:'Fixture',credit_limit:1000,closing_day:1,due_day:10,color:'#000000',active:true});const now=new Date();const current=format(new Date(now.getFullYear(),now.getMonth(),1),'yyyy-MM-dd');const previous=format(new Date(now.getFullYear(),now.getMonth(),0),'yyyy-MM-dd');
  const first=await repo1.saveTransaction({...transaction('Previous month bill item',40),credit_card_id:card.id,transaction_date:previous,due_date:previous});const second=await repo1.saveTransaction({...transaction('Current month bill item',60),credit_card_id:card.id,transaction_date:current,due_date:current});expect(first.credit_card_bill_id).toBe(second.credit_card_bill_id);
  await repo1.savePayment({workspace_id:workspace,credit_card_bill_id:first.credit_card_bill_id,amount:50,payment_date:current,affects_balance:false});
  const h=await mount(repo1,<ReportsPage/>);let paid=nodes(h.container).find(n=>n.tagName==='SPAN'&&text(n)==='Já Quitado');while(paid&&!props(paid).className?.includes('rounded-3xl'))paid=paid.parentNode;expect(text(paid)).toContain('30,00');
  const doc=(globalThis as any).document;const create=doc.createElement.bind(doc);let href='';doc.createElement=(tag:string)=>{const n=create(tag);if(tag==='a'){n.setAttribute=(k:string,v:string)=>{if(k==='href')href=v;};n.click=()=>{};n.remove=()=>n.parentNode?.removeChild(n);}return n;};
  try{await act(async()=>props(nodes(h.container).find(n=>n.tagName==='BUTTON'&&text(n)==='JSON')).onClick());const out=JSON.parse(decodeURIComponent(href.split(',').slice(1).join(',')));expect(out.dataset).toHaveLength(1);expect(out.dataset[0]).toMatchObject({amount:60,paidAmount:30});}
  finally{doc.createElement=create;}
  const snapshot=await repo1.loadSnapshot(workspace);expect(snapshot.allCreditCardBills[0].paid_amount).toBe(50);expect(snapshot.allTransactions.every((t:any)=>t.paid_amount===0)).toBe(true);console.log('A5_PERIOD_ALLOCATION',JSON.stringify({billPaid:50,currentPeriodPaid:30,previousPeriodShare:20,sourceItemsUnchanged:true}));
 });
 it('retains current-month spending and budget for an archived parent category',async()=>{
  await fresh();const parent=await repo1.saveCategory({workspace_id:workspace,name:'Archived budget parent',type:'expense',icon:'tag',color:'#000000',active:true});const child=await repo1.saveCategory({workspace_id:workspace,parent_id:parent.id,name:'Archived budget child',type:'expense',icon:'tag',color:'#000000',active:true});const date=format(new Date(),'yyyy-MM-dd');
  await repo1.saveBudget({workspace_id:workspace,category_id:parent.id,month:new Date().getMonth()+1,year:new Date().getFullYear(),planned_amount:50});await repo1.saveTransaction({...transaction('Archived category history',100),category_id:child.id,transaction_date:date,due_date:date});await repo1.saveCategory({...parent,active:false});
  const h=await mount(repo1,<BudgetsPage/>);const card=nodes(h.container).find(n=>n.tagName==='DIV'&&props(n).className?.includes('flex flex-col justify-between')&&nodes(n).some(c=>c.tagName==='H3'&&text(c)==='Archived budget parent'));expect(text(card)).toContain('100,00');expect(props(nodes(card).find(n=>n.tagName==='BUTTON')).disabled).toBe(true);
 });
});
