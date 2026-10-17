import {
  purchaseOrderCancelSchema,
  purchaseOrderInputSchema,
  purchaseOrderListSchema,
  purchaseOrderOptionsSchema,
  purchaseOrderQuerySchema,
  purchaseOrderSchema,
  purchaseSuggestionSchema,
} from '@clinica/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../../http/access-guard.js';
import type { PurchaseOrdersService } from './orders.js';

const idParams = z.object({ id: z.uuid() });
const view = { access: { kind: 'permission', permission: 'purchases.view' } } as const;
const manage = { access: { kind: 'permission', permission: 'purchases.manage' } } as const;

export const purchaseOrderRoutes: FastifyPluginAsyncZod<{ orders: PurchaseOrdersService }> = async (
  app,
  { orders },
) => {
  app.get(
    '/',
    {
      config: view,
      schema: { querystring: purchaseOrderQuerySchema, response: { 200: purchaseOrderListSchema } },
    },
    async (request) => orders.list(requireAuth(request), request.query),
  );

  app.get(
    '/options',
    { config: manage, schema: { response: { 200: purchaseOrderOptionsSchema } } },
    async (request) => orders.options(requireAuth(request)),
  );

  app.get(
    '/suggestion',
    {
      config: manage,
      schema: {
        querystring: z.object({ supplierId: z.uuid().optional() }),
        response: { 200: purchaseSuggestionSchema },
      },
    },
    async (request) => orders.suggestion(requireAuth(request), request.query.supplierId),
  );

  app.post(
    '/',
    {
      config: manage,
      schema: { body: purchaseOrderInputSchema, response: { 201: purchaseOrderSchema } },
    },
    async (request, reply) => {
      const created = await orders.create(requireAuth(request), request.body);
      return reply.status(201).send(created);
    },
  );

  app.get(
    '/:id',
    { config: view, schema: { params: idParams, response: { 200: purchaseOrderSchema } } },
    async (request) => orders.get(requireAuth(request), request.params.id),
  );

  app.put(
    '/:id',
    {
      config: manage,
      schema: {
        params: idParams,
        body: purchaseOrderInputSchema,
        response: { 200: purchaseOrderSchema },
      },
    },
    async (request) => orders.update(requireAuth(request), request.params.id, request.body),
  );

  app.post(
    '/:id/send',
    { config: manage, schema: { params: idParams, response: { 200: purchaseOrderSchema } } },
    async (request) => orders.send(requireAuth(request), request.params.id),
  );

  app.post(
    '/:id/receive',
    { config: manage, schema: { params: idParams, response: { 200: purchaseOrderSchema } } },
    async (request) => orders.receive(requireAuth(request), request.params.id),
  );

  app.post(
    '/:id/cancel',
    {
      config: manage,
      schema: {
        params: idParams,
        body: purchaseOrderCancelSchema,
        response: { 200: purchaseOrderSchema },
      },
    },
    async (request) => orders.cancel(requireAuth(request), request.params.id, request.body),
  );
};
