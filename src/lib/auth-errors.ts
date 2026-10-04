const NETWORK_ERROR_PATTERN =
  /failed to fetch|fetch failed|networkerror|network request failed|load failed|connection refused|err_connection_[a-z_]+/i;

const NETWORK_ERROR_MESSAGE =
  'Não foi possível conectar ao serviço de autenticação. Verifique sua conexão e tente novamente.';

function getErrorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = error.message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }
  return null;
}

export function getAuthErrorMessage(error: unknown, fallback: string): string {
  const message = getErrorMessage(error);
  if (!message) return fallback;
  if (NETWORK_ERROR_PATTERN.test(message)) return NETWORK_ERROR_MESSAGE;
  return message;
}
