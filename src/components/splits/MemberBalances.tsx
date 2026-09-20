'use client';

import React from 'react';
import { MemberNetBalance } from '@/lib/financial-engine';
import { WorkspaceMember } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import { Users } from 'lucide-react';

export interface MemberBalancesProps {
  balances: MemberNetBalance[];
  currentMembers: WorkspaceMember[];
  getMemberName: (id?: string | null) => string;
}

export function MemberBalances({
  balances,
  currentMembers,
  getMemberName,
}: MemberBalancesProps) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            Balanço Individual por Membro
          </h2>
        </div>
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
          {currentMembers.length} membro{currentMembers.length > 1 ? 's' : ''} participante{currentMembers.length > 1 ? 's' : ''}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {balances.map((b) => {
          const isCreditor = b.net_balance > 0;
          const isDebtor = b.net_balance < 0;
          const memberName = getMemberName(b.member_id);

          return (
            <div
              key={b.member_id}
              className={`rounded-2xl border p-4.5 transition ${
                isCreditor
                  ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/50 dark:bg-emerald-950/20'
                  : isDebtor
                  ? 'border-rose-200 bg-rose-50/40 dark:border-rose-900/50 dark:bg-rose-950/20'
                  : 'border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-800/40'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-slate-900 dark:text-white">
                  {memberName}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                    isCreditor
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
                      : isDebtor
                      ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300'
                      : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                  }`}
                >
                  {isCreditor ? 'A Receber' : isDebtor ? 'A Pagar' : 'Equilibrado'}
                </span>
              </div>

              <div className="mt-3 space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
                <div className="flex justify-between">
                  <span>Total pago nos registros:</span>
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {formatCurrency(b.total_paid)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Sua responsabilidade:</span>
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {formatCurrency(b.total_share)}
                  </span>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Saldo Líquido:
                </span>
                <span
                  className={`text-base font-extrabold ${
                    isCreditor
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : isDebtor
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {isCreditor ? `+${formatCurrency(b.net_balance)}` : formatCurrency(b.net_balance)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
