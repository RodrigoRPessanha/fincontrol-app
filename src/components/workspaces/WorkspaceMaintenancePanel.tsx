'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useFinance } from '@/lib/context/finance-context';
import { useOperationAttempt } from '@/lib/hooks/use-operation-attempt';
import { formatCurrency } from '@/lib/utils';
import type { WorkspaceMaintenanceAction, WorkspaceMaintenancePreview } from '@/lib/workspace-maintenance';

const countLabels: Record<string,string> = { transactions:'Transações', purchases:'Compras', installments:'Parcelas', payments:'Pagamentos', transfers:'Transferências', settlements:'Acertos entre participantes', bills:'Faturas', recurring:'Recorrências', budgets:'Orçamentos', goals:'Metas', goal_deposits:'Aportes em metas' };
const retainedLabels: Record<string,string> = { accounts:'Contas', cards:'Cartões', methods:'Métodos de pagamento', categories:'Categorias', people:'Pessoas', members:'Acessos de membros' };

export function WorkspaceMaintenancePanel() {
  const { activeWorkspace, isSaving, isWorkspaceOwner, isMaintainingWorkspace, previewWorkspaceMaintenanceAsync, maintainWorkspaceAsync } = useFinance();
  const [action,setAction] = useState<WorkspaceMaintenanceAction | null>(null);
  const [targetId,setTargetId] = useState('');
  const [preview,setPreview] = useState<WorkspaceMaintenancePreview | null>(null);
  const [loading,setLoading] = useState(false);
  const [busy,setBusy] = useState(false);
  const [name,setName] = useState('');
  const [confirmed,setConfirmed] = useState(false);
  const [error,setError] = useState('');
  const [success,setSuccess] = useState('');
  const pending = useRef(false);
  const mounted = useRef(true);
  const sequence = useRef(0);
  const dialog = useRef<HTMLDivElement>(null);
  const attempt = useOperationAttempt(activeWorkspace.id,'workspace-maintenance');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current += 1; }; },[]);
  const visible = !!action && targetId === activeWorkspace.id && isWorkspaceOwner;
  useEffect(() => {
    if (!visible) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector?.<HTMLElement>('input,button')?.focus?.();
    return () => previous?.focus?.();
  },[visible,preview?.fingerprint]);
  const close = () => { if (pending.current) return; sequence.current += 1; setAction(null); setPreview(null); setError(''); };
  const load = async (selected: WorkspaceMaintenanceAction) => {
    if (pending.current) return;
    const id = activeWorkspace.id; const seq = ++sequence.current;
    setAction(selected); setTargetId(id); setPreview(null); setLoading(true); setName(''); setConfirmed(false); setError(''); setSuccess('');
    try { const result = await previewWorkspaceMaintenanceAsync(id); if (mounted.current && sequence.current === seq) setPreview(result); }
    catch (cause) { if (mounted.current && sequence.current === seq) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a prévia.'); }
    finally { if (mounted.current && sequence.current === seq) setLoading(false); }
  };
  if (!isWorkspaceOwner) return null;
  const disabled = busy || isMaintainingWorkspace || loading || !preview || !confirmed || name !== preview.name || (action === 'delete' && !preview.can_delete);
  return <section aria-label="Manutenção do workspace" className="space-y-4 rounded-3xl border border-rose-200 bg-white p-5 dark:border-rose-900 dark:bg-slate-900">
    <h2 className="text-lg font-bold">Recomeçar ou excluir o workspace</h2>
    <p className="text-sm text-slate-500 dark:text-slate-400">Apenas o proprietário pode usar estas opções. Confira a prévia antes de confirmar: os dados removidos não podem ser recuperados pela interface.</p>
    {success && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{success}</p>}
    {error && !visible && <p role="alert" className="text-sm text-rose-600">{error}</p>}
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={isMaintainingWorkspace || isSaving} onClick={() => { void load('clear'); }} className="min-h-11 rounded-xl border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 dark:text-rose-300">Limpar lançamentos</button>
      <button type="button" disabled={isMaintainingWorkspace || isSaving} onClick={() => { void load('delete'); }} className="min-h-11 rounded-xl bg-rose-700 px-4 py-2 text-sm font-semibold text-white">Excluir workspace</button>
    </div>
    {visible && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="workspace-maintenance-title" className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-5 shadow-xl dark:bg-slate-900" onKeyDown={event => {
        if (event.key === 'Escape') close();
        if (event.key === 'Tab') {
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled),button:not(:disabled)'));
          const first = controls[0], last = controls[controls.length-1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
        <h2 id="workspace-maintenance-title" className="text-lg font-bold">{action === 'clear' ? 'Limpar lançamentos' : 'Excluir workspace'}</h2>
        {loading && <p role="status" className="mt-3 text-sm">Carregando a prévia...</p>}
        {preview && <>
          <p className="mt-2 break-words font-semibold">{preview.name}</p>
          <p className="mt-3 text-sm">{action === 'clear' ? 'Remove todos os lançamentos, compras, pagamentos, acertos, recorrências, orçamentos e metas deste workspace.' : 'Remove este workspace e todos os seus lançamentos e cadastros. Todos os membros perderão acesso a ele.'}</p>
          <div className="mt-4 rounded-xl border p-3 dark:border-slate-700"><h3 className="text-sm font-bold">Registros que serão removidos</h3>
            <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">{Object.entries(preview.counts).map(([key,count]) => <li key={key}>{countLabels[key] || 'Outros registros'}: <strong>{count}</strong></li>)}</ul>
          </div>
          <div className="mt-3 rounded-xl border p-3 dark:border-slate-700"><h3 className="text-sm font-bold">{action === 'clear' ? 'Cadastros mantidos' : 'Cadastros também removidos'}</h3>
            <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">{Object.entries(preview.retained).map(([key,count]) => <li key={key}>{retainedLabels[key] || 'Outros cadastros'}: <strong>{count}</strong></li>)}</ul>
          </div>
          {action === 'clear' && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">Os saldos das contas voltarão aos saldos iniciais cadastrados (total: {formatCurrency(preview.initial_balance_total)}). Os acessos dos membros serão mantidos.</p>}
          {action === 'delete' && !preview.can_delete && <p role="alert" className="mt-3 text-sm text-amber-700 dark:text-amber-300">Crie outro workspace seu antes de excluir este. Para recomeçar nele, use Limpar lançamentos.</p>}
          <form className="mt-4 space-y-4" onSubmit={async event => {
            event.preventDefault(); if (pending.current || disabled || !action) return;
            pending.current = true; setBusy(true); setError('');
            try {
              const request = { action, confirmation_name:name, expected_fingerprint:preview.fingerprint, operation_key:await attempt.getKey({workspace_id:targetId,action,name,fingerprint:preview.fingerprint}) };
              await maintainWorkspaceAsync(targetId,request); attempt.complete();
              if (mounted.current) { setAction(null); setPreview(null); setSuccess(action === 'clear' ? 'Lançamentos removidos. Cadastros mantidos e saldos restaurados aos valores iniciais.' : 'Workspace excluído. Outro workspace foi selecionado.'); }
            } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Não foi possível concluir a operação.'); }
            finally { pending.current = false; if (mounted.current) setBusy(false); }
          }}>
            <label className="block text-sm font-semibold" htmlFor="maintenance-name">Digite o nome exato do workspace</label>
            <input id="maintenance-name" required autoComplete="off" disabled={busy} value={name} onChange={event => setName(event.target.value)} className="min-h-11 w-full rounded-xl border p-2 text-sm dark:border-slate-700 dark:bg-slate-800" />
            <label className="flex items-start gap-3 text-sm"><input type="checkbox" required disabled={busy} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1"/><span>Entendo que esta ação é definitiva e não pode ser desfeita pela interface.</span></label>
            <div className="flex flex-wrap justify-end gap-2"><button type="button" disabled={busy} onClick={close} className="min-h-11 rounded-xl border px-4">Cancelar</button><button type="submit" disabled={disabled} className="min-h-11 rounded-xl bg-rose-700 px-4 font-bold text-white disabled:opacity-50">{busy ? 'Processando...' : action === 'clear' ? 'Confirmar limpeza' : 'Confirmar exclusão'}</button></div>
          </form>
        </>}
        {error && <div role="alert" className="mt-4 text-sm text-rose-600"><p>{error}</p><button type="button" disabled={busy} onClick={() => { if (action) void load(action); }} className="min-h-11 underline">Atualizar prévia</button></div>}
        {!preview && <button type="button" disabled={busy} onClick={close} className="mt-4 min-h-11 rounded-xl border px-4">Cancelar</button>}
      </div>
    </div>}
  </section>;
}
