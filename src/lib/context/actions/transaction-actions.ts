import { findOperationReceipt } from './operation-receipts';
import { format } from 'date-fns';
import {
  Transaction,
  Payment,
  UpdateTransactionDTO,
  SplitType,
  TransactionSplit,
} from '../../types';
import {
  toCents,
  fromCents,
  resolveTransactionAccountId,
  validateTransactionBusinessRules,
  validateBilledTransactionDateImmutability,
  calculateCardBillDates,
  reconcileBillAfterItemDeletion,
  calculateExpenseSplits,
  normalizeMoney,
  resolveOrCreateCreditCardBill,
} from '../../financial-engine';
import {
  validateActiveCategory,
  resolveAndValidateCreditCard,
  validateTransactionSplits,
} from './action-helpers';
import { FinanceActionDeps } from './types';

export function addTransaction(
  deps: FinanceActionDeps,
  txData: Omit<Transaction, 'id' | 'workspace_id' | 'created_at'>
): Transaction {
  txData = { ...txData, amount: normalizeMoney(txData.amount, 'Valor da transação') };
  const state = deps.getState();
  const targetWsId = state.activeWorkspaceId;
  const receipt = findOperationReceipt(state.allTransactions, targetWsId, txData.operation_key, txData);
  if (receipt) return receipt;

  const effectiveAccountId = resolveTransactionAccountId(
    txData.payment_method_id,
    txData.account_id,
    state.allPaymentMethods,
    targetWsId
  );

  validateTransactionBusinessRules(
    { ...txData, account_id: effectiveAccountId },
    state.allPaymentMethods,
    targetWsId
  );
  validateTransactionSplits(
    deps,
    txData.amount,
    targetWsId,
    txData.paid_by_member_id,
    txData.splits,
    txData.split_type,
    txData.paid_by_person_id
  );

  if (effectiveAccountId) {
    const a = state.allAccounts.find((acc) => acc.id === effectiveAccountId && acc.workspace_id === targetWsId);
    if (!a) throw new Error('Conta bancária informada não pertence ao workspace ativo.');
    if (a.active === false) throw new Error('A conta bancária informada está inativa.');
  }

  const explicitBill = txData.credit_card_bill_id
    ? state.allCreditCardBills.find((b) => b.id === txData.credit_card_bill_id && b.workspace_id === targetWsId)
    : undefined;
  if (txData.credit_card_bill_id && !explicitBill) throw new Error('Fatura não encontrada no workspace ativo.');
  const cardId = resolveAndValidateCreditCard(deps, targetWsId, txData.payment_method_id, txData.credit_card_id || explicitBill?.credit_card_id);
  if (txData.type === 'income' && cardId) {
    throw new Error('Receitas não podem ser vinculadas a cartão de crédito ou faturas.');
  }
  validateActiveCategory(deps, targetWsId, txData.category_id);

  let billId: string | null = txData.credit_card_bill_id || null;
  let nextBills = state.allCreditCardBills;
  let dueDate = txData.due_date;

  if (cardId) {
    if (txData.status === 'paid') throw new Error('Despesas de cartão devem ser pagas pela fatura.');
    const card = state.allCreditCards.find((c) => c.id === cardId && c.workspace_id === targetWsId)!;
    const billDates = calculateCardBillDates(
      txData.transaction_date,
      card.closing_day,
      card.due_day
    );
    if (explicitBill && (explicitBill.credit_card_id !== cardId || explicitBill.reference_month !== billDates.referenceMonth)) {
      throw new Error('Fatura informada não corresponde ao ciclo do cartão.');
    }
    const preview = resolveOrCreateCreditCardBill({
      bills: state.allCreditCardBills, cardId, workspaceId: targetWsId,
      ...billDates, amount: txData.amount,
    });
    billId = preview.billId;
    nextBills = preview.updatedBills.map((b) => b.id === billId ? {
      ...b, total_amount: normalizeMoney(b.total_amount, 'Total da fatura', 'nonnegative'),
      paid_amount: normalizeMoney(b.paid_amount, 'Valor pago da fatura', 'nonnegative'),
    } : b);
    dueDate = nextBills.find((b) => b.id === billId)!.due_date;
  }

  const effectiveSplitType: SplitType = txData.split_type || 'individual';
  const effectiveSplits = effectiveSplitType !== 'individual' ? txData.splits : undefined;

  const newTx: Transaction = {
    ...txData,
    id: deps.generateId('tx'),
    workspace_id: targetWsId,
    account_id: effectiveAccountId,
    credit_card_id: cardId,
    credit_card_bill_id: billId,
    due_date: dueDate,
    split_type: effectiveSplitType,
    splits: effectiveSplits,
    paid_amount: txData.status === 'paid' ? txData.amount : (txData.paid_amount || 0),
    created_at: deps.now().toISOString(),
  };

  // Fatura, transação e possíveis pagamentos só são publicados após todas as validações.
  const currentState = deps.getState();
  const activeWs = currentState.allWorkspaces.find((w) => w.id === targetWsId);
  const isExpenseTracker = activeWs?.tracking_mode === 'expense_tracker';

  let nextAccounts = currentState.allAccounts;
  let nextPayments = currentState.allPayments;

  if (newTx.status === 'paid' && !newTx.credit_card_id) {
    const userId = deps.getUserId();
    const shouldMutateAccount = !!(newTx.account_id && !isExpenseTracker);

    if (shouldMutateAccount) {
      const currentCents = toCents(
        currentState.allAccounts.find((a) => a.id === newTx.account_id)?.current_balance || 0
      );
      const amountCents = toCents(newTx.amount);
      const diffCents = newTx.type === 'expense' ? -amountCents : amountCents;

      nextAccounts = currentState.allAccounts.map((acc) => {
        if (acc.id === newTx.account_id) {
          return { ...acc, current_balance: normalizeMoney(fromCents(currentCents + diffCents), 'Saldo resultante', 'signed') };
        }
        return acc;
      });
    }

    const newPay: Payment = {
      id: deps.generateId('pay'),
      workspace_id: targetWsId,
      transaction_id: newTx.id,
      account_id: newTx.account_id || null,
      payment_method_id: newTx.payment_method_id || undefined,
      amount: newTx.amount,
      payment_date: format(deps.now(), 'yyyy-MM-dd'),
      created_by: userId,
      created_at: deps.now().toISOString(),
      affects_balance: shouldMutateAccount,
    };
    nextPayments = [newPay, ...currentState.allPayments];
  }

  deps.commit({
    ...currentState,
    allTransactions: [newTx, ...currentState.allTransactions],
    allCreditCardBills: nextBills,
    allAccounts: nextAccounts,
    allPayments: nextPayments,
  });

  return newTx;
}

