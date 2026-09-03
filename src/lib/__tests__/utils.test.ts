import { describe, it, expect } from 'vitest';
import { cn, formatCurrency, formatDate, formatMonthYear, getStatusBadge, sanitizeCsvCell } from '../utils';

describe('Utils - cn (Tailwind Class Merging)', () => {
  it('deve combinar e mesclar classes do Tailwind corretamente', () => {
    expect(cn('px-2 py-1', 'bg-blue-500')).toBe('px-2 py-1 bg-blue-500');
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-sm', false && 'text-lg', undefined, null, 'font-bold')).toBe('text-sm font-bold');
  });
});

describe('Utils - formatCurrency', () => {
  it('deve formatar valores monetários em Real (BRL)', () => {
    const formatted = formatCurrency(1250.5);
    expect(formatted).toContain('1.250,50');
    expect(formatted).toContain('R$');
  });

  it('deve formatar valores negativos e zero', () => {
    expect(formatCurrency(0)).toContain('0,00');
    expect(formatCurrency(-50.25)).toContain('50,25');
  });

  it('deve retornar fallback quando o valor for nulo, indefinido ou NaN', () => {
    expect(formatCurrency(null)).toContain('0,00');
    expect(formatCurrency(null)).toContain('R$');
    expect(formatCurrency(undefined)).toContain('0,00');
    expect(formatCurrency(NaN)).toContain('0,00');
  });

  it('deve suportar outras moedas quando especificado, inclusive no fallback', () => {
    const formattedUSD = formatCurrency(100, 'USD');
    expect(formattedUSD).toContain('100,00');
    expect(formatCurrency(null, 'USD')).toContain('0,00');
  });
});

describe('Utils - formatDate', () => {
  it('deve formatar datas no padrão brasileiro DD/MM/AAAA', () => {
    expect(formatDate('2026-08-22')).toBe('22/08/2026');
  });

  it('deve retornar hífen quando a data for nula ou indefinida', () => {
    expect(formatDate(null)).toBe('-');
    expect(formatDate(undefined)).toBe('-');
    expect(formatDate('')).toBe('-');
  });

  it('deve lidar com formato customizado e data ISO completa de forma determinística', () => {
    expect(formatDate('2026-08-22T12:00:00Z', 'dd/MM/yyyy')).toBe('22/08/2026');
  });

  it('deve lidar com datas em formato nativo Date e strings não ISO', () => {
    expect(formatDate('2026/08/22')).toBe('22/08/2026');
  });

  it('deve retornar a string original se a data for inválida', () => {
    expect(formatDate('data-invalida')).toBe('data-invalida');
  });
});

describe('Utils - formatMonthYear', () => {
  it('deve formatar string YYYY-MM por extenso em português', () => {
    const formatted = formatMonthYear('2026-08');
    expect(formatted.toLowerCase()).toBe('agosto 2026');
  });

  it('deve formatar string ISO completa YYYY-MM-DD por extenso', () => {
    const formatted = formatMonthYear('2026-08-15');
    expect(formatted.toLowerCase()).toBe('agosto 2026');
  });

  it('deve retornar hífen para valores vazios, nulos ou indefinidos', () => {
    expect(formatMonthYear(null)).toBe('-');
    expect(formatMonthYear(undefined)).toBe('-');
    expect(formatMonthYear('')).toBe('-');
  });
});

describe('Utils - getStatusBadge', () => {
  it('deve retornar label e estilos para todos os status possíveis', () => {
    expect(getStatusBadge('paid').label).toBe('Pago / Recebido');
    expect(getStatusBadge('partially_paid').label).toBe('Parcialmente Pago');
    expect(getStatusBadge('pending').label).toBe('Pendente');
    expect(getStatusBadge('overdue').label).toBe('Vencido');
    expect(getStatusBadge('cancelled').label).toBe('Cancelado');
    expect(getStatusBadge('open').label).toBe('Fatura Aberta');
    expect(getStatusBadge('closed').label).toBe('Fatura Fechada');
    expect(getStatusBadge('outro_status').label).toBe('outro_status');
  });
});

describe('Utils - sanitizeCsvCell', () => {
  it('deve formatar valores numéricos com duas casas decimais', () => {
    expect(sanitizeCsvCell(150.5)).toBe('150.50');
    expect(sanitizeCsvCell(0)).toBe('0.00');
    expect(sanitizeCsvCell(99.999)).toBe('100.00');
  });

  it('deve escapar aspas duplas internas duplicando-as e envolver em aspas', () => {
    expect(sanitizeCsvCell('Compra "Especial"')).toBe('"Compra ""Especial"""');
  });

  it('deve neutralizar quebras de linha substituindo por espaço', () => {
    expect(sanitizeCsvCell("Linha 1\nLinha 2\rLinha 3")).toBe('"Linha 1 Linha 2 Linha 3"');
  });

  it('deve neutralizar caracteres perigosos de fórmula de planilha (=, +, -, @) prefixando com apóstrofo', () => {
    expect(sanitizeCsvCell('=SUM(A1:A10)')).toBe('"\'=SUM(A1:A10)"');
    expect(sanitizeCsvCell('+cmd|/c')).toBe('"\'+cmd|/c"');
    expect(sanitizeCsvCell('-50.00')).toBe('"\' -50.00"'.replace(' ', ''));
    expect(sanitizeCsvCell('@calc')).toBe('"\'@calc"');
  });

  it('deve lidar com nulo, indefinido e strings vazias', () => {
    expect(sanitizeCsvCell(null)).toBe('""');
    expect(sanitizeCsvCell(undefined)).toBe('""');
    expect(sanitizeCsvCell('')).toBe('""');
  });
});
