'use client';

import React from 'react';
import { MemberNetBalance } from '@/lib/financial-engine';
import { Purchase, WorkspaceMember } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import { Users } from 'lucide-react';

export interface MemberBalancesProps {
  balances: MemberNetBalance[];
  currentMembers: WorkspaceMember[];
  getMemberName: (id?: string | null) => string;
  participantsCount?: number;
  purchases?: Purchase[];
}

export function MemberBalances({
  balances,
  currentMembers,
  getMemberName,
  participantsCount,
  purchases = [],
}: MemberBalancesProps) {
  const count = participantsCount !== undefined ? participantsCount : currentMembers.length;

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            Balanço Individual por Participante
          </h2>
        </div>
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
          {count} participante{count > 1 ? 's' : ''}
        </span>
      </div>

      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">As despesas atribuídas incluem valores pendentes e parcelas futuras; não são o total quitado na conta ou fatura. Repasses e acertos abaixo explicam o saldo entre participantes.</p>
      <div
        className={`mt-4 grid gap-4 ${
          count === 1
            ? 'grid-cols-1'
            : count === 2
            ? 'grid-cols-1 md:grid-cols-2'
            : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
        }`}
      >
        {balances.map((b) => {
          const isCreditor = b.net_balance > 0;
          const isDebtor = b.net_balance < 0;
          const participantId = b.participant_id || b.member_id;
          const memberName = b.name || getMemberName(participantId);

          return (
            <div
              key={participantId}
              className={`rounded-2xl border p-5 transition ${
                isCreditor
                  ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/50 dark:bg-emerald-950/20'
                  : isDebtor
                  ? 'border-rose-200 bg-rose-50/40 dark:border-rose-900/50 dark:bg-rose-950/20'
                  : 'border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-800/40'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="break-words text-sm font-bold text-slate-900 dark:text-white">
                    {memberName}
                  </span>
                  {b.participant_type === 'person' && (
                    <span className="shrink-0 rounded bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                      Pessoa
                    </span>
                  )}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
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
                  <span>Despesas atribuídas:</span>
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

              <dl className="mt-3 space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
                <div className="flex flex-wrap justify-between gap-2"><dt>Repasses enviados:</dt><dd className="font-semibold">{formatCurrency(b.repayments_sent || 0)}</dd></div>
                <div className="flex flex-wrap justify-between gap-2"><dt>Repasses recebidos:</dt><dd className="font-semibold">{formatCurrency(b.repayments_received || 0)}</dd></div>
                <div className="flex flex-wrap justify-between gap-2"><dt>Acertos enviados:</dt><dd className="font-semibold">{formatCurrency(b.settlements_sent || 0)}</dd></div>
                <div className="flex flex-wrap justify-between gap-2"><dt>Acertos recebidos:</dt><dd className="font-semibold">{formatCurrency(b.settlements_received || 0)}</dd></div>
              </dl>
              <ul className="mt-3 space-y-1 text-xs text-slate-500 dark:text-slate-400">
                {purchases.flatMap((purchase) => (purchase.splits || []).filter((share) => {
                  const id = share.person_id || share.member_id;
                  const payer = purchase.paid_by_person_id || purchase.paid_by_member_id;
                  return (share.repaid_installments_count || 0) > 0 && id !== payer && (id === participantId || payer === participantId);
                }).map((share) => <li key={`${purchase.id}:${share.person_id || share.member_id}`} className="break-words">{purchase.description}: {share.repaid_installments_count} de {purchase.installment_count} parcelas repassadas • {formatCurrency(share.repaid_amount || 0)}</li>))}
              </ul>
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
