import {
  pageSchema,
  productInputSchema,
  productListItemSchema,
  productListQuerySchema,
  productSchema,
  lotTraceSchema,
  productStockSchema,
  stockAdjustmentSchema,
} from '@clinica/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../../http/access-guard.js';
import type { InventoryService } from '../inventory/service.js';
import type { ProductService } from './service.js';

const idParams = z.object({ id: z.uuid() });

export const productRoutes: FastifyPluginAsyncZod<{
  products: ProductService;
  inventory: InventoryService;
}> = async (app, { products, inventory }) => {
  app.get(
    '/',
    {
      config: { access: { kind: 'permission', permission: 'products.view' } },
      schema: {
        querystring: productListQuerySchema,
        response: { 200: pageSchema(productListItemSchema) },
      },
    },
    async (request) => {
      const result = await products.list(requireAuth(request), request.query);
      return { ...result, page: request.query.page, pageSize: request.query.pageSize };
    },
  );

  // Antes de "/:id": rota estática.
  app.get(
    '/professionals',
    {
      config: { access: { kind: 'permission', permission: 'products.manage' } },
      schema: { response: { 200: z.array(z.object({ id: z.uuid(), name: z.string() })) } },
    },
    async (request) => products.professionals(requireAuth(request)),
  );

  app.post(
    '/',
    {
      config: { access: { kind: 'permission', permission: 'products.manage' } },
      schema: { body: productInputSchema, response: { 201: productSchema } },
    },
    async (request, reply) => {
      const product = await products.create(requireAuth(request), request.body);
      return reply.status(201).send(product);
    },
  );

  app.get(
    '/:id',
    {
      config: { access: { kind: 'permission', permission: 'products.view' } },
      schema: { params: idParams, response: { 200: productSchema } },
    },
    async (request) => products.get(requireAuth(request), request.params.id),
  );

  // Estoque na unidade atual [RN-31]; nulo quando o item não controla estoque.
  app.get(
    '/:id/stock',
    {
      config: { access: { kind: 'permission', permission: 'products.view' } },
      schema: { params: idParams, response: { 200: productStockSchema.nullable() } },
    },
    async (request) => inventory.stock(requireAuth(request), request.params.id),
  );

  app.post(
    '/:id/stock',
    {
      config: { access: { kind: 'permission', permission: 'inventory.adjust' } },
      schema: {
        params: idParams,
        body: stockAdjustmentSchema,
        response: { 200: productStockSchema },
      },
    },
    async (request) => inventory.adjust(requireAuth(request), request.params.id, request.body),
  );

  // Rastreio do lote até a venda e o animal [RN-32].
  app.get(
    '/:id/lots/:lotId',
    {
      config: { access: { kind: 'permission', permission: 'products.view' } },
      schema: {
        params: z.object({ id: z.uuid(), lotId: z.uuid() }),
        response: { 200: lotTraceSchema },
      },
    },
    async (request) =>
      inventory.trace(requireAuth(request), request.params.id, request.params.lotId),
  );

  app.put(
    '/:id',
    {
      config: { access: { kind: 'permission', permission: 'products.manage' } },
      schema: { params: idParams, body: productInputSchema, response: { 200: productSchema } },
    },
    async (request) => products.update(requireAuth(request), request.params.id, request.body),
  );

  app.post(
    '/:id/archive',
    {
      config: { access: { kind: 'permission', permission: 'products.manage' } },
      schema: { params: idParams, response: { 200: productSchema } },
    },
    async (request) => products.setArchived(requireAuth(request), request.params.id, true),
  );

  app.post(
    '/:id/restore',
    {
      config: { access: { kind: 'permission', permission: 'products.manage' } },
      schema: { params: idParams, response: { 200: productSchema } },
    },
    async (request) => products.setArchived(requireAuth(request), request.params.id, false),
  );
};
