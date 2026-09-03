import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/context/auth-context';
import { ThemeProvider } from '@/lib/context/theme-context';
import { FinanceProvider } from '@/lib/context/finance-context';

export const metadata: Metadata = {
  title: 'FinControl - Gestão Financeira Pessoal e Compartilhada',
  description: 'Controle completo de despesas, receitas, contas bancárias, cartões, faturas, compras parceladas e planejamento futuro.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className="h-full">
      <body className="h-full min-h-screen bg-slate-50 text-slate-900 antialiased selection:bg-emerald-500 selection:text-white dark:bg-slate-950 dark:text-slate-100">
        <AuthProvider>
          <ThemeProvider>
            <FinanceProvider>
              {children}
            </FinanceProvider>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
