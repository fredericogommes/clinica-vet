import {
  cancelEntrySchema,
  entryInputSchema,
  entryListSchema,
  entryQuerySchema,
  entrySchema,
  entryUpdateSchema,
  financeOptionsSchema,
  financialAccountInputSchema,
  financialAccountSchema,
  financialCategoryInputSchema,
  financialCategorySchema,
  payEntrySchema,
  supplierInputSchema,
  supplierSchema,
  transferInputSchema,
} from '@clinica/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../../http/access-guard.js';
import type { FinanceService } from './service.js';

const idParams = z.object({ id: z.uuid() });
const view = { access: { kind: 'permission', permission: 'finance.view' } } as const;
const manage = { access: { kind: 'permission', permission: 'finance.manage' } } as const;
const configure = { access: { kind: 'permission', permission: 'finance.configure' } } as const;

/** Financeiro [p.18–19, RN-35]: lançamentos, contas, plano de contas e fornecedores. */
export const financeRoutes: FastifyPluginAsyncZod<{ finance: FinanceService }> = async (
  app,
  { finance },
) => {
  app.get(
    '/options',
    { config: view, schema: { response: { 200: financeOptionsSchema } } },
    async (request) => finance.options(requireAuth(request)),
  );

  app.get(
    '/entries',
    { config: view, schema: { querystring: entryQuerySchema, response: { 200: entryListSchema } } },
    async (request) => finance.list(requireAuth(request), request.query),
  );

  app.get(
    '/entries/:id',
    { config: view, schema: { params: idParams, response: { 200: entrySchema } } },
    async (request) => finance.get(requireAuth(request), request.params.id),
  );

  app.post(
    '/entries',
    {
      config: manage,
      schema: { body: entryInputSchema, response: { 201: z.array(entrySchema) } },
    },
    async (request, reply) =>
      reply.status(201).send(await finance.create(requireAuth(request), request.body)),
  );

  app.put(
    '/entries/:id',
    {
      config: manage,
      schema: { params: idParams, body: entryUpdateSchema, response: { 200: entrySchema } },
    },
    async (request) => finance.update(requireAuth(request), request.params.id, request.body),
  );

  app.post(
    '/entries/:id/pay',
    {
      config: manage,
      schema: { params: idParams, body: payEntrySchema, response: { 200: entrySchema } },
    },
    async (request) => finance.pay(requireAuth(request), request.params.id, request.body),
  );

  app.post(
    '/entries/:id/reopen',
    { config: manage, schema: { params: idParams, response: { 200: entrySchema } } },
    async (request) => finance.reopen(requireAuth(request), request.params.id),
  );

  app.post(
    '/entries/:id/cancel',
    {
      config: manage,
      schema: { params: idParams, body: cancelEntrySchema, response: { 200: entrySchema } },
    },
    async (request) => finance.cancel(requireAuth(request), request.params.id, request.body),
  );

  app.post(
    '/transfers',
    {
      config: manage,
      schema: { body: transferInputSchema, response: { 201: z.array(entrySchema) } },
    },
    async (request, reply) =>
      reply.status(201).send(await finance.transfer(requireAuth(request), request.body)),
  );

  app.get(
    '/accounts',
    { config: view, schema: { response: { 200: z.array(financialAccountSchema) } } },
    async (request) => finance.listAccounts(requireAuth(request)),
  );

  app.post(
    '/accounts',
    {
      config: configure,
      schema: { body: financialAccountInputSchema, response: { 201: financialAccountSchema } },
    },
    async (request, reply) =>
      reply.status(201).send(await finance.createAccount(requireAuth(request), request.body)),
  );

  app.put(
    '/accounts/:id',
    {
      config: configure,
      schema: {
        params: idParams,
        body: financialAccountInputSchema,
        response: { 200: financialAccountSchema },
      },
    },
    async (request) => finance.updateAccount(requireAuth(request), request.params.id, request.body),
  );

  app.get(
    '/categories',
    { config: view, schema: { response: { 200: z.array(financialCategorySchema) } } },
    async (request) => finance.listCategories(requireAuth(request)),
  );

  app.post(
    '/categories',
    {
      config: configure,
      schema: { body: financialCategoryInputSchema, response: { 201: financialCategorySchema } },
    },
    async (request, reply) =>
      reply.status(201).send(await finance.createCategory(requireAuth(request), request.body)),
  );

  app.put(
    '/categories/:id',
    {
      config: configure,
      schema: {
        params: idParams,
        body: financialCategoryInputSchema,
        response: { 200: financialCategorySchema },
      },
    },
    async (request) =>
      finance.updateCategory(requireAuth(request), request.params.id, request.body),
  );

  app.get(
    '/suppliers',
    { config: view, schema: { response: { 200: z.array(supplierSchema) } } },
    async (request) => finance.listSuppliers(requireAuth(request)),
  );

  app.post(
    '/suppliers',
    {
      config: configure,
      schema: { body: supplierInputSchema, response: { 201: supplierSchema } },
    },
    async (request, reply) =>
      reply.status(201).send(await finance.createSupplier(requireAuth(request), request.body)),
  );

  app.put(
    '/suppliers/:id',
    {
      config: configure,
      schema: { params: idParams, body: supplierInputSchema, response: { 200: supplierSchema } },
    },
    async (request) =>
      finance.updateSupplier(requireAuth(request), request.params.id, request.body),
  );
};
