import {
  vaccinationDueQuerySchema,
  vaccinationDueSchema,
  vaccineInputSchema,
  vaccineSchema,
} from '@clinica/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../../http/access-guard.js';
import type { VaccineService } from './service.js';

const idParams = z.object({ id: z.uuid() });

/** Vacinas [p.12]: leitura para quem aplica, escrita em Cadastros; consulta Vacinação [p.17]. */
export const vaccineRoutes: FastifyPluginAsyncZod<{ vaccines: VaccineService }> = async (
  app,
  { vaccines },
) => {
  app.get(
    '/',
    {
      config: { access: { kind: 'authenticated' } },
      schema: { response: { 200: z.array(vaccineSchema) } },
    },
    async (request) => vaccines.list(requireAuth(request)),
  );

  app.get(
    '/due',
    {
      config: { access: { kind: 'permission', permission: 'reports.vaccination' } },
      schema: { querystring: vaccinationDueQuerySchema, response: { 200: vaccinationDueSchema } },
    },
    async (request) => {
      const auth = requireAuth(request);
      return vaccines.due(auth, request.query, await vaccines.today(auth));
    },
  );

  app.get(
    '/:id',
    {
      config: { access: { kind: 'authenticated' } },
      schema: { params: idParams, response: { 200: vaccineSchema } },
    },
    async (request) => vaccines.get(requireAuth(request), request.params.id),
  );

  app.post(
    '/',
    {
      config: { access: { kind: 'permission', permission: 'catalogs.manage' } },
      schema: { body: vaccineInputSchema, response: { 201: vaccineSchema } },
    },
    async (request, reply) => {
      const vaccine = await vaccines.save(requireAuth(request), null, request.body);
      return reply.status(201).send(vaccine);
    },
  );

  app.put(
    '/:id',
    {
      config: { access: { kind: 'permission', permission: 'catalogs.manage' } },
      schema: { params: idParams, body: vaccineInputSchema, response: { 200: vaccineSchema } },
    },
    async (request) => vaccines.save(requireAuth(request), request.params.id, request.body),
  );
};
