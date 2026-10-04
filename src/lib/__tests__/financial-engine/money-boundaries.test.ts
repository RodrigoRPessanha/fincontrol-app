import { describe, expect, it } from 'vitest';
import { normalizeMoney, readMoney, MAX_MONEY } from '../../financial-engine';
import { parseMoneyField } from '../../utils';

describe('Fronteiras monetárias', () => {
  it.each(['12,34', '12.34'])('preserva decimal %s', (value) => expect(parseMoneyField(value, 'Valor')).toBe(12.34));
  it.each(['1.234,56', '1,234.56', '1234.56'])('preserva milhares %s', (value) => expect(parseMoneyField(value, 'Valor')).toBe(1234.56));
  it.each(['100abc', '1.23.45', '1e3', 'NaN', 'Infinity', '', '1.234'])('recusa texto inválido/ambíguo %s', (value) => expect(() => parseMoneyField(value, 'Valor')).toThrow());
  it('saldo assinado e vazio opcional não permitem texto inválido', () => {
    expect(parseMoneyField('-12.34', 'Saldo', 'signed')).toBe(-12.34);
    expect(parseMoneyField('', 'Saldo', 'signed', true)).toBe(0);
    expect(() => parseMoneyField('abc', 'Saldo', 'signed', true)).toThrow();
  });
  it.each([NaN, Infinity, -Infinity, -100, 0, 0.004, 1e30])('recusa quantia de operação %s', (value) => expect(() => normalizeMoney(value)).toThrow());
  it('normaliza half-up e valida limites e políticas por campo', () => {
    expect(normalizeMoney(10.075)).toBe(10.08);
    expect(normalizeMoney(0.005)).toBe(0.01);
    expect(normalizeMoney(MAX_MONEY)).toBe(MAX_MONEY);
    expect(() => normalizeMoney(MAX_MONEY + 1)).toThrow();
    expect(normalizeMoney(0, 'Teto', 'nonnegative')).toBe(0);
    expect(() => normalizeMoney(-0.001, 'Teto', 'nonnegative')).toThrow();
    expect(normalizeMoney(-12.345, 'Saldo', 'signed')).toBe(-12.35);
  });
  it.each(['NaN', 'Infinity', null, undefined, {}, true, ''])('não mascara dado inválido como zero: %s', (value) => expect(() => readMoney(value)).toThrow());
  it('lê números/decimais do banco sem perder saldo negativo legítimo', () => {
    expect(readMoney('0.00')).toBe(0);
    expect(readMoney('-12.34')).toBe(-12.34);
  });
});
