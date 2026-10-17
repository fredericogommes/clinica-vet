import {
  stockAnalysisQuerySchema,
  stockAnalysisSchema,
  stockCancelSchema,
  stockCountCreateSchema,
  stockCountListSchema,
  stockCountQuerySchema,
  stockCountSchema,
  stockCountUpdateSchema,
  stockExitInputSchema,
  stockExitListSchema,
  stockExitQuerySchema,
  stockExitSchema,
  stockOptionsSchema,
} from '@clinica/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { forbidden } from '../../core/errors.js';
import { requireAuth } from '../../http/access-guard.js';
import type { StockOpsService } from './service.js';

const idParams = z.object({ id: z.uuid() });
const exits = { access: { kind: 'permission', permission: 'inventory.exits' } } as const;
const counts = { access: { kind: 'permission', permission: 'inventory.counts' } } as const;
// Opções servem às duas telas: basta uma das permissões.
const anyStock = { access: { kind: 'authenticated' } } as const;

export const stockRoutes: FastifyPluginAsyncZod<{ stock: StockOpsService }> = async (
  app,
  { stock },
) => {
  app.get(
    '/options',
    { config: anyStock, schema: { response: { 200: stockOptionsSchema } } },
    async (request) => {
      const auth = requireAuth(request);
      if (!auth.permissions.has('inventory.exits') && !auth.permissions.has('inventory.counts')) {
        throw forbidden();
      }
      return stock.options(auth);
    },
  );

  app.get(
    '/analysis',
    {
      config: { access: { kind: 'permission', permission: 'inventory.analysis' } },
      schema: { querystring: stockAnalysisQuerySchema, response: { 200: stockAnalysisSchema } },
    },
    async (request) => stock.analysis(requireAuth(request), request.query),
  );

  app.get(
    '/exits',
    {
      config: exits,
      schema: { querystring: stockExitQuerySchema, response: { 200: stockExitListSchema } },
    },
    async (request) => stock.listExits(requireAuth(request), request.query),
  );

  app.post(
    '/exits',
    { config: exits, schema: { body: stockExitInputSchema, response: { 201: stockExitSchema } } },
    async (request, reply) => {
      const created = await stock.createExit(requireAuth(request), request.body);
      return reply.status(201).send(created);
    },
  );

  app.get(
    '/exits/:id',
    { config: exits, schema: { params: idParams, response: { 200: stockExitSchema } } },
    async (request) => stock.getExit(requireAuth(request), request.params.id),
  );

  app.post(
    '/exits/:id/cancel',
    {
      config: exits,
      schema: { params: idParams, body: stockCancelSchema, response: { 200: stockExitSchema } },
    },
    async (request) => stock.cancelExit(requireAuth(request), request.params.id, request.body),
  );

  app.get(
    '/counts',
    {
      config: counts,
      schema: { querystring: stockCountQuerySchema, response: { 200: stockCountListSchema } },
    },
    async (request) => stock.listCounts(requireAuth(request), request.query),
  );

  app.post(
    '/counts',
    {
      config: counts,
      schema: { body: stockCountCreateSchema, response: { 201: stockCountSchema } },
    },
    async (request, reply) => {
      const created = await stock.createCount(requireAuth(request), request.body);
      return reply.status(201).send(created);
    },
  );

  app.get(
    '/counts/:id',
    { config: counts, schema: { params: idParams, response: { 200: stockCountSchema } } },
    async (request) => stock.getCount(requireAuth(request), request.params.id),
  );

  app.put(
    '/counts/:id',
    {
      config: counts,
      schema: {
        params: idParams,
        body: stockCountUpdateSchema,
        response: { 200: stockCountSchema },
      },
    },
    async (request) => stock.updateCount(requireAuth(request), request.params.id, request.body),
  );

  app.post(
    '/counts/:id/apply',
    { config: counts, schema: { params: idParams, response: { 200: stockCountSchema } } },
    async (request) => stock.applyCount(requireAuth(request), request.params.id),
  );

  app.post(
    '/counts/:id/cancel',
    { config: counts, schema: { params: idParams, response: { 200: stockCountSchema } } },
    async (request) => stock.cancelCount(requireAuth(request), request.params.id),
  );
};
