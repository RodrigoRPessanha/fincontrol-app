import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET as handleCallback } from '../../app/auth/callback/route';
import { updateSession } from '../supabase/proxy';
import { NextRequest } from 'next/server';

// Mock cookies for server and callback
const mockSet = vi.fn();
const mockGetAll = vi.fn().mockReturnValue([{ name: 'sb-token', value: 'token-abc' }]);

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: () => mockGetAll(),
    set: (...args: unknown[]) => mockSet(...args),
  }),
}));

// Mock @supabase/ssr for controlled responses
const mockExchangeCode = vi.fn();
const mockGetUser = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: vi.fn(() => ({
    from: vi.fn(),
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
      signOut: vi.fn(),
    },
  })),
  createServerClient: vi.fn((_url, _key, options) => {
    // If setAll is called, simulate writing to response
    if (options?.cookies?.setAll) {
      options.cookies.setAll([{ name: 'sb-refreshed-session', value: 'refreshed-123', options: {} }]);
    }
    return {
      from: vi.fn(),
      auth: {
        exchangeCodeForSession: mockExchangeCode,
        getUser: mockGetUser,
      },
    };
  }),
}));

describe('Auth Flows & Security Redirections (Revisão Etapa 4)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.NEXT_PUBLIC_DATA_MODE = 'supabase';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test-project.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_pub_test_123';
    mockExchangeCode.mockReset();
    mockGetUser.mockReset();
    mockSet.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('Callback Route - Open Redirect Prevention & Recovery Flow', () => {
    it('redirects to / when next=@evil.example/path is passed (prevents open redirect)', async () => {
      mockExchangeCode.mockResolvedValue({ error: null });

      const req = new NextRequest('http://localhost:3000/auth/callback?code=valid-code&next=@evil.example/path');
      const res = await handleCallback(req);

      expect(res.status).toBe(307);
      const location = res.headers.get('location');
      expect(location).toBe('http://localhost:3000/');
    });

    it('redirects to / when next=//evil.example is passed (prevents protocol-relative redirect)', async () => {
      mockExchangeCode.mockResolvedValue({ error: null });

      const req = new NextRequest('http://localhost:3000/auth/callback?code=valid-code&next=//evil.example');
      const res = await handleCallback(req);

      expect(res.status).toBe(307);
      const location = res.headers.get('location');
      expect(location).toBe('http://localhost:3000/');
    });

    it('redirects to /auth/reset-password when type=recovery is passed in callback', async () => {
      mockExchangeCode.mockResolvedValue({ error: null });

      const req = new NextRequest('http://localhost:3000/auth/callback?code=valid-recovery-code&type=recovery');
      const res = await handleCallback(req);

      expect(res.status).toBe(307);
      const location = res.headers.get('location');
      expect(location).toBe('http://localhost:3000/auth/reset-password');
    });

    it('accepts safe internal paths like /dashboard or /accounts', async () => {
      mockExchangeCode.mockResolvedValue({ error: null });

      const req = new NextRequest('http://localhost:3000/auth/callback?code=valid-code&next=/dashboard');
      const res = await handleCallback(req);

      expect(res.status).toBe(307);
      const location = res.headers.get('location');
      expect(location).toBe('http://localhost:3000/dashboard');
    });

    it('redirects to /auth/login with error param when code is invalid or missing', async () => {
      mockExchangeCode.mockResolvedValue({ error: { message: 'Invalid code' } });

      const req = new NextRequest('http://localhost:3000/auth/callback?code=bad-code');
      const res = await handleCallback(req);

      expect(res.status).toBe(307);
      const location = res.headers.get('location');
      expect(location).toBe('http://localhost:3000/auth/login?error=auth_callback_failed');
    });
  });

  describe('Proxy - Refreshed Cookie Preservation & Auth Redirects', () => {
    it('preserves refreshed session cookies when returning a redirect response', async () => {
      // User is unauthenticated on protected route
      mockGetUser.mockResolvedValue({ data: { user: null } });

      const req = new NextRequest('http://localhost:3000/transactions');
      const res = await updateSession(req);

      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('/auth/login?redirectTo=%2Ftransactions');

      // Check that cookies written by setAll were copied to redirect response
      const setCookieHeader = res.headers.get('set-cookie');
      expect(setCookieHeader).toContain('sb-refreshed-session=refreshed-123');
    });

    it('redirects authenticated user from /auth/login to / preserving cookies', async () => {
      // User is authenticated
      mockGetUser.mockResolvedValue({ data: { user: { id: 'usr-real', email: 'test@example.com' } } });

      const req = new NextRequest('http://localhost:3000/auth/login');
      const res = await updateSession(req);

      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe('http://localhost:3000/');
      expect(res.headers.get('set-cookie')).toContain('sb-refreshed-session=refreshed-123');
    });

    it('allows authenticated user to access /auth/reset-password during recovery flow', async () => {
      // User is authenticated (e.g. via recovery code session)
      mockGetUser.mockResolvedValue({ data: { user: { id: 'usr-recovery', email: 'recovery@example.com' } } });

      const req = new NextRequest('http://localhost:3000/auth/reset-password');
      const res = await updateSession(req);

      // Should not redirect to /, should allow viewing reset-password page
      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
    });
  });
});
