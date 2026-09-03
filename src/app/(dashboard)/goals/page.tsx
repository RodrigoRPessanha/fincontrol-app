'use client';

import React, { useState } from 'react';
import { useFinance } from '@/lib/context/finance-context';
import {
  Target,
  Plus,
  TrendingUp,
  Calendar,
  CheckCircle2,
  DollarSign,
  ShieldCheck,
  Plane,
  Car,
  Home,
  Sparkles,
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { FinancialGoal } from '@/lib/types';

export default function GoalsPage() {
  const { goals, accounts, addGoal, depositGoal } = useFinance();

  const [isNewGoalOpen, setIsNewGoalOpen] = useState(false);
  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState<FinancialGoal | null>(null);

  // Form states
  const [goalName, setGoalName] = useState('');
  const [targetAmountStr, setTargetAmountStr] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [goalIcon, setGoalIcon] = useState('shield-check');
  const [goalColor, setGoalColor] = useState('#10b981');

  // Deposit state
  const [depositAmountStr, setDepositAmountStr] = useState('');
  const [depositAccountId, setDepositAccountId] = useState('');

  const handleCreateGoal = (e: React.FormEvent) => {
    e.preventDefault();
    const targetAmt = parseFloat(targetAmountStr.replace(/\./g, '').replace(',', '.')) || 0;
    if (!goalName.trim() || targetAmt <= 0) return;

    addGoal({
      name: goalName.trim(),
      target_amount: targetAmt,
      current_amount: 0,
      target_date: targetDate || undefined,
      status: 'in_progress',
      color: goalColor,
      icon: goalIcon,
    });

    setGoalName('');
    setTargetAmountStr('');
    setTargetDate('');
    setIsNewGoalOpen(false);
  };

  const handleDeposit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGoal || !depositAccountId) return;
    const amt = parseFloat(depositAmountStr.replace(/\./g, '').replace(',', '.')) || 0;
    if (amt <= 0) return;

    depositGoal(selectedGoal.id, amt, depositAccountId);
    setDepositAmountStr('');
    setDepositAccountId('');
    setIsDepositOpen(false);
    setSelectedGoal(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Metas & Objetivos Financeiros
          </h2>
          <p className="text-xs text-slate-500">
            Acompanhe o progresso das suas reservas, viagens, compra de patrimônio e sonhos.
          </p>
        </div>

        <button
          onClick={() => setIsNewGoalOpen(true)}
          className="flex items-center gap-1.5 rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-600/25 transition hover:bg-emerald-500 self-start sm:self-auto"
        >
          <Plus className="h-4 w-4 stroke-[2.5]" />
          <span>Criar Nova Meta</span>
        </button>
      </div>

      {/* Grid de Metas */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {goals.map((goal) => {
          const percent = Math.min(100, Math.round((goal.current_amount / goal.target_amount) * 100));
          const remaining = Math.max(0, goal.target_amount - goal.current_amount);
          const isCompleted = goal.current_amount >= goal.target_amount;

          return (
            <div
              key={goal.id}
              className="flex flex-col justify-between rounded-3xl bg-white p-6 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800 transition hover:shadow-md"
            >
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-2xl text-white font-bold shadow-md"
                      style={{ backgroundColor: goal.color }}
                    >
                      <Target className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">{goal.name}</h3>
                      {goal.target_date && (
                        <span className="text-[11px] text-slate-400">
                          Prazo: {formatDate(goal.target_date)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Barra de Progresso */}
                <div className="mt-4 space-y-1.5">
                  <div className="flex justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
                    <span>{percent}% alcançado</span>
                    <span className="text-emerald-600 dark:text-emerald-400">
                      {isCompleted ? 'Meta Concluída! 🎉' : `Faltam ${formatCurrency(remaining)}`}
                    </span>
                  </div>
                  <div className="h-3.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>

                {/* Valores Acumulados */}
                <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-slate-50 p-3 text-xs dark:bg-slate-800/40">
                  <div>
                    <span className="text-[10px] text-slate-400 font-semibold uppercase">Acumulado:</span>
                    <p className="font-extrabold text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(goal.current_amount)}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-semibold uppercase">Meta Final:</span>
                    <p className="font-extrabold text-slate-900 dark:text-white">
                      {formatCurrency(goal.target_amount)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Botão de Depositar Fundos */}
              <div className="mt-5 pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                <button
                  onClick={() => {
                    setSelectedGoal(goal);
                    setIsDepositOpen(true);
                  }}
                  className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-emerald-50 py-2.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800"
                >
                  <DollarSign className="h-4 w-4" />
                  <span>Guardar Dinheiro nesta Meta</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal Nova Meta */}
      {isNewGoalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Criar Meta Financeira</h3>
            <form onSubmit={handleCreateGoal} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500">Nome da Meta</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Reserva de Emergência 6 meses"
                  value={goalName}
                  onChange={(e) => setGoalName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500">Valor Alvo (Meta)</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: 50000,00"
                  value={targetAmountStr}
                  onChange={(e) => setTargetAmountStr(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-base font-bold dark:border-slate-700 dark:bg-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500">Data Limite (Opcional)</label>
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsNewGoalOpen(false)}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white hover:bg-emerald-500"
                >
                  Salvar Meta
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Depositar na Meta */}
      {isDepositOpen && selectedGoal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Guardar Dinheiro na Meta</h3>
            <p className="text-xs text-slate-500">{selectedGoal.name}</p>

            <form onSubmit={handleDeposit} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500">Conta de Origem</label>
                <select
                  required
                  value={depositAccountId}
                  onChange={(e) => setDepositAccountId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-xs dark:border-slate-700 dark:bg-slate-800"
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
                <label className="block text-xs font-semibold uppercase text-slate-500">Valor a Guardar</label>
                <input
                  type="text"
                  required
                  placeholder="0,00"
                  value={depositAmountStr}
                  onChange={(e) => setDepositAmountStr(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-base font-bold dark:border-slate-700 dark:bg-slate-800"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsDepositOpen(false)}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white hover:bg-emerald-500"
                >
                  Confirmar Aporte
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