export function updateTransaction(
  deps: FinanceActionDeps,
  id: string,
  data: UpdateTransactionDTO
): void {
  if (data.amount !== undefined) data = { ...data, amount: normalizeMoney(data.amount, 'Valor da transação') };
  const state = deps.getState();
  const targetWsId = state.activeWorkspaceId;
  const existing = state.allTransactions.find((t) => t.id === id && t.workspace_id === targetWsId);
  if (!existing) return;

  validateBilledTransactionDateImmutability(existing, data);

  if (data.amount !== undefined && data.amount !== existing.amount) {
    if (existing.status === 'paid' || existing.status === 'partially_paid' || existing.credit_card_bill_id) {
      throw new Error(
        'Alterações em valores de transações já quitadas ou faturadas devem ser realizadas através de estorno ou pagamento transacional.'
      );
    }
    if (!Number.isFinite(data.amount) || data.amount <= 0) {
      throw new Error('O valor da transação deve ser maior que zero.');
    }
  }

  if (data.category_id !== undefined) {
    validateActiveCategory(deps, targetWsId, data.category_id);
  }

  const willChangeAmount = data.amount !== undefined && data.amount !== existing.amount;
  const willChangeSplitType = data.split_type !== undefined && data.split_type !== existing.split_type;
  const willChangePayer =
    (data.paid_by_member_id !== undefined && data.paid_by_member_id !== existing.paid_by_member_id) ||
    (data.paid_by_person_id !== undefined && data.paid_by_person_id !== existing.paid_by_person_id);

  const targetAmount = data.amount !== undefined ? data.amount : existing.amount;
  const targetSplitType = data.split_type !== undefined ? data.split_type : existing.split_type;
  const targetPayer = data.paid_by_member_id !== undefined ? data.paid_by_member_id : existing.paid_by_member_id;
  const targetPersonPayer = data.paid_by_person_id !== undefined ? data.paid_by_person_id : existing.paid_by_person_id;
  if (willChangePayer) {
    validateTransactionSplits(deps, targetAmount, targetWsId, targetPayer, undefined, 'individual', targetPersonPayer, existing);
  }

  let reconciledSplits: TransactionSplit[] | undefined = undefined;

  const isTargetDivided = targetSplitType && targetSplitType !== 'individual';

  if (data.splits !== undefined) {
    validateTransactionSplits(deps, targetAmount, targetWsId, targetPayer, data.splits, targetSplitType, targetPersonPayer, existing);
    reconciledSplits = data.splits;
  } else if (!isTargetDivided) {
    reconciledSplits = [];
  } else if (targetSplitType === 'equal' || targetSplitType === 'full_other') {
    const wsMembers = state.allWorkspaceMembers.filter((m) => m.workspace_id === targetWsId);
    const effectivePayer = targetPayer || wsMembers[0]?.id;
    if (willChangeAmount || willChangeSplitType || willChangePayer || !existing.splits || existing.splits.length === 0) {
      const payerId = targetPersonPayer || effectivePayer;
      const participants = existing.splits?.length ? existing.splits.map((split) => ({
        id: (split.person_id || split.member_id)!, type: split.person_id ? 'person' as const : 'member' as const,
      })) : wsMembers.map((m) => ({ id: m.id, type: 'member' as const }));
      const previousPayerId = existing.paid_by_person_id || existing.paid_by_member_id;
      if (previousPayerId && !participants.some((p) => p.id === previousPayerId)) {
        participants.push({ id: previousPayerId, type: existing.paid_by_person_id ? 'person' : 'member' });
      }
      if (!participants.some((p) => p.id === payerId)) participants.push({ id: payerId, type: targetPersonPayer ? 'person' : 'member' });
      const participantOrder = [...wsMembers.map((m) => m.id), ...(state.allPeople || []).filter((p) => p.workspace_id === targetWsId).map((p) => p.id)];
      participants.sort((a, b) => participantOrder.indexOf(a.id) - participantOrder.indexOf(b.id));
      reconciledSplits = calculateExpenseSplits(targetAmount, targetSplitType, participants, { id: payerId, type: targetPersonPayer ? 'person' : 'member' });
      validateTransactionSplits(deps, targetAmount, targetWsId, targetPayer, reconciledSplits, targetSplitType, targetPersonPayer, existing);
    } else {
      validateTransactionSplits(deps, targetAmount, targetWsId, targetPayer, existing.splits, targetSplitType, targetPersonPayer, existing);
    }
  } else if (targetSplitType === 'custom') {
    if (willChangeAmount || willChangeSplitType || willChangePayer || !existing.splits || existing.splits.length === 0) {
      throw new Error(
        'Ao alterar o valor total, pagador ou regra de uma transação com divisão personalizada, é obrigatório fornecer os novos valores de rateio correspondentes.'
      );
    }
    validateTransactionSplits(deps, targetAmount, targetWsId, targetPayer, existing.splits, targetSplitType, targetPersonPayer, existing);
  }

  const nextTxs = state.allTransactions.map((t) => {
    if (t.id === id && t.workspace_id === targetWsId) {
      return {
        ...t,
        description: data.description !== undefined ? data.description.trim() : t.description,
        amount: data.amount !== undefined ? data.amount : t.amount,
        category_id: data.category_id !== undefined ? data.category_id : t.category_id,
        due_date: data.due_date !== undefined ? data.due_date : t.due_date,
        transaction_date: data.transaction_date !== undefined ? data.transaction_date : t.transaction_date,
        notes: data.notes !== undefined ? data.notes : t.notes,
        paid_by_member_id: data.paid_by_member_id !== undefined ? data.paid_by_member_id : t.paid_by_member_id,
        paid_by_person_id: data.paid_by_person_id !== undefined ? data.paid_by_person_id : t.paid_by_person_id,
        split_type: targetSplitType,
        splits: reconciledSplits !== undefined ? (reconciledSplits.length > 0 ? reconciledSplits : undefined) : t.splits,
        updated_at: deps.now().toISOString(),
      };
    }
    return t;
  });

  deps.commit({
    ...state,
    allTransactions: nextTxs,
  });
}

