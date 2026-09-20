'use client';

import React from 'react';
import { PaymentMethod } from '@/lib/types';

export interface PaymentMethodFieldsProps {
  paymentMethodId: string;
  onPaymentMethodChange: (id: string) => void;
  filteredPaymentMethods: PaymentMethod[];
}

export function PaymentMethodFields({
  paymentMethodId,
  onPaymentMethodChange,
  filteredPaymentMethods,
}: PaymentMethodFieldsProps) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        Método de Pagamento
      </label>
      <select
        value={paymentMethodId}
        onChange={(e) => onPaymentMethodChange(e.target.value)}
        className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
      >
        <option value="">Selecione o método</option>
        {filteredPaymentMethods.map((pm) => (
          <option key={pm.id} value={pm.id}>
            {pm.name}
          </option>
        ))}
      </select>
    </div>
  );
}
