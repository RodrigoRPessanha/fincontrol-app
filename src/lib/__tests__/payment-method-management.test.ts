import { describe, expect, it } from 'vitest';
import { getInitialFinanceState } from '../context/finance-storage';
import { addPaymentMethod, updatePaymentMethod, deletePaymentMethod } from '../context/actions/payment-method-actions';
import { paymentChoices, persistedPaymentMethodId } from '../payment-methods';
import { FinanceState } from '../context/finance-state';

function fixture() {
  let state: FinanceState = { ...getInitialFinanceState(), activeWorkspaceId: 'ws', allPaymentMethods: [],
    allTransactions: [], allPurchases: [], allPayments: [], allRecurring: [], allAccounts: [], allCreditCards: [] };
  const deps = { getState: () => state, commit: (next: FinanceState) => { state = next; },
    generateId: () => 'pm', now: () => new Date('2026-01-01'), getUserId: () => 'owner' };
  return { deps, getState: () => state };
}

describe('payment method management', () => {
  it('edits unused methods, deactivates/reactivates and deletes without touching history', () => {
    const { deps, getState } = fixture();
    expect(() => addPaymentMethod(deps, { name: ' ', type: 'pix', active: true })).toThrow(/nome/);
    addPaymentMethod(deps, { name: ' Pix ', type: 'pix', active: true });
    expect(updatePaymentMethod(deps, 'pm', { name: ' Dinheiro ', type: 'cash', active: false })).toMatchObject({ name: 'Dinheiro', type: 'cash', active: false });
    expect(updatePaymentMethod(deps, 'pm', { active: true }).active).toBe(true);
    expect(() => updatePaymentMethod(deps, 'pm', { name: ' ' })).toThrow(/nome/);
    expect(() => updatePaymentMethod(deps, 'foreign', {})).toThrow(/workspace/);
    expect(() => deletePaymentMethod(deps, 'foreign')).toThrow(/workspace/);
    deletePaymentMethod(deps, 'pm');
    expect(getState().allPaymentMethods).toEqual([]);
  });

  it.each(['allTransactions', 'allPurchases', 'allPayments', 'allRecurring'] as const)('preserves methods referenced by %s, even if inactive', (key) => {
    const { deps, getState } = fixture();
    addPaymentMethod(deps, { name: 'Pix', type: 'pix', active: true });
    (getState()[key] as any[]).push({ id: 'historic', payment_method_id: 'pm', active: false });
    expect(() => deletePaymentMethod(deps, 'pm')).toThrow(/histórico/);
    expect(() => updatePaymentMethod(deps, 'pm', { type: 'cash' })).toThrow(/tipo/);
    expect(updatePaymentMethod(deps, 'pm', { name: 'Pix antigo', active: false })).toMatchObject({ name: 'Pix antigo', type: 'pix', active: false });
    expect(getState()[key][0].payment_method_id).toBe('pm');
  });

  it('locks the type of linked methods, validates workspace, and ignores identity injection', () => {
    const { deps, getState } = fixture();
    getState().allAccounts.push({ id: 'acc', workspace_id: 'ws', active: true } as any);
    addPaymentMethod(deps, { name: 'Pix', type: 'pix', active: true, linked_account_id: 'acc' });
    expect(() => updatePaymentMethod(deps, 'pm', { type: 'cash' })).toThrow(/tipo/);
    expect(updatePaymentMethod(deps, 'pm', { id: 'other', workspace_id: 'foreign' } as any)).toMatchObject({ id: 'pm', workspace_id: 'ws' });
    getState().activeWorkspaceId = 'foreign';
    expect(() => updatePaymentMethod(deps, 'pm', { name: 'Changed' })).toThrow(/workspace/);
    expect(() => deletePaymentMethod(deps, 'pm')).toThrow(/workspace/);
  });

  it('offers active cards directly, avoids linked duplicates and never persists a synthetic method ID', () => {
    const methods = [{ id: 'pix', workspace_id: 'ws', name: 'Pix', type: 'pix', active: true },
      { id: 'fixed', workspace_id: 'ws', name: 'Card method', type: 'credit_card', credit_card_id: 'card1', active: true }] as any;
    const cards = [{ id: 'card1', name: 'One', active: true }, { id: 'card2', name: 'Two', active: true }, { id: 'card3', name: 'Inactive', active: false }] as any;
    const choices = paymentChoices(methods, cards);
    expect(choices.map((choice) => choice.id)).toEqual(['pix', 'fixed', 'card:card2']);
    expect(persistedPaymentMethodId('card:card2')).toBeUndefined();
    expect(persistedPaymentMethodId('pix')).toBe('pix');
    expect(persistedPaymentMethodId('')).toBeUndefined();
  });
});
