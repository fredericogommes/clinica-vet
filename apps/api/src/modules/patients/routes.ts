import {
  createPatientRequestSchema,
  listQuerySchema,
  pageSchema,
  patientInputSchema,
  patientListItemSchema,
  patientSchema,
  transferOwnerRequestSchema,
} from '@clinica/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../../http/access-guard.js';
import type { PatientService } from './service.js';

const idParams = z.object({ id: z.uuid() });

export const patientRoutes: FastifyPluginAsyncZod<{ patients: PatientService }> = async (
  app,
  { patients },
) => {
  app.get(
    '/',
    {
      config: { access: { kind: 'permission', permission: 'patients.view' } },
      schema: {
        querystring: listQuerySchema,
        response: { 200: pageSchema(patientListItemSchema) },
      },
    },
    async (request) => {
      const result = await patients.list(requireAuth(request), request.query);
      return { ...result, page: request.query.page, pageSize: request.query.pageSize };
    },
  );

  app.post(
    '/',
    {
      config: { access: { kind: 'permission', permission: 'patients.manage' } },
      schema: { body: createPatientRequestSchema, response: { 201: patientSchema } },
    },
    async (request, reply) => {
      const patient = await patients.create(
        requireAuth(request),
        request.body.clientId,
        request.body.patient,
      );
      return reply.status(201).send(patient);
    },
  );

  app.get(
    '/:id',
    {
      config: { access: { kind: 'permission', permission: 'patients.view' } },
      schema: { params: idParams, response: { 200: patientSchema } },
    },
    async (request) => patients.get(requireAuth(request), request.params.id),
  );

  app.put(
    '/:id',
    {
      config: { access: { kind: 'permission', permission: 'patients.manage' } },
      schema: { params: idParams, body: patientInputSchema, response: { 200: patientSchema } },
    },
    async (request) => patients.update(requireAuth(request), request.params.id, request.body),
  );

  app.post(
    '/:id/transfer',
    {
      config: { access: { kind: 'permission', permission: 'patients.transfer_owner' } },
      schema: {
        params: idParams,
        body: transferOwnerRequestSchema,
        response: { 200: patientSchema },
      },
    },
    async (request) =>
      patients.transferOwner(
        requireAuth(request),
        request.params.id,
        request.body.clientId,
        request.body.reason,
      ),
  );

  app.post(
    '/:id/archive',
    {
      config: { access: { kind: 'permission', permission: 'patients.archive' } },
      schema: { params: idParams, response: { 200: patientSchema } },
    },
    async (request) => patients.setArchived(requireAuth(request), request.params.id, true),
  );

  app.post(
    '/:id/restore',
    {
      config: { access: { kind: 'permission', permission: 'patients.archive' } },
      schema: { params: idParams, response: { 200: patientSchema } },
    },
    async (request) => patients.setArchived(requireAuth(request), request.params.id, false),
  );
};
