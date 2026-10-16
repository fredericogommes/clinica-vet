import type { Permission } from '@clinica/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { AppError, forbidden } from '../core/errors.js';
import { tokensMatch, type AuthContext, type SessionService } from '../modules/auth/sessions.js';

/** Toda rota declara seu nível de acesso; rota sem declaração impede a aplicação de subir. */
export type RouteAccess =
  { kind: 'public' } | { kind: 'authenticated' } | { kind: 'permission'; permission: Permission };

declare module 'fastify' {
  interface FastifyContextConfig {
    access?: RouteAccess;
  }
  interface FastifyRequest {
    authContext: AuthContext | null;
  }
}

export const SESSION_COOKIE = 'sid';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.authContext) throw new AppError('unauthenticated', 'Faça login para continuar.');
  return request.authContext;
}

export const accessGuard = fp(
  async (app: FastifyInstance, opts: { sessions: SessionService }) => {
    app.decorateRequest('authContext', null);

    app.addHook('onRoute', (route) => {
      if (!route.config?.access && !route.url.startsWith('/api/docs')) {
        throw new Error(`Rota ${route.method.toString()} ${route.url} sem declaração de acesso.`);
      }
    });

    app.addHook('preValidation', async (request) => {
      const access = request.routeOptions.config.access;
      if (!access || access.kind === 'public') return;

      const token = request.cookies[SESSION_COOKIE];
      const auth = token ? await opts.sessions.authenticate(token) : null;
      if (!auth) throw new AppError('unauthenticated', 'Faça login para continuar.');

      if (!SAFE_METHODS.has(request.method)) {
        const header = request.headers['x-csrf-token'];
        if (!tokensMatch(auth.csrfToken, typeof header === 'string' ? header : undefined)) {
          throw new AppError('csrf_invalid', 'Sessão desatualizada. Recarregue a página.');
        }
      }
      if (access.kind === 'permission' && !auth.permissions.has(access.permission)) {
        throw forbidden();
      }
      request.authContext = auth;
    });
  },
  { name: 'access-guard' },
);
