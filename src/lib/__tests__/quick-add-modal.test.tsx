import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QuickAddModal } from '@/components/transactions/QuickAddModal';
import * as FinanceContext from '@/lib/context/finance-context';
import { WorkspaceMember, Workspace, CreditCard, PaymentMethod, Account, Category } from '@/lib/types';

describe('QuickAddModal Comprehensive UI Tests', () => {
  const mockAddTransaction = vi.fn();
  const mockCreateInstallmentPurchase = vi.fn();
  const mockCreateTransfer = vi.fn();
  const mockOnClose = vi.fn();

  const mockWorkspace: Workspace = {
    id: 'ws-1',
    name: 'FinControl Workspace',
    owner_id: 'usr-1',
    currency: 'BRL',
    created_at: '2026-01-15T00:00:00Z',
    tracking_mode: 'full',
  };

  const mockMembers: WorkspaceMember[] = [
    {
      id: 'wsm-1',
      workspace_id: 'ws-1',
      user_id: 'usr-1',
      role: 'owner',
      user: { id: 'usr-1', name: 'Rodrigo Silva', email: 'rodrigo@exemplo.com', created_at: '2026-01-01T00:00:00Z' },
      created_at: '2026-01-15T00:00:00Z',
    },
    {
      id: 'wsm-2',
      workspace_id: 'ws-1',
      user_id: 'usr-2',
      role: 'member',
      user: { id: 'usr-2', name: 'Camila Santos', email: 'camila@exemplo.com', created_at: '2026-01-01T00:00:00Z' },
      created_at: '2026-01-15T00:00:00Z',
    },
  ];

  const mockCategories: Category[] = [
    {
      id: 'cat-exp-1',
      name: 'Alimentação',
      icon: 'Utensils',
      color: '#f59e0b',
      type: 'expense',
      workspace_id: 'ws-1',
      active: true,
      created_at: '2026-01-01',
      subcategories: [
        {
          id: 'sub-exp-1',
          parent_id: 'cat-exp-1',
          name: 'Restaurante',
          icon: 'Utensils',
          color: '#f59e0b',
          type: 'expense',
          workspace_id: 'ws-1',
          active: true,
          created_at: '2026-01-01',
        },
      ],
    },
    { id: 'cat-inc-1', name: 'Salário', icon: 'Briefcase', color: '#10b981', type: 'income', workspace_id: 'ws-1', active: true, created_at: '2026-01-01' },
  ];

  const mockAccounts: Account[] = [
    { id: 'acc-1', name: 'Nubank Corrente', type: 'checking', institution: 'Nubank', initial_balance: 5000, current_balance: 5000, color: '#10b981', active: true, workspace_id: 'ws-1', created_at: '2026-01-01' },
    { id: 'acc-2', name: 'Inter Poupança', type: 'savings', institution: 'Inter', initial_balance: 10000, current_balance: 10000, color: '#f59e0b', active: true, workspace_id: 'ws-1', created_at: '2026-01-01' },
  ];

  const mockCreditCards: CreditCard[] = [
    {
      id: 'card-1',
      name: 'Nubank Ultravioleta',
      institution: 'Nubank',
      credit_limit: 15000,
      closing_day: 5,
      due_day: 12,
      color: '#8b5cf6',
      active: true,
      workspace_id: 'ws-1',
      created_at: '2026-01-01',
    },
  ];

  const mockPaymentMethods: PaymentMethod[] = [
    { id: 'pm-pix', name: 'PIX', type: 'pix', linked_account_id: 'acc-1', workspace_id: 'ws-1', active: true, created_at: '2026-01-01' },
    { id: 'pm-card', name: 'Cartão de Crédito', type: 'credit_card', workspace_id: 'ws-1', active: true, created_at: '2026-01-01' },
    { id: 'pm-card-fixed', name: 'Cartão Nubank Fixo', type: 'credit_card', credit_card_id: 'card-1', workspace_id: 'ws-1', active: true, created_at: '2026-01-01' },
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
      step = '';
      min = '';
      max = '';
      disabled = false;
      checked = false;
      className = '';
      textContent = '';
      setAttribute(k: string, v: string) { (this as any)[k] = v; }
      removeAttribute(k: string) { delete (this as any)[k]; }
      addEventListener() {}
      removeEventListener() {}
    }

    class MockSelectElement extends MockElement {
      tagName = 'SELECT';
      options: any[] = [];
      appendChild(child: any) {
        if (child.tagName === 'OPTION') this.options.push(child);
        return super.appendChild(child);
      }
    }

    const doc: any = new MockNode();
    doc.nodeType = 9;
    doc.defaultView = globalThis;
    doc.activeElement = null;
    doc.createElement = (tag: string) => {
      const upper = tag.toUpperCase();
      let el: any;
      if (upper === 'SELECT') el = new MockSelectElement();
      else el = new MockElement();
      el.tagName = upper;
      el.ownerDocument = doc;
      return el;
    };
    doc.createElementNS = (_ns: string, tag: string) => doc.createElement(tag);
    doc.createTextNode = (val: string) => {
      const n: any = new MockNode();
      n.nodeType = 3;
      n.nodeValue = val;
      n.textContent = val;
      n.ownerDocument = doc;
      return n;
    };
    doc.createComment = (val: string) => {
      const n: any = new MockNode();
      n.nodeType = 8;
      n.nodeValue = val;
      n.ownerDocument = doc;
      return n;
    };
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
    (globalThis as any).HTMLSelectElement = MockSelectElement;
    (globalThis as any).HTMLTextAreaElement = class extends MockElement {};
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

    vi.spyOn(FinanceContext, 'useFinance').mockReturnValue({
      activeWorkspace: mockWorkspace,
      workspaceMembers: mockMembers,
      categories: mockCategories,
      accounts: mockAccounts,
      paymentMethods: mockPaymentMethods,
      creditCards: mockCreditCards,
      addTransaction: mockAddTransaction,
      createInstallmentPurchase: mockCreateInstallmentPurchase,
      createTransfer: mockCreateTransfer,
    } as any);
  });

  it('não deve renderizar conteúdo quando isOpen for false', async () => {
    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(QuickAddModal, { isOpen: false, onClose: mockOnClose }));
    });

    expect(container.childNodes).toHaveLength(0);
    await act(async () => {
      root.unmount();
    });
  });

  it('deve fechar modal ao clicar no botão de fechar e no botão cancelar', async () => {
    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(QuickAddModal, { isOpen: true, onClose: mockOnClose }));
    });

    const buttons = findNodes(container, (n) => n.tagName === 'BUTTON');

    // 1. Botão Cancelar
    const cancelBtn = buttons.find((b) => getReactProps(b)?.children === 'Cancelar');
    expect(cancelBtn).toBeDefined();

    await act(async () => {
      getReactProps(cancelBtn).onClick({ stopPropagation: () => {} });
    });
    expect(mockOnClose).toHaveBeenCalledTimes(1);

    // 2. Botão de fechar (X no topo com classe text-slate-400)
    const closeIconBtn = buttons.find((b) => getReactProps(b)?.className?.includes('text-slate-400'));
    expect(closeIconBtn).toBeDefined();

    await act(async () => {
      getReactProps(closeIconBtn).onClick({ stopPropagation: () => {} });
    });
    expect(mockOnClose).toHaveBeenCalledTimes(2);

    await act(async () => {
      root.unmount();
    });
  });

  it('deve registrar receita (income) com categoria e conta', async () => {
    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(QuickAddModal, { isOpen: true, onClose: mockOnClose }));
    });

    const buttons = findNodes(container, (n) => n.tagName === 'BUTTON');

    // Alternar para aba Receita
    const incomeTab = buttons.find((b) => getReactProps(b)?.children === 'Receita');
    expect(incomeTab).toBeDefined();

    await act(async () => {
      getReactProps(incomeTab).onClick();
    });

    const inputs = findNodes(container, (n) => n.tagName === 'INPUT');
    const amountInput = inputs.find((i) => getReactProps(i)?.placeholder === '0,00');
    const descInput = inputs.find((i) => getReactProps(i)?.placeholder?.includes('Salário') || getReactProps(i)?.placeholder?.includes('Ex:'));

    expect(amountInput).toBeDefined();
    expect(descInput).toBeDefined();

    await act(async () => {
      getReactProps(amountInput).onChange({ target: { value: '3500,00' } });
      getReactProps(descInput).onChange({ target: { value: 'Consultoria Web' } });
    });

    // Submeter Formulário
    const form = findNodes(container, (n) => n.tagName === 'FORM')[0];
    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });

    expect(mockAddTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Consultoria Web',
        amount: 3500,
        type: 'income',
      })
    );
    expect(mockOnClose).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('deve registrar transferência entre contas bancárias', async () => {
    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(QuickAddModal, { isOpen: true, onClose: mockOnClose }));
    });

    const buttons = findNodes(container, (n) => n.tagName === 'BUTTON');
    const transferTab = buttons.find((b) => getReactProps(b)?.children === 'Transferência');
    expect(transferTab).toBeDefined();

    await act(async () => {
      getReactProps(transferTab).onClick();
    });

    // Localizar selects de conta de origem e destino
    const selects = findNodes(container, (n) => n.tagName === 'SELECT');
    expect(selects.length).toBeGreaterThanOrEqual(2);

    await act(async () => {
      getReactProps(selects[0]).onChange({ target: { value: 'acc-1' } });
      getReactProps(selects[1]).onChange({ target: { value: 'acc-2' } });
    });

    // Preencher Valor
    const inputs = findNodes(container, (n) => n.tagName === 'INPUT');
    const amountInput = inputs.find((i) => getReactProps(i)?.placeholder === '0,00');
    expect(amountInput).toBeDefined();

    await act(async () => {
      getReactProps(amountInput).onChange({ target: { value: '450,00' } });
    });

    // Submeter
    const form = findNodes(container, (n) => n.tagName === 'FORM')[0];
    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });

    expect(mockCreateTransfer).toHaveBeenCalledWith(
      'acc-1',
      'acc-2',
      450,
      expect.any(String),
      ''
    );
    expect(mockOnClose).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('deve validar e rejeitar transferência com a mesma conta de origem e destino', async () => {
    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(QuickAddModal, { isOpen: true, onClose: mockOnClose }));
    });

    const buttons = findNodes(container, (n) => n.tagName === 'BUTTON');
    const transferTab = buttons.find((b) => getReactProps(b)?.children === 'Transferência');
    await act(async () => {
      getReactProps(transferTab).onClick();
    });

    const selects = findNodes(container, (n) => n.tagName === 'SELECT');
    await act(async () => {
      getReactProps(selects[0]).onChange({ target: { value: 'acc-1' } });
      getReactProps(selects[1]).onChange({ target: { value: 'acc-1' } });
    });

    const inputs = findNodes(container, (n) => n.tagName === 'INPUT');
    const amountInput = inputs.find((i) => getReactProps(i)?.placeholder === '0,00');
    await act(async () => {
      getReactProps(amountInput).onChange({ target: { value: '100' } });
    });

    const form = findNodes(container, (n) => n.tagName === 'FORM')[0];
    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });

    expect(mockCreateTransfer).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('deve configurar compra parcelada no cartão de crédito com parcelas pré-pagas', async () => {
    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(QuickAddModal, { isOpen: true, onClose: mockOnClose }));
    });

    const inputs = findNodes(container, (n) => n.tagName === 'INPUT');
    const amountInput = inputs.find((i) => getReactProps(i)?.placeholder === '0,00');
    const descInput = inputs.find((i) => getReactProps(i)?.placeholder?.includes('Supermercado') || getReactProps(i)?.placeholder?.includes('Ex:'));

    await act(async () => {
      getReactProps(descInput).onChange({ target: { value: 'Smart TV 4K' } });
      getReactProps(amountInput).onChange({ target: { value: '3000' } });
    });

    // 1. Selecionar método Cartão de Crédito
    const selects = findNodes(container, (n) => n.tagName === 'SELECT');
    const pmSelect = selects.find((s) => {
      return (s as any).options?.some?.((o: any) => o.value === 'pm-card');
    });
    expect(pmSelect).toBeDefined();

    await act(async () => {
      getReactProps(pmSelect).onChange({ target: { value: 'pm-card' } });
    });

    // 2. Localizar e selecionar cartão de crédito 'card-1'
    const cardSelect = findNodes(container, (n) => n.tagName === 'SELECT').find((s) => {
      return (s as any).options?.some?.((o: any) => o.value === 'card-1');
    });
    expect(cardSelect).toBeDefined();

    await act(async () => {
      getReactProps(cardSelect).onChange({ target: { value: 'card-1' } });
    });

    // 3. Localizar e selecionar 3 parcelas
    const installmentSelect = findNodes(container, (n) => n.tagName === 'SELECT').find((s) => {
      const p = getReactProps(s);
      return p?.value === 1 && s !== cardSelect && s !== pmSelect;
    });
    expect(installmentSelect).toBeDefined();

    await act(async () => {
      getReactProps(installmentSelect).onChange({ target: { value: 3 } });
    });

    // 4. Selecionar 1 parcela já paga
    const paidSelect = findNodes(container, (n) => n.tagName === 'SELECT').find((s) => {
      const p = getReactProps(s);
      return p?.value === 0 && s !== installmentSelect && s !== cardSelect && s !== pmSelect;
    });
    expect(paidSelect).toBeDefined();

    await act(async () => {
      getReactProps(paidSelect).onChange({ target: { value: 1 } });
    });

    // Submeter
    const form = findNodes(container, (n) => n.tagName === 'FORM')[0];
    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });

    expect(mockCreateInstallmentPurchase).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Smart TV 4K',
        total_amount: 3000,
        installment_count: 3,
        credit_card_id: 'card-1',
      })
    );

    await act(async () => {
      root.unmount();
    });
  });

  it('deve expandir "Mais opções" e enviar data customizada, conta bancária e notas', async () => {
    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(QuickAddModal, { isOpen: true, onClose: mockOnClose }));
    });

    const inputs = findNodes(container, (n) => n.tagName === 'INPUT');
    const amountInput = inputs.find((i) => getReactProps(i)?.placeholder === '0,00');
    const descInput = inputs.find((i) => getReactProps(i)?.placeholder?.includes('Supermercado') || getReactProps(i)?.placeholder?.includes('Ex:'));

    await act(async () => {
      getReactProps(descInput).onChange({ target: { value: 'Manutenção Predial' } });
      getReactProps(amountInput).onChange({ target: { value: '250,00' } });
    });

    // Expandir Mais Opções
    const buttons = findNodes(container, (n) => n.tagName === 'BUTTON');
    const moreOptionsBtn = buttons.find((b) => getReactProps(b)?.className?.includes('text-emerald-600'));
    expect(moreOptionsBtn).toBeDefined();

    await act(async () => {
      getReactProps(moreOptionsBtn).onClick();
    });

    // Modificar datas
    const dateInputs = findNodes(container, (n) => n.tagName === 'INPUT' && getReactProps(n)?.type === 'date');
    expect(dateInputs.length).toBeGreaterThanOrEqual(2);

    await act(async () => {
      getReactProps(dateInputs[0]).onChange({ target: { value: '2026-09-01' } });
      getReactProps(dateInputs[1]).onChange({ target: { value: '2026-09-10' } });
    });

    // Marcar já pago hoje
    const paidCheckbox = findNode(container, (n) => n.tagName === 'INPUT' && getReactProps(n)?.id === 'alreadyPaid');
    if (paidCheckbox) {
      await act(async () => {
        getReactProps(paidCheckbox).onChange({ target: { checked: true } });
      });
    }

    // Preencher notas
    const notesTextarea = findNode(container, (n) => n.tagName === 'TEXTAREA');
    if (notesTextarea) {
      await act(async () => {
        getReactProps(notesTextarea).onChange({ target: { value: 'Nota 9988' } });
      });
    }

    // Submeter
    const form = findNodes(container, (n) => n.tagName === 'FORM')[0];
    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });

    expect(mockAddTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Manutenção Predial',
        amount: 250,
        transaction_date: '2026-09-01',
        due_date: '2026-09-10',
        status: 'paid',
        notes: 'Nota 9988',
      })
    );

    await act(async () => {
      root.unmount();
    });
  });

  it('deve validar e rejeitar submissão com valor vazio ou zero', async () => {
    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(QuickAddModal, { isOpen: true, onClose: mockOnClose }));
    });

    const form = findNodes(container, (n) => n.tagName === 'FORM')[0];

    // Descrição preenchida mas valor zero
    const inputs = findNodes(container, (n) => n.tagName === 'INPUT');
    const descInput = inputs.find((i) => getReactProps(i)?.placeholder?.includes('Supermercado') || getReactProps(i)?.placeholder?.includes('Ex:'));

    await act(async () => {
      getReactProps(descInput).onChange({ target: { value: 'Teste Zero' } });
    });

    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });

    expect(mockAddTransaction).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('deve exibir erro ao tentar submeter cartão de crédito sem selecionar cartão válido', async () => {
    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(QuickAddModal, { isOpen: true, onClose: mockOnClose }));
    });

    const inputs = findNodes(container, (n) => n.tagName === 'INPUT');
    const amountInput = inputs.find((i) => getReactProps(i)?.placeholder === '0,00');
    const descInput = inputs.find((i) => getReactProps(i)?.placeholder?.includes('Supermercado') || getReactProps(i)?.placeholder?.includes('Ex:'));

    await act(async () => {
      getReactProps(descInput).onChange({ target: { value: 'Compra Sem Cartão' } });
      getReactProps(amountInput).onChange({ target: { value: '100' } });
    });

    // Selecionar método Cartão de Crédito genérico (sem cartão associado)
    const selects = findNodes(container, (n) => n.tagName === 'SELECT');
    const pmSelect = selects.find((s) => (s as any).options?.some?.((o: any) => o.value === 'pm-card'));

    await act(async () => {
      getReactProps(pmSelect).onChange({ target: { value: 'pm-card' } });
    });

    // Submeter SEM selecionar o cartão
    const form = findNodes(container, (n) => n.tagName === 'FORM')[0];
    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });

    expect(mockAddTransaction).not.toHaveBeenCalled();
    expect(mockCreateInstallmentPurchase).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('deve configurar despesa com divisão de rateio igual (equal split) entre membros', async () => {
    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(QuickAddModal, { isOpen: true, onClose: mockOnClose }));
    });

    const inputs = findNodes(container, (n) => n.tagName === 'INPUT');
    const amountInput = inputs.find((i) => getReactProps(i)?.placeholder === '0,00');
    const descInput = inputs.find((i) => getReactProps(i)?.placeholder?.includes('Supermercado') || getReactProps(i)?.placeholder?.includes('Ex:'));

    await act(async () => {
      getReactProps(descInput).onChange({ target: { value: 'Almoço Equipe' } });
      getReactProps(amountInput).onChange({ target: { value: '200' } });
    });

    // Localizar seletor de regra de divisão
    const selects = findNodes(container, (n) => n.tagName === 'SELECT');
    const splitRuleSelect = selects.find((s) => (s as any).options?.some?.((o: any) => o.value === 'equal'));
    expect(splitRuleSelect).toBeDefined();

    await act(async () => {
      getReactProps(splitRuleSelect).onChange({ target: { value: 'equal' } });
    });

    // Localizar seletor de "Quem pagou?" e selecionar 'wsm-2'
    const payerSelect = selects.find((s) => (s as any).options?.some?.((o: any) => o.value === 'wsm-2'));
    expect(payerSelect).toBeDefined();

    await act(async () => {
      getReactProps(payerSelect).onChange({ target: { value: 'wsm-2' } });
    });

    const form = findNodes(container, (n) => n.tagName === 'FORM')[0];
    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });

    expect(mockAddTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Almoço Equipe',
        amount: 200,
        paid_by_member_id: 'wsm-2',
        split_type: 'equal',
        splits: expect.arrayContaining([
          expect.objectContaining({ member_id: 'wsm-1', amount: 100 }),
          expect.objectContaining({ member_id: 'wsm-2', amount: 100 }),
        ]),
      })
    );

    await act(async () => {
      root.unmount();
    });
  });

  it('deve configurar rateio personalizado (custom split) com inputs individuais por membro', async () => {
    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(QuickAddModal, { isOpen: true, onClose: mockOnClose }));
    });

    const inputs = findNodes(container, (n) => n.tagName === 'INPUT');
    const amountInput = inputs.find((i) => getReactProps(i)?.placeholder === '0,00');
    const descInput = inputs.find((i) => getReactProps(i)?.placeholder?.includes('Supermercado') || getReactProps(i)?.placeholder?.includes('Ex:'));

    await act(async () => {
      getReactProps(descInput).onChange({ target: { value: 'Jantar Custom' } });
      getReactProps(amountInput).onChange({ target: { value: '300' } });
    });

    // Selecionar split personalizado
    const selects = findNodes(container, (n) => n.tagName === 'SELECT');
    const splitRuleSelect = selects.find((s) => (s as any).options?.some?.((o: any) => o.value === 'custom'));
    expect(splitRuleSelect).toBeDefined();

    await act(async () => {
      getReactProps(splitRuleSelect).onChange({ target: { value: 'custom' } });
    });

    // Preencher valores customizados dos membros (120 e 180)
    const customInputs = findNodes(container, (n) => n.tagName === 'INPUT' && n.type === 'number');
    expect(customInputs.length).toBeGreaterThanOrEqual(2);

    await act(async () => {
      getReactProps(customInputs[0]).onChange({ target: { value: '120' } });
      getReactProps(customInputs[1]).onChange({ target: { value: '180' } });
    });

    const form = findNodes(container, (n) => n.tagName === 'FORM')[0];
    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });

    expect(mockAddTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Jantar Custom',
        amount: 300,
        split_type: 'custom',
        splits: expect.arrayContaining([
          expect.objectContaining({ member_id: 'wsm-1', amount: 120 }),
          expect.objectContaining({ member_id: 'wsm-2', amount: 180 }),
        ]),
      })
    );

    await act(async () => {
      root.unmount();
    });
  });

  it('deve capturar erro e exibir mensagem quando addTransaction lançar exceção', async () => {
    mockAddTransaction.mockImplementationOnce(() => {
      throw new Error('Falha de banco de dados simulada');
    });

    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(QuickAddModal, { isOpen: true, onClose: mockOnClose }));
    });

    const inputs = findNodes(container, (n) => n.tagName === 'INPUT');
    const amountInput = inputs.find((i) => getReactProps(i)?.placeholder === '0,00');
    const descInput = inputs.find((i) => getReactProps(i)?.placeholder?.includes('Supermercado') || getReactProps(i)?.placeholder?.includes('Ex:'));

    await act(async () => {
      getReactProps(descInput).onChange({ target: { value: 'Teste Exceção' } });
      getReactProps(amountInput).onChange({ target: { value: '50' } });
    });

    const form = findNodes(container, (n) => n.tagName === 'FORM')[0];
    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });

    expect(mockAddTransaction).toHaveBeenCalled();
    expect(mockOnClose).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('deve selecionar método com cartão fixo, selecionar subcategoria e resetar parcelas pagas ao diminuir total de parcelas', async () => {
    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(QuickAddModal, { isOpen: true, onClose: mockOnClose }));
    });

    const inputs = findNodes(container, (n) => n.tagName === 'INPUT');
    const amountInput = inputs.find((i) => getReactProps(i)?.placeholder === '0,00');
    const descInput = inputs.find((i) => getReactProps(i)?.placeholder?.includes('Supermercado') || getReactProps(i)?.placeholder?.includes('Ex:'));

    await act(async () => {
      getReactProps(descInput).onChange({ target: { value: 'Jantar Restaurante' } });
      getReactProps(amountInput).onChange({ target: { value: '600' } });
    });

    // Selecionar subcategoria
    const selects = findNodes(container, (n) => n.tagName === 'SELECT');
    const catSelect = selects.find((s) => (s as any).options?.some?.((o: any) => o.value === 'sub-exp-1'));
    expect(catSelect).toBeDefined();
    await act(async () => {
      getReactProps(catSelect).onChange({ target: { value: 'sub-exp-1' } });
    });

    // Selecionar método com cartão fixo
    const pmSelect = selects.find((s) => (s as any).options?.some?.((o: any) => o.value === 'pm-card-fixed'));
    expect(pmSelect).toBeDefined();
    await act(async () => {
      getReactProps(pmSelect).onChange({ target: { value: 'pm-card-fixed' } });
    });

    // O cartão já está resolvido automaticamente via selectedPaymentMethod.credit_card_id!
    // Selecionar 4 parcelas
    const updatedSelects = findNodes(container, (n) => n.tagName === 'SELECT');
    const instSelect = updatedSelects.find((s) => getReactProps(s)?.value === 1 && s !== pmSelect && s !== catSelect);
    expect(instSelect).toBeDefined();

    await act(async () => {
      getReactProps(instSelect).onChange({ target: { value: 4 } });
    });

    // Selecionar 3 parcelas já pagas
    const paidSelect = findNodes(container, (n) => n.tagName === 'SELECT').find((s) => getReactProps(s)?.value === 0 && s !== instSelect && s !== pmSelect);
    expect(paidSelect).toBeDefined();

    await act(async () => {
      getReactProps(paidSelect).onChange({ target: { value: 3 } });
    });

    // Agora reduz o total de parcelas de 4 para 2 (deve disparar reset automático de paidInstallmentsCount para 0)
    await act(async () => {
      getReactProps(instSelect).onChange({ target: { value: 2 } });
    });

    const form = findNodes(container, (n) => n.tagName === 'FORM')[0];
    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });

    expect(mockCreateInstallmentPurchase).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Jantar Restaurante',
        total_amount: 600,
        installment_count: 2,
        paid_installments_count: 0,
        credit_card_id: 'card-1',
        category_id: 'sub-exp-1',
        payment_method_id: 'pm-card-fixed',
      })
    );

    await act(async () => {
      root.unmount();
    });
  });

  it('deve limpar seleção de método de cartão ao alternar de Despesa para Receita', async () => {
    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(QuickAddModal, { isOpen: true, onClose: mockOnClose }));
    });

    // Selecionar método de cartão fixo
    const selects = findNodes(container, (n) => n.tagName === 'SELECT');
    const pmSelect = selects.find((s) => (s as any).options?.some?.((o: any) => o.value === 'pm-card-fixed'));
    expect(pmSelect).toBeDefined();

    await act(async () => {
      getReactProps(pmSelect).onChange({ target: { value: 'pm-card-fixed' } });
    });

    // Clicar na aba Receita
    const buttons = findNodes(container, (n) => n.tagName === 'BUTTON');
    const incomeTab = buttons.find((b) => getReactProps(b)?.children === 'Receita');
    expect(incomeTab).toBeDefined();

    await act(async () => {
      getReactProps(incomeTab).onClick();
    });

    // Em Receita, métodos de cartão não devem aparecer e o método selecionado foi resetado
    const updatedSelects = findNodes(container, (n) => n.tagName === 'SELECT');
    const newPmSelect = updatedSelects.find((s) => getReactProps(s)?.value === '');
    expect(newPmSelect).toBeDefined();

    await act(async () => {
      root.unmount();
    });
  });
});
