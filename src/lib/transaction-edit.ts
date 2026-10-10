import { Payment, Transaction, UpdateTransactionDTO } from './types';

export function transactionFinancialEditLocked(tx: Transaction, payments: Payment[]): boolean {
  return Boolean(tx.credit_card_id || tx.credit_card_bill_id || tx.status === 'paid' || tx.status === 'partially_paid' || tx.status === 'cancelled' ||
    (tx.paid_amount || 0) > 0 || payments.some((payment) => payment.transaction_id === tx.id));
}

export function reconcileEditedDueStatus(tx: Transaction, changes: UpdateTransactionDTO, today: string): Transaction {
  if (changes.due_date === undefined || (tx.status !== 'pending' && tx.status !== 'overdue')) return tx;
  return { ...tx, status: changes.due_date < today ? 'overdue' : 'pending' };
}

export function assertTransactionPatch(tx: Transaction, changes: UpdateTransactionDTO, payments: Payment[]) {
  if (changes.description !== undefined && !changes.description.trim()) throw new Error('Informe a descrição da transação.');
  if (transactionFinancialEditLocked(tx, payments) && ['amount', 'paid_by_member_id', 'paid_by_person_id', 'split_type', 'splits'].some((key) => key in changes)) {
    throw new Error('Valor e rateio de transações pagas ou faturadas estão protegidos. Edite apenas os dados descritivos.');
  }
}
