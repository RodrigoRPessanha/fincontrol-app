import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RootLayout from '@/app/layout';
import DashboardLayout from '@/app/(dashboard)/layout';
import HelpLayout from '@/app/ajuda/layout';
import HelpPage from '@/app/ajuda/page';
import { FinanceProvider } from '@/lib/context/finance-context';

const route = vi.hoisted(() => ({ pathname: '/ajuda', auth: null as any }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
vi.mock('@/lib/context/auth-context', () => ({ useOptionalAuth: () => route.auth, AuthProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/lib/context/theme-context', () => ({ ThemeProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/lib/context/finance-context', () => ({
  FinanceProvider: vi.fn(({ children }: { children: React.ReactNode }) => <div data-finance-scope="true">{children}</div>),
}));
vi.mock('@/components/layout/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('@/components/layout/Header', () => ({ Header: () => null }));
vi.mock('@/components/layout/MobileNav', () => ({ MobileNav: () => null }));
vi.mock('@/components/shared/GlobalErrorBanner', () => ({ GlobalErrorBanner: () => null }));

describe('Public help and financial layout boundaries', () => {
  beforeEach(() => { vi.clearAllMocks(); route.pathname = '/ajuda'; route.auth = null; });

  it('renders help without mounting the financial initializer', () => {
    const html = renderToStaticMarkup(<RootLayout><HelpLayout><HelpPage /></HelpLayout></RootLayout>);
    expect(html).toContain('Como podemos ajudar?');
    expect(html).toContain('Pular para o conteúdo');
    expect(FinanceProvider).not.toHaveBeenCalled();
  });

  it('keeps financial pages inside their provider', () => {
    route.pathname = '/';
    route.auth = { dataMode: 'local', user: { id: 'usr-1' }, isLoading: false };
    const html = renderToStaticMarkup(<RootLayout><DashboardLayout><p>Conteúdo financeiro protegido</p></DashboardLayout></RootLayout>);
    expect(FinanceProvider).toHaveBeenCalledOnce();
    expect(html).toContain('data-finance-scope="true"');
    expect(html).toContain('Conteúdo financeiro protegido');
  });

  it('does not mount the remote financial initializer after sign-out', () => {
    route.pathname = '/transactions';
    route.auth = { dataMode: 'supabase', user: null, isLoading: false };
    const html = renderToStaticMarkup(<RootLayout><DashboardLayout><p>Conteúdo financeiro protegido</p></DashboardLayout></RootLayout>);

    expect(FinanceProvider).not.toHaveBeenCalled();
    expect(html).not.toContain('Conteúdo financeiro protegido');
  });
});
