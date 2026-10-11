import { describe, expect, it } from 'vitest';
import { calculateCardBillDates, cardDatesForCycle } from '../financial-engine/credit-cards';
import { splitInstallments } from '../financial-engine/installments';
import { CreditCard } from '../types';

describe('relative card closing', () => {
  it('subtracts seven calendar days across February and leap years', () => {
    expect(cardDatesForCycle('2026-02', 22, 1, 7)).toEqual({ referenceMonth: '2026-02', closingDate: '2026-02-22', dueDate: '2026-03-01' });
    expect(cardDatesForCycle('2026-03', 22, 1, 7).closingDate).toBe('2026-03-25');
    expect(cardDatesForCycle('2028-02', 22, 1, 7).closingDate).toBe('2028-02-23');
  });
  it('moves a purchase on closing day into the next cycle', () => {
    expect(calculateCardBillDates('2026-02-21', 22, 1, 7).dueDate).toBe('2026-03-01');
    expect(calculateCardBillDates('2026-02-22', 22, 1, 7).dueDate).toBe('2026-04-01');
  });
  it('recomputes every installment rather than carrying a fixed closing day', () => {
    const card = { closing_day: 22, due_day: 1, closing_days_before_due: 7 } as CreditCard;
    const rows = splitInstallments(600, 3, '2026-02-20', card, 1);
    expect(rows.map(r => r.closingDate)).toEqual(['2026-02-22', '2026-03-25', '2026-04-24']);
    expect(rows.map(r => r.dueDate)).toEqual(['2026-03-01', '2026-04-01', '2026-05-01']);
    expect(rows.map(r => r.isPaid)).toEqual([true, false, false]);
  });
  it('clamps due day before subtracting the offset and rolls over December', () => {
    expect(cardDatesForCycle('2026-02', 20, 31, 7)).toMatchObject({ dueDate: '2026-02-28', closingDate: '2026-02-21' });
    expect(cardDatesForCycle('2026-12', 20, 1, 7)).toMatchObject({ dueDate: '2027-01-01', closingDate: '2026-12-25' });
  });
  it('rejects invalid offsets and retains fixed calendar behavior', () => {
    expect(() => calculateCardBillDates('2026-02-10', 20, 1, 0)).toThrow();
    expect(() => calculateCardBillDates('2026-02-10', 20, 1, 28)).toThrow();
    expect(calculateCardBillDates('2026-02-10', 20, 1)).toMatchObject({ dueDate: '2026-03-01', closingDate: '2026-02-20' });
  });
});
