import { format } from 'date-fns';
import { Transfer } from '../../types';
import { toCents, fromCents } from '../../financial-engine';
import { FinanceActionDeps } from './types';

export function createTransfer(
  deps: FinanceActionDeps,
  fromAccountId: string,
  toAccountId: string,
  amount: number,
  date: string = format(deps.now(), 'yyyy-MM-dd'),
  notes?: string
): Transfer {
  if (fromAccountId === toAccountId) {
    throw new Error('A conta de origem e destino devem ser diferentes.');
  }

  const transferCents = toCents(amount);
  if (!Number.isFinite(amount) || amount <= 0 || transferCents <= 0 || !Number.isSafeInteger(transferCents)) {
    throw new Error('O valor da transferência deve ser de pelo menos R$ 0,01.');
  }

  const state = deps.getState();
  const targetWsId = state.activeWorkspaceId;
  const activeWs = state.allWorkspaces.find((w) => w.id === targetWsId);
  if (activeWs?.tracking_mode === 'expense_tracker') {
    throw new Error('Transferências entre contas não são permitidas no modo Apenas Despesas.');
  }

  const fromAcc = state.allAccounts.find((a) => a.id === fromAccountId && a.workspace_id === targetWsId);
  const toAcc = state.allAccounts.find((a) => a.id === toAccountId && a.workspace_id === targetWsId);
  if (!fromAcc || !toAcc) {
    throw new Error('As contas informadas devem pertencer ao workspace ativo.');
  }
  if (fromAcc.active === false || toAcc.active === false) {
    throw new Error('A conta bancária informada está inativa.');
  }

  const finalAmount = fromCents(transferCents);

  const newTransfer: Transfer = {
    id: deps.generateId('trf'),
    workspace_id: targetWsId,
    from_account_id: fromAccountId,
    to_account_id: toAccountId,
    amount: finalAmount,
    transfer_date: date,
    notes: notes || undefined,
    created_by: 'usr-1',
    created_at: deps.now().toISOString(),
    from_account: fromAcc,
    to_account: toAcc,
  };

  const nextAccounts = state.allAccounts.map((acc) => {
    if (acc.id === fromAccountId) {
      return { ...acc, current_balance: fromCents(toCents(acc.current_balance) - transferCents) };
    }
    if (acc.id === toAccountId) {
      return { ...acc, current_balance: fromCents(toCents(acc.current_balance) + transferCents) };
    }
    return acc;
  });

  deps.commit({
    ...state,
    allTransfers: [newTransfer, ...state.allTransfers],
    allAccounts: nextAccounts,
  });

  return newTransfer;
}
