import { describe, it, expect } from 'vitest';
import {
  getActualDaysInMonth,
  calculateIntegerPercentages,
  toCents,
  fromCents,
  roundCurrency,
  compareCurrency,
} from '../../financial-engine';
import { Account, Category, CreditCard, CreditCardBill, Installment, Payment, Purchase, RecurringTransaction, Transaction, Settlement, WorkspaceMember } from '../../types';

describe('Financial Engine - Dias Reais do Mês', () => {
  it('deve retornar o número real de dias para meses de 28, 29, 30 e 31 dias', () => {
    expect(getActualDaysInMonth(2026, 1)).toBe(31);
    expect(getActualDaysInMonth(2026, 2)).toBe(28);
    expect(getActualDaysInMonth(2024, 2)).toBe(29);
    expect(getActualDaysInMonth(2026, 4)).toBe(30);
    expect(getActualDaysInMonth(2026, 8)).toBe(31);
  });
});


describe('Financial Engine - Distribuição Exata de Percentuais (Largest Remainder Method)', () => {
  it('deve fechar a soma em exatamente 100% no caso clássico de três partes iguais (1/3 + 1/3 + 1/3)', () => {
    const items = [
      { id: 'item-1', amount: 100 },
      { id: 'item-2', amount: 100 },
      { id: 'item-3', amount: 100 },
    ];
    const total = 300;
    const res = calculateIntegerPercentages(items, total);

    const p1 = res.get('item-1')!;
    const p2 = res.get('item-2')!;
    const p3 = res.get('item-3')!;

    expect(p1 + p2 + p3).toBe(100);
    expect([p1, p2, p3].sort()).toEqual([33, 33, 34]);
  });

  it('deve distribuir percentuais proporcionais em dízimas e múltiplos itens', () => {
    const items = [
      { id: 'a', amount: 70 },
      { id: 'b', amount: 20 },
      { id: 'c', amount: 10 },
    ];
    const res = calculateIntegerPercentages(items, 100);
    expect(res.get('a')).toBe(70);
    expect(res.get('b')).toBe(20);
    expect(res.get('c')).toBe(10);
    expect(res.get('a')! + res.get('b')! + res.get('c')!).toBe(100);
  });

  it('deve retornar 0 para todos os itens quando o totalAmount for zero ou negativo', () => {
    const items = [
      { id: 'a', amount: 0 },
      { id: 'b', amount: 0 },
    ];
    const res = calculateIntegerPercentages(items, 0);
    expect(res.get('a')).toBe(0);
    expect(res.get('b')).toBe(0);

    const resNeg = calculateIntegerPercentages([{ id: 'a', amount: 50 }], -100);
    expect(resNeg.get('a')).toBe(0);
  });

  it('deve lidar com lista vazia sem quebrar', () => {
    const res = calculateIntegerPercentages([], 100);
    expect(res.size).toBe(0);
  });

  it('deve distribuir saldo restante quando itens somam menos que o total com restos zero', () => {
    const items = [
      { id: 'a', amount: 50 },
      { id: 'b', amount: 0 },
    ];
    const res = calculateIntegerPercentages(items, 100);
    expect(res.get('a')).toBe(100);
    expect(res.get('b')).toBe(0);
  });

  it('deve normalizar proporcionalmente quando a soma das fatias divergir do total informado', () => {
    // Caso da auditoria: 60 + 60 com total 100 deve normalizar para 50% e 50% (soma 100%)
    const items = [
      { id: 'item-1', amount: 60 },
      { id: 'item-2', amount: 60 },
    ];
    const res = calculateIntegerPercentages(items, 100);
    expect(res.get('item-1')).toBe(50);
    expect(res.get('item-2')).toBe(50);
    expect(res.get('item-1')! + res.get('item-2')!).toBe(100);
  });

  it('deve tratar com segurança valores NaN, Infinity, negativos e centavos residuais', () => {
    const items = [
      { id: 'a', amount: 100 },
      { id: 'b', amount: -20 },
      { id: 'c', amount: NaN },
      { id: 'd', amount: Infinity },
    ];
    const res = calculateIntegerPercentages(items, 100);
    expect(res.get('a')).toBe(100);
    expect(res.get('b')).toBe(0);
    expect(res.get('c')).toBe(0);
    expect(res.get('d')).toBe(0);
    expect(res.get('a')! + res.get('b')! + res.get('c')! + res.get('d')!).toBe(100);
  });
});

describe('Financial Engine - Conversão e Precisão Monetária (toCents, fromCents, roundCurrency)', () => {
  it('toCents deve converter floats monetários com precisão half-up', () => {
    expect(toCents(10.55)).toBe(1055);
    expect(toCents(10.555)).toBe(1056);
    expect(toCents(-10.555)).toBe(-1056);
  });

  it('toCents deve retornar 0 para valores subcentavos abaixo do limiar (abs < 0.005)', () => {
    expect(toCents(0.004)).toBe(0);
    expect(toCents(-0.004)).toBe(0);
    expect(toCents(0.0001)).toBe(0);
  });

  it('toCents deve tratar notação científica tanto com expoente positivo quanto negativo', () => {
    expect(toCents(2e3)).toBe(200000);
    expect(toCents(1.5e-3)).toBe(0);
    expect(toCents(5e-2)).toBe(5);
  });

  it('toCents deve tratar entradas não-numéricas, não-finitas e overflow com segurança', () => {
    expect(toCents(NaN)).toBe(0);
    expect(toCents(Infinity)).toBe(0);
    expect(toCents(-Infinity)).toBe(0);
    expect(toCents(undefined as any)).toBe(0);
    expect(toCents('100' as any)).toBe(0);
    expect(toCents(Number.MAX_SAFE_INTEGER)).toBe(0);
    expect(toCents(-0)).toBe(0);
  });

  it('fromCents deve converter centavos de volta para float de 2 casas decimais', () => {
    expect(fromCents(1055)).toBe(10.55);
    expect(fromCents(-1055)).toBe(-10.55);
    expect(fromCents(0)).toBe(0);
  });

  it('fromCents deve tratar não-numéricos, não-finitos, zero negativo e inteiros inseguros', () => {
    expect(fromCents('invalid' as any)).toBe(0);
    expect(fromCents(NaN)).toBe(0);
    expect(fromCents(Infinity)).toBe(0);
    expect(fromCents(-0)).toBe(0);
    expect(fromCents(Number.MAX_SAFE_INTEGER + 1000)).toBe(0);
  });

  it('roundCurrency deve arredondar números de forma determinística', () => {
    expect(roundCurrency(10.555)).toBe(10.56);
    expect(roundCurrency(10.554)).toBe(10.55);
    expect(roundCurrency(0)).toBe(0);
  });

  it('cobre casos extremos de notação científica, -0 e compareCurrency', () => {
    // targetExp < 0 em notação científica
    expect(toCents(1.23e-4)).toBe(0);
    expect(toCents(6e-3)).toBe(1);

    // fromCents e toCents resultando em -0
    expect(toCents(-0.001)).toBe(0);
    expect(fromCents(-0.0001)).toBe(0);

    // compareCurrency
    expect(compareCurrency(20, 10)).toBeGreaterThan(0);
    expect(compareCurrency(10, 20)).toBeLessThan(0);
    expect(compareCurrency(10, 10)).toBe(0);
  });
});

