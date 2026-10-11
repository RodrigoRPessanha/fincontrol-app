import React from 'react';

export function RepaymentCountFields({ participants, total, counts, onChange }: {
  participants: { id: string; name: string }[]; total: number; counts: Record<string, number>;
  onChange: (id: string, count: number) => void;
}) {
  return <div className="mt-4 space-y-3 border-t border-teal-200 pt-4 dark:border-teal-900">
    <h3 className="text-sm font-bold">Parcelas já repassadas por pessoa</h3>
    <p className="text-xs text-slate-500 dark:text-slate-400">Informe quantas das primeiras parcelas cada pessoa já lhe repassou. Isso reduz o saldo acumulado a acertar, sem pagar novamente a fatura nem movimentar contas. Não inclua valores já registrados em acertos.</p>
    {participants.map((person) => <label key={person.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="break-words">{person.name}</span><select aria-label={`Parcelas repassadas por ${person.name}`} value={counts[person.id] || 0} onChange={(event) => onChange(person.id, Number(event.target.value))} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 dark:border-slate-600 dark:bg-slate-900">
        {Array.from({ length: total + 1 }, (_, count) => <option key={count} value={count}>{count} de {total}</option>)}
      </select>
    </label>)}
  </div>;
}
