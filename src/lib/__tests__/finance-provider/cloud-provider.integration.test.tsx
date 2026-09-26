import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { FinanceProvider, useFinance } from '../../context/finance-context';
import { AuthContext, AuthContextType } from '../../context/auth-context';
import { SupabaseFinanceRepository } from '../../repositories/supabase-finance-repository';
import { Database } from '../../supabase/database.types';
import { Purchase } from '../../types';

const isCloudEnabled = process.env.TEST_CLOUD === 'true';

function getEnvConfig() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const idx = trimmed.indexOf('=');
        const k = trimmed.slice(0, idx).trim();
        const v = trimmed.slice(idx + 1).trim();
        if (!env[k]) env[k] = v;
      }
    }
  }
  return env;
}

function getServiceRoleKey(): string | null {
  try {
    const out = execSync(
      'cmd /c npx supabase projects api-keys --project-ref iwesoczokkycjovyknnz --reveal --output json',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const keys = JSON.parse(out);
    const sr = keys.find((k: any) => k.name === 'service_role' || k.tags?.includes('service_role'));
    return sr?.api_key ?? null;
  } catch {
    return null;
  }
}

import { setupFinanceHarness } from '../test-utils/finance-provider-harness';

describe.runIf(isCloudEnabled)('FinanceProvider Real Cloud Integration (Staging)', { timeout: 60000 }, () => {
  setupFinanceHarness();

  let adminClient: SupabaseClient<Database>;
  let userClient1: SupabaseClient<Database>;
  let userClient2: SupabaseClient<Database>;
  let repo1: SupabaseFinanceRepository;
  let repo2: SupabaseFinanceRepository;

  let testUser1Id: string;
  let testUser1Email: string;
  let testUser2Id: string;
  let testUser2Email: string;

  let testWorkspaceId: string;
  let testAccountId: string;

  const activeRoots: any[] = [];

  beforeAll(async () => {
    const env = getEnvConfig();
    const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceRoleKey = getServiceRoleKey();

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error('Configurações do Supabase Staging incompletas para teste do Provider em nuvem.');
    }

    adminClient = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 7);

    // 1. Cria Usuário 1 (Navegador 1 - Proprietário)
    testUser1Email = `test.prov1.${timestamp}.${rand}@fincontrol.app`;
    const testPassword1 = `TestPass!${timestamp}#Prov1`;
    const { data: user1Res, error: err1 } = await adminClient.auth.admin.createUser({
      email: testUser1Email,
      password: testPassword1,
      email_confirm: true,
      user_metadata: { name: 'Browser 1 Owner' },
    });
    if (err1 || !user1Res.user) throw new Error(`Falha ao criar usuário 1: ${err1?.message}`);
    testUser1Id = user1Res.user.id;

    // 2. Cria Usuário 2 (Navegador 2 - Membro Colaborador)
    testUser2Email = `test.prov2.${timestamp}.${rand}@fincontrol.app`;
    const testPassword2 = `TestPass!${timestamp}#Prov2`;
    const { data: user2Res, error: err2 } = await adminClient.auth.admin.createUser({
      email: testUser2Email,
      password: testPassword2,
      email_confirm: true,
      user_metadata: { name: 'Browser 2 Member' },
    });
    if (err2 || !user2Res.user) throw new Error(`Falha ao criar usuário 2: ${err2?.message}`);
    testUser2Id = user2Res.user.id;

    // 3. Autentica Usuário 1
    userClient1 = createClient<Database>(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: login1Err } = await userClient1.auth.signInWithPassword({
      email: testUser1Email,
      password: testPassword1,
    });
    if (login1Err) throw new Error(`Login 1 falhou: ${login1Err.message}`);
    repo1 = new SupabaseFinanceRepository(userClient1);

    // 4. Autentica Usuário 2
    userClient2 = createClient<Database>(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: login2Err } = await userClient2.auth.signInWithPassword({
      email: testUser2Email,
      password: testPassword2,
    });
    if (login2Err) throw new Error(`Login 2 falhou: ${login2Err.message}`);
    repo2 = new SupabaseFinanceRepository(userClient2);

    // 5. Cria Workspace compartilhado via repo1
    const ws = await repo1.createWorkspace({
      name: 'Workspace Nuvem Integrada',
      owner_id: testUser1Id,
      currency: 'BRL',
      tracking_mode: 'full',
    });
    testWorkspaceId = ws.id;

    // 6. Adiciona Usuário 2 ao workspace como membro
    await repo1.addWorkspaceMember({
      workspace_id: testWorkspaceId,
      user_id: testUser2Id,
      role: 'member',
    });

    // 7. Cria Conta Bancária inicial via repo1
    const acc = await repo1.saveAccount({
      workspace_id: testWorkspaceId,
      name: 'Conta Nubank Cloud',
      institution: 'Nubank',
      type: 'checking',
      color: '#8A05BE',
      initial_balance: 5000,
      current_balance: 5000,
      active: true,
    });
    testAccountId = acc.id;
  }, 40000);

  afterAll(async () => {
    while (activeRoots.length > 0) {
      const root = activeRoots.pop();
      try {
        await act(async () => {
          root.unmount();
        });
      } catch {
        // ignore unmount errors on teardown
      }
    }

    if (adminClient && testUser1Id) {
      await adminClient.from('workspaces').delete().eq('owner_id', testUser1Id);
    }
    if (testWorkspaceId && adminClient) {
      await adminClient.from('workspaces').delete().eq('id', testWorkspaceId);
    }
    if (testUser1Id && adminClient) {
      await adminClient.auth.admin.deleteUser(testUser1Id);
    }
    if (testUser2Id && adminClient) {
      await adminClient.auth.admin.deleteUser(testUser2Id);
    }
  }, 20000);

  async function mountCloudProvider(
    repo: SupabaseFinanceRepository,
    userId: string,
    email: string,
    initialWorkspaceId?: string
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
      user: { id: userId, name: email.split('@')[0], email, created_at: new Date().toISOString() },
      isLoading: false,
      login: async () => {},
      signUp: async () => ({ error: null, user: null }),
      resetPassword: async () => ({ error: null }),
      updatePassword: async () => ({ error: null }),
      logout: async () => {},
      updateProfile: () => {},
      dataMode: 'supabase',
    };

    await act(async () => {
      root.render(
        <AuthContext.Provider value={authVal}>
          <FinanceProvider
            repository={repo}
            initialDataMode="supabase"
            initialWorkspaceId={initialWorkspaceId || testWorkspaceId}
          >
            <Consumer />
          </FinanceProvider>
        </AuthContext.Provider>
      );
    });

    // Aguarda hidratação inicial do repositório remoto
    for (let i = 0; i < 50; i++) {
      if (currentCtx?.isLoaded && !currentCtx?.isLoading) break;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
    }

    return {
      getCtx: () => currentCtx,
      root,
    };
  }

  it('1. hidrata simultaneamente dois navegadores no Staging sem dados mock locais', async () => {
    const browser1 = await mountCloudProvider(repo1, testUser1Id, testUser1Email);
    const browser2 = await mountCloudProvider(repo2, testUser2Id, testUser2Email);

    const ctx1 = browser1.getCtx();
    const ctx2 = browser2.getCtx();

    expect(ctx1.dataMode).toBe('supabase');
    expect(ctx2.dataMode).toBe('supabase');
    expect(ctx1.isLoaded).toBe(true);
    expect(ctx2.isLoaded).toBe(true);

    expect(ctx1.workspaces.some((w) => w.id === testWorkspaceId)).toBe(true);
    expect(ctx2.workspaces.some((w) => w.id === testWorkspaceId)).toBe(true);
    expect(ctx1.accounts.some((a) => a.id === testAccountId)).toBe(true);
  });

  it('2. cria compra parcelada encadeada, reconcilia UUID canônico do Cloud e quita parcela imediatamente sem aguardar isSaving=false', async () => {
    const browser1 = await mountCloudProvider(repo1, testUser1Id, testUser1Email);
    const getCtx1 = browser1.getCtx;

    // 1. Cria compra parcelada de forma otimista
    let createdPurchase!: Purchase;
    await act(async () => {
      createdPurchase = getCtx1().createInstallmentPurchase({
        description: 'MacBook Air Staging',
        total_amount: 1500,
        installment_count: 3,
        purchase_date: '2026-09-25',
      });
    });

    const localInstallments = getCtx1().installments.filter((i) => i.purchase_id === createdPurchase.id);
    const localInst1 = localInstallments.find((i) => i.installment_number === 1)!;
    expect(localInst1).toBeDefined();
    expect(localInst1.id).toBeDefined();

    // 2. DISPARA QUITAÇÃO IMEDIATAMENTE (sem aguardar isSaving=false)
    // O Provider resolve o ID local para o UUID canônico retornado pelo Cloud via idMapRef
    await act(async () => {
      getCtx1().recordPayment({
        installment_id: localInst1.id,
        amount: 500,
        payment_date: '2026-09-25',
        account_id: testAccountId,
      });
    });

    // 3. Aguarda esvaziamento completo da fila de mutações
    for (let i = 0; i < 50; i++) {
      if (!getCtx1().isSaving && getCtx1().installments.some((inst) => inst.purchase_id !== undefined && inst.status === 'paid')) break;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 100));
      });
    }

    expect(getCtx1().isSaving).toBe(false);
    expect(getCtx1().error).toBeNull();

    // 4. Verifica se adotou UUID canônico do banco de dados (não 'pur-xxxx')
    const freshPurchases = getCtx1().purchases;
    const createdPur = freshPurchases.find((p) => p.description === 'MacBook Air Staging');
    expect(createdPur).toBeDefined();
    expect(createdPur!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    // 5. Verifica parcelas com UUIDs canônicos do banco e primeira parcela quitada
    const installments = getCtx1().installments.filter((i) => i.purchase_id === createdPur!.id);
    expect(installments.length).toBe(3);
    const inst1 = installments.find((i) => i.installment_number === 1);
    expect(inst1).toBeDefined();
    expect(inst1!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(inst1!.status).toBe('paid');
    expect(inst1!.paid_amount).toBe(500);

    // 6. Confirma diretamente no banco do Supabase Cloud que o pagamento foi gravado com o UUID canônico da parcela
    const { data: dbPayment, error: dbErr } = await adminClient
      .from('payments')
      .select('*')
      .eq('installment_id', inst1!.id)
      .single();
    expect(dbErr).toBeNull();
    expect(dbPayment).toBeDefined();
    expect(dbPayment!.amount).toBe(500);
    expect(dbPayment!.account_id).toBe(testAccountId);
  });

  it('3. suporta modo expense_tracker sem conta bancária e com affects_balance: false sem erro de constraint no Cloud', async () => {
    // 1. Cria workspace sem saldo (expense_tracker)
    const wsSemSaldo = await repo1.createWorkspace({
      name: 'Despesas Sem Saldo Cloud',
      owner_id: testUser1Id,
      currency: 'BRL',
      tracking_mode: 'expense_tracker',
    });

    const browser1 = await mountCloudProvider(repo1, testUser1Id, testUser1Email, wsSemSaldo.id);
    const getCtx1 = browser1.getCtx;

    expect(getCtx1().activeWorkspace.id).toBe(wsSemSaldo.id);
    expect(getCtx1().activeWorkspace.tracking_mode).toBe('expense_tracker');

    // 2. Adiciona despesa pendente
    await act(async () => {
      getCtx1().addTransaction({
        description: 'Almoço Executivo',
        amount: 85,
        type: 'expense',
        status: 'pending',
        transaction_date: '2026-09-25',
        due_date: '2026-09-25',
      });
    });

    for (let i = 0; i < 50; i++) {
      if (!getCtx1().isSaving && getCtx1().transactions.some((t) => t.description === 'Almoço Executivo')) break;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 100));
      });
    }

    const tx = getCtx1().transactions.find((t) => t.description === 'Almoço Executivo');
    expect(tx).toBeDefined();

    // 3. Registra pagamento sem conta bancária (affects_balance: false)
    await act(async () => {
      getCtx1().recordPayment({
        transaction_id: tx!.id,
        amount: 85,
        payment_date: '2026-09-25',
      });
    });

    for (let i = 0; i < 50; i++) {
      if (!getCtx1().isSaving && getCtx1().transactions.find((t) => t.id === tx!.id)?.status === 'paid') break;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 100));
      });
    }

    // Verifica que pagamento foi registrado sem erro de constraint payments_account_balance_chk
    expect(getCtx1().error).toBeNull();
    const updatedTx = getCtx1().transactions.find((t) => t.id === tx!.id);
    expect(updatedTx?.status).toBe('paid');
  });

  it('4. sincroniza mutações entre dois navegadores distintos via refreshData()', async () => {
    const browser1 = await mountCloudProvider(repo1, testUser1Id, testUser1Email);
    const browser2 = await mountCloudProvider(repo2, testUser2Id, testUser2Email);

    const getCtx1 = browser1.getCtx;
    const getCtx2 = browser2.getCtx;

    // 1. Navegador 1 cria uma nova categoria no Cloud Staging
    const uniqueCatName = `Marketing Cloud ${Date.now()}`;
    await act(async () => {
      getCtx1().addCategory({
        name: uniqueCatName,
        color: '#ff0077',
        icon: 'tag',
        type: 'expense',
        active: true,
      });
    });

    for (let i = 0; i < 50; i++) {
      if (!getCtx1().isSaving && getCtx1().categories.some((c) => c.name === uniqueCatName)) break;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 100));
      });
    }

    // Navegador 1 já possui
    expect(getCtx1().categories.some((c) => c.name === uniqueCatName)).toBe(true);
    // Navegador 2 ainda não possui antes do refresh
    expect(getCtx2().categories.some((c) => c.name === uniqueCatName)).toBe(false);

    // 2. Navegador 2 executa refreshData() contra o Staging
    await act(async () => {
      await getCtx2().refreshData();
    });

    // 3. Navegador 2 agora reflete os dados gravados pelo Navegador 1 no Staging
    expect(getCtx2().categories.some((c) => c.name === uniqueCatName)).toBe(true);
  });

  it('5. alterna workspace de forma assíncrona carregando snapshot limpo do Cloud', async () => {
    const browser1 = await mountCloudProvider(repo1, testUser1Id, testUser1Email);
    const getCtx1 = browser1.getCtx;

    // 1. Cria segundo workspace
    await act(async () => {
      getCtx1().createWorkspace('Empresa Secundária Cloud');
    });

    for (let i = 0; i < 50; i++) {
      if (!getCtx1().isSaving && getCtx1().workspaces.some((w) => w.name === 'Empresa Secundária Cloud')) break;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 100));
      });
    }

    const secondWs = getCtx1().workspaces.find((w) => w.name === 'Empresa Secundária Cloud');
    expect(secondWs).toBeDefined();

    // 2. Alterna para o novo workspace
    await act(async () => {
      await getCtx1().setActiveWorkspaceId(secondWs!.id);
    });

    for (let i = 0; i < 50; i++) {
      if (!getCtx1().isLoading && getCtx1().activeWorkspace.name === 'Empresa Secundária Cloud') break;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 100));
      });
    }

    expect(getCtx1().activeWorkspace.name).toBe('Empresa Secundária Cloud');
    // Workspace novo não deve conter as contas do workspace anterior
    expect(getCtx1().accounts.some((a) => a.id === testAccountId)).toBe(false);
  });

  it('6. convida membro para o workspace via e-mail e persiste com o UUID canônico do perfil no Cloud', async () => {
    // 1. User 1 cria um workspace dedicado para teste de convite
    const inviteWs = await repo1.createWorkspace({
      name: 'Workspace Convite Email Cloud',
      owner_id: testUser1Id,
      currency: 'BRL',
      tracking_mode: 'full',
    });

    const browser1 = await mountCloudProvider(repo1, testUser1Id, testUser1Email, inviteWs.id);
    const getCtx1 = browser1.getCtx;

    expect(getCtx1().activeWorkspace.id).toBe(inviteWs.id);

    // 2. Convida Usuário 2 passando o endereço de e-mail (não o UUID)
    await act(async () => {
      getCtx1().addWorkspaceMember(testUser2Email, 'member');
    });

    for (let i = 0; i < 50; i++) {
      if (!getCtx1().isSaving && getCtx1().workspaceMembers.some((m) => m.user?.email === testUser2Email || m.user_id === testUser2Id)) break;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 100));
      });
    }

    expect(getCtx1().isSaving).toBe(false);
    expect(getCtx1().error).toBeNull();

    // 3. Valida no Supabase Cloud que o registro foi gravado na tabela workspace_members com o UUID canônico (profiles.id)
    const { data: memberRows, error: memberErr } = await adminClient
      .from('workspace_members')
      .select('*')
      .eq('workspace_id', inviteWs.id)
      .eq('user_id', testUser2Id);

    expect(memberErr).toBeNull();
    expect(memberRows?.length).toBe(1);
    expect(memberRows![0].role).toBe('member');
    expect(memberRows![0].user_id).toBe(testUser2Id);
  });

  it('7. cria conta bancária diretamente pelo Provider no Cloud e reconcilia UUID canônico sem erro de update', async () => {
    const browser1 = await mountCloudProvider(repo1, testUser1Id, testUser1Email);
    const getCtx1 = browser1.getCtx;

    await act(async () => {
      getCtx1().addAccount({
        name: 'Conta Inter Provider Cloud',
        institution: 'Banco Inter',
        type: 'checking',
        color: '#ff7a00',
        initial_balance: 1500,
        current_balance: 1500,
        active: true,
      });
    });

    for (let i = 0; i < 50; i++) {
      if (!getCtx1().isSaving && getCtx1().accounts.some((a) => a.name === 'Conta Inter Provider Cloud')) break;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 100));
      });
    }

    expect(getCtx1().isSaving).toBe(false);
    expect(getCtx1().error).toBeNull();

    const savedAcc = getCtx1().accounts.find((a) => a.name === 'Conta Inter Provider Cloud');
    expect(savedAcc).toBeDefined();
    expect(savedAcc!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    // Valida diretamente no banco do Supabase Cloud
    const { data: dbAcc, error: dbErr } = await adminClient
      .from('accounts')
      .select('*')
      .eq('id', savedAcc!.id)
      .single();

    expect(dbErr).toBeNull();
    expect(dbAcc).toBeDefined();
    expect(dbAcc!.name).toBe('Conta Inter Provider Cloud');
    expect(dbAcc!.institution).toBe('Banco Inter');
  });

  it('8. cria categoria e define orçamento encadeados imediatamente sem aguardar isSaving=false no Cloud', async () => {
    const browser1 = await mountCloudProvider(repo1, testUser1Id, testUser1Email);
    const getCtx1 = browser1.getCtx;

    let createdCat: any;
    await act(async () => {
      createdCat = getCtx1().addCategory({
        name: 'Lazer e Streaming Cloud',
        type: 'expense',
        color: '#ec4899',
        icon: 'film',
        active: true,
      });
      // Imediatamente define orçamento para a categoria recém-criada (sem aguardar isSaving=false)
      getCtx1().setBudget(createdCat.id, 800, 11, 2026);
    });

    for (let i = 0; i < 50; i++) {
      if (!getCtx1().isSaving && getCtx1().budgets.some((b) => b.planned_amount === 800)) break;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 100));
      });
    }

    expect(getCtx1().isSaving).toBe(false);
    expect(getCtx1().error).toBeNull();

    // Categoria foi persistida com UUID canônico
    const savedCat = getCtx1().categories.find((c) => c.name === 'Lazer e Streaming Cloud');
    expect(savedCat).toBeDefined();
    expect(savedCat!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    // Orçamento foi persistido no Cloud associado ao UUID canônico da categoria
    const { data: dbBudget, error: dbErr } = await adminClient
      .from('budgets')
      .select('*')
      .eq('workspace_id', testWorkspaceId)
      .eq('category_id', savedCat!.id)
      .eq('month', 11)
      .eq('year', 2026)
      .single();

    expect(dbErr).toBeNull();
    expect(dbBudget).toBeDefined();
    expect(Number(dbBudget!.planned_amount)).toBe(800);
  });

  it('9. renomeia conta via updateAccount com payload parcial sem sobrescrever saldo alterado concorrentemente por outro cliente Cloud', async () => {
    const browser1 = await mountCloudProvider(repo1, testUser1Id, testUser1Email);
    const browser2 = await mountCloudProvider(repo2, testUser2Id, testUser2Email);
    const getCtx1 = browser1.getCtx;
    const getCtx2 = browser2.getCtx;

    // 1. Navegador 1 cria conta com saldo inicial e atual de 2500
    let createdAcc: any;
    await act(async () => {
      createdAcc = getCtx1().addAccount({
        name: 'Conta Concorrente Cloud',
        institution: 'Banco Safra',
        color: '#f59e0b',
        type: 'checking',
        initial_balance: 2500,
        current_balance: 2500,
        active: true,
      });
    });

    for (let i = 0; i < 50; i++) {
      if (!getCtx1().isSaving && getCtx1().accounts.some((a) => a.name === 'Conta Concorrente Cloud')) break;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 100));
      });
    }

    expect(getCtx1().isSaving).toBe(false);
    const savedAcc = getCtx1().accounts.find((a) => a.name === 'Conta Concorrente Cloud');
    expect(savedAcc).toBeDefined();
    expect(savedAcc!.initial_balance).toBe(2500);
    expect(savedAcc!.current_balance).toBe(2500);

    // 2. Navegador 2 sincroniza o workspace para enxergar a nova conta
    await act(async () => {
      await getCtx2().refreshData();
    });
    expect(getCtx2().accounts.some((a) => a.id === savedAcc!.id)).toBe(true);

    // 3. Navegador 2 cria despesa e registra um pagamento de 500 debitando a conta no Cloud Staging
    let b2Tx: any;
    await act(async () => {
      b2Tx = getCtx2().addTransaction({
        description: 'Despesa Concorrente Navegador 2',
        amount: 500,
        type: 'expense',
        status: 'pending',
        account_id: savedAcc!.id,
        transaction_date: '2026-09-26',
        due_date: '2026-09-26',
      });
    });

    for (let i = 0; i < 50; i++) {
      if (!getCtx2().isSaving && getCtx2().transactions.some((t) => t.description === 'Despesa Concorrente Navegador 2')) break;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 100));
      });
    }

    const canonicalTx = getCtx2().transactions.find((t) => t.description === 'Despesa Concorrente Navegador 2');
    expect(canonicalTx).toBeDefined();

    await act(async () => {
      getCtx2().recordPayment({
        transaction_id: canonicalTx!.id,
        account_id: savedAcc!.id,
        amount: 500,
        payment_date: '2026-09-26',
      });
    });

    for (let i = 0; i < 50; i++) {
      if (!getCtx2().isSaving && getCtx2().transactions.find((t) => t.id === canonicalTx!.id)?.status === 'paid') break;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 100));
      });
    }

    // Valida que o saldo remoto no PostgreSQL do Staging foi atualizado para 2000 pelo Navegador 2
    const { data: dbMid, error: dbMidErr } = await adminClient
      .from('accounts')
      .select('*')
      .eq('id', savedAcc!.id)
      .single();
    expect(dbMidErr).toBeNull();
    expect(Number(dbMid!.current_balance)).toBe(2000);

    // 4. Note que o Navegador 1 NÃO executou refreshData(): seu estado local ainda possui current_balance = 2500
    const b1OldAcc = getCtx1().accounts.find((a) => a.id === savedAcc!.id);
    expect(b1OldAcc!.current_balance).toBe(2500);

    // 5. Navegador 1 renomeia a conta enviando APENAS o campo `name` (payload parcial)
    await act(async () => {
      getCtx1().updateAccount(savedAcc!.id, {
        name: 'Conta Concorrente Renomeada Cloud',
      });
    });

    for (let i = 0; i < 50; i++) {
      if (!getCtx1().isSaving && getCtx1().accounts.some((a) => a.name === 'Conta Concorrente Renomeada Cloud')) break;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 100));
      });
    }

    expect(getCtx1().isSaving).toBe(false);
    expect(getCtx1().error).toBeNull();

    // 6. Valida diretamente no banco de dados do Supabase Cloud Staging que:
    //    - o nome foi atualizado para 'Conta Concorrente Renomeada Cloud'
    //    - o saldo mais recente (2000) NÃO FOI SOBRESCRITO pelo saldo antigo (2500) do Navegador 1
    const { data: dbAcc, error: dbErr } = await adminClient
      .from('accounts')
      .select('*')
      .eq('id', savedAcc!.id)
      .single();

    expect(dbErr).toBeNull();
    expect(dbAcc).toBeDefined();
    expect(dbAcc!.name).toBe('Conta Concorrente Renomeada Cloud');
    expect(Number(dbAcc!.current_balance)).toBe(2000);
    expect(Number(dbAcc!.initial_balance)).toBe(2500);

    // 7. Valida que o estado local do Navegador 1 recebeu o saldo canônico atualizado do banco
    const b1NewAcc = getCtx1().accounts.find((a) => a.id === savedAcc!.id);
    expect(b1NewAcc).toBeDefined();
    expect(b1NewAcc!.name).toBe('Conta Concorrente Renomeada Cloud');
    expect(b1NewAcc!.current_balance).toBe(2000);
  });
});
