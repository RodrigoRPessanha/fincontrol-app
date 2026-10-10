'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useFinance } from '@/lib/context/finance-context';
import { Transaction, TransactionSplit, SplitType, UpdateTransactionDTO } from '@/lib/types';
import { parseCurrencyInput } from '@/lib/utils';
import { calculateExpenseSplits, resolveSplitParticipants, toCents } from '@/lib/financial-engine';
import { transactionFinancialEditLocked } from '@/lib/transaction-edit';
import { SplitFields } from './quick-add/SplitFields';

export function EditTransactionModal({ target, onClose }: { target: Transaction; onClose: () => void }) {
  const { activeWorkspace, isWorkspaceReadOnly, updateTransactionAsync, refreshData, allWorkspaceCategories,
    workspaceMembers, allWorkspacePeople, people, payments, addPerson } = useFinance();
  const [original] = useState(target);
  const [description, setDescription] = useState(target.description);
  const [amount, setAmount] = useState(target.amount.toFixed(2).replace('.', ','));
  const [category, setCategory] = useState(target.category_id || '');
  const [date, setDate] = useState(target.transaction_date);
  const [due, setDue] = useState(target.due_date);
  const [notes, setNotes] = useState(target.notes || '');
  const [splitType, setSplitType] = useState<SplitType>(target.split_type || 'individual');
  const [memberPayer, setMemberPayer] = useState(target.paid_by_member_id || workspaceMembers[0]?.id || '');
  const [personPayer, setPersonPayer] = useState(target.paid_by_person_id || '');
  const [participants, setParticipants] = useState<string[]>(target.splits?.map((split) => (split.person_id || split.member_id)!) || []);
  const [custom, setCustom] = useState<Record<string, number>>(() => Object.fromEntries((target.splits || []).map((split) => [(split.person_id || split.member_id)!, split.amount])));
  const [financeDirty, setFinanceDirty] = useState(false);
  const [payerDirty, setPayerDirty] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector?.('input')?.focus?.();
    return () => { mounted.current = false; previous?.focus?.(); };
  }, []);
  if (isWorkspaceReadOnly || target.workspace_id !== activeWorkspace.id) return null;
  const locked = transactionFinancialEditLocked(target, payments);
  const datesLocked = Boolean(target.credit_card_id || target.credit_card_bill_id);
  const selectablePeople = (allWorkspacePeople || people).filter((person) => !person.archived || target.paid_by_person_id === person.id || target.splits?.some((split) => split.person_id === person.id));
  const numAmount = parseCurrencyInput(amount);
  const inputClass = 'mt-1 w-full rounded-xl border border-slate-300 bg-transparent p-2.5 text-sm dark:border-slate-600 disabled:opacity-60';
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending.current) return;
    setError('');
    try {
      if (!description.trim() || !Number.isFinite(numAmount) || numAmount <= 0) throw new Error('Informe descrição e valor positivo.');
      const patch: UpdateTransactionDTO = {};
      if (description.trim() !== original.description) patch.description = description.trim();
      if (category !== (original.category_id || '')) patch.category_id = category || null;
      if (date !== original.transaction_date) patch.transaction_date = date;
      if (due !== original.due_date) patch.due_date = due;
      if (notes !== (original.notes || '')) patch.notes = notes || null;
      if (!locked && financeDirty) {
        if (toCents(numAmount) !== toCents(original.amount)) patch.amount = numAmount;
        if (splitType !== (original.split_type || 'individual')) patch.split_type = splitType;
        const payer = personPayer || memberPayer;
        const active = resolveSplitParticipants(workspaceMembers, selectablePeople, participants, payer);
        if (splitType !== 'individual' && active.length < 2) throw new Error('Selecione pelo menos duas pessoas para dividir.');
        const splits: TransactionSplit[] = splitType === 'individual' ? [] : calculateExpenseSplits(numAmount, splitType, active,
          { id: payer, type: personPayer ? 'person' : 'member' }, active.map((part) => ({ ...part, amount: custom[part.id] || 0 })));
        if (JSON.stringify(splits) !== JSON.stringify(original.splits || [])) patch.splits = splits;
        if ((payerDirty || splitType !== 'individual') && payer !== (original.paid_by_person_id || original.paid_by_member_id || '')) {
          patch.paid_by_person_id = personPayer || null;
          patch.paid_by_member_id = personPayer ? null : memberPayer || null;
        }
      }
      if (Object.keys(patch).length === 0) { onClose(); return; }
      pending.current = true; setBusy(true);
      await updateTransactionAsync(target.id, patch, original.updated_at);
      if (mounted.current) onClose();
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a transação.');
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="edit-transaction-title" className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-5 dark:bg-slate-900" onKeyDown={(event) => {
      if (event.key === 'Escape' && !busy) onClose();
      if (event.key === 'Tab') {
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)')).filter((el) => !el.closest('fieldset:disabled'));
        const first = controls[0]; const last = controls[controls.length - 1];
        if (first && event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        if (last && !event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }}>
      <h2 id="edit-transaction-title" className="text-lg font-bold">Editar transação</h2>
      <form className="mt-4 space-y-4" onSubmit={submit}>
        <fieldset disabled={busy} className="space-y-4">
          <label className="block text-sm">Descrição<input aria-label="Descrição" className={inputClass} required value={description} onChange={(event) => setDescription(event.target.value)} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">Valor<input aria-label="Valor" inputMode="decimal" className={inputClass} required disabled={locked} value={amount} onChange={(event) => { setAmount(event.target.value); setFinanceDirty(true); }} /></label>
            <label className="text-sm">Categoria<select aria-label="Categoria" className={`${inputClass} bg-white dark:bg-slate-900`} value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Sem categoria</option>{allWorkspaceCategories.filter((cat) => cat.type === target.type).flatMap((cat) => [cat, ...(cat.subcategories || [])]).filter((cat) => cat.active !== false || cat.id === category).map((cat) => <option key={cat.id} value={cat.id} disabled={cat.active === false}>{cat.name}{cat.active === false ? ' (inativa)' : ''}</option>)}</select></label>
            <label className="text-sm">Competência<input aria-label="Competência" className={inputClass} type="date" required disabled={datesLocked} value={date} onChange={(event) => setDate(event.target.value)} /></label>
            <label className="text-sm">Vencimento<input aria-label="Vencimento" className={inputClass} type="date" required disabled={datesLocked} value={due} onChange={(event) => setDue(event.target.value)} /></label>
          </div>
          {locked && <p className="text-xs text-slate-500 dark:text-slate-400">Valores e rateios pagos, faturados ou cancelados ficam protegidos. Datas de faturas também são preservadas.</p>}
          <label className="block text-sm">Observações<textarea aria-label="Observações" className={inputClass} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
          {target.type === 'expense' && <fieldset disabled={locked}>
            <SplitFields type="expense" workspaceMembers={workspaceMembers} people={selectablePeople} numAmount={numAmount || 0} splitType={splitType} onSplitTypeChange={(value) => { setSplitType(value); setFinanceDirty(true); }} paidByMemberId={memberPayer} paidByPersonId={personPayer} onPaidByMemberIdChange={(value) => { setMemberPayer(value); setPayerDirty(true); setFinanceDirty(true); }} onPaidByPersonIdChange={(value) => { setPersonPayer(value); setPayerDirty(true); setFinanceDirty(true); }} selectedParticipantIds={participants} onToggleParticipant={(id) => { setParticipants((previous) => { const ids = resolveSplitParticipants(workspaceMembers, selectablePeople, previous, personPayer || memberPayer).map((part) => part.id); return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]; }); setFinanceDirty(true); }} customSplits={custom} onCustomSplitChange={(id, value) => { setCustom((previous) => ({ ...previous, [id]: value })); setFinanceDirty(true); }} onAddPerson={addPerson} />
          </fieldset>}
        </fieldset>
        {error && <div role="alert" className="space-y-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-300"><p>{error}</p><button type="button" disabled={busy} className="underline" onClick={async () => { try { await refreshData(); if (mounted.current) onClose(); } catch { if (mounted.current) setError('Não foi possível atualizar. Tente novamente.'); } }}>Atualizar dados e fechar edição</button></div>}
        <div className="flex justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-700"><button type="button" disabled={busy} onClick={onClose} className="min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm dark:border-slate-600">Cancelar</button><button disabled={busy || !description.trim()} type="submit" className="min-h-11 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Salvando...' : 'Salvar alterações'}</button></div>
      </form>
    </div>
  </div>;
}
