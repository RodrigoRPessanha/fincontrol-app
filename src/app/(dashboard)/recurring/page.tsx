'use client';

import React, { useState } from 'react';
import { useFinance } from '@/lib/context/finance-context';
import {
  Repeat,
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  ToggleLeft,
  ToggleRight,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  CreditCard as CreditCardIcon,
  Landmark,
  Wallet,
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { CategoryIcon } from '@/components/shared/CategoryIcon';
import { resolveCategory } from '@/lib/financial-engine';
import { RecurringTransaction, RecurrenceFrequency } from '@/lib/types';
import { format } from 'date-fns';

export default function RecurringPage() {
  const {
    isLoaded,
    recurring,
    categories,
    paymentMethods,
    accounts,
    creditCards,
    allWorkspaceCategories,
    allWorkspaceCreditCards,
    allWorkspaceAccounts,
    allWorkspacePaymentMethods,
    addRecurring,
    toggleRecurring,
    deleteRecurring,
  } = useFinance();

  const [isNewRecOpen, setIsNewRecOpen] = useState(false);
  const [desc, setDesc] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [recType, setRecType] = useState<'expense' | 'income'>('expense');
  const [catId, setCatId] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [creditCardId, setCreditCardId] = useState('');
  const [freq, setFreq] = useState<RecurrenceFrequency>('monthly');
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const filteredCategories = categories.filter((c) => c.type === recType);
  const filteredPaymentMethods = paymentMethods.filter((p) =>
    recType === 'income' ? p.type !== 'credit_card' && !p.credit_card_id : true
  );

  const selectedPm = paymentMethods.find((p) => p.id === paymentMethodId);
  const fixedCard = selectedPm?.credit_card_id
    ? creditCards.find((c) => c.id === selectedPm.credit_card_id)
    : null;

  const handleTypeChange = (type: 'expense' | 'income') => {
    setRecType(type);
    setCatId('');
    if (type === 'income') {
      setCreditCardId('');
      if (selectedPm && (selectedPm.type === 'credit_card' || selectedPm.credit_card_id)) {
        setPaymentMethodId('');
      }
    }
  };

  const handleMethodChange = (pmId: string) => {
    setPaymentMethodId(pmId);
    const pm = paymentMethods.find((p) => p.id === pmId);
    if (pm) {
      if (pm.credit_card_id) {
        setCreditCardId(pm.credit_card_id);
        setAccountId('');
      } else if (pm.type === 'credit_card') {
        setCreditCardId(''); // Não pré-seleciona primeiro cartão; exige escolha explícita
        setAccountId('');
      } else if (pm.linked_account_id) {
        setAccountId(pm.linked_account_id);
        setCreditCardId('');
      } else {
        setCreditCardId('');
      }
    } else {
      setCreditCardId('');
    }
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(amountStr.replace(/\./g, '').replace(',', '.')) || 0;
    if (amt <= 0 || !desc.trim()) return;

    if (recType === 'expense' && selectedPm?.type === 'credit_card' && !fixedCard && !creditCardId) {
      return;
    }

    addRecurring({
      description: desc.trim(),
      amount: amt,
      type: recType,
      category_id: catId || undefined,
      account_id: recType === 'expense' && (fixedCard || creditCardId) ? undefined : accountId || undefined,
      payment_method_id: paymentMethodId || undefined,
      credit_card_id: recType === 'income' ? undefined : (fixedCard?.id || creditCardId) || undefined,
      frequency: freq,
      start_date: startDate,
      next_occurrence: startDate,
      auto_create: true,
      active: true,
    });

    setDesc('');
    setAmountStr('');
    setPaymentMethodId('');
    setAccountId('');
    setCreditCardId('');
    setIsNewRecOpen(false);
  };

  // Converte o valor de cada recorrência para uma base mensal proporcional
  const getMonthlyAmount = (r: RecurringTransaction) => {
    switch (r.frequency) {
      case 'weekly':
        return r.amount * (52 / 12); // ~4.33x por mês
      case 'bimonthly':
        return r.amount / 2;
      case 'quarterly':
        return r.amount / 3;
      case 'semiannual':
        return r.amount / 6;
      case 'annual':
        return r.amount / 12;
      case 'custom':
        return r.amount * (30 / Math.max(1, r.interval_days || 30));
      case 'monthly':
      default:
        return r.amount;
    }
  };

  const totalMonthlyExpense = recurring
    .filter((r) => r.active && r.type === 'expense')
    .reduce((acc, r) => acc + getMonthlyAmount(r), 0);

  const totalMonthlyIncome = recurring
    .filter((r) => r.active && r.type === 'income')
    .reduce((acc, r) => acc + getMonthlyAmount(r), 0);

  if (!isLoaded) {
    return (
      <div className="space-y-6 animate-pulse p-2">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="h-8 w-48 bg-slate-200 dark:bg-slate-800 rounded-xl" />
          <div className="h-10 w-36 bg-slate-200 dark:bg-slate-800 rounded-xl" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 bg-slate-100 dark:bg-slate-800/60 rounded-2xl p-4 border border-slate-200/60 dark:border-slate-800" />
          ))}
        </div>
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
            Gastos Fixos & Assinaturas Recorrentes
          </h2>
          <p className="text-xs text-slate-500">
            Controle salários, aluguel, condomínio, internet, Netflix, Spotify e assinaturas vinculadas a cartões ou contas.
          </p>
        </div>

        <button
          onClick={() => setIsNewRecOpen(true)}
          className="flex items-center gap-1.5 rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-600/25 transition hover:bg-emerald-500 self-start sm:self-auto"
        >
          <Plus className="h-4 w-4 stroke-[2.5]" />
          <span>Nova Recorrência</span>
        </button>
      </div>

      {/* Cards de Totais Recorrentes */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-3xl bg-white p-5 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Renda Fixa Mensal</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <ArrowUpRight className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black text-emerald-600">
            {formatCurrency(totalMonthlyIncome)}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">Salários e recebimentos fixos</p>
        </div>

        <div className="rounded-3xl bg-white p-5 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Gastos Fixos Mensais</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
              <ArrowDownRight className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black text-rose-600">
            {formatCurrency(totalMonthlyExpense)}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">Aluguel, condomínio, assinaturas</p>
        </div>

        <div className="rounded-3xl bg-white p-5 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Saldo Fixo Livre</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Repeat className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">
            {formatCurrency(totalMonthlyIncome - totalMonthlyExpense)}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">Margem antes de compras variáveis</p>
        </div>
      </div>

      {/* Lista de Recorrências */}
      <div className="overflow-hidden rounded-3xl bg-white shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-100 bg-slate-50/70 uppercase tracking-wider text-slate-400 dark:border-slate-800 dark:bg-slate-800/40">
              <tr>
                <th className="py-3.5 pl-6 pr-3">Descrição & Categoria</th>
                <th className="px-3 py-3.5">Cobrança / Conta</th>
                <th className="px-3 py-3.5">Frequência</th>
                <th className="px-3 py-3.5">Próxima Ocorrência</th>
                <th className="px-3 py-3.5">Status</th>
                <th className="px-3 py-3.5 text-right">Valor</th>
                <th className="py-3.5 pl-3 pr-6 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {recurring.map((rec) => {
                const cat = resolveCategory(allWorkspaceCategories, rec.category_id);
                const card = allWorkspaceCreditCards.find((c) => c.id === rec.credit_card_id);
                const acc = allWorkspaceAccounts.find((a) => a.id === rec.account_id);
                const pm = allWorkspacePaymentMethods.find((p) => p.id === rec.payment_method_id);

                return (
                  <tr key={rec.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50">
                    <td className="py-4 pl-6 pr-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex h-9 w-9 items-center justify-center rounded-xl font-bold shadow-sm ${
                            rec.type === 'income'
                              ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50'
                              : 'bg-rose-50 text-rose-600 dark:bg-rose-950/50'
                          }`}
                        >
                          <CategoryIcon iconName={cat.rootCategory?.icon || 'tag'} />
                        </div>
                        <div>
                          <span className="font-bold text-slate-900 dark:text-white">
                            {rec.description}
                          </span>
                          <div className="text-[11px] text-slate-400">{cat.displayName}</div>
                          {!rec.active && rec.suspended_reason && (
                            <div className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                              <AlertTriangle className="h-3 w-3 shrink-0" />
                              <span>{rec.suspended_reason}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="px-3 py-4 text-slate-600 dark:text-slate-300">
                      {card ? (
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                          <CreditCardIcon className="h-3.5 w-3.5 shrink-0" />
                          <span>{card.name}</span>
                        </div>
                      ) : acc ? (
                        <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                          <Landmark className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <span>{acc.name}</span>
                        </div>
                      ) : pm ? (
                        <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                          <Wallet className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <span>{pm.name}</span>
                        </div>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>

                    <td className="px-3 py-4 text-slate-600 dark:text-slate-300 capitalize font-medium">
                      {rec.frequency === 'monthly' ? 'Mensal' : rec.frequency}
                    </td>

                    <td className="px-3 py-4 font-semibold text-slate-700 dark:text-slate-200">
                      {formatDate(rec.next_occurrence)}
                    </td>

                    <td className="px-3 py-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                          rec.active
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400'
                            : 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400'
                        }`}
                      >
                        {rec.active ? 'Ativo' : 'Pausado'}
                      </span>
                    </td>

                    <td className="px-3 py-4 text-right">
                      <span
                        className={`text-sm font-extrabold ${
                          rec.type === 'income' ? 'text-emerald-600' : 'text-rose-600'
                        }`}
                      >
                        {rec.type === 'income' ? '+ ' : '- '}
                        {formatCurrency(rec.amount)}
                      </span>
                    </td>

                    <td className="py-4 pl-3 pr-6 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => toggleRecurring(rec.id)}
                          title={rec.active ? 'Pausar recorrência' : 'Reativar recorrência'}
                          className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                        >
                          {rec.active ? (
                            <ToggleRight className="h-5 w-5 text-emerald-600" />
                          ) : (
                            <ToggleLeft className="h-5 w-5 text-slate-400" />
                          )}
                        </button>
                        <button
                          onClick={() => deleteRecurring(rec.id)}
                          title="Excluir recorrência"
                          className="rounded-lg p-1.5 text-slate-400 hover:text-rose-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Nova Recorrência */}
      {isNewRecOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900 border border-slate-100 dark:border-slate-800 max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Cadastrar Gasto Fixo / Assinatura</h3>
            <form onSubmit={handleCreate} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500">Tipo</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => handleTypeChange('expense')}
                    className={`py-2 rounded-xl text-xs font-bold ${
                      recType === 'expense' ? 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/50 dark:text-rose-400' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                    }`}
                  >
                    Despesa Fixa
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTypeChange('income')}
                    className={`py-2 rounded-xl text-xs font-bold ${
                      recType === 'income' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                    }`}
                  >
                    Receita Fixa
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500">Descrição</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Aluguel, Netflix, Salário"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500">Valor</label>
                <input
                  type="text"
                  required
                  placeholder="0,00"
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-base font-bold dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-500">Frequência</label>
                  <select
                    value={freq}
                    onChange={(e) => setFreq(e.target.value as RecurrenceFrequency)}
                    className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="weekly">Semanal</option>
                    <option value="monthly">Mensal</option>
                    <option value="bimonthly">Bimestral</option>
                    <option value="quarterly">Trimestral</option>
                    <option value="semiannual">Semestral</option>
                    <option value="annual">Anual</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-500">Categoria</label>
                  <select
                    value={catId}
                    onChange={(e) => setCatId(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="">Selecione</option>
                    {filteredCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Método de Pagamento */}
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500">Método de Pagamento</label>
                <select
                  value={paymentMethodId}
                  onChange={(e) => handleMethodChange(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  <option value="">Nenhum / Selecionar depois</option>
                  {filteredPaymentMethods.map((pm) => (
                    <option key={pm.id} value={pm.id}>
                      {pm.name} {pm.credit_card_id ? '(Cartão de Crédito Fixo)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Cartão de Crédito Automático ou Seleção de Cartão */}
              {recType === 'expense' && fixedCard ? (
                <div className="rounded-xl bg-indigo-50 p-3 text-xs text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-900 flex items-center gap-2">
                  <CreditCardIcon className="h-4 w-4 shrink-0" />
                  <span>Fatura automática gerada no cartão: <strong>{fixedCard.name}</strong></span>
                </div>
              ) : recType === 'expense' && selectedPm?.type === 'credit_card' ? (
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-500">Cartão de Crédito *</label>
                  <select
                    required
                    value={creditCardId}
                    onChange={(e) => setCreditCardId(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="">Selecione o cartão (obrigatório)</option>
                    {creditCards.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-500">
                    {recType === 'income' ? 'Conta de Destino' : 'Conta Bancária'}
                  </label>
                  <select
                    value={accountId}
                    disabled={!!selectedPm?.linked_account_id}
                    onChange={(e) => setAccountId(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-xs disabled:opacity-60 disabled:bg-slate-100 dark:disabled:bg-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="">Nenhuma / Selecionar depois</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({formatCurrency(a.current_balance)})
                      </option>
                    ))}
                  </select>
                  {selectedPm?.linked_account_id && (
                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                      Conta fixa vinculada ao método de pagamento selecionado.
                    </p>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500">Data de Início / Próxima</label>
                <input
                  type="date"
                  required
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsNewRecOpen(false)}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white hover:bg-emerald-500"
                >
                  Salvar Recorrência
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
