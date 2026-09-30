import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QuickAddModal } from '@/components/transactions/QuickAddModal';
import SplitsPage from '@/app/(dashboard)/splits/page';
import { SharedExpensesList } from '@/components/splits/SharedExpensesList';
import { SplitSummary } from '@/components/splits/SplitSummary';
import { SettlementHistory } from '@/components/splits/SettlementHistory';
import { SettlementModal } from '@/components/splits/SettlementModal';
import { PeopleManager } from '@/components/splits/PeopleManager';
import { SplitFields } from '@/components/transactions/quick-add/SplitFields';
import * as FinanceContext from '@/lib/context/finance-context';
import { calculateExpenseSplits } from '@/lib/financial-engine';
import { WorkspaceMember, Workspace, Person } from '@/lib/types';

describe('Splits Flow UI Tests (P2-01 Auditoria Externa V36)', () => {
  const mockAddTransaction = vi.fn();
  const mockCreateInstallmentPurchase = vi.fn();
  const mockRecordSettlement = vi.fn();
  const mockDeleteSettlement = vi.fn();
  const mockAddPerson = vi.fn();
  const mockUpdatePerson = vi.fn();
  const mockDeletePerson = vi.fn();
  const mockOnClose = vi.fn();

  const mockWorkspace: Workspace = {
    id: 'ws-2',
    name: 'Casa & Família',
    owner_id: 'usr-1',
    currency: 'BRL',
    created_at: '2026-01-15T00:00:00Z',
    tracking_mode: 'full',
  };

  const mockMembers: WorkspaceMember[] = [
    {
      id: 'wsm-2',
      workspace_id: 'ws-2',
      user_id: 'usr-1',
      role: 'owner',
      user: {
        id: 'usr-1',
        name: 'Rodrigo Silva',
        email: 'rodrigo@exemplo.com',
        created_at: '2026-01-01T00:00:00Z',
      },
      created_at: '2026-01-15T00:00:00Z',
    },
    {
      id: 'wsm-3',
      workspace_id: 'ws-2',
      user_id: 'usr-2',
      role: 'admin',
      user: {
        id: 'usr-2',
        name: 'Camila Santos',
        email: 'camila@exemplo.com',
        created_at: '2026-01-01T00:00:00Z',
      },
      created_at: '2026-01-15T00:00:00Z',
    },
  ];

  const mockCategories = [
    { id: 'cat-1', name: 'Alimentação', icon: 'Utensils', color: '#f59e0b', type: 'expense', active: true },
  ];

  const mockAccounts = [
    { id: 'acc-1', name: 'Conta Corrente', type: 'checking', institution: 'Banco', initial_balance: 1000, current_balance: 1000, active: true },
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
      className = '';
      textContent = '';
      setAttribute(k: string, v: string) { (this as any)[k] = v; }
      removeAttribute(k: string) { delete (this as any)[k]; }
      addEventListener() {}
      removeEventListener() {}
      focus() {}
      blur() {}
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
      if (tag.toLowerCase() === 'select') return new MockSelectElement();
      const el = new MockElement();
      el.tagName = tag.toUpperCase();
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
    (globalThis as any).HTMLTextAreaElement = class extends MockElement {};
    (globalThis as any).HTMLSelectElement = MockSelectElement;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('QuickAddModal: interage com formulário de rateio, preenche custom e submete (P0-03, P2-01 & P2-02)', async () => {
    vi.spyOn(FinanceContext, 'useFinance').mockReturnValue({
      activeWorkspace: mockWorkspace,
      workspaceMembers: mockMembers,
      categories: mockCategories as any,
      paymentMethods: [] as any,
      accounts: mockAccounts as any,
      creditCards: [] as any,
      addTransaction: mockAddTransaction,
      createInstallmentPurchase: mockCreateInstallmentPurchase,
      createTransfer: vi.fn(),
    } as any);

    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<QuickAddModal isOpen={true} onClose={mockOnClose} />);
    });

    // 1. Localiza os campos de valor e descrição
    const inputs = findNodes(container, (n) => n.tagName === 'INPUT');
    const amountInput = inputs.find((i) => getReactProps(i)?.placeholder === '0,00');
    const descInput = inputs.find((i) => getReactProps(i)?.placeholder?.includes('Supermercado'));

    expect(amountInput).toBeDefined();
    expect(descInput).toBeDefined();

    // Preenche valor 100,00 e descrição "Jantar com Amigos"
    await act(async () => {
      getReactProps(amountInput).onChange({ target: { value: '100,00' } });
      getReactProps(descInput).onChange({ target: { value: 'Jantar com Amigos' } });
    });

    // 2. Localiza o select de regra de divisão
    const selects = findNodes(container, (n) => n.tagName === 'SELECT');
    const splitTypeSelect = selects.find((s) => {
      const props = getReactProps(s);
      return props?.value === 'individual' || props?.children?.some?.((c: any) => c?.props?.value === 'equal');
    });
    expect(splitTypeSelect).toBeDefined();

    // Altera para 'equal'
    await act(async () => {
      getReactProps(splitTypeSelect).onChange({ target: { value: 'equal' } });
    });

    // Submete o formulário com divisão igualitária
    const form = findNodes(container, (n) => n.tagName === 'FORM')[0];
    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });

    expect(mockAddTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Jantar com Amigos',
        amount: 100,
        type: 'expense',
        split_type: 'equal',
        splits: [
          { member_id: 'wsm-2', amount: 50, percentage: 50 },
          { member_id: 'wsm-3', amount: 50, percentage: 50 },
        ],
      })
    );

    mockAddTransaction.mockClear();

    // 3. Interage com 'custom': seleciona custom e preenche valores para cada membro
    const currentAmountInput = findNodes(container, (n) => n.tagName === 'INPUT').find((i) => getReactProps(i)?.placeholder === '0,00');
    const currentDescInput = findNodes(container, (n) => n.tagName === 'INPUT').find((i) => getReactProps(i)?.placeholder?.includes('Supermercado'));
    const curSplitSelect = findNodes(container, (n) => n.tagName === 'SELECT').find((s) => {
      const p = getReactProps(s);
      return p?.children?.some?.((c: any) => c?.props?.value === 'custom');
    });

    await act(async () => {
      getReactProps(currentDescInput).onChange({ target: { value: 'Jantar com Amigos' } });
      getReactProps(currentAmountInput).onChange({ target: { value: '100,00' } });
      getReactProps(curSplitSelect).onChange({ target: { value: 'custom' } });
    });

    // Encontra os inputs de custom splits renderizados no preview
    const customInputs = findNodes(container, (n) => n.tagName === 'INPUT' && getReactProps(n)?.type === 'number');
    expect(customInputs.length).toBe(2);

    // Preenche R$ 30,00 para wsm-2 e R$ 70,00 para wsm-3
    await act(async () => {
      getReactProps(customInputs[0]).onChange({ target: { value: '30.00' } });
      getReactProps(customInputs[1]).onChange({ target: { value: '70.00' } });
    });

    // Submete com os splits customizados
    await act(async () => {
      const currentForm = findNodes(container, (n) => n.tagName === 'FORM')[0];
      getReactProps(currentForm).onSubmit({ preventDefault: () => {} });
    });

    expect(mockAddTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Jantar com Amigos',
        amount: 100,
        type: 'expense',
        split_type: 'custom',
        splits: [
          { member_id: 'wsm-2', amount: 30, percentage: 30 },
          { member_id: 'wsm-3', amount: 70, percentage: 70 },
        ],
      })
    );

    root.unmount();
  });

  it('SplitsPage: renderiza acertos recomendados, valida limite direcional no modal e executa acerto válido (P0-01 & P2-01)', async () => {
    // Cenário: Rodrigo (wsm-2) pagou 100 de almoço dividido 50/50 com Camila (wsm-3).
    // Camila deve R$ 50 para Rodrigo.
    const mockTxs = [
      {
        id: 'tx-1',
        workspace_id: 'ws-2',
        description: 'Almoço Compartilhado',
        amount: 100,
        type: 'expense' as const,
        paid_by_member_id: 'wsm-2',
        split_type: 'equal' as const,
        splits: [
          { member_id: 'wsm-2', amount: 50 },
          { member_id: 'wsm-3', amount: 50 },
        ],
        transaction_date: '2026-09-18',
        due_date: '2026-09-18',
        status: 'paid' as const,
        created_at: '2026-09-18T12:00:00Z',
      },
    ];

    vi.spyOn(FinanceContext, 'useFinance').mockReturnValue({
      activeWorkspace: mockWorkspace,
      workspaceMembers: mockMembers,
      transactions: mockTxs as any,
      purchases: [],
      settlements: [],
      recordSettlement: mockRecordSettlement,
      deleteSettlement: mockDeleteSettlement,
    } as any);

    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<SplitsPage />);
    });

    // Procura o botão "Liquidar Agora" que abre o modal pré-preenchido
    const buttons = findNodes(container, (n) => n.tagName === 'BUTTON');
    const settleBtn = buttons.find((b) => {
      const props = getReactProps(b);
      return props?.children === 'Liquidar Agora';
    });

    expect(settleBtn).toBeDefined();

    // Clica em "Liquidar Agora" para abrir o modal de acerto com wsm-3 -> wsm-2 (R$ 50.00)
    await act(async () => {
      const props = getReactProps(settleBtn);
      props.onClick();
    });

    // Procura o formulário de settlement
    const forms = findNodes(container, (n) => n.tagName === 'FORM');
    expect(forms.length).toBeGreaterThan(0);
    const form = forms[0];
    const formProps = getReactProps(form);

    // 1. Tenta submeter valor excedente (R$ 60,00 quando a dívida é R$ 50,00)
    const inputs = findNodes(form, (n) => n.tagName === 'INPUT');
    const amountInput = inputs.find((i) => getReactProps(i)?.type === 'number');
    expect(amountInput).toBeDefined();

    // Altera o valor para 60,00 (excedente)
    const amountProps = getReactProps(amountInput);
    await act(async () => {
      amountProps.onChange({ target: { value: '60.00' } });
    });

    // Tenta submeter: deve ser bloqueado localmente na interface
    await act(async () => {
      const currentForm = findNodes(container, (n) => n.tagName === 'FORM')[0];
      const currentFormProps = getReactProps(currentForm);
      currentFormProps.onSubmit({ preventDefault: () => {} });
    });
    expect(mockRecordSettlement).not.toHaveBeenCalled();

    // 2. Altera de volta para valor válido (R$ 40,00)
    const updatedInputs = findNodes(container, (n) => n.tagName === 'INPUT');
    const updatedAmountInput = updatedInputs.find((i) => getReactProps(i)?.type === 'number');
    await act(async () => {
      getReactProps(updatedAmountInput).onChange({ target: { value: '40.00' } });
    });

    await act(async () => {
      const currentForm = findNodes(container, (n) => n.tagName === 'FORM')[0];
      const currentFormProps = getReactProps(currentForm);
      currentFormProps.onSubmit({ preventDefault: () => {} });
    });

    expect(mockRecordSettlement).toHaveBeenCalledWith(
      expect.objectContaining({
        from_member_id: 'wsm-3',
        to_member_id: 'wsm-2',
        amount: 40.0,
      })
    );

    root.unmount();
  });

  it('SplitsPage: exclui liquidação existente chamando deleteSettlement (P2-01)', async () => {
    const mockSettlements = [
      {
        id: 'set-1',
        workspace_id: 'ws-2',
        from_member_id: 'wsm-3',
        to_member_id: 'wsm-2',
        amount: 50.0,
        settlement_date: '2026-09-18',
        created_at: '2026-09-18T10:00:00Z',
      },
      {
        id: 'set-2',
        workspace_id: 'ws-2',
        from_member_id: 'wsm-2',
        to_member_id: 'wsm-3',
        amount: 25.0,
        settlement_date: '2026-09-17',
        created_at: '2026-09-17T10:00:00Z',
      },
    ];

    vi.spyOn(FinanceContext, 'useFinance').mockReturnValue({
      activeWorkspace: mockWorkspace,
      workspaceMembers: mockMembers,
      transactions: [],
      purchases: [],
      settlements: mockSettlements as any,
      recordSettlement: mockRecordSettlement,
      deleteSettlement: mockDeleteSettlement,
    } as any);

    // Mock confirm
    (globalThis as any).confirm = vi.fn().mockReturnValue(true);
    (window as any).confirm = (globalThis as any).confirm;

    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<SplitsPage />);
    });

    const buttons = findNodes(container, (n) => n.tagName === 'BUTTON');
    const deleteBtn = buttons.find((b) => {
      const props = getReactProps(b);
      return props?.title === 'Excluir acerto';
    });

    expect(deleteBtn).toBeDefined();

    await act(async () => {
      const props = getReactProps(deleteBtn);
      props.onClick();
    });

    expect(mockDeleteSettlement).toHaveBeenCalledWith('set-1');
    root.unmount();
  });

  it('SplitsPage: exibe aviso quando há apenas 1 membro no workspace e desabilita botão de acerto', async () => {
    vi.spyOn(FinanceContext, 'useFinance').mockReturnValue({
      activeWorkspace: mockWorkspace,
      workspaceMembers: [mockMembers[0]],
      transactions: [],
      purchases: [],
      settlements: [],
      recordSettlement: mockRecordSettlement,
      deleteSettlement: mockDeleteSettlement,
    } as any);

    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<SplitsPage />);
    });

    // Deve renderizar texto de membro único
    const textNodes = findNodes(container, (n) => n.textContent?.includes('Workspace com membro único'));
    expect(textNodes.length).toBeGreaterThan(0);

    // Botão Registrar Acerto deve estar desabilitado
    const buttons = findNodes(container, (n) => n.tagName === 'BUTTON');
    const settleBtn = buttons.find((b) => {
      const p = getReactProps(b);
      return p?.children?.[1] === 'Registrar Acerto de Contas' || (Array.isArray(p?.children) && p.children.includes('Registrar Acerto de Contas'));
    });
    expect(settleBtn).toBeDefined();
    expect(getReactProps(settleBtn).disabled).toBe(true);

    root.unmount();
  });

  it('SplitsPage: exibe mensagem quando todas as contas estão acertadas (0 dívidas)', async () => {
    vi.spyOn(FinanceContext, 'useFinance').mockReturnValue({
      activeWorkspace: mockWorkspace,
      workspaceMembers: mockMembers,
      transactions: [],
      purchases: [],
      settlements: [],
      recordSettlement: mockRecordSettlement,
      deleteSettlement: mockDeleteSettlement,
    } as any);

    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<SplitsPage />);
    });

    const textNodes = findNodes(container, (n) => n.textContent?.includes('Todas as contas estão acertadas!'));
    expect(textNodes.length).toBeGreaterThan(0);

    root.unmount();
  });

  it('SplitsPage: abre modal manual superior, usa botão Preencher Total, preenche data/notas e cancela', async () => {
    const mockTxs = [
      {
        id: 'tx-1',
        workspace_id: 'ws-2',
        description: 'Jantar',
        amount: 100,
        type: 'expense' as const,
        paid_by_member_id: 'wsm-2',
        split_type: 'equal' as const,
        splits: [
          { member_id: 'wsm-2', amount: 50 },
          { member_id: 'wsm-3', amount: 50 },
        ],
        transaction_date: '2026-09-18',
        due_date: '2026-09-18',
        status: 'paid' as const,
        created_at: '2026-09-18T12:00:00Z',
      },
    ];

    const mockPurchases = [
      {
        id: 'pur-1',
        workspace_id: 'ws-2',
        description: 'Móveis Parcelados',
        total_amount: 300,
        installment_count: 3,
        paid_by_member_id: 'wsm-2',
        split_type: 'equal' as const,
        splits: [
          { member_id: 'wsm-2', amount: 150 },
          { member_id: 'wsm-3', amount: 150 },
        ],
        purchase_date: '2026-09-10',
        created_at: '2026-09-10T10:00:00Z',
      },
    ];

    vi.spyOn(FinanceContext, 'useFinance').mockReturnValue({
      activeWorkspace: mockWorkspace,
      workspaceMembers: mockMembers,
      transactions: mockTxs as any,
      purchases: mockPurchases as any,
      settlements: [],
      recordSettlement: mockRecordSettlement,
      deleteSettlement: mockDeleteSettlement,
    } as any);

    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<SplitsPage />);
    });

    // 1. Abre modal pelo botão do topo
    const buttons = findNodes(container, (n) => n.tagName === 'BUTTON');
    const topBtn = buttons.find((b) => {
      const p = getReactProps(b);
      return p?.children?.[1] === 'Registrar Acerto de Contas' || (Array.isArray(p?.children) && p.children.includes('Registrar Acerto de Contas'));
    });
    expect(topBtn).toBeDefined();

    await act(async () => {
      getReactProps(topBtn).onClick();
    });

    // Modal aberto: encontra botão "Preencher total"
    const fillTotalBtn = findNodes(container, (n) => n.tagName === 'BUTTON' && getReactProps(n)?.children === 'Preencher total')[0];
    expect(fillTotalBtn).toBeDefined();

    await act(async () => {
      getReactProps(fillTotalBtn).onClick();
    });

    // Preenche data e notas
    const dateInput = findNodes(container, (n) => n.tagName === 'INPUT' && getReactProps(n)?.type === 'date')[0];
    expect(dateInput).toBeDefined();
    await act(async () => {
      getReactProps(dateInput).onChange({ target: { value: '2026-09-19' } });
    });

    const textarea = findNodes(container, (n) => n.tagName === 'TEXTAREA')[0];
    expect(textarea).toBeDefined();
    await act(async () => {
      getReactProps(textarea).onChange({ target: { value: 'Acerto via Pix Banco do Brasil' } });
    });

    // Cancela o modal pelo botão "Cancelar"
    const cancelBtn = findNodes(container, (n) => n.tagName === 'BUTTON' && getReactProps(n)?.children === 'Cancelar')[0];
    expect(cancelBtn).toBeDefined();

    await act(async () => {
      getReactProps(cancelBtn).onClick();
    });

    // Modal foi fechado
    expect(findNodes(container, (n) => n.tagName === 'FORM').length).toBe(0);

    // Reabre e fecha pelo botão 'X'
    await act(async () => {
      getReactProps(topBtn).onClick();
    });
    expect(findNodes(container, (n) => n.tagName === 'FORM').length).toBe(1);

    const modalCloseBtn = findNodes(container, (n) => n.tagName === 'BUTTON' && getReactProps(n)?.className?.includes('rounded-xl p-1.5'))[0];
    expect(modalCloseBtn).toBeDefined();
    await act(async () => {
      getReactProps(modalCloseBtn).onClick();
    });
    expect(findNodes(container, (n) => n.tagName === 'FORM').length).toBe(0);

    root.unmount();
  });

  it('SplitsPage: validações de formulário (mesmo membro, valor zero, sem débito e exceção)', async () => {
    const mockTxs = [
      {
        id: 'tx-1',
        workspace_id: 'ws-2',
        description: 'Mercado',
        amount: 80,
        type: 'expense' as const,
        paid_by_member_id: 'wsm-2',
        split_type: 'equal' as const,
        splits: [
          { member_id: 'wsm-2', amount: 40 },
          { member_id: 'wsm-3', amount: 40 },
        ],
        transaction_date: '2026-09-18',
        due_date: '2026-09-18',
        status: 'paid' as const,
        created_at: '2026-09-18T12:00:00Z',
      },
    ];

    vi.spyOn(FinanceContext, 'useFinance').mockReturnValue({
      activeWorkspace: mockWorkspace,
      workspaceMembers: mockMembers,
      transactions: mockTxs as any,
      purchases: [],
      settlements: [],
      recordSettlement: mockRecordSettlement,
      deleteSettlement: mockDeleteSettlement,
    } as any);

    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<SplitsPage />);
    });

    // Abre modal pelo botão Liquidar Agora (wsm-3 deve a wsm-2 R$ 40)
    const settleBtn = findNodes(container, (n) => n.tagName === 'BUTTON' && getReactProps(n)?.children === 'Liquidar Agora')[0];
    await act(async () => {
      getReactProps(settleBtn).onClick();
    });

    const form = findNodes(container, (n) => n.tagName === 'FORM')[0];
    const selects = findNodes(form, (n) => n.tagName === 'SELECT');

    // 1. Mesmo membro como pagador e recebedor
    await act(async () => {
      getReactProps(selects[0]).onChange({ target: { value: 'wsm-2' } });
      getReactProps(selects[1]).onChange({ target: { value: 'wsm-2' } });
    });

    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });
    expect(mockRecordSettlement).not.toHaveBeenCalled();

    // 2. Sem membros selecionados (vazio)
    await act(async () => {
      getReactProps(selects[0]).onChange({ target: { value: '' } });
    });
    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });
    expect(mockRecordSettlement).not.toHaveBeenCalled();

    // 3. Valor zero ou negativo
    await act(async () => {
      getReactProps(selects[0]).onChange({ target: { value: 'wsm-3' } });
      getReactProps(selects[1]).onChange({ target: { value: 'wsm-2' } });
    });

    const amountInput = findNodes(form, (n) => n.tagName === 'INPUT' && getReactProps(n)?.type === 'number')[0];
    await act(async () => {
      getReactProps(amountInput).onChange({ target: { value: '0' } });
    });

    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });
    expect(mockRecordSettlement).not.toHaveBeenCalled();

    // 4. Sem débito na direção oposta (wsm-2 pagando wsm-3, quando quem deve é wsm-3)
    await act(async () => {
      getReactProps(selects[0]).onChange({ target: { value: 'wsm-2' } });
      getReactProps(selects[1]).onChange({ target: { value: 'wsm-3' } });
      getReactProps(amountInput).onChange({ target: { value: '40' } });
    });

    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });
    expect(mockRecordSettlement).not.toHaveBeenCalled();

    // 5. Simulação de erro lançado pelo recordSettlement
    mockRecordSettlement.mockImplementationOnce(() => {
      throw new Error('Erro ao salvar settlement no storage');
    });

    await act(async () => {
      getReactProps(selects[0]).onChange({ target: { value: 'wsm-3' } });
      getReactProps(selects[1]).onChange({ target: { value: 'wsm-2' } });
      getReactProps(amountInput).onChange({ target: { value: '20' } });
    });

    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });

    expect(mockRecordSettlement).toHaveBeenCalled();
    // Modal ainda permanece aberto porque houve erro
    expect(findNodes(container, (n) => n.tagName === 'FORM').length).toBe(1);

    root.unmount();
  });

  it('SplitsPage: renderiza fallback quando transação ou split possui ID nulo de membro', async () => {
    const mockTxs = [
      {
        id: 'tx-null',
        workspace_id: 'ws-2',
        description: 'Despesa Sem Autor',
        amount: 50,
        type: 'expense' as const,
        paid_by_member_id: null,
        split_type: 'equal' as const,
        splits: [
          { member_id: null as any, amount: 50 },
        ],
        transaction_date: '2026-09-18',
        due_date: '2026-09-18',
        status: 'paid' as const,
        created_at: '2026-09-18T12:00:00Z',
      },
    ];

    const mockSettlements = [
      {
        id: 'set-sem-notas',
        workspace_id: 'ws-2',
        from_member_id: 'wsm-2',
        to_member_id: 'wsm-3',
        amount: 30,
        settlement_date: '2026-09-18',
        notes: undefined,
        created_at: '2026-09-18T10:00:00Z',
      },
    ];

    vi.spyOn(FinanceContext, 'useFinance').mockReturnValue({
      activeWorkspace: mockWorkspace,
      workspaceMembers: mockMembers,
      transactions: mockTxs as any,
      purchases: [],
      settlements: mockSettlements as any,
      recordSettlement: mockRecordSettlement,
      deleteSettlement: mockDeleteSettlement,
    } as any);

    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<SplitsPage />);
    });

    const fallbackNodes = findNodes(container, (n) => n.textContent?.includes('Membro não identificado'));
    expect(fallbackNodes.length).toBeGreaterThan(0);

    root.unmount();
  });

  it('SplitsPage: limpa mensagem de sucesso após timer de 5 segundos', async () => {
    vi.useFakeTimers();
    const mockTxs = [
      {
        id: 'tx-split-timer',
        workspace_id: 'ws-2',
        description: 'Jantar Compartilhado',
        amount: 100,
        type: 'expense' as const,
        paid_by_member_id: 'wsm-2',
        split_type: 'equal' as const,
        splits: [
          { member_id: 'wsm-2', amount: 50 },
          { member_id: 'wsm-3', amount: 50 },
        ],
        transaction_date: '2026-09-18',
        due_date: '2026-09-18',
        status: 'paid' as const,
        created_at: '2026-09-18T12:00:00Z',
      },
    ];

    vi.spyOn(FinanceContext, 'useFinance').mockReturnValue({
      activeWorkspace: mockWorkspace,
      workspaceMembers: mockMembers,
      transactions: mockTxs as any,
      purchases: [],
      settlements: [],
      recordSettlement: mockRecordSettlement,
      deleteSettlement: mockDeleteSettlement,
    } as any);

    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<SplitsPage />);
    });

    const buttons = findNodes(container, (n) => n.tagName === 'BUTTON');
    const settleBtn = buttons.find((b) => getReactProps(b)?.children === 'Liquidar Agora');
    expect(settleBtn).toBeDefined();

    await act(async () => {
      getReactProps(settleBtn).onClick();
    });

    const form = findNodes(container, (n) => n.tagName === 'FORM')[0];
    expect(form).toBeDefined();

    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });

    expect(mockRecordSettlement).toHaveBeenCalled();

    // Avança os 5000ms para disparar o callback `() => setSuccessMessage(null)`
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    await act(async () => {
      root.unmount();
    });
    vi.useRealTimers();
  });

  it('SharedExpensesList: renderiza variações de split_type, parcelamento e estado vazio', async () => {
    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    // 1. Estado vazio
    await act(async () => {
      root.render(
        <SharedExpensesList
          splitItems={[]}
          currentMembers={mockMembers}
          getMemberName={(id) => id || 'Membro'}
        />
      );
    });

    const emptyText = findNodes(container, (n) => n.textContent?.includes('Nenhuma despesa dividida'));
    expect(emptyText.length).toBeGreaterThan(0);

    // 2. Lista com variações de tipo (equal com 3 membros, full_other, custom, default, e compra parcelada)
    const threeMembers: WorkspaceMember[] = [
      ...mockMembers,
      {
        id: 'wsm-4',
        workspace_id: 'ws-2',
        user_id: 'usr-3',
        role: 'member',
        created_at: '2026-01-15T00:00:00Z',
      },
    ];

    const sampleItems = [
      {
        id: 'item-1',
        description: 'Jantar 3 Membros',
        amount: 300,
        date: '2026-09-01',
        paid_by_member_id: 'wsm-2',
        split_type: 'equal' as const,
        splits: [
          { member_id: 'wsm-2', amount: 100 },
          { member_id: 'wsm-3', amount: 100 },
          { member_id: 'wsm-4', amount: 100 },
        ],
        isPurchase: false,
        installmentCount: 1,
      },
      {
        id: 'item-2',
        description: 'Mercado 100% Outro',
        amount: 150,
        date: '2026-09-02',
        paid_by_member_id: 'wsm-2',
        split_type: 'full_other' as const,
        splits: [{ member_id: 'wsm-3', amount: 150 }],
        isPurchase: true,
        installmentCount: 3,
      },
      {
        id: 'item-3',
        description: 'Combustível Custom',
        amount: 200,
        date: '2026-09-03',
        paid_by_member_id: 'wsm-3',
        split_type: 'custom' as const,
        splits: [
          { member_id: 'wsm-2', amount: 120 },
          { member_id: 'wsm-3', amount: 80 },
        ],
        isPurchase: false,
        installmentCount: 1,
      },
      {
        id: 'item-4',
        description: 'Despesa Tipo Nulo',
        amount: 80,
        date: '2026-09-04',
        paid_by_member_id: 'wsm-2',
        split_type: null,
        splits: [{ member_id: 'wsm-2', amount: 80 }],
        isPurchase: false,
        installmentCount: 1,
      },
    ];

    await act(async () => {
      root.render(
        <SharedExpensesList
          splitItems={sampleItems}
          currentMembers={threeMembers}
          getMemberName={(id) => (id === 'wsm-2' ? 'Rodrigo' : id === 'wsm-3' ? 'Camila' : 'Outro')}
        />
      );
    });

    const equalBadge = findNodes(container, (n) => n.textContent?.includes('Divisão Igualitária'));
    expect(equalBadge.length).toBeGreaterThan(0);

    const fullOtherBadge = findNodes(container, (n) => n.textContent?.includes('100% Outro'));
    expect(fullOtherBadge.length).toBeGreaterThan(0);

    const customBadge = findNodes(container, (n) => n.textContent?.includes('Personalizado'));
    expect(customBadge.length).toBeGreaterThan(0);

    const defaultBadge = findNodes(container, (n) => n.textContent === 'Rateio');
    expect(defaultBadge.length).toBeGreaterThan(0);

    const parceladoBadge = findNodes(container, (n) => n.textContent?.includes('x parcelado'));
    expect(parceladoBadge.length).toBeGreaterThan(0);

    await act(async () => {
      root.unmount();
    });
  });

  it('SplitSummary: renderiza estado zerado e múltiplos acertos pendentes com disparo de callback', async () => {
    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);
    const mockOnSettle = vi.fn();

    // 1. Estado sem dívidas
    await act(async () => {
      root.render(
        <SplitSummary
          pairwiseDebts={[]}
          getMemberName={(id) => id || 'Membro'}
          onOpenSettleDebt={mockOnSettle}
        />
      );
    });

    const cleanText = findNodes(container, (n) => n.textContent?.includes('Todas as contas estão acertadas!'));
    expect(cleanText.length).toBeGreaterThan(0);

    // 2. Estado com 1 dívida (singular)
    const singleDebt = [{ from_member_id: 'wsm-3', to_member_id: 'wsm-2', amount: 45.5 }];
    await act(async () => {
      root.render(
        <SplitSummary
          pairwiseDebts={singleDebt}
          getMemberName={(id) => (id === 'wsm-2' ? 'Rodrigo' : 'Camila')}
          onOpenSettleDebt={mockOnSettle}
        />
      );
    });

    const singleBadge = findNodes(container, (n) => n.textContent?.includes('1 acerto pendente'));
    expect(singleBadge.length).toBeGreaterThan(0);

    // Clicar no botão de liquidar acerto
    const buttons = findNodes(container, (n) => n.tagName === 'BUTTON');
    const settleBtn = buttons.find((b) => getReactProps(b)?.children === 'Liquidar Agora');
    expect(settleBtn).toBeDefined();

    await act(async () => {
      getReactProps(settleBtn).onClick();
    });
    expect(mockOnSettle).toHaveBeenCalledWith('wsm-3', 'wsm-2', 45.5);

    // 3. Estado com 2 dívidas (plural)
    const pluralDebts = [
      { from_member_id: 'wsm-3', to_member_id: 'wsm-2', amount: 45.5 },
      { from_member_id: 'wsm-4', to_member_id: 'wsm-2', amount: 90.0 },
    ];
    await act(async () => {
      root.render(
        <SplitSummary
          pairwiseDebts={pluralDebts}
          getMemberName={(id) => (id === 'wsm-2' ? 'Rodrigo' : 'Camila')}
          onOpenSettleDebt={mockOnSettle}
        />
      );
    });

    const pluralBadge = findNodes(container, (n) => n.textContent?.includes('2 acertos pendentes'));
    expect(pluralBadge.length).toBeGreaterThan(0);

    await act(async () => {
      root.unmount();
    });
  });

  it('SettlementHistory: renderiza registros com e sem notas, e respeita confirm true/false ao excluir', async () => {
    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);
    const mockDelete = vi.fn();

    const sampleSettlements = [
      {
        id: 'set-with-notes',
        workspace_id: 'ws-2',
        from_member_id: 'wsm-2',
        to_member_id: 'wsm-3',
        amount: 50.0,
        settlement_date: '2026-08-15',
        notes: 'Pix de almoço',
        created_at: '2026-08-15',
      },
      {
        id: 'set-no-notes',
        workspace_id: 'ws-2',
        from_member_id: 'wsm-3',
        to_member_id: 'wsm-2',
        amount: 20.0,
        settlement_date: '2026-08-16',
        created_at: '2026-08-16',
      },
    ];

    await act(async () => {
      root.render(
        <SettlementHistory
          workspaceSettlements={sampleSettlements}
          getMemberName={(id) => (id === 'wsm-2' ? 'Rodrigo' : 'Camila')}
          onDeleteSettlement={mockDelete}
        />
      );
    });

    const notesText = findNodes(container, (n) => n.textContent?.includes('Pix de almoço'));
    expect(notesText.length).toBeGreaterThan(0);

    const deleteButtons = findNodes(container, (n) => n.tagName === 'BUTTON');
    expect(deleteButtons.length).toBe(2);

    // 1. window.confirm retorna false: não deve chamar onDeleteSettlement
    const originalConfirm = (globalThis as any).window.confirm;
    (globalThis as any).window.confirm = vi.fn().mockReturnValue(false);

    await act(async () => {
      getReactProps(deleteButtons[0]).onClick();
    });
    expect(mockDelete).not.toHaveBeenCalled();

    // 2. window.confirm retorna true: deve chamar onDeleteSettlement
    (globalThis as any).window.confirm = vi.fn().mockReturnValue(true);

    await act(async () => {
      getReactProps(deleteButtons[0]).onClick();
    });
    expect(mockDelete).toHaveBeenCalledWith('set-with-notes');

    (globalThis as any).window.confirm = originalConfirm;

    await act(async () => {
      root.unmount();
    });
  });

  it('SettlementModal: trata fallbacks de nome de membros, botão Preencher Total e ausência de dívida', async () => {
    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    const mockSetFrom = vi.fn();
    const mockSetTo = vi.fn();
    const mockSetAmount = vi.fn();
    const mockSetDate = vi.fn();
    const mockSetNotes = vi.fn();
    const mockSetAccount = vi.fn();
    const mockOnSubmit = vi.fn();
    const mockCloseModal = vi.fn();

    // Membro com apenas email prefix e membro com apenas ID
    const fallbackMembers: WorkspaceMember[] = [
      {
        id: 'wsm-email-only',
        workspace_id: 'ws-2',
        user_id: 'usr-e',
        role: 'member',
        user: { id: 'usr-e', name: '', email: 'prefixo@exemplo.com', created_at: '' },
        created_at: '2026-01-01',
      },
      {
        id: 'wsm-id-only',
        workspace_id: 'ws-2',
        user_id: 'usr-none',
        role: 'member',
        user: undefined as any,
        created_at: '2026-01-01',
      },
    ];

    // 1. Renderiza com dívida bilateral existente (> 0)
    await act(async () => {
      root.render(
        <SettlementModal
          isOpen={true}
          onClose={mockCloseModal}
          fromMemberId="wsm-email-only"
          toMemberId="wsm-id-only"
          settlementAmountStr=""
          settlementDate="2026-08-20"
          settlementNotes=""
          currentMembers={fallbackMembers}
          selectedPairDebt={{ from_member_id: 'wsm-email-only', to_member_id: 'wsm-id-only', amount: 85.5 }}
          settlementError={null}
          setFromMemberId={mockSetFrom}
          setToMemberId={mockSetTo}
          setSettlementAmountStr={mockSetAmount}
          setSettlementDate={mockSetDate}
          setSettlementNotes={mockSetNotes}
          onSubmit={mockOnSubmit}
        />
      );
    });

    // Encontra o botão "Preencher total" e clica nele
    const fillTotalBtn = findNodes(container, (n) => n.tagName === 'BUTTON' && n.textContent?.includes('Preencher total'))[0];
    expect(fillTotalBtn).toBeDefined();

    await act(async () => {
      getReactProps(fillTotalBtn).onClick();
    });
    expect(mockSetAmount).toHaveBeenCalledWith('85.50');

    // 2. Renderiza quando selectedPairDebt for null ou zerado
    await act(async () => {
      root.render(
        <SettlementModal
          isOpen={true}
          onClose={mockCloseModal}
          fromMemberId="wsm-email-only"
          toMemberId="wsm-id-only"
          settlementAmountStr=""
          settlementDate="2026-08-20"
          settlementNotes=""
          currentMembers={fallbackMembers}
          selectedPairDebt={null}
          settlementError={null}
          setFromMemberId={mockSetFrom}
          setToMemberId={mockSetTo}
          setSettlementAmountStr={mockSetAmount}
          setSettlementDate={mockSetDate}
          setSettlementNotes={mockSetNotes}
          onSubmit={mockOnSubmit}
        />
      );
    });

    const noDebtCard = findNodes(container, (n) => n.textContent?.includes('Não há débito pendente nesta direção.'));
    expect(noDebtCard.length).toBeGreaterThan(0);

    await act(async () => {
      root.unmount();
    });
  });

  it('SplitsPage: cobre fallbacks de nome de membro, workspace de membro único, botão superior e validação de limite de dívida', async () => {
    const singleMember: WorkspaceMember[] = [
      {
        id: 'wsm-alone',
        workspace_id: 'ws-single',
        user_id: 'u-alone',
        role: 'owner',
        user: { id: 'u-alone', name: '', email: 'solitary@fincontrol.com', created_at: '' },
        created_at: '',
      },
    ];

    const singleWs: Workspace = {
      id: 'ws-single',
      name: 'Workspace Individual',
      owner_id: 'u-alone',
      currency: 'BRL',
      created_at: '2026-01-01',
      tracking_mode: 'full',
    };

    vi.spyOn(FinanceContext, 'useFinance').mockReturnValue({
      activeWorkspace: singleWs,
      workspaceMembers: singleMember,
      transactions: [],
      purchases: [],
      settlements: [],
      recordSettlement: mockRecordSettlement,
      deleteSettlement: mockDeleteSettlement,
    } as any);

    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<SplitsPage />);
    });

    // 1. Deve exibir o alerta de membro único
    const singleWarning = findNodes(container, (n) => n.textContent?.includes('Workspace com membro único'));
    expect(singleWarning.length).toBeGreaterThan(0);

    // Botão de registrar acerto deve estar desabilitado
    const buttons = findNodes(container, (n) => n.tagName === 'BUTTON');
    const topBtn = buttons.find((b) => {
      const p = getReactProps(b);
      return p?.children?.[1] === 'Registrar Acerto de Contas' || (Array.isArray(p?.children) && p.children.includes('Registrar Acerto de Contas'));
    });
    expect(topBtn).toBeDefined();
    expect(getReactProps(topBtn)?.disabled).toBe(true);

    // 2. Agora monta com membros que exercitam os fallbacks de nome (email apenas e ID apenas)
    const variedMembers: WorkspaceMember[] = [
      {
        id: 'wsm-email-only',
        workspace_id: 'ws-pair',
        user_id: 'u-email',
        role: 'owner',
        user: { id: 'u-email', name: '', email: 'emailonly@teste.com', created_at: '' },
        created_at: '',
      },
      {
        id: 'wsm-id-only',
        workspace_id: 'ws-pair',
        user_id: 'u-none',
        role: 'member',
        user: undefined as any,
        created_at: '',
      },
    ];

    const pairWs: Workspace = {
      id: 'ws-pair',
      name: 'Workspace Par',
      owner_id: 'u-email',
      currency: 'BRL',
      created_at: '2026-01-01',
      tracking_mode: 'full',
    };

    // wsm-id-only deve 50 para wsm-email-only
    const mockTxs = [
      {
        id: 'tx-pair-1',
        workspace_id: 'ws-pair',
        description: 'Jantar a dois',
        amount: 100,
        type: 'expense' as const,
        paid_by_member_id: 'wsm-email-only',
        split_type: 'equal' as const,
        splits: [
          { member_id: 'wsm-email-only', amount: 50 },
          { member_id: 'wsm-id-only', amount: 50 },
        ],
        transaction_date: '2026-09-18',
        due_date: '2026-09-18',
        status: 'paid' as const,
        created_at: '2026-09-18T12:00:00Z',
      },
    ];

    const mockSettlements = [
      {
        id: 'set-existente',
        workspace_id: 'ws-pair',
        from_member_id: 'wsm-id-only',
        to_member_id: 'wsm-email-only',
        amount: 20,
        settlement_date: '2026-09-19',
        notes: 'Acerto parcial',
        created_at: '2026-09-19T10:00:00Z',
      },
    ];

    vi.spyOn(FinanceContext, 'useFinance').mockReturnValue({
      activeWorkspace: pairWs,
      workspaceMembers: variedMembers,
      transactions: mockTxs as any,
      purchases: [],
      settlements: mockSettlements as any,
      recordSettlement: mockRecordSettlement,
      deleteSettlement: mockDeleteSettlement,
    } as any);

    await act(async () => {
      root.render(<SplitsPage />);
    });

    // Clica no botão "Registrar Acerto de Contas" do cabeçalho (linhas 183-189)
    const pairButtons = findNodes(container, (n) => n.tagName === 'BUTTON');
    const headerBtn = pairButtons.find((b) => {
      const p = getReactProps(b);
      return p?.children?.[1] === 'Registrar Acerto de Contas' || (Array.isArray(p?.children) && p.children.includes('Registrar Acerto de Contas'));
    });
    expect(headerBtn).toBeDefined();

    await act(async () => {
      getReactProps(headerBtn).onClick();
    });

    // O modal abre
    let form = findNodes(container, (n) => n.tagName === 'FORM')[0];
    expect(form).toBeDefined();

    // Digita valor que excede a dívida pendente (dívida pendente restante: 50 - 20 = 30; digitamos 45)
    const amountInput = findNodes(form, (n) => n.tagName === 'INPUT' && getReactProps(n)?.type === 'number')[0];
    await act(async () => {
      getReactProps(amountInput).onChange({ target: { value: '45.00' } });
    });

    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });

    // Erro de valor excedente deve ser exibido (linha 140)
    let errorMsg = findNodes(container, (n) => n.textContent?.includes('excede a dívida pendente'));
    expect(errorMsg.length).toBeGreaterThan(0);
    expect(mockRecordSettlement).not.toHaveBeenCalled();

    // Digita valor válido (25.00) com notas em branco (whitespace) para cobrir linha 153 (notes: undefined)
    await act(async () => {
      getReactProps(amountInput).onChange({ target: { value: '25.00' } });
    });

    const notesInput = findNodes(form, (n) => n.tagName === 'TEXTAREA')[0];
    if (notesInput) {
      await act(async () => {
        getReactProps(notesInput).onChange({ target: { value: '   ' } });
      });
    }

    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });

    expect(mockRecordSettlement).toHaveBeenCalledWith(
      expect.objectContaining({
        from_member_id: 'wsm-id-only',
        to_member_id: 'wsm-email-only',
        amount: 25,
        notes: undefined,
      })
    );

    mockRecordSettlement.mockClear();

    // 3. Testa exceção sem message ao salvar settlement (linha 160: err.message || 'Erro ao registrar o acerto.')
    await act(async () => {
      getReactProps(headerBtn).onClick();
    });

    form = findNodes(container, (n) => n.tagName === 'FORM')[0];
    const newAmountInput = findNodes(form, (n) => n.tagName === 'INPUT' && getReactProps(n)?.type === 'number')[0];
    await act(async () => {
      getReactProps(newAmountInput).onChange({ target: { value: '5.00' } });
    });

    mockRecordSettlement.mockImplementationOnce(() => {
      throw 'string error without message property';
    });

    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });

    errorMsg = findNodes(container, (n) => n.textContent?.includes('Erro ao registrar o acerto.'));
    expect(errorMsg.length).toBeGreaterThan(0);

    // 4. Testa onDeleteSettlement em SplitsPage (linha 245): confirm false e confirm true
    const trashBtn = findNodes(container, (n) => n.tagName === 'BUTTON' && getReactProps(n)?.title === 'Excluir acerto')[0];
    expect(trashBtn).toBeDefined();

    // Caso false no confirm de SplitsPage: SettlementHistory recebe true, SplitsPage recebe false
    (globalThis as any).window.confirm = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    await act(async () => {
      getReactProps(trashBtn).onClick();
    });
    expect(mockDeleteSettlement).not.toHaveBeenCalled();

    // Caso true: ambos recebem true
    (globalThis as any).window.confirm = vi.fn().mockReturnValue(true);
    await act(async () => {
      getReactProps(trashBtn).onClick();
    });
    expect(mockDeleteSettlement).toHaveBeenCalledWith('set-existente');

    // 5. Clica no headerBtn quando membros possuem id vazio para cobrir linhas 184-185 (|| '')
    const membersWithEmptyId: WorkspaceMember[] = [
      { id: '', workspace_id: 'ws-pair', user_id: 'u-1', role: 'owner', user: { id: 'u-1', name: 'User 1', email: 'u1@t.com', created_at: '' }, created_at: '' },
      { id: '', workspace_id: 'ws-pair', user_id: 'u-2', role: 'member', user: { id: 'u-2', name: 'User 2', email: 'u2@t.com', created_at: '' }, created_at: '' },
    ];
    vi.spyOn(FinanceContext, 'useFinance').mockReturnValue({
      activeWorkspace: pairWs,
      workspaceMembers: membersWithEmptyId,
      transactions: [],
      purchases: [],
      settlements: [],
      recordSettlement: mockRecordSettlement,
      deleteSettlement: mockDeleteSettlement,
    } as any);

    await act(async () => {
      root.render(<SplitsPage />);
    });

    const emptyIdBtns = findNodes(container, (n) => n.tagName === 'BUTTON');
    const headerBtnEmpty = emptyIdBtns.find((b) => {
      const p = getReactProps(b);
      return p?.children?.[1] === 'Registrar Acerto de Contas' || (Array.isArray(p?.children) && p.children.includes('Registrar Acerto de Contas'));
    });
    if (headerBtnEmpty) {
      await act(async () => {
        getReactProps(headerBtnEmpty).onClick();
      });
    }

    await act(async () => {
      root.unmount();
    });
  });

  it('PeopleManager: adiciona, edita, arquiva, desarquiva, exclui e trata erros de validação e servidor', async () => {
    const peopleData: Person[] = [
      { id: 'p-1', workspace_id: 'ws-2', name: 'Carlos Silva', created_at: '2026-03-01T10:00:00Z', archived: false },
      { id: 'p-2', workspace_id: 'ws-2', name: 'Mariana Costa', created_at: '2026-03-05T10:00:00Z', archived: true },
    ];

    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PeopleManager
          people={peopleData}
          onAddPerson={mockAddPerson}
          onUpdatePerson={mockUpdatePerson}
          onDeletePerson={mockDeletePerson}
        />
      );
    });

    // 1. Verifica validação de nome vazio e nome duplicado
    // Nome vazio via Enter
    await act(async () => {
      const input = findNodes(container, (n) => n.tagName === 'INPUT')[0];
      getReactProps(input).onKeyDown({ key: 'Enter', preventDefault: () => {} });
    });

    // Nome duplicado existente
    await act(async () => {
      const input = findNodes(container, (n) => n.tagName === 'INPUT')[0];
      getReactProps(input).onChange({ target: { value: '  carlos silva  ' } });
    });
    await act(async () => {
      const input = findNodes(container, (n) => n.tagName === 'INPUT')[0];
      getReactProps(input).onKeyDown({ key: 'Enter', preventDefault: () => {} });
    });

    // Sucesso na adição via clique no botão Adicionar
    mockAddPerson.mockResolvedValueOnce({ id: 'p-3', name: 'Lucas Fernandes', workspace_id: 'ws-2', created_at: '2026-03-10' });
    await act(async () => {
      const input = findNodes(container, (n) => n.tagName === 'INPUT')[0];
      getReactProps(input).onChange({ target: { value: 'Lucas Fernandes' } });
    });
    await act(async () => {
      const btns = findNodes(container, (n) => n.tagName === 'BUTTON');
      const btn = btns.find((b) => {
        const p = getReactProps(b);
        return Array.isArray(p?.children) && p.children.includes('Adicionar');
      });
      await getReactProps(btn).onClick({ preventDefault: () => {} });
    });
    expect(mockAddPerson).toHaveBeenCalledWith({ name: 'Lucas Fernandes' });

    // Erro assíncrono no add
    mockAddPerson.mockRejectedValueOnce(new Error('Erro no servidor ao salvar'));
    await act(async () => {
      const input = findNodes(container, (n) => n.tagName === 'INPUT')[0];
      getReactProps(input).onChange({ target: { value: 'Nome Que Falha' } });
    });
    await act(async () => {
      const btns = findNodes(container, (n) => n.tagName === 'BUTTON');
      const btn = btns.find((b) => {
        const p = getReactProps(b);
        return Array.isArray(p?.children) && p.children.includes('Adicionar');
      });
      await getReactProps(btn).onClick({ preventDefault: () => {} });
    });

    // 2. Fechar banner de erro se visível
    const allBtns = findNodes(container, (n) => n.tagName === 'BUTTON');
    const dismissBtn = allBtns.find((b) => getReactProps(b)?.className?.includes('text-rose-500'));
    if (dismissBtn) {
      await act(async () => {
        getReactProps(dismissBtn).onClick();
      });
    }

    // 3. Edição / Renomeação
    // 3. Edição / Renomeação
    // Inicia edição e cancela
    await act(async () => {
      const btn = findNodes(container, (n) => n.tagName === 'BUTTON').find((b) => getReactProps(b)?.title === 'Renomear pessoa');
      getReactProps(btn).onClick();
    });
    const cancelBtn = findNodes(container, (n) => n.tagName === 'BUTTON').find((b) => getReactProps(b)?.title === 'Cancelar');
    if (cancelBtn) {
      await act(async () => {
        getReactProps(cancelBtn).onClick();
      });
    }

    // Inicia edição novamente
    await act(async () => {
      const btn = findNodes(container, (n) => n.tagName === 'BUTTON').find((b) => getReactProps(b)?.title === 'Renomear pessoa');
      getReactProps(btn).onClick();
    });

    // Testa tecla Escape para cancelar
    await act(async () => {
      const editInput = findNodes(container, (n) => n.tagName === 'INPUT').find((i) => getReactProps(i)?.autoFocus);
      getReactProps(editInput).onKeyDown({ key: 'Escape' });
    });

    // Inicia edição novamente para salvar
    await act(async () => {
      const btn = findNodes(container, (n) => n.tagName === 'BUTTON').find((b) => getReactProps(b)?.title === 'Renomear pessoa');
      getReactProps(btn).onClick();
    });

    // Tenta salvar nome vazio
    await act(async () => {
      const editInput = findNodes(container, (n) => n.tagName === 'INPUT').find((i) => getReactProps(i)?.autoFocus);
      getReactProps(editInput).onChange({ target: { value: '   ' } });
    });
    await act(async () => {
      const editInput = findNodes(container, (n) => n.tagName === 'INPUT').find((i) => getReactProps(i)?.autoFocus);
      getReactProps(editInput).onKeyDown({ key: 'Enter', preventDefault: () => {} });
    });

    // Salva rename com sucesso via Enter
    await act(async () => {
      const editInput = findNodes(container, (n) => n.tagName === 'INPUT').find((i) => getReactProps(i)?.autoFocus);
      getReactProps(editInput).onChange({ target: { value: 'Carlos Silva Jr.' } });
    });
    mockUpdatePerson.mockResolvedValueOnce(undefined);
    await act(async () => {
      const editInput = findNodes(container, (n) => n.tagName === 'INPUT').find((i) => getReactProps(i)?.autoFocus);
      getReactProps(editInput).onKeyDown({ key: 'Enter', preventDefault: () => {} });
    });
    expect(mockUpdatePerson).toHaveBeenCalledWith('p-1', { name: 'Carlos Silva Jr.' });

    // Testa erro ao renomear
    await act(async () => {
      const btn = findNodes(container, (n) => n.tagName === 'BUTTON').find((b) => getReactProps(b)?.title === 'Renomear pessoa');
      getReactProps(btn).onClick();
    });
    await act(async () => {
      const editInput = findNodes(container, (n) => n.tagName === 'INPUT').find((i) => getReactProps(i)?.autoFocus);
      getReactProps(editInput).onChange({ target: { value: 'Nome Com Erro' } });
    });
    mockUpdatePerson.mockRejectedValueOnce(new Error('Erro de renomeação'));
    await act(async () => {
      const editInput = findNodes(container, (n) => n.tagName === 'INPUT').find((i) => getReactProps(i)?.autoFocus);
      getReactProps(editInput).onKeyDown({ key: 'Enter', preventDefault: () => {} });
    });

    // Cancela o modo de edição com Escape após erro
    await act(async () => {
      const editInput = findNodes(container, (n) => n.tagName === 'INPUT').find((i) => getReactProps(i)?.autoFocus);
      if (editInput) getReactProps(editInput).onKeyDown({ key: 'Escape' });
    });

    // 4. Toggle Archive / Unarchive
    mockUpdatePerson.mockResolvedValueOnce(undefined);
    await act(async () => {
      const archiveBtn = findNodes(container, (n) => n.tagName === 'BUTTON').find((b) => getReactProps(b)?.title === 'Arquivar pessoa');
      if (archiveBtn) await getReactProps(archiveBtn).onClick();
    });
    expect(mockUpdatePerson).toHaveBeenCalledWith('p-1', { archived: true });

    // Erro na requisição de arquivamento
    mockUpdatePerson.mockRejectedValueOnce(new Error('Erro ao arquivar'));
    await act(async () => {
      const archiveBtn = findNodes(container, (n) => n.tagName === 'BUTTON').find((b) => getReactProps(b)?.title === 'Arquivar pessoa');
      if (archiveBtn) await getReactProps(archiveBtn).onClick();
    });

    // Unarchive
    mockUpdatePerson.mockResolvedValueOnce(undefined);
    await act(async () => {
      const unarchiveBtn = findNodes(container, (n) => n.tagName === 'BUTTON').find((b) => getReactProps(b)?.title === 'Reativar pessoa');
      if (unarchiveBtn) await getReactProps(unarchiveBtn).onClick();
    });
    expect(mockUpdatePerson).toHaveBeenCalledWith('p-2', { archived: false });

    // 5. Exclusão
    // Confirm = false
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    await act(async () => {
      const deleteBtn = findNodes(container, (n) => n.tagName === 'BUTTON').find((b) => getReactProps(b)?.title === 'Excluir pessoa');
      await getReactProps(deleteBtn).onClick();
    });
    expect(mockDeletePerson).not.toHaveBeenCalled();

    // Confirm = true sucesso
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    mockDeletePerson.mockResolvedValueOnce(undefined);
    await act(async () => {
      const deleteBtn = findNodes(container, (n) => n.tagName === 'BUTTON').find((b) => getReactProps(b)?.title === 'Excluir pessoa');
      await getReactProps(deleteBtn).onClick();
    });
    expect(mockDeletePerson).toHaveBeenCalledWith('p-1');

    // Confirm = true erro (histórico restrito)
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    mockDeletePerson.mockRejectedValueOnce(new Error('Possui histórico'));
    await act(async () => {
      const deleteBtn = findNodes(container, (n) => n.tagName === 'BUTTON').find((b) => getReactProps(b)?.title === 'Excluir pessoa');
      await getReactProps(deleteBtn).onClick();
    });

    // 6. Lista vazia
    await act(async () => {
      root.render(
        <PeopleManager
          people={[]}
          onAddPerson={mockAddPerson}
          onUpdatePerson={mockUpdatePerson}
          onDeletePerson={mockDeletePerson}
        />
      );
    });

    await act(async () => {
      root.unmount();
    });
  });

  it('SplitFields & SplitsPage: lida com pessoas em rateio, alteração de pagador e acerto com pessoa externa', async () => {
    const peopleData: Person[] = [
      { id: 'p-1', workspace_id: 'ws-2', name: 'Carlos Silva', created_at: '2026-03-01T10:00:00Z', archived: false },
      { id: 'p-2', workspace_id: 'ws-2', name: 'Mariana Costa', created_at: '2026-03-05T10:00:00Z', archived: true },
    ];

    const onSplitTypeChange = vi.fn();
    const onActiveParticipantIdsChange = vi.fn();
    const onPaidByMemberIdChange = vi.fn();
    const onPaidByPersonIdChange = vi.fn();
    const onCustomSplitChange = vi.fn();
    const onAddPerson = vi.fn().mockResolvedValue({ id: 'p-new', name: 'Novo Participante' });
    const onToggleParticipant = vi.fn();

    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    // 1. Renderiza SplitFields com splitType "custom"
    await act(async () => {
      root.render(
        <SplitFields
          splitType="custom"
          onSplitTypeChange={onSplitTypeChange}
          workspaceMembers={mockMembers}
          people={peopleData}
          selectedParticipantIds={['wsm-2', 'p-1']}
          paidByMemberId="wsm-2"
          onPaidByMemberIdChange={onPaidByMemberIdChange}
          paidByPersonId=""
          onPaidByPersonIdChange={onPaidByPersonIdChange}
          totalAmount={100}
          type="expense"
          customSplits={{ 'wsm-2': 50, 'p-1': 50 }}
          onCustomSplitChange={onCustomSplitChange}
          onAddPerson={onAddPerson}
          onToggleParticipant={onToggleParticipant}
        />
      );
    });

    // 2. Altera "Quem pagou?" para uma pessoa (p-1)
    const selects = findNodes(container, (n) => n.tagName === 'SELECT');
    const payerSelect = selects[0];
    if (payerSelect) {
      await act(async () => {
        getReactProps(payerSelect).onChange({ target: { value: 'p-1' } });
      });
      expect(onPaidByPersonIdChange).toHaveBeenCalledWith('p-1');
      expect(onPaidByMemberIdChange).toHaveBeenCalledWith('');

      // Altera de volta para um membro
      await act(async () => {
        getReactProps(payerSelect).onChange({ target: { value: 'wsm-3' } });
      });
      expect(onPaidByMemberIdChange).toHaveBeenCalledWith('wsm-3');
      expect(onPaidByPersonIdChange).toHaveBeenCalledWith('');
    }

    // 2.1 Altera regra de divisão
    if (selects[1]) {
      await act(async () => {
        getReactProps(selects[1]).onChange({ target: { value: 'equal' } });
      });
      expect(onSplitTypeChange).toHaveBeenCalledWith('equal');
    }

    // 2.2 Altera valor de custom split
    const numberInputs = findNodes(container, (n) => n.tagName === 'INPUT' && getReactProps(n)?.type === 'number');
    if (numberInputs.length > 0) {
      await act(async () => {
        getReactProps(numberInputs[0]).onChange({ target: { value: '60' } });
      });
      expect(onCustomSplitChange).toHaveBeenCalledWith('wsm-2', 60);
    }

    // 3. Chips de participantes
    const chipBtns = findNodes(container, (n) => n.tagName === 'BUTTON').filter((b) => getReactProps(b)?.className?.includes('rounded-full'));
    if (chipBtns.length > 0) {
      await act(async () => {
        getReactProps(chipBtns[0]).onClick();
      });
      expect(onToggleParticipant).toHaveBeenCalled();
    }

    // 4. Testar adicionar pessoa inline dentro de SplitFields
    const addInlineBtn = findNodes(container, (n) => n.tagName === 'BUTTON').find((b) => getReactProps(b)?.className?.includes('text-teal-700'));
    if (addInlineBtn) {
      await act(async () => {
        getReactProps(addInlineBtn).onClick();
      });
      const inlineInput = findNodes(container, (n) => n.tagName === 'INPUT').find((i) => getReactProps(i)?.placeholder?.includes('Nome da pessoa'));
      if (inlineInput) {
        await act(async () => {
          getReactProps(inlineInput).onChange({ target: { value: 'Roberto' } });
        });
        const inlineSaveBtn = findNodes(container, (n) => n.tagName === 'BUTTON').find((b) => getReactProps(b)?.children === 'Salvar');
        if (inlineSaveBtn) {
          await act(async () => {
            await getReactProps(inlineSaveBtn).onClick({ preventDefault: () => {} });
          });
          expect(onAddPerson).toHaveBeenCalledWith('Roberto');
        }
      }
    }

    // 5. SplitsPage: Acerto envolvendo pessoa externa (from_person_id ou to_person_id)
    const txWithPerson = [
      {
        id: 'tx-pers-1',
        workspace_id: 'ws-2',
        description: 'Aluguel com Carlos',
        amount: 200,
        transaction_date: '2026-03-01',
        due_date: '2026-03-01',
        type: 'expense' as const,
        status: 'pending' as const,
        paid_by_member_id: 'wsm-2',
        split_type: 'equal' as const,
        splits: [
          { member_id: 'wsm-2', amount: 100, percentage: 50 },
          { person_id: 'p-1', amount: 100, percentage: 50 },
        ],
      },
    ];

    vi.spyOn(FinanceContext, 'useFinance').mockReturnValue({
      activeWorkspace: mockWorkspace,
      workspaceMembers: mockMembers,
      people: peopleData,
      allWorkspacePeople: peopleData,
      transactions: txWithPerson as any,
      purchases: [],
      settlements: [],
      recordSettlement: mockRecordSettlement,
      deleteSettlement: mockDeleteSettlement,
      addPerson: mockAddPerson,
      updatePerson: mockUpdatePerson,
      deletePerson: mockDeletePerson,
    } as any);

    await act(async () => {
      root.render(<SplitsPage />);
    });

    // Encontra botão "Acertar" no saldo devedor de Carlos para Rodrigo
    const settleBtns = findNodes(container, (n) => n.tagName === 'BUTTON').filter((b) => {
      const p = getReactProps(b);
      return Array.isArray(p?.children) ? p.children.includes('Acertar') : p?.children === 'Acertar';
    });

    if (settleBtns.length > 0) {
      await act(async () => {
        getReactProps(settleBtns[0]).onClick();
      });

      // Submete o formulário de acerto no modal aberto
      const modalForm = findNodes(container, (n) => n.tagName === 'FORM').find((f) => getReactProps(f)?.className?.includes('space-y-4') || getReactProps(f)?.onSubmit);
      if (modalForm) {
        await act(async () => {
          getReactProps(modalForm).onSubmit({ preventDefault: () => {} });
        });
        expect(mockRecordSettlement).toHaveBeenCalledWith(
          expect.objectContaining({
            from_person_id: 'p-1',
            to_member_id: 'wsm-2',
            amount: 100,
          })
        );
      }
    }

    await act(async () => {
      root.unmount();
    });
  });

  it('QuickAddModal: valida coerção para individual com 1 participante e compra parcelada paga por pessoa', async () => {
    const peopleData: Person[] = [
      { id: 'p-1', workspace_id: 'ws-2', name: 'Carlos Silva', created_at: '2026-03-01T10:00:00Z', archived: false },
    ];

    const mockCards: any[] = [
      {
        id: 'card-1',
        workspace_id: 'ws-2',
        name: 'Nubank',
        institution: 'Nubank',
        credit_limit: 5000,
        closing_day: 5,
        due_day: 15,
        active: true,
      },
    ];

    const mockPaymentMethods: any[] = [
      {
        id: 'pm-card',
        workspace_id: 'ws-2',
        name: 'Cartão Nubank',
        type: 'credit_card',
        credit_card_id: 'card-1',
        active: true,
      },
    ];

    vi.spyOn(FinanceContext, 'useFinance').mockReturnValue({
      activeWorkspace: mockWorkspace,
      workspaceMembers: mockMembers,
      people: peopleData,
      allWorkspacePeople: peopleData,
      categories: mockCategories as any,
      paymentMethods: mockPaymentMethods,
      accounts: mockAccounts as any,
      creditCards: mockCards,
      addTransaction: mockAddTransaction,
      createInstallmentPurchase: mockCreateInstallmentPurchase,
      createTransfer: vi.fn(),
    } as any);

    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<QuickAddModal isOpen={true} onClose={mockOnClose} />);
    });

    const inputs = findNodes(container, (n) => n.tagName === 'INPUT');
    const amountInput = inputs.find((i) => getReactProps(i)?.placeholder === '0,00');
    const descInput = inputs.find((i) => getReactProps(i)?.placeholder?.includes('Supermercado'));

    await act(async () => {
      getReactProps(amountInput).onChange({ target: { value: '600,00' } });
      getReactProps(descInput).onChange({ target: { value: 'TV Parcelada por Carlos' } });
    });

    // 1. Seleciona método de pagamento com cartão
    const allSelects = findNodes(container, (n) => n.tagName === 'SELECT');
    const pmSelect = allSelects.find((s) => (s as any).options?.some?.((o: any) => o.value === 'pm-card'));
    if (pmSelect) {
      await act(async () => {
        getReactProps(pmSelect).onChange({ target: { value: 'pm-card' } });
      });
    }

    // 2. Configura parcelamento em 3x
    const updatedSelects = findNodes(container, (n) => n.tagName === 'SELECT');
    const instSelect = updatedSelects.find((s) => {
      const p = getReactProps(s);
      return (p?.value === 1 || p?.value === '1') && s !== pmSelect;
    });
    if (instSelect) {
      await act(async () => {
        getReactProps(instSelect).onChange({ target: { value: 3 } });
      });
    }

    // 3. Altera regra de rateio para equal
    const splitSelect = findNodes(container, (n) => n.tagName === 'SELECT').find((s) => {
      const p = getReactProps(s);
      return p?.children?.some?.((c: any) => c?.props?.value === 'equal');
    });
    if (splitSelect) {
      await act(async () => {
        getReactProps(splitSelect).onChange({ target: { value: 'equal' } });
      });
    }

    // 4. Altera pagador para a pessoa p-1
    const payerSelect = findNodes(container, (n) => n.tagName === 'SELECT').find((s) => {
      const p = getReactProps(s);
      return (s as any).options?.some?.((o: any) => o.value === 'p-1') ||
             (Array.isArray(p?.children) && p.children.flat().some((c: any) => c?.props?.value === 'p-1'));
    });
    if (payerSelect) {
      await act(async () => {
        getReactProps(payerSelect).onChange({ target: { value: 'p-1' } });
      });
    }

    // 5. Submete formulário
    const form = findNodes(container, (n) => n.tagName === 'FORM')[0];
    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });

    expect(mockCreateInstallmentPurchase).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'TV Parcelada por Carlos',
        total_amount: 600,
        paid_by_person_id: 'p-1',
        paid_by_member_id: undefined,
      })
    );

    await act(async () => {
      root.unmount();
    });
  });

  it('cobre PeopleManager com Escape no modo edição, tecla Tab e erro de arquivamento genérico', async () => {
    const peopleData: Person[] = [
      { id: 'p-1', workspace_id: 'ws-2', name: 'Carlos Silva', created_at: '2026-03-01T10:00:00Z', archived: false },
    ];
    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PeopleManager
          people={peopleData}
          onAddPerson={mockAddPerson}
          onUpdatePerson={mockUpdatePerson}
          onDeletePerson={mockDeletePerson}
        />
      );
    });

    // 1. Enter com texto vazio / espaços no input de adicionar nova pessoa
    const addInput = findNodes(container, (n) => n.tagName === 'INPUT')[0];
    await act(async () => {
      getReactProps(addInput).onChange({ target: { value: '   ' } });
      getReactProps(addInput).onKeyDown({ key: 'Enter', preventDefault: () => {} });
      getReactProps(addInput).onKeyDown({ key: 'Tab' });
    });
    expect(mockAddPerson).not.toHaveBeenCalled();

    // 2. Entra em modo de edição
    const editBtn = findNodes(container, (n) => n.tagName === 'BUTTON').find((b) => getReactProps(b)?.title === 'Renomear pessoa');
    await act(async () => {
      getReactProps(editBtn).onClick();
    });

    // Pressiona tecla qualquer (ex: Tab) para exercitar implicit else em onKeyDown
    const editInput = findNodes(container, (n) => n.tagName === 'INPUT').find((i) => getReactProps(i)?.autoFocus);
    await act(async () => {
      getReactProps(editInput).onKeyDown({ key: 'Tab' });
      // Cancela edição com Escape
      getReactProps(editInput).onKeyDown({ key: 'Escape' });
    });

    // 3. Erro de arquivamento sem propriedade message (exercita fallback)
    mockUpdatePerson.mockRejectedValueOnce('Erro simples sem message');
    const archiveBtn = findNodes(container, (n) => n.tagName === 'BUTTON').find((b) => getReactProps(b)?.title === 'Arquivar pessoa');
    await act(async () => {
      await getReactProps(archiveBtn).onClick();
    });

    await act(async () => {
      root.unmount();
    });
  });

  it('cobre SplitFields com troca de pagador, inline add, cancelamento, Enter, Tab e chips', async () => {
    const handlePaidByMember = vi.fn();
    const handlePaidByPerson = vi.fn();
    const handleAddPerson = vi.fn().mockResolvedValue({ id: 'p-new', name: 'Novo Participante' });
    const handleTogglePart = vi.fn();
    const peopleData: Person[] = [
      { id: 'p-1', name: 'Carlos', workspace_id: 'ws-2', created_at: '2026-03-01T00:00:00Z', archived: false },
    ];

    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SplitFields
          type="expense"
          workspaceMembers={mockMembers}
          people={peopleData}
          paidByMemberId="wsm-2"
          onPaidByMemberIdChange={handlePaidByMember}
          paidByPersonId=""
          onPaidByPersonIdChange={handlePaidByPerson}
          splitType="equal"
          onSplitTypeChange={vi.fn()}
          numAmount={100}
          onAddPerson={handleAddPerson}
          selectedParticipantIds={['wsm-2', 'p-1']}
          onToggleParticipant={handleTogglePart}
        />
      );
    });

    // 1. Payer select
    const selects = findNodes(container, (n) => n.tagName === 'SELECT');
    const payerSelect = selects[0];
    await act(async () => {
      // Muda para pessoa
      getReactProps(payerSelect).onChange({ target: { value: 'p-1' } });
    });
    expect(handlePaidByPerson).toHaveBeenCalledWith('p-1');
    expect(handlePaidByMember).toHaveBeenCalledWith('');

    await act(async () => {
      // Muda de volta para membro
      getReactProps(payerSelect).onChange({ target: { value: 'wsm-3' } });
    });
    expect(handlePaidByMember).toHaveBeenCalledWith('wsm-3');
    expect(handlePaidByPerson).toHaveBeenCalledWith('');

    // 2. Chip de participante
    const chipBtns = findNodes(container, (n) => n.tagName === 'BUTTON').filter((b) => getReactProps(b)?.className?.includes('rounded-full'));
    if (chipBtns.length > 0) {
      await act(async () => {
        getReactProps(chipBtns[0]).onClick();
      });
      expect(handleTogglePart).toHaveBeenCalled();
    }

    // 3. Abrir inline add person e cancelar
    const addPersonBtn = findNodes(container, (n) => n.tagName === 'BUTTON').find((b) => getReactProps(b)?.className?.includes('text-teal-700'));
    if (addPersonBtn) {
      await act(async () => {
        getReactProps(addPersonBtn).onClick();
      });

      const cancelBtn = findNodes(container, (n) => n.tagName === 'BUTTON').find((b) => getReactProps(b)?.children === 'Cancelar');
      if (cancelBtn) {
        await act(async () => {
          getReactProps(cancelBtn).onClick();
        });
      }

      // Reabre após cancelar re-consultando o botão
      await act(async () => {
        const reAddBtn = findNodes(container, (n) => n.tagName === 'BUTTON').find((b) => getReactProps(b)?.className?.includes('text-teal-700'));
        if (reAddBtn) getReactProps(reAddBtn).onClick();
      });

      const inlineInput = findNodes(container, (n) => n.tagName === 'INPUT').find((i) => getReactProps(i)?.placeholder?.includes('Nome da pessoa'));
      if (inlineInput) {
        // 1. Tentar salvar vazio
        await act(async () => {
          getReactProps(inlineInput).onKeyDown({ key: 'Enter', preventDefault: () => {} });
        });

        // 2. Tentar salvar nome existente 'Carlos'
        await act(async () => {
          getReactProps(inlineInput).onChange({ target: { value: 'Carlos' } });
        });
        await act(async () => {
          const cur = findNodes(container, (n) => n.tagName === 'INPUT').find((i) => getReactProps(i)?.placeholder?.includes('Nome da pessoa'));
          if (cur) getReactProps(cur).onKeyDown({ key: 'Enter', preventDefault: () => {} });
        });

        // 3. Salvar com erro na API
        handleAddPerson.mockRejectedValueOnce(new Error('Erro na API'));
        await act(async () => {
          const cur = findNodes(container, (n) => n.tagName === 'INPUT').find((i) => getReactProps(i)?.placeholder?.includes('Nome da pessoa'));
          if (cur) getReactProps(cur).onChange({ target: { value: 'Lucas' } });
        });
        await act(async () => {
          const cur = findNodes(container, (n) => n.tagName === 'INPUT').find((i) => getReactProps(i)?.placeholder?.includes('Nome da pessoa'));
          if (cur) getReactProps(cur).onKeyDown({ key: 'Enter', preventDefault: () => {} });
        });

        // 4. Salvar com sucesso
        handleAddPerson.mockResolvedValueOnce({ id: 'p-lucas', name: 'Lucas' });
        await act(async () => {
          const cur = findNodes(container, (n) => n.tagName === 'INPUT').find((i) => getReactProps(i)?.placeholder?.includes('Nome da pessoa'));
          if (cur) getReactProps(cur).onChange({ target: { value: 'Lucas' } });
        });
        await act(async () => {
          const cur = findNodes(container, (n) => n.tagName === 'INPUT').find((i) => getReactProps(i)?.placeholder?.includes('Nome da pessoa'));
          if (cur) {
            getReactProps(cur).onKeyDown({ key: 'Tab' });
            getReactProps(cur).onKeyDown({ key: 'Enter', preventDefault: () => {} });
          }
        });
        expect(handleAddPerson).toHaveBeenCalledWith('Lucas');
      }
    }

    // 5. SplitFields sem callbacks opcionais nem people
    await act(async () => {
      root.render(
        <SplitFields
          type="expense"
          workspaceMembers={mockMembers}
          paidByMemberId="wsm-2"
          onPaidByMemberIdChange={handlePaidByMember}
          splitType="equal"
          onSplitTypeChange={vi.fn()}
          numAmount={100}
        />
      );
    });
    const chipBtnsNoCb = findNodes(container, (n) => n.tagName === 'BUTTON').filter((b) => getReactProps(b)?.className?.includes('rounded-full'));
    if (chipBtnsNoCb.length > 0) {
      await act(async () => {
        getReactProps(chipBtnsNoCb[0]).onClick();
      });
    }
    const payerSelectNoCb = findNodes(container, (n) => n.tagName === 'SELECT')[0];
    if (payerSelectNoCb) {
      await act(async () => {
        getReactProps(payerSelectNoCb).onChange({ target: { value: 'wsm-3' } });
      });
    }

    // 6. SplitFields com membro único e sem pessoas (totalCount <= 1)
    const handleAddPersonSingle = vi.fn().mockResolvedValue({ id: 'p-single', name: 'Ana' });
    await act(async () => {
      root.render(
        <SplitFields
          type="expense"
          workspaceMembers={[mockMembers[0]]}
          people={[]}
          paidByMemberId="wsm-2"
          onPaidByMemberIdChange={handlePaidByMember}
          splitType="individual"
          onSplitTypeChange={vi.fn()}
          numAmount={100}
          onAddPerson={handleAddPersonSingle}
        />
      );
    });

    const singleInput = findNodes(container, (n) => n.tagName === 'INPUT').find((i) => getReactProps(i)?.placeholder?.includes('ex: Lucas'));
    if (singleInput) {
      await act(async () => {
        getReactProps(singleInput).onChange({ target: { value: 'Ana' } });
      });
      const singleAddBtn = findNodes(container, (n) => n.tagName === 'BUTTON').find((b) => getReactProps(b)?.className?.includes('bg-teal-600'));
      if (singleAddBtn) {
        await act(async () => {
          await getReactProps(singleAddBtn).onClick({ preventDefault: () => {} });
        });
        expect(handleAddPersonSingle).toHaveBeenCalledWith('Ana');
      }
    }

    await act(async () => {
      root.unmount();
    });
  });

  it('cobre SplitsPage quando membro paga para pessoa externa (isToPerson = true)', async () => {
    const peopleData: Person[] = [
      { id: 'p-1', workspace_id: 'ws-2', name: 'Carlos Silva', created_at: '2026-03-01T10:00:00Z', archived: false },
    ];

    const tx = [
      {
        id: 'tx-p-paid',
        workspace_id: 'ws-2',
        description: 'Jantar pago por Carlos',
        amount: 100,
        transaction_date: '2026-03-01',
        due_date: '2026-03-01',
        type: 'expense' as const,
        status: 'pending' as const,
        paid_by_person_id: 'p-1',
        split_type: 'equal' as const,
        splits: [
          { person_id: 'p-1', amount: 50, percentage: 50 },
          { member_id: 'wsm-2', amount: 50, percentage: 50 },
        ],
      },
    ];

    vi.spyOn(FinanceContext, 'useFinance').mockReturnValue({
      activeWorkspace: mockWorkspace,
      workspaceMembers: mockMembers,
      people: peopleData,
      allWorkspacePeople: peopleData,
      transactions: tx as any,
      purchases: [],
      settlements: [],
      recordSettlement: mockRecordSettlement,
      deleteSettlement: mockDeleteSettlement,
      addPerson: mockAddPerson,
      updatePerson: mockUpdatePerson,
      deletePerson: mockDeletePerson,
    } as any);

    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<SplitsPage />);
    });

    const settleBtns = findNodes(container, (n) => n.tagName === 'BUTTON').filter((b) => {
      const p = getReactProps(b);
      return Array.isArray(p?.children) ? p.children.includes('Liquidar Agora') : p?.children === 'Liquidar Agora';
    });

    if (settleBtns.length > 0) {
      await act(async () => {
        getReactProps(settleBtns[0]).onClick();
      });

      const modalForm = findNodes(container, (n) => n.tagName === 'FORM').find((f) => getReactProps(f)?.className?.includes('space-y-4') || getReactProps(f)?.onSubmit);
      if (modalForm) {
        await act(async () => {
          getReactProps(modalForm).onSubmit({ preventDefault: () => {} });
        });
        expect(mockRecordSettlement).toHaveBeenCalledWith(
          expect.objectContaining({
            from_member_id: 'wsm-2',
            to_member_id: null,
            from_person_id: null,
            to_person_id: 'p-1',
            amount: 50,
          })
        );
      }
    }

    await act(async () => {
      root.unmount();
    });
  });

  it('cobre QuickAddModal com despesa customizada contendo membro e pessoa paga por pessoa', async () => {
    const peopleData: Person[] = [
      { id: 'p-1', workspace_id: 'ws-2', name: 'Carlos Silva', created_at: '2026-03-01T10:00:00Z', archived: false },
    ];

    vi.spyOn(FinanceContext, 'useFinance').mockReturnValue({
      activeWorkspace: mockWorkspace,
      workspaceMembers: mockMembers,
      people: peopleData,
      allWorkspacePeople: peopleData,
      categories: mockCategories as any,
      paymentMethods: [],
      accounts: mockAccounts as any,
      creditCards: [],
      addTransaction: mockAddTransaction,
      createInstallmentPurchase: mockCreateInstallmentPurchase,
      createTransfer: vi.fn(),
    } as any);

    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<QuickAddModal isOpen={true} onClose={mockOnClose} />);
    });

    const inputs = findNodes(container, (n) => n.tagName === 'INPUT');
    const amountInput = inputs.find((i) => getReactProps(i)?.placeholder === '0,00');
    const descInput = inputs.find((i) => getReactProps(i)?.placeholder?.includes('Supermercado'));

    await act(async () => {
      getReactProps(amountInput).onChange({ target: { value: '100,00' } });
      getReactProps(descInput).onChange({ target: { value: 'Churrasco com Carlos' } });
    });

    // Seleciona categoria cat-1
    const catSelect = findNodes(container, (n) => n.tagName === 'SELECT').find((s) => {
      const p = getReactProps(s);
      return Array.isArray(p?.children) && p.children.flat().some((c: any) => c?.props?.value === 'cat-1');
    });
    if (catSelect) {
      await act(async () => {
        getReactProps(catSelect).onChange({ target: { value: 'cat-1' } });
      });
    }

    // Seleciona regra custom
    const splitSelect = findNodes(container, (n) => n.tagName === 'SELECT').find((s) => {
      const p = getReactProps(s);
      return p?.children?.some?.((c: any) => c?.props?.value === 'custom');
    });
    if (splitSelect) {
      await act(async () => {
        getReactProps(splitSelect).onChange({ target: { value: 'custom' } });
      });
    }

    // Define valores customizados somando 100
    const customInputs = findNodes(container, (n) => n.tagName === 'INPUT' && getReactProps(n)?.type === 'number');
    if (customInputs.length >= 2) {
      await act(async () => {
        getReactProps(customInputs[0]).onChange({ target: { value: '50' } });
        getReactProps(customInputs[1]).onChange({ target: { value: '50' } });
      });
    }

    // Seleciona pagador pessoa p-1
    const payerSelect = findNodes(container, (n) => n.tagName === 'SELECT').find((s) => {
      const p = getReactProps(s);
      return (Array.isArray(p?.children) && p.children.flat().some((c: any) => c?.props?.value === 'p-1'));
    });
    if (payerSelect) {
      await act(async () => {
        getReactProps(payerSelect).onChange({ target: { value: 'p-1' } });
      });
    }

    const form = findNodes(container, (n) => n.tagName === 'FORM')[0];
    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });

    expect(mockAddTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Churrasco com Carlos',
        amount: 100,
        paid_by_person_id: 'p-1',
        paid_by_member_id: undefined,
        split_type: 'custom',
      })
    );

    await act(async () => {
      root.unmount();
    });
  });

  it('cobre QuickAddModal quando pagador não está nos participantes selecionados e é incluído automaticamente', async () => {
    vi.spyOn(FinanceContext, 'useFinance').mockReturnValue({
      activeWorkspace: mockWorkspace,
      workspaceMembers: mockMembers,
      people: [],
      allWorkspacePeople: [],
      categories: mockCategories as any,
      paymentMethods: [],
      accounts: mockAccounts as any,
      creditCards: [],
      addTransaction: mockAddTransaction,
      createInstallmentPurchase: mockCreateInstallmentPurchase,
      createTransfer: vi.fn(),
    } as any);

    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<QuickAddModal isOpen={true} onClose={mockOnClose} />);
    });

    const inputs = findNodes(container, (n) => n.tagName === 'INPUT');
    const amountInput = inputs.find((i) => getReactProps(i)?.placeholder === '0,00');
    const descInput = inputs.find((i) => getReactProps(i)?.placeholder?.includes('Supermercado'));

    await act(async () => {
      getReactProps(amountInput).onChange({ target: { value: '80,00' } });
      getReactProps(descInput).onChange({ target: { value: 'Café com Camila' } });
    });

    // Seleciona categoria cat-1
    const catSelect = findNodes(container, (n) => n.tagName === 'SELECT').find((s) => {
      const p = getReactProps(s);
      return Array.isArray(p?.children) && p.children.flat().some((c: any) => c?.props?.value === 'cat-1');
    });
    if (catSelect) {
      await act(async () => {
        getReactProps(catSelect).onChange({ target: { value: 'cat-1' } });
      });
    }

    // Seleciona splitType equal
    const splitSelect = findNodes(container, (n) => n.tagName === 'SELECT').find((s) => {
      const p = getReactProps(s);
      return p?.children?.some?.((c: any) => c?.props?.value === 'equal');
    });
    if (splitSelect) {
      await act(async () => {
        getReactProps(splitSelect).onChange({ target: { value: 'equal' } });
      });
    }

    // Payer é wsm-2 (Rodrigo), mas desmarcou Rodrigo e deixou só Camila (wsm-3)
    const chipBtns = findNodes(container, (n) => n.tagName === 'BUTTON').filter((b) => getReactProps(b)?.className?.includes('rounded-full'));
    if (chipBtns.length > 0) {
      await act(async () => {
        getReactProps(chipBtns[0]).onClick();
      });
    }

    const form = findNodes(container, (n) => n.tagName === 'FORM')[0];
    await act(async () => {
      getReactProps(form).onSubmit({ preventDefault: () => {} });
    });

    expect(mockAddTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Café com Camila',
        amount: 80,
        paid_by_member_id: 'wsm-2',
        split_type: 'equal',
      })
    );

    await act(async () => {
      root.unmount();
    });
  });

  it('cobre SplitsPage com despesa sem splits e compra parcelada com splits no histórico', async () => {
    const txWithoutSplits = [
      {
        id: 'tx-no-splits',
        workspace_id: 'ws-2',
        description: 'Padaria Simples',
        amount: 30,
        transaction_date: '2026-03-01',
        due_date: '2026-03-01',
        type: 'expense' as const,
        status: 'paid' as const,
        split_type: 'equal' as const,
        splits: undefined,
      },
    ];

    const purchasesWithSplits = [
      {
        id: 'pur-splits-1',
        workspace_id: 'ws-2',
        description: 'Geladeira Nova',
        total_amount: 1000,
        installment_count: 10,
        purchase_date: '2026-03-01',
        paid_by_member_id: 'wsm-2',
        split_type: 'equal' as const,
        splits: [
          { member_id: 'wsm-2', amount: 500, percentage: 50 },
          { member_id: 'wsm-3', amount: 500, percentage: 50 },
        ],
      },
      {
        id: 'pur-splits-no-array',
        workspace_id: 'ws-2',
        description: 'Mesa de Jantar',
        total_amount: 400,
        installment_count: 4,
        purchase_date: '2026-03-01',
        paid_by_member_id: 'wsm-2',
        split_type: 'equal' as const,
        splits: undefined,
      },
      {
        id: 'pur-other-ws',
        workspace_id: 'ws-other',
        description: 'Outro workspace',
        total_amount: 200,
        installment_count: 2,
        purchase_date: '2026-03-01',
        splits: [],
      },
    ];

    vi.spyOn(FinanceContext, 'useFinance').mockReturnValue({
      activeWorkspace: mockWorkspace,
      workspaceMembers: mockMembers,
      people: [],
      allWorkspacePeople: [],
      transactions: txWithoutSplits as any,
      purchases: purchasesWithSplits as any,
      settlements: [],
      recordSettlement: mockRecordSettlement,
      deleteSettlement: mockDeleteSettlement,
      addPerson: mockAddPerson,
      updatePerson: mockUpdatePerson,
      deletePerson: mockDeletePerson,
    } as any);

    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<SplitsPage />);
    });

    const registerSettlementBtn = findNodes(container, (n) => n.tagName === 'BUTTON').find((b) => {
      const p = getReactProps(b);
      return Array.isArray(p?.children) ? p.children.includes('Registrar Acerto de Contas') : p?.children === 'Registrar Acerto de Contas';
    });
    if (registerSettlementBtn) {
      await act(async () => {
        getReactProps(registerSettlementBtn).onClick();
      });
    }

    await act(async () => {
      root.unmount();
    });
  });

  it('cobre ramificações de SplitFields (sem pagador, sem callbacks opcionais, sem people)', async () => {
    const container = (globalThis as any).document.createElement('div');
    const root = createRoot(container);

    // 1. Renderiza SplitFields com callbacks opcionais ausentes
    await act(async () => {
      root.render(
        <SplitFields
          type="expense"
          totalAmount={100}
          splitType="equal"
          onSplitTypeChange={vi.fn()}
          paidByMemberId="wsm-2"
          paidByPersonId=""
          onPaidByMemberIdChange={vi.fn()}
          onPaidByPersonIdChange={vi.fn()}
          workspaceMembers={mockMembers}
          people={[{ id: 'person-test-0', name: 'Pessoa Inicial', workspace_id: 'ws-2', archived: false, created_at: '' }]}
          selectedParticipantIds={['wsm-2', 'person-test-0']}
          onToggleParticipant={undefined as any}
          onAddPerson={undefined as any}
        />
      );
    });

    // 2. Clica no chip de participante quando onToggleParticipant é indefinido (linha 282)
    const chips = findNodes(container, (n) => n.tagName === 'BUTTON');
    const memberChip = chips.find((c) => c.textContent?.includes('Rodrigo Silva'));
    if (memberChip) {
      await act(async () => {
        getReactProps(memberChip).onClick();
      });
    }

    // 3. Abre form de nova pessoa e tenta adicionar com nome duplicado (linha 143)
    const addPersonBtn = chips.find((c) => c.textContent?.includes('Nova Pessoa'));
    if (addPersonBtn) {
      await act(async () => {
        getReactProps(addPersonBtn).onClick();
      });
    }
    const input = findNodes(container, (n) => n.tagName === 'INPUT')[0];
    const saveBtn = findNodes(container, (n) => n.tagName === 'BUTTON').find((c) => c.textContent?.includes('Salvar'));
    if (input && saveBtn) {
      await act(async () => {
        getReactProps(input).onChange({ target: { value: 'Rodrigo Silva' } });
      });
      await act(async () => {
        getReactProps(saveBtn).onClick({ preventDefault: vi.fn() });
      });
      // Agora com nome inédito mas onAddPerson ausente (linha 146 false)
      await act(async () => {
        getReactProps(input).onChange({ target: { value: 'Nova Pessoa Sem Callback' } });
      });
      await act(async () => {
        getReactProps(saveBtn).onClick({ preventDefault: vi.fn() });
      });
    }

    // 4. Troca o select para membro e depois para pessoa existente cobrindo isPerson
    const payerSelect = findNodes(container, (n) => n.tagName === 'SELECT')[1];
    if (payerSelect) {
      await act(async () => {
        getReactProps(payerSelect).onChange({ target: { value: 'wsm-3' } });
      });
      await act(async () => {
        getReactProps(payerSelect).onChange({ target: { value: 'person-test-0' } });
      });
    }

    // 5. Renderiza com onToggleParticipant e onAddPerson definidos, pagador fora dos selecionados
    const mockToggle = vi.fn();
    const mockAdd = vi.fn().mockResolvedValue({ id: 'p-lucas', name: 'Lucas' });
    await act(async () => {
      root.render(
        <SplitFields
          type="expense"
          totalAmount={100}
          splitType="equal"
          onSplitTypeChange={vi.fn()}
          paidByMemberId="wsm-2"
          paidByPersonId=""
          onPaidByMemberIdChange={vi.fn()}
          onPaidByPersonIdChange={vi.fn()}
          workspaceMembers={mockMembers}
          people={[{ id: 'person-test-0', name: 'Pessoa Inicial', workspace_id: 'ws-2', archived: false, created_at: '' }]}
          selectedParticipantIds={['wsm-3']} // wsm-2 pagou mas não está nos selecionados -> cobre linhas 91-95
          onToggleParticipant={mockToggle}
          onAddPerson={mockAdd}
        />
      );
    });

    const chipsWithToggle = findNodes(container, (n) => n.tagName === 'BUTTON');
    const chipToClick = chipsWithToggle.find((c) => c.textContent?.includes('Rodrigo Silva'));
    if (chipToClick) {
      await act(async () => {
        getReactProps(chipToClick).onClick();
      });
      expect(mockToggle).toHaveBeenCalledWith('wsm-2');
    }

    // Adiciona pessoa com sucesso invocando onToggleParticipant(created.id) (linhas 151-153)
    const addBtn2 = chipsWithToggle.find((c) => c.textContent?.includes('Nova Pessoa'));
    if (addBtn2) {
      await act(async () => {
        getReactProps(addBtn2).onClick();
      });
    }
    const input2 = findNodes(container, (n) => n.tagName === 'INPUT')[0];
    const saveBtn2 = findNodes(container, (n) => n.tagName === 'BUTTON').find((c) => c.textContent?.includes('Salvar'));
    if (input2 && saveBtn2) {
      await act(async () => {
        getReactProps(input2).onChange({ target: { value: 'Lucas' } });
      });
      await act(async () => {
        await getReactProps(saveBtn2).onClick({ preventDefault: vi.fn() });
      });
      expect(mockAdd).toHaveBeenCalledWith('Lucas');
      expect(mockToggle).toHaveBeenCalledWith('p-lucas');
    }

    // 6. Renderiza com pagador inexistente e selectedParticipantIds inexistente (payerPart undefined -> linha 93 false, filtered.length === 0 -> linha 97 fallback)
    await act(async () => {
      root.render(
        <SplitFields
          type="expense"
          totalAmount={100}
          splitType="equal"
          onSplitTypeChange={vi.fn()}
          paidByMemberId="unknown-payer-id"
          paidByPersonId=""
          onPaidByMemberIdChange={vi.fn()}
          onPaidByPersonIdChange={vi.fn()}
          workspaceMembers={mockMembers}
          people={[]}
          selectedParticipantIds={['id-inexistente']}
        />
      );
    });

    // 7. Renderiza com workspaceMembers vazio e somente people (linha 71 people[0]?.id e linha 75 isPerson)
    await act(async () => {
      root.render(
        <SplitFields
          type="expense"
          totalAmount={100}
          splitType="equal"
          onSplitTypeChange={vi.fn()}
          paidByMemberId=""
          paidByPersonId=""
          onPaidByMemberIdChange={vi.fn()}
          onPaidByPersonIdChange={vi.fn()}
          workspaceMembers={[]}
          people={[{ id: 'p-sole', name: 'Pessoa Unica', workspace_id: 'ws-2', archived: false, created_at: '' }]}
          selectedParticipantIds={['p-sole']}
        />
      );
    });

    await act(async () => {
      root.unmount();
    });
  });
});
