'use client';

import React from 'react';
import { PairwiseDebt } from '@/lib/financial-engine/splits';
import { formatCurrency } from '@/lib/utils';
import { fromCents, toCents } from '@/lib/financial-engine';
import { MonthlySharedExpense } from '@/lib/financial-engine/monthly-splits';

export function MonthlySplitOverview({ month, onMonthChange, items, responsibilities, warnings, getName, debts = [], onMarkRepayments }: {
  month: string; onMonthChange: (month: string) => void; items: MonthlySharedExpense[];
  debts?: PairwiseDebt[]; onMarkRepayments?: () => void;
  responsibilities: Map<string, number>; warnings: string[]; getName: (id: string) => string;
}) {
  const total = fromCents(items.reduce((sum, item) => sum + toCents(item.amount), 0));
  return <section aria-label="Divisão mensal" className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><h2 className="text-base font-bold">Divisão do mês</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Despesas compartilhadas: <strong>{formatCurrency(total)}</strong></p></div>
      <label className="text-sm font-semibold" htmlFor="split-month">Mês<input id="split-month" type="month" value={month} onChange={(event) => { if (event.target.value) onMonthChange(event.target.value); }} className="mt-1 block min-h-11 rounded-xl border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600" /></label>
    </div>
    <p className="text-xs text-slate-500 dark:text-slate-400">Parcelas entram pelo vencimento; compras avulsas no cartão, pelo vencimento da fatura; demais despesas, pela competência. Acertos e dívidas de todos os meses ficam no saldo acumulado abaixo.</p>
    {warnings.length > 0 && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">{warnings.length} compra(s) com parcelas ou rateios inconsistentes não entraram no resumo. Confira os registros antes de usar os totais.</p>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {[...responsibilities].map(([id, amount]) => <article key={id} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700"><h3 className="break-words text-sm font-bold">{getName(id)}</h3><p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Responsabilidade no mês</p><p className="mt-1 text-lg font-bold">{formatCurrency(amount)}</p></article>)}
    </div>
    {responsibilities.size === 2 && (() => {
      const entries = [...responsibilities].sort((a, b) => toCents(b[1]) - toCents(a[1]) || a[0].localeCompare(b[0]));
      return <p className="text-xs text-slate-500 dark:text-slate-400">Diferença entre responsabilidades: {formatCurrency(entries[0][1])} − {formatCurrency(entries[1][1])} = <strong>{formatCurrency(fromCents(toCents(entries[0][1]) - toCents(entries[1][1])))}</strong>. Essa comparação não considera quem pagou cada despesa; confira a compensação abaixo.</p>;
    })()}
    {items.length > 0 && <div className="space-y-3 rounded-2xl border border-teal-200 p-4 dark:border-teal-900">
      <h3 className="text-sm font-bold">Compensação das despesas do mês</h3>
      <p className="text-xs text-slate-500 dark:text-slate-400">Considera quem pagou, a responsabilidade de cada participante e as parcelas já repassadas. Acertos avulsos ficam somente no saldo acumulado, pois não possuem vínculo com um mês de despesas.</p>
      {debts.map(d => <p key={`${d.from_member_id}:${d.to_member_id}`} className="break-words text-sm"><strong>{getName(d.from_member_id)}</strong> deve pagar <strong>{formatCurrency(d.amount)}</strong> a <strong>{getName(d.to_member_id)}</strong>.</p>)}
      {!debts.length && <p className="text-sm">Nenhum valor pendente nesta compensação mensal.</p>}
    </div>}
    {onMarkRepayments && <button type="button" onClick={onMarkRepayments} className="min-h-11 rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white">Marcar parcelas repassadas até este mês</button>}
    {items.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">Nenhuma despesa com divisão neste mês.</p>}
  </section>;
}
