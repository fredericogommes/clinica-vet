import type { ErrorCode } from '@clinica/contracts';

const statusByCode: Record<ErrorCode, number> = {
  validation_failed: 400,
  unauthenticated: 401,
  csrf_invalid: 403,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  internal: 500,
};

/** Falha esperada de negócio. Erros fora desta classe viram `internal` sem expor detalhes. */
export class AppError extends Error {
  readonly statusCode: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusByCode[code];
  }
}

export const notFound = (what: string) => new AppError('not_found', `${what} não encontrado.`);
export const forbidden = () =>
  new AppError('forbidden', 'Você não tem permissão para executar esta ação.');
export const conflict = (message: string) => new AppError('conflict', message);
