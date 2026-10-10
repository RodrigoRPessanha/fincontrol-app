import { CreditCardBill, Installment, Purchase, Transaction, TransactionSplit } from '../types';
import { fromCents, toCents } from './money';

export interface MonthlySharedExpense {
  id: string;
  description: string;
  amount: number;
  date: string;
  paid_by_member_id?: string | null;
  paid_by_person_id?: string | null;
  split_type?: Transaction['split_type'];
  splits: TransactionSplit[];
  isPurchase: boolean;
  installmentCount: number;
  installmentNumber?: number;
}

/** Read-only projection. Never changes the accumulated settlement ledger. */
export function monthlySharedExpenses(
  workspaceId: string, month: string, transactions: Transaction[], purchases: Purchase[],
  installments: Installment[], bills: CreditCardBill[]
): { items: MonthlySharedExpense[]; responsibilities: Map<string, number>; warnings: string[] } {
  const items: MonthlySharedExpense[] = [];
  const warnings: string[] = [];
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { items, responsibilities: new Map(), warnings };
  for (const tx of transactions) {
    if (tx.workspace_id !== workspaceId || tx.type !== 'expense' || tx.status === 'cancelled' ||
      !tx.split_type || tx.split_type === 'individual' || !tx.splits?.length) continue;
    const bill = bills.find((b) => b.id === tx.credit_card_bill_id && b.workspace_id === workspaceId);
    if (bill?.status === 'cancelled') continue;
    const date = tx.credit_card_bill_id ? bill?.due_date || tx.due_date : tx.transaction_date;
    if ((date || '').startsWith(month)) items.push({ ...tx, date, splits: tx.splits, isPurchase: false, installmentCount: 1 });
  }
  for (const purchase of purchases) {
    if (purchase.workspace_id !== workspaceId || !purchase.split_type || purchase.split_type === 'individual' || !purchase.splits?.length) continue;
    const rows = installments.filter((inst) => inst.purchase_id === purchase.id)
      .sort((a, b) => a.installment_number - b.installment_number || a.id.localeCompare(b.id));
    const shares = [...purchase.splits].sort((a, b) => (a.person_id || a.member_id || '').localeCompare(b.person_id || b.member_id || ''));
    let remaining = toCents(purchase.total_amount);
    const remainingShares = shares.map((share) => toCents(share.amount));
    if (rows.length !== purchase.installment_count || new Set(rows.map((row) => row.installment_number)).size !== rows.length ||
      rows.reduce((sum, row) => sum + toCents(row.amount), 0) !== remaining ||
      remainingShares.some((value) => value < 0) || remainingShares.reduce((sum, value) => sum + value, 0) !== remaining ||
      rows.some((row) => toCents(row.amount) <= 0)) {
      warnings.push(purchase.description);
      continue;
    }
    // Allocate every installment before filtering the month. Each row and each
    // participant's whole-purchase share conserve cents, including custom splits.
    for (const row of rows) {
      const cents = toCents(row.amount);
      const allocations = remainingShares.map((value, index) => {
        const numerator = BigInt(cents) * BigInt(value);
        return { index, cents: Number(numerator / BigInt(remaining)), remainder: numerator % BigInt(remaining) };
      });
      let extra = cents - allocations.reduce((sum, part) => sum + part.cents, 0);
      allocations.sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
      for (const part of allocations) {
        if (extra > 0) { part.cents++; extra--; }
        remainingShares[part.index] -= part.cents;
      }
      remaining -= cents;
      const bill = bills.find((b) => b.id === row.credit_card_bill_id && b.workspace_id === workspaceId);
      if (row.status === 'cancelled' || bill?.status === 'cancelled' || !row.due_date.startsWith(month)) continue;
      const splits = allocations.sort((a, b) => a.index - b.index).map((part) => ({ ...shares[part.index], amount: fromCents(part.cents) }));
      items.push({ ...purchase, id: `${purchase.id}:${row.id}`, amount: row.amount, date: row.due_date,
        splits, isPurchase: true, installmentCount: purchase.installment_count, installmentNumber: row.installment_number });
    }
  }
  const responsibilityCents = new Map<string, number>();
  for (const item of items) for (const split of item.splits) {
    const id = split.person_id || split.member_id;
    if (id) responsibilityCents.set(id, (responsibilityCents.get(id) || 0) + toCents(split.amount));
  }
  return { items: items.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
    responsibilities: new Map([...responsibilityCents].map(([id, cents]) => [id, fromCents(cents)])), warnings };
}
