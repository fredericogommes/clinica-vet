import { loginRequestSchema, sessionSchema, switchUnitRequestSchema } from '@clinica/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth, SESSION_COOKIE } from '../../http/access-guard.js';
import type { SessionService } from './sessions.js';

export const authRoutes: FastifyPluginAsyncZod<{
  sessions: SessionService;
  secureCookies: boolean;
}> = async (app, { sessions, secureCookies }) => {
  app.post(
    '/login',
    {
      config: { access: { kind: 'public' }, rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { body: loginRequestSchema, response: { 204: z.null() } },
    },
    async (request, reply) => {
      const { token, expiresAt } = await sessions.login(request.body.email, request.body.password);
      reply.setCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        secure: secureCookies,
        sameSite: 'lax',
        path: '/',
        expires: expiresAt,
      });
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/logout',
    { config: { access: { kind: 'authenticated' } }, schema: { response: { 204: z.null() } } },
    async (request, reply) => {
      await sessions.logout(requireAuth(request));
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/session',
    { config: { access: { kind: 'authenticated' } }, schema: { response: { 200: sessionSchema } } },
    async (request) => sessions.describe(requireAuth(request)),
  );

  app.post(
    '/unit',
    {
      config: { access: { kind: 'authenticated' } },
      schema: { body: switchUnitRequestSchema, response: { 204: z.null() } },
    },
    async (request, reply) => {
      await sessions.switchUnit(requireAuth(request), request.body.unitId);
      return reply.status(204).send(null);
    },
  );
};
