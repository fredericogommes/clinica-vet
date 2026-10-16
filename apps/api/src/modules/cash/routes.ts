import {
  cashListQuerySchema,
  cashMovementInputSchema,
  cashSessionSchema,
  cashSessionSummarySchema,
  closeCashSchema,
  currentCashSchema,
  openCashSchema,
  pageSchema,
} from '@clinica/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../../http/access-guard.js';
import type { CashService } from './service.js';

const idParams = z.object({ id: z.uuid() });

export const cashRoutes: FastifyPluginAsyncZod<{ cash: CashService }> = async (app, { cash }) => {
  // Lista e detalhe valem para o operador (os seus) e o supervisor (todos); o serviço confere.
  app.get(
    '/',
    {
      config: { access: { kind: 'authenticated' } },
      schema: {
        querystring: cashListQuerySchema,
        response: { 200: pageSchema(cashSessionSummarySchema) },
      },
    },
    async (request) => {
      const result = await cash.list(requireAuth(request), request.query);
      return { ...result, page: request.query.page, pageSize: request.query.pageSize };
    },
  );

  app.get(
    '/current',
    {
      config: { access: { kind: 'permission', permission: 'cash.operate' } },
      schema: { response: { 200: currentCashSchema } },
    },
    async (request) => ({ session: await cash.current(requireAuth(request)) }),
  );

  app.post(
    '/',
    {
      config: { access: { kind: 'permission', permission: 'cash.operate' } },
      schema: { body: openCashSchema, response: { 201: cashSessionSchema } },
    },
    async (request, reply) => {
      const session = await cash.open(requireAuth(request), request.body);
      return reply.status(201).send(session);
    },
  );

  app.get(
    '/:id',
    {
      config: { access: { kind: 'authenticated' } },
      schema: { params: idParams, response: { 200: cashSessionSchema } },
    },
    async (request) => cash.get(requireAuth(request), request.params.id),
  );

  app.post(
    '/:id/movements',
    {
      config: { access: { kind: 'permission', permission: 'cash.operate' } },
      schema: {
        params: idParams,
        body: cashMovementInputSchema,
        response: { 200: cashSessionSchema },
      },
    },
    async (request) => cash.addMovement(requireAuth(request), request.params.id, request.body),
  );

  app.post(
    '/:id/close',
    {
      config: { access: { kind: 'authenticated' } },
      schema: { params: idParams, body: closeCashSchema, response: { 200: cashSessionSchema } },
    },
    async (request) => cash.close(requireAuth(request), request.params.id, request.body),
  );
};
