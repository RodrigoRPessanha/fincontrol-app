'use client';

import React from 'react';
import { WorkspaceMember } from '@/lib/types';
import { PairwiseDebt } from '@/lib/financial-engine';
import { formatCurrency } from '@/lib/utils';
import { Scale, X, AlertCircle } from 'lucide-react';

export interface SettlementModalProps {
  isOpen: boolean;
  onClose: () => void;
  fromMemberId: string;
  setFromMemberId: (id: string) => void;
  toMemberId: string;
  setToMemberId: (id: string) => void;
  settlementAmountStr: string;
  setSettlementAmountStr: (val: string) => void;
  settlementDate: string;
  setSettlementDate: (val: string) => void;
  settlementNotes: string;
  setSettlementNotes: (val: string) => void;
  settlementError: string | null;
  currentMembers: WorkspaceMember[];
  selectedPairDebt: PairwiseDebt | null;
  onSubmit: (e: React.FormEvent) => void;
}

export function SettlementModal({
  isOpen,
  onClose,
  fromMemberId,
  setFromMemberId,
  toMemberId,
  setToMemberId,
  settlementAmountStr,
  setSettlementAmountStr,
  settlementDate,
  setSettlementDate,
  settlementNotes,
  setSettlementNotes,
  settlementError,
  currentMembers,
  selectedPairDebt,
  onSubmit,
}: SettlementModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-600 text-white font-bold shadow-md shadow-teal-500/20">
              <Scale className="h-5 w-5" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              Registrar Acerto de Contas
            </h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {settlementError && (
          <div className="mt-4 flex items-center gap-2 rounded-2xl bg-rose-50 p-3 text-xs font-semibold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{settlementError}</span>
          </div>
        )}

        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Quem está pagando?
              </label>
              <select
                value={fromMemberId}
                onChange={(e) => setFromMemberId(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                <option value="">Selecione...</option>
                {currentMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.user?.name || m.user?.email?.split('@')[0] || m.id}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Quem está recebendo?
              </label>
              <select
                value={toMemberId}
                onChange={(e) => setToMemberId(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                <option value="">Selecione...</option>
                {currentMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.user?.name || m.user?.email?.split('@')[0] || m.id}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {fromMemberId && toMemberId && fromMemberId !== toMemberId && (
            <div className={`rounded-xl p-2.5 text-xs ${
              selectedPairDebt && selectedPairDebt.amount > 0
                ? 'bg-amber-50 text-amber-900 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900/60'
                : 'bg-slate-50 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
            }`}>
              {selectedPairDebt && selectedPairDebt.amount > 0 ? (
                <div className="flex items-center justify-between">
                  <span>Dívida máxima: <strong>{formatCurrency(selectedPairDebt.amount)}</strong></span>
                  <button
                    type="button"
                    onClick={() => setSettlementAmountStr(selectedPairDebt.amount.toFixed(2))}
                    className="font-bold text-teal-600 hover:underline dark:text-teal-400 ml-2"
                  >
                    Preencher total
                  </button>
                </div>
              ) : (
                <span>Não há débito pendente nesta direção.</span>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Valor do Acerto (R$)
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              max={selectedPairDebt ? selectedPairDebt.amount : undefined}
              required
              placeholder="0,00"
              value={settlementAmountStr}
              onChange={(e) => setSettlementAmountStr(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-bold text-slate-900 focus:border-teal-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Data da Liquidação
            </label>
            <input
              type="date"
              required
              value={settlementDate}
              onChange={(e) => setSettlementDate(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Observações (Opcional)
            </label>
            <textarea
              rows={2}
              placeholder="Ex: Pix referente a contas do mês..."
              value={settlementNotes}
              onChange={(e) => setSettlementNotes(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-2 text-xs text-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!selectedPairDebt || selectedPairDebt.amount <= 0}
              className="rounded-xl bg-teal-600 px-5 py-2 text-xs font-bold text-white shadow-md shadow-teal-600/25 transition hover:bg-teal-500 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Confirmar Acerto
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
