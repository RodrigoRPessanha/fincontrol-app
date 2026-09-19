'use client';

import React, { useState, useMemo } from 'react';
import { useFinance } from '@/lib/context/finance-context';
import { calculateMemberNetBalances } from '@/lib/financial-engine';
import { formatCurrency, formatDate } from '@/lib/utils';
import { format } from 'date-fns';
import {
  Scale,
  Users,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  PlusCircle,
  Clock,
  History,
  Check,
  X,
  CreditCard,
  Trash2,
} from 'lucide-react';

export default function SplitsPage() {
  const {
    activeWorkspace,
    workspaceMembers,
    transactions,
    purchases,
    settlements,
    recordSettlement,
    deleteSettlement,
  } = useFinance();

  // Modal de Liquidação / Registro de Acerto
  const [isSettlementModalOpen, setIsSettlementModalOpen] = useState(false);
  const [fromMemberId, setFromMemberId] = useState('');
  const [toMemberId, setToMemberId] = useState('');
  const [settlementAmountStr, setSettlementAmountStr] = useState('');
  const [settlementDate, setSettlementDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [settlementNotes, setSettlementNotes] = useState('');
  const [settlementError, setSettlementError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Membros do workspace ativo
  const currentMembers = useMemo(
    () => workspaceMembers.filter((m) => m.workspace_id === activeWorkspace.id),
    [workspaceMembers, activeWorkspace.id]
  );

  // Cálculo de Balanços e Dívidas Consolidadas pelo Motor Financeiro Puro (com Purchases parceladas)
  const { balances, pairwiseDebts } = useMemo(() => {
    return calculateMemberNetBalances(transactions, settlements, currentMembers, activeWorkspace.id, purchases);
  }, [transactions, settlements, currentMembers, activeWorkspace.id, purchases]);

  // Itens com rateio no workspace (Transações avulsas e Compras parceladas)
  const splitItems = useMemo(() => {
    const txs = transactions
      .filter((t) => t.workspace_id === activeWorkspace.id && t.type === 'expense' && t.splits && t.splits.length > 0)
      .map((t) => ({
        id: t.id,
        description: t.description,
        amount: t.amount,
        date: t.transaction_date,
        paid_by_member_id: t.paid_by_member_id,
        split_type: t.split_type,
        splits: t.splits || [],
        isPurchase: false,
        installmentCount: 1,
      }));

    const purs = purchases
      .filter((p) => p.workspace_id === activeWorkspace.id && p.splits && p.splits.length > 0)
      .map((p) => ({
        id: p.id,
        description: p.description,
        amount: p.total_amount,
        date: p.purchase_date,
        paid_by_member_id: p.paid_by_member_id,
        split_type: p.split_type,
        splits: p.splits || [],
        isPurchase: true,
        installmentCount: p.installment_count,
      }));

    return [...txs, ...purs].sort((a, b) => b.date.localeCompare(a.date));
  }, [transactions, purchases, activeWorkspace.id]);

  // Acertos realizados no workspace
  const workspaceSettlements = useMemo(() => {
    return settlements
      .filter((s) => s.workspace_id === activeWorkspace.id)
      .sort((a, b) => b.settlement_date.localeCompare(a.settlement_date));
  }, [settlements, activeWorkspace.id]);

  const getMemberName = (id?: string | null) => {
    if (!id) return 'Membro não identificado';
    const found = currentMembers.find((m) => m.id === id);
    return found?.user?.name || found?.user?.email?.split('@')[0] || `Membro ${id.substring(0, 4)}`;
  };

  const selectedPairDebt = useMemo(() => {
    if (!fromMemberId || !toMemberId) return null;
    return pairwiseDebts.find((d) => d.from_member_id === fromMemberId && d.to_member_id === toMemberId) || null;
  }, [pairwiseDebts, fromMemberId, toMemberId]);

  const handleOpenSettleDebt = (debtFrom: string, debtTo: string, amount: number) => {
    setFromMemberId(debtFrom);
    setToMemberId(debtTo);
    setSettlementAmountStr(amount.toFixed(2));
    setSettlementDate(format(new Date(), 'yyyy-MM-dd'));
    setSettlementNotes(`Acerto de contas consolidado`);
    setSettlementError(null);
    setIsSettlementModalOpen(true);
  };

  const handleSaveSettlement = (e: React.FormEvent) => {
    e.preventDefault();
    setSettlementError(null);
    const amount = parseFloat(settlementAmountStr.replace(',', '.')) || 0;

    if (!fromMemberId || !toMemberId) {
      setSettlementError('Selecione quem está pagando e quem está recebendo.');
      return;
    }
    if (fromMemberId === toMemberId) {
      setSettlementError('O pagador e recebedor não podem ser a mesma pessoa.');
      return;
    }
    if (amount <= 0) {
      setSettlementError('O valor do acerto deve ser maior que zero.');
      return;
    }

    const matchingDebt = pairwiseDebts.find(
      (d) => d.from_member_id === fromMemberId && d.to_member_id === toMemberId
    );
    if (!matchingDebt || matchingDebt.amount <= 0) {
      setSettlementError(`Não há débito pendente de ${getMemberName(fromMemberId)} para ${getMemberName(toMemberId)}.`);
      return;
    }
    const maxCents = Math.round(matchingDebt.amount * 100);
    const amountCents = Math.round(amount * 100);
    if (amountCents > maxCents) {
      setSettlementError(
        `O valor do acerto (${formatCurrency(amount)}) excede a dívida pendente (${formatCurrency(matchingDebt.amount)}).`
      );
      return;
    }

    try {
      recordSettlement({
        from_member_id: fromMemberId,
        to_member_id: toMemberId,
        amount,
        settlement_date: settlementDate,
        notes: settlementNotes.trim() || undefined,
      });

      setIsSettlementModalOpen(false);
      setSuccessMessage(`Acerto de ${formatCurrency(amount)} registrado com sucesso!`);
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err: any) {
      setSettlementError(err.message || 'Erro ao registrar o acerto.');
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-600 text-white shadow-md shadow-teal-500/20">
              <Scale className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Divisão de Contas & Acertos
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Divisão equilibrada de despesas compartilhadas (estilo Splitwise) e compensação líquida entre membros do workspace.
          </p>
        </div>

        <button
          onClick={() => {
            setFromMemberId(currentMembers[1]?.id || '');
            setToMemberId(currentMembers[0]?.id || '');
            setSettlementAmountStr('');
            setSettlementError(null);
            setIsSettlementModalOpen(true);
          }}
          disabled={currentMembers.length <= 1}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-teal-600/20 transition hover:bg-teal-500 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <PlusCircle className="h-4 w-4" />
          Registrar Acerto de Contas
        </button>
      </div>

      {/* Aviso de Membro Único */}
      {currentMembers.length <= 1 && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-medium text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-sm">Workspace com membro único</p>
            <p className="mt-0.5 text-amber-800 dark:text-amber-300">
              Para utilizar a divisão de despesas e cálculo de acertos entre pessoas, convide outros membros para este workspace ou selecione um workspace compartilhado no topo da página.
            </p>
          </div>
        </div>
      )}

      {/* Success Notification */}
      {successMessage && (
        <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300 animate-in fade-in duration-200">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Seção 1: Acertos Recomendados (Dívidas Consolidadas) */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-teal-600 dark:text-teal-400" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Acertos de Contas Sugeridos (Compensação Líquida)
            </h2>
          </div>
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {pairwiseDebts.length === 0 ? 'Tudo em dia' : `${pairwiseDebts.length} acerto${pairwiseDebts.length > 1 ? 's' : ''} pendente${pairwiseDebts.length > 1 ? 's' : ''}`}
          </span>
        </div>

        {pairwiseDebts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400 mb-3">
              <Check className="h-6 w-6" />
            </div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Todas as contas estão acertadas!
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-sm">
              Não há dívidas pendentes ou desequilíbrio financeiro registrado entre os membros deste workspace.
            </p>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            {pairwiseDebts.map((debt, idx) => (
              <div
                key={idx}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-amber-200/80 bg-amber-50/40 p-4 dark:border-amber-900/50 dark:bg-amber-950/20"
              >
                <div className="flex items-center gap-3">
                  <div className="flex flex-col">
                    <span className="text-xs text-slate-500 dark:text-slate-400">Devedor</span>
                    <span className="text-sm font-bold text-slate-900 dark:text-white">
                      {getMemberName(debt.from_member_id)}
                    </span>
                  </div>

                  <div className="flex flex-col items-center px-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">deve</span>
                    <ArrowRight className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  </div>

                  <div className="flex flex-col">
                    <span className="text-xs text-slate-500 dark:text-slate-400">Credor</span>
                    <span className="text-sm font-bold text-slate-900 dark:text-white">
                      {getMemberName(debt.to_member_id)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-amber-200/60 dark:border-amber-900/60">
                  <span className="text-base font-extrabold text-amber-700 dark:text-amber-300">
                    {formatCurrency(debt.amount)}
                  </span>
                  <button
                    onClick={() => handleOpenSettleDebt(debt.from_member_id, debt.to_member_id, debt.amount)}
                    className="rounded-xl bg-teal-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-teal-500 active:scale-95"
                  >
                    Liquidar Agora
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Seção 2: Balanço Consolidado por Membro */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Balanço Individual por Membro
            </h2>
          </div>
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {currentMembers.length} membro{currentMembers.length > 1 ? 's' : ''} participante{currentMembers.length > 1 ? 's' : ''}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {balances.map((b) => {
            const isCreditor = b.net_balance > 0;
            const isDebtor = b.net_balance < 0;
            const memberName = getMemberName(b.member_id);

            return (
              <div
                key={b.member_id}
                className={`rounded-2xl border p-4.5 transition ${
                  isCreditor
                    ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/50 dark:bg-emerald-950/20'
                    : isDebtor
                    ? 'border-rose-200 bg-rose-50/40 dark:border-rose-900/50 dark:bg-rose-950/20'
                    : 'border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-800/40'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-900 dark:text-white">
                    {memberName}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                      isCreditor
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
                        : isDebtor
                        ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300'
                        : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {isCreditor ? 'A Receber' : isDebtor ? 'A Pagar' : 'Equilibrado'}
                  </span>
                </div>

                <div className="mt-3 space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
                  <div className="flex justify-between">
                    <span>Total pago nos registros:</span>
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {formatCurrency(b.total_paid)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Sua responsabilidade:</span>
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {formatCurrency(b.total_share)}
                    </span>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Saldo Líquido:
                  </span>
                  <span
                    className={`text-base font-extrabold ${
                      isCreditor
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : isDebtor
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {isCreditor ? `+${formatCurrency(b.net_balance)}` : formatCurrency(b.net_balance)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Seção 3: Histórico de Despesas Rateadas */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-teal-600 dark:text-teal-400" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Despesas com Rateio Registradas
            </h2>
          </div>
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {splitItems.length} despesa{splitItems.length !== 1 ? 's' : ''}
          </span>
        </div>

        {splitItems.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
            Nenhuma despesa dividida registrada ainda. Adicione despesas com divisão no botão "Novo Registro".
          </div>
        ) : (
          <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
            {splitItems.map((item) => (
              <div key={item.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-900 dark:text-white">
                      {item.description}
                    </span>
                    <span className="rounded-md bg-teal-50 px-2 py-0.5 text-[10px] font-bold text-teal-700 dark:bg-teal-950/60 dark:text-teal-400">
                      {item.split_type === 'equal'
                        ? (currentMembers.length === 2 ? 'Divisão 50/50' : 'Divisão Igualitária')
                        : item.split_type === 'full_other'
                        ? '100% Outro'
                        : item.split_type === 'custom'
                        ? 'Personalizado'
                        : 'Rateio'}
                    </span>
                    {item.isPurchase && (
                      <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-400">
                        {item.installmentCount}x parcelado
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span>{formatDate(item.date)}</span>
                    <span>•</span>
                    <span>Pago por: <strong>{getMemberName(item.paid_by_member_id)}</strong></span>
                  </div>
                </div>

                <div className="flex flex-col sm:items-end">
                  <span className="text-sm font-bold text-slate-900 dark:text-white">
                    {formatCurrency(item.amount)}
                  </span>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {item.splits?.map((split, sIdx) => (
                      <span
                        key={sIdx}
                        className="text-[11px] rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                      >
                        {getMemberName(split.member_id)}: {formatCurrency(split.amount)}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Seção 4: Histórico de Acertos / Liquidações Realizadas */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-teal-600 dark:text-teal-400" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Histórico de Acertos Concluídos
            </h2>
          </div>
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {workspaceSettlements.length} liquidação{workspaceSettlements.length !== 1 ? 'ões' : ''}
          </span>
        </div>

        {workspaceSettlements.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
            Nenhum acerto de contas liquidado ainda.
          </div>
        ) : (
          <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
            {workspaceSettlements.map((s) => (
              <div key={s.id} className="py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
                    <Check className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900 dark:text-white">
                      {getMemberName(s.from_member_id)} pagou {getMemberName(s.to_member_id)}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {formatDate(s.settlement_date)} {s.notes ? `• ${s.notes}` : ''}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                    {formatCurrency(s.amount)}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm('Deseja realmente excluir este registro de acerto? O balanço líquido será recalculado.')) {
                        deleteSettlement(s.id);
                      }
                    }}
                    title="Excluir acerto"
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 transition"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal de Registro de Acerto de Contas */}
      {isSettlementModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-600 text-white font-bold shadow-md shadow-teal-500/20">
                  <Scale className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  Registrar Acerto de Contas
                </h3>
              </div>
              <button
                onClick={() => setIsSettlementModalOpen(false)}
                className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {settlementError && (
              <div className="mt-4 flex items-center gap-2 rounded-2xl bg-rose-50 p-3 text-xs font-semibold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{settlementError}</span>
              </div>
            )}

            <form onSubmit={handleSaveSettlement} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Quem está pagando?
                  </label>
                  <select
                    value={fromMemberId}
                    onChange={(e) => setFromMemberId(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="">Selecione...</option>
                    {currentMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.user?.name || m.user?.email?.split('@')[0] || m.id}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Quem está recebendo?
                  </label>
                  <select
                    value={toMemberId}
                    onChange={(e) => setToMemberId(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="">Selecione...</option>
                    {currentMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.user?.name || m.user?.email?.split('@')[0] || m.id}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {fromMemberId && toMemberId && fromMemberId !== toMemberId && (
                <div className={`rounded-xl p-2.5 text-xs ${
                  selectedPairDebt && selectedPairDebt.amount > 0
                    ? 'bg-amber-50 text-amber-900 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900/60'
                    : 'bg-slate-50 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
                }`}>
                  {selectedPairDebt && selectedPairDebt.amount > 0 ? (
                    <div className="flex items-center justify-between">
                      <span>Dívida máxima: <strong>{formatCurrency(selectedPairDebt.amount)}</strong></span>
                      <button
                        type="button"
                        onClick={() => setSettlementAmountStr(selectedPairDebt.amount.toFixed(2))}
                        className="font-bold text-teal-600 hover:underline dark:text-teal-400 ml-2"
                      >
                        Preencher total
                      </button>
                    </div>
                  ) : (
                    <span>Não há débito pendente nesta direção.</span>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Valor do Acerto (R$)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={selectedPairDebt ? selectedPairDebt.amount : undefined}
                  required
                  placeholder="0,00"
                  value={settlementAmountStr}
                  onChange={(e) => setSettlementAmountStr(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-bold text-slate-900 focus:border-teal-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Data da Liquidação
                </label>
                <input
                  type="date"
                  required
                  value={settlementDate}
                  onChange={(e) => setSettlementDate(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Observações (Opcional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Ex: Pix referente a contas do mês..."
                  value={settlementNotes}
                  onChange={(e) => setSettlementNotes(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-2 text-xs text-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsSettlementModalOpen(false)}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!selectedPairDebt || selectedPairDebt.amount <= 0}
                  className="rounded-xl bg-teal-600 px-5 py-2 text-xs font-bold text-white shadow-md shadow-teal-600/25 transition hover:bg-teal-500 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Confirmar Acerto
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
