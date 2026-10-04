import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { setupFinanceHarness } from '../test-utils/finance-provider-harness';
import { STORAGE_KEYS, getInitialFinanceState, loadFinanceSnapshot, saveFinanceSnapshot } from '../../context/finance-storage';

describe('A3: atomic local persistence and recoverable financial receipts', () => {
  const harness = setupFinanceHarness();
  it('exposes storage access failure and blocks mutations instead of publishing fictitious success', async () => {
    let writes = 0;
    globalThis.localStorage.getItem = () => { throw new Error('SecurityError'); };
    globalThis.localStorage.setItem = () => { writes++; };
    const h = await harness.mountProvider();
    expect(h.getCtx().error?.message).toBe('SecurityError');
    expect(() => h.getCtx().addAccount({ name: 'Blocked', type: 'cash', institution: 'Fixture', initial_balance: 1000, current_balance: 1000, color: '#000000', active: true })).toThrow(/somente leitura/);
    expect(writes).toBe(0);
  });
  async function fixture() {
    harness.storageMap.set(STORAGE_KEYS.recurring, '[]');
    const h = await harness.mountProvider(); let account = '';
    await act(async () => { account = h.getCtx().addAccount({ name: 'Atomic bank', type: 'cash', institution: 'Fixture', initial_balance: 1000, current_balance: 1000, color: '#000000', active: true }).id; });
    return { ...h, account };
  }
  it('rejects quota before publishing debit and reloads the last complete snapshot', async () => {
    const h = await fixture(); const storage = globalThis.localStorage; const write = storage.setItem.bind(storage);
    const before = storage.getItem(STORAGE_KEYS.snapshot);
    storage.setItem = (key, value) => { if (key === STORAGE_KEYS.snapshot) throw new Error('QuotaExceededError'); write(key, value); };
    await act(async () => {
      expect(() => h.getCtx().addTransaction({ description: 'Atomic rejected', amount: 100, type: 'expense', status: 'paid', account_id: h.account, transaction_date: '2050-10-01', due_date: '2050-10-01' })).toThrow('QuotaExceededError');
    });
    expect(h.getCtx().error?.message).toBe('QuotaExceededError');
    expect(h.getCtx().accounts.find((a) => a.id === h.account)?.current_balance).toBe(1000);
    expect(storage.getItem(STORAGE_KEYS.snapshot)).toBe(before);
    storage.setItem = write;
    await act(async () => h.root.unmount()); const reloaded = await harness.mountProvider();
    expect(reloaded.getCtx().transactions.some((t) => t.description === 'Atomic rejected')).toBe(false);
    expect(reloaded.getCtx().accounts.find((a) => a.id === h.account)?.current_balance).toBe(1000);
  });
  it('treats legacy mirrors as non-authoritative after a successful atomic commit', async () => {
    const h = await fixture(); const storage = globalThis.localStorage; const write = storage.setItem.bind(storage);
    storage.setItem = (key, value) => { if (key === STORAGE_KEYS.transactions) throw new Error('Mirror quota'); write(key, value); };
    await act(async () => { h.getCtx().addTransaction({ description: 'Atomic accepted', amount: 100, type: 'expense', status: 'paid', account_id: h.account, transaction_date: '2050-10-01', due_date: '2050-10-01' }); });
    storage.setItem = write;
    const snapshot = loadFinanceSnapshot(storage).snapshot;
    expect(snapshot.allAccounts.find((a) => a.id === h.account)?.current_balance).toBe(900);
    const tx = snapshot.allTransactions.find((t) => t.description === 'Atomic accepted')!;
    expect(snapshot.allPayments.filter((p) => p.transaction_id === tx.id)).toHaveLength(1);
  });
  it('commits installment/bill graph only once and recovers purchase and full-payment keys after reload', async () => {
    const h = await fixture();
    const purchase = { operation_key: 'purchase-receipt', description: 'Recoverable purchase', total_amount: 120, installment_count: 3, purchase_date: '2050-10-01' };
    await act(async () => { await h.getCtx().createInstallmentPurchaseAsync(purchase); await h.getCtx().createInstallmentPurchaseAsync(purchase); });
    expect(h.getCtx().purchases.filter((p) => p.operation_key === purchase.operation_key)).toHaveLength(1);
    const tx = h.getCtx().addTransaction({ description: 'Recoverable payment', amount: 100, type: 'expense', status: 'pending', transaction_date: '2050-10-01', due_date: '2050-10-01' });
    const payment = { operation_key: 'payment-receipt', transaction_id: tx.id, account_id: h.account, amount: 100, payment_date: '2050-10-01' };
    await act(async () => { await h.getCtx().recordPaymentAsync(payment); });
    await act(async () => h.root.unmount()); const reloaded = await harness.mountProvider();
    await act(async () => { await reloaded.getCtx().recordPaymentAsync(payment); await reloaded.getCtx().createInstallmentPurchaseAsync(purchase); });
    expect(reloaded.getCtx().accounts.find((a) => a.id === h.account)?.current_balance).toBe(900);
    expect(reloaded.getCtx().payments.filter((p) => p.operation_key === payment.operation_key)).toHaveLength(1);
    expect(() => reloaded.getCtx().recordPayment({ ...payment, amount: 99 })).toThrow(/dados diferentes/);
  });
  it('does not publish intermediate card bills when a purchase graph cannot be saved', async () => {
    const h = await fixture(); const storage = globalThis.localStorage; const write = storage.setItem.bind(storage);
    const before = JSON.stringify(h.getCtx().creditCardBills);
    storage.setItem = (key, value) => { if (key === STORAGE_KEYS.snapshot) throw new Error('Quota'); write(key, value); };
    await act(async () => { expect(() => h.getCtx().createInstallmentPurchase({ description: 'Rejected graph', total_amount: 120, installment_count: 3, purchase_date: '2050-10-01', credit_card_id: 'card-1' })).toThrow('Quota'); });
    storage.setItem = write;
    expect(JSON.stringify(h.getCtx().creditCardBills)).toBe(before);
    expect(h.getCtx().purchases.some((p) => p.description === 'Rejected graph')).toBe(false);
  });
  it.each([null, { version: 1 }, { version: 0, state: {} }, { version: 1, state: { ...getInitialFinanceState(), activeWorkspaceId: null } }, { version: 1, state: { ...getInitialFinanceState(), allGoals: null } }, { version: 1.5, state: getInitialFinanceState() }])('rejects invalid envelopes without using partial mirrors: %j', (value) => {
    globalThis.localStorage.setItem(STORAGE_KEYS.snapshot, JSON.stringify(value));
    expect(() => loadFinanceSnapshot(globalThis.localStorage)).toThrow();
  });
  it('preserves a future atomic envelope and refuses writing it', () => {
    const state = getInitialFinanceState();
    const future = JSON.stringify({ version: 2, state });
    globalThis.localStorage.setItem(STORAGE_KEYS.snapshot, future);
    expect(loadFinanceSnapshot(globalThis.localStorage).canPersist).toBe(false);
    expect(() => saveFinanceSnapshot(globalThis.localStorage, state)).toThrow(/futura/);
    expect(globalThis.localStorage.getItem(STORAGE_KEYS.snapshot)).toBe(future);
  });
  it('recovers a bill payment key without paying again and rejects a conflicting retry', async () => {
    const h = await fixture(); let bill = '';
    await act(async () => { bill = h.getCtx().addTransaction({ description: 'Receipt bill', amount: 30, type: 'expense', status: 'pending', credit_card_id: 'card-1', transaction_date: '2050-10-01', due_date: '2050-10-01' }).credit_card_bill_id!; });
    await act(async () => { await h.getCtx().payCreditCardBillAsync(bill, h.account, 30, '2050-10-01', undefined, 'bill-key'); });
    await act(async () => { await h.getCtx().payCreditCardBillAsync(bill, h.account, undefined, '2050-10-01', undefined, 'bill-key'); });
    await act(async () => { await h.getCtx().payCreditCardBillAsync(bill, h.account, 30, '2050-10-01', undefined, 'bill-key'); });
    expect(h.getCtx().accounts.find((a) => a.id === h.account)?.current_balance).toBe(970);
    expect(() => h.getCtx().payCreditCardBill(bill, h.account, 29, '2050-10-01', undefined, 'bill-key')).toThrow(/dados diferentes/);
  });
  it('deduplicates a keyed transfer and rejects its conflicting payload without another balance effect', async () => {
    const h = await fixture();
    await act(async () => { await h.getCtx().createTransferAsync(h.account, 'acc-1', 30, '2050-10-01', undefined, 'transfer-key'); await h.getCtx().createTransferAsync(h.account, 'acc-1', 30, '2050-10-01', undefined, 'transfer-key'); });
    expect(h.getCtx().accounts.find((a) => a.id === h.account)?.current_balance).toBe(970);
    expect(() => h.getCtx().createTransfer(h.account, 'acc-1', 40, '2050-10-01', undefined, 'transfer-key')).toThrow(/dados diferentes/);
  });
  it('recovers a no-account payment in expense mode without requiring the former balance', async () => {
    const h = await fixture(); let tx = '';
    await act(async () => {
      h.getCtx().updateWorkspace(h.getCtx().activeWorkspace.id, { tracking_mode: 'expense_tracker' });
      tx = h.getCtx().addTransaction({ description: 'Tracker receipt', amount: 30, type: 'expense', status: 'pending', transaction_date: '2050-10-01', due_date: '2050-10-01' }).id;
    });
    const payment = { operation_key: 'tracker-key', transaction_id: tx, amount: 30, account_id: null, payment_date: '2050-10-01' };
    await act(async () => { await h.getCtx().recordPaymentAsync(payment); await h.getCtx().recordPaymentAsync(payment); });
    expect(h.getCtx().accounts.find((a) => a.id === h.account)?.current_balance).toBe(1000);
    expect(h.getCtx().payments.filter((p) => p.operation_key === payment.operation_key)).toHaveLength(1);
  });
  it('recovers the same settlement key without reducing debt twice', async () => {
    const h = await fixture(); let first = ''; let second = '';
    await act(async () => {
      first = h.getCtx().addPerson('Receipt Alpha').id;
      second = h.getCtx().addPerson('Receipt Beta').id;
    });
    await act(async () => {
      h.getCtx().addTransaction({ description: 'Settlement receipt debt', amount: 100, type: 'expense', status: 'pending', transaction_date: '2050-10-01', due_date: '2050-10-01', paid_by_person_id: first, split_type: 'equal', splits: [{ person_id: first, amount: 50 }, { person_id: second, amount: 50 }] });
    });
    const settlement = { operation_key: 'settlement-key', from_person_id: second, to_person_id: first, amount: 20, settlement_date: '2050-10-01' };
    await act(async () => { await h.getCtx().recordSettlementAsync(settlement); await h.getCtx().recordSettlementAsync(settlement); });
    expect(h.getCtx().settlements.filter((s) => s.operation_key === settlement.operation_key)).toHaveLength(1);
    expect(() => h.getCtx().recordSettlement({ ...settlement, amount: 21 })).toThrow(/dados diferentes/);
  });

  it.each(['expense', 'income'] as const)('recovers a paid %s transaction key immediately and after reload', async (type) => {
    const h = await fixture();
    const payload = { operation_key: 'transaction-key', description: 'Transaction receipt', amount: 30, type, status: 'paid' as const, account_id: h.account, transaction_date: '2050-10-01', due_date: '2050-10-01' };
    await act(async () => { await h.getCtx().addTransactionAsync(payload); await h.getCtx().addTransactionAsync(payload); });
    await act(async () => h.root.unmount()); const reloaded = await harness.mountProvider();
    await act(async () => { await reloaded.getCtx().addTransactionAsync(payload); });
    expect(reloaded.getCtx().transactions.filter((t) => t.operation_key === payload.operation_key)).toHaveLength(1);
    expect(reloaded.getCtx().accounts.find((a) => a.id === h.account)?.current_balance).toBe(type === 'expense' ? 970 : 1030);
    expect(() => reloaded.getCtx().addTransaction({ ...payload, amount: 31 })).toThrow(/dados diferentes/);
    await act(async () => { await reloaded.getCtx().addTransactionAsync({ ...payload, operation_key: 'new-intention' }); });
    expect(reloaded.getCtx().accounts.find((a) => a.id === h.account)?.current_balance).toBe(type === 'expense' ? 940 : 1060);
  });
});
