'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { useOptionalAuth } from '@/lib/context/auth-context';
import { FinanceProvider, FinanceProviderProps } from '@/lib/context/finance-context';

function Session({ children, providerProps }: { children: React.ReactNode; providerProps?: Omit<FinanceProviderProps, 'children'> }) {
  const pathname = usePathname();
  const auth = useOptionalAuth();
  const financial = pathname !== null && !pathname.startsWith('/ajuda') && !pathname.startsWith('/auth');
  const [entered, setEntered] = useState(financial);
  if (financial && !entered) setEntered(true);
  const retain = entered && (auth?.dataMode === 'local' || !!auth?.user);
  const signedOutRemoteRoute = financial && auth?.dataMode === 'supabase' && !auth.isLoading && !auth.user;
  if (signedOutRemoteRoute) return null;
  return financial || retain ? <FinanceProvider {...providerProps}>{children}</FinanceProvider> : <>{children}</>;
}

export function FinanceSessionHost({ children, providerProps }: { children: React.ReactNode; providerProps?: Omit<FinanceProviderProps, 'children'> }) {
  const auth = useOptionalAuth();
  return <Session key={`${auth?.dataMode}:${auth?.user?.id ?? 'signed-out'}`} providerProps={providerProps}>{children}</Session>;
}
