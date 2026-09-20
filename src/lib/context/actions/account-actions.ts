import { Account } from '../../types';
import { FinanceActionDeps } from './types';

export function addAccount(
  deps: FinanceActionDeps,
  accountData: Omit<Account, 'id' | 'workspace_id' | 'created_at'>
): Account {
  const state = deps.getState();
  const targetWsId = state.activeWorkspaceId;
  const newAcc: Account = {
    ...accountData,
    id: deps.generateId('acc'),
    workspace_id: targetWsId,
    current_balance: accountData.initial_balance || 0,
    active: accountData.active !== undefined ? accountData.active : true,
    created_at: deps.now().toISOString(),
  };

  deps.commit({
    ...state,
    allAccounts: [...state.allAccounts, newAcc],
  });

  return newAcc;
}

export function updateAccount(
  deps: FinanceActionDeps,
  id: string,
  data: Omit<Partial<Account>, 'id' | 'workspace_id' | 'created_at'>
): void {
  const state = deps.getState();
  const targetWsId = state.activeWorkspaceId;
  deps.commit({
    ...state,
    allAccounts: state.allAccounts.map((a) =>
      a.id === id && a.workspace_id === targetWsId
        ? { ...a, ...data, id: a.id, workspace_id: a.workspace_id, created_at: a.created_at }
        : a
    ),
  });
}

export function deleteAccount(
  deps: FinanceActionDeps,
  id: string
): { success: boolean; action: 'deleted' | 'inactivated'; message: string } {
  const state = deps.getState();
  const targetWsId = state.activeWorkspaceId;
  const targetAcc = state.allAccounts.find((a) => a.id === id && a.workspace_id === targetWsId);
  if (!targetAcc) {
    return {
      success: false,
      action: 'deleted',
      message: 'Conta bancária não encontrada no workspace ativo.',
    };
  }

  const hasPayments = state.allPayments.some((p) => p.account_id === id);
  const hasTransfers = state.allTransfers.some((tr) => tr.from_account_id === id || tr.to_account_id === id);
  const hasActiveTxs = state.allTransactions.some((t) => t.account_id === id && (t.status === 'paid' || t.credit_card_bill_id));
  const hasPurchases = state.allPurchases.some((p) => p.account_id === id);

  if (hasPayments || hasTransfers || hasActiveTxs || hasPurchases) {
    // Soft-delete / inativação segura para manter integridade de pagamentos, transferências e compras
    deps.commit({
      ...state,
      allAccounts: state.allAccounts.map((acc) =>
        acc.id === id ? { ...acc, active: false } : acc
      ),
    });
    return {
      success: true,
      action: 'inactivated',
      message: 'A conta possui histórico financeiro (pagamentos/transferências/compras) e foi inativada para preservar os registros contábeis.',
    };
  }

  // Sem histórico financeiro restritivo: exclusão física com desvinculação limpa (SET NULL)
  deps.commit({
    ...state,
    allTransactions: state.allTransactions.map((t) =>
      t.account_id === id ? { ...t, account_id: undefined } : t
    ),
    allPurchases: state.allPurchases.map((pur) =>
      pur.account_id === id ? { ...pur, account_id: undefined } : pur
    ),
    allRecurring: state.allRecurring.map((r) =>
      r.account_id === id ? { ...r, account_id: undefined } : r
    ),
    allPaymentMethods: state.allPaymentMethods.map((pm) =>
      pm.linked_account_id === id ? { ...pm, linked_account_id: undefined } : pm
    ),
    allCreditCards: state.allCreditCards.map((c) =>
      c.linked_payment_account_id === id ? { ...c, linked_payment_account_id: undefined } : c
    ),
    allAccounts: state.allAccounts.filter((a) => a.id !== id),
  });

  return {
    success: true,
    action: 'deleted',
    message: 'Conta bancária excluída com sucesso.',
  };
}
