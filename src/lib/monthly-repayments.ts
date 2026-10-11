import { Installment, Purchase } from './types';
import { withPurchaseRepayments } from './purchase-repayments';

export interface MonthlyRepaymentChange {
  purchase_id: string;
  expected_version: number;
  previous_count: number;
  count: number;
}

/** Marks only an unpaid prefix through the cutoff month, never reduces existing history. */
export function monthlyRepaymentPlan(workspaceId: string, month: string, participantId: string, purchases: Purchase[], installments: Installment[]): MonthlyRepaymentChange[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Selecione um mês válido.');
  return purchases.filter(p => p.workspace_id === workspaceId && p.split_type && p.split_type !== 'individual' && (p.paid_by_person_id || p.paid_by_member_id) !== participantId)
    .flatMap(p => {
      const share = p.splits?.find(s => (s.person_id || s.member_id) === participantId);
      if (!share) return [];
      const rows = installments.filter(i => i.purchase_id === p.id);
      const count = rows.filter(i => i.due_date.slice(0, 7) <= month).reduce((max, i) => Math.max(max, i.installment_number), 0);
      const previous = share.repaid_installments_count || 0;
      if (count <= previous) return [];
      if (rows.some(i => i.installment_number <= count && i.due_date.slice(0, 7) > month)) throw new Error('Confira a ordem dos vencimentos antes de marcar os repasses.');
      // Reuse the canonical cents and complete-calendar validation.
      withPurchaseRepayments(p, rows, (p.splits || []).filter(s => (s.person_id || s.member_id) !== (p.paid_by_person_id || p.paid_by_member_id)).map(s => ({participant_id: (s.person_id || s.member_id)!, count: (s.person_id || s.member_id) === participantId ? count : s.repaid_installments_count || 0})));
      return [{ purchase_id: p.id, expected_version: p.repayment_version || 0, previous_count: previous, count }];
    }).sort((a, b) => a.purchase_id.localeCompare(b.purchase_id));
}

export function applyMonthlyRepayments(workspaceId: string, month: string, participantId: string, purchases: Purchase[], installments: Installment[], expected: MonthlyRepaymentChange[]): Purchase[] {
  const plan = monthlyRepaymentPlan(workspaceId, month, participantId, purchases, installments);
  if (JSON.stringify(plan) !== JSON.stringify(expected)) throw new Error('As compras ou os repasses foram alterados. Atualize os dados e confira a prévia.');
  return purchases.map(p => {
    const change = plan.find(c => c.purchase_id === p.id);
    if (!change) return p;
    const counts = (p.splits || []).filter(s => (s.person_id || s.member_id) !== (p.paid_by_person_id || p.paid_by_member_id)).map(s => ({ participant_id: (s.person_id || s.member_id)!, count: (s.person_id || s.member_id) === participantId ? change.count : s.repaid_installments_count || 0 }));
    return { ...withPurchaseRepayments(p, installments, counts), repayment_version: change.expected_version + 1 };
  });
}
