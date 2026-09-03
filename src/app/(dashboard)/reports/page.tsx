'use client';

import React, { useState, useMemo } from 'react';
import { useFinance } from '@/lib/context/finance-context';
import {
  BarChart3,
  PieChart,
  Calendar,
  Download,
  Filter,
  CreditCard,
  Wallet,
  TrendingUp,
  DollarSign,
} from 'lucide-react';
import { formatCurrency, sanitizeCsvCell } from '@/lib/utils';
import { CategoryIcon } from '@/components/shared/CategoryIcon';
import { format } from 'date-fns';
import { Category } from '@/lib/types';
import { resolveCategory, calculateIntegerPercentages } from '@/lib/financial-engine';

export default function ReportsPage() {
  const {
    transactions,
    allWorkspaceCategories,
    allWorkspacePaymentMethods,
    purchases,
    installments,
  } = useFinance();

  const [periodFilter, setPeriodFilter] = useState<'month' | 'quarter' | 'year'>('month');
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));

  // Cálculo das datas do trimestre
  const [yearStr, monthStr] = selectedMonth.split('-');
  const monthNum = parseInt(monthStr || '1', 10);
  const quarterNum = Math.ceil(monthNum / 3); // 1, 2, 3, 4
  const startQuarterMonth = (quarterNum - 1) * 3 + 1;
  const quarterMonths = [startQuarterMonth, startQuarterMonth + 1, startQuarterMonth + 2].map(
    (m) => `${yearStr}-${String(m).padStart(2, '0')}`
  );

  // Transações do período (excluindo canceladas)
  const filteredTxs = transactions.filter((t) => {
    if (t.status === 'cancelled') return false;

    if (periodFilter === 'month') {
      return t.transaction_date.startsWith(selectedMonth);
    }
    if (periodFilter === 'quarter') {
      const txMonth = t.transaction_date.slice(0, 7);
      return quarterMonths.includes(txMonth);
    }
    if (periodFilter === 'year') {
      return t.transaction_date.startsWith(selectedMonth.slice(0, 4));
    }
    return true;
  });

  // Parcelas ativas do período (cartão e não-cartão)
  const filteredPeriodInstallments = installments.filter((i) => {
    if (i.status === 'cancelled') return false;
    if (periodFilter === 'month') return i.due_date.startsWith(selectedMonth);
    if (periodFilter === 'quarter') {
      const instMonth = i.due_date.slice(0, 7);
      return quarterMonths.includes(instMonth);
    }
    if (periodFilter === 'year') return i.due_date.startsWith(selectedMonth.slice(0, 4));
    return true;
  });

  // Dataset normalizado do relatório (fonte única de verdade para tudo)
  const reportRows = useMemo(() => {
    const rows: {
      id: string;
      date: string;
      description: string;
      type: 'expense' | 'income' | 'transfer';
      categoryId?: string;
      rootCategoryId?: string;
      categoryName: string;
      isUncategorized: boolean;
      paymentMethodId?: string;
      paymentMethodName: string;
      amount: number;
      status: string;
    }[] = [];

    // 1. Transações comuns
    filteredTxs.forEach((t) => {
      const catInfo = resolveCategory(allWorkspaceCategories, t.category_id);
      const pm = allWorkspacePaymentMethods.find((p) => p.id === t.payment_method_id);
      rows.push({
        id: t.id,
        date: t.transaction_date,
        description: t.description,
        type: t.type,
        categoryId: t.category_id || undefined,
        rootCategoryId: catInfo.rootId,
        categoryName: catInfo.displayName,
        isUncategorized: !catInfo.isFound,
        paymentMethodId: t.payment_method_id || undefined,
        paymentMethodName: pm?.name || 'Outro / Sem Método',
        amount: t.amount,
        status: t.status,
      });
    });

    // 2. Parcelas do período (cartão e não-cartão)
    filteredPeriodInstallments.forEach((i) => {
      const pur = purchases.find((p) => p.id === i.purchase_id);
      const catInfo = resolveCategory(allWorkspaceCategories, pur?.category_id);
      const pm = allWorkspacePaymentMethods.find((p) => p.id === pur?.payment_method_id);
      rows.push({
        id: i.id,
        date: i.due_date,
        description: `${pur?.description || 'Parcela'} (${i.installment_number}/${pur?.installment_count || '?'})`,
        type: 'expense',
        categoryId: pur?.category_id || undefined,
        rootCategoryId: catInfo.rootId,
        categoryName: catInfo.displayName,
        isUncategorized: !catInfo.isFound,
        paymentMethodId: pur?.payment_method_id || undefined,
        paymentMethodName: pm?.name || 'Outro / Sem Método',
        amount: i.amount,
        status: i.status,
      });
    });

    return rows;
  }, [filteredTxs, filteredPeriodInstallments, allWorkspaceCategories, allWorkspacePaymentMethods, purchases]);

  // Gastos por Categoria derivados do dataset único (partição estrita sem dupla contagem)
  const categorySpending = useMemo(() => {
    const list: {
      category: Category | { id: string; name: string; icon: string; color: string; type: 'expense' };
      amount: number;
    }[] = allWorkspaceCategories
      .filter((c) => c.type === 'expense' && !c.parent_id)
      .map((cat) => {
        const total = reportRows
          .filter((r) => r.type === 'expense' && r.rootCategoryId === cat.id)
          .reduce((acc, r) => acc + r.amount, 0);

        return {
          category: cat,
          amount: total,
        };
      })
      .filter((c) => c.amount > 0);

    // Reconciliação: despesas sem categoria associada
    const uncategorizedTotal = reportRows
      .filter((r) => r.type === 'expense' && r.isUncategorized)
      .reduce((acc, r) => acc + r.amount, 0);

    if (uncategorizedTotal > 0) {
      list.push({
        category: {
          id: 'uncategorized',
          name: 'Sem Categoria',
          icon: 'HelpCircle',
          color: '#64748b',
          type: 'expense',
        },
        amount: uncategorizedTotal,
      });
    }

    return list.sort((a, b) => b.amount - a.amount);
  }, [allWorkspaceCategories, reportRows]);

  // Total de Despesas do Período calculado diretamente do dataset unificado (100% de reconciliação)
  const totalExpensePeriod = useMemo(() => {
    return reportRows.filter((r) => r.type === 'expense').reduce((acc, r) => acc + r.amount, 0);
  }, [reportRows]);

  // Gastos por Método de Pagamento derivados do dataset único (com reconciliação de métodos não associados)
  const paymentMethodSpending = useMemo(() => {
    const list = allWorkspacePaymentMethods
      .map((pm) => {
        const total = reportRows
          .filter((r) => r.type === 'expense' && r.paymentMethodId === pm.id)
          .reduce((acc, r) => acc + r.amount, 0);

        return {
          pm,
          amount: total,
        };
      })
      .filter((p) => p.amount > 0);

    const unmappedPmTotal = reportRows
      .filter(
        (r) =>
          r.type === 'expense' &&
          (!r.paymentMethodId || !allWorkspacePaymentMethods.some((pm) => pm.id === r.paymentMethodId))
      )
      .reduce((acc, r) => acc + r.amount, 0);

    if (unmappedPmTotal > 0) {
      list.push({
        pm: {
          id: 'other-pm',
          workspace_id: '',
          name: 'Outro / Sem Método',
          type: 'other' as any,
          active: true,
          created_at: '',
        },
        amount: unmappedPmTotal,
      });
    }

    return list.sort((a, b) => b.amount - a.amount);
  }, [allWorkspacePaymentMethods, reportRows]);

  // Distribuição exata de percentuais via Largest Remainder (soma garantida em 100%)
  const categoryPercentagesMap = useMemo(() => {
    return calculateIntegerPercentages(
      categorySpending.map((c) => ({ id: c.category.id, amount: c.amount })),
      totalExpensePeriod
    );
  }, [categorySpending, totalExpensePeriod]);

  const paymentMethodPercentagesMap = useMemo(() => {
    return calculateIntegerPercentages(
      paymentMethodSpending.map((p) => ({ id: p.pm.id, amount: p.amount })),
      totalExpensePeriod
    );
  }, [paymentMethodSpending, totalExpensePeriod]);

  // Exportar dados em JSON diretamente do dataset normalizado
  const handleExportJSON = () => {
    const exportData = {
      dataset: reportRows,
      period: periodFilter,
      reference: selectedMonth,
      exportedAt: new Date().toISOString(),
    };
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `fincontrol_relatorio_${selectedMonth}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Exportar CSV diretamente do dataset normalizado
  const handleExportCSV = () => {
    let csv = 'Data;Descrição;Tipo;Categoria;Método;Valor;Status\n';
    reportRows.forEach((r) => {
      csv += `${sanitizeCsvCell(r.date)};${sanitizeCsvCell(r.description)};${sanitizeCsvCell(r.type)};${sanitizeCsvCell(r.categoryName)};${sanitizeCsvCell(r.paymentMethodName)};${sanitizeCsvCell(r.amount)};${sanitizeCsvCell(r.status)}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `relatorio_${selectedMonth}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Relatórios Financeiros & Análise
          </h2>
          <p className="text-xs text-slate-500">
            Respostas completas para onde está indo o seu dinheiro: categorias, métodos de pagamento e fluxo.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          {/* Alternador de Período */}
          <div className="flex items-center rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            <button
              onClick={() => setPeriodFilter('month')}
              className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                periodFilter === 'month'
                  ? 'bg-white text-emerald-700 shadow-sm dark:bg-slate-900 dark:text-white'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400'
              }`}
            >
              Mês
            </button>
            <button
              onClick={() => setPeriodFilter('quarter')}
              className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                periodFilter === 'quarter'
                  ? 'bg-white text-emerald-700 shadow-sm dark:bg-slate-900 dark:text-white'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400'
              }`}
            >
              Trimestre
            </button>
            <button
              onClick={() => setPeriodFilter('year')}
              className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                periodFilter === 'year'
                  ? 'bg-white text-emerald-700 shadow-sm dark:bg-slate-900 dark:text-white'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400'
              }`}
            >
              Ano
            </button>
          </div>

          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
          >
            <Download className="h-4 w-4" />
            <span>CSV</span>
          </button>

          <button
            onClick={handleExportJSON}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
          >
            <Download className="h-4 w-4" />
            <span>JSON</span>
          </button>

          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 shadow-sm focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
        </div>
      </div>

      {/* Grid de Relatórios */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Relatório por Categoria */}
        <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <PieChart className="h-5 w-5 text-emerald-600" />
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Gastos por Categoria
              </h3>
            </div>
            <span className="text-xs font-bold text-slate-500">
              Total: {formatCurrency(totalExpensePeriod)}
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {categorySpending.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                Nenhum gasto registrado no período selecionado.
              </div>
            ) : (
              categorySpending.map((item) => {
                const percent = categoryPercentagesMap.get(item.category.id) ?? 0;

                return (
                  <div key={item.category.id} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-200">
                        <CategoryIcon iconName={item.category.icon} color={item.category.color} />
                        <span>{item.category.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-slate-900 dark:text-white">
                          {formatCurrency(item.amount)}
                        </span>
                        <span className="text-[11px] text-slate-400 font-semibold w-8 text-right">
                          {percent}%
                        </span>
                      </div>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${percent}%`,
                          backgroundColor: item.category.color || '#10b981',
                        }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Relatório por Método de Pagamento */}
        <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-indigo-600" />
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Gastos por Método de Pagamento
              </h3>
            </div>
            <span className="text-xs text-slate-400">PIX vs Cartões vs Dinheiro</span>
          </div>

          <div className="mt-4 space-y-3">
            {paymentMethodSpending.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                Nenhum pagamento registrado no período selecionado.
              </div>
            ) : (
              paymentMethodSpending.map((item) => {
                const percent = paymentMethodPercentagesMap.get(item.pm.id) ?? 0;

                return (
                  <div key={item.pm.id} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        {item.pm.name}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-slate-900 dark:text-white">
                          {formatCurrency(item.amount)}
                        </span>
                        <span className="text-[11px] text-slate-400 font-semibold w-8 text-right">
                          {percent}%
                        </span>
                      </div>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full bg-indigo-500 transition-all duration-300"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
