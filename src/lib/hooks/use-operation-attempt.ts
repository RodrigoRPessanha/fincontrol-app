'use client';

import { useRef } from 'react';
import { useOptionalAuth } from '../context/auth-context';

/** Retains the same intention through an error/remount; a successful later action gets a new key. */
export function useOperationAttempt(workspaceId: string, kind: string) {
  const auth = useOptionalAuth();
  const memory = useRef<{ signature: string; key: string } | null>(null);
  const slot = `fincontrol_attempt:${auth?.user?.id ?? 'local'}:${workspaceId}:${kind}`;
  const getKey = async (payload: unknown): Promise<string> => {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
    const signature = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const storage = typeof window !== 'undefined' ? window.sessionStorage : undefined;
    const saved = storage?.getItem(slot);
    const previous = saved ? JSON.parse(saved) as { signature: string; key: string } : memory.current;
    const attempt = previous?.signature === signature ? previous : { signature, key: crypto.randomUUID() };
    // Failure is visible to the form before sending a mutation without retry protection.
    storage?.setItem(slot, JSON.stringify(attempt));
    memory.current = attempt;
    return attempt.key;
  };
  const complete = () => {
    if (typeof window !== 'undefined') window.sessionStorage?.removeItem(slot);
    memory.current = null;
  };
  return { getKey, complete };
}
