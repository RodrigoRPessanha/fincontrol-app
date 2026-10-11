import { Installment, Purchase } from './types';
import { monthlySharedExpenses } from './financial-engine/monthly-splits';
import { fromCents, toCents } from './financial-engine/money';

export interface PurchaseRepaymentCount { participant_id: string; count: number }

/** Historical repayments cover the first N installments, independently of card payments. */
export function withPurchaseRepayments(purchase: Purchase, installments: Installment[], counts: PurchaseRepaymentCount[]): Purchase {
  const payer = purchase.paid_by_person_id || purchase.paid_by_member_id;
  const splits = purchase.splits || [];
  const seen = new Set<string>();
  for (const entry of counts) {
    if (seen.has(entry.participant_id) || entry.participant_id === payer || !splits.some((s) => (s.person_id || s.member_id) === entry.participant_id) ||
      !Number.isInteger(entry.count) || entry.count < 0 || entry.count > purchase.installment_count) {
      throw new Error('Informe uma quantidade válida de parcelas repassadas para cada participante.');
    }
    seen.add(entry.participant_id);
  }
  if (!splits.length) return purchase;
  const rows = installments.filter((row) => row.purchase_id === purchase.id);
  const items = [...new Set(rows.map((row) => row.due_date.slice(0, 7)))].flatMap((month) =>
    monthlySharedExpenses(purchase.workspace_id, month, [], [purchase], rows, []).items);
  if (counts.some((entry) => entry.count > 0) && (!payer || items.length !== purchase.installment_count || rows.some((r) => r.status === 'cancelled'))) {
    throw new Error('Confira as parcelas e o pagador da compra antes de registrar os repasses.');
  }
  return { ...purchase, splits: splits.map((share) => {
    const id = (share.person_id || share.member_id)!;
    const count = counts.find((entry) => entry.participant_id === id)?.count ?? 0;
    const cents = items.filter((item) => item.installmentNumber! <= count).reduce((sum, item) =>
      sum + toCents(item.splits.find((s) => (s.person_id || s.member_id) === id)!.amount), 0);
    return { ...share, repaid_installments_count: count, repaid_amount: fromCents(cents) };
  }) };
}
