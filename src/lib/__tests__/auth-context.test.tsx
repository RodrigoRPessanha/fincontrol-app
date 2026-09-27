import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth, AuthContextType } from '../context/auth-context';

// Mock Supabase client
const mockSignInWithPassword = vi.fn();
const mockSignUp = vi.fn();
const mockResetPasswordForEmail = vi.fn();
const mockUpdateUser = vi.fn();
const mockSignOut = vi.fn();
const mockGetSession = vi.fn();
const mockUnsubscribe = vi.fn();
let authStateCallback: ((event: string, session: unknown) => void) | null = null;

vi.mock('../supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      onAuthStateChange: vi.fn((cb) => {
        authStateCallback = cb;
        return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
      }),
      signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
      signUp: (...args: unknown[]) => mockSignUp(...args),
      resetPasswordForEmail: (...args: unknown[]) => mockResetPasswordForEmail(...args),
      updateUser: (...args: unknown[]) => mockUpdateUser(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
    },
  })),
}));

// Setup DOM mock for React createRoot in Node.js test environment
function setupAuthHarness() {
  class MockNode {
    nodeType = 1;
    childNodes: any[] = [];
    parentNode: any = null;
    ownerDocument: any = null;
    appendChild(child: any) { child.parentNode = this; this.childNodes.push(child); return child; }
    removeChild(child: any) { const idx = this.childNodes.indexOf(child); if (idx >= 0) this.childNodes.splice(idx, 1); child.parentNode = null; return child; }
    insertBefore(child: any, ref: any) { const idx = this.childNodes.indexOf(ref); if (idx >= 0) this.childNodes.splice(idx, 0, child); else this.appendChild(child); return child; }
  }

  class MockElement extends MockNode {
    tagName = 'DIV';
    style = {};
    setAttribute() {}
    removeAttribute() {}
    addEventListener() {}
    removeEventListener() {}
  }

  const doc: any = new MockNode();
  doc.nodeType = 9;
  doc.defaultView = globalThis;
  doc.activeElement = null;
  doc.createElement = (tag: string) => {
    const el = new MockElement();
    el.tagName = tag.toUpperCase();
    el.ownerDocument = doc;
    return el;
  };
  doc.createElementNS = (_ns: string, tag: string) => doc.createElement(tag);
  doc.createTextNode = (val: string) => { const n: any = new MockNode(); n.nodeType = 3; n.nodeValue = val; n.ownerDocument = doc; return n; };
  doc.createComment = (val: string) => { const n: any = new MockNode(); n.nodeType = 8; n.nodeValue = val; n.ownerDocument = doc; return n; };
  doc.documentElement = doc.createElement('html');
  doc.head = doc.createElement('head');
  doc.body = doc.createElement('body');
  doc.addEventListener = () => {};
  doc.removeEventListener = () => {};

  (globalThis as any).document = doc;
  (globalThis as any).window = globalThis;
  (globalThis as any).HTMLIFrameElement = class {};

  const storage = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, String(v)),
    removeItem: (k: string) => storage.delete(k),
    clear: () => storage.clear(),
  };

  const mountAuth = async () => {
    let currentCtx!: AuthContextType;
    function Consumer() {
      currentCtx = useAuth();
      return null;
    }

    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AuthProvider>
          <Consumer />
        </AuthProvider>
      );
    });

    return {
      getCtx: () => currentCtx,
      root,
      container,
    };
  };

  return { storage, mountAuth };
}

