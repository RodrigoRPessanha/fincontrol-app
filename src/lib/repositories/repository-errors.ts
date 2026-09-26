/**
 * Erros padronizados da camada de repositório do FinControl V38.
 * Convertem códigos PostgREST/PostgreSQL e falhas locais em erros tipados de domínio.
 */

export type RepositoryErrorCode =
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'VALIDATION_FAILED'
  | 'NETWORK_ERROR'
  | 'DATABASE_ERROR'
  | 'UNKNOWN';

export class RepositoryError extends Error {
  public readonly code: RepositoryErrorCode;
  public readonly originalError?: unknown;
  public readonly entity?: string;

  constructor(message: string, code: RepositoryErrorCode = 'UNKNOWN', originalError?: unknown, entity?: string) {
    super(message);
    this.name = 'RepositoryError';
    this.code = code;
    this.originalError = originalError;
    this.entity = entity;
    Object.setPrototypeOf(this, RepositoryError.prototype);
  }

  /**
   * Converte erros de PostgREST / Supabase em RepositoryError com código semântico.
   */
  public static fromPostgrestError(error: { code?: string; message: string; details?: string }, entity?: string): RepositoryError {
    const pgCode = error.code ?? '';
    let code: RepositoryErrorCode = 'DATABASE_ERROR';

    if (pgCode === 'PGRST116' || pgCode === '42P01') {
      code = 'NOT_FOUND';
    } else if (pgCode === '42501') {
      code = 'FORBIDDEN';
    } else if (pgCode === '23505') {
      code = 'CONFLICT';
    } else if (pgCode === '23514' || pgCode === '23502' || pgCode === '22P02') {
      code = 'VALIDATION_FAILED';
    }

    return new RepositoryError(error.message, code, error, entity);
  }
}
