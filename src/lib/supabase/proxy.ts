import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from './database.types';
import { getSafeRedirectPath } from '@/lib/utils';

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const dataMode = process.env.NEXT_PUBLIC_DATA_MODE || 'local';

  // Se em modo local, permite navegação livre mantendo baseline síncrona
  if (dataMode === 'local') {
    return supabaseResponse;
  }

  // Em modo Supabase, falha fechado caso a configuração esteja ausente
  if (!supabaseUrl || !supabaseKey) {
    return new NextResponse(
      'Configuração do Supabase ausente. Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY para operar em DATA_MODE=supabase.',
      {
        status: 500,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
        },
      }
    );
  }

  const supabase = createServerClient<Database>(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // Atualiza ou recupera a sessão do usuário
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isAuthRoute = pathname.startsWith('/auth');

  // Helper para preservar cookies renovados durante redirecionamentos
  const createRedirectWithCookies = (url: URL): NextResponse => {
    const redirectResponse = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie.name, cookie.value, cookie);
    });
    return redirectResponse;
  };

  // Rotas protegidas exigem usuário logado em modo supabase
  if (!user && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/login';
    url.searchParams.set('redirectTo', getSafeRedirectPath(pathname, '/'));
    return createRedirectWithCookies(url);
  }

  // Usuário não autenticado tentando acessar diretamente reset-password sem sessão de recovery
  if (!user && pathname === '/auth/reset-password') {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/forgot-password';
    return createRedirectWithCookies(url);
  }

  // Se usuário autenticado tentar acessar páginas de auth (exceto callback e reset-password durante recuperação)
  if (user && isAuthRoute && pathname !== '/auth/callback' && pathname !== '/auth/reset-password') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return createRedirectWithCookies(url);
  }

  return supabaseResponse;
}
