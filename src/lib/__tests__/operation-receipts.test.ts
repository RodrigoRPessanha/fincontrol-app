import { describe, expect, it } from 'vitest';
import { findOperationReceipt } from '../context/actions/operation-receipts';

const original = [{ member_id: 'member-a', amount: 60 }, { person_id: 'person-b', amount: 60, percentage: 50 }];
const persisted = { workspace_id: 'workspace-a', operation_key: 'attempt', splits: original.map((split, i) => ({ ...split, id: `split-${i}`, workspace_id: 'workspace-a', purchase_id: 'purchase', member_id: split.member_id ?? null, person_id: split.person_id ?? null })) };

describe('financial receipt identity', () => {
  it('accepts original splits after row metadata and order have changed', () => {
    expect(findOperationReceipt([persisted], 'workspace-a', 'attempt', { splits: [...original].reverse() })).toBe(persisted);
  });
  it.each([
    [{ member_id: 'other-member', amount: 60 }, original[1]],
    [original[0], { person_id: 'other-person', amount: 60, percentage: 50 }],
    [{ member_id: 'member-a', amount: 59 }, original[1]],
    [original[0], { person_id: 'person-b', amount: 60, percentage: 49 }],
    [original[0]],
    [original[0], original[0]],
  ])('rejects a changed participant, amount, percentage or split set: %j', (...splits) => {
    expect(() => findOperationReceipt([persisted], 'workspace-a', 'attempt', { splits })).toThrow(/dados diferentes/);
  });
  it('scopes keys to the workspace and allows genuinely new intentions', () => {
    expect(findOperationReceipt([persisted], 'workspace-b', 'attempt', {})).toBeUndefined();
    expect(findOperationReceipt([persisted], 'workspace-a', 'new', {})).toBeUndefined();
    expect(findOperationReceipt([persisted], 'workspace-a', undefined, {})).toBeUndefined();
  });
  it.each([undefined, null, []])('accepts an empty individual split set: %j', (splits) => {
    const row = { workspace_id: 'workspace-a', operation_key: 'individual' };
    expect(findOperationReceipt([row], 'workspace-a', 'individual', { splits })).toBe(row);
  });
});
