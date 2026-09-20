'use client';

import React from 'react';
import { WorkspaceMember, SplitType, TransactionSplit } from '@/lib/types';
import { Users } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { calculateExpenseSplits } from '@/lib/financial-engine';

export interface SplitFieldsProps {
  type: 'expense' | 'income' | 'transfer';
  workspaceMembers: WorkspaceMember[];
  paidByMemberId: string;
  onPaidByMemberIdChange: (id: string) => void;
  splitType: SplitType;
  onSplitTypeChange: (type: SplitType) => void;
  customSplits: Record<string, number>;
  onCustomSplitChange: (memberId: string, amount: number) => void;
  numAmount: number;
}

export function SplitFields({
  type,
  workspaceMembers,
  paidByMemberId,
  onPaidByMemberIdChange,
  splitType,
  onSplitTypeChange,
  customSplits,
  onCustomSplitChange,
  numAmount,
}: SplitFieldsProps) {
  if (type !== 'expense' || workspaceMembers.length <= 1) return null;

  const effectivePayerId = paidByMemberId || workspaceMembers[0]?.id;

  let previewSplits: TransactionSplit[] = [];
  let previewError: string | null = null;
  if (splitType !== 'individual' && numAmount > 0) {
    try {
      const customList = splitType === 'custom'
        ? workspaceMembers.map((m) => ({ member_id: m.id, amount: customSplits[m.id] || 0 }))
        : undefined;
      if (effectivePayerId) {
        previewSplits = calculateExpenseSplits(numAmount, splitType, workspaceMembers, effectivePayerId, customList);
      }
    } catch (e: any) {
      previewError = e.message;
    }
  }

  return (
    <div className="rounded-2xl border border-teal-200/80 bg-teal-50/50 p-4 dark:border-teal-900/50 dark:bg-teal-950/20">
      <div className="flex items-center justify-between pb-2 mb-3 border-b border-teal-200/60 dark:border-teal-900/60">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-teal-600 dark:text-teal-400" />
          <span className="text-xs font-bold uppercase tracking-wider text-teal-900 dark:text-teal-300">
            Divisão de Despesa (Rateio)
          </span>
        </div>
        <span className="text-[11px] text-teal-700 dark:text-teal-400 font-medium">
          {workspaceMembers.length} membros no workspace
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Quem pagou? */}
        <div>
          <label className="block text-[11px] font-semibold text-teal-900 dark:text-teal-300">
            Quem pagou?
          </label>
          <select
            value={paidByMemberId || (workspaceMembers[0]?.id ?? '')}
            onChange={(e) => onPaidByMemberIdChange(e.target.value)}
            className="mt-1 w-full rounded-xl border border-teal-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:outline-none dark:border-teal-800 dark:bg-slate-900 dark:text-white"
          >
            {workspaceMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.user?.name || m.user?.email?.split('@')[0] || `Membro ${m.id.substring(0, 4)}`} {m.role === 'owner' ? '(Owner)' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Como dividir? */}
        <div>
          <label className="block text-[11px] font-semibold text-teal-900 dark:text-teal-300">
            Regra de Divisão
          </label>
          <select
            value={splitType}
            onChange={(e) => onSplitTypeChange(e.target.value as SplitType)}
            className="mt-1 w-full rounded-xl border border-teal-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:outline-none dark:border-teal-800 dark:bg-slate-900 dark:text-white"
          >
            <option value="individual">Sem divisão (100% de quem pagou)</option>
            <option value="equal">
              {workspaceMembers.length === 2 ? 'Dividir igualmente (50/50)' : 'Dividir igualmente (entre todos)'}
            </option>
            <option value="full_other">100% de outra pessoa (compra em nome de outro)</option>
            <option value="custom">Personalizado (definir valores)</option>
          </select>
        </div>
      </div>

      {/* Preview dos valores calculados */}
      {splitType !== 'individual' && numAmount > 0 && (
        <div className="mt-3 pt-3 border-t border-teal-200/60 dark:border-teal-900/60">
          <div className="text-[11px] font-bold uppercase tracking-wider text-teal-800 dark:text-teal-300 mb-1.5">
            Responsabilidade de cada membro:
          </div>
          {splitType === 'custom' ? (
            <div className="space-y-1.5">
              {workspaceMembers.map((m) => {
                const memberName = m.user?.name || m.user?.email?.split('@')[0] || `Membro ${m.id.substring(0, 4)}`;
                const isPayer = m.id === effectivePayerId;
                return (
                  <div key={m.id} className="flex items-center justify-between text-xs bg-white dark:bg-slate-900 p-2 rounded-xl border border-teal-200 dark:border-teal-900">
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      {memberName} {isPayer && <span className="text-[10px] text-teal-600 font-bold">(Pagador)</span>}
                    </span>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400 text-xs">R$</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0,00"
                        value={customSplits[m.id] ?? ''}
                        onChange={(e) => {
                          const val = Math.max(0, parseFloat(e.target.value) || 0);
                          onCustomSplitChange(m.id, val);
                        }}
                        className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-right text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </div>
                  </div>
                );
              })}
              {previewError && (
                <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 mt-1">
                  {previewError}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              {workspaceMembers.map((m) => {
                const memberName = m.user?.name || m.user?.email?.split('@')[0] || `Membro ${m.id.substring(0, 4)}`;
                const isPayer = m.id === effectivePayerId;
                const splitItem = previewSplits.find((s) => s.member_id === m.id);
                const shareAmount = splitItem ? splitItem.amount : 0;

                return (
                  <div key={m.id} className="flex items-center justify-between text-xs bg-white/70 dark:bg-slate-900/70 px-2.5 py-1.5 rounded-lg">
                    <span className="text-slate-700 dark:text-slate-300">
                      {memberName} {isPayer && <span className="text-[10px] text-teal-600 font-bold">(Pagou)</span>}
                    </span>
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {formatCurrency(shareAmount)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
