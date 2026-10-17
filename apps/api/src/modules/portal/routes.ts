import {
  portalAccountListSchema,
  portalAccountSchema,
  portalHomeSchema,
  portalInviteInputSchema,
  portalInviteResultSchema,
  portalLinkInfoSchema,
  portalLoginSchema,
  portalPatientSchema,
  portalSessionSchema,
  portalSetPasswordSchema,
  portalSettingsSchema,
} from '@clinica/contracts';
import type { FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  PORTAL_COOKIE,
  PORTAL_COOKIE_PATH,
  requireAuth,
  requirePortal,
} from '../../http/access-guard.js';
import type { PortalAdminService, PortalService } from './service.js';
import type { PortalSessionService } from './sessions.js';

const clientParams = z.object({ clientId: z.uuid() });
const manage = { access: { kind: 'permission', permission: 'portal.manage' } } as const;
const configure = { access: { kind: 'permission', permission: 'portal.configure' } } as const;

/** Lado da equipe: configuração e acesso de cada cliente. */
export const portalAdminRoutes: FastifyPluginAsyncZod<{ admin: PortalAdminService }> = async (
  app,
  { admin },
) => {
  app.get(
    '/settings',
    { config: configure, schema: { response: { 200: portalSettingsSchema } } },
    async (request) => admin.settings(requireAuth(request)),
  );
  app.put(
    '/settings',
    {
      config: configure,
      schema: { body: portalSettingsSchema, response: { 200: portalSettingsSchema } },
    },
    async (request) => admin.updateSettings(requireAuth(request), request.body),
  );
  app.get(
    '/accounts',
    { config: configure, schema: { response: { 200: portalAccountListSchema } } },
    async (request) => admin.accounts(requireAuth(request)),
  );
  app.get(
    '/clients/:clientId',
    { config: manage, schema: { params: clientParams, response: { 200: portalAccountSchema } } },
    async (request) => admin.account(requireAuth(request), request.params.clientId),
  );
  app.post(
    '/clients/:clientId/link',
    {
      config: manage,
      schema: {
        params: clientParams,
        body: portalInviteInputSchema,
        response: { 200: portalInviteResultSchema },
      },
    },
    async (request) =>
      admin.invite(requireAuth(request), request.params.clientId, request.body.email),
  );
  for (const [path, blocked] of [
    ['block', true],
    ['unblock', false],
  ] as const) {
    app.post(
      `/clients/:clientId/${path}`,
      { config: manage, schema: { params: clientParams, response: { 200: portalAccountSchema } } },
      async (request) => admin.setBlocked(requireAuth(request), request.params.clientId, blocked),
    );
  }
};

const tokenParams = z.object({ token: z.string().regex(/^[\w-]{43}$/, 'Link inválido') });
const portal = { access: { kind: 'portal' } } as const;
const pub = { access: { kind: 'public' } } as const;

/** Lado do tutor. O cookie do portal só é enviado para estas rotas. */
export const portalRoutes: FastifyPluginAsyncZod<{
  portal: PortalService;
  sessions: PortalSessionService;
  secureCookies: boolean;
}> = async (app, { portal: service, sessions, secureCookies }) => {
  const setCookie = (reply: FastifyReply, token: string) =>
    reply.setCookie(PORTAL_COOKIE, token, {
      httpOnly: true,
      secure: secureCookies,
      sameSite: 'strict',
      path: PORTAL_COOKIE_PATH,
      // No celular do tutor a sessão sobrevive ao fechar o navegador; a validade é do servidor.
      maxAge: Math.floor(sessions.ttlMs / 1000),
    });

  app.post(
    '/login',
    {
      config: { ...pub, rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { body: portalLoginSchema, response: { 204: z.null() } },
    },
    async (request, reply) => {
      setCookie(reply, await sessions.login(request.body.email, request.body.password));
      return reply.status(204).send(null);
    },
  );
  app.get(
    '/link/:token',
    {
      config: { ...pub, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { params: tokenParams, response: { 200: portalLinkInfoSchema } },
    },
    async (request) => service.linkInfo(request.params.token),
  );
  app.post(
    '/link/:token',
    {
      config: { ...pub, rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { params: tokenParams, body: portalSetPasswordSchema, response: { 204: z.null() } },
    },
    async (request, reply) => {
      setCookie(reply, await service.setPassword(request.params.token, request.body.password));
      return reply.status(204).send(null);
    },
  );
  app.post(
    '/logout',
    { config: portal, schema: { response: { 204: z.null() } } },
    async (request, reply) => {
      await sessions.logout(requirePortal(request));
      reply.clearCookie(PORTAL_COOKIE, { path: PORTAL_COOKIE_PATH });
      return reply.status(204).send(null);
    },
  );
  app.get(
    '/session',
    { config: portal, schema: { response: { 200: portalSessionSchema } } },
    async (request) => service.session(requirePortal(request)),
  );
  app.get(
    '/home',
    { config: portal, schema: { response: { 200: portalHomeSchema } } },
    async (request) => service.home(requirePortal(request)),
  );
  app.get(
    '/patients/:id',
    {
      config: portal,
      schema: { params: z.object({ id: z.uuid() }), response: { 200: portalPatientSchema } },
    },
    async (request) => service.patient(requirePortal(request), request.params.id),
  );
};
