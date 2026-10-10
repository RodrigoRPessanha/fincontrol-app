'use client';

import React from 'react';
import { formatCurrency } from '@/lib/utils';
import { fromCents, toCents } from '@/lib/financial-engine';
import { MonthlySharedExpense } from '@/lib/financial-engine/monthly-splits';

export function MonthlySplitOverview({ month, onMonthChange, items, responsibilities, warnings, getName }: {
  month: string; onMonthChange: (month: string) => void; items: MonthlySharedExpense[];
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
    {items.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">Nenhuma despesa com divisão neste mês.</p>}
  </section>;
}
