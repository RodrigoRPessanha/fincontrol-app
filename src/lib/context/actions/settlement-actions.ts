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
    from_member_id?: string | null;
    to_member_id?: string | null;
    from_person_id?: string | null;
    to_person_id?: string | null;
    amount: number;
    settlement_date?: string;
    notes?: string;
    payment_account_id?: string;
  }
): Settlement {
  const state = deps.getState();
  const targetWsId = state.activeWorkspaceId;
  const activeWs = state.allWorkspaces.find((w) => w.id === targetWsId);
  const isExpenseTracker = activeWs?.tracking_mode === 'expense_tracker';

  const wsPeople = state.allPeople || [];

  if (data.from_member_id && data.from_person_id) {
    throw new Error('O pagador não pode ser simultaneamente membro e pessoa.');
  }
  if (data.to_member_id && data.to_person_id) {
    throw new Error('O recebedor não pode ser simultaneamente membro e pessoa.');
  }

  // Determina fromId e toId suportando tanto IDs explícitos quanto legacy from_member_id
  let effectiveFromPersonId = data.from_person_id || null;
  let effectiveFromMemberId = data.from_member_id || null;

  if (!effectiveFromPersonId && effectiveFromMemberId) {
    if (wsPeople.some((p) => p.id === effectiveFromMemberId)) {
      effectiveFromPersonId = effectiveFromMemberId;
      effectiveFromMemberId = null;
    }
  }

  let effectiveToPersonId = data.to_person_id || null;
  let effectiveToMemberId = data.to_member_id || null;

  if (!effectiveToPersonId && effectiveToMemberId) {
    if (wsPeople.some((p) => p.id === effectiveToMemberId)) {
      effectiveToPersonId = effectiveToMemberId;
      effectiveToMemberId = null;
    }
  }

  const fromId = effectiveFromPersonId || effectiveFromMemberId;
  const toId = effectiveToPersonId || effectiveToMemberId;

  if (!fromId || !toId) {
    throw new Error('Membros devedor e credor devem ser informados para o acerto.');
  }

  const { pairwiseDebts } = calculateMemberNetBalances(
    state.allTransactions,
    state.allSettlements || [],
    state.allWorkspaceMembers,
    targetWsId,
    state.allPurchases,
    state.allPeople || []
  );

  // No modo Apenas Despesas & Rateio, contas bancárias são totalmente ignoradas
  if (!isExpenseTracker && data.payment_account_id) {
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
    fromId,
    toId,
    data.amount,
    state.allWorkspaceMembers,
    targetWsId,
    pairwiseDebts,
    state.allPeople
  );

  const newSettlement: Settlement = {
    id: deps.generateId('set'),
    workspace_id: targetWsId,
    from_member_id: effectiveFromMemberId,
    to_member_id: effectiveToMemberId,
    from_person_id: effectiveFromPersonId,
    to_person_id: effectiveToPersonId,
    amount: roundCurrency(data.amount),
    settlement_date: data.settlement_date || format(deps.now(), 'yyyy-MM-dd'),
    notes: data.notes,
    payment_account_id: isExpenseTracker ? undefined : data.payment_account_id,
    created_at: deps.now().toISOString(),
  };

  deps.commit({
    ...state,
    allSettlements: [newSettlement, ...(state.allSettlements || [])],
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
