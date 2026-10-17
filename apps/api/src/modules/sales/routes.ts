import {
  cancelSaleSchema,
  mySalesSchema,
  pageSchema,
  patientSaleItemInputSchema,
  patientSalesSchema,
  receiveSaleSchema,
  reverseSaleSchema,
  saleContextSchema,
  saleInputSchema,
  saleListItemSchema,
  saleListQuerySchema,
  saleSchema,
  salesByItemQuerySchema,
  salesByItemSchema,
  salesPeriodSchema,
  salesSettingsSchema,
  salesSummarySchema,
  sellableItemSchema,
  sellableQuerySchema,
} from '@clinica/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../../http/access-guard.js';
import type { SalesReportService } from './reports.js';
import type { SaleService } from './service.js';

const idParams = z.object({ id: z.uuid() });
const patientParams = z.object({ patientId: z.uuid() });

export const saleRoutes: FastifyPluginAsyncZod<{
  sales: SaleService;
  reports: SalesReportService;
}> = async (app, { sales, reports }) => {
  app.get(
    '/',
    {
      config: { access: { kind: 'permission', permission: 'sales.view' } },
      schema: {
        querystring: saleListQuerySchema,
        response: { 200: pageSchema(saleListItemSchema) },
      },
    },
    async (request) => {
      const result = await sales.list(requireAuth(request), request.query);
      return { ...result, page: request.query.page, pageSize: request.query.pageSize };
    },
  );

  // Rotas estáticas antes de "/:id".
  // Consulta vendas [p.9]: resumo e totais por produto e serviço do período.
  app.get(
    '/reports/summary',
    {
      config: { access: { kind: 'permission', permission: 'sales.reports' } },
      schema: { querystring: salesPeriodSchema, response: { 200: salesSummarySchema } },
    },
    async (request) => reports.summary(requireAuth(request), request.query),
  );

  app.get(
    '/reports/items',
    {
      config: { access: { kind: 'permission', permission: 'sales.reports' } },
      schema: { querystring: salesByItemQuerySchema, response: { 200: salesByItemSchema } },
    },
    async (request) => reports.byItem(requireAuth(request), request.query),
  );

  // Minhas vendas [p.10]: só os itens do próprio profissional.
  app.get(
    '/mine',
    {
      config: { access: { kind: 'permission', permission: 'sales.view_own' } },
      schema: { querystring: salesPeriodSchema, response: { 200: mySalesSchema } },
    },
    async (request) => reports.mine(requireAuth(request), request.query),
  );

  app.get(
    '/context',
    {
      config: { access: { kind: 'permission', permission: 'sales.manage' } },
      schema: { response: { 200: saleContextSchema } },
    },
    async (request) => sales.context(requireAuth(request)),
  );

  app.get(
    '/sellable',
    {
      config: { access: { kind: 'permission', permission: 'sales.manage' } },
      schema: { querystring: sellableQuerySchema, response: { 200: z.array(sellableItemSchema) } },
    },
    async (request) => sales.sellable(requireAuth(request), request.query.q),
  );

  app.get(
    '/settings',
    {
      config: { access: { kind: 'permission', permission: 'sales.configure' } },
      schema: { response: { 200: salesSettingsSchema } },
    },
    async (request) => sales.settings(requireAuth(request)),
  );

  app.put(
    '/settings',
    {
      config: { access: { kind: 'permission', permission: 'sales.configure' } },
      schema: { body: salesSettingsSchema, response: { 200: salesSettingsSchema } },
    },
    async (request) => sales.updateSettings(requireAuth(request), request.body),
  );

  app.get(
    '/patient/:patientId',
    {
      config: { access: { kind: 'permission', permission: 'sales.view' } },
      schema: { params: patientParams, response: { 200: patientSalesSchema } },
    },
    async (request) => sales.forPatient(requireAuth(request), request.params.patientId),
  );

  app.post(
    '/patient/:patientId/items',
    {
      config: { access: { kind: 'permission', permission: 'sales.manage' } },
      schema: {
        params: patientParams,
        body: patientSaleItemInputSchema,
        response: { 200: saleSchema },
      },
    },
    async (request) =>
      sales.addToPatient(requireAuth(request), request.params.patientId, request.body),
  );

  app.post(
    '/',
    {
      config: { access: { kind: 'permission', permission: 'sales.manage' } },
      schema: { body: saleInputSchema, response: { 201: saleSchema } },
    },
    async (request, reply) => {
      const sale = await sales.create(requireAuth(request), request.body);
      return reply.status(201).send(sale);
    },
  );

  app.get(
    '/:id',
    {
      config: { access: { kind: 'permission', permission: 'sales.view' } },
      schema: { params: idParams, response: { 200: saleSchema } },
    },
    async (request) => sales.get(requireAuth(request), request.params.id),
  );

  app.put(
    '/:id',
    {
      config: { access: { kind: 'permission', permission: 'sales.manage' } },
      schema: { params: idParams, body: saleInputSchema, response: { 200: saleSchema } },
    },
    async (request) => sales.update(requireAuth(request), request.params.id, request.body),
  );

  app.post(
    '/:id/cancel',
    {
      config: { access: { kind: 'permission', permission: 'sales.cancel' } },
      schema: { params: idParams, body: cancelSaleSchema, response: { 200: saleSchema } },
    },
    async (request) => sales.cancel(requireAuth(request), request.params.id, request.body.reason),
  );

  app.post(
    '/:id/receive',
    {
      config: { access: { kind: 'permission', permission: 'sales.receive' } },
      schema: { params: idParams, body: receiveSaleSchema, response: { 200: saleSchema } },
    },
    async (request) => sales.receive(requireAuth(request), request.params.id, request.body),
  );

  app.post(
    '/:id/reverse',
    {
      config: { access: { kind: 'permission', permission: 'sales.reverse' } },
      schema: { params: idParams, body: reverseSaleSchema, response: { 200: saleSchema } },
    },
    async (request) => sales.reverse(requireAuth(request), request.params.id, request.body.reason),
  );
};
