import { Account, CreditCard, PaymentMethod, Transaction } from '../types';

/**
 * Resolução e inferência estrita de conta bancária para transações com base no método de pagamento.
 */
export function resolveTransactionAccountId(
  paymentMethodId: string | null | undefined,
  explicitAccountId: string | null | undefined,
  paymentMethods: PaymentMethod[],
  workspaceId: string
): string | undefined {
  if (!paymentMethodId) return explicitAccountId || undefined;
  const pm = paymentMethods.find((p) => p.id === paymentMethodId && p.workspace_id === workspaceId);
  if (pm?.linked_account_id) {
    if (explicitAccountId && explicitAccountId !== pm.linked_account_id) {
      throw new Error('A conta bancária informada diverge da conta bancária vinculada a este método de pagamento.');
    }
    return pm.linked_account_id;
  }
  return explicitAccountId || undefined;
}

/**
 * Validação de invariantes de transação (proíbe receitas com cartão ou faturas e valida coerência de contas).
 */
export function validateTransactionBusinessRules(
  tx: {
    type: string;
    credit_card_id?: string | null;
    credit_card_bill_id?: string | null;
    payment_method_id?: string | null;
    account_id?: string | null;
  },
  paymentMethods: PaymentMethod[],
  workspaceId: string
): void {
  if (tx.type === 'income') {
    if (tx.credit_card_id || tx.credit_card_bill_id) {
      throw new Error('Receitas não podem ser vinculadas a cartão de crédito ou faturas.');
    }
    if (tx.payment_method_id) {
      const pm = paymentMethods.find((p) => p.id === tx.payment_method_id && p.workspace_id === workspaceId);
      if (pm && (pm.type === 'credit_card' || pm.credit_card_id)) {
        throw new Error('Receitas não podem ser vinculadas a cartão de crédito ou faturas.');
      }
    }
  }

  // Coerência estrita entre linked_account_id do método de pagamento e account_id da transação (P2 V22/V23)
  if (tx.payment_method_id && tx.account_id) {
    const pm = paymentMethods.find((p) => p.id === tx.payment_method_id && p.workspace_id === workspaceId);
    if (pm?.linked_account_id && pm.linked_account_id !== tx.account_id) {
      throw new Error('A conta bancária informada diverge da conta bancária vinculada a este método de pagamento.');
    }
  }
}

/**
 * Validação de imutabilidade de datas em transações vinculadas a fatura de cartão de crédito.
 */
export function validateBilledTransactionDateImmutability(
  tx: { credit_card_bill_id?: string | null; transaction_date: string; due_date: string },
  data: { transaction_date?: string; due_date?: string }
): void {
  if (tx.credit_card_bill_id) {
    if (
      (data.transaction_date !== undefined && data.transaction_date !== tx.transaction_date) ||
      (data.due_date !== undefined && data.due_date !== tx.due_date)
    ) {
      throw new Error(
        'Datas de transações vinculadas a faturas de cartão de crédito não podem ser alteradas diretamente.'
      );
    }
  }
}

/**
 * Validação de conta bancária ativa para transação ou atualização.
 */
export function validateTransactionAccount(
  accountId: string | null | undefined,
  accounts: Account[],
  workspaceId: string
): void {
  if (accountId) {
    const a = accounts.find((acc) => acc.id === accountId && acc.workspace_id === workspaceId);
    if (!a) throw new Error('Conta bancária informada não pertence ao workspace ativo.');
    if (a.active === false) throw new Error('A conta bancária informada está inativa.');
  }
}
