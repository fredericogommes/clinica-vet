import { dashboardLayoutSchema, dashboardSchema } from '@clinica/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireAuth } from '../../http/access-guard.js';
import type { DashboardService } from './service.js';

/** Painel de controle [p.3]: qualquer usuário autenticado; cada widget depende da sua chave. */
export const dashboardRoutes: FastifyPluginAsyncZod<{ dashboard: DashboardService }> = async (
  app,
  { dashboard },
) => {
  app.get(
    '/',
    {
      config: { access: { kind: 'authenticated' } },
      schema: { response: { 200: dashboardSchema } },
    },
    async (request) => dashboard.get(requireAuth(request)),
  );

  app.put(
    '/layout',
    {
      config: { access: { kind: 'authenticated' } },
      schema: { body: dashboardLayoutSchema, response: { 200: dashboardLayoutSchema } },
    },
    async (request) => ({
      widgets: await dashboard.saveLayout(requireAuth(request), request.body),
    }),
  );
};
