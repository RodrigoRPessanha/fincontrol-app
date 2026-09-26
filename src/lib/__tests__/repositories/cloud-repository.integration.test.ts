import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { SupabaseFinanceRepository } from '../../repositories/supabase-finance-repository';
import { Database } from '../../supabase/database.types';

const isCloudEnabled = process.env.TEST_CLOUD === 'true';

// Helper para ler .env.local se não definido no ambiente
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

describe.runIf(isCloudEnabled)('SupabaseFinanceRepository Cloud Integration (Staging)', { timeout: 30000 }, () => {
  let adminClient: SupabaseClient<Database>;
  let userClient: SupabaseClient<Database>;
  let repo: SupabaseFinanceRepository;
  let testUserId: string;
  let testUserEmail: string;
  let testWorkspaceId: string;
  let ownerMemberId: string;
  let testAccountId: string;

  beforeAll(async () => {
    const env = getEnvConfig();
    const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceRoleKey = getServiceRoleKey();

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error('Configurações do Supabase Staging incompletas para teste de repositório em nuvem.');
    }

    adminClient = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Cria usuário de teste com e-mail confirmado (ZERO SMTP / sem envio de e-mails)
    testUserEmail = `test.repo.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@fincontrol.app`;
    const testPassword = `TestPass!${Date.now()}#Aa1`;

    const { data: createdUser, error: createErr } = await adminClient.auth.admin.createUser({
      email: testUserEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { name: 'Repo Tester' },
    });

    if (createErr || !createdUser.user) {
      throw new Error(`Falha ao criar usuário de teste no staging: ${createErr?.message}`);
    }
    testUserId = createdUser.user.id;

    // Autentica como o usuário de teste
    userClient = createClient<Database>(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error: loginErr } = await userClient.auth.signInWithPassword({
      email: testUserEmail,
      password: testPassword,
    });

    if (loginErr) {
      throw new Error(`Falha no login do usuário de teste: ${loginErr.message}`);
    }

    // Instancia o repositório sob o contexto autenticado do usuário
    repo = new SupabaseFinanceRepository(userClient);
  }, 30000);

  afterAll(async () => {
    // Teardown completo no staging
    if (testWorkspaceId && adminClient) {
      await adminClient.from('workspaces').delete().eq('id', testWorkspaceId);
    }
    if (testUserId && adminClient) {
      await adminClient.auth.admin.deleteUser(testUserId);
    }
  }, 20000);

  it('1. cria workspace no staging via repositório', async () => {
    const ws = await repo.createWorkspace({
      name: 'Staging Test Workspace',
      owner_id: testUserId,
      currency: 'BRL',
      tracking_mode: 'full',
    });

    expect(ws.id).toBeDefined();
    expect(ws.name).toBe('Staging Test Workspace');
    expect(ws.owner_id).toBe(testUserId);
    testWorkspaceId = ws.id;

    // Recupera membros do workspace recém-criado
    const members = await repo.getWorkspaceMembers(ws.id);
    expect(members.length).toBeGreaterThan(0);
    const ownerMember = members.find((m) => m.user_id === testUserId);
    expect(ownerMember).toBeDefined();
    ownerMemberId = ownerMember!.id;
  });

  it('2. salva e recupera conta financeira no staging sob RLS', async () => {
    const account = await repo.saveAccount({
      workspace_id: testWorkspaceId,
      name: 'Conta Corrente Staging',
      institution: 'FinBank',
      type: 'checking',
      current_balance: 1500,
      initial_balance: 1500,
      color: '#3b82f6',
      active: true,
    });

    expect(account.id).toBeDefined();
    expect(account.current_balance).toBe(1500);
    testAccountId = account.id;

    const accounts = await repo.getAccounts(testWorkspaceId);
    expect(accounts.some((a) => a.id === account.id)).toBe(true);
  });

  it('3. salva categoria no staging', async () => {
    const cat = await repo.saveCategory({
      workspace_id: testWorkspaceId,
      name: 'Alimentação Staging',
      type: 'expense',
      color: '#ef4444',
      icon: 'utensils',
      active: true,
    });

    expect(cat.id).toBeDefined();
    expect(cat.name).toBe('Alimentação Staging');

    const categories = await repo.getCategories(testWorkspaceId);
    expect(categories.some((c) => c.id === cat.id)).toBe(true);
  });

  it('4. grava transação com rateios (splits) e executa sincronização atômica', async () => {
    const tx = await repo.saveTransaction({
      workspace_id: testWorkspaceId,
      description: 'Supermercado Staging',
      amount: 250,
      transaction_date: '2026-04-10',
      due_date: '2026-04-10',
      type: 'expense',
      status: 'paid',
      account_id: testAccountId,
      paid_by_member_id: ownerMemberId,
      split_type: 'equal',
      splits: [
        {
          member_id: ownerMemberId,
          amount: 250,
          percentage: 100,
        },
      ],
    });

    expect(tx.id).toBeDefined();
    expect(tx.amount).toBe(250);

    const txs = await repo.getTransactions(testWorkspaceId);
    const found = txs.find((t) => t.id === tx.id);
    expect(found).toBeDefined();
    expect(found!.splits?.length).toBe(1);
    expect(found!.splits![0].amount).toBe(250);

    // Verifica que pagamento foi criado automaticamente e saldo foi abatido
    const accounts = await repo.getAccounts(testWorkspaceId);
    const acc = accounts.find((a) => a.id === testAccountId);
    expect(acc?.current_balance).toBe(1250);

    const payments = await repo.getPayments(testWorkspaceId);
    const pay = payments.find((p) => p.transaction_id === tx.id);
    expect(pay).toBeDefined();
    expect(pay?.amount).toBe(250);
  });

  it('5. salva e recupera cartão de crédito no staging', async () => {
    const card = await repo.saveCreditCard({
      workspace_id: testWorkspaceId,
      name: 'Nubank Staging',
      institution: 'Nubank',
      credit_limit: 5000,
      closing_day: 10,
      due_day: 17,
      color: '#820ad1',
      active: true,
    });

    expect(card.id).toBeDefined();
    expect(card.credit_limit).toBe(5000);

    const cards = await repo.getCreditCards(testWorkspaceId);
    expect(cards.some((c) => c.id === card.id)).toBe(true);
  });

  it('6. carrega snapshot consolidado do workspace em lote (sem N+1)', async () => {
    const snapshot = await repo.loadSnapshot(testWorkspaceId);

    expect(snapshot.activeWorkspaceId).toBe(testWorkspaceId);
    expect(snapshot.allWorkspaces.some((w) => w.id === testWorkspaceId)).toBe(true);
    expect(snapshot.allWorkspaceMembers.length).toBeGreaterThan(0);
    expect(snapshot.allAccounts.length).toBeGreaterThan(0);
    expect(snapshot.allCategories.length).toBeGreaterThan(0);
    expect(snapshot.allCreditCards.length).toBeGreaterThan(0);
    expect(snapshot.allTransactions.length).toBeGreaterThan(0);
    expect(snapshot.allTransactions[0].splits?.length).toBeGreaterThan(0);
  });

  it('7. registra pagamento de receita com aumento de saldo e reverte com diminuição de saldo', async () => {
    const incomeTx = await repo.saveTransaction({
      workspace_id: testWorkspaceId,
      description: 'Consultoria Staging',
      amount: 300,
      transaction_date: '2026-04-12',
      due_date: '2026-12-31',
      type: 'income',
      status: 'pending',
    });

    const incomePay = await repo.savePayment({
      workspace_id: testWorkspaceId,
      account_id: testAccountId,
      transaction_id: incomeTx.id,
      amount: 300,
      payment_date: '2026-04-12',
      affects_balance: true,
    });

    // Saldo da conta aumentou: 1250 + 300 = 1550
    let accounts = await repo.getAccounts(testWorkspaceId);
    let acc = accounts.find((a) => a.id === testAccountId);
    expect(acc?.current_balance).toBe(1550);

    let txs = await repo.getTransactions(testWorkspaceId);
    let tx = txs.find((t) => t.id === incomeTx.id);
    expect(tx?.status).toBe('paid');

    // Estorno de receita diminui o saldo bancário e retorna status para pending
    await repo.deletePayment(incomePay.id);

    accounts = await repo.getAccounts(testWorkspaceId);
    acc = accounts.find((a) => a.id === testAccountId);
    expect(acc?.current_balance).toBe(1250);

    txs = await repo.getTransactions(testWorkspaceId);
    tx = txs.find((t) => t.id === incomeTx.id);
    expect(tx?.status).toBe('pending');
  });

  it('8. gerencia pagamentos parciais de parcelas e recalcula status no estorno', async () => {
    const purchase = await repo.savePurchase({
      workspace_id: testWorkspaceId,
      description: 'Equipamento Staging',
      total_amount: 400,
      installment_count: 2,
      purchase_date: '2026-10-01',
    });

    const insts = await repo.getInstallments(purchase.id);
    expect(insts.length).toBe(2);
    const inst1 = insts[0];

    // Pagamento parcial 1: R$ 50 de R$ 200
    const partPay1 = await repo.savePayment({
      workspace_id: testWorkspaceId,
      installment_id: inst1.id,
      account_id: testAccountId,
      amount: 50,
      payment_date: '2026-04-02',
      affects_balance: true,
    });

    let updatedInsts = await repo.getInstallments(purchase.id);
    let currentInst1 = updatedInsts.find((i) => i.id === inst1.id);
    expect(currentInst1?.status).toBe('partially_paid');
    expect(currentInst1?.paid_amount).toBe(50);

    // Pagamento parcial 2: R$ 70 de R$ 200
    const partPay2 = await repo.savePayment({
      workspace_id: testWorkspaceId,
      installment_id: inst1.id,
      account_id: testAccountId,
      amount: 70,
      payment_date: '2026-04-03',
      affects_balance: true,
    });

    updatedInsts = await repo.getInstallments(purchase.id);
    currentInst1 = updatedInsts.find((i) => i.id === inst1.id);
    expect(currentInst1?.status).toBe('partially_paid');
    expect(currentInst1?.paid_amount).toBe(120);

    // Estorna pagamento parcial 2: status deve continuar partially_paid com paid_amount = 50
    await repo.deletePayment(partPay2.id);
    updatedInsts = await repo.getInstallments(purchase.id);
    currentInst1 = updatedInsts.find((i) => i.id === inst1.id);
    expect(currentInst1?.status).toBe('partially_paid');
    expect(currentInst1?.paid_amount).toBe(50);

    // Estorna pagamento parcial 1: status deve voltar para pending com paid_amount = 0
    await repo.deletePayment(partPay1.id);
    updatedInsts = await repo.getInstallments(purchase.id);
    currentInst1 = updatedInsts.find((i) => i.id === inst1.id);
    expect(currentInst1?.status).toBe('pending');
    expect(currentInst1?.paid_amount).toBe(0);

    // Saldo bancário retornou para 1250 (50 + 70 estornados)
    const accounts = await repo.getAccounts(testWorkspaceId);
    const acc = accounts.find((a) => a.id === testAccountId);
    expect(acc?.current_balance).toBe(1250);
  });

  it('9. atualiza pagamento via fn_update_payment reconciliando diferença de saldo', async () => {
    const expenseTx = await repo.saveTransaction({
      workspace_id: testWorkspaceId,
      description: 'Manutenção Staging',
      amount: 200,
      transaction_date: '2026-04-15',
      due_date: '2026-04-15',
      type: 'expense',
      status: 'pending',
    });

    const payment = await repo.savePayment({
      workspace_id: testWorkspaceId,
      account_id: testAccountId,
      transaction_id: expenseTx.id,
      amount: 100,
      payment_date: '2026-04-15',
      affects_balance: true,
    });

    let accounts = await repo.getAccounts(testWorkspaceId);
    let acc = accounts.find((a) => a.id === testAccountId);
    expect(acc?.current_balance).toBe(1150); // 1250 - 100

    // Atualiza pagamento de 100 para 160: deve debitar mais 60
    await repo.savePayment({
      ...payment,
      amount: 160,
    });

    accounts = await repo.getAccounts(testWorkspaceId);
    acc = accounts.find((a) => a.id === testAccountId);
    expect(acc?.current_balance).toBe(1090); // 1150 - 60

    // Limpa estornando
    await repo.deletePayment(payment.id);
    accounts = await repo.getAccounts(testWorkspaceId);
    acc = accounts.find((a) => a.id === testAccountId);
    expect(acc?.current_balance).toBe(1250);
  });

  it('10. cria, atualiza e estorna transferência reconciliando saldos entre contas', async () => {
    const secondAccount = await repo.saveAccount({
      workspace_id: testWorkspaceId,
      name: 'Conta Poupança Staging',
      institution: 'FinBank',
      type: 'savings',
      current_balance: 500,
      initial_balance: 500,
      color: '#10b981',
      active: true,
    });

    // 1. Cria transferência de R$ 100
    const transfer = await repo.saveTransfer({
      workspace_id: testWorkspaceId,
      from_account_id: testAccountId,
      to_account_id: secondAccount.id,
      amount: 100,
      transfer_date: '2026-04-15',
    });

    let accounts = await repo.getAccounts(testWorkspaceId);
    let fromAcc = accounts.find((a) => a.id === testAccountId);
    let toAcc = accounts.find((a) => a.id === secondAccount.id);
    expect(fromAcc?.current_balance).toBe(1150); // 1250 - 100
    expect(toAcc?.current_balance).toBe(600); // 500 + 100

    // 2. Atualiza valor da transferência para R$ 250
    await repo.saveTransfer({
      ...transfer,
      amount: 250,
    });

    accounts = await repo.getAccounts(testWorkspaceId);
    fromAcc = accounts.find((a) => a.id === testAccountId);
    toAcc = accounts.find((a) => a.id === secondAccount.id);
    expect(fromAcc?.current_balance).toBe(1000); // 1250 - 250
    expect(toAcc?.current_balance).toBe(750); // 500 + 250

    // 3. Estorna transferência: restaura saldos originais
    await repo.deleteTransfer(transfer.id);

    accounts = await repo.getAccounts(testWorkspaceId);
    fromAcc = accounts.find((a) => a.id === testAccountId);
    toAcc = accounts.find((a) => a.id === secondAccount.id);
    expect(fromAcc?.current_balance).toBe(1250);
    expect(toAcc?.current_balance).toBe(500);
  });

  it('11. rejeita alteração direta de valor em transações com rateio sem bypass de sessão', async () => {
    // Transação com rateio existente
    const tx = await repo.saveTransaction({
      workspace_id: testWorkspaceId,
      description: 'Transação Protegida',
      amount: 100,
      transaction_date: '2026-04-18',
      due_date: '2026-12-31',
      type: 'expense',
      status: 'pending',
      split_type: 'equal',
      splits: [
        {
          member_id: ownerMemberId,
          amount: 100,
          percentage: 100,
        },
      ],
    });

    // UPDATE direto em transactions alterando amount sem alterar splits deve ser rejeitado pelo trigger incondicional
    const { error } = await (repo as any).client
      .from('transactions')
      .update({ amount: 150 })
      .eq('id', tx.id);

    expect(error).toBeDefined();
    expect(error?.message).toMatch(/viola a conservação das frações de rateio existentes/i);
  });

  it('12. reconcilia parcelas e faturas de cartão ao atualizar valor total da compra parcelada no staging', async () => {
    const card = await repo.saveCreditCard({
      workspace_id: testWorkspaceId,
      name: 'Cartão Staging Rec',
      institution: 'StagingCard',
      credit_limit: 8000,
      closing_day: 15,
      due_day: 25,
      color: '#10b981',
      active: true,
    });

    // Cria compra de 2 parcelas de R$ 150 (total R$ 300)
    const purchase = await repo.savePurchase({
      workspace_id: testWorkspaceId,
      description: 'Notebook Staging Rec',
      total_amount: 300,
      installment_count: 2,
      purchase_date: '2026-04-10',
      credit_card_id: card.id,
    });

    let insts = await repo.getInstallments(purchase.id);
    expect(insts.length).toBe(2);
    expect(insts[0].amount).toBe(150);
    expect(insts[1].amount).toBe(150);

    const bills = await repo.getCreditCardBills(card.id);
    expect(bills.length).toBeGreaterThan(0);
    const bill = bills[0];
    const initialBillTotal = bill.total_amount;

    // Atualiza a compra de R$ 300 para R$ 500: parcelas devem virar R$ 250 cada e fatura deve ser ajustada
    await repo.savePurchase({
      ...purchase,
      total_amount: 500,
    });

    insts = await repo.getInstallments(purchase.id);
    expect(insts[0].amount).toBe(250);
    expect(insts[1].amount).toBe(250);

    const updatedBills = await repo.getCreditCardBills(card.id);
    const updatedBill = updatedBills.find((b) => b.id === bill.id);
    expect(updatedBill?.total_amount).toBe(initialBillTotal + 100); // 250 - 150 = +100
  });

  it('13. reabre transações e parcelas vinculadas ao estornar ou reduzir pagamento de fatura de cartão', async () => {
    const cards = await repo.getCreditCards(testWorkspaceId);
    const recCard = cards.find((c) => c.name === 'Cartão Staging Rec')!;
    const bills = await repo.getCreditCardBills(recCard.id);
    const bill = bills[0];

    // Transação vinculada à fatura
    const tx = await repo.saveTransaction({
      workspace_id: testWorkspaceId,
      credit_card_id: recCard.id,
      credit_card_bill_id: bill.id,
      description: 'Item de Teste Fatura',
      amount: 50,
      transaction_date: '2026-04-12',
      due_date: '2026-12-31',
      type: 'expense',
      status: 'pending',
    });

    // Paga a fatura integralmente
    const billPayment = await repo.savePayment({
      workspace_id: testWorkspaceId,
      credit_card_bill_id: bill.id,
      account_id: testAccountId,
      amount: bill.total_amount,
      payment_date: '2026-04-20',
      affects_balance: true,
    });

    let txs = await repo.getTransactions(testWorkspaceId);
    let reloadedTx = txs.find((t) => t.id === tx.id);
    expect(reloadedTx?.status).toBe('paid');

    // 1. Reduz o pagamento para R$ 10 via savePayment: deve reabrir o item para pending
    await repo.savePayment({
      ...billPayment,
      amount: 10,
    });

    txs = await repo.getTransactions(testWorkspaceId);
    reloadedTx = txs.find((t) => t.id === tx.id);
    expect(reloadedTx?.status).toBe('pending');

    // 2. Restaura quitação completa da fatura: item deve voltar a 'paid'
    await repo.savePayment({
      ...billPayment,
      amount: bill.total_amount,
    });

    txs = await repo.getTransactions(testWorkspaceId);
    reloadedTx = txs.find((t) => t.id === tx.id);
    expect(reloadedTx?.status).toBe('paid');

    // 3. Estorna o pagamento completamente: fatura reabre e item vira 'pending'
    await repo.deletePayment(billPayment.id);

    txs = await repo.getTransactions(testWorkspaceId);
    reloadedTx = txs.find((t) => t.id === tx.id);
    expect(reloadedTx?.status).toBe('pending');
  });

  it('14. conserva a soma das parcelas = total_amount ao editar compra com parcela parcialmente paga no staging', async () => {
    // Exemplo da auditoria: compra de R$ 400, duas parcelas de R$ 200, primeira com R$ 50 pagos.
    const purchase = await repo.savePurchase({
      workspace_id: testWorkspaceId,
      description: 'Compra com Parcial Staging',
      total_amount: 400,
      installment_count: 2,
      purchase_date: '2026-10-01',
    });

    let insts = await repo.getInstallments(purchase.id);
    expect(insts.length).toBe(2);
    const inst1 = insts.find((i) => i.installment_number === 1)!;
    const inst2 = insts.find((i) => i.installment_number === 2)!;
    expect(inst1.amount).toBe(200);
    expect(inst2.amount).toBe(200);

    // Paga R$ 50 na primeira parcela
    const partialPayment = await repo.savePayment({
      workspace_id: testWorkspaceId,
      installment_id: inst1.id,
      account_id: testAccountId,
      amount: 50,
      payment_date: '2026-10-02',
      affects_balance: true,
    });

    insts = await repo.getInstallments(purchase.id);
    const updatedInst1 = insts.find((i) => i.id === inst1.id)!;
    const updatedInst2 = insts.find((i) => i.id === inst2.id)!;
    expect(updatedInst1.status).toBe('partially_paid');
    expect(updatedInst1.paid_amount).toBe(50);

    // Atualiza o valor total da compra para R$ 500: as parcelas devem virar R$ 250 + R$ 250 = R$ 500
    await repo.savePurchase({
      ...purchase,
      total_amount: 500,
    });

    insts = await repo.getInstallments(purchase.id);
    const finalInst1 = insts.find((i) => i.id === inst1.id)!;
    const finalInst2 = insts.find((i) => i.id === inst2.id)!;

    expect(finalInst1.amount).toBe(250);
    expect(finalInst1.paid_amount).toBe(50);
    expect(finalInst1.status).toBe('partially_paid');

    expect(finalInst2.amount).toBe(250);
    expect(finalInst2.paid_amount).toBe(0);
    expect(finalInst2.status).toBe('pending');

    const totalSum = finalInst1.amount + finalInst2.amount;
    expect(totalSum).toBe(500);

    // Limpa o pagamento para restaurar o saldo da conta
    await repo.deletePayment(partialPayment.id);
  });

  it('15. reconcilia saldo bancário ao alterar tipo da transação com pagamentos existentes no staging', async () => {
    let accounts = await repo.getAccounts(testWorkspaceId);
    let acc = accounts.find((a) => a.id === testAccountId)!;
    const initialBalance = acc.current_balance;

    // 1. Cria transação de despesa de R$ 100
    const tx = await repo.saveTransaction({
      workspace_id: testWorkspaceId,
      description: 'Transação Mudar Tipo Staging',
      amount: 100,
      transaction_date: '2026-10-05',
      due_date: '2026-10-05',
      type: 'expense',
      status: 'pending',
    });

    // Paga a despesa debitando da conta: saldo diminui em R$ 100
    const payment = await repo.savePayment({
      workspace_id: testWorkspaceId,
      transaction_id: tx.id,
      account_id: testAccountId,
      amount: 100,
      payment_date: '2026-10-05',
      affects_balance: true,
    });

    accounts = await repo.getAccounts(testWorkspaceId);
    acc = accounts.find((a) => a.id === testAccountId)!;
    expect(acc.current_balance).toBe(initialBalance - 100);

    // 2. Altera o tipo da transação de expense para income:
    // Deve estornar o débito (+100) e aplicar o crédito (+100) => diferença de +200
    await repo.saveTransaction({
      ...tx,
      type: 'income',
    });

    accounts = await repo.getAccounts(testWorkspaceId);
    acc = accounts.find((a) => a.id === testAccountId)!;
    expect(acc.current_balance).toBe(initialBalance + 100);

    // 3. Altera de volta de income para expense:
    // Deve estornar o crédito (-100) e aplicar o débito (-100) => diferença de -200
    await repo.saveTransaction({
      ...tx,
      type: 'expense',
    });

    accounts = await repo.getAccounts(testWorkspaceId);
    acc = accounts.find((a) => a.id === testAccountId)!;
    expect(acc.current_balance).toBe(initialBalance - 100);

    // 4. Estorna o pagamento: saldo retorna ao valor original
    await repo.deletePayment(payment.id);

    accounts = await repo.getAccounts(testWorkspaceId);
    acc = accounts.find((a) => a.id === testAccountId)!;
    expect(acc.current_balance).toBe(initialBalance);
  });

  it('16. rejeita redução de compra que deixe o total_amount de fatura vinculada abaixo do valor já pago (paid_amount)', async () => {
    // 1. Cria cartão de crédito e compra com parcela vinculada à fatura
    const card = await repo.saveCreditCard({
      workspace_id: testWorkspaceId,
      name: 'Cartão Limite Fatura Staging',
      institution: 'StagingCard',
      credit_limit: 5000,
      closing_day: 15,
      due_day: 25,
      color: '#3b82f6',
      active: true,
    });

    const purchase = await repo.savePurchase({
      workspace_id: testWorkspaceId,
      description: 'Compra com Fatura Parcial Staging',
      total_amount: 150,
      installment_count: 1,
      purchase_date: '2026-10-01',
      credit_card_id: card.id,
    });

    const bills = await repo.getCreditCardBills(card.id);
    expect(bills.length).toBeGreaterThan(0);
    const bill = bills[0];
    expect(bill.total_amount).toBe(150);

    // 2. Paga R$ 100 na fatura (paid_amount = 100)
    const billPayment = await repo.savePayment({
      workspace_id: testWorkspaceId,
      credit_card_bill_id: bill.id,
      account_id: testAccountId,
      amount: 100,
      payment_date: '2026-10-02',
      affects_balance: true,
    });

    const billsAfterPay = await repo.getCreditCardBills(card.id);
    const updatedBill = billsAfterPay.find((b) => b.id === bill.id)!;
    expect(updatedBill.paid_amount).toBe(100);

    // 3. Tenta reduzir a compra para R$ 20: o total da fatura iria para R$ 20, mas paid_amount é 100
    // A RPC fn_update_purchase_with_splits deve rejeitar com erro explícito
    await expect(
      repo.savePurchase({
        ...purchase,
        total_amount: 20,
      })
    ).rejects.toThrow(/inferior ao valor j[áa] pago nela/i);

    // 4. Confirma que a compra e a fatura não foram corrompidas
    const billsUnchanged = await repo.getCreditCardBills(card.id);
    expect(billsUnchanged.find((b) => b.id === bill.id)!.total_amount).toBe(150);

    // Limpa o pagamento
    await repo.deletePayment(billPayment.id);
  });

  it('17. quita e sincroniza fatura e parcelas quando redução do total iguala exatamente o paid_amount existente no staging', async () => {
    // 1. Cria cartão de crédito e compra de R$ 150 vinculada à fatura
    const card = await repo.saveCreditCard({
      workspace_id: testWorkspaceId,
      name: 'Cartão Quitação Igualdade Staging',
      institution: 'StagingCard',
      credit_limit: 5000,
      closing_day: 15,
      due_day: 25,
      color: '#10b981',
      active: true,
    });

    const purchase = await repo.savePurchase({
      workspace_id: testWorkspaceId,
      description: 'Compra Redução Quitação Staging',
      total_amount: 150,
      installment_count: 1,
      purchase_date: '2026-10-01',
      credit_card_id: card.id,
    });

    let bills = await repo.getCreditCardBills(card.id);
    expect(bills.length).toBeGreaterThan(0);
    const bill = bills[0];
    expect(bill.total_amount).toBe(150);

    let insts = await repo.getInstallments(purchase.id);
    expect(insts.length).toBe(1);
    expect(insts[0].status).toBe('pending');
    expect(insts[0].amount).toBe(150);
    expect(insts[0].paid_amount).toBe(0);

    // 2. Paga R$ 100 na fatura (paid_amount = 100, status = partially_paid)
    const billPayment = await repo.savePayment({
      workspace_id: testWorkspaceId,
      credit_card_bill_id: bill.id,
      account_id: testAccountId,
      amount: 100,
      payment_date: '2026-10-02',
      affects_balance: true,
    });

    bills = await repo.getCreditCardBills(card.id);
    const partiallyPaidBill = bills.find((b) => b.id === bill.id)!;
    expect(partiallyPaidBill.paid_amount).toBe(100);
    expect(partiallyPaidBill.status).toBe('partially_paid');

    // 3. Reduz a compra para exatamente R$ 100 (= paid_amount da fatura)
    // A RPC fn_update_purchase_with_splits deve sincronizar e marcar fatura e parcela como 'paid'
    await repo.savePurchase({
      ...purchase,
      total_amount: 100,
    });

    // 4. Valida se a fatura foi quitada (total = 100, paid = 100, status = paid)
    bills = await repo.getCreditCardBills(card.id);
    const paidBill = bills.find((b) => b.id === bill.id)!;
    expect(paidBill.total_amount).toBe(100);
    expect(paidBill.paid_amount).toBe(100);
    expect(paidBill.status).toBe('paid');

    // 5. Valida se a parcela foi sincronizada para 'paid' com amount=100 e paid_amount=100
    insts = await repo.getInstallments(purchase.id);
    const paidInst = insts.find((i) => i.purchase_id === purchase.id)!;
    expect(paidInst.amount).toBe(100);
    expect(paidInst.paid_amount).toBe(100);
    expect(paidInst.status).toBe('paid');

    // 6. Limpa o pagamento
    await repo.deletePayment(billPayment.id);
  });

  it('18. reverte saldo bancário e exclui pagamentos ao excluir transação paga no staging', async () => {
    let accounts = await repo.getAccounts(testWorkspaceId);
    let acc = accounts.find((a) => a.id === testAccountId)!;
    const initialBalance = acc.current_balance;

    // 1. Cria transação de despesa de R$ 75
    const tx = await repo.saveTransaction({
      workspace_id: testWorkspaceId,
      description: 'Transação Exclusão Staging',
      amount: 75,
      type: 'expense',
      transaction_date: '2026-10-05',
      due_date: '2026-10-15',
      account_id: testAccountId,
      status: 'pending',
    });

    // 2. Registra pagamento que debita a conta bancária
    const payment = await repo.savePayment({
      workspace_id: testWorkspaceId,
      transaction_id: tx.id,
      account_id: testAccountId,
      amount: 75,
      payment_date: '2026-10-05',
      affects_balance: true,
    });

    accounts = await repo.getAccounts(testWorkspaceId);
    acc = accounts.find((a) => a.id === testAccountId)!;
    expect(acc.current_balance).toBe(initialBalance - 75);

    // 3. Exclui a transação via deleteTransaction (invocando a RPC fn_delete_transaction)
    await repo.deleteTransaction(tx.id);

    // 4. Confirma que o saldo foi estornado de volta
    accounts = await repo.getAccounts(testWorkspaceId);
    acc = accounts.find((a) => a.id === testAccountId)!;
    expect(acc.current_balance).toBe(initialBalance);

    // 5. Confirma que a transação e seus pagamentos foram removidos
    const txs = await repo.getTransactions(testWorkspaceId);
    expect(txs.some((t) => t.id === tx.id)).toBe(false);

    const payments = await repo.getPayments(testWorkspaceId);
    expect(payments.some((p) => p.id === payment.id)).toBe(false);
  });

  it('19. reverte saldo bancário e remove parcelas ao excluir compra com parcelas pagas diretamente no staging', async () => {
    let accounts = await repo.getAccounts(testWorkspaceId);
    let acc = accounts.find((a) => a.id === testAccountId)!;
    const initialBalance = acc.current_balance;

    // 1. Cria compra parcelada direta (carnê/boleto) com 2 parcelas de R$ 80 (total 160)
    const purchase = await repo.savePurchase({
      workspace_id: testWorkspaceId,
      description: 'Compra Carnê com Parcela Paga Exclusão',
      total_amount: 160,
      installment_count: 2,
      purchase_date: '2026-10-01',
      account_id: testAccountId,
    });

    let insts = await repo.getInstallments(purchase.id);
    expect(insts.length).toBe(2);

    // 2. Paga a primeira parcela (R$ 80) debitando a conta bancária
    const instPay = await repo.savePayment({
      workspace_id: testWorkspaceId,
      installment_id: insts[0].id,
      account_id: testAccountId,
      amount: 80,
      payment_date: '2026-10-02',
      affects_balance: true,
    });

    accounts = await repo.getAccounts(testWorkspaceId);
    acc = accounts.find((a) => a.id === testAccountId)!;
    expect(acc.current_balance).toBe(initialBalance - 80);

    // 3. Exclui a compra via deletePurchase (invocando a RPC fn_delete_purchase)
    await repo.deletePurchase(purchase.id);

    // 4. Confirma que o saldo da conta foi estornado (+80)
    accounts = await repo.getAccounts(testWorkspaceId);
    acc = accounts.find((a) => a.id === testAccountId)!;
    expect(acc.current_balance).toBe(initialBalance);

    // 5. Confirma que as parcelas e os pagamentos foram excluídos
    insts = await repo.getInstallments(purchase.id);
    expect(insts.length).toBe(0);

    const payments = await repo.getPayments(testWorkspaceId);
    expect(payments.some((p) => p.id === instPay.id)).toBe(false);

    const purchases = await repo.getPurchases(testWorkspaceId);
    expect(purchases.some((p) => p.id === purchase.id)).toBe(false);
  });

  it('20. rejeita exclusão de compra que deixe fatura com total_amount inferior a paid_amount no staging', async () => {
    // 1. Cria cartão e compra de R$ 150 (1 parcela) vinculada a fatura
    const card = await repo.saveCreditCard({
      workspace_id: testWorkspaceId,
      name: 'Cartão Rejeição Exclusão Staging',
      institution: 'StagingCard',
      credit_limit: 5000,
      closing_day: 15,
      due_day: 25,
      color: '#8b5cf6',
      active: true,
    });

    const purchase = await repo.savePurchase({
      workspace_id: testWorkspaceId,
      description: 'Compra Rejeição Exclusão Fatura',
      total_amount: 150,
      installment_count: 1,
      purchase_date: '2026-10-01',
      credit_card_id: card.id,
    });

    const bills = await repo.getCreditCardBills(card.id);
    const bill = bills[0];

    // 2. Paga R$ 100 diretamente na fatura
    const billPay = await repo.savePayment({
      workspace_id: testWorkspaceId,
      credit_card_bill_id: bill.id,
      account_id: testAccountId,
      amount: 100,
      payment_date: '2026-10-02',
      affects_balance: true,
    });

    // 3. Tenta excluir a compra: o total da fatura iria de 150 para 0, mas paid_amount é 100!
    // A RPC fn_delete_purchase deve rejeitar com exceção explícita
    await expect(repo.deletePurchase(purchase.id)).rejects.toThrow(/inferior ao valor j[áa] pago nela/i);

    // 4. Confirma que a compra não foi excluída
    const purchases = await repo.getPurchases(testWorkspaceId);
    expect(purchases.some((p) => p.id === purchase.id)).toBe(true);

    // Limpa o pagamento da fatura antes do teardown
    await repo.deletePayment(billPay.id);
    await repo.deletePurchase(purchase.id);
  });

  it('21. ajusta total da fatura e sincroniza quitação ao excluir compra em cartão com fatura parcialmente paga no staging', async () => {
    // 1. Cria cartão de crédito
    const card = await repo.saveCreditCard({
      workspace_id: testWorkspaceId,
      name: 'Cartão Exclusão e Quitação Staging',
      institution: 'StagingCard',
      credit_limit: 5000,
      closing_day: 15,
      due_day: 25,
      color: '#06b6d4',
      active: true,
    });

    // 2. Cria Purchase A (80) e Purchase B (80) na mesma fatura (total = 160)
    const purchaseA = await repo.savePurchase({
      workspace_id: testWorkspaceId,
      description: 'Compra A Mesma Fatura',
      total_amount: 80,
      installment_count: 1,
      purchase_date: '2026-10-01',
      credit_card_id: card.id,
    });

    const purchaseB = await repo.savePurchase({
      workspace_id: testWorkspaceId,
      description: 'Compra B Mesma Fatura',
      total_amount: 80,
      installment_count: 1,
      purchase_date: '2026-10-01',
      credit_card_id: card.id,
    });

    let bills = await repo.getCreditCardBills(card.id);
    const bill = bills[0];
    expect(bill.total_amount).toBe(160);

    // 3. Registra pagamento de R$ 80 na fatura (paid_amount = 80, status = partially_paid)
    const billPay = await repo.savePayment({
      workspace_id: testWorkspaceId,
      credit_card_bill_id: bill.id,
      account_id: testAccountId,
      amount: 80,
      payment_date: '2026-10-02',
      affects_balance: true,
    });

    bills = await repo.getCreditCardBills(card.id);
    const updatedBill = bills.find((b) => b.id === bill.id)!;
    expect(updatedBill.paid_amount).toBe(80);
    expect(updatedBill.status).toBe('partially_paid');

    // 4. Exclui Purchase B (80): o total da fatura cai de 160 para 80!
    // Como paid_amount é 80, a fatura deve ser marcada como 'paid' e a parcela da Purchase A quitada!
    await repo.deletePurchase(purchaseB.id);

    bills = await repo.getCreditCardBills(card.id);
    const paidBill = bills.find((b) => b.id === bill.id)!;
    expect(paidBill.total_amount).toBe(80);
    expect(paidBill.paid_amount).toBe(80);
    expect(paidBill.status).toBe('paid');

    const instsA = await repo.getInstallments(purchaseA.id);
    expect(instsA[0].status).toBe('paid');
    expect(instsA[0].paid_amount).toBe(80);

    // Limpa o pagamento e a purchase restante
    await repo.deletePayment(billPay.id);
    await repo.deletePurchase(purchaseA.id);
  });

  it('22. executa exclusões concorrentes de compras na mesma fatura com lock determinístico no staging', async () => {
    // 1. Cria cartão de crédito dedicado para o teste de concorrência
    const card = await repo.saveCreditCard({
      workspace_id: testWorkspaceId,
      name: 'Cartão Concorrência Staging',
      institution: 'FinBank',
      credit_limit: 3000,
      closing_day: 15,
      due_day: 25,
      color: '#f59e0b',
      active: true,
    });

    // 2. Cria Purchase A (100) e Purchase B (100) na mesma fatura (total = 200)
    const purchaseA = await repo.savePurchase({
      workspace_id: testWorkspaceId,
      description: 'Compra Concorrente A',
      total_amount: 100,
      installment_count: 1,
      purchase_date: '2026-11-01',
      credit_card_id: card.id,
    });

    const purchaseB = await repo.savePurchase({
      workspace_id: testWorkspaceId,
      description: 'Compra Concorrente B',
      total_amount: 100,
      installment_count: 1,
      purchase_date: '2026-11-01',
      credit_card_id: card.id,
    });

    let bills = await repo.getCreditCardBills(card.id);
    const bill = bills[0];
    expect(bill.total_amount).toBe(200);
    expect(bill.paid_amount).toBe(0);
    expect(bill.status).toBe('open');

    // 3. Dispara exclusões concorrentes simultâneas via Promise.all
    // Com o lock FOR UPDATE em credit_card_bills na fn_delete_purchase (Migration 018),
    // a segunda transação aguarda a primeira e recalcula sobre o total atualizado,
    // garantindo que o total_amount final seja 0 (200 - 100 - 100 = 0) e não 100.
    await Promise.all([
      repo.deletePurchase(purchaseA.id),
      repo.deletePurchase(purchaseB.id),
    ]);

    // 4. Valida que o total da fatura foi corretamente reconciliado para 0
    bills = await repo.getCreditCardBills(card.id);
    const finalBill = bills.find((b) => b.id === bill.id)!;
    expect(finalBill.total_amount).toBe(0);
    expect(finalBill.paid_amount).toBe(0);
    expect(finalBill.status).toBe('open');

    // 5. Valida que ambas as compras e suas parcelas foram devidamente removidas
    const purchases = await repo.getPurchases(testWorkspaceId);
    expect(purchases.some((p) => p.id === purchaseA.id)).toBe(false);
    expect(purchases.some((p) => p.id === purchaseB.id)).toBe(false);

    const instsA = await repo.getInstallments(purchaseA.id);
    expect(instsA.length).toBe(0);
    const instsB = await repo.getInstallments(purchaseB.id);
    expect(instsB.length).toBe(0);
  });

  it('23. rejeita mutação direta em faturas e parcelas por cliente autenticado mas permite ciclo via RPCs no staging', async () => {
    // 1. Cria cartão de crédito e compra com fatura no staging
    const card = await repo.saveCreditCard({
      workspace_id: testWorkspaceId,
      name: 'Cartão Protegido DML Staging',
      institution: 'FinBank',
      credit_limit: 4000,
      closing_day: 10,
      due_day: 20,
      color: '#8b5cf6',
      active: true,
    });

    const purchase = await repo.savePurchase({
      workspace_id: testWorkspaceId,
      description: 'Compra Proteção DML',
      total_amount: 300,
      installment_count: 3,
      purchase_date: '2026-11-01',
      credit_card_id: card.id,
    });

    const bills = await repo.getCreditCardBills(card.id);
    expect(bills.length).toBeGreaterThan(0);
    const bill = bills[0];
    const insts = await repo.getInstallments(purchase.id);
    expect(insts.length).toBe(3);
    const inst = insts[0];

    const client = (repo as any).client;

    // 2. Comprova que tentativas diretas de INSERT, UPDATE e DELETE em credit_card_bills falham com 42501
    const { error: insertBillErr } = await client
      .from('credit_card_bills')
      .insert({
        workspace_id: testWorkspaceId,
        credit_card_id: card.id,
        reference_month: '2027-05',
        closing_date: '2027-05-10',
        due_date: '2027-05-20',
        total_amount: 100,
      });
    expect(insertBillErr).toBeDefined();
    expect(insertBillErr?.code).toBe('42501');

    const { error: updateBillErr } = await client
      .from('credit_card_bills')
      .update({ paid_amount: 999, status: 'paid' })
      .eq('id', bill.id);
    expect(updateBillErr).toBeDefined();
    expect(updateBillErr?.code).toBe('42501');

    const { error: deleteBillErr } = await client
      .from('credit_card_bills')
      .delete()
      .eq('id', bill.id);
    expect(deleteBillErr).toBeDefined();
    expect(deleteBillErr?.code).toBe('42501');

    // 3. Comprova que tentativas diretas de INSERT, UPDATE e DELETE em installments falham com 42501
    const { error: insertInstErr } = await client
      .from('installments')
      .insert({
        purchase_id: purchase.id,
        installment_number: 4,
        amount: 100,
        due_date: '2027-02-20',
        status: 'pending',
        paid_amount: 0,
      });
    expect(insertInstErr).toBeDefined();
    expect(insertInstErr?.code).toBe('42501');

    const { error: updateInstErr } = await client
      .from('installments')
      .update({ paid_amount: 100, status: 'paid' })
      .eq('id', inst.id);
    expect(updateInstErr).toBeDefined();
    expect(updateInstErr?.code).toBe('42501');

    const { error: deleteInstErr } = await client
      .from('installments')
      .delete()
      .eq('id', inst.id);
    expect(deleteInstErr).toBeDefined();
    expect(deleteInstErr?.code).toBe('42501');

    // 3.1. Comprova via fn_check_table_privilege que authenticated não possui TRUNCATE, TRIGGER, REFERENCES (Migration 020)
    const { data: billTruncate } = await client.rpc('fn_check_table_privilege', { p_table: 'credit_card_bills', p_privilege: 'truncate' });
    expect(billTruncate).toBe(false);
    const { data: billTrigger } = await client.rpc('fn_check_table_privilege', { p_table: 'credit_card_bills', p_privilege: 'trigger' });
    expect(billTrigger).toBe(false);
    const { data: billReferences } = await client.rpc('fn_check_table_privilege', { p_table: 'credit_card_bills', p_privilege: 'references' });
    expect(billReferences).toBe(false);
    const { data: billSelect } = await client.rpc('fn_check_table_privilege', { p_table: 'credit_card_bills', p_privilege: 'select' });
    expect(billSelect).toBe(true);

    const { data: instTruncate } = await client.rpc('fn_check_table_privilege', { p_table: 'installments', p_privilege: 'truncate' });
    expect(instTruncate).toBe(false);
    const { data: instTrigger } = await client.rpc('fn_check_table_privilege', { p_table: 'installments', p_privilege: 'trigger' });
    expect(instTrigger).toBe(false);
    const { data: instReferences } = await client.rpc('fn_check_table_privilege', { p_table: 'installments', p_privilege: 'references' });
    expect(instReferences).toBe(false);
    const { data: instSelect } = await client.rpc('fn_check_table_privilege', { p_table: 'installments', p_privilege: 'select' });
    expect(instSelect).toBe(true);

    // 4. Comprova que o ciclo oficial via RPCs continua 100% funcional
    // Paga a fatura via RPC fn_record_payment
    const billPay = await repo.savePayment({
      workspace_id: testWorkspaceId,
      credit_card_bill_id: bill.id,
      account_id: testAccountId,
      amount: bill.total_amount,
      payment_date: '2026-11-05',
      affects_balance: true,
    });

    const billsPaid = await repo.getCreditCardBills(card.id);
    expect(billsPaid.find((b) => b.id === bill.id)?.status).toBe('paid');
    const instsPaid = await repo.getInstallments(purchase.id);
    const paidBillInst = instsPaid.find((i) => i.credit_card_bill_id === bill.id);
    expect(paidBillInst?.status).toBe('paid');

    // Estorna o pagamento da fatura via RPC fn_delete_payment
    await repo.deletePayment(billPay.id);
    const billsReopened = await repo.getCreditCardBills(card.id);
    expect(billsReopened.find((b) => b.id === bill.id)?.status).toBe('open');
    const instsReopened = await repo.getInstallments(purchase.id);
    const reopenedBillInst = instsReopened.find((i) => i.credit_card_bill_id === bill.id);
    expect(reopenedBillInst?.status).toBe('pending');

    // Exclui a compra via RPC fn_delete_purchase
    await repo.deletePurchase(purchase.id);
    const billsAfterDel = await repo.getCreditCardBills(card.id);
    expect(billsAfterDel.find((b) => b.id === bill.id)?.total_amount).toBe(0);
    const instsAfterDel = await repo.getInstallments(purchase.id);
    expect(instsAfterDel.length).toBe(0);
  });
});



