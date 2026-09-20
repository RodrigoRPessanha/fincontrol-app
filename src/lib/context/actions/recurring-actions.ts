import { format } from 'date-fns';
import { RecurringTransaction } from '../../types';
import {
  validateRecurringAmount,
  isValidCustomInterval,
  resolveTransactionAccountId,
  validateTransactionBusinessRules,
  calculateCatchUpOccurrence,
  processRecurringBatchState,
} from '../../financial-engine';
import { validateActiveCategory, resolveAndValidateCreditCard } from './action-helpers';
import { FinanceActionDeps } from './types';

export function processPendingRecurring(
  deps: FinanceActionDeps
): void {
  const state = deps.getState();
  const todayStr = format(deps.now(), 'yyyy-MM-dd');

  const result = processRecurringBatchState({
    recurring: state.allRecurring,
    transactions: state.allTransactions,
    bills: state.allCreditCardBills,
    accounts: state.allAccounts,
    paymentMethods: state.allPaymentMethods,
    creditCards: state.allCreditCards,
    categories: state.allCategories,
    todayStr,
    generateId: deps.generateId,
  });

  if (result.hasChanges) {
    deps.commit({
      ...state,
      allTransactions: result.newTransactions.length > 0
        ? [...result.newTransactions, ...state.allTransactions]
        : state.allTransactions,
      allCreditCardBills: result.updatedBills,
      allRecurring: result.updatedRecurring,
    });
  }
}

export function addRecurring(
  deps: FinanceActionDeps,
  data: Omit<RecurringTransaction, 'id' | 'workspace_id' | 'created_at'>,
  onProcessed?: () => void
): RecurringTransaction {
  validateRecurringAmount(data.amount);
  if (data.frequency === 'custom') {
    if (!isValidCustomInterval(data.interval_days)) {
      throw new Error('Intervalo em dias inválido para recorrência personalizada (deve ser número inteiro entre 1 e 3650 dias).');
    }
  }

  const state = deps.getState();
  const targetWsId = state.activeWorkspaceId;
  const effectiveAccountId = resolveTransactionAccountId(
    data.payment_method_id,
    data.account_id,
    state.allPaymentMethods,
    targetWsId
  );

  if (effectiveAccountId) {
    const a = state.allAccounts.find((acc) => acc.id === effectiveAccountId && acc.workspace_id === targetWsId);
    if (!a) throw new Error('Conta bancária informada não pertence ao workspace ativo.');
    if (a.active === false) throw new Error('A conta bancária informada está inativa.');
  }

  const effectiveCardId = resolveAndValidateCreditCard(deps, targetWsId, data.payment_method_id, data.credit_card_id);
  validateTransactionBusinessRules(
    {
      type: data.type,
      credit_card_id: effectiveCardId || data.credit_card_id,
      payment_method_id: data.payment_method_id,
      account_id: effectiveAccountId,
    },
    state.allPaymentMethods,
    targetWsId
  );
  validateActiveCategory(deps, targetWsId, data.category_id);

  const newRec: RecurringTransaction = {
    ...data,
    id: deps.generateId('rec'),
    workspace_id: targetWsId,
    account_id: effectiveAccountId,
    credit_card_id: effectiveCardId || undefined,
    active: true,
    suspended_reason: null,
    created_at: deps.now().toISOString(),
  };

  deps.commit({
    ...state,
    allRecurring: [...state.allRecurring, newRec],
  });

  if (onProcessed) {
    onProcessed();
  } else {
    processPendingRecurring(deps);
  }

  return newRec;
}

export function toggleRecurring(
  deps: FinanceActionDeps,
  id: string,
  onProcessed?: () => void
): void {
  const state = deps.getState();
  const todayStr = format(deps.now(), 'yyyy-MM-dd');
  const targetWsId = state.activeWorkspaceId;

  const updateFn = (r: RecurringTransaction) => {
    if (r.id === id && r.workspace_id === targetWsId) {
      const willBeActive = !r.active;
      let nextOcc = r.next_occurrence;
      if (willBeActive && nextOcc < todayStr) {
        nextOcc = calculateCatchUpOccurrence(nextOcc, r.start_date, r.frequency, r.interval_days, todayStr);
      }
      return {
        ...r,
        active: willBeActive,
        next_occurrence: nextOcc,
        suspended_reason: willBeActive ? null : r.suspended_reason,
      };
    }
    return r;
  };

  deps.commit({
    ...state,
    allRecurring: state.allRecurring.map(updateFn),
  });

  if (onProcessed) {
    onProcessed();
  } else {
    processPendingRecurring(deps);
  }
}

export function deleteRecurring(
  deps: FinanceActionDeps,
  id: string
): void {
  const state = deps.getState();
  const targetWsId = state.activeWorkspaceId;
  deps.commit({
    ...state,
    allRecurring: state.allRecurring.filter(
      (r) => !(r.id === id && r.workspace_id === targetWsId)
    ),
  });
}
