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
import {
  addRecurring as addRecurringAction,
  toggleRecurring as toggleRecurringAction,
  processPendingRecurring as processPendingRecurringAction,
} from '../../context/actions/recurring-actions';

describe('FinanceProvider - Recorrências', () => {
  const { storageMap, mountProvider } = setupFinanceHarness();

    it('deve rejeitar criação de recorrência vinculada a conta inativada no mesmo lote (P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const catId = getCtx().categories[0]?.id || 'cat-1';

      await act(async () => {
        getCtx().updateAccount('acc-1', { active: false });
        expect(() => {
          getCtx().addRecurring({
            description: 'Recorrência Conta Inativa Lote',
            amount: 10.10,
            type: 'expense',
            category_id: catId,
            account_id: 'acc-1',
            frequency: 'monthly',
            start_date: '2099-01-01',
            next_occurrence: '2099-01-01',
            auto_create: false,
            active: true,
          });
        }).toThrow(/está inativa/i);
      });

      expect(getCtx().recurring.find((r) => r.description === 'Recorrência Conta Inativa Lote')).toBeUndefined();
    });

    it('deve rejeitar criação de recorrência vinculada a conta excluída no mesmo lote (P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const catId = getCtx().categories[0]?.id || 'cat-1';
      let cleanAcc: any;

      await act(async () => {
        cleanAcc = getCtx().addAccount({
          name: 'Conta Limpa Para Recorrência',
          type: 'checking',
          institution: 'Nubank',
          initial_balance: 100.0,
          current_balance: 100.0,
          color: '#000',
          active: true,
        });
      });

      await act(async () => {
        const delRes = getCtx().deleteAccount(cleanAcc.id);
        expect(delRes.action).toBe('deleted');

        expect(() => {
          getCtx().addRecurring({
            description: 'Recorrência Conta Excluída Lote',
            amount: 10.10,
            type: 'expense',
            category_id: catId,
            account_id: cleanAcc.id,
            frequency: 'monthly',
            start_date: '2099-01-01',
            next_occurrence: '2099-01-01',
            auto_create: false,
            active: true,
          });
        }).toThrow(/não pertence ao workspace/i);
      });

      expect(getCtx().recurring.find((r) => r.description === 'Recorrência Conta Excluída Lote')).toBeUndefined();
    });

    it('deve permitir criação de recorrência vinculada a conta recém-criada no mesmo lote (P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const catId = getCtx().categories[0]?.id || 'cat-1';
      let newAcc: any;
      let rec: any;

      await act(async () => {
        newAcc = getCtx().addAccount({
          name: 'Conta Recorrente Nova Lote',
          type: 'checking',
          institution: 'Nubank',
          initial_balance: 500.0,
          current_balance: 500.0,
          color: '#3b82f6',
          active: true,
        });

        rec = getCtx().addRecurring({
          description: 'Recorrência Conta Nova Lote',
          amount: 10.10,
          type: 'expense',
          category_id: catId,
          account_id: newAcc.id,
          frequency: 'monthly',
          start_date: '2099-01-01',
          next_occurrence: '2099-01-01',
          auto_create: false,
          active: true,
        });
      });

      expect(rec).toBeDefined();
      expect(rec.account_id).toBe(newAcc.id);
      expect(getCtx().recurring.find((r) => r.id === rec.id)).toBeDefined();
    });

    it('deve manter coerência nos controles de recorrência com renderização intermediária (P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const catId = getCtx().categories[0]?.id || 'cat-1';

      // 1. Controle: Inativação com renderização intermediária
      await act(async () => {
        getCtx().updateAccount('acc-1', { active: false });
      });

      await act(async () => {
        expect(() => {
          getCtx().addRecurring({
            description: 'Recorrência Conta Inativa Controle',
            amount: 25.0,
            type: 'expense',
            category_id: catId,
            account_id: 'acc-1',
            frequency: 'monthly',
            start_date: '2099-01-01',
            next_occurrence: '2099-01-01',
            auto_create: false,
            active: true,
          });
        }).toThrow(/está inativa/i);
      });

      // 2. Controle: Criação de conta com renderização intermediária
      let newAcc: any;
      await act(async () => {
        newAcc = getCtx().addAccount({
          name: 'Conta Nova Controle',
          type: 'checking',
          institution: 'Nubank',
          initial_balance: 200.0,
          current_balance: 200.0,
          color: '#10b981',
          active: true,
        });
      });

      let rec: any;
      await act(async () => {
        rec = getCtx().addRecurring({
          description: 'Recorrência Conta Nova Controle',
          amount: 25.0,
          type: 'expense',
          category_id: catId,
          account_id: newAcc.id,
          frequency: 'monthly',
          start_date: '2099-01-01',
          next_occurrence: '2099-01-01',
          auto_create: false,
          active: true,
        });
      });

      expect(rec).toBeDefined();
      expect(rec.account_id).toBe(newAcc.id);
      expect(getCtx().recurring.find((r) => r.id === rec.id)).toBeDefined();
    });

    it('toggleRecurring e deleteRecurring: deve alternar status e excluir recorrência', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();

      let rec: any;
      await act(async () => {
        rec = getCtx().addRecurring({
          description: 'Internet Fibra 500MB',
          amount: 149.9,
          type: 'expense',
          frequency: 'monthly',
          start_date: '2026-01-01',
          next_occurrence: '2026-01-01',
          active: true,
          auto_create: true,
        });
      });

      expect(rec.active).toBe(true);

      // Desativa
      await act(async () => {
        getCtx().toggleRecurring(rec.id);
      });
      expect(getCtx().recurring.find((r) => r.id === rec.id)?.active).toBe(false);

      // Reativa com recálculo de catchup
      await act(async () => {
        getCtx().toggleRecurring(rec.id);
      });
      expect(getCtx().recurring.find((r) => r.id === rec.id)?.active).toBe(true);

      // Exclui
      await act(async () => {
        getCtx().deleteRecurring(rec.id);
      });
      expect(getCtx().recurring.some((r) => r.id === rec.id)).toBe(false);
    });

    it('recurring-actions: valida intervalo customizado, executa callback onProcessed e lida com IDs inexistentes', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      // 1. Recorrência personalizada com intervalo inválido
      expect(() => {
        getCtx().addRecurring({
          description: 'Recorrência Custom Inválida',
          amount: 50,
          type: 'expense',
          frequency: 'custom',
          interval_days: 0,
          start_date: '2026-08-01',
          next_occurrence: '2026-08-01',
          active: true,
          auto_create: false,
        });
      }).toThrow('Intervalo em dias inválido para recorrência personalizada');

      // 2. Recorrência personalizada válida
      let customRec: any;
      await act(async () => {
        customRec = getCtx().addRecurring({
          description: 'Recorrência Quinzenal',
          amount: 100,
          type: 'expense',
          frequency: 'custom',
          interval_days: 15,
          start_date: '2026-08-01',
          next_occurrence: '2026-08-01',
          active: true,
          auto_create: false,
        });
      });

      expect(customRec).toBeDefined();
      expect(customRec.interval_days).toBe(15);

      // 3. addRecurring e toggleRecurring com callback onProcessed customizado
      const mockOnProcessed = () => {};
      let recWithCb: any;
      await act(async () => {
        recWithCb = (getCtx().addRecurring as any)(
          {
            description: 'Recorrência com Callback',
            amount: 75,
            type: 'expense',
            frequency: 'monthly',
            start_date: '2026-08-01',
            next_occurrence: '2026-08-01',
            active: true,
            auto_create: false,
          },
          mockOnProcessed
        );
      });

      expect(recWithCb).toBeDefined();

      await act(async () => {
        (getCtx().toggleRecurring as any)(recWithCb.id, mockOnProcessed);
      });

      const toggled = getCtx().recurring.find((r) => r.id === recWithCb.id);
      expect(toggled?.active).toBe(false);

      // 4. toggleRecurring e deleteRecurring com ID inexistente
      await act(async () => {
        getCtx().toggleRecurring('rec-inexistente-1234');
        getCtx().deleteRecurring('rec-inexistente-1234');
      });
    });

    it('createTransfer deve rejeitar transferência para conta de destino inexistente ou inativa', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();

      // Conta de destino inexistente
      expect(() => {
        getCtx().createTransfer('acc-1', 'acc-inexistente-xyz', 50, '2026-08-01');
      }).toThrow('As contas informadas devem pertencer ao workspace ativo.');

      // Inativa acc-2 e tenta transferir para ela
      await act(async () => {
        getCtx().updateAccount('acc-2', { active: false });
      });

      expect(() => {
        getCtx().createTransfer('acc-1', 'acc-2', 50, '2026-08-01');
      }).toThrow('A conta bancária informada está inativa.');
    });

    it('recurring-actions: addRecurring e toggleRecurring executam processPendingRecurring quando onProcessed é omitido e calculam catch-up em data retroativa', async () => {
      let state: any = {
        activeWorkspaceId: 'ws-1',
        allWorkspaces: [{ id: 'ws-1', name: 'WS', tracking_mode: 'full' }],
        allAccounts: [{ id: 'acc-1', workspace_id: 'ws-1', active: true, current_balance: 1000 }],
        allCategories: [{ id: 'cat-1', workspace_id: 'ws-1', active: true }],
        allPaymentMethods: [],
        allCreditCards: [],
        allCreditCardBills: [],
        allTransactions: [],
        allPurchases: [],
        allInstallments: [],
        allPayments: [],
        allGoals: [],
        allBudgets: [],
        allSettlements: [],
        allWorkspaceMembers: [],
        allRecurring: [
          {
            id: 'rec-catchup',
            workspace_id: 'ws-1',
            description: 'Recorrência Atrasada',
            amount: 50,
            type: 'expense',
            frequency: 'monthly',
            start_date: '2020-01-01',
            next_occurrence: '2020-01-01',
            active: false,
            auto_create: false,
            created_at: '2020-01-01T00:00:00Z',
          },
        ],
      };

      const deps = {
        getState: () => state,
        commit: (next: any) => { state = next; },
        generateId: (p = 'rec') => `${p}-test-${Date.now()}`,
        now: () => new Date('2026-08-20T12:00:00Z'),
      };

      // 1. addRecurring sem onProcessed -> deve cair no else (processPendingRecurring, linha 103)
      const newRec = addRecurringAction(deps, {
        description: 'Recorrência Direta',
        amount: 30,
        type: 'expense',
        frequency: 'monthly',
        start_date: '2026-09-01',
        next_occurrence: '2026-09-01',
        active: true,
        auto_create: false,
      });
      expect(newRec).toBeDefined();

      // 2. toggleRecurring na rec-catchup (inativa e next_occurrence passada) sem onProcessed
      // -> willBeActive vira true, nextOcc < todayStr vira true (executa calculateCatchUpOccurrence, linha 123),
      // e sem onProcessed executa processPendingRecurring (linha 143)
      toggleRecurringAction(deps, 'rec-catchup');
      const toggled = state.allRecurring.find((r: any) => r.id === 'rec-catchup');
      expect(toggled.active).toBe(true);
      expect(toggled.next_occurrence > '2020-01-01').toBe(true);

      // 3. processPendingRecurring com série cujo next_occurrence ultrapassou end_date (hasChanges = true, newTransactions.length = 0, cobre linha 35)
      state.allRecurring = [
        {
          id: 'rec-expired',
          workspace_id: 'ws-1',
          description: 'Série Expirada',
          amount: 100,
          type: 'expense',
          frequency: 'monthly',
          start_date: '2026-01-01',
          end_date: '2026-07-01',
          next_occurrence: '2026-08-01',
          active: true,
          auto_create: true,
          created_at: '2026-01-01T00:00:00Z',
        },
      ];
      const prevTxs = state.allTransactions;
      processPendingRecurringAction(deps);
      expect(state.allTransactions).toBe(prevTxs);
      expect(state.allRecurring[0].active).toBe(false);
    });
});

