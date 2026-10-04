import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import BudgetsPage from '@/app/(dashboard)/budgets/page';
import { useFinance } from '@/lib/context/finance-context';

vi.mock('@/components/help/ContextualHelp', () => ({ ContextualHelp: () => null }));
vi.mock('@/components/shared/CategoryIcon', () => ({ CategoryIcon: () => null }));
vi.mock('@/lib/context/finance-context', () => ({ useFinance: vi.fn() }));

describe('BudgetsPage without a category limit', () => {
  it('does not show a false 0% or remaining balance when spending exists but no budget is set', () => {
    const today = new Date().toISOString().slice(0, 10);
    vi.mocked(useFinance).mockReturnValue({
      budgets: [],
      categories: [],
      allWorkspaceCategories: [
        {
          id: 'cat-food',
          workspace_id: 'ws-1',
          name: 'Alimentação',
          type: 'expense',
          active: true,
          color: '#10b981',
          icon: 'tag',
          created_at: today,
        },
      ],
      transactions: [
        {
          id: 'tx-food',
          workspace_id: 'ws-1',
          description: 'Mercado',
          amount: 48,
          type: 'expense',
          status: 'pending',
          transaction_date: today,
          due_date: today,
        },
      ],
      purchases: [],
      installments: [],
      setBudget: vi.fn(),
      isWorkspaceReadOnly: false,
    } as any);

    const html = renderToStaticMarkup(React.createElement(BudgetsPage));

    expect(html).toContain('Sem limite definido');
    expect(html).toContain('Defina um limite para acompanhar o saldo');
    expect(html).not.toContain('Restam R$');
    expect(html).not.toContain('0%');
  });
});
