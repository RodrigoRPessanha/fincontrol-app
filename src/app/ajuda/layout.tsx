import Link from 'next/link';
import { BookOpen, ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Central de ajuda | FinControl',
  description: 'Guias em português para organizar gastos, workspaces e divisão de despesas no FinControl.',
};

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a href="#conteudo-ajuda" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:p-3 focus:text-slate-900">Pular para o conteúdo</a>
      <div role="region" aria-label="Central de ajuda" tabIndex={0} className="help-scroll-region h-dvh overflow-y-scroll bg-slate-50 text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-emerald-600 dark:bg-slate-950 dark:text-slate-100">
        <header role="banner" className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8">
            <Link href="/ajuda" className="flex items-center gap-3 rounded-lg font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600">
              <BookOpen aria-hidden="true" className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
              <span>FinControl <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">Central de ajuda</span></span>
            </Link>
            <Link href="/" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600 dark:border-slate-700 dark:hover:bg-slate-800">
              <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Acessar o sistema
            </Link>
          </div>
        </header>
        <main id="conteudo-ajuda" tabIndex={-1} className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">{children}</main>
        <footer role="contentinfo" className="mx-auto max-w-6xl px-5 pb-8 text-sm text-slate-500 sm:px-8 dark:text-slate-400">Ajuda pública · Você não precisa entrar para ler os guias. Os registros financeiros continuam protegidos.</footer>
      </div>
    </>
  );
}
