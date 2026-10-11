'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Purchase } from '@/lib/types';
import { useFinance } from '@/lib/context/finance-context';
import { RepaymentCountFields } from './RepaymentCountFields';

export function PurchaseRepaymentModal({ purchase, getName, onClose }: { purchase: Purchase; getName: (id: string) => string; onClose: () => void }) {
  const { updatePurchaseRepaymentsAsync, refreshData, activeWorkspace, isWorkspaceReadOnly } = useFinance();
  const [original] = useState(purchase);
  const participants = (original.splits || []).filter((s) => (s.person_id || s.member_id) !== (original.paid_by_person_id || original.paid_by_member_id));
  const [counts, setCounts] = useState<Record<string, number>>(() => Object.fromEntries(participants.map((s) => [(s.person_id || s.member_id)!, s.repaid_installments_count || 0])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; const previous = document.activeElement as HTMLElement | null; dialog.current?.querySelector?.('select')?.focus?.();
    return () => { mounted.current = false; previous?.focus?.(); }; }, []);
  if (isWorkspaceReadOnly || activeWorkspace.id !== purchase.workspace_id) return null;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="repayment-title" className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-5 dark:bg-slate-900" onKeyDown={(event) => {
      if (event.key === 'Escape' && !busy) onClose();
      if (event.key === 'Tab') {
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('select:not(:disabled), button:not(:disabled)'));
        const first = controls[0]; const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }}>
      <h2 id="repayment-title" className="text-lg font-bold">Ajustar parcelas repassadas</h2><p className="mt-1 break-words text-sm">{original.description}</p>
      <form onSubmit={async (event) => {
        event.preventDefault(); if (pending.current) return; pending.current = true; setBusy(true); setError('');
        try { await updatePurchaseRepaymentsAsync(original.id, Object.entries(counts).map(([participant_id, count]) => ({ participant_id, count })), original.repayment_version || 0); if (mounted.current) onClose(); }
        catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Não foi possível salvar os repasses.'); }
        finally { pending.current = false; if (mounted.current) setBusy(false); }
      }}>
        <fieldset disabled={busy}><RepaymentCountFields participants={participants.map((s) => ({ id: (s.person_id || s.member_id)!, name: getName((s.person_id || s.member_id)!) }))} total={original.installment_count} counts={counts} onChange={(id, count) => setCounts((previous) => ({ ...previous, [id]: count }))} /></fieldset>
        {error && <div role="alert" className="mt-4 text-sm text-rose-600"><p>{error}</p><button type="button" disabled={busy} className="underline" onClick={async () => { try { await refreshData(); if (mounted.current) onClose(); } catch { if (mounted.current) setError('Não foi possível atualizar os dados.'); } }}>Atualizar dados e fechar</button></div>}
        <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={busy} onClick={onClose} className="min-h-11 rounded-xl border px-4">Cancelar</button><button type="submit" disabled={busy} className="min-h-11 rounded-xl bg-teal-600 px-4 font-bold text-white">{busy ? 'Salvando...' : 'Salvar repasses'}</button></div>
      </form>
    </div>
  </div>;
}