describe('AuthContext - Complete Authentication Flows', () => {
  const originalEnv = process.env;
  const { storage, mountAuth } = setupAuthHarness();

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    storage.clear();
    mockSignInWithPassword.mockReset();
    mockSignUp.mockReset();
    mockResetPasswordForEmail.mockReset();
    mockUpdateUser.mockReset();
    mockSignOut.mockReset();
    mockGetSession.mockReset();
    authStateCallback = null;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('Local Mode (NEXT_PUBLIC_DATA_MODE=local)', () => {
    it('initializes with default mock user and loads saved profile from localStorage', async () => {
      storage.set(
        'fincontrol_user',
        JSON.stringify({ id: 'usr-saved', name: 'Saved User', email: 'saved@test.com' })
      );

      const { getCtx } = await mountAuth();

      expect(getCtx().dataMode).toBe('local');
      expect(getCtx().user).not.toBeNull();

      // Aguarda tick de timer para hidratar usuário do localStorage
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });

      expect(getCtx().user?.id).toBe('usr-saved');
    });

    it('performs local login and saves to localStorage', async () => {
      const { getCtx } = await mountAuth();

      await act(async () => {
        await getCtx().login('novo@fincontrol.com');
      });

      expect(getCtx().user?.email).toBe('novo@fincontrol.com');
      expect(getCtx().user?.id).toBe('usr-1');
      expect(storage.get('fincontrol_user')).toContain('novo@fincontrol.com');
    });

    it('performs local logout and clears localStorage', async () => {
      const { getCtx } = await mountAuth();

      await act(async () => {
        await getCtx().logout();
      });

      expect(getCtx().user).toBeNull();
      expect(storage.has('fincontrol_user')).toBe(false);
    });

    it('updates local profile and syncs to localStorage', async () => {
      const { getCtx } = await mountAuth();

      act(() => {
        getCtx().updateProfile({ name: 'Nome Atualizado' });
      });

      expect(getCtx().user?.name).toBe('Nome Atualizado');
      expect(storage.get('fincontrol_user')).toContain('Nome Atualizado');
    });

    it('handles signUp, resetPassword, and updatePassword locally without errors', async () => {
      const { getCtx } = await mountAuth();

      let signUpRes: any;
      let resetRes: any;
      let updatePassRes: any;

      await act(async () => {
        signUpRes = await getCtx().signUp('local@test.com', 'password123', 'Local User');
        resetRes = await getCtx().resetPassword('local@test.com');
        updatePassRes = await getCtx().updatePassword('newPassword123');
      });

      expect(signUpRes.error).toBeNull();
      expect(signUpRes.user.email).toBe('local@test.com');
      expect(resetRes.error).toBeNull();
      expect(updatePassRes.error).toBeNull();
    });
  });

  describe('Supabase Mode (NEXT_PUBLIC_DATA_MODE=supabase)', () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_DATA_MODE = 'supabase';
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test-project.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_pub_test_123';
      mockGetSession.mockResolvedValue({
        data: {
          session: {
            user: {
              id: 'usr-supabase-1',
              email: 'sb@test.com',
              user_metadata: { name: 'Supabase User' },
              created_at: '2026-09-23T20:00:00Z',
            },
          },
        },
        error: null,
      });
    });

    it('hydrates user from Supabase getSession and responds to onAuthStateChange', async () => {
      const { getCtx } = await mountAuth();

      expect(getCtx().dataMode).toBe('supabase');

      await act(async () => {
        await Promise.resolve();
      });

      expect(getCtx().user?.id).toBe('usr-supabase-1');
      expect(getCtx().user?.name).toBe('Supabase User');

      // Dispara mudança de estado para deslogado
      await act(async () => {
        if (authStateCallback) {
          authStateCallback('SIGNED_OUT', null);
        }
      });

      expect(getCtx().user).toBeNull();
    });

    it('performs login via signInWithPassword and updates user state', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: {
          user: {
            id: 'usr-logged',
            email: 'logged@test.com',
            user_metadata: { name: 'Logged User' },
            created_at: '2026-09-23T20:00:00Z',
          },
        },
        error: null,
      });

      const { getCtx } = await mountAuth();

      await act(async () => {
        await getCtx().login('logged@test.com', 'mypassword');
      });

      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: 'logged@test.com',
        password: 'mypassword',
      });
      expect(getCtx().user?.id).toBe('usr-logged');
    });

    it('throws error when signInWithPassword fails', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: { user: null },
        error: new Error('Invalid login credentials'),
      });

      const { getCtx } = await mountAuth();

      await expect(
        act(async () => {
          await getCtx().login('logged@test.com', 'wrong');
        })
      ).rejects.toThrow('Invalid login credentials');
    });

    it('calls signUp with emailRedirectTo to callback', async () => {
      mockSignUp.mockResolvedValue({
        data: {
          user: {
            id: 'usr-new',
            email: 'newuser@test.com',
            user_metadata: { name: 'New User' },
            created_at: '2026-09-23T20:00:00Z',
          },
        },
        error: null,
      });

      const { getCtx } = await mountAuth();

      let res: any;
      await act(async () => {
        res = await getCtx().signUp('newuser@test.com', 'securepass123', 'New User');
      });

      expect(mockSignUp).toHaveBeenCalledWith({
        email: 'newuser@test.com',
        password: 'securepass123',
        options: {
          data: { name: 'New User' },
          emailRedirectTo: expect.stringContaining('/auth/callback'),
        },
      });
      expect(res.error).toBeNull();
      expect(res.user).not.toBeNull();
    });

    it('calls resetPassword with redirectTo pointing to callback?type=recovery', async () => {
      mockResetPasswordForEmail.mockResolvedValue({ data: {}, error: null });

      const { getCtx } = await mountAuth();

      let res: any;
      await act(async () => {
        res = await getCtx().resetPassword('forgot@test.com');
      });

      expect(mockResetPasswordForEmail).toHaveBeenCalledWith('forgot@test.com', {
        redirectTo: expect.stringContaining('/auth/callback?type=recovery'),
      });
      expect(res.error).toBeNull();
    });

    it('calls updatePassword via updateUser to complete password recovery flow', async () => {
      mockUpdateUser.mockResolvedValue({ data: {}, error: null });

      const { getCtx } = await mountAuth();

      let res: any;
      await act(async () => {
        res = await getCtx().updatePassword('brandNewPassword999');
      });

      expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'brandNewPassword999' });
      expect(res.error).toBeNull();
    });

    it('calls signOut on logout', async () => {
      mockSignOut.mockResolvedValue({ error: null });

      const { getCtx } = await mountAuth();

      await act(async () => {
        await getCtx().logout();
      });

      expect(mockSignOut).toHaveBeenCalled();
      expect(getCtx().user).toBeNull();
    });
  });

  describe('useAuth outside provider', () => {
    it('throws error when useAuth is called without AuthProvider', async () => {
      let caughtError: Error | null = null;
      class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
        state = { hasError: false };
        static getDerivedStateFromError(error: Error) {
          caughtError = error;
          return { hasError: true };
        }
        render() {
          if (this.state.hasError) return null;
          return this.props.children;
        }
      }

      function OrphanConsumer() {
        useAuth();
        return null;
      }

      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);

      await act(async () => {
        root.render(
          <ErrorBoundary>
            <OrphanConsumer />
          </ErrorBoundary>
        );
      });

      expect(caughtError).not.toBeNull();
      expect((caughtError as any)?.message).toContain('useAuth deve ser usado dentro de um AuthProvider');
    });
  });
});
