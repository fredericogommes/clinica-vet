import { apiErrorSchema, type ErrorCode } from '@clinica/contracts';
import type { z } from 'zod';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'network',
    message: string,
    readonly fieldErrors: { path: string; message: string }[] = [],
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

let csrfToken: string | undefined;
let portalCsrfToken: string | undefined;

/** Definido pela sessão carregada; enviado em toda requisição que altera dados. */
export function setCsrfToken(token: string | undefined): void {
  csrfToken = token;
}

/** Token da sessão do portal do tutor, guardado à parte do token da equipe. */
export function setPortalCsrfToken(token: string | undefined): void {
  portalCsrfToken = token;
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

async function request(
  method: Method,
  path: string,
  body?: unknown,
  token = csrfToken,
): Promise<Response> {
  const headers: Record<string, string> = {};
  // Arquivos vão crus, com o tipo do próprio arquivo; o resto vai como JSON.
  const file = body instanceof Blob ? body : null;
  if (file) headers['content-type'] = file.type;
  else if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && token) headers['x-csrf-token'] = token;
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      ...(file ? { body: file } : body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiRequestError(
      0,
      'network',
      'Sem conexão com o servidor. Verifique a rede e tente de novo.',
    );
  }
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      throw new ApiRequestError(response.status, code, message, details);
    }
    throw new ApiRequestError(response.status, 'internal', 'Erro inesperado do servidor.');
  }
  return response;
}

/** Requisição com resposta validada pelo contrato compartilhado com a API. */
export async function api<T extends z.ZodType>(
  method: Method,
  path: string,
  schema: T,
  body?: unknown,
): Promise<z.infer<T>> {
  const response = await request(method, path, body);
  return schema.parse(await response.json());
}

export async function apiVoid(method: Method, path: string, body?: unknown): Promise<void> {
  await request(method, path, body);
}

/** Requisição do portal do tutor: caminho relativo a /api/portal e CSRF da sessão do portal. */
export async function portalApi<T extends z.ZodType>(
  method: Method,
  path: string,
  schema: T,
  body?: unknown,
): Promise<z.infer<T>> {
  const response = await request(method, `/portal${path}`, body, portalCsrfToken);
  return schema.parse(await response.json());
}

export async function portalApiVoid(method: Method, path: string, body?: unknown): Promise<void> {
  await request(method, `/portal${path}`, body, portalCsrfToken);
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : 'Algo deu errado. Tente novamente.';
}
