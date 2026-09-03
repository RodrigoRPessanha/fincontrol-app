'use client';

import React, { useState } from 'react';
import { useFinance } from '@/lib/context/finance-context';
import {
  TrendingUp,
  Layers,
  Repeat,
  Calendar,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  ArrowUpRight,
  ShieldCheck,
  Percent,
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { calculateFutureCommitments } from '@/lib/financial-engine';

export default function PlanningPage() {
  const { installments, purchases, creditCardBills, recurring, transactions } = useFinance();

  const [horizonMonths, setHorizonMonths] = useState<3 | 6 | 12>(6);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  // Calcula projeção
  const commitments = calculateFutureCommitments(
    installments.map((i) => ({
      ...i,
      purchase: purchases.find((p) => p.id === i.purchase_id),
      bill: creditCardBills.find((b) => b.id === i.credit_card_bill_id),
    })),
    recurring,
    transactions,
    horizonMonths,
    new Date(),
    creditCardBills
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Planejamento & Comprometimento Futuro
          </h2>
          <p className="text-xs text-slate-500">
            Descubra quanto da sua renda futura já está contratada em parcelas, fixos e obrigações.
          </p>
        </div>

        {/* Horizon Selector (3, 6, 12 meses) */}
        <div className="flex items-center gap-1 rounded-2xl bg-white p-1 shadow-sm border border-slate-200 dark:border-slate-800 dark:bg-slate-900 self-start sm:self-auto">
          <button
            onClick={() => setHorizonMonths(3)}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
              horizonMonths === 3
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
            }`}
          >
            Próximos 3 meses
          </button>
          <button
            onClick={() => setHorizonMonths(6)}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
              horizonMonths === 6
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
            }`}
          >
            6 meses
          </button>
          <button
            onClick={() => setHorizonMonths(12)}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
              horizonMonths === 12
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
            }`}
          >
            12 meses (1 ano)
          </button>
        </div>
      </div>

      {/* Grid de Meses Projetados */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {commitments.map((c) => {
          const isExpanded = expandedMonth === c.monthKey;
          const commitmentRate =
            c.expectedIncome > 0 ? Math.round((c.totalCommitment / c.expectedIncome) * 100) : 0;

          return (
            <div
              key={c.monthKey}
              className="flex flex-col justify-between rounded-3xl bg-white p-5 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800 transition hover:shadow-md"
            >
              <div>
                {/* Header do Mês */}
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-emerald-600" />
                    <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                      {c.monthLabel}
                    </h3>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold border ${
                      commitmentRate > 80
                        ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400'
                        : commitmentRate > 50
                        ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400'
                    }`}
                  >
                    {commitmentRate}% Comprometido
                  </span>
                </div>

                {/* Total Comprometido */}
                <div className="mt-4">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Total Já Comprometido
                  </span>
                  <div className="text-2xl font-black text-rose-600 dark:text-rose-400">
                    {formatCurrency(c.totalCommitment)}
                  </div>
                </div>

                {/* Discriminação por Categoria de Obrigação */}
                <div className="mt-4 space-y-2 text-xs">
                  {/* Parcelas */}
                  <div className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/40">
                    <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                      <Layers className="h-3.5 w-3.5 text-indigo-500" />
                      <span>Parcelas de Compras</span>
                    </div>
                    <span className="font-bold text-slate-900 dark:text-white">
                      {formatCurrency(c.installmentsAmount)}
                    </span>
                  </div>

                  {/* Gastos Fixos / Recorrentes */}
                  <div className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/40">
                    <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                      <Repeat className="h-3.5 w-3.5 text-blue-500" />
                      <span>Gastos Fixos / Recorrentes</span>
                    </div>
                    <span className="font-bold text-slate-900 dark:text-white">
                      {formatCurrency(c.recurringAmount)}
                    </span>
                  </div>

                  {/* Receita Prevista & Saldo Livre */}
                  <div className="flex items-center justify-between pt-2 text-[11px] font-semibold text-slate-400">
                    <span>Receita Esperada: {formatCurrency(c.expectedIncome)}</span>
                    <span
                      className={
                        c.netForecast >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600'
                      }
                    >
                      Livre: {formatCurrency(c.netForecast)}
                    </span>
                  </div>
                </div>

                {/* Dropdown de Itens Detalhados do Mês */}
                {isExpanded && (
                  <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 dark:border-slate-800 max-h-48 overflow-y-auto pr-1">
                    <h5 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Itens previstos ({c.items.length})
                    </h5>
                    {c.items.map((item, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between text-[11px] py-1 border-b border-slate-50 dark:border-slate-800/40"
                      >
                        <span className="truncate max-w-[180px] text-slate-700 dark:text-slate-300">
                          {item.title}
                        </span>
                        <span className="font-bold text-slate-900 dark:text-white">
                          {formatCurrency(item.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Botão de Expandir Itens */}
              <button
                onClick={() => setExpandedMonth(isExpanded ? null : c.monthKey)}
                className="mt-4 flex w-full items-center justify-center gap-1 rounded-xl bg-slate-100 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
              >
                <span>{isExpanded ? 'Recolher detalhes' : 'Ver todos os lançamentos'}</span>
                {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
