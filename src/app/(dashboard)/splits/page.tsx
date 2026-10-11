'use client';

import React, { useState, useMemo, useRef } from 'react';
import { useOperationAttempt } from '@/lib/hooks/use-operation-attempt';
import { useFinance } from '@/lib/context/finance-context';
import { monthlySharedExpenses } from '@/lib/financial-engine/monthly-splits';
import { PurchaseRepaymentModal } from '@/components/splits/PurchaseRepaymentModal';
import { MonthlySplitOverview } from '@/components/splits/MonthlySplitOverview';
import { calculateMemberNetBalances } from '@/lib/financial-engine';
import { formatCurrency } from '@/lib/utils';
import { format } from 'date-fns';
import {
  Scale,
  CheckCircle2,
  AlertCircle,
  PlusCircle,
} from 'lucide-react';
import { SplitSummary } from '@/components/splits/SplitSummary';
import { MemberBalances } from '@/components/splits/MemberBalances';
import { SharedExpensesList } from '@/components/splits/SharedExpensesList';
import { SettlementHistory } from '@/components/splits/SettlementHistory';
import { SettlementModal } from '@/components/splits/SettlementModal';
import { PeopleManager } from '@/components/splits/PeopleManager';
import { ContextualHelp } from '@/components/help/ContextualHelp';

