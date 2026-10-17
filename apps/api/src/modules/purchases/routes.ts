import {
  purchaseCancelSchema,
  purchaseImportSchema,
  purchaseInputSchema,
  purchaseListSchema,
  purchaseOptionsSchema,
  purchaseQuerySchema,
  purchaseSchema,
} from '@clinica/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../../http/access-guard.js';
import type { PurchasesService } from './service.js';

const idParams = z.object({ id: z.uuid() });
const view = { access: { kind: 'permission', permission: 'purchases.view' } } as const;
const manage = { access: { kind: 'permission', permission: 'purchases.manage' } } as const;

export const purchaseRoutes: FastifyPluginAsyncZod<{ purchases: PurchasesService }> = async (
  app,
  { purchases },
) => {
  app.get(
    '/',
    {
      config: view,
      schema: { querystring: purchaseQuerySchema, response: { 200: purchaseListSchema } },
    },
    async (request) => purchases.list(requireAuth(request), request.query),
  );

  app.get(
    '/options',
    { config: view, schema: { response: { 200: purchaseOptionsSchema } } },
    async (request) => purchases.options(requireAuth(request)),
  );

  app.post(
    '/',
    { config: manage, schema: { body: purchaseInputSchema, response: { 201: purchaseSchema } } },
    async (request, reply) => {
      const purchase = await purchases.create(requireAuth(request), request.body);
      return reply.status(201).send(purchase);
    },
  );

  // O XML vem como texto no JSON; NF-e grande com muitos itens passa de 1 MB.
  app.post(
    '/import',
    {
      config: manage,
      bodyLimit: 3 * 1024 * 1024,
      schema: { body: purchaseImportSchema, response: { 201: purchaseSchema } },
    },
    async (request, reply) => {
      const purchase = await purchases.importXml(requireAuth(request), request.body.xml);
      return reply.status(201).send(purchase);
    },
  );

  app.get(
    '/:id',
    { config: view, schema: { params: idParams, response: { 200: purchaseSchema } } },
    async (request) => purchases.get(requireAuth(request), request.params.id),
  );

  app.put(
    '/:id',
    {
      config: manage,
      schema: { params: idParams, body: purchaseInputSchema, response: { 200: purchaseSchema } },
    },
    async (request) => purchases.update(requireAuth(request), request.params.id, request.body),
  );

  app.post(
    '/:id/confirm',
    { config: manage, schema: { params: idParams, response: { 200: purchaseSchema } } },
    async (request) => purchases.confirm(requireAuth(request), request.params.id),
  );

  app.post(
    '/:id/cancel',
    {
      config: manage,
      schema: { params: idParams, body: purchaseCancelSchema, response: { 200: purchaseSchema } },
    },
    async (request) => purchases.cancel(requireAuth(request), request.params.id, request.body),
  );
};
