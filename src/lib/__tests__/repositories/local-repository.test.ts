import { describe, it, expect, beforeEach } from 'vitest';
import { LocalFinanceRepository } from '../../repositories/local-finance-repository';
import { RepositoryError } from '../../repositories/repository-errors';
import { loadFinanceSnapshot, saveFinanceSnapshot } from '../../context/finance-storage';
import { CreditCardBill, Installment } from '../../types';

function createMockStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

function seedBill(
  storage: Storage,
  bill: Omit<CreditCardBill, 'id' | 'created_at'> & { id?: string; created_at?: string }
): CreditCardBill {
  const { snapshot } = loadFinanceSnapshot(storage);
  const id = bill.id || ('local_b_' + Math.random().toString(36).slice(2, 9));
  const fullBill: CreditCardBill = {
    ...bill,
    id,
    created_at: bill.created_at || new Date().toISOString(),
  };
  const existingIdx = snapshot.allCreditCardBills.findIndex((b) => b.id === id);
  if (existingIdx !== -1) {
    snapshot.allCreditCardBills[existingIdx] = fullBill;
  } else {
    snapshot.allCreditCardBills.push(fullBill);
  }
  saveFinanceSnapshot(storage, snapshot);
  return fullBill;
}

function seedInstallment(
  storage: Storage,
  inst: Omit<Installment, 'id' | 'created_at'> & { id?: string; created_at?: string }
): Installment {
  const { snapshot } = loadFinanceSnapshot(storage);
  const id = inst.id || ('local_inst_' + Math.random().toString(36).slice(2, 9));
  const fullInst: Installment = {
    ...inst,
    id,
    created_at: inst.created_at || new Date().toISOString(),
  };
  const existingIdx = snapshot.allInstallments.findIndex((i) => i.id === id);
  if (existingIdx !== -1) {
    snapshot.allInstallments[existingIdx] = fullInst;
  } else {
    snapshot.allInstallments.push(fullInst);
  }
  saveFinanceSnapshot(storage, snapshot);
  return fullInst;
}

