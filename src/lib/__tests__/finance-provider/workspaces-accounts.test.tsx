import { describe, it, expect, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useFinance, FinanceProvider } from '../../context/finance-context';
import * as financeStorage from '../../context/finance-storage';
import { setupFinanceHarness } from '../test-utils/finance-provider-harness';
import {
  resolveOrCreateCreditCardBill,
  reconcileBillAfterItemDeletion,
  validateCreditCardBillIntegrity,
  toCents,
  fromCents,
  roundCurrency,
  compareCurrency,
  calculateDashboardSummary,
  calculateFutureCommitments,
} from '../../financial-engine';
import { CreditCardBill, Transaction, Settlement } from '../../types';

describe('FinanceProvider - Workspaces e Contas', () => {
  const { storageMap, mountProvider } = setupFinanceHarness();

  it('deve proteger campos imutaveis (workspace_id, id, created_at) via APIs reais do FinanceProvider (P2-02)', async () => {
    storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));

    const { getCtx } = await mountProvider();
    expect(getCtx().isLoaded).toBe(true);

    const acc = getCtx().accounts[0];
    expect(acc).toBeDefined();
    const originalAccId = acc.id;
    const originalWsId = acc.workspace_id;
    const originalCreatedAt = acc.created_at;

    await act(async () => {
      getCtx().updateAccount(originalAccId, {
        name: 'Nome Atualizado Pelo Provider',
        // Injetando campos que devem ser ignorados/protegidos
        ...({ workspace_id: 'ws-hacked', id: 'acc-hacked', created_at: '2099-01-01' } as any),
      });
    });

    const updatedAcc = getCtx().accounts.find((a) => a.id === originalAccId);
    expect(updatedAcc).toBeDefined();
    expect(updatedAcc?.name).toBe('Nome Atualizado Pelo Provider');
    expect(updatedAcc?.id).toBe(originalAccId);
    expect(updatedAcc?.workspace_id).toBe(originalWsId);
    expect(updatedAcc?.created_at).toBe(originalCreatedAt);
  });

    it('deve rejeitar transferência após inativar conta no mesmo lote (P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const bal1Before = getCtx().accounts.find((a) => a.id === 'acc-1')!.current_balance;
      const bal2Before = getCtx().accounts.find((a) => a.id === 'acc-2')!.current_balance;

      await act(async () => {
        getCtx().updateAccount('acc-1', { active: false });
        expect(() => {
          getCtx().createTransfer('acc-1', 'acc-2', 10.10);
        }).toThrow(/está inativa/i);
      });

      expect(getCtx().allWorkspaceAccounts.find((a) => a.id === 'acc-1')!.current_balance).toBe(bal1Before);
      expect(getCtx().allWorkspaceAccounts.find((a) => a.id === 'acc-2')!.current_balance).toBe(bal2Before);
    });

    it('deve executar soft-delete ao excluir conta de origem de transferência criada no mesmo lote (P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      let deleteResult: any;
      await act(async () => {
        getCtx().createTransfer('acc-1', 'acc-2', 10.10);
        deleteResult = getCtx().deleteAccount('acc-1');
      });

      expect(deleteResult.action).toBe('inactivated');
      const acc1 = getCtx().allWorkspaceAccounts.find((a) => a.id === 'acc-1')!;
      expect(acc1).toBeDefined();
      expect(acc1.active).toBe(false);
    });

    it('deve permitir usar conta imediatamente após criá-la no mesmo lote (P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      let newAcc: any;
      let tx: any;
      await act(async () => {
        newAcc = getCtx().addAccount({
          name: 'Nova Conta Imediata',
          type: 'checking',
          institution: 'Nubank',
          initial_balance: 500.0,
          current_balance: 500.0,
          color: '#3b82f6',
          active: true,
        });

        tx = getCtx().addTransaction({
          type: 'expense',
          amount: 50.0,
          description: 'Despesa em Nova Conta',
          category_id: 'cat-1',
          account_id: newAcc.id,
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
      });

      expect(tx).toBeDefined();
      expect(tx.account_id).toBe(newAcc.id);
      expect(getCtx().transactions.find((t) => t.id === tx.id)).toBeDefined();
    });

    it('deve permitir usar método de pagamento recém-criado no mesmo lote (P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const catId = getCtx().categories[0]?.id || 'cat-1';
      let pm: any;
      let tx: any;

      await act(async () => {
        pm = getCtx().addPaymentMethod({
          name: 'Pix Banco Inter Lote',
          type: 'pix',
          linked_account_id: 'acc-1',
          active: true,
        });

        tx = getCtx().addTransaction({
          description: 'Compra Método Novo Lote',
          amount: 10.10,
          type: 'expense',
          category_id: catId,
          payment_method_id: pm.id,
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
      });

      expect(tx).toBeDefined();
      expect(tx.payment_method_id).toBe(pm.id);
      expect(tx.account_id).toBe('acc-1');
      expect(getCtx().transactions.find((t) => t.id === tx.id)).toBeDefined();
    });

    it('deve permitir usar categoria recém-criada no mesmo lote (P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      let cat: any;
      let tx: any;

      await act(async () => {
        cat = getCtx().addCategory({
          name: 'Tecnologia e IA Lote',
          type: 'expense',
          color: '#8b5cf6',
          icon: 'Cpu',
          active: true,
        });

        tx = getCtx().addTransaction({
          description: 'Assinatura Software IA Lote',
          amount: 30.0,
          type: 'expense',
          category_id: cat.id,
          account_id: 'acc-1',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
      });

      expect(tx).toBeDefined();
      expect(tx.category_id).toBe(cat.id);
      expect(getCtx().transactions.find((t) => t.id === tx.id)).toBeDefined();
    });

    it('deve rejeitar transação vinculada a categoria inativada no mesmo lote (P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const catId = getCtx().categories[0]?.id || 'cat-1';

      await act(async () => {
        getCtx().updateCategory(catId, { active: false });
        expect(() => {
          getCtx().addTransaction({
            description: 'Transação Categoria Inativa Lote',
            amount: 40.0,
            type: 'expense',
            category_id: catId,
            account_id: 'acc-1',
            transaction_date: '2026-08-01',
            due_date: '2026-08-01',
            status: 'pending',
          });
        }).toThrow(/está inativa/i);
      });

      expect(getCtx().transactions.find((t) => t.description === 'Transação Categoria Inativa Lote')).toBeUndefined();
    });

    it('deve manter coerência nos controles de cartões, métodos e categorias com renderização intermediária', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const catId = getCtx().categories[0]?.id || 'cat-1';

      // 1. Controle de Cartão Inativo
      await act(async () => {
        getCtx().updateCreditCard('card-1', { active: false });
      });

      await act(async () => {
        expect(() => {
          getCtx().addTransaction({
            description: 'Compra Cartão Inativo Controle',
            amount: 50.0,
            type: 'expense',
            category_id: catId,
            credit_card_id: 'card-1',
            transaction_date: '2026-08-01',
            due_date: '2026-08-12',
            status: 'pending',
          });
        }).toThrow(/está inativo/i);
      });

      // 2. Controle de Categoria Inativa
      await act(async () => {
        getCtx().updateCategory(catId, { active: false });
      });

      await act(async () => {
        expect(() => {
          getCtx().addTransaction({
            description: 'Transação Categoria Inativa Controle',
            amount: 40.0,
            type: 'expense',
            category_id: catId,
            account_id: 'acc-1',
            transaction_date: '2026-08-01',
            due_date: '2026-08-01',
            status: 'pending',
          });
        }).toThrow(/está inativa/i);
      });

      // 3. Controle de Método Novo
      let pm: any;
      await act(async () => {
        pm = getCtx().addPaymentMethod({
          name: 'Pix Banco Inter Controle',
          type: 'pix',
          linked_account_id: 'acc-1',
          active: true,
        });
      });

      let tx: any;
      await act(async () => {
        tx = getCtx().addTransaction({
          description: 'Compra Método Novo Controle',
          amount: 15.0,
          type: 'expense',
          payment_method_id: pm.id,
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
      });

      expect(tx).toBeDefined();
      expect(tx.payment_method_id).toBe(pm.id);
      expect(tx.account_id).toBe('acc-1');
    });

    it('deve associar conta ao novo workspace mesmo quando createWorkspace e addAccount são chamados no mesmo lote act', async () => {
      const { getCtx } = await mountProvider();

      let createdWs: any;
      let createdAcc: any;

      await act(async () => {
        createdWs = getCtx().createWorkspace('Workspace Startup V36');
        createdAcc = getCtx().addAccount({
          name: 'Conta PJ Startup',
          type: 'checking',
          institution: 'Banco do Brasil',
          initial_balance: 5000,
          current_balance: 5000,
          color: '#0066cc',
          active: true,
        });
      });

      expect(createdWs).toBeDefined();
      expect(createdAcc).toBeDefined();
      expect(createdAcc.workspace_id).toBe(createdWs.id);
    });

    it('deve associar membro e categoria ao workspace correto quando setActiveWorkspaceId é chamado no mesmo lote act', async () => {
      const { getCtx } = await mountProvider();

      let targetWs: any;
      await act(async () => {
        targetWs = getCtx().createWorkspace('Workspace Filial V36');
      });

      let createdCat: any;
      await act(async () => {
        // Altera workspace ativo e adiciona membro e categoria na mesma chamada/lote
        getCtx().setActiveWorkspaceId(targetWs.id);
        getCtx().addWorkspaceMember('gerente@filial.com', 'admin');
        createdCat = getCtx().addCategory({
          name: 'Despesas Operacionais Filial',
          type: 'expense',
          color: '#ff9900',
          icon: 'Briefcase',
          active: true,
        });
      });

      expect(createdCat.workspace_id).toBe(targetWs.id);
      const members = getCtx().workspaceMembers.filter((m) => m.workspace_id === targetWs.id);
      expect(members.some((m) => m.user?.email === 'gerente@filial.com')).toBe(true);
    });

    it('deve suportar tracking_mode expense_tracker: updateWorkspace, pagamentos sem conta bancária e sem mutação de saldo', async () => {
      const { getCtx } = await mountProvider();

      let ws: any;
      await act(async () => {
        ws = getCtx().createWorkspace('Controle Despesas Sem Saldo', 'expense_tracker');
      });

      expect(ws.tracking_mode).toBe('expense_tracker');

      await act(async () => {
        getCtx().setActiveWorkspaceId(ws.id);
      });

      expect(getCtx().activeWorkspace.id).toBe(ws.id);
      expect(getCtx().activeWorkspace.tracking_mode).toBe('expense_tracker');

      // Testar updateWorkspace
      await act(async () => {
        getCtx().updateWorkspace(ws.id, { name: 'Despesas & Splits Atualizado' });
      });
      expect(getCtx().activeWorkspace.name).toBe('Despesas & Splits Atualizado');

      // Criar uma conta existente para provar que o saldo não muda
      let acc: any;
      await act(async () => {
        acc = getCtx().addAccount({
          name: 'Conta Teste Intocada',
          type: 'checking',
          institution: 'Banco X',
          initial_balance: 500,
          current_balance: 500,
          color: '#10b981',
          active: true,
        });
      });

      expect(acc.current_balance).toBe(500);

      // Adicionar transação pendente sem conta obrigatória
      let tx: any;
      await act(async () => {
        tx = getCtx().addTransaction({
          description: 'Conta de Energia',
          amount: 150,
          type: 'expense',
          status: 'pending',
          transaction_date: '2026-09-20',
          due_date: '2026-09-20',
        });
      });

      expect(tx.status).toBe('pending');
      expect(tx.paid_amount).toBe(0);

      // Quitar pagamento sem informar conta (account_id omitted/undefined)
      await act(async () => {
        getCtx().recordPayment({
          transaction_id: tx.id,
          amount: 150,
          payment_date: '2026-09-20',
        });
      });

      const updatedTx = getCtx().transactions.find((t) => t.id === tx.id);
      expect(updatedTx?.status).toBe('paid');
      expect(updatedTx?.paid_amount).toBe(150);

      // O saldo da conta criada não deve ter sido afetado
      const refreshedAcc = getCtx().accounts.find((a) => a.id === acc.id);
      expect(refreshedAcc?.current_balance).toBe(500);

      // Testar pagamento de fatura de cartão no modo expense_tracker sem exigir conta
      let card: any;
      await act(async () => {
        card = getCtx().addCreditCard({
          name: 'Cartão Despesas',
          institution: 'Nubank',
          credit_limit: 3000,
          closing_day: 10,
          due_day: 18,
          color: '#8b5cf6',
          active: true,
        });
      });

      // Adicionar despesa no cartão
      await act(async () => {
        getCtx().addTransaction({
          description: 'Supermercado',
          amount: 200,
          type: 'expense',
          credit_card_id: card.id,
          transaction_date: '2026-09-05',
          due_date: '2026-09-18',
          status: 'pending',
        });
      });

      const bill = getCtx().creditCardBills.find((b) => b.credit_card_id === card.id);
      expect(bill).toBeDefined();

      if (bill) {
        await act(async () => {
          getCtx().payCreditCardBill(bill.id, undefined, 200, '2026-09-18');
        });

        const updatedBill = getCtx().creditCardBills.find((b) => b.id === bill.id);
        expect(updatedBill?.status).toBe('paid');
      }

      // O saldo da conta bancária continua exatamente 500
      const finalAcc = getCtx().accounts.find((a) => a.id === acc.id);
      expect(finalAcc?.current_balance).toBe(500);
    });

    it('deve imunizar contra saldo artificial na alternância de modos full -> tracker -> full -> deleteTransaction (P0-02)', async () => {
      const { getCtx } = await mountProvider();

      // 1. Criar workspace full e conta com 8450.00
      let ws: any;
      await act(async () => {
        ws = getCtx().createWorkspace('Workspace Híbrido', 'full');
      });

      await act(async () => {
        getCtx().setActiveWorkspaceId(ws.id);
      });

      let acc: any;
      await act(async () => {
        acc = getCtx().addAccount({
          name: 'Conta Corrente P0-02',
          type: 'checking',
          institution: 'Banco Itaú',
          initial_balance: 8450.0,
          current_balance: 8450.0,
          color: '#3b82f6',
          active: true,
        });
      });
      expect(acc.current_balance).toBe(8450.0);

      // 2. Criar despesa pendente vinculada à conta
      let tx: any;
      await act(async () => {
        tx = getCtx().addTransaction({
          description: 'Despesa a pagar',
          amount: 10.1,
          type: 'expense',
          account_id: acc.id,
          status: 'pending',
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
        });
      });

      // 3. Trocar workspace para expense_tracker
      await act(async () => {
        getCtx().updateWorkspace(ws.id, { tracking_mode: 'expense_tracker' });
      });
      expect(getCtx().activeWorkspace.tracking_mode).toBe('expense_tracker');

      // 4. Pagar 10.10 sem account_id no tracker: saldo continua 8450.00
      await act(async () => {
        getCtx().recordPayment({
          transaction_id: tx.id,
          amount: 10.1,
          payment_date: '2026-09-18',
        });
      });

      let currentAcc = getCtx().accounts.find((a) => a.id === acc.id);
      expect(currentAcc?.current_balance).toBe(8450.0);

      // 5. Trocar novamente para full
      await act(async () => {
        getCtx().updateWorkspace(ws.id, { tracking_mode: 'full' });
      });
      expect(getCtx().activeWorkspace.tracking_mode).toBe('full');

      // 6. Excluir a transação
      await act(async () => {
        getCtx().deleteTransaction(tx.id);
      });

      // 7. Saldo DEVE permanecer exatamente em 8450.00 (sem estorno artificial!)
      const finalAcc = getCtx().accounts.find((a) => a.id === acc.id);
      expect(finalAcc?.current_balance).toBe(8450.0);
    });

    it('deve estornar débito histórico do modo full ao excluir no modo expense_tracker (Full -> Tracker -> Delete)', async () => {
      const { getCtx } = await mountProvider();

      // 1. Workspace no modo full
      let ws: any;
      await act(async () => {
        ws = getCtx().createWorkspace('Workspace Proveniência Reauditoria', 'full');
      });

      await act(async () => {
        getCtx().setActiveWorkspaceId(ws.id);
      });

      // 2. Conta com saldo inicial de 8.450,00 e categoria
      let acc: any;
      let cat: any;
      await act(async () => {
        acc = getCtx().addAccount({
          name: 'Conta Corrente Principal',
          type: 'checking',
          institution: 'Banco Itaú',
          initial_balance: 8450.0,
          current_balance: 8450.0,
          color: '#3b82f6',
          active: true,
        });
        cat = getCtx().addCategory({
          name: 'Geral',
          color: '#3b82f6',
          icon: 'tag',
          type: 'expense',
          active: true,
        });
      });

      // 3. Cria despesa de 10,10 no modo full e quita com a conta
      let tx: any;
      await act(async () => {
        tx = getCtx().addTransaction({
          description: 'Despesa Full Histórica',
          amount: 10.10,
          type: 'expense',
          category_id: cat.id,
          account_id: acc.id,
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'pending',
        });
      });

      await act(async () => {
        getCtx().recordPayment({
          transaction_id: tx.id,
          account_id: acc.id,
          amount: 10.10,
          payment_date: '2026-09-18',
        });
      });

      // Saldo após pagamento no modo full: 8.450,00 - 10,10 = 8.439,90
      expect(getCtx().accounts.find((a) => a.id === acc.id)?.current_balance).toBe(8439.9);

      // 4. Alterna workspace para expense_tracker
      await act(async () => {
        getCtx().updateWorkspace(ws.id, { tracking_mode: 'expense_tracker' });
      });
      expect(getCtx().activeWorkspace.tracking_mode).toBe('expense_tracker');

      // 5. Exclui a transação enquanto o workspace está em expense_tracker
      await act(async () => {
        getCtx().deleteTransaction(tx.id);
      });

      // 6. O saldo contábil da conta DEVE ser estornado para 8.450,00 porque o Payment teve affects_balance = true!
      const finalAcc = getCtx().accounts.find((a) => a.id === acc.id);
      expect(finalAcc?.current_balance).toBe(8450.0);
    });

    it('useFinance: deve lançar erro se invocado fora de um FinanceProvider', () => {
      let caughtError: any = null;
      function TestComponent() {
        try {
          useFinance();
        } catch (e) {
          caughtError = e;
        }
        return null;
      }
      const container = (globalThis as any).document.createElement('div');
      const root = createRoot(container);
      act(() => {
        root.render(React.createElement(TestComponent));
      });
      expect(caughtError).toBeDefined();
      expect(caughtError.message).toMatch(/useFinance deve ser usado dentro de um FinanceProvider/i);
    });

    it('deve hidratar todos os estados persistidos em localStorage no mount', async () => {
      storageMap.set('fincontrol_v2_workspaces', JSON.stringify([{ id: 'ws-hid', name: 'WS Hidratado', owner_id: 'usr-1', currency: 'BRL', tracking_mode: 'full', created_at: '2026-01-01' }]));
      storageMap.set('fincontrol_v2_active_ws', 'ws-hid');
      storageMap.set('fincontrol_v2_members', JSON.stringify([{ id: 'm-hid', workspace_id: 'ws-hid', user_id: 'usr-1', role: 'owner', created_at: '2026-01-01' }]));
      storageMap.set('fincontrol_v2_accounts', JSON.stringify([{ id: 'acc-hid', workspace_id: 'ws-hid', name: 'Conta Hidratada', type: 'checking', institution: 'Bank', initial_balance: 500, current_balance: 500, active: true, created_at: '2026-01-01' }]));
      storageMap.set('fincontrol_v2_categories', JSON.stringify([{ id: 'cat-hid', workspace_id: 'ws-hid', name: 'Cat Hidratada', icon: 'Tag', color: '#000', type: 'expense', active: true, created_at: '2026-01-01' }]));
      storageMap.set('fincontrol_v2_paymentMethods', JSON.stringify([{ id: 'pm-hid', workspace_id: 'ws-hid', name: 'PM Hid', type: 'pix', linked_account_id: 'acc-hid', active: true, created_at: '2026-01-01' }]));
      storageMap.set('fincontrol_v2_creditCards', JSON.stringify([{ id: 'cc-hid', workspace_id: 'ws-hid', name: 'Card Hid', brand: 'Visa', credit_limit: 5000, closing_day: 5, due_day: 15, active: true, created_at: '2026-01-01' }]));
      storageMap.set('fincontrol_v2_bills', JSON.stringify([{ id: 'bill-hid', workspace_id: 'ws-hid', credit_card_id: 'cc-hid', reference_month: '2026-09', closing_date: '2026-09-05', due_date: '2026-09-15', total_amount: 100, paid_amount: 0, status: 'open' }]));
      storageMap.set('fincontrol_v2_transactions', JSON.stringify([{ id: 'tx-hid', workspace_id: 'ws-hid', description: 'Tx Hid', amount: 100, type: 'expense', transaction_date: '2026-09-10', due_date: '2026-09-10', status: 'pending', created_at: '2026-09-10' }]));
      storageMap.set('fincontrol_v2_purchases', JSON.stringify([{ id: 'pur-hid', workspace_id: 'ws-hid', description: 'Pur Hid', total_amount: 200, installment_count: 2, purchase_date: '2026-09-10', created_at: '2026-09-10' }]));
      storageMap.set('fincontrol_v2_installments', JSON.stringify([{ id: 'inst-hid', workspace_id: 'ws-hid', purchase_id: 'pur-hid', installment_number: 1, total_installments: 2, amount: 100, due_date: '2026-09-15', status: 'pending', created_at: '2026-09-10' }]));
      storageMap.set('fincontrol_v2_payments', JSON.stringify([{ id: 'pay-hid', workspace_id: 'ws-hid', transaction_id: 'tx-hid', amount: 50, payment_date: '2026-09-10', created_by: 'usr-1', created_at: '2026-09-10', affects_balance: false }]));
      storageMap.set('fincontrol_v2_transfers', JSON.stringify([{ id: 'trf-hid', workspace_id: 'ws-hid', from_account_id: 'acc-hid', to_account_id: 'acc-hid-2', amount: 100, transfer_date: '2026-09-10', created_by: 'usr-1', created_at: '2026-09-10' }]));
      storageMap.set('fincontrol_v2_settlements', JSON.stringify([{ id: 'set-hid', workspace_id: 'ws-hid', from_member_id: 'm-hid', to_member_id: 'm-hid-2', amount: 50, settlement_date: '2026-09-10', created_at: '2026-09-10' }]));
      storageMap.set('fincontrol_v2_goals', JSON.stringify([{ id: 'goal-hid', workspace_id: 'ws-hid', name: 'Goal Hid', target_amount: 1000, current_amount: 200, target_date: '2026-12-31', status: 'in_progress', color: '#000', icon: 'star', created_at: '2026-01-01' }]));
      storageMap.set('fincontrol_v2_budgets', JSON.stringify([{ id: 'bud-hid', workspace_id: 'ws-hid', category_id: 'cat-hid', month: 9, year: 2026, planned_amount: 500 }]));
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));

      const { getCtx } = await mountProvider();

      expect(getCtx().activeWorkspace.id).toBe('ws-hid');
      expect(getCtx().accounts.some((a) => a.id === 'acc-hid')).toBe(true);
      expect(getCtx().categories.some((c) => c.id === 'cat-hid')).toBe(true);
      expect(getCtx().creditCards.some((c) => c.id === 'cc-hid')).toBe(true);
      expect(getCtx().purchases.some((p) => p.id === 'pur-hid')).toBe(true);
      expect(getCtx().installments.some((i) => i.id === 'inst-hid')).toBe(true);
      expect(getCtx().settlements.some((s) => s.id === 'set-hid')).toBe(true);
      expect(getCtx().transfers.some((t) => t.id === 'trf-hid')).toBe(true);
    });

    it('validação de categoria/subcategoria: rejeita categoria de outro workspace e subcategoria inativa', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();

      // Categoria inexistente ou de outro workspace
      expect(() => {
        getCtx().addTransaction({
          description: 'Teste Categoria Inválida',
          amount: 50,
          type: 'expense',
          category_id: 'cat-inexistente',
          transaction_date: '2026-09-19',
          due_date: '2026-09-19',
          status: 'pending',
        });
      }).toThrow(/Categoria informada não pertence ao workspace/i);

      // Categoria com subcategoria inativa
      await act(async () => {
        getCtx().addCategory({
          name: 'Categoria Teste Inativa',
          icon: 'tag',
          color: '#ff0000',
          type: 'expense',
          active: true,
          subcategories: [
            {
              id: 'sub-inativa-1',
              workspace_id: 'ws-1',
              parent_id: 'temp',
              name: 'Sub Inativa',
              icon: 'tag',
              color: '#ff0000',
              type: 'expense',
              active: false,
              created_at: '2026-01-01',
            },
          ],
        });
      });

      expect(() => {
        getCtx().addTransaction({
          description: 'Teste Subcategoria Inativa',
          amount: 50,
          type: 'expense',
          category_id: 'sub-inativa-1',
          transaction_date: '2026-09-19',
          due_date: '2026-09-19',
          status: 'pending',
        });
      }).toThrow(/A subcategoria informada está inativa/i);
    });

    it('hidratação resiliente: captura erro de JSON corrompido em localStorage sem quebrar', async () => {
      storageMap.set('fincontrol_v2_workspaces', '{invalid-json-string-corrompida');
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));

      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);
      expect(getCtx().workspaces.length).toBeGreaterThan(0);
    });

    it('P1-01 regressão: hidratação com recurring corrompido preserva contas válidas e não sobrescreve com mocks', async () => {
      const preservedAccount = {
        id: 'acc-preservada',
        workspace_id: 'ws-1',
        name: 'Conta Preservada',
        type: 'checking' as const,
        institution: 'Banco Teste',
        initial_balance: 123,
        current_balance: 123,
        active: true,
        created_at: '2026-01-01',
      };
      storageMap.set('fincontrol_v2_accounts', JSON.stringify([preservedAccount]));
      storageMap.set('fincontrol_v2_recurring', '{json-corrompido');

      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      // A conta persistida deve ter sido carregada no estado do Provider
      expect(getCtx().accounts.some((a) => a.id === 'acc-preservada')).toBe(true);
      expect(getCtx().accounts.find((a) => a.id === 'acc-preservada')?.current_balance).toBe(123);

      // O efeito de persistência NÃO pode sobrescrever accounts com os mocks
      const rawAccounts = storageMap.get('fincontrol_v2_accounts');
      expect(rawAccounts).toBeDefined();
      const parsedAccounts = JSON.parse(rawAccounts!);
      expect(parsedAccounts).toHaveLength(1);
      expect(parsedAccounts[0].id).toBe('acc-preservada');
    });

    it('P1-01 reauditoria: Provider montado com schema futuro (v2) opera em read-only e preserva storage byte a byte', async () => {
      const futureAccount = {
        id: 'acc-futura',
        workspace_id: 'ws-1',
        name: 'Conta Futura Teste',
        type: 'checking' as const,
        institution: 'Banco Futuro',
        color: '#ff0055',
        initial_balance: 321,
        current_balance: 321,
        active: true,
        created_at: '2026-09-19',
      };
      storageMap.set('fincontrol_v2_schema_version', '2');
      storageMap.set('fincontrol_v2_accounts', JSON.stringify([futureAccount]));

      // Tira cópia exata do estado inicial do storage para validação byte a byte
      const snapshotBefore = new Map(storageMap);

      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      // Provider deve disponibilizar a conta futura para leitura
      expect(getCtx().accounts.some((a) => a.id === 'acc-futura')).toBe(true);
      expect(getCtx().accounts.find((a) => a.id === 'acc-futura')?.current_balance).toBe(321);

      // O storage NÃO pode ser rebaixado para versão 1
      expect(storageMap.get('fincontrol_v2_schema_version')).toBe('2');

      // Todas as chaves e valores devem permanecer idênticos byte a byte
      expect(storageMap.size).toBe(snapshotBefore.size);
      for (const [key, value] of snapshotBefore.entries()) {
        expect(storageMap.get(key)).toBe(value);
      }
    });

    it('P1-01 reauditoria: rejeita mutations públicas (addAccount, addTransaction, processPendingRecurring) com erro claro em modo read-only', async () => {
      storageMap.set('fincontrol_v2_schema_version', '2');
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const accountsCountBefore = getCtx().accounts.length;
      const transactionsCountBefore = getCtx().transactions.length;

      // 1. Rejeição de addAccount
      expect(() => {
        getCtx().addAccount({
          name: 'Conta Efêmera Rejeitada',
          type: 'checking',
          institution: 'Banco Teste',
          color: '#123456',
          initial_balance: 100,
          current_balance: 100,
          active: true,
        });
      }).toThrow(/Operação bloqueada: o aplicativo está em modo somente leitura/);

      expect(getCtx().accounts.length).toBe(accountsCountBefore);

      // 2. Rejeição de addTransaction
      expect(() => {
        getCtx().addTransaction({
          description: 'Transação Efêmera Rejeitada',
          amount: 50,
          type: 'expense',
          category_id: getCtx().categories[0]?.id || 'cat-1',
          transaction_date: '2026-09-19',
          due_date: '2026-09-19',
          status: 'pending',
        });
      }).toThrow(/Operação bloqueada: o aplicativo está em modo somente leitura/);

      expect(getCtx().transactions.length).toBe(transactionsCountBefore);

      // 3. Rejeição de processPendingRecurring
      expect(() => {
        getCtx().processPendingRecurring();
      }).toThrow(/Operação bloqueada: o aplicativo está em modo somente leitura/);
    });

    it('deleteAccount: inativa conta com histórico e exclui fisicamente desvinculando de recorrências quando sem histórico restritivo', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      // 1. Cria conta nova sem histórico financeiro restritivo
      let createdAcc: any;
      await act(async () => {
        createdAcc = getCtx().addAccount({
          name: 'Conta Sem Histórico',
          type: 'checking',
          institution: 'Banco Novo',
          color: '#123456',
          initial_balance: 0,
          current_balance: 0,
          active: true,
        });
      });

      // Vincula uma recorrência a essa conta
      await act(async () => {
        getCtx().addRecurring({
          description: 'Recorrência Vinculada',
          amount: 50,
          type: 'expense',
          category_id: getCtx().categories[0]?.id || 'cat-1',
          frequency: 'monthly',
          start_date: '2026-09-01',
          next_occurrence: '2026-09-01',
          auto_create: false,
          active: true,
          account_id: createdAcc.id,
        });
      });

      expect(getCtx().recurring.some((r) => r.account_id === createdAcc.id)).toBe(true);

      // Exclusão física da conta sem histórico financeiro
      await act(async () => {
        const res = getCtx().deleteAccount(createdAcc.id);
        expect(res.action).toBe('deleted');
      });

      // A conta não deve mais existir
      expect(getCtx().accounts.some((a) => a.id === createdAcc.id)).toBe(false);
      // A recorrência deve ter sido desvinculada (account_id = undefined)
      const rec = getCtx().recurring.find((r) => r.description === 'Recorrência Vinculada');
      expect(rec?.account_id).toBeUndefined();

      // 2. Conta com histórico financeiro (acc-1 possui pagamentos/compras): deve ser apenas inativada (soft delete)
      await act(async () => {
        const res = getCtx().deleteAccount('acc-1');
        expect(res.action).toBe('inactivated');
      });

      const acc1 = getCtx().allWorkspaceAccounts.find((a) => a.id === 'acc-1');
      expect(acc1?.active).toBe(false);

      // 3. Conta inexistente deve retornar success: false
      const resInexistente = getCtx().deleteAccount('acc-inexistente');
      expect(resInexistente.success).toBe(false);
      expect(resInexistente.message).toContain('não encontrada no workspace ativo');
    });

    it('deve cobrir branches de initial_balance zerado, active false e soft/hard delete desvinculando cartões e métodos', async () => {
      const { getCtx } = await mountProvider();

      // 1. addAccount com active: false e initial_balance: 0
      let accInactive: any;
      await act(async () => {
        accInactive = getCtx().addAccount({
          name: 'Conta Inativa Direta',
          type: 'checking',
          institution: 'Banco Teste',
          initial_balance: 0,
          current_balance: 0,
          color: '#123456',
          active: false,
        });
      });
      expect(accInactive.active).toBe(false);
      expect(accInactive.current_balance).toBe(0);

      // 2. Conta com transferência como destino (to_account_id): deve acionar soft-delete
      let accToTrf: any;
      await act(async () => {
        accToTrf = getCtx().addAccount({
          name: 'Conta Destino Transferência',
          type: 'checking',
          institution: 'Banco',
          initial_balance: 100,
          current_balance: 100,
          color: '#123456',
          active: true,
        });
      });

      await act(async () => {
        getCtx().createTransfer('acc-1', accToTrf.id, 50, '2026-09-01');
      });

      await act(async () => {
        const res = getCtx().deleteAccount(accToTrf.id);
        expect(res.action).toBe('inactivated');
      });

      // 3. Hard-delete desvinculando método de pagamento e cartão
      let accToClean: any;
      await act(async () => {
        accToClean = getCtx().addAccount({
          name: 'Conta Para Limpeza Total',
          type: 'checking',
          institution: 'Banco',
          initial_balance: 50,
          current_balance: 50,
          color: '#123456',
          active: true,
        });
      });

      // Vincula um método de pagamento e um cartão de crédito a essa conta
      await act(async () => {
        getCtx().addPaymentMethod({
          name: 'Método Vinculado',
          type: 'debit_card',
          linked_account_id: accToClean.id,
          active: true,
        });
        getCtx().addCreditCard({
          name: 'Cartão com Conta Vinculada',
          institution: 'Banco',
          credit_limit: 3000,
          closing_day: 5,
          due_day: 12,
          color: '#333',
          active: true,
          linked_payment_account_id: accToClean.id,
        });
      });

      // Exclui a conta sem histórico financeiro restritivo
      await act(async () => {
        const res = getCtx().deleteAccount(accToClean.id);
        expect(res.action).toBe('deleted');
      });

      // O método de pagamento e o cartão devem ter sido desvinculados (linked_account_id = undefined)
      const pm = getCtx().paymentMethods.find((p) => p.name === 'Método Vinculado');
      expect(pm?.linked_account_id).toBeUndefined();

      const card = getCtx().creditCards.find((c) => c.name === 'Cartão com Conta Vinculada');
      expect(card?.linked_payment_account_id).toBeUndefined();

      // 4. Cadastra método de pagamento avulso sem conta bancária vinculada
      let pmUnlinked: any;
      await act(async () => {
        pmUnlinked = getCtx().addPaymentMethod({
          name: 'Dinheiro Físico',
          type: 'cash',
          active: true,
        });
      });
      expect(pmUnlinked.id).toBeDefined();
      expect(pmUnlinked.linked_account_id).toBeUndefined();
    });

    it('deve utilizar fallback de generateId quando crypto.randomUUID for indefinido (linha 55)', async () => {
      const originalRandomUUID = (globalThis as any).crypto?.randomUUID;
      if ((globalThis as any).crypto) {
        (globalThis as any).crypto.randomUUID = undefined;
      }

      const { getCtx } = await mountProvider();
      let accWithFallbackId: any;
      await act(async () => {
        accWithFallbackId = getCtx().addAccount({
          name: 'Conta Fallback ID',
          type: 'checking',
          institution: 'Banco',
          initial_balance: 100,
          current_balance: 100,
          color: '#000',
          active: true,
        });
      });

      expect(accWithFallbackId.id).toMatch(/^acc-\d+-[a-z0-9]+/);

      if ((globalThis as any).crypto) {
        (globalThis as any).crypto.randomUUID = originalRandomUUID;
      }
    });

    it('deve capturar erro inesperado no loadFinanceSnapshot durante montagem e definir isLoaded (linha 156)', async () => {
      const spyLoad = vi.spyOn(financeStorage, 'loadFinanceSnapshot').mockImplementationOnce(() => {
        throw new Error('Falha catastrófica de I/O de storage');
      });
      const spyConsole = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);
      expect(spyConsole).toHaveBeenCalledWith('Erro ao hidratar dados locais:', expect.any(Error));

      spyLoad.mockRestore();
      spyConsole.mockRestore();
    });

    it('deve cobrir fallback de activeWorkspace e processPendingRecurring antes de isLoaded (linhas 224 e 336)', async () => {
      let earlyCtx: any;
      function Probe() {
        earlyCtx = useFinance();
        return null;
      }
      const container = (globalThis as any).document.createElement('div');
      const root = createRoot(container);
      act(() => {
        root.render(
          React.createElement(FinanceProvider, null, React.createElement(Probe, null))
        );
      });
      expect(earlyCtx.isLoaded).toBe(false);
      expect(() => earlyCtx.processPendingRecurring()).not.toThrow();

      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(earlyCtx.isLoaded).toBe(true);

      await act(async () => {
        earlyCtx.setActiveWorkspaceId('ws-inexistente-fallback');
      });
      expect(earlyCtx.activeWorkspace).toBeDefined();
      expect(earlyCtx.activeWorkspace.id).toBe('ws-1');

      await act(async () => {
        root.unmount();
      });
    });
});

