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
  calculateExpenseSplits,
} from '../../financial-engine';
import { CreditCardBill, Transaction, Settlement } from '../../types';
import { getOrCreateAndAddItemToBill } from '../../context/actions/action-helpers';

describe('FinanceProvider - Rateios e Acertos', () => {
  const { storageMap, mountProvider } = setupFinanceHarness();

    it('deve registrar acerto de contas (recordSettlement) e persistir em settlements', async () => {
      const { getCtx } = await mountProvider();

      let ws: any;
      await act(async () => {
        ws = getCtx().createWorkspace('República Compartilhada');
      });

      await act(async () => {
        getCtx().setActiveWorkspaceId(ws.id);
        getCtx().addWorkspaceMember('amigo1@teste.com', 'member');
      });

      const currentMembers = getCtx().workspaceMembers.filter((m) => m.workspace_id === ws.id);
      expect(currentMembers.length).toBeGreaterThanOrEqual(2);

      const m1 = currentMembers[0].id;
      const m2 = currentMembers[1].id;

      // Cria despesa rateada 50/50 onde m2 paga 100 (m1 deve 50 para m2)
      await act(async () => {
        getCtx().addTransaction({
          description: 'Almoço Compartilhado',
          amount: 100.0,
          type: 'expense',
          paid_by_member_id: m2,
          split_type: 'equal',
          splits: [
            { member_id: m1, amount: 50.0 },
            { member_id: m2, amount: 50.0 },
          ],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'paid',
        });
      });

      let settlement: any;
      await act(async () => {
        settlement = getCtx().recordSettlement({
          from_member_id: m1,
          to_member_id: m2,
          amount: 50.0,
          settlement_date: '2026-09-18',
          notes: 'Pix de quitação de almoço',
        });
      });

      expect(settlement).toBeDefined();
      expect(settlement.workspace_id).toBe(ws.id);
      expect(settlement.amount).toBe(50.0);
      expect(settlement.from_member_id).toBe(m1);
      expect(settlement.to_member_id).toBe(m2);

      // Rejeita acerto inválido (mesmo pagador e recebedor)
      await act(async () => {
        expect(() => {
          getCtx().recordSettlement({
            from_member_id: m1,
            to_member_id: m1,
            amount: 30.0,
          });
        }).toThrow(/não podem ser a mesma pessoa/i);
      });

      // Exclusão de acerto (deleteSettlement)
      await act(async () => {
        getCtx().deleteSettlement(settlement.id);
      });

      expect(getCtx().settlements.some((s) => s.id === settlement.id)).toBe(false);
    });

    it('deve validar liquidação direcional e teto de dívida em recordSettlement (P0-01 Local)', async () => {
      const { getCtx } = await mountProvider();

      // Ativa workspace ws-2 que possui wsm-2 (Rodrigo) e wsm-3 (Camila)
      await act(async () => {
        getCtx().setActiveWorkspaceId('ws-2');
      });

      // 1. Sem despesas rateadas, tentar liquidar deve ser rejeitado
      expect(() => {
        getCtx().recordSettlement({
          from_member_id: 'wsm-3',
          to_member_id: 'wsm-2',
          amount: 50,
          settlement_date: '2026-09-18',
        });
      }).toThrow(/Não há débito pendente registrado entre o pagador e o recebedor/i);

      // 2. Registra despesa dividida 50/50: Rodrigo (wsm-2) paga 100,00 (Camila wsm-3 deve 50,00)
      await act(async () => {
        getCtx().addTransaction({
          description: 'Jantar Compartilhado',
          amount: 100,
          type: 'expense',
          paid_by_member_id: 'wsm-2',
          split_type: 'equal',
          splits: [
            { member_id: 'wsm-2', amount: 50 },
            { member_id: 'wsm-3', amount: 50 },
          ],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'paid',
        });
      });

      // 3. Rodrigo tentar pagar Camila deve ser rejeitado (direção invertida)
      expect(() => {
        getCtx().recordSettlement({
          from_member_id: 'wsm-2',
          to_member_id: 'wsm-3',
          amount: 20,
          settlement_date: '2026-09-18',
        });
      }).toThrow(/Não há débito pendente registrado/i);

      // 4. Camila tentar pagar mais que o débito (50.01) deve ser rejeitado
      expect(() => {
        getCtx().recordSettlement({
          from_member_id: 'wsm-3',
          to_member_id: 'wsm-2',
          amount: 50.01,
          settlement_date: '2026-09-18',
        });
      }).toThrow(/excede a dívida pendente/i);

      // 5. Camila paga exatamente 50.00: sucesso!
      let s: any;
      await act(async () => {
        s = getCtx().recordSettlement({
          from_member_id: 'wsm-3',
          to_member_id: 'wsm-2',
          amount: 50.0,
          settlement_date: '2026-09-18',
        });
      });
      expect(s.id).toBeDefined();

      // 6. Após a quitação total, tentar pagar novamente deve ser rejeitado (dívida zerada)
      expect(() => {
        getCtx().recordSettlement({
          from_member_id: 'wsm-3',
          to_member_id: 'wsm-2',
          amount: 10,
          settlement_date: '2026-09-18',
        });
      }).toThrow(/Não há débito pendente registrado/i);
    });

    it('deve consolidar compra parcelada com rateio no balanço sem duplicação (P0-02 Local)', async () => {
      const { getCtx } = await mountProvider();

      await act(async () => {
        getCtx().setActiveWorkspaceId('ws-2');
      });

      // Rodrigo compra parcelada de R$ 600 em 3x dividida 50/50 com Camila
      await act(async () => {
        getCtx().createInstallmentPurchase({
          description: 'Mesa de Jantar 3x',
          total_amount: 600,
          installment_count: 3,
          purchase_date: '2026-09-18',
          paid_by_member_id: 'wsm-2',
          split_type: 'equal',
          splits: [
            { member_id: 'wsm-2', amount: 300 },
            { member_id: 'wsm-3', amount: 300 },
          ],
        });
      });

      // Camila deve agora R$ 300 para Rodrigo. Pagamento de R$ 300 deve ser aceito
      await act(async () => {
        getCtx().recordSettlement({
          from_member_id: 'wsm-3',
          to_member_id: 'wsm-2',
          amount: 300,
          settlement_date: '2026-09-18',
        });
      });

      // Nova tentativa de pagamento rejeitada (débito zerado)
      expect(() => {
        getCtx().recordSettlement({
          from_member_id: 'wsm-3',
          to_member_id: 'wsm-2',
          amount: 1,
          settlement_date: '2026-09-18',
        });
      }).toThrow(/Não há débito pendente registrado/i);
    });

    it('deve validar pertencimento de membros e duplicidade na borda do provider (P1-01 Local)', async () => {
      const { getCtx } = await mountProvider();

      await act(async () => {
        getCtx().setActiveWorkspaceId('ws-2');
      });

      // Membro inexistente
      expect(() => {
        getCtx().addTransaction({
          description: 'Membro Inexistente',
          amount: 100,
          type: 'expense',
          paid_by_member_id: 'm-ghost',
          split_type: 'equal',
          splits: [{ member_id: 'wsm-2', amount: 100 }],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'paid',
        });
      }).toThrow(/O membro pagador informado não pertence ao workspace ativo/i);

      // Membro de outro workspace (wsm-1 é de ws-1, não de ws-2)
      expect(() => {
        getCtx().addTransaction({
          description: 'Membro de Outro Workspace',
          amount: 100,
          type: 'expense',
          paid_by_member_id: 'wsm-2',
          split_type: 'equal',
          splits: [{ member_id: 'wsm-1', amount: 100 }],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'paid',
        });
      }).toThrow(/não pertence ao workspace ativo/i);

      // Membros duplicados na lista de splits
      expect(() => {
        getCtx().addTransaction({
          description: 'Membro Duplicado',
          amount: 100,
          type: 'expense',
          paid_by_member_id: 'wsm-2',
          split_type: 'custom',
          splits: [
            { member_id: 'wsm-3', amount: 50 },
            { member_id: 'wsm-3', amount: 50 },
          ],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'paid',
        });
      }).toThrow(/Membros duplicados identificados no rateio/i);

      // Split negativo direto (P1-01 Local Auditoria V36)
      expect(() => {
        getCtx().addTransaction({
          description: 'Split Negativo',
          amount: 100,
          type: 'expense',
          paid_by_member_id: 'wsm-2',
          split_type: 'custom',
          splits: [
            { member_id: 'wsm-2', amount: -50 },
            { member_id: 'wsm-3', amount: 150 },
          ],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'paid',
        });
      }).toThrow(/não pode ser negativo ou inválido/i);

      // Soma divergente do total em addTransaction (P1-01 Local Auditoria V36)
      expect(() => {
        getCtx().addTransaction({
          description: 'Soma Divergente',
          amount: 100,
          type: 'expense',
          paid_by_member_id: 'wsm-2',
          split_type: 'custom',
          splits: [
            { member_id: 'wsm-2', amount: 20 },
            { member_id: 'wsm-3', amount: 20 },
          ],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'paid',
        });
      }).toThrow(/diverge do valor total da despesa/i);

      // Soma divergente do total em createInstallmentPurchase (P1-01 Local Auditoria V36)
      expect(() => {
        getCtx().createInstallmentPurchase({
          description: 'Compra Soma Divergente',
          total_amount: 300,
          installment_count: 3,
          purchase_date: '2026-09-18',
          paid_by_member_id: 'wsm-2',
          split_type: 'custom',
          splits: [
            { member_id: 'wsm-2', amount: 50 },
            { member_id: 'wsm-3', amount: 50 },
          ],
        });
      }).toThrow(/diverge do valor total da despesa/i);

      // Reconciliação atômica em updateTransaction (P1-01 Local Auditoria V36)
      // 1. Despesa com divisão customizada: alterar total sem novos splits deve ser rejeitado
      let txCustom: any;
      await act(async () => {
        txCustom = getCtx().addTransaction({
          description: 'Despesa Custom Original',
          amount: 100,
          type: 'expense',
          paid_by_member_id: 'wsm-2',
          split_type: 'custom',
          splits: [
            { member_id: 'wsm-2', amount: 50 },
            { member_id: 'wsm-3', amount: 50 },
          ],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'pending',
        });
      });

      expect(() => {
        getCtx().updateTransaction(txCustom.id, { amount: 200 });
      }).toThrow(/Ao alterar o valor total.*divisão personalizada/i);

      // 2. Despesa com divisão igualitária (equal): alterar total de 100 para 200 recalcula atomicamente os splits
      let txEqual: any;
      await act(async () => {
        txEqual = getCtx().addTransaction({
          description: 'Despesa Equal Reconciliada',
          amount: 100,
          type: 'expense',
          paid_by_member_id: 'wsm-2',
          split_type: 'equal',
          splits: [
            { member_id: 'wsm-2', amount: 50 },
            { member_id: 'wsm-3', amount: 50 },
          ],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'pending',
        });
      });

      await act(async () => {
        getCtx().updateTransaction(txEqual.id, { amount: 200 });
      });

      const updated = getCtx().transactions.find((t) => t.id === txEqual.id);
      expect(updated?.amount).toBe(200);
      expect(updated?.splits).toEqual([
        { member_id: 'wsm-2', amount: 100, percentage: 50 },
        { member_id: 'wsm-3', amount: 100, percentage: 50 },
      ]);
    });

    it('deve validar regras de coerência e reconciliação dinâmica de splits na borda pública do Provider (Reauditoria V36)', async () => {
      const { getCtx } = await mountProvider();

      await act(async () => {
        getCtx().setActiveWorkspaceId('ws-2');
      });

      // Prova 1: Regra equal sem splits rejeitada
      expect(() => {
        getCtx().addTransaction({
          description: 'Equal sem splits',
          amount: 100,
          type: 'expense',
          paid_by_member_id: 'wsm-2',
          split_type: 'equal',
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'pending',
        });
      }).toThrow(/A regra de divisão selecionada exige o preenchimento das frações de rateio/i);

      // Prova 2: Regra individual com splits rejeitada
      expect(() => {
        getCtx().addTransaction({
          description: 'Individual com splits',
          amount: 100,
          type: 'expense',
          paid_by_member_id: 'wsm-2',
          split_type: 'individual',
          splits: [{ member_id: 'wsm-3', amount: 100 }],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'pending',
        });
      }).toThrow(/Transações individuais não devem possuir divisão de despesas/i);

      // Prova 3: updateTransaction trocando pagador em full_other recalcula splits transferindo a responsabilidade
      let txFullOther: any;
      await act(async () => {
        txFullOther = getCtx().addTransaction({
          description: 'Jantar Pago por Rodrigo para Camila',
          amount: 120,
          type: 'expense',
          paid_by_member_id: 'wsm-2',
          split_type: 'full_other',
          splits: [{ member_id: 'wsm-3', amount: 120, percentage: 100 }],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'pending',
        });
      });

      expect(txFullOther.splits).toEqual([{ member_id: 'wsm-3', amount: 120, percentage: 100 }]);

      // Rodrigo (wsm-2) passa a ser trocado por Camila (wsm-3) como pagadora
      await act(async () => {
        getCtx().updateTransaction(txFullOther.id, { paid_by_member_id: 'wsm-3' });
      });

      const updatedPayerTx = getCtx().transactions.find((t) => t.id === txFullOther.id);
      expect(updatedPayerTx?.paid_by_member_id).toBe('wsm-3');
      expect(updatedPayerTx?.splits).toEqual([{ member_id: 'wsm-2', amount: 120, percentage: 100 }]);

      // Prova 4: updateTransaction trocando regra equal -> full_other recalcula splits atomicamente
      let txEqual: any;
      await act(async () => {
        txEqual = getCtx().addTransaction({
          description: 'Despesa Inicial 50/50',
          amount: 200,
          type: 'expense',
          paid_by_member_id: 'wsm-2',
          split_type: 'equal',
          splits: [
            { member_id: 'wsm-2', amount: 100, percentage: 50 },
            { member_id: 'wsm-3', amount: 100, percentage: 50 },
          ],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'pending',
        });
      });

      await act(async () => {
        getCtx().updateTransaction(txEqual.id, { split_type: 'full_other' });
      });

      const updatedSplitTypeTx = getCtx().transactions.find((t) => t.id === txEqual.id);
      expect(updatedSplitTypeTx?.split_type).toBe('full_other');
      expect(updatedSplitTypeTx?.splits).toEqual([{ member_id: 'wsm-3', amount: 200, percentage: 100 }]);

      // Prova 5 (P1-01 V36 Semântica): split_type omitido/undefined com splits é rejeitado
      expect(() => {
        getCtx().addTransaction({
          description: 'Regra omitida com splits',
          amount: 100,
          type: 'expense',
          paid_by_member_id: 'wsm-2',
          splits: [
            { member_id: 'wsm-2', amount: 50 },
            { member_id: 'wsm-3', amount: 50 },
          ],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'pending',
        });
      }).toThrow(/Transações individuais não devem possuir divisão de despesas/i);

      expect(() => {
        getCtx().createInstallmentPurchase({
          description: 'Parcelamento Regra Omitida com splits',
          total_amount: 100,
          installment_count: 2,
          purchase_date: '2026-09-18',
          paid_by_member_id: 'wsm-2',
          splits: [
            { member_id: 'wsm-2', amount: 50 },
            { member_id: 'wsm-3', amount: 50 },
          ],
        });
      }).toThrow(/Transações individuais não devem possuir divisão de despesas/i);

      // Prova 6 (P1-01 V36 Semântica): split_type: 'equal' com distribuição divergente (30/70) é rejeitado
      expect(() => {
        getCtx().addTransaction({
          description: 'Equal com 30/70 divergente',
          amount: 100,
          type: 'expense',
          paid_by_member_id: 'wsm-2',
          split_type: 'equal',
          splits: [
            { member_id: 'wsm-2', amount: 30 },
            { member_id: 'wsm-3', amount: 70 },
          ],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'pending',
        });
      }).toThrow(/A distribuição de frações informada diverge do cálculo canônico para a regra 'equal'/i);

      expect(() => {
        getCtx().createInstallmentPurchase({
          description: 'Parcelamento Equal com 30/70 divergente',
          total_amount: 100,
          installment_count: 2,
          purchase_date: '2026-09-18',
          paid_by_member_id: 'wsm-2',
          split_type: 'equal',
          splits: [
            { member_id: 'wsm-2', amount: 30 },
            { member_id: 'wsm-3', amount: 70 },
          ],
        });
      }).toThrow(/A distribuição de frações informada diverge do cálculo canônico para a regra 'equal'/i);

      // Provas 7 e 8: Workspaces com 3 membros (P1-01 V36 Conjunto Canônico Completo)
      let ws3: any;
      await act(async () => {
        ws3 = getCtx().createWorkspace('Workspace Trio');
        getCtx().setActiveWorkspaceId(ws3.id);
        getCtx().addWorkspaceMember('membroB@teste.com', 'member');
        getCtx().addWorkspaceMember('membroC@teste.com', 'member');
      });

      const trioMembers = getCtx().workspaceMembers.filter((m) => m.workspace_id === ws3.id);
      expect(trioMembers).toHaveLength(3);
      const [mA, mB, mC] = trioMembers.map((m) => m.id);

      // Prova 7: equal omitindo terceiro membro (A=50, B=50; C omitido) deve ser rejeitado
      expect(() => {
        getCtx().addTransaction({
          description: 'Equal omitindo C',
          amount: 100,
          type: 'expense',
          paid_by_member_id: mA,
          split_type: 'equal',
          splits: [
            { member_id: mA, amount: 50 },
            { member_id: mB, amount: 50 },
          ],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'pending',
        });
      }).toThrow(/A distribuição de frações informada diverge do cálculo canônico para a regra 'equal'/i);

      expect(() => {
        getCtx().createInstallmentPurchase({
          description: 'Parcelamento Equal omitindo C',
          total_amount: 100,
          installment_count: 2,
          purchase_date: '2026-09-18',
          paid_by_member_id: mA,
          split_type: 'equal',
          splits: [
            { member_id: mA, amount: 50 },
            { member_id: mB, amount: 50 },
          ],
        });
      }).toThrow(/A distribuição de frações informada diverge do cálculo canônico para a regra 'equal'/i);

      // Prova 8: full_other omitindo outro não pagador (A paga, B=100; C omitido) deve ser rejeitado
      expect(() => {
        getCtx().addTransaction({
          description: 'Full Other omitindo C',
          amount: 100,
          type: 'expense',
          paid_by_member_id: mA,
          split_type: 'full_other',
          splits: [
            { member_id: mB, amount: 100 },
          ],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'pending',
        });
      }).toThrow(/A distribuição de frações informada diverge do cálculo canônico para a regra 'full_other'/i);

      expect(() => {
        getCtx().createInstallmentPurchase({
          description: 'Parcelamento Full Other omitindo C',
          total_amount: 100,
          installment_count: 2,
          purchase_date: '2026-09-18',
          paid_by_member_id: mA,
          split_type: 'full_other',
          splits: [
            { member_id: mB, amount: 100 },
          ],
        });
      }).toThrow(/A distribuição de frações informada diverge do cálculo canônico para a regra 'full_other'/i);
    });

    it('recordSettlement com payment_account_id: valida que conta pertence ao workspace e está ativa', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      storageMap.set('fincontrol_v2_members', JSON.stringify([
        { id: 'wsm-1', workspace_id: 'ws-1', user_id: 'usr-1', role: 'owner' },
        { id: 'wsm-2', workspace_id: 'ws-1', user_id: 'usr-2', role: 'member' },
      ]));
      storageMap.set('fincontrol_v2_transactions', JSON.stringify([
        {
          id: 'tx-set-val',
          workspace_id: 'ws-1',
          description: 'Almoço rateado',
          amount: 100,
          type: 'expense',
          paid_by_member_id: 'wsm-1',
          split_type: 'equal',
          splits: [
            { member_id: 'wsm-1', amount: 50 },
            { member_id: 'wsm-2', amount: 50 },
          ],
          transaction_date: '2026-09-18',
          due_date: '2026-09-18',
          status: 'paid',
          created_at: '2026-09-18',
        },
      ]));
      const { getCtx } = await mountProvider();

      // Conta inexistente
      expect(() => {
        getCtx().recordSettlement({
          from_member_id: 'wsm-2',
          to_member_id: 'wsm-1',
          amount: 25,
          payment_account_id: 'acc-inexistente-123',
        });
      }).toThrow(/A conta bancária informada para o acerto não pertence ao workspace ativo/i);

      // Conta inativa
      await act(async () => {
        getCtx().updateAccount('acc-1', { active: false });
      });
      expect(() => {
        getCtx().recordSettlement({
          from_member_id: 'wsm-2',
          to_member_id: 'wsm-1',
          amount: 25,
          payment_account_id: 'acc-1',
        });
      }).toThrow(/A conta bancária informada para o acerto está inativa/i);

      // Reativa conta e registra com sucesso fornecendo payment_account_id e omitindo settlement_date
      await act(async () => {
        getCtx().updateAccount('acc-1', { active: true });
      });

      let validSet: any;
      await act(async () => {
        validSet = getCtx().recordSettlement({
          from_member_id: 'wsm-2',
          to_member_id: 'wsm-1',
          amount: 25,
          payment_account_id: 'acc-1',
        });
      });
      expect(validSet.id).toBeDefined();
      expect(validSet.payment_account_id).toBe('acc-1');
      expect(validSet.settlement_date).toBeDefined();

      // deleteSettlement com ID inexistente não quebra
      await act(async () => {
        getCtx().deleteSettlement('set-inexistente-xyz');
      });
    });

    it('calculateExpenseSplits deve cobrir branches de full_other sem outros membros, custom vazio e regra desconhecida', () => {
      const singleMember = [{ id: 'm-only', workspace_id: 'ws-1', user_id: 'u-1', role: 'owner' as const, created_at: '2026-01-01' }];
      
      // full_other com apenas 1 membro no workspace
      const splitsSingle = calculateExpenseSplits(100, 'full_other', singleMember, 'm-only');
      expect(splitsSingle).toEqual([{ member_id: 'm-only', amount: 100, percentage: 100 }]);

      // custom com array vazio ou não informado
      const splitsCustomEmpty = calculateExpenseSplits(100, 'custom', singleMember, 'm-only', []);
      expect(splitsCustomEmpty).toEqual([{ member_id: 'm-only', amount: 100, percentage: 100 }]);

      // regra desconhecida cai no fallback default
      const splitsUnknown = calculateExpenseSplits(100, 'regra_desconhecida' as any, singleMember, 'm-only');
      expect(splitsUnknown).toEqual([{ member_id: 'm-only', amount: 100, percentage: 100 }]);
    });

    it('validação canônica de full_other com splits explícitos e validação de subcategoria inativa', async () => {
      const { getCtx } = await mountProvider();

      // 1. Alterna para ws-2 (possui wsm-2 e wsm-3)
      await act(async () => {
        getCtx().setActiveWorkspaceId('ws-2');
      });

      let catWs2: any;
      await act(async () => {
        catWs2 = getCtx().addCategory({
          name: 'Alimentação WS2',
          type: 'expense',
          color: '#10b981',
          icon: 'Utensils',
          active: true,
        });
      });

      const catId = catWs2.id;

      // Cria transação válida com full_other e splits canônicos
      let validFullOther: any;
      await act(async () => {
        validFullOther = getCtx().addTransaction({
          description: 'Compra 100% Outro Canônica',
          amount: 100,
          type: 'expense',
          category_id: catId,
          paid_by_member_id: 'wsm-2',
          split_type: 'full_other',
          splits: [{ member_id: 'wsm-3', amount: 100 }],
          status: 'paid',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
        });
      });
      expect(validFullOther.id).toBeDefined();

      // Tenta criar transação com splits de tamanho divergente para full_other (incluindo pagador com valor 0)
      expect(() => {
        getCtx().addTransaction({
          description: 'Full Other Tamanho Errado',
          amount: 100,
          type: 'expense',
          category_id: catId,
          paid_by_member_id: 'wsm-2',
          split_type: 'full_other',
          splits: [
            { member_id: 'wsm-2', amount: 0 },
            { member_id: 'wsm-3', amount: 100 },
          ],
          status: 'paid',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
        });
      }).toThrow(/diverge do cálculo canônico para a regra 'full_other'/i);

      // 2. Cria categoria com subcategoria inativa e valida rejeição
      let catWithSub: any;
      await act(async () => {
        catWithSub = getCtx().addCategory({
          name: 'Categoria Pai',
          type: 'expense',
          color: '#123',
          icon: 'Tag',
          active: true,
        });
        getCtx().updateCategory(catWithSub.id, {
          subcategories: [
            {
              id: 'sub-inactive-test',
              parent_id: catWithSub.id,
              name: 'Sub Inativa',
              type: 'expense',
              color: '#123',
              icon: 'Tag',
              workspace_id: 'ws-2',
              active: false,
              created_at: '2026-01-01',
            },
          ],
        });
      });

      expect(() => {
        getCtx().addTransaction({
          description: 'Transação com Sub Inativa',
          amount: 50,
          type: 'expense',
          category_id: 'sub-inactive-test',
          status: 'paid',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
        });
      }).toThrow('A subcategoria informada está inativa.');
    });

    it('validateTransactionSplits: deve validar regras de full_other com splits divergentes e fallback de pagador', async () => {
      const { getCtx } = await mountProvider();
      await act(async () => {
        getCtx().setActiveWorkspaceId('ws-2');
      });

      // 1. full_other com o próprio pagador possuindo fração positiva
      expect(() => {
        getCtx().addTransaction({
          description: 'Full Other com pagador recebendo fração',
          amount: 100,
          type: 'expense',
          paid_by_member_id: 'wsm-2',
          split_type: 'full_other',
          splits: [
            { member_id: 'wsm-2', amount: 50 },
            { member_id: 'wsm-3', amount: 50 },
          ],
          status: 'paid',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
        });
      }).toThrow('Na regra 100% de outra pessoa, o pagador não pode possuir fração atribuída a si mesmo.');

      // 2. full_other com soma divergente (cobre linha 132)
      expect(() => {
        getCtx().addTransaction({
          description: 'Full Other com soma divergente',
          amount: 100,
          type: 'expense',
          paid_by_member_id: 'wsm-2',
          split_type: 'full_other',
          splits: [
            { member_id: 'wsm-3', amount: 80 },
          ],
          status: 'paid',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
        });
      }).toThrow(/A soma das frações do rateio .* diverge do valor total da despesa/);

      // 3. Adiciona terceiro membro em ws-2 para testar regras canônicas de full_other com >1 outro membro
      await act(async () => {
        getCtx().addWorkspaceMember('terceiro@exemplo.com', 'member');
      });
      const thirdMember = getCtx().workspaceMembers.find((m) => m.user?.email === 'terceiro@exemplo.com')!;
      expect(thirdMember).toBeDefined();

      // 3a. splits.length (1) !== canonical.length (2) com soma correta (100) -> cobre linha 173
      expect(() => {
        getCtx().addTransaction({
          description: 'Full Other com número incorreto de frações',
          amount: 100,
          type: 'expense',
          paid_by_member_id: 'wsm-2',
          split_type: 'full_other',
          splits: [
            { member_id: 'wsm-3', amount: 100 },
          ],
          status: 'paid',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
        });
      }).toThrow(/A distribuição de frações informada diverge do cálculo canônico para a regra 'full_other'/);

      // 3b. splits.length (2) correto e soma correta (100), mas valores divergentes (70/30 vs 50/50 canônico) -> cobre linha 182
      expect(() => {
        getCtx().addTransaction({
          description: 'Full Other com distribuição desigual',
          amount: 100,
          type: 'expense',
          paid_by_member_id: 'wsm-2',
          split_type: 'full_other',
          splits: [
            { member_id: 'wsm-3', amount: 70 },
            { member_id: thirdMember.id, amount: 30 },
          ],
          status: 'paid',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
        });
      }).toThrow(/A distribuição de frações informada diverge do cálculo canônico para a regra 'full_other'/);

      // 4. full_other sem paid_by_member_id informado (usa fallback wsMembers[0]?.id = wsm-2, cobre linha 168)
      let txFallbackPayer: any;
      await act(async () => {
        txFallbackPayer = getCtx().addTransaction({
          description: 'Full Other com Pagador Fallback',
          amount: 100,
          type: 'expense',
          split_type: 'full_other',
          splits: [
            { member_id: 'wsm-3', amount: 50, percentage: 50 },
            { member_id: thirdMember.id, amount: 50, percentage: 50 },
          ],
          status: 'paid',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
        });
      });
      expect(txFallbackPayer).toBeDefined();
      expect(txFallbackPayer.paid_by_member_id).toBeUndefined();
    });

    it('action-helpers: deve cobrir getOrCreateAndAddItemToBill sem wsId e validateActiveCategory com subcategoria ativa (linhas 21 e 62)', async () => {
      const { getCtx } = await mountProvider();

      // 1. Cria categoria pai com subcategoria ativa
      let catWithActiveSub: any;
      await act(async () => {
        catWithActiveSub = getCtx().addCategory({
          name: 'Transporte Urbano',
          type: 'expense',
          color: '#3b82f6',
          icon: 'Car',
          active: true,
        });
        getCtx().updateCategory(catWithActiveSub.id, {
          subcategories: [
            {
              id: 'sub-active-taxi',
              parent_id: catWithActiveSub.id,
              name: 'Táxi / Aplicativo',
              type: 'expense',
              color: '#3b82f6',
              icon: 'Car',
              workspace_id: 'ws-1',
              active: true,
              created_at: '2026-01-01',
            },
          ],
        });
      });

      // Transação usando subcategoria ativa: entra na linha 60 e avalia linha 62 como false (sucesso)
      let txSub: any;
      await act(async () => {
        txSub = getCtx().addTransaction({
          description: 'Corrida Táxi',
          amount: 45,
          type: 'expense',
          category_id: 'sub-active-taxi',
          status: 'paid',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
        });
      });
      expect(txSub.id).toBeDefined();
      expect(txSub.category_id).toBe('sub-active-taxi');

      // 2. Chama getOrCreateAndAddItemToBill sem passar wsId (cobre fallback da linha 21: state.activeWorkspaceId)
      let billIdFallbackWs: string | undefined;
      const deps = {
        getState: () => ({
          activeWorkspaceId: 'ws-1',
          allCreditCardBills: [],
        }),
        commit: (next: any) => {},
        generateId: (p = 'bill') => `${p}-test`,
        now: () => new Date(),
      };
      billIdFallbackWs = getOrCreateAndAddItemToBill(
        deps as any,
        'card-1',
        '2026-08',
        '2026-08-05',
        '2026-08-12',
        100
      );
      expect(billIdFallbackWs).toBeDefined();
    });
});

