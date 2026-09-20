import { PaymentMethod } from '../../types';
import { FinanceActionDeps } from './types';

export function addPaymentMethod(
  deps: FinanceActionDeps,
  pmData: Omit<PaymentMethod, 'id' | 'workspace_id' | 'created_at'>
): PaymentMethod {
  const state = deps.getState();
  const targetWsId = state.activeWorkspaceId;
  if (pmData.linked_account_id) {
    const acc = state.allAccounts.find(
      (a) => a.id === pmData.linked_account_id && a.workspace_id === targetWsId
    );
    if (!acc) throw new Error('Conta vinculada ao método de pagamento não pertence ao workspace ativo.');
    if (acc.active === false) throw new Error('A conta bancária vinculada ao método de pagamento está inativa.');
  }
  const newPm: PaymentMethod = {
    ...pmData,
    id: deps.generateId('pm'),
    workspace_id: targetWsId,
    created_at: deps.now().toISOString(),
  };

  deps.commit({
    ...state,
    allPaymentMethods: [...state.allPaymentMethods, newPm],
  });

  return newPm;
}
