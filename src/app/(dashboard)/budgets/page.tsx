'use client';

import { ContextualHelp } from '@/components/help/ContextualHelp';

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
import { parseMoneyField, formatCurrency } from '@/lib/utils';
import { toCents, fromCents, getCategoryLineage, flattenCategories } from '@/lib/financial-engine';
import { CategoryIcon } from '@/components/shared/CategoryIcon';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function BudgetsPage() {
  const { budgets, categories, allWorkspaceCategories = categories, transactions, purchases, installments, setBudget, isWorkspaceReadOnly } = useFinance();

  const [formError, setFormError] = useState<string | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedCatId, setSelectedCatId] = useState('');
  const [plannedAmountStr, setPlannedAmountStr] = useState('');

  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();
  const monthKey = format(new Date(), 'yyyy-MM');

  const canonicalCategories = flattenCategories(allWorkspaceCategories);
  const selectableCategories = canonicalCategories.filter((c) => c.type === 'expense' && c.active !== false);
  const currentBudgets = new Map(budgets.filter((b) => b.month === currentMonth && b.year === currentYear).map((b) => [b.category_id, b]));
  const purchaseById = new Map(purchases.map((p) => [p.id, p]));
  const expenseRows = [
    ...transactions.filter((t) => t.type === 'expense' && t.status !== 'cancelled' && t.transaction_date.startsWith(monthKey)).map((t) => ({ categoryId: t.category_id, amount: t.amount })),
    ...installments.filter((i) => i.status !== 'cancelled' && i.due_date.startsWith(monthKey)).map((i) => ({ categoryId: purchaseById.get(i.purchase_id)?.category_id, amount: i.amount })),
  ];
  const lineageCache = new Map<string, ReturnType<typeof getCategoryLineage>>();
  const lineageFor = (id?: string | null) => {
    if (!id) return [];
    if (!lineageCache.has(id)) lineageCache.set(id, getCategoryLineage(canonicalCategories, id));
    return lineageCache.get(id)!;
  };
  const spentByCategory = new Map<string, number>();
  let totalSpentCents = 0;
  for (const row of expenseRows) {
    const cents = toCents(row.amount);
    totalSpentCents += cents; // Every obligation counts once in the overall summary.
    for (const category of lineageFor(row.categoryId)) {
      spentByCategory.set(category.id, (spentByCategory.get(category.id) ?? 0) + cents);
    }
  }
  const expenseCategories = canonicalCategories.filter((c) => c.type === 'expense' &&
    (c.active !== false || currentBudgets.has(c.id) || spentByCategory.has(c.id)));
  const budgetItems = expenseCategories.map((cat) => {
    const planned = currentBudgets.get(cat.id)?.planned_amount ?? 0;
    const hasBudget = currentBudgets.has(cat.id);
    const spentCents = spentByCategory.get(cat.id) ?? 0;
    const plannedCents = toCents(planned);
    return {
      category: cat, planned, spent: fromCents(spentCents),
      remaining: fromCents(Math.max(0, plannedCents - spentCents)),
      hasBudget,
      percent: hasBudget && plannedCents > 0 ? Math.round(spentCents / plannedCents * 100) : null,
      isOverbudget: hasBudget && spentCents > plannedCents,
    };
  });
  // A parent ceiling already includes its child ceilings; never add overlapping limits.
  const totalPlannedCents = budgetItems.filter((item) => !lineageFor(item.category.id).slice(1)
    .some((ancestor) => (currentBudgets.get(ancestor.id)?.planned_amount ?? 0) > 0))
    .reduce((sum, item) => sum + toCents(item.planned), 0);
  const totalRemainingCents = Math.max(0, totalPlannedCents - totalSpentCents);
  const totalPlanned = fromCents(totalPlannedCents);
  const totalSpent = fromCents(totalSpentCents);
  const totalRemaining = fromCents(totalRemainingCents);

  const handleSaveBudget = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    try {
      const amt = parseMoneyField(plannedAmountStr, 'Orçamento', 'nonnegative');
      if (!selectedCatId || amt < 0) return;
      setBudget(selectedCatId, amt, currentMonth, currentYear);
      setIsEditModalOpen(false);
      setSelectedCatId('');
      setPlannedAmountStr('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Não foi possível salvar.');
    }
  };

  return (
    <div className="space-y-6">
      {formError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{formError}</p>}
      <ContextualHelp slug="orcamentos" label="Como definir um limite por categoria" />
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

        {!isWorkspaceReadOnly && <button
          onClick={() => setIsEditModalOpen(true)}
          className="flex items-center gap-1.5 rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-600/25 transition hover:bg-emerald-500 self-start sm:self-auto"
        >
          <Plus className="h-4 w-4 stroke-[2.5]" />
          <span>Definir Orçamento</span>
        </button>}
      </div>

      {/* Resumo Geral */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-3xl bg-white p-5 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Total Planejado</span>
          <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">
            {formatCurrency(totalPlanned)}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            Teto de gastos para{' '}
            {(() => {
              const m = format(new Date(), 'MMMM', { locale: ptBR });
              return m.charAt(0).toUpperCase() + m.slice(1);
            })()}
          </p>
        </div>

        <div className="rounded-3xl bg-white p-5 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Total Gasto Até Agora</span>
          <div className="mt-2 text-2xl font-black text-rose-600">
            {formatCurrency(totalSpent)}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            {totalPlanned > 0
              ? `${Math.round((totalSpent / totalPlanned) * 100)}% consumido`
              : budgetItems.some((item) => item.hasBudget) ? 'Limites definidos sem teto positivo' : 'Nenhum limite definido'}
          </p>
        </div>

        <div className="rounded-3xl bg-white p-5 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Saldo Restante no Teto</span>
          <div className="mt-2 text-2xl font-black text-emerald-600">
            {totalPlanned > 0 ? formatCurrency(totalRemaining) : '—'}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            {totalPlanned > 0 ? 'Disponível para gastar no mês' : 'Defina um orçamento para calcular o saldo restante'}
          </p>
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
                      {item.hasBudget ? `Orçado: ${formatCurrency(item.planned)}` : 'Sem limite definido'}
                    </span>
                  </div>
                </div>

                {!isWorkspaceReadOnly && <button
                  disabled={item.category.active === false}
                  title={item.category.active === false ? 'Restaure a categoria para editar seu limite.' : 'Editar orçamento'}
                  onClick={() => {
                    setSelectedCatId(item.category.id);
                    setPlannedAmountStr(item.planned ? item.planned.toString() : '');
                    setIsEditModalOpen(true);
                  }}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <Edit2 className="h-4 w-4" />
                </button>}
              </div>

              {/* Progress Bar */}
              <div className="mt-4 space-y-1.5">
                <div className="flex justify-between text-xs font-semibold text-slate-600 dark:text-slate-300">
                  <span>Gasto: {formatCurrency(item.spent)}</span>
                  <span>{item.percent === null ? (item.hasBudget ? 'Limite zerado' : 'Sem limite definido') : `${item.percent}%`}</span>
                </div>
                {item.percent !== null && <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      item.isOverbudget
                        ? 'bg-rose-500'
                        : (item.percent ?? 0) > 75
                        ? 'bg-amber-500'
                        : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.min(100, item.percent ?? 0)}%` }}
                  />
                </div>}
              </div>

              {/* Status & Restante */}
              <div className="mt-4 flex items-center justify-between text-xs font-bold">
                {item.isOverbudget ? (
                  <span className="text-rose-600 flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Estourou em {formatCurrency(item.spent - item.planned)}
                  </span>
                ) : item.hasBudget ? (
                  <span className="text-emerald-600 flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Restam {formatCurrency(item.remaining)}
                  </span>
                ) : (
                  <span className="text-slate-500">Defina um limite para acompanhar o saldo</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Modal Ajustar Orçamento */}
      {isEditModalOpen && !isWorkspaceReadOnly && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Definir Orçamento de Categoria</h3>
            <form onSubmit={handleSaveBudget} className="mt-4 space-y-3">
            {formError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{formError}</p>}
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500">Categoria</label>
                <select
                  required
                  value={selectedCatId}
                  onChange={(e) => setSelectedCatId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                >
                  <option value="">Selecione a categoria</option>
                  {selectableCategories.map((c) => (
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
