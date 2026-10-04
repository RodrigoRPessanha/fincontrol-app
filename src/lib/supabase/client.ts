import { createBrowserClient } from '@supabase/ssr';
import { createClient as createScopedClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

interface SessionScope { userId?: string; assertCurrent: () => void }
export function createClient(scope: SessionScope): ReturnType<typeof createScopedClient<Database>> | null;
export function createClient(): ReturnType<typeof createBrowserClient<Database>> | null;
export function createClient(scope?: SessionScope) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '';

  if (!supabaseUrl || !supabaseKey) {
    // Retorna cliente dummy quando não configurado
    return null;
  }

  const authClient = createBrowserClient<Database>(supabaseUrl, supabaseKey);
  if (!scope) return authClient;
  if (!scope.userId) return null;
  const assertCurrent = () => {
    try { scope.assertCurrent(); }
    catch (error) {
      throw new DOMException(error instanceof Error ? error.message : 'Sessão alterada.', 'AbortError');
    }
  };
  // O repository não usa Auth: obtém apenas o token da identidade que o originou.
  return createScopedClient<Database>(supabaseUrl, supabaseKey, {
    accessToken: async () => {
      assertCurrent();
      const { data, error } = await authClient.auth.getSession();
      assertCurrent();
      if (error || !data.session || data.session.user.id !== scope.userId) {
        throw new DOMException('Sessão financeira não corresponde à identidade ativa.', 'AbortError');
      }
      // Vincula também o token, sem confiar somente no user armazenado pelo SDK.
      // A assinatura/autorização continuam sendo validadas pelo Supabase no servidor.
      let principal: unknown;
      try {
        const payload = data.session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        principal = JSON.parse(atob(payload)).sub;
      } catch {
        throw new DOMException('Token financeiro inválido.', 'AbortError');
      }
      if (principal !== scope.userId) {
        throw new DOMException('Token financeiro não corresponde à identidade ativa.', 'AbortError');
      }
      return data.session.access_token;
    },
    global: {
      fetch: async (input, init) => {
        assertCurrent();
        return fetch(input, init);
      },
    },
  });
}
