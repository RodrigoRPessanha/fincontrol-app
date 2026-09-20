'use client';

import React from 'react';
import { SplitType, TransactionSplit, WorkspaceMember } from '@/lib/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import { CreditCard } from 'lucide-react';

export interface SharedExpenseItem {
  id: string;
  description: string;
  amount: number;
  date: string;
  paid_by_member_id?: string | null;
  split_type?: SplitType | null;
  splits: TransactionSplit[];
  isPurchase: boolean;
  installmentCount: number;
}

export interface SharedExpensesListProps {
  splitItems: SharedExpenseItem[];
  currentMembers: WorkspaceMember[];
  getMemberName: (id?: string | null) => string;
}

export function SharedExpensesList({
  splitItems,
  currentMembers,
  getMemberName,
}: SharedExpensesListProps) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-teal-600 dark:text-teal-400" />
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            Despesas com Rateio Registradas
          </h2>
        </div>
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
          {splitItems.length} despesa{splitItems.length !== 1 ? 's' : ''}
        </span>
      </div>

      {splitItems.length === 0 ? (
        <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
          Nenhuma despesa dividida registrada ainda. Adicione despesas com divisão no botão "Novo Registro".
        </div>
      ) : (
        <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
          {splitItems.map((item) => (
            <div key={item.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-900 dark:text-white">
                    {item.description}
                  </span>
                  <span className="rounded-md bg-teal-50 px-2 py-0.5 text-[10px] font-bold text-teal-700 dark:bg-teal-950/60 dark:text-teal-400">
                    {item.split_type === 'equal'
                      ? (currentMembers.length === 2 ? 'Divisão 50/50' : 'Divisão Igualitária')
                      : item.split_type === 'full_other'
                      ? '100% Outro'
                      : item.split_type === 'custom'
                      ? 'Personalizado'
                      : 'Rateio'}
                  </span>
                  {item.isPurchase && (
                    <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-400">
                      {item.installmentCount}x parcelado
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span>{formatDate(item.date)}</span>
                  <span>•</span>
                  <span>Pago por: <strong>{getMemberName(item.paid_by_member_id)}</strong></span>
                </div>
              </div>

              <div className="flex flex-col sm:items-end">
                <span className="text-sm font-bold text-slate-900 dark:text-white">
                  {formatCurrency(item.amount)}
                </span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {item.splits?.map((split, sIdx) => (
                    <span
                      key={sIdx}
                      className="text-[11px] rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                    >
                      {getMemberName(split.member_id)}: {formatCurrency(split.amount)}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
