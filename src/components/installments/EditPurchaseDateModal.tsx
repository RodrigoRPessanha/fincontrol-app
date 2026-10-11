'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFinance } from '@/lib/context/finance-context';
import { Purchase } from '@/lib/types';
import { assertPurchaseDateMove, purchaseDateSchedule, PurchaseDateReadState } from '@/lib/financial-engine/purchase-dates';
import { formatCurrency, formatDate } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/StatusBadge';

export function EditPurchaseDateModal({ purchase, onClose }: { purchase: Purchase; onClose: () => void }) {
  const { activeWorkspace, isWorkspaceReadOnly, installments, allWorkspaceCreditCards, creditCardBills,
    payments, transactions, reschedulePurchaseDateAsync, refreshData } = useFinance();
  const [original] = useState(purchase);
  const [date, setDate] = useState(purchase.purchase_date);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  const dialog = useRef<HTMLDivElement>(null);
  const preview = useMemo(() => {
    const state: PurchaseDateReadState = { allInstallments: installments, allCreditCards: allWorkspaceCreditCards,
      allCreditCardBills: creditCardBills, allPayments: payments, allTransactions: transactions };
    try {
      const rows = purchaseDateSchedule(state, original, date);
      try { assertPurchaseDateMove(state, original, rows); return { rows, error: '' }; }
      catch (cause) { return { rows, error: cause instanceof Error ? cause.message : 'Confira as faturas antes de corrigir a data.' }; }
    } catch (cause) { return { rows: [], error: cause instanceof Error ? cause.message : 'Não foi possível calcular a prévia.' }; }
  }, [original, date, installments, allWorkspaceCreditCards, creditCardBills, payments, transactions]);
  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector?.('input')?.focus?.();
    return () => { mounted.current = false; previous?.focus?.(); };
  }, []);
  if (isWorkspaceReadOnly || activeWorkspace.id !== purchase.workspace_id) return null;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="purchase-date-title"
      className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl dark:bg-slate-900"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) onClose();
        if (event.key === 'Tab') {
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)'));
          const first = controls[0]; const last = controls[controls.length - 1];
          if (first && event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          if (last && !event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }}>
      <h2 id="purchase-date-title" className="text-lg font-bold">Corrigir data da compra</h2>
      <p className="mt-1 break-words text-sm text-slate-500 dark:text-slate-400">{original.description}</p>
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Confira os novos vencimentos antes de salvar. Valores pagos, datas dos pagamentos e repasses serão preservados. Faturas com baixas registradas não serão movidas automaticamente.</p>
      <form onSubmit={async (event) => {
        event.preventDefault();
        if (pending.current || preview.error || date === original.purchase_date) return;
        pending.current = true; setBusy(true); setError('');
        try {
          await reschedulePurchaseDateAsync(original.id, { purchase_date: date, expected_version: original.repayment_version || 0, expected_schedule: preview.rows });
          if (mounted.current) onClose();
        } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Não foi possível corrigir a data.'); }
        finally { pending.current = false; if (mounted.current) setBusy(false); }
      }}>
        <label className="mt-4 block text-sm font-semibold" htmlFor="purchase-date-input">Data correta da compra</label>
        <input id="purchase-date-input" type="date" required disabled={busy} value={date} onChange={(event) => setDate(event.target.value)}
          className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600" />
        <h3 className="mt-4 text-sm font-bold">Prévia dos vencimentos</h3>
        <ul className="mt-2 space-y-2">
          {preview.rows.map((row) => <li key={row.installment_id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-semibold">Parcela {row.installment_number} • {formatCurrency(row.amount)}</span><StatusBadge status={row.status} /></div>
            <div className="mt-2 grid grid-cols-2 gap-3 text-xs"><div><p className="text-slate-500 dark:text-slate-400">Vencimento atual</p><time dateTime={row.old_due_date}>{formatDate(row.old_due_date)}</time></div><div><p className="text-slate-500 dark:text-slate-400">Novo vencimento</p><time dateTime={row.due_date} className="font-semibold text-indigo-600 dark:text-indigo-400">{formatDate(row.due_date)}</time></div></div>
          </li>)}
        </ul>
        {preview.error && <p role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">{preview.error}</p>}
        {error && <div role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-300"><p>{error}</p><button type="button" disabled={busy} className="mt-2 underline" onClick={async () => {
          try { await refreshData(); if (mounted.current) onClose(); } catch { if (mounted.current) setError('Não foi possível atualizar os dados. Tente novamente.'); }
        }}>Atualizar dados e fechar edição</button></div>}
        <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
          <button type="button" disabled={busy} onClick={onClose} className="min-h-11 rounded-xl border border-slate-300 px-4 dark:border-slate-600">Cancelar</button>
          <button type="submit" disabled={busy || !!preview.error || date === original.purchase_date} className="min-h-11 rounded-xl bg-indigo-600 px-4 font-bold text-white disabled:opacity-50">{busy ? 'Salvando...' : 'Confirmar novos vencimentos'}</button>
        </div>
      </form>
    </div>
  </div>;
}
