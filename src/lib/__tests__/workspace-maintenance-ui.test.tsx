import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { setupFinanceHarness } from './test-utils/finance-provider-harness';
import * as Finance from '../context/finance-context';
import { WorkspaceMaintenancePanel } from '@/components/workspaces/WorkspaceMaintenancePanel';
import { workspaceMaintenanceFixture } from './test-utils/workspace-maintenance-fixture';
import { localWorkspaceMaintenancePreview } from '../workspace-maintenance';

function props(n:any):any {const k=Object.keys(n||{}).find(k=>k.startsWith('__reactProps$'));return k?n[k]:{};}
function nodes(n:any,p:(n:any)=>boolean):any[]{return [...(p(n)?[n]:[]),...(n.childNodes||[]).flatMap((c:any)=>nodes(c,p))];}
function text(n:any):string{return n.nodeValue||n.textContent||(n.childNodes||[]).map(text).join('');}
describe('Owner workspace maintenance interface',()=>{
 setupFinanceHarness();const roots:any[]=[];let ctx:any,preview:any,read:any,maintain:any;
 beforeEach(()=>{const state=workspaceMaintenanceFixture();preview=localWorkspaceMaintenancePreview(state,'w');read=vi.fn().mockResolvedValue(preview);maintain=vi.fn().mockResolvedValue(undefined);ctx={activeWorkspace:state.allWorkspaces[0],isWorkspaceOwner:true,isMaintainingWorkspace:false,isSaving:false,previewWorkspaceMaintenanceAsync:read,maintainWorkspaceAsync:maintain};vi.spyOn(Finance,'useFinance').mockImplementation(()=>ctx);});
 afterEach(async()=>{await act(async()=>roots.splice(0).forEach(r=>r.unmount()));vi.restoreAllMocks();});
 async function mount(){const container=document.createElement('div');const root=createRoot(container);roots.push(root);await act(async()=>root.render(<WorkspaceMaintenancePanel/>));return {container,root};}
 const button=(c:any,label:string)=>nodes(c,n=>n.tagName==='BUTTON'&&text(n)===label)[0];const form=(c:any)=>nodes(c,n=>n.tagName==='FORM')[0];const input=(c:any)=>nodes(c,n=>props(n).id==='maintenance-name')[0];const checkbox=(c:any)=>nodes(c,n=>props(n).type==='checkbox')[0];
 async function open(c:any,action='Limpar lançamentos'){await act(async()=>props(button(c,action)).onClick());}
 async function confirm(c:any){await act(async()=>{props(input(c)).onChange({target:{value:preview.name}});props(checkbox(c)).onChange({target:{checked:true}});});}
 it('shows effects and exact-name confirmation, blocks early and duplicate submits, and awaits persistence',async()=>{
  const {container}=await mount();await open(container);expect(text(container)).toContain('Recorrências');expect(text(container)).toContain('Cadastros mantidos');expect(text(container)).toContain('1.100,00');
  await act(async()=>props(form(container)).onSubmit({preventDefault(){}}));expect(maintain).not.toHaveBeenCalled();
  await act(async()=>props(input(container)).onChange({target:{value:'Wrong'} }));await act(async()=>props(checkbox(container)).onChange({target:{checked:true}}));expect(props(button(container,'Confirmar limpeza')).disabled).toBe(true);
  await confirm(container);let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>{enter=r;});maintain.mockImplementationOnce(()=>{enter();return new Promise<void>(r=>{release=r;});});let pending!:Promise<void>;
  await act(async()=>{pending=props(form(container)).onSubmit({preventDefault(){}});await entered;await props(form(container)).onSubmit({preventDefault(){}});});expect(maintain).toHaveBeenCalledOnce();await act(async()=>props(button(container,'Excluir workspace')).onClick());expect(read).toHaveBeenCalledOnce();expect(maintain).toHaveBeenCalledWith('w',expect.objectContaining({action:'clear',confirmation_name:preview.name,expected_fingerprint:preview.fingerprint,operation_key:expect.any(String)}));
  const dialog=nodes(container,n=>props(n).role==='dialog')[0];await act(async()=>props(dialog).onKeyDown({key:'Escape'}));expect(text(container)).toContain('Processando...');
  await act(async()=>{release();await pending;});expect(text(container)).toContain('Lançamentos removidos. Cadastros mantidos');expect(nodes(container,n=>props(n).role==='dialog')).toHaveLength(0);
 });
 it('deletes only after the same explicit confirmation and blocks deletion of the last owned workspace',async()=>{
  const {container}=await mount();await open(container,'Excluir workspace');expect(text(container)).toContain('Todos os membros perderão acesso');expect(text(container)).toContain('Cadastros também removidos');await confirm(container);await act(async()=>props(form(container)).onSubmit({preventDefault(){}}));expect(maintain).toHaveBeenCalledWith('w',expect.objectContaining({action:'delete'}));expect(text(container)).toContain('Workspace excluído.');
  read.mockResolvedValueOnce({...preview,can_delete:false});await open(container,'Excluir workspace');await confirm(container);expect(text(container)).toContain('Crie outro workspace seu');expect(props(button(container,'Confirmar exclusão')).disabled).toBe(true);await act(async()=>props(form(container)).onSubmit({preventDefault(){}}));expect(maintain).toHaveBeenCalledOnce();
 });
 it('keeps a failed operation reviewable and reuses its key on retry, while refreshing resets the confirmation',async()=>{
  const {container}=await mount();await open(container);await confirm(container);maintain.mockRejectedValueOnce(new Error('Changed remotely'));await act(async()=>props(form(container)).onSubmit({preventDefault(){}}));expect(text(container)).toContain('Changed remotely');const firstKey=maintain.mock.calls[0][1].operation_key;
  maintain.mockRejectedValueOnce('Offline');await act(async()=>props(form(container)).onSubmit({preventDefault(){}}));expect(maintain.mock.calls[1][1].operation_key).toBe(firstKey);expect(text(container)).toContain('Não foi possível concluir');
  read.mockResolvedValueOnce({...preview,fingerprint:'new'});await act(async()=>props(button(container,'Atualizar prévia')).onClick());expect(props(input(container)).value).toBe('');expect(props(checkbox(container)).checked).toBe(false);
 });
 it('reports preview errors, supports retry and cancellation during loading, and ignores stale preview responses',async()=>{
  read.mockRejectedValueOnce(new Error('No access'));const {container}=await mount();await open(container);expect(text(container)).toContain('No access');expect(form(container)).toBeUndefined();await act(async()=>props(button(container,'Atualizar prévia')).onClick());expect(form(container)).toBeDefined();await act(async()=>props(button(container,'Cancelar')).onClick());expect(form(container)).toBeUndefined();
  let release!:(p:any)=>void;read.mockImplementationOnce(()=>new Promise(r=>{release=r;}));await open(container);expect(text(container)).toContain('Carregando a prévia');await act(async()=>props(button(container,'Cancelar')).onClick());await act(async()=>release(preview));expect(form(container)).toBeUndefined();
  read.mockRejectedValueOnce('Network');await open(container);expect(text(container)).toContain('Não foi possível carregar');
 });
 it('hides controls for non-owners and an old dialog when the active workspace changes',async()=>{
  ctx.isWorkspaceOwner=false;const {container,root}=await mount();expect(text(container)).toBe('');ctx.isWorkspaceOwner=true;await act(async()=>root.render(<WorkspaceMaintenancePanel/>));await open(container);ctx.activeWorkspace={...ctx.activeWorkspace,id:'other'};await act(async()=>root.render(<WorkspaceMaintenancePanel/>));expect(form(container)).toBeUndefined();
 });
 it('disables owner actions during saves and keeps a completed-operation refresh error visible after switching away',async()=>{
  ctx.isSaving=true;const {container,root}=await mount();expect(props(button(container,'Limpar lançamentos')).disabled).toBe(true);
  ctx.isSaving=false;ctx.isMaintainingWorkspace=true;await act(async()=>root.render(<WorkspaceMaintenancePanel/>));expect(props(button(container,'Excluir workspace')).disabled).toBe(true);
  ctx.isMaintainingWorkspace=false;read.mockResolvedValueOnce({...preview,counts:{...preview.counts,future:1},retained:{...preview.retained,future:2}});await act(async()=>root.render(<WorkspaceMaintenancePanel/>));await open(container,'Excluir workspace');expect(text(container)).toContain('Outros registros');expect(text(container)).toContain('Outros cadastros');await confirm(container);maintain.mockRejectedValueOnce(new Error('Operação concluída, mas não foi possível atualizar a tela.'));
  await act(async()=>props(form(container)).onSubmit({preventDefault(){}}));ctx.activeWorkspace={...ctx.activeWorkspace,id:'other'};await act(async()=>root.render(<WorkspaceMaintenancePanel/>));expect(text(container)).toContain('Operação concluída');expect(form(container)).toBeUndefined();
 });
 it('contains keyboard focus and restores cancellation behavior',async()=>{
  const {container}=await mount();await open(container);const dialog=nodes(container,n=>props(n).role==='dialog')[0];const first={focus:vi.fn()},last={focus:vi.fn()};dialog.querySelectorAll=()=>[first,last];const preventDefault=vi.fn();(document as any).activeElement=first;await act(async()=>props(dialog).onKeyDown({key:'Tab',currentTarget:dialog,shiftKey:true,preventDefault}));expect(last.focus).toHaveBeenCalled();(document as any).activeElement=last;await act(async()=>props(dialog).onKeyDown({key:'Tab',currentTarget:dialog,shiftKey:false,preventDefault}));expect(first.focus).toHaveBeenCalled();await act(async()=>props(dialog).onKeyDown({key:'Escape'}));expect(form(container)).toBeUndefined();
 });
 it.each([false,true])('does not update an unmounted form after a pending operation (reject=%s)',async reject=>{
  const {container,root}=await mount();await open(container);await confirm(container);let release!:()=>void,enter!:()=>void;const entered=new Promise<void>(r=>{enter=r;});maintain.mockImplementationOnce(()=>{enter();return new Promise<void>((resolve,fail)=>{release=()=>reject?fail(new Error('Offline')):resolve();});});let pending!:Promise<void>;await act(async()=>{pending=props(form(container)).onSubmit({preventDefault(){}});await entered;});await act(async()=>root.unmount());roots.splice(roots.indexOf(root),1);await act(async()=>{release();await pending;});
 });
 it.each([false,true])('ignores an unmounted preview response (reject=%s)',async reject=>{
  const {container,root}=await mount();let release!:()=>void;read.mockImplementationOnce(()=>new Promise((resolve,fail)=>{release=()=>reject?fail(new Error('Offline')):resolve(preview);}));await open(container);await act(async()=>root.unmount());roots.splice(roots.indexOf(root),1);await act(async()=>release());
 });
});
