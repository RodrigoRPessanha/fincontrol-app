'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  ArrowLeftRight,
  TrendingUp,
  CreditCard,
  Layers,
  Repeat,
  PieChart,
  Target,
  BarChart3,
  Users,
  Settings,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFinance } from '@/lib/context/finance-context';

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/transactions', label: 'Transações', icon: ArrowLeftRight },
  { href: '/planning', label: 'Planejamento Futuro', icon: TrendingUp },
  { href: '/accounts', label: 'Contas & Cartões', icon: CreditCard },
  { href: '/installments', label: 'Parcelamentos', icon: Layers },
  { href: '/recurring', label: 'Recorrências', icon: Repeat },
  { href: '/budgets', label: 'Orçamentos', icon: PieChart },
  { href: '/goals', label: 'Metas', icon: Target },
  { href: '/reports', label: 'Relatórios', icon: BarChart3 },
  { href: '/workspaces', label: 'Membros & Acesso', icon: Users },
  { href: '/settings', label: 'Configurações', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { activeWorkspace, workspaceMembers } = useFinance();

  const membersInActiveWs = workspaceMembers.filter(
    (m) => m.workspace_id === activeWorkspace.id
  );

  return (
    <aside className="hidden lg:flex h-screen w-64 flex-col justify-between border-r border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sticky top-0">
      <div className="flex flex-col gap-6">
        {/* Logo & App Brand */}
        <div className="flex items-center gap-3 px-2 pt-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 text-white shadow-lg shadow-emerald-500/20">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900 dark:text-white leading-tight">
              FinControl
            </h1>
            <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              Pessoal & Compartilhado
            </p>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="flex flex-col gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition duration-150',
                  isActive
                    ? 'bg-emerald-50 text-emerald-700 shadow-sm font-semibold dark:bg-emerald-950/50 dark:text-emerald-400'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
                )}
              >
                <Icon
                  className={cn(
                    'h-4 w-4',
                    isActive
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-slate-400 dark:text-slate-500'
                  )}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Footer / Active Workspace & Security Info */}
      <div className="flex flex-col gap-3 rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
        <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
          <span>Membros no Workspace</span>
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-300">
            {membersInActiveWs.length}
          </span>
        </div>

        {/* Avatares dos Membros */}
        <div className="flex -space-x-2 overflow-hidden py-1">
          {membersInActiveWs.map((m) => (
            <div
              key={m.id}
              title={`${m.user?.name || m.user_id} (${m.role})`}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white ring-2 ring-white dark:ring-slate-900"
            >
              {m.user?.name ? m.user.name.charAt(0).toUpperCase() : 'M'}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
          <span>RLS & Supabase Seguro</span>
        </div>
      </div>
    </aside>
  );
}
