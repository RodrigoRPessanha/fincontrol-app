import { Account } from '../types';

/**
 * Validação de conta bancária para liquidação de fatura de cartão de crédito.
 * No modo sem saldo (isExpenseTrackerMode), a conta bancária é opcional.
 */
export function validateBillPaymentAccount(
  accountId: string | undefined | null,
  accounts: Account[],
  workspaceId: string,
  isExpenseTrackerMode?: boolean
): void {
  if (isExpenseTrackerMode && !accountId) {
    return;
  }
  if (!accountId) {
    throw new Error('Conta bancária não encontrada no workspace ativo.');
  }
  const acc = accounts.find((a) => a.id === accountId && a.workspace_id === workspaceId);
  if (!acc) {
    throw new Error('Conta bancária não encontrada no workspace ativo.');
  }
  if (acc.active === false) {
    throw new Error('A conta bancária selecionada para pagamento da fatura está inativa.');
  }
}

/**
 * Validação centralizada de conta bancária para liquidação de obrigações (transações e parcelas).
 * No modo sem saldo (isExpenseTrackerMode), a conta é opcional e não gera erro se omitida.
 */
export function validatePaymentAccount(
  accountId: string | undefined | null,
  accounts: Account[],
  workspaceId: string,
  isExpenseTrackerMode?: boolean
): Account | null {
  if (isExpenseTrackerMode && !accountId) {
    return null;
  }
  if (!accountId) {
    throw new Error('Conta bancária não encontrada no workspace ativo.');
  }
  const acc = accounts.find((a) => a.id === accountId && a.workspace_id === workspaceId);
  if (!acc) {
    throw new Error('Conta bancária não encontrada no workspace ativo.');
  }
  if (acc.active === false) {
    throw new Error('A conta bancária informada está inativa.');
  }
  return acc;
}
