import { describe, it, expect, vi } from 'vitest';
import { SupabaseFinanceRepository } from '../../repositories/supabase-finance-repository';
import { RepositoryError } from '../../repositories/repository-errors';
import { SupabaseClient } from '@supabase/supabase-js';

function createMockSupabaseClient() {
  const queryBuilder: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
  };

  const client = {
    from: vi.fn().mockReturnValue(queryBuilder),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  } as unknown as SupabaseClient<any>;

  return { client, queryBuilder };
}

describe('SupabaseFinanceRepository', () => {
  it('loads snapshot in parallel across tables and resolves relations', async () => {
    const { client } = createMockSupabaseClient();

    const mockTableData: Record<string, any> = {
      workspaces: [{ id: 'ws-1', name: 'Ws 1', owner_id: 'u-1', currency: 'BRL', tracking_mode: 'full', created_at: '2026-01-01' }],
      workspace_members: [
        { id: 'm-1', workspace_id: 'ws-1', user_id: 'u-1', role: 'owner', created_at: '2026-01-01', profiles: { id: 'u-1', name: 'User 1' } },
        { id: 'm-2', workspace_id: 'ws-1', user_id: 'u-2', role: 'member', created_at: '2026-01-01', profiles: [{ id: 'u-2', name: 'User 2' }] },
      ],
      accounts: [{ id: 'a-1', workspace_id: 'ws-1', name: 'Conta', current_balance: 100, initial_balance: 100, type: 'checking', active: true }],
      credit_cards: [{ id: 'c-1', workspace_id: 'ws-1', name: 'Cartão', credit_limit: 1000, closing_day: 1, due_day: 10, active: true }],
      credit_card_bills: [{ id: 'b-1', credit_card_id: 'c-1', workspace_id: 'ws-1', reference_month: '2026-04', closing_date: '2026-04-01', due_date: '2026-04-10', total_amount: 100, paid_amount: 0, status: 'open' }],
      payment_methods: [{ id: 'pm-1', workspace_id: 'ws-1', name: 'Pix', type: 'pix', active: true }],
      categories: [{ id: 'cat-1', workspace_id: 'ws-1', name: 'Mercado', type: 'expense', active: true }],
      transactions: [{ id: 'tx-1', workspace_id: 'ws-1', description: 'Compra', amount: 50, transaction_date: '2026-04-01', due_date: '2026-04-01', type: 'expense', status: 'completed' }],
      transaction_splits: [{ id: 'ts-1', transaction_id: 'tx-1', workspace_id: 'ws-1', member_id: 'm-1', amount: 50 }],
      purchases: [{ id: 'p-1', workspace_id: 'ws-1', description: 'TV', total_amount: 1200, installment_count: 12, purchase_date: '2026-04-01' }],
      purchase_splits: [{ id: 'ps-1', purchase_id: 'p-1', workspace_id: 'ws-1', member_id: 'm-1', amount: 1200 }],
      payments: [{ id: 'pay-1', workspace_id: 'ws-1', amount: 100, payment_date: '2026-04-01', affects_balance: true }],
      transfers: [{ id: 'tr-1', workspace_id: 'ws-1', from_account_id: 'a-1', to_account_id: 'a-2', amount: 50, transfer_date: '2026-04-01' }],
      recurring_transactions: [{ id: 'r-1', workspace_id: 'ws-1', description: 'Net', amount: 30, frequency: 'monthly', day_of_month: 5, active: true }],
      budgets: [{ id: 'bg-1', workspace_id: 'ws-1', category_id: 'cat-1', planned_amount: 200, month: 4, year: 2026 }],
      financial_goals: [{ id: 'g-1', workspace_id: 'ws-1', name: 'Carro', target_amount: 20000, current_amount: 5000 }],
      settlements: [{ id: 's-1', workspace_id: 'ws-1', from_member_id: 'm-1', to_member_id: 'm-2', amount: 50, settlement_date: '2026-04-01' }],
      installments: [{ id: 'inst-1', purchase_id: 'p-1', installment_number: 1, amount: 100, due_date: '2026-05-01', status: 'pending', paid_amount: 0 }],
    };

    (client.from as any).mockImplementation((table: string) => {
      const data = mockTableData[table] ?? [];
      const builder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({ data, error: null }),
        then: (resolve: any) => resolve({ data, error: null }),
      };
      return builder;
    });

    const repo = new SupabaseFinanceRepository(client);
    const snapshot = await repo.loadSnapshot('ws-1');

    expect(snapshot.activeWorkspaceId).toBe('ws-1');
    expect(snapshot.allAccounts.length).toBe(1);
    expect(snapshot.allTransactions.length).toBe(1);
    expect(snapshot.allTransactions[0].splits?.length).toBe(1);
    expect(snapshot.allPurchases[0].splits?.length).toBe(1);
    expect(snapshot.allInstallments.length).toBe(1);
  });

  it('throws RepositoryError if table query fails during loadSnapshot', async () => {
    const { client } = createMockSupabaseClient();
    (client.from as any).mockImplementation((table: string) => {
      if (table === 'accounts') {
        const builder: any = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          then: (resolve: any) =>
            resolve({ data: null, error: { code: '42501', message: 'Forbidden' } }),
        };
        return builder;
      }
      const builder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: (resolve: any) => resolve({ data: [], error: null }),
      };
      return builder;
    });

    const repo = new SupabaseFinanceRepository(client);
    await expect(repo.loadSnapshot('ws-1')).rejects.toThrow(RepositoryError);
  });

  it('creates workspace via fn_create_workspace and fails closed without fallback on RPC error', async () => {
    const { client } = createMockSupabaseClient();
    const repo = new SupabaseFinanceRepository(client);

    // 1. Success case
    (client.rpc as any).mockResolvedValueOnce({ data: 'ws-new-id', error: null });
    (client.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'ws-new-id', name: 'Work', owner_id: 'u-1', currency: 'BRL', tracking_mode: 'full', created_at: '2026-01-01' },
        error: null,
      }),
    });

    const created = await repo.createWorkspace({
      name: 'Work',
      owner_id: 'u-1',
      currency: 'BRL',
      tracking_mode: 'full',
    });
    expect(created.id).toBe('ws-new-id');
    expect(client.rpc).toHaveBeenCalledWith('fn_create_workspace', {
      p_name: 'Work',
      p_currency: 'BRL',
      p_tracking_mode: 'full',
    });

    // 2. RPC Failure case: must NOT attempt direct insert fallback, must fail-closed
    (client.rpc as any).mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'Permissao negada' },
    });
    await expect(
      repo.createWorkspace({
        name: 'Fail Work',
        owner_id: 'u-1',
        currency: 'BRL',
        tracking_mode: 'full',
      })
    ).rejects.toThrow(RepositoryError);
  });

  it('manages workspace CRUD operations and membership', async () => {
    const { client } = createMockSupabaseClient();
    const repo = new SupabaseFinanceRepository(client);

    // getWorkspaces
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockResolvedValue({
        data: [{ id: 'ws-1', name: 'Ws 1', owner_id: 'u-1', currency: 'BRL', tracking_mode: 'full', created_at: '2026-01-01' }],
        error: null,
      }),
    });
    const wsList = await repo.getWorkspaces();
    expect(wsList.length).toBe(1);

    // updateWorkspace
    (client.from as any).mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'ws-1', name: 'Ws Renamed', owner_id: 'u-1', currency: 'BRL', tracking_mode: 'full', created_at: '2026-01-01' },
        error: null,
      }),
    });
    const updatedWs = await repo.updateWorkspace('ws-1', { name: 'Ws Renamed' });
    expect(updatedWs.name).toBe('Ws Renamed');

    // deleteWorkspace
    (client.from as any).mockReturnValueOnce({
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    await expect(repo.deleteWorkspace('ws-1')).resolves.toBeUndefined();

    // getWorkspaceMembers
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({
        data: [{ id: 'm-1', workspace_id: 'ws-1', user_id: 'u-1', role: 'owner', created_at: '2026-01-01', profiles: { name: 'User 1' } }],
        error: null,
      }),
    });
    const members = await repo.getWorkspaceMembers('ws-1');
    expect(members.length).toBe(1);

    // addWorkspaceMember
    (client.from as any).mockReturnValueOnce({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'm-2', workspace_id: 'ws-1', user_id: 'u-2', role: 'member', created_at: '2026-01-01', profiles: { name: 'User 2' } },
        error: null,
      }),
    });
    const addedMember = await repo.addWorkspaceMember({ workspace_id: 'ws-1', user_id: 'u-2', role: 'member' });
    expect(addedMember.id).toBe('m-2');

    // updateWorkspaceMemberRole
    (client.from as any).mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'm-2', workspace_id: 'ws-1', user_id: 'u-2', role: 'admin', created_at: '2026-01-01', profiles: { name: 'User 2' } },
        error: null,
      }),
    });
    const updatedMember = await repo.updateWorkspaceMemberRole('m-2', 'admin');
    expect(updatedMember.role).toBe('admin');

    // removeWorkspaceMember
    (client.from as any).mockReturnValueOnce({
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    await expect(repo.removeWorkspaceMember('m-2')).resolves.toBeUndefined();
  });

  it('saves transaction atomically via fn_create_transaction_with_splits on insert', async () => {
    const { client } = createMockSupabaseClient();
    const createdTxRow = {
      id: 'tx-new',
      workspace_id: 'ws-1',
      description: 'Jantar',
      amount: 100,
      transaction_date: '2026-04-01',
      due_date: '2026-04-01',
      type: 'expense',
      status: 'completed',
    };

    (client.rpc as any).mockResolvedValueOnce({ data: 'tx-new', error: null });
    (client.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: createdTxRow, error: null }),
    });

    const repo = new SupabaseFinanceRepository(client);
    const result = await repo.saveTransaction({
      workspace_id: 'ws-1',
      description: 'Jantar',
      amount: 100,
      transaction_date: '2026-04-01',
      due_date: '2026-04-01',
      type: 'expense',
      status: 'paid',
      splits: [{ member_id: 'm-1', amount: 50, percentage: 50 }],
    });

    expect(result.id).toBe('tx-new');
    expect(client.rpc).toHaveBeenCalledWith('fn_create_transaction_with_splits', expect.objectContaining({
      p_workspace_id: 'ws-1',
      p_description: 'Jantar',
      p_amount: 100,
      p_splits: [{ member_id: 'm-1', amount: 50, percentage: 50 }],
    }));
  });

  it('fails atomically when fn_create_transaction_with_splits returns error', async () => {
    const { client } = createMockSupabaseClient();
    (client.rpc as any).mockResolvedValueOnce({
      data: null,
      error: { code: '23514', message: 'A soma dos rateios deve ser igual ao valor total' },
    });

    const repo = new SupabaseFinanceRepository(client);
    await expect(
      repo.saveTransaction({
        workspace_id: 'ws-1',
        description: 'Jantar Falho',
        amount: 100,
        transaction_date: '2026-04-01',
        due_date: '2026-04-01',
        type: 'expense',
        status: 'paid',
        splits: [{ member_id: 'm-1', amount: 40, percentage: 40 }],
      })
    ).rejects.toThrow(RepositoryError);
  });

  it('updates existing transaction and synchronizes splits via fn_update_transaction_with_splits', async () => {
    const { client } = createMockSupabaseClient();
    const repo = new SupabaseFinanceRepository(client);
    const updatedTxRow = {
      id: 'tx-existing',
      workspace_id: 'ws-1',
      description: 'Jantar Atualizado',
      amount: 120,
      transaction_date: '2026-04-01',
      due_date: '2026-04-01',
      type: 'expense',
      status: 'completed',
    };

    (client.rpc as any).mockResolvedValueOnce({ data: 'tx-existing', error: null });
    (client.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: updatedTxRow, error: null }),
    });

    const result = await repo.saveTransaction({
      id: 'tx-existing',
      workspace_id: 'ws-1',
      description: 'Jantar Atualizado',
      amount: 120,
      transaction_date: '2026-04-01',
      due_date: '2026-04-01',
      type: 'expense',
      status: 'paid',
      splits: [{ member_id: 'm-1', amount: 120, percentage: 100 }],
    });

    expect(result.id).toBe('tx-existing');
    expect(client.rpc).toHaveBeenCalledWith('fn_update_transaction_with_splits', expect.objectContaining({
      p_workspace_id: 'ws-1',
      p_transaction_id: 'tx-existing',
      p_splits: [{ member_id: 'm-1', amount: 120, percentage: 100 }],
    }));
  });

  it('saves purchase atomically via fn_create_purchase_with_splits on insert', async () => {
    const { client } = createMockSupabaseClient();
    const createdPurchaseRow = {
      id: 'pur-new',
      workspace_id: 'ws-1',
      description: 'Móvel',
      total_amount: 600,
      installment_count: 6,
      purchase_date: '2026-04-01',
    };

    (client.rpc as any).mockResolvedValueOnce({ data: 'pur-new', error: null });
    (client.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: createdPurchaseRow, error: null }),
    });

    const repo = new SupabaseFinanceRepository(client);
    const result = await repo.savePurchase({
      workspace_id: 'ws-1',
      description: 'Móvel',
      total_amount: 600,
      installment_count: 6,
      purchase_date: '2026-04-01',
      splits: [{ member_id: 'm-1', amount: 300, percentage: 50 }],
    });

    expect(result.id).toBe('pur-new');
    expect(client.rpc).toHaveBeenCalledWith('fn_create_purchase_with_splits', expect.objectContaining({
      p_workspace_id: 'ws-1',
      p_description: 'Móvel',
      p_total_amount: 600,
      p_splits: [{ member_id: 'm-1', amount: 300, percentage: 50 }],
    }));
  });

  it('updates existing purchase and synchronizes splits via fn_update_purchase_with_splits', async () => {
    const { client } = createMockSupabaseClient();
    const repo = new SupabaseFinanceRepository(client);
    const updatedPurchaseRow = {
      id: 'pur-existing',
      workspace_id: 'ws-1',
      description: 'Móvel Atualizado',
      total_amount: 800,
      installment_count: 8,
      purchase_date: '2026-04-01',
    };

    (client.rpc as any).mockResolvedValueOnce({ data: 'pur-existing', error: null });
    (client.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: updatedPurchaseRow, error: null }),
    });

    const result = await repo.savePurchase({
      id: 'pur-existing',
      workspace_id: 'ws-1',
      description: 'Móvel Atualizado',
      total_amount: 800,
      installment_count: 8,
      purchase_date: '2026-04-01',
      splits: [{ member_id: 'm-1', amount: 800, percentage: 100 }],
    });

    expect(result.id).toBe('pur-existing');
    expect(client.rpc).toHaveBeenCalledWith('fn_update_purchase_with_splits', expect.objectContaining({
      p_workspace_id: 'ws-1',
      p_purchase_id: 'pur-existing',
      p_splits: [{ member_id: 'm-1', amount: 800, percentage: 100 }],
    }));
  });

  it('saves payment with obligation calling fn_record_payment and deletes with fn_delete_payment', async () => {
    const { client } = createMockSupabaseClient();
    const repo = new SupabaseFinanceRepository(client);

    // 1. savePayment with obligation (transaction_id)
    (client.rpc as any).mockResolvedValueOnce({ data: 'pay-new-id', error: null });
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'pay-new-id', workspace_id: 'ws-1', amount: 150, payment_date: '2026-04-01', affects_balance: true },
        error: null,
      }),
    });

    const payment = await repo.savePayment({
      workspace_id: 'ws-1',
      amount: 150,
      payment_date: '2026-04-01',
      transaction_id: 'tx-1',
      affects_balance: true,
    });
    expect(payment.id).toBe('pay-new-id');
    expect(client.rpc).toHaveBeenCalledWith('fn_record_payment', expect.objectContaining({
      p_workspace_id: 'ws-1',
      p_amount: 150,
      p_transaction_id: 'tx-1',
    }));

    // 2. deletePayment calls fn_delete_payment
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { workspace_id: 'ws-1' },
        error: null,
      }),
    });
    (client.rpc as any).mockResolvedValueOnce({ error: null });

    await expect(repo.deletePayment('pay-new-id')).resolves.toBeUndefined();
    expect(client.rpc).toHaveBeenCalledWith('fn_delete_payment', {
      p_workspace_id: 'ws-1',
      p_payment_id: 'pay-new-id',
    });
  });

  it('saves transfer calling fn_create_transfer and deletes with fn_delete_transfer', async () => {
    const { client } = createMockSupabaseClient();
    const repo = new SupabaseFinanceRepository(client);

    // 1. saveTransfer insert
    (client.rpc as any).mockResolvedValueOnce({ data: 'tr-new-id', error: null });
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'tr-new-id', workspace_id: 'ws-1', from_account_id: 'a-1', to_account_id: 'a-2', amount: 200, transfer_date: '2026-04-01' },
        error: null,
      }),
    });

    const transfer = await repo.saveTransfer({
      workspace_id: 'ws-1',
      from_account_id: 'a-1',
      to_account_id: 'a-2',
      amount: 200,
      transfer_date: '2026-04-01',
    });
    expect(transfer.id).toBe('tr-new-id');
    expect(client.rpc).toHaveBeenCalledWith('fn_create_transfer', expect.objectContaining({
      p_workspace_id: 'ws-1',
      p_from_account_id: 'a-1',
      p_to_account_id: 'a-2',
      p_amount: 200,
    }));

    // 2. deleteTransfer calls fn_delete_transfer
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { workspace_id: 'ws-1' },
        error: null,
      }),
    });
    (client.rpc as any).mockResolvedValueOnce({ error: null });

    await expect(repo.deleteTransfer('tr-new-id')).resolves.toBeUndefined();
    expect(client.rpc).toHaveBeenCalledWith('fn_delete_transfer', {
      p_workspace_id: 'ws-1',
      p_transfer_id: 'tr-new-id',
    });
  });

  it('handles entities CRUD: accounts, cards, bills, methods, categories, installments, recurring, budgets, goals, settlements', async () => {
    const { client } = createMockSupabaseClient();
    const repo = new SupabaseFinanceRepository(client);

    // Accounts
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [{ id: 'a-1', name: 'Conta', workspace_id: 'ws-1', current_balance: 100, initial_balance: 100, type: 'checking', active: true }], error: null }),
    });
    const accs = await repo.getAccounts('ws-1');
    expect(accs.length).toBe(1);

    (client.from as any).mockReturnValueOnce({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'a-2', name: 'Conta 2', workspace_id: 'ws-1', current_balance: 50, initial_balance: 50, type: 'checking', active: true }, error: null }),
    });
    const savedAcc = await repo.saveAccount({ workspace_id: 'ws-1', name: 'Conta 2', type: 'checking', current_balance: 50, initial_balance: 50, active: true, institution: 'Bank', color: '#10b981' });
    expect(savedAcc.id).toBe('a-2');

    (client.from as any).mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'a-2', name: 'Conta 2 Renomeada', workspace_id: 'ws-1', current_balance: 50, initial_balance: 50, type: 'checking', active: true }, error: null }),
    });
    const updatedAcc = await repo.saveAccount({ id: 'a-2', workspace_id: 'ws-1', name: 'Conta 2 Renomeada', type: 'checking', current_balance: 50, initial_balance: 50, active: true, institution: 'Bank', color: '#10b981' });
    expect(updatedAcc.name).toBe('Conta 2 Renomeada');

    (client.from as any).mockReturnValueOnce({
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    await expect(repo.deleteAccount('a-2')).resolves.toBeUndefined();

    // Payment Methods
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [{ id: 'pm-1', workspace_id: 'ws-1', name: 'Pix', type: 'pix', active: true }], error: null }),
    });
    const pms = await repo.getPaymentMethods('ws-1');
    expect(pms.length).toBe(1);

    (client.from as any).mockReturnValueOnce({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'pm-1', workspace_id: 'ws-1', name: 'Pix', type: 'pix', active: true }, error: null }),
    });
    await repo.savePaymentMethod({ workspace_id: 'ws-1', name: 'Pix', type: 'pix', active: true });

    (client.from as any).mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'pm-1', workspace_id: 'ws-1', name: 'Pix Atualizado', type: 'pix', active: true }, error: null }),
    });
    await repo.savePaymentMethod({ id: 'pm-1', workspace_id: 'ws-1', name: 'Pix Atualizado', type: 'pix', active: true });

    (client.from as any).mockReturnValueOnce({
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    await expect(repo.deletePaymentMethod('pm-1')).resolves.toBeUndefined();

    // Credit Cards & Bills
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [{ id: 'c-1', workspace_id: 'ws-1', name: 'Cartao', credit_limit: 1000, closing_day: 1, due_day: 10, active: true }], error: null }),
    });
    const cards = await repo.getCreditCards('ws-1');
    expect(cards.length).toBe(1);

    (client.from as any).mockReturnValueOnce({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'c-1', workspace_id: 'ws-1', name: 'Cartao', credit_limit: 1000, closing_day: 1, due_day: 10, active: true }, error: null }),
    });
    await repo.saveCreditCard({ workspace_id: 'ws-1', name: 'Cartao', credit_limit: 1000, closing_day: 1, due_day: 10, active: true, institution: 'Bank', color: '#10b981' });

    (client.from as any).mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'c-1', workspace_id: 'ws-1', name: 'Cartao Up', credit_limit: 2000, closing_day: 1, due_day: 10, active: true }, error: null }),
    });
    await repo.saveCreditCard({ id: 'c-1', workspace_id: 'ws-1', name: 'Cartao Up', credit_limit: 2000, closing_day: 1, due_day: 10, active: true, institution: 'Bank', color: '#10b981' });

    (client.from as any).mockReturnValueOnce({
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    await expect(repo.deleteCreditCard('c-1')).resolves.toBeUndefined();

    // Categories
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [{ id: 'cat-1', workspace_id: 'ws-1', name: 'Cat', type: 'expense', active: true }], error: null }),
    });
    const cats = await repo.getCategories('ws-1');
    expect(cats.length).toBe(1);

    (client.from as any).mockReturnValueOnce({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'cat-1', workspace_id: 'ws-1', name: 'Cat', type: 'expense', active: true }, error: null }),
    });
    await repo.saveCategory({ workspace_id: 'ws-1', name: 'Cat', type: 'expense', active: true, color: '#10b981', icon: 'tag' });

    (client.from as any).mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'cat-1', workspace_id: 'ws-1', name: 'Cat Up', type: 'expense', active: true }, error: null }),
    });
    await repo.saveCategory({ id: 'cat-1', workspace_id: 'ws-1', name: 'Cat Up', type: 'expense', active: true, color: '#10b981', icon: 'tag' });

    (client.from as any).mockReturnValueOnce({
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    await expect(repo.deleteCategory('cat-1')).resolves.toBeUndefined();

    // Recurring
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [{ id: 'rec-1', workspace_id: 'ws-1', description: 'Assinatura', amount: 50, frequency: 'monthly', active: true, start_date: '2026-01-01', auto_create: false }], error: null }),
    });
    const recs = await repo.getRecurring('ws-1');
    expect(recs.length).toBe(1);

    (client.from as any).mockReturnValueOnce({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'rec-1', workspace_id: 'ws-1', description: 'Assinatura', amount: 50, frequency: 'monthly', active: true, start_date: '2026-01-01', auto_create: false }, error: null }),
    });
    await repo.saveRecurring({ workspace_id: 'ws-1', description: 'Assinatura', amount: 50, frequency: 'monthly', type: 'expense', active: true, start_date: '2026-01-01', auto_create: false, next_occurrence: '2026-02-01' });

    (client.from as any).mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'rec-1', workspace_id: 'ws-1', description: 'Assinatura Up', amount: 60, frequency: 'monthly', active: true, start_date: '2026-01-01', auto_create: false }, error: null }),
    });
    await repo.saveRecurring({ id: 'rec-1', workspace_id: 'ws-1', description: 'Assinatura Up', amount: 60, frequency: 'monthly', type: 'expense', active: true, start_date: '2026-01-01', auto_create: false, next_occurrence: '2026-02-01' });

    (client.from as any).mockReturnValueOnce({
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    await expect(repo.deleteRecurring('rec-1')).resolves.toBeUndefined();

    // Budgets
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [{ id: 'b-1', workspace_id: 'ws-1', category_id: 'cat-1', planned_amount: 500, month: 4, year: 2026 }], error: null }),
    });
    const budgets = await repo.getBudgets('ws-1');
    expect(budgets.length).toBe(1);

    (client.from as any).mockReturnValueOnce({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'b-1', workspace_id: 'ws-1', category_id: 'cat-1', planned_amount: 500, month: 4, year: 2026 }, error: null }),
    });
    await repo.saveBudget({ workspace_id: 'ws-1', category_id: 'cat-1', planned_amount: 500, month: 4, year: 2026 });

    (client.from as any).mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'b-1', workspace_id: 'ws-1', category_id: 'cat-1', planned_amount: 600, month: 4, year: 2026 }, error: null }),
    });
    await repo.saveBudget({ id: 'b-1', workspace_id: 'ws-1', category_id: 'cat-1', planned_amount: 600, month: 4, year: 2026 });

    (client.from as any).mockReturnValueOnce({
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    await expect(repo.deleteBudget('b-1')).resolves.toBeUndefined();

    // Goals
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [{ id: 'g-1', workspace_id: 'ws-1', name: 'Carro', target_amount: 10000, current_amount: 2000 }], error: null }),
    });
    const goals = await repo.getGoals('ws-1');
    expect(goals.length).toBe(1);

    (client.from as any).mockReturnValueOnce({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'g-1', workspace_id: 'ws-1', name: 'Carro', target_amount: 10000, current_amount: 2000 }, error: null }),
    });
    await repo.saveGoal({ workspace_id: 'ws-1', name: 'Carro', target_amount: 10000, current_amount: 2000, status: 'in_progress', color: '#10b981', icon: 'target' });

    (client.from as any).mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'g-1', workspace_id: 'ws-1', name: 'Carro Novo', target_amount: 12000, current_amount: 3000 }, error: null }),
    });
    await repo.saveGoal({ id: 'g-1', workspace_id: 'ws-1', name: 'Carro Novo', target_amount: 12000, current_amount: 3000, status: 'in_progress', color: '#10b981', icon: 'target' });

    (client.from as any).mockReturnValueOnce({
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    await expect(repo.deleteGoal('g-1')).resolves.toBeUndefined();

    // Settlements
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [{ id: 's-1', workspace_id: 'ws-1', from_member_id: 'm-1', to_member_id: 'm-2', amount: 50, settlement_date: '2026-04-01' }], error: null }),
    });
    const settlements = await repo.getSettlements('ws-1');
    expect(settlements.length).toBe(1);

    (client.from as any).mockReturnValueOnce({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 's-1', workspace_id: 'ws-1', from_member_id: 'm-1', to_member_id: 'm-2', amount: 50, settlement_date: '2026-04-01' }, error: null }),
    });
    await repo.saveSettlement({ workspace_id: 'ws-1', from_member_id: 'm-1', to_member_id: 'm-2', amount: 50, settlement_date: '2026-04-01' });

    (client.from as any).mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 's-1', workspace_id: 'ws-1', from_member_id: 'm-1', to_member_id: 'm-2', amount: 75, settlement_date: '2026-04-01' }, error: null }),
    });
    await repo.saveSettlement({ id: 's-1', workspace_id: 'ws-1', from_member_id: 'm-1', to_member_id: 'm-2', amount: 75, settlement_date: '2026-04-01' });

    (client.from as any).mockReturnValueOnce({
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    await expect(repo.deleteSettlement('s-1')).resolves.toBeUndefined();
  });

  it('handles credit card bills, installments, and payment/transfer variations', async () => {
    const { client } = createMockSupabaseClient();
    const repo = new SupabaseFinanceRepository(client);

    // Bills
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [{ id: 'b-1', credit_card_id: 'c-1', workspace_id: 'ws-1', reference_month: '2026-04', closing_date: '2026-04-01', due_date: '2026-04-10', total_amount: 100, paid_amount: 0, status: 'open' }], error: null }),
    });
    const bills = await repo.getCreditCardBills('c-1');
    expect(bills.length).toBe(1);

    // Installments
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [{ id: 'inst-1', purchase_id: 'p-1', installment_number: 1, amount: 50, due_date: '2026-05-01', status: 'pending', paid_amount: 0 }], error: null }),
    });
    const insts = await repo.getInstallments('p-1');
    expect(insts.length).toBe(1);

    // Payments: getPayments, update, standalone insert, obligation with installment/bill
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [{ id: 'pay-1', workspace_id: 'ws-1', amount: 50, payment_date: '2026-04-01', affects_balance: false }], error: null }),
    });
    const payments = await repo.getPayments('ws-1');
    expect(payments.length).toBe(1);

    // update payment
    (client.rpc as any).mockResolvedValueOnce({ data: 'pay-1', error: null });
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'pay-1', workspace_id: 'ws-1', amount: 60, payment_date: '2026-04-01', affects_balance: false }, error: null }),
    });
    await repo.savePayment({ id: 'pay-1', workspace_id: 'ws-1', amount: 60, payment_date: '2026-04-01', affects_balance: false });

    // standalone insert
    (client.from as any).mockReturnValueOnce({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'pay-standalone', workspace_id: 'ws-1', amount: 30, payment_date: '2026-04-01', affects_balance: false }, error: null }),
    });
    await repo.savePayment({ workspace_id: 'ws-1', amount: 30, payment_date: '2026-04-01', affects_balance: false });

    // payment with installment
    (client.rpc as any).mockResolvedValueOnce({ data: 'pay-inst', error: null });
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'pay-inst', workspace_id: 'ws-1', amount: 50, payment_date: '2026-04-01', affects_balance: true }, error: null }),
    });
    await repo.savePayment({ workspace_id: 'ws-1', amount: 50, payment_date: '2026-04-01', installment_id: 'inst-1', affects_balance: true });

    // payment with credit card bill
    (client.rpc as any).mockResolvedValueOnce({ data: 'pay-bill', error: null });
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'pay-bill', workspace_id: 'ws-1', amount: 100, payment_date: '2026-04-01', affects_balance: true }, error: null }),
    });
    await repo.savePayment({ workspace_id: 'ws-1', amount: 100, payment_date: '2026-04-01', credit_card_bill_id: 'b-1', affects_balance: true });

    // payment delete not found
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
    });
    await expect(repo.deletePayment('nonexistent')).rejects.toThrow(RepositoryError);

    // payment delete rpc error
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { workspace_id: 'ws-1' }, error: null }),
    });
    (client.rpc as any).mockResolvedValueOnce({ error: { message: 'reversal failed' } });
    await expect(repo.deletePayment('pay-1')).rejects.toThrow(RepositoryError);

    // Transfers: getTransfers, update, delete not found, delete rpc error
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [{ id: 'tr-1', workspace_id: 'ws-1', from_account_id: 'a-1', to_account_id: 'a-2', amount: 40, transfer_date: '2026-04-01' }], error: null }),
    });
    const trs = await repo.getTransfers('ws-1');
    expect(trs.length).toBe(1);

    (client.rpc as any).mockResolvedValueOnce({ data: 'tr-1', error: null });
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'tr-1', workspace_id: 'ws-1', from_account_id: 'a-1', to_account_id: 'a-2', amount: 45, transfer_date: '2026-04-01' }, error: null }),
    });
    await repo.saveTransfer({ id: 'tr-1', workspace_id: 'ws-1', from_account_id: 'a-1', to_account_id: 'a-2', amount: 45, transfer_date: '2026-04-01' });

    // transfer delete not found
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
    });
    await expect(repo.deleteTransfer('nonexistent')).rejects.toThrow(RepositoryError);

    // transfer delete rpc error
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { workspace_id: 'ws-1' }, error: null }),
    });
    (client.rpc as any).mockResolvedValueOnce({ error: { message: 'transfer reversal failed' } });
    await expect(repo.deleteTransfer('tr-1')).rejects.toThrow(RepositoryError);

    // deleteTransaction and deletePurchase
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { workspace_id: 'ws-1' }, error: null }),
    });
    (client.rpc as any).mockResolvedValueOnce({ error: null });
    await expect(repo.deleteTransaction('tx-1')).resolves.toBeUndefined();

    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { workspace_id: 'ws-1' }, error: null }),
    });
    (client.rpc as any).mockResolvedValueOnce({ error: null });
    await expect(repo.deletePurchase('p-1')).resolves.toBeUndefined();

    // getPurchases and getTransactions queries
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [{ id: 'p-1', workspace_id: 'ws-1', description: 'P1', total_amount: 100, installment_count: 1, purchase_date: '2026-04-01' }], error: null }),
    });
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [{ id: 'ps-1', purchase_id: 'p-1', workspace_id: 'ws-1', member_id: 'm-1', amount: 100 }], error: null }),
    });
    const purchases = await repo.getPurchases('ws-1');
    expect(purchases.length).toBe(1);
    expect(purchases[0].splits?.length).toBe(1);

    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [{ id: 'tx-1', workspace_id: 'ws-1', description: 'Tx1', amount: 50, transaction_date: '2026-04-01', due_date: '2026-04-01', type: 'expense', status: 'completed' }], error: null }),
    });
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [{ id: 'ts-1', transaction_id: 'tx-1', workspace_id: 'ws-1', member_id: 'm-1', amount: 50 }], error: null }),
    });
    const txs = await repo.getTransactions('ws-1');
    expect(txs.length).toBe(1);
    expect(txs[0].splits?.length).toBe(1);

    // savePurchase RPC error
    (client.rpc as any).mockResolvedValueOnce({ data: null, error: { message: 'create purchase failed' } });
    await expect(
      repo.savePurchase({
        workspace_id: 'ws-1',
        description: 'Fail',
        total_amount: 100,
        installment_count: 1,
        purchase_date: '2026-04-01',
      })
    ).rejects.toThrow(RepositoryError);

    // savePayment with obligation RPC error
    (client.rpc as any).mockResolvedValueOnce({ data: null, error: { message: 'record payment failed' } });
    await expect(
      repo.savePayment({
        workspace_id: 'ws-1',
        amount: 50,
        payment_date: '2026-04-01',
        transaction_id: 'tx-1',
        affects_balance: true,
      })
    ).rejects.toThrow(RepositoryError);

    // saveTransfer RPC error
    (client.rpc as any).mockResolvedValueOnce({ data: null, error: { message: 'create transfer failed' } });
    await expect(
      repo.saveTransfer({
        workspace_id: 'ws-1',
        from_account_id: 'a-1',
        to_account_id: 'a-2',
        amount: 10,
        transfer_date: '2026-04-01',
      })
    ).rejects.toThrow(RepositoryError);

    // loadSnapshot with empty purchases
    (client.from as any).mockImplementation((table: string) => {
      const builder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({ data: [], error: null }),
        then: (resolve: any) => resolve({ data: [], error: null }),
      };
      return builder;
    });
    const emptySnap = await repo.loadSnapshot('ws-empty');
    expect(emptySnap.allPurchases.length).toBe(0);
    expect(emptySnap.allInstallments.length).toBe(0);

    // loadSnapshot with null table responses (covers ?? [] fallbacks across all entities)
    (client.from as any).mockImplementation((table: string) => {
      const builder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({ data: null, error: null }),
        then: (resolve: any) => resolve({ data: null, error: null }),
      };
      return builder;
    });
    const nullSnap = await repo.loadSnapshot('ws-null');
    expect(nullSnap.allAccounts.length).toBe(0);
    expect(nullSnap.allTransactions.length).toBe(0);
    expect(nullSnap.allPurchases.length).toBe(0);

    // saveTransaction update without splits
    (client.rpc as any).mockResolvedValueOnce({ data: 'tx-1', error: null });
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'tx-1', workspace_id: 'ws-1', description: 'Tx1 Up', amount: 55, transaction_date: '2026-04-01', due_date: '2026-04-01', type: 'expense', status: 'completed' }, error: null }),
    });
    await repo.saveTransaction({ id: 'tx-1', workspace_id: 'ws-1', description: 'Tx1 Up', amount: 55, transaction_date: '2026-04-01', due_date: '2026-04-01', type: 'expense', status: 'paid' });

    // savePurchase update without splits
    (client.rpc as any).mockResolvedValueOnce({ data: 'p-1', error: null });
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'p-1', workspace_id: 'ws-1', description: 'P1 Up', total_amount: 120, installment_count: 1, purchase_date: '2026-04-01' }, error: null }),
    });
    await repo.savePurchase({ id: 'p-1', workspace_id: 'ws-1', description: 'P1 Up', total_amount: 120, installment_count: 1, purchase_date: '2026-04-01' });
  });

  it('throws RepositoryError across various query error conditions', async () => {
    const { client } = createMockSupabaseClient();
    const repo = new SupabaseFinanceRepository(client);
    const err = { message: 'db error', code: '42501' };

    // Workspaces
    (client.from as any).mockReturnValueOnce({ select: vi.fn().mockResolvedValue({ data: null, error: err }) });
    await expect(repo.getWorkspaces()).rejects.toThrow(RepositoryError);

    (client.from as any).mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.updateWorkspace('ws-1', { name: 'X' })).rejects.toThrow(RepositoryError);

    (client.from as any).mockReturnValueOnce({
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: err }),
    });
    await expect(repo.deleteWorkspace('ws-1')).rejects.toThrow(RepositoryError);

    // Members
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.getWorkspaceMembers('ws-1')).rejects.toThrow(RepositoryError);

    (client.from as any).mockReturnValueOnce({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.addWorkspaceMember({ workspace_id: 'ws-1', user_id: 'u-1', role: 'member' })).rejects.toThrow(RepositoryError);

    (client.from as any).mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.updateWorkspaceMemberRole('m-1', 'admin')).rejects.toThrow(RepositoryError);

    (client.from as any).mockReturnValueOnce({
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: err }),
    });
    await expect(repo.removeWorkspaceMember('m-1')).rejects.toThrow(RepositoryError);

    // Accounts
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.getAccounts('ws-1')).rejects.toThrow(RepositoryError);

    (client.from as any).mockReturnValueOnce({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.saveAccount({ workspace_id: 'ws-1', name: 'A', type: 'checking', current_balance: 0, initial_balance: 0, active: true, institution: 'Bank', color: '#10b981' })).rejects.toThrow(RepositoryError);

    (client.from as any).mockReturnValueOnce({
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: err }),
    });
    await expect(repo.deleteAccount('a-1')).rejects.toThrow(RepositoryError);

    // Credit cards and bills
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.getCreditCards('ws-1')).rejects.toThrow(RepositoryError);

    (client.from as any).mockReturnValueOnce({
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: err }),
    });
    await expect(repo.deleteCreditCard('c-1')).rejects.toThrow(RepositoryError);

    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.getCreditCardBills('c-1')).rejects.toThrow(RepositoryError);

    // Categories
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.getCategories('ws-1')).rejects.toThrow(RepositoryError);

    (client.from as any).mockReturnValueOnce({
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: err }),
    });
    await expect(repo.deleteCategory('cat-1')).rejects.toThrow(RepositoryError);

    // Recurring
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.getRecurring('ws-1')).rejects.toThrow(RepositoryError);

    (client.from as any).mockReturnValueOnce({
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: err }),
    });
    await expect(repo.deleteRecurring('rec-1')).rejects.toThrow(RepositoryError);

    // Budgets
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.getBudgets('ws-1')).rejects.toThrow(RepositoryError);

    (client.from as any).mockReturnValueOnce({
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: err }),
    });
    await expect(repo.deleteBudget('b-1')).rejects.toThrow(RepositoryError);

    // Goals
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.getGoals('ws-1')).rejects.toThrow(RepositoryError);

    (client.from as any).mockReturnValueOnce({
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: err }),
    });
    await expect(repo.deleteGoal('g-1')).rejects.toThrow(RepositoryError);

    // Settlements
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.getSettlements('ws-1')).rejects.toThrow(RepositoryError);

    (client.from as any).mockReturnValueOnce({
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: err }),
    });
    await expect(repo.deleteSettlement('s-1')).rejects.toThrow(RepositoryError);
  });

  it('covers individual table error branches during loadSnapshot', async () => {
    const tables = [
      'workspaces', 'workspace_members', 'accounts', 'credit_cards', 'credit_card_bills',
      'payment_methods', 'categories', 'transactions', 'transaction_splits', 'purchases',
      'purchase_splits', 'payments', 'transfers', 'recurring_transactions', 'budgets',
      'financial_goals', 'settlements', 'installments'
    ];

    for (const table of tables) {
      const { client } = createMockSupabaseClient();
      (client.from as any).mockImplementation((t: string) => {
        if (t === table) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: null, error: { message: `failed on ${table}`, code: '42501' } }),
            then: (resolve: any) => resolve({ data: null, error: { message: `failed on ${table}`, code: '42501' } }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: t === 'purchases' ? [{ id: 'p-1' }] : [], error: null }),
          then: (resolve: any) => resolve({ data: t === 'purchases' ? [{ id: 'p-1' }] : [], error: null }),
        };
      });
      const repo = new SupabaseFinanceRepository(client);
      await expect(repo.loadSnapshot('ws-1')).rejects.toThrow(RepositoryError);
    }
  });

  it('covers postgrest update and fetch error branches across entities', async () => {
    const { client } = createMockSupabaseClient();
    const repo = new SupabaseFinanceRepository(client);
    const err = { message: 'update failed', code: '42501' };

    // createWorkspace fetch error
    (client.rpc as any).mockResolvedValueOnce({ data: 'ws-new', error: null });
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.createWorkspace({ name: 'Fetch Err', owner_id: 'u-1', currency: 'BRL', tracking_mode: 'full' })).rejects.toThrow(RepositoryError);

    // saveAccount update error
    (client.from as any).mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.saveAccount({ id: 'a-1', workspace_id: 'ws-1', name: 'A', type: 'checking', current_balance: 0, initial_balance: 0, active: true, institution: 'Bank', color: '#10b981' })).rejects.toThrow(RepositoryError);

    // savePaymentMethod update error
    (client.from as any).mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.savePaymentMethod({ id: 'pm-1', workspace_id: 'ws-1', name: 'PM', type: 'pix', active: true })).rejects.toThrow(RepositoryError);

    // saveCreditCard update error
    (client.from as any).mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.saveCreditCard({ id: 'c-1', workspace_id: 'ws-1', name: 'Card', credit_limit: 100, closing_day: 1, due_day: 10, active: true, institution: 'Bank', color: '#10b981' })).rejects.toThrow(RepositoryError);


    // saveCategory update error
    (client.from as any).mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.saveCategory({ id: 'cat-1', workspace_id: 'ws-1', name: 'Cat', type: 'expense', active: true, color: '#10b981', icon: 'tag' })).rejects.toThrow(RepositoryError);

    // saveTransaction update rpc error
    (client.rpc as any).mockResolvedValueOnce({ data: null, error: err });
    await expect(repo.saveTransaction({ id: 'tx-1', workspace_id: 'ws-1', description: 'Tx', amount: 10, transaction_date: '2026-04-01', due_date: '2026-04-01', type: 'expense', status: 'paid' })).rejects.toThrow(RepositoryError);

    // saveTransaction update fetch error
    (client.rpc as any).mockResolvedValueOnce({ data: 'tx-1', error: null });
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.saveTransaction({ id: 'tx-1', workspace_id: 'ws-1', description: 'Tx', amount: 10, transaction_date: '2026-04-01', due_date: '2026-04-01', type: 'expense', status: 'paid', splits: [{ member_id: 'm-1', amount: 10, percentage: 100 }] })).rejects.toThrow(RepositoryError);

    // saveTransaction insert fetch error
    (client.rpc as any).mockResolvedValueOnce({ data: 'tx-created', error: null });
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.saveTransaction({ workspace_id: 'ws-1', description: 'Tx', amount: 10, transaction_date: '2026-04-01', due_date: '2026-04-01', type: 'expense', status: 'paid' })).rejects.toThrow(RepositoryError);

    // savePurchase update rpc error
    (client.rpc as any).mockResolvedValueOnce({ data: null, error: err });
    await expect(repo.savePurchase({ id: 'p-1', workspace_id: 'ws-1', description: 'P', total_amount: 100, installment_count: 1, purchase_date: '2026-04-01' })).rejects.toThrow(RepositoryError);

    // savePurchase update fetch error
    (client.rpc as any).mockResolvedValueOnce({ data: 'p-1', error: null });
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.savePurchase({ id: 'p-1', workspace_id: 'ws-1', description: 'P', total_amount: 100, installment_count: 1, purchase_date: '2026-04-01', splits: [{ member_id: 'm-1', amount: 100, percentage: 100 }] })).rejects.toThrow(RepositoryError);

    // savePurchase insert fetch error
    (client.rpc as any).mockResolvedValueOnce({ data: 'p-created', error: null });
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.savePurchase({ workspace_id: 'ws-1', description: 'P', total_amount: 100, installment_count: 1, purchase_date: '2026-04-01' })).rejects.toThrow(RepositoryError);


    // savePayment update rpc error
    (client.rpc as any).mockResolvedValueOnce({ data: null, error: err });
    await expect(repo.savePayment({ id: 'pay-1', workspace_id: 'ws-1', amount: 50, payment_date: '2026-04-01', affects_balance: false })).rejects.toThrow(RepositoryError);

    // savePayment update fetch error
    (client.rpc as any).mockResolvedValueOnce({ data: 'pay-1', error: null });
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.savePayment({ id: 'pay-1', workspace_id: 'ws-1', amount: 50, payment_date: '2026-04-01', affects_balance: false })).rejects.toThrow(RepositoryError);

    // savePayment obligation fetch error
    (client.rpc as any).mockResolvedValueOnce({ data: 'pay-new', error: null });
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.savePayment({ workspace_id: 'ws-1', amount: 50, payment_date: '2026-04-01', transaction_id: 'tx-1', affects_balance: true })).rejects.toThrow(RepositoryError);

    // savePayment standalone insert error
    (client.from as any).mockReturnValueOnce({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.savePayment({ workspace_id: 'ws-1', amount: 50, payment_date: '2026-04-01', affects_balance: false })).rejects.toThrow(RepositoryError);

    // saveTransfer update rpc error
    (client.rpc as any).mockResolvedValueOnce({ data: null, error: err });
    await expect(repo.saveTransfer({ id: 'tr-1', workspace_id: 'ws-1', from_account_id: 'a-1', to_account_id: 'a-2', amount: 50, transfer_date: '2026-04-01' })).rejects.toThrow(RepositoryError);

    // saveTransfer update fetch error
    (client.rpc as any).mockResolvedValueOnce({ data: 'tr-1', error: null });
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.saveTransfer({ id: 'tr-1', workspace_id: 'ws-1', from_account_id: 'a-1', to_account_id: 'a-2', amount: 50, transfer_date: '2026-04-01' })).rejects.toThrow(RepositoryError);

    // saveTransfer insert fetch error
    (client.rpc as any).mockResolvedValueOnce({ data: 'tr-new', error: null });
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.saveTransfer({ workspace_id: 'ws-1', from_account_id: 'a-1', to_account_id: 'a-2', amount: 50, transfer_date: '2026-04-01' })).rejects.toThrow(RepositoryError);

    // atomic updates returning null updatedId
    (client.rpc as any).mockResolvedValueOnce({ data: null, error: null });
    await expect(repo.saveTransaction({ id: 'tx-1', workspace_id: 'ws-1', description: 'Tx', amount: 10, transaction_date: '2026-04-01', due_date: '2026-04-01', type: 'expense', status: 'paid' })).rejects.toThrow(RepositoryError);

    (client.rpc as any).mockResolvedValueOnce({ data: null, error: null });
    await expect(repo.savePurchase({ id: 'p-1', workspace_id: 'ws-1', description: 'P', total_amount: 100, installment_count: 1, purchase_date: '2026-04-01' })).rejects.toThrow(RepositoryError);

    (client.rpc as any).mockResolvedValueOnce({ data: null, error: null });
    await expect(repo.savePayment({ id: 'pay-1', workspace_id: 'ws-1', amount: 50, payment_date: '2026-04-01', affects_balance: false })).rejects.toThrow(RepositoryError);

    (client.rpc as any).mockResolvedValueOnce({ data: null, error: null });
    await expect(repo.saveTransfer({ id: 'tr-1', workspace_id: 'ws-1', from_account_id: 'a-1', to_account_id: 'a-2', amount: 50, transfer_date: '2026-04-01' })).rejects.toThrow(RepositoryError);

    // saveRecurring update error
    (client.from as any).mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.saveRecurring({ id: 'r-1', workspace_id: 'ws-1', description: 'R', amount: 10, frequency: 'monthly', type: 'expense', active: true, start_date: '2026-01-01', next_occurrence: '2026-05-01', auto_create: false })).rejects.toThrow(RepositoryError);

    // saveBudget update error
    (client.from as any).mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.saveBudget({ id: 'b-1', workspace_id: 'ws-1', category_id: 'cat-1', planned_amount: 100, month: 4, year: 2026 })).rejects.toThrow(RepositoryError);

    // saveGoal update error
    (client.from as any).mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.saveGoal({ id: 'g-1', workspace_id: 'ws-1', name: 'G', target_amount: 100, current_amount: 10, status: 'in_progress', color: '#10b981', icon: 'target' })).rejects.toThrow(RepositoryError);

    // saveSettlement update error
    (client.from as any).mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.saveSettlement({ id: 's-1', workspace_id: 'ws-1', from_member_id: 'm-1', to_member_id: 'm-2', amount: 10, settlement_date: '2026-04-01' })).rejects.toThrow(RepositoryError);

    // createWorkspace with null id and null rpc error
    (client.rpc as any).mockResolvedValueOnce({ data: null, error: null });
    await expect(repo.createWorkspace({ name: 'WS', owner_id: 'u-1', currency: 'BRL', tracking_mode: 'full' })).rejects.toThrow(RepositoryError);

    // getPurchases query error & splits query error
    (client.from as any).mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: null, error: err }) });
    await expect(repo.getPurchases('ws-1')).rejects.toThrow(RepositoryError);

    (client.from as any).mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: [], error: null }) });
    (client.from as any).mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: null, error: err }) });
    await expect(repo.getPurchases('ws-1')).rejects.toThrow(RepositoryError);

    // getTransactions query error & splits query error
    (client.from as any).mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: null, error: err }) });
    await expect(repo.getTransactions('ws-1')).rejects.toThrow(RepositoryError);

    (client.from as any).mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: [], error: null }) });
    (client.from as any).mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: null, error: err }) });
    await expect(repo.getTransactions('ws-1')).rejects.toThrow(RepositoryError);
  });

  it('covers insert error paths and RPC null response paths across entities in supabase repository', async () => {
    const { client } = createMockSupabaseClient();
    const repo = new SupabaseFinanceRepository(client);
    const err = { message: 'insert failed', code: '42501' };

    // 1. Insert error paths for entities with simple inserts
    // saveAccount insert error
    (client.from as any).mockReturnValueOnce({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.saveAccount({ workspace_id: 'ws-1', name: 'A', type: 'checking', current_balance: 0, initial_balance: 0, active: true, institution: 'Bank', color: '#10b981' })).rejects.toThrow(RepositoryError);

    // savePaymentMethod insert error
    (client.from as any).mockReturnValueOnce({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.savePaymentMethod({ workspace_id: 'ws-1', name: 'PM', type: 'pix', active: true })).rejects.toThrow(RepositoryError);

    // saveCreditCard insert error
    (client.from as any).mockReturnValueOnce({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.saveCreditCard({ workspace_id: 'ws-1', name: 'Card', credit_limit: 100, closing_day: 1, due_day: 10, active: true, institution: 'Bank', color: '#10b981' })).rejects.toThrow(RepositoryError);

    // saveCategory insert error
    (client.from as any).mockReturnValueOnce({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.saveCategory({ workspace_id: 'ws-1', name: 'Cat', type: 'expense', active: true, color: '#10b981', icon: 'tag' })).rejects.toThrow(RepositoryError);

    // saveRecurring insert error
    (client.from as any).mockReturnValueOnce({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.saveRecurring({ workspace_id: 'ws-1', description: 'R', amount: 10, frequency: 'monthly', type: 'expense', active: true, start_date: '2026-01-01', auto_create: false, next_occurrence: '2026-05-01' })).rejects.toThrow(RepositoryError);

    // saveBudget insert error
    (client.from as any).mockReturnValueOnce({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.saveBudget({ workspace_id: 'ws-1', category_id: 'cat-1', planned_amount: 100, month: 4, year: 2026 })).rejects.toThrow(RepositoryError);

    // saveGoal insert error
    (client.from as any).mockReturnValueOnce({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.saveGoal({ workspace_id: 'ws-1', name: 'G', target_amount: 100, current_amount: 10, status: 'in_progress', color: '#10b981', icon: 'target' })).rejects.toThrow(RepositoryError);

    // saveSettlement insert error
    (client.from as any).mockReturnValueOnce({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: err }),
    });
    await expect(repo.saveSettlement({ workspace_id: 'ws-1', from_member_id: 'm-1', to_member_id: 'm-2', amount: 10, settlement_date: '2026-04-01' })).rejects.toThrow(RepositoryError);

    // 2. RPC null ID return without error (hits !txId / !purchaseId / !paymentId / !transferId branch)
    (client.rpc as any).mockResolvedValueOnce({ data: null, error: null });
    await expect(repo.saveTransaction({ workspace_id: 'ws-1', description: 'Tx', amount: 10, transaction_date: '2026-04-01', due_date: '2026-04-01', type: 'expense', status: 'paid' })).rejects.toThrow(RepositoryError);

    (client.rpc as any).mockResolvedValueOnce({ data: null, error: null });
    await expect(repo.savePurchase({ workspace_id: 'ws-1', description: 'P', total_amount: 100, installment_count: 1, purchase_date: '2026-04-01' })).rejects.toThrow(RepositoryError);

    (client.rpc as any).mockResolvedValueOnce({ data: null, error: null });
    await expect(repo.savePayment({ workspace_id: 'ws-1', amount: 10, payment_date: '2026-04-01', transaction_id: 'tx-1' })).rejects.toThrow(RepositoryError);

    (client.rpc as any).mockResolvedValueOnce({ data: null, error: null });
    await expect(repo.saveTransfer({ workspace_id: 'ws-1', from_account_id: 'a-1', to_account_id: 'a-2', amount: 10, transfer_date: '2026-04-01' })).rejects.toThrow(RepositoryError);

    // 3. deletePayment & deleteTransfer null fetch and rpc error branches
    // deletePayment: fetch returns data: null, error: null (!payment)
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    await expect(repo.deletePayment('pay-missing')).rejects.toThrow(RepositoryError);

    // deletePayment: fn_delete_payment returns rpcErr
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { workspace_id: 'ws-1' }, error: null }),
    });
    (client.rpc as any).mockResolvedValueOnce({ error: err });
    await expect(repo.deletePayment('pay-1')).rejects.toThrow(RepositoryError);

    // deleteTransfer: fetch returns data: null, error: null (!transfer)
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    await expect(repo.deleteTransfer('tr-missing')).rejects.toThrow(RepositoryError);

    // deleteTransfer: fn_delete_transfer returns rpcErr
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { workspace_id: 'ws-1' }, error: null }),
    });
    (client.rpc as any).mockResolvedValueOnce({ error: err });
    await expect(repo.deleteTransfer('tr-1')).rejects.toThrow(RepositoryError);
  });

  it('covers null query results, profiles array format, and optional arguments in supabase repository', async () => {
    const { client } = createMockSupabaseClient();
    const repo = new SupabaseFinanceRepository(client);

    // 1. All get* methods returning { data: null, error: null }
    (client.from as any).mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: null, error: null }) });
    const accs = await repo.getAccounts('ws-1');
    expect(accs).toEqual([]);

    (client.from as any).mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: null, error: null }) });
    const pms = await repo.getPaymentMethods('ws-1');
    expect(pms).toEqual([]);

    (client.from as any).mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: null, error: null }) });
    const cards = await repo.getCreditCards('ws-1');
    expect(cards).toEqual([]);

    (client.from as any).mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: null, error: null }) });
    const bills = await repo.getCreditCardBills('c-1');
    expect(bills).toEqual([]);

    (client.from as any).mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: null, error: null }) });
    const cats = await repo.getCategories('ws-1');
    expect(cats).toEqual([]);

    (client.from as any).mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: null, error: null }) });
    const insts = await repo.getInstallments('p-1');
    expect(insts).toEqual([]);

    (client.from as any).mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: null, error: null }) });
    const pays = await repo.getPayments('ws-1');
    expect(pays).toEqual([]);

    (client.from as any).mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: null, error: null }) });
    const trs = await repo.getTransfers('ws-1');
    expect(trs).toEqual([]);

    (client.from as any).mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: null, error: null }) });
    const recs = await repo.getRecurring('ws-1');
    expect(recs).toEqual([]);

    (client.from as any).mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: null, error: null }) });
    const bgs = await repo.getBudgets('ws-1');
    expect(bgs).toEqual([]);

    (client.from as any).mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: null, error: null }) });
    const goals = await repo.getGoals('ws-1');
    expect(goals).toEqual([]);

    (client.from as any).mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: null, error: null }) });
    const setts = await repo.getSettlements('ws-1');
    expect(setts).toEqual([]);

    // 2. getPurchases and getTransactions with multiple splits per item
    (client.from as any).mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: [{ id: 'p-1', workspace_id: 'ws-1', description: 'P', total_amount: 100, installment_count: 1, purchase_date: '2026-04-01' }], error: null }) });
    (client.from as any).mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: [{ id: 'ps-1', purchase_id: 'p-1', workspace_id: 'ws-1', member_id: 'm-1', amount: 50 }, { id: 'ps-2', purchase_id: 'p-1', workspace_id: 'ws-1', member_id: 'm-2', amount: 50 }], error: null }) });
    const purchasesWithMultiSplits = await repo.getPurchases('ws-1');
    expect(purchasesWithMultiSplits[0].splits?.length).toBe(2);

    (client.from as any).mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: [{ id: 'tx-1', workspace_id: 'ws-1', description: 'T', amount: 100, transaction_date: '2026-04-01', due_date: '2026-04-01', type: 'expense', status: 'completed' }], error: null }) });
    (client.from as any).mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: [{ id: 'ts-1', transaction_id: 'tx-1', workspace_id: 'ws-1', member_id: 'm-1', amount: 50 }, { id: 'ts-2', transaction_id: 'tx-1', workspace_id: 'ws-1', member_id: 'm-2', amount: 50 }], error: null }) });
    const txWithMultiSplits = await repo.getTransactions('ws-1');
    expect(txWithMultiSplits[0].splits?.length).toBe(2);

    // 3. Profiles as array in addWorkspaceMember and updateWorkspaceMemberRole
    (client.from as any).mockReturnValueOnce({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'm-arr', workspace_id: 'ws-1', user_id: 'u-1', role: 'member', created_at: '2026-01-01', profiles: [{ id: 'u-1', name: 'Array Profile', email: 'arr@example.com' }] },
        error: null,
      }),
    });
    const memberWithArr = await repo.addWorkspaceMember({ workspace_id: 'ws-1', user_id: 'u-1', role: 'member' });
    expect(memberWithArr.user?.name).toBe('Array Profile');

    (client.from as any).mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'm-arr', workspace_id: 'ws-1', user_id: 'u-1', role: 'admin', created_at: '2026-01-01', profiles: [{ id: 'u-1', name: 'Array Profile' }] },
        error: null,
      }),
    });
    const updatedMemberWithArr = await repo.updateWorkspaceMemberRole('m-arr', 'admin');
    expect(updatedMemberWithArr.role).toBe('admin');

    // 4. savePayment with installment_id and credit_card_bill_id obligation (hits boolean branches)
    (client.rpc as any).mockResolvedValueOnce({ data: 'pay-inst', error: null });
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'pay-inst', workspace_id: 'ws-1', amount: 50, payment_date: '2026-04-01', installment_id: 'inst-1', affects_balance: true },
        error: null,
      }),
    });
    const payInst = await repo.savePayment({
      workspace_id: 'ws-1',
      amount: 50,
      payment_date: '2026-04-01',
      installment_id: 'inst-1',
      account_id: 'acc-1',
      affects_balance: true,
    });
    expect(payInst.id).toBe('pay-inst');

    (client.rpc as any).mockResolvedValueOnce({ data: 'pay-bill', error: null });
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'pay-bill', workspace_id: 'ws-1', amount: 100, payment_date: '2026-04-01', credit_card_bill_id: 'bill-1', affects_balance: false },
        error: null,
      }),
    });
    const payBill = await repo.savePayment({
      workspace_id: 'ws-1',
      amount: 100,
      payment_date: '2026-04-01',
      credit_card_bill_id: 'bill-1',
      affects_balance: false,
    });
    expect(payBill.id).toBe('pay-bill');

    // 5. Query error tests for getInstallments, getPayments, getTransfers, and deletePurchase
    const postgrestErr = { message: 'Failed query', code: '42501' };
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: null, error: postgrestErr }),
    });
    await expect(repo.getInstallments('p-1')).rejects.toThrow(RepositoryError);

    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: null, error: postgrestErr }),
    });
    await expect(repo.getPayments('ws-1')).rejects.toThrow(RepositoryError);

    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: null, error: postgrestErr }),
    });
    await expect(repo.getTransfers('ws-1')).rejects.toThrow(RepositoryError);

    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { workspace_id: 'ws-1' }, error: null }),
    });
    (client.rpc as any).mockResolvedValueOnce({ error: postgrestErr });
    await expect(repo.deletePurchase('p-1')).rejects.toThrow(RepositoryError);

    // 6. deletePayment, deleteTransfer, deleteTransaction and deletePurchase fetch error
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: postgrestErr }),
    });
    await expect(repo.deletePayment('pay-fetch-err')).rejects.toThrow(RepositoryError);

    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: postgrestErr }),
    });
    await expect(repo.deleteTransfer('tr-fetch-err')).rejects.toThrow(RepositoryError);

    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: postgrestErr }),
    });
    await expect(repo.deleteTransaction('tx-fetch-err')).rejects.toThrow(RepositoryError);

    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: postgrestErr }),
    });
    await expect(repo.deletePurchase('p-fetch-err')).rejects.toThrow(RepositoryError);

    // 7. saveTransaction and savePurchase insert with splits undefined
    (client.rpc as any).mockResolvedValueOnce({ data: 'tx-no-splits', error: null });
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'tx-no-splits', workspace_id: 'ws-1', description: 'Tx No Splits', amount: 10, transaction_date: '2026-04-01', due_date: '2026-04-01', type: 'expense', status: 'completed' },
        error: null,
      }),
    });
    const savedTxNoSplits = await repo.saveTransaction({
      workspace_id: 'ws-1',
      description: 'Tx No Splits',
      amount: 10,
      transaction_date: '2026-04-01',
      due_date: '2026-04-01',
      type: 'expense',
      status: 'paid',
    });
    expect(savedTxNoSplits.id).toBe('tx-no-splits');

    (client.rpc as any).mockResolvedValueOnce({ data: 'p-no-splits', error: null });
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'p-no-splits', workspace_id: 'ws-1', description: 'P No Splits', total_amount: 100, installment_count: 1, purchase_date: '2026-04-01' },
        error: null,
      }),
    });
    const savedPNoSplits = await repo.savePurchase({
      workspace_id: 'ws-1',
      description: 'P No Splits',
      total_amount: 100,
      installment_count: 1,
      purchase_date: '2026-04-01',
    });
    expect(savedPNoSplits.id).toBe('p-no-splits');

    // 8. deleteTransaction error
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { workspace_id: 'ws-1' }, error: null }),
    });
    (client.rpc as any).mockResolvedValueOnce({ error: postgrestErr });
    await expect(repo.deleteTransaction('tx-1')).rejects.toThrow(RepositoryError);

    // 9. getPurchases and getTransactions with data: null and no splits
    (client.from as any).mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: null, error: null }) });
    (client.from as any).mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: null, error: null }) });
    const emptyPurchases = await repo.getPurchases('ws-1');
    expect(emptyPurchases).toEqual([]);

    (client.from as any).mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: null, error: null }) });
    (client.from as any).mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: null, error: null }) });
    const emptyTxs = await repo.getTransactions('ws-1');
    expect(emptyTxs).toEqual([]);

    // 10. saveTransaction and savePurchase update without splits (splits === undefined)
    // 10. saveTransaction and savePurchase update without splits (splits === undefined)
    (client.rpc as any).mockResolvedValueOnce({ data: 'tx-1', error: null });
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'tx-1', workspace_id: 'ws-1', description: 'Tx Updated', amount: 10, transaction_date: '2026-04-01', due_date: '2026-04-01', type: 'expense', status: 'completed' },
        error: null,
      }),
    });
    const updatedTxNoSplits = await repo.saveTransaction({
      id: 'tx-1',
      workspace_id: 'ws-1',
      description: 'Tx Updated',
      amount: 10,
      transaction_date: '2026-04-01',
      due_date: '2026-04-01',
      type: 'expense',
      status: 'paid',
    });
    expect(updatedTxNoSplits.id).toBe('tx-1');

    (client.rpc as any).mockResolvedValueOnce({ data: 'p-1', error: null });
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'p-1', workspace_id: 'ws-1', description: 'P Updated', total_amount: 100, installment_count: 1, purchase_date: '2026-04-01' },
        error: null,
      }),
    });
    const updatedPNoSplits = await repo.savePurchase({
      id: 'p-1',
      workspace_id: 'ws-1',
      description: 'P Updated',
      total_amount: 100,
      installment_count: 1,
      purchase_date: '2026-04-01',
    });
    expect(updatedPNoSplits.id).toBe('p-1');

    // 11. saveTransfer update
    (client.rpc as any).mockResolvedValueOnce({ data: 'tr-1', error: null });
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'tr-1', workspace_id: 'ws-1', from_account_id: 'a-1', to_account_id: 'a-2', amount: 50, transfer_date: '2026-04-01' },
        error: null,
      }),
    });
    const updatedTr = await repo.saveTransfer({
      id: 'tr-1',
      workspace_id: 'ws-1',
      from_account_id: 'a-1',
      to_account_id: 'a-2',
      amount: 50,
      transfer_date: '2026-04-01',
    });
    expect(updatedTr.id).toBe('tr-1');

    // 12. savePayment update and standalone insert
    (client.rpc as any).mockResolvedValueOnce({ data: 'pay-1', error: null });
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'pay-1', workspace_id: 'ws-1', amount: 50, payment_date: '2026-04-01', affects_balance: false },
        error: null,
      }),
    });
    const updatedPay = await repo.savePayment({
      id: 'pay-1',
      workspace_id: 'ws-1',
      amount: 50,
      payment_date: '2026-04-01',
      affects_balance: false,
    });
    expect(updatedPay.id).toBe('pay-1');

    (client.from as any).mockReturnValueOnce({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'pay-std', workspace_id: 'ws-1', amount: 25, payment_date: '2026-04-01', affects_balance: false },
        error: null,
      }),
    });
    const stdPay = await repo.savePayment({
      workspace_id: 'ws-1',
      amount: 25,
      payment_date: '2026-04-01',
      affects_balance: false,
    });
    expect(stdPay.id).toBe('pay-std');

    // 13. getPaymentMethods, deletePaymentMethod, deleteCategory errors
    (client.from as any).mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: null, error: postgrestErr }) });
    await expect(repo.getPaymentMethods('ws-1')).rejects.toThrow(RepositoryError);

    (client.from as any).mockReturnValueOnce({ delete: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: postgrestErr }) });
    await expect(repo.deletePaymentMethod('pm-1')).rejects.toThrow(RepositoryError);

    (client.from as any).mockReturnValueOnce({ delete: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: postgrestErr }) });
    await expect(repo.deleteCategory('cat-1')).rejects.toThrow(RepositoryError);

    // 14. Mixed splits in getPurchases and getTransactions
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({
        data: [
          { id: 'p-with-splits', workspace_id: 'ws-1', description: 'P1', total_amount: 100, installment_count: 1, purchase_date: '2026-04-01' },
          { id: 'p-no-splits', workspace_id: 'ws-1', description: 'P2', total_amount: 50, installment_count: 1, purchase_date: '2026-04-01' },
        ],
        error: null,
      }),
    });
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({
        data: [{ id: 'ps-1', purchase_id: 'p-with-splits', workspace_id: 'ws-1', member_id: 'm-1', amount: 100 }],
        error: null,
      }),
    });
    const mixedPurchases = await repo.getPurchases('ws-1');
    expect(mixedPurchases[0].splits?.length).toBe(1);
    expect(mixedPurchases[1].splits).toBeUndefined();

    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({
        data: [
          { id: 'tx-with-splits', workspace_id: 'ws-1', description: 'T1', amount: 100, transaction_date: '2026-04-01', due_date: '2026-04-01', type: 'expense', status: 'completed' },
          { id: 'tx-no-splits', workspace_id: 'ws-1', description: 'T2', amount: 50, transaction_date: '2026-04-01', due_date: '2026-04-01', type: 'expense', status: 'completed' },
        ],
        error: null,
      }),
    });
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({
        data: [{ id: 'ts-1', transaction_id: 'tx-with-splits', workspace_id: 'ws-1', member_id: 'm-1', amount: 100 }],
        error: null,
      }),
    });
    const mixedTxs = await repo.getTransactions('ws-1');
    expect(mixedTxs[0].splits?.length).toBe(1);
    expect(mixedTxs[1].splits).toBeUndefined();

    // 16. Covers getWorkspaces data null, createWorkspace default vs custom args, getWorkspaceMembers null & object profile
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    const nullWs = await repo.getWorkspaces();
    expect(nullWs).toEqual([]);

    (client.rpc as any).mockResolvedValueOnce({ data: 'ws-def', error: null });
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'ws-def', name: 'Def', currency: 'BRL', tracking_mode: 'full' }, error: null }),
    });
    const defWs = await repo.createWorkspace({ name: 'Def', owner_id: 'u-1' } as any);
    expect(defWs.id).toBe('ws-def');

    (client.rpc as any).mockResolvedValueOnce({ data: 'ws-cust', error: null });
    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'ws-cust', name: 'Cust', currency: 'USD', tracking_mode: 'expense_tracker' }, error: null }),
    });
    const custWs = await repo.createWorkspace({ name: 'Cust', owner_id: 'u-1', currency: 'USD', tracking_mode: 'expense_tracker' });
    expect(custWs.id).toBe('ws-cust');

    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    const nullMembers = await repo.getWorkspaceMembers('ws-1');
    expect(nullMembers).toEqual([]);

    (client.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({
        data: [{ id: 'm-obj', user_id: 'u-1', workspace_id: 'ws-1', role: 'member', profiles: { id: 'u-1', name: 'Obj User', email: 'obj@test.com' } }],
        error: null,
      }),
    });
    const objMembers = await repo.getWorkspaceMembers('ws-1');
    expect(objMembers[0].user?.name).toBe('Obj User');
  });
});
