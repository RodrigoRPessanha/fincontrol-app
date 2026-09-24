'use client';

import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { UserProfile } from '../types';
import { mockCurrentUser } from '../mock-data';
import { createClient } from '../supabase/client';
import type { User } from '@supabase/supabase-js';

export interface AuthContextType {
  user: UserProfile | null;
  isLoading: boolean;
  login: (email: string, password?: string) => Promise<void>;
  signUp: (email: string, password: string, name?: string) => Promise<{ error: Error | null; user: UserProfile | null }>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
  updatePassword: (password: string) => Promise<{ error: Error | null }>;
  logout: () => Promise<void>;
  updateProfile: (data: Partial<UserProfile>) => void;
  dataMode: 'local' | 'supabase';
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function mapSupabaseUser(sbUser: User): UserProfile {
  return {
    id: sbUser.id,
    name:
      sbUser.user_metadata?.name ||
      sbUser.user_metadata?.full_name ||
      (sbUser.email ? sbUser.email.split('@')[0] : 'Usuário'),
    email: sbUser.email || '',
    avatar_url: sbUser.user_metadata?.avatar_url,
    created_at: sbUser.created_at,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const dataMode = useMemo<'local' | 'supabase'>(() => {
    return process.env.NEXT_PUBLIC_DATA_MODE === 'supabase' ? 'supabase' : 'local';
  }, []);

  const [user, setUser] = useState<UserProfile | null>(() => {
    return dataMode === 'local' ? mockCurrentUser : null;
  });
  const [isLoading, setIsLoading] = useState<boolean>(() => {
    if (dataMode === 'local') return false;
    return !!createClient();
  });

  useEffect(() => {
    if (dataMode === 'local') {
      const timer = setTimeout(() => {
        try {
          const savedUser = localStorage.getItem('fincontrol_user');
          if (savedUser) {
            const parsed = JSON.parse(savedUser);
            setUser((prev) => (JSON.stringify(prev) !== JSON.stringify(parsed) ? parsed : prev));
          }
        } catch {
          // Keep default
        }
      }, 0);
      return () => clearTimeout(timer);
    }

    // Modo Supabase
    const supabase = createClient();
    if (!supabase) {
      return;
    }

    let isMounted = true;

    async function initSession() {
      try {
        const { data: { session }, error } = await supabase!.auth.getSession();
        if (error) {
          console.error('Erro ao recuperar sessão Supabase:', error.message);
        }
        if (isMounted) {
          if (session?.user) {
            setUser(mapSupabaseUser(session.user));
          } else {
            setUser(null);
          }
          setIsLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          console.error('Falha na inicialização da sessão:', err);
          setIsLoading(false);
        }
      }
    }

    initSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (isMounted) {
        if (session?.user) {
          setUser(mapSupabaseUser(session.user));
        } else {
          setUser(null);
        }
        setIsLoading(false);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [dataMode]);

  const login = async (email: string, password?: string) => {
    setIsLoading(true);

    if (dataMode === 'local') {
      const u: UserProfile = {
        id: 'usr-1',
        name: email.split('@')[0],
        email,
        avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
        created_at: new Date().toISOString(),
      };
      setUser(u);
      localStorage.setItem('fincontrol_user', JSON.stringify(u));
      setIsLoading(false);
      return;
    }

    const supabase = createClient();
    if (!supabase) {
      setIsLoading(false);
      throw new Error('Supabase client não está inicializado.');
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: password || '',
    });

    if (error) {
      setIsLoading(false);
      throw error;
    }

    if (data.user) {
      setUser(mapSupabaseUser(data.user));
    }
    setIsLoading(false);
  };

  const signUp = async (
    email: string,
    password: string,
    name?: string
  ): Promise<{ error: Error | null; user: UserProfile | null }> => {
    setIsLoading(true);

    if (dataMode === 'local') {
      const u: UserProfile = {
        id: 'usr-1',
        name: name || email.split('@')[0],
        email,
        avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
        created_at: new Date().toISOString(),
      };
      setUser(u);
      localStorage.setItem('fincontrol_user', JSON.stringify(u));
      setIsLoading(false);
      return { error: null, user: u };
    }

    const supabase = createClient();
    if (!supabase) {
      setIsLoading(false);
      return { error: new Error('Supabase client não configurado'), user: null };
    }

    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ||
      (typeof window !== 'undefined' && window.location ? window.location.origin : 'http://localhost:3000');
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name: name || email.split('@')[0],
        },
        emailRedirectTo: `${siteUrl}/auth/callback`,
      },
    });

    setIsLoading(false);

    if (error) {
      return { error, user: null };
    }

    const mappedUser = data.user ? mapSupabaseUser(data.user) : null;
    return { error: null, user: mappedUser };
  };

  const resetPassword = async (email: string): Promise<{ error: Error | null }> => {
    if (dataMode === 'local') {
      return { error: null };
    }

    const supabase = createClient();
    if (!supabase) {
      return { error: new Error('Supabase client não configurado') };
    }

    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ||
      (typeof window !== 'undefined' && window.location ? window.location.origin : 'http://localhost:3000');
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl}/auth/callback?type=recovery`,
    });

    return { error: error ? new Error(error.message) : null };
  };

  const updatePassword = async (password: string): Promise<{ error: Error | null }> => {
    setIsLoading(true);
    if (dataMode === 'local') {
      setIsLoading(false);
      return { error: null };
    }

    const supabase = createClient();
    if (!supabase) {
      setIsLoading(false);
      return { error: new Error('Supabase client não configurado') };
    }

    const { error } = await supabase.auth.updateUser({ password });
    setIsLoading(false);
    return { error: error ? new Error(error.message) : null };
  };

  const logout = async () => {
    setIsLoading(true);
    if (dataMode === 'local') {
      setUser(null);
      localStorage.removeItem('fincontrol_user');
      setIsLoading(false);
      return;
    }

    const supabase = createClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    setUser(null);
    setIsLoading(false);
  };

  const updateProfile = (data: Partial<UserProfile>) => {
    if (!user) return;
    const updated = { ...user, ...data };
    setUser(updated);

    if (dataMode === 'local') {
      localStorage.setItem('fincontrol_user', JSON.stringify(updated));
    } else {
      const supabase = createClient();
      if (supabase) {
        supabase.auth.updateUser({
          data: {
            name: updated.name,
            avatar_url: updated.avatar_url,
          },
        }).catch((err) => {
          console.error('Erro ao atualizar perfil no Supabase:', err);
        });
      }
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        login,
        signUp,
        resetPassword,
        updatePassword,
        logout,
        updateProfile,
        dataMode,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser usado dentro de um AuthProvider');
  }
  return context;
}
