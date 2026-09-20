'use client';

import React from 'react';
import { CreditCard, PaymentMethod } from '@/lib/types';
import { CreditCard as CreditCardIcon } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

export interface InstallmentFieldsProps {
  isCreditCardSelected: boolean;
  selectedPaymentMethod: PaymentMethod | undefined;
  creditCards: CreditCard[];
  selectedCreditCardId: string;
  onSelectedCreditCardIdChange: (id: string) => void;
  installmentCount: number;
  onInstallmentCountChange: (count: number) => void;
  paidInstallmentsCount: number;
  onPaidInstallmentsCountChange: (count: number) => void;
  numAmount: number;
  billPreview: { referenceMonth: string; dueDate: string } | null;
  pendingBalancePreview: number;
}

export function InstallmentFields({
  isCreditCardSelected,
  selectedPaymentMethod,
  creditCards,
  selectedCreditCardId,
  onSelectedCreditCardIdChange,
  installmentCount,
  onInstallmentCountChange,
  paidInstallmentsCount,
  onPaidInstallmentsCountChange,
  numAmount,
  billPreview,
  pendingBalancePreview,
}: InstallmentFieldsProps) {
  if (!isCreditCardSelected) return null;

  return (
    <div className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-3.5 dark:border-indigo-900 dark:bg-indigo-950/40">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-bold text-indigo-900 dark:text-indigo-300">
          <CreditCardIcon className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          <span>Parcelamento no Cartão</span>
        </div>
        {billPreview && (
          <span className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">
            1ª Fatura: {billPreview.referenceMonth} (Venc: {billPreview.dueDate})
          </span>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-3">
        {/* Seletor explícito de cartão quando o método não possui cartão fixo */}
        {!selectedPaymentMethod?.credit_card_id && creditCards.length > 0 && (
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-indigo-800 dark:text-indigo-300">
              Cartão de Crédito *
            </label>
            <select
              required
              value={selectedCreditCardId}
              onChange={(e) => onSelectedCreditCardIdChange(e.target.value)}
              className="mt-1 rounded-xl border border-indigo-300 bg-white px-3 py-1.5 text-sm font-semibold text-indigo-950 focus:outline-none dark:border-indigo-800 dark:bg-slate-900 dark:text-white"
            >
              <option value="">Selecione o cartão (obrigatório)</option>
              {creditCards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} (Fecha dia {c.closing_day})
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-indigo-800 dark:text-indigo-300">
            Total de Parcelas
          </label>
          <select
            value={installmentCount}
            onChange={(e) => {
              const val = Number(e.target.value);
              onInstallmentCountChange(val);
              if (paidInstallmentsCount >= val) onPaidInstallmentsCountChange(0);
            }}
            className="mt-1 rounded-xl border border-indigo-300 bg-white px-3 py-1.5 text-sm font-semibold text-indigo-950 focus:outline-none dark:border-indigo-800 dark:bg-slate-900 dark:text-white"
          >
            <option value={1}>À vista (1x de {formatCurrency(numAmount)})</option>
            {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 18, 24].map((n) => (
              <option key={n} value={n}>
                {n}x de {formatCurrency(numAmount ? numAmount / n : 0)}
              </option>
            ))}
          </select>
        </div>

        {installmentCount > 1 && (
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-indigo-800 dark:text-indigo-300">
              Parcelas já pagas
            </label>
            <select
              value={paidInstallmentsCount}
              onChange={(e) => onPaidInstallmentsCountChange(Number(e.target.value))}
              className="mt-1 rounded-xl border border-indigo-300 bg-white px-3 py-1.5 text-sm font-semibold text-indigo-950 focus:outline-none dark:border-indigo-800 dark:bg-slate-900 dark:text-white"
            >
              {Array.from({ length: installmentCount }, (_, i) => (
                <option key={i} value={i}>
                  {i === 0 ? 'Nenhuma (0 pagas)' : `${i} parcela${i > 1 ? 's' : ''} já paga${i > 1 ? 's' : ''}`}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {installmentCount > 1 && numAmount > 0 && (
        <div className="mt-2 text-xs text-indigo-800 dark:text-indigo-200 flex items-center justify-between border-t border-indigo-200/60 dark:border-indigo-900/60 pt-2">
          <span>
            {paidInstallmentsCount > 0 ? (
              <>
                <strong>{paidInstallmentsCount} pagas</strong> • Restam <strong>{installmentCount - paidInstallmentsCount} parcelas a vencer</strong>
              </>
            ) : (
              <>
                Gera <strong>{installmentCount} parcelas</strong> vinculadas às próximas faturas.
              </>
            )}
          </span>
          <span className="font-bold text-indigo-950 dark:text-indigo-100">
            Saldo a pagar: {formatCurrency(pendingBalancePreview)}
          </span>
        </div>
      )}
    </div>
  );
}
