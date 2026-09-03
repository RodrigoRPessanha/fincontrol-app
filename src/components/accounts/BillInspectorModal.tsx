'use client';

import React from 'react';
import { useFinance } from '@/lib/context/finance-context';
import { X, CreditCard, Calendar, CheckCircle, AlertCircle, DollarSign } from 'lucide-react';
import { formatCurrency, formatDate, formatMonthYear } from '@/lib/utils';
import { StatusBadge } from '../shared/StatusBadge';
import { CreditCardBill } from '@/lib/types';

interface BillInspectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  bill: CreditCardBill | null;
  onPayBill: (bill: CreditCardBill) => void;
}

export function BillInspectorModal({ isOpen, onClose, bill, onPayBill }: BillInspectorModalProps) {
  const { allWorkspaceCreditCards, transactions, installments, purchases } = useFinance();

  if (!isOpen || !bill) return null;

  const card = allWorkspaceCreditCards.find((c) => c.id === bill.credit_card_id);

  // Transações avulsas nesta fatura
  const billTransactions = transactions.filter((t) => t.credit_card_bill_id === bill.id);

  // Parcelas nesta fatura
  const billInstallments = installments.filter((i) => i.credit_card_bill_id === bill.id);

  const remaining = Math.max(0, bill.total_amount - (bill.paid_amount || 0));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900 border border-slate-100 dark:border-slate-800 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-md shadow-indigo-600/20">
              <CreditCard className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Fatura {formatMonthYear(bill.reference_month)}
              </h3>
              <p className="text-xs text-slate-500">{card?.name || 'Cartão de Crédito'}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Info Grid */}
        <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-slate-50 p-3.5 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
          <div>
            <span className="text-[10px] font-semibold uppercase text-slate-400">Total Fatura</span>
            <p className="text-sm font-extrabold text-slate-900 dark:text-white">
              {formatCurrency(bill.total_amount)}
            </p>
          </div>
          <div>
            <span className="text-[10px] font-semibold uppercase text-slate-400">Fechamento</span>
            <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
              {formatDate(bill.closing_date)}
            </p>
          </div>
          <div>
            <span className="text-[10px] font-semibold uppercase text-slate-400">Vencimento</span>
            <p className="text-xs font-bold text-rose-600 dark:text-rose-400">
              {formatDate(bill.due_date)}
            </p>
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between px-1">
          <StatusBadge status={bill.status} />
          {bill.status !== 'paid' && (
            <span className="text-xs font-medium text-slate-500">
              Restante: <strong className="text-rose-600">{formatCurrency(remaining)}</strong>
            </span>
          )}
        </div>

        {/* Items List inside Bill */}
        <div className="mt-4 flex-1 overflow-y-auto space-y-2 pr-1">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Lançamentos desta fatura ({billTransactions.length + billInstallments.length})
          </h4>

          {billTransactions.length === 0 && billInstallments.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              Nenhum lançamento registrado nesta fatura.
            </div>
          ) : (
            <>
              {/* Parcelas */}
              {billInstallments.map((inst) => {
                const purchase = purchases.find((p) => p.id === inst.purchase_id);
                return (
                  <div
                    key={inst.id}
                    className="flex items-center justify-between rounded-xl bg-white p-3 border border-slate-100 dark:bg-slate-800/40 dark:border-slate-800 text-xs"
                  >
                    <div>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {purchase?.description || 'Compra Parcelada'}
                      </span>
                      <div className="text-[11px] text-slate-400">
                        Parcela {inst.installment_number} de {purchase?.installment_count || '?'}
                      </div>
                    </div>
                    <span className="font-bold text-slate-900 dark:text-white">
                      {formatCurrency(inst.amount)}
                    </span>
                  </div>
                );
              })}

              {/* Transações avulsas */}
              {billTransactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between rounded-xl bg-white p-3 border border-slate-100 dark:bg-slate-800/40 dark:border-slate-800 text-xs"
                >
                  <div>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {tx.description}
                    </span>
                    <div className="text-[11px] text-slate-400">Compra avulsa em {formatDate(tx.transaction_date)}</div>
                  </div>
                  <span className="font-bold text-slate-900 dark:text-white">
                    {formatCurrency(tx.amount)}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 dark:border-slate-800 mt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            Fechar
          </button>
          {bill.status !== 'paid' && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onPayBill(bill);
              }}
              className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2 text-sm font-bold text-white shadow-md shadow-emerald-600/20 hover:bg-emerald-500"
            >
              <DollarSign className="h-4 w-4" />
              <span>Pagar Fatura</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
