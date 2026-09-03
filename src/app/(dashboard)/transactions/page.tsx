'use client';

import React, { useState, useMemo, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useFinance } from '@/lib/context/finance-context';
import {
  Search,
  Filter,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  Clock,
  AlertCircle,
  Copy,
  Trash2,
  Plus,
  Calendar,
  Layers,
  CreditCard,
  Building,
  DollarSign,
} from 'lucide-react';
import { formatCurrency, formatDate, getStatusBadge } from '@/lib/utils';
import { resolveCategory } from '@/lib/financial-engine';
import { CategoryIcon } from '@/components/shared/CategoryIcon';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { PaymentModal } from '@/components/transactions/PaymentModal';
import { QuickAddModal } from '@/components/transactions/QuickAddModal';
import { Transaction } from '@/lib/types';
import { format } from 'date-fns';

function TransactionsContent() {
  const searchParams = useSearchParams();

  const {
    isLoaded,
    transactions,
    allWorkspaceCategories,
    allWorkspacePaymentMethods,
    allWorkspaceAccounts,
    allWorkspaceCreditCards,
    deleteTransaction,
    duplicateTransaction,
  } = useFinance();

  // Filtros
  const [searchTerm, setSearchTerm] = useState('');
  const urlStatus = searchParams.get('status');
  const [statusFilter, setStatusFilter] = useState<string>(urlStatus || 'all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<string>('all');
  const [monthFilter, setMonthFilter] = useState<string>(format(new Date(), 'yyyy-MM'));

  // Sincronização reativa caso searchParams mude mantendo a página montada (reseta para 'all' se query for removida)
  useEffect(() => {
    const targetStatus = urlStatus || 'all';
    if (targetStatus !== statusFilter) {
      const timer = setTimeout(() => {
        setStatusFilter(targetStatus);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [urlStatus, statusFilter]);

  // Modais
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [paymentTarget, setPaymentTarget] = useState<{
    type: 'transaction';
    id: string;
    title: string;
    totalAmount: number;
    paidAmount: number;
    dueDate?: string;
  } | null>(null);

  // Filtragem dos dados
  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      // Texto
      if (searchTerm && !tx.description.toLowerCase().includes(searchTerm.toLowerCase())) {
        return false;
      }
      // Tipo
      if (typeFilter !== 'all' && tx.type !== typeFilter) {
        return false;
      }
      // Status
      if (statusFilter !== 'all') {
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        if (statusFilter === 'overdue') {
          if (tx.status === 'paid' || tx.due_date >= todayStr) return false;
        } else if (tx.status !== statusFilter) {
          return false;
        }
      }
      // Categoria
      if (categoryFilter !== 'all' && tx.category_id !== categoryFilter) {
        return false;
      }
      // Método de Pagamento
      if (paymentMethodFilter !== 'all' && tx.payment_method_id !== paymentMethodFilter) {
        return false;
      }
      // Mês de Competência
      if (monthFilter && !tx.transaction_date.startsWith(monthFilter)) {
        return false;
      }
      return true;
    });
  }, [transactions, searchTerm, typeFilter, statusFilter, categoryFilter, paymentMethodFilter, monthFilter]);

  // Totais da listagem filtrada
  const totalIncome = filteredTransactions
    .filter((t) => t.type === 'income')
    .reduce((acc, t) => acc + t.amount, 0);

  const totalExpense = filteredTransactions
    .filter((t) => t.type === 'expense')
    .reduce((acc, t) => acc + t.amount, 0);

  const netTotal = totalIncome - totalExpense;

  if (!isLoaded) {
    return (
      <div className="space-y-6 animate-pulse p-2">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="h-8 w-48 bg-slate-200 dark:bg-slate-800 rounded-xl" />
          <div className="h-10 w-36 bg-slate-200 dark:bg-slate-800 rounded-xl" />
        </div>
        <div className="h-16 bg-slate-100 dark:bg-slate-800/60 rounded-2xl border border-slate-200/60 dark:border-slate-800" />
        <div className="h-96 bg-slate-100 dark:bg-slate-800/60 rounded-2xl border border-slate-200/60 dark:border-slate-800" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Transações & Movimentações
          </h2>
          <p className="text-xs text-slate-500">
            Gerencie todas as despesas, receitas e contas a pagar.
          </p>
        </div>

        <button
          onClick={() => setIsQuickAddOpen(true)}
          className="flex items-center gap-1.5 rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-600/25 transition hover:bg-emerald-500 self-start sm:self-auto"
        >
          <Plus className="h-4 w-4 stroke-[2.5]" />
          <span>Nova Transação</span>
        </button>
      </div>

      {/* Barra de Filtros Avançados */}
      <div className="rounded-3xl bg-white p-5 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800 space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {/* Busca por texto */}
          <div className="relative lg:col-span-2">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por descrição..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-2xl border border-slate-300 bg-slate-50/50 py-2 pl-10 pr-4 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          {/* Mês de Competência */}
          <div>
            <input
              type="month"
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="w-full rounded-2xl border border-slate-300 bg-slate-50/50 py-2 px-3 text-xs text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          {/* Tipo */}
          <div>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
              className="w-full rounded-2xl border border-slate-300 bg-slate-50/50 py-2 px-3 text-xs text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              <option value="all">Todos os Tipos</option>
              <option value="expense">Apenas Despesas</option>
              <option value="income">Apenas Receitas</option>
            </select>
          </div>

          {/* Status */}
          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full rounded-2xl border border-slate-300 bg-slate-50/50 py-2 px-3 text-xs text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              <option value="all">Todos os Status</option>
              <option value="paid">Pagas / Recebidas</option>
              <option value="pending">Pendentes</option>
              <option value="partially_paid">Parcialmente Pagas</option>
              <option value="overdue">Vencidas</option>
            </select>
          </div>
        </div>

        {/* Resumo da Filtragem */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs font-semibold">
          <span className="text-slate-400">
            {filteredTransactions.length} registros encontrados
          </span>
          <div className="flex items-center gap-4">
            <span className="text-emerald-600 dark:text-emerald-400">
              Receitas: {formatCurrency(totalIncome)}
            </span>
            <span className="text-rose-600 dark:text-rose-400">
              Despesas: {formatCurrency(totalExpense)}
            </span>
            <span className="text-slate-800 dark:text-slate-200">
              Líquido: <strong>{formatCurrency(netTotal)}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Tabela de Transações */}
      <div className="overflow-hidden rounded-3xl bg-white shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-100 bg-slate-50/70 uppercase tracking-wider text-slate-400 dark:border-slate-800 dark:bg-slate-800/40">
              <tr>
                <th className="py-3.5 pl-6 pr-3">Descrição & Categoria</th>
                <th className="px-3 py-3.5">Competência</th>
                <th className="px-3 py-3.5">Vencimento</th>
                <th className="px-3 py-3.5">Pagamento / Conta</th>
                <th className="px-3 py-3.5">Status</th>
                <th className="px-3 py-3.5 text-right">Valor</th>
                <th className="py-3.5 pl-3 pr-6 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    Nenhuma transação encontrada com os filtros selecionados.
                  </td>
                </tr>
              ) : (
                filteredTransactions.map((tx) => {
                  const cat = resolveCategory(allWorkspaceCategories, tx.category_id);
                  const pm = allWorkspacePaymentMethods.find((p) => p.id === tx.payment_method_id);
                  const acc = allWorkspaceAccounts.find((a) => a.id === tx.account_id);
                  const isPaid = tx.status === 'paid';

                  return (
                    <tr
                      key={tx.id}
                      className="transition hover:bg-slate-50/80 dark:hover:bg-slate-800/50"
                    >
                      {/* Descrição e Categoria */}
                      <td className="py-4 pl-6 pr-3">
                        <div className="flex items-center gap-3">
                          <div
                            className={`flex h-9 w-9 items-center justify-center rounded-xl font-bold shadow-sm ${
                              tx.type === 'income'
                                ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400'
                                : 'bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400'
                            }`}
                          >
                            <CategoryIcon iconName={cat?.rootCategory?.icon || 'tag'} />
                          </div>
                          <div>
                            <span className="font-bold text-slate-900 dark:text-white">
                              {tx.description}
                            </span>
                            <div className="text-[11px] text-slate-400">
                              {cat?.displayName || 'Sem categoria'}
                              {tx.notes && <span> • {tx.notes}</span>}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Competência */}
                      <td className="px-3 py-4 text-slate-600 dark:text-slate-300">
                        {formatDate(tx.transaction_date)}
                      </td>

                      {/* Vencimento */}
                      <td className="px-3 py-4">
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                          {formatDate(tx.due_date)}
                        </span>
                      </td>

                      {/* Método de Pagamento / Conta */}
                      <td className="px-3 py-4 text-slate-500">
                        <div>{pm?.name || 'Não especificado'}</div>
                        {acc && <div className="text-[10px] text-slate-400">{acc.name}</div>}
                      </td>

                      {/* Status */}
                      <td className="px-3 py-4">
                        <StatusBadge status={tx.status} />
                      </td>

                      {/* Valor */}
                      <td className="px-3 py-4 text-right">
                        <span
                          className={`text-sm font-extrabold ${
                            tx.type === 'income'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {tx.type === 'income' ? '+ ' : '- '}
                          {formatCurrency(tx.amount)}
                        </span>
                        {tx.status === 'partially_paid' && (
                          <div className="text-[10px] text-emerald-600 font-semibold">
                            Pago: {formatCurrency(tx.paid_amount || 0)}
                          </div>
                        )}
                      </td>

                      {/* Ações */}
                      <td className="py-4 pl-3 pr-6 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {!isPaid && (
                            tx.credit_card_bill_id || tx.credit_card_id ? (
                              <span
                                title="Despesas no cartão devem ser pagas através da fatura"
                                className="rounded-lg bg-indigo-50 px-2 py-1 text-[11px] font-bold text-indigo-600 border border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-400 dark:border-indigo-800 cursor-default"
                              >
                                Na Fatura
                              </span>
                            ) : (
                              <button
                                onClick={() =>
                                  setPaymentTarget({
                                    type: 'transaction',
                                    id: tx.id,
                                    title: tx.description,
                                    totalAmount: tx.amount,
                                    paidAmount: tx.paid_amount || 0,
                                    dueDate: tx.due_date,
                                  })
                                }
                                className="rounded-lg bg-emerald-50 px-2.5 py-1 font-bold text-emerald-700 hover:bg-emerald-100 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800"
                              >
                                Pagar
                              </button>
                            )
                          )}
                          <button
                            onClick={() => duplicateTransaction(tx.id)}
                            title="Duplicar Transação"
                            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => deleteTransaction(tx.id)}
                            title="Excluir Transação"
                            className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modais */}
      <QuickAddModal isOpen={isQuickAddOpen} onClose={() => setIsQuickAddOpen(false)} />

      <PaymentModal
        isOpen={!!paymentTarget}
        onClose={() => setPaymentTarget(null)}
        target={paymentTarget}
      />
    </div>
  );
}

export default function TransactionsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xs text-slate-400">Carregando transações...</div>}>
      <TransactionsContent />
    </Suspense>
  );
}
