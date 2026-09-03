'use client';

import React, { useState } from 'react';
import { useFinance } from '@/lib/context/finance-context';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  CreditCard as CreditCardIcon,
  Layers,
  AlertCircle,
  Clock,
  CheckCircle2,
  Calendar,
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
  ChevronRight,
  Target,
  PieChart,
  ShieldCheck,
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { calculateDashboardSummary, resolveCategory } from '@/lib/financial-engine';
import { CategoryIcon } from '@/components/shared/CategoryIcon';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { PaymentModal } from '@/components/transactions/PaymentModal';
import { InstallmentDetailModal } from '@/components/installments/InstallmentDetailModal';
import { BillInspectorModal } from '@/components/accounts/BillInspectorModal';
import { CreditCardBill, Installment, Purchase, Transaction } from '@/lib/types';
import Link from 'next/link';
import { format } from 'date-fns';

export default function DashboardPage() {
  const {
    isLoaded,
    activeWorkspace,
    accounts,
    creditCards,
    allWorkspaceCreditCards,
    creditCardBills,
    transactions,
    purchases,
    installments,
    payments,
    recurring,
    budgets,
    goals,
    categories,
    allWorkspaceCategories,
    viewPerspective,
    setViewPerspective,
  } = useFinance();

  // Modais de Ação
  const [paymentTarget, setPaymentTarget] = useState<{
    type: 'transaction' | 'installment' | 'bill';
    id: string;
    title: string;
    totalAmount: number;
    paidAmount: number;
    dueDate?: string;
  } | null>(null);

  const [selectedPurchase, setSelectedPurchase] = useState<Purchase | null>(null);
  const [selectedBill, setSelectedBill] = useState<CreditCardBill | null>(null);

  if (!isLoaded) {
    return (
      <div className="space-y-6 animate-pulse p-2">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="h-8 w-48 bg-slate-200 dark:bg-slate-800 rounded-xl" />
          <div className="h-10 w-64 bg-slate-200 dark:bg-slate-800 rounded-xl" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-slate-100 dark:bg-slate-800/60 rounded-2xl p-4 border border-slate-200/60 dark:border-slate-800" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 h-72 bg-slate-100 dark:bg-slate-800/60 rounded-2xl border border-slate-200/60 dark:border-slate-800" />
          <div className="h-72 bg-slate-100 dark:bg-slate-800/60 rounded-2xl border border-slate-200/60 dark:border-slate-800" />
        </div>
      </div>
    );
  }

  // Cálculos do Resumo através do Motor Financeiro Puro
  const summary = calculateDashboardSummary(
    transactions,
    installments.map((i) => ({ ...i, purchase: purchases.find((p) => p.id === i.purchase_id) })),
    recurring,
    accounts,
    payments,
    format(new Date(), 'yyyy-MM'),
    creditCardBills
  );

  const activeMetric = viewPerspective === 'realized' ? summary.realized : summary.planned;
  const todayStr = format(new Date(), 'yyyy-MM-dd');

  // Transações, Parcelas e Faturas Próximas de Vencimento
  const pendingTransactions = transactions
    .filter(
      (t) =>
        (t.status === 'pending' || t.status === 'partially_paid') &&
        t.type === 'expense' &&
        !t.credit_card_bill_id &&
        !t.credit_card_id
    )
    .map((t) => ({
      id: t.id,
      title: t.description,
      amount: t.amount - (t.paid_amount || 0),
      totalAmount: t.amount,
      paidAmount: t.paid_amount || 0,
      dueDate: t.due_date,
      category: resolveCategory(allWorkspaceCategories, t.category_id),
      type: 'transaction' as const,
      isOverdue: t.due_date < todayStr,
    }));

  const pendingInstallments = installments
    .filter((i) => (i.status === 'pending' || i.status === 'partially_paid') && !i.credit_card_bill_id)
    .map((i) => {
      const p = purchases.find((pur) => pur.id === i.purchase_id);
      return {
        id: i.id,
        title: `${p?.description || 'Parcela'} (${i.installment_number}/${p?.installment_count || '?'})`,
        amount: i.amount - (i.paid_amount || 0),
        totalAmount: i.amount,
        paidAmount: i.paid_amount || 0,
        dueDate: i.due_date,
        category: resolveCategory(allWorkspaceCategories, p?.category_id),
        type: 'installment' as const,
        isOverdue: i.due_date < todayStr,
      };
    });

  const pendingBills = creditCardBills
    .filter(
      (b) =>
        (b.status === 'open' || b.status === 'partially_paid' || b.status === 'overdue') &&
        b.total_amount - (b.paid_amount || 0) > 0
    )
    .map((b) => {
      const card = allWorkspaceCreditCards.find((c) => c.id === b.credit_card_id);
      return {
        id: b.id,
        title: `Fatura ${card?.name || 'Cartão'} (${b.reference_month})`,
        amount: b.total_amount - (b.paid_amount || 0),
        totalAmount: b.total_amount,
        paidAmount: b.paid_amount || 0,
        dueDate: b.due_date,
        category: undefined,
        type: 'bill' as const,
        isOverdue: b.due_date < todayStr,
      };
    });

  const nextPayments = [...pendingTransactions, ...pendingInstallments, ...pendingBills]
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Header do Dashboard & Alternador Previsto vs Realizado */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Visão Geral
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Ambiente ativo: <strong className="text-slate-700 dark:text-slate-200">{activeWorkspace.name}</strong> •{' '}
            {format(new Date(), "MMMM 'de' yyyy")}
          </p>
        </div>

        {/* Perspective Switcher */}
        <div className="flex items-center gap-2 self-start rounded-2xl bg-white p-1 shadow-sm border border-slate-200 dark:border-slate-800 dark:bg-slate-900">
          <button
            onClick={() => setViewPerspective('realized')}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
              viewPerspective === 'realized'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
            }`}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Realizado (Caixa)
          </button>
          <button
            onClick={() => setViewPerspective('planned')}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
              viewPerspective === 'planned'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
            }`}
          >
            <Calendar className="h-3.5 w-3.5" />
            Previsto (Mês)
          </button>
        </div>
      </div>

      {/* Alertas de Vencimento se houver */}
      {summary.overdue.count > 0 && (
        <div className="flex items-center justify-between rounded-2xl bg-rose-50 p-4 border border-rose-200 text-rose-800 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-300">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
            <div>
              <p className="text-xs font-bold">
                Você possui {summary.overdue.count} {summary.overdue.count === 1 ? 'conta vencida' : 'contas vencidas'}
              </p>
              <p className="text-[11px] text-rose-600/80 dark:text-rose-400">
                Total acumulado vencido: <strong>{formatCurrency(summary.overdue.amount)}</strong>
              </p>
            </div>
          </div>
          <Link
            href="/transactions?status=overdue"
            className="rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-rose-500"
          >
            Ver Vencidas
          </Link>
        </div>
      )}

      {/* Cards de Métricas Principais */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Saldo Total em Contas */}
        <div className="rounded-3xl bg-white p-5 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Patrimônio em Contas
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              <Wallet className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-black text-slate-900 dark:text-white">
              {formatCurrency(summary.totalBalance)}
            </h3>
            <p className="mt-1 text-[11px] text-slate-400">
              Soma de {accounts.length} contas ativas
            </p>
          </div>
        </div>

        {/* Receitas do Mês */}
        <div className="rounded-3xl bg-white p-5 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Receitas ({viewPerspective === 'realized' ? 'Recebidas' : 'Previstas'})
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
              <ArrowUpRight className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
              {formatCurrency(activeMetric.income)}
            </h3>
            <p className="mt-1 text-[11px] text-slate-400">
              {viewPerspective === 'realized' ? 'Total creditado em conta' : 'Considerando salários e rendas'}
            </p>
          </div>
        </div>

        {/* Despesas do Mês */}
        <div className="rounded-3xl bg-white p-5 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Despesas ({viewPerspective === 'realized' ? 'Pagas' : 'Previstas'})
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400">
              <ArrowDownRight className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-black text-rose-600 dark:text-rose-400">
              {formatCurrency(activeMetric.expense)}
            </h3>
            <p className="mt-1 text-[11px] text-slate-400">
              {viewPerspective === 'realized' ? 'Saídas já liquidadas' : 'Inclui faturas e parcelas'}
            </p>
          </div>
        </div>

        {/* Saldo Mensal Líquido */}
        <div className="rounded-3xl bg-white p-5 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Saldo do Mês
            </span>
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-xl ${
                activeMetric.net >= 0
                  ? 'bg-teal-50 text-teal-600 dark:bg-teal-950/50 dark:text-teal-400'
                  : 'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400'
              }`}
            >
              <DollarSign className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <h3
              className={`text-2xl font-black ${
                activeMetric.net >= 0 ? 'text-slate-900 dark:text-white' : 'text-rose-600'
              }`}
            >
              {formatCurrency(activeMetric.net)}
            </h3>
            <p className="mt-1 text-[11px] text-slate-400">
              Resultado líquido ({viewPerspective === 'realized' ? 'Realizado' : 'Previsto'})
            </p>
          </div>
        </div>
      </div>

      {/* Seção 2: Próximos Pagamentos & Cartões de Crédito */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Próximos Pagamentos (2 colunas) */}
        <div className="lg:col-span-2 rounded-3xl bg-white p-6 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-emerald-600" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Próximos Pagamentos
                </h3>
              </div>
              <Link
                href="/transactions"
                className="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
              >
                Ver todos <ChevronRight className="h-3 w-3" />
              </Link>
            </div>

            <div className="mt-4 space-y-2.5">
              {nextPayments.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  🎉 Nenhuma conta pendente para os próximos dias!
                </div>
              ) : (
                nextPayments.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between rounded-2xl bg-slate-50 p-3.5 transition hover:bg-slate-100 dark:bg-slate-800/50 dark:hover:bg-slate-800 border border-slate-100 dark:border-slate-800"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-slate-700 shadow-sm dark:bg-slate-700 dark:text-slate-200">
                        <CategoryIcon iconName={item.category?.rootCategory?.icon || 'tag'} />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                          {item.title}
                        </h4>
                        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400">
                          <span>Vencimento: {formatDate(item.dueDate)}</span>
                          {item.isOverdue && (
                            <span className="font-bold text-rose-600">Vencido!</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-sm font-extrabold text-slate-900 dark:text-white">
                        {formatCurrency(item.amount)}
                      </span>
                      <button
                        onClick={() =>
                          setPaymentTarget({
                            type: item.type,
                            id: item.id,
                            title: item.title,
                            totalAmount: item.totalAmount,
                            paidAmount: item.paidAmount,
                            dueDate: item.dueDate,
                          })
                        }
                        className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-500"
                      >
                        Pagar
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-between text-xs text-slate-400">
            <span>Organizados por data de vencimento mais próxima</span>
            <span>{nextPayments.length} obrigações listadas</span>
          </div>
        </div>

        {/* Cartões de Crédito & Faturas */}
        <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <CreditCardIcon className="h-5 w-5 text-indigo-600" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Cartões de Crédito
                </h3>
              </div>
              <Link
                href="/accounts"
                className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
              >
                Faturas <ChevronRight className="h-3 w-3" />
              </Link>
            </div>

            <div className="mt-4 space-y-4">
              {creditCards.map((card) => {
                // Fatura atual do cartão
                const currentBill = creditCardBills.find(
                  (b) => b.credit_card_id === card.id && b.status === 'open'
                ) || creditCardBills.find((b) => b.credit_card_id === card.id);

                const billAmount = currentBill ? currentBill.total_amount : 0;
                const availableLimit = Math.max(0, card.credit_limit - billAmount);
                const usedPercent = Math.min(100, Math.round((billAmount / card.credit_limit) * 100));

                return (
                  <div
                    key={card.id}
                    className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                          {card.name}
                        </h4>
                        <span className="text-[10px] text-slate-400">
                          •••• {card.last_four_digits} | Fecha dia {card.closing_day} | Vence dia {card.due_day}
                        </span>
                      </div>
                      {currentBill && (
                        <button
                          onClick={() => setSelectedBill(currentBill)}
                          className="text-xs font-bold text-indigo-600 hover:underline"
                        >
                          Ver Fatura
                        </button>
                      )}
                    </div>

                    <div className="mt-3 flex items-center justify-between text-xs">
                      <span className="text-slate-500">Fatura Atual:</span>
                      <span className="font-bold text-slate-900 dark:text-white">
                        {formatCurrency(billAmount)}
                      </span>
                    </div>

                    {/* Progress Bar do Limite */}
                    <div className="mt-2">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                        <div
                          className="h-full rounded-full bg-indigo-600 transition-all duration-300"
                          style={{ width: `${usedPercent}%` }}
                        />
                      </div>
                      <div className="mt-1.5 flex justify-between text-[10px] font-semibold text-slate-400">
                        <span>Limite Disp: {formatCurrency(availableLimit)}</span>
                        <span>Total: {formatCurrency(card.credit_limit)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-center text-xs text-slate-400">
            Calculado automaticamente pelo dia de fechamento
          </div>
        </div>
      </div>

      {/* Seção 3: Parcelamentos Ativos & Orçamentos & Metas */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Parcelamentos Ativos */}
        <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-indigo-600" />
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Parcelamentos Ativos
              </h3>
            </div>
            <Link
              href="/installments"
              className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
            >
              Ver todos <ChevronRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="mt-4 space-y-3">
            {purchases.slice(0, 3).map((purchase) => {
              const pInsts = installments.filter((i) => i.purchase_id === purchase.id);
              const paidCount = pInsts.filter((i) => i.status === 'paid').length;
              const totalPaid = pInsts.reduce((acc, i) => acc + (i.paid_amount || (i.status === 'paid' ? i.amount : 0)), 0);
              const progress = Math.min(100, Math.round((totalPaid / purchase.total_amount) * 100));

              return (
                <div
                  key={purchase.id}
                  onClick={() => setSelectedPurchase(purchase)}
                  className="cursor-pointer rounded-2xl bg-slate-50 p-3.5 hover:bg-slate-100 dark:bg-slate-800/40 dark:hover:bg-slate-800 border border-slate-100 dark:border-slate-800 transition"
                >
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                      {purchase.description}
                    </h4>
                    <span className="text-xs font-extrabold text-slate-900 dark:text-white">
                      {formatCurrency(purchase.total_amount / purchase.installment_count)}/mês
                    </span>
                  </div>

                  <div className="mt-2">
                    <div className="flex justify-between text-[11px] text-slate-500 pb-1">
                      <span>
                        {paidCount} de {purchase.installment_count} parcelas pagas
                      </span>
                      <span>{progress}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                      <div
                        className="h-full rounded-full bg-emerald-500"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Orçamento Mensal */}
        <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <PieChart className="h-5 w-5 text-amber-500" />
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Orçamento Mensal
              </h3>
            </div>
            <Link
              href="/budgets"
              className="text-xs font-bold text-amber-600 hover:text-amber-700 flex items-center gap-1"
            >
              Detalhes <ChevronRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="mt-4 space-y-3">
            {budgets.slice(0, 3).map((bud) => {
              const cat = categories.find((c) => c.id === bud.category_id);
              // Cálculo simples de gasto na categoria este mês
              const spent = transactions
                .filter((t) => t.category_id === bud.category_id && t.type === 'expense')
                .reduce((acc, t) => acc + t.amount, 0);
              const percent = Math.min(100, Math.round((spent / bud.planned_amount) * 100));

              return (
                <div key={bud.id} className="space-y-1.5">
                  <div className="flex justify-between text-xs font-bold">
                    <span className="text-slate-800 dark:text-slate-200">{cat?.name}</span>
                    <span className="text-slate-500">
                      {formatCurrency(spent)} de {formatCurrency(bud.planned_amount)}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                    <div
                      className={`h-full rounded-full transition-all ${
                        percent > 90 ? 'bg-rose-500' : percent > 70 ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Metas Financeiras */}
        <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-emerald-600" />
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Metas Financeiras
              </h3>
            </div>
            <Link
              href="/goals"
              className="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
            >
              Ver todas <ChevronRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="mt-4 space-y-3">
            {goals.slice(0, 3).map((goal) => {
              const percent = Math.min(100, Math.round((goal.current_amount / goal.target_amount) * 100));
              return (
                <div key={goal.id} className="space-y-1.5">
                  <div className="flex justify-between text-xs font-bold">
                    <span className="text-slate-800 dark:text-slate-200">{goal.name}</span>
                    <span className="text-emerald-600 dark:text-emerald-400">{percent}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-400 font-semibold">
                    <span>Atual: {formatCurrency(goal.current_amount)}</span>
                    <span>Meta: {formatCurrency(goal.target_amount)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Modais Ativos */}
      <PaymentModal
        isOpen={!!paymentTarget}
        onClose={() => setPaymentTarget(null)}
        target={paymentTarget}
      />

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

      <BillInspectorModal
        isOpen={!!selectedBill}
        onClose={() => setSelectedBill(null)}
        bill={selectedBill}
        onPayBill={(bill) => {
          setPaymentTarget({
            type: 'bill',
            id: bill.id,
            title: `Fatura ${bill.reference_month}`,
            totalAmount: bill.total_amount,
            paidAmount: bill.paid_amount || 0,
            dueDate: bill.due_date,
          });
        }}
      />
    </div>
  );
}
