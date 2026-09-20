import { format } from 'date-fns';
import { Settlement } from '../../types';
import {
  calculateMemberNetBalances,
  validateSettlement,
  roundCurrency,
} from '../../financial-engine';
import { FinanceActionDeps } from './types';

export function recordSettlement(
  deps: FinanceActionDeps,
  data: {
    from_member_id: string;
    to_member_id: string;
    amount: number;
    settlement_date?: string;
    notes?: string;
    payment_account_id?: string;
  }
): Settlement {
  const state = deps.getState();
  const targetWsId = state.activeWorkspaceId;

  const { pairwiseDebts } = calculateMemberNetBalances(
    state.allTransactions,
    state.allSettlements,
    state.allWorkspaceMembers,
    targetWsId,
    state.allPurchases
  );

  if (data.payment_account_id) {
    const acc = state.allAccounts.find(
      (a) => a.id === data.payment_account_id && a.workspace_id === targetWsId
    );
    if (!acc) {
      throw new Error('A conta bancária informada para o acerto não pertence ao workspace ativo.');
    }
    if (acc.active === false) {
      throw new Error('A conta bancária informada para o acerto está inativa.');
    }
  }

  validateSettlement(
    data.from_member_id,
    data.to_member_id,
    data.amount,
    state.allWorkspaceMembers,
    targetWsId,
    pairwiseDebts
  );

  const newSettlement: Settlement = {
    id: deps.generateId('set'),
    workspace_id: targetWsId,
    from_member_id: data.from_member_id,
    to_member_id: data.to_member_id,
    amount: roundCurrency(data.amount),
    settlement_date: data.settlement_date || format(deps.now(), 'yyyy-MM-dd'),
    notes: data.notes,
    payment_account_id: data.payment_account_id,
    created_at: deps.now().toISOString(),
  };

  deps.commit({
    ...state,
    allSettlements: [newSettlement, ...state.allSettlements],
  });

  return newSettlement;
}

export function deleteSettlement(
  deps: FinanceActionDeps,
  id: string
): void {
  const state = deps.getState();
  const targetWsId = state.activeWorkspaceId;
  deps.commit({
    ...state,
    allSettlements: state.allSettlements.filter(
      (s) => !(s.id === id && s.workspace_id === targetWsId)
    ),
  });
}
