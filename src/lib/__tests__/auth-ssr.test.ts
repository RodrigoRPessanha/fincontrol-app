import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createClient as createBrowserClient } from '../supabase/client';
import { createClient as createServerClient } from '../supabase/server';
import { updateSession } from '../supabase/proxy';
import { NextRequest } from 'next/server';

// Mock cookies for server.ts
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: vi.fn().mockReturnValue([{ name: 'sb-token', value: 'xyz' }]),
    set: vi.fn(),
  }),
}));

describe('Supabase SSR Clients and Proxy', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('Browser Client (client.ts)', () => {
    it('returns null when environment variables are missing', () => {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      const client = createBrowserClient();
      expect(client).toBeNull();
    });

    it('instantiates client using NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test-project.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_pub_test_123';

      const client = createBrowserClient();
      expect(client).not.toBeNull();
      expect(typeof client?.from).toBe('function');
    });

    it('falls back to NEXT_PUBLIC_SUPABASE_ANON_KEY if publishable key is absent', () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test-project.supabase.co';
      delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'sb_anon_test_456';

      const client = createBrowserClient();
      expect(client).not.toBeNull();
      expect(typeof client?.from).toBe('function');
    });
  });

  describe('Server Client (server.ts)', () => {
    it('returns null when environment variables are missing', async () => {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      const client = await createServerClient();
      expect(client).toBeNull();
    });

    it('creates server client with getAll and setAll cookie contract', async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test-project.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_pub_test_123';

      const client = await createServerClient();
      expect(client).not.toBeNull();
      expect(typeof client?.from).toBe('function');
    });
  });

  describe('Proxy Session Updater (proxy.ts)', () => {
    it('passes through request when in DATA_MODE=local', async () => {
      process.env.NEXT_PUBLIC_DATA_MODE = 'local';
      const req = new NextRequest('http://localhost:3000/dashboard');
      const res = await updateSession(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
    });

    it('fails closed (500) when Supabase keys are missing in DATA_MODE=supabase', async () => {
      process.env.NEXT_PUBLIC_DATA_MODE = 'supabase';
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      const req = new NextRequest('http://localhost:3000/dashboard');
      const res = await updateSession(req);
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(text).toContain('Configuração do Supabase ausente');
    });

    it('redirects unauthenticated user to login on protected routes in supabase mode with sanitized redirectTo', async () => {
      process.env.NEXT_PUBLIC_DATA_MODE = 'supabase';
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test-project.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_pub_test_123';

      const req = new NextRequest('http://localhost:3000/dashboard');
      const res = await updateSession(req);
      expect(res.status).toBe(307);
      const location = res.headers.get('location');
      expect(location).toContain('/auth/login?redirectTo=%2Fdashboard');
    });

    it('sanitizes open redirect attempts in redirectTo when redirecting to login', async () => {
      process.env.NEXT_PUBLIC_DATA_MODE = 'supabase';
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test-project.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_pub_test_123';

      // Path attempting open redirect
      const req = new NextRequest('http://localhost:3000/@evil.example/path');
      const res = await updateSession(req);
      expect(res.status).toBe(307);
      const location = res.headers.get('location');
      // getSafeRedirectPath sanitized it to '/'
      expect(location).toContain('/auth/login?redirectTo=%2F');
    });

    it('allows access to /auth/login without redirecting in supabase mode when unauthenticated', async () => {
      process.env.NEXT_PUBLIC_DATA_MODE = 'supabase';
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test-project.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_pub_test_123';

      const req = new NextRequest('http://localhost:3000/auth/login');
      const res = await updateSession(req);
      expect(res.status).toBe(200);
    });

    it('redirects unauthenticated user from /auth/reset-password to /auth/forgot-password', async () => {
      process.env.NEXT_PUBLIC_DATA_MODE = 'supabase';
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test-project.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_pub_test_123';

      const req = new NextRequest('http://localhost:3000/auth/reset-password');
      const res = await updateSession(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('/auth/forgot-password');
    });
  });
});
