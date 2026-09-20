'use client';

import React from 'react';
import { Account, Category } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';

export interface TransactionFieldsProps {
  type: 'expense' | 'income' | 'transfer';
  description: string;
  onDescriptionChange: (val: string) => void;
  categoryId: string;
  onCategoryChange: (val: string) => void;
  filteredCategories: Category[];
  fromAccountId: string;
  onFromAccountIdChange: (val: string) => void;
  toAccountId: string;
  onToAccountIdChange: (val: string) => void;
  accounts: Account[];
  paymentMethodSlot?: React.ReactNode;
}

export function TransactionFields({
  type,
  description,
  onDescriptionChange,
  categoryId,
  onCategoryChange,
  filteredCategories,
  fromAccountId,
  onFromAccountIdChange,
  toAccountId,
  onToAccountIdChange,
  accounts,
  paymentMethodSlot,
}: TransactionFieldsProps) {
  if (type === 'transfer') {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Conta de Origem (Debitar)
          </label>
          <select
            required
            value={fromAccountId}
            onChange={(e) => onFromAccountIdChange(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          >
            <option value="">Selecione a conta</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({formatCurrency(a.current_balance)})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Conta de Destino (Creditar)
          </label>
          <select
            required
            value={toAccountId}
            onChange={(e) => onToAccountIdChange(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          >
            <option value="">Selecione a conta</option>
            {accounts
              .filter((a) => a.id !== fromAccountId)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({formatCurrency(a.current_balance)})
                </option>
              ))}
          </select>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Descrição */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Descrição
        </label>
        <input
          type="text"
          required
          placeholder={
            type === 'expense'
              ? 'Ex: Supermercado Pão de Açúcar'
              : 'Ex: Salário Mensal / Freelance'
          }
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
        />
      </div>

      {/* Categoria e Método de Pagamento */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Categoria
          </label>
          <select
            value={categoryId}
            onChange={(e) => onCategoryChange(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          >
            <option value="">Selecione a categoria</option>
            {filteredCategories.map((cat) => (
              <React.Fragment key={cat.id}>
                <option value={cat.id} className="font-bold">
                  {cat.name}
                </option>
                {cat.subcategories?.map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    &nbsp;&nbsp;↳ {sub.name}
                  </option>
                ))}
              </React.Fragment>
            ))}
          </select>
        </div>

        {paymentMethodSlot}
      </div>
    </>
  );
}
