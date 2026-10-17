import {
  examInputSchema,
  examListItemSchema,
  examReferencesInputSchema,
  examSchema,
} from '@clinica/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../../http/access-guard.js';
import type { ExamService } from './service.js';

const idParams = z.object({ id: z.uuid() });

/** Cadastro de exames [p.12–14]: leitura para quem registra resultado, escrita em Cadastros. */
export const examRoutes: FastifyPluginAsyncZod<{ exams: ExamService }> = async (app, { exams }) => {
  app.get(
    '/',
    {
      config: { access: { kind: 'authenticated' } },
      schema: { response: { 200: z.array(examListItemSchema) } },
    },
    async (request) => exams.list(requireAuth(request)),
  );

  app.get(
    '/:id',
    {
      config: { access: { kind: 'authenticated' } },
      schema: { params: idParams, response: { 200: examSchema } },
    },
    async (request) => exams.get(requireAuth(request), request.params.id),
  );

  app.post(
    '/',
    {
      config: { access: { kind: 'permission', permission: 'catalogs.manage' } },
      schema: { body: examInputSchema, response: { 201: examSchema } },
    },
    async (request, reply) => {
      const exam = await exams.save(requireAuth(request), null, request.body);
      return reply.status(201).send(exam);
    },
  );

  app.put(
    '/:id',
    {
      config: { access: { kind: 'permission', permission: 'catalogs.manage' } },
      schema: { params: idParams, body: examInputSchema, response: { 200: examSchema } },
    },
    async (request) => exams.save(requireAuth(request), request.params.id, request.body),
  );

  app.put(
    '/:id/references',
    {
      config: { access: { kind: 'permission', permission: 'catalogs.manage' } },
      schema: { params: idParams, body: examReferencesInputSchema, response: { 200: examSchema } },
    },
    async (request) => exams.saveReferences(requireAuth(request), request.params.id, request.body),
  );
};
