'use client';

import React, { useState } from 'react';
import { useFinance } from '@/lib/context/finance-context';
import { X, CheckCircle2, DollarSign, Calendar, Wallet } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { toCents, fromCents } from '@/lib/financial-engine';
import { format } from 'date-fns';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  target: {
    type: 'transaction' | 'installment' | 'bill';
    id: string;
    title: string;
    totalAmount: number;
    paidAmount: number;
    dueDate?: string;
  } | null;
}

export function parseCurrencyInput(val: string): number {
  const trimmed = val.trim();
  if (!trimmed) return NaN;

  // 1. Formato brasileiro com vírgula decimal (ex: 1.234,56 ou 1234,56 ou 0,20)
  if (/^\d{1,3}(\.\d{3})*,\d{1,2}$/.test(trimmed) || /^\d+,\d{1,2}$/.test(trimmed)) {
    const normalized = trimmed.replace(/\./g, '').replace(',', '.');
    const num = parseFloat(normalized);
    return Number.isFinite(num) ? num : NaN;
  }

  // 2. Formato internacional com ponto decimal (ex: 1,234.56 ou 1234.56 ou 0.20)
  if (/^\d{1,3}(,\d{3})*\.\d{1,2}$/.test(trimmed) || /^\d+\.\d{1,2}$/.test(trimmed)) {
    const normalized = trimmed.replace(/,/g, '');
    const num = parseFloat(normalized);
    return Number.isFinite(num) ? num : NaN;
  }

  // 3. Inteiro puro (ex: 20 ou 1000)
  if (/^\d+$/.test(trimmed)) {
    const num = parseFloat(trimmed);
    return Number.isFinite(num) ? num : NaN;
  }

  return NaN;
}

export function PaymentModal({ isOpen, onClose, target }: PaymentModalProps) {
  const { accounts, activeWorkspace, recordPayment, payCreditCardBill } = useFinance();
  const isExpenseTracker = activeWorkspace?.tracking_mode === 'expense_tracker';

  const [amountStr, setAmountStr] = useState('');
  const [accountId, setAccountId] = useState('');
  const [paymentDate, setPaymentDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [notes, setNotes] = useState('');

  if (!isOpen || !target) return null;

  const totalCents = toCents(target.totalAmount);
  const paidCents = toCents(target.paidAmount || 0);
  const remainingCents = Math.max(0, totalCents - paidCents);
  const remaining = fromCents(remainingCents);

  const trimmed = amountStr.trim();
  const isInputEmpty = trimmed === '';
  const rawNum = parseCurrencyInput(trimmed);
  const isInvalid = !isInputEmpty && (!Number.isFinite(rawNum) || rawNum <= 0);

  const currentAmountCents = !isInputEmpty && !isInvalid ? toCents(rawNum) : 0;
  const currentAmount = fromCents(currentAmountCents);
  const isOverRemaining = currentAmountCents > remainingCents;
  const isAccountMissing = !isExpenseTracker && !accountId;
  const canSubmit = !isAccountMissing && !isInputEmpty && !isInvalid && currentAmountCents > 0 && !isOverRemaining;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    if (target.type === 'bill') {
      payCreditCardBill(target.id, accountId || undefined, currentAmount, paymentDate, notes || undefined);
    } else {
      recordPayment({
        transaction_id: target.type === 'transaction' ? target.id : undefined,
        installment_id: target.type === 'installment' ? target.id : undefined,
        account_id: accountId || undefined,
        amount: currentAmount,
        payment_date: paymentDate,
        notes: notes || undefined,
      });
    }

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500 text-white font-bold shadow-md shadow-emerald-500/20">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Registrar Pagamento</h3>
              <p className="text-xs text-slate-500 truncate max-w-[240px]">{target.title}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Resumo da Obrigação */}
        <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 text-center">
          <div>
            <span className="text-[10px] font-semibold uppercase text-slate-400">Total</span>
            <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
              {formatCurrency(target.totalAmount)}
            </p>
          </div>
          <div>
            <span className="text-[10px] font-semibold uppercase text-slate-400">Já Pago</span>
            <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
              {formatCurrency(target.paidAmount)}
            </p>
          </div>
          <div>
            <span className="text-[10px] font-semibold uppercase text-slate-400">Restante</span>
            <p className="text-xs font-bold text-rose-600 dark:text-rose-400">
              {formatCurrency(remaining)}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Valor a Pagar */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Valor do Pagamento
              </label>
              <button
                type="button"
                onClick={() => setAmountStr(remaining.toFixed(2).replace('.', ','))}
                className="text-xs font-bold text-emerald-600 hover:underline"
              >
                Pagar Total ({formatCurrency(remaining)})
              </button>
            </div>
            <div className="relative mt-1.5">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-base font-bold text-slate-400">
                R$
              </span>
              <input
                type="text"
                required
                placeholder={remaining.toFixed(2).replace('.', ',')}
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                className={`w-full rounded-xl border py-2.5 pl-10 pr-3 text-lg font-bold text-slate-900 focus:outline-none dark:bg-slate-800 dark:text-white ${
                  isInvalid || isOverRemaining
                    ? 'border-rose-500 bg-rose-50/30'
                    : 'border-slate-300 bg-white focus:border-emerald-500 dark:border-slate-700'
                }`}
              />
            </div>
            {isInvalid && (
              <p className="mt-1 text-[11px] font-bold text-rose-600">
                Por favor, informe um valor monetário válido maior que zero.
              </p>
            )}
            {isOverRemaining && !isInvalid && (
              <p className="mt-1 text-[11px] font-bold text-rose-600">
                O valor não pode ser superior ao saldo restante ({formatCurrency(remaining)}).
              </p>
            )}
          </div>

          {/* Conta de Origem (Débito) - Apenas quando controle de saldo ativo */}
          {isExpenseTracker ? (
            <div className="rounded-2xl bg-teal-50/70 p-3 text-xs text-teal-800 dark:bg-teal-950/40 dark:text-teal-300 border border-teal-200/60 dark:border-teal-900/60">
              <span className="font-bold">Modo Apenas Despesas:</span> Esta baixa atualizará o status para pago e registrará o histórico sem alterar saldos de contas.
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Conta de Saída do Dinheiro
              </label>
              <select
                required
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                <option value="">Selecione a conta</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} — Saldo: {formatCurrency(acc.current_balance)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Data do Pagamento */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Data do Pagamento
            </label>
            <input
              type="date"
              required
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          {/* Observações */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Observação (Opcional)
            </label>
            <input
              type="text"
              placeholder="Ex: 1º pagamento parcial, PIX comprovante 123"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className={`rounded-xl px-5 py-2 text-sm font-bold text-white shadow-md transition ${
                !canSubmit
                  ? 'bg-slate-400 cursor-not-allowed opacity-60'
                  : 'bg-emerald-600 shadow-emerald-600/20 hover:bg-emerald-500'
              }`}
            >
              Confirmar Pagamento
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