export default function SplitsPage() {
  const {
    activeWorkspace,
    workspaceMembers,
    people = [],
    allWorkspacePeople = people,
    transactions,
    purchases,
    installments = [],
    creditCardBills = [],
    settlements,
    recordSettlementAsync,
    deleteSettlement,
    addPerson,
    updatePerson,
    deletePerson,
    isWorkspaceReadOnly,
  } = useFinance();

  const [repaymentPurchaseId, setRepaymentPurchaseId] = useState<string | null>(null);
  const repaymentPurchase = purchases.find((p) => p.id === repaymentPurchaseId);
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'));
  const settlementPending = useRef(false);
  const [isSettling, setIsSettling] = useState(false);
  const settlementAttempt = useOperationAttempt(activeWorkspace.id, 'settlement');
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

  const effectivePeople = useMemo(
    () => (allWorkspacePeople?.length ? allWorkspacePeople : people),
    [allWorkspacePeople, people]
  );

  const totalParticipantsCount = currentMembers.length + effectivePeople.length;

  // Cálculo de Balanços e Dívidas Consolidadas pelo Motor Financeiro Puro (com Pessoas e Purchases parceladas)
  const { balances, pairwiseDebts } = useMemo(() => {
    return calculateMemberNetBalances(transactions, settlements, currentMembers, activeWorkspace.id, purchases, effectivePeople);
  }, [transactions, settlements, currentMembers, activeWorkspace.id, purchases, effectivePeople]);

  const monthly = useMemo(() => monthlySharedExpenses(activeWorkspace.id, month, transactions, purchases, installments, creditCardBills),
    [activeWorkspace.id, month, transactions, purchases, installments, creditCardBills]);

  // Acertos realizados no workspace
  const workspaceSettlements = useMemo(() => {
    return settlements
      .filter((s) => s.workspace_id === activeWorkspace.id)
      .sort((a, b) => b.settlement_date.localeCompare(a.settlement_date));
  }, [settlements, activeWorkspace.id]);

  const getParticipantName = (id?: string | null) => {
    if (!id) return 'Membro não identificado';
    const foundMember = currentMembers.find((m) => m.id === id);
    if (foundMember) {
      return foundMember.user?.name || foundMember.user?.email?.split('@')[0] || `Membro ${id.substring(0, 4)}`;
    }
    const foundPerson = (allWorkspacePeople?.length ? allWorkspacePeople : people).find((p: any) => p.id === id);
    if (foundPerson) {
      return foundPerson.name;
    }
    return `Membro ${id.substring(0, 4)}`;
  };

  const selectedPairDebt = useMemo(() => {
    if (!fromMemberId || !toMemberId) return null;
    return (
      pairwiseDebts.find(
        (d) => d.from_member_id === fromMemberId && d.to_member_id === toMemberId
      ) || null
    );
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

  const handleSaveSettlement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (settlementPending.current) return;
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

    try {
      settlementPending.current = true;
      setIsSettling(true);
      const isFromPerson = allWorkspacePeople.some((p) => p.id === fromMemberId);
      const isToPerson = allWorkspacePeople.some((p) => p.id === toMemberId);

      const payload = {
        from_member_id: isFromPerson ? null : fromMemberId,
        to_member_id: isToPerson ? null : toMemberId,
        from_person_id: isFromPerson ? fromMemberId : null,
        to_person_id: isToPerson ? toMemberId : null,
        amount,
        settlement_date: settlementDate,
        notes: settlementNotes.trim() || undefined,
      };
      const operationKey = await settlementAttempt.getKey(payload);
      const recovered = settlements.some((s) => s.operation_key === operationKey);
      const matchingDebt = pairwiseDebts.find(
        (d) => d.from_member_id === fromMemberId && d.to_member_id === toMemberId
      );
      if (!recovered && (!matchingDebt || matchingDebt.amount <= 0)) {
        setSettlementError(`Não há débito pendente de ${getParticipantName(fromMemberId)} para ${getParticipantName(toMemberId)}.`);
        return;
      }
      const maxCents = Math.round((matchingDebt?.amount ?? 0) * 100);
      const amountCents = Math.round(amount * 100);
      if (!recovered && amountCents > maxCents) {
        setSettlementError(
          `O valor do acerto (${formatCurrency(amount)}) excede a dívida pendente (${formatCurrency(matchingDebt?.amount ?? 0)}).`
        );
        return;
      }

      await recordSettlementAsync({ ...payload, operation_key: operationKey });
      settlementAttempt.complete();

      setIsSettlementModalOpen(false);
      setSuccessMessage(`Acerto de ${formatCurrency(amount)} registrado com sucesso!`);
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err: any) {
      setSettlementError(err.message || 'Erro ao registrar o acerto.');
    } finally {
      settlementPending.current = false;
      setIsSettling(false);
    }
  };

  const defaultFromId = currentMembers[1]?.id || people[0]?.id || '';
  const defaultToId = currentMembers[0]?.id || '';

  return (
    <div className="space-y-6 pb-12">
      <ContextualHelp slug="dividir-despesas" label="Como dividir despesas e registrar acertos" />
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
            Divisão equilibrada de despesas compartilhadas (estilo Splitwise) e compensação líquida entre membros e pessoas.
          </p>
        </div>

        {!isWorkspaceReadOnly && <button
          onClick={() => {
            setFromMemberId(defaultFromId);
            setToMemberId(defaultToId);
            setSettlementAmountStr('');
            setSettlementError(null);
            setIsSettlementModalOpen(true);
          }}
          disabled={totalParticipantsCount <= 1}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-teal-600/20 transition hover:bg-teal-500 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <PlusCircle className="h-4 w-4" />
          Registrar Acerto de Contas
        </button>}
      </div>

      {/* Aviso de Participante Único */}
      {totalParticipantsCount <= 1 && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-medium text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-sm">Workspace com membro único</p>
            <p className="mt-0.5 text-amber-800 dark:text-amber-300">
              Para utilizar a divisão de despesas e cálculo de acertos entre pessoas, convide outros membros para este workspace ou cadastre pessoas pelo nome na seção abaixo.
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

      <MonthlySplitOverview month={month} onMonthChange={setMonth} items={monthly.items} responsibilities={monthly.responsibilities} warnings={monthly.warnings} getName={getParticipantName} />
      <SharedExpensesList splitItems={monthly.items} currentMembers={currentMembers} getMemberName={getParticipantName} onEditRepayments={isWorkspaceReadOnly ? undefined : setRepaymentPurchaseId} />
      {repaymentPurchase && <PurchaseRepaymentModal key={`${activeWorkspace.id}:${repaymentPurchase.id}`} purchase={repaymentPurchase} getName={getParticipantName} onClose={() => setRepaymentPurchaseId(null)} />}

      {/* Seção 4: Gerenciamento de Pessoas Cadastradas (Rateio por Nome) */}
      <PeopleManager
        people={effectivePeople}
        onAddPerson={addPerson}
        onUpdatePerson={updatePerson}
        onDeletePerson={deletePerson}
        readOnly={isWorkspaceReadOnly}
      />

      <details className="space-y-4 rounded-3xl border border-slate-200 p-4 dark:border-slate-800">
        <summary className="cursor-pointer text-sm font-bold">Acertos e saldo acumulado — todos os meses</summary>
        <p className="text-sm text-slate-500 dark:text-slate-400">Inclui o valor total das compras, inclusive parcelas futuras, e todos os acertos registrados. O filtro mensal não altera esta dívida.</p>
      <SplitSummary
        pairwiseDebts={pairwiseDebts}
        getMemberName={getParticipantName}
        onOpenSettleDebt={handleOpenSettleDebt}
        readOnly={isWorkspaceReadOnly}
      />

      {/* Seção 2: Balanço Consolidado por Participante */}
      <MemberBalances
        purchases={purchases}
        balances={balances}
        currentMembers={currentMembers}
        getMemberName={getParticipantName}
        participantsCount={totalParticipantsCount}
      />

      {/* Seção 5: Histórico de Acertos / Liquidações Realizadas */}
      <SettlementHistory
        workspaceSettlements={workspaceSettlements}
        getMemberName={getParticipantName}
        readOnly={isWorkspaceReadOnly}
        onDeleteSettlement={(id) => {
          if (window.confirm('Deseja realmente excluir este registro de acerto? O balanço líquido será recalculado.')) {
            deleteSettlement(id);
          }
        }}
      />

      </details>

      {/* Modal de Registro de Acerto de Contas */}
      {!isWorkspaceReadOnly && <SettlementModal
        isOpen={isSettlementModalOpen}
        onClose={() => setIsSettlementModalOpen(false)}
        fromMemberId={fromMemberId}
        setFromMemberId={setFromMemberId}
        toMemberId={toMemberId}
        setToMemberId={setToMemberId}
        settlementAmountStr={settlementAmountStr}
        setSettlementAmountStr={setSettlementAmountStr}
        settlementDate={settlementDate}
        setSettlementDate={setSettlementDate}
        settlementNotes={settlementNotes}
        setSettlementNotes={setSettlementNotes}
        settlementError={settlementError}
        currentMembers={currentMembers}
        people={people}
        selectedPairDebt={selectedPairDebt}
        onSubmit={handleSaveSettlement}
        isSubmitting={isSettling}
      />}
    </div>
  );
}
