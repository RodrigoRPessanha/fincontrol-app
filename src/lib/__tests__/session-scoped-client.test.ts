import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '../supabase/client';

const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@supabase/ssr', () => ({ createBrowserClient: () => ({ auth }) }));
const token = (sub: string) => `fixture.${btoa(JSON.stringify({ sub }))}.fixture`;

describe('Cliente financeiro vinculado à identidade', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fixture.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_fixture';
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'a' }, access_token: token('a') } }, error: null });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { headers: { 'content-type': 'application/json' } })));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { process.env = { ...originalEnv }; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('envia apenas o token da identidade esperada', async () => {
    const client = createClient({ userId: 'a', assertCurrent: () => {} })!;
    const result = await client.from('accounts').select('id');
    expect(result.error).toBeNull();
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls).toHaveLength(1);
    expect(new Headers(calls[0][1]?.headers).get('authorization')).toBe(`Bearer ${token('a')}`);
  });

  it('não envia uma requisição de A com token de B mesmo antes da atualização React', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'b' }, access_token: token('b') } }, error: null });
    const client = createClient({ userId: 'a', assertCurrent: () => {} })!;
    const result = await client.from('accounts').select('id');
    expect(result.error?.message).toMatch(/identidade ativa/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('interrompe I/O se a sessão mudar durante a leitura assíncrona do token', async () => {
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => { finish = resolve; });
    auth.getSession.mockReturnValue(pending);
    let current = true;
    const client = createClient({ userId: 'a', assertCurrent: () => { if (!current) throw new Error('Sessão alterada'); } })!;
    const request = Promise.resolve(client.from('accounts').select('id'));
    await Promise.resolve();
    current = false;
    finish({ data: { session: { user: { id: 'a' }, access_token: token('a') } }, error: null });
    const result = await request;
    expect(result.error?.message).toMatch(/Sessão alterada/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([token('b'), 'malformed'])('não aceita token %s junto de metadados user A', async (accessToken) => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'a' }, access_token: accessToken } }, error: null });
    const client = createClient({ userId: 'a', assertCurrent: () => {} })!;
    const result = await client.from('accounts').select('id');
    expect(result.error?.message).toMatch(/Token financeiro/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
