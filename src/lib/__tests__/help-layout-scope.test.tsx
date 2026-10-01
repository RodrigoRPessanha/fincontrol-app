import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RootLayout from '@/app/layout';
import DashboardLayout from '@/app/(dashboard)/layout';
import HelpLayout from '@/app/ajuda/layout';
import HelpPage from '@/app/ajuda/page';
import { FinanceProvider } from '@/lib/context/finance-context';

vi.mock('@/lib/context/auth-context', () => ({ AuthProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/lib/context/theme-context', () => ({ ThemeProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/lib/context/finance-context', () => ({
  FinanceProvider: vi.fn(({ children }: { children: React.ReactNode }) => <div data-finance-scope="true">{children}</div>),
}));
vi.mock('@/components/layout/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('@/components/layout/Header', () => ({ Header: () => null }));
vi.mock('@/components/layout/MobileNav', () => ({ MobileNav: () => null }));
vi.mock('@/components/shared/GlobalErrorBanner', () => ({ GlobalErrorBanner: () => null }));

describe('Public help and financial layout boundaries', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders help without mounting the financial initializer', () => {
    const html = renderToStaticMarkup(<RootLayout><HelpLayout><HelpPage /></HelpLayout></RootLayout>);
    expect(html).toContain('Como podemos ajudar?');
    expect(html).toContain('Pular para o conteúdo');
    expect(FinanceProvider).not.toHaveBeenCalled();
  });

  it('keeps financial pages inside their provider', () => {
    const html = renderToStaticMarkup(<RootLayout><DashboardLayout><p>Conteúdo financeiro protegido</p></DashboardLayout></RootLayout>);
    expect(FinanceProvider).toHaveBeenCalledOnce();
    expect(html).toContain('data-finance-scope="true"');
    expect(html).toContain('Conteúdo financeiro protegido');
  });
});
