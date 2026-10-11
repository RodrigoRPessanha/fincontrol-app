import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { setupFinanceHarness } from './test-utils/finance-provider-harness';
import * as Finance from '../context/finance-context';
import { PurchaseRepaymentModal } from '@/components/splits/PurchaseRepaymentModal';
import { SharedExpensesList } from '@/components/splits/SharedExpensesList';
import SplitsPage from '@/app/(dashboard)/splits/page';
import { Purchase } from '../types';

function props(node: any): any { const key = Object.keys(node || {}).find((k) => k.startsWith('__reactProps$')); return key ? node[key] : {}; }
function nodes(node: any, predicate: (n: any) => boolean): any[] { return [...(predicate(node) ? [node] : []), ...(node.childNodes || []).flatMap((child: any) => nodes(child, predicate))]; }
function text(node: any): string { return node.nodeValue || node.textContent || (node.childNodes || []).map(text).join(''); }
const purchase = { id: 'p', workspace_id: 'w', description: '600/3', total_amount: 600, installment_count: 3, repayment_version: 4, paid_by_member_id: 'a', split_type: 'equal', purchase_date: '2026-10-01', splits: [{ member_id: 'a', amount: 300 }, { person_id: 'b', amount: 300, repaid_installments_count: 2, repaid_amount: 200 }] } as Purchase;

