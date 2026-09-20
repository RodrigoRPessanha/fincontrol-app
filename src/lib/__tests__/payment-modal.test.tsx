import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { PaymentModal, parseCurrencyInput } from '@/components/transactions/PaymentModal';
import * as FinanceContext from '@/lib/context/finance-context';
import { toCents, fromCents } from '@/lib/financial-engine';

describe('PaymentModal Component & Cent-Accuracy Logic (V36 / P0-01 & P2-01)', () => {
  const mockRecordPayment = vi.fn();
  const mockPayCreditCardBill = vi.fn();
  const mockOnClose = vi.fn();

  const mockAccounts = [
    {
      id: 'acc-1',
      name: 'Conta Corrente Principal',
      type: 'checking',
      current_balance: 1000.0,
      color: '#3b82f6',
      icon: 'landmark',
      is_archived: false,
    },
    {
      id: 'acc-2',
      name: 'Reserva Financeira',
      type: 'savings',
      current_balance: 5000.0,
      color: '#10b981',
      icon: 'piggy-bank',
      is_archived: false,
    },
  ];

  function getReactProps(element: any): any {
    if (!element) return null;
    const key = Object.keys(element).find((k) => k.startsWith('__reactProps$'));
    return key ? element[key] : null;
  }

  function findNode(root: any, predicate: (node: any) => boolean): any {
    if (predicate(root)) return root;
    for (const child of root.childNodes || []) {
      const found = findNode(child, predicate);
      if (found) return found;
    }
    return null;
  }

  function findNodes(root: any, predicate: (node: any) => boolean): any[] {
    const list: any[] = [];
    if (predicate(root)) list.push(root);
    for (const child of root.childNodes || []) {
      list.push(...findNodes(child, predicate));
    }
    return list;
  }

  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(FinanceContext, 'useFinance').mockReturnValue({
      accounts: mockAccounts as any,
      recordPayment: mockRecordPayment,
      payCreditCardBill: mockPayCreditCardBill,
    } as any);

    // Mock DOM robusto para React 19
    class MockNode {
      nodeType = 1;
      childNodes: any[] = [];
      parentNode: any = null;
      ownerDocument: any = null;
      appendChild(child: any) { child.parentNode = this; this.childNodes.push(child); return child; }
      removeChild(child: any) { const idx = this.childNodes.indexOf(child); if (idx >= 0) this.childNodes.splice(idx, 1); child.parentNode = null; return child; }
      insertBefore(child: any, ref: any) { const idx = this.childNodes.indexOf(ref); if (idx >= 0) this.childNodes.splice(idx, 0, child); else this.appendChild(child); child.parentNode = this; return child; }
    }

    class MockElement extends MockNode {
      tagName = 'DIV';
      style: any = {};
      value = '';
      type = '';
      disabled = false;
      className = '';
      setAttribute(k: string, v: string) { (this as any)[k] = v; }
      removeAttribute(k: string) { delete (this as any)[k]; }
      addEventListener() {}
      removeEventListener() {}
    }

    class MockSelectElement extends MockElement {
      tagName = 'SELECT';
      options: any[] = [];
      appendChild(child: any) {
        super.appendChild(child);
        this.options.push(child);
        return child;
      }
    }

    const doc: any = new MockNode();
    doc.nodeType = 9;
    doc.defaultView = globalThis;
    doc.activeElement = null;
    doc.createElement = (tag: string) => {
      const lower = tag.toLowerCase();
      let el: MockElement;
      if (lower === 'select') {
        el = new MockSelectElement();
      } else {
        el = new MockElement();
        el.tagName = tag.toUpperCase();
      }
      el.ownerDocument = doc;
      return el;
    };
    doc.createElementNS = (_ns: string, tag: string) => doc.createElement(tag);
    doc.createTextNode = (val: string) => { const n: any = new MockNode(); n.nodeType = 3; (n as any).nodeValue = val; n.ownerDocument = doc; return n; };
    doc.createComment = (val: string) => { const n: any = new MockNode(); n.nodeType = 8; (n as any).nodeValue = val; n.ownerDocument = doc; return n; };
    doc.documentElement = doc.createElement('html');
    doc.head = doc.createElement('head');
    doc.body = doc.createElement('body');
    doc.addEventListener = () => {};
    doc.removeEventListener = () => {};

    (globalThis as any).document = doc;
    (globalThis as any).window = globalThis;
    (globalThis as any).Node = MockNode;
    (globalThis as any).Element = MockElement;
    (globalThis as any).HTMLElement = MockElement;
    (globalThis as any).HTMLIFrameElement = class extends MockElement {};
    (globalThis as any).HTMLInputElement = class extends MockElement {};
    (globalThis as any).HTMLTextAreaElement = class extends MockElement {};
    (globalThis as any).HTMLSelectElement = MockSelectElement;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('deve converter corretamente entradas com ponto decimal e com vírgula via parseCurrencyInput (P0-01)', () => {
    // Casos cruciais da auditoria: 0.20 e 0,20 devem representar R$ 0,20 (20 centavos)
    expect(parseCurrencyInput('0.20')).toBe(0.20);
    expect(toCents(parseCurrencyInput('0.20'))).toBe(20);

    expect(parseCurrencyInput('0,20')).toBe(0.20);
    expect(toCents(parseCurrencyInput('0,20'))).toBe(20);

    // Casos com 10.50 e 10,50
    expect(parseCurrencyInput('10.50')).toBe(10.50);
    expect(toCents(parseCurrencyInput('10.50'))).toBe(1050);

    expect(parseCurrencyInput('10,50')).toBe(10.50);
    expect(toCents(parseCurrencyInput('10,50'))).toBe(1050);

    // Valores com separador de milhar
    expect(parseCurrencyInput('1.234,56')).toBe(1234.56);
    expect(toCents(parseCurrencyInput('1.234,56'))).toBe(123456);

    expect(parseCurrencyInput('1,234.56')).toBe(1234.56);
    expect(toCents(parseCurrencyInput('1,234.56'))).toBe(123456);

    // Inteiros
    expect(parseCurrencyInput('100')).toBe(100.0);
    expect(toCents(parseCurrencyInput('100'))).toBe(10000);

    // Conteúdos inválidos
    expect(Number.isNaN(parseCurrencyInput('abc'))).toBe(true);
    expect(Number.isNaN(parseCurrencyInput(''))).toBe(true);
    expect(Number.isNaN(parseCurrencyInput('   '))).toBe(true);
    expect(Number.isNaN(parseCurrencyInput('--'))).toBe(true);
    expect(Number.isNaN(parseCurrencyInput('10.50.20'))).toBe(true);
  });

  it('não deve renderizar nada quando isOpen for false ou target for null', async () => {
    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PaymentModal
          isOpen={false}
          onClose={mockOnClose}
          target={{
            type: 'transaction',
            id: 'tx-1',
            title: 'Despesa Teste',
            totalAmount: 100,
            paidAmount: 0,
          }}
        />
      );
    });
    expect(container.childNodes.length).toBe(0);

    await act(async () => {
      root.render(
        <PaymentModal
          isOpen={true}
          onClose={mockOnClose}
          target={null}
        />
      );
    });
    expect(container.childNodes.length).toBe(0);
    root.unmount();
  });

  it('deve calcular remanescente em centavos inteiros sem artefatos de float IEEE 754 (P0-01)', () => {
    const totalAmount = 0.30;
    const paidAmount = 0.10;

    const totalCents = toCents(totalAmount);
    const paidCents = toCents(paidAmount);
    const remainingCents = Math.max(0, totalCents - paidCents);
    const remaining = fromCents(remainingCents);

    expect(remainingCents).toBe(20);
    expect(remaining).toBe(0.20);

    // Quando o usuário clica em "Pagar Total", o valor gerado é "0,20"
    const amountStr = remaining.toFixed(2).replace('.', ',');
    expect(amountStr).toBe('0,20');

    const parsedAmount = parseCurrencyInput(amountStr);
    const currentAmountCents = toCents(parsedAmount);

    expect(currentAmountCents).toBe(20);
    expect(currentAmountCents > remainingCents).toBe(false);

    // Se o usuário informar 0.21, deve ser excedente
    const excessCents = toCents(0.21);
    expect(excessCents > remainingCents).toBe(true);
  });

  it('deve interagir com formulário para pagar transação avulsa com 0,20 e 0.20 (P2-01)', async () => {
    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PaymentModal
          isOpen={true}
          onClose={mockOnClose}
          target={{
            type: 'transaction',
            id: 'tx-centavos',
            title: 'Café Expresso',
            totalAmount: 30.30,
            paidAmount: 10.10,
          }}
        />
      );
    });

    const inputs = findNodes(container, (n) => n.tagName === 'INPUT');
    const amountInput = inputs[0]; // input de valor monetário
    const select = findNode(container, (n) => n.tagName === 'SELECT');
    const form = findNode(container, (n) => n.tagName === 'FORM');

    // 1. Seleciona conta bancária
    await act(async () => {
      getReactProps(select).onChange({ target: { value: 'acc-1' } });
    });

    // 1.1 Altera data e observação
    const dateInput = inputs.find((i) => getReactProps(i)?.type === 'date');
    const notesInput = inputs.find((i) => getReactProps(i)?.placeholder?.includes('1º pagamento parcial'));
    if (dateInput) {
      await act(async () => {
        getReactProps(dateInput).onChange({ target: { value: '2026-09-20' } });
      });
    }
    if (notesInput) {
      await act(async () => {
        getReactProps(notesInput).onChange({ target: { value: 'Comprovante PIX 123' } });
      });
    }

    // 2. Digita '0,20'
    await act(async () => {
      getReactProps(amountInput).onChange({ target: { value: '0,20' } });
    });

    // 3. Envia o formulário
    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });

    expect(mockRecordPayment).toHaveBeenCalledTimes(1);
    expect(mockRecordPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        transaction_id: 'tx-centavos',
        account_id: 'acc-1',
        amount: 0.20,
        payment_date: '2026-09-20',
        notes: 'Comprovante PIX 123',
      })
    );
    expect(mockOnClose).toHaveBeenCalledTimes(1);

    // 4. Teste com '0.20' (ponto decimal)
    mockRecordPayment.mockClear();
    mockOnClose.mockClear();

    await act(async () => {
      getReactProps(amountInput).onChange({ target: { value: '0.20' } });
    });

    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });

    expect(mockRecordPayment).toHaveBeenCalledTimes(1);
    expect(mockRecordPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        transaction_id: 'tx-centavos',
        account_id: 'acc-1',
        amount: 0.20,
      })
    );
    expect(mockOnClose).toHaveBeenCalledTimes(1);

    root.unmount();
  });

  it('deve disparar clique no botão "Pagar Total" e enviar valor integral nos três destinos (P2-01)', async () => {
    // --- Destino 1: Transação ---
    const container1 = (globalThis as any).document.createElement('div');
    const root1 = createRoot(container1);

    await act(async () => {
      root1.render(
        <PaymentModal
          isOpen={true}
          onClose={mockOnClose}
          target={{
            type: 'transaction',
            id: 'tx-total',
            title: 'Serviço Mensal',
            totalAmount: 100.0,
            paidAmount: 40.0,
          }}
        />
      );
    });

    const select1 = findNode(container1, (n) => n.tagName === 'SELECT');
    const form1 = findNode(container1, (n) => n.tagName === 'FORM');
    const buttons1 = findNodes(container1, (n) => n.tagName === 'BUTTON');
    const payTotalBtn1 = buttons1.find((b) => {
      const props = getReactProps(b);
      return props?.type === 'button' && props?.onClick && typeof props?.children === 'object';
    });

    await act(async () => {
      getReactProps(select1).onChange({ target: { value: 'acc-1' } });
    });
    await act(async () => {
      getReactProps(payTotalBtn1).onClick();
    });

    await act(async () => {
      getReactProps(form1).onSubmit({ preventDefault: () => {} });
    });

    expect(mockRecordPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        transaction_id: 'tx-total',
        account_id: 'acc-1',
        amount: 60.0,
      })
    );
    root1.unmount();

    // --- Destino 2: Parcela (installment) ---
    mockRecordPayment.mockClear();
    const container2 = (globalThis as any).document.createElement('div');
    const root2 = createRoot(container2);

    await act(async () => {
      root2.render(
        <PaymentModal
          isOpen={true}
          onClose={mockOnClose}
          target={{
            type: 'installment',
            id: 'inst-total',
            title: 'Notebook (2/10)',
            totalAmount: 300.0,
            paidAmount: 100.0,
          }}
        />
      );
    });

    const select2 = findNode(container2, (n) => n.tagName === 'SELECT');
    const form2 = findNode(container2, (n) => n.tagName === 'FORM');
    const buttons2 = findNodes(container2, (n) => n.tagName === 'BUTTON');
    const payTotalBtn2 = buttons2.find((b) => {
      const props = getReactProps(b);
      return props?.type === 'button' && props?.onClick && typeof props?.children === 'object';
    });

    await act(async () => {
      getReactProps(select2).onChange({ target: { value: 'acc-2' } });
    });
    await act(async () => {
      getReactProps(payTotalBtn2).onClick();
    });

    await act(async () => {
      getReactProps(form2).onSubmit({ preventDefault: () => {} });
    });

    expect(mockRecordPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        installment_id: 'inst-total',
        account_id: 'acc-2',
        amount: 200.0,
      })
    );
    root2.unmount();

    // --- Destino 3: Fatura (bill) ---
    mockPayCreditCardBill.mockClear();
    const container3 = (globalThis as any).document.createElement('div');
    const root3 = createRoot(container3);

    await act(async () => {
      root3.render(
        <PaymentModal
          isOpen={true}
          onClose={mockOnClose}
          target={{
            type: 'bill',
            id: 'bill-total',
            title: 'Fatura Nubank Agosto',
            totalAmount: 1500.75,
            paidAmount: 500.25,
          }}
        />
      );
    });

    const select3 = findNode(container3, (n) => n.tagName === 'SELECT');
    const form3 = findNode(container3, (n) => n.tagName === 'FORM');
    const buttons3 = findNodes(container3, (n) => n.tagName === 'BUTTON');
    const payTotalBtn3 = buttons3.find((b) => {
      const props = getReactProps(b);
      return props?.type === 'button' && props?.onClick && typeof props?.children === 'object';
    });

    await act(async () => {
      getReactProps(select3).onChange({ target: { value: 'acc-1' } });
    });
    await act(async () => {
      getReactProps(payTotalBtn3).onClick();
    });

    await act(async () => {
      getReactProps(form3).onSubmit({ preventDefault: () => {} });
    });

    expect(mockPayCreditCardBill).toHaveBeenCalledWith(
      'bill-total',
      'acc-1',
      1000.50,
      expect.any(String),
      undefined
    );
    root3.unmount();
  });

  it('deve aceitar formatos com milhar (1.234,56 e 1,234.56) via formulário (P2-01)', async () => {
    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PaymentModal
          isOpen={true}
          onClose={mockOnClose}
          target={{
            type: 'transaction',
            id: 'tx-milhar',
            title: 'Equipamento',
            totalAmount: 5000.0,
            paidAmount: 0,
          }}
        />
      );
    });

    const amountInput = findNodes(container, (n) => n.tagName === 'INPUT')[0];
    const select = findNode(container, (n) => n.tagName === 'SELECT');
    const form = findNode(container, (n) => n.tagName === 'FORM');

    await act(async () => {
      getReactProps(select).onChange({ target: { value: 'acc-1' } });
      getReactProps(amountInput).onChange({ target: { value: '1.234,56' } });
    });

    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });

    expect(mockRecordPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        transaction_id: 'tx-milhar',
        amount: 1234.56,
      })
    );

    mockRecordPayment.mockClear();

    await act(async () => {
      getReactProps(amountInput).onChange({ target: { value: '1,234.56' } });
    });

    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });

    expect(mockRecordPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        transaction_id: 'tx-milhar',
        amount: 1234.56,
      })
    );

    root.unmount();
  });

  it('deve rejeitar submissão com texto inválido "abc", vazio, valor negativo ou acima do restante (P2-01)', async () => {
    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PaymentModal
          isOpen={true}
          onClose={mockOnClose}
          target={{
            type: 'transaction',
            id: 'tx-rejeicao',
            title: 'Aluguel',
            totalAmount: 100.0,
            paidAmount: 50.0,
          }}
        />
      );
    });

    const amountInput = findNodes(container, (n) => n.tagName === 'INPUT')[0];
    const select = findNode(container, (n) => n.tagName === 'SELECT');
    const form = findNode(container, (n) => n.tagName === 'FORM');

    await act(async () => {
      getReactProps(select).onChange({ target: { value: 'acc-1' } });
    });

    // 1. Texto 'abc'
    await act(async () => {
      getReactProps(amountInput).onChange({ target: { value: 'abc' } });
    });
    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });
    expect(mockRecordPayment).not.toHaveBeenCalled();

    // 2. Vazio ''
    await act(async () => {
      getReactProps(amountInput).onChange({ target: { value: '' } });
    });
    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });
    expect(mockRecordPayment).not.toHaveBeenCalled();

    // 3. Valor negativo '-10,00' e '-5.50'
    await act(async () => {
      getReactProps(amountInput).onChange({ target: { value: '-10,00' } });
    });
    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });
    expect(mockRecordPayment).not.toHaveBeenCalled();

    await act(async () => {
      getReactProps(amountInput).onChange({ target: { value: '-5.50' } });
    });
    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });
    expect(mockRecordPayment).not.toHaveBeenCalled();

    // 4. Excesso: restante é 50.00, tenta pagar 50.01
    await act(async () => {
      getReactProps(amountInput).onChange({ target: { value: '50,01' } });
    });
    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });
    expect(mockRecordPayment).not.toHaveBeenCalled();

    // 5. Sem conta selecionada
    await act(async () => {
      getReactProps(select).onChange({ target: { value: '' } });
      getReactProps(amountInput).onChange({ target: { value: '50,00' } });
    });
    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });
    expect(mockRecordPayment).not.toHaveBeenCalled();

    root.unmount();
  });

  it('deve permitir digitar valores parciais avulsos em parcelas e faturas (P2-01)', async () => {
    // 1. Parcela com digitação manual de 50,00
    const container1 = (globalThis as any).document.createElement('div');
    const root1 = createRoot(container1);

    await act(async () => {
      root1.render(
        <PaymentModal
          isOpen={true}
          onClose={mockOnClose}
          target={{
            type: 'installment',
            id: 'inst-parcial',
            title: 'Curso (1/5)',
            totalAmount: 200.0,
            paidAmount: 0,
          }}
        />
      );
    });

    const amountInput1 = findNodes(container1, (n) => n.tagName === 'INPUT')[0];
    const select1 = findNode(container1, (n) => n.tagName === 'SELECT');
    const form1 = findNode(container1, (n) => n.tagName === 'FORM');

    await act(async () => {
      getReactProps(select1).onChange({ target: { value: 'acc-1' } });
    });
    await act(async () => {
      getReactProps(amountInput1).onChange({ target: { value: '50,00' } });
    });
    await act(async () => {
      getReactProps(form1).onSubmit({ preventDefault: () => {} });
    });

    expect(mockRecordPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        installment_id: 'inst-parcial',
        account_id: 'acc-1',
        amount: 50.0,
      })
    );
    root1.unmount();

    // 2. Fatura com digitação manual de 150,00
    mockPayCreditCardBill.mockClear();
    const container2 = (globalThis as any).document.createElement('div');
    const root2 = createRoot(container2);

    await act(async () => {
      root2.render(
        <PaymentModal
          isOpen={true}
          onClose={mockOnClose}
          target={{
            type: 'bill',
            id: 'bill-parcial',
            title: 'Fatura Nubank',
            totalAmount: 500.0,
            paidAmount: 0,
          }}
        />
      );
    });

    const amountInput2 = findNodes(container2, (n) => n.tagName === 'INPUT')[0];
    const select2 = findNode(container2, (n) => n.tagName === 'SELECT');
    const form2 = findNode(container2, (n) => n.tagName === 'FORM');

    await act(async () => {
      getReactProps(select2).onChange({ target: { value: 'acc-2' } });
    });
    await act(async () => {
      getReactProps(amountInput2).onChange({ target: { value: '150,00' } });
    });
    await act(async () => {
      getReactProps(form2).onSubmit({ preventDefault: () => {} });
    });

    expect(mockPayCreditCardBill).toHaveBeenCalledWith(
      'bill-parcial',
      'acc-2',
      150.0,
      expect.any(String),
      undefined
    );
    root2.unmount();
  });

  it('deve disparar onClose ao clicar nos botões Cancelar e Fechar', async () => {
    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PaymentModal
          isOpen={true}
          onClose={mockOnClose}
          target={{
            type: 'transaction',
            id: 'tx-cancel',
            title: 'Internet',
            totalAmount: 100.0,
            paidAmount: 0,
          }}
        />
      );
    });

    const buttons = findNodes(container, (n) => n.tagName === 'BUTTON');
    const closeBtn = buttons[0]; // Botão com ícone X
    const cancelBtn = buttons.find((b) => {
      const props = getReactProps(b);
      return props?.children === 'Cancelar';
    });

    await act(async () => {
      getReactProps(closeBtn).onClick();
    });
    expect(mockOnClose).toHaveBeenCalledTimes(1);

    mockOnClose.mockClear();

    await act(async () => {
      getReactProps(cancelBtn).onClick();
    });
    expect(mockOnClose).toHaveBeenCalledTimes(1);

    root.unmount();
  });

  describe('Modo Apenas Despesas (expense_tracker) - P0-01 e P2-01', () => {
    beforeEach(() => {
      vi.spyOn(FinanceContext, 'useFinance').mockReturnValue({
        accounts: mockAccounts as any,
        recordPayment: mockRecordPayment,
        payCreditCardBill: mockPayCreditCardBill,
        activeWorkspace: {
          id: 'ws-tracker',
          name: 'Workspace Despesas',
          tracking_mode: 'expense_tracker',
        } as any,
      } as any);
    });

    it('não deve renderizar select de contas e deve exibir aviso explicativo', async () => {
      const container = (globalThis as any).document.createElement('div');
      const root = createRoot(container);

      await act(async () => {
        root.render(
          <PaymentModal
            isOpen={true}
            onClose={mockOnClose}
            target={{
              type: 'transaction',
              id: 'tx-tracker-1',
              title: 'Energia Elétrica',
              totalAmount: 180.5,
              paidAmount: 0,
            }}
          />
        );
      });

      const selects = findNodes(container, (n) => n.tagName === 'SELECT');
      expect(selects.length).toBe(0);

      // Encontra mensagem explicativa do modo sem saldo
      const trackerNotice = findNode(container, (n) => {
        const props = getReactProps(n);
        return props?.className?.includes('bg-teal-50/70');
      });
      expect(trackerNotice).not.toBeNull();

      root.unmount();
    });

    it('deve manter botão habilitado ao digitar valor sem exigir conta bancária (P0-01)', async () => {
      const container = (globalThis as any).document.createElement('div');
      const root = createRoot(container);

      await act(async () => {
        root.render(
          <PaymentModal
            isOpen={true}
            onClose={mockOnClose}
            target={{
              type: 'transaction',
              id: 'tx-tracker-2',
              title: 'Aluguel',
              totalAmount: 1200.0,
              paidAmount: 0,
            }}
          />
        );
      });

      const inputs = findNodes(container, (n) => n.tagName === 'INPUT');
      const amountInput = inputs[0];
      expect(amountInput).toBeDefined();

      const submitBtn = findNode(container, (n) => n.tagName === 'BUTTON' && n.type === 'submit');
      expect(submitBtn).toBeDefined();

      // Inicialmente com valor vazio, o botão deve estar desabilitado
      expect(getReactProps(submitBtn).disabled).toBe(true);

      // Ao digitar valor válido no modo expense_tracker, o botão DEVE ficar habilitado sem exigir conta
      await act(async () => {
        getReactProps(amountInput).onChange({ target: { value: '1200,00' } });
      });

      expect(getReactProps(submitBtn).disabled).toBe(false);

      // Submeter pagamento e verificar que recordPayment recebe account_id undefined
      const form = findNode(container, (n) => n.tagName === 'FORM');
      await act(async () => {
        getReactProps(form).onSubmit({ preventDefault: () => {} });
      });

      expect(mockRecordPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          transaction_id: 'tx-tracker-2',
          amount: 1200.0,
          account_id: undefined,
        })
      );
      expect(mockOnClose).toHaveBeenCalledTimes(1);

      root.unmount();
    });

    it('deve permitir pagar fatura de cartão no modo tracker sem exigir conta', async () => {
      const container = (globalThis as any).document.createElement('div');
      const root = createRoot(container);

      await act(async () => {
        root.render(
          <PaymentModal
            isOpen={true}
            onClose={mockOnClose}
            target={{
              type: 'bill',
              id: 'bill-tracker-1',
              title: 'Fatura Nubank',
              totalAmount: 450.0,
              paidAmount: 0,
            }}
          />
        );
      });

      // Clicar no botão "Pagar Total"
      const buttons = findNodes(container, (n) => n.tagName === 'BUTTON');
      const totalBtn = buttons.find((b) => {
        const props = getReactProps(b);
        return props?.type === 'button' && props?.onClick && typeof props?.children === 'object';
      });
      expect(totalBtn).toBeDefined();

      await act(async () => {
        getReactProps(totalBtn).onClick();
      });

      const submitBtn = findNode(container, (n) => n.tagName === 'BUTTON' && n.type === 'submit');
      expect(getReactProps(submitBtn).disabled).toBe(false);

      const form = findNode(container, (n) => n.tagName === 'FORM');
      await act(async () => {
        getReactProps(form).onSubmit({ preventDefault: () => {} });
      });

      expect(mockPayCreditCardBill).toHaveBeenCalledWith(
        'bill-tracker-1',
        undefined,
        450.0,
        expect.any(String),
        undefined
      );
      expect(mockOnClose).toHaveBeenCalledTimes(1);

      root.unmount();
    });
  });

  describe('parseCurrencyInput unit tests', () => {
    it('deve converter corretamente entradas em formato BR, US, inteiros e rejeitar inválidos', () => {
      expect(parseCurrencyInput('')).toBeNaN();
      expect(parseCurrencyInput('   ')).toBeNaN();
      expect(parseCurrencyInput('not-a-number')).toBeNaN();
      expect(parseCurrencyInput('100')).toBe(100);
      expect(parseCurrencyInput('1.234,56')).toBe(1234.56);
      expect(parseCurrencyInput('1,234.56')).toBe(1234.56);
      expect(parseCurrencyInput('0,20')).toBe(0.2);
      expect(parseCurrencyInput('0.20')).toBe(0.2);

      // Valores gigantescos que ultrapassam Number.MAX_VALUE e geram Infinity (linhas 31, 38, 44)
      expect(parseCurrencyInput('9'.repeat(400) + ',50')).toBeNaN();
      expect(parseCurrencyInput('9'.repeat(400) + '.50')).toBeNaN();
      expect(parseCurrencyInput('9'.repeat(400))).toBeNaN();
    });
  });
});
