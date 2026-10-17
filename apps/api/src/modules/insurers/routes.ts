import {
  insurerCandidateSchema,
  insurerInputSchema,
  insurerOptionSchema,
  insurerPricesInputSchema,
  insurerPricesSchema,
  insurerSchema,
} from '@clinica/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../../http/access-guard.js';
import type { InsurerService } from './service.js';

const idParams = z.object({ id: z.uuid() });
const configure = { kind: 'permission', permission: 'insurers.configure' } as const;

/** Convênios e tabelas de preço [RN-43]. */
export const insurerRoutes: FastifyPluginAsyncZod<{ insurers: InsurerService }> = async (
  app,
  { insurers },
) => {
  app.get(
    '/',
    {
      config: { access: configure },
      schema: { response: { 200: z.array(insurerSchema) } },
    },
    async (request) => insurers.list(requireAuth(request)),
  );

  // O cadastro do animal escolhe o plano entre os convênios ativos.
  app.get(
    '/options',
    {
      config: { access: { kind: 'permission', permission: 'patients.manage' } },
      schema: { response: { 200: z.array(insurerOptionSchema) } },
    },
    async (request) => insurers.options(requireAuth(request)),
  );

  app.get(
    '/products',
    {
      config: { access: configure },
      schema: {
        querystring: z.object({ q: z.string().trim().max(100).default('') }),
        response: { 200: z.array(insurerCandidateSchema) },
      },
    },
    async (request) => insurers.candidates(requireAuth(request), request.query.q),
  );

  app.post(
    '/',
    {
      config: { access: configure },
      schema: { body: insurerInputSchema, response: { 201: insurerSchema } },
    },
    async (request, reply) => {
      const insurer = await insurers.create(requireAuth(request), request.body);
      return reply.status(201).send(insurer);
    },
  );

  app.put(
    '/:id',
    {
      config: { access: configure },
      schema: { params: idParams, body: insurerInputSchema, response: { 200: insurerSchema } },
    },
    async (request) => insurers.update(requireAuth(request), request.params.id, request.body),
  );

  app.get(
    '/:id/prices',
    {
      config: { access: configure },
      schema: { params: idParams, response: { 200: insurerPricesSchema } },
    },
    async (request) => insurers.prices(requireAuth(request), request.params.id),
  );

  app.put(
    '/:id/prices',
    {
      config: { access: configure },
      schema: {
        params: idParams,
        body: insurerPricesInputSchema,
        response: { 200: insurerPricesSchema },
      },
    },
    async (request) => insurers.savePrices(requireAuth(request), request.params.id, request.body),
  );
};
