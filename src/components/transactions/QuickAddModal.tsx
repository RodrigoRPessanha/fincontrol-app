'use client';

import React, { useState, useMemo } from 'react';
import { useFinance } from '@/lib/context/finance-context';
import {
  X,
  ChevronDown,
  ChevronUp,
  CreditCard as CreditCardIcon,
  Calendar,
  Check,
  ArrowRightLeft,
  DollarSign,
  Layers,
  AlertCircle,
} from 'lucide-react';
import { CategoryIcon } from '../shared/CategoryIcon';
import { formatCurrency } from '@/lib/utils';
import { calculateCardBillDates, splitInstallments } from '@/lib/financial-engine';
import { format } from 'date-fns';

interface QuickAddModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function QuickAddModal({ isOpen, onClose }: QuickAddModalProps) {
  const {
    categories,
    paymentMethods,
    accounts,
    creditCards,
    addTransaction,
    createInstallmentPurchase,
    createTransfer,
  } = useFinance();

  const [type, setType] = useState<'expense' | 'income' | 'transfer'>('expense');
  const [description, setDescription] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [installmentCount, setInstallmentCount] = useState(1);
  const [paidInstallmentsCount, setPaidInstallmentsCount] = useState(0);

  // Transferência
  const [fromAccountId, setFromAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');

  // Cartão de Crédito Explícito
  const [selectedCreditCardId, setSelectedCreditCardId] = useState('');

  // Opções Avançadas (Divulgação Progressiva)
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const [transactionDate, setTransactionDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [dueDate, setDueDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [isAlreadyPaid, setIsAlreadyPaid] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [notes, setNotes] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const filteredCategories = categories.filter(
    (c) => c.type === (type === 'transfer' ? 'expense' : type)
  );

  const filteredPaymentMethods = useMemo(() => {
    if (type === 'income') {
      return paymentMethods.filter((p) => p.type !== 'credit_card' && !p.credit_card_id);
    }
    return paymentMethods;
  }, [paymentMethods, type]);

  const selectedPaymentMethod = paymentMethods.find((p) => p.id === paymentMethodId);
  const isCreditCardSelected =
    type === 'expense' &&
    (selectedPaymentMethod?.type === 'credit_card' || !!selectedPaymentMethod?.credit_card_id);

  // Precedência absoluta: método com cartão fixo sempre tem prioridade sobre seleção genérica
  const selectedCard = useMemo(() => {
    if (!isCreditCardSelected) return undefined;
    if (selectedPaymentMethod?.credit_card_id) {
      return creditCards.find((c) => c.id === selectedPaymentMethod.credit_card_id);
    }
    if (selectedCreditCardId) {
      return creditCards.find((c) => c.id === selectedCreditCardId);
    }
    return undefined;
  }, [isCreditCardSelected, selectedPaymentMethod, selectedCreditCardId, creditCards]);

  const handleTypeSelect = (newType: 'expense' | 'income' | 'transfer') => {
    setType(newType);
    setCategoryId('');
    if (newType === 'income') {
      setSelectedCreditCardId('');
      if (selectedPaymentMethod && (selectedPaymentMethod.type === 'credit_card' || selectedPaymentMethod.credit_card_id)) {
        setPaymentMethodId('');
      }
    }
  };

  // Cálculo da primeira fatura e preview exato ao centavo via splitInstallments
  const billPreview = selectedCard
    ? calculateCardBillDates(transactionDate, selectedCard.closing_day, selectedCard.due_day)
    : null;

  const numAmount = parseFloat(amountStr.replace(/\./g, '').replace(',', '.')) || 0;

  const splitPreview =
    isCreditCardSelected && installmentCount > 1 && selectedCard && numAmount > 0
      ? splitInstallments(numAmount, installmentCount, transactionDate, selectedCard, paidInstallmentsCount)
      : [];

  const pendingBalancePreview = splitPreview.length > 0
    ? splitPreview.filter((s) => !s.isPaid).reduce((acc, s) => acc + s.amount, 0)
    : numAmount;

  const resetAndClose = () => {
    setDescription('');
    setAmountStr('');
    setCategoryId('');
    setPaymentMethodId('');
    setSelectedCreditCardId('');
    setInstallmentCount(1);
    setPaidInstallmentsCount(0);
    setFromAccountId('');
    setToAccountId('');
    setTransactionDate(format(new Date(), 'yyyy-MM-dd'));
    setDueDate(format(new Date(), 'yyyy-MM-dd'));
    setIsAlreadyPaid(false);
    setAccountId('');
    setNotes('');
    setErrorMessage(null);
    setShowMoreOptions(false);
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    if (numAmount <= 0) {
      setErrorMessage('O valor da transação deve ser maior que zero.');
      return;
    }

    try {
      if (type === 'transfer') {
        if (!fromAccountId || !toAccountId || fromAccountId === toAccountId) {
          setErrorMessage('Selecione contas de origem e destino distintas.');
          return;
        }
        createTransfer(fromAccountId, toAccountId, numAmount, transactionDate, notes);
        resetAndClose();
        return;
      }

      if (isCreditCardSelected && !selectedCard) {
        setErrorMessage('Por favor, selecione um cartão de crédito válido para continuar.');
        return;
      }

      if (isCreditCardSelected && installmentCount > 1 && selectedCard) {
        // Compra Parcelada Atômica com suporte a parcelas já pagas
        createInstallmentPurchase({
          description: description.trim() || 'Compra Parcelada',
          total_amount: numAmount,
          installment_count: installmentCount,
          purchase_date: transactionDate,
          credit_card_id: selectedCard.id,
          category_id: categoryId || undefined,
          payment_method_id: paymentMethodId || undefined,
          account_id: accountId || selectedPaymentMethod?.linked_account_id || selectedCard.linked_payment_account_id || undefined,
          paid_installments_count: paidInstallmentsCount,
        });
      } else {
        // Transação Avulsa
        addTransaction({
          description: description.trim() || (type === 'expense' ? 'Despesa' : 'Receita'),
          amount: numAmount,
          type: type,
          category_id: categoryId || undefined,
          payment_method_id: paymentMethodId || undefined,
          credit_card_id: isCreditCardSelected && selectedCard ? selectedCard.id : undefined,
          account_id: accountId || selectedPaymentMethod?.linked_account_id || undefined,
          transaction_date: transactionDate,
          due_date: isCreditCardSelected && billPreview ? billPreview.dueDate : dueDate,
          status: isAlreadyPaid ? 'paid' : 'pending',
          paid_at: isAlreadyPaid ? new Date().toISOString() : null,
          notes: notes || undefined,
        });
      }

      resetAndClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Erro ao processar o registro financeiro.');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900 border border-slate-100 dark:border-slate-800 my-8">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-xl font-bold text-white shadow-md ${
                type === 'expense'
                  ? 'bg-rose-500 shadow-rose-500/20'
                  : type === 'income'
                  ? 'bg-emerald-500 shadow-emerald-500/20'
                  : 'bg-blue-500 shadow-blue-500/20'
              }`}
            >
              {type === 'expense' ? '-' : type === 'income' ? '+' : '⇄'}
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              {type === 'expense'
                ? 'Nova Despesa'
                : type === 'income'
                ? 'Nova Receita'
                : 'Nova Transferência'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tipo de Transação (Tabs) */}
        <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-slate-100 p-1.5 dark:bg-slate-800">
          <button
            type="button"
            onClick={() => handleTypeSelect('expense')}
            className={`rounded-xl py-2 text-xs font-bold transition ${
              type === 'expense'
                ? 'bg-white text-rose-600 shadow-sm dark:bg-slate-900 dark:text-rose-400'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            Despesa
          </button>
          <button
            type="button"
            onClick={() => handleTypeSelect('income')}
            className={`rounded-xl py-2 text-xs font-bold transition ${
              type === 'income'
                ? 'bg-white text-emerald-600 shadow-sm dark:bg-slate-900 dark:text-emerald-400'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            Receita
          </button>
          <button
            type="button"
            onClick={() => handleTypeSelect('transfer')}
            className={`rounded-xl py-2 text-xs font-bold transition ${
              type === 'transfer'
                ? 'bg-white text-blue-600 shadow-sm dark:bg-slate-900 dark:text-blue-400'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            Transferência
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Alerta Amigável de Validação */}
          {errorMessage && (
            <div className="rounded-2xl bg-rose-50 p-3.5 text-xs font-bold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 border border-rose-200 dark:border-rose-900 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Valor Principal */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Valor
            </label>
            <div className="relative mt-1.5">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-400">
                R$
              </span>
              <input
                type="text"
                required
                placeholder="0,00"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                className="w-full rounded-2xl border border-slate-300 bg-slate-50/50 py-3 pl-12 pr-4 text-2xl font-black text-slate-900 placeholder:text-slate-300 focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
          </div>

          {/* Se for transferência */}
          {type === 'transfer' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Conta de Origem (Debitar)
                </label>
                <select
                  required
                  value={fromAccountId}
                  onChange={(e) => setFromAccountId(e.target.value)}
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
                  onChange={(e) => setToAccountId(e.target.value)}
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
          ) : (
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
                  onChange={(e) => setDescription(e.target.value)}
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
                    onChange={(e) => setCategoryId(e.target.value)}
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

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Método de Pagamento
                  </label>
                  <select
                    value={paymentMethodId}
                    onChange={(e) => {
                      setPaymentMethodId(e.target.value);
                      setSelectedCreditCardId('');
                    }}
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
              </div>

              {/* Opção Especial: Parcelamento em Cartão de Crédito */}
              {isCreditCardSelected && (
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
                          onChange={(e) => setSelectedCreditCardId(e.target.value)}
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
                          setInstallmentCount(val);
                          if (paidInstallmentsCount >= val) setPaidInstallmentsCount(0);
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
                          onChange={(e) => setPaidInstallmentsCount(Number(e.target.value))}
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
              )}
            </>
          )}

          {/* Divulgação Progressiva: Mais Opções */}
          <div className="border-t border-slate-100 pt-2 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setShowMoreOptions(!showMoreOptions)}
              className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
            >
              <span>{showMoreOptions ? 'Menos opções' : 'Mais opções (Datas, Conta)'}</span>
              {showMoreOptions ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>

            {showMoreOptions && (
              <div className="mt-3 space-y-3 rounded-2xl bg-slate-50 p-3.5 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Data da Compra / Competência
                    </label>
                    <input
                      type="date"
                      value={transactionDate}
                      onChange={(e) => setTransactionDate(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Data de Vencimento
                    </label>
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                </div>

                {type !== 'transfer' && !isCreditCardSelected && (
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="checkbox"
                      id="alreadyPaid"
                      checked={isAlreadyPaid}
                      onChange={(e) => setIsAlreadyPaid(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <label
                      htmlFor="alreadyPaid"
                      className="text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer"
                    >
                      {type === 'expense' ? 'Esta despesa já foi paga hoje' : 'Esta receita já foi recebida hoje'}
                    </label>
                  </div>
                )}

                {/* Selecionar Conta Bancária específica */}
                {type !== 'transfer' && (
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Conta Bancária
                    </label>
                    <select
                      value={accountId}
                      onChange={(e) => setAccountId(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    >
                      <option value="">Conta padrão do método ou nenhuma</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({formatCurrency(a.current_balance)})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Observações */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Observações / Notas
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Adicione detalhes, tags ou número do documento..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-2 text-xs text-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Submit Button */}
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={resetAndClose}
              className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-600/25 transition hover:bg-emerald-500 active:scale-95"
            >
              Salvar Registro
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
