import { Installment, Purchase, Transaction } from './types';

export interface ExpenseListRow extends Transaction {
  record_kind: 'transaction' | 'installment';
  period_date: string;
  purchase_id?: string;
  installment_number?: number;
  installment_count?: number;
}

/** Read-only list: each installment appears once; the full purchase never becomes another expense row. */
export function expenseListRows(workspaceId: string, transactions: Transaction[], purchases: Purchase[], installments: Installment[]): ExpenseListRow[] {
  const rows: ExpenseListRow[] = transactions.filter((tx) => tx.workspace_id === workspaceId).map((tx) => ({ ...tx, record_kind: 'transaction', period_date: tx.transaction_date }));
  const byId = new Map(purchases.filter((p) => p.workspace_id === workspaceId).map((p) => [p.id, p]));
  for (const inst of installments) {
    const purchase = byId.get(inst.purchase_id);
    if (!purchase) continue;
    rows.push({ id: inst.id, workspace_id: workspaceId, record_kind: 'installment', purchase_id: purchase.id,
      installment_number: inst.installment_number, installment_count: purchase.installment_count,
      description: purchase.description, amount: inst.amount, type: 'expense', status: inst.status,
      transaction_date: purchase.purchase_date, due_date: inst.due_date, period_date: inst.due_date,
      paid_amount: inst.status === 'paid' ? inst.amount : inst.paid_amount,
      category_id: purchase.category_id, payment_method_id: purchase.payment_method_id, account_id: purchase.account_id,
      credit_card_id: purchase.credit_card_id, credit_card_bill_id: inst.credit_card_bill_id, created_at: inst.created_at });
  }
  return rows.sort((a, b) => b.period_date.localeCompare(a.period_date) || a.record_kind.localeCompare(b.record_kind) || a.id.localeCompare(b.id));
}
