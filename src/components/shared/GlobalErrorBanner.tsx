'use client';

import React from 'react';
import { useFinance } from '@/lib/context/finance-context';
import { AlertCircle, X } from 'lucide-react';

export function GlobalErrorBanner() {
  const { error, clearError } = useFinance();

  if (!error) return null;
  const workspaceName = (error as Error & { workspace_name?: string }).workspace_name;

  return (
    <div
      role="alert"
      className="mb-6 rounded-2xl bg-rose-50 p-4 text-xs font-bold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 border border-rose-200 dark:border-rose-900 flex items-center justify-between gap-3 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
        <span className="truncate">{workspaceName && `${workspaceName}: `}{error.message}</span>
      </div>
      <button
        onClick={clearError}
        aria-label="Fechar erro"
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold hover:bg-rose-100 dark:hover:bg-rose-900/40 transition shrink-0"
      >
        <X className="h-3.5 w-3.5" />
        <span>Fechar</span>
      </button>
    </div>
  );
}
