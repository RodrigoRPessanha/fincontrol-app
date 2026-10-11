import { describe,it,expect } from 'vitest';
import { assertWorkspaceOwner,localWorkspaceMaintenancePreview,validateWorkspaceMaintenance,applyWorkspaceMaintenance } from '../workspace-maintenance';
import { workspaceMaintenanceFixture } from './test-utils/workspace-maintenance-fixture';
import { LocalFinanceRepository } from '../repositories/local-finance-repository';
import { saveFinanceSnapshot,loadFinanceSnapshot,STORAGE_KEYS } from '../context/finance-storage';

function storage() { const map=new Map<string,string>();return {getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>map.set(k,String(v)),removeItem:(k:string)=>map.delete(k),clear:()=>map.clear(),key:(i:number)=>[...map.keys()][i]??null,get length(){return map.size;}} as Storage; }
describe('Workspace maintenance',()=>{
 it('clears every financial collection and restores initial balances while preserving catalogs and other workspaces',()=>{
  const state=workspaceMaintenanceFixture();const before=JSON.stringify(state);const preview=localWorkspaceMaintenancePreview(state,'w');
  expect(preview).toMatchObject({name:'Meu Workspace',can_delete:true,initial_balance_total:1100,counts:{purchases:1,installments:3,payments:1,recurring:1,budgets:1,goals:1}});
  const next=applyWorkspaceMaintenance(state,'w','clear');
  for(const key of ['allPurchases','allInstallments','allPayments','allTransfers','allRecurring','allBudgets','allGoals','allSettlements','allCreditCardBills'] as const) expect(next[key]).toEqual([]);
  expect(next.allTransactions.map(t=>t.id)).toEqual(['foreign-tx']);expect(next.allAccounts[0].current_balance).toBe(1000);expect(next.allAccounts[1].current_balance).toBe(100);expect(next.allAccounts[2]).toBe(state.allAccounts[2]);
  for(const key of ['allWorkspaces','allWorkspaceMembers','allCreditCards','allCategories','allPaymentMethods','allPeople'] as const) expect(next[key]).toBe(state[key]);
  expect(next.activeWorkspaceId).toBe('w');expect(JSON.stringify(state)).toBe(before);
 });
 it('deletes catalogs and child installments and chooses another workspace only when deleting the active one',()=>{
  const state=workspaceMaintenanceFixture();const next=applyWorkspaceMaintenance(state,'w','delete');expect(next.allWorkspaces.map(w=>w.id)).toEqual(['other','foreign']);expect(next.activeWorkspaceId).toBe('other');
  for(const key of ['allWorkspaceMembers','allAccounts','allCreditCards','allPaymentMethods','allCategories','allPeople'] as const) expect(next[key].some(r=>r.workspace_id==='w')).toBe(false);
  expect(applyWorkspaceMaintenance({...state,activeWorkspaceId:'other'},'w','delete').activeWorkspaceId).toBe('other');
 });
 it('rejects non-owners, unknown workspaces, names, stale previews, invalid operations and deletion of the last owned workspace',()=>{
  const state=workspaceMaintenanceFixture();assertWorkspaceOwner(state,'w','usr-1');
  for(const uid of ['', 'usr-2']) expect(()=>assertWorkspaceOwner(state,'w',uid)).toThrow(/proprietário/);
  expect(()=>assertWorkspaceOwner({...state,allWorkspaceMembers:state.allWorkspaceMembers.map(m=>({...m,role:'admin'}))},'w','usr-1')).toThrow(/proprietário/);
  expect(()=>localWorkspaceMaintenancePreview(state,'missing')).toThrow(/não encontrado/);
  const p=localWorkspaceMaintenancePreview(state,'w');const req={action:'clear' as const,confirmation_name:p.name,expected_fingerprint:p.fingerprint,operation_key:'test'};validateWorkspaceMaintenance(p,req);
  for(const patch of [{confirmation_name:'Wrong'},{expected_fingerprint:'stale'},{operation_key:''},{operation_key:'x'.repeat(201)},{action:'wrong' as any}]) expect(()=>validateWorkspaceMaintenance(p,{...req,...patch})).toThrow();
  expect(()=>validateWorkspaceMaintenance({...p,can_delete:false},{...req,action:'delete'})).toThrow(/Crie outro/);
  expect(localWorkspaceMaintenancePreview({...state,allWorkspaceMembers:state.allWorkspaceMembers.filter(m=>m.workspace_id!=='other')},'w').can_delete).toBe(false);
 });
 it('can purge a remotely deleted final workspace from a cache without leaving an invalid active id',()=>{
  const state=workspaceMaintenanceFixture();const next=applyWorkspaceMaintenance({...state,allWorkspaces:[state.allWorkspaces[0]]},'w','delete');expect(next.activeWorkspaceId).toBe('');expect(next.allWorkspaces).toEqual([]);
 });
 it('invalidates previews after changes in target data but ignores unrelated workspace edits',()=>{
  const state=workspaceMaintenanceFixture();const p=localWorkspaceMaintenancePreview(state,'w');
  expect(localWorkspaceMaintenancePreview({...state,allTransactions:state.allTransactions.map(t=>t.workspace_id==='foreign'?{...t,amount:99}:t)},'w').fingerprint).toBe(p.fingerprint);
  expect(localWorkspaceMaintenancePreview({...state,allTransactions:state.allTransactions.map(t=>t.workspace_id==='w'?{...t,amount:99}:t)},'w').fingerprint).not.toBe(p.fingerprint);
 });
 it('persists local clearing and deletion, makes retries no-ops, and prevents reusing an operation key with another intention',async()=>{
  const st=storage();const state=workspaceMaintenanceFixture();saveFinanceSnapshot(st,state);const repo=new LocalFinanceRepository(st);const p=await repo.getWorkspaceMaintenancePreview('w');
  const req={action:'clear' as const,confirmation_name:p.name,expected_fingerprint:p.fingerprint,operation_key:'clear'};
  expect(await repo.maintainWorkspace('w',req)).toMatchObject({replayed:false});expect((await repo.loadSnapshot('w')).allPurchases).toEqual([]);
  const latest=loadFinanceSnapshot(st).snapshot;latest.allTransactions.push({...state.allTransactions[0],id:'new'});saveFinanceSnapshot(st,latest);
  expect(await repo.maintainWorkspace('w',req)).toMatchObject({replayed:true});expect((await repo.loadSnapshot('w')).allTransactions.some(t=>t.id==='new')).toBe(true);
  await expect(repo.maintainWorkspace('w',{...req,action:'delete'})).rejects.toThrow(/reutilizada/);
  const after=await repo.getWorkspaceMaintenancePreview('w');await repo.maintainWorkspace('w',{...req,action:'delete',operation_key:'delete',expected_fingerprint:after.fingerprint});
  expect((await repo.getWorkspaces()).some(w=>w.id==='w')).toBe(false);
  await expect(new LocalFinanceRepository(st).maintainWorkspace('w',req)).rejects.toThrow(/não encontrado/);
 });
 it('leaves persisted data intact when the atomic snapshot write fails',async()=>{
  const st=storage();saveFinanceSnapshot(st,workspaceMaintenanceFixture());const repo=new LocalFinanceRepository(st);const p=await repo.getWorkspaceMaintenancePreview('w');const before=st.getItem(STORAGE_KEYS.snapshot);const write=st.setItem.bind(st);st.setItem=()=>{throw new Error('Quota exceeded');};
  await expect(repo.maintainWorkspace('w',{action:'clear',confirmation_name:p.name,expected_fingerprint:p.fingerprint,operation_key:'quota'})).rejects.toThrow('Quota');expect(st.getItem(STORAGE_KEYS.snapshot)).toBe(before);st.setItem=write;
 });
});
