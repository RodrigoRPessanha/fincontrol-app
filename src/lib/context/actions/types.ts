import { FinanceState } from '../finance-state';

export interface FinanceActionDeps {
  getState(): FinanceState;
  commit(next: FinanceState): void;
  generateId(prefix: string): string;
  now(): Date;
}
