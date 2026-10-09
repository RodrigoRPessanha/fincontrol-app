import { loadCloudEnvironment, getStagingServiceRoleKey } from '../../../../scripts/cloud-test-safety.mjs';
import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { useFinance } from '../../context/finance-context';
import { AuthContext } from '../../context/auth-context';
import { SupabaseFinanceRepository } from '../../repositories/supabase-finance-repository';
import { setupFinanceHarness } from '../test-utils/finance-provider-harness';
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

describe.runIf(process.env.TEST_CLOUD === 'true')('Agent 3: real Cloud persistence and concurrency probes', { timeout: 60000 }, () => {
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
  async function mount(repository: any, children?: React.ReactNode) {
    route.path = '/';
    let ctx!: ReturnType<typeof useFinance>;
    function Capture() { ctx = useFinance(); return null; }
    const container = (globalThis as any).document.createElement('div'); const root = createRoot(container); roots.push(root);
    const auth: any = { user: { id: users[0], name: 'Fixture', email, created_at: '2026-01-01' }, isLoading: false, dataMode: 'supabase' };
    const render = (financial: boolean) => { route.path = financial ? '/' : '/ajuda'; root.render(<AuthContext.Provider value={auth}><FinanceSessionHost providerProps={{ repository, initialDataMode: "supabase", initialWorkspaceId: workspace }}>{financial ? <><Capture />{children}</> : <div>Public help</div>}</FinanceSessionHost></AuthContext.Provider>); };
    await act(async () => render(true));
    for (let i = 0; i < 300 && (!ctx?.isLoaded || ctx.isLoading); i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(ctx.error).toBeNull(); expect(ctx.activeWorkspace.id).toBe(workspace);
    return { get: () => ctx, root, render, container };
  }
  async function drain(h: any) { for (let i = 0; i < 400 && h.get().isSaving; i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); }); expect(h.get().isSaving).toBe(false); }
  const transaction = (description: string, amount = 100) => ({ workspace_id: workspace, description, amount, type: 'expense', status: 'pending', transaction_date: '2050-10-01', due_date: '2050-10-01' });

  it('does not duplicate partial payment when retrying after a committed response is lost', async () => {
    const tx = await repo1.saveTransaction(transaction('Lost payment'));
    let lose = true;
    const wrapped = decorate(repo1, { savePayment: async (data: any) => { const saved = await repo1.savePayment(data); if (lose) { lose = false; throw new Error('Simulated lost response AFTER commit'); } return saved; } });
    let closed = 0;
    const h = await mount(wrapped, <PaymentModal isOpen onClose={() => { closed++; }} target={{ type: 'transaction', id: tx.id, title: 'Lost response fixture', totalAmount: 100, paidAmount: 0 }} />);
    const before = (await repo1.getAccounts(workspace)).find((a: any) => a.id === account).current_balance;
    const props = (n: any): any => { const k = Object.keys(n).find((key) => key.startsWith('__reactProps$')); return k ? n[k] : {}; };
    const nodes = (n: any): any[] => [n, ...(n.childNodes ?? []).flatMap(nodes)];
    const text = (n: any): string => n.nodeType === 3 ? n.nodeValue ?? '' : n.textContent || (n.childNodes ?? []).map(text).join('');
    await act(async () => {
      props(nodes(h.container).find((n) => n.tagName === 'INPUT' && props(n).placeholder === '100,00')).onChange({ target: { value: '30' } });
      props(nodes(h.container).find((n) => n.tagName === 'SELECT')).onChange({ target: { value: account } });
    });
    await act(async () => { await props(nodes(h.container).find((n) => n.tagName === 'FORM')).onSubmit({ preventDefault() {} }); });
    await drain(h);
    expect(closed).toBe(0); expect(nodes(h.container).some((n) => text(n).includes('AFTER commit'))).toBe(true);
    const first = (await repo1.getPayments(workspace)).filter((p: any) => p.transaction_id === tx.id);
    await act(async () => { await props(nodes(h.container).find((n) => n.tagName === 'FORM')).onSubmit({ preventDefault() {} }); });
    await drain(h);
    const payments = (await repo1.getPayments(workspace)).filter((p: any) => p.transaction_id === tx.id);
    const after = (await repo1.getAccounts(workspace)).find((a: any) => a.id === account).current_balance;
    observe('lostPayment', { firstCount: first.length, afterRetryCount: payments.length, amounts: payments.map((p: any) => p.amount), before, after, modalClosedAfterRetry: closed });
    expect(first).toHaveLength(1); expect(payments).toHaveLength(1); expect(after).toBe(before - 30);
  });

  it('does not duplicate purchases/installments after a lost committed response', async () => {
    let lose = true;
    const wrapped = decorate(repo1, { savePurchase: async (data: any) => { const saved = await repo1.savePurchase(data); if (lose) { lose = false; throw new Error('Simulated lost purchase response AFTER commit'); } return saved; } });
    const h = await mount(wrapped);
    const data = { operation_key: 'lost-purchase-attempt', description: 'Lost purchase', total_amount: 120, installment_count: 3, purchase_date: '2050-10-01' };
    await act(async () => { h.get().createInstallmentPurchase(data); }); await drain(h);
    expect(h.get().error?.message).toMatch(/AFTER commit/);
    await act(async () => { h.get().createInstallmentPurchase(data); }); await drain(h);
    const purchases = (await repo1.getPurchases(workspace)).filter((p: any) => p.description === data.description);
    const installments = (await Promise.all(purchases.map((p: any) => repo1.getInstallments(p.id)))).flat();
    observe('lostPurchase', { purchases: purchases.length, installments: installments.length, total: purchases.reduce((sum: number, p: any) => sum + p.total_amount, 0) });
    expect(purchases).toHaveLength(1); expect(installments).toHaveLength(3);
  });

  it('persists an edit queued immediately after account creation', async () => {
    const pending = gate(); let entered!: () => void; const entry = new Promise<void>((r) => { entered = r; }); let first = true;
    const wrapped = decorate(repo1, { saveAccount: async (data: any) => { if (first) { first = false; entered(); await pending.wait; } return repo1.saveAccount(data); } });
    const h = await mount(wrapped);
    await act(async () => { const created = h.get().addAccount({ name: 'Temporary original', type: 'cash', institution: 'Fixture', initial_balance: 0, current_balance: 0, color: '#000000', active: true }); h.get().updateAccount(created.id, { name: 'Temporary edited' }); });
    await entry; pending.release(); await drain(h);
    const saved = (await repo1.getAccounts(workspace)).filter((a: any) => a.name.startsWith('Temporary'));
    observe('temporaryAccount', { savedNames: saved.map((a: any) => a.name), error: h.get().error?.message });
    expect(saved.map((a: any) => a.name)).toEqual(['Temporary edited']); expect(h.get().error).toBeNull();
  });

  it('pays a bill queued immediately after one-off creation', async () => {
    const card = await repo1.saveCreditCard({ workspace_id: workspace, name: 'Temporary bill card', institution: 'Fixture', color: '#000000', credit_limit: 1000, closing_day: 25, due_day: 5, active: true });
    const pending = gate(); let entered!: () => void; const entry = new Promise<void>((r) => { entered = r; }); let first = true;
    const wrapped = decorate(repo1, { saveTransaction: async (data: any) => { if (first) { first = false; entered(); await pending.wait; } return repo1.saveTransaction(data); } });
    const h = await mount(wrapped); let paid!: Promise<any>;
    await act(async () => { const created = h.get().addTransaction({ ...transaction('Temporary bill', 100), credit_card_id: card.id } as any); paid = h.get().payCreditCardBillAsync(created.credit_card_bill_id!, account, 100); void paid.catch(() => {}); });
    await entry; pending.release(); await act(async () => { await paid; }); await drain(h);
    const bills = await repo1.getCreditCardBills(card.id); observe('temporaryBill', { total: bills[0].total_amount, paid: bills[0].paid_amount }); expect(bills[0].paid_amount).toBe(100);
  });

  it('retains queued financial actions when navigating to help with the same identity', async () => {
    const pending = gate(); let entered!: () => void; const entry = new Promise<void>((r) => { entered = r; }); let calls = 0;
    const wrapped = decorate(repo1, { saveTransaction: async (data: any) => { calls++; entered(); await pending.wait; return repo1.saveTransaction(data); } });
    const h = await mount(wrapped);
    await act(async () => { h.get().addTransaction(transaction('Navigation first') as any); h.get().addTransaction(transaction('Navigation second') as any); });
    await entry; await act(async () => h.render(false)); pending.release();
    // The help body has no consumer; observe persistence independently while it stays open.
    for (let i = 0; i < 30; i++) {
      const committed = (await repo1.getTransactions(workspace)).filter((t: any) => t.description.startsWith('Navigation'));
      if (committed.length === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await act(async () => h.render(true));
    await drain(h);
    for (let i = 0; i < 300 && (!h.get().isLoaded || h.get().isLoading); i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    const saved = (await repo1.getTransactions(workspace)).filter((t: any) => t.description.startsWith('Navigation'));
    observe('navigation', { calls, saved: saved.map((t: any) => t.description), newProviderError: h.get().error?.message ?? null });
    expect(saved.map((t: any) => t.description).sort()).toEqual(['Navigation first','Navigation second']); expect(calls).toBe(2); expect(h.get().error).toBeNull();
  });

  it('concurrent full payments from owner/member cannot exceed the obligation', async () => {
    const tx = await repo1.saveTransaction(transaction('Concurrent payment'));
    const before = (await repo1.getAccounts(workspace)).find((a: any) => a.id === account).current_balance;
    const payment = { workspace_id: workspace, transaction_id: tx.id, account_id: account, amount: 100, payment_date: '2050-10-01', affects_balance: true };
    const results = await Promise.allSettled([repo1.savePayment(payment), repo2.savePayment(payment)]);
    const payments = (await repo1.getPayments(workspace)).filter((p: any) => p.transaction_id === tx.id);
    const after = (await repo1.getAccounts(workspace)).find((a: any) => a.id === account).current_balance;
    observe('concurrentPayment', { fulfilled: results.filter((s) => s.status === 'fulfilled').length, paymentCount: payments.length, debit: before - after });
    expect(payments).toHaveLength(1); expect(after).toBe(before - 100);
  });

  it('concurrent deletions of purchases sharing bills preserve totals without deadlock', async () => {
    const card = await repo1.saveCreditCard({ workspace_id: workspace, name: 'Concurrent delete card', institution: 'Fixture', color: '#000000', credit_limit: 1000, closing_day: 25, due_day: 5, active: true });
    const payload = { workspace_id: workspace, description: 'Concurrent delete', total_amount: 100, installment_count: 2, purchase_date: '2050-10-01', credit_card_id: card.id };
    const first = await repo1.savePurchase(payload); const second = await repo1.savePurchase({ ...payload, total_amount: 80 });
    const results = await Promise.allSettled([repo1.deletePurchase(first.id), repo2.deletePurchase(second.id)]);
    const bills = await repo1.getCreditCardBills(card.id);
    observe('concurrentDelete', { fulfilled: results.filter((s) => s.status === 'fulfilled').length, totals: bills.map((b: any) => b.total_amount) });
    expect(results.every((s) => s.status === 'fulfilled')).toBe(true); expect(bills.every((b: any) => b.total_amount === 0)).toBe(true);
  });

  it('concurrent installment payment and purchase deletion conserve the account', async () => {
    const purchase = await repo1.savePurchase({ workspace_id: workspace, description: 'Delete/pay race', total_amount: 50, installment_count: 1, purchase_date: '2050-10-01' });
    const installment = (await repo1.getInstallments(purchase.id))[0];
    const before = (await repo1.getAccounts(workspace)).find((a: any) => a.id === account).current_balance;
    const results = await Promise.allSettled([repo1.savePayment({ workspace_id: workspace, installment_id: installment.id, account_id: account, amount: 50, payment_date: '2050-10-01', affects_balance: true }), repo2.deletePurchase(purchase.id)]);
    const after = (await repo1.getAccounts(workspace)).find((a: any) => a.id === account).current_balance;
    observe('deletePaymentRace', { results: results.map((s) => s.status), before, after, remainingInstallments: (await repo1.getInstallments(purchase.id)).length });
    expect(after).toBe(before); expect((await repo1.getInstallments(purchase.id))).toHaveLength(0);
  });

  it('concurrent purchase edit/delete leaves no dangling installments or debit', async () => {
    const purchase = await repo1.savePurchase({ workspace_id: workspace, description: 'Edit/delete race', total_amount: 50, installment_count: 1, purchase_date: '2050-10-01' });
    const before = (await repo1.getAccounts(workspace)).find((a: any) => a.id === account).current_balance;
    const results = await Promise.allSettled([repo1.savePurchase({ ...purchase, total_amount: 70 }), repo2.deletePurchase(purchase.id)]);
    const after = (await repo1.getAccounts(workspace)).find((a: any) => a.id === account).current_balance;
    observe('editDeleteRace', { results: results.map((s) => s.status), before, after, remainingInstallments: (await repo1.getInstallments(purchase.id)).length });
    expect(results[1].status).toBe('fulfilled'); expect(after).toBe(before); expect((await repo1.getInstallments(purchase.id))).toHaveLength(0);
  });

  it('failure in workspace A while switching to B does not erase a successful B write', async () => {
    const secondWorkspace = (await repo1.createWorkspace({ name: 'Agent 3 B', owner_id: users[0], currency: 'BRL', tracking_mode: 'full' })).id;
    const pending = gate(); let entered!: () => void; const entry = new Promise<void>((r) => { entered = r; });
    const wrapped = decorate(repo1, { saveTransaction: async (data: any) => { if (data.description === 'Workspace A failure') { entered(); await pending.wait; throw new Error('Controlled failure in workspace A'); } return repo1.saveTransaction(data); } });
    const h = await mount(wrapped);
    await act(async () => { h.get().addTransaction(transaction('Workspace A failure') as any); });
    await entry;
    await act(async () => { await h.get().setActiveWorkspaceId(secondWorkspace); h.get().addTransaction({ ...transaction('Workspace B success'), workspace_id: undefined } as any); });
    pending.release(); await drain(h);
    const rows = await repo1.getTransactions(secondWorkspace);
    observe('workspaceSwitch', { activeIsB: h.get().activeWorkspace.id === secondWorkspace, bSaved: rows.some((t: any) => t.description === 'Workspace B success'), error: h.get().error?.message ?? null });
    expect(rows.some((t: any) => t.description === 'Workspace B success')).toBe(true);
    expect(h.get().activeWorkspace.id).toBe(secondWorkspace);
  });
  it('replays a paid transaction after remount without another optimistic debit', async () => {
    const payload = {...transaction('Revalidation paid replay',30), status:'paid', account_id:account, operation_key:crypto.randomUUID()};
    const first=await mount(repo1);
    await act(async()=>{await first.get().addTransactionAsync(payload as any);});
    await act(async()=>first.root.unmount()); roots.splice(roots.indexOf(first.root),1);
    const h=await mount(repo1);
    const before=(await repo1.getAccounts(workspace)).find((a:any)=>a.id===account).current_balance;
    await act(async()=>{await h.get().addTransactionAsync(payload as any);});
    const remote=(await repo1.getTransactions(workspace)).filter((t:any)=>t.operation_key===payload.operation_key);
    const local=h.get().transactions.filter((t:any)=>t.operation_key===payload.operation_key);
    const balance=h.get().accounts.find((a:any)=>a.id===account)?.current_balance;
    console.log('REVALIDATION_TRANSACTION',JSON.stringify({remoteRows:remote.length,localRows:local.length,remoteBalance:before,providerBalance:balance}));
    expect(remote).toHaveLength(1);expect(local).toHaveLength(1);expect(balance).toBe(before);
  });
  it('persists creation using an account created immediately before it', async()=>{
    const pending=gate();let entered!:()=>void;const entry=new Promise<void>(r=>{entered=r;});let first=true;
    const wrapped=decorate(repo1,{saveAccount:async(data:any)=>{if(first){first=false;entered();await pending.wait;}return repo1.saveAccount(data);}});
    const h=await mount(wrapped);let done!:Promise<any>;
    await act(async()=>{const a=h.get().addAccount({name:'Revalidation new account',type:'cash',institution:'Fixture',initial_balance:1000,current_balance:1000,color:'#000000',active:true});done=h.get().addTransactionAsync({...transaction('Revalidation chained paid',30),status:'paid',account_id:a.id} as any);void done.catch(()=>{});});
    await entry;pending.release();let failure='';await act(async()=>{try{await done;}catch(e:any){failure=e.message;}});await drain(h);
    const accounts=await repo1.getAccounts(workspace);const bank=accounts.find((a:any)=>a.name==='Revalidation new account');
    const remote=(await repo1.getTransactions(workspace)).find((t:any)=>t.description==='Revalidation chained paid');
    const local=h.get().transactions.find((t:any)=>t.description==='Revalidation chained paid');
    console.log('REVALIDATION_REFERENCE',JSON.stringify({failure,remoteAccount:remote?.account_id,providerAccount:local?.account_id,bank:bank?.id,remoteBalance:bank?.current_balance,providerBalance:h.get().accounts.find((a:any)=>a.id===bank?.id)?.current_balance}));
    expect(failure).toBe('');expect(local?.account_id).toBe(bank.id);expect(h.get().accounts.find((a:any)=>a.id===bank.id)?.current_balance).toBe(bank.current_balance);
  });

  it.each(['members', 'people'] as const)('recovers a split purchase with %s after a lost response and remount',async(kind)=>{
    const people = kind === 'people' ? await Promise.all(['A', 'B'].map((name) => repo1.savePerson({ workspace_id: workspace, name: `Receipt ${name}`, archived: false }))) : [];
    let lose = true;
    const wrapped = decorate(repo1, { savePurchase: async (data: any) => { const saved = await repo1.savePurchase(data); if (lose) { lose = false; throw new Error('Lost split response AFTER commit'); } return saved; } });
    const h=await mount(wrapped);const members=h.get().workspaceMembers;
    const payload={description:'Revalidation split recovery',total_amount:120,installment_count:3,purchase_date:'2050-10-01',operation_key:crypto.randomUUID(),...(kind === 'members' ? { paid_by_member_id:members[0].id, split_type:'equal', splits:members.map((m:any)=>({member_id:m.id,amount:60})) } : { paid_by_person_id:people[0].id, split_type:'custom', splits:people.map((person:any,i:number)=>({person_id:person.id,amount:i === 0 ? 40 : 80})) })};
    await act(async()=>{await expect(h.get().createInstallmentPurchaseAsync(payload as any)).rejects.toThrow('AFTER commit');});
    await drain(h);
    await act(async()=>h.root.unmount());roots.splice(roots.indexOf(h.root),1);
    const reloaded=await mount(repo1);let failure='';await act(async()=>{try{await reloaded.get().createInstallmentPurchaseAsync(payload as any);}catch(e:any){failure=e.message;}});
    expect(failure).toBe('');
    const saved = reloaded.get().purchases.filter((p:any)=>p.operation_key===payload.operation_key);
    expect(saved).toHaveLength(1);
    const installments = await repo1.getInstallments(saved[0].id);
    expect(installments).toHaveLength(3);
    expect(installments.reduce((sum:number,item:any)=>sum+item.amount,0)).toBe(120);
    await expect(repo1.savePurchase({ ...payload, workspace_id: workspace, total_amount: 121 })).rejects.toThrow(/diferentes/);
  });
  const props = (n:any):any => {const key=Object.keys(n).find(k=>k.startsWith('__reactProps$'));return key?n[key]:{};};
  const nodes = (n:any):any[] => [n,...(n.childNodes??[]).flatMap(nodes)];
  const text = (n:any):string => n.nodeType===3?n.nodeValue??'':n.textContent||(n.childNodes??[]).map(text).join('');
  it('persists the exact default split preview with multiple members and a saved person',async()=>{
    const person=await repo1.savePerson({workspace_id:workspace,name:'A4 Saved Person',archived:false});
    let closed=0;const h=await mount(repo1,<QuickAddModal isOpen onClose={()=>{closed++;}} />);
    await act(async()=>{
      props(nodes(h.container).find(n=>n.tagName==='INPUT'&&props(n).placeholder==='0,00')).onChange({target:{value:'120'}});
      props(nodes(h.container).find(n=>n.tagName==='INPUT'&&String(props(n).placeholder).startsWith('Ex:'))).onChange({target:{value:'A4 Default Preview'}});
      props(nodes(h.container).find(n=>n.tagName==='SELECT'&&nodes(n).some(c=>props(c).value==='equal'))).onChange({target:{value:'equal'}});
    });
    const preview=nodes(h.container).filter(n=>n.tagName==='DIV'&&props(n).className?.includes('bg-white/70')).map(text);
    await act(async()=>{await props(nodes(h.container).find(n=>n.tagName==='FORM')).onSubmit({preventDefault(){}});});
    await drain(h);
    const saved=(await repo1.loadSnapshot(workspace)).allTransactions.find((t:any)=>t.description==='A4 Default Preview');
    console.log('A4_PREVIEW',JSON.stringify({preview,closed,splits:saved?.splits?.map((s:any)=>({member:s.member_id,person:s.person_id,amount:s.amount}))}));
    expect(preview).toHaveLength(2);expect(saved.splits).toHaveLength(2);expect(saved.splits.some((s:any)=>s.person_id===person.id)).toBe(false);expect(saved.splits.map((s:any)=>s.amount)).toEqual([60,60]);
  });
  it('preserves a saved person when editing the total of an equal divided expense',async()=>{
    const person=await repo1.savePerson({workspace_id:workspace,name:'A4 Edit Person',archived:false});const members=await repo1.getWorkspaceMembers(workspace);
    const tx=await repo1.saveTransaction({...transaction('A4 Edit Mixed',100),paid_by_person_id:person.id,split_type:'equal',splits:[{member_id:members[0].id,amount:50},{person_id:person.id,amount:50}]});
    const h=await mount(repo1);await act(async()=>{h.get().updateTransaction(tx.id,{amount:120});});await drain(h);
    const saved=(await repo1.loadSnapshot(workspace)).allTransactions.find((t:any)=>t.id===tx.id);
    console.log('A4_EDIT',JSON.stringify({error:h.get().error?.message,payer:saved.paid_by_person_id,splits:saved.splits}));
    expect(h.get().error).toBeNull();expect(saved.splits.find((s:any)=>s.person_id===person.id)?.amount).toBe(60);
  });
  it('preserves the person payer when duplicating a divided expense',async()=>{
    const person=await repo1.savePerson({workspace_id:workspace,name:'A4 Copy Person',archived:false});const members=await repo1.getWorkspaceMembers(workspace);
    const tx=await repo1.saveTransaction({...transaction('A4 Copy Mixed',100),paid_by_person_id:person.id,split_type:'equal',splits:[{member_id:members[0].id,amount:50},{person_id:person.id,amount:50}]});
    const h=await mount(repo1);await act(async()=>{h.get().duplicateTransaction(tx.id);});await drain(h);
    const saved=(await repo1.loadSnapshot(workspace)).allTransactions.find((t:any)=>t.description.startsWith('A4 Copy Mixed ('));
    console.log('A4_COPY',JSON.stringify({error:h.get().error?.message,payer:saved?.paid_by_person_id,memberPayer:saved?.paid_by_member_id}));
    expect(h.get().error).toBeNull();expect(saved.paid_by_person_id).toBe(person.id);
  });
  it('works without accounts in expense tracker for payment, card, purchase and settlement',async()=>{
    workspace=(await repo1.createWorkspace({name:'A4 No Balance',owner_id:users[0],currency:'BRL',tracking_mode:'expense_tracker'})).id;
    const person=await repo1.savePerson({workspace_id:workspace,name:'A4 No Account Person',archived:false});
    const h=await mount(repo1);const member=h.get().workspaceMembers[0];expect(h.get().accounts).toHaveLength(0);
    let tx:any;await act(async()=>{tx=await h.get().addTransactionAsync({...transaction('A4 Tracker Expense',100),paid_by_member_id:member.id,split_type:'equal',splits:[{member_id:member.id,amount:50},{person_id:person.id,amount:50}]} as any);await h.get().recordPaymentAsync({transaction_id:tx.id,amount:30,payment_date:'2050-10-01'});await h.get().recordSettlementAsync({from_person_id:person.id,to_member_id:member.id,amount:20,settlement_date:'2050-10-01'});});
    const card=await repo1.saveCreditCard({workspace_id:workspace,name:'A4 No Bank Card',institution:'Fixture',color:'#000000',credit_limit:1000,closing_day:25,due_day:5,active:true});
    await act(async()=>h.get().refreshData());
    let purchase:any;await act(async()=>{purchase=await h.get().createInstallmentPurchaseAsync({description:'A4 Tracker Card',total_amount:120,installment_count:3,purchase_date:'2050-10-01',credit_card_id:card.id});});
    const bill=h.get().creditCardBills.find((b:any)=>b.credit_card_id===card.id);
    let failure='';await act(async()=>{try{await h.get().payCreditCardBillAsync(bill!.id,undefined,bill!.total_amount,'2050-10-01');}catch(e:any){failure=e.message;}});await drain(h);
    expect(failure).toBe('');
    expect(bill!.id).toMatch(/^[0-9a-f-]{36}$/);
    const direct=await repo1.savePurchase({workspace_id:workspace,description:'A4 Direct Installment',total_amount:60,installment_count:2,purchase_date:'2050-10-01'});
    await act(async()=>{await h.get().refreshData();});const inst=h.get().installments.find((i:any)=>i.purchase_id===direct.id);
    await act(async()=>{await h.get().recordPaymentAsync({installment_id:inst!.id,amount:30,payment_date:'2050-10-01'});});
    expect(()=>h.get().createTransfer('missing-a','missing-b',10)).toThrow(/Despesas/);
    expect(()=>h.get().depositGoalAsync('missing-goal',10,'missing-account')).toThrow(/Despesas/);
    const snapshot=await repo1.loadSnapshot(workspace);console.log('A4_TRACKER',JSON.stringify({accounts:snapshot.allAccounts.length,payments:snapshot.allPayments.map((p:any)=>({amount:p.amount,affects:p.affects_balance,account:p.account_id})),installments:snapshot.allInstallments.filter((i:any)=>i.purchase_id===purchase.id).length,settlements:snapshot.allSettlements.length}));
    expect(snapshot.allAccounts).toHaveLength(0);expect(snapshot.allPayments.every((p:any)=>p.affects_balance===false&&!p.account_id)).toBe(true);expect(snapshot.allSettlements).toHaveLength(1);expect(failure).toBe('');
  });

  it('conserves three-person netting, reciprocal debts, settlement limits and deletion history',async()=>{
    workspace=(await repo1.createWorkspace({name:'A4 Netting',owner_id:users[0],currency:'BRL',tracking_mode:'expense_tracker'})).id;
    const [a,b,c]=await Promise.all(['A','B','C'].map(name=>repo1.savePerson({workspace_id:workspace,name:`A4 Net ${name}`,archived:false})));
    const countBefore=(await repo1.getWorkspaceMembers(workspace)).length;
    expect(countBefore).toBe(1);const foreign=await repo2.loadSnapshot(workspace);expect(foreign.allPeople).toHaveLength(0);expect(foreign.allWorkspaces.some((w:any)=>w.id===workspace)).toBe(false);
    const t1=await repo1.saveTransaction({...transaction('A4 Net ABC',120),paid_by_person_id:a.id,split_type:'equal',splits:[a,b,c].map(p=>({person_id:p.id,amount:40}))});
    await repo1.saveTransaction({...transaction('A4 Net Reciprocal',30),paid_by_person_id:b.id,split_type:'custom',splits:[{person_id:a.id,amount:15},{person_id:b.id,amount:0},{person_id:c.id,amount:15}]});
    const read=async()=>{const st=await repo1.loadSnapshot(workspace);return calculateMemberNetBalances(st.allTransactions,st.allSettlements,st.allWorkspaceMembers,workspace,st.allPurchases,st.allPeople);};
    let net=await read();expect(net.balances.find(x=>x.participant_id===a.id)?.net_balance).toBe(65);expect(net.balances.find(x=>x.participant_id===b.id)?.net_balance).toBe(-10);expect(net.balances.find(x=>x.participant_id===c.id)?.net_balance).toBe(-55);
    await expect(repo1.saveSettlement({workspace_id:workspace,from_person_id:b.id,to_person_id:c.id,amount:1,settlement_date:'2050-10-01'})).rejects.toThrow();
    const settlement=await repo1.saveSettlement({workspace_id:workspace,from_person_id:c.id,to_person_id:a.id,amount:20,settlement_date:'2050-10-01'});
    await expect(repo1.saveSettlement({workspace_id:workspace,from_person_id:c.id,to_person_id:a.id,amount:36,settlement_date:'2050-10-01'})).rejects.toThrow();
    await repo1.deleteTransaction(t1.id);net=await read();expect(net.balances.find(x=>x.participant_id===a.id)?.net_balance).toBe(-35);
    await repo1.deleteSettlement(settlement.id);net=await read();expect(net.balances.find(x=>x.participant_id===a.id)?.net_balance).toBe(-15);expect(net.balances.reduce((sum,x)=>sum+x.net_balance,0)).toBe(0);expect((await repo1.getWorkspaceMembers(workspace)).length).toBe(countBefore);
    await repo1.savePerson({ ...b, archived: true });
    let archiveFailure='';try{await repo1.saveSettlement({workspace_id:workspace,from_person_id:a.id,to_person_id:b.id,amount:1,settlement_date:'2050-10-01'});}catch(e:any){archiveFailure=e.message;}
    console.log('A4_CLOUD_ARCHIVE',JSON.stringify({archiveFailure}));expect(archiveFailure).toMatch(/ativa/);
    console.log('A4_NETTING',JSON.stringify({conserved:true,foreignAccessRejected:true,membersUnchanged:true,final:net.balances.map(x=>({name:x.name,net:x.net_balance}))}));
  });
  it('saves an explicit two-member selection shown in the preview of a three-member workspace',async()=>{
    workspace=(await repo1.createWorkspace({name:'Selected members fixture',owner_id:users[0],currency:'BRL',tracking_mode:'full'})).id;
    await repo1.addWorkspaceMember({workspace_id:workspace,user_id:users[1],role:'member'});
    const created=await admin.auth.admin.createUser({email:`test.a4revalidate.${Date.now()}@fincontrol.app`,password:`Fixture!${crypto.randomUUID()}A`,email_confirm:true});if(created.error)throw created.error;users.push(created.data.user.id);
    await repo1.addWorkspaceMember({workspace_id:workspace,user_id:created.data.user.id,role:'member'});
    await repo1.savePerson({workspace_id:workspace,name:'A4 Revalidation Saved',archived:false});
    let closed=0;const h=await mount(repo1,<QuickAddModal isOpen onClose={()=>{closed++;}}/>);
    await act(async()=>{
      props(nodes(h.container).find(n=>n.tagName==='INPUT'&&props(n).placeholder==='0,00')).onChange({target:{value:'120'}});
      props(nodes(h.container).find(n=>n.tagName==='INPUT'&&String(props(n).placeholder).startsWith('Ex:'))).onChange({target:{value:'A4 Subset Selection'}});
      props(nodes(h.container).find(n=>n.tagName==='SELECT'&&nodes(n).some(c=>props(c).value==='equal'))).onChange({target:{value:'equal'}});
    });
    const chips=nodes(h.container).filter(n=>n.tagName==='BUTTON'&&props(n).className?.includes('rounded-full')&&props(n).className?.includes('bg-teal-600'));
    expect(chips).toHaveLength(3);await act(async()=>props(chips[2]).onClick());
    const preview=nodes(h.container).filter(n=>n.tagName==='DIV'&&props(n).className?.includes('bg-white/70')).map(text);
    await act(async()=>{await props(nodes(h.container).find(n=>n.tagName==='FORM')).onSubmit({preventDefault(){}});});await drain(h);
    const rows=(await repo1.getTransactions(workspace)).filter((t:any)=>t.description==='A4 Subset Selection');
    console.log('A4R_SELECTION',JSON.stringify({preview,closed,rows:rows.length,error:h.get().error?.message,formText:text(h.container).includes('canônico')}));expect(rows).toHaveLength(1);
  });
  it('keeps a single canonical paid bill when its payment is queued before purchase confirmation',async()=>{
    account=(await repo1.saveAccount({workspace_id:workspace,name:'Queued bill fixture bank',type:'cash',institution:'Fixture',initial_balance:1000,current_balance:1000,color:'#000000',active:true})).id;
    const card=await repo1.saveCreditCard({workspace_id:workspace,name:'A4 Revalidation Card',institution:'Fixture',color:'#000000',credit_limit:1000,closing_day:25,due_day:5,active:true});
    const pending=gate();let entered!:()=>void;const entry=new Promise<void>(r=>{entered=r;});let first=true;
    const wrapped=decorate(repo1,{savePurchase:async(data:any)=>{if(first){first=false;entered();await pending.wait;}return repo1.savePurchase(data);}});
    const h=await mount(wrapped);let paid!:Promise<any>;let bill:any;
    await act(async()=>{h.get().createInstallmentPurchase({description:'A4 Queued Bill',total_amount:120,installment_count:3,purchase_date:'2050-10-01',credit_card_id:card.id});});
    bill=h.get().creditCardBills.find((b:any)=>b.credit_card_id===card.id);
    await act(async()=>{paid=h.get().payCreditCardBillAsync(bill.id,account,bill.total_amount,'2050-10-01');void paid.catch(()=>{});});await entry;pending.release();await act(async()=>{await paid;});await drain(h);
    const provider=h.get().creditCardBills.filter((b:any)=>b.credit_card_id===card.id&&b.reference_month===bill.reference_month);
    const remote=(await repo1.getCreditCardBills(card.id)).filter((b:any)=>b.reference_month===bill.reference_month);
    console.log('A4R_BILL_QUEUE',JSON.stringify({provider:provider.map((b:any)=>({id:b.id,paid:b.paid_amount})),remote:remote.map((b:any)=>({id:b.id,paid:b.paid_amount}))}));expect(provider).toHaveLength(1);expect(provider[0].id).toBe(remote[0].id);expect(provider[0].paid_amount).toBe(remote[0].paid_amount);
  });
});
