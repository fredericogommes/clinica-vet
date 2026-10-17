import type { Permission } from '@clinica/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { AppError, forbidden } from '../core/errors.js';
import { tokensMatch, type AuthContext, type SessionService } from '../modules/auth/sessions.js';
import type { PortalContext, PortalSessionService } from '../modules/portal/sessions.js';

/**
 * Toda rota declara seu nível de acesso; rota sem declaração impede a aplicação de subir.
 * `portal` é a sessão do tutor, que não abre nenhuma rota da equipe.
 */
export type RouteAccess =
  | { kind: 'public' }
  | { kind: 'authenticated' }
  | { kind: 'permission'; permission: Permission }
  | { kind: 'portal' };

declare module 'fastify' {
  interface FastifyContextConfig {
    access?: RouteAccess;
  }
  interface FastifyRequest {
    authContext: AuthContext | null;
    portalContext: PortalContext | null;
  }
}

export const SESSION_COOKIE = 'sid';
/** Cookie do portal do tutor, enviado só para as rotas do portal. */
export const PORTAL_COOKIE = 'psid';
export const PORTAL_COOKIE_PATH = '/api/portal';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.authContext) throw new AppError('unauthenticated', 'Faça login para continuar.');
  return request.authContext;
}

export function requirePortal(request: FastifyRequest): PortalContext {
  if (!request.portalContext)
    throw new AppError('unauthenticated', 'Entre no portal para continuar.');
  return request.portalContext;
}

const checkCsrf = (request: FastifyRequest, expected: string) => {
  if (SAFE_METHODS.has(request.method)) return;
  const header = request.headers['x-csrf-token'];
  if (!tokensMatch(expected, typeof header === 'string' ? header : undefined)) {
    throw new AppError('csrf_invalid', 'Sessão desatualizada. Recarregue a página.');
  }
};

export const accessGuard = fp(
  async (
    app: FastifyInstance,
    opts: { sessions: SessionService; portalSessions: PortalSessionService },
  ) => {
    app.decorateRequest('authContext', null);
    app.decorateRequest('portalContext', null);

    app.addHook('onRoute', (route) => {
      if (!route.config?.access && !route.url.startsWith('/api/docs')) {
        throw new Error(`Rota ${route.method.toString()} ${route.url} sem declaração de acesso.`);
      }
    });

    app.addHook('preValidation', async (request) => {
      const access = request.routeOptions.config.access;
      if (!access || access.kind === 'public') return;

      if (access.kind === 'portal') {
        const token = request.cookies[PORTAL_COOKIE];
        const ctx = token ? await opts.portalSessions.authenticate(token) : null;
        if (!ctx) throw new AppError('unauthenticated', 'Entre no portal para continuar.');
        checkCsrf(request, ctx.csrfToken);
        request.portalContext = ctx;
        return;
      }

      const token = request.cookies[SESSION_COOKIE];
      const auth = token ? await opts.sessions.authenticate(token) : null;
      if (!auth) throw new AppError('unauthenticated', 'Faça login para continuar.');

      checkCsrf(request, auth.csrfToken);
      if (access.kind === 'permission' && !auth.permissions.has(access.permission)) {
        throw forbidden();
      }
      request.authContext = auth;
    });
  },
  { name: 'access-guard' },
);
