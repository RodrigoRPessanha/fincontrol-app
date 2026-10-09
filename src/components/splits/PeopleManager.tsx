'use client';

import React, { useState } from 'react';
import { Person } from '@/lib/types';
import { formatDate } from '@/lib/utils';
import { Users, UserPlus, Edit2, Trash2, Check, X, AlertCircle, Archive, ArchiveRestore } from 'lucide-react';

export interface PeopleManagerProps {
  people: Person[];
  readOnly?: boolean;
  onAddPerson: (data: { name: string }) => Promise<Person | null | undefined> | Person | null | undefined;
  onUpdatePerson: (id: string, data: { name?: string; archived?: boolean }) => Promise<void> | void;
  onDeletePerson: (id: string) => Promise<void> | void;
}

export function PeopleManager({
  people,
  readOnly = false,
  onAddPerson,
  onUpdatePerson,
  onDeletePerson,
}: PeopleManagerProps) {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = newName.trim();
    if (!trimmed) {
      setError('Informe o nome da pessoa.');
      return;
    }
    if (people.some((p) => !p.archived && p.name.toLowerCase() === trimmed.toLowerCase())) {
      setError('Já existe uma pessoa cadastrada com esse nome.');
      return;
    }

    try {
      setIsSubmitting(true);
      await onAddPerson({ name: trimmed });
      setNewName('');
    } catch (err: any) {
      setError(err.message || 'Erro ao cadastrar pessoa.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartEdit = (person: Person) => {
    setEditingId(person.id);
    setEditingName(person.name);
    setError(null);
  };

  const handleSaveEdit = async (id: string) => {
    const trimmed = editingName.trim();
    if (!trimmed) {
      setError('O nome não pode estar vazio.');
      return;
    }
    try {
      await onUpdatePerson(id, { name: trimmed });
      setEditingId(null);
      setEditingName('');
    } catch (err: any) {
      setError(err.message || 'Erro ao renomear pessoa.');
    }
  };

  const handleToggleArchive = async (person: Person) => {
    setError(null);
    try {
      await onUpdatePerson(person.id, { archived: !person.archived });
    } catch (err: any) {
      setError(err.message || 'Erro ao alterar status de arquivamento.');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    setError(null);
    if (!window.confirm(`Deseja realmente excluir ${name}? Se houver despesas ou acertos vinculados, a exclusão será bloqueada.`)) {
      return;
    }
    try {
      await onDeletePerson(id);
    } catch (err: any) {
      setError(err.message || 'Não é possível excluir esta pessoa pois ela possui histórico de despesas ou acertos.');
    }
  };

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-teal-600 dark:text-teal-400" />
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            Pessoas Cadastradas para Rateio
          </h2>
        </div>
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
          {people.length} pessoa{people.length !== 1 ? 's' : ''}
        </span>
      </div>

      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        Divida contas com amigos, familiares ou terceiros informando apenas o nome, sem exigir conta no sistema nem acesso ao workspace.
      </p>

      {error && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-rose-50 p-2.5 text-xs font-semibold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 border border-rose-200 dark:border-rose-900">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Input para adicionar nova pessoa */}
      {!readOnly && <div className="mt-4 flex gap-2">
        <input
          type="text"
          placeholder="Nome da pessoa (ex: Maria, Lucas, Carlos)..."
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAdd(e);
            }
          }}
          className="flex-1 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs text-slate-900 focus:border-teal-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={isSubmitting || !newName.trim()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-teal-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-teal-500 disabled:opacity-50"
        >
          <UserPlus className="h-3.5 w-3.5" />
          Adicionar
        </button>
      </div>}

      {/* Lista de pessoas salvas */}
      {people.length === 0 ? (
        <div className="py-6 text-center text-xs text-slate-400 dark:text-slate-500">
          Nenhuma pessoa avulsa cadastrada neste workspace ainda.
        </div>
      ) : (
        <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
          {people.map((person) => {
            const isEditing = editingId === person.id;

            return (
              <div
                key={person.id}
                className="py-3 flex items-center justify-between gap-3 text-xs"
              >
                {!readOnly && isEditing ? (
                  <div className="flex flex-1 items-center gap-2">
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="rounded-lg border border-teal-500 px-2 py-1 text-xs text-slate-900 dark:bg-slate-800 dark:text-white"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleSaveEdit(person.id);
                        } else if (e.key === 'Escape') {
                          setEditingId(null);
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => handleSaveEdit(person.id)}
                      className="rounded-lg bg-teal-600 p-1 text-white hover:bg-teal-500"
                      title="Salvar"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                      title="Cancelar"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-bold ${person.archived ? 'text-slate-500 line-through dark:text-slate-400' : 'text-slate-900 dark:text-white'}`}>
                      {person.name}
                    </span>
                    {person.archived && (
                      <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900/60">
                        Arquivada
                      </span>
                    )}
                    <span className="text-[11px] text-slate-400">
                      (desde {formatDate(person.created_at)})
                    </span>
                  </div>
                )}

                {!readOnly && !isEditing && (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleStartEdit(person)}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                      title="Renomear pessoa"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleArchive(person)}
                      className={`rounded-lg p-1.5 transition ${
                        person.archived
                          ? 'text-teal-600 hover:bg-teal-50 dark:text-teal-400 dark:hover:bg-teal-950/40'
                          : 'text-slate-400 hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-950/40 dark:hover:text-amber-400'
                      }`}
                      title={person.archived ? 'Reativar pessoa' : 'Arquivar pessoa'}
                    >
                      {person.archived ? (
                        <ArchiveRestore className="h-3.5 w-3.5" />
                      ) : (
                        <Archive className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(person.id, person.name)}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                      title="Excluir pessoa"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
