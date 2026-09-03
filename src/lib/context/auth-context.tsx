'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { UserProfile } from '../types';
import { mockCurrentUser } from '../mock-data';

interface AuthContextType {
  user: UserProfile | null;
  isLoading: boolean;
  login: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (data: Partial<UserProfile>) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(mockCurrentUser);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  useEffect(() => {
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
  }, []);

  const login = async (email: string) => {
    setIsLoading(true);
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
  };

  const logout = async () => {
    setUser(null);
    localStorage.removeItem('fincontrol_user');
  };

  const updateProfile = (data: Partial<UserProfile>) => {
    if (!user) return;
    const updated = { ...user, ...data };
    setUser(updated);
    localStorage.setItem('fincontrol_user', JSON.stringify(updated));
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, updateProfile }}>
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
