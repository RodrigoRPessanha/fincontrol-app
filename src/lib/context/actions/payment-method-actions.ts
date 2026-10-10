import { PaymentMethod } from '../../types';
import { FinanceActionDeps } from './types';
import { paymentMethodHasReferences } from '../../payment-methods';

export function updatePaymentMethod(deps: FinanceActionDeps, id: string, data: Partial<Pick<PaymentMethod, 'name' | 'type' | 'active'>>): PaymentMethod {
  const state = deps.getState();
  const method = state.allPaymentMethods.find((pm) => pm.id === id && pm.workspace_id === state.activeWorkspaceId);
  if (!method) throw new Error('Método de pagamento não encontrado no workspace ativo.');
  if (data.name !== undefined && !data.name.trim()) throw new Error('Informe o nome do método de pagamento.');
  if (data.type !== undefined && data.type !== method.type &&
    (paymentMethodHasReferences(state, id) || method.credit_card_id || method.linked_account_id)) {
    throw new Error('O tipo não pode mudar enquanto houver vínculos. Crie outro método.');
  }
  const updated = { ...method, name: data.name?.trim() ?? method.name,
    type: data.type ?? method.type, active: data.active ?? method.active };
  deps.commit({ ...state, allPaymentMethods: state.allPaymentMethods.map((pm) => pm.id === id ? updated : pm) });
  return updated;
}

export function deletePaymentMethod(deps: FinanceActionDeps, id: string): void {
  const state = deps.getState();
  if (!state.allPaymentMethods.some((pm) => pm.id === id && pm.workspace_id === state.activeWorkspaceId)) {
    throw new Error('Método de pagamento não encontrado no workspace ativo.');
  }
  if (paymentMethodHasReferences(state, id)) throw new Error('Método com histórico não pode ser excluído. Desative-o para preservar os registros.');
  deps.commit({ ...state, allPaymentMethods: state.allPaymentMethods.filter((pm) => pm.id !== id) });
}

export function addPaymentMethod(
  deps: FinanceActionDeps,
  pmData: Omit<PaymentMethod, 'id' | 'workspace_id' | 'created_at'>
): PaymentMethod {
  if (!pmData.name.trim()) throw new Error('Informe o nome do método de pagamento.');
  pmData = { ...pmData, name: pmData.name.trim() };
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
