'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  ArrowLeftRight,
  Plus,
  TrendingUp,
  Menu,
  X,
  CreditCard,
  Layers,
  Repeat,
  PieChart,
  Target,
  BarChart3,
  Users,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { QuickAddModal } from '../transactions/QuickAddModal';

const drawerLinks = [
  { href: '/accounts', label: 'Contas & Cartões', icon: CreditCard },
  { href: '/installments', label: 'Parcelamentos', icon: Layers },
  { href: '/recurring', label: 'Recorrências', icon: Repeat },
  { href: '/budgets', label: 'Orçamentos', icon: PieChart },
  { href: '/goals', label: 'Metas Financeiras', icon: Target },
  { href: '/reports', label: 'Relatórios', icon: BarChart3 },
  { href: '/workspaces', label: 'Membros & Acesso', icon: Users },
  { href: '/settings', label: 'Configurações', icon: Settings },
];

export function MobileNav() {
  const pathname = usePathname();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-40 flex h-16 items-center justify-around border-t border-slate-200 bg-white/95 px-2 backdrop-blur-md lg:hidden dark:border-slate-800 dark:bg-slate-900/95">
        <Link
          href="/"
          className={cn(
            'flex flex-col items-center gap-1 text-xs font-medium',
            pathname === '/'
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-slate-500 hover:text-slate-900 dark:text-slate-400'
          )}
        >
          <LayoutDashboard className="h-5 w-5" />
          <span>Início</span>
        </Link>

        <Link
          href="/transactions"
          className={cn(
            'flex flex-col items-center gap-1 text-xs font-medium',
            pathname === '/transactions'
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-slate-500 hover:text-slate-900 dark:text-slate-400'
          )}
        >
          <ArrowLeftRight className="h-5 w-5" />
          <span>Extrato</span>
        </Link>

        {/* Center Floating Action Button */}
        <button
          onClick={() => setIsQuickAddOpen(true)}
          className="-mt-5 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-600/30 transition hover:bg-emerald-500 active:scale-90"
        >
          <Plus className="h-6 w-6 stroke-[2.5]" />
        </button>

        <Link
          href="/planning"
          className={cn(
            'flex flex-col items-center gap-1 text-xs font-medium',
            pathname === '/planning'
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-slate-500 hover:text-slate-900 dark:text-slate-400'
          )}
        >
          <TrendingUp className="h-5 w-5" />
          <span>Futuro</span>
        </Link>

        <button
          onClick={() => setIsDrawerOpen(true)}
          className="flex flex-col items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400"
        >
          <Menu className="h-5 w-5" />
          <span>Menu</span>
        </button>
      </nav>

      {/* Slide-out Menu Drawer */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-50 flex bg-black/60 backdrop-blur-sm lg:hidden">
          <div className="ml-auto flex h-full w-4/5 max-w-sm flex-col justify-between bg-white p-6 shadow-2xl dark:bg-slate-900">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
                <h3 className="font-bold text-slate-900 dark:text-white">Mais Módulos</h3>
                <button
                  onClick={() => setIsDrawerOpen(false)}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mt-4 flex flex-col gap-1">
                {drawerLinks.map((link) => {
                  const Icon = link.icon;
                  const isActive = pathname === link.href;
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={() => setIsDrawerOpen(false)}
                      className={cn(
                        'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                        isActive
                          ? 'bg-emerald-50 text-emerald-700 font-semibold dark:bg-emerald-950/50 dark:text-emerald-400'
                          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                      )}
                    >
                      <Icon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      <span>{link.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>

            <div className="text-center text-xs text-slate-400">
              FinControl © 2026
            </div>
          </div>
        </div>
      )}

      {/* Modal de Adição Rápida Mobile */}
      <QuickAddModal isOpen={isQuickAddOpen} onClose={() => setIsQuickAddOpen(false)} />
    </>
  );
}
