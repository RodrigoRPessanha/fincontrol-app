import { describe, expect, it } from 'vitest';
import React, { act } from 'react';
import { FinanceProvider, useFinance } from '../../context/finance-context';
import { setupFinanceHarness } from '../test-utils/finance-provider-harness';
import AccountsPage from '../../../app/(dashboard)/accounts/page';
import BudgetsPage from '../../../app/(dashboard)/budgets/page';
import GoalsPage from '../../../app/(dashboard)/goals/page';
import RecurringPage from '../../../app/(dashboard)/recurring/page';

function props(node: any): any {
  const key = Object.keys(node).find((k) => k.startsWith('__reactProps$'));
  return key ? node[key] : {};
}
function text(node: any): string {
  return node.nodeType === 3 ? node.nodeValue ?? '' : node.textContent || (node.childNodes ?? []).map(text).join('');
}
function nodes(node: any, predicate: (n: any) => boolean): any[] {
  return [...(predicate(node) ? [node] : []), ...(node.childNodes ?? []).flatMap((child: any) => nodes(child, predicate))];
}

describe('Valores persistidos pelos sete formulários monetários', () => {
  const harness = setupFinanceHarness();
  const forms = [
    { kind: 'account', Page: AccountsPage, button: 'Nova Conta', name: 'Ex: Nubank Principal', value: '0,00' },
    { kind: 'card', Page: AccountsPage, button: 'Novo Cartão', name: 'Ex: Nubank Ultravioleta', value: '10000,00' },
    { kind: 'transfer', Page: AccountsPage, button: 'Transferir entre Contas', value: '0,00' },
    { kind: 'budget', Page: BudgetsPage, button: 'Definir Orçamento', value: 'Ex: 1500,00' },
    { kind: 'goal', Page: GoalsPage, button: 'Criar Nova Meta', name: 'Ex: Reserva de Emergência 6 meses', value: 'Ex: 50000,00' },
    { kind: 'deposit', Page: GoalsPage, button: 'Guardar Dinheiro nesta Meta', value: '0,00' },
    { kind: 'recurring', Page: RecurringPage, button: 'Nova Recorrência', name: 'Ex: Aluguel, Netflix, Salário', value: '0,00' },
  ];
  for (const config of forms) {
    it.each(['12.34', '12,34', '1,234.56', '100abc'])(`${config.kind}: %s`, async (input) => {
      const h = await harness.mountProvider();
      let ctx!: ReturnType<typeof useFinance>;
      function Capture() { ctx = useFinance(); return null; }
      const Page = config.Page;
      await act(async () => h.root.render(<FinanceProvider><Capture /><Page /></FinanceProvider>));
      const bank = ctx.accounts[0];
      const goal = ctx.goals[0];
      const beforeBalance = bank.current_balance;
      const beforeGoal = goal?.current_amount ?? 0;
      if (config.kind === 'card') {
        const tab = nodes(h.container, (n) => n.tagName === 'BUTTON' && text(n).includes('Cartões de Crédito'))[0];
        await act(async () => props(tab).onClick());
      }
      const button = nodes(h.container, (n) => n.tagName === 'BUTTON' && text(n).includes(config.button))[0];
      expect(button).toBeTruthy();
      await act(async () => props(button).onClick());
      const form = nodes(h.container, (n) => n.tagName === 'FORM')[0];
      const fields = nodes(form, (n) => n.tagName === 'INPUT');
      const value = fields.find((n) => props(n).placeholder === config.value);
      expect(value).toBeTruthy();
      await act(async () => {
        if (config.name) props(fields.find((n) => props(n).placeholder === config.name)).onChange({ target: { value: 'Monetary fixture' } });
        props(value).onChange({ target: { value: input } });
        const selects = nodes(form, (n) => n.tagName === 'SELECT');
        if (config.kind === 'transfer') {
          props(selects[0]).onChange({ target: { value: bank.id } });
          props(selects[1]).onChange({ target: { value: ctx.accounts[1].id } });
        }
        if (config.kind === 'budget') props(selects[0]).onChange({ target: { value: ctx.categories.find((c) => c.type === 'expense')!.id } });
        if (config.kind === 'deposit') props(selects[0]).onChange({ target: { value: bank.id } });
      });
      await act(async () => props(form).onSubmit({ preventDefault() {} }));
      if (input === '100abc') {
        expect(nodes(h.container, (n) => props(n).role === 'alert').some((n) => text(n).length > 0)).toBe(true);
        expect(nodes(h.container, (n) => n.tagName === 'FORM')).toHaveLength(1);
        expect(ctx.accounts[0].current_balance).toBe(beforeBalance);
        expect(ctx.accounts.some((a) => a.name === 'Monetary fixture')).toBe(false);
        return;
      }
      const expected = input === '1,234.56' ? 1234.56 : 12.34;
      if (config.kind === 'account') expect(ctx.accounts.find((a) => a.name === 'Monetary fixture')?.initial_balance).toBe(expected);
      if (config.kind === 'card') expect(ctx.creditCards.find((c) => c.name === 'Monetary fixture')?.credit_limit).toBe(expected);
      if (config.kind === 'transfer') expect(ctx.accounts.find((a) => a.id === bank.id)?.current_balance).toBeCloseTo(beforeBalance - expected, 2);
      if (config.kind === 'budget') expect(ctx.budgets.some((b) => b.planned_amount === expected)).toBe(true);
      if (config.kind === 'goal') expect(ctx.goals.find((g) => g.name === 'Monetary fixture')?.target_amount).toBe(expected);
      if (config.kind === 'deposit') {
        expect(ctx.goals.find((g) => g.id === goal.id)?.current_amount).toBeCloseTo(beforeGoal + expected, 2);
        expect(ctx.accounts.find((a) => a.id === bank.id)?.current_balance).toBeCloseTo(beforeBalance - expected, 2);
      }
      if (config.kind === 'recurring') expect(ctx.recurring.find((r) => r.description === 'Monetary fixture')?.amount).toBe(expected);
    });
  }
});
