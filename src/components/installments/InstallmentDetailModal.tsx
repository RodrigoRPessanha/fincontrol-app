'use client';

import React from 'react';
import { useFinance } from '@/lib/context/finance-context';
import { X, Layers, CheckCircle2, Calendar, CreditCard, DollarSign } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { resolveCategory } from '@/lib/financial-engine';
import { StatusBadge } from '../shared/StatusBadge';
import { Purchase, Installment } from '@/lib/types';

interface InstallmentDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  purchase: Purchase | null;
  onPayInstallment: (inst: Installment, purchase: Purchase) => void;
}

export function InstallmentDetailModal({
  isOpen,
  onClose,
  purchase,
  onPayInstallment,
}: InstallmentDetailModalProps) {
  const { installments, allWorkspaceCreditCards, allWorkspaceCategories } = useFinance();

  if (!isOpen || !purchase) return null;

  const card = allWorkspaceCreditCards.find((c) => c.id === purchase.credit_card_id);
  const cat = resolveCategory(allWorkspaceCategories, purchase.category_id);
  const purchaseInstallments = installments
    .filter((i) => i.purchase_id === purchase.id)
    .sort((a, b) => a.installment_number - b.installment_number);

  const paidCount = purchaseInstallments.filter((i) => i.status === 'paid').length;
  const totalPaid = purchaseInstallments.reduce((acc, i) => acc + (i.paid_amount || (i.status === 'paid' ? i.amount : 0)), 0);
  const remaining = Math.max(0, purchase.total_amount - totalPaid);
  const progressPercent = Math.min(100, Math.round((totalPaid / purchase.total_amount) * 100));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900 border border-slate-100 dark:border-slate-800 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-md shadow-indigo-600/20 font-bold text-sm">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {purchase.description}
              </h3>
              <p className="text-xs text-slate-500">
                {purchase.installment_count}x no {card?.name || 'Cartão / Carnê'}{cat.isFound ? ` • ${cat.displayName}` : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Resumo da Compra */}
        <div className="mt-4 space-y-3 rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <span className="text-[10px] font-semibold uppercase text-slate-400">Total da Compra</span>
              <p className="text-sm font-extrabold text-slate-900 dark:text-white">
                {formatCurrency(purchase.total_amount)}
              </p>
            </div>
            <div>
              <span className="text-[10px] font-semibold uppercase text-slate-400">Total Pago</span>
              <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                {formatCurrency(totalPaid)}
              </p>
            </div>
            <div>
              <span className="text-[10px] font-semibold uppercase text-slate-400">Restante</span>
              <p className="text-sm font-bold text-rose-600 dark:text-rose-400">
                {formatCurrency(remaining)}
              </p>
            </div>
          </div>

          {/* Barra de Progresso */}
          <div>
            <div className="flex justify-between text-xs font-semibold text-slate-600 dark:text-slate-300 pb-1">
              <span>{paidCount} de {purchase.installment_count} parcelas pagas</span>
              <span>{progressPercent}%</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        </div>

        {/* Lista de Todas as Parcelas */}
        <div className="mt-4 flex-1 overflow-y-auto space-y-2 pr-1">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Detalhamento das Parcelas
          </h4>

          <div className="space-y-1.5">
            {purchaseInstallments.map((inst) => {
              const isPaid = inst.status === 'paid';
              return (
                <div
                  key={inst.id}
                  className="flex items-center justify-between rounded-xl bg-white p-3 border border-slate-100 dark:bg-slate-800/40 dark:border-slate-800 text-xs"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-100 font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300 text-[11px]">
                      {inst.installment_number}
                    </span>
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-white">
                        {formatCurrency(inst.amount)}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Vencimento: {formatDate(inst.due_date)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <StatusBadge status={inst.status} />
                    {!isPaid && (
                      inst.credit_card_bill_id || purchase.credit_card_id ? (
                        <span
                          title="Parcelas de cartão devem ser pagas na fatura correspondente"
                          className="rounded-lg bg-indigo-50 px-2 py-1 text-[11px] font-bold text-indigo-600 border border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-400 dark:border-indigo-800 cursor-default"
                        >
                          Na Fatura
                        </span>
                      ) : (
                        <button
                          onClick={() => {
                            onClose();
                            onPayInstallment(inst, purchase);
                          }}
                          className="rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-100 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800"
                        >
                          Pagar
                        </button>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end pt-4 border-t border-slate-100 dark:border-slate-800 mt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-100 px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
