import {
  clientsIntelligenceSchema,
  intelligenceFavoritesSchema,
  intelligenceQuerySchema,
  patientsIntelligenceSchema,
  salesIntelligenceSchema,
} from '@clinica/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireAuth } from '../../http/access-guard.js';
import type { IntelligenceService } from './service.js';

const access = { kind: 'permission', permission: 'intelligence.view' } as const;

/** Inteligência › Vendas [p.11–12]: uma rota por aba e os favoritos de cada usuário. */
export const intelligenceRoutes: FastifyPluginAsyncZod<{
  intelligence: IntelligenceService;
}> = async (app, { intelligence }) => {
  app.get(
    '/sales',
    {
      config: { access },
      schema: { querystring: intelligenceQuerySchema, response: { 200: salesIntelligenceSchema } },
    },
    async (request) => intelligence.sales(requireAuth(request), request.query),
  );

  app.get(
    '/clients',
    {
      config: { access },
      schema: {
        querystring: intelligenceQuerySchema,
        response: { 200: clientsIntelligenceSchema },
      },
    },
    async (request) => intelligence.clients(requireAuth(request), request.query),
  );

  app.get(
    '/patients',
    {
      config: { access },
      schema: {
        querystring: intelligenceQuerySchema,
        response: { 200: patientsIntelligenceSchema },
      },
    },
    async (request) => intelligence.patients(requireAuth(request), request.query),
  );

  app.get(
    '/favorites',
    { config: { access }, schema: { response: { 200: intelligenceFavoritesSchema } } },
    async (request) => ({ keys: await intelligence.favorites(requireAuth(request)) }),
  );

  app.put(
    '/favorites',
    {
      config: { access },
      schema: { body: intelligenceFavoritesSchema, response: { 200: intelligenceFavoritesSchema } },
    },
    async (request) => ({
      keys: await intelligence.saveFavorites(requireAuth(request), request.body.keys),
    }),
  );
};
