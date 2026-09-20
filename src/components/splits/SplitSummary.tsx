'use client';

import React from 'react';
import { PairwiseDebt } from '@/lib/financial-engine';
import { formatCurrency } from '@/lib/utils';
import { Scale, Check, ArrowRight } from 'lucide-react';

export interface SplitSummaryProps {
  pairwiseDebts: PairwiseDebt[];
  getMemberName: (id?: string | null) => string;
  onOpenSettleDebt: (debtFrom: string, debtTo: string, amount: number) => void;
}

export function SplitSummary({
  pairwiseDebts,
  getMemberName,
  onOpenSettleDebt,
}: SplitSummaryProps) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <Scale className="h-5 w-5 text-teal-600 dark:text-teal-400" />
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            Acertos de Contas Sugeridos (Compensação Líquida)
          </h2>
        </div>
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
          {pairwiseDebts.length === 0
            ? 'Tudo em dia'
            : `${pairwiseDebts.length} acerto${pairwiseDebts.length > 1 ? 's' : ''} pendente${pairwiseDebts.length > 1 ? 's' : ''}`}
        </span>
      </div>

      {pairwiseDebts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400 mb-3">
            <Check className="h-6 w-6" />
          </div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            Todas as contas estão acertadas!
          </h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-sm">
            Não há dívidas pendentes ou desequilíbrio financeiro registrado entre os membros deste workspace.
          </p>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {pairwiseDebts.map((debt, idx) => (
            <div
              key={idx}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-amber-200/80 bg-amber-50/40 p-4 dark:border-amber-900/50 dark:bg-amber-950/20"
            >
              <div className="flex items-center gap-3">
                <div className="flex flex-col">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Devedor</span>
                  <span className="text-sm font-bold text-slate-900 dark:text-white">
                    {getMemberName(debt.from_member_id)}
                  </span>
                </div>

                <div className="flex flex-col items-center px-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">deve</span>
                  <ArrowRight className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                </div>

                <div className="flex flex-col">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Credor</span>
                  <span className="text-sm font-bold text-slate-900 dark:text-white">
                    {getMemberName(debt.to_member_id)}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-amber-200/60 dark:border-amber-900/60">
                <span className="text-base font-extrabold text-amber-700 dark:text-amber-300">
                  {formatCurrency(debt.amount)}
                </span>
                <button
                  onClick={() => onOpenSettleDebt(debt.from_member_id, debt.to_member_id, debt.amount)}
                  className="rounded-xl bg-teal-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-teal-500 active:scale-95"
                >
                  Liquidar Agora
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
