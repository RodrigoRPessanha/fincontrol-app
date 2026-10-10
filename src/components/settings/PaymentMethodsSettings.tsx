'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useFinance } from '@/lib/context/finance-context';
import { PaymentMethod, PaymentMethodType } from '@/lib/types';

const types: Record<PaymentMethodType, string> = {
  pix: 'Pix', cash: 'Dinheiro', debit_card: 'Cartão de débito', credit_card: 'Cartão de crédito',
  bank_transfer: 'Transferência bancária', boleto: 'Boleto', automatic_debit: 'Débito automático', other: 'Outro',
};

export function PaymentMethodsSettings() {
  const { allWorkspacePaymentMethods, isWorkspaceReadOnly,
    addPaymentMethodAsync, updatePaymentMethodAsync, deletePaymentMethodAsync } = useFinance();
  const [editing, setEditing] = useState<PaymentMethod | 'new' | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<PaymentMethodType>('pix');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<PaymentMethod | null>(null);
  const pending = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const run = async (operation: () => Promise<unknown>, close?: () => void) => {
    if (pending.current || isWorkspaceReadOnly) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await operation();
      if (mounted.current) close?.();
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a alteração.');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const open = (method: PaymentMethod | 'new') => {
    returnFocus.current = document.activeElement as HTMLElement;
    setError(''); setEditing(method);
    setName(method === 'new' ? '' : method.name);
    setType(method === 'new' ? 'pix' : method.type);
  };
  const closeDialog = () => {
    setEditing(null); setDeleting(null); setError('');
    returnFocus.current?.focus?.();
  };
  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !busy) { event.preventDefault(); closeDialog(); }
    if (event.key !== 'Tab') return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled), select:not(:disabled), button:not(:disabled), a[href]'));
    const first = controls[0]; const last = controls[controls.length - 1];
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const button = 'rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-600 disabled:opacity-50';
  return (
    <section className="space-y-4" aria-label="Gerenciar métodos de pagamento">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">Seus cartões já aparecem ao registrar despesas. Gerencie-os em <Link className="text-emerald-600 underline dark:text-emerald-400" href="/accounts">Contas e cartões</Link>.</p>
        {!isWorkspaceReadOnly && <button className={button} disabled={busy} onClick={() => open('new')}>Novo Método</button>}
      </div>
      {error && !editing && !deleting && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-300">{error}</p>}
      {allWorkspacePaymentMethods.length === 0 && <p className="rounded-2xl border border-dashed border-slate-300 p-5 text-sm text-slate-500 dark:text-slate-400">Nenhum método cadastrado. Adicione Pix, dinheiro, boleto ou outra forma de pagamento.</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {allWorkspacePaymentMethods.map((method) => (
          <article key={method.id} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><h3 className="break-words text-sm font-bold">{method.name}</h3><p className="text-xs text-slate-500 dark:text-slate-400">{types[method.type]}</p></div>
              <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{method.active ? 'Ativo' : 'Inativo'}</span>
            </div>
            {!isWorkspaceReadOnly && <div className="flex flex-wrap gap-2">
              <button className={button} disabled={busy} onClick={() => open(method)} aria-label={`Editar ${method.name}`}>Editar</button>
              <button className={button} disabled={busy} onClick={() => void run(() => updatePaymentMethodAsync(method.id, { active: !method.active }))} aria-label={`${method.active ? 'Desativar' : 'Reativar'} ${method.name}`}>{method.active ? 'Desativar' : 'Reativar'}</button>
              <button className={button} disabled={busy} onClick={() => { returnFocus.current = document.activeElement as HTMLElement; setError(''); setDeleting(method); }} aria-label={`Excluir ${method.name}`}>Excluir</button>
            </div>}
          </article>
        ))}
      </div>
      {editing && !isWorkspaceReadOnly && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4">
        <div role="dialog" aria-modal="true" onKeyDown={handleDialogKeyDown} aria-labelledby="payment-method-title" className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-6 dark:bg-slate-900">
          <h3 id="payment-method-title" className="font-bold">{editing === 'new' ? 'Cadastrar' : 'Editar'} método de pagamento</h3>
          <form className="mt-4 space-y-4" onSubmit={(event) => {
            event.preventDefault();
            void run(() => editing === 'new' ? addPaymentMethodAsync({ name, type, active: true }) : updatePaymentMethodAsync(editing.id, { name, type }), closeDialog);
          }}>
            <label htmlFor="method-name" className="block text-sm">Nome<input id="method-name" autoFocus required value={name} maxLength={100} onChange={(event) => setName(event.target.value)} disabled={busy} className="mt-1 w-full rounded-xl border border-slate-300 bg-transparent p-3 dark:border-slate-600" /></label>
            <label htmlFor="method-type" className="block text-sm">Tipo<select id="method-type" value={type} onChange={(event) => setType(event.target.value as PaymentMethodType)} disabled={busy} className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-3 dark:border-slate-600 dark:bg-slate-900">{Object.entries(types).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <p className="text-xs text-slate-500 dark:text-slate-400">Métodos com histórico ou vínculos não permitem alterar o tipo. Você pode mudar o nome ou desativá-los.</p>
            {error && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
            <div className="flex justify-end gap-2"><button type="button" disabled={busy} className={button} onClick={closeDialog}>Cancelar</button><button type="submit" disabled={busy || !name.trim()} className={button}>{busy ? 'Salvando...' : 'Salvar Método'}</button></div>
          </form>
        </div>
      </div>}
      {deleting && !isWorkspaceReadOnly && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div role="dialog" aria-modal="true" onKeyDown={handleDialogKeyDown} aria-labelledby="delete-method-title" className="w-full max-w-md space-y-4 rounded-3xl bg-white p-6 dark:bg-slate-900">
          <h3 id="delete-method-title" className="break-words font-bold">Excluir {deleting.name}?</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">A exclusão é definitiva e só é permitida sem lançamentos vinculados. Para preservar o histórico, use Desativar.</p>
          {error && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
          <div className="flex justify-end gap-2"><button autoFocus className={button} disabled={busy} onClick={closeDialog}>Cancelar</button><button className={button} disabled={busy} onClick={() => void run(() => deletePaymentMethodAsync(deleting.id), closeDialog)}>{busy ? 'Excluindo...' : 'Confirmar exclusão'}</button></div>
        </div>
      </div>}
    </section>
  );
}
