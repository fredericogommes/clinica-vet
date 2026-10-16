import {
  clientInputSchema,
  clientListItemSchema,
  clientSchema,
  listQuerySchema,
  pageSchema,
  updateConsentsRequestSchema,
} from '@clinica/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../../http/access-guard.js';
import type { ClientService } from './service.js';

const idParams = z.object({ id: z.uuid() });

export const clientRoutes: FastifyPluginAsyncZod<{ clients: ClientService }> = async (
  app,
  { clients },
) => {
  app.get(
    '/',
    {
      config: { access: { kind: 'permission', permission: 'clients.view' } },
      schema: { querystring: listQuerySchema, response: { 200: pageSchema(clientListItemSchema) } },
    },
    async (request) => {
      const result = await clients.list(requireAuth(request), request.query);
      return { ...result, page: request.query.page, pageSize: request.query.pageSize };
    },
  );

  app.post(
    '/',
    {
      config: { access: { kind: 'permission', permission: 'clients.manage' } },
      schema: { body: clientInputSchema, response: { 201: clientSchema } },
    },
    async (request, reply) => {
      const client = await clients.create(requireAuth(request), request.body);
      return reply.status(201).send(client);
    },
  );

  app.get(
    '/:id',
    {
      config: { access: { kind: 'permission', permission: 'clients.view' } },
      schema: { params: idParams, response: { 200: clientSchema } },
    },
    async (request) => clients.get(requireAuth(request), request.params.id),
  );

  app.put(
    '/:id',
    {
      config: { access: { kind: 'permission', permission: 'clients.manage' } },
      schema: { params: idParams, body: clientInputSchema, response: { 200: clientSchema } },
    },
    async (request) => clients.update(requireAuth(request), request.params.id, request.body),
  );

  app.put(
    '/:id/consents',
    {
      config: { access: { kind: 'permission', permission: 'clients.manage' } },
      schema: {
        params: idParams,
        body: updateConsentsRequestSchema,
        response: { 200: clientSchema },
      },
    },
    async (request) =>
      clients.updateConsents(requireAuth(request), request.params.id, request.body),
  );

  app.post(
    '/:id/archive',
    {
      config: { access: { kind: 'permission', permission: 'clients.archive' } },
      schema: { params: idParams, response: { 200: clientSchema } },
    },
    async (request) => clients.setArchived(requireAuth(request), request.params.id, true),
  );

  app.post(
    '/:id/restore',
    {
      config: { access: { kind: 'permission', permission: 'clients.archive' } },
      schema: { params: idParams, response: { 200: clientSchema } },
    },
    async (request) => clients.setArchived(requireAuth(request), request.params.id, false),
  );

  app.delete(
    '/:id',
    {
      config: { access: { kind: 'permission', permission: 'clients.delete' } },
      schema: { params: idParams },
    },
    async (request, reply) => {
      await clients.remove(requireAuth(request), request.params.id);
      return reply.status(204).send();
    },
  );
};
