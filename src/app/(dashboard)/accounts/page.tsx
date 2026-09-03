'use client';

import React, { useState } from 'react';
import { useFinance } from '@/lib/context/finance-context';
import {
  Wallet,
  CreditCard as CreditCardIcon,
  Receipt,
  Plus,
  ArrowRightLeft,
  Calendar,
  Building,
  CheckCircle2,
  AlertCircle,
  Eye,
  DollarSign,
} from 'lucide-react';
import { formatCurrency, formatDate, formatMonthYear } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { BillInspectorModal } from '@/components/accounts/BillInspectorModal';
import { PaymentModal } from '@/components/transactions/PaymentModal';
import { Account, CreditCard, CreditCardBill } from '@/lib/types';

export default function AccountsPage() {
  const {
    accounts,
    allWorkspaceAccounts,
    creditCards,
    allWorkspaceCreditCards,
    creditCardBills,
    transfers,
    addAccount,
    updateAccount,
    deleteAccount,
    addCreditCard,
    createTransfer,
  } = useFinance();

  const [activeTab, setActiveTab] = useState<'accounts' | 'cards' | 'bills' | 'transfers'>('accounts');
  const [showInactiveAccounts, setShowInactiveAccounts] = useState(false);

  // Modais
  const [isNewAccountOpen, setIsNewAccountOpen] = useState(false);
  const [isNewCardOpen, setIsNewCardOpen] = useState(false);
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [selectedBill, setSelectedBill] = useState<CreditCardBill | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<{
    type: 'bill';
    id: string;
    title: string;
    totalAmount: number;
    paidAmount: number;
    dueDate?: string;
  } | null>(null);

  // Forms states
  const [accName, setAccName] = useState('');
  const [accType, setAccType] = useState<any>('checking');
  const [accInstitution, setAccInstitution] = useState('');
  const [accBalance, setAccBalance] = useState('');
  const [accColor, setAccColor] = useState('#10b981');

  const [cardName, setCardName] = useState('');
  const [cardInstitution, setCardInstitution] = useState('');
  const [cardLastDigits, setCardLastDigits] = useState('');
  const [cardLimit, setCardLimit] = useState('');
  const [cardClosingDay, setCardClosingDay] = useState(3);
  const [cardDueDay, setCardDueDay] = useState(10);
  const [cardAccountId, setCardAccountId] = useState('');

  // Transfer state
  const [fromAcc, setFromAcc] = useState('');
  const [toAcc, setToAcc] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferNotes, setTransferNotes] = useState('');

  const handleCreateAccount = (e: React.FormEvent) => {
    e.preventDefault();
    const balance = parseFloat(accBalance.replace(/\./g, '').replace(',', '.')) || 0;
    addAccount({
      name: accName,
      type: accType,
      institution: accInstitution || 'Geral',
      initial_balance: balance,
      current_balance: balance,
      color: accColor,
      active: true,
    });
    setAccName('');
    setAccInstitution('');
    setAccBalance('');
    setIsNewAccountOpen(false);
  };

  const handleCreateCard = (e: React.FormEvent) => {
    e.preventDefault();
    const limit = parseFloat(cardLimit.replace(/\./g, '').replace(',', '.')) || 0;
    addCreditCard({
      name: cardName,
      institution: cardInstitution || 'Banco',
      last_four_digits: cardLastDigits || '0000',
      credit_limit: limit,
      closing_day: cardClosingDay,
      due_day: cardDueDay,
      linked_payment_account_id: cardAccountId || undefined,
      color: '#6366f1',
      active: true,
    });
    setCardName('');
    setCardInstitution('');
    setCardLastDigits('');
    setCardLimit('');
    setIsNewCardOpen(false);
  };

  const handleTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(transferAmount.replace(/\./g, '').replace(',', '.')) || 0;
    if (amt <= 0 || !fromAcc || !toAcc || fromAcc === toAcc) return;
    createTransfer(fromAcc, toAcc, amt, undefined, transferNotes);
    setFromAcc('');
    setToAcc('');
    setTransferAmount('');
    setTransferNotes('');
    setIsTransferOpen(false);
  };

  const totalAccountsBalance = accounts.reduce((acc, a) => acc + (a.current_balance || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Contas, Cartões & Faturas
          </h2>
          <p className="text-xs text-slate-500">
            Patrimônio total em contas: <strong className="text-slate-800 dark:text-slate-200">{formatCurrency(totalAccountsBalance)}</strong>
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={() => setIsTransferOpen(true)}
            className="flex items-center gap-1.5 rounded-2xl bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-sm border border-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-200"
          >
            <ArrowRightLeft className="h-3.5 w-3.5 text-blue-600" />
            <span>Transferir entre Contas</span>
          </button>

          {activeTab === 'accounts' && (
            <button
              onClick={() => setIsNewAccountOpen(true)}
              className="flex items-center gap-1.5 rounded-2xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white shadow-md shadow-emerald-600/20 hover:bg-emerald-500"
            >
              <Plus className="h-4 w-4" />
              <span>Nova Conta</span>
            </button>
          )}

          {activeTab === 'cards' && (
            <button
              onClick={() => setIsNewCardOpen(true)}
              className="flex items-center gap-1.5 rounded-2xl bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white shadow-md shadow-indigo-600/20 hover:bg-indigo-500"
            >
              <Plus className="h-4 w-4" />
              <span>Novo Cartão</span>
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800">
        <button
          onClick={() => setActiveTab('accounts')}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-bold transition ${
            activeTab === 'accounts'
              ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Wallet className="h-4 w-4" />
          <span>Contas & Carteiras ({accounts.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('cards')}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-bold transition ${
            activeTab === 'cards'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <CreditCardIcon className="h-4 w-4" />
          <span>Cartões de Crédito ({creditCards.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('bills')}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-bold transition ${
            activeTab === 'bills'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Receipt className="h-4 w-4" />
          <span>Faturas ({creditCardBills.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('transfers')}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-bold transition ${
            activeTab === 'transfers'
              ? 'border-purple-600 text-purple-600 dark:text-purple-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <ArrowRightLeft className="h-4 w-4" />
          <span>Transferências ({transfers.length})</span>
        </button>
      </div>

      {/* Conteúdo da Tab 1: Contas Bancárias */}
      {activeTab === 'accounts' && (
        <div className="space-y-4">
          {allWorkspaceAccounts.some((a) => a.active === false) && (
            <div className="flex items-center justify-end">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showInactiveAccounts}
                  onChange={(e) => setShowInactiveAccounts(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span>Mostrar contas inativadas</span>
              </label>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(showInactiveAccounts ? allWorkspaceAccounts : accounts).map((acc) => {
              const isInactive = acc.active === false;

              return (
                <div
                  key={acc.id}
                  className={`flex flex-col justify-between rounded-3xl bg-white p-5 shadow-sm border transition ${
                    isInactive
                      ? 'border-red-200/80 bg-slate-50/60 opacity-80 dark:border-red-900/40 dark:bg-slate-900/40'
                      : 'border-slate-200/80 dark:bg-slate-900 dark:border-slate-800'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <div
                        className="flex h-10 w-10 items-center justify-center rounded-2xl font-bold text-white shadow-md"
                        style={{ backgroundColor: isInactive ? '#94a3b8' : acc.color }}
                      >
                        <Building className="h-5 w-5" />
                      </div>
                      <div className="flex items-center gap-1.5">
                        {isInactive && (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase text-red-600 dark:bg-red-950/60 dark:text-red-400">
                            Inativa
                          </span>
                        )}
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-500 dark:bg-slate-800">
                          {acc.type}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">{acc.name}</h3>
                      <p className="text-xs text-slate-400">{acc.institution}</p>
                    </div>
                  </div>

                  <div className="mt-6 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-semibold uppercase text-slate-400">Saldo Atual</span>
                      <div className="text-xl font-black text-slate-900 dark:text-white">
                        {formatCurrency(acc.current_balance)}
                      </div>
                    </div>

                    {isInactive && (
                      <button
                        onClick={() => updateAccount(acc.id, { active: true })}
                        className="rounded-xl bg-emerald-50 px-2.5 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 transition"
                      >
                        Reativar
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Conteúdo da Tab 2: Cartões de Crédito */}
      {activeTab === 'cards' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {creditCards.map((card) => {
            const currentBill = creditCardBills.find(
              (b) => b.credit_card_id === card.id && b.status === 'open'
            ) || creditCardBills.find((b) => b.credit_card_id === card.id);

            const billAmount = currentBill ? currentBill.total_amount : 0;
            const available = Math.max(0, card.credit_limit - billAmount);
            const usedPct = Math.min(100, Math.round((billAmount / card.credit_limit) * 100));

            return (
              <div
                key={card.id}
                className="rounded-3xl bg-white p-6 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-md shadow-indigo-600/20">
                      <CreditCardIcon className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white">{card.name}</h4>
                      <p className="text-xs text-slate-400">Final •••• {card.last_four_digits}</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/40">
                    <span className="text-[10px] text-slate-400">Fechamento:</span>
                    <p className="font-bold text-slate-700 dark:text-slate-200">Dia {card.closing_day}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/40">
                    <span className="text-[10px] text-slate-400">Vencimento:</span>
                    <p className="font-bold text-rose-600 dark:text-rose-400">Dia {card.due_day}</p>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-semibold pb-1">
                    <span className="text-slate-500">Limite Utilizado:</span>
                    <span className="text-slate-900 dark:text-white font-bold">{formatCurrency(billAmount)}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                    <div className="h-full bg-indigo-600 rounded-full" style={{ width: `${usedPct}%` }} />
                  </div>
                  <div className="mt-1 flex justify-between text-[10px] text-slate-400 font-semibold">
                    <span>Disponível: {formatCurrency(available)}</span>
                    <span>Total: {formatCurrency(card.credit_limit)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Conteúdo da Tab 3: Faturas */}
      {activeTab === 'bills' && (
        <div className="overflow-hidden rounded-3xl bg-white shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-100 bg-slate-50/70 uppercase tracking-wider text-slate-400 dark:border-slate-800 dark:bg-slate-800/40">
                <tr>
                  <th className="py-3.5 pl-6 pr-3">Cartão & Mês</th>
                  <th className="px-3 py-3.5">Fechamento</th>
                  <th className="px-3 py-3.5">Vencimento</th>
                  <th className="px-3 py-3.5">Status</th>
                  <th className="px-3 py-3.5 text-right">Total Fatura</th>
                  <th className="px-3 py-3.5 text-right">Valor Pago</th>
                  <th className="py-3.5 pl-3 pr-6 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {creditCardBills.map((bill) => {
                  const card = allWorkspaceCreditCards.find((c) => c.id === bill.credit_card_id);
                  return (
                    <tr key={bill.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50">
                      <td className="py-4 pl-6 pr-3">
                        <span className="font-bold text-slate-900 dark:text-white">
                          {formatMonthYear(bill.reference_month)}
                        </span>
                        <div className="text-[11px] text-slate-400">{card?.name}</div>
                      </td>
                      <td className="px-3 py-4 text-slate-600 dark:text-slate-300">
                        {formatDate(bill.closing_date)}
                      </td>
                      <td className="px-3 py-4 font-semibold text-rose-600 dark:text-rose-400">
                        {formatDate(bill.due_date)}
                      </td>
                      <td className="px-3 py-4">
                        <StatusBadge status={bill.status} />
                      </td>
                      <td className="px-3 py-4 text-right font-extrabold text-slate-900 dark:text-white">
                        {formatCurrency(bill.total_amount)}
                      </td>
                      <td className="px-3 py-4 text-right font-bold text-emerald-600">
                        {formatCurrency(bill.paid_amount || 0)}
                      </td>
                      <td className="py-4 pl-3 pr-6 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setSelectedBill(bill)}
                            className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                          >
                            Inspecionar
                          </button>
                          {bill.status !== 'paid' && (
                            <button
                              onClick={() =>
                                setPaymentTarget({
                                  type: 'bill',
                                  id: bill.id,
                                  title: `Fatura ${bill.reference_month} (${card?.name})`,
                                  totalAmount: bill.total_amount,
                                  paidAmount: bill.paid_amount || 0,
                                  dueDate: bill.due_date,
                                })
                              }
                              className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white shadow-sm hover:bg-emerald-500"
                            >
                              Pagar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Conteúdo da Tab 4: Histórico de Transferências */}
      {activeTab === 'transfers' && (
        <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Histórico de Transferências</h3>
              <p className="text-xs text-slate-500">Rastreabilidade completa de movimentações entre suas contas.</p>
            </div>
            <button
              onClick={() => setIsTransferOpen(true)}
              className="flex items-center gap-1.5 rounded-2xl bg-blue-600 px-3.5 py-2 text-xs font-bold text-white shadow-md hover:bg-blue-500"
            >
              <ArrowRightLeft className="h-4 w-4" />
              <span>Nova Transferência</span>
            </button>
          </div>

          {transfers.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              Nenhuma transferência registrada neste workspace.
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 dark:border-slate-800">
                    <th className="pb-3 font-semibold">Data</th>
                    <th className="pb-3 font-semibold">Conta de Origem</th>
                    <th className="pb-3 font-semibold">Conta de Destino</th>
                    <th className="pb-3 font-semibold">Observações</th>
                    <th className="pb-3 font-semibold text-right">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {transfers.map((trf) => (
                    <tr key={trf.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="py-3 font-mono text-slate-500">{trf.transfer_date}</td>
                      <td className="py-3 font-bold text-rose-600">
                        {allWorkspaceAccounts.find((a) => a.id === trf.from_account_id)?.name || 'Conta Origem'}
                      </td>
                      <td className="py-3 font-bold text-emerald-600">
                        {allWorkspaceAccounts.find((a) => a.id === trf.to_account_id)?.name || 'Conta Destino'}
                      </td>
                      <td className="py-3 text-slate-500">{trf.notes || '-'}</td>
                      <td className="py-3 text-right font-black text-slate-900 dark:text-white">
                        {formatCurrency(trf.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modal Nova Conta */}
      {isNewAccountOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Cadastrar Nova Conta</h3>
            <form onSubmit={handleCreateAccount} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500">Nome da Conta</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Nubank Principal"
                  value={accName}
                  onChange={(e) => setAccName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-500">Tipo</label>
                  <select
                    value={accType}
                    onChange={(e) => setAccType(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                  >
                    <option value="checking">Conta Corrente</option>
                    <option value="savings">Poupança</option>
                    <option value="cash">Dinheiro em Espécie</option>
                    <option value="investment">Investimentos</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-500">Instituição</label>
                  <input
                    type="text"
                    placeholder="Ex: Nubank, Itaú"
                    value={accInstitution}
                    onChange={(e) => setAccInstitution(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500">Saldo Inicial</label>
                <input
                  type="text"
                  placeholder="0,00"
                  value={accBalance}
                  onChange={(e) => setAccBalance(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-xs font-bold dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsNewAccountOpen(false)}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white hover:bg-emerald-500"
                >
                  Salvar Conta
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Novo Cartão */}
      {isNewCardOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Cadastrar Cartão de Crédito</h3>
            <form onSubmit={handleCreateCard} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500">Nome do Cartão</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Nubank Ultravioleta"
                  value={cardName}
                  onChange={(e) => setCardName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-500">Últimos 4 dígitos</label>
                  <input
                    type="text"
                    maxLength={4}
                    placeholder="1234"
                    value={cardLastDigits}
                    onChange={(e) => setCardLastDigits(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-500">Limite Total</label>
                  <input
                    type="text"
                    required
                    placeholder="10000,00"
                    value={cardLimit}
                    onChange={(e) => setCardLimit(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-xs font-bold dark:border-slate-700 dark:bg-slate-800"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-500">Dia Fechamento</label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    required
                    value={cardClosingDay}
                    onChange={(e) => setCardClosingDay(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-500">Dia Vencimento</label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    required
                    value={cardDueDay}
                    onChange={(e) => setCardDueDay(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsNewCardOpen(false)}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white hover:bg-indigo-500"
                >
                  Salvar Cartão
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Transferência */}
      {isTransferOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Transferência entre Contas</h3>
            <form onSubmit={handleTransfer} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500">Conta Origem (Saída)</label>
                <select
                  required
                  value={fromAcc}
                  onChange={(e) => setFromAcc(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                >
                  <option value="">Selecione</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({formatCurrency(a.current_balance)})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500">Conta Destino (Entrada)</label>
                <select
                  required
                  value={toAcc}
                  onChange={(e) => setToAcc(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                >
                  <option value="">Selecione</option>
                  {accounts
                    .filter((a) => a.id !== fromAcc)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({formatCurrency(a.current_balance)})
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500">Valor da Transferência</label>
                <input
                  type="text"
                  required
                  placeholder="0,00"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-base font-bold dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsTransferOpen(false)}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-blue-600 px-5 py-2 text-xs font-bold text-white hover:bg-blue-500"
                >
                  Confirmar Transferência
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modais de Inspeção e Pagamento */}
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

      <PaymentModal
        isOpen={!!paymentTarget}
        onClose={() => setPaymentTarget(null)}
        target={paymentTarget}
      />
    </div>
  );
}
