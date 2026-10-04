import { describe, expect, it } from 'vitest';
import { getAuthErrorMessage } from '../auth-errors';

describe('getAuthErrorMessage', () => {
  it.each([
    'Failed to fetch',
    'TypeError: fetch failed',
    'NetworkError when attempting to fetch resource.',
    'Load failed',
    'net::ERR_CONNECTION_REFUSED',
  ])('maps network errors to a clear Portuguese message: %s', (message) => {
    expect(getAuthErrorMessage(new TypeError(message), 'Fallback')).toBe(
      'Não foi possível conectar ao serviço de autenticação. Verifique sua conexão e tente novamente.'
    );
  });

  it('preserves Supabase errors unrelated to connectivity', () => {
    expect(getAuthErrorMessage(new Error('Invalid login credentials'), 'Fallback')).toBe(
      'Invalid login credentials'
    );
  });

  it('uses the fallback when an unknown error has no message', () => {
    expect(getAuthErrorMessage(null, 'Fallback')).toBe('Fallback');
    expect(getAuthErrorMessage({ code: 'UNKNOWN' }, 'Fallback')).toBe('Fallback');
  });
});
