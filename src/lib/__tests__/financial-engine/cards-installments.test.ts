import { describe, it, expect } from 'vitest';
import {
  calculateCardBillDates,
  splitInstallments
} from '../../financial-engine';
import { Account, Category, CreditCard, CreditCardBill, Installment, Payment, Purchase, RecurringTransaction, Transaction, Settlement, WorkspaceMember } from '../../types';

describe('Financial Engine - Cálculo de Faturas de Cartão (calculateCardBillDates)', () => {
  it('deve manter compra na fatura do mês atual se a compra foi antes do fechamento', () => {
    const result = calculateCardBillDates('2026-08-05', 10, 18);
    expect(result.referenceMonth).toBe('2026-08');
    expect(result.closingDate).toBe('2026-08-10');
    expect(result.dueDate).toBe('2026-08-18');
  });

  it('deve projetar para a fatura do mês seguinte se a compra ocorreu após o fechamento', () => {
    const result = calculateCardBillDates('2026-08-15', 10, 18);
    expect(result.referenceMonth).toBe('2026-09');
    expect(result.closingDate).toBe('2026-09-10');
    expect(result.dueDate).toBe('2026-09-18');
  });

  it('deve tratar vencimento no mês subsequente quando dueDay < closingDay', () => {
    const result = calculateCardBillDates('2026-08-10', 25, 5);
    expect(result.referenceMonth).toBe('2026-08');
    expect(result.closingDate).toBe('2026-08-25');
    expect(result.dueDate).toBe('2026-09-05');
  });

  it('deve tratar virada de ano em Dezembro tanto no fechamento quanto no vencimento subsequente', () => {
    const result1 = calculateCardBillDates('2026-12-28', 20, 28);
    expect(result1.referenceMonth).toBe('2027-01');
    expect(result1.closingDate).toBe('2027-01-20');
    expect(result1.dueDate).toBe('2027-01-28');

    const result2 = calculateCardBillDates('2026-12-10', 20, 5);
    expect(result2.referenceMonth).toBe('2026-12');
    expect(result2.closingDate).toBe('2026-12-20');
    expect(result2.dueDate).toBe('2027-01-05');
  });

  it('deve aplicar clamp seguro para fechamento nos dias 29, 30 e 31 em Fevereiro', () => {
    const result = calculateCardBillDates('2026-02-10', 31, 10);
    expect(result.referenceMonth).toBe('2026-02');
    expect(result.closingDate).toBe('2026-02-28');
    expect(result.dueDate).toBe('2026-03-10');
  });

  it('deve calcular corretamente a matriz de datas de fim de mês, bissexto e viradas de ano', () => {
    // 28/02/2026 após fechamento dia 25
    const r1 = calculateCardBillDates('2026-02-28', 25, 5);
    expect(r1.referenceMonth).toBe('2026-03');
    expect(r1.closingDate).toBe('2026-03-25');
    expect(r1.dueDate).toBe('2026-04-05');

    // 29/02/2028 (ano bissexto) após fechamento dia 28
    const r2 = calculateCardBillDates('2028-02-29', 28, 10);
    expect(r2.referenceMonth).toBe('2028-03');
    expect(r2.closingDate).toBe('2028-03-28');
    expect(r2.dueDate).toBe('2028-04-10');

    // 30/04/2026 após fechamento dia 25
    const r3 = calculateCardBillDates('2026-04-30', 25, 5);
    expect(r3.referenceMonth).toBe('2026-05');
    expect(r3.closingDate).toBe('2026-05-25');
    expect(r3.dueDate).toBe('2026-06-05');

    // 31/01/2026 após fechamento dia 30
    const r4 = calculateCardBillDates('2026-01-31', 30, 5);
    expect(r4.referenceMonth).toBe('2026-02');
    expect(r4.closingDate).toBe('2026-02-28');
    expect(r4.dueDate).toBe('2026-03-05');

    // 31/12/2026 após fechamento dia 20 (virada de ano)
    const r5 = calculateCardBillDates('2026-12-31', 20, 5);
    expect(r5.referenceMonth).toBe('2027-01');
    expect(r5.closingDate).toBe('2027-01-20');
    expect(r5.dueDate).toBe('2027-02-05');
  });

  it('deve usar valores defensivos se parâmetros forem inválidos', () => {
    const result1 = calculateCardBillDates('2026-08-10', 0, 40);
    expect(result1.referenceMonth).toBe('2026-09');
    expect(result1.closingDate).toBe('2026-09-01');
    expect(result1.dueDate).toBe('2026-09-30');

    const result2 = calculateCardBillDates('2026-08-05', 15, 0);
    expect(result2.referenceMonth).toBe('2026-08');
    expect(result2.closingDate).toBe('2026-08-15');
    expect(result2.dueDate).toBe('2026-09-10');

    expect(() => calculateCardBillDates('data-invalida', 10, 20)).toThrow('Data de compra inválida fornecida');
    expect(() => calculateCardBillDates('', 10, 20)).toThrow('Data de compra inválida');
  });
});


