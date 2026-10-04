import { TransactionSplit } from '../../types';

function comparableField(field: string, value: unknown): string | undefined {
  if (field === 'splits' && (value == null || Array.isArray(value))) {
    // Only the financial identity belongs to an intention, never generated row metadata.
    const splits = ((value ?? []) as TransactionSplit[]).map((split) => ({
      member_id: split.member_id ?? null,
      person_id: split.person_id ?? null,
      amount: split.amount,
      percentage: split.percentage ?? null,
    }));
    splits.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return JSON.stringify(splits);
  }
  return JSON.stringify(value ?? null);
}

/** Returns a prior result for the same attempt, without another optimistic financial effect. */
export function findOperationReceipt<T extends { workspace_id: string; operation_key?: string }>(
  rows: T[], workspaceId: string, key: string | undefined, expected: Record<string, unknown>
): T | undefined {
  if (!key) return undefined;
  const row = rows.find((item) => item.workspace_id === workspaceId && item.operation_key === key);
  if (row) {
    for (const [field, value] of Object.entries(expected)) {
      if (value !== undefined && comparableField(field, (row as Record<string, unknown>)[field]) !== comparableField(field, value)) {
        throw new Error('Tentativa reutilizada com dados diferentes.');
      }
    }
  }
  return row;
}
