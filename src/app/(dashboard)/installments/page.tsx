'use client';

import React, { useState } from 'react';
import { useFinance } from '@/lib/context/finance-context';
import {
  Layers,
  Plus,
  CreditCard,
  Calendar,
  CheckCircle2,
  Clock,
  ChevronRight,
  TrendingUp,
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { resolveCategory } from '@/lib/financial-engine';
import { InstallmentDetailModal } from '@/components/installments/InstallmentDetailModal';
import { PaymentModal } from '@/components/transactions/PaymentModal';
import { Installment, Purchase } from '@/lib/types';
import { QuickAddModal } from '@/components/transactions/QuickAddModal';

export default function InstallmentsPage() {
  const { purchases, installments, allWorkspaceCreditCards, allWorkspaceCategories } = useFinance();

  const [selectedPurchase, setSelectedPurchase] = useState<Purchase | null>(null);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [paymentTarget, setPaymentTarget] = useState<{
    type: 'installment';
    id: string;
    title: string;
    totalAmount: number;
    paidAmount: number;
    dueDate?: string;
  } | null>(null);

  // Totais agregados
  const totalPurchasesAmount = purchases.reduce((acc, p) => acc + p.total_amount, 0);

  const totalPaidAll = installments.reduce((acc, i) => {
    return acc + (i.paid_amount || (i.status === 'paid' ? i.amount : 0));
  }, 0);

  const totalRemainingAll = Math.max(0, totalPurchasesAmount - totalPaidAll);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Compras Parceladas & Carnês
          </h2>
          <p className="text-xs text-slate-500">
            Acompanhe o progresso de cada parcelamento sem perder o controle dos próximos meses.
          </p>
        </div>

        <button
          onClick={() => setIsQuickAddOpen(true)}
          className="flex items-center gap-1.5 rounded-2xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-600/25 transition hover:bg-indigo-500 self-start sm:self-auto"
        >
          <Plus className="h-4 w-4 stroke-[2.5]" />
          <span>Nova Compra Parcelada</span>
        </button>
      </div>

      {/* Resumo Geral dos Parcelamentos */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-3xl bg-white p-5 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Total Contratado</span>
          <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">
            {formatCurrency(totalPurchasesAmount)}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">{purchases.length} compras parceladas ativas</p>
        </div>

        <div className="rounded-3xl bg-white p-5 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Total Já Quitado</span>
          <div className="mt-2 text-2xl font-black text-emerald-600 dark:text-emerald-400">
            {formatCurrency(totalPaidAll)}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            {totalPurchasesAmount > 0
              ? `${Math.round((totalPaidAll / totalPurchasesAmount) * 100)}% pago do total`
              : '0%'}
          </p>
        </div>

        <div className="rounded-3xl bg-white p-5 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Saldo Restante a Pagar</span>
          <div className="mt-2 text-2xl font-black text-rose-600 dark:text-rose-400">
            {formatCurrency(totalRemainingAll)}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">Compromisso financeiro futuro</p>
        </div>
      </div>

      {/* Grid de Compras Parceladas */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {purchases.map((purchase) => {
          const card = allWorkspaceCreditCards.find((c) => c.id === purchase.credit_card_id);
          const cat = resolveCategory(allWorkspaceCategories, purchase.category_id);
          const pInsts = installments.filter((i) => i.purchase_id === purchase.id);

          const paidCount = pInsts.filter((i) => i.status === 'paid').length;
          const totalPaid = pInsts.reduce(
            (acc, i) => acc + (i.paid_amount || (i.status === 'paid' ? i.amount : 0)),
            0
          );
          const remaining = Math.max(0, purchase.total_amount - totalPaid);
          const progress = Math.min(100, Math.round((totalPaid / purchase.total_amount) * 100));

          return (
            <div
              key={purchase.id}
              onClick={() => setSelectedPurchase(purchase)}
              className="cursor-pointer flex flex-col justify-between rounded-3xl bg-white p-6 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800 transition hover:shadow-md hover:border-indigo-300 dark:hover:border-indigo-800"
            >
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 font-bold text-xs dark:bg-indigo-950/50 dark:text-indigo-400">
                      <Layers className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                        {purchase.description}
                      </h3>
                      <span className="text-[11px] text-slate-400">
                        {card?.name || 'Carnê / Outro'} • {formatDate(purchase.purchase_date)}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </div>

                <div className="mt-4 flex items-center justify-between text-xs">
                  <span className="text-slate-500">Valor da Parcela:</span>
                  <span className="font-extrabold text-slate-900 dark:text-white">
                    {purchase.installment_count}x de {formatCurrency(purchase.total_amount / purchase.installment_count)}
                  </span>
                </div>

                {/* Barra de Progresso Real */}
                <div className="mt-3 space-y-1">
                  <div className="flex justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
                    <span>
                      {paidCount} de {purchase.installment_count} parcelas pagas
                    </span>
                    <span>{progress}%</span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>

                {/* Métricas Financeiras */}
                <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-slate-50 p-3 text-xs dark:bg-slate-800/40">
                  <div>
                    <span className="text-[10px] text-slate-400 font-semibold uppercase">Já Pago:</span>
                    <p className="font-bold text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(totalPaid)}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-semibold uppercase">Restante:</span>
                    <p className="font-bold text-rose-600 dark:text-rose-400">
                      {formatCurrency(remaining)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-center text-xs font-bold text-indigo-600 hover:underline">
                Visualizar Todas as Parcelas →
              </div>
            </div>
          );
        })}
      </div>

      {/* Modais */}
      <InstallmentDetailModal
        isOpen={!!selectedPurchase}
        onClose={() => setSelectedPurchase(null)}
        purchase={selectedPurchase}
        onPayInstallment={(inst, pur) => {
          setPaymentTarget({
            type: 'installment',
            id: inst.id,
            title: `${pur.description} (${inst.installment_number}/${pur.installment_count})`,
            totalAmount: inst.amount,
            paidAmount: inst.paid_amount || 0,
            dueDate: inst.due_date,
          });
        }}
      />

      <PaymentModal
        isOpen={!!paymentTarget}
        onClose={() => setPaymentTarget(null)}
        target={paymentTarget}
      />

      <QuickAddModal isOpen={isQuickAddOpen} onClose={() => setIsQuickAddOpen(false)} />
    </div>
  );
}
