'use client';

import React, { useState, useMemo } from 'react';
import { WorkspaceMember, SplitType, TransactionSplit, Person, SplitParticipant } from '@/lib/types';
import { Users, Plus, UserPlus, Check } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { calculateExpenseSplits } from '@/lib/financial-engine';

export interface SplitFieldsProps {
  type: 'expense' | 'income' | 'transfer';
  workspaceMembers: WorkspaceMember[];
  people?: Person[];
  paidByMemberId: string;
  onPaidByMemberIdChange: (id: string) => void;
  paidByPersonId?: string;
  onPaidByPersonIdChange?: (id: string) => void;
  splitType: SplitType;
  onSplitTypeChange: (type: SplitType) => void;
  customSplits?: Record<string, number>;
  onCustomSplitChange?: (participantId: string, amount: number) => void;
  numAmount?: number;
  totalAmount?: number;
  onSplitsChange?: (splits: any) => void;
  onAddPerson?: (name: string) => Promise<Person | null | undefined> | Person | null | undefined;
  selectedParticipantIds?: string[];
  onToggleParticipant?: (id: string) => void;
}

export function SplitFields({
  type,
  workspaceMembers,
  people = [],
  paidByMemberId,
  onPaidByMemberIdChange,
  paidByPersonId,
  onPaidByPersonIdChange,
  splitType,
  onSplitTypeChange,
  customSplits = {},
  onCustomSplitChange,
  numAmount = 0,
  totalAmount,
  onAddPerson,
  selectedParticipantIds,
  onToggleParticipant,
}: SplitFieldsProps) {
  const currentAmount = typeof totalAmount === 'number' ? totalAmount : numAmount;
  // All hooks must stay at the very top of the component
  const [newPersonName, setNewPersonName] = useState('');
  const [isAddingPerson, setIsAddingPerson] = useState(false);
  const [addPersonError, setAddPersonError] = useState<string | null>(null);

  // Lista de todos os participantes possíveis (membros + pessoas salvas)
  const allAvailableParticipants: SplitParticipant[] = useMemo(() => {
    const memberParts: SplitParticipant[] = workspaceMembers.map((m) => ({
      id: m.id,
      name: m.user?.name || m.user?.email?.split('@')[0] || `Membro ${m.id.substring(0, 4)}`,
      type: 'member' as const,
    }));
    const personParts: SplitParticipant[] = people.map((p) => ({
      id: p.id,
      name: p.name,
      type: 'person' as const,
    }));
    return [...memberParts, ...personParts];
  }, [workspaceMembers, people]);

  // Determinar pagador efetivo
  const effectivePayerId = paidByPersonId
    ? paidByPersonId
    : paidByMemberId || workspaceMembers[0]?.id || (people[0]?.id ?? '');

  const effectivePayerType: 'member' | 'person' = paidByPersonId
    ? 'person'
    : (people.some((p) => p.id === effectivePayerId) ? 'person' : 'member');

  // Participantes ativos no cálculo
  const activeParticipants = useMemo(() => {
    if (!selectedParticipantIds || selectedParticipantIds.length === 0) {
      if (workspaceMembers.length <= 1 && people.length > 0) {
        return allAvailableParticipants;
      }
      return workspaceMembers.map((m) => ({
        id: m.id,
        name: m.user?.name || m.user?.email?.split('@')[0] || `Membro ${m.id.substring(0, 4)}`,
        type: 'member' as const,
      }));
    }

    const filtered = allAvailableParticipants.filter((p) => selectedParticipantIds.includes(p.id));
    if (effectivePayerId && !filtered.some((p) => p.id === effectivePayerId)) {
      const payerPart = allAvailableParticipants.find((p) => p.id === effectivePayerId);
      if (payerPart) {
        filtered.push(payerPart);
      }
    }
    return filtered.length > 0 ? filtered : allAvailableParticipants;
  }, [allAvailableParticipants, workspaceMembers, people, selectedParticipantIds, effectivePayerId]);

  const { previewSplits, previewError } = useMemo(() => {
    let splits: TransactionSplit[] = [];
    let err: string | null = null;
    if (type === 'expense' && splitType !== 'individual' && currentAmount > 0 && activeParticipants.length > 0) {
      try {
        const customList = splitType === 'custom'
          ? activeParticipants.map((p) => ({
              id: p.id,
              type: p.type,
              member_id: p.type === 'member' ? p.id : null,
              person_id: p.type === 'person' ? p.id : null,
              amount: customSplits[p.id] || 0,
            }))
          : undefined;

        splits = calculateExpenseSplits(
          currentAmount,
          splitType,
          activeParticipants,
          { id: effectivePayerId, type: effectivePayerType },
          customList
        );
      } catch (e: any) {
        err = e.message;
      }
    }
    return { previewSplits: splits, previewError: err };
  }, [type, splitType, currentAmount, activeParticipants, customSplits, effectivePayerId, effectivePayerType]);

  const selectedPayerLabel = useMemo(() => {
    const member = workspaceMembers.find((m) => m.id === effectivePayerId);
    if (member) {
      const name = member.user?.name || member.user?.email?.split('@')[0] || `Membro ${member.id.substring(0, 4)}`;
      return `${name}${member.role === 'owner' ? ' (Owner)' : ''}`;
    }
    const person = people.find((p) => p.id === effectivePayerId);
    if (person) {
      return `${person.name} (Pessoa)`;
    }
    return 'Quem pagou';
  }, [workspaceMembers, people, effectivePayerId]);

  const selectedSplitLabel = useMemo(() => {
    if (splitType === 'individual') return 'Sem divisão (100% pagador)';
    if (splitType === 'equal') {
      return activeParticipants.length === 2
        ? 'Dividir igualmente (50/50)'
        : 'Dividir igualmente (entre todos)';
    }
    if (splitType === 'full_other') return '100% de outra pessoa';
    return 'Personalizado (definir valores)';
  }, [splitType, activeParticipants.length]);

  // Se não for despesa, rateio não se aplica (return após todos os hooks)
  if (type !== 'expense') return null;

  const totalCount = allAvailableParticipants.length;

  const handleCreatePerson = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddPersonError(null);
    const trimmed = newPersonName.trim();
    if (!trimmed) {
      setAddPersonError('Informe o nome da pessoa.');
      return;
    }
    if (allAvailableParticipants.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
      setAddPersonError('Já existe um membro ou pessoa com esse nome.');
      return;
    }
    if (onAddPerson) {
      try {
        const created = await onAddPerson(trimmed);
        setNewPersonName('');
        setIsAddingPerson(false);
        if (created && onToggleParticipant) {
          onToggleParticipant(created.id);
        }
      } catch (err: any) {
        setAddPersonError(err.message || 'Erro ao adicionar pessoa.');
      }
    }
  };

  return (
    <div className="rounded-2xl border border-teal-200/80 bg-teal-50/50 p-4 dark:border-teal-900/50 dark:bg-teal-950/20">
      <div className="flex items-center justify-between pb-2 mb-3 border-b border-teal-200/60 dark:border-teal-900/60">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-teal-600 dark:text-teal-400" />
          <span className="text-xs font-bold uppercase tracking-wider text-teal-900 dark:text-teal-300">
            Divisão de Despesa (Rateio)
          </span>
        </div>
        <span className="text-[11px] text-teal-700 dark:text-teal-400 font-medium">
          {totalCount} {totalCount === 1 ? 'participante disponível' : 'participantes disponíveis'}
        </span>
      </div>

      {/* Se houver apenas 1 participante (membro único e nenhuma pessoa), convida a cadastrar pessoa */}
      {totalCount <= 1 && (
        <div className="mb-3 rounded-xl bg-white/80 p-3 border border-teal-200 text-xs dark:bg-slate-900/80 dark:border-teal-900">
          <p className="text-slate-600 dark:text-slate-300 mb-2">
            Para dividir esta despesa, adicione o nome da pessoa com quem deseja ratear:
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Nome da pessoa (ex: Lucas)"
              value={newPersonName}
              onChange={(e) => setNewPersonName(e.target.value)}
              className="flex-1 rounded-lg border border-teal-300 px-2.5 py-1.5 text-xs text-slate-900 dark:border-teal-800 dark:bg-slate-800 dark:text-white"
            />
            <button
              type="button"
              onClick={handleCreatePerson}
              className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-teal-500"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Adicionar
            </button>
          </div>
          {addPersonError && (
            <p className="mt-1.5 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
              {addPersonError}
            </p>
          )}
        </div>
      )}

      {totalCount > 1 && (
        <>
          {/* Seleção de Participantes (Chips) se houver pessoas salvas */}
          {(people.length > 0 || (selectedParticipantIds && selectedParticipantIds.length > 0)) && (
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-[11px] font-semibold text-teal-900 dark:text-teal-300">
                  Quem participa desta divisão?
                </label>
                {!isAddingPerson && onAddPerson && (
                  <button
                    type="button"
                    onClick={() => setIsAddingPerson(true)}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-teal-700 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-300"
                  >
                    <Plus className="h-3 w-3" />
                    + Nova Pessoa
                  </button>
                )}
              </div>

              {/* Input Inline de Adicionar Nova Pessoa */}
              {isAddingPerson && (
                <div className="mb-2 flex items-center gap-2 rounded-xl bg-white p-2 border border-teal-300 dark:bg-slate-900 dark:border-teal-800">
                  <input
                    type="text"
                    placeholder="Nome da pessoa..."
                    value={newPersonName}
                    onChange={(e) => setNewPersonName(e.target.value)}
                    className="flex-1 rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCreatePerson(e);
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleCreatePerson}
                    className="rounded-lg bg-teal-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-teal-500"
                  >
                    Salvar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddingPerson(false);
                      setNewPersonName('');
                      setAddPersonError(null);
                    }}
                    className="rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Cancelar
                  </button>
                </div>
              )}
              {addPersonError && isAddingPerson && (
                <p className="mb-2 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                  {addPersonError}
                </p>
              )}

              {/* Chips de Participantes */}
              <div className="flex flex-wrap gap-1.5">
                {allAvailableParticipants.map((p) => {
                  const isSelected = activeParticipants.some((ap) => ap.id === p.id);
                  const isPayer = p.id === effectivePayerId;

                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        if (onToggleParticipant) {
                          onToggleParticipant(p.id);
                        }
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition ${
                        isSelected
                          ? 'bg-teal-600 text-white shadow-sm'
                          : 'bg-white text-slate-600 border border-teal-200 hover:bg-teal-50 dark:bg-slate-900 dark:text-slate-300 dark:border-teal-900'
                      }`}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                      <span>{p.name}</span>
                      {p.type === 'person' && (
                        <span className={`text-[10px] ${isSelected ? 'text-teal-200' : 'text-slate-400'}`}>
                          (Pessoa)
                        </span>
                      )}
                      {isPayer && (
                        <span className={`text-[10px] font-bold ${isSelected ? 'text-amber-200' : 'text-amber-600'}`}>
                          [Pagou]
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Quem pagou? */}
            <div className="min-w-0">
              <label className="block text-[11px] font-semibold text-teal-900 dark:text-teal-300">
                Quem pagou?
              </label>
              <select
                value={effectivePayerId}
                onChange={(e) => {
                  const val = e.target.value;
                  const isPerson = people.some((p) => p.id === val);
                  if (isPerson) {
                    onPaidByPersonIdChange?.(val);
                    onPaidByMemberIdChange('');
                  } else {
                    onPaidByMemberIdChange(val);
                    onPaidByPersonIdChange?.('');
                  }
                }}
                className="mt-1 w-full truncate rounded-xl border border-teal-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:outline-none dark:border-teal-800 dark:bg-slate-900 dark:text-white"
                title={selectedPayerLabel}
              >
                {workspaceMembers.map((m) => {
                  const label = `${m.user?.name || m.user?.email?.split('@')[0] || `Membro ${m.id.substring(0, 4)}`}${m.role === 'owner' ? ' (Owner)' : ''}`;
                  return (
                    <option key={m.id} value={m.id} title={label}>
                      {label}
                    </option>
                  );
                })}
                {people.map((p) => {
                  const label = `${p.name} (Pessoa)`;
                  return (
                    <option key={p.id} value={p.id} title={label}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Como dividir? */}
            <div className="min-w-0">
              <label className="block text-[11px] font-semibold text-teal-900 dark:text-teal-300">
                Regra de Divisão
              </label>
              <select
                value={splitType}
                onChange={(e) => onSplitTypeChange(e.target.value as SplitType)}
                className="mt-1 w-full truncate rounded-xl border border-teal-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:outline-none dark:border-teal-800 dark:bg-slate-900 dark:text-white"
                title={selectedSplitLabel}
              >
                <option value="individual" title="Sem rateio (100% de quem pagou)">Sem divisão (100% pagador)</option>
                <option
                  value="equal"
                  title={
                    activeParticipants.length === 2
                      ? 'Dividir igualmente (50/50)'
                      : 'Dividir igualmente (entre todos)'
                  }
                >
                  {activeParticipants.length === 2
                    ? 'Dividir igualmente (50/50)'
                    : 'Dividir igualmente (entre todos)'}
                </option>
                <option value="full_other" title="100% de outra pessoa (compra em nome de outro)">
                  100% de outra pessoa
                </option>
                <option value="custom" title="Personalizado (definir valores)">
                  Personalizado (definir valores)
                </option>
              </select>
            </div>
          </div>

          {/* Preview dos valores calculados */}
          {splitType !== 'individual' && currentAmount > 0 && (
            <div className="mt-3 pt-3 border-t border-teal-200/60 dark:border-teal-900/60">
              <div className="text-[11px] font-bold uppercase tracking-wider text-teal-800 dark:text-teal-300 mb-1.5">
                Responsabilidade de cada participante:
              </div>
              {splitType === 'custom' ? (
                <div className="space-y-1.5">
                  {activeParticipants.map((p) => {
                    const isPayer = p.id === effectivePayerId;
                    return (
                      <div
                        key={p.id}
                        className="flex items-center justify-between text-xs bg-white dark:bg-slate-900 p-2 rounded-xl border border-teal-200 dark:border-teal-900"
                      >
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                          {p.name} {p.type === 'person' && <span className="text-[10px] text-slate-400">(Pessoa)</span>}{' '}
                          {isPayer && <span className="text-[10px] text-teal-600 font-bold">(Pagador)</span>}
                        </span>
                        <div className="flex items-center gap-1">
                          <span className="text-slate-400 text-xs">R$</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0,00"
                            value={customSplits[p.id] ?? ''}
                            onChange={(e) => {
                              const val = Math.max(0, parseFloat(e.target.value) || 0);
                              onCustomSplitChange?.(p.id, val);
                            }}
                            className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-right text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                          />
                        </div>
                      </div>
                    );
                  })}
                  {previewError && (
                    <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 mt-1">
                      {previewError}
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {activeParticipants.map((p) => {
                    const isPayer = p.id === effectivePayerId;
                    const splitItem = previewSplits.find(
                      (s) => (s.member_id && s.member_id === p.id) || (s.person_id && s.person_id === p.id)
                    );
                    const shareAmount = splitItem ? splitItem.amount : 0;

                    return (
                      <div
                        key={p.id}
                        className="flex items-center justify-between text-xs bg-white/70 dark:bg-slate-900/70 px-2.5 py-1.5 rounded-lg"
                      >
                        <span className="text-slate-700 dark:text-slate-300">
                          {p.name} {p.type === 'person' && <span className="text-[10px] text-slate-400">(Pessoa)</span>}{' '}
                          {isPayer && <span className="text-[10px] text-teal-600 font-bold">(Pagou)</span>}
                        </span>
                        <span className="font-semibold text-slate-900 dark:text-white">
                          {formatCurrency(shareAmount)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
