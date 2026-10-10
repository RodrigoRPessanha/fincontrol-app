import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupFinanceHarness } from './test-utils/finance-provider-harness';
import * as Finance from '../context/finance-context';
import { EditTransactionModal } from '@/components/transactions/EditTransactionModal';
import { MonthlySplitOverview } from '@/components/splits/MonthlySplitOverview';
import { Transaction } from '../types';

function props(node: any): any { const key = Object.keys(node || {}).find((key) => key.startsWith('__reactProps$')); return key ? node[key] : {}; }
function nodes(node: any, predicate: (node: any) => boolean): any[] { return [...(predicate(node) ? [node] : []), ...(node.childNodes || []).flatMap((child: any) => nodes(child, predicate))]; }
function text(node: any): string { return node.nodeValue || node.textContent || (node.childNodes || []).map(text).join(''); }
const tx = { id: 't', workspace_id: 'w', description: 'Original', amount: 100, type: 'expense', status: 'pending', transaction_date: '2026-10-01', due_date: '2026-10-20', created_at: '2026-10-01', updated_at: '2026-10-01', split_type: 'equal', paid_by_member_id: 'a', splits: [{ member_id: 'a', amount: 50 }, { member_id: 'b', amount: 50 }] } as Transaction;

describe('Transaction edit and monthly overview UI', () => {
  setupFinanceHarness();
  const roots: any[] = [];
  let update: ReturnType<typeof vi.fn>; let refresh: ReturnType<typeof vi.fn>; let close: () => void;
  beforeEach(() => {
    update = vi.fn().mockResolvedValue(undefined); refresh = vi.fn().mockResolvedValue(undefined); close = vi.fn();
    vi.spyOn(Finance, 'useFinance').mockReturnValue({ activeWorkspace: { id: 'w' }, isWorkspaceReadOnly: false,
      updateTransactionAsync: update, refreshData: refresh, allWorkspaceCategories: [], allWorkspacePeople: [], people: [], payments: [],
      workspaceMembers: [{ id: 'a', workspace_id: 'w', user: { name: 'Pessoa A' } }, { id: 'b', workspace_id: 'w', user: { name: 'Pessoa B' } }], addPerson: vi.fn() } as any);
  });
  afterEach(async () => { await act(async () => { for (const root of roots.splice(0)) root.unmount(); }); vi.restoreAllMocks(); });
  async function mount(target = tx) {
    const container = document.createElement('div'); const root = createRoot(container); roots.push(root);
    await act(async () => root.render(<EditTransactionModal target={target} onClose={close} />));
    return container;
  }
  const field = (container: any, name: string) => nodes(container, (node) => props(node)['aria-label'] === name)[0];
  const form = (container: any) => nodes(container, (node) => node.tagName === 'FORM')[0];

  it('sends only changed metadata, awaits persistence and prevents a double submit', async () => {
    let release!: () => void; update.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const container = await mount();
    await act(async () => props(field(container, 'Descrição')).onChange({ target: { value: 'Edited' } }));
    let done!: Promise<void>;
    await act(async () => { done = props(form(container)).onSubmit({ preventDefault() {} }); await props(form(container)).onSubmit({ preventDefault() {} }); });
    expect(update).toHaveBeenCalledExactlyOnceWith('t', { description: 'Edited' }, tx.updated_at); expect(close).not.toHaveBeenCalled();
    await act(async () => { release(); await done; }); expect(close).toHaveBeenCalledTimes(1);
  });

  it('keeps failed edits open and lets the user refresh instead of overwriting a remote edit', async () => {
    update.mockRejectedValueOnce(new Error('Esta transação foi alterada.'));
    const container = await mount();
    await act(async () => props(field(container, 'Descrição')).onChange({ target: { value: 'Edited' } }));
    await act(async () => props(form(container)).onSubmit({ preventDefault() {} }));
    expect(text(container)).toContain('Esta transação foi alterada.'); expect(close).not.toHaveBeenCalled();
    refresh.mockRejectedValueOnce(new Error('Offline'));
    const refreshButton = () => nodes(container, (node) => props(node).children === 'Atualizar dados e fechar edição')[0];
    await act(async () => props(refreshButton()).onClick()); expect(text(container)).toContain('Não foi possível atualizar');
    await act(async () => props(refreshButton()).onClick()); expect(close).toHaveBeenCalledTimes(1);
  });

  it('recalculates equal shares when editing an unpaid amount', async () => {
    const container = await mount();
    await act(async () => props(field(container, 'Valor')).onChange({ target: { value: '30,00' } }));
    await act(async () => props(form(container)).onSubmit({ preventDefault() {} }));
    expect(update).toHaveBeenCalledWith('t', expect.objectContaining({ amount: 30, splits: expect.arrayContaining([
      expect.objectContaining({ member_id: 'a', amount: 15 }), expect.objectContaining({ member_id: 'b', amount: 15 }),
    ]) }), tx.updated_at);
  });

  it('protects billed values and dates while allowing descriptive notes', async () => {
    const container = await mount({ ...tx, credit_card_bill_id: 'bill', status: 'paid' });
    expect(props(field(container, 'Valor')).disabled).toBe(true); expect(props(field(container, 'Vencimento')).disabled).toBe(true);
    await act(async () => props(field(container, 'Observações')).onChange({ target: { value: 'Details' } }));
    await act(async () => props(form(container)).onSubmit({ preventDefault() {} }));
    expect(update).toHaveBeenCalledWith('t', { notes: 'Details' }, tx.updated_at);
  });
  it('keeps the opening version and does not resend untouched fields after a remote refresh', async () => {
    const container = await mount();
    await act(async () => props(field(container, 'Observações')).onChange({ target: { value: 'My note' } }));
    await act(async () => roots[roots.length - 1].render(<EditTransactionModal target={{ ...tx, description: 'Remote description', updated_at: 'remote-version' }} onClose={close} />));
    update.mockRejectedValueOnce(new Error('Concurrent edit'));
    await act(async () => props(form(container)).onSubmit({ preventDefault() {} }));
    expect(update).toHaveBeenCalledExactlyOnceWith('t', { notes: 'My note' }, tx.updated_at);
    expect(close).not.toHaveBeenCalled();
  });

  it('renders monthly responsibilities and changes period without accepting an empty month', async () => {
    const onMonth = vi.fn(); const container = document.createElement('div'); const root = createRoot(container); roots.push(root);
    await act(async () => root.render(<MonthlySplitOverview month="2026-10" onMonthChange={onMonth} items={[{ amount: 200 } as any]} responsibilities={new Map([['a', 100], ['b', 100]])} warnings={[]} getName={(id) => `Pessoa ${id}`} />));
    expect(text(container)).toContain('Pessoa a'); expect(text(container)).toContain('Pessoa b');
    expect(text(container)).toContain('100,00');
    const input = nodes(container, (node) => props(node).id === 'split-month')[0];
    await act(async () => { props(input).onChange({ target: { value: '2026-11' } }); props(input).onChange({ target: { value: '' } }); });
    expect(onMonth).toHaveBeenCalledExactlyOnceWith('2026-11');
  });
});
