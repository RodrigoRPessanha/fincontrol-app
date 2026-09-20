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

describe('FinanceProvider - Transações', () => {
  const { storageMap, mountProvider } = setupFinanceHarness();

    it('deve retornar saldo exatamente ao original após addTransaction paga e deleteTransaction (V35 / P1)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));

      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const accBefore = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      const originalBalance = accBefore.current_balance;

      let tx: any;
      await act(async () => {
        tx = getCtx().addTransaction({
          description: 'Despesa paga imediata',
          amount: 30.3,
          type: 'expense',
          transaction_date: '2026-08-02',
          due_date: '2026-08-02',
          account_id: 'acc-1',
          category_id: getCtx().categories[0]?.id,
          status: 'paid',
        });
      });

      const accDuring = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      expect(accDuring.current_balance).toBe(fromCents(toCents(originalBalance) - 3030));

      await act(async () => {
        getCtx().deleteTransaction(tx.id);
      });

      const accAfter = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      expect(accAfter.current_balance).toBe(originalBalance);
    });

    it('deve sincronizar estado entre updateTransaction e recordPayment no mesmo lote rejeitando excesso após edição (V36 / P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const accBefore = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      const balanceBefore = accBefore.current_balance;

      let tx: any;
      await act(async () => {
        tx = getCtx().addTransaction({
          type: 'expense',
          amount: 30.3,
          description: 'Transação Inicial 30.30',
          category_id: 'cat-1',
          account_id: 'acc-1',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
      });

      // No MESMO act/lote: edita o valor de 30.30 para 10.10 e tenta pagar 20.20
      await act(async () => {
        getCtx().updateTransaction(tx.id, { amount: 10.1 });

        // Como a transação foi reduzida para 10.10, tentar pagar 20.20 DEVE ser rejeitado
        expect(() => {
          getCtx().recordPayment({
            transaction_id: tx.id,
            account_id: 'acc-1',
            amount: 20.2,
            payment_date: '2026-08-01',
          });
        }).toThrow(/excede o saldo restante da transação/i);
      });

      // Transação deve manter amount 10.10 e paid_amount 0 (sem pagamento extra)
      const updatedTx = getCtx().transactions.find((t) => t.id === tx.id);
      expect(updatedTx?.amount).toBe(10.1);
      expect(updatedTx?.paid_amount || 0).toBe(0);
      expect(updatedTx?.status).toBe('pending');

      // Nenhum pagamento registrado
      const pay = getCtx().payments.find((p) => p.transaction_id === tx.id);
      expect(pay).toBeUndefined();

      // Saldo da conta permaneceu rigorosamente intacto
      const accAfter = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      expect(accAfter.current_balance).toBe(balanceBefore);
    });

    it('deve estornar na conta efetiva de pagamento ao excluir transação (Vínculo acc-1, Pagamento acc-2) (P0-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const acc1Before = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      const acc2Before = getCtx().accounts.find((a) => a.id === 'acc-2')!;
      const bal1Before = acc1Before.current_balance;
      const bal2Before = acc2Before.current_balance;

      let tx: any;
      await act(async () => {
        tx = getCtx().addTransaction({
          type: 'expense',
          amount: 30.30,
          description: 'Despesa Cruzada P0-01',
          category_id: 'cat-1',
          account_id: 'acc-1',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
      });

      await act(async () => {
        getCtx().recordPayment({
          transaction_id: tx.id,
          account_id: 'acc-2',
          amount: 30.30,
          payment_date: '2026-08-01',
        });
      });

      // acc-1 permanece intacta; acc-2 foi debitada em 30.30
      expect(getCtx().accounts.find((a) => a.id === 'acc-1')!.current_balance).toBe(bal1Before);
      expect(getCtx().accounts.find((a) => a.id === 'acc-2')!.current_balance).toBe(fromCents(toCents(bal2Before) - 3030));

      await act(async () => {
        getCtx().deleteTransaction(tx.id);
      });

      // Ambas as contas devem retornar exatamente aos seus saldos iniciais
      expect(getCtx().accounts.find((a) => a.id === 'acc-1')!.current_balance).toBe(bal1Before);
      expect(getCtx().accounts.find((a) => a.id === 'acc-2')!.current_balance).toBe(bal2Before);
      expect(getCtx().transactions.find((t) => t.id === tx.id)).toBeUndefined();
      expect(getCtx().payments.filter((p) => p.transaction_id === tx.id)).toHaveLength(0);
    });

    it('deve estornar na conta do pagamento ao excluir transação sem conta vinculada (P0-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const acc2Before = getCtx().accounts.find((a) => a.id === 'acc-2')!;
      const bal2Before = acc2Before.current_balance;

      let tx: any;
      await act(async () => {
        tx = getCtx().addTransaction({
          type: 'expense',
          amount: 30.30,
          description: 'Despesa Sem Conta P0-01',
          category_id: 'cat-1',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
      });

      await act(async () => {
        getCtx().recordPayment({
          transaction_id: tx.id,
          account_id: 'acc-2',
          amount: 30.30,
          payment_date: '2026-08-01',
        });
      });

      expect(getCtx().accounts.find((a) => a.id === 'acc-2')!.current_balance).toBe(fromCents(toCents(bal2Before) - 3030));

      await act(async () => {
        getCtx().deleteTransaction(tx.id);
      });

      expect(getCtx().accounts.find((a) => a.id === 'acc-2')!.current_balance).toBe(bal2Before);
    });

    it('deve estornar proporcionalmente para múltiplas contas de pagamento ao excluir transação (P0-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const acc1Before = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      const acc2Before = getCtx().accounts.find((a) => a.id === 'acc-2')!;
      const bal1Before = acc1Before.current_balance;
      const bal2Before = acc2Before.current_balance;

      let tx: any;
      await act(async () => {
        tx = getCtx().addTransaction({
          type: 'expense',
          amount: 30.30,
          description: 'Despesa Fracionada P0-01',
          category_id: 'cat-1',
          account_id: 'acc-1',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
      });

      await act(async () => {
        getCtx().recordPayment({
          transaction_id: tx.id,
          account_id: 'acc-1',
          amount: 10.10,
          payment_date: '2026-08-01',
        });
        getCtx().recordPayment({
          transaction_id: tx.id,
          account_id: 'acc-2',
          amount: 20.20,
          payment_date: '2026-08-01',
        });
      });

      expect(getCtx().accounts.find((a) => a.id === 'acc-1')!.current_balance).toBe(fromCents(toCents(bal1Before) - 1010));
      expect(getCtx().accounts.find((a) => a.id === 'acc-2')!.current_balance).toBe(fromCents(toCents(bal2Before) - 2020));

      await act(async () => {
        getCtx().deleteTransaction(tx.id);
      });

      expect(getCtx().accounts.find((a) => a.id === 'acc-1')!.current_balance).toBe(bal1Before);
      expect(getCtx().accounts.find((a) => a.id === 'acc-2')!.current_balance).toBe(bal2Before);
    });

    it('duplicateTransaction: deve duplicar transação com sufixo (Cópia) e status pendente', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();

      let duplicated: any;
      await act(async () => {
        duplicated = getCtx().duplicateTransaction('tx-1');
      });

      expect(duplicated).toBeDefined();
      expect(duplicated.description).toContain('(Cópia)');
      expect(duplicated.status).toBe('pending');
      expect(duplicated.paid_amount).toBe(0);
      expect(duplicated.paid_at).toBeNull();
      expect(getCtx().transactions.some((t) => t.id === duplicated.id)).toBe(true);
    });

    it('guardas defensivas: validações de createInstallmentPurchase e updateTransaction', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();

      // Compra parcelada com valor <= 0
      expect(() => {
        getCtx().createInstallmentPurchase({
          description: 'Teste Valor Zero',
          total_amount: 0,
          installment_count: 2,
          purchase_date: '2026-09-19',
        });
      }).toThrow(/maior que zero/i);

      // Compra parcelada com conta de outro workspace
      expect(() => {
        getCtx().createInstallmentPurchase({
          description: 'Teste Conta Outro WS',
          total_amount: 100,
          installment_count: 2,
          purchase_date: '2026-09-19',
          account_id: 'acc-inexistente-ws999',
        });
      }).toThrow(/não pertence ao workspace ativo/i);

      // updateTransaction: alteração de valor em transação já quitada (tx-1 está paid nos mocks)
      expect(() => {
        getCtx().updateTransaction('tx-1', { amount: 9999 });
      }).toThrow(/transações já quitadas ou faturadas/i);

      // updateTransaction: alteração para valor inválido em transação pendente
      let pendTx: any;
      await act(async () => {
        pendTx = getCtx().addTransaction({
          description: 'Pendente',
          amount: 50,
          type: 'expense',
          transaction_date: '2026-09-19',
          due_date: '2026-09-19',
          status: 'pending',
        });
      });

      expect(() => {
        getCtx().updateTransaction(pendTx.id, { amount: -5 });
      }).toThrow(/maior que zero/i);
    });

    it('transaction-actions: exercita branches de addTransaction, updateTransaction, deleteTransaction e duplicateTransaction', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      // 1. addTransaction: receita com cartão de crédito (proibido)
      expect(() => {
        getCtx().addTransaction({
          description: 'Receita no Cartão',
          amount: 500,
          type: 'income',
          credit_card_id: 'card-1',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
      }).toThrow('Receitas não podem ser vinculadas a cartão de crédito ou faturas.');

      // 2. addTransaction: conta bancária inexistente ou inativa
      expect(() => {
        getCtx().addTransaction({
          description: 'Conta Inexistente',
          amount: 50,
          type: 'expense',
          account_id: 'acc-inexistente',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
      }).toThrow('Conta bancária informada não pertence ao workspace ativo.');

      await act(async () => {
        getCtx().updateAccount('acc-1', { active: false });
      });

      expect(() => {
        getCtx().addTransaction({
          description: 'Conta Inativa',
          amount: 50,
          type: 'expense',
          account_id: 'acc-1',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
      }).toThrow('A conta bancária informada está inativa.');

      // Reativar conta para os testes subsequentes
      await act(async () => {
        getCtx().updateAccount('acc-1', { active: true });
      });

      // 3. addTransaction: receita paga imediata (incrementa saldo da conta)
      const accBefore = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      const balanceBefore = accBefore.current_balance;

      let incomePaidTx: any;
      await act(async () => {
        incomePaidTx = getCtx().addTransaction({
          description: 'Receita Paga Imediata',
          amount: 250,
          type: 'income',
          account_id: 'acc-1',
          category_id: getCtx().categories.find((c) => c.type === 'income')?.id,
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'paid',
        });
      });

      const accAfterIncome = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      expect(accAfterIncome.current_balance).toBe(balanceBefore + 250);

      // 4. deleteTransaction: excluir receita paga sem pagamento registrado deve estornar saldo
      await act(async () => {
        getCtx().deleteTransaction(incomePaidTx.id);
      });

      const accAfterDeleteIncome = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      expect(accAfterDeleteIncome.current_balance).toBe(balanceBefore);

      // 5. deleteTransaction: ID inexistente retorna sem erro (no-op)
      await act(async () => {
        getCtx().deleteTransaction('tx-inexistente-1234');
      });

      // 6. duplicateTransaction: ID inexistente retorna null
      let dupResult: any;
      await act(async () => {
        dupResult = getCtx().duplicateTransaction('tx-inexistente-1234');
      });
      expect(dupResult).toBeNull();

      // 7. updateTransaction: ID inexistente retorna sem erro (no-op)
      await act(async () => {
        getCtx().updateTransaction('tx-inexistente-1234', { description: 'Nova Desc' });
      });

      // Adicionar segundo membro ao workspace ativo para permitir testes de rateio
      await act(async () => {
        getCtx().addWorkspaceMember('membro2@exemplo.com', 'member');
      });
      const members = getCtx().workspaceMembers;
      const m1 = members[0]?.id;
      const m2 = members[1]?.id;

      // 8. updateTransaction: rateio personalizado (custom) sem fornecer novos splits ao mudar valor
      let customTx: any;
      await act(async () => {
        customTx = getCtx().addTransaction({
          description: 'Despesa Custom Split',
          amount: 100,
          type: 'expense',
          category_id: getCtx().categories[0]?.id,
          account_id: 'acc-1',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
          split_type: 'custom',
          paid_by_member_id: m1,
          splits: [
            { member_id: m1, amount: 60 },
            { member_id: m2, amount: 40 },
          ],
        });
      });

      expect(() => {
        getCtx().updateTransaction(customTx.id, { amount: 120 });
      }).toThrow(/obrigatório fornecer os novos valores de rateio/i);

      // 9. updateTransaction: rateio igual (equal) recalcula splits automaticamente ao mudar valor
      let equalTx: any;
      await act(async () => {
        equalTx = getCtx().addTransaction({
          description: 'Despesa Equal Split',
          amount: 100,
          type: 'expense',
          category_id: getCtx().categories[0]?.id,
          account_id: 'acc-1',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
          split_type: 'equal',
          paid_by_member_id: m1,
          splits: [
            { member_id: m1, amount: 50 },
            { member_id: m2, amount: 50 },
          ],
        });
      });

      await act(async () => {
        getCtx().updateTransaction(equalTx.id, {
          amount: 200,
          description: 'Despesa Equal Atualizada',
          notes: 'Notas atualizadas',
          due_date: '2026-08-15',
          transaction_date: '2026-08-02',
          category_id: getCtx().categories[0]?.id,
        });
      });

      const updatedEqual = getCtx().transactions.find((t) => t.id === equalTx.id);
      expect(updatedEqual?.amount).toBe(200);
      expect(updatedEqual?.description).toBe('Despesa Equal Atualizada');
      expect(updatedEqual?.notes).toBe('Notas atualizadas');
      expect(updatedEqual?.splits).toBeDefined();
      expect(updatedEqual?.splits?.[0].amount).toBe(100);
      expect(updatedEqual?.splits?.[1].amount).toBe(100);

      // 10. action-helpers: validação full_other onde pagador tem fração > 0 (linha 135)
      expect(() => {
        getCtx().addTransaction({
          description: 'Full Other com fração do pagador',
          amount: 100,
          type: 'expense',
          category_id: getCtx().categories[0]?.id,
          account_id: 'acc-1',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
          split_type: 'full_other',
          paid_by_member_id: m1,
          splits: [
            { member_id: m1, amount: 50 },
            { member_id: m2, amount: 50 },
          ],
        });
      }).toThrow('Na regra 100% de outra pessoa, o pagador não pode possuir fração atribuída a si mesmo.');

      // 11. action-helpers: validação full_other divergente do cálculo canônico (linhas 174 e 182)
      await act(async () => {
        getCtx().addWorkspaceMember('membro3@exemplo.com', 'member');
      });
      const m3 = getCtx().workspaceMembers[2]?.id;

      // Divergência de contagem de frações (linha 174: espera 2 frações m2 e m3, enviou 1)
      expect(() => {
        getCtx().addTransaction({
          description: 'Full Other contagem divergente',
          amount: 100,
          type: 'expense',
          category_id: getCtx().categories[0]?.id,
          account_id: 'acc-1',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
          split_type: 'full_other',
          paid_by_member_id: m1,
          splits: [{ member_id: m2, amount: 100 }],
        });
      }).toThrow(/diverge do cálculo canônico para a regra 'full_other'/i);

      // Divergência de valor de fração (linha 182: canônico é 50/50, enviou 60/40)
      expect(() => {
        getCtx().addTransaction({
          description: 'Full Other valor divergente',
          amount: 100,
          type: 'expense',
          category_id: getCtx().categories[0]?.id,
          account_id: 'acc-1',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
          split_type: 'full_other',
          paid_by_member_id: m1,
          splits: [
            { member_id: m2, amount: 60 },
            { member_id: m3, amount: 40 },
          ],
        });
      }).toThrow(/diverge do cálculo canônico para a regra 'full_other'/i);
    });

    it('updateTransaction deve preservar splits válidos existentes ao atualizar apenas descrição ou notas', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();

      // 1. Cria transação com split_type 'equal'
      let txEqual: any;
      await act(async () => {
        txEqual = getCtx().addTransaction({
          description: 'Despesa Equal',
          amount: 100,
          type: 'expense',
          paid_by_member_id: 'wsm-1',
          split_type: 'equal',
          splits: [
            { member_id: 'wsm-1', amount: 100 },
          ],
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
      });

      // Atualiza apenas a descrição (deve cair na linha 199 validando os splits existentes)
      await act(async () => {
        getCtx().updateTransaction(txEqual.id, { description: 'Despesa Equal Atualizada' });
      });

      const updatedEqual = getCtx().transactions.find((t) => t.id === txEqual.id);
      expect(updatedEqual?.description).toBe('Despesa Equal Atualizada');

      // 2. Cria transação com split_type 'custom'
      let txCustom: any;
      await act(async () => {
        txCustom = getCtx().addTransaction({
          description: 'Despesa Custom',
          amount: 100,
          type: 'expense',
          paid_by_member_id: 'wsm-1',
          split_type: 'custom',
          splits: [
            { member_id: 'wsm-1', amount: 100 },
          ],
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
      });

      // Atualiza apenas notas (deve cair na linha 207 validando os splits existentes)
      await act(async () => {
        getCtx().updateTransaction(txCustom.id, { notes: 'Nova anotação' });
      });

      const updatedCustom = getCtx().transactions.find((t) => t.id === txCustom.id);
      expect(updatedCustom?.notes).toBe('Nova anotação');
    });

    it('deleteTransaction deve estornar saldo de conta ao excluir receita quitada sem pagamentos avulsos', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();

      const accBefore = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      const balBefore = accBefore.current_balance;

      let incomeTx: any;
      await act(async () => {
        incomeTx = getCtx().addTransaction({
          description: 'Receita Direta Quitada',
          amount: 500,
          type: 'income',
          account_id: 'acc-1',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'paid',
        });
      });

      // Exclui a receita quitada: o saldo da conta deve reverter (-500)
      await act(async () => {
        getCtx().deleteTransaction(incomeTx.id);
      });

      const accAfter = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      expect(accAfter.current_balance).toBe(balBefore);
    });

    it('recordPayment deve rejeitar valor <= 0', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();

      expect(() => {
        getCtx().recordPayment({
          transaction_id: 'tx-1',
          account_id: 'acc-1',
          amount: 0,
          payment_date: '2026-08-01',
        });
      }).toThrow(/O valor do pagamento deve ser estritamente maior que zero/i);

      expect(() => {
        getCtx().recordPayment({
          transaction_id: 'tx-1',
          account_id: 'acc-1',
          amount: -50,
          payment_date: '2026-08-01',
        });
      }).toThrow(/O valor do pagamento deve ser estritamente maior que zero/i);
    });

    it('recordPayment deve lançar erro se nenhum identificador de alvo suportado for informado', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();

      expect(() => {
        getCtx().recordPayment({
          amount: 50,
          account_id: 'acc-1',
          payment_date: '2026-08-01',
        } as any);
      }).toThrow('Informe exatamente uma obrigação de destino para o pagamento.');
    });

    it('updateTransaction com splits explícitos e deleteTransaction de despesa quitada direta sem pagamentos avulsos', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();

      // 1. updateTransaction com data.splits !== undefined em workspace compartilhado ws-2 (linhas 189-190)
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

      let tx: any;
      await act(async () => {
        tx = getCtx().addTransaction({
          description: 'Despesa para Splits Explícitos',
          amount: 100,
          type: 'expense',
          category_id: catWs2.id,
          split_type: 'equal',
          splits: [
            { member_id: 'wsm-2', amount: 50 },
            { member_id: 'wsm-3', amount: 50 },
          ],
          status: 'paid',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
        });
      });

      await act(async () => {
        getCtx().updateTransaction(tx.id, {
          splits: [
            { member_id: 'wsm-2', amount: 70 },
            { member_id: 'wsm-3', amount: 30 },
          ],
          split_type: 'custom',
        });
      });

      const updated = getCtx().transactions.find((t) => t.id === tx.id);
      expect(updated?.splits?.[0].amount).toBe(70);

      // Retorna para ws-1 para testes de conta bancária acc-1
      await act(async () => {
        getCtx().setActiveWorkspaceId('ws-1');
      });

      // 2. deleteTransaction de despesa quitada direta na criação sem pagamentos avulsos (linhas 270-274)
      const accBefore = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      const balBefore = accBefore.current_balance;

      let paidExpense: any;
      await act(async () => {
        paidExpense = getCtx().addTransaction({
          description: 'Despesa Quitada Direta',
          amount: 120,
          type: 'expense',
          category_id: 'cat-1',
          account_id: 'acc-1',
          status: 'paid',
          paid_amount: 120,
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
        });
      });

      // Saldo reduziu em 120
      expect(getCtx().accounts.find((a) => a.id === 'acc-1')!.current_balance).toBe(fromCents(toCents(balBefore) - 12000));

      // Exclui a despesa quitada direta -> saldo deve estornar (+120)
      await act(async () => {
        getCtx().deleteTransaction(paidExpense.id);
      });

      expect(getCtx().accounts.find((a) => a.id === 'acc-1')!.current_balance).toBe(balBefore);

      // 3. deleteTransaction de despesa parcialmente quitada sem pagamentos avulsos
      let partialExpense: any;
      await act(async () => {
        partialExpense = getCtx().addTransaction({
          description: 'Despesa Parcial Direta',
          amount: 200,
          type: 'expense',
          category_id: 'cat-1',
          account_id: 'acc-1',
          status: 'partially_paid',
          paid_amount: 80,
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
        });
      });

      await act(async () => {
        getCtx().deleteTransaction(partialExpense.id);
      });

      expect(getCtx().accounts.find((a) => a.id === 'acc-1')!.current_balance).toBe(fromCents(toCents(balBefore) + 8000));
    });

    it('addTransaction: deve rejeitar receita vinculada a cartão de crédito (linha 56)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();

      expect(() => {
        getCtx().addTransaction({
          description: 'Receita no Cartão Proibida',
          amount: 250,
          type: 'income',
          credit_card_id: 'card-1',
          status: 'paid',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
        });
      }).toThrow('Receitas não podem ser vinculadas a cartão de crédito ou faturas.');
    });
});

