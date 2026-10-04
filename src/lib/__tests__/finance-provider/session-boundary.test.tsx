import { describe, it, expect, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { FinanceProvider, useFinance } from '../../context/finance-context';
import { AuthContext, AuthContextType } from '../../context/auth-context';
import { getInitialFinanceState } from '../../context/finance-storage';
import { FinanceRepository } from '../../repositories/finance-repository';
import { FinanceState } from '../../context/finance-state';
import { setupFinanceHarness } from '../test-utils/finance-provider-harness';

function snapshot(owner: string): FinanceState {
  const base = getInitialFinanceState();
  for (const key of Object.keys(base) as (keyof FinanceState)[]) {
    if (Array.isArray(base[key])) Reflect.set(base, key, []);
  }
  return {
    ...base, activeWorkspaceId: `ws-${owner}`,
    allWorkspaces: [{ id: `ws-${owner}`, name: owner, owner_id: owner, currency: 'BRL', created_at: '2026-01-01' }],
    allWorkspaceMembers: [],
    allAccounts: [{ id: `acc-${owner}`, workspace_id: `ws-${owner}`, name: owner, type: 'cash', active: true, current_balance: 1000, initial_balance: 1000, institution: '', color: '#000', created_at: '2026-01-01' }],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('FinanceProvider: limite de identidade de sessão', () => {
  setupFinanceHarness();

  async function mount() {
    let ctx!: ReturnType<typeof useFinance>;
    let identity = 'a';
    const a = snapshot('a'), b = snapshot('b');
    const repo = {
      getWorkspaces: vi.fn(async () => identity === 'a' ? a.allWorkspaces : b.allWorkspaces),
      loadSnapshot: vi.fn(async () => identity === 'a' ? a : b),
      materializeRecurring: vi.fn(async () => ({ created_transactions: 0 })),
      saveAccount: vi.fn(async (data) => ({ ...data, id: data.id ?? 'created', created_at: '2026-01-01' })),
    };
    const root = createRoot(document.createElement('div'));
    function Consumer() { ctx = useFinance(); return null; }
    async function render(userId: string | null) {
      identity = userId ?? '';
      const auth = { user: userId ? { id: userId, name: userId, email: 'fixture@example.test', created_at: '2026-01-01' } : null, dataMode: 'supabase', isLoading: false } as AuthContextType;
      await act(async () => root.render(
        <AuthContext.Provider value={auth}>
          <FinanceProvider repository={repo as unknown as FinanceRepository} initialDataMode="supabase">
            <Consumer />
          </FinanceProvider>
        </AuthContext.Provider>
      ));
    }
    await render('a');
    return { getCtx: () => ctx, repo, render, close: () => act(async () => root.unmount()) };
  }

  it('limpa dados no logout e mantém vazio se a próxima identidade falhar', async () => {
    const h = await mount();
    try {
      expect(h.getCtx().accounts.map((a) => a.id)).toEqual(['acc-a']);
      await h.render(null);
      expect(h.getCtx().accounts).toEqual([]);
      h.repo.getWorkspaces.mockRejectedValueOnce(new Error('B indisponível'));
      await h.render('b');
      expect(h.getCtx().accounts).toEqual([]);
      expect(h.getCtx().activeWorkspace.id).toBe('');
    } finally { await h.close(); }
  });

  it('não reutiliza autorização antiga ao retornar de A para B e depois A', async () => {
    const h = await mount();
    try {
      const oldCtx = h.getCtx();
      await h.render('b');
      await h.render('a');
      expect(h.getCtx().accounts.map((a) => a.id)).toEqual(['acc-a']);
      expect(() => oldCtx.updateAccount('acc-a', { name: 'old generation' })).toThrow(/Sessão alterada/);
    } finally { await h.close(); }
  });

  it('mantém modo Supabase sem AuthProvider e impede qualquer mutation', async () => {
    let ctx!: ReturnType<typeof useFinance>;
    const repo = { getWorkspaces: vi.fn(), loadSnapshot: vi.fn() } as unknown as FinanceRepository;
    const root = createRoot(document.createElement('div'));
    function Consumer() { ctx = useFinance(); return null; }
    try {
      await act(async () => root.render(<FinanceProvider initialDataMode="supabase" repository={repo}><Consumer /></FinanceProvider>));
      expect(ctx.dataMode).toBe('supabase');
      expect(ctx.accounts).toEqual([]);
      expect(() => ctx.updateAccount('acc-a', { name: 'unauthorized' })).toThrow(/não autenticado/);
      expect(repo.getWorkspaces).not.toHaveBeenCalled();
    } finally { await act(async () => root.unmount()); }
  });

  it('reconcilia id temporário com id canônico mesmo sem crypto no navegador', async () => {
    vi.stubGlobal('crypto', undefined);
    const h = await mount();
    try {
      const canonical = 'e1400000-0000-0000-0000-000000000001';
      h.repo.saveAccount.mockImplementationOnce(async (data) => ({ ...data, id: canonical, created_at: '2026-01-01' }));
      await act(async () => {
        h.getCtx().addAccount({ name: 'Compatibility', type: 'cash', institution: '', color: '#000', active: true, initial_balance: 0, current_balance: 0 });
        await h.getCtx().waitForPendingMutations();
      });
      expect(h.getCtx().accounts.some((a) => a.id === canonical && a.name === 'Compatibility')).toBe(true);
    } finally { await h.close(); vi.unstubAllGlobals(); }
  });

  it('não aplica resposta tardia de refresh A em B', async () => {
    const h = await mount();
    const pending = deferred<FinanceState>();
    try {
      h.repo.loadSnapshot.mockImplementationOnce(() => pending.promise);
      let refresh!: Promise<void>;
      await act(async () => { refresh = h.getCtx().refreshData(); refresh.catch(() => {}); });
      await h.render('b');
      await act(async () => { pending.resolve(snapshot('a')); await refresh.catch(() => {}); });
      expect(h.getCtx().accounts.map((a) => a.id)).toEqual(['acc-b']);
    } finally { await h.close(); }
  });

  it('não envia gravação A enfileirada sob sessão B, nem mantém erro/estado de A', async () => {
    const h = await mount();
    const pending = deferred<Record<string, unknown>>();
    try {
      h.repo.saveAccount.mockImplementationOnce(() => pending.promise as never);
      let finished!: Promise<void>;
      await act(async () => {
        const ctx = h.getCtx();
        ctx.updateAccount('acc-a', { name: 'first' });
        ctx.updateAccount('acc-a', { name: 'queued' });
        finished = ctx.waitForPendingMutations();
      });
      expect(h.repo.saveAccount).toHaveBeenCalledTimes(1);
      const oldCtx = h.getCtx();
      await h.render('b');
      expect(() => oldCtx.updateAccount('acc-a', { name: 'stale identity' })).toThrow(/Sessão alterada/);
      await act(async () => { pending.resolve({ ...snapshot('a').allAccounts[0], name: 'first' }); await finished; });
      expect(h.repo.saveAccount).toHaveBeenCalledTimes(1);
      expect(h.getCtx().accounts.map((a) => a.id)).toEqual(['acc-b']);
      expect(h.getCtx().error).toBeNull();
      expect(h.getCtx().isSaving).toBe(false);
    } finally { await h.close(); }
  });

  it('falha fechado em repository incompleto durante troca, sem restaurar dados locais', async () => {
    const h = await mount();
    try {
      Reflect.set(h.repo, 'getWorkspaces', undefined);
      await h.render('b');
      expect(h.getCtx().accounts).toEqual([]);
      expect(h.getCtx().error).not.toBeNull();
    } finally { await h.close(); }
  });
});
