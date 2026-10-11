'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFinance } from '@/lib/context/finance-context';
import { monthlyRepaymentPlan } from '@/lib/monthly-repayments';
import { withPurchaseRepayments } from '@/lib/purchase-repayments';
import { fromCents, toCents } from '@/lib/financial-engine';
import { formatCurrency, formatMonthYear } from '@/lib/utils';

export function MonthlyRepaymentModal({ month, participants, getName, onClose }: { month: string; participants: string[]; getName: (id: string) => string; onClose: () => void }) {
  const { activeWorkspace, purchases, installments, markMonthlyRepaymentsAsync, refreshData, isWorkspaceReadOnly } = useFinance();
  const [original] = useState(() => ({ purchases, installments, workspaceId: activeWorkspace.id }));
  const [participant, setParticipant] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const mounted = useRef(true);
  const dialog = useRef<HTMLDivElement>(null);
  const preview = useMemo(() => {
    if (!participant) return { plan: [], amount: 0, error: '' };
    try {
      const plan = monthlyRepaymentPlan(original.workspaceId, month, participant, original.purchases, original.installments);
      const amount = fromCents(plan.reduce((sum, change) => {
        const p = original.purchases.find(p => p.id === change.purchase_id)!;
        const counts = (p.splits || []).filter(s => (s.person_id || s.member_id) !== (p.paid_by_person_id || p.paid_by_member_id)).map(s => ({participant_id: (s.person_id || s.member_id)!, count: (s.person_id || s.member_id) === participant ? change.count : s.repaid_installments_count || 0}));
        const updated = withPurchaseRepayments(p, original.installments, counts);
        const share = updated.splits!.find(s => (s.person_id || s.member_id) === participant)!;
        const before = p.splits!.find(s => (s.person_id || s.member_id) === participant)!;
        return sum + toCents(share.repaid_amount || 0) - toCents(before.repaid_amount || 0);
      }, 0));
      return { plan, amount, error: '' };
    } catch (cause) { return { plan: [], amount: 0, error: cause instanceof Error ? cause.message : 'Confira as parcelas.' }; }
  }, [original, month, participant]);
  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector?.('select')?.focus?.();
    return () => { mounted.current = false; previous?.focus?.(); };
  }, []);
  if (isWorkspaceReadOnly || activeWorkspace.id !== original.workspaceId) return null;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="monthly-repayment-title" className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-5 dark:bg-slate-900" onKeyDown={event => {
      if (event.key === 'Escape' && !busy) onClose();
      if (event.key === 'Tab') {
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('select:not(:disabled), input:not(:disabled), button:not(:disabled)'));
        const first = controls[0]; const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <h2 id="monthly-repayment-title" className="text-lg font-bold">Marcar parcelas repassadas até {formatMonthYear(month)}</h2>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Inclui parcelas de meses anteriores e do mês selecionado. Preserva parcelas futuras, contagens maiores já registradas e repasses de outras pessoas. Não altera pagamentos de faturas ou saldos bancários.</p>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Se vocês quitaram as dívidas por compensação líquida, confirme também as parcelas do outro participante. A prévia mostra as partes quitadas, e não apenas o valor líquido transferido.</p>
      <form className="mt-4 space-y-4" onSubmit={async event => {
        event.preventDefault(); if (pending.current || !confirmed || !participant || !preview.plan.length || preview.error) return;
        pending.current = true; setBusy(true); setError('');
        try { await markMonthlyRepaymentsAsync(month, participant, preview.plan); if (mounted.current) onClose(); }
        catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Não foi possível registrar os repasses.'); }
        finally { pending.current = false; if (mounted.current) setBusy(false); }
      }}>
        <label className="block text-sm font-semibold" htmlFor="monthly-repayment-person">Quem já repassou?</label>
        <select id="monthly-repayment-person" required disabled={busy} value={participant} onChange={event => { setParticipant(event.target.value); setConfirmed(false); setError(''); }} className="min-h-11 w-full rounded-xl border p-2 dark:border-slate-700 dark:bg-slate-800">
          <option value="">Selecione o participante</option>{participants.map(id => <option key={id} value={id}>{getName(id)}</option>)}
        </select>
        {participant && !preview.plan.length && !preview.error && <p className="text-sm">Nenhuma parcela pendente de repasse até este mês.</p>}
        {preview.plan.length > 0 && <div className="space-y-3">
          <ul className="space-y-2">{preview.plan.map(change => <li key={change.purchase_id} className="rounded-xl border p-3 text-sm dark:border-slate-700"><p className="break-words font-semibold">{original.purchases.find(p => p.id === change.purchase_id)?.description}</p><p>Parcelas repassadas: {change.previous_count} → {change.count}</p></li>)}</ul>
          <p className="text-sm font-semibold">Repasses que serão reconhecidos: {formatCurrency(preview.amount)}</p>
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" required disabled={busy} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1" /><span>Confirmo que essas parcelas foram quitadas entre os participantes, por repasse ou compensação, e não foram registradas também como acertos avulsos. Registrar o mesmo valor nos dois lugares duplica a baixa.</span></label>
        </div>}
        {(error || preview.error) && <div role="alert" className="text-sm text-rose-600"><p>{error || preview.error}</p><button type="button" disabled={busy} className="min-h-11 underline" onClick={async () => { try { await refreshData(); if (mounted.current) onClose(); } catch { if (mounted.current) setError('Não foi possível atualizar os dados.'); } }}>Atualizar dados e fechar</button></div>}
        <div className="flex flex-wrap justify-end gap-2"><button type="button" disabled={busy} onClick={onClose} className="min-h-11 rounded-xl border px-4">Cancelar</button><button type="submit" disabled={busy || !confirmed || !preview.plan.length || !!preview.error} className="min-h-11 rounded-xl bg-teal-600 px-4 font-bold text-white disabled:opacity-50">{busy ? 'Salvando...' : 'Confirmar repasses'}</button></div>
      </form>
    </div>
  </div>;
}
