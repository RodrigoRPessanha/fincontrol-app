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

describe('FinanceProvider - Pagamentos e Aritmética Monetária', () => {
  const { storageMap, mountProvider } = setupFinanceHarness();

    it('deve converter e comparar valores monetários sem distorção de float', () => {
      // 10.10 + 20.20 no IEEE 754 cru é 30.299999999999997
      const rawFloatSum = 10.1 + 20.2;
      expect(rawFloatSum).not.toBe(30.3);
      expect(toCents(rawFloatSum)).toBe(3030);
      expect(fromCents(3030)).toBe(30.3);
      expect(roundCurrency(rawFloatSum)).toBe(30.3);

      // Comparações de centavos
      expect(compareCurrency(rawFloatSum, 30.3)).toBe(0);
      expect(compareCurrency(30.31, 30.3)).toBeGreaterThan(0);
      expect(compareCurrency(30.29, 30.3)).toBeLessThan(0);

      // 0.30 - 0.10 no IEEE 754 cru é 0.19999999999999998
      const rawFloatDiff = 0.3 - 0.1;
      expect(rawFloatDiff).not.toBe(0.2);
      expect(toCents(rawFloatDiff)).toBe(20);
      expect(fromCents(20)).toBe(0.2);
      expect(roundCurrency(rawFloatDiff)).toBe(0.2);
    });

    it('deve aplicar precisão de centavos em recordPayment para transações e parcelas', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));

      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      // 1. Criar transação à vista com valor 30.30
      let tx: any;
      await act(async () => {
        tx = getCtx().addTransaction({
          description: 'Serviço pontual 30.30',
          amount: 30.3,
          type: 'expense',
          transaction_date: '2026-08-02',
          due_date: '2026-08-02',
          account_id: 'acc-1',
          category_id: getCtx().categories[0]?.id,
          status: 'pending',
        });
      });

      // Pagar parcial de 10.10
      await act(async () => {
        getCtx().recordPayment({
          transaction_id: tx.id,
          account_id: 'acc-1',
          amount: 10.1,
          payment_date: '2026-08-02',
        });
      });

      let currentTx = getCtx().transactions.find((t) => t.id === tx.id);
      expect(currentTx?.status).toBe('partially_paid');
      expect(currentTx?.paid_amount).toBe(10.1);

      // Pagar restante de 20.20 (total 30.30) - sem erro de float
      await act(async () => {
        getCtx().recordPayment({
          transaction_id: tx.id,
          account_id: 'acc-1',
          amount: 20.2,
          payment_date: '2026-08-02',
        });
      });

      currentTx = getCtx().transactions.find((t) => t.id === tx.id);
      expect(currentTx?.status).toBe('paid');
      expect(currentTx?.paid_amount).toBe(30.3);

      // Tentar pagar mais 0.01 deve ser rejeitado
      expect(() => {
        getCtx().recordPayment({
          transaction_id: tx.id,
          account_id: 'acc-1',
          amount: 0.01,
          payment_date: '2026-08-02',
        });
      }).toThrow(/excede o saldo restante da transação/i);

      // 2. Criar compra parcelada fora de cartão com parcela de 30.30 (V35 / P2-01)
      let pur: any;
      await act(async () => {
        pur = getCtx().createInstallmentPurchase({
          description: 'Parcelamento 30.30',
          total_amount: 30.3,
          installment_count: 1,
          purchase_date: '2026-08-02',
          account_id: 'acc-1',
          category_id: getCtx().categories[0]?.id,
        });
      });
      const inst = getCtx().installments.find((i) => i.purchase_id === pur.id);
      expect(inst).toBeDefined();
      const instId = inst!.id;

      // Pagar parcial de 10.10 na parcela
      await act(async () => {
        getCtx().recordPayment({
          installment_id: instId,
          account_id: 'acc-1',
          amount: 10.1,
          payment_date: '2026-08-02',
        });
      });
      let currentInst = getCtx().installments.find((i) => i.id === instId);
      expect(currentInst?.status).toBe('partially_paid');
      expect(currentInst?.paid_amount).toBe(10.1);

      // Pagar restante de 20.20 (total 30.30)
      await act(async () => {
        getCtx().recordPayment({
          installment_id: instId,
          account_id: 'acc-1',
          amount: 20.2,
          payment_date: '2026-08-02',
        });
      });
      currentInst = getCtx().installments.find((i) => i.id === instId);
      expect(currentInst?.status).toBe('paid');
      expect(currentInst?.paid_amount).toBe(30.3);

      // Tentar pagar 0.01 adicional deve ser rejeitado
      expect(() => {
        getCtx().recordPayment({
          installment_id: instId,
          account_id: 'acc-1',
          amount: 0.01,
          payment_date: '2026-08-02',
        });
      }).toThrow(/excede o saldo restante da parcela/i);
    });

    it('deve formalizar política determinística de arredondamento para >2 casas decimais (V35 / P2-03)', () => {
      expect(roundCurrency(1.005)).toBe(1.01);
      expect(roundCurrency(1.004)).toBe(1.0);
      expect(toCents(1.005)).toBe(101);
      expect(toCents(1.004)).toBe(100);
      expect(fromCents(101)).toBe(1.01);
    });

    it('deve calcular toCents e roundCurrency com half-up exponencial imune a erros de escala IEEE 754 (V36 / P2-02)', () => {
      // 10.075 * 100 em float IEEE 754 dá 1007.499999999999886...
      // Com arredondamento exponencial comercial half-up:
      expect(toCents(10.075)).toBe(1008);
      expect(roundCurrency(10.075)).toBe(10.08);
      expect(toCents(10.074)).toBe(1007);
      expect(roundCurrency(10.074)).toBe(10.07);

      // Casos negativos simétricos
      expect(toCents(-10.075)).toBe(-1008);
      expect(roundCurrency(-10.075)).toBe(-10.08);
      expect(toCents(-10.074)).toBe(-1007);
      expect(roundCurrency(-10.074)).toBe(-10.07);

      // Tratamento defensivo de valores não-finitos
      expect(toCents(NaN)).toBe(0);
      expect(toCents(Infinity)).toBe(0);
      expect(toCents(-Infinity)).toBe(0);
      expect(fromCents(NaN)).toBe(0);
      expect(roundCurrency(NaN)).toBe(0);

      // Normalização de zero
      expect(Object.is(toCents(-0), 0)).toBe(true);
      expect(Object.is(fromCents(-0), 0)).toBe(true);
    });

    it('deve suportar chamadas agrupadas no mesmo lote (batching) em recordPayment preservando acumulador funcional (V36 / P1-02)', async () => {
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
          description: 'Despesa Parcelada V36',
          category_id: 'cat-1',
          account_id: 'acc-1',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
      });

      // Duas quitações parciais no MESMO act/lote: 10.10 + 20.20 = 30.30
      await act(async () => {
        getCtx().recordPayment({
          transaction_id: tx.id,
          account_id: 'acc-1',
          amount: 10.1,
          payment_date: '2026-08-01',
        });
        getCtx().recordPayment({
          transaction_id: tx.id,
          account_id: 'acc-1',
          amount: 20.2,
          payment_date: '2026-08-01',
        });
      });

      const updatedTx = getCtx().transactions.find((t) => t.id === tx.id);
      expect(updatedTx?.paid_amount).toBe(30.3);
      expect(updatedTx?.status).toBe('paid');

      // Saldo da conta foi debitado em 10.10 + 20.20 = 30.30
      const accAfter = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      expect(accAfter.current_balance).toBe(fromCents(toCents(balanceBefore) - 3030));
    });

    it('deve rejeitar atomicamente sobrepagamento agrupado em transações no mesmo lote (V36 / P1-01)', async () => {
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
          description: 'Despesa Concorrente V36',
          category_id: 'cat-1',
          account_id: 'acc-1',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
      });

      // Duas chamadas de 20.20 no mesmo act/lote: a 1ª passa, a 2ª deve falhar
      await act(async () => {
        getCtx().recordPayment({
          transaction_id: tx.id,
          account_id: 'acc-1',
          amount: 20.2,
          payment_date: '2026-08-01',
        });

        expect(() => {
          getCtx().recordPayment({
            transaction_id: tx.id,
            account_id: 'acc-1',
            amount: 20.2,
            payment_date: '2026-08-01',
          });
        }).toThrow(/excede o saldo restante/i);
      });

      const updatedTx = getCtx().transactions.find((t) => t.id === tx.id);
      expect(updatedTx?.paid_amount).toBe(20.2);
      expect(updatedTx?.status).toBe('partially_paid');

      // Conta debitada estritamente em 20.20 (não 40.40)
      const accAfter = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      expect(accAfter.current_balance).toBe(fromCents(toCents(balanceBefore) - 2020));
    });

    it('deve rejeitar atomicamente sobrepagamento agrupado em parcelas no mesmo lote (V36 / P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const accBefore = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      const balanceBefore = accBefore.current_balance;

      // Criar compra parcelada avulsa (sem cartão)
      let pur: any;
      await act(async () => {
        pur = getCtx().createInstallmentPurchase({
          description: 'Curso Parcelado V36',
          total_amount: 30.3,
          category_id: 'cat-1',
          installment_count: 1,
          purchase_date: '2026-08-01',
          account_id: 'acc-1',
        });
      });

      const inst = getCtx().installments.find((i) => i.purchase_id === pur.id)!;
      expect(inst).toBeDefined();

      await act(async () => {
        getCtx().recordPayment({
          installment_id: inst.id,
          account_id: 'acc-1',
          amount: 20.2,
          payment_date: '2026-08-01',
        });

        expect(() => {
          getCtx().recordPayment({
            installment_id: inst.id,
            account_id: 'acc-1',
            amount: 20.2,
            payment_date: '2026-08-01',
          });
        }).toThrow(/excede o saldo restante/i);
      });

      const updatedInst = getCtx().installments.find((i) => i.id === inst.id);
      expect(updatedInst?.paid_amount).toBe(20.2);
      expect(updatedInst?.status).toBe('partially_paid');

      const accAfter = getCtx().accounts.find((a) => a.id === 'acc-1')!;
      expect(accAfter.current_balance).toBe(fromCents(toCents(balanceBefore) - 2020));
    });

    it('deve rejeitar recordPayment com conta de outro workspace ou inativa preservando saldos (P1-02)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const customAccounts = [
        { id: 'acc-main', workspace_id: 'ws-1', name: 'Conta Principal', type: 'checking', institution: 'Nubank', initial_balance: 100, current_balance: 100, color: '#000', active: true, created_at: '2026-01-01' },
        { id: 'acc-ws2', workspace_id: 'ws-2', name: 'Conta WS2', type: 'checking', institution: 'Nubank', initial_balance: 100, current_balance: 100, color: '#000', active: true, created_at: '2026-01-01' },
        { id: 'acc-inactive', workspace_id: 'ws-1', name: 'Conta Inativa', type: 'checking', institution: 'Nubank', initial_balance: 100, current_balance: 100, color: '#000', active: false, created_at: '2026-01-01' },
      ];
      storageMap.set('fincontrol_v2_accounts', JSON.stringify(customAccounts));

      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      let tx: any;
      await act(async () => {
        tx = getCtx().addTransaction({
          type: 'expense',
          amount: 10.10,
          description: 'Despesa WS Validação',
          category_id: 'cat-1',
          account_id: 'acc-main',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
      });

      // Conta de outro workspace
      await act(async () => {
        expect(() => {
          getCtx().recordPayment({
            transaction_id: tx.id,
            account_id: 'acc-ws2',
            amount: 10.10,
            payment_date: '2026-08-01',
          });
        }).toThrow(/não encontrada no workspace ativo/i);
      });

      // Conta inativa
      await act(async () => {
        expect(() => {
          getCtx().recordPayment({
            transaction_id: tx.id,
            account_id: 'acc-inactive',
            amount: 10.10,
            payment_date: '2026-08-01',
          });
        }).toThrow(/está inativa/i);
      });

      // Nenhum pagamento criado e nenhum saldo alterado
      expect(getCtx().payments.filter((p) => p.transaction_id === tx.id)).toHaveLength(0);
      expect(getCtx().accounts.find((a) => a.id === 'acc-main')!.current_balance).toBe(100);
    });

    it('deve rejeitar pagamento após inativar conta no mesmo lote (P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      const balBefore = getCtx().accounts.find((a) => a.id === 'acc-1')!.current_balance;

      let tx: any;
      await act(async () => {
        tx = getCtx().addTransaction({
          type: 'expense',
          amount: 10.10,
          description: 'Despesa Inativa Lote',
          category_id: 'cat-1',
          account_id: 'acc-1',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
      });

      await act(async () => {
        getCtx().updateAccount('acc-1', { active: false });
        expect(() => {
          getCtx().recordPayment({
            transaction_id: tx.id,
            account_id: 'acc-1',
            amount: 10.10,
            payment_date: '2026-08-01',
          });
        }).toThrow(/está inativa/i);
      });

      // Saldo inalterado e nenhum pagamento gerado
      expect(getCtx().allWorkspaceAccounts.find((a) => a.id === 'acc-1')!.current_balance).toBe(balBefore);
      expect(getCtx().payments.filter((p) => p.transaction_id === tx.id)).toHaveLength(0);
    });

    it('deve rejeitar pagamento após excluir conta no mesmo lote (P1-01)', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      let cleanAcc: any;
      let tx: any;
      await act(async () => {
        cleanAcc = getCtx().addAccount({
          name: 'Conta para Exclusão Física',
          type: 'checking',
          institution: 'Nubank',
          initial_balance: 100.0,
          current_balance: 100.0,
          color: '#000',
          active: true,
        });

        tx = getCtx().addTransaction({
          type: 'expense',
          amount: 10.10,
          description: 'Despesa Excluída Lote',
          category_id: 'cat-1',
          account_id: cleanAcc.id,
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
      });

      await act(async () => {
        const delRes = getCtx().deleteAccount(cleanAcc.id);
        expect(delRes.action).toBe('deleted');

        expect(() => {
          getCtx().recordPayment({
            transaction_id: tx.id,
            account_id: cleanAcc.id,
            amount: 10.10,
            payment_date: '2026-08-01',
          });
        }).toThrow(/não encontrada/i);
      });

      expect(getCtx().payments.filter((p) => p.transaction_id === tx.id)).toHaveLength(0);
    });

    it('recordPayment: exercita payment_method_id (linha 45), validação de alvos e proteções de cartão', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      // 1. targetsCount !== 1 (0 ou 2 alvos)
      expect(() => {
        getCtx().recordPayment({
          amount: 50,
          payment_date: '2026-08-01',
        });
      }).toThrow('Informe exatamente uma obrigação de destino para o pagamento.');

      expect(() => {
        getCtx().recordPayment({
          transaction_id: 'tx-1',
          installment_id: 'inst-1',
          amount: 50,
          payment_date: '2026-08-01',
        });
      }).toThrow('Informe exatamente uma obrigação de destino para o pagamento.');

      // 2. payment_method_id de outro workspace ou inexistente (linha 45 & 46)
      let pendingTx: any;
      await act(async () => {
        pendingTx = getCtx().addTransaction({
          type: 'expense',
          amount: 100,
          description: 'Despesa para Teste de Pagamento',
          category_id: getCtx().categories[0]?.id,
          account_id: 'acc-1',
          transaction_date: '2026-08-01',
          due_date: '2026-08-01',
          status: 'pending',
        });
      });

      expect(() => {
        getCtx().recordPayment({
          transaction_id: pendingTx.id,
          account_id: 'acc-1',
          payment_method_id: 'pm-inexistente',
          amount: 50,
          payment_date: '2026-08-01',
        });
      }).toThrow('Método de pagamento não pertence ao workspace ativo.');

      // 3. payment_method_id válido do workspace ativo (linha 45 satisfeita)
      let successfulPay: any;
      await act(async () => {
        successfulPay = getCtx().recordPayment({
          transaction_id: pendingTx.id,
          account_id: 'acc-1',
          payment_method_id: 'pm-1',
          amount: 50,
          payment_date: '2026-08-01',
          notes: 'Pagamento parcial com método PM-1',
        });
      });

      expect(successfulPay).toBeDefined();
      expect(successfulPay.payment_method_id).toBe('pm-1');
      expect(successfulPay.amount).toBe(50);

      const txAfterPartial = getCtx().transactions.find((t) => t.id === pendingTx.id);
      expect(txAfterPartial?.status).toBe('partially_paid');
      expect(txAfterPartial?.paid_amount).toBe(50);

      // 4. Quitação avulsa de transação de cartão de crédito deve ser rejeitada
      let cardTx: any;
      await act(async () => {
        cardTx = getCtx().addTransaction({
          type: 'expense',
          amount: 80,
          description: 'Despesa no Cartão',
          category_id: getCtx().categories[0]?.id,
          credit_card_id: 'card-1',
          transaction_date: '2026-08-01',
          due_date: '2026-08-10',
          status: 'pending',
        });
      });

      expect(() => {
        getCtx().recordPayment({
          transaction_id: cardTx.id,
          account_id: 'acc-1',
          amount: 80,
          payment_date: '2026-08-01',
        });
      }).toThrow('Itens vinculados a cartão de crédito devem ser quitados exclusivamente através da fatura correspondente.');

      // 5. Transação inexistente no workspace
      expect(() => {
        getCtx().recordPayment({
          transaction_id: 'tx-inexistente',
          account_id: 'acc-1',
          amount: 50,
          payment_date: '2026-08-01',
        });
      }).toThrow('Transação não encontrada no workspace ativo.');
    });

    it('recordPayment: quitação de parcelas normais, rejeição de parcelas de cartão e fatura via credit_card_bill_id', async () => {
      storageMap.set('fincontrol_v2_recurring', JSON.stringify([]));
      const { getCtx } = await mountProvider();
      expect(getCtx().isLoaded).toBe(true);

      // 1. Parcela de cartão de crédito deve ser rejeitada
      let cardPurchase: any;
      await act(async () => {
        cardPurchase = getCtx().createInstallmentPurchase({
          description: 'Compra no Cartão Parcelada',
          total_amount: 600,
          installment_count: 3,
          purchase_date: '2026-08-01',
          credit_card_id: 'card-1',
          category_id: getCtx().categories[0]?.id,
        });
      });

      const cardInst = getCtx().installments.find((i) => i.purchase_id === cardPurchase.id);
      expect(cardInst).toBeDefined();

      expect(() => {
        getCtx().recordPayment({
          installment_id: cardInst?.id,
          account_id: 'acc-1',
          amount: 200,
          payment_date: '2026-08-01',
        });
      }).toThrow('Parcelas vinculadas a cartão de crédito devem ser quitadas exclusivamente através da fatura correspondente.');

      // 2. Parcela inexistente
      expect(() => {
        getCtx().recordPayment({
          installment_id: 'inst-inexistente',
          account_id: 'acc-1',
          amount: 100,
          payment_date: '2026-08-01',
        });
      }).toThrow('Parcela não encontrada.');

      // 3. Compra parcelada sem cartão (carnê/boleto em conta corrente)
      let nonCardPurchase: any;
      await act(async () => {
        nonCardPurchase = getCtx().createInstallmentPurchase({
          description: 'Curso Parcelado Boleto',
          total_amount: 400,
          installment_count: 2,
          purchase_date: '2026-08-01',
          account_id: 'acc-1',
          category_id: getCtx().categories[0]?.id,
        });
      });

      const nonCardInsts = getCtx().installments.filter((i) => i.purchase_id === nonCardPurchase.id);
      expect(nonCardInsts).toHaveLength(2);
      const firstInst = nonCardInsts[0];

      // Exceder valor da parcela (200)
      expect(() => {
        getCtx().recordPayment({
          installment_id: firstInst.id,
          account_id: 'acc-1',
          amount: 250,
          payment_date: '2026-08-01',
        });
      }).toThrow(/excede o saldo restante da parcela/i);

      // Pagamento parcial (R$ 50)
      await act(async () => {
        getCtx().recordPayment({
          installment_id: firstInst.id,
          account_id: 'acc-1',
          amount: 50,
          payment_date: '2026-08-01',
        });
      });

      let instAfterPartial = getCtx().installments.find((i) => i.id === firstInst.id);
      expect(instAfterPartial?.status).toBe('partially_paid');
      expect(instAfterPartial?.paid_amount).toBe(50);

      // Pagamento restante (R$ 150) -> total 200 quitado
      await act(async () => {
        getCtx().recordPayment({
          installment_id: firstInst.id,
          account_id: 'acc-1',
          amount: 150,
          payment_date: '2026-08-01',
        });
      });

      let instAfterFull = getCtx().installments.find((i) => i.id === firstInst.id);
      expect(instAfterFull?.status).toBe('paid');
      expect(instAfterFull?.paid_amount).toBe(200);

      // 4. Pagamento de fatura de cartão via credit_card_bill_id
      const existingBill = getCtx().creditCardBills[0];
      if (existingBill && existingBill.total_amount > 0) {
        let billPay: any;
        await act(async () => {
          billPay = getCtx().recordPayment({
            credit_card_bill_id: existingBill.id,
            account_id: 'acc-1',
            amount: existingBill.total_amount,
            payment_date: '2026-08-10',
            notes: 'Pagamento total da fatura',
          });
        });

        expect(billPay).toBeDefined();
        const billAfter = getCtx().creditCardBills.find((b) => b.id === existingBill.id);
        expect(billAfter?.status).toBe('paid');
      }
    });
});
