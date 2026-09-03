import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, parseISO, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number | undefined | null, currency: string = 'BRL'): string {
  const num = value === undefined || value === null || isNaN(value) ? 0 : value;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currency,
  }).format(num);
}

export function formatDate(dateString: string | undefined | null, formatStr: string = 'dd/MM/yyyy'): string {
  if (!dateString) return '-';
  try {
    const parsed = parseISO(dateString);
    if (!isValid(parsed)) {
      const d = new Date(dateString);
      if (!isValid(d)) return dateString;
      return format(d, formatStr, { locale: ptBR });
    }
    return format(parsed, formatStr, { locale: ptBR });
  } catch {
    return dateString;
  }
}

export function formatMonthYear(dateString: string | undefined | null): string {
  if (!dateString) return '-';
  try {
    if (dateString.length === 7) {
      const [year, month] = dateString.split('-');
      const d = new Date(Number(year), Number(month) - 1, 1);
      const str = format(d, 'MMMM yyyy', { locale: ptBR });
      return str.charAt(0).toUpperCase() + str.slice(1);
    }
    const d = parseISO(dateString);
    const str = format(d, 'MMMM yyyy', { locale: ptBR });
    return str.charAt(0).toUpperCase() + str.slice(1);
  } catch {
    return dateString;
  }
}

export function getStatusBadge(status: string) {
  switch (status) {
    case 'paid':
      return { label: 'Pago / Recebido', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800' };
    case 'partially_paid':
      return { label: 'Parcialmente Pago', bg: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800' };
    case 'pending':
      return { label: 'Pendente', bg: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800' };
    case 'overdue':
      return { label: 'Vencido', bg: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800' };
    case 'cancelled':
      return { label: 'Cancelado', bg: 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700' };
    case 'open':
      return { label: 'Fatura Aberta', bg: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-400 dark:border-sky-800' };
    case 'closed':
      return { label: 'Fatura Fechada', bg: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-800' };
    default:
      return { label: status, bg: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300' };
  }
}

/**
 * Sanitiza células de CSV prevenindo formula injection (=, +, -, @),
 * tratando aspas duplas (" -> "") e normalizando quebras de linha.
 */
export function sanitizeCsvCell(val: string | number | undefined | null): string {
  if (typeof val === 'number') return val.toFixed(2);
  let str = String(val ?? '').replace(/"/g, '""').replace(/\r?\n|\r/g, ' ');
  if (/^[=+\-@]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str}"`;
}
