import { addDays, format, parseISO } from 'date-fns';
import { FinanceState } from '../context/finance-state';
import { CreditCardBill, Purchase, TransactionStatus } from '../types';
import { splitInstallments } from './installments';
import { fromCents, toCents } from './money';

export type PurchaseDateReadState = Pick<FinanceState, 'allInstallments' | 'allCreditCards' | 'allCreditCardBills' | 'allPayments' | 'allTransactions'>;

export interface PurchaseDateScheduleRow {
  installment_id: string; installment_number: number; old_due_date: string; due_date: string;
  old_bill_id: string | null; target_bill_id: string | null; reference_month: string | null;
  closing_date: string | null; amount: number; paid_amount: number; status: TransactionStatus;
}
export interface PurchaseDateChange {
  purchase_date: string; expected_version: number; expected_schedule: PurchaseDateScheduleRow[];
}

export function purchaseDateSchedule(state: PurchaseDateReadState, purchase: Purchase, date: string): PurchaseDateScheduleRow[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Informe uma data de compra válida.');
  const card = state.allCreditCards.find((c) => c.id === purchase.credit_card_id && c.workspace_id === purchase.workspace_id);
  if (purchase.credit_card_id && !card) throw new Error('Cartão da compra não encontrado no workspace.');
  // The creation RPC assigns purchases on the closing day to the next cycle.
  const referenceDate = card && card.closing_days_before_due == null && parseISO(date).getDate() === card.closing_day ? format(addDays(parseISO(date), 1), 'yyyy-MM-dd') : date;
  const calendar = splitInstallments(purchase.total_amount, purchase.installment_count, referenceDate, card);
  const rows = state.allInstallments.filter((i) => i.purchase_id === purchase.id).sort((a,b) => a.installment_number-b.installment_number);
  if (calendar.length !== purchase.installment_count || rows.length !== calendar.length ||
    rows.some((row,index) => row.installment_number !== index+1 || row.status === 'cancelled' || row.paid_amount < 0 || row.paid_amount > row.amount || (row.status === 'paid' && toCents(row.paid_amount) !== toCents(row.amount))) ||
    rows.reduce((sum,row) => sum+toCents(row.amount),0) !== toCents(purchase.total_amount)) throw new Error('Confira as parcelas da compra antes de corrigir a data.');
  return rows.map((row,index) => {
    const cycle = calendar[index];
    const oldBill = state.allCreditCardBills.find((b) => b.id === row.credit_card_bill_id && b.workspace_id === purchase.workspace_id && b.credit_card_id === purchase.credit_card_id);
    if ((purchase.credit_card_id && !row.credit_card_bill_id) || (row.credit_card_bill_id && !oldBill)) throw new Error('Fatura da parcela não encontrada no workspace.');
    const target = card ? state.allCreditCardBills.find((b) => b.workspace_id === purchase.workspace_id && b.credit_card_id === card.id && b.reference_month === cycle.referenceMonth) : undefined;
    return { installment_id: row.id, installment_number: row.installment_number, old_due_date: row.due_date,
      due_date: target?.due_date || cycle.dueDate, old_bill_id: row.credit_card_bill_id || null,
      target_bill_id: target?.id || null, reference_month: cycle.referenceMonth || null,
      closing_date: target?.closing_date || cycle.closingDate || null, amount: row.amount, paid_amount: row.paid_amount, status: row.status };
  });
}

export function assertPurchaseDateMove(state: PurchaseDateReadState, purchase: Purchase, plan: PurchaseDateScheduleRow[]): void {
  for (const row of plan) {
    if (!purchase.credit_card_id || row.old_bill_id === row.target_bill_id) continue;
    for (const id of [row.old_bill_id,row.target_bill_id]) {
      if (!id) continue;
      const bill = state.allCreditCardBills.find((b) => b.id === id && b.workspace_id === purchase.workspace_id)!;
      const paid = state.allPayments.some((p) => p.workspace_id === purchase.workspace_id && (p.credit_card_bill_id === id ||
        state.allInstallments.some((i) => i.id === p.installment_id && i.credit_card_bill_id === id) ||
        state.allTransactions.some((t) => t.id === p.transaction_id && t.credit_card_bill_id === id)));
      if (bill.status === 'cancelled' || paid) throw new Error('Uma fatura envolvida possui baixa registrada ou está cancelada. Não é possível mover esse histórico para outra fatura.');
    }
  }
}

