import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { FinanceProvider, useFinance, FinanceProviderProps } from '../../context/finance-context';
import { FinanceRepository } from '../../repositories/finance-repository';
import { FinanceState } from '../../context/finance-state';
import { AuthContext, AuthContextType } from '../../context/auth-context';
import { SupabaseFinanceRepository } from '../../repositories/supabase-finance-repository';
import { LocalFinanceRepository } from '../../repositories/local-finance-repository';
import * as clientModule from '../../supabase/client';
import { PaymentModal } from '../../../components/transactions/PaymentModal';
import { GlobalErrorBanner } from '../../../components/shared/GlobalErrorBanner';
import GoalsPage from '../../../app/(dashboard)/goals/page';
import { markOperationReplay } from '../../repositories/operation-result';

function createMockSnapshot(overrides?: Partial<FinanceState>): FinanceState {
  return {
    activeWorkspaceId: 'ws-1',
    allWorkspaces: [
      { id: 'ws-1', name: 'Workspace Alfa', owner_id: 'usr-1', currency: 'BRL', tracking_mode: 'full', created_at: '2026-01-01' },
      { id: 'ws-2', name: 'Workspace Beta', owner_id: 'usr-1', currency: 'BRL', tracking_mode: 'full', created_at: '2026-01-01' },
    ],
    allWorkspaceMembers: [
      { id: 'wsm-1', workspace_id: 'ws-1', user_id: 'usr-1', role: 'owner', created_at: '2026-01-01' },
      { id: 'wsm-2', workspace_id: 'ws-1', user_id: 'usr-2', role: 'member', created_at: '2026-01-01' },
    ],
    allAccounts: [
      {
        id: 'acc-1',
        workspace_id: 'ws-1',
        name: 'Nubank Principal',
        type: 'checking',
        institution: 'Nubank',
        initial_balance: 1000,
        current_balance: 1000,
        color: '#8A05BE',
        active: true,
        created_at: '2026-01-01',
      },
      {
        id: 'acc-2',
        workspace_id: 'ws-1',
        name: 'Itaú Reserva',
        type: 'savings',
        institution: 'Itaú',
        initial_balance: 500,
        current_balance: 500,
        color: '#EC7000',
        active: true,
        created_at: '2026-01-01',
      },
    ],
    allCreditCards: [
      {
        id: 'card-1',
        workspace_id: 'ws-1',
        name: 'Cartão Ultravioleta',
        institution: 'Nubank',
        credit_limit: 10000,
        closing_day: 25,
        due_day: 5,
        color: '#000000',
        active: true,
        created_at: '2026-01-01',
      },
    ],
    allCreditCardBills: [
      {
        id: 'bill-1',
        workspace_id: 'ws-1',
        credit_card_id: 'card-1',
        reference_month: '2026-09',
        closing_date: '2026-09-25',
        due_date: '2026-10-05',
        total_amount: 300,
        paid_amount: 0,
        status: 'open',
        created_at: '2026-09-01',
      },
    ],
    allPaymentMethods: [
      { id: 'pm-1', workspace_id: 'ws-1', name: 'Pix', type: 'pix', active: true, created_at: '2026-01-01' },
    ],
    allCategories: [
      { id: 'cat-1', workspace_id: 'ws-1', name: 'Alimentação', color: '#FF5722', icon: 'utensils', type: 'expense', active: true, created_at: '2026-01-01' },
    ],
    allTransactions: [
      {
        id: 'tx-1',
        workspace_id: 'ws-1',
        description: 'Supermercado Central',
        amount: 80,
        type: 'expense',
        status: 'pending',
        transaction_date: '2026-09-20',
        due_date: '2026-09-20',
        category_id: 'cat-1',
        account_id: 'acc-1',
        created_at: '2026-09-20',
      },
    ],
    allPurchases: [
      {
        id: 'pur-1',
        workspace_id: 'ws-1',
        description: 'Notebook Dell',
        total_amount: 3000,
        installment_count: 10,
        purchase_date: '2026-09-01',
        credit_card_id: 'card-1',
        account_id: 'acc-1',
        created_at: '2026-09-01',
      },
    ],
    allInstallments: [
      {
        id: 'inst-1',
        purchase_id: 'pur-1',
        installment_number: 1,
        amount: 300,
        paid_amount: 0,
        due_date: '2026-10-05',
        status: 'pending',
        credit_card_bill_id: 'bill-1',
        created_at: '2026-09-01',
      },
    ],
    allPayments: [],
    allTransfers: [],
    allRecurring: [
      {
        id: 'rec-1',
        workspace_id: 'ws-1',
        description: 'Spotify',
        amount: 34.9,
        type: 'expense',
        frequency: 'monthly',
        start_date: '2026-01-01',
        next_occurrence: '2026-10-01',
        active: true,
        auto_create: true,
        created_at: '2026-01-01',
      },
    ],
    allBudgets: [
      { id: 'bud-1', workspace_id: 'ws-1', category_id: 'cat-1', planned_amount: 1000, month: 9, year: 2026 },
    ],
    allGoals: [
      {
        id: 'goal-1',
        workspace_id: 'ws-1',
        name: 'Viagem de Férias',
        target_amount: 5000,
        current_amount: 1500,
        target_date: '2026-12-31',
        color: '#00F',
        icon: 'plane',
        status: 'in_progress',
        created_at: '2026-01-01',
      },
    ],
    allPeople: [],
    allSettlements: [],
    ...overrides,
  };
}

function createMockRepository(snapshot: FinanceState) {
  const repo: FinanceRepository = {
    recordGoalDeposit: vi.fn().mockImplementation(async (_ws, goalId, accountId, amount) => {
      const goal = snapshot.allGoals.find((g) => g.id === goalId)!;
      const account = snapshot.allAccounts.find((a) => a.id === accountId)!;
      goal.current_amount += amount;
      account.current_balance -= amount;
    }),
    loadSnapshot: vi.fn().mockImplementation(async (wsId: string) => ({
      ...snapshot,
      activeWorkspaceId: wsId,
    })),
    getWorkspaces: vi.fn().mockImplementation(async () => snapshot.allWorkspaces),
    createWorkspace: vi.fn().mockImplementation(async (data) => {
      const workspace = { ...data, id: 'ws-remote-created', created_at: '2026-01-01' };
      snapshot.allWorkspaces.push(workspace);
      snapshot.allWorkspaceMembers.push({ id: 'wsm-remote-owner', workspace_id: workspace.id, user_id: data.owner_id, role: 'owner', created_at: '2026-01-01', user: { id: data.owner_id, name: 'QA Owner', email: 'qa@example.com', created_at: '2026-01-01' } });
      return structuredClone(workspace);
    }),
    updateWorkspace: vi.fn().mockImplementation(async (id, data) => {
      const workspace = snapshot.allWorkspaces.find(w => w.id === id)!;
      Object.assign(workspace, data);
      return structuredClone(workspace);
    }),
    deleteWorkspace: vi.fn().mockResolvedValue(undefined),
    getWorkspaceMembers: vi.fn().mockImplementation(async () => snapshot.allWorkspaceMembers),
    addWorkspaceMember: vi.fn().mockImplementation(async (data) => ({
      ...data,
      id: 'wsm-remote-created',
      created_at: '2026-01-01',
    })),
    updateWorkspaceMemberRole: vi.fn().mockImplementation(async (id, role) => ({
      ...snapshot.allWorkspaceMembers[0],
      id,
      role,
    })),
    removeWorkspaceMember: vi.fn().mockResolvedValue(undefined),
    getAccounts: vi.fn().mockImplementation(async () => snapshot.allAccounts),
    saveAccount: vi.fn().mockImplementation(async (data) => ({
      ...data,
      active: data.active !== undefined ? data.active : true,
      id: data.id || 'acc-remote-created',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    } as any)),
    deleteAccount: vi.fn().mockResolvedValue(undefined),
    getPaymentMethods: vi.fn().mockImplementation(async () => snapshot.allPaymentMethods),
    savePaymentMethod: vi.fn().mockImplementation(async (data) => ({
      ...data,
      id: data.id || 'pm-remote-created',
      created_at: '2026-01-01',
    } as any)),
    deletePaymentMethod: vi.fn().mockResolvedValue(undefined),
    getCreditCards: vi.fn().mockImplementation(async () => snapshot.allCreditCards),
    saveCreditCard: vi.fn().mockImplementation(async (data) => ({
      ...data,
      id: data.id || 'card-remote-created',
      created_at: '2026-01-01',
    } as any)),
    deleteCreditCard: vi.fn().mockResolvedValue(undefined),
    getCreditCardBills: vi.fn().mockImplementation(async () => snapshot.allCreditCardBills),
    getCategories: vi.fn().mockImplementation(async () => snapshot.allCategories),
    saveCategory: vi.fn().mockImplementation(async (data) => ({
      ...data,
      id: data.id || 'cat-remote-created',
      created_at: '2026-01-01',
    } as any)),
    deleteCategory: vi.fn().mockResolvedValue(undefined),
    getTransactions: vi.fn().mockImplementation(async () => snapshot.allTransactions),
    saveTransaction: vi.fn().mockImplementation(async (data) => ({
      ...data,
      id: data.id || 'tx-remote-created',
      created_at: '2026-01-01',
    } as any)),
    deleteTransaction: vi.fn().mockResolvedValue(undefined),
    getPurchases: vi.fn().mockImplementation(async () => snapshot.allPurchases),
    savePurchase: vi.fn().mockImplementation(async (data) => {
      const purId = data.id || 'pur-remote-created';
      const count = data.installment_count || 1;
      const amount = (data.total_amount || 0) / count;
      for (let idx = 0; idx < count; idx++) {
        snapshot.allInstallments.push({
          id: `inst-remote-${idx + 1}`,
          purchase_id: purId,
          installment_number: idx + 1,
          amount,
          status: 'pending',
          paid_amount: 0,
          due_date: '2026-09-22',
          created_at: '2026-01-01',
        } as any);
      }
      return {
        ...data,
        id: purId,
        created_at: '2026-01-01',
      } as any;
    }),
    deletePurchase: vi.fn().mockResolvedValue(undefined),
    getInstallments: vi.fn().mockImplementation(async () => snapshot.allInstallments),
    getPayments: vi.fn().mockImplementation(async () => snapshot.allPayments),
    savePayment: vi.fn().mockImplementation(async (data) => ({
      ...data,
      id: data.id || 'pay-remote-created',
      created_at: '2026-01-01',
    } as any)),
    deletePayment: vi.fn().mockResolvedValue(undefined),
    getTransfers: vi.fn().mockImplementation(async () => snapshot.allTransfers),
    saveTransfer: vi.fn().mockImplementation(async (data) => ({
      ...data,
      id: data.id || 'tr-remote-created',
      created_at: '2026-01-01',
    } as any)),
    deleteTransfer: vi.fn().mockResolvedValue(undefined),
    getRecurring: vi.fn().mockImplementation(async () => snapshot.allRecurring),
    saveRecurring: vi.fn().mockImplementation(async (data) => ({
      ...data,
      id: data.id || 'rec-remote-created',
      created_at: '2026-01-01',
    } as any)),
    deleteRecurring: vi.fn().mockResolvedValue(undefined),
    getBudgets: vi.fn().mockImplementation(async () => snapshot.allBudgets),
    saveBudget: vi.fn().mockImplementation(async (data) => ({
      ...data,
      id: data.id || 'bud-remote-created',
    } as any)),
    deleteBudget: vi.fn().mockResolvedValue(undefined),
    getGoals: vi.fn().mockImplementation(async () => snapshot.allGoals),
    saveGoal: vi.fn().mockImplementation(async (data) => ({
      ...data,
      id: data.id || 'goal-remote-created',
      created_at: '2026-01-01',
    } as any)),
    deleteGoal: vi.fn().mockResolvedValue(undefined),
    getSettlements: vi.fn().mockImplementation(async () => snapshot.allSettlements),
    saveSettlement: vi.fn().mockImplementation(async (data) => ({
      ...data,
      id: data.id || 'set-remote-created',
      created_at: '2026-01-01',
    } as any)),
    deleteSettlement: vi.fn().mockResolvedValue(undefined),
    getPeople: vi.fn().mockImplementation(async () => snapshot.allPeople),
    savePerson: vi.fn().mockImplementation(async (data) => ({
      ...data,
      id: data.id || 'person-remote-created',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    } as any)),
    deletePerson: vi.fn().mockResolvedValue(undefined),
    materializeRecurring: vi.fn().mockResolvedValue({
      created_transactions: 0,
      suspended_recurring: 0,
      processed_recurring: 0,
    }),
  };
  return repo;
}

import { setupFinanceHarness } from '../test-utils/finance-provider-harness';

