import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QuickAddModal } from '@/components/transactions/QuickAddModal';
import { SplitFields } from '@/components/transactions/quick-add/SplitFields';
import SplitsPage from '@/app/(dashboard)/splits/page';
import { PeopleManager } from '@/components/splits/PeopleManager';
import { MemberBalances } from '@/components/splits/MemberBalances';
import { addPerson, updatePerson, deletePerson } from '@/lib/context/actions/person-actions';
import { recordSettlement } from '@/lib/context/actions/settlement-actions';
import { validateTransactionSplits } from '@/lib/context/actions/action-helpers';
import * as FinanceContext from '@/lib/context/finance-context';
import { FinanceProvider, useFinance } from '@/lib/context/finance-context';
import { LocalFinanceRepository } from '@/lib/repositories/local-finance-repository';
import { WorkspaceMember, Workspace, Person } from '@/lib/types';

describe('People & Flexible Splits UI Tests', () => {
  const mockAddTransaction = vi.fn();
  const mockCreateInstallmentPurchase = vi.fn();
  const mockRecordSettlement = vi.fn();
  const mockDeleteSettlement = vi.fn();
  const mockAddPerson = vi.fn();
  const mockUpdatePerson = vi.fn();
  const mockDeletePerson = vi.fn();
  const mockOnClose = vi.fn();

  const mockWorkspace: Workspace = {
    id: 'ws-single',
    name: 'Workspace Individual',
    owner_id: 'usr-1',
    currency: 'BRL',
    created_at: '2026-01-15T00:00:00Z',
    tracking_mode: 'full',
  };

  const mockExpenseTrackerWorkspace: Workspace = {
    id: 'ws-tracker',
    name: 'Despesas & Rateio',
    owner_id: 'usr-1',
    currency: 'BRL',
    created_at: '2026-01-15T00:00:00Z',
    tracking_mode: 'expense_tracker',
  };

  const singleMember: WorkspaceMember[] = [
    {
      id: 'wsm-1',
      workspace_id: 'ws-single',
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
  ];

  const savedPeople: Person[] = [
    {
      id: 'person-1',
      workspace_id: 'ws-single',
      name: 'João Silva',
      archived: false,
      created_at: '2026-01-20T00:00:00Z',
      updated_at: '2026-01-20T00:00:00Z',
    },
    {
      id: 'person-2',
      workspace_id: 'ws-single',
      name: 'Maria Santos',
      archived: false,
      created_at: '2026-01-21T00:00:00Z',
      updated_at: '2026-01-21T00:00:00Z',
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
      textContent = '';
      setAttribute(k: string, v: string) { (this as any)[k] = v; }
      removeAttribute(k: string) { delete (this as any)[k]; }
      focus() {}
      blur() {}
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
    (globalThis as any).confirm = () => true;
    (globalThis as any).window.confirm = () => true;
    (globalThis as any).Node = MockNode;
    (globalThis as any).Element = MockElement;
    (globalThis as any).HTMLElement = MockElement;
    (globalThis as any).HTMLIFrameElement = class extends MockElement {};
    (globalThis as any).HTMLInputElement = class extends MockElement {};
    (globalThis as any).HTMLTextAreaElement = class extends MockElement {};
    (globalThis as any).HTMLSelectElement = MockSelectElement;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  describe('PeopleManager Component', () => {
    it('renderiza lista de pessoas, adiciona nova pessoa e trata validações', async () => {
      const container = (globalThis as any).document.createElement('div');
      const root = createRoot(container);

      mockAddPerson.mockResolvedValueOnce({
        id: 'person-3',
        workspace_id: 'ws-single',
        name: 'Lucas Pereira',
        archived: false,
        created_at: '2026-01-22T00:00:00Z',
        updated_at: '2026-01-22T00:00:00Z',
      });

      await act(async () => {
        root.render(
          <PeopleManager
            people={savedPeople}
            onAddPerson={mockAddPerson}
            onUpdatePerson={mockUpdatePerson}
            onDeletePerson={mockDeletePerson}
          />
        );
      });

      const inputs = findNodes(container, (n) => n.tagName === 'INPUT');
      const nameInput = inputs.find((i) => getReactProps(i)?.placeholder?.includes('Maria, Lucas'));
      expect(nameInput).toBeDefined();

      // 1. Tenta adicionar com nome vazio
      const buttons = findNodes(container, (n) => n.tagName === 'BUTTON');
      const addBtn = buttons.find((b) => getReactProps(b)?.children?.includes?.('Adicionar') || getReactProps(b)?.children?.[1] === 'Adicionar');

      // Preenche nome duplicado
      await act(async () => {
        getReactProps(nameInput).onChange({ target: { value: 'João Silva' } });
      });
      await act(async () => {
        getReactProps(addBtn).onClick({ preventDefault: () => {} });
      });
      expect(mockAddPerson).not.toHaveBeenCalled();

      // Preenche nome válido "Lucas Pereira"
      await act(async () => {
        getReactProps(nameInput).onChange({ target: { value: 'Lucas Pereira' } });
      });
      await act(async () => {
        getReactProps(addBtn).onClick({ preventDefault: () => {} });
      });
      expect(mockAddPerson).toHaveBeenCalledWith({ name: 'Lucas Pereira' });

      await act(async () => {
        root.unmount();
      });
    });

    it('renomeia e exclui pessoa', async () => {
      const container = (globalThis as any).document.createElement('div');
      const root = createRoot(container);

      await act(async () => {
        root.render(
          <PeopleManager
            people={savedPeople}
            onAddPerson={mockAddPerson}
            onUpdatePerson={mockUpdatePerson}
            onDeletePerson={mockDeletePerson}
          />
        );
      });

      // 1. Enter key e não-Enter no input de adicionar pessoa
      const inputs = findNodes(container, (n) => n.tagName === 'INPUT');
      const addInput = inputs.find((i) => getReactProps(i)?.placeholder?.includes('Maria, Lucas'));
      await act(async () => {
        getReactProps(addInput).onKeyDown({ key: 'Tab', preventDefault: () => {} });
        getReactProps(addInput).onChange({ target: { value: 'Novo Nome' } });
      });
      await act(async () => {
        getReactProps(addInput).onKeyDown({ key: 'Enter', preventDefault: () => {} });
      });
      expect(mockAddPerson).toHaveBeenCalledWith({ name: 'Novo Nome' });

      // Localiza botão de renomear (Edit2)
      const editButtons = findNodes(container, (n) => n.tagName === 'BUTTON' && getReactProps(n)?.title === 'Renomear pessoa');
      expect(editButtons.length).toBe(2);

      await act(async () => {
        getReactProps(editButtons[0]).onClick();
      });

      // Input de edição aparece
      const editInput = findNode(container, (n) => n.tagName === 'INPUT' && getReactProps(n)?.value === 'João Silva');
      expect(editInput).toBeDefined();

      // Salvar com nome vazio dispara erro
      await act(async () => {
        getReactProps(editInput).onChange({ target: { value: '   ' } });
      });
      const saveBtn = findNode(container, (n) => n.tagName === 'BUTTON' && getReactProps(n)?.title === 'Salvar');
      await act(async () => {
        getReactProps(saveBtn).onClick();
      });
      expect(mockUpdatePerson).not.toHaveBeenCalledWith('person-1', expect.anything());

      // Tecla Escape fecha edição
      await act(async () => {
        getReactProps(editInput).onKeyDown({ key: 'Escape', preventDefault: () => {} });
      });

      // Reabre edição e salva via Enter
      const freshEditBtns = findNodes(container, (n) => n.tagName === 'BUTTON' && getReactProps(n)?.title === 'Renomear pessoa');
      await act(async () => {
        getReactProps(freshEditBtns[0]).onClick();
      });
      const reEditInput = findNode(container, (n) => n.tagName === 'INPUT' && getReactProps(n)?.value === 'João Silva');
      await act(async () => {
        getReactProps(reEditInput).onChange({ target: { value: 'João Silva Júnior' } });
      });
      await act(async () => {
        getReactProps(reEditInput).onKeyDown({ key: 'Enter', preventDefault: () => {} });
      });
      expect(mockUpdatePerson).toHaveBeenCalledWith('person-1', { name: 'João Silva Júnior' });

      // Clicar em Cancelar fecha edição
      const freshEditBtns2 = findNodes(container, (n) => n.tagName === 'BUTTON' && getReactProps(n)?.title === 'Renomear pessoa');
      await act(async () => {
        getReactProps(freshEditBtns2[1]).onClick();
      });
      const cancelBtn = findNode(container, (n) => n.tagName === 'BUTTON' && getReactProps(n)?.title === 'Cancelar');
      await act(async () => {
        getReactProps(cancelBtn).onClick();
      });

      // Excluir pessoa (com confirm = false não chama deletePerson)
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      const deleteButtons = findNodes(container, (n) => n.tagName === 'BUTTON' && getReactProps(n)?.title === 'Excluir pessoa');
      await act(async () => {
        getReactProps(deleteButtons[1]).onClick();
      });
      expect(mockDeletePerson).not.toHaveBeenCalled();

      // Excluir pessoa com erro lançado
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      mockDeletePerson.mockImplementationOnce(() => {
        throw new Error('Falha simulada');
      });
      await act(async () => {
        getReactProps(deleteButtons[1]).onClick();
      });
      expect(mockDeletePerson).toHaveBeenCalledWith('person-2');

      // Sucesso na exclusão
      mockDeletePerson.mockReset();
      await act(async () => {
        getReactProps(deleteButtons[0]).onClick();
      });
      expect(mockDeletePerson).toHaveBeenCalledWith('person-1');

      await act(async () => {
        root.unmount();
      });
    });
  });

  describe('QuickAddModal with People', () => {
    it('divide igualmente (50/50) entre único membro e uma pessoa informada', async () => {
      vi.spyOn(FinanceContext, 'useFinance').mockReturnValue({
        activeWorkspace: mockWorkspace,
        workspaceMembers: singleMember,
        categories: [{ id: 'cat-1', name: 'Alimentação', type: 'expense', active: true }] as any,
        paymentMethods: [] as any,
        accounts: [] as any,
        creditCards: [] as any,
        people: [savedPeople[0]],
        addPerson: mockAddPerson,
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
        getReactProps(amountInput).onChange({ target: { value: '150,00' } });
        getReactProps(descInput).onChange({ target: { value: 'Almoço Compartilhado' } });
      });

      // Seleciona regra de divisão 'equal'
      const selects = findNodes(container, (n) => n.tagName === 'SELECT');
      const splitRuleSelect = selects.find((s) => {
        const props = getReactProps(s);
        return props?.value === 'individual' || props?.children?.some?.((c: any) => c?.props?.value === 'equal');
      });
      expect(splitRuleSelect).toBeDefined();

      await act(async () => {
        getReactProps(splitRuleSelect).onChange({ target: { value: 'equal' } });
      });

      const form = findNodes(container, (n) => n.tagName === 'FORM')[0];
      await act(async () => {
        getReactProps(form).onSubmit({ preventDefault: () => {} });
      });

      expect(mockAddTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Almoço Compartilhado',
          amount: 150,
          type: 'expense',
          paid_by_member_id: 'wsm-1',
          paid_by_person_id: undefined,
          split_type: 'equal',
          splits: [
            { member_id: 'wsm-1', amount: 75, percentage: 50 },
            { person_id: 'person-1', amount: 75, percentage: 50 },
          ],
        })
      );

      await act(async () => {
        root.unmount();
      });
    });

    it('indica que uma Pessoa pagou a despesa (paid_by_person_id)', async () => {
      vi.spyOn(FinanceContext, 'useFinance').mockReturnValue({
        activeWorkspace: mockWorkspace,
        workspaceMembers: singleMember,
        categories: [{ id: 'cat-1', name: 'Alimentação', type: 'expense', active: true }] as any,
        paymentMethods: [] as any,
        accounts: [] as any,
        creditCards: [] as any,
        people: [savedPeople[0]],
        addPerson: mockAddPerson,
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
        getReactProps(descInput).onChange({ target: { value: 'Combustível da viagem' } });
      });

      // Seleciona Quem pagou = João Silva (person-1)
      const selects = findNodes(container, (n) => n.tagName === 'SELECT');
      const payerSelect = selects.find((s) => (s as any).options?.some?.((o: any) => o.value === 'person-1'));
      expect(payerSelect).toBeDefined();

      await act(async () => {
        getReactProps(payerSelect).onChange({ target: { value: 'person-1' } });
      });

      // Seleciona regra equal
      const splitRuleSelect = selects.find((s) => {
        const props = getReactProps(s);
        return props?.value === 'individual' || props?.children?.some?.((c: any) => c?.props?.value === 'equal');
      });
      await act(async () => {
        getReactProps(splitRuleSelect).onChange({ target: { value: 'equal' } });
      });

      const form = findNodes(container, (n) => n.tagName === 'FORM')[0];
      await act(async () => {
        getReactProps(form).onSubmit({ preventDefault: () => {} });
      });

      expect(mockAddTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Combustível da viagem',
          amount: 80,
          type: 'expense',
          paid_by_member_id: undefined,
          paid_by_person_id: 'person-1',
          split_type: 'equal',
          splits: [
            { member_id: 'wsm-1', amount: 40, percentage: 50 },
            { person_id: 'person-1', amount: 40, percentage: 50 },
          ],
        })
      );

      await act(async () => {
        root.unmount();
      });
    });

    it('divide 100% de outra pessoa com uma Pessoa (full_other)', async () => {
      vi.spyOn(FinanceContext, 'useFinance').mockReturnValue({
        activeWorkspace: mockWorkspace,
        workspaceMembers: singleMember,
        categories: [{ id: 'cat-1', name: 'Alimentação', type: 'expense', active: true }] as any,
        paymentMethods: [] as any,
        accounts: [] as any,
        creditCards: [] as any,
        people: [savedPeople[0]],
        addPerson: mockAddPerson,
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
        getReactProps(amountInput).onChange({ target: { value: '200,00' } });
        getReactProps(descInput).onChange({ target: { value: 'Remédio para o João' } });
      });

      // Seleciona regra 'full_other'
      const selects = findNodes(container, (n) => n.tagName === 'SELECT');
      const splitRuleSelect = selects.find((s) => {
        const props = getReactProps(s);
        return props?.value === 'individual' || props?.children?.some?.((c: any) => c?.props?.value === 'full_other');
      });

      await act(async () => {
        getReactProps(splitRuleSelect).onChange({ target: { value: 'full_other' } });
      });

      const form = findNodes(container, (n) => n.tagName === 'FORM')[0];
      await act(async () => {
        getReactProps(form).onSubmit({ preventDefault: () => {} });
      });

      expect(mockAddTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Remédio para o João',
          amount: 200,
          paid_by_member_id: 'wsm-1',
          split_type: 'full_other',
          splits: [
            { person_id: 'person-1', amount: 200, percentage: 100 },
          ],
        })
      );

      await act(async () => {
        root.unmount();
      });
    });

    it('permite adicionar nova pessoa inline dentro de SplitFields', async () => {
      mockAddPerson.mockResolvedValueOnce({
        id: 'person-new',
        workspace_id: 'ws-single',
        name: 'Clara Lima',
        archived: false,
        created_at: '2026-01-22T00:00:00Z',
        updated_at: '2026-01-22T00:00:00Z',
      });

      vi.spyOn(FinanceContext, 'useFinance').mockReturnValue({
        activeWorkspace: mockWorkspace,
        workspaceMembers: singleMember,
        categories: [{ id: 'cat-1', name: 'Alimentação', type: 'expense', active: true }] as any,
        paymentMethods: [] as any,
        accounts: [] as any,
        creditCards: [] as any,
        people: [], // Nenhuma pessoa cadastrada previamente
        addPerson: mockAddPerson,
        addTransaction: mockAddTransaction,
        createInstallmentPurchase: mockCreateInstallmentPurchase,
        createTransfer: vi.fn(),
      } as any);

      const container = (globalThis as any).document.createElement('div');
      const root = createRoot(container);

      await act(async () => {
        root.render(<QuickAddModal isOpen={true} onClose={mockOnClose} />);
      });

      // No modo 1 membro e 0 pessoas, o banner convida a digitar o nome da pessoa
      const inlineInput = findNode(container, (n) => n.tagName === 'INPUT' && getReactProps(n)?.placeholder?.includes('Lucas'));
      expect(inlineInput).toBeDefined();

      await act(async () => {
        getReactProps(inlineInput).onChange({ target: { value: 'Clara Lima' } });
      });

      const buttons = findNodes(container, (n) => n.tagName === 'BUTTON');
      const addInlineBtn = buttons.find((b) => getReactProps(b)?.children?.includes?.('Adicionar') || getReactProps(b)?.children?.[1] === 'Adicionar');
      expect(addInlineBtn).toBeDefined();

      await act(async () => {
        getReactProps(addInlineBtn).onClick({ preventDefault: () => {} });
      });

      expect(mockAddPerson).toHaveBeenCalledWith('Clara Lima');

      await act(async () => {
        root.unmount();
      });
    });
  });

  describe('SplitsPage with People and Settlements', () => {
    it('calcula débitos entre membro e pessoa e registra acerto válido no modo normal e no modo expense_tracker', async () => {
      // Cenário: Rodrigo pagou R$ 100,00 e dividiu 50/50 com João (person-1).
      // João deve R$ 50,00 para Rodrigo.
      const trackerMember: WorkspaceMember = {
        ...singleMember[0],
        workspace_id: 'ws-tracker',
      };
      const trackerPerson: Person = {
        ...savedPeople[0],
        workspace_id: 'ws-tracker',
      };

      const mockTx = {
        id: 'tx-1',
        workspace_id: 'ws-tracker',
        description: 'Almoço',
        amount: 100,
        transaction_date: '2026-04-01',
        paid_by_member_id: 'wsm-1',
        paid_by_person_id: null,
        type: 'expense' as const,
        status: 'paid' as const,
        split_type: 'equal' as const,
        splits: [
          { member_id: 'wsm-1', amount: 50, percentage: 50 },
          { person_id: 'person-1', amount: 50, percentage: 50 },
        ],
        created_at: '2026-04-01',
      };

      vi.spyOn(FinanceContext, 'useFinance').mockReturnValue({
        activeWorkspace: mockExpenseTrackerWorkspace,
        workspaceMembers: [trackerMember],
        people: [trackerPerson],
        allPeople: [trackerPerson],
        transactions: [mockTx],
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

      // Verifica botão "Liquidar Agora" na seção de acertos recomendados
      const buttons = findNodes(container, (n) => n.tagName === 'BUTTON');
      const settleBtn = buttons.find((b) => getReactProps(b)?.children === 'Liquidar Agora');
      expect(settleBtn).toBeDefined();

      // Clica em Liquidar Agora
      await act(async () => {
        getReactProps(settleBtn).onClick();
      });

      // Modal de acerto abre com fromMemberId = person-1 (João deve) e toMemberId = wsm-1 (Rodrigo recebe)
      const form = findNode(container, (n) => n.tagName === 'FORM');
      expect(form).toBeDefined();

      // Confirma acerto no modal
      await act(async () => {
        getReactProps(form).onSubmit({ preventDefault: () => {} });
      });

      expect(mockRecordSettlement).toHaveBeenCalledWith({
        from_member_id: null,
        to_member_id: 'wsm-1',
        from_person_id: 'person-1',
        to_person_id: null,
        amount: 50,
        settlement_date: expect.any(String),
        notes: 'Acerto de contas consolidado',
      });

      await act(async () => {
        root.unmount();
      });
    });

    it('exibe o nome correto de pessoas salvas e fallback de participante desconhecido', async () => {
      // Cria cenário com acerto contendo pessoa e id desconhecido
      const mockSettlement = {
        id: 'set-page-1',
        workspace_id: 'ws-single',
        from_member_id: null,
        to_member_id: 'wsm-1',
        from_person_id: 'person-1',
        to_person_id: null,
        amount: 100,
        settlement_date: '2026-04-01',
        notes: 'Acerto com João',
        created_at: '2026-04-01',
      };

      vi.spyOn(FinanceContext, 'useFinance').mockReturnValue({
        activeWorkspace: mockWorkspace,
        workspaceMembers: singleMember,
        people: savedPeople,
        allPeople: savedPeople,
        transactions: [],
        purchases: [],
        settlements: [
          mockSettlement,
          {
            id: 'set-page-unknown',
            workspace_id: 'ws-single',
            from_member_id: null,
            to_member_id: null,
            from_person_id: 'unknown-id',
            to_person_id: null,
            amount: 50,
            settlement_date: '2026-04-01',
            notes: 'Acerto desconhecido',
            created_at: '2026-04-01',
          },
        ],
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

      // Localiza João Silva e fallback "Membro unkn" no histórico de acertos
      const textNodes = findNodes(container, (n) => {
        const c = getReactProps(n)?.children;
        if (Array.isArray(c)) {
          return c.some((item) => typeof item === 'string' && item.includes('Membro unkn'));
        }
        return typeof c === 'string' && c.includes('Membro unkn');
      });
      expect(textNodes.length).toBeGreaterThan(0);

      await act(async () => {
        root.unmount();
      });
    });
  });

  describe('SplitFields Component Edge Cases', () => {
    it('trata erros de validação, cancelamento e teclado no input inline de nova pessoa', async () => {
      const container = (globalThis as any).document.createElement('div');
      const root = createRoot(container);
      const onToggle = vi.fn();
      const onAdd = vi.fn().mockResolvedValue({ id: 'p-new', name: 'Nova Maria' });

      await act(async () => {
        root.render(
          <SplitFields
            type="expense"
            workspaceMembers={singleMember}
            people={savedPeople}
            paidByMemberId="wsm-1"
            onPaidByMemberIdChange={vi.fn()}
            paidByPersonId={undefined}
            onPaidByPersonIdChange={vi.fn()}
            splitType="equal"
            onSplitTypeChange={vi.fn()}
            numAmount={100}
            onAddPerson={onAdd}
            selectedParticipantIds={['wsm-1', 'person-1']}
            onToggleParticipant={onToggle}
          />
        );
      });

      // 1. Clicar no botão "+ Nova Pessoa"
      const newPersonBtn = findNode(container, (n) => n.tagName === 'BUTTON' && (getReactProps(n)?.children?.[1]?.includes?.('Nova Pessoa') || getReactProps(n)?.children?.includes?.('+ Nova Pessoa')));
      expect(newPersonBtn).toBeDefined();
      await act(async () => {
        getReactProps(newPersonBtn).onClick();
      });

      // 2. Clicar em Cancelar fecha o input inline
      const cancelBtn = findNode(container, (n) => n.tagName === 'BUTTON' && getReactProps(n)?.children === 'Cancelar');
      expect(cancelBtn).toBeDefined();
      await act(async () => {
        getReactProps(cancelBtn).onClick();
      });

      // Reabre
      const reNewPersonBtn = findNode(container, (n) => n.tagName === 'BUTTON' && (getReactProps(n)?.children?.[1]?.includes?.('Nova Pessoa') || getReactProps(n)?.children?.includes?.('+ Nova Pessoa')));
      await act(async () => {
        getReactProps(reNewPersonBtn).onClick();
      });

      const inlineInput = findNode(container, (n) => n.tagName === 'INPUT' && getReactProps(n)?.placeholder === 'Nome da pessoa...');
      const saveBtn = findNode(container, (n) => n.tagName === 'BUTTON' && getReactProps(n)?.children === 'Salvar');

      // 3. Salvar vazio exibe erro
      await act(async () => {
        getReactProps(inlineInput).onChange({ target: { value: '   ' } });
      });
      await act(async () => {
        getReactProps(saveBtn).onClick({ preventDefault: () => {} });
      });
      expect(findNode(container, (n) => n.tagName === 'P' && getReactProps(n)?.children === 'Informe o nome da pessoa.')).toBeDefined();

      // 4. Salvar duplicado exibe erro
      await act(async () => {
        getReactProps(inlineInput).onChange({ target: { value: 'João Silva' } });
      });
      await act(async () => {
        getReactProps(saveBtn).onClick({ preventDefault: () => {} });
      });
      expect(findNode(container, (n) => n.tagName === 'P' && getReactProps(n)?.children === 'Já existe um membro ou pessoa com esse nome.')).toBeDefined();

      // 5. Salvar via Enter com nome válido chama onAdd e onToggle
      await act(async () => {
        getReactProps(inlineInput).onChange({ target: { value: 'Nova Maria' } });
      });
      await act(async () => {
        getReactProps(inlineInput).onKeyDown({ key: 'Enter', preventDefault: () => {} });
      });
      expect(onAdd).toHaveBeenCalledWith('Nova Maria');
      expect(onToggle).toHaveBeenCalledWith('p-new');

      // 6. Clicar em um chip de participante chama onToggleParticipant
      const chips = findNodes(container, (n) => n.tagName === 'BUTTON' && getReactProps(n)?.className?.includes('rounded-full'));
      expect(chips.length).toBeGreaterThanOrEqual(1);
      await act(async () => {
        getReactProps(chips[0]).onClick();
      });
      expect(onToggle).toHaveBeenCalledWith('wsm-1');

      // 7. Renderizar onde o pagador não está em selectedParticipantIds (cobrindo linhas 88-90)
      // e onAddPerson rejeita (cobrindo linha 153)
      const rejectingOnAdd = vi.fn().mockRejectedValue(new Error('Falha na API ao adicionar'));
      await act(async () => {
        root.render(
          <SplitFields
            type="expense"
            workspaceMembers={singleMember}
            people={savedPeople}
            paidByMemberId="wsm-1"
            onPaidByMemberIdChange={vi.fn()}
            paidByPersonId={undefined}
            onPaidByPersonIdChange={vi.fn()}
            splitType="equal"
            onSplitTypeChange={vi.fn()}
            numAmount={100}
            onAddPerson={rejectingOnAdd}
            selectedParticipantIds={['person-1']} // wsm-1 não selecionado, será inserido pelo fallback
            onToggleParticipant={onToggle}
          />
        );
      });

      const reNewPersonBtn2 = findNode(container, (n) => n.tagName === 'BUTTON' && (getReactProps(n)?.children?.[1]?.includes?.('Nova Pessoa') || getReactProps(n)?.children?.includes?.('+ Nova Pessoa')));
      await act(async () => {
        getReactProps(reNewPersonBtn2).onClick();
      });

      const inlineInput2 = findNode(container, (n) => n.tagName === 'INPUT' && getReactProps(n)?.placeholder === 'Nome da pessoa...');
      const saveBtn2 = findNode(container, (n) => n.tagName === 'BUTTON' && getReactProps(n)?.children === 'Salvar');

      await act(async () => {
        getReactProps(inlineInput2).onChange({ target: { value: 'Nova Pessoa Erro' } });
      });
      await act(async () => {
        getReactProps(saveBtn2).onClick({ preventDefault: () => {} });
      });
      expect(findNode(container, (n) => n.tagName === 'P' && getReactProps(n)?.children === 'Falha na API ao adicionar')).toBeDefined();

      await act(async () => {
        root.unmount();
      });
    });
  });

  describe('PeopleManager Component Edge Cases', () => {
    it('trata erros ao adicionar, editar e excluir pessoas', async () => {
      const container = (globalThis as any).document.createElement('div');
      const root = createRoot(container);
      const rejectingAdd = vi.fn().mockRejectedValue(new Error('Falha ao adicionar'));
      const rejectingUpdate = vi.fn().mockRejectedValue(new Error('Falha ao atualizar'));
      const rejectingDelete = vi.fn().mockRejectedValue(new Error('Falha ao excluir'));

      await act(async () => {
        root.render(
          <PeopleManager
            people={savedPeople}
            onAddPerson={rejectingAdd}
            onUpdatePerson={rejectingUpdate}
            onDeletePerson={rejectingDelete}
          />
        );
      });

      // 1. Tentar adicionar com nome vazio
      const addInput = findNode(container, (n) => n.tagName === 'INPUT' && getReactProps(n)?.placeholder?.includes('Maria, Lucas'));
      const addBtn = findNode(container, (n) => n.tagName === 'BUTTON' && getReactProps(n)?.children?.[1] === 'Adicionar');

      await act(async () => {
        getReactProps(addInput).onChange({ target: { value: '   ' } });
      });
      await act(async () => {
        getReactProps(addBtn).onClick({ preventDefault: () => {} });
      });
      expect(findNode(container, (n) => getReactProps(n)?.children?.[1] === 'Informe o nome da pessoa.')).toBeDefined();

      // 2. Tentar adicionar nome duplicado
      await act(async () => {
        getReactProps(addInput).onChange({ target: { value: 'João Silva' } });
      });
      await act(async () => {
        getReactProps(addBtn).onClick({ preventDefault: () => {} });
      });
      expect(findNode(container, (n) => getReactProps(n)?.children?.[1] === 'Já existe uma pessoa cadastrada com esse nome.')).toBeDefined();

      // 3. onAddPerson rejeita
      await act(async () => {
        getReactProps(addInput).onChange({ target: { value: 'Carlos Novo' } });
      });
      await act(async () => {
        getReactProps(addBtn).onClick({ preventDefault: () => {} });
      });
      expect(findNode(container, (n) => getReactProps(n)?.children?.[1] === 'Falha ao adicionar')).toBeDefined();

      // 4. onUpdatePerson rejeita
      const editBtns = findNodes(container, (n) => n.tagName === 'BUTTON' && getReactProps(n)?.title === 'Renomear pessoa');
      await act(async () => {
        getReactProps(editBtns[0]).onClick();
      });
      const editInput = findNode(container, (n) => n.tagName === 'INPUT' && getReactProps(n)?.value === 'João Silva');
      const saveBtn = findNode(container, (n) => n.tagName === 'BUTTON' && getReactProps(n)?.title === 'Salvar');
      await act(async () => {
        getReactProps(editInput).onChange({ target: { value: 'João Silva Alterado' } });
      });
      await act(async () => {
        getReactProps(saveBtn).onClick();
      });
      expect(findNode(container, (n) => getReactProps(n)?.children?.[1] === 'Falha ao atualizar')).toBeDefined();

      // 5. onDeletePerson com confirm=true mas rejeitado
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const deleteBtns = findNodes(container, (n) => n.tagName === 'BUTTON' && getReactProps(n)?.title === 'Excluir pessoa');
      await act(async () => {
        getReactProps(deleteBtns[0]).onClick();
      });
      expect(findNode(container, (n) => getReactProps(n)?.children?.[1] === 'Falha ao excluir')).toBeDefined();

      await act(async () => {
        root.unmount();
      });
    });
  });

  describe('QuickAddModal Edge Cases', () => {
    it('gerencia toggle de participantes (desmarcar, impedir desmarcar o último, remarcar) e reset de cartão ao alterar forma de pagamento', async () => {
      vi.spyOn(FinanceContext, 'useFinance').mockReturnValue({
        activeWorkspace: mockWorkspace,
        workspaceMembers: singleMember,
        categories: [] as any,
        paymentMethods: [
          { id: 'pm-cc', name: 'Cartão de Crédito', type: 'credit', credit_card_id: 'card-1' },
          { id: 'pm-pix', name: 'PIX', type: 'pix' },
        ] as any,
        accounts: [{ id: 'acc-1', name: 'Conta Principal', type: 'checking', balance: 1000 }] as any,
        creditCards: [{ id: 'card-1', name: 'Nubank', limit: 5000, closing_day: 10, due_day: 17 }] as any,
        people: savedPeople,
        addPerson: mockAddPerson,
        addTransaction: mockAddTransaction,
        createInstallmentPurchase: mockCreateInstallmentPurchase,
        createTransfer: vi.fn(),
      } as any);

      const container = (globalThis as any).document.createElement('div');
      const root = createRoot(container);

      await act(async () => {
        root.render(<QuickAddModal isOpen={true} onClose={mockOnClose} />);
      });

      // 1. Mudança de forma de pagamento limpa selectedCreditCardId
      const selects = findNodes(container, (n) => n.tagName === 'SELECT');
      const pmSelect = selects.find((s) => getReactProps(s)?.value === '');
      if (pmSelect) {
        await act(async () => {
          getReactProps(pmSelect).onChange({ target: { value: 'pm-pix' } });
        });
      }

      // 2. Chips de participantes: desmarcar João Silva
      const chips = findNodes(container, (n) => n.tagName === 'BUTTON' && getReactProps(n)?.className?.includes('rounded-full'));
      expect(chips.length).toBe(3); // wsm-1, person-1, person-2

      // Desmarca person-1
      await act(async () => {
        getReactProps(chips[1]).onClick();
      });

      // Desmarca person-2
      const freshChips = findNodes(container, (n) => n.tagName === 'BUTTON' && getReactProps(n)?.className?.includes('rounded-full'));
      await act(async () => {
        getReactProps(freshChips[2]).onClick();
      });

      // Agora só resta wsm-1. Tentar desmarcar wsm-1 não surte efeito (guarda current.length <= 1)
      const lastChip = findNodes(container, (n) => n.tagName === 'BUTTON' && getReactProps(n)?.className?.includes('rounded-full'));
      await act(async () => {
        getReactProps(lastChip[0]).onClick();
      });

      // Re-clicar em person-1 para re-adicioná-lo
      await act(async () => {
        getReactProps(lastChip[1]).onClick();
      });

      // Desmarca wsm-1 (pagador) para testar o fallback que insere o pagador de volta (linhas 200-201)
      const chipsAfterReAdd = findNodes(container, (n) => n.tagName === 'BUTTON' && getReactProps(n)?.className?.includes('rounded-full'));
      await act(async () => {
        getReactProps(chipsAfterReAdd[0]).onClick();
      });

      // Submete a despesa com selectedParticipantIds customizado (cobrindo linhas 198-201 em QuickAddModal)
      const descInput = findNode(container, (n) => n.tagName === 'INPUT' && getReactProps(n)?.placeholder?.includes('Supermercado'));
      const amountInput = findNode(container, (n) => n.tagName === 'INPUT' && getReactProps(n)?.placeholder?.includes('0,00'));
      const form = findNode(container, (n) => n.tagName === 'FORM');

      await act(async () => {
        getReactProps(descInput).onChange({ target: { value: 'Despesa com Participantes Selecionados' } });
        getReactProps(amountInput).onChange({ target: { value: '80,00' } });
      });

      const allSelects = findNodes(container, (n) => n.tagName === 'SELECT');
      const splitTypeSelect = allSelects.find((s) => getReactProps(s)?.value === 'individual');
      if (splitTypeSelect) {
        await act(async () => {
          getReactProps(splitTypeSelect).onChange({ target: { value: 'equal' } });
        });
      }

      await act(async () => {
        getReactProps(form).onSubmit({ preventDefault: () => {} });
      });

      expect(mockAddTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Despesa com Participantes Selecionados',
          amount: 80,
          split_type: 'equal',
        })
      );

      await act(async () => {
        root.unmount();
      });
    });
  });

  describe('MemberBalances Component Fallbacks', () => {
    it('lida com ausência de participantsCount e de b.name corretamente', async () => {
      const container = (globalThis as any).document.createElement('div');
      const root = createRoot(container);

      const mockGetMemberName = vi.fn().mockReturnValue('Nome Pelo Callback');

      await act(async () => {
        root.render(
          <MemberBalances
            balances={[
              {
                member_id: 'unknown-id',
                total_paid: 100,
                total_share: 50,
                net_balance: 50,
                participant_type: 'person',
              } as any,
            ]}
            currentMembers={singleMember}
            getMemberName={mockGetMemberName}
          />
        );
      });

      expect(mockGetMemberName).toHaveBeenCalledWith('unknown-id');
      expect(findNode(container, (n) => getReactProps(n)?.children === 'Nome Pelo Callback')).toBeDefined();

      await act(async () => {
        root.unmount();
      });
    });
  });

  describe('Person Actions and Validation Helpers Edge Cases', () => {
    it('executa updatePerson com archived true/false e valida exclusão bloqueada por purchases/settlements', () => {
      const fakeDeps: any = {
        state: {
          allPeople: [
            { id: 'p-1', workspace_id: 'ws-1', name: 'Carlos', archived: false, created_at: '2026-01-01' },
          ],
          allTransactions: [],
          allPurchases: [
            {
              id: 'pur-1',
              workspace_id: 'ws-1',
              paid_by_person_id: 'p-1',
              splits: [],
            },
          ],
          allSettlements: [],
          allWorkspaceMembers: [],
        },
        getState() {
          return this.state;
        },
        commit(newState: any) {
          this.state = newState;
        },
        now() {
          return new Date('2026-04-01T12:00:00Z');
        },
      };

      // updatePerson arquivando
      const updated = updatePerson(fakeDeps, 'p-1', { archived: true });
      expect(updated.archived).toBe(true);

      // deletePerson bloqueado por pur.paid_by_person_id
      expect(() => deletePerson(fakeDeps, 'p-1')).toThrow(/histórico financeiro/);

      // deletePerson bloqueado por pur.splits
      fakeDeps.state.allPurchases = [
        {
          id: 'pur-2',
          workspace_id: 'ws-1',
          paid_by_person_id: null,
          splits: [{ person_id: 'p-1', amount: 50 }],
        },
      ];
      expect(() => deletePerson(fakeDeps, 'p-1')).toThrow(/histórico financeiro/);
    });

    it('valida transações no action-helpers com restrições de pagador membro/pessoa simultâneo ou inválido', () => {
      const fakeDeps: any = {
        state: {
          allWorkspaceMembers: [
            { id: 'm-1', workspace_id: 'ws-1' },
            { id: 'm-2', workspace_id: 'ws-1' },
          ],
          allPeople: [
            { id: 'p-1', workspace_id: 'ws-1' },
          ],
        },
        getState() {
          return this.state;
        },
      };

      // Simultâneo
      expect(() =>
        validateTransactionSplits(fakeDeps, 100, 'ws-1', 'm-1', [], 'equal', 'p-1')
      ).toThrow('Transação não pode ter pagador membro e pagador pessoa simultaneamente.');

      // Membro fora do workspace
      expect(() =>
        validateTransactionSplits(fakeDeps, 100, 'ws-1', 'm-fora', [], 'equal', null)
      ).toThrow('O membro pagador informado não pertence ao workspace ativo.');

      // Pessoa fora do workspace
      expect(() =>
        validateTransactionSplits(fakeDeps, 100, 'ws-1', null, [], 'equal', 'p-fora')
      ).toThrow('A pessoa pagadora informada não pertence ao workspace ativo.');

      // Regra equal com discrepância de valores entre membros
      expect(() =>
        validateTransactionSplits(
          fakeDeps,
          100,
          'ws-1',
          'm-1',
          [
            { member_id: 'm-1', amount: 40 },
            { member_id: 'm-2', amount: 60 },
          ],
          'equal',
          null
        )
      ).toThrow("A distribuição de frações informada diverge do cálculo canônico para a regra 'equal'.");

      // Regra full_other com discrepância de valores entre membros
      const threeMembersDeps: any = {
        state: {
          allWorkspaceMembers: [
            { id: 'm-1', workspace_id: 'ws-1' },
            { id: 'm-2', workspace_id: 'ws-1' },
            { id: 'm-3', workspace_id: 'ws-1' },
          ],
          allPeople: [],
        },
        getState() {
          return this.state;
        },
      };
      expect(() =>
        validateTransactionSplits(
          threeMembersDeps,
          100,
          'ws-1',
          'm-1',
          [
            { member_id: 'm-2', amount: 40 },
            { member_id: 'm-3', amount: 60 },
          ],
          'full_other',
          null
        )
      ).toThrow("A distribuição de frações informada diverge do cálculo canônico para a regra 'full_other'.");
    });

    it('suporta fallbacks quando state.allPeople ou allSettlements é undefined', () => {
      const undefinedPeopleDeps: any = {
        state: {
          activeWorkspaceId: 'ws-1',
          allPeople: undefined,
          allWorkspaceMembers: [{ id: 'm-1', workspace_id: 'ws-1' }],
          allTransactions: [],
          allPurchases: [],
          allSettlements: undefined,
        },
        getState() {
          return this.state;
        },
        commit(newState: any) {
          this.state = newState;
        },
        generateId: (prefix: string) => `${prefix}-new`,
        now: () => new Date('2026-04-01T12:00:00Z'),
      };

      // validateTransactionSplits com allPeople undefined
      expect(() =>
        validateTransactionSplits(undefinedPeopleDeps, 100, 'ws-1', 'm-1', [], 'individual', null)
      ).not.toThrow();

      // addPerson com allPeople undefined
      const created = addPerson(undefinedPeopleDeps, { name: 'Pessoa Inicial' });
      expect(created.name).toBe('Pessoa Inicial');
      expect(undefinedPeopleDeps.state.allPeople).toHaveLength(1);

      // deletePerson com allSettlements undefined
      expect(() => deletePerson(undefinedPeopleDeps, created.id)).not.toThrow();

      // updatePerson e deletePerson com allPeople undefined lançando Not Found
      undefinedPeopleDeps.state.allPeople = undefined;
      expect(() => updatePerson(undefinedPeopleDeps, 'missing', { name: 'Novo' })).toThrow(/não encontrada/);
      expect(() => deletePerson(undefinedPeopleDeps, 'missing')).toThrow(/não encontrada/);

      // recordSettlement com allPeople undefined
      undefinedPeopleDeps.state.allWorkspaceMembers = [
        { id: 'm-1', workspace_id: 'ws-1' },
        { id: 'm-2', workspace_id: 'ws-1' },
      ];
      undefinedPeopleDeps.state.allTransactions = [
        {
          id: 'tx-shared',
          workspace_id: 'ws-1',
          description: 'Despesa Compartilhada',
          amount: 100,
          type: 'expense',
          paid_by_member_id: 'm-2',
          split_type: 'equal',
          splits: [
            { member_id: 'm-1', amount: 50 },
            { member_id: 'm-2', amount: 50 },
          ],
        },
      ];
      undefinedPeopleDeps.state.allWorkspaces = [{ id: 'ws-1', tracking_mode: 'full' }];
      const settlement = recordSettlement(undefinedPeopleDeps, {
        from_member_id: 'm-1',
        to_member_id: 'm-2',
        amount: 50,
      });
      expect(settlement.amount).toBe(50);
    });

    it('valida regras de integridade de pagador e pessoa no LocalFinanceRepository', async () => {
      const repo = new LocalFinanceRepository();

      // saveTransaction com ambos pagadores
      await expect(
        repo.saveTransaction({
          workspace_id: 'ws-1',
          description: 'Tx Inválida',
          amount: 50,
          date: '2026-01-01',
          type: 'expense',
          category_id: 'cat-1',
          paid_by_member_id: 'm-1',
          paid_by_person_id: 'p-1',
        } as any)
      ).rejects.toThrow('Transação não pode ter pagador membro e pagador pessoa simultaneamente');

      // savePurchase com ambos pagadores
      await expect(
        repo.savePurchase({
          workspace_id: 'ws-1',
          description: 'Compra Inválida',
          total_amount: 100,
          purchase_date: '2026-01-01',
          total_installments: 2,
          paid_by_member_id: 'm-1',
          paid_by_person_id: 'p-1',
        } as any)
      ).rejects.toThrow('Compra parcelada não pode ter pagador membro e pagador pessoa simultaneamente');

      // savePerson com nome vazio
      await expect(
        repo.savePerson({
          workspace_id: 'ws-1',
          name: '   ',
        } as any)
      ).rejects.toThrow('Nome da pessoa não pode ser vazio');
    });

    it('cobre ramificações de erro e atalhos de teclado no PeopleManager', async () => {
      const container = (globalThis as any).document.createElement('div');
      const root = createRoot(container);

      const mockAddErr = vi.fn().mockRejectedValueOnce({});
      const mockUpdErr = vi.fn().mockRejectedValueOnce({});
      const mockDelErr = vi.fn().mockRejectedValueOnce({});

      await act(async () => {
        root.render(
          <PeopleManager
            people={[{ id: 'p-1', name: 'Ana', workspace_id: 'ws-1', archived: false, created_at: '2026-01-01', updated_at: '2026-01-01' }]}
            onAddPerson={mockAddErr}
            onUpdatePerson={mockUpdErr}
            onDeletePerson={mockDelErr}
          />
        );
      });

      // 1. onAddPerson erro genérico sem message
      const addInput = findNode(container, (n) => n.tagName === 'INPUT' && getReactProps(n)?.placeholder?.includes('Maria'));
      await act(async () => {
        getReactProps(addInput).onChange({ target: { value: 'Nova Pessoa' } });
      });
      await act(async () => {
        getReactProps(addInput).onKeyDown({ key: 'Enter', preventDefault: () => {} });
      });
      expect(findNode(container, (n) => getReactProps(n)?.children?.includes?.('Erro ao cadastrar pessoa.'))).toBeDefined();

      // 2. Start edit and press Escape
      const editBtn = findNode(container, (n) => n.tagName === 'BUTTON' && getReactProps(n)?.title === 'Renomear pessoa');
      await act(async () => {
        getReactProps(editBtn).onClick();
      });
      const editInput = findNode(container, (n) => n.tagName === 'INPUT' && getReactProps(n)?.value === 'Ana');
      expect(editInput).toBeDefined();

      // Pressiona Escape
      await act(async () => {
        getReactProps(editInput).onKeyDown({ key: 'Escape', preventDefault: () => {} });
      });
      // Verifica que cancelou a edição
      expect(findNode(container, (n) => n.tagName === 'INPUT' && getReactProps(n)?.value === 'Ana')).toBeFalsy();

      // 3. Start edit, save and handle error without message
      const editBtn2 = findNode(container, (n) => n.tagName === 'BUTTON' && getReactProps(n)?.title === 'Renomear pessoa');
      await act(async () => {
        getReactProps(editBtn2).onClick();
      });
      const editInput2 = findNode(container, (n) => n.tagName === 'INPUT' && getReactProps(n)?.value === 'Ana');
      await act(async () => {
        getReactProps(editInput2).onKeyDown({ key: 'Enter', preventDefault: () => {} });
      });
      expect(findNode(container, (n) => getReactProps(n)?.children?.includes?.('Erro ao renomear pessoa.'))).toBeDefined();

      // Cancela edição para reexibir botão de exclusão
      await act(async () => {
        getReactProps(editInput2).onKeyDown({ key: 'Escape', preventDefault: () => {} });
      });

      // 4. Delete with error without message
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const delBtn = findNode(container, (n) => n.tagName === 'BUTTON' && getReactProps(n)?.title === 'Excluir pessoa');
      await act(async () => {
        getReactProps(delBtn).onClick();
      });
      expect(findNode(container, (n) => getReactProps(n)?.children?.includes?.('Não é possível excluir esta pessoa'))).toBeDefined();

      confirmSpy.mockRestore();
      await act(async () => {
        root.unmount();
      });
    });

    it('cobre ramificações do SplitFields (erros inline, visualização custom e chips não selecionados)', async () => {
      const container = (globalThis as any).document.createElement('div');
      const root = createRoot(container);

      const mockAddInline = vi.fn().mockRejectedValueOnce({});

      await act(async () => {
        root.render(
          <SplitFields
            type="expense"
            totalAmount={100}
            workspaceMembers={[{ id: 'm-1', workspace_id: 'ws-1', user: { name: 'Membro 1' } } as any]}
            people={[]}
            splitType="individual"
            onSplitTypeChange={vi.fn()}
            paidByMemberId="m-1"
            paidByPersonId=""
            onPaidByMemberIdChange={vi.fn()}
            onPaidByPersonIdChange={vi.fn()}
            selectedParticipantIds={['m-1']}
            onToggleParticipant={vi.fn()}
            onSplitsChange={vi.fn()}
            onAddPerson={mockAddInline}
          />
        );
      });

      // 1. Tentar adicionar com nome vazio
      const inlineInput = findNode(container, (n) => n.tagName === 'INPUT' && getReactProps(n)?.placeholder?.includes('Lucas'));
      const buttons = findNodes(container, (n) => n.tagName === 'BUTTON');
      const addInlineBtn = buttons.find((b) => getReactProps(b)?.children?.includes?.('Adicionar') || getReactProps(b)?.children?.[1] === 'Adicionar');
      await act(async () => {
        getReactProps(inlineInput).onChange({ target: { value: '   ' } });
      });
      await act(async () => {
        getReactProps(addInlineBtn).onClick({ preventDefault: () => {} });
      });
      expect(findNode(container, (n) => getReactProps(n)?.children === 'Informe o nome da pessoa.')).toBeDefined();

      // 2. Tentar adicionar com nome duplicado existente
      await act(async () => {
        getReactProps(inlineInput).onChange({ target: { value: 'Membro 1' } });
      });
      await act(async () => {
        getReactProps(addInlineBtn).onClick({ preventDefault: () => {} });
      });
      expect(findNode(container, (n) => getReactProps(n)?.children === 'Já existe um membro ou pessoa com esse nome.')).toBeDefined();

      // 3. Erro genérico na adição
      await act(async () => {
        getReactProps(inlineInput).onChange({ target: { value: 'Nome Novo' } });
      });
      await act(async () => {
        getReactProps(addInlineBtn).onClick({ preventDefault: () => {} });
      });
      expect(findNode(container, (n) => getReactProps(n)?.children === 'Erro ao adicionar pessoa.')).toBeDefined();

      // 4. Renderizar com regra 'custom' com membro e pessoa, verificando badges e chip não selecionado
      await act(async () => {
        root.render(
          <SplitFields
            type="expense"
            totalAmount={100}
            workspaceMembers={[{ id: 'm-1', workspace_id: 'ws-1', user: { name: 'Membro 1' } } as any]}
            people={[{ id: 'p-1', workspace_id: 'ws-1', name: 'Pessoa 1', archived: false, created_at: '', updated_at: '' }]}
            splitType="custom"
            onSplitTypeChange={vi.fn()}
            paidByMemberId="m-1"
            paidByPersonId=""
            onPaidByMemberIdChange={vi.fn()}
            onPaidByPersonIdChange={vi.fn()}
            selectedParticipantIds={['m-1']}
            onToggleParticipant={vi.fn()}
            onSplitsChange={vi.fn()}
          />
        );
      });

      // Valida que o chip de p-1 não selecionado renderiza texto (Pessoa) com text-slate-400
      expect(findNode(container, (n) => getReactProps(n)?.className?.includes?.('text-slate-400') && getReactProps(n)?.children === '(Pessoa)')).toBeDefined();

      // Muda pagador para p-1 mas não seleciona o chip de p-1
      await act(async () => {
        root.render(
          <SplitFields
            type="expense"
            totalAmount={100}
            workspaceMembers={[{ id: 'm-1', workspace_id: 'ws-1', user: { name: 'Membro 1' } } as any]}
            people={[{ id: 'p-1', workspace_id: 'ws-1', name: 'Pessoa 1', archived: false, created_at: '', updated_at: '' }]}
            splitType="custom"
            onSplitTypeChange={vi.fn()}
            paidByMemberId=""
            paidByPersonId="p-1"
            onPaidByMemberIdChange={vi.fn()}
            onPaidByPersonIdChange={vi.fn()}
            selectedParticipantIds={['m-1']}
            onToggleParticipant={vi.fn()}
            onSplitsChange={vi.fn()}
          />
        );
      });
      expect(findNode(container, (n) => getReactProps(n)?.className?.includes?.('text-amber-600') && getReactProps(n)?.children === '[Pagou]')).toBeDefined();

      await act(async () => {
        root.unmount();
      });
    });

    it('cria compra parcelada com pagador membro no QuickAddModal', async () => {
      const mockCard = {
        id: 'card-1',
        workspace_id: 'ws-single',
        name: 'Nubank',
        institution: 'Nubank',
        credit_limit: 5000,
        closing_day: 1,
        due_day: 10,
        color: '#820ad1',
        active: true,
        created_at: '2026-01-01',
      };

      vi.spyOn(FinanceContext, 'useFinance').mockReturnValue({
        activeWorkspace: mockWorkspace,
        workspaceMembers: singleMember,
        categories: [{ id: 'cat-1', name: 'Alimentação', type: 'expense', active: true }] as any,
        paymentMethods: [{ id: 'pm-1', name: 'Cartão de Crédito', type: 'credit_card', credit_card_id: 'card-1', active: true }] as any,
        accounts: [] as any,
        creditCards: [mockCard] as any,
        people: [savedPeople[0]],
        addPerson: mockAddPerson,
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
        getReactProps(amountInput).onChange({ target: { value: '300,00' } });
        getReactProps(descInput).onChange({ target: { value: 'Sofá parcelado' } });
      });

      // Seleciona método de pagamento Cartão
      const selects = findNodes(container, (n) => n.tagName === 'SELECT');
      const pmSelect = selects.find((s) => (s as any).options?.some?.((o: any) => o.value === 'pm-1'));
      if (pmSelect) {
        await act(async () => {
          getReactProps(pmSelect).onChange({ target: { value: 'pm-1' } });
        });
      }

      // Altera número de parcelas para 3
      const allSelectsAfter = findNodes(container, (n) => n.tagName === 'SELECT');
      const installmentSelect = allSelectsAfter.find((s) => {
        const p = getReactProps(s);
        return p?.value === 1 && s !== pmSelect;
      });
      if (installmentSelect) {
        await act(async () => {
          getReactProps(installmentSelect).onChange({ target: { value: '3' } });
        });
      }

      const form = findNodes(container, (n) => n.tagName === 'FORM')[0];
      await act(async () => {
        getReactProps(form).onSubmit({ preventDefault: () => {} });
      });

      expect(mockCreateInstallmentPurchase).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Sofá parcelado',
          total_amount: 300,
          installment_count: 3,
          paid_by_member_id: 'wsm-1',
          paid_by_person_id: undefined,
        })
      );

      await act(async () => {
        root.unmount();
      });
    });
  });
});
