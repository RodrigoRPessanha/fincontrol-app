'use client';

import React, { useState } from 'react';
import { useFinance } from '@/lib/context/finance-context';
import { useAuth } from '@/lib/context/auth-context';
import {
  Users,
  Plus,
  ShieldCheck,
  Building2,
  Mail,
  CheckCircle2,
  Crown,
  UserCheck,
  Eye,
  Lock,
} from 'lucide-react';
import { WorkspaceRole } from '@/lib/types';

export default function WorkspacesPage() {
  const {
    workspaces,
    activeWorkspace,
    workspaceMembers,
    createWorkspace,
    addWorkspaceMember,
  } = useFinance();
  const { user } = useAuth();

  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'viewer'>('member');

  const membersInActiveWs = workspaceMembers.filter(
    (m) => m.workspace_id === activeWorkspace.id
  );

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    addWorkspaceMember(inviteEmail.trim(), inviteRole);
    setInviteEmail('');
    setIsInviteOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Workspaces & Membros Compartilhados
          </h2>
          <p className="text-xs text-slate-500">
            Controle de acesso por workspace financeiro com permissões isoladas (RLS).
          </p>
        </div>

        <button
          onClick={() => setIsInviteOpen(true)}
          className="flex items-center gap-1.5 rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-600/25 transition hover:bg-emerald-500 self-start sm:self-auto"
        >
          <Plus className="h-4 w-4 stroke-[2.5]" />
          <span>Convidar Pessoa</span>
        </button>
      </div>

      {/* Info do Workspace Ativo */}
      <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500 text-white font-black text-lg shadow-md shadow-emerald-500/20">
              {activeWorkspace.name.charAt(0)}
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                {activeWorkspace.name}
              </h3>
              <p className="text-xs text-slate-400">
                Moeda: {activeWorkspace.currency} • Criado em 2026
              </p>
            </div>
          </div>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400">
            Workspace Ativo
          </span>
        </div>

        {/* Lista de Membros */}
        <div className="mt-6 space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Pessoas com acesso ({membersInActiveWs.length})
          </h4>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-2xl border border-slate-100 dark:border-slate-800 overflow-hidden">
            {membersInActiveWs.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between p-4 bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/50"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    {member.user?.name ? member.user.name.charAt(0).toUpperCase() : 'M'}
                  </div>
                  <div>
                    <h5 className="text-xs font-bold text-slate-900 dark:text-white">
                      {member.user?.name || 'Membro'}
                    </h5>
                    <span className="text-[11px] text-slate-400">
                      {member.user?.email || 'email@exemplo.com'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold capitalize border ${
                      member.role === 'owner'
                        ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400'
                        : member.role === 'admin'
                        ? 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-400'
                        : member.role === 'member'
                        ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400'
                        : 'bg-slate-100 text-slate-600 border-slate-200'
                    }`}
                  >
                    {member.role === 'owner' && <Crown className="h-3 w-3" />}
                    {member.role === 'admin' && <ShieldCheck className="h-3 w-3" />}
                    {member.role === 'member' && <UserCheck className="h-3 w-3" />}
                    {member.role === 'viewer' && <Eye className="h-3 w-3" />}
                    <span>{member.role}</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Explicação de Permissões RLS */}
      <div className="rounded-3xl bg-slate-50 p-6 border border-slate-200/80 dark:bg-slate-800/40 dark:border-slate-800">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-200">
          <Lock className="h-4 w-4 text-emerald-600" />
          <span>Matriz de Permissões e Segurança Row Level Security (RLS)</span>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
          <div className="rounded-2xl bg-white p-3.5 border border-slate-200 dark:bg-slate-900 dark:border-slate-800">
            <strong className="text-amber-600">Owner:</strong>
            <p className="mt-1 text-slate-500">Controle total, gerencia workspaces, deleta ambiente e convida membros.</p>
          </div>
          <div className="rounded-2xl bg-white p-3.5 border border-slate-200 dark:bg-slate-900 dark:border-slate-800">
            <strong className="text-indigo-600">Admin:</strong>
            <p className="mt-1 text-slate-500">Gerencia dados, contas bancárias, cartões e adiciona membros.</p>
          </div>
          <div className="rounded-2xl bg-white p-3.5 border border-slate-200 dark:bg-slate-900 dark:border-slate-800">
            <strong className="text-blue-600">Member:</strong>
            <p className="mt-1 text-slate-500">Cadastra e edita despesas, receitas, faturas e parcelamentos.</p>
          </div>
          <div className="rounded-2xl bg-white p-3.5 border border-slate-200 dark:bg-slate-900 dark:border-slate-800">
            <strong className="text-slate-600">Viewer:</strong>
            <p className="mt-1 text-slate-500">Acesso somente leitura a relatórios, dashboard e extratos.</p>
          </div>
        </div>
      </div>

      {/* Modal Convidar Membro */}
      {isInviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Convidar para o Workspace</h3>
            <p className="text-xs text-slate-500">Compartilhe o ambiente &quot;{activeWorkspace.name}&quot;.</p>

            <form onSubmit={handleInvite} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500">E-mail do Usuário</label>
                <input
                  type="email"
                  required
                  placeholder="parceiro@exemplo.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500">Papel / Nível de Acesso</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as any)}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                >
                  <option value="admin">Admin (Acesso total exceto deletar workspace)</option>
                  <option value="member">Member (Criar e editar transações)</option>
                  <option value="viewer">Viewer (Apenas visualização)</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsInviteOpen(false)}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white hover:bg-emerald-500"
                >
                  Enviar Convite
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