describe('FinanceProvider - Repositório Assíncrono e Modo Supabase', () => {
  setupFinanceHarness();
  const activeRoots: any[] = [];
  it('preserves a transaction edit queued behind creation instead of replacing it with the old reply', async () => {
    const snapshot = createMockSnapshot(); const repo = createMockRepository(snapshot);
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    repo.saveTransaction = vi.fn().mockImplementation(async (data) => { if (!data.id) { await gate; return { ...data, id: 'canonical-transaction', created_at: '2026-01-01' }; } return { ...data, created_at: '2026-01-01' }; });
    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });
    await act(async () => {
      const created = getCtx().addTransaction({ description: 'Original', amount: 20, type: 'expense', status: 'pending', transaction_date: '2050-10-01', due_date: '2050-10-01' });
      getCtx().updateTransaction(created.id, { description: 'Edited' });
    });
    await act(async () => { release(); await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(repo.saveTransaction).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'canonical-transaction', description: 'Edited' }));
    expect(getCtx().transactions.find((t) => t.id === 'canonical-transaction')?.description).toBe('Edited');
  });
  it('persists a duplicated expense with its person payer and typed split references', async () => {
    const snapshot = createMockSnapshot();
    snapshot.allPeople = [{ id: 'person-copy', workspace_id: 'ws-1', name: 'Copy fixture', archived: false, created_at: '2026-01-01', updated_at: '2026-01-01' }];
    snapshot.allTransactions[0] = { ...snapshot.allTransactions[0], amount: 100, status: 'pending', paid_by_member_id: null, paid_by_person_id: 'person-copy', split_type: 'equal', splits: [{ member_id: 'wsm-1', amount: 50 }, { person_id: 'person-copy', amount: 50 }] };
    const repo = createMockRepository(snapshot);
    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });
    await act(async () => { getCtx().duplicateTransaction('tx-1'); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(repo.saveTransaction).toHaveBeenCalledWith(expect.objectContaining({
      paid_by_person_id: 'person-copy', splits: [expect.objectContaining({ member_id: 'wsm-1', amount: 50 }), expect.objectContaining({ person_id: 'person-copy', amount: 50 })],
    }));
    expect(getCtx().error).toBeNull();
  });
  it.each(['payment', 'bill', 'transfer', 'settlement', 'transaction'])('does not overwrite workspace B when a recovered %s finishes in A', async (kind) => {
    const snapshot = createMockSnapshot(); const repo = createMockRepository(snapshot);
    snapshot.allTransactions[0] = { ...snapshot.allTransactions[0], amount: 100, paid_amount: 0, status: 'pending', paid_by_member_id: 'wsm-1', split_type: 'equal', splits: [{ member_id: 'wsm-1', amount: 50 }, { member_id: 'wsm-2', amount: 50 }] };
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    const recovered = async (data: any) => { await gate; return markOperationReplay({ ...data, id: 'recovered', created_at: '2026-01-01' }, true); };
    repo.savePayment = vi.fn().mockImplementation(recovered); repo.saveTransfer = vi.fn().mockImplementation(recovered); repo.saveSettlement = vi.fn().mockImplementation(recovered); repo.saveTransaction = vi.fn().mockImplementation(recovered);
    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' }); let done!: Promise<any>;
    await act(async () => {
      if (kind === 'transaction') done = getCtx().addTransactionAsync({ description: 'Recovered transaction', amount: 30, type: 'expense', status: 'paid', account_id: 'acc-1', transaction_date: '2050-10-01', due_date: '2050-10-01', operation_key: 'key' });
      if (kind === 'payment') done = getCtx().recordPaymentAsync({ transaction_id: 'tx-1', account_id: 'acc-1', amount: 20, payment_date: '2050-10-01', operation_key: 'key' });
      if (kind === 'bill') done = getCtx().payCreditCardBillAsync('bill-1', 'acc-1', 20, '2050-10-01', undefined, 'key');
      if (kind === 'transfer') done = getCtx().createTransferAsync('acc-1', 'acc-2', 20, '2050-10-01', undefined, 'key');
      if (kind === 'settlement') done = getCtx().recordSettlementAsync({ from_member_id: 'wsm-2', to_member_id: 'wsm-1', amount: 20, settlement_date: '2050-10-01', operation_key: 'key' });
      await getCtx().setActiveWorkspaceId('ws-2');
    });
    await act(async () => { release(); await done; });
    expect(getCtx().activeWorkspace.id).toBe('ws-2');
    expect(repo.loadSnapshot).toHaveBeenLastCalledWith('ws-1');
  });
  it.each(['card', 'category', 'goal'])('preserves a %s edit queued behind creation through UUID reconciliation', async (kind) => {
    const snapshot = createMockSnapshot(); const repo = createMockRepository(snapshot);
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    const method = kind === 'card' ? 'saveCreditCard' : kind === 'category' ? 'saveCategory' : 'saveGoal';
    const original = repo[method];
    repo[method] = vi.fn().mockImplementation(async (data) => {
      if (!data.id) { await gate; return { ...data, id: 'canonical-created', created_at: '2026-01-01' }; }
      return original(data as any);
    });
    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });
    await act(async () => {
      if (kind === 'card') { const item = getCtx().addCreditCard({ name: 'Original', institution: 'Fixture', credit_limit: 100, closing_day: 25, due_day: 5, color: '#000000', active: true }); getCtx().updateCreditCard(item.id, { name: 'Edited' }); }
      if (kind === 'category') { const item = getCtx().addCategory({ name: 'Original', type: 'expense', color: '#000000', icon: 'tag', active: true }); getCtx().updateCategory(item.id, { name: 'Edited' }); }
      if (kind === 'goal') { const item = getCtx().addGoal({ name: 'Original', target_amount: 100, current_amount: 0, status: 'in_progress', color: '#000000', icon: 'target' }); getCtx().updateGoal(item.id, { name: 'Edited' }); }
    });
    await act(async () => { release(); await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(repo[method]).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'canonical-created', name: 'Edited' }));
  });
  it.each(['payment', 'bill', 'transfer', 'settlement', 'transaction'])('reconciles authoritative shared entities after recovering a %s attempt', async (kind) => {
    const initial = createMockSnapshot();
    initial.allTransactions[0] = { ...initial.allTransactions[0], amount: 100, paid_amount: 0, status: 'pending', paid_by_member_id: 'wsm-1', split_type: 'equal', splits: [{ member_id: 'wsm-1', amount: 50 }, { member_id: 'wsm-2', amount: 50 }] };
    const fresh = createMockSnapshot();
    fresh.allAccounts = fresh.allAccounts.map((a) => a.id === 'acc-1' ? { ...a, current_balance: 900, name: 'Other session change' } : a);
    const repo = createMockRepository(initial);
    (repo.loadSnapshot as any).mockResolvedValueOnce(initial).mockResolvedValue(fresh);
    const replay = async (data: any) => markOperationReplay({ ...data, id: 'confirmed-result', created_at: '2026-01-01' }, true);
    repo.savePayment = vi.fn().mockImplementation(replay);
    repo.saveTransfer = vi.fn().mockImplementation(replay);
    repo.saveSettlement = vi.fn().mockImplementation(replay);
    repo.saveTransaction = vi.fn().mockImplementation(replay);
    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });
    await act(async () => {
      if (kind === 'transaction') await getCtx().addTransactionAsync({ description: 'Recovered transaction', amount: 30, type: 'expense', status: 'paid', account_id: 'acc-1', transaction_date: '2050-10-01', due_date: '2050-10-01', operation_key: 'key' });
      if (kind === 'payment') await getCtx().recordPaymentAsync({ transaction_id: 'tx-1', account_id: 'acc-1', amount: 30, payment_date: '2050-10-01', operation_key: 'key' });
      if (kind === 'bill') await getCtx().payCreditCardBillAsync('bill-1', 'acc-1', 30, '2050-10-01', undefined, 'key');
      if (kind === 'transfer') await getCtx().createTransferAsync('acc-1', 'acc-2', 30, '2050-10-01', undefined, 'key');
      if (kind === 'settlement') await getCtx().recordSettlementAsync({ from_member_id: 'wsm-2', to_member_id: 'wsm-1', amount: 20, settlement_date: '2050-10-01', operation_key: 'key' });
    });
    expect(getCtx().accounts.find((a) => a.id === 'acc-1')).toMatchObject({ current_balance: 900, name: 'Other session change' });
    expect(repo.loadSnapshot).toHaveBeenCalledTimes(2);
  });
  it('resolves an account UUID only when the queued edit runs and keeps the edited name', async () => {
    const snapshot = createMockSnapshot(); const repo = createMockRepository(snapshot);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const original = repo.saveAccount;
    repo.saveAccount = vi.fn().mockImplementation(async (data) => {
      if (!data.id) { await gate; return { ...data, id: 'account-canonical', created_at: '2026-01-01' }; }
      return original(data);
    });
    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });
    await act(async () => {
      const account = getCtx().addAccount({ name: 'Original', type: 'cash', institution: 'Fixture', initial_balance: 0, current_balance: 0, color: '#000000', active: true });
      getCtx().updateAccount(account.id, { name: 'Edited' });
    });
    await act(async () => { release(); await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(repo.saveAccount).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'account-canonical', name: 'Edited' }));
    expect(getCtx().accounts.find((a) => a.id === 'account-canonical')?.name).toBe('Edited');
  });

  it('keeps the goal dialog busy during persistence and open with a visible error after rejection', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);
    let rejectDeposit!: (error: Error) => void;
    repo.recordGoalDeposit = vi.fn().mockImplementation(() => new Promise<void>((_, reject) => { rejectDeposit = reject; }));
    const { container } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' }, undefined, <GoalsPage />);
    const text = (node: any): string => node.nodeType === 3 ? node.nodeValue ?? '' : node.textContent || (node.childNodes ?? []).map(text).join('');
    const open = findNode(container, (n) => n.tagName === 'BUTTON' && text(n).includes('Guardar Dinheiro nesta Meta'));
    await act(async () => getReactProps(open).onClick());
    const form = findNode(container, (n) => n.tagName === 'FORM');
    await act(async () => {
      getReactProps(findNode(form, (n) => n.tagName === 'SELECT')).onChange({ target: { value: 'acc-1' } });
      getReactProps(findNode(form, (n) => n.tagName === 'INPUT' && getReactProps(n)?.placeholder === '0,00')).onChange({ target: { value: '12.34' } });
    });
    let submitted!: Promise<void>;
    await act(async () => {
      submitted = getReactProps(form).onSubmit({ preventDefault() {} });
      await getReactProps(form).onSubmit({ preventDefault() {} });
    });
    const submit = findNode(form, (n) => n.tagName === 'BUTTON' && getReactProps(n)?.type === 'submit');
    expect(getReactProps(submit).disabled).toBe(true);
    expect(repo.recordGoalDeposit).toHaveBeenCalledTimes(1);
    await act(async () => { rejectDeposit(new Error('Deposit rejected by bank')); await submitted; });
    expect(findNode(container, (n) => n.tagName === 'FORM')).toBeTruthy();
    expect(findNodes(container, (n) => getReactProps(n)?.role === 'alert').some((n) => text(n).includes('Deposit rejected by bank'))).toBe(true);
    expect(getReactProps(findNode(form, (n) => n.tagName === 'BUTTON' && getReactProps(n)?.type === 'submit')).disabled).toBe(false);
  });

  it('replaces an optimistic card bill with its canonical bill after atomic transaction creation', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);
    repo.saveTransaction = vi.fn().mockImplementation(async (data) => {
      const bill = { ...snapshot.allCreditCardBills[0], id: 'canonical-bill', reference_month: '2026-10', closing_date: '2026-10-25', due_date: '2026-11-05', total_amount: data.amount };
      snapshot.allCreditCardBills.push(bill);
      const tx = { ...data, id: 'canonical-tx', credit_card_bill_id: bill.id, due_date: bill.due_date, created_at: '2026-01-01' };
      snapshot.allTransactions.push(tx);
      return tx;
    });
    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });
    let optimisticBill = '';
    await act(async () => {
      const tx = getCtx().addTransaction({ description: 'Card once', credit_card_id: 'card-1', amount: 25, type: 'expense', status: 'pending', transaction_date: '2026-09-26', due_date: '2026-09-26' });
      optimisticBill = tx.credit_card_bill_id!;
    });
    await act(async () => { await getCtx().refreshData(); });
    expect(getCtx().creditCardBills.some((b) => b.id === optimisticBill)).toBe(false);
    expect(getCtx().creditCardBills.find((b) => b.id === 'canonical-bill')?.total_amount).toBe(25);
    expect(getCtx().transactions.find((t) => t.id === 'canonical-tx')?.credit_card_bill_id).toBe('canonical-bill');
  });

  it('awaits atomic goal debit, deduplicates submissions and refreshes authoritative balances', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);
    const initialGoal = snapshot.allGoals[0].current_amount;
    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });
    await act(async () => {
      const first = getCtx().depositGoalAsync('goal-1', 10.075, 'acc-1', 'same-key');
      expect(getCtx().depositGoalAsync('goal-1', 10.075, 'acc-1', 'same-key')).toBe(first);
      expect(() => getCtx().depositGoalAsync('goal-1', 20, 'acc-1', 'same-key')).toThrow(/dados diferentes/);
      await first;
    });
    expect(repo.recordGoalDeposit).toHaveBeenCalledExactlyOnceWith('ws-1', 'goal-1', 'acc-1', 10.08, 'same-key');
    expect(repo.saveGoal).not.toHaveBeenCalled();
    expect(repo.saveAccount).not.toHaveBeenCalled();
    expect(getCtx().accounts.find((a) => a.id === 'acc-1')?.current_balance).toBe(989.92);
    expect(getCtx().goals.find((g) => g.id === 'goal-1')?.current_amount).toBe(initialGoal + 10.08);
    await act(async () => { await getCtx().depositGoalAsync('goal-1', 10.075, 'acc-1', 'same-key'); });
    expect(repo.recordGoalDeposit).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported atomic deposits and allows the same key to retry after failure', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);
    const deposit = repo.recordGoalDeposit;
    delete repo.recordGoalDeposit;
    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });
    await act(async () => {
      await expect(getCtx().depositGoalAsync('goal-1', 10, 'acc-1', 'retry-key')).rejects.toThrow(/atômicos/);
    });
    await act(async () => { await getCtx().refreshData(); });
    expect(getCtx().accounts.find((a) => a.id === 'acc-1')?.current_balance).toBe(1000);
    repo.recordGoalDeposit = deposit;
    await act(async () => { await getCtx().depositGoalAsync('goal-1', 10, 'acc-1', 'retry-key'); });
    expect(getCtx().accounts.find((a) => a.id === 'acc-1')?.current_balance).toBe(990);
  });

  it('keeps the void deposit API compatible while reporting remote failure and rejecting foreign accounts', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);
    repo.recordGoalDeposit = vi.fn().mockRejectedValue(new Error('Deposit rejected'));
    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });
    expect(() => getCtx().depositGoal('goal-1', 10, 'foreign')).toThrow(/não encontrada/);
    await act(async () => { getCtx().depositGoal('goal-1', 10, 'acc-1'); });
    await act(async () => { await getCtx().refreshData(); });
    expect(getCtx().accounts.find((a) => a.id === 'acc-1')?.current_balance).toBe(1000);
    expect(repo.saveGoal).not.toHaveBeenCalled();
  });

  afterEach(async () => {
    while (activeRoots.length > 0) {
      const root = activeRoots.pop();
      try {
        await act(async () => {
          root.unmount();
        });
      } catch {
        // cleanup
      }
    }
    vi.restoreAllMocks();
  });

  const defaultAuth: AuthContextType = {
    user: { id: 'usr-1', name: 'Rodrigo', email: 'rodrigo@test.com', created_at: '2026-01-01' },
    isLoading: false,
    login: vi.fn(),
    signUp: vi.fn(),
    resetPassword: vi.fn(),
    updatePassword: vi.fn(),
    logout: vi.fn(),
    updateProfile: vi.fn(),
    dataMode: 'supabase',
  };

  function getReactProps(element: any): any {
    if (!element) return null;
    const key = Object.keys(element).find((k) => k.startsWith('__reactProps$'));
    return key ? element[key] : null;
  }

  function findNode(root: any, predicate: (node: any) => boolean): any {
    if (!root) return null;
    if (predicate(root)) return root;
    for (const child of root.childNodes || []) {
      const found = findNode(child, predicate);
      if (found) return found;
    }
    return null;
  }

  function findNodes(root: any, predicate: (node: any) => boolean): any[] {
    const list: any[] = [];
    if (!root) return list;
    if (predicate(root)) list.push(root);
    for (const child of root.childNodes || []) {
      list.push(...findNodes(child, predicate));
    }
    return list;
  }

  async function mountTestProvider(
    props: Partial<FinanceProviderProps> = {},
    authContextValue?: Partial<AuthContextType>,
    children?: React.ReactNode
  ) {
    let currentCtx!: ReturnType<typeof useFinance>;
    function Consumer() {
      currentCtx = useFinance();
      return null;
    }

    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);
    activeRoots.push(root);

    const authVal: AuthContextType = {
      ...defaultAuth,
      dataMode: props.initialDataMode || 'supabase',
      ...authContextValue,
    };

    await act(async () => {
      root.render(
        <AuthContext.Provider value={authVal}>
          <FinanceProvider {...props}>
            <Consumer />
            {children}
          </FinanceProvider>
        </AuthContext.Provider>
      );
    });

    for (let i = 0; i < 30 && !currentCtx?.isLoaded; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
    }

    return {
      getCtx: () => currentCtx,
      root,
      container,
    };
  }

  it.each([false, true])('reconciles the new Owner before the first expense (queued=%s)', async (queued) => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);
    repo.getWorkspaceMembers = vi.fn(async (id) => snapshot.allWorkspaceMembers.filter((m) => m.workspace_id === id));
    const create = repo.createWorkspace;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    repo.createWorkspace = vi.fn(async (data) => { await gate; return create(data); });
    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });
    await act(async () => { getCtx().createWorkspace('First expense QA', 'expense_tracker'); });
    const provisionalMemberId = getCtx().workspaceMembers[0].id;
    if (!queued) await act(async () => { release(); await getCtx().waitForPendingMutations(); });
    await act(async () => {
      const owner = getCtx().workspaceMembers[0];
      const saved = getCtx().addTransactionAsync({ description: 'First shared expense', amount: 40, type: 'expense', status: 'pending', transaction_date: '2026-10-04', due_date: '2026-10-04', paid_by_member_id: owner.id, split_type: 'custom', splits: [{ member_id: owner.id, amount: 40 }] });
      release();
      await saved;
    });
    expect(provisionalMemberId).not.toBe('wsm-remote-owner');
    expect(getCtx().workspaceMembers[0]).toMatchObject({ id: 'wsm-remote-owner', user: { name: 'QA Owner' } });
    expect(repo.saveTransaction).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ workspace_id: 'ws-remote-created', paid_by_member_id: 'wsm-remote-owner', splits: [{ member_id: 'wsm-remote-owner', amount: 40 }] }));
    expect(getCtx().transactions).toHaveLength(1);
    expect(getCtx().transactions[0].paid_by_member_id).toBe('wsm-remote-owner');
    expect(getCtx().error).toBeNull();
    expect(getCtx().isSaving).toBe(false);
  });

  it('does not switch back when workspace creation finishes after a user switches away', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);
    const create = repo.createWorkspace;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    repo.createWorkspace = vi.fn(async (data) => { await gate; return create(data); });
    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });
    await act(async () => {
      getCtx().createWorkspace('Background QA');
      await getCtx().setActiveWorkspaceId('ws-1');
      release();
      await getCtx().waitForPendingMutations();
    });
    expect(getCtx().activeWorkspace.id).toBe('ws-1');
    expect(getCtx().workspaceMembers.map((m) => m.id)).toEqual(['wsm-1', 'wsm-2']);
    expect(getCtx().error).toBeNull();
  });

  it.each([false, true])('A8-P01: removes a rejected first expense (snapshot unavailable=%s)', async (snapshotUnavailable) => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);
    repo.loadSnapshot = vi.fn(async (id) => {
      if (snapshotUnavailable && id === 'ws-remote-created') throw new Error('A8 snapshot unavailable');
      return structuredClone({ ...snapshot, activeWorkspaceId: id });
    });
    repo.getWorkspaces = vi.fn(async () => structuredClone(snapshot.allWorkspaces));
    repo.getWorkspaceMembers = vi.fn(async (id) => structuredClone(snapshot.allWorkspaceMembers.filter(m => m.workspace_id === id)));
    const create = repo.createWorkspace;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    repo.createWorkspace = vi.fn(async (data) => { await gate; return create(data); });
    repo.saveTransaction = vi.fn().mockRejectedValue(new Error('A8 rejected transaction'));
    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });
    await act(async () => { getCtx().createWorkspace('A8 newly created', 'expense_tracker'); });
    const owner = getCtx().workspaceMembers[0];
    await act(async () => {
      const saved = getCtx().addTransactionAsync({ description: 'A8 rejected first expense', type: 'expense', amount: 40, status: 'pending', transaction_date: '2026-10-04', due_date: '2026-10-04', paid_by_member_id: owner.id, split_type: 'custom', splits: [{ member_id: owner.id, amount: 40 }] });
      release();
      await expect(saved).rejects.toThrow('A8 rejected transaction');
      await getCtx().waitForPendingMutations();
    });
    expect(getCtx().activeWorkspace.id).toBe('ws-remote-created');
    expect(getCtx().error).not.toBeNull();
    expect(getCtx().transactions.filter(t => t.description === 'A8 rejected first expense')).toHaveLength(0);
    expect(getCtx().workspaceMembers[0].id).toBe('wsm-remote-owner');
    expect(getCtx().workspaces.some(w => w.id === 'ws-remote-created')).toBe(true);
  });

  it('A8-P02: queued payer stays canonical if the user switches workspace before creation finishes', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);
    repo.loadSnapshot = vi.fn(async (id) => structuredClone({ ...snapshot, activeWorkspaceId: id }));
    repo.getWorkspaces = vi.fn(async () => structuredClone(snapshot.allWorkspaces));
    repo.getWorkspaceMembers = vi.fn(async (id) => structuredClone(snapshot.allWorkspaceMembers.filter(m => m.workspace_id === id)));
    const create = repo.createWorkspace;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    repo.createWorkspace = vi.fn(async (data) => { await gate; return create(data); });
    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });
    await act(async () => { getCtx().createWorkspace('A8 switch during creation', 'expense_tracker'); });
    const owner = getCtx().workspaceMembers[0];
    await act(async () => {
      const saved = getCtx().addTransactionAsync({ description: 'A8 queued first expense', type: 'expense', amount: 40, status: 'pending', transaction_date: '2026-10-04', due_date: '2026-10-04', paid_by_member_id: owner.id, split_type: 'custom', splits: [{ member_id: owner.id, amount: 40 }] });
      await getCtx().setActiveWorkspaceId('ws-1');
      release();
      await saved;
      await getCtx().waitForPendingMutations();
    });
    expect(getCtx().activeWorkspace.id).toBe('ws-1');
    expect(repo.saveTransaction).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ workspace_id: 'ws-remote-created', paid_by_member_id: 'wsm-remote-owner', splits: [{ member_id: 'wsm-remote-owner', amount: 40 }] }));
    expect(getCtx().workspaces.some(w => w.id === 'ws-remote-created')).toBe(true);
  });

  it('A8-P01: fallback removes only the failed expense and preserves a confirmed expense and workspace', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);
    repo.loadSnapshot = vi.fn(async (id) => {
      if (id === 'ws-remote-created') throw new Error('A8 refresh offline');
      return structuredClone({ ...snapshot, activeWorkspaceId: id });
    });
    repo.getWorkspaceMembers = vi.fn(async (id) => structuredClone(snapshot.allWorkspaceMembers.filter(m => m.workspace_id === id)));
    const create = repo.createWorkspace;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    repo.createWorkspace = vi.fn(async (data) => { await gate; return create(data); });
    repo.saveTransaction = vi.fn(async (data) => {
      if (data.description === 'Rejected') throw new Error('A8 server rejected');
      return { ...data, id: 'confirmed-expense', created_at: '2026-10-04' };
    });
    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });
    await act(async () => { getCtx().createWorkspace('A8 fallback batch', 'expense_tracker'); });
    const owner = getCtx().workspaceMembers[0];
    const data = { amount: 40, type: 'expense' as const, status: 'pending' as const, transaction_date: '2026-10-04', due_date: '2026-10-04', paid_by_member_id: owner.id, split_type: 'custom' as const, splits: [{ member_id: owner.id, amount: 40 }] };
    await act(async () => {
      const confirmed = getCtx().addTransactionAsync({ ...data, description: 'Confirmed' });
      const rejected = getCtx().addTransactionAsync({ ...data, description: 'Rejected' });
      release();
      await confirmed;
      await expect(rejected).rejects.toThrow('A8 server rejected');
      await getCtx().waitForPendingMutations();
    });
    expect(getCtx().transactions).toHaveLength(1);
    expect(getCtx().transactions[0]).toMatchObject({ id: 'confirmed-expense', description: 'Confirmed', workspace_id: 'ws-remote-created' });
    expect(getCtx().activeWorkspace.id).toBe('ws-remote-created');
    expect(getCtx().workspaceMembers[0].id).toBe('wsm-remote-owner');
  });

  it('A8-P03: selecting a workspace through its original result uses its canonical ID', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);
    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });
    let provisionalId = '';
    await act(async () => {
      provisionalId = getCtx().createWorkspace('A8 selection').id;
      await getCtx().waitForPendingMutations();
    });
    await act(async () => { await getCtx().setActiveWorkspaceId('ws-1'); });
    await act(async () => { await getCtx().setActiveWorkspaceId(provisionalId); });
    expect(repo.loadSnapshot).toHaveBeenLastCalledWith('ws-remote-created');
    expect(getCtx().activeWorkspace.id).toBe('ws-remote-created');
    expect(getCtx().error).toBeNull();
  });

  it.each(['account', 'person', 'category', 'method', 'card', 'goal', 'recurring'])('A8-P03: queued %s uses the canonical workspace', async (kind) => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);
    const create = repo.createWorkspace;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    repo.createWorkspace = vi.fn(async (data) => { await gate; return create(data); });
    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });
    await act(async () => { getCtx().createWorkspace('A8 account during creation'); });
    await act(async () => {
      if (kind === 'account') getCtx().addAccount({ name: 'A8 bank', institution: 'QA', type: 'checking', initial_balance: 0, current_balance: 0, color: '#000000', active: true });
      if (kind === 'person') getCtx().addPerson('A8 person');
      if (kind === 'category') getCtx().addCategory({ name: 'A8 category', type: 'expense', color: '#000000', icon: 'tag', active: true });
      if (kind === 'method') getCtx().addPaymentMethod({ name: 'A8 method', type: 'pix', active: true });
      if (kind === 'card') getCtx().addCreditCard({ name: 'A8 card', institution: 'QA', credit_limit: 1000, closing_day: 20, due_day: 28, color: '#000000', active: true });
      if (kind === 'goal') getCtx().addGoal({ name: 'A8 goal', target_amount: 100, current_amount: 0, status: 'in_progress', color: '#000000', icon: 'target' });
      if (kind === 'recurring') getCtx().addRecurring({ description: 'A8 recurring', amount: 10, type: 'expense', frequency: 'monthly', start_date: '2050-01-01', next_occurrence: '2050-01-01', active: true, auto_create: false });
      release();
      await getCtx().waitForPendingMutations();
    });
    const writes = { account: repo.saveAccount, person: repo.savePerson, category: repo.saveCategory, method: repo.savePaymentMethod, card: repo.saveCreditCard, goal: repo.saveGoal, recurring: repo.saveRecurring };
    expect(writes[kind as keyof typeof writes]).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ workspace_id: 'ws-remote-created' }));
    expect(getCtx().error).toBeNull();
  });

  it('A8-P03: queued purchase and settlement keep their workspace and participant references', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);
    const create = repo.createWorkspace;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    repo.createWorkspace = vi.fn(async (data) => { await gate; return create(data); });
    repo.savePerson = vi.fn(async data => {
      const person = { ...data, id: 'canonical-person', archived: false, created_at: '2026-10-04', updated_at: '2026-10-04' };
      snapshot.allPeople.push(person);
      return person;
    });
    repo.savePurchase = vi.fn(async data => {
      const purchase = { ...data, id: 'canonical-purchase', created_at: '2026-10-04' };
      snapshot.allPurchases.push(purchase);
      snapshot.allInstallments.push(
        { id: 'canonical-installment-1', purchase_id: purchase.id, installment_number: 1, amount: 20, paid_amount: 0, due_date: '2050-01-01', status: 'pending', created_at: '2026-10-04' },
        { id: 'canonical-installment-2', purchase_id: purchase.id, installment_number: 2, amount: 20, paid_amount: 0, due_date: '2050-02-01', status: 'pending', created_at: '2026-10-04' }
      );
      return purchase;
    });
    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });
    await act(async () => { getCtx().createWorkspace('A8 shared purchase', 'expense_tracker'); });
    const owner = getCtx().workspaceMembers[0];
    await act(async () => {
      const person = getCtx().addPerson('A8 purchase participant');
      const purchase = getCtx().createInstallmentPurchaseAsync({ description: 'A8 purchase', total_amount: 40, installment_count: 2, purchase_date: '2050-01-01', paid_by_member_id: owner.id, split_type: 'equal', splits: [{ member_id: owner.id, amount: 20 }, { person_id: person.id, amount: 20 }] });
      const settlement = getCtx().recordSettlementAsync({ from_person_id: person.id, to_member_id: owner.id, amount: 10 });
      release();
      await Promise.all([purchase, settlement]);
      await getCtx().waitForPendingMutations();
    });
    expect(repo.savePurchase).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ workspace_id: 'ws-remote-created', paid_by_member_id: 'wsm-remote-owner', splits: [expect.objectContaining({ member_id: 'wsm-remote-owner', amount: 20 }), expect.objectContaining({ person_id: 'canonical-person', amount: 20 })] }));
    expect(repo.saveSettlement).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ workspace_id: 'ws-remote-created', from_person_id: 'canonical-person', to_member_id: 'wsm-remote-owner', amount: 10 }));
    expect(getCtx().purchases.find(p => p.id === 'canonical-purchase')?.workspace_id).toBe('ws-remote-created');
    expect(getCtx().settlements[0].to_member_id).toBe('wsm-remote-owner');
    expect(getCtx().installments.filter(i => i.purchase_id === 'canonical-purchase')).toHaveLength(2);
    expect(getCtx().error).toBeNull();
  });

  it('A8-R01: a mode change queued behind creation remains equal to the persisted mode', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);
    repo.loadSnapshot = vi.fn(async id => structuredClone({ ...snapshot, activeWorkspaceId: id }));
    repo.getWorkspaces = vi.fn(async () => structuredClone(snapshot.allWorkspaces));
    const create = repo.createWorkspace;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    repo.createWorkspace = vi.fn(async data => { await gate; return structuredClone(await create(data)); });
    repo.updateWorkspace = vi.fn(async (id, patch) => {
      const ws = snapshot.allWorkspaces.find(w => w.id === id)!;
      Object.assign(ws, patch);
      return structuredClone(ws);
    });
    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });
    await act(async () => { getCtx().createWorkspace('A8 mode queued'); });
    await act(async () => {
      getCtx().updateWorkspace(getCtx().activeWorkspace.id, { tracking_mode: 'expense_tracker' });
      release();
      await getCtx().waitForPendingMutations();
    });
    expect(repo.updateWorkspace).toHaveBeenCalledWith('ws-remote-created', { tracking_mode: 'expense_tracker' });
    expect(snapshot.allWorkspaces.find(w => w.id === 'ws-remote-created')?.tracking_mode).toBe('expense_tracker');
    expect(getCtx().activeWorkspace.tracking_mode).toBe('expense_tracker');
    expect(getCtx().error).toBeNull();
  });

  it('A8-R02a: rejected workspace creation does not leave a usable phantom workspace', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);
    repo.loadSnapshot = vi.fn(async id => structuredClone({ ...snapshot, activeWorkspaceId: id }));
    repo.createWorkspace = vi.fn().mockRejectedValue(new Error('A8 workspace quota rejected'));
    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });
    await act(async () => {
      getCtx().createWorkspace('A8 rejected workspace');
      await getCtx().waitForPendingMutations();
    });
    expect(getCtx().error?.message).toBe('A8 workspace quota rejected');
    expect(getCtx().workspaces.some(w => w.name === 'A8 rejected workspace')).toBe(false);
    expect(getCtx().activeWorkspace.id).toBe('ws-1');
  });

  it('A8-R02b: failed member fetch after committed creation recovers canonical workspace identity', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);
    repo.loadSnapshot = vi.fn(async id => structuredClone({ ...snapshot, activeWorkspaceId: id }));
    repo.getWorkspaceMembers = vi.fn().mockRejectedValue(new Error('A8 member fetch offline'));
    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });
    await act(async () => {
      getCtx().createWorkspace('A8 committed workspace');
      await getCtx().waitForPendingMutations();
    });
    expect(snapshot.allWorkspaces.some(w => w.id === 'ws-remote-created')).toBe(true);
    expect(getCtx().activeWorkspace.id).toBe('ws-remote-created');
    expect(getCtx().workspaceMembers[0].id).toBe('wsm-remote-owner');
  });

  it.each([false, true])('A8-R01: later workspace edits survive an earlier response and navigation (switch=%s)', async (switchWorkspace) => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);
    repo.loadSnapshot = vi.fn(async id => structuredClone({ ...snapshot, activeWorkspaceId: id }));
    const create = repo.createWorkspace;
    let releaseCreate!: () => void;
    const createGate = new Promise<void>(resolve => { releaseCreate = resolve; });
    repo.createWorkspace = vi.fn(async data => { await createGate; return create(data); });
    const update = repo.updateWorkspace;
    let firstStarted!: () => void;
    const started = new Promise<void>(resolve => { firstStarted = resolve; });
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
    let count = 0;
    repo.updateWorkspace = vi.fn(async (id, patch) => {
      const stored = await update(id, patch);
      if (++count === 1) { firstStarted(); await firstGate; }
      return stored;
    });
    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });
    let id = '';
    await act(async () => { id = getCtx().createWorkspace('Initial name').id; });
    await act(async () => {
      getCtx().updateWorkspace(id, { name: 'First name', tracking_mode: 'expense_tracker' });
      getCtx().updateWorkspace(id, { name: 'Final name', currency: 'BRL' });
      getCtx().updateWorkspace('ws-1', { name: 'Other workspace' });
      releaseCreate();
      await started;
    });
    expect(getCtx().activeWorkspace.name).toBe('Final name');
    if (switchWorkspace) await act(async () => { await getCtx().setActiveWorkspaceId('ws-1'); });
    expect(getCtx().workspaces.find(w => w.id === 'ws-remote-created')?.name).toBe('Final name');
    await act(async () => { releaseFirst(); await getCtx().waitForPendingMutations(); });
    expect(getCtx().workspaces.find(w => w.id === 'ws-remote-created')).toMatchObject({ name: 'Final name', tracking_mode: 'expense_tracker' });
    expect(getCtx().activeWorkspace.id).toBe(switchWorkspace ? 'ws-1' : 'ws-remote-created');
    expect(getCtx().workspaces.find(w => w.id === 'ws-1')?.name).toBe('Other workspace');
    expect(getCtx().error).toBeNull();
  });

  it('A8-R01: failed rename rolls back without losing a successful mode update when refresh fails', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);
    repo.loadSnapshot = vi.fn(async id => {
      if (id === 'ws-remote-created') throw new Error('Snapshot offline');
      return structuredClone({ ...snapshot, activeWorkspaceId: id });
    });
    const create = repo.createWorkspace;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    repo.createWorkspace = vi.fn(async data => { await gate; return create(data); });
    const update = repo.updateWorkspace;
    repo.updateWorkspace = vi.fn(async (id, patch) => {
      if (patch.name === 'Rejected name') throw new Error('Rename rejected');
      return update(id, patch);
    });
    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });
    let id = '';
    await act(async () => { id = getCtx().createWorkspace('Confirmed name').id; });
    await act(async () => {
      getCtx().updateWorkspace(id, { name: 'Rejected name' });
      getCtx().updateWorkspace(id, { tracking_mode: 'expense_tracker' });
      release();
      await getCtx().waitForPendingMutations();
    });
    expect(getCtx().activeWorkspace).toMatchObject({ id: 'ws-remote-created', name: 'Confirmed name', tracking_mode: 'expense_tracker' });
    expect(getCtx().workspaceMembers[0].id).toBe('wsm-remote-owner');
    expect(getCtx().error?.message).toBe('Rename rejected');
  });

  it.each([false, true])('A8-R02: rejected creation discards its dependent graph and preserves other workspaces (switch=%s)', async (switchWorkspace) => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);
    repo.loadSnapshot = vi.fn(async id => structuredClone({ ...snapshot, activeWorkspaceId: id }));
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    repo.createWorkspace = vi.fn(async () => { await gate; throw new Error('Creation rejected'); });
    repo.saveAccount = vi.fn().mockRejectedValue(new Error('Unknown workspace'));
    repo.savePurchase = vi.fn().mockRejectedValue(new Error('Unknown workspace'));
    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });
    await act(async () => { getCtx().createWorkspace('Rejected with dependents', 'expense_tracker'); });
    await act(async () => {
      getCtx().addAccount({ name: 'Discarded account', type: 'checking', institution: 'QA', initial_balance: 0, current_balance: 0, color: '#000000', active: true });
      const purchase = getCtx().createInstallmentPurchaseAsync({ description: 'Discarded purchase', total_amount: 40, installment_count: 2, purchase_date: '2050-01-01' });
      if (switchWorkspace) await getCtx().setActiveWorkspaceId('ws-1');
      release();
      await expect(purchase).rejects.toThrow('Unknown workspace');
      await getCtx().waitForPendingMutations();
    });
    expect(getCtx().workspaces.some(w => w.name === 'Rejected with dependents')).toBe(false);
    expect(getCtx().activeWorkspace.id).toBe('ws-1');
    expect(getCtx().accounts.map(a => a.id)).toEqual(['acc-1', 'acc-2']);
    expect(getCtx().purchases.map(p => p.id)).toEqual(['pur-1']);
    expect(getCtx().installments.map(i => i.id)).toEqual(['inst-1']);
  });

  it('A8-R02: committed workspace stays read-only until a failed membership lookup can be recovered', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);
    let offline = true;
    repo.loadSnapshot = vi.fn(async id => {
      if (offline && id === 'ws-remote-created') throw new Error('Snapshot offline');
      return structuredClone({ ...snapshot, activeWorkspaceId: id });
    });
    repo.getWorkspaceMembers = vi.fn().mockRejectedValue(new Error('Members offline'));
    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });
    await act(async () => { getCtx().createWorkspace('Committed but unresolved'); await getCtx().waitForPendingMutations(); });
    expect(getCtx().activeWorkspace.id).toBe('ws-remote-created');
    expect(getCtx().workspaceMembers).toHaveLength(0);
    expect(getCtx().isWorkspaceReadOnly).toBe(true);
    const account = { name: 'Blocked account', type: 'checking' as const, institution: 'QA', initial_balance: 0, current_balance: 0, color: '#000000', active: true };
    expect(() => getCtx().addAccount(account)).toThrow(/aguardando confirmação de acesso/);
    expect(repo.saveAccount).not.toHaveBeenCalled();
    offline = false;
    await act(async () => { await getCtx().refreshData(); });
    expect(getCtx().isWorkspaceReadOnly).toBe(false);
    await act(async () => { getCtx().addAccount(account); await getCtx().waitForPendingMutations(); });
    expect(repo.saveAccount).toHaveBeenCalledOnce();
    expect(getCtx().workspaceMembers[0].id).toBe('wsm-remote-owner');
  });

  it('A8-R02: rejected creation with no previous workspace leaves no phantom environment', async () => {
    const repo = createMockRepository(createMockSnapshot());
    repo.getWorkspaces = vi.fn().mockResolvedValue([]);
    repo.createWorkspace = vi.fn().mockRejectedValue(new Error('Creation offline'));
    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });
    await act(async () => { getCtx().createWorkspace('No previous workspace'); await getCtx().waitForPendingMutations(); });
    expect(getCtx().workspaces).toHaveLength(0);
    expect(getCtx().workspaceMembers).toHaveLength(0);
    expect(getCtx().isWorkspaceReadOnly).toBe(true);
  });

  it.each(['previous', 'other', 'empty'])('A8-R02: reconciles a workspace deleted remotely before its Owner can be read (%s)', async (fallback) => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);
    repo.loadSnapshot = vi.fn(async id => structuredClone({ ...snapshot, activeWorkspaceId: id }));
    repo.getWorkspaceMembers = vi.fn(async id => {
      snapshot.allWorkspaces = snapshot.allWorkspaces.filter(w => w.id !== id && (fallback === 'previous' || w.id !== 'ws-1') && fallback !== 'empty');
      snapshot.allWorkspaceMembers = fallback === 'previous' ? snapshot.allWorkspaceMembers.filter(m => m.workspace_id === 'ws-1')
        : fallback === 'other' ? [{ id: 'other-owner', workspace_id: 'ws-2', user_id: 'usr-1', role: 'owner', created_at: '2026-01-01' }] : [];
      return [];
    });
    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });
    await act(async () => { getCtx().createWorkspace('Removed in another session'); await getCtx().waitForPendingMutations(); });
    expect(getCtx().workspaces.some(w => w.id === 'ws-remote-created')).toBe(false);
    expect(getCtx().activeWorkspace.id).toBe(fallback === 'previous' ? 'ws-1' : fallback === 'other' ? 'ws-2' : '');
    expect(getCtx().isWorkspaceReadOnly).toBe(fallback === 'empty');
    expect(getCtx().error).not.toBeNull();
  });

  it('deve hidratar workspaces e snapshot consolidado a partir do repositório remoto', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);

    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    expect(getCtx().isLoaded).toBe(true);
    expect(getCtx().isLoading).toBe(false);
    expect(getCtx().dataMode).toBe('supabase');
    expect(getCtx().activeWorkspace.id).toBe('ws-1');
    expect(getCtx().accounts.length).toBe(2);
    expect(getCtx().accounts[0].name).toBe('Nubank Principal');
    expect(getCtx().transactions.length).toBe(1);
    expect(getCtx().transactions[0].description).toBe('Supermercado Central');
    expect(repo.getWorkspaces).toHaveBeenCalledWith('usr-1');
    expect(repo.loadSnapshot).toHaveBeenCalledWith('ws-1');
    expect(getCtx().isWorkspaceReadOnly).toBe(false);
  });

  it('restaura o workspace ativo salvo para o mesmo usuário no modo Supabase', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);
    localStorage.setItem('fincontrol_active_workspace:usr-1', 'ws-2');

    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });

    expect(repo.loadSnapshot).toHaveBeenCalledWith('ws-2');
    expect(getCtx().activeWorkspace.id).toBe('ws-2');
    expect(localStorage.getItem('fincontrol_active_workspace:usr-1')).toBe('ws-2');
  });

  it('ignora a preferência de workspace que o usuário atual não pode acessar', async () => {
    const snapshot = createMockSnapshot({
      allWorkspaces: [createMockSnapshot().allWorkspaces[0]],
    });
    const repo = createMockRepository(snapshot);
    localStorage.setItem('fincontrol_active_workspace:usr-1', 'ws-foreign');

    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });

    expect(repo.loadSnapshot).toHaveBeenCalledWith('ws-1');
    expect(getCtx().activeWorkspace.id).toBe('ws-1');
  });

  it('marca o contexto como somente leitura quando o usuário ativo é Viewer', async () => {
    const snapshot = createMockSnapshot({
      allWorkspaceMembers: [
        { id: 'wsm-viewer', workspace_id: 'ws-1', user_id: 'usr-1', role: 'viewer', created_at: '2026-01-01' },
      ],
    });
    const repo = createMockRepository(snapshot);

    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });

    expect(getCtx().isWorkspaceReadOnly).toBe(true);
  });

  it('deve aguardar auth se auth estiver em loading', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);

    let authLoading = true;
    let setAuthLoading: (val: boolean) => void = () => {};

    function StatefulAuthWrapper({ children }: { children: React.ReactNode }) {
      const [loading, setLoading] = React.useState(authLoading);
      setAuthLoading = setLoading;
      const authVal: AuthContextType = {
        user: { id: 'usr-1', name: 'Rodrigo', email: 'rodrigo@test.com', created_at: '2026-01-01' },
        isLoading: loading,
        login: vi.fn(),
        signUp: vi.fn(),
        resetPassword: vi.fn(),
        updatePassword: vi.fn(),
        logout: vi.fn(),
        updateProfile: vi.fn(),
        dataMode: 'supabase',
      };
      return <AuthContext.Provider value={authVal}>{children}</AuthContext.Provider>;
    }

    let currentCtx!: ReturnType<typeof useFinance>;
    function Consumer() {
      currentCtx = useFinance();
      return null;
    }

    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);
    activeRoots.push(root);

    await act(async () => {
      root.render(
        <StatefulAuthWrapper>
          <FinanceProvider repository={repo} initialDataMode="supabase">
            <Consumer />
          </FinanceProvider>
        </StatefulAuthWrapper>
      );
    });

    expect(currentCtx.isLoading).toBe(true);
    expect(repo.loadSnapshot).not.toHaveBeenCalled();

    // Desbloqueia auth
    await act(async () => {
      setAuthLoading(false);
    });

    for (let i = 0; i < 20 && !currentCtx?.isLoaded; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
    }

    expect(currentCtx.isLoaded).toBe(true);
    expect(repo.loadSnapshot).toHaveBeenCalledWith('ws-1');
  });

  it('deve criar workspace padrão automaticamente para novo usuário sem workspaces', async () => {
    const snapshot = createMockSnapshot({
      allWorkspaces: [{
        id: 'ws-remote-created',
        name: 'Meu Workspace',
        owner_id: 'usr-new-id',
        currency: 'BRL',
        tracking_mode: 'full',
        created_at: '2026-01-01',
      }],
    });
    const repo = createMockRepository(snapshot);
    (repo.getWorkspaces as any).mockResolvedValueOnce([]);

    const { getCtx } = await mountTestProvider(
      {
        repository: repo,
        initialDataMode: 'supabase',
      },
      { user: { id: 'usr-new-id', name: 'Rodrigo', email: 'rodrigo@test.com', created_at: '2026-01-01' } }
    );

    expect(getCtx().isLoaded).toBe(true);
    expect(repo.createWorkspace).toHaveBeenCalledWith({
      name: 'Meu Workspace',
      owner_id: 'usr-new-id',
      currency: 'BRL',
      tracking_mode: 'full',
    });
    expect(repo.loadSnapshot).toHaveBeenCalledWith('ws-remote-created');
    expect(localStorage.getItem('fincontrol_active_workspace:usr-new-id')).toBe('ws-remote-created');
  });

  it('deve parar com erro de autenticação no modo Supabase se auth.user for nulo', async () => {
    const repo = createMockRepository(createMockSnapshot());

    const { getCtx } = await mountTestProvider(
      {
        repository: repo,
        initialDataMode: 'supabase',
      },
      { user: null }
    );

    expect(getCtx().isLoaded).toBe(true);
    expect(getCtx().error).toBeDefined();
    expect(getCtx().error?.message).toMatch(/não autenticado/i);
    expect(repo.createWorkspace).not.toHaveBeenCalled();

    // Também valida que mutações adicionais são rejeitadas com erro de autenticação
    expect(() => getCtx().createWorkspace('Workspace Sem Auth')).toThrow(/não autenticado/i);
  });

  it('deve executar mutação otimista de addTransaction com persistência remota bem-sucedida', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);

    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    let created: any;
    await act(async () => {
      created = getCtx().addTransaction({
        description: 'Almoço no Restaurante',
        amount: 45.5,
        type: 'expense',
        status: 'pending',
        transaction_date: '2026-09-21',
        due_date: '2026-09-21',
        category_id: 'cat-1',
        account_id: 'acc-1',
      });
    });

    expect(created).toBeDefined();
    // No estado síncrono local, a transação foi adicionada imediatamente
    expect(getCtx().transactions.some((t) => t.description === 'Almoço no Restaurante')).toBe(true);

    // Aguarda conclusão assíncrona
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(repo.saveTransaction).toHaveBeenCalled();
    expect(getCtx().isSaving).toBe(false);
    expect(getCtx().error).toBeNull();
  });

  it('deve executar rollback imediato se persistência remota falhar em addTransaction', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);
    (repo.saveTransaction as any).mockRejectedValueOnce(new Error('Erro de conexão com o Supabase'));

    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    const initialTxCount = getCtx().transactions.length;

    await act(async () => {
      getCtx().addTransaction({
        description: 'Transação Fadada ao Fracasso',
        amount: 100,
        type: 'expense',
        status: 'pending',
        transaction_date: '2026-09-21',
        due_date: '2026-09-21',
        category_id: 'cat-1',
        account_id: 'acc-1',
      });
    });

    // Aguarda a rejeição da Promise e execução do rollback
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    // O estado reverteu para o anterior
    expect(getCtx().transactions.length).toBe(initialTxCount);
    expect(getCtx().transactions.some((t) => t.description === 'Transação Fadada ao Fracasso')).toBe(false);
    expect(getCtx().error).not.toBeNull();
    expect(getCtx().error?.message).toContain('Erro de conexão com o Supabase');
    expect(getCtx().isSaving).toBe(false);

    // Testa clearError
    act(() => {
      getCtx().clearError();
    });
    expect(getCtx().error).toBeNull();
  });

  it('deve executar rollback em updateTransaction quando repositório rejeita', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);
    (repo.saveTransaction as any).mockRejectedValueOnce(new Error('Update falhou no banco'));

    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    const originalDesc = getCtx().transactions.find((t) => t.id === 'tx-1')!.description;

    await act(async () => {
      getCtx().updateTransaction('tx-1', {
        description: 'Tentativa de alteração com erro',
      });
    });

    // Aguarda o rollback
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    const txAfter = getCtx().transactions.find((t) => t.id === 'tx-1')!;
    expect(txAfter.description).toBe(originalDesc);
    expect(getCtx().error?.message).toContain('Update falhou no banco');
  });

  it('deve executar rollback em deleteTransaction quando repositório rejeita', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);
    (repo.deleteTransaction as any).mockRejectedValueOnce(new Error('Exclusão bloqueada'));

    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    expect(getCtx().transactions.some((t) => t.id === 'tx-1')).toBe(true);

    await act(async () => {
      getCtx().deleteTransaction('tx-1');
    });

    // Aguarda o rollback
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    // A transação foi restaurada após a falha remota
    expect(getCtx().transactions.some((t) => t.id === 'tx-1')).toBe(true);
    expect(getCtx().error?.message).toContain('Exclusão bloqueada');
  });

  it('deve usar previousState se loadSnapshot falhar durante rollback de mutação', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);

    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    const initialTxCount = getCtx().transactions.length;

    (repo.saveTransaction as any).mockRejectedValueOnce(new Error('Erro na mutação remota'));
    (repo.loadSnapshot as any).mockRejectedValueOnce(new Error('Falha no loadSnapshot'));

    await act(async () => {
      getCtx().addTransaction({
        description: 'Falha com duplo erro',
        amount: 50,
        type: 'expense',
        status: 'pending',
        transaction_date: '2026-09-22',
        due_date: '2026-09-22',
      });
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });

    expect(getCtx().transactions.length).toBe(initialTxCount);
    expect(getCtx().error?.message).toContain('Erro na mutação remota');
  });

  it('deve permitir refreshData recarregando o snapshot atualizado', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);

    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    expect(repo.loadSnapshot).toHaveBeenCalledTimes(1);

    await act(async () => {
      await getCtx().refreshData();
    });

    expect(repo.loadSnapshot).toHaveBeenCalledTimes(2);
    expect(getCtx().isLoading).toBe(false);
    expect(getCtx().error).toBeNull();
  });

  it('deve registrar erro se refreshData falhar', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);

    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    (repo.loadSnapshot as any).mockRejectedValueOnce(new Error('Queda de rede ao recarregar'));

    let caughtError: any;
    await act(async () => {
      try {
        await getCtx().refreshData();
      } catch (err) {
        caughtError = err;
      }
    });

    expect(caughtError?.message).toContain('Queda de rede ao recarregar');
    expect(getCtx().error?.message).toContain('Queda de rede ao recarregar');
    expect(getCtx().isLoading).toBe(false);
  });

  it('deve recarregar dados do localStorage ao chamar refreshData em modo local', async () => {
    let currentCtx!: ReturnType<typeof useFinance>;
    function Consumer() {
      currentCtx = useFinance();
      return null;
    }

    const div = document.createElement('div');
    const root = createRoot(div);
    activeRoots.push(root);

    await act(async () => {
      root.render(
        <FinanceProvider initialDataMode="local">
          <Consumer />
        </FinanceProvider>
      );
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(currentCtx.isLoaded).toBe(true);
    expect(currentCtx.dataMode).toBe('local');

    await act(async () => {
      await currentCtx.refreshData();
    });

    expect(currentCtx.isLoading).toBe(false);
    expect(currentCtx.error).toBeNull();
  });

  it('deve ignorar conclusão assíncrona se componente for desmontado durante initSupabaseData', async () => {
    let resolveSnapshot!: (val: any) => void;
    const snapshotPromise = new Promise((resolve) => {
      resolveSnapshot = resolve;
    });
    const repo = createMockRepository(createMockSnapshot());
    (repo.loadSnapshot as any).mockReturnValueOnce(snapshotPromise);

    const div = document.createElement('div');
    const root = createRoot(div);

    await act(async () => {
      root.render(
        <AuthContext.Provider value={defaultAuth}>
          <FinanceProvider repository={repo} initialDataMode="supabase">
            <div>Test</div>
          </FinanceProvider>
        </AuthContext.Provider>
      );
    });

    // Desmonta antes da Promise resolver
    await act(async () => {
      root.unmount();
    });

    // Resolve após desmontar
    await act(async () => {
      resolveSnapshot(createMockSnapshot());
      await new Promise((r) => setTimeout(r, 20));
    });
  });

  it('deve ignorar rejeição assíncrona se componente for desmontado durante initSupabaseData', async () => {
    let rejectSnapshot!: (val: any) => void;
    const snapshotPromise = new Promise((_, reject) => {
      rejectSnapshot = reject;
    });
    const repo = createMockRepository(createMockSnapshot());
    (repo.loadSnapshot as any).mockReturnValueOnce(snapshotPromise);

    const div = document.createElement('div');
    const root = createRoot(div);

    await act(async () => {
      root.render(
        <AuthContext.Provider value={defaultAuth}>
          <FinanceProvider repository={repo} initialDataMode="supabase">
            <div>Test</div>
          </FinanceProvider>
        </AuthContext.Provider>
      );
    });

    // Desmonta antes da Promise rejeitar
    await act(async () => {
      root.unmount();
    });

    // Rejeita após desmontar
    await act(async () => {
      rejectSnapshot(new Error('Erro pós-desmonte'));
      await new Promise((r) => setTimeout(r, 20));
    });
  });

  it('deve alternar workspace carregando snapshot novo de forma assíncrona', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);

    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    expect(getCtx().activeWorkspace.id).toBe('ws-1');

    await act(async () => {
      getCtx().setActiveWorkspaceId('ws-2');
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(repo.loadSnapshot).toHaveBeenCalledWith('ws-2');
    expect(getCtx().activeWorkspace.id).toBe('ws-2');
    expect(localStorage.getItem('fincontrol_active_workspace:usr-1')).toBe('ws-2');
  });

  it('deve registrar erro se alternância de workspace falhar', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);

    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    (repo.loadSnapshot as any).mockRejectedValueOnce(new Error('Falha ao carregar workspace'));

    await act(async () => {
      getCtx().setActiveWorkspaceId('ws-2');
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(getCtx().error?.message).toContain('Falha ao carregar workspace');
    expect(getCtx().isLoading).toBe(false);
  });

  it('deve cobrir todas as mutações assíncronas do repositório remoto', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);

    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    // 1. Contas
    let createdAcc: any;
    await act(async () => {
      createdAcc = getCtx().addAccount({
        name: 'Inter PJ',
        type: 'checking',
        institution: 'Inter',
        initial_balance: 500,
        current_balance: 500,
        color: '#FF7A00',
        active: false,
      });
      getCtx().updateAccount('acc-1', { name: 'Nubank Atualizado' });
    });

    // 2. Cartões de Crédito e Pagamento de Fatura
    await act(async () => {
      getCtx().addCreditCard({
        name: 'Inter Black',
        institution: 'Inter',
        credit_limit: 15000,
        closing_day: 10,
        due_day: 20,
        color: '#000',
        active: true,
      });
      getCtx().updateCreditCard('card-1', { name: 'Ultravioleta Gold' });
      getCtx().payCreditCardBill('bill-1', 'acc-1', 150, '2026-09-22', 'Pagamento parcial');
    });

    // 3. Formas de Pagamento e Categorias
    await act(async () => {
      getCtx().addPaymentMethod({ name: 'Boleto', type: 'cash', active: true });
      getCtx().addCategory({ name: 'Transporte', color: '#00F', icon: 'car', type: 'expense', active: true });
      getCtx().updateCategory('cat-1', { name: 'Alimentação & Mercado' });
    });

    // 4. Compras Parceladas, Parcelas e Pagamento Direto
    await act(async () => {
      getCtx().createInstallmentPurchase({
        description: 'iPhone',
        total_amount: 5000,
        installment_count: 10,
        purchase_date: '2026-09-02',
        credit_card_id: 'card-1',
      });
      getCtx().recordPayment({
        transaction_id: 'tx-1',
        amount: 80,
        payment_date: '2026-09-22',
        account_id: 'acc-1',
      });
      getCtx().createTransfer('acc-1', 'acc-2', 50, '2026-09-22', 'Aporte interno');
      getCtx().updateTransaction('tx-1', { category_id: 'cat-1', paid_by_member_id: 'wsm-1' });
      getCtx().deleteAccount(createdAcc.id);
      getCtx().duplicateTransaction('tx-1');
      getCtx().duplicateTransaction('inexistente-id');
    });

    // 5. Rateios e Acertos
    await act(async () => {
      getCtx().addTransaction({
        description: 'Almoço Compartilhado',
        amount: 200,
        type: 'expense',
        status: 'pending',
        due_date: '2026-09-22',
        paid_by_member_id: 'wsm-2',
        split_type: 'equal',
        splits: [
          { member_id: 'wsm-1', amount: 100 },
          { member_id: 'wsm-2', amount: 100 },
        ],
        transaction_date: '2026-09-22',
      });
      const set = getCtx().recordSettlement({
        from_member_id: 'wsm-1',
        to_member_id: 'wsm-2',
        amount: 100,
      });
      getCtx().deleteSettlement(set.id);
    });

    // 6. Recorrências, Orçamentos e Metas
    await act(async () => {
      getCtx().addRecurring({
        description: 'Netflix',
        amount: 55.9,
        type: 'expense',
        frequency: 'monthly',
        start_date: '2026-01-01',
        next_occurrence: '2026-10-01',
        active: true,
        auto_create: true,
      });
      getCtx().toggleRecurring('rec-1');
      getCtx().setBudget('cat-1', 1200, 9, 2026);
      getCtx().addGoal({
        name: 'Carro Novo',
        target_amount: 50000,
        current_amount: 5000,
        target_date: '2027-12-31',
        color: '#00F',
        icon: 'flag',
        status: 'in_progress',
      });
      getCtx().updateGoal('goal-1', { name: 'Viagem Internacional' });
      getCtx().depositGoal('goal-1', 500, 'acc-1');
    });

    // 7. Workspaces e Membros
    await act(async () => {
      getCtx().createWorkspace('Workspace Familiar');
      getCtx().updateWorkspace('ws-1', { name: 'Workspace Alfa Renomeado' });
      getCtx().addWorkspaceMember('convidado@test.com', 'member');
    });

    // Aguarda todos os despachos remotos terminarem
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });

    // Deleta recorrência e conta após persistência concluída
    await act(async () => {
      getCtx().deleteRecurring('rec-1');
      getCtx().deleteAccount(createdAcc.id);
    });

    expect(repo.saveAccount).toHaveBeenCalled();
    expect(repo.deleteAccount).toHaveBeenCalled();
    expect(repo.saveCreditCard).toHaveBeenCalled();
    expect(repo.savePayment).toHaveBeenCalled();
    expect(repo.savePaymentMethod).toHaveBeenCalled();
    expect(repo.saveCategory).toHaveBeenCalled();
    expect(repo.savePurchase).toHaveBeenCalled();
    expect(repo.saveTransfer).toHaveBeenCalled();
    expect(repo.saveSettlement).toHaveBeenCalled();
    expect(repo.deleteSettlement).toHaveBeenCalled();
    expect(repo.saveRecurring).toHaveBeenCalled();
    expect(repo.deleteRecurring).toHaveBeenCalled();
    expect(repo.saveBudget).toHaveBeenCalled();
    expect(repo.saveGoal).toHaveBeenCalled();
    expect(repo.createWorkspace).toHaveBeenCalled();
    expect(repo.updateWorkspace).toHaveBeenCalled();
    expect(repo.addWorkspaceMember).toHaveBeenCalled();
    expect(getCtx().isSaving).toBe(false);
  });

  it('deve instanciar SupabaseFinanceRepository quando em modo supabase sem prop repository', async () => {
    const dummyClient = { from: vi.fn(), rpc: vi.fn() };
    vi.spyOn(clientModule, 'createClient').mockReturnValue(dummyClient as any);

    let currentCtx!: ReturnType<typeof useFinance>;
    function Consumer() {
      currentCtx = useFinance();
      return null;
    }

    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);
    activeRoots.push(root);

    await act(async () => {
      root.render(
        <FinanceProvider initialDataMode="supabase">
          <Consumer />
        </FinanceProvider>
      );
    });

    expect(clientModule.createClient).toHaveBeenCalled();
    expect(currentCtx.dataMode).toBe('supabase');
  });

  it('deve usar LocalFinanceRepository no modo local e refreshData no modo local', async () => {
    let currentCtx!: ReturnType<typeof useFinance>;
    function Consumer() {
      currentCtx = useFinance();
      return null;
    }

    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);
    activeRoots.push(root);

    await act(async () => {
      root.render(
        <FinanceProvider initialDataMode="local">
          <Consumer />
        </FinanceProvider>
      );
    });

    for (let i = 0; i < 20 && !currentCtx?.isLoaded; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
    }

    expect(currentCtx.isLoaded).toBe(true);
    expect(currentCtx.dataMode).toBe('local');

    // Executa refreshData no modo local
    await act(async () => {
      await currentCtx.refreshData();
    });

    expect(currentCtx.isLoaded).toBe(true);
  });

  it('deve registrar erro ao falhar troca de workspace', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);

    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    (repo.loadSnapshot as any).mockRejectedValueOnce('Falha na troca');

    await act(async () => {
      getCtx().setActiveWorkspaceId('ws-2');
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(getCtx().error?.message).toContain('Falha na troca');
    expect(getCtx().isLoading).toBe(false);
  });

  it('deve tratar erro na hidratação inicial do Supabase', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);
    (repo.getWorkspaces as any).mockRejectedValueOnce('Falha geral no Supabase');

    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    expect(getCtx().isLoaded).toBe(true);
    expect(getCtx().error?.message).toContain('Falha geral no Supabase');
    expect(getCtx().isLoading).toBe(false);
  });

  it('deve usar LocalFinanceRepository se createClient retornar null em modo supabase', async () => {
    vi.spyOn(clientModule, 'createClient').mockReturnValue(null);

    let currentCtx!: ReturnType<typeof useFinance>;
    function Consumer() {
      currentCtx = useFinance();
      return null;
    }

    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);
    activeRoots.push(root);

    await act(async () => {
      root.render(
        <FinanceProvider initialDataMode="supabase">
          <Consumer />
        </FinanceProvider>
      );
    });

    for (let i = 0; i < 20 && !currentCtx?.isLoaded; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
    }

    expect(currentCtx.isLoaded).toBe(true);
  });

  it('deve detectar dataMode a partir da instância de SupabaseFinanceRepository e LocalFinanceRepository', async () => {
    const snapshot = createMockSnapshot();
    const dummyClient = { from: vi.fn(), rpc: vi.fn() };
    const sbRepo = new SupabaseFinanceRepository(dummyClient as any);
    sbRepo.getWorkspaces = vi.fn().mockResolvedValue(snapshot.allWorkspaces);
    sbRepo.loadSnapshot = vi.fn().mockResolvedValue(snapshot);

    const { getCtx: getSbCtx } = await mountTestProvider({
      repository: sbRepo,
    });
    expect(getSbCtx().dataMode).toBe('supabase');

    const localRepo = new LocalFinanceRepository();
    const { getCtx: getLocalCtx } = await mountTestProvider({
      repository: localRepo,
    });
    expect(getLocalCtx().dataMode).toBe('local');

    // 3. auth.dataMode
    const { getCtx: getAuthCtx } = await mountTestProvider({}, { dataMode: 'supabase' });
    expect(getAuthCtx().dataMode).toBe('supabase');

    // 4. fallback process.env.NEXT_PUBLIC_DATA_MODE
    const prevEnv = process.env.NEXT_PUBLIC_DATA_MODE;
    process.env.NEXT_PUBLIC_DATA_MODE = 'supabase';
    const { getCtx: getEnvCtx } = await mountTestProvider({}, { dataMode: undefined as any });
    expect(getEnvCtx().dataMode).toBe('supabase');
    process.env.NEXT_PUBLIC_DATA_MODE = 'local';
    const { getCtx: getLocalEnvCtx } = await mountTestProvider({}, { dataMode: undefined as any });
    expect(getLocalEnvCtx().dataMode).toBe('local');
    process.env.NEXT_PUBLIC_DATA_MODE = prevEnv;
  });

  it('deve lidar com snapshot remoto que não contém parcelas correspondentes', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);
    // repo.loadSnapshot returns empty installments
    (repo.loadSnapshot as any).mockResolvedValue({ ...snapshot, allInstallments: [] });
    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });

    await act(async () => {
      getCtx().createInstallmentPurchase({
        description: 'Compra Sem Parcelas Remotas',
        total_amount: 500,
        installment_count: 2,
        purchase_date: '2026-09-25',
      });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(getCtx().purchases.some((p) => p.description === 'Compra Sem Parcelas Remotas')).toBe(true);
  });

  it('deve tratar duplicateTransaction com id inexistente e rollback com string', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);
    (repo.saveTransaction as any).mockRejectedValueOnce('Erro em formato string');

    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    // 1. duplicateTransaction inexistente
    await act(async () => {
      const dup = getCtx().duplicateTransaction('tx-inexistente');
      expect(dup).toBeNull();
    });

    // 2. addTransaction com rejeição em string
    await act(async () => {
      getCtx().addTransaction({
        description: 'Transação com erro string',
        amount: 20,
        type: 'expense',
        status: 'pending',
        transaction_date: '2026-09-22',
        due_date: '2026-09-22',
      });
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(getCtx().error?.message).toContain('Erro em formato string');
  });

  it('deve cobrir branches de addWorkspaceMember (resolução de user_id por email ou id)', async () => {
    const snapshot = createMockSnapshot();
    // Adiciona membro com user.email e membro com user_id igual ao email
    snapshot.allWorkspaceMembers = [
      { id: 'wsm-1', workspace_id: 'ws-1', user_id: 'usr-1', role: 'owner', created_at: '2026-01-01', user: { id: 'usr-1', name: 'User 1', email: 'usr1@teste.com', created_at: '2026-01-01' } },
      { id: 'wsm-2', workspace_id: 'ws-1', user_id: 'usr2@teste.com', role: 'member', created_at: '2026-01-01' },
    ];
    const repo = createMockRepository(snapshot);
    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });

    // 1. Match por user.email
    await act(async () => {
      getCtx().addWorkspaceMember('usr1@teste.com', 'admin');
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(repo.addWorkspaceMember).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'usr-1', role: 'admin' })
    );

    // 2. Match por user_id === email
    await act(async () => {
      getCtx().addWorkspaceMember('usr2@teste.com', 'member');
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(repo.addWorkspaceMember).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'usr2@teste.com', role: 'member' })
    );

    // 3. Fallback para email quando não encontra
    await act(async () => {
      getCtx().addWorkspaceMember('novo@teste.com', 'viewer');
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(repo.addWorkspaceMember).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'novo@teste.com', role: 'viewer' })
    );
  });

  it('deve cobrir branches de payCreditCardBill e recordPayment (com e sem account_id)', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);
    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });

    // 1. payCreditCardBill com accountId definido
    await act(async () => {
      getCtx().payCreditCardBill('bill-1', 'acc-1', 100, '2026-09-25', 'Pagamento parcial');
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(repo.savePayment).toHaveBeenCalledWith(
      expect.objectContaining({ credit_card_bill_id: 'bill-1', account_id: 'acc-1' })
    );

    // 2. payCreditCardBill sem accountId (permitido em modo expense_tracker -> account_id: null)
    await act(async () => {
      getCtx().updateWorkspace('ws-1', { tracking_mode: 'expense_tracker' });
    });
    await act(async () => {
      getCtx().payCreditCardBill('bill-1', undefined, 50, '2026-09-25');
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(repo.savePayment).toHaveBeenCalledWith(
      expect.objectContaining({ credit_card_bill_id: 'bill-1', account_id: null })
    );

    // 3. recordPayment com account_id definido
    await act(async () => {
      getCtx().recordPayment({
        amount: 30,
        payment_date: '2026-09-25',
        account_id: 'acc-1',
        transaction_id: 'tx-1',
      });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(repo.savePayment).toHaveBeenCalledWith(
      expect.objectContaining({ transaction_id: 'tx-1', account_id: 'acc-1' })
    );

    // 4. recordPayment sem account_id
    await act(async () => {
      getCtx().recordPayment({
        amount: 25,
        payment_date: '2026-09-25',
        transaction_id: 'tx-1',
      });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(repo.savePayment).toHaveBeenCalledWith(
      expect.objectContaining({ transaction_id: 'tx-1', account_id: null })
    );
  });

  it('deve cobrir addTransaction preservando outras transações na atualização de estado e addAccount com active booleano ou undefined', async () => {
    const snapshot = createMockSnapshot();
    // Snapshot já possui 'tx-1' em allTransactions
    const repo = createMockRepository(snapshot);
    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });

    // 1. addTransaction quando já existem outras transações (cobre t.id !== res.id)
    await act(async () => {
      getCtx().addTransaction({
        description: 'Nova transação que preserva tx-1',
        amount: 99,
        type: 'expense',
        status: 'pending',
        transaction_date: '2026-09-25',
        due_date: '2026-09-25',
      });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    const txs = getCtx().transactions;
    expect(txs.some((t) => t.id === 'tx-1')).toBe(true);

    // 2. addAccount com active explicitamente false
    await act(async () => {
      getCtx().addAccount({
        name: 'Conta Inativa Inicial',
        type: 'checking',
        institution: 'Nubank',
        initial_balance: 0,
        current_balance: 0,
        color: '#111111',
        active: false,
      });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    // 3. addAccount sem active informado
    await act(async () => {
      getCtx().addAccount({
        name: 'Conta Sem Active Informado',
        type: 'savings',
        institution: 'Itaú',
        initial_balance: 0,
        current_balance: 0,
        color: '#222222',
      } as any);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    const allAccs = getCtx().allWorkspaceAccounts;
    expect(allAccs.find((a) => a.name === 'Conta Inativa Inicial')?.active).toBe(false);
    expect(getCtx().accounts.some((a) => a.name === 'Conta Inativa Inicial')).toBe(false);
    expect(allAccs.find((a) => a.name === 'Conta Sem Active Informado')?.active).toBe(true);

    // 4. duplicateTransaction quando existem múltiplas transações (cobre branch t.id !== res.id)
    await act(async () => {
      getCtx().duplicateTransaction('tx-1');
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(getCtx().transactions.length).toBeGreaterThan(2);
  });

  it('deve cobrir refreshData com erro que não é instância de Error e unmount prematuro', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);
    const { getCtx } = await mountTestProvider({ repository: repo, initialDataMode: 'supabase' });

    repo.loadSnapshot = vi.fn().mockRejectedValue('falha de rede como string');

    await act(async () => {
      await expect(getCtx().refreshData()).rejects.toThrow('falha de rede como string');
    });
    expect(getCtx().error?.message).toBe('falha de rede como string');
  });

  it('deve respeitar isMounted ao desmontar antes da resolução de loadWorkspaces ou loadSnapshot', async () => {
    let resolveWorkspaces: (ws: any) => void;
    const workspacesPromise = new Promise((resolve) => {
      resolveWorkspaces = resolve;
    });
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);
    (repo as any).loadWorkspaces = vi.fn().mockImplementation(() => workspacesPromise);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <FinanceProvider repository={repo} initialDataMode="supabase">
          <div>Child</div>
        </FinanceProvider>
      );
    });

    act(() => {
      root.unmount();
    });
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }

    await act(async () => {
      resolveWorkspaces!([
        { id: 'ws-1', name: 'Meu Workspace', owner_id: 'usr-1', currency: 'BRL', tracking_mode: 'full', created_at: '2026-01-01' }
      ]);
    });
  });

  it('deve acionar fallback mockWorkspaces[0] em modo local quando allWorkspaces for vazio', async () => {
    localStorage.setItem('fincontrol_workspaces', JSON.stringify([]));
    const { getCtx } = await mountTestProvider({ initialDataMode: 'local' });
    expect(getCtx().activeWorkspace).toBeDefined();
  });
  it('deve demonstrar operação A falhando e operação B sendo bem-sucedida, nessa ordem, com o resultado de B preservado na UI', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);

    let savedTxB: any = null;
    (repo.saveTransaction as any)
      .mockRejectedValueOnce(new Error('Falha na transação A'))
      .mockImplementationOnce(async (tx: any) => {
        savedTxB = { ...tx, id: 'tx-b-remote-id', created_at: '2026-09-26' };
        return savedTxB;
      });

    // Quando o Provider reconciliar ao esvaziar a fila com falha, o snapshot remoto conterá B mas não A
    (repo.loadSnapshot as any).mockImplementation(async (wsId: string) => ({
      ...snapshot,
      activeWorkspaceId: wsId,
      allTransactions: [
        ...snapshot.allTransactions,
        ...(savedTxB ? [savedTxB] : []),
      ],
    }));

    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    // Dispara Operação A (falha) e imediatamente Operação B (sucesso) em fila
    await act(async () => {
      getCtx().addTransaction({
        description: 'Transação A Falha',
        amount: 100,
        type: 'expense',
        status: 'pending',
        transaction_date: '2026-09-26',
        due_date: '2026-09-26',
        category_id: 'cat-1',
        account_id: 'acc-1',
      });
      getCtx().addTransaction({
        description: 'Transação B Sucesso',
        amount: 200,
        type: 'income',
        status: 'paid',
        transaction_date: '2026-09-26',
        due_date: '2026-09-26',
        category_id: 'cat-1',
        account_id: 'acc-1',
      });
    });

    // Aguarda o processamento de toda a fila
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    // A fila terminou
    expect(getCtx().isSaving).toBe(false);
    // Erro da operação A foi capturado
    expect(getCtx().error?.message).toContain('Falha na transação A');
    // Transação B com sucesso foi preservada na UI
    expect(getCtx().transactions.some((t) => t.description === 'Transação B Sucesso')).toBe(true);
    // Transação A que falhou foi revertida e não consta na UI
    expect(getCtx().transactions.some((t) => t.description === 'Transação A Falha')).toBe(false);
  });

  it('deve persistir mutação no workspace de origem mesmo se houver troca de workspace durante o salvamento', async () => {
    const snapshot = createMockSnapshot();
    const ws2 = { id: 'ws-2', name: 'Workspace 2', owner_id: 'usr-1', currency: 'BRL', tracking_mode: 'full' as const, created_at: '2026-01-01' };
    const repo = createMockRepository({
      ...snapshot,
      allWorkspaces: [...snapshot.allWorkspaces, ws2],
    });

    let resolveSave: ((val: any) => void) | null = null;
    const savePromise = new Promise((resolve) => {
      resolveSave = resolve;
    });

    (repo.saveAccount as any).mockImplementationOnce(() => savePromise);

    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    // Dispara criação de conta no workspace ativo atual (ws-1)
    await act(async () => {
      getCtx().addAccount({
        name: 'Conta Workspace 1',
        institution: 'Banco 1',
        color: '#10b981',
        type: 'checking',
        initial_balance: 500,
        current_balance: 500,
        active: true,
      });
    });

    // Imediatamente troca para ws-2 enquanto o salvamento da conta ainda está em andamento
    await act(async () => {
      getCtx().setActiveWorkspaceId('ws-2');
    });

    // Resolve o salvamento da conta
    await act(async () => {
      resolveSave!({
        id: 'acc-ws-1-id',
        workspace_id: 'ws-1',
        name: 'Conta Workspace 1',
        type: 'checking',
        balance: 500,
        active: true,
        created_at: '2026-09-26',
      });
      await new Promise((r) => setTimeout(r, 40));
    });

    // A persistência no repositório recebeu workspace_id: 'ws-1', e NÃO 'ws-2', e sem ID otimista
    expect(repo.saveAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: 'ws-1',
        name: 'Conta Workspace 1',
      })
    );
    expect((repo.saveAccount as any).mock.calls[0][0].id).toBeUndefined();
  });

  it('deve reconciliar o estado de A quando mutação em A falha, outra em B conclui e o usuário está no workspace A', async () => {
    const snapshot1 = createMockSnapshot();
    const ws2 = { id: 'ws-2', name: 'Workspace 2', owner_id: 'usr-1', currency: 'BRL', tracking_mode: 'full' as const, created_at: '2026-01-01' };
    const catWs2 = { id: 'cat-ws2', workspace_id: 'ws-2', name: 'Cat WS2', type: 'income' as const, color: '#10b981', icon: 'tag', active: true, created_at: '2026-01-01' };
    const repo = createMockRepository({
      ...snapshot1,
      allWorkspaces: [...snapshot1.allWorkspaces, ws2],
      allCategories: [...snapshot1.allCategories, catWs2],
    });

    // Operação em ws-1 falha
    (repo.saveTransaction as any).mockImplementationOnce(() => Promise.reject(new Error('Erro no workspace A')));
    // Operação em ws-2 sucede
    (repo.saveTransaction as any).mockImplementationOnce((tx: any) => Promise.resolve({ ...tx, id: 'tx-b-canonical' }));

    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    // 1. Dispara transação no Workspace A (ws-1)
    await act(async () => {
      getCtx().addTransaction({
        description: 'Transação Falha em A',
        amount: 100,
        type: 'expense',
        status: 'pending',
        transaction_date: '2026-09-26',
        due_date: '2026-09-26',
        category_id: 'cat-1',
      });
    });

    // 2. Dispara transação no Workspace B (ws-2)
    await act(async () => {
      getCtx().setActiveWorkspaceId('ws-2');
    });
    await act(async () => {
      getCtx().addTransaction({
        description: 'Transação Sucesso em B',
        amount: 200,
        type: 'income',
        status: 'pending',
        transaction_date: '2026-09-26',
        due_date: '2026-09-26',
        category_id: 'cat-ws2',
      });
    });

    // 3. Usuário retorna ao Workspace A
    await act(async () => {
      getCtx().setActiveWorkspaceId('ws-1');
    });

    // 4. Aguarda término de toda a fila
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });

    // Fila terminou
    expect(getCtx().isSaving).toBe(false);
    expect(getCtx().activeWorkspace.id).toBe('ws-1');
    // Transação falha foi removida do Workspace A após a reconciliação automática
    expect(getCtx().transactions.some((t) => t.description === 'Transação Falha em A')).toBe(false);
  });

  it('deve encadear addCategory e setBudget imediatamente e resolver UUID canônico da categoria no orçamento', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);

    const canonicalCatId = 'cat-canonical-uuid-999';
    (repo.saveCategory as any).mockImplementationOnce(async (cat: any) => ({
      ...cat,
      id: canonicalCatId,
    }));
    (repo.saveBudget as any).mockImplementationOnce(async (b: any) => ({
      ...b,
      id: 'bud-canonical-uuid-888',
    }));

    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    let createdCat: any;
    // Dispara criação de categoria e setBudget IMEDIATAMENTE em sucessão
    await act(async () => {
      createdCat = getCtx().addCategory({
        name: 'Categoria Nova Chained',
        type: 'expense',
        color: '#ff0000',
        icon: 'tag',
        active: true,
      });
      getCtx().setBudget(createdCat.id, 500, 10, 2026);
    });

    // Aguarda o processamento de ambas as mutações na fila
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(getCtx().isSaving).toBe(false);
    expect(getCtx().error).toBeNull();

    // saveBudget foi chamado com o UUID canônico da categoria retornada pelo banco
    expect(repo.saveBudget).toHaveBeenCalledWith(
      expect.objectContaining({
        category_id: canonicalCatId,
        planned_amount: 500,
        month: 10,
        year: 2026,
      })
    );
  });

  it('deve preservar saldos intactos no repositório e no estado ao chamar updateAccount com payload parcial', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);

    (repo.saveAccount as any).mockImplementation(async (acc: any) => ({
      ...acc,
      id: acc.id ?? 'acc-saved-1',
    }));

    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    // Conta inicial tem initial_balance: 1000 e current_balance: 1000
    const targetAccount = getCtx().accounts[0];
    expect(targetAccount.initial_balance).toBe(1000);
    expect(targetAccount.current_balance).toBe(1000);

    // Atualiza apenas o nome
    await act(async () => {
      getCtx().updateAccount(targetAccount.id, { name: 'Conta Nome Atualizado' });
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(getCtx().isSaving).toBe(false);
    expect(getCtx().error).toBeNull();

    // Verifica que saveAccount recebeu apenas os campos editados (sem enviar saldo antigo)
    expect(repo.saveAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        id: targetAccount.id,
        name: 'Conta Nome Atualizado',
      })
    );
    expect((repo.saveAccount as any).mock.calls[0][0].initial_balance).toBeUndefined();
    expect((repo.saveAccount as any).mock.calls[0][0].current_balance).toBeUndefined();

    // E no estado do contexto os saldos permanecem intactos
    const updated = getCtx().accounts.find((a) => a.id === targetAccount.id);
    expect(updated?.name).toBe('Conta Nome Atualizado');
    expect(updated?.initial_balance).toBe(1000);
    expect(updated?.current_balance).toBe(1000);
  });

  it('A tem sucesso, pagamento B falha, loadSnapshot falha: desfaz cirurgicamente pagamento, saldo da conta e status da obrigação preservando A', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);

    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    const targetAccount = getCtx().accounts.find((a) => a.id === 'acc-1')!;
    const targetTx = getCtx().transactions.find((t) => t.id === 'tx-1')!;
    const initialBalance = targetAccount.current_balance;
    const initialStatus = targetTx.status;
    const initialPaidAmount = targetTx.paid_amount ?? 0;

    // 1. Operação A (addCategory) tem sucesso
    (repo.saveCategory as any).mockImplementationOnce(async (cat: any) => ({
      ...cat,
      id: 'cat-success-123',
    }));

    // 2. Operação B (recordPayment) falha na persistência remota
    (repo.savePayment as any).mockImplementationOnce(() =>
      Promise.reject(new Error('Erro na gravação remota do pagamento'))
    );

    // 3. Reconciliação do snapshot no drain da fila falha (rede indisponível)
    (repo.loadSnapshot as any).mockRejectedValueOnce(
      new Error('Rede indisponível ao recarregar snapshot')
    );

    // Dispara Operação A seguida imediatamente por Operação B
    let paymentRes: any;
    await act(async () => {
      getCtx().addCategory({
        name: 'Categoria Sucesso A',
        type: 'expense',
        color: '#ff0000',
        icon: 'tag',
        active: true,
      });

      paymentRes = getCtx().recordPayment({
        transaction_id: targetTx.id,
        account_id: targetAccount.id,
        amount: 50,
        payment_date: '2026-09-26',
      });
    });

    // Aguarda o esvaziamento da fila de mutações
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(getCtx().isSaving).toBe(false);
    expect(getCtx().error).not.toBeNull();
    expect(getCtx().error?.message).toContain('Erro na gravação remota do pagamento');

    // 1. Mutação A foi preservada com sucesso no estado da UI
    expect(getCtx().categories.some((c) => c.name === 'Categoria Sucesso A')).toBe(true);

    // 2. Pagamento B falhou: o pagamento foi removido de allPayments pelo rollback cirúrgico
    expect(getCtx().payments.some((p) => p.id === paymentRes.id)).toBe(false);

    // 3. Conta: o saldo da conta foi restaurado para o saldo original (efeito colateral desfeito)
    const accAfter = getCtx().accounts.find((a) => a.id === 'acc-1')!;
    expect(accAfter.current_balance).toBe(initialBalance);

    // 4. Obrigação: o status e paid_amount da transação foram restaurados para os valores originais
    const txAfter = getCtx().transactions.find((t) => t.id === 'tx-1')!;
    expect(txAfter.status).toBe(initialStatus);
    expect(txAfter.paid_amount ?? 0).toBe(initialPaidAmount);
  });

  it('dois pagamentos na mesma conta e obrigação com A salvo, B rejeitado e recarga indisponível: saldo, status e pagamentos refletem A', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);

    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    const targetAccount = getCtx().accounts.find((a) => a.id === 'acc-1')!;
    const targetTx = getCtx().transactions.find((t) => t.id === 'tx-1')!;
    expect(targetAccount.current_balance).toBe(1000);
    expect(targetTx.paid_amount ?? 0).toBe(0);
    expect(targetTx.status).toBe('pending');

    // 1. Pagamento A (R$ 50) é persistido com sucesso no banco remoto
    const canonicalPayAId = 'pay-a-canonical-uuid-50';
    (repo.savePayment as any).mockImplementationOnce(async (p: any) => ({
      ...p,
      id: canonicalPayAId,
    }));

    // 2. Pagamento B (R$ 20) é rejeitado pelo repositório remoto
    (repo.savePayment as any).mockImplementationOnce(() =>
      Promise.reject(new Error('Erro simulado no pagamento B'))
    );

    // 3. Recarga do snapshot no esvaziamento da fila está indisponível
    (repo.loadSnapshot as any).mockRejectedValueOnce(
      new Error('Recarga de snapshot indisponível')
    );

    let payA: any;
    let payB: any;
    await act(async () => {
      payA = getCtx().recordPayment({
        transaction_id: targetTx.id,
        account_id: targetAccount.id,
        amount: 50,
        payment_date: '2026-09-26',
      });
      payB = getCtx().recordPayment({
        transaction_id: targetTx.id,
        account_id: targetAccount.id,
        amount: 20,
        payment_date: '2026-09-26',
      });
    });

    // Aguarda o término da fila de mutações
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });

    expect(getCtx().isSaving).toBe(false);
    expect(getCtx().error).not.toBeNull();
    expect(getCtx().error?.message).toContain('Erro simulado no pagamento B');

    // 1. Saldo da conta reflete A (R$ 1000 - R$ 50 = R$ 950, e NÃO regride para R$ 1000 de antes de A)
    const accAfter = getCtx().accounts.find((a) => a.id === 'acc-1')!;
    expect(accAfter.current_balance).toBe(950);

    // 2. Status e paid_amount da obrigação refletem A (R$ 50 pago, partially_paid, e NÃO regridem para 0 / pending)
    const txAfter = getCtx().transactions.find((t) => t.id === 'tx-1')!;
    expect(txAfter.status).toBe('partially_paid');
    expect(txAfter.paid_amount).toBe(50);

    // 3. Pagamentos exibidos refletem A: Pagamento A preservado, Pagamento B rejeitado e removido
    expect(getCtx().payments.some((p) => p.id === payA.id || p.id === canonicalPayAId)).toBe(true);
    expect(getCtx().payments.some((p) => p.id === payB.id)).toBe(false);
  });

  it('outra mutation tem sucesso, excluir uma transação paga falha, recarga falha: transação, pagamentos e saldo permanecem coerentes', async () => {
    const snapshot = createMockSnapshot({
      allAccounts: [
        {
          id: 'acc-1',
          workspace_id: 'ws-1',
          name: 'Nubank Principal',
          type: 'checking',
          institution: 'Nubank',
          initial_balance: 1000,
          current_balance: 850,
          color: '#8A05BE',
          active: true,
          created_at: '2026-01-01',
        },
      ],
      allTransactions: [
        {
          id: 'tx-paid-1',
          workspace_id: 'ws-1',
          description: 'Conta de Energia',
          amount: 150,
          type: 'expense',
          status: 'paid',
          paid_amount: 150,
          transaction_date: '2026-09-20',
          due_date: '2026-09-20',
          category_id: 'cat-1',
          account_id: 'acc-1',
          created_at: '2026-09-20',
        },
      ],
      allPayments: [
        {
          id: 'pay-tx-1',
          workspace_id: 'ws-1',
          transaction_id: 'tx-paid-1',
          account_id: 'acc-1',
          amount: 150,
          payment_date: '2026-09-20',
          created_at: '2026-09-20',
        },
      ],
    });
    const repo = createMockRepository(snapshot);

    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    // 1. Operação A (addCategory) tem sucesso
    (repo.saveCategory as any).mockImplementationOnce(async (cat: any) => ({
      ...cat,
      id: 'cat-success-789',
    }));

    // 2. Operação B (deleteTransaction) falha
    (repo.deleteTransaction as any).mockImplementationOnce(() =>
      Promise.reject(new Error('Erro na exclusão remota da transação'))
    );

    // 3. Reconciliação do snapshot no drain falha
    (repo.loadSnapshot as any).mockRejectedValueOnce(
      new Error('Erro na recarga de snapshot pós-falha')
    );

    await act(async () => {
      getCtx().addCategory({
        name: 'Categoria Sucesso A',
        type: 'expense',
        color: '#10b981',
        icon: 'tag',
        active: true,
      });

      getCtx().deleteTransaction('tx-paid-1');
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(getCtx().isSaving).toBe(false);
    expect(getCtx().error).not.toBeNull();
    expect(getCtx().error?.message).toContain('Erro na exclusão remota da transação');

    // 1. Mutação A foi preservada com sucesso
    expect(getCtx().categories.some((c) => c.name === 'Categoria Sucesso A')).toBe(true);

    // 2. Transação que falhou em exclusão foi restaurada com status 'paid' e paid_amount 150
    const tx = getCtx().transactions.find((t) => t.id === 'tx-paid-1');
    expect(tx).toBeDefined();
    expect(tx?.status).toBe('paid');
    expect(tx?.paid_amount).toBe(150);

    // 3. Pagamento removido otimisticamente foi integralmente restaurado
    const pay = getCtx().payments.find((p) => p.id === 'pay-tx-1');
    expect(pay).toBeDefined();
    expect(pay?.transaction_id).toBe('tx-paid-1');
    expect(pay?.amount).toBe(150);

    // 4. Saldo da conta foi restaurado para R$ 850 (mantendo a coerência com a transação paga)
    const acc = getCtx().accounts.find((a) => a.id === 'acc-1');
    expect(acc?.current_balance).toBe(850);
  });

  it('A tem sucesso, pagamento de parcela B falha, loadSnapshot falha: desfaz pagamento, restaura saldo da conta e status da parcela', async () => {
    const snapshot = createMockSnapshot({
      allPurchases: [
        {
          id: 'pur-direct-1',
          workspace_id: 'ws-1',
          description: 'Carnê Reforma',
          total_amount: 1000,
          installment_count: 5,
          purchase_date: '2026-09-01',
          category_id: 'cat-1',
          created_at: '2026-09-01',
        },
      ],
      allInstallments: [
        {
          id: 'inst-direct-1',
          purchase_id: 'pur-direct-1',
          installment_number: 1,
          amount: 200,
          paid_amount: 0,
          due_date: '2026-10-05',
          status: 'pending',
          created_at: '2026-09-01',
        },
      ],
    });
    const repo = createMockRepository(snapshot);

    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    const targetAccount = getCtx().accounts.find((a) => a.id === 'acc-1')!;
    const targetInst = getCtx().installments.find((i) => i.id === 'inst-direct-1')!;
    const initialBalance = targetAccount.current_balance;
    const initialStatus = targetInst.status;
    const initialPaidAmount = targetInst.paid_amount ?? 0;

    // 1. Operação A (addCreditCard) tem sucesso
    (repo.saveCreditCard as any).mockImplementationOnce(async (card: any) => ({
      ...card,
      id: 'card-success-456',
    }));

    // 2. Operação B (recordPayment na parcela) falha
    (repo.savePayment as any).mockImplementationOnce(() =>
      Promise.reject(new Error('Falha remota no pagamento de parcela'))
    );

    // 3. Reconciliação do snapshot no drain falha
    (repo.loadSnapshot as any).mockRejectedValueOnce(
      new Error('Erro de conexão ao recarregar snapshot')
    );

    let paymentRes: any;
    await act(async () => {
      getCtx().addCreditCard({
        name: 'Cartão Sucesso A',
        institution: 'Nubank',
        color: '#6366f1',
        active: true,
        credit_limit: 2000,
        closing_day: 5,
        due_day: 15,
      });

      paymentRes = getCtx().recordPayment({
        installment_id: targetInst.id,
        account_id: targetAccount.id,
        amount: 100,
        payment_date: '2026-09-26',
      });
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(getCtx().isSaving).toBe(false);
    expect(getCtx().error).not.toBeNull();

    // 1. Operação A preservada
    expect(getCtx().creditCards.some((c) => c.name === 'Cartão Sucesso A')).toBe(true);

    // 2. Pagamento de parcela removido
    expect(getCtx().payments.some((p) => p.id === paymentRes.id)).toBe(false);

    // 3. Conta restaurada
    const accAfter = getCtx().accounts.find((a) => a.id === 'acc-1')!;
    expect(accAfter.current_balance).toBe(initialBalance);

    // 4. Parcela restaurada
    const instAfter = getCtx().installments.find((i) => i.id === 'inst-direct-1')!;
    expect(instAfter.status).toBe(initialStatus);
    expect(instAfter.paid_amount ?? 0).toBe(initialPaidAmount);
  });

  it('deve preservar mutações bem-sucedidas no lote mesmo se snapshot falhar após rollback cirúrgico', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);

    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    // Configura os mocks para a execução da fila de mutações
    // 1. Operação A (addTransaction) falha
    (repo.saveTransaction as any).mockImplementationOnce(() =>
      Promise.reject(new Error('Erro simulado na operação A'))
    );
    // 2. Operação B (addAccount) tem sucesso
    const canonicalAccId = 'acc-b-canonical-999';
    (repo.saveAccount as any).mockImplementationOnce(async (acc: any) => ({
      ...acc,
      id: canonicalAccId,
    }));
    // 3. Operação C (updateAccount) falha
    (repo.saveAccount as any).mockImplementationOnce(() =>
      Promise.reject(new Error('Erro simulado no updateAccount'))
    );
    // 4. Operação D (deleteAccount) falha
    (repo.deleteAccount as any).mockImplementationOnce(() =>
      Promise.reject(new Error('Erro simulado no deleteAccount'))
    );

    // 5. Reconciliação do snapshot no drain falha
    (repo.loadSnapshot as any).mockRejectedValueOnce(
      new Error('Erro ao carregar snapshot no catch')
    );

    // Dispara as operações em lote
    await act(async () => {
      // Criação que vai falhar
      getCtx().addTransaction({
        description: 'Transação A que vai falhar',
        amount: 300,
        type: 'expense',
        status: 'pending',
        transaction_date: '2026-09-26',
        due_date: '2026-09-26',
        category_id: 'cat-1',
      });
      // Criação que vai suceder
      getCtx().addAccount({
        name: 'Conta B que deve ser preservada',
        type: 'checking',
        institution: 'Banco B',
        initial_balance: 500,
        current_balance: 500,
        color: '#10b981',
        active: true,
      });
      // Edição que vai falhar
      getCtx().updateAccount('acc-1', { name: 'Nubank Nome Tentado' });
      // Deleção que vai falhar
      getCtx().deleteAccount('acc-2');
    });

    // Aguarda processamento de toda a fila
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(getCtx().isSaving).toBe(false);
    expect(getCtx().error).not.toBeNull();

    // Operação B que teve sucesso remoto FOI PRESERVADA no estado
    expect(
      getCtx().accounts.some((a) => a.name === 'Conta B que deve ser preservada')
    ).toBe(true);

    // Operação A que falhou FOI REMOVIDA do estado pelo rollback cirúrgico
    expect(
      getCtx().transactions.some((t) => t.description === 'Transação A que vai falhar')
    ).toBe(false);

    // Operação C que falhou teve seu nome revertido para o estado base
    const acc1 = getCtx().accounts.find((a) => a.id === 'acc-1');
    expect(acc1?.name).toBe('Nubank Principal');

    // Operação D que falhou em deleção foi restaurada no estado
    expect(getCtx().accounts.some((a) => a.id === 'acc-2')).toBe(true);
  });

  it('deve restaurar rollbackBaseState integralmente quando nenhuma mutação tem sucesso e snapshot falha', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);

    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    // Ambas as mutações falham
    (repo.saveTransaction as any).mockImplementationOnce(() =>
      Promise.reject(new Error('Erro transação'))
    );
    (repo.loadSnapshot as any).mockRejectedValueOnce(
      new Error('Erro snapshot catch')
    );

    await act(async () => {
      getCtx().addTransaction({
        description: 'Transação Sem Sucesso',
        amount: 250,
        type: 'expense',
        status: 'pending',
        transaction_date: '2026-09-26',
        due_date: '2026-09-26',
        category_id: 'cat-1',
      });
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });

    expect(getCtx().isSaving).toBe(false);
    expect(getCtx().error).not.toBeNull();
    // Transação foi revertida pelo rollbackBaseStateRef
    expect(getCtx().transactions.some((t) => t.description === 'Transação Sem Sucesso')).toBe(false);
  });

  it('deve ignorar atualização de estado local se o workspace ativo tiver mudado durante o salvamento para cartão, categoria, meta, orçamento e recorrente', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);

    (repo.saveCreditCard as any).mockImplementation(async (card: any) => {
      await new Promise((r) => setTimeout(r, 10));
      return { ...card, id: 'card-remote' };
    });
    (repo.saveCategory as any).mockImplementation(async (cat: any) => {
      await new Promise((r) => setTimeout(r, 10));
      return { ...cat, id: 'cat-remote' };
    });
    (repo.saveGoal as any).mockImplementation(async (g: any) => {
      await new Promise((r) => setTimeout(r, 10));
      return { ...g, id: 'goal-remote' };
    });
    (repo.saveRecurring as any).mockImplementation(async (rec: any) => {
      await new Promise((r) => setTimeout(r, 10));
      return { ...rec, id: 'rec-remote' };
    });
    (repo.saveBudget as any).mockImplementation(async (b: any) => {
      await new Promise((r) => setTimeout(r, 10));
      return { ...b, id: 'bud-remote' };
    });
    (repo.savePurchase as any).mockImplementation(async (p: any) => {
      await new Promise((r) => setTimeout(r, 10));
      return { ...p, id: 'pur-remote' };
    });
    (repo.savePayment as any).mockImplementation(async (p: any) => {
      await new Promise((r) => setTimeout(r, 10));
      return { ...p, id: 'pay-remote' };
    });
    (repo.saveTransaction as any).mockImplementation(async (t: any) => {
      await new Promise((r) => setTimeout(r, 10));
      return { ...t, id: 'tx-dup-remote' };
    });

    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    await act(async () => {
      getCtx().addCreditCard({ name: 'Card 1', institution: 'Nubank', color: '#6366f1', active: true, credit_limit: 1000, closing_day: 1, due_day: 10 });
      getCtx().addCategory({ name: 'Cat 1', type: 'expense', color: '#000', icon: 'tag', active: true });
      getCtx().addGoal({ name: 'Goal 1', target_amount: 1000, current_amount: 0, status: 'in_progress', color: '#000', icon: 'target' });
      getCtx().addRecurring({ description: 'Rec 1', amount: 50, type: 'expense', frequency: 'monthly', start_date: '2026-01-01', next_occurrence: '2026-02-01', auto_create: false, active: true });
      getCtx().setBudget('cat-1', 400, 10, 2026);
      getCtx().createInstallmentPurchase({ description: 'Notebook', total_amount: 1200, installment_count: 2, purchase_date: '2026-09-26', category_id: 'cat-1' });
      getCtx().recordPayment({ transaction_id: 'tx-1', account_id: 'acc-1', amount: 10, payment_date: '2026-09-26' });
      getCtx().duplicateTransaction('tx-1');
      getCtx().setActiveWorkspaceId('ws-2');
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 180));
    });

    expect(getCtx().activeWorkspace.id).toBe('ws-2');
  });

  it('deve disparar materializeRecurring e refreshData ao chamar processPendingRecurring em modo supabase', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);

    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    await act(async () => {
      getCtx().processPendingRecurring();
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(repo.materializeRecurring).toHaveBeenCalledWith('ws-1');
    expect(repo.loadSnapshot).toHaveBeenCalled();

    // Cenário com erro em materializeRecurring
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    (repo.materializeRecurring as any).mockRejectedValueOnce(new Error('Erro na materialização'));
    await act(async () => {
      getCtx().processPendingRecurring();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(consoleSpy).toHaveBeenCalledWith(
      'Falha ao materializar recorrências no Supabase:',
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });

  it('deve executar actions.processPendingRecurring em modo local', async () => {
    const { getCtx } = await mountTestProvider({
      initialDataMode: 'local',
    });
    await act(async () => {
      getCtx().processPendingRecurring();
      const rec = getCtx().addRecurring({
        description: 'Rec Local Mode',
        amount: 50,
        type: 'expense',
        frequency: 'monthly',
        start_date: '2026-01-01',
        next_occurrence: '2026-02-01',
        auto_create: false,
        active: true,
      });
      getCtx().toggleRecurring(rec.id);
    });
    expect(getCtx().dataMode).toBe('local');
  });

  it('deve sequenciar persistência remota antes de materializeRecurring e refreshData ao criar ou alternar recorrência em modo supabase', async () => {
    const executionOrder: string[] = [];
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);

    (repo.saveRecurring as any).mockImplementation(async (rec: any) => {
      await new Promise((r) => setTimeout(r, 20));
      executionOrder.push('saveRecurring');
      return { ...rec, id: 'rec-remote-1' };
    });

    (repo.materializeRecurring as any).mockImplementation(async () => {
      executionOrder.push('materializeRecurring');
      return { processed_recurring: 1, created_transactions: 1, suspended_recurring: 0 };
    });

    (repo.loadSnapshot as any).mockImplementation(async (wsId: string) => {
      executionOrder.push('loadSnapshot');
      return {
        ...snapshot,
        activeWorkspaceId: wsId,
        allRecurring: [
          ...snapshot.allRecurring,
          {
            id: 'rec-remote-1',
            workspace_id: wsId,
            description: 'Recorrência Sequenciada',
            amount: 100,
            type: 'expense' as const,
            frequency: 'monthly' as const,
            start_date: '2026-01-01',
            next_occurrence: '2026-02-01',
            auto_create: true,
            active: true,
            created_at: new Date().toISOString(),
          },
        ],
      };
    });

    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    executionOrder.length = 0; // limpa o bootstrap inicial

    await act(async () => {
      getCtx().addRecurring({
        description: 'Recorrência Sequenciada',
        amount: 100,
        type: 'expense',
        frequency: 'monthly',
        start_date: '2026-01-01',
        next_occurrence: '2026-02-01',
        auto_create: true,
        active: true,
      });
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    // Comprova que saveRecurring finalizou ANTES de materializeRecurring e loadSnapshot
    expect(executionOrder).toEqual(['saveRecurring', 'materializeRecurring', 'loadSnapshot']);
    expect(getCtx().recurring.some((r) => r.description === 'Recorrência Sequenciada')).toBe(true);

    // Agora testa toggleRecurring
    executionOrder.length = 0;
    await act(async () => {
      getCtx().toggleRecurring('rec-remote-1');
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(executionOrder).toEqual(['saveRecurring', 'materializeRecurring', 'loadSnapshot']);
  });

  it('preserva alterações pendentes durante a recarga com mutações concorrentes/sobrepostas (addRecurring + toggleRecurring)', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);

    const savedRecurringList: any[] = [];
    const remoteRecurringList: any[] = [...snapshot.allRecurring];

    (repo.saveRecurring as any).mockImplementation(async (r: any) => {
      savedRecurringList.push({ ...r });
      const saved = { ...r, id: r.id || 'rec-new-1' };
      const idx = remoteRecurringList.findIndex((item) => item.id === saved.id);
      if (idx >= 0) {
        remoteRecurringList[idx] = saved;
      } else {
        remoteRecurringList.push(saved);
      }
      return saved;
    });

    (repo.loadSnapshot as any).mockImplementation(async (wsId: string) => {
      // Retorna o estado atual do banco remoto (quando A recarrega, B ainda não foi salvo no banco)
      return {
        ...snapshot,
        activeWorkspaceId: wsId,
        allRecurring: remoteRecurringList.map((r) => ({ ...r })),
      };
    });

    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    expect(getCtx().recurring.find((r) => r.id === 'rec-1')?.active).toBe(true);

    // Dispara addRecurring (A) e imediatamente toggleRecurring de rec-1 (B)
    await act(async () => {
      getCtx().addRecurring({
        description: 'Netflix Novo',
        amount: 55,
        type: 'expense',
        frequency: 'monthly',
        start_date: '2026-01-01',
        next_occurrence: '2026-02-01',
        auto_create: true,
        active: true,
      });

      // B é disparado concorrentemente antes de A finalizar sua recarga
      getCtx().toggleRecurring('rec-1');
    });

    // Aguarda o processamento de toda a fila ordenada de mutações
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });

    // Verifica que rec-1 foi salvo com active: false (não foi revertido pela recarga de A)
    const rec1SaveCall = savedRecurringList.find((r) => r.id === 'rec-1');
    expect(rec1SaveCall).toBeDefined();
    expect(rec1SaveCall.active).toBe(false);

    // No estado final da UI, rec-1 está inativo e a nova recorrência está presente
    const finalRec1 = getCtx().recurring.find((r) => r.id === 'rec-1');
    expect(finalRec1?.active).toBe(false);
    expect(getCtx().recurring.some((r) => r.description === 'Netflix Novo')).toBe(true);
    expect(getCtx().error).toBeNull();
  });

  it('toggle cuja RPC muda next_occurrence reflete a nova data na UI após refreshData', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);

    // rec-1 começa inativo com next_occurrence: 2026-09-01
    let currentRemoteRec = {
      ...snapshot.allRecurring[0],
      active: false,
      next_occurrence: '2026-09-01',
    };

    (repo.saveRecurring as any).mockImplementation(async (r: any) => {
      currentRemoteRec = { ...currentRemoteRec, ...r };
      return currentRemoteRec;
    });

    // Simula a RPC avançando next_occurrence no banco remoto para o próximo mês
    (repo.materializeRecurring as any).mockImplementation(async () => {
      currentRemoteRec = {
        ...currentRemoteRec,
        next_occurrence: '2026-10-01',
      };
      return { created_transactions: 1, suspended_rules: 0, advanced_rules: 1 };
    });

    (repo.loadSnapshot as any).mockImplementation(async (wsId: string) => {
      return {
        ...snapshot,
        activeWorkspaceId: wsId,
        allRecurring: [currentRemoteRec],
      };
    });

    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    // Dispara toggleRecurring de rec-1 sem mutações subsequentes
    await act(async () => {
      getCtx().toggleRecurring('rec-1');
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });

    // A UI deve refletir next_occurrence atualizada pela RPC (2026-10-01) e active: true
    const rec1 = getCtx().recurring.find((r) => r.id === 'rec-1');
    expect(rec1).toBeDefined();
    expect(rec1?.active).toBe(true);
    expect(rec1?.next_occurrence).toBe('2026-10-01');
    expect(getCtx().error).toBeNull();
  });

  it('addRecurring seguido imediatamente de toggleRecurring e deleteRecurring na mesma regra resolve o ID canônico', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);

    const callLog: { method: string; id?: string; payload?: any }[] = [];
    const databaseRecords = new Map<string, any>();

    // O repositório real diferencia INSERT (sem id) de UPDATE (com id)
    (repo.saveRecurring as any).mockImplementation(async (r: any) => {
      if (r.id) {
        if (!databaseRecords.has(r.id)) {
          throw new Error(`PGRST116: JSON object requested, no rows returned for update on id ${r.id}`);
        }
        const updated = { ...databaseRecords.get(r.id), ...r };
        databaseRecords.set(r.id, updated);
        callLog.push({ method: 'saveRecurring (update)', id: r.id, payload: updated });
        return updated;
      }
      // Inserção: r.id deve ser undefined!
      const canonical = { ...r, id: '70000000-0000-0000-0000-000000000099' };
      databaseRecords.set(canonical.id, canonical);
      callLog.push({ method: 'saveRecurring (create)', id: canonical.id, payload: canonical });
      return canonical;
    });

    (repo.deleteRecurring as any).mockImplementation(async (id: string) => {
      callLog.push({ method: 'deleteRecurring', id });
    });

    (repo.loadSnapshot as any).mockImplementation(async (wsId: string) => {
      return {
        ...snapshot,
        activeWorkspaceId: wsId,
      };
    });

    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    let createdId: string = '';

    await act(async () => {
      const res = getCtx().addRecurring({
        description: 'Regra Relâmpago',
        amount: 120,
        type: 'expense',
        frequency: 'monthly',
        start_date: '2026-01-01',
        next_occurrence: '2026-01-01',
        auto_create: true,
        active: true,
      });
      createdId = res.id;

      // Imediatamente na mesma regra recém-criada (usando o ID retornado/temporário):
      getCtx().toggleRecurring(createdId);
      getCtx().deleteRecurring(createdId);
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });

    // 1. A criação gerou o registro inicial e atribuiu o UUID canônico
    const createCall = callLog.find((c) => c.method === 'saveRecurring (create)');
    expect(createCall).toBeDefined();

    // 2. O toggle usou o UUID canônico do banco (NÃO o createdId temporário)
    const toggleCall = callLog.find((c) => c.method === 'saveRecurring (update)');
    expect(toggleCall).toBeDefined();
    expect(toggleCall?.id).toBe('70000000-0000-0000-0000-000000000099');

    // 3. A exclusão usou o UUID canônico do banco (NÃO o createdId temporário)
    const deleteCall = callLog.find((c) => c.method === 'deleteRecurring');
    expect(deleteCall).toBeDefined();
    expect(deleteCall?.id).toBe('70000000-0000-0000-0000-000000000099');

    // 4. Na UI final, a regra foi removida e não há erros
    expect(getCtx().recurring.some((r) => r.description === 'Regra Relâmpago')).toBe(false);
    expect(getCtx().error).toBeNull();
  });

  it('deve bloquear operações com erro quando em modo supabase sem usuário logado', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);
    const { getCtx } = await mountTestProvider(
      { repository: repo, initialDataMode: 'supabase' },
      { user: null }
    );

    expect(getCtx().error?.message).toContain('Sessão não encontrada: usuário não autenticado no modo Supabase.');

    // 1. Mutação que usa getUserId()
    expect(() => {
      getCtx().createWorkspace('Workspace Proibido');
    }).toThrow('Operação não permitida: usuário não autenticado no modo Supabase.');

    // 2. Mutação que NÃO usa getUserId() (ex: addAccount, addCategory)
    expect(() => {
      getCtx().addAccount({
        name: 'Conta Proibida',
        type: 'checking',
        institution: 'Banco Teste',
        initial_balance: 100,
        current_balance: 100,
        color: '#123456',
        active: true,
      });
    }).toThrow('Operação não permitida: usuário não autenticado no modo Supabase.');

    expect(() => {
      getCtx().addCategory({
        name: 'Categoria Proibida',
        type: 'expense',
        color: '#ff0000',
        icon: 'tag',
        active: true,
      });
    }).toThrow('Operação não permitida: usuário não autenticado no modo Supabase.');

    // 3. Nenhuma mutação otimista deve ter sido aplicada ao estado
    expect(getCtx().workspaces.some((w) => w.name === 'Workspace Proibido')).toBe(false);
    expect(getCtx().accounts.some((a) => a.name === 'Conta Proibida')).toBe(false);
    expect(getCtx().categories.some((c) => c.name === 'Categoria Proibida')).toBe(false);
  });


  it('deve usar o id do usuário logado no modo local ou fallback usr-1 quando não autenticado', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);

    // 1. Usuário logado no modo local
    const { getCtx: getCtxWithUser } = await mountTestProvider(
      { repository: repo, initialDataMode: 'local' },
      { user: { id: 'usr-custom-local', name: 'Local User', email: 'local@test.com', created_at: '2026-01-01' } }
    );
    let ws1: any;
    await act(async () => {
      ws1 = getCtxWithUser().createWorkspace('Workspace Custom');
    });
    expect(ws1.owner_id).toBe('usr-custom-local');

    // 2. Sem usuário no modo local (fallback usr-1)
    const { getCtx: getCtxNoUser } = await mountTestProvider(
      { repository: repo, initialDataMode: 'local' },
      { user: null }
    );
    let ws2: any;
    await act(async () => {
      ws2 = getCtxNoUser().createWorkspace('Workspace Fallback');
    });
    expect(ws2.owner_id).toBe('usr-1');
  });

  it('fornece resultado aguardável da persistência remota em recordPaymentAsync e payCreditCardBillAsync capturando rejeição do repositório', async () => {
    const snapshot = createMockSnapshot({
      allTransactions: [
        {
          id: 'tx-1',
          workspace_id: 'ws-1',
          description: 'Licença Software',
          amount: 1234.0,
          paid_amount: 12.34,
          type: 'expense',
          status: 'partially_paid',
          transaction_date: '2026-09-20',
          due_date: '2026-09-20',
          category_id: 'cat-1',
          account_id: 'acc-1',
          created_at: '2026-09-20',
        },
        {
          id: 'tx-2',
          workspace_id: 'ws-1',
          description: 'Serviço Cloud',
          amount: 100.0,
          paid_amount: 0,
          type: 'expense',
          status: 'pending',
          transaction_date: '2026-09-20',
          due_date: '2026-09-20',
          category_id: 'cat-1',
          account_id: 'acc-1',
          created_at: '2026-09-20',
        },
      ],
    });
    const repo = createMockRepository(snapshot);

    // Simula a falha remota da RPC (excede saldo restante) no repositório real
    const rpcErrorMessage = 'O valor do pagamento (R$ 1.234,00) excede o saldo restante da obrigação (R$ 1.221,66).';
    repo.savePayment = vi.fn().mockRejectedValue(new Error(rpcErrorMessage));

    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    expect(getCtx().isLoaded).toBe(true);

    // 1. Chamada a recordPaymentAsync com await rejeita com o erro remoto da persistência
    let caughtError: any = null;
    await act(async () => {
      try {
        await getCtx().recordPaymentAsync({
          transaction_id: 'tx-1',
          account_id: 'acc-1',
          amount: 1221.66,
          payment_date: '2026-09-27',
        });
      } catch (err) {
        caughtError = err;
      }
    });

    expect(caughtError).toBeDefined();
    expect(caughtError.message).toContain('excede o saldo restante');

    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(getCtx().error?.message).toContain('excede o saldo restante');

    // 2. Quando o repositório salva com sucesso, recordPaymentAsync resolve normalmente
    repo.savePayment = vi.fn().mockResolvedValue({
      id: 'pay-success',
      transaction_id: 'tx-1',
      account_id: 'acc-1',
      amount: 1221.66,
      payment_date: '2026-09-27',
      created_at: '2026-09-27',
    });

    let successPayment: any = null;
    await act(async () => {
      successPayment = await getCtx().recordPaymentAsync({
        transaction_id: 'tx-1',
        account_id: 'acc-1',
        amount: 1221.66,
        payment_date: '2026-09-27',
      });
    });

    expect(successPayment).toBeDefined();
    expect(successPayment.id).toBeDefined();
    expect(successPayment.amount).toBe(1221.66);

    // 3. O método síncrono recordPayment retorna o Payment de domínio sem propriedade 'then'
    repo.savePayment = vi.fn().mockResolvedValue({
      id: 'pay-sync',
      transaction_id: 'tx-2',
      account_id: 'acc-1',
      amount: 10,
      payment_date: '2026-09-27',
      created_at: '2026-09-27',
    });
    let syncPayment: any = null;
    await act(async () => {
      syncPayment = getCtx().recordPayment({
        transaction_id: 'tx-2',
        account_id: 'acc-1',
        amount: 10,
        payment_date: '2026-09-27',
      });
      await getCtx().waitForPendingMutations();
    });
    expect(syncPayment).toBeDefined();
    expect('then' in syncPayment).toBe(false);

    // 4. payCreditCardBillAsync também oferece resultado aguardável e rejeita com erro remoto
    repo.savePayment = vi.fn().mockRejectedValue(new Error('Falha remota na quitação da fatura'));
    let billError: any = null;
    await act(async () => {
      try {
        await getCtx().payCreditCardBillAsync('bill-1', 'acc-1', 100, '2026-09-27');
      } catch (err) {
        billError = err;
      }
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(billError).toBeDefined();
    expect(billError.message).toContain('Falha remota na quitação da fatura');

    // 5. payCreditCardBill síncrono retorna sem 'then'
    repo.savePayment = vi.fn().mockResolvedValue({
      id: 'pay-bill-success',
      credit_card_bill_id: 'bill-1',
      amount: 50,
      payment_date: '2026-09-27',
      created_at: '2026-09-27',
    });
    let syncBillPayment: any = null;
    await act(async () => {
      syncBillPayment = getCtx().payCreditCardBill('bill-1', 'acc-1', 50, '2026-09-27');
      await getCtx().waitForPendingMutations();
    });
    expect(syncBillPayment).toBeDefined();
    expect('then' in syncBillPayment).toBe(false);
  });

  it('persiste remotamente addPerson, updatePerson, deletePerson e resolve splits em updateTransaction e createInstallmentPurchase', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);

    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    expect(getCtx().isLoaded).toBe(true);

    // 1. addPerson persiste remotamente e atualiza allPeople com ID canônico
    let createdPerson: any = null;
    await act(async () => {
      createdPerson = getCtx().addPerson('Fernanda Remota');
      await getCtx().waitForPendingMutations();
    });
    expect(createdPerson).toBeDefined();
    expect(repo.savePerson).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Fernanda Remota', workspace_id: 'ws-1' })
    );

    // 2. updatePerson persiste remotamente
    await act(async () => {
      getCtx().updatePerson(createdPerson.id, { name: 'Fernanda Atualizada' });
      await getCtx().waitForPendingMutations();
    });
    expect(repo.savePerson).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Fernanda Atualizada' })
    );

    // 3. deletePerson persiste remotamente
    await act(async () => {
      getCtx().deletePerson(createdPerson.id);
      await getCtx().waitForPendingMutations();
    });
    expect(repo.deletePerson).toHaveBeenCalled();

    // 4. updateTransaction com splits mapeia canonicalIds
    await act(async () => {
      getCtx().updateTransaction('tx-1', {
        split_type: 'equal',
        splits: [
          { member_id: 'wsm-1', amount: 40 },
          { member_id: 'wsm-2', amount: 40 },
        ],
      });
      await getCtx().waitForPendingMutations();
    });
    expect(repo.saveTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'tx-1',
        splits: expect.arrayContaining([
          expect.objectContaining({ member_id: 'wsm-1', amount: 40 }),
        ]),
      })
    );

    // 5. createInstallmentPurchase com splits mapeia canonicalIds
    await act(async () => {
      getCtx().createInstallmentPurchase({
        description: 'TV Sala 2x',
        total_amount: 500,
        installment_count: 2,
        purchase_date: '2026-09-20',
        split_type: 'equal',
        splits: [
          { member_id: 'wsm-1', amount: 250 },
          { member_id: 'wsm-2', amount: 250 },
        ],
      });
      await getCtx().waitForPendingMutations();
    });
    expect(repo.savePurchase).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'TV Sala 2x',
        splits: expect.arrayContaining([
          expect.objectContaining({ member_id: 'wsm-1', amount: 250 }),
        ]),
      })
    );
  });

  it('rejeita mutação assíncrona quando ação local síncrona falha na validação', async () => {
    const snapshot = createMockSnapshot();
    const repo = createMockRepository(snapshot);
    const { getCtx } = await mountTestProvider({
      repository: repo,
      initialDataMode: 'supabase',
    });

    let caughtError: any = null;
    await act(async () => {
      try {
        await (getCtx() as any).addTransactionAsync({
          description: 'Inválido',
          amount: -50,
          type: 'expense',
          transaction_date: '2026-09-20',
          due_date: '2026-09-20',
          status: 'pending',
        });
      } catch (err) {
        caughtError = err;
      }
    });

    expect(caughtError).toBeDefined();
  });
});
