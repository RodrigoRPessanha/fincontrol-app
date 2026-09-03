'use client';

import React, { useState } from 'react';
import { useFinance } from '@/lib/context/finance-context';
import { useAuth } from '@/lib/context/auth-context';
import { useTheme } from '@/lib/context/theme-context';
import {
  Building2,
  ChevronDown,
  Plus,
  Eye,
  Calendar,
  Sparkles,
  Users,
  Check,
  PlusCircle,
  Bell,
  Search,
  Sun,
  Moon,
  Laptop,
} from 'lucide-react';
import { QuickAddModal } from '../transactions/QuickAddModal';

export function Header() {
  const {
    workspaces,
    activeWorkspace,
    setActiveWorkspaceId,
    createWorkspace,
    viewPerspective,
    setViewPerspective,
  } = useFinance();
  const { user } = useAuth();
  const { theme, resolvedTheme, toggleTheme } = useTheme();

  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const [isNewWsModalOpen, setIsNewWsModalOpen] = useState(false);
  const [newWsName, setNewWsName] = useState('');
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);

  const handleCreateWs = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWsName.trim()) return;
    createWorkspace(newWsName.trim());
    setNewWsName('');
    setIsNewWsModalOpen(false);
    setIsWorkspaceMenuOpen(false);
  };

  return (
    <>
      <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-slate-200 bg-white/80 px-4 sm:px-6 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/80">
        {/* Workspace Switcher & Info */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <button
              onClick={() => setIsWorkspaceMenuOpen(!isWorkspaceMenuOpen)}
              className="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-500 text-white shadow-sm font-bold text-xs">
                {activeWorkspace.name.charAt(0)}
              </div>
              <span className="max-w-[140px] truncate sm:max-w-[200px]">
                {activeWorkspace.name}
              </span>
              <ChevronDown className="h-4 w-4 text-slate-500" />
            </button>

            {/* Dropdown Menu */}
            {isWorkspaceMenuOpen && (
              <div className="absolute left-0 top-full mt-2 w-64 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl z-50 dark:border-slate-800 dark:bg-slate-900">
                <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Seus Workspaces
                </div>
                {workspaces.map((ws) => (
                  <button
                    key={ws.id}
                    onClick={() => {
                      setActiveWorkspaceId(ws.id);
                      setIsWorkspaceMenuOpen(false);
                    }}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 font-bold text-xs">
                        {ws.name.charAt(0)}
                      </div>
                      <span className="truncate">{ws.name}</span>
                    </div>
                    {ws.id === activeWorkspace.id && (
                      <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    )}
                  </button>
                ))}

                <div className="my-1 border-t border-slate-100 dark:border-slate-800" />

                <button
                  onClick={() => setIsNewWsModalOpen(true)}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                >
                  <PlusCircle className="h-4 w-4" />
                  <span>Novo Workspace</span>
                </button>
              </div>
            )}
          </div>

          {/* Tag de Workspace Compartilhado se houver */}
          {activeWorkspace.id === 'ws-2' && (
            <span className="hidden items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 border border-indigo-200 sm:inline-flex dark:bg-indigo-950/40 dark:text-indigo-400 dark:border-indigo-800">
              <Users className="h-3 w-3" /> Compartilhado
            </span>
          )}
        </div>

        {/* Right Actions: Previsto vs Realizado Toggle, Fast Add, User */}
        <div className="flex items-center gap-2 sm:gap-4">
          {/* Toggle de Perspectiva (Previsto vs Realizado) */}
          <div className="hidden items-center rounded-xl bg-slate-100 p-1 md:flex dark:bg-slate-800">
            <button
              onClick={() => setViewPerspective('realized')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-semibold transition ${
                viewPerspective === 'realized'
                  ? 'bg-white text-emerald-700 shadow-sm dark:bg-slate-900 dark:text-emerald-400'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <Check className="h-3.5 w-3.5" />
              Realizado
            </button>
            <button
              onClick={() => setViewPerspective('planned')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-semibold transition ${
                viewPerspective === 'planned'
                  ? 'bg-white text-blue-700 shadow-sm dark:bg-slate-900 dark:text-blue-400'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <Calendar className="h-3.5 w-3.5" />
              Previsto
            </button>
          </div>

          {/* Quick Add Button */}
          <button
            onClick={() => setIsQuickAddOpen(true)}
            className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white shadow-md shadow-emerald-600/20 transition hover:bg-emerald-500 active:scale-95"
          >
            <Plus className="h-4 w-4 stroke-[2.5]" />
            <span className="hidden sm:inline">Nova Transação</span>
          </button>

          {/* Theme Switcher Button */}
          <button
            onClick={toggleTheme}
            title={resolvedTheme === 'dark' ? 'Mudar para Tema Claro' : 'Mudar para Tema Escuro'}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition hover:bg-slate-200 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
          >
            {resolvedTheme === 'dark' ? (
              <Sun className="h-4 w-4 text-amber-400" />
            ) : (
              <Moon className="h-4 w-4 text-slate-700" />
            )}
          </button>

          {/* Avatar Profile */}
          <div className="flex items-center gap-2 pl-2 border-l border-slate-200 dark:border-slate-800">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-slate-700 font-semibold text-sm ring-2 ring-emerald-500/20 dark:bg-slate-700 dark:text-slate-200">
              {user?.name ? user.name.charAt(0).toUpperCase() : 'U'}
            </div>
          </div>
        </div>
      </header>

      {/* Modal de Novo Workspace */}
      {isNewWsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Criar Novo Workspace</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Crie um novo ambiente financeiro separado (ex: &quot;Casa&quot;, &quot;Empresa&quot;, &quot;Viagem Casal&quot;).
            </p>
            <form onSubmit={handleCreateWs} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Nome do Workspace
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Finanças da Casa"
                  value={newWsName}
                  onChange={(e) => setNewWsName(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsNewWsModalOpen(false)}
                  className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
                >
                  Criar Workspace
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Adição Rápida */}
      <QuickAddModal isOpen={isQuickAddOpen} onClose={() => setIsQuickAddOpen(false)} />
    </>
  );
}
