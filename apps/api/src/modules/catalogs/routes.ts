import {
  breedSchema,
  catalogItemInputSchema,
  catalogItemSchema,
  catalogKinds,
} from '@clinica/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../../http/access-guard.js';
import type { CatalogService } from './service.js';

const kindParams = z.object({ kind: z.enum(catalogKinds) });
const itemParams = kindParams.extend({ id: z.uuid() });
const idParams = z.object({ id: z.uuid() });

export const catalogRoutes: FastifyPluginAsyncZod<{ catalogs: CatalogService }> = async (
  app,
  { catalogs },
) => {
  // Os cadastros alimentam os formulários de clientes e animais, por isso a leitura só exige sessão.
  app.get(
    '/:kind',
    {
      config: { access: { kind: 'authenticated' } },
      schema: { params: kindParams, response: { 200: z.array(catalogItemSchema) } },
    },
    async (request) => catalogs.list(requireAuth(request), request.params.kind),
  );

  app.post(
    '/:kind',
    {
      config: { access: { kind: 'permission', permission: 'catalogs.manage' } },
      schema: {
        params: kindParams,
        body: catalogItemInputSchema,
        response: { 201: catalogItemSchema },
      },
    },
    async (request, reply) => {
      const item = await catalogs.create(requireAuth(request), request.params.kind, request.body);
      return reply.status(201).send(item);
    },
  );

  app.put(
    '/:kind/:id',
    {
      config: { access: { kind: 'permission', permission: 'catalogs.manage' } },
      schema: {
        params: itemParams,
        body: catalogItemInputSchema,
        response: { 200: catalogItemSchema },
      },
    },
    async (request) =>
      catalogs.update(requireAuth(request), request.params.kind, request.params.id, request.body),
  );

  app.get(
    '/species/:id/breeds',
    {
      config: { access: { kind: 'authenticated' } },
      schema: { params: idParams, response: { 200: z.array(breedSchema) } },
    },
    async (request) => catalogs.listBreeds(requireAuth(request), request.params.id),
  );

  app.post(
    '/species/:id/breeds',
    {
      config: { access: { kind: 'permission', permission: 'catalogs.manage' } },
      schema: { params: idParams, body: catalogItemInputSchema, response: { 201: breedSchema } },
    },
    async (request, reply) => {
      const breed = await catalogs.createBreed(
        requireAuth(request),
        request.params.id,
        request.body,
      );
      return reply.status(201).send(breed);
    },
  );

  app.put(
    '/breeds/:id',
    {
      config: { access: { kind: 'permission', permission: 'catalogs.manage' } },
      schema: { params: idParams, body: catalogItemInputSchema, response: { 200: breedSchema } },
    },
    async (request) => catalogs.updateBreed(requireAuth(request), request.params.id, request.body),
  );
};