export function reschedulePurchaseState(state: FinanceState, id: string, change: PurchaseDateChange, makeId: () => string, now: string): FinanceState {
  const purchase = state.allPurchases.find((p) => p.id === id && p.workspace_id === state.activeWorkspaceId);
  if (!purchase) throw new Error('Compra não encontrada no workspace ativo.');
  if ((purchase.repayment_version || 0) !== change.expected_version) throw new Error('A compra foi alterada. Atualize os dados e confira a prévia.');
  const plan = purchaseDateSchedule(state,purchase,change.purchase_date);
  if (JSON.stringify(plan) !== JSON.stringify(change.expected_schedule)) throw new Error('As parcelas ou as faturas foram alteradas. Atualize os dados e confira a prévia.');
  assertPurchaseDateMove(state,purchase,plan);
  const bills = [...state.allCreditCardBills];
  const deltas = new Map<string,{ amount: number; paid: number }>();
  const mapped = new Map<string,{ due: string; bill: string | null }>();
  const add = (bill: string,amount: number,paid: number) => {
    const old = deltas.get(bill) || { amount:0,paid:0 }; deltas.set(bill,{ amount:old.amount+amount,paid:old.paid+paid });
  };
  for (const row of plan) {
    let target = row.target_bill_id;
    if (purchase.credit_card_id && !target) {
      target = makeId();
      bills.push({ id:target,workspace_id:purchase.workspace_id,credit_card_id:purchase.credit_card_id,reference_month:row.reference_month!,
        closing_date:row.closing_date!,due_date:row.due_date,total_amount:0,paid_amount:0,status:'open',created_at:now } as CreditCardBill);
    }
    mapped.set(row.installment_id,{ due:row.due_date,bill:target });
    if (row.old_bill_id !== target) {
      if (row.old_bill_id) add(row.old_bill_id,-toCents(row.amount),-toCents(row.paid_amount));
      if (target) add(target,toCents(row.amount),toCents(row.paid_amount));
    }
  }
  const installments = state.allInstallments.map((inst) => {
    const target = mapped.get(inst.id); if (!target) return inst;
    return { ...inst,due_date:target.due,credit_card_bill_id:target.bill,
      status:inst.status === 'pending' || inst.status === 'overdue' ? (target.due < now.slice(0,10) ? 'overdue' as const : 'pending' as const) : inst.status };
  });
  for (const [id,delta] of deltas) {
    const index = bills.findIndex((b) => b.id === id);
    const bill = { ...bills[index] }; bills[index] = bill;
    const total = toCents(bill.total_amount)+delta.amount; const paid = toCents(bill.paid_amount)+delta.paid;
    if (total<0 || paid<0 || paid>total) throw new Error('A correção deixaria uma fatura com valores inconsistentes. Confira os pagamentos.');
    bill.total_amount=fromCents(total);bill.paid_amount=fromCents(paid);
    bill.status=total>0 && paid===total?'paid':paid>0?'partially_paid':bill.due_date<now.slice(0,10) && total>0?'overdue':'open';
    bill.paid_at=bill.status==='paid' ? bill.paid_at || installments.filter((i) => i.credit_card_bill_id===id && i.paid_at).map((i) => i.paid_at!).sort().at(-1) || now : null;
  }
  return { ...state,allCreditCardBills:bills,allInstallments:installments,
    allPurchases:state.allPurchases.map((p) => p.id===id?{...p,purchase_date:change.purchase_date,repayment_version:change.expected_version+1}:p) };
}
