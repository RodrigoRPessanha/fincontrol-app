import { CreditCard, PaymentMethod } from './types';
import type { FinanceState } from './context/finance-state';

export function paymentMethodHasReferences(state: FinanceState, id: string): boolean {
  return [state.allTransactions, state.allPurchases, state.allRecurring, state.allPayments]
    .some((items) => items.some((item) => item.payment_method_id === id));
}

// These choices identify a card directly; they are never saved as payment_methods.
export function paymentChoices(methods: PaymentMethod[], cards: CreditCard[]): PaymentMethod[] {
  const active = methods.filter((method) => method.active !== false);
  return [...active, ...cards.filter((card) => card.active !== false &&
    !active.some((method) => method.credit_card_id === card.id))
    .map((card): PaymentMethod => ({
      id: `card:${card.id}`, workspace_id: card.workspace_id,
      name: `Cartão — ${card.name}`, type: 'credit_card', credit_card_id: card.id,
      active: true, created_at: card.created_at,
    }))];
}

export function persistedPaymentMethodId(choiceId: string): string | undefined {
  return choiceId && !choiceId.startsWith('card:') ? choiceId : undefined;
}
