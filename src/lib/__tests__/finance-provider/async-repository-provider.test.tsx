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
    allSettlements: [],
    ...overrides,
  };
}

function createMockRepository(snapshot: FinanceState) {
  const repo: FinanceRepository = {
    loadSnapshot: vi.fn().mockImplementation(async (wsId: string) => ({
      ...snapshot,
      activeWorkspaceId: wsId,
    })),
    getWorkspaces: vi.fn().mockImplementation(async () => snapshot.allWorkspaces),
    createWorkspace: vi.fn().mockImplementation(async (data) => ({
      ...data,
      id: 'ws-remote-created',
      created_at: '2026-01-01',
    })),
    updateWorkspace: vi.fn().mockImplementation(async (id, data) => ({
      ...snapshot.allWorkspaces[0],
      ...data,
      id,
    })),
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
  };
  return repo;
}

import { setupFinanceHarness } from '../test-utils/finance-provider-harness';

describe('FinanceProvider - Repositório Assíncrono e Modo Supabase', () => {
  setupFinanceHarness();
  const activeRoots: any[] = [];

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

  async function mountTestProvider(
    props: Partial<FinanceProviderProps> = {},
    authContextValue?: Partial<AuthContextType>
  ) {
    let currentCtx!: ReturnType<typeof useFinance>;
    function Consumer() {
      currentCtx = useFinance();
      return null;
    }

    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);
    activeRoots.push(root);

    const defaultAuth: AuthContextType = {
      user: { id: 'usr-1', name: 'Rodrigo', email: 'rodrigo@test.com', created_at: '2026-01-01' },
      isLoading: false,
      login: vi.fn(),
      signUp: vi.fn(),
      resetPassword: vi.fn(),
      updatePassword: vi.fn(),
      logout: vi.fn(),
      updateProfile: vi.fn(),
      dataMode: props.initialDataMode || 'supabase',
      ...authContextValue,
    };

    await act(async () => {
      root.render(
        <AuthContext.Provider value={defaultAuth}>
          <FinanceProvider {...props}>
            <Consumer />
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
      allWorkspaces: [],
    });
    const repo = createMockRepository(snapshot);
    (repo.getWorkspaces as any).mockResolvedValueOnce([]);

    const { getCtx } = await mountTestProvider(
      {
        repository: repo,
        initialDataMode: 'supabase',
      },
      { user: null }
    );

    expect(getCtx().isLoaded).toBe(true);
    expect(repo.createWorkspace).toHaveBeenCalledWith({
      name: 'Meu Workspace',
      owner_id: 'usr-1',
      currency: 'BRL',
      tracking_mode: 'full',
    });
    expect(repo.loadSnapshot).toHaveBeenCalledWith('ws-remote-created');
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
        <FinanceProvider repository={repo} initialDataMode="supabase">
          <div>Test</div>
        </FinanceProvider>
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
        <FinanceProvider repository={repo} initialDataMode="supabase">
          <div>Test</div>
        </FinanceProvider>
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
      await new Promise((r) => setTimeout(r, 60));
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
});
