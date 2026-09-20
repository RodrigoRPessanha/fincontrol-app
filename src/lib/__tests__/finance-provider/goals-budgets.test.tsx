import { describe, it, expect } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useFinance } from '../../context/finance-context';
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

describe('FinanceProvider - Metas, Orçamentos e Transferências', () => {
  const { storageMap, mountProvider } = setupFinanceHarness();

    it('deve concluir meta financeira sem falha por float drift (0.30 + 0.60 = 0.90) (V35 / P1)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));

      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const accBefore = getCtx().accounts.find((a) => a.id === 'acc-1');
      const balanceBefore = accBefore?.current_balance || 0;

      // Criar meta com target de 0.90
      let goal: any;
      await act(async () => {
        goal = getCtx().addGoal({
          name: 'Meta Teste Float',
          target_amount: 0.9,
          current_amount: 0,
          target_date: '2026-12-31',
          status: 'in_progress',
          color: '#10b981',
          icon: 'piggy-bank',
        });
      });

      // Primeiro depósito de 0.30
      await act(async () => {
        getCtx().depositGoal(goal.id, 0.3, 'acc-1');
      });
      let currentGoal = getCtx().goals.find((g) => g.id === goal.id);
      expect(currentGoal?.current_amount).toBe(0.3);
      expect(currentGoal?.status).toBe('in_progress');

      // Segundo depósito de 0.60 (0.30 + 0.60 = 0.90; em float cru seria 0.8999999999999999)
      await act(async () => {
        getCtx().depositGoal(goal.id, 0.6, 'acc-1');
      });
      currentGoal = getCtx().goals.find((g) => g.id === goal.id);
      expect(currentGoal?.current_amount).toBe(0.9);
      expect(currentGoal?.status).toBe('completed');

      // Verificar que saldo da conta debitou exatamente 0.90 em centavos
      const accAfter = getCtx().accounts.find((a) => a.id === 'acc-1');
      expect(accAfter?.current_balance).toBe(fromCents(toCents(balanceBefore) - 90));
    });

    it('deve transferir valores decimais preservando saldos em centavos exatos (V35 / P1)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));

      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const acc1Before = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      const acc2Before = getCtx().accounts.find((a) => a.id === 'acc-2')!;
      const balance1Before = acc1Before.current_balance;
      const balance2Before = acc2Before.current_balance;

      // Transferência 1: 10.15
      await act(async () => {
        getCtx().createTransfer('acc-1', 'acc-2', 10.15);
      });

      // Transferência 2: 20.25
      await act(async () => {
        getCtx().createTransfer('acc-1', 'acc-2', 20.25);
      });

      const acc1After = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      const acc2After = getCtx().accounts.find((a) => a.id === 'acc-2')!;

      // 10.15 + 20.25 = 30.40
      expect(acc1After.current_balance).toBe(fromCents(toCents(balance1Before) - 3040));
      expect(acc2After.current_balance).toBe(fromCents(toCents(balance2Before) + 3040));
    });

    it('deve normalizar agregações de Dashboard e Previsões em centavos (V35 / P2-02)', () => {
      const mockTxs: any[] = [
        {
          id: 'tx-1',
          workspace_id: 'ws-1',
          amount: 10.1,
          type: 'expense',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        },
        {
          id: 'tx-2',
          workspace_id: 'ws-1',
          amount: 20.2,
          type: 'expense',
          transaction_date: '2026-08-02',
          due_date: '2026-08-02',
          status: 'pending',
        },
      ];

      const dashboard = calculateDashboardSummary(
        mockTxs,
        [],
        [],
        [{ current_balance: 100.1 }, { current_balance: 200.2 }],
        [],
        '2026-08'
      );
      expect(dashboard.planned.expense).toBe(30.3);
      expect(dashboard.planned.net).toBe(-30.3);
      expect(dashboard.totalBalance).toBe(300.3);

      const commitments = calculateFutureCommitments([], [], mockTxs, 1, new Date(2026, 7, 1));
      expect(commitments[0].pendingTransactionsAmount).toBe(30.3);
      expect(commitments[0].totalCommitment).toBe(30.3);
      expect(commitments[0].netForecast).toBe(-30.3);
    });

    it('deve suportar chamadas agrupadas no mesmo lote (batching) em depositGoal preservando acumulador funcional (V36 / P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));

      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const accBefore = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      const balanceBefore = accBefore.current_balance;

      let goal: any;
      await act(async () => {
        goal = getCtx().addGoal({
          name: 'Meta Lote V36',
          target_amount: 0.9,
          current_amount: 0,
          target_date: '2026-12-31',
          status: 'in_progress',
          color: '#10b981',
          icon: 'target',
        });
      });

      // Duas chamadas seguidas no MESMO act/lote sem esperar renderização intermediária
      await act(async () => {
        getCtx().depositGoal(goal.id, 0.3, 'acc-1');
        getCtx().depositGoal(goal.id, 0.6, 'acc-1');
      });

      const updatedGoal = getCtx().goals.find((g) => g.id === goal.id);
      expect(updatedGoal?.current_amount).toBe(0.9);
      expect(updatedGoal?.status).toBe('completed');

      const accAfter = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      expect(accAfter.current_balance).toBe(fromCents(toCents(balanceBefore) - 90));
    });

    it('deve rejeitar transferência subcentavo (1e-7) sem zerar nem corromper contas (V36 / P0-02)', async () => {
      // Helper deve retornar 0 para representações científicas extremas em vez de NaN
      expect(toCents(1e-7)).toBe(0);
      expect(toCents(1e21)).toBe(0);
      expect(fromCents(NaN)).toBe(0);

      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const acc1Before = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      const acc2Before = getCtx().accounts.find((a) => a.id === 'acc-2')!;
      const balance1Before = acc1Before.current_balance;
      const balance2Before = acc2Before.current_balance;

      // Tentativa de transferir valor subcentavo (0.0000001 = 1e-7) deve ser rejeitada
      await act(async () => {
        expect(() => {
          getCtx().createTransfer('acc-1', 'acc-2', 0.0000001);
        }).toThrow(/pelo menos R\$ 0,01/i);
      });

      // Conservação estrita de saldos: NENHUM saldo foi zerado ou mutado
      const acc1After = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      const acc2After = getCtx().accounts.find((a) => a.id === 'acc-2')!;
      expect(acc1After.current_balance).toBe(balance1Before);
      expect(acc2After.current_balance).toBe(balance2Before);
    });

    it('deve rejeitar createTransfer e depositGoal no domínio quando em expense_tracker (P1-01)', async () => {
      const { getCtx } = await mountProvider();

      let ws: any;
      await act(async () => {
        ws = getCtx().createWorkspace('Workspace Sem Saldo P1-01', 'expense_tracker');
      });

      await act(async () => {
        getCtx().setActiveWorkspaceId(ws.id);
      });

      let acc1: any;
      let acc2: any;
      await act(async () => {
        acc1 = getCtx().addAccount({
          name: 'Conta 1',
          type: 'checking',
          institution: 'Banco A',
          initial_balance: 500,
          current_balance: 500,
          color: '#10b981',
          active: true,
        });
        acc2 = getCtx().addAccount({
          name: 'Conta 2',
          type: 'checking',
          institution: 'Banco B',
          initial_balance: 300,
          current_balance: 300,
          color: '#3b82f6',
          active: true,
        });
      });

      // createTransfer deve ser rejeitado no domínio
      expect(() => {
        getCtx().createTransfer(acc1.id, acc2.id, 100);
      }).toThrow(/Transferências entre contas não são permitidas no modo Apenas Despesas/i);

      // depositGoal deve ser rejeitado no domínio
      let goal: any;
      await act(async () => {
        goal = getCtx().addGoal({
          name: 'Meta Viagem',
          target_amount: 1000,
          current_amount: 0,
          color: '#10b981',
          icon: 'target',
          status: 'in_progress',
        });
      });

      expect(() => {
        getCtx().depositGoal(goal.id, 50, acc1.id);
      }).toThrow(/Aportes em metas financeiras não são permitidos no modo Apenas Despesas/i);

      // Nenhum saldo foi alterado
      expect(getCtx().accounts.find((a) => a.id === acc1.id)?.current_balance).toBe(500);
      expect(getCtx().accounts.find((a) => a.id === acc2.id)?.current_balance).toBe(300);
    });

    it('transferência: validação de mesma conta, valor <= 0, e rejeição de conta inativa', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();

      // Mesma conta de origem e destino
      expect(() => {
        getCtx().createTransfer('acc-1', 'acc-1', 100);
      }).toThrow(/A conta de origem e destino devem ser diferentes/i);

      // Valor zero ou negativo
      expect(() => {
        getCtx().createTransfer('acc-1', 'acc-2', 0);
      }).toThrow(/O valor da transferência deve ser de pelo menos R\$ 0,01/i);

      // Inativação de conta de destino
      await act(async () => {
        getCtx().updateAccount('acc-2', { active: false });
      });

      expect(() => {
        getCtx().createTransfer('acc-1', 'acc-2', 100);
      }).toThrow(/A conta bancária informada está inativa/i);
    });

    it('depositGoal: conclui meta e atualiza status para completed quando atinge o alvo', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();

      let newGoal: any;
      await act(async () => {
        newGoal = getCtx().addGoal({
          name: 'Notebook Novo',
          target_amount: 1000,
          current_amount: 800,
          target_date: '2026-12-31',
          status: 'in_progress',
          color: '#10b981',
          icon: 'laptop',
        });
      });

      const accBefore = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      const balBefore = accBefore.current_balance;

      // Depósito de 250 (ultrapassa 1000)
      await act(async () => {
        getCtx().depositGoal(newGoal.id, 250, 'acc-1');
      });

      const foundGoal = getCtx().goals.find((g) => g.id === newGoal.id)!;
      expect(foundGoal.current_amount).toBe(1050);
      expect(foundGoal.status).toBe('completed');

      const accAfter = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      expect(accAfter.current_balance).toBe(balBefore - 250);

      // Rejeita depósito com conta inativa
      await act(async () => {
        getCtx().updateAccount('acc-2', { active: false });
      });
      expect(() => {
        getCtx().depositGoal(newGoal.id, 50, 'acc-2');
      }).toThrow(/A conta bancária informada está inativa/i);
    });

    it('setBudget: deve criar novo orçamento e atualizar orçamento existente no mesmo mês/categoria', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();

      await act(async () => {
        getCtx().setBudget('cat-1', 1200, 9, 2026);
      });

      const b1 = getCtx().budgets.find((b) => b.category_id === 'cat-1' && b.month === 9 && b.year === 2026);
      expect(b1).toBeDefined();
      expect(b1?.planned_amount).toBe(1200);

      // Atualização no mesmo mês
      await act(async () => {
        getCtx().setBudget('cat-1', 1800, 9, 2026);
      });

      const b2 = getCtx().budgets.find((b) => b.category_id === 'cat-1' && b.month === 9 && b.year === 2026);
      expect(b2?.planned_amount).toBe(1800);
    });

    it('updateGoal: deve atualizar nome e alvo de uma meta existente', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();

      let g: any;
      await act(async () => {
        g = getCtx().addGoal({
          name: 'Carro Antigo',
          target_amount: 40000,
          current_amount: 5000,
          target_date: '2027-12-31',
          status: 'in_progress',
          color: '#3b82f6',
          icon: 'car',
        });
      });

      await act(async () => {
        getCtx().updateGoal(g.id, {
          name: 'Carro Elétrico 0km',
          target_amount: 80000,
        });
      });

      const updated = getCtx().goals.find((item) => item.id === g.id);
      expect(updated?.name).toBe('Carro Elétrico 0km');
      expect(updated?.target_amount).toBe(80000);
    });
});
