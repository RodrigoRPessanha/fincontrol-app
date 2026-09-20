'use client';

import React, { useState, useMemo } from 'react';
import { useFinance } from '@/lib/context/finance-context';
import {
  X,
  ChevronDown,
  ChevronUp,
  AlertCircle,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { calculateCardBillDates, splitInstallments, toCents, fromCents, calculateExpenseSplits } from '@/lib/financial-engine';
import { SplitType, TransactionSplit } from '@/lib/types';
import { format } from 'date-fns';
import { TransactionFields } from './quick-add/TransactionFields';
import { PaymentMethodFields } from './quick-add/PaymentMethodFields';
import { InstallmentFields } from './quick-add/InstallmentFields';
import { SplitFields } from './quick-add/SplitFields';

interface QuickAddModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function QuickAddModal({ isOpen, onClose }: QuickAddModalProps) {
  const {
    activeWorkspace,
    categories,
    paymentMethods,
    accounts,
    creditCards,
    workspaceMembers,
    addTransaction,
    createInstallmentPurchase,
    createTransfer,
  } = useFinance();

  const isExpenseTracker = activeWorkspace?.tracking_mode === 'expense_tracker';

  const [type, setType] = useState<'expense' | 'income' | 'transfer'>('expense');
  const [description, setDescription] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [installmentCount, setInstallmentCount] = useState(1);
  const [paidInstallmentsCount, setPaidInstallmentsCount] = useState(0);

  // Rateio de Despesas (Splitwise)
  const [paidByMemberId, setPaidByMemberId] = useState('');
  const [splitType, setSplitType] = useState<SplitType>('individual');
  const [customSplits, setCustomSplits] = useState<Record<string, number>>({});

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
    ? fromCents(splitPreview.filter((s) => !s.isPaid).reduce((acc, s) => acc + toCents(s.amount), 0))
    : numAmount;

  const resetAndClose = () => {
    setDescription('');
    setAmountStr('');
    setCategoryId('');
    setPaymentMethodId('');
    setSelectedCreditCardId('');
    setInstallmentCount(1);
    setPaidInstallmentsCount(0);
    setPaidByMemberId('');
    setSplitType('individual');
    setCustomSplits({});
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

      const effectivePayerId = paidByMemberId || workspaceMembers[0]?.id;
      let resolvedSplits: TransactionSplit[] | undefined = undefined;

      if (type === 'expense' && splitType !== 'individual' && workspaceMembers.length > 1 && effectivePayerId) {
        const customList = splitType === 'custom'
          ? workspaceMembers.map((m) => ({ member_id: m.id, amount: customSplits[m.id] || 0 }))
          : undefined;
        resolvedSplits = calculateExpenseSplits(numAmount, splitType, workspaceMembers, effectivePayerId, customList);
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
          paid_by_member_id: effectivePayerId,
          split_type: splitType !== 'individual' ? splitType : undefined,
          splits: resolvedSplits,
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
          paid_by_member_id: effectivePayerId,
          split_type: splitType !== 'individual' ? splitType : undefined,
          splits: resolvedSplits,
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
        <div className={`mt-4 grid ${isExpenseTracker ? 'grid-cols-2' : 'grid-cols-3'} gap-2 rounded-2xl bg-slate-100 p-1.5 dark:bg-slate-800`}>
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
          {!isExpenseTracker && (
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
          )}
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

          {/* Campos de Transação e Método */}
          <TransactionFields
            type={type}
            description={description}
            onDescriptionChange={setDescription}
            categoryId={categoryId}
            onCategoryChange={setCategoryId}
            filteredCategories={filteredCategories}
            fromAccountId={fromAccountId}
            onFromAccountIdChange={setFromAccountId}
            toAccountId={toAccountId}
            onToAccountIdChange={setToAccountId}
            accounts={accounts}
            paymentMethodSlot={
              <PaymentMethodFields
                paymentMethodId={paymentMethodId}
                onPaymentMethodChange={(val) => {
                  setPaymentMethodId(val);
                  setSelectedCreditCardId('');
                }}
                filteredPaymentMethods={filteredPaymentMethods}
              />
            }
          />

          {/* Opção Especial: Parcelamento em Cartão de Crédito */}
          {type !== 'transfer' && (
            <InstallmentFields
              isCreditCardSelected={isCreditCardSelected}
              selectedPaymentMethod={selectedPaymentMethod}
              creditCards={creditCards}
              selectedCreditCardId={selectedCreditCardId}
              onSelectedCreditCardIdChange={setSelectedCreditCardId}
              installmentCount={installmentCount}
              onInstallmentCountChange={setInstallmentCount}
              paidInstallmentsCount={paidInstallmentsCount}
              onPaidInstallmentsCountChange={setPaidInstallmentsCount}
              numAmount={numAmount}
              billPreview={billPreview}
              pendingBalancePreview={pendingBalancePreview}
            />
          )}

          {/* Rateio de Despesas (Splitwise) */}
          {type !== 'transfer' && (
            <SplitFields
              type={type}
              workspaceMembers={workspaceMembers}
              paidByMemberId={paidByMemberId}
              onPaidByMemberIdChange={setPaidByMemberId}
              splitType={splitType}
              onSplitTypeChange={setSplitType}
              customSplits={customSplits}
              onCustomSplitChange={(mId, val) =>
                setCustomSplits((prev) => ({ ...prev, [mId]: val }))
              }
              numAmount={numAmount}
            />
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

                {/* Selecionar Conta Bancária específica (Apenas quando modo patrimonial completo) */}
                {type !== 'transfer' && !isExpenseTracker && (
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
