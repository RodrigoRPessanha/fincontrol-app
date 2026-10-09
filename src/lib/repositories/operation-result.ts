const replay = Symbol('financial-operation-replay');

export function markOperationReplay<T extends object>(value: T, recovered: boolean): T {
  return Object.assign(value, { [replay]: recovered });
}

export function isOperationReplay(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as Record<symbol, unknown>)[replay] === true;
}
