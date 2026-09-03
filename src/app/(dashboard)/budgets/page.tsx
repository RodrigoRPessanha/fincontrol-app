'use client';

import React, { useState } from 'react';
import { useFinance } from '@/lib/context/finance-context';
import {
  PieChart,
  Plus,
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  TrendingDown,
  Edit2,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { CategoryIcon } from '@/components/shared/CategoryIcon';
import { format } from 'date-fns';

export default function BudgetsPage() {
  const { budgets, categories, transactions, purchases, installments, setBudget } = useFinance();

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedCatId, setSelectedCatId] = useState('');
  const [plannedAmountStr, setPlannedAmountStr] = useState('');

  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();
  const monthKey = format(new Date(), 'yyyy-MM');

  const expenseCategories = categories.filter((c) => c.type === 'expense');

  // Cálculos de orçamento
  const budgetItems = expenseCategories.map((cat) => {
    const bud = budgets.find(
      (b) => b.category_id === cat.id && b.month === currentMonth && b.year === currentYear
    );
    const planned = bud ? bud.planned_amount : 0;

    // 1. Transações avulsas da categoria no mês (não canceladas)
    const txSpent = transactions
      .filter((t) => (t.category_id === cat.id || cat.subcategories?.some(s => s.id === t.category_id)) && t.type === 'expense' && t.status !== 'cancelled' && t.transaction_date.startsWith(monthKey))
      .reduce((acc, t) => acc + t.amount, 0);

    // 2. Parcelas com vencimento no mês de compras desta categoria (não canceladas)
    const instSpent = installments
      .filter((i) => {
        if (i.status === 'cancelled') return false;
        const p = purchases.find((pur) => pur.id === i.purchase_id);
        const matchCat = p?.category_id === cat.id || cat.subcategories?.some(s => s.id === p?.category_id);
        return matchCat && i.due_date.startsWith(monthKey);
      })
      .reduce((acc, i) => acc + i.amount, 0);

    const spent = txSpent + instSpent;
    const remaining = Math.max(0, planned - spent);
    const percent = planned > 0 ? Math.round((spent / planned) * 100) : 0;
    const isOverbudget = spent > planned && planned > 0;

    return {
      category: cat,
      planned,
      spent,
      remaining,
      percent,
      isOverbudget,
    };
  });

  const totalPlanned = budgetItems.reduce((acc, b) => acc + b.planned, 0);
  const totalSpent = budgetItems.reduce((acc, b) => acc + b.spent, 0);
  const totalRemaining = Math.max(0, totalPlanned - totalSpent);

  const handleSaveBudget = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(plannedAmountStr.replace(/\./g, '').replace(',', '.')) || 0;
    if (!selectedCatId || amt < 0) return;
    setBudget(selectedCatId, amt, currentMonth, currentYear);
    setIsEditModalOpen(false);
    setSelectedCatId('');
    setPlannedAmountStr('');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Orçamentos Mensais por Categoria
          </h2>
          <p className="text-xs text-slate-500">
            Defina limites de gastos para cada categoria e evite surpresas no final do mês.
          </p>
        </div>

        <button
          onClick={() => setIsEditModalOpen(true)}
          className="flex items-center gap-1.5 rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-600/25 transition hover:bg-emerald-500 self-start sm:self-auto"
        >
          <Plus className="h-4 w-4 stroke-[2.5]" />
          <span>Definir Orçamento</span>
        </button>
      </div>

      {/* Resumo Geral */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-3xl bg-white p-5 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Total Planejado</span>
          <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">
            {formatCurrency(totalPlanned)}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">Teto de gastos para {format(new Date(), 'MMMM')}</p>
        </div>

        <div className="rounded-3xl bg-white p-5 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Total Gasto Até Agora</span>
          <div className="mt-2 text-2xl font-black text-rose-600">
            {formatCurrency(totalSpent)}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            {totalPlanned > 0 ? `${Math.round((totalSpent / totalPlanned) * 100)}% consumido` : '0%'}
          </p>
        </div>

        <div className="rounded-3xl bg-white p-5 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Saldo Restante no Teto</span>
          <div className="mt-2 text-2xl font-black text-emerald-600">
            {formatCurrency(totalRemaining)}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">Disponível para gastar no mês</p>
        </div>
      </div>

      {/* Grid de Categorias e Orçamentos */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {budgetItems.map((item) => (
          <div
            key={item.category.id}
            className="flex flex-col justify-between rounded-3xl bg-white p-5 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800"
          >
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2.5">
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-xl font-bold text-white shadow-sm"
                    style={{ backgroundColor: item.category.color }}
                  >
                    <CategoryIcon iconName={item.category.icon} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      {item.category.name}
                    </h3>
                    <span className="text-[11px] text-slate-400">
                      Orçado: {formatCurrency(item.planned)}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => {
                    setSelectedCatId(item.category.id);
                    setPlannedAmountStr(item.planned ? item.planned.toString() : '');
                    setIsEditModalOpen(true);
                  }}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <Edit2 className="h-4 w-4" />
                </button>
              </div>

              {/* Progress Bar */}
              <div className="mt-4 space-y-1.5">
                <div className="flex justify-between text-xs font-semibold text-slate-600 dark:text-slate-300">
                  <span>Gasto: {formatCurrency(item.spent)}</span>
                  <span>{item.percent}%</span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      item.isOverbudget
                        ? 'bg-rose-500'
                        : item.percent > 75
                        ? 'bg-amber-500'
                        : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.min(100, item.percent)}%` }}
                  />
                </div>
              </div>

              {/* Status & Restante */}
              <div className="mt-4 flex items-center justify-between text-xs font-bold">
                {item.isOverbudget ? (
                  <span className="text-rose-600 flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Estourou em {formatCurrency(item.spent - item.planned)}
                  </span>
                ) : (
                  <span className="text-emerald-600 flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Restam {formatCurrency(item.remaining)}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Modal Ajustar Orçamento */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Definir Orçamento de Categoria</h3>
            <form onSubmit={handleSaveBudget} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500">Categoria</label>
                <select
                  required
                  value={selectedCatId}
                  onChange={(e) => setSelectedCatId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                >
                  <option value="">Selecione a categoria</option>
                  {expenseCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500">Limite Mensal Planejado</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: 1500,00"
                  value={plannedAmountStr}
                  onChange={(e) => setPlannedAmountStr(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-base font-bold dark:border-slate-700 dark:bg-slate-800"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white hover:bg-emerald-500"
                >
                  Salvar Orçamento
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