describe('LocalFinanceRepository', () => {
  let storage: Storage;
  let repo: LocalFinanceRepository;

  beforeEach(() => {
    storage = createMockStorage();
    repo = new LocalFinanceRepository(storage);
  });

  it('loads snapshot and respects activeWorkspaceId', async () => {
    const state = await repo.loadSnapshot('ws-1');
    expect(state.activeWorkspaceId).toBe('ws-1');
    expect(state.allWorkspaces.length).toBeGreaterThan(0);
    expect(state.allAccounts.length).toBeGreaterThan(0);

    const customWs = await repo.createWorkspace({
      name: 'Workspace Novo',
      owner_id: 'u-1',
      currency: 'BRL',
      tracking_mode: 'full',
    });
    const updatedState = await repo.loadSnapshot(customWs.id);
    expect(updatedState.activeWorkspaceId).toBe(customWs.id);
  });

  it('handles workspaces CRUD correctly', async () => {
    const created = await repo.createWorkspace({
      name: 'Novo Workspace',
      owner_id: 'user-xyz',
      currency: 'BRL',
      tracking_mode: 'full',
    });
    expect(created.id).toBeDefined();
    expect(created.name).toBe('Novo Workspace');

    const updated = await repo.updateWorkspace(created.id, { name: 'Workspace Renomeado' });
    expect(updated.name).toBe('Workspace Renomeado');

    await repo.deleteWorkspace(created.id);
    const workspaces = await repo.getWorkspaces();
    expect(workspaces.some((w) => w.id === created.id)).toBe(false);

    await expect(repo.updateWorkspace('inexistente', { name: 'Erro' })).rejects.toThrow(
      RepositoryError
    );
    await expect(repo.deleteWorkspace('inexistente')).rejects.toThrow(RepositoryError);
  });

  it('handles workspace members CRUD', async () => {
    const created = await repo.addWorkspaceMember({
      workspace_id: 'ws-personal',
      user_id: 'usr-abc',
      role: 'member',
    });
    expect(created.id).toBeDefined();
    expect(created.role).toBe('member');

    const members = await repo.getWorkspaceMembers('ws-personal');
    expect(members.some((m) => m.id === created.id)).toBe(true);

    const updated = await repo.updateWorkspaceMemberRole(created.id, 'admin');
    expect(updated.role).toBe('admin');

    await repo.removeWorkspaceMember(created.id);
    const afterDelete = await repo.getWorkspaceMembers('ws-personal');
    expect(afterDelete.some((m) => m.id === created.id)).toBe(false);

    await expect(repo.updateWorkspaceMemberRole('inexistente', 'admin')).rejects.toThrow(
      RepositoryError
    );
    await expect(repo.removeWorkspaceMember('inexistente')).rejects.toThrow(RepositoryError);
  });

  it('handles accounts CRUD', async () => {
    const acc = await repo.saveAccount({
      workspace_id: 'ws-personal',
      name: 'Banco Inter',
      institution: 'Inter',
      type: 'checking',
      current_balance: 1500,
      initial_balance: 1500,
      color: '#ff7a00',
      active: true,
    });
    expect(acc.id).toBeDefined();

    const accounts = await repo.getAccounts('ws-personal');
    expect(accounts.some((a) => a.id === acc.id)).toBe(true);

    const updated = await repo.saveAccount({
      ...acc,
      current_balance: 2000,
    });
    expect(updated.current_balance).toBe(2000);

    await repo.deleteAccount(acc.id);
    const afterDelete = await repo.getAccounts('ws-personal');
    expect(afterDelete.some((a) => a.id === acc.id)).toBe(false);

    await expect(repo.deleteAccount('inexistente')).rejects.toThrow(RepositoryError);
  });

  it('handles payment methods CRUD', async () => {
    const pm = await repo.savePaymentMethod({
      workspace_id: 'ws-personal',
      name: 'Pix Inter',
      type: 'pix',
      active: true,
    });
    expect(pm.id).toBeDefined();

    const methods = await repo.getPaymentMethods('ws-personal');
    expect(methods.some((m) => m.id === pm.id)).toBe(true);

    const updated = await repo.savePaymentMethod({ ...pm, name: 'Pix Inter Atualizado' });
    expect(updated.name).toBe('Pix Inter Atualizado');

    await repo.deletePaymentMethod(pm.id);
    await expect(repo.deletePaymentMethod('inexistente')).rejects.toThrow(RepositoryError);
  });

  it('handles credit cards and bills CRUD', async () => {
    const card = await repo.saveCreditCard({
      workspace_id: 'ws-personal',
      name: 'Inter Mastercard',
      institution: 'Inter',
      credit_limit: 8000,
      closing_day: 5,
      due_day: 12,
      color: '#ff7a00',
      active: true,
    });
    expect(card.id).toBeDefined();

    const updatedCard = await repo.saveCreditCard({ ...card, credit_limit: 10000 });
    expect(updatedCard.credit_limit).toBe(10000);

    const bill = seedBill(storage, {
      credit_card_id: card.id,
      workspace_id: 'ws-personal',
      reference_month: '2026-05',
      closing_date: '2026-05-05',
      due_date: '2026-05-12',
      total_amount: 500,
      paid_amount: 0,
      status: 'open',
    });
    expect(bill.id).toBeDefined();

    const bills = await repo.getCreditCardBills(card.id);
    expect(bills.length).toBe(1);

    const updatedBill = seedBill(storage, { ...bill, total_amount: 600 });
    expect(updatedBill.total_amount).toBe(600);

    await repo.deleteCreditCard(card.id);
    await expect(repo.deleteCreditCard('inexistente')).rejects.toThrow(RepositoryError);
  });

  it('handles categories CRUD', async () => {
    const cat = await repo.saveCategory({
      workspace_id: 'ws-personal',
      name: 'Assinaturas',
      type: 'expense',
      color: '#3b82f6',
      icon: 'sparkles',
      active: true,
    });
    expect(cat.id).toBeDefined();

    const updated = await repo.saveCategory({ ...cat, name: 'Streaming & Assinaturas' });
    expect(updated.name).toBe('Streaming & Assinaturas');

    await repo.deleteCategory(cat.id);
    await expect(repo.deleteCategory('inexistente')).rejects.toThrow(RepositoryError);
  });

  it('handles transactions CRUD', async () => {
    const tx = await repo.saveTransaction({
      workspace_id: 'ws-personal',
      description: 'Luz',
      amount: 180,
      transaction_date: '2026-04-10',
      due_date: '2026-04-10',
      type: 'expense',
      status: 'paid',
    });
    expect(tx.id).toBeDefined();

    const txs = await repo.getTransactions('ws-personal');
    expect(txs.some((t) => t.id === tx.id)).toBe(true);

    const updated = await repo.saveTransaction({ ...tx, amount: 195 });
    expect(updated.amount).toBe(195);

    await repo.deleteTransaction(tx.id);
    await expect(repo.deleteTransaction('inexistente')).rejects.toThrow(RepositoryError);
  });

  it('handles purchases and installments CRUD and auto-generates installments', async () => {
    const purchase = await repo.savePurchase({
      workspace_id: 'ws-personal',
      description: 'Sofá',
      total_amount: 2400,
      installment_count: 12,
      paid_installments_count: 0,
      purchase_date: '2026-04-01',
    });
    expect(purchase.id).toBeDefined();

    const purchases = await repo.getPurchases('ws-personal');
    expect(purchases.some((p) => p.id === purchase.id)).toBe(true);

    const installments = await repo.getInstallments(purchase.id);
    expect(installments.length).toBe(12);

    // Parcela avulsa via seed
    const manualInst = seedInstallment(storage, {
      purchase_id: purchase.id,
      installment_number: 13,
      amount: 50,
      due_date: '2026-06-01',
      status: 'pending',
      paid_amount: 0,
    });
    expect(manualInst.id).toBeDefined();

    const firstInst = installments[0];
    const updatedInst = seedInstallment(storage, { ...firstInst, paid_amount: 200, status: 'paid' });
    expect(updatedInst.status).toBe('paid');

    const updatedPurchase = await repo.savePurchase({ ...purchase, paid_installments_count: 1 });
    expect(updatedPurchase.paid_installments_count).toBe(1);

    await repo.deletePurchase(purchase.id);
    const afterDeleteInst = await repo.getInstallments(purchase.id);
    expect(afterDeleteInst.length).toBe(0);

    await expect(repo.deletePurchase('inexistente')).rejects.toThrow(RepositoryError);
  });

  it('validates splits sums for transactions and purchases', async () => {
    // Valid splits
    const tx = await repo.saveTransaction({
      workspace_id: 'ws-personal',
      description: 'Jantar Dividido',
      amount: 100,
      transaction_date: '2026-04-01',
      due_date: '2026-04-01',
      type: 'expense',
      status: 'paid',
      splits: [
        { member_id: 'mem-1', amount: 60, percentage: 60 },
        { member_id: 'mem-2', amount: 40, percentage: 40 },
      ],
    });
    expect(tx.id).toBeDefined();

    // Invalid transaction splits (sum != amount)
    await expect(
      repo.saveTransaction({
        workspace_id: 'ws-personal',
        description: 'Jantar Errado',
        amount: 100,
        transaction_date: '2026-04-01',
        due_date: '2026-04-01',
        type: 'expense',
        status: 'paid',
        splits: [{ member_id: 'mem-1', amount: 50, percentage: 50 }],
      })
    ).rejects.toThrow(RepositoryError);

    // Invalid purchase splits (sum != total_amount)
    await expect(
      repo.savePurchase({
        workspace_id: 'ws-personal',
        description: 'Compra Errada',
        total_amount: 500,
        installment_count: 5,
        purchase_date: '2026-04-01',
        splits: [{ member_id: 'mem-1', amount: 300, percentage: 60 }],
      })
    ).rejects.toThrow(RepositoryError);
  });

  it('updates balances and obligation statuses on saveTransfer/savePayment and reverses on deletion', async () => {
    // 1. Setup accounts
    const acc1 = await repo.saveAccount({
      workspace_id: 'ws-personal',
      name: 'Origem',
      type: 'checking',
      current_balance: 1000,
      initial_balance: 1000,
      institution: 'Bank',
      color: '#10b981',
      active: true,
    });
    const acc2 = await repo.saveAccount({
      workspace_id: 'ws-personal',
      name: 'Destino',
      type: 'checking',
      current_balance: 500,
      initial_balance: 500,
      institution: 'Bank',
      color: '#10b981',
      active: true,
    });

    // 2. Transfer: debits acc1, credits acc2
    const tr = await repo.saveTransfer({
      workspace_id: 'ws-personal',
      from_account_id: acc1.id,
      to_account_id: acc2.id,
      amount: 200,
      transfer_date: '2026-04-01',
    });
    let accs = await repo.getAccounts('ws-personal');
    expect(accs.find((a) => a.id === acc1.id)?.current_balance).toBe(800);
    expect(accs.find((a) => a.id === acc2.id)?.current_balance).toBe(700);

    // Revert transfer
    await repo.deleteTransfer(tr.id);
    accs = await repo.getAccounts('ws-personal');
    expect(accs.find((a) => a.id === acc1.id)?.current_balance).toBe(1000);
    expect(accs.find((a) => a.id === acc2.id)?.current_balance).toBe(500);

    // Transfer with nonexistent account fails
    await expect(
      repo.saveTransfer({
        workspace_id: 'ws-personal',
        from_account_id: 'nonexistent',
        to_account_id: acc2.id,
        amount: 50,
        transfer_date: '2026-04-01',
      })
    ).rejects.toThrow(RepositoryError);

    // 3. Payment affecting balance & transaction
    const tx = await repo.saveTransaction({
      workspace_id: 'ws-personal',
      description: 'Conta de Água',
      amount: 100,
      transaction_date: '2026-04-01',
      due_date: '2026-04-01',
      type: 'expense',
      status: 'pending',
    });
    const pay = await repo.savePayment({
      workspace_id: 'ws-personal',
      account_id: acc1.id,
      transaction_id: tx.id,
      amount: 100,
      payment_date: '2026-04-01',
      affects_balance: true,
    });
    accs = await repo.getAccounts('ws-personal');
    expect(accs.find((a) => a.id === acc1.id)?.current_balance).toBe(900);
    const txs = await repo.getTransactions('ws-personal');
    expect(txs.find((t) => t.id === tx.id)?.status).toBe('paid');

    // Revert payment
    await repo.deletePayment(pay.id);
    accs = await repo.getAccounts('ws-personal');
    expect(accs.find((a) => a.id === acc1.id)?.current_balance).toBe(1000);
    const txsAfter = await repo.getTransactions('ws-personal');
    expect(txsAfter.find((t) => t.id === tx.id)?.status).toBe('pending');
  });

  it('reconciles balances and statuses for income payments, partial payment deletions, and updates', async () => {
    // Setup accounts
    const accA = await repo.saveAccount({
      workspace_id: 'ws-personal',
      name: 'Conta A',
      type: 'checking',
      current_balance: 1000,
      initial_balance: 1000,
      institution: 'Bank',
      color: '#10b981',
      active: true,
    });
    const accB = await repo.saveAccount({
      workspace_id: 'ws-personal',
      name: 'Conta B',
      type: 'checking',
      current_balance: 500,
      initial_balance: 500,
      institution: 'Bank',
      color: '#3b82f6',
      active: true,
    });

    // 1. Transaction created with status = 'paid' generates payment & adjusts balance
    const paidExpenseTx = await repo.saveTransaction({
      workspace_id: 'ws-personal',
      description: 'Mercado à vista',
      amount: 150,
      transaction_date: '2026-04-01',
      due_date: '2026-04-01',
      type: 'expense',
      status: 'paid',
      account_id: accA.id,
    });
    expect(paidExpenseTx.status).toBe('paid');
    let accs = await repo.getAccounts('ws-personal');
    expect(accs.find((a) => a.id === accA.id)?.current_balance).toBe(850);
    const paymentsTx = await repo.getPayments('ws-personal');
    const autoPay = paymentsTx.find((p) => p.transaction_id === paidExpenseTx.id);
    expect(autoPay).toBeDefined();
    expect(autoPay?.amount).toBe(150);

    // 2. Income payment creation increases balance, and deletion decreases balance
    const incomeTx = await repo.saveTransaction({
      workspace_id: 'ws-personal',
      description: 'Salário Extra',
      amount: 400,
      transaction_date: '2026-04-01',
      due_date: '2026-04-01',
      type: 'income',
      status: 'pending',
    });
    const incomePay = await repo.savePayment({
      workspace_id: 'ws-personal',
      account_id: accA.id,
      transaction_id: incomeTx.id,
      amount: 400,
      payment_date: '2026-04-01',
      affects_balance: true,
    });
    accs = await repo.getAccounts('ws-personal');
    expect(accs.find((a) => a.id === accA.id)?.current_balance).toBe(1250); // 850 + 400

    // Deleting income payment subtracts from account balance
    await repo.deletePayment(incomePay.id);
    accs = await repo.getAccounts('ws-personal');
    expect(accs.find((a) => a.id === accA.id)?.current_balance).toBe(850); // 1250 - 400

    // 3. Partial payments on installment and status recalculation on deletion
    const purchase = await repo.savePurchase({
      workspace_id: 'ws-personal',
      description: 'Eletrodoméstico',
      total_amount: 300,
      installment_count: 1,
      purchase_date: '2026-04-01',
    });
    const inst = (await repo.getInstallments(purchase.id))[0];

    const partPay1 = await repo.savePayment({
      workspace_id: 'ws-personal',
      installment_id: inst.id,
      account_id: accA.id,
      amount: 100,
      payment_date: '2026-04-01',
      affects_balance: true,
    });
    let insts = await repo.getInstallments(purchase.id);
    expect(insts[0].status).toBe('partially_paid');
    expect(insts[0].paid_amount).toBe(100);

    const partPay2 = await repo.savePayment({
      workspace_id: 'ws-personal',
      installment_id: inst.id,
      account_id: accA.id,
      amount: 100,
      payment_date: '2026-04-02',
      affects_balance: true,
    });
    insts = await repo.getInstallments(purchase.id);
    expect(insts[0].status).toBe('partially_paid');
    expect(insts[0].paid_amount).toBe(200);

    // Deleting one of two partial payments keeps status as partially_paid
    await repo.deletePayment(partPay2.id);
    insts = await repo.getInstallments(purchase.id);
    expect(insts[0].status).toBe('partially_paid');
    expect(insts[0].paid_amount).toBe(100);

    // Deleting the last partial payment restores status to pending
    await repo.deletePayment(partPay1.id);
    insts = await repo.getInstallments(purchase.id);
    expect(insts[0].status).toBe('pending');
    expect(insts[0].paid_amount).toBe(0);

    // 4. Updating a payment amount reconciles balance difference and obligation
    const newTx = await repo.saveTransaction({
      workspace_id: 'ws-personal',
      description: 'Serviço',
      amount: 200,
      transaction_date: '2026-04-01',
      due_date: '2026-04-01',
      type: 'expense',
      status: 'pending',
    });
    const editablePay = await repo.savePayment({
      workspace_id: 'ws-personal',
      account_id: accB.id,
      transaction_id: newTx.id,
      amount: 100,
      payment_date: '2026-04-01',
      affects_balance: true,
    });
    accs = await repo.getAccounts('ws-personal');
    expect(accs.find((a) => a.id === accB.id)?.current_balance).toBe(400); // 500 - 100

    // Update payment amount from 100 to 180 (affects balance: 400 - 80 = 320)
    await repo.savePayment({
      ...editablePay,
      amount: 180,
    });
    accs = await repo.getAccounts('ws-personal');
    expect(accs.find((a) => a.id === accB.id)?.current_balance).toBe(320);

    // 5. Updating a transfer reconciles both accounts
    const initialTransfer = await repo.saveTransfer({
      workspace_id: 'ws-personal',
      from_account_id: accA.id,
      to_account_id: accB.id,
      amount: 100,
      transfer_date: '2026-04-01',
    });
    // accA was 850 -> minus 100 = 750
    // accB was 320 -> plus 100 = 420
    accs = await repo.getAccounts('ws-personal');
    expect(accs.find((a) => a.id === accA.id)?.current_balance).toBe(750);
    expect(accs.find((a) => a.id === accB.id)?.current_balance).toBe(420);

    // Update transfer amount from 100 to 150
    await repo.saveTransfer({
      ...initialTransfer,
      amount: 150,
    });
    accs = await repo.getAccounts('ws-personal');
    expect(accs.find((a) => a.id === accA.id)?.current_balance).toBe(700); // 750 - 50
    expect(accs.find((a) => a.id === accB.id)?.current_balance).toBe(470); // 420 + 50

    // Transfer update with invalid account throws RepositoryError
    await expect(
      repo.saveTransfer({
        id: initialTransfer.id,
        workspace_id: 'ws-personal',
        from_account_id: 'nonexistent-acc',
        to_account_id: accB.id,
        amount: 10,
        transfer_date: '2026-04-01',
      })
    ).rejects.toThrow(RepositoryError);

    // 6. Updating an income payment with affects_balance
    const incomeTx2 = await repo.saveTransaction({
      workspace_id: 'ws-personal',
      description: 'Freelance',
      amount: 500,
      transaction_date: '2026-04-01',
      due_date: '2026-04-01',
      type: 'income',
      status: 'pending',
    });
    const incomePay2 = await repo.savePayment({
      workspace_id: 'ws-personal',
      account_id: accA.id,
      transaction_id: incomeTx2.id,
      amount: 200,
      payment_date: '2026-04-01',
      affects_balance: true,
    });
    // Update income payment amount from 200 to 300 (accA was 700 + 200 = 900 -> 700 + 300 = 1000)
    await repo.savePayment({
      ...incomePay2,
      amount: 300,
    });
    accs = await repo.getAccounts('ws-personal');
    expect(accs.find((a) => a.id === accA.id)?.current_balance).toBe(1000);

    // 7. Updating a payment on an installment
    const purForInst = await repo.savePurchase({
      workspace_id: 'ws-personal',
      description: 'Teclado',
      total_amount: 200,
      installment_count: 1,
      purchase_date: '2026-04-01',
    });
    const instTarget = (await repo.getInstallments(purForInst.id))[0];
    const instPay = await repo.savePayment({
      workspace_id: 'ws-personal',
      installment_id: instTarget.id,
      amount: 100,
      payment_date: '2026-04-01',
    });
    // Update payment to full 200
    await repo.savePayment({
      ...instPay,
      amount: 200,
    });
    const updatedInstsAfterPay = await repo.getInstallments(purForInst.id);
    expect(updatedInstsAfterPay[0].status).toBe('paid');
    expect(updatedInstsAfterPay[0].paid_amount).toBe(200);

    // 8. Updating and deleting a payment on a credit card bill
    const testCard = await repo.saveCreditCard({
      workspace_id: 'ws-personal',
      name: 'Cartão Teste',
      institution: 'Bank',
      credit_limit: 1000,
      closing_day: 1,
      due_day: 10,
      color: '#10b981',
      active: true,
    });
    const testBill = seedBill(storage, {
      credit_card_id: testCard.id,
      workspace_id: 'ws-personal',
      reference_month: '2026-08',
      closing_date: '2026-08-01',
      due_date: '2026-08-10',
      total_amount: 500,
      paid_amount: 0,
      status: 'open',
    });
    const testBillTx = await repo.saveTransaction({
      workspace_id: 'ws-personal',
      description: 'Gasto na Fatura',
      amount: 250,
      transaction_date: '2026-08-01',
      due_date: '2026-08-10',
      credit_card_id: testCard.id,
      credit_card_bill_id: testBill.id,
      type: 'expense',
      status: 'pending',
    });
    const testBillPur = await repo.savePurchase({
      workspace_id: 'ws-personal',
      description: 'Compra Fatura',
      total_amount: 250,
      installment_count: 1,
      purchase_date: '2026-08-01',
      credit_card_id: testCard.id,
    });
    const testBillInst = (await repo.getInstallments(testBillPur.id))[0];
    testBillInst.credit_card_bill_id = testBill.id;
    seedInstallment(storage, testBillInst);

    const billPay = await repo.savePayment({
      workspace_id: 'ws-personal',
      credit_card_bill_id: testBill.id,
      amount: 200,
      payment_date: '2026-08-02',
    });
    // Update payment on bill to 500 (full paid)
    await repo.savePayment({
      ...billPay,
      amount: 500,
    });
    let bills = await repo.getCreditCardBills(testCard.id);
    expect(bills[0].status).toBe('paid');
    expect(bills[0].paid_amount).toBe(500);
    const updatedTestBillTx = (await repo.getTransactions('ws-personal')).find((t) => t.id === testBillTx.id)!;
    expect(updatedTestBillTx.status).toBe('paid');
    const updatedTestBillInst = (await repo.getInstallments(testBillPur.id))[0];
    expect(updatedTestBillInst.status).toBe('paid');

    // Update payment on bill back down to 200: reopens bill to partially_paid and linked items to pending
    await repo.savePayment({
      ...billPay,
      amount: 200,
    });
    bills = await repo.getCreditCardBills(testCard.id);
    expect(bills[0].status).toBe('partially_paid');
    const demotedTx = (await repo.getTransactions('ws-personal')).find((t) => t.id === testBillTx.id)!;
    expect(demotedTx.status).toBe('pending');
    const demotedInst = (await repo.getInstallments(testBillPur.id))[0];
    expect(demotedInst.status).toBe('pending');

    // Delete payment on bill: restores to open with paid_amount = 0
    await repo.deletePayment(billPay.id);
    bills = await repo.getCreditCardBills(testCard.id);
    expect(bills[0].status).toBe('open');
    expect(bills[0].paid_amount).toBe(0);

    // 9. Transaction with type: income and status: paid (covers line 455)
    const paidIncomeTx = await repo.saveTransaction({
      workspace_id: 'ws-personal',
      description: 'Consultoria Direta',
      amount: 350,
      transaction_date: '2026-04-01',
      due_date: '2026-04-01',
      type: 'income',
      status: 'paid',
      account_id: accA.id,
    });
    expect(paidIncomeTx.status).toBe('paid');
    accs = await repo.getAccounts('ws-personal');
    expect(accs.find((a) => a.id === accA.id)?.current_balance).toBe(1350); // 1000 + 350

    // 10. Transaction with 2 partial payments, deleting 1 leaves partially_paid (covers line 781 reducer)
    const multiPayTx = await repo.saveTransaction({
      workspace_id: 'ws-personal',
      description: 'Serviço Parcelado',
      amount: 200,
      transaction_date: '2026-04-01',
      due_date: '2026-04-01',
      type: 'expense',
      status: 'pending',
    });
    const txP1 = await repo.savePayment({
      workspace_id: 'ws-personal',
      transaction_id: multiPayTx.id,
      amount: 50,
      payment_date: '2026-04-01',
    });
    const txP2 = await repo.savePayment({
      workspace_id: 'ws-personal',
      transaction_id: multiPayTx.id,
      amount: 50,
      payment_date: '2026-04-02',
    });
    await repo.deletePayment(txP2.id);
    const txsList = await repo.getTransactions('ws-personal');
    const checkedTx = txsList.find((t) => t.id === multiPayTx.id);
    expect(checkedTx?.status).toBe('partially_paid');

    // 11. Bill with 2 partial payments, deleting 1 leaves partially_paid (covers line 808 reducer)
    const billP1 = await repo.savePayment({
      workspace_id: 'ws-personal',
      credit_card_bill_id: testBill.id,
      amount: 100,
      payment_date: '2026-08-01',
    });
    const billP2 = await repo.savePayment({
      workspace_id: 'ws-personal',
      credit_card_bill_id: testBill.id,
      amount: 100,
      payment_date: '2026-08-02',
    });
    await repo.deletePayment(billP2.id);
    bills = await repo.getCreditCardBills(testCard.id);
    expect(bills[0].status).toBe('partially_paid');
    expect(bills[0].paid_amount).toBe(100);
    await repo.deletePayment(billP1.id);

    // 12. Payment update switching account
    const switchPayTx = await repo.saveTransaction({
      workspace_id: 'ws-personal',
      description: 'Conta Switch',
      amount: 100,
      transaction_date: '2026-04-01',
      due_date: '2026-04-01',
      type: 'expense',
      status: 'pending',
    });
    const switchPay = await repo.savePayment({
      workspace_id: 'ws-personal',
      transaction_id: switchPayTx.id,
      account_id: accA.id,
      amount: 100,
      payment_date: '2026-04-01',
      affects_balance: true,
    });
    // Switch from accA to accB: accA refunded (+100), accB debited (-100)
    await repo.savePayment({
      id: switchPay.id,
      workspace_id: 'ws-personal',
      account_id: accB.id,
      amount: 100,
      payment_date: '2026-04-01',
      affects_balance: true,
    });
    // 13. Transfer update without new from/to/amount uses oldTransfer fallbacks
    const fallbackTr = await repo.saveTransfer({
      id: initialTransfer.id,
      workspace_id: 'ws-personal',
    } as any);
    expect(fallbackTr.id).toBe(initialTransfer.id);

    // 14. Transfer and Payment update where accounts are missing from state (hits false branches of if(oldAcc), if(newAcc))
    const rawState = (repo as any).getState();
    const orphanTr = await repo.saveTransfer({
      workspace_id: 'ws-personal',
      from_account_id: accA.id,
      to_account_id: accB.id,
      amount: 10,
      transfer_date: '2026-04-01',
    });
    // Remove accounts from state to trigger !oldFromAcc / !oldToAcc branches
    rawState.allAccounts = [];
    (repo as any).saveState(rawState);

    await expect(
      repo.saveTransfer({
        id: orphanTr.id,
        workspace_id: 'ws-personal',
        amount: 20,
      } as any)
    ).rejects.toThrow(RepositoryError);

    // 15. Deleting one payment when remaining still >= amount leaves status as 'paid'
    const fullPaidTx = await repo.saveTransaction({
      workspace_id: 'ws-personal',
      description: 'Overpaid Tx',
      amount: 100,
      transaction_date: '2026-04-01',
      due_date: '2026-04-01',
      type: 'expense',
      status: 'pending',
    });
    const fpTx1 = await repo.savePayment({ workspace_id: 'ws-personal', transaction_id: fullPaidTx.id, amount: 100, payment_date: '2026-04-01' });
    const fpTx2 = await repo.savePayment({ workspace_id: 'ws-personal', transaction_id: fullPaidTx.id, amount: 20, payment_date: '2026-04-02' });
    await repo.deletePayment(fpTx2.id);
    const txsList2 = await repo.getTransactions('ws-personal');
    expect(txsList2.find((t) => t.id === fullPaidTx.id)?.status).toBe('paid');

    const fullPaidPur = await repo.savePurchase({
      workspace_id: 'ws-personal',
      description: 'Overpaid Pur',
      total_amount: 100,
      installment_count: 1,
      purchase_date: '2026-04-01',
    });
    const fullPaidInst = (await repo.getInstallments(fullPaidPur.id))[0];
    const fpInst1 = await repo.savePayment({ workspace_id: 'ws-personal', installment_id: fullPaidInst.id, amount: 100, payment_date: '2026-04-01' });
    const fpInst2 = await repo.savePayment({ workspace_id: 'ws-personal', installment_id: fullPaidInst.id, amount: 20, payment_date: '2026-04-02' });
    await repo.deletePayment(fpInst2.id);
    const instsList2 = await repo.getInstallments(fullPaidPur.id);
    expect(instsList2[0].status).toBe('paid');

    const fpBill = seedBill(storage, {
      credit_card_id: testCard.id,
      workspace_id: 'ws-personal',
      reference_month: '2026-09',
      closing_date: '2026-09-01',
      due_date: '2026-09-10',
      total_amount: 100,
      paid_amount: 0,
      status: 'open',
    });
    const fpBill1 = await repo.savePayment({ workspace_id: 'ws-personal', credit_card_bill_id: fpBill.id, amount: 100, payment_date: '2026-09-02' });
    const fpBill2 = await repo.savePayment({ workspace_id: 'ws-personal', credit_card_bill_id: fpBill.id, amount: 20, payment_date: '2026-09-03' });
    await repo.deletePayment(fpBill2.id);
    const billsList2 = await repo.getCreditCardBills(testCard.id);
    expect(billsList2.find((b) => b.id === fpBill.id)?.status).toBe('paid');
  });

  it('initializes with default memory storage if no storage provided', async () => {
    const memoryRepo = new LocalFinanceRepository();
    expect(memoryRepo).toBeInstanceOf(LocalFinanceRepository);

    // Test window.localStorage branch in constructor
    const origWindow = (globalThis as any).window;
    (globalThis as any).window = { localStorage: createMockStorage() };
    const winRepo = new LocalFinanceRepository();
    expect(winRepo).toBeInstanceOf(LocalFinanceRepository);
    (globalThis as any).window = origWindow;

    // Test memory storage internal functions: setItem, getItem, key, removeItem, clear, length
    const memStore = (memoryRepo as any).storage;
    memStore.setItem('test-key', 'val');
    expect(memStore.getItem('test-key')).toBe('val');
    expect(memStore.key(0)).toBe('test-key');
    expect(memStore.length).toBe(1);
    memStore.removeItem('test-key');
    expect(memStore.length).toBe(0);
    memStore.setItem('k2', 'v2');
    memStore.clear();
    expect(memStore.length).toBe(0);

    // Test generateId fallback when crypto.randomUUID is not available
    const origCryptoDesc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    try {
      Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
      const ws = await memoryRepo.createWorkspace({
        name: 'Fallback Crypto',
        owner_id: 'u-1',
        currency: 'BRL',
        tracking_mode: 'full',
      });
      expect(ws.id).toBeDefined();
    } finally {
      if (origCryptoDesc) {
        Object.defineProperty(globalThis, 'crypto', origCryptoDesc);
      }
    }
  });

  it('handles payments, transfers, recurring, budgets, goals, and settlements CRUD', async () => {
    // Categories getter
    await repo.saveCategory({ workspace_id: 'ws-personal', name: 'Cat Test', type: 'expense', active: true, color: '#10b981', icon: 'tag' });
    const cats = await repo.getCategories('ws-personal');
    expect(cats.length).toBeGreaterThan(0);

    // Credit cards getter
    await repo.saveCreditCard({ workspace_id: 'ws-personal', name: 'Card Test', credit_limit: 1000, closing_day: 1, due_day: 10, active: true, institution: 'Bank', color: '#6366f1' });
    const cards = await repo.getCreditCards('ws-personal');
    expect(cards.length).toBeGreaterThan(0);

    // Payments
    const pay = await repo.savePayment({
      workspace_id: 'ws-personal',
      payment_date: '2026-04-01',
      amount: 100,
      affects_balance: false,
    });
    expect(pay.id).toBeDefined();
    const payments = await repo.getPayments('ws-personal');
    expect(payments.some((p) => p.id === pay.id)).toBe(true);

    const updatedPay = await repo.savePayment({ ...pay, amount: 120 });
    expect(updatedPay.amount).toBe(120);
    await repo.deletePayment(pay.id);
    await expect(repo.deletePayment('inexistente')).rejects.toThrow(RepositoryError);

    // Transfers getter, update and error
    const tr = await repo.saveTransfer({
      workspace_id: 'ws-personal',
      from_account_id: 'acc-1',
      to_account_id: 'acc-2',
      amount: 30,
      transfer_date: '2026-04-01',
    });
    const transfers = await repo.getTransfers('ws-personal');
    expect(transfers.some((t) => t.id === tr.id)).toBe(true);
    const updatedTr = await repo.saveTransfer({ ...tr, amount: 35 });
    expect(updatedTr.amount).toBe(35);
    await repo.deleteTransfer(tr.id);
    await expect(repo.deleteTransfer('inexistente')).rejects.toThrow(RepositoryError);

    // Recurring
    const rec = await repo.saveRecurring({
      workspace_id: 'ws-personal',
      description: 'Academia',
      amount: 120,
      frequency: 'monthly',
      type: 'expense',
      active: true,
      start_date: '2026-01-01',
      next_occurrence: '2026-05-10',
      auto_create: false,
    });
    expect(rec.id).toBeDefined();
    const recurringList = await repo.getRecurring('ws-personal');
    expect(recurringList.some((r) => r.id === rec.id)).toBe(true);

    const updatedRec = await repo.saveRecurring({ ...rec, amount: 130 });
    expect(updatedRec.amount).toBe(130);
    await repo.deleteRecurring(rec.id);
    await expect(repo.deleteRecurring('inexistente')).rejects.toThrow(RepositoryError);

    // Budgets
    const budget = await repo.saveBudget({
      workspace_id: 'ws-personal',
      category_id: 'cat-1',
      planned_amount: 500,
      month: 4,
      year: 2026,
    });
    expect(budget.id).toBeDefined();
    const budgets = await repo.getBudgets('ws-personal');
    expect(budgets.some((b) => b.id === budget.id)).toBe(true);

    const updatedBudget = await repo.saveBudget({ ...budget, planned_amount: 600 });
    expect(updatedBudget.planned_amount).toBe(600);
    await repo.deleteBudget(budget.id);
    await expect(repo.deleteBudget('inexistente')).rejects.toThrow(RepositoryError);

    // Goals
    const goal = await repo.saveGoal({
      workspace_id: 'ws-personal',
      name: 'Viagem',
      target_amount: 5000,
      current_amount: 1000,
      target_date: '2026-12-01',
      status: 'in_progress',
      color: '#3b82f6',
      icon: 'plane',
    });
    expect(goal.id).toBeDefined();
    const goals = await repo.getGoals('ws-personal');
    expect(goals.some((g) => g.id === goal.id)).toBe(true);

    const updatedGoal = await repo.saveGoal({ ...goal, current_amount: 1500 });
    expect(updatedGoal.current_amount).toBe(1500);
    await repo.deleteGoal(goal.id);
    await expect(repo.deleteGoal('inexistente')).rejects.toThrow(RepositoryError);

    // Settlements
    const settlement = await repo.saveSettlement({
      workspace_id: 'ws-personal',
      from_member_id: 'mem-1',
      to_member_id: 'mem-2',
      amount: 40,
      settlement_date: '2026-04-01',
    });
    expect(settlement.id).toBeDefined();
    const settlements = await repo.getSettlements('ws-personal');
    expect(settlements.some((s) => s.id === settlement.id)).toBe(true);

    const updatedSettlement = await repo.saveSettlement({ ...settlement, amount: 45 });
    expect(updatedSettlement.amount).toBe(45);
    await repo.deleteSettlement(settlement.id);
    await expect(repo.deleteSettlement('inexistente')).rejects.toThrow(RepositoryError);
  });

  it('handles payments for installments and credit card bills with reversals', async () => {
    // Installment payment
    const purchase = await repo.savePurchase({
      workspace_id: 'ws-personal',
      description: 'Celular',
      total_amount: 1000,
      installment_count: 2,
      purchase_date: '2026-04-01',
    });
    const insts = await repo.getInstallments(purchase.id);
    expect(insts.length).toBe(2);

    const payInst = await repo.savePayment({
      workspace_id: 'ws-personal',
      installment_id: insts[0].id,
      amount: 500,
      payment_date: '2026-04-01',
      affects_balance: false,
    });
    const instsAfter = await repo.getInstallments(purchase.id);
    expect(instsAfter[0].status).toBe('paid');
    expect(instsAfter[0].paid_amount).toBe(500);

    // Revert installment payment
    await repo.deletePayment(payInst.id);
    const instsReverted = await repo.getInstallments(purchase.id);
    expect(instsReverted[0].status).toBe('pending');
    expect(instsReverted[0].paid_amount).toBe(0);

    // Credit card bill payment
    const card = await repo.saveCreditCard({
      workspace_id: 'ws-personal',
      name: 'Card Test',
      institution: 'Bank',
      credit_limit: 5000,
      closing_day: 1,
      due_day: 10,
      color: '#6366f1',
      active: true,
    });
    const bill = seedBill(storage, {
      credit_card_id: card.id,
      workspace_id: 'ws-personal',
      reference_month: '2026-05',
      closing_date: '2026-05-01',
      due_date: '2026-05-10',
      total_amount: 300,
      paid_amount: 0,
      status: 'open',
    });

    const payBill = await repo.savePayment({
      workspace_id: 'ws-personal',
      credit_card_bill_id: bill.id,
      amount: 300,
      payment_date: '2026-05-02',
      affects_balance: false,
    });
    let bills = await repo.getCreditCardBills(card.id);
    expect(bills[0].status).toBe('paid');
    expect(bills[0].paid_amount).toBe(300);

    // Revert bill payment
    await repo.deletePayment(payBill.id);
    bills = await repo.getCreditCardBills(card.id);
    expect(bills[0].status).toBe('open');
    expect(bills[0].paid_amount).toBe(0);
  });

  it('inserts entities with provided id when id is not found in existing state', async () => {
    const acc = await repo.saveAccount({ id: 'acc-new-custom', workspace_id: 'ws-personal', name: 'Custom ID Acc', type: 'checking', current_balance: 100, initial_balance: 100, active: true, institution: 'Bank', color: '#10b981' });
    expect(acc.id).toBe('acc-new-custom');

    const cat = await repo.saveCategory({ id: 'cat-new-custom', workspace_id: 'ws-personal', name: 'Custom ID Cat', type: 'expense', active: true, color: '#10b981', icon: 'tag' });
    expect(cat.id).toBe('cat-new-custom');

    const pm = await repo.savePaymentMethod({ id: 'pm-new-custom', workspace_id: 'ws-personal', name: 'Custom ID PM', type: 'pix', active: true });
    expect(pm.id).toBe('pm-new-custom');

    const card = await repo.saveCreditCard({ id: 'card-new-custom', workspace_id: 'ws-personal', name: 'Custom ID Card', credit_limit: 1000, closing_day: 1, due_day: 10, active: true, institution: 'Bank', color: '#6366f1' });
    expect(card.id).toBe('card-new-custom');

    const tx = await repo.saveTransaction({ id: 'tx-new-custom', workspace_id: 'ws-personal', description: 'Custom ID Tx', amount: 50, transaction_date: '2026-04-01', due_date: '2026-04-01', type: 'expense', status: 'paid' });
    expect(tx.id).toBe('tx-new-custom');

    const pur = await repo.savePurchase({ id: 'pur-new-custom', workspace_id: 'ws-personal', description: 'Custom ID Pur', total_amount: 100, installment_count: 1, purchase_date: '2026-04-01' });
    expect(pur.id).toBe('pur-new-custom');

    const pay = await repo.savePayment({ id: 'pay-new-custom', workspace_id: 'ws-personal', amount: 50, payment_date: '2026-04-01', affects_balance: false });
    expect(pay.id).toBe('pay-new-custom');

    const tr = await repo.saveTransfer({ id: 'tr-new-custom', workspace_id: 'ws-personal', from_account_id: 'acc-1', to_account_id: 'acc-2', amount: 10, transfer_date: '2026-04-01' });
    expect(tr.id).toBe('tr-new-custom');

    const rec = await repo.saveRecurring({ id: 'rec-new-custom', workspace_id: 'ws-personal', description: 'Custom ID Rec', amount: 20, frequency: 'monthly', type: 'expense', active: true, start_date: '2026-01-01', next_occurrence: '2026-05-01', auto_create: false });
    expect(rec.id).toBe('rec-new-custom');

    const bg = await repo.saveBudget({ id: 'bg-new-custom', workspace_id: 'ws-personal', category_id: 'cat-1', planned_amount: 100, month: 4, year: 2026 });
    expect(bg.id).toBe('bg-new-custom');

    const goal = await repo.saveGoal({ id: 'goal-new-custom', workspace_id: 'ws-personal', name: 'Custom ID Goal', target_amount: 1000, current_amount: 100, status: 'in_progress', color: '#10b981', icon: 'target' });
    expect(goal.id).toBe('goal-new-custom');

    const st = await repo.saveSettlement({ id: 'st-new-custom', workspace_id: 'ws-personal', from_member_id: 'mem-1', to_member_id: 'mem-2', amount: 20, settlement_date: '2026-04-01' });
    expect(st.id).toBe('st-new-custom');
  });

  it('covers partial payments and missing reference branches in savePayment, deletePayment, and deleteTransfer', async () => {
    // 1. Partial payment on installment
    const purchase = await repo.savePurchase({
      workspace_id: 'ws-personal',
      description: 'Notebook',
      total_amount: 1000,
      installment_count: 2,
      purchase_date: '2026-04-01',
    });
    const insts = await repo.getInstallments(purchase.id);
    await repo.savePayment({
      workspace_id: 'ws-personal',
      installment_id: insts[0].id,
      amount: 200,
      payment_date: '2026-04-01',
      affects_balance: false,
    });
    const instsAfterPartial = await repo.getInstallments(purchase.id);
    expect(instsAfterPartial[0].status).toBe('partially_paid');
    expect(instsAfterPartial[0].paid_amount).toBe(200);

    // 2. Partial payment on credit card bill
    const card = await repo.saveCreditCard({
      workspace_id: 'ws-personal',
      name: 'Partial Card',
      institution: 'Bank',
      credit_limit: 3000,
      closing_day: 1,
      due_day: 10,
      color: '#6366f1',
      active: true,
    });
    const bill = seedBill(storage, {
      credit_card_id: card.id,
      workspace_id: 'ws-personal',
      reference_month: '2026-07',
      closing_date: '2026-07-01',
      due_date: '2026-07-10',
      total_amount: 600,
      paid_amount: 0,
      status: 'open',
    });
    await repo.savePayment({
      workspace_id: 'ws-personal',
      credit_card_bill_id: bill.id,
      amount: 150,
      payment_date: '2026-07-02',
      affects_balance: false,
    });
    const billsAfterPartial = await repo.getCreditCardBills(card.id);
    expect(billsAfterPartial[0].status).toBe('partially_paid');
    expect(billsAfterPartial[0].paid_amount).toBe(150);

    // 3. savePayment with nonexistent references (hits false branches of if (acc), if (tx), if (inst), if (bill))
    const orphanPayment = await repo.savePayment({
      workspace_id: 'ws-personal',
      account_id: 'acc-nonexistent',
      affects_balance: true,
      transaction_id: 'tx-nonexistent',
      installment_id: 'inst-nonexistent',
      credit_card_bill_id: 'bill-nonexistent',
      amount: 50,
      payment_date: '2026-04-01',
    });
    expect(orphanPayment.id).toBeDefined();

    // 4. deletePayment with nonexistent references (hits false branches of if (acc), if (tx), if (inst), if (bill))
    await repo.deletePayment(orphanPayment.id);

    // 5. deleteTransfer where accounts are missing from state
    const acc1 = await repo.saveAccount({
      workspace_id: 'ws-personal',
      name: 'Acc 1',
      type: 'checking',
      current_balance: 500,
      initial_balance: 500,
      institution: 'Bank',
      color: '#10b981',
      active: true,
    });
    const acc2 = await repo.saveAccount({
      workspace_id: 'ws-personal',
      name: 'Acc 2',
      type: 'checking',
      current_balance: 500,
      initial_balance: 500,
      institution: 'Bank',
      color: '#10b981',
      active: true,
    });
    const tr = await repo.saveTransfer({
      workspace_id: 'ws-personal',
      from_account_id: acc1.id,
      to_account_id: acc2.id,
      amount: 100,
      transfer_date: '2026-04-01',
    });
    await repo.deleteAccount(acc1.id);
    await repo.deleteAccount(acc2.id);
    await expect(repo.deleteTransfer(tr.id)).resolves.toBeUndefined();

    // 6. Installment and Bill with undefined paid_amount in savePayment & deletePayment
    const purchaseUndef = await repo.savePurchase({
      workspace_id: 'ws-personal',
      description: 'Undef Paid Amount',
      total_amount: 100,
      installment_count: 1,
      purchase_date: '2026-04-01',
    });
    const instUndef = (await repo.getInstallments(purchaseUndef.id))[0];
    (instUndef as any).paid_amount = undefined;
    seedInstallment(storage, instUndef);

    const payInstUndef = await repo.savePayment({
      workspace_id: 'ws-personal',
      installment_id: instUndef.id,
      amount: 50,
      payment_date: '2026-04-01',
    });
    (instUndef as any).paid_amount = undefined;
    seedInstallment(storage, instUndef);
    await repo.deletePayment(payInstUndef.id);

    const billUndef = seedBill(storage, {
      credit_card_id: card.id,
      workspace_id: 'ws-personal',
      reference_month: '2026-08',
      closing_date: '2026-08-01',
      due_date: '2026-08-10',
      total_amount: 100,
      paid_amount: undefined as any,
      status: 'open',
    });
    const payBillUndef = await repo.savePayment({
      workspace_id: 'ws-personal',
      credit_card_bill_id: billUndef.id,
      amount: 50,
      payment_date: '2026-08-02',
    });
    (billUndef as any).paid_amount = undefined;
    seedBill(storage, billUndef);
    await repo.deletePayment(payBillUndef.id);

    // 7. Purchase with paid_installments_count > 0 and installment_count = 0
    const purWithPaid = await repo.savePurchase({
      workspace_id: 'ws-personal',
      description: 'Paid Insts Pur',
      total_amount: 300,
      installment_count: 3,
      paid_installments_count: 2,
      purchase_date: '2026-04-01',
    });
    const instsWithPaid = await repo.getInstallments(purWithPaid.id);
    expect(instsWithPaid[0].status).toBe('paid');
    expect(instsWithPaid[0].paid_amount).toBe(100);
    expect(instsWithPaid[1].status).toBe('paid');
    expect(instsWithPaid[2].status).toBe('pending');

    const purZeroInst = await repo.savePurchase({
      workspace_id: 'ws-personal',
      description: 'Zero Inst Pur',
      total_amount: 100,
      installment_count: 0,
      purchase_date: '2026-04-01',
    });
    const instsZero = await repo.getInstallments(purZeroInst.id);
    expect(instsZero.length).toBe(0);

    // 8. loadSnapshot with unknown workspaceId and with throwing storage
    const stateUnknown = await repo.loadSnapshot('ws-desconhecido');
    expect(stateUnknown.allWorkspaces.length).toBeGreaterThan(0);

    const throwingStorage: Storage = {
      ...createMockStorage(),
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
    };
    const throwingRepo = new LocalFinanceRepository(throwingStorage);
    const existingWs = (await throwingRepo.getWorkspaces())[0];
    const snap = await throwingRepo.loadSnapshot(existingWs.id);
    expect(snap.activeWorkspaceId).toBe(existingWs.id);

    // 9. Default constructor without storage argument and memory storage key coverage
    const defaultRepo = new LocalFinanceRepository();
    expect(defaultRepo).toBeDefined();
    const memStorage = (defaultRepo as any).storage as Storage;
    memStorage.setItem('test_k', 'v');
    expect(memStorage.key(0)).toBe('test_k');
    expect(memStorage.key(999)).toBeNull();

    // 10. Split sum mismatch validation in savePurchase and saveTransaction
    await expect(
      repo.savePurchase({
        workspace_id: 'ws-personal',
        description: 'Split Mismatch Pur',
        total_amount: 100,
        installment_count: 1,
        purchase_date: '2026-04-01',
        splits: [{ member_id: 'm-1', amount: 40 }],
      })
    ).rejects.toThrow(RepositoryError);

    await expect(
      repo.saveTransaction({
        workspace_id: 'ws-personal',
        description: 'Split Mismatch Tx',
        amount: 100,
        transaction_date: '2026-04-01',
        due_date: '2026-04-01',
        type: 'expense',
        status: 'paid',
        splits: [{ member_id: 'm-1', amount: 40 }],
      })
    ).rejects.toThrow(RepositoryError);

    // 11. Matching splits in savePurchase and saveTransaction, and undefined installment_count
    const purValidSplits = await repo.savePurchase({
      workspace_id: 'ws-personal',
      description: 'Matching Splits Pur',
      total_amount: 100,
      installment_count: undefined as any,
      purchase_date: '2026-04-01',
      splits: [{ member_id: 'm-1', amount: 60 }, { member_id: 'm-2', amount: 40 }],
    });
    expect(purValidSplits.splits?.length).toBe(2);

    const txValidSplits = await repo.saveTransaction({
      workspace_id: 'ws-personal',
      description: 'Matching Splits Tx',
      amount: 100,
      transaction_date: '2026-04-01',
      due_date: '2026-04-01',
      type: 'expense',
      status: 'paid',
      splits: [{ member_id: 'm-1', amount: 60 }, { member_id: 'm-2', amount: 40 }],
    });
    expect(txValidSplits.splits?.length).toBe(2);

    // 12. Reconciliação de parcelas e faturas ao editar compra parcelada (V38 / Migration 014)
    const recCard = await repo.saveCreditCard({
      workspace_id: 'ws-personal',
      name: 'Cartão Platinum',
      institution: 'Bank',
      closing_day: 10,
      due_day: 20,
      credit_limit: 5000,
      color: '#000',
      active: true,
    });
    const recBill = seedBill(storage, {
      workspace_id: 'ws-personal',
      credit_card_id: recCard.id,
      reference_month: '2026-05',
      closing_date: '2026-05-10',
      due_date: '2026-05-20',
      total_amount: 200,
      paid_amount: 0,
      status: 'open',
    });

    const recPurchase = await repo.savePurchase({
      workspace_id: 'ws-personal',
      description: 'Notebook Parcelado',
      total_amount: 400,
      installment_count: 2,
      purchase_date: '2026-04-01',
    });
    let recInsts = await repo.getInstallments(recPurchase.id);
    expect(recInsts.length).toBe(2);
    expect(recInsts[0].amount).toBe(200);
    expect(recInsts[1].amount).toBe(200);

    // Vincula a primeira parcela à fatura
    recInsts[0].credit_card_bill_id = recBill.id;
    seedInstallment(storage, recInsts[0]);

    // Edita o total da compra para R$ 500: parcelas devem virar R$ 250 e fatura deve ir para R$ 250
    await repo.savePurchase({
      ...recPurchase,
      total_amount: 500,
    });
    recInsts = await repo.getInstallments(recPurchase.id);
    expect(recInsts[0].amount).toBe(250);
    expect(recInsts[1].amount).toBe(250);

    const bills = await repo.getCreditCardBills(recCard.id);
    const updatedBill = bills.find((b) => b.id === recBill.id);
    expect(updatedBill?.total_amount).toBe(250);

    // Rejeita redução de total abaixo do total já pago pelas parcelas
    recInsts[0].status = 'paid';
    recInsts[0].paid_amount = 250;
    seedInstallment(storage, recInsts[0]);

    await expect(
      repo.savePurchase({
        ...recPurchase,
        total_amount: 200,
      })
    ).rejects.toThrow(RepositoryError);

    // 13. Reabertura de itens ao estornar ou reduzir pagamento de fatura (V38 / Migration 014)
    const cardTx = await repo.saveTransaction({
      workspace_id: 'ws-personal',
      credit_card_id: recCard.id,
      credit_card_bill_id: recBill.id,
      description: 'Item da Fatura',
      amount: 50,
      transaction_date: '2026-05-01',
      due_date: '2026-05-20',
      type: 'expense',
      status: 'pending',
    });

    // Paga a fatura integralmente (R$ 250)
    const billPay = await repo.savePayment({
      workspace_id: 'ws-personal',
      credit_card_bill_id: recBill.id,
      account_id: acc1.id,
      amount: 250,
      payment_date: '2026-05-20',
      affects_balance: true,
    });

    let reloadedTx = (await repo.getTransactions('ws-personal')).find((t) => t.id === cardTx.id);
    let reloadedInst = (await repo.getInstallments(recPurchase.id)).find((i) => i.id === recInsts[0].id);
    expect(reloadedTx?.status).toBe('paid');
    expect(reloadedInst?.status).toBe('paid');

    // Reduz pagamento para R$ 100 via savePayment: fatura vira partially_paid e reabre itens
    await repo.savePayment({
      ...billPay,
      amount: 100,
    });
    reloadedTx = (await repo.getTransactions('ws-personal')).find((t) => t.id === cardTx.id);
    reloadedInst = (await repo.getInstallments(recPurchase.id)).find((i) => i.id === recInsts[0].id);
    expect(reloadedTx?.status).toBe('pending');
    expect(reloadedInst?.status).toBe('pending');

    // Restaura pagamento completo
    await repo.savePayment({
      ...billPay,
      amount: 250,
    });
    reloadedTx = (await repo.getTransactions('ws-personal')).find((t) => t.id === cardTx.id);
    expect(reloadedTx?.status).toBe('paid');

    // Exclui pagamento: reabre fatura e seus itens
    await repo.deletePayment(billPay.id);
    reloadedTx = (await repo.getTransactions('ws-personal')).find((t) => t.id === cardTx.id);
    reloadedInst = (await repo.getInstallments(recPurchase.id)).find((i) => i.id === recInsts[0].id);
    expect(reloadedTx?.status).toBe('pending');
    expect(reloadedInst?.status).toBe('pending');

    // 14. Compra com parcela parcialmente paga conserva a soma das parcelas = total_amount ao redistribuir
    const partialPurchase = await repo.savePurchase({
      workspace_id: 'ws-personal',
      description: 'Compra com Parcial',
      total_amount: 400,
      installment_count: 2,
      purchase_date: '2026-10-01',
    });
    let partInsts = await repo.getInstallments(partialPurchase.id);
    expect(partInsts.length).toBe(2);
    expect(partInsts[0].amount).toBe(200);
    expect(partInsts[1].amount).toBe(200);

    // Paga R$ 50 na primeira parcela
    const partialPay = await repo.savePayment({
      workspace_id: 'ws-personal',
      installment_id: partInsts[0].id,
      amount: 50,
      payment_date: '2026-10-02',
    });
    partInsts = await repo.getInstallments(partialPurchase.id);
    expect(partInsts[0].status).toBe('partially_paid');
    expect(partInsts[0].paid_amount).toBe(50);

    // Atualiza o total da compra de 400 para 500: parcelas devem virar 250 + 250 = 500
    await repo.savePurchase({
      ...partialPurchase,
      total_amount: 500,
    });
    partInsts = await repo.getInstallments(partialPurchase.id);
    expect(partInsts[0].amount).toBe(250);
    expect(partInsts[0].paid_amount).toBe(50);
    expect(partInsts[0].status).toBe('partially_paid');
    expect(partInsts[1].amount).toBe(250);
    expect(partInsts[1].paid_amount).toBe(0);
    expect(partInsts[1].status).toBe('pending');
    expect(partInsts[0].amount + partInsts[1].amount).toBe(500);

    await repo.deletePayment(partialPay.id);

    // 15. Alterar tipo de transação com pagamentos reconcilia o saldo da conta
    const typeChangeAcc = await repo.saveAccount({
      workspace_id: 'ws-personal',
      name: 'Conta Tipo Change',
      institution: 'Bank',
      type: 'checking',
      current_balance: 1000,
      initial_balance: 1000,
      color: '#10b981',
      active: true,
    });

    const typeChangeTx = await repo.saveTransaction({
      workspace_id: 'ws-personal',
      description: 'Transação Mudar Tipo',
      amount: 100,
      transaction_date: '2026-10-01',
      due_date: '2026-10-01',
      type: 'expense',
      status: 'pending',
    });
    const typeChangePay = await repo.savePayment({
      workspace_id: 'ws-personal',
      transaction_id: typeChangeTx.id,
      account_id: typeChangeAcc.id,
      amount: 100,
      payment_date: '2026-10-01',
      affects_balance: true,
    });
    let curBal = (await repo.getAccounts('ws-personal')).find((a) => a.id === typeChangeAcc.id)?.current_balance;
    expect(curBal).toBe(900); // 1000 - 100

    // Altera tipo de expense para income: deve estornar débito (-100) e aplicar crédito (+100) => +200
    await repo.saveTransaction({
      ...typeChangeTx,
      type: 'income',
    });
    curBal = (await repo.getAccounts('ws-personal')).find((a) => a.id === typeChangeAcc.id)?.current_balance;
    expect(curBal).toBe(1100); // 900 + 200

    // Altera de volta para expense: deve estornar crédito e aplicar débito => -200
    await repo.saveTransaction({
      ...typeChangeTx,
      type: 'expense',
    });
    curBal = (await repo.getAccounts('ws-personal')).find((a) => a.id === typeChangeAcc.id)?.current_balance;
    expect(curBal).toBe(900); // 1100 - 200

    // Estorna pagamento: retorna ao saldo inicial
    await repo.deletePayment(typeChangePay.id);
    curBal = (await repo.getAccounts('ws-personal')).find((a) => a.id === typeChangeAcc.id)?.current_balance;
    expect(curBal).toBe(1000);

    // 16. Rejeita alterar total de compra quando todas as parcelas já foram quitadas
    const allPaidPur = await repo.savePurchase({
      workspace_id: 'ws-personal',
      description: 'Compra Todas Pagas',
      total_amount: 100,
      installment_count: 1,
      purchase_date: '2026-10-01',
    });
    const allPaidInst = (await repo.getInstallments(allPaidPur.id))[0];
    allPaidInst.status = 'paid';
    allPaidInst.paid_amount = 100;
    seedInstallment(storage, allPaidInst);

    await expect(
      repo.savePurchase({
        ...allPaidPur,
        total_amount: 150,
      })
    ).rejects.toThrow('Todas as parcelas desta compra já foram quitadas e seu valor não pode ser alterado');

    // 17. Rejeita novo valor de parcela menor que o valor já pago nela
    const highPaidPur = await repo.savePurchase({
      workspace_id: 'ws-personal',
      description: 'Compra Alta Parcela',
      total_amount: 400,
      installment_count: 2,
      purchase_date: '2026-10-01',
    });
    const highPaidInsts = await repo.getInstallments(highPaidPur.id);
    highPaidInsts[0].paid_amount = 180;
    seedInstallment(storage, highPaidInsts[0]);

    // Reduz total para 200: cada parcela seria 100, mas a primeira tem 180 pagos => lança erro
    await expect(
      repo.savePurchase({
        ...highPaidPur,
        total_amount: 200,
      })
    ).rejects.toThrow('não pode ser menor do que o valor já pago nela');

    // 18. Rejeita redução de compra que deixe total_amount de fatura vinculada abaixo de paid_amount
    const billLimitCard = await repo.saveCreditCard({
      workspace_id: 'ws-personal',
      name: 'Cartão Limite Fatura Local',
      institution: 'Bank',
      credit_limit: 5000,
      closing_day: 15,
      due_day: 25,
      color: '#3b82f6',
      active: true,
    });
    const limitBill = seedBill(storage, {
      workspace_id: 'ws-personal',
      credit_card_id: billLimitCard.id,
      reference_month: '2026-10',
      closing_date: '2026-10-15',
      due_date: '2026-10-25',
      total_amount: 150,
      paid_amount: 0,
      status: 'open',
    });
    const billLimitPur = await repo.savePurchase({
      workspace_id: 'ws-personal',
      description: 'Compra Fatura Limite',
      total_amount: 150,
      installment_count: 1,
      purchase_date: '2026-10-01',
      credit_card_id: billLimitCard.id,
    });
    const limitInst = (await repo.getInstallments(billLimitPur.id))[0];
    limitInst.credit_card_bill_id = limitBill.id;
    seedInstallment(storage, limitInst);

    const limitPay = await repo.savePayment({
      workspace_id: 'ws-personal',
      credit_card_bill_id: limitBill.id,
      amount: 100,
      payment_date: '2026-10-02',
    });
    await expect(
      repo.savePurchase({
        ...billLimitPur,
        total_amount: 20,
      })
    ).rejects.toThrow('inferior ao valor já pago nela');
    await repo.deletePayment(limitPay.id);

    // 19. Quita e sincroniza fatura e parcelas quando redução do total iguala exatamente o paid_amount existente
    const eqBill = seedBill(storage, {
      workspace_id: 'ws-personal',
      credit_card_id: billLimitCard.id,
      reference_month: '2026-11',
      closing_date: '2026-11-15',
      due_date: '2026-11-25',
      total_amount: 150,
      paid_amount: 0,
      status: 'open',
    });
    const eqPur = await repo.savePurchase({
      workspace_id: 'ws-personal',
      description: 'Compra Fatura Igualdade',
      total_amount: 150,
      installment_count: 1,
      purchase_date: '2026-11-01',
      credit_card_id: billLimitCard.id,
    });
    const eqInst = (await repo.getInstallments(eqPur.id))[0];
    eqInst.credit_card_bill_id = eqBill.id;
    seedInstallment(storage, eqInst);

    // Adiciona uma segunda compra/parcela na mesma fatura para validar sincronização de otherInst
    const otherPur = await repo.savePurchase({
      workspace_id: 'ws-personal',
      description: 'Compra Paralela Mesma Fatura',
      total_amount: 10,
      installment_count: 1,
      purchase_date: '2026-11-01',
      credit_card_id: billLimitCard.id,
    });
    const otherInst = (await repo.getInstallments(otherPur.id))[0];
    otherInst.credit_card_bill_id = eqBill.id;
    seedInstallment(storage, otherInst);

    // Adiciona uma transação vinculada à fatura para cobrir a sincronização de transações
    await repo.saveTransaction({
      workspace_id: 'ws-personal',
      description: 'Despesa Avulsa Fatura',
      amount: 0,
      type: 'expense',
      transaction_date: '2026-11-01',
      due_date: '2026-11-25',
      credit_card_id: billLimitCard.id,
      credit_card_bill_id: eqBill.id,
      status: 'pending',
    });

    const eqPay = await repo.savePayment({
      workspace_id: 'ws-personal',
      credit_card_bill_id: eqBill.id,
      amount: 100,
      payment_date: '2026-11-02',
    });

    // Reduz compra para R$ 100: fatura deve ficar paid, parcela e transação quitadas
    await repo.savePurchase({
      ...eqPur,
      total_amount: 100,
    });

    const billsAfterEq = await repo.getCreditCardBills(billLimitCard.id);
    const updatedEqBill = billsAfterEq.find((b) => b.id === eqBill.id)!;
    expect(updatedEqBill.total_amount).toBe(100);
    expect(updatedEqBill.paid_amount).toBe(100);
    expect(updatedEqBill.status).toBe('paid');

    const instsAfterEq = await repo.getInstallments(eqPur.id);
    const updatedEqInst = instsAfterEq.find((i) => i.id === eqInst.id)!;
    expect(updatedEqInst.amount).toBe(100);
    expect(updatedEqInst.paid_amount).toBe(100);
    expect(updatedEqInst.status).toBe('paid');

    const txsAfterEq = await repo.getTransactions('ws-personal');
    const updatedEqTx = txsAfterEq.find((t) => t.credit_card_bill_id === eqBill.id)!;
    expect(updatedEqTx.status).toBe('paid');

    const otherInstsAfterEq = await repo.getInstallments(otherPur.id);
    expect(otherInstsAfterEq[0].status).toBe('paid');

    await repo.deletePayment(eqPay.id);

    // 20. Reversão de saldo bancário e exclusão de transações (despesa e receita) com pagamentos
    const delAcc = await repo.saveAccount({
      workspace_id: 'ws-personal',
      name: 'Conta Exclusão Local',
      institution: 'Banco Teste',
      type: 'checking',
      initial_balance: 500,
      current_balance: 500,
      color: '#10b981',
      active: true,
    });

    // Despesa
    const expTx = await repo.saveTransaction({
      workspace_id: 'ws-personal',
      description: 'Despesa a excluir',
      amount: 50,
      type: 'expense',
      transaction_date: '2026-11-01',
      due_date: '2026-11-10',
      account_id: delAcc.id,
      status: 'pending',
    });
    await repo.savePayment({
      workspace_id: 'ws-personal',
      transaction_id: expTx.id,
      account_id: delAcc.id,
      amount: 50,
      payment_date: '2026-11-01',
      affects_balance: true,
    });
    let accsNow = await repo.getAccounts('ws-personal');
    expect(accsNow.find((a) => a.id === delAcc.id)?.current_balance).toBe(450);

    await repo.deleteTransaction(expTx.id);
    accsNow = await repo.getAccounts('ws-personal');
    expect(accsNow.find((a) => a.id === delAcc.id)?.current_balance).toBe(500);

    // Receita
    const incTx = await repo.saveTransaction({
      workspace_id: 'ws-personal',
      description: 'Receita a excluir',
      amount: 100,
      type: 'income',
      transaction_date: '2026-11-01',
      due_date: '2026-11-10',
      account_id: delAcc.id,
      status: 'pending',
    });
    await repo.savePayment({
      workspace_id: 'ws-personal',
      transaction_id: incTx.id,
      account_id: delAcc.id,
      amount: 100,
      payment_date: '2026-11-01',
      affects_balance: true,
    });
    accsNow = await repo.getAccounts('ws-personal');
    expect(accsNow.find((a) => a.id === delAcc.id)?.current_balance).toBe(600);

    await repo.deleteTransaction(incTx.id);
    accsNow = await repo.getAccounts('ws-personal');
    expect(accsNow.find((a) => a.id === delAcc.id)?.current_balance).toBe(500);

    // 21. Reversão de saldo e exclusão de compra com parcelas pagas diretamente
    const delPur = await repo.savePurchase({
      workspace_id: 'ws-personal',
      description: 'Compra Carnê a Excluir',
      total_amount: 200,
      installment_count: 2,
      purchase_date: '2026-11-01',
      account_id: delAcc.id,
    });
    const delInsts = await repo.getInstallments(delPur.id);
    await repo.savePayment({
      workspace_id: 'ws-personal',
      installment_id: delInsts[0].id,
      account_id: delAcc.id,
      amount: 100,
      payment_date: '2026-11-01',
      affects_balance: true,
    });
    accsNow = await repo.getAccounts('ws-personal');
    expect(accsNow.find((a) => a.id === delAcc.id)?.current_balance).toBe(400);

    await repo.deletePurchase(delPur.id);
    accsNow = await repo.getAccounts('ws-personal');
    expect(accsNow.find((a) => a.id === delAcc.id)?.current_balance).toBe(500);
    expect((await repo.getInstallments(delPur.id)).length).toBe(0);

    // 22. Rejeição e reconciliação de fatura ao excluir compra em cartão
    const delBill = seedBill(storage, {
      workspace_id: 'ws-personal',
      credit_card_id: billLimitCard.id,
      reference_month: '2026-12',
      closing_date: '2026-12-15',
      due_date: '2026-12-25',
      total_amount: 200,
      paid_amount: 150,
      status: 'partially_paid',
    });
    const cardPurA = await repo.savePurchase({
      workspace_id: 'ws-personal',
      description: 'Compra A Fatura',
      total_amount: 100,
      installment_count: 1,
      purchase_date: '2026-12-01',
      credit_card_id: billLimitCard.id,
    });
    const cardInstA = (await repo.getInstallments(cardPurA.id))[0];
    cardInstA.credit_card_bill_id = delBill.id;
    seedInstallment(storage, cardInstA);

    const cardPurB = await repo.savePurchase({
      workspace_id: 'ws-personal',
      description: 'Compra B Fatura',
      total_amount: 100,
      installment_count: 1,
      purchase_date: '2026-12-01',
      credit_card_id: billLimitCard.id,
    });
    const cardInstB = (await repo.getInstallments(cardPurB.id))[0];
    cardInstB.credit_card_bill_id = delBill.id;
    seedInstallment(storage, cardInstB);

    // Adiciona transação avulsa na fatura para exercitar a sincronização de billTx
    await repo.saveTransaction({
      workspace_id: 'ws-personal',
      description: 'Transação Avulsa Fatura Compra',
      amount: 0,
      type: 'expense',
      transaction_date: '2026-12-01',
      due_date: '2026-12-25',
      credit_card_id: billLimitCard.id,
      credit_card_bill_id: delBill.id,
      status: 'pending',
    });

    // Excluir cardPurA reduziria o total da fatura para 100, mas paid_amount é 150 -> REJEITA
    await expect(repo.deletePurchase(cardPurA.id)).rejects.toThrow('inferior ao valor já pago nela');

    // Se ajustar o paid_amount para 100 e excluir cardPurA, total cai para 100 = paid_amount -> fatura quitada
    delBill.paid_amount = 100;
    delBill.total_amount = 200;
    seedBill(storage, delBill);

    await repo.deletePurchase(cardPurA.id);
    const updatedDelBill = (await repo.getCreditCardBills(billLimitCard.id)).find((b) => b.id === delBill.id)!;
    expect(updatedDelBill.total_amount).toBe(100);
    expect(updatedDelBill.paid_amount).toBe(100);
    expect(updatedDelBill.status).toBe('paid');

    const remainingInsts = await repo.getInstallments(cardPurB.id);
    expect(remainingInsts[0].status).toBe('paid');

    // 23. Rejeição e reconciliação de fatura ao excluir transação vinculada a cartão de crédito
    const txBill = seedBill(storage, {
      workspace_id: 'ws-personal',
      credit_card_id: billLimitCard.id,
      reference_month: '2027-01',
      closing_date: '2027-01-15',
      due_date: '2027-01-25',
      total_amount: 150,
      paid_amount: 120,
      status: 'partially_paid',
    });
    const cardTxA = await repo.saveTransaction({
      workspace_id: 'ws-personal',
      description: 'Transação Cartão A',
      amount: 50,
      type: 'expense',
      transaction_date: '2027-01-05',
      due_date: '2027-01-25',
      credit_card_id: billLimitCard.id,
      credit_card_bill_id: txBill.id,
      status: 'pending',
    });
    const cardTxB = await repo.saveTransaction({
      workspace_id: 'ws-personal',
      description: 'Transação Cartão B',
      amount: 100,
      type: 'expense',
      transaction_date: '2027-01-05',
      due_date: '2027-01-25',
      credit_card_id: billLimitCard.id,
      credit_card_bill_id: txBill.id,
      status: 'pending',
    });
    const txBillPur = await repo.savePurchase({
      workspace_id: 'ws-personal',
      description: 'Compra Fatura Tx',
      total_amount: 10,
      installment_count: 1,
      purchase_date: '2027-01-01',
      credit_card_id: billLimitCard.id,
    });
    const txBillInst = (await repo.getInstallments(txBillPur.id))[0];
    txBillInst.credit_card_bill_id = txBill.id;
    seedInstallment(storage, txBillInst);

    // Excluir cardTxA (50) reduziria o total da fatura para 100, mas paid_amount é 120 -> REJEITA
    await expect(repo.deleteTransaction(cardTxA.id)).rejects.toThrow('inferior ao valor já pago nela');

    // Ajusta paid_amount para 100 e exclui cardTxA: total da fatura vai para 100 = paid_amount -> fatura e cardTxB quitados
    txBill.paid_amount = 100;
    txBill.total_amount = 150;
    seedBill(storage, txBill);

    await repo.deleteTransaction(cardTxA.id);
    const updatedTxBill = (await repo.getCreditCardBills(billLimitCard.id)).find((b) => b.id === txBill.id)!;
    expect(updatedTxBill.total_amount).toBe(100);
    expect(updatedTxBill.paid_amount).toBe(100);
    expect(updatedTxBill.status).toBe('paid');

    const updatedCardTxB = (await repo.getTransactions('ws-personal')).find((t) => t.id === cardTxB.id)!;
    expect(updatedCardTxB.status).toBe('paid');

    const updatedTxBillInst = (await repo.getInstallments(txBillPur.id))[0];
    expect(updatedTxBillInst.status).toBe('paid');

    // 24. Cobertura de exclusão de transação e compra em faturas abertas (open) e parcialmente pagas (partially_paid)
    const openBill = seedBill(storage, {
      workspace_id: 'ws-personal',
      credit_card_id: billLimitCard.id,
      reference_month: '2027-02',
      closing_date: '2027-02-15',
      due_date: '2027-02-25',
      total_amount: 100,
      paid_amount: 0,
      status: 'open',
    });
    const openPur = await repo.savePurchase({
      workspace_id: 'ws-personal',
      description: 'Compra Aberta',
      total_amount: 50,
      installment_count: 1,
      purchase_date: '2027-02-01',
      credit_card_id: billLimitCard.id,
    });
    const openInst = (await repo.getInstallments(openPur.id))[0];
    openInst.credit_card_bill_id = openBill.id;
    seedInstallment(storage, openInst);
    await repo.deletePurchase(openPur.id);
    const updatedOpenBill = (await repo.getCreditCardBills(billLimitCard.id)).find((b) => b.id === openBill.id)!;
    expect(updatedOpenBill.status).toBe('open');

    const openTx = await repo.saveTransaction({
      workspace_id: 'ws-personal',
      description: 'Transação Aberta',
      amount: 40,
      type: 'expense',
      transaction_date: '2027-02-05',
      due_date: '2027-02-25',
      credit_card_id: billLimitCard.id,
      credit_card_bill_id: openBill.id,
      status: 'pending',
    });
    await repo.deleteTransaction(openTx.id);
    const updatedOpenBillTx = (await repo.getCreditCardBills(billLimitCard.id)).find((b) => b.id === openBill.id)!;
    expect(updatedOpenBillTx.status).toBe('open');

    const partBill = seedBill(storage, {
      workspace_id: 'ws-personal',
      credit_card_id: billLimitCard.id,
      reference_month: '2027-03',
      closing_date: '2027-03-15',
      due_date: '2027-03-25',
      total_amount: 200,
      paid_amount: 50,
      status: 'partially_paid',
    });
    const partTx = await repo.saveTransaction({
      workspace_id: 'ws-personal',
      description: 'Transação Parcial',
      amount: 30,
      type: 'expense',
      transaction_date: '2027-03-05',
      due_date: '2027-03-25',
      credit_card_id: billLimitCard.id,
      credit_card_bill_id: partBill.id,
      status: 'pending',
    });
    await repo.deleteTransaction(partTx.id);
    const updatedPartBill = (await repo.getCreditCardBills(billLimitCard.id)).find((b) => b.id === partBill.id)!;
    expect(updatedPartBill.status).toBe('partially_paid');

    const partPur = await repo.savePurchase({
      workspace_id: 'ws-personal',
      description: 'Compra Parcial',
      total_amount: 30,
      installment_count: 1,
      purchase_date: '2027-03-01',
      credit_card_id: billLimitCard.id,
    });
    const partInst = (await repo.getInstallments(partPur.id))[0];
    partInst.credit_card_bill_id = partBill.id;
    seedInstallment(storage, partInst);
    await repo.deletePurchase(partPur.id);
    const updatedPartBillPur = (await repo.getCreditCardBills(billLimitCard.id)).find((b) => b.id === partBill.id)!;
    expect(updatedPartBillPur.status).toBe('partially_paid');

    // 25. Exclusão de transação e compra com referências órfãs ou pagamentos sem conta associada
    const orphanTx = await repo.saveTransaction({
      workspace_id: 'ws-personal',
      description: 'Tx com fatura inexistente',
      amount: 40,
      type: 'expense',
      transaction_date: '2027-04-01',
      due_date: '2027-04-10',
      credit_card_bill_id: 'non-existent-bill-id',
      status: 'pending',
    });
    await repo.savePayment({
      workspace_id: 'ws-personal',
      transaction_id: orphanTx.id,
      account_id: 'non-existent-acc-id',
      amount: 20,
      payment_date: '2027-04-02',
      affects_balance: true,
    });
    await repo.deleteTransaction(orphanTx.id);

    const orphanPur = await repo.savePurchase({
      workspace_id: 'ws-personal',
      description: 'Compra com fatura inexistente',
      total_amount: 50,
      installment_count: 1,
      purchase_date: '2027-04-01',
    });
    const orphanInst = (await repo.getInstallments(orphanPur.id))[0];
    orphanInst.credit_card_bill_id = 'non-existent-bill-id';
    seedInstallment(storage, orphanInst);
    await repo.savePayment({
      workspace_id: 'ws-personal',
      installment_id: orphanInst.id,
      account_id: 'non-existent-acc-id',
      amount: 25,
      payment_date: '2027-04-02',
      affects_balance: true,
    });
    await repo.deletePurchase(orphanPur.id);
  });
});