describe('Financial Engine - splitInstallments', () => {
  it('deve lançar erro se a data de compra for inválida no parcelamento', () => {
    expect(() => splitInstallments(100, 3, 'data-invalida')).toThrow('Data de compra inválida fornecida');
    expect(() => splitInstallments(100, 3, '')).toThrow('Data de compra inválida');
  });

  it('deve rejeitar parcelamento com quantidade inválida, decimal ou negativa', () => {
    expect(splitInstallments(100, 0, '2026-08-01')).toEqual([]);
    expect(splitInstallments(100, -3, '2026-08-01')).toEqual([]);
    expect(splitInstallments(100, 2.5, '2026-08-01')).toEqual([]);
    expect(splitInstallments(100, 150, '2026-08-01')).toEqual([]);
    expect(splitInstallments(100, '3' as any, '2026-08-01')).toEqual([]);
  });

  it('deve rejeitar valores monetários inválidos ou parcelas menores que 1 centavo', () => {
    expect(splitInstallments(0, 3, '2026-08-01')).toEqual([]);
    expect(splitInstallments(-50, 3, '2026-08-01')).toEqual([]);
    expect(splitInstallments(NaN, 3, '2026-08-01')).toEqual([]);
    expect(splitInstallments(Infinity, 3, '2026-08-01')).toEqual([]);
    expect(splitInstallments(0.02, 5, '2026-08-01')).toEqual([]);
  });

  it('deve dividir R$ 100,00 em 3x sem perda de centavos (33,34 + 33,33 + 33,33)', () => {
    const split = splitInstallments(100, 3, '2026-08-15');
    expect(split).toHaveLength(3);
    expect(split[0].amount).toBe(33.34);
    expect(split[1].amount).toBe(33.33);
    expect(split[2].amount).toBe(33.33);
    expect(split[0].dueDate).toBe('2026-08-15');
    expect(split[1].dueDate).toBe('2026-09-15');
    expect(split[2].dueDate).toBe('2026-10-15');
  });

  it('deve associar datas de fatura quando fornecido cartão de crédito', () => {
    const card: CreditCard = {
      id: 'card-1',
      workspace_id: 'ws-1',
      name: 'Itaú',
      institution: 'Itaú',
      credit_limit: 5000,
      closing_day: 10,
      due_day: 18,
      color: '#000',
      active: true,
      created_at: '2026-01-01',
    };

    const split = splitInstallments(300, 2, '2026-08-15', card);
    expect(split).toHaveLength(2);
    expect(split[0].referenceMonth).toBe('2026-09');
    expect(split[0].dueDate).toBe('2026-09-18');
    expect(split[1].referenceMonth).toBe('2026-10');
    expect(split[1].dueDate).toBe('2026-10-18');
  });

  it('deve gerar faturas consecutivas para compra em fim de mês (31/01, fechamento 30, 3x) sem duplicar ciclo nem pular mês', () => {
    const cardEndMonth: CreditCard = {
      id: 'card-end',
      workspace_id: 'ws-1',
      name: 'Nubank',
      institution: 'Nubank',
      credit_limit: 10000,
      closing_day: 30,
      due_day: 5,
      color: '#820ad1',
      active: true,
      created_at: '2026-01-01',
    };

    const split = splitInstallments(300, 3, '2026-01-31', cardEndMonth);
    expect(split).toHaveLength(3);
    // Parcela 1: cai na fatura de fevereiro (fechamento de janeiro no dia 30 já havia passado)
    expect(split[0].referenceMonth).toBe('2026-02');
    expect(split[0].closingDate).toBe('2026-02-28');
    expect(split[0].dueDate).toBe('2026-03-05');

    // Parcela 2: fatura de março consecutiva (sem pular mês!)
    expect(split[1].referenceMonth).toBe('2026-03');
    expect(split[1].closingDate).toBe('2026-03-30');
    expect(split[1].dueDate).toBe('2026-04-05');

    // Parcela 3: fatura de abril consecutiva
    expect(split[2].referenceMonth).toBe('2026-04');
    expect(split[2].closingDate).toBe('2026-04-30');
    expect(split[2].dueDate).toBe('2026-05-05');
  });

  it('deve suportar paidInstallmentsCount e marcar parcelas já quitadas', () => {
    const split = splitInstallments(1000, 10, '2026-01-10', undefined, 3);
    expect(split).toHaveLength(10);
    expect(split[0].isPaid).toBe(true);
    expect(split[1].isPaid).toBe(true);
    expect(split[2].isPaid).toBe(true);
    expect(split[3].isPaid).toBe(false);
    expect(split[9].isPaid).toBe(false);
  });

  it('deve cruzar virada de ano em parcelamento de 12x no cartão com vencimento no mês seguinte', () => {
    const cardYearTurn: CreditCard = {
      id: 'card-yt',
      workspace_id: 'ws-1',
      name: 'Itaú',
      institution: 'Itaú',
      credit_limit: 15000,
      closing_day: 25,
      due_day: 5,
      color: '#ff6600',
      active: true,
      created_at: '2026-01-01',
    };

    const split = splitInstallments(1200, 12, '2026-11-28', cardYearTurn, 2);
    expect(split).toHaveLength(12);
    // Parcela 1: Dezembro 2026 (vencimento Jan 2027)
    expect(split[0].referenceMonth).toBe('2026-12');
    expect(split[0].dueDate).toBe('2027-01-05');
    expect(split[0].isPaid).toBe(true);

    // Parcela 2: Janeiro 2027 (vencimento Fev 2027)
    expect(split[1].referenceMonth).toBe('2027-01');
    expect(split[1].dueDate).toBe('2027-02-05');
    expect(split[1].isPaid).toBe(true);

    // Parcela 12: Novembro 2027 (vencimento Dez 2027)
    expect(split[11].referenceMonth).toBe('2027-11');
    expect(split[11].dueDate).toBe('2027-12-05');
    expect(split[11].isPaid).toBe(false);
  });
});

