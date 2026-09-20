'use client';

import React from 'react';
import { Settlement } from '@/lib/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import { History, Check, Trash2 } from 'lucide-react';

export interface SettlementHistoryProps {
  workspaceSettlements: Settlement[];
  getMemberName: (id?: string | null) => string;
  onDeleteSettlement: (id: string) => void;
}

export function SettlementHistory({
  workspaceSettlements,
  getMemberName,
  onDeleteSettlement,
}: SettlementHistoryProps) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-teal-600 dark:text-teal-400" />
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            Histórico de Acertos Concluídos
          </h2>
        </div>
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
          {workspaceSettlements.length} liquidação{workspaceSettlements.length !== 1 ? 'ões' : ''}
        </span>
      </div>

      {workspaceSettlements.length === 0 ? (
        <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
          Nenhum acerto de contas liquidado ainda.
        </div>
      ) : (
        <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
          {workspaceSettlements.map((s) => (
            <div key={s.id} className="py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
                  <Check className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900 dark:text-white">
                    {getMemberName(s.from_member_id)} pagou {getMemberName(s.to_member_id)}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {formatDate(s.settlement_date)} {s.notes ? `• ${s.notes}` : ''}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(s.amount)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm('Deseja realmente excluir este registro de acerto? O balanço líquido será recalculado.')) {
                      onDeleteSettlement(s.id);
                    }
                  }}
                  title="Excluir acerto"
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 transition"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
