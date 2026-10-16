import type { ApiError } from '@clinica/contracts';
import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { AppError } from '../core/errors.js';

export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((_request, reply) => {
    const body: ApiError = { error: { code: 'not_found', message: 'Recurso não encontrado.' } };
    return reply.status(404).send(body);
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      const body: ApiError = {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      };
      return reply.status(error.statusCode).send(body);
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      const body: ApiError = {
        error: {
          code: 'validation_failed',
          message: 'Verifique os campos informados.',
          details: error.validation.map((v) => ({
            path: v.instancePath.replace(/^\//, '').replaceAll('/', '.'),
            message: v.message ?? 'Valor inválido',
          })),
        },
      };
      return reply.status(400).send(body);
    }
    if (error.statusCode === 429) {
      const body: ApiError = {
        error: { code: 'rate_limited', message: 'Muitas tentativas. Aguarde um minuto.' },
      };
      return reply.status(429).send(body);
    }
    if (error.statusCode === 413) {
      const body: ApiError = {
        error: { code: 'validation_failed', message: 'O arquivo passa do tamanho máximo de 8 MB.' },
      };
      return reply.status(413).send(body);
    }
    if (error.statusCode === 415) {
      const body: ApiError = {
        error: { code: 'validation_failed', message: 'Formato de arquivo não aceito.' },
      };
      return reply.status(415).send(body);
    }
    if (error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500) {
      const body: ApiError = {
        error: { code: 'validation_failed', message: 'Requisição inválida.' },
      };
      return reply.status(error.statusCode).send(body);
    }
    request.log.error({ err: error }, 'erro não tratado');
    const body: ApiError = {
      error: { code: 'internal', message: 'Erro interno. Tente novamente.' },
    };
    return reply.status(500).send(body);
  });
}