describe('Purchase repayment interface', () => {
  setupFinanceHarness(); const roots: any[] = []; let update: any; let refresh: any; let close: any; let context: any;
  beforeEach(() => { update = vi.fn().mockResolvedValue(undefined); refresh = vi.fn().mockResolvedValue(undefined); close = vi.fn();
    context = { activeWorkspace: { id: 'w' }, isWorkspaceReadOnly: false, updatePurchaseRepaymentsAsync: update, refreshData: refresh };
    vi.spyOn(Finance, 'useFinance').mockImplementation(() => context);
  });
  afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); vi.restoreAllMocks(); });
  async function mount(element: React.ReactNode = <PurchaseRepaymentModal purchase={purchase} getName={(id) => id} onClose={close} />) {
    const container = document.createElement('div'); const root = createRoot(container); roots.push(root); await act(async () => root.render(element)); return { container, root };
  }
  it('loads saved counts, saves only repayment counts with opening version and prevents duplicate submits', async () => {
    let release!: () => void; update.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const { container } = await mount(); const select = nodes(container, (n) => n.tagName === 'SELECT')[0]; expect(props(select).value).toBe(2);
    await act(async () => props(select).onChange({ target: { value: '1' } }));
    const form = nodes(container, (n) => n.tagName === 'FORM')[0]; let pending!: Promise<void>;
    await act(async () => { pending = props(form).onSubmit({ preventDefault() {} }); await props(form).onSubmit({ preventDefault() {} }); });
    expect(update).toHaveBeenCalledExactlyOnceWith('p', [{ participant_id: 'b', count: 1 }], 4); expect(close).not.toHaveBeenCalled();
    await act(async () => { release(); await pending; }); expect(close).toHaveBeenCalledOnce();
  });
  it('keeps conflicting edits open and provides refresh recovery, including a failed refresh', async () => {
    update.mockRejectedValueOnce(new Error('Remote conflict')); const { container } = await mount();
    await act(async () => props(nodes(container, (n) => n.tagName === 'FORM')[0]).onSubmit({ preventDefault() {} }));
    expect(text(container)).toContain('Remote conflict'); expect(close).not.toHaveBeenCalled();
    const button = () => nodes(container, (n) => props(n).children === 'Atualizar dados e fechar')[0];
    refresh.mockRejectedValueOnce(new Error('Offline')); await act(async () => props(button()).onClick()); expect(text(container)).toContain('Não foi possível atualizar');
    await act(async () => props(button()).onClick()); expect(close).toHaveBeenCalledOnce();
  });
  it('hides foreign/read-only forms, handles legacy empty shares and cancels via Escape', async () => {
    context.isWorkspaceReadOnly = true; expect(text((await mount()).container)).toBe(''); context.isWorkspaceReadOnly = false;
    expect(text((await mount(<PurchaseRepaymentModal purchase={{ ...purchase, workspace_id: 'foreign' }} getName={String} onClose={close} />)).container)).toBe('');
    const { container } = await mount(<PurchaseRepaymentModal purchase={{ ...purchase, splits: undefined, repayment_version: undefined }} getName={String} onClose={close} />);
    const dialog = nodes(container, (n) => props(n).role === 'dialog')[0]; await act(async () => props(dialog).onKeyDown({ key: 'Escape' })); expect(close).toHaveBeenCalledOnce();
    await act(async () => props(nodes(container, (n) => props(n).children === 'Cancelar')[0]).onClick()); expect(close).toHaveBeenCalledTimes(2);
    update.mockRejectedValueOnce('Failure'); await act(async () => props(nodes(container, (n) => n.tagName === 'FORM')[0]).onSubmit({ preventDefault() {} })); expect(text(container)).toContain('Não foi possível salvar');
  });
  it('opens an existing split from the monthly list and closes its editor without changing the monthly responsibility', async () => {
    const rows = [1, 2, 3].map((n) => ({ id: `i${n}`, purchase_id: 'p', installment_number: n, amount: 200, due_date: `2026-${String(new Date().getMonth() + 1).padStart(2, '0')}-10`, status: 'pending' }));
    Object.assign(context, { workspaceMembers: [{ id: 'a', workspace_id: 'w', role: 'owner', user: { name: 'A' } }], people: [{ id: 'b', workspace_id: 'w', name: 'B' }], transactions: [], purchases: [purchase], installments: rows, creditCardBills: [], settlements: [], recordSettlementAsync: vi.fn(), deleteSettlement: vi.fn(), addPerson: vi.fn(), updatePerson: vi.fn(), deletePerson: vi.fn() });
    const { container } = await mount(<SplitsPage />); const buttons = nodes(container, (n) => n.tagName === 'BUTTON' && text(n).startsWith('Ajustar repasses de'));
    expect(buttons.length).toBe(3); await act(async () => props(buttons[0]).onClick()); expect(text(container)).toContain('Ajustar parcelas repassadas');
    await act(async () => props(nodes(container, (n) => props(n).children === 'Cancelar')[0]).onClick()); expect(text(container)).not.toContain('Ajustar parcelas repassadas');
    expect(text(container)).toContain('Responsabilidade no mês');
  });
  it('traps keyboard focus and ignores Escape while a repayment save is pending', async () => {
    const { container } = await mount(); const dialog = nodes(container, (n) => props(n).role === 'dialog')[0];
    const first = { focus: vi.fn() }; const last = { focus: vi.fn() }; dialog.querySelectorAll = () => [first, last];
    const preventDefault = vi.fn(); (document as any).activeElement = first;
    await act(async () => props(dialog).onKeyDown({ key: 'Tab', currentTarget: dialog, shiftKey: true, preventDefault })); expect(last.focus).toHaveBeenCalledOnce();
    (document as any).activeElement = last;
    await act(async () => props(dialog).onKeyDown({ key: 'Tab', currentTarget: dialog, shiftKey: false, preventDefault })); expect(first.focus).toHaveBeenCalledOnce();
    (document as any).activeElement = null;
    await act(async () => props(dialog).onKeyDown({ key: 'Tab', currentTarget: dialog, shiftKey: false, preventDefault }));
    let release!: () => void; update.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; })); let pending!: Promise<void>;
    await act(async () => { pending = props(nodes(container, (n) => n.tagName === 'FORM')[0]).onSubmit({ preventDefault() {} }); });
    await act(async () => props(dialog).onKeyDown({ key: 'Escape' })); expect(close).not.toHaveBeenCalled();
    await act(async () => { release(); await pending; });
  });
  it.each([false, true])('discards save callbacks after the form is unmounted (reject=%s)', async (reject) => {
    let release!: () => void; update.mockImplementationOnce(() => new Promise<void>((resolve, fail) => { release = () => reject ? fail(new Error('Offline')) : resolve(); }));
    const { container, root } = await mount(<PurchaseRepaymentModal purchase={{ ...purchase, paid_by_member_id: undefined, paid_by_person_id: 'b', splits: [{ member_id: 'a', amount: 300 }] }} getName={String} onClose={close} />);
    let pending!: Promise<void>; await act(async () => { pending = props(nodes(container, (n) => n.tagName === 'FORM')[0]).onSubmit({ preventDefault() {} }); });
    await act(async () => root.unmount()); roots.splice(roots.indexOf(root), 1);
    await act(async () => { release(); await pending; }); expect(close).not.toHaveBeenCalled();
  });
  it.each([false, true])('discards a refresh callback after the editor is unmounted (reject=%s)', async (reject) => {
    update.mockRejectedValueOnce(new Error('Conflict')); const { container, root } = await mount();
    await act(async () => props(nodes(container, (n) => n.tagName === 'FORM')[0]).onSubmit({ preventDefault() {} }));
    let release!: () => void; refresh.mockImplementationOnce(() => new Promise<void>((resolve, fail) => { release = () => reject ? fail(new Error('Offline')) : resolve(); }));
    let pending!: Promise<void>; await act(async () => { pending = props(nodes(container, (n) => props(n).children === 'Atualizar dados e fechar')[0]).onClick(); });
    await act(async () => root.unmount()); roots.splice(roots.indexOf(root), 1);
    await act(async () => { release(); await pending; }); expect(close).not.toHaveBeenCalled();
  });
  it('labels historical repayments on purchase items and passes the purchase identity to the edit action', async () => {
    const edit = vi.fn(); const { container } = await mount(<SharedExpensesList splitItems={[{ ...purchase, amount: 200, date: '2026-10-28', isPurchase: true, purchaseId: 'p', installmentCount: 3, installmentNumber: 1, splits: purchase.splits! }]} currentMembers={[]} getMemberName={String} onEditRepayments={edit} />);
    expect(text(container)).toContain('2 parcela(s) já repassada(s)'); await act(async () => props(nodes(container, (n) => n.tagName === 'BUTTON')[0]).onClick()); expect(edit).toHaveBeenCalledWith('p');
  });
});