export function deleteTransaction(
  deps: FinanceActionDeps,
  id: string
): void {
  const state = deps.getState();
  const targetWsId = state.activeWorkspaceId;
  const tx = state.allTransactions.find((t) => t.id === id && t.workspace_id === targetWsId);
  if (!tx) return;

  let nextBills = state.allCreditCardBills;
  if (tx.credit_card_bill_id) {
    const bill = state.allCreditCardBills.find((b) => b.id === tx.credit_card_bill_id);
    if (bill) {
      const reconciled = reconcileBillAfterItemDeletion(bill, tx.amount);
      nextBills = state.allCreditCardBills.map((b) =>
        b.id === tx.credit_card_bill_id ? reconciled : b
      );
    }
  }

  const txPayments = state.allPayments.filter((p) => p.transaction_id === id);
  const accountAdjustments = new Map<string, number>();

  let recordedPaidCents = 0;
  for (const p of txPayments) {
    const didAffectBalance = p.affects_balance !== undefined ? p.affects_balance : Boolean(p.account_id);
    if (p.account_id && didAffectBalance) {
      const pCents = toCents(p.amount);
      recordedPaidCents += pCents;
      const diff = tx.type === 'expense' ? pCents : -pCents;
      accountAdjustments.set(p.account_id, (accountAdjustments.get(p.account_id) || 0) + diff);
    }
  }

  if (txPayments.length === 0 && tx.account_id && !tx.credit_card_id && (tx.status === 'paid' || tx.status === 'partially_paid')) {
    const totalPaidCents = toCents(tx.paid_amount || (tx.status === 'paid' ? tx.amount : 0));
    const unrecordedPaidCents = Math.max(0, totalPaidCents - recordedPaidCents);
    if (unrecordedPaidCents > 0) {
      const diff = tx.type === 'expense' ? unrecordedPaidCents : -unrecordedPaidCents;
      accountAdjustments.set(tx.account_id, (accountAdjustments.get(tx.account_id) || 0) + diff);
    }
  }

  let nextAccounts = state.allAccounts;
  if (accountAdjustments.size > 0) {
    nextAccounts = state.allAccounts.map((acc) => {
      const diff = accountAdjustments.get(acc.id);
      if (diff) {
        const currentCents = toCents(acc.current_balance);
        return { ...acc, current_balance: normalizeMoney(fromCents(currentCents + diff), 'Saldo resultante', 'signed') };
      }
      return acc;
    });
  }

  deps.commit({
    ...state,
    allCreditCardBills: nextBills,
    allAccounts: nextAccounts,
    allPayments: state.allPayments.filter((p) => p.transaction_id !== id),
    allTransactions: state.allTransactions.filter((t) => t.id !== id),
  });
}

export function duplicateTransaction(
  deps: FinanceActionDeps,
  id: string
): Transaction | null {
  const state = deps.getState();
  const targetWsId = state.activeWorkspaceId;
  const tx = state.allTransactions.find((t) => t.id === id && t.workspace_id === targetWsId);
  if (!tx) return null;

  const todayStr = format(deps.now(), 'yyyy-MM-dd');
  return addTransaction(deps, {
    description: `${tx.description} (Cópia)`,
    amount: tx.amount,
    type: tx.type,
    category_id: tx.category_id,
    account_id: tx.account_id,
    payment_method_id: tx.payment_method_id,
    credit_card_id: tx.credit_card_id,
    transaction_date: todayStr,
    due_date: todayStr,
    status: 'pending',
    paid_amount: 0,
    paid_at: null,
    notes: tx.notes,
    paid_by_member_id: tx.paid_by_member_id,
    paid_by_person_id: tx.paid_by_person_id,
    split_type: tx.split_type,
    splits: tx.splits ? [...tx.splits] : undefined,
  });
}
