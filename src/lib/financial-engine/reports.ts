import { CreditCardBill, Installment, Transaction } from '../types';
import { fromCents, toCents } from './money';

/** Read-only proportional attribution over the complete bill, before period filtering. */
export function allocateBillPayments(transactions: Transaction[], installments: Installment[], bills: CreditCardBill[]) {
  type Item = { id: string; kind: 'transaction' | 'installment'; cents: number };
  const groups = new Map<string, Item[]>();
  const result = { transactions: new Map<string, number>(), installments: new Map<string, number>() };
  const add = (billId: string, item: Item) => {
    const group = groups.get(billId) ?? [];
    group.push(item);
    groups.set(billId, group);
  };
  for (const tx of transactions) {
    if (tx.type === 'expense' && tx.status !== 'cancelled' && tx.credit_card_bill_id) {
      add(tx.credit_card_bill_id, { id: tx.id, kind: 'transaction', cents: toCents(tx.amount) });
    }
  }
  for (const inst of installments) {
    if (inst.status !== 'cancelled' && inst.credit_card_bill_id) {
      add(inst.credit_card_bill_id, { id: inst.id, kind: 'installment', cents: toCents(inst.amount) });
    }
  }
  for (const bill of bills) {
    const group = groups.get(bill.id);
    if (!group || bill.status === 'cancelled') continue;
    const total = group.reduce((sum, item) => sum + item.cents, 0);
    if (total <= 0) continue;
    // Reserve the share of missing/invalid historical items rather than inventing payment.
    const denominator = BigInt(Math.max(total, toCents(bill.total_amount)));
    const paid = BigInt(Math.min(Math.max(0, toCents(bill.paid_amount)), Number(denominator)));
    const shares = group.map((item) => {
      const numerator = paid * BigInt(item.cents);
      return { ...item, paidCents: numerator / denominator, remainder: numerator % denominator, key: `${item.kind}:${item.id}` };
    });
    let remaining = paid * BigInt(total) / denominator - shares.reduce((sum, item) => sum + item.paidCents, BigInt(0));
    shares.sort((a, b) => a.remainder === b.remainder ? (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) : a.remainder > b.remainder ? -1 : 1);
    for (const share of shares) {
      if (remaining > BigInt(0)) { share.paidCents++; remaining--; }
      const target = share.kind === 'transaction' ? result.transactions : result.installments;
      target.set(share.id, fromCents(Number(share.paidCents)));
    }
  }
  return result;
}
