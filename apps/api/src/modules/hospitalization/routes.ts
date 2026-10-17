import {
  admitSchema,
  applyTemplateSchema,
  boxInputSchema,
  boxSchema,
  cancelHospitalizationSchema,
  closeHospitalizationSchema,
  executeDoseSchema,
  executionMapQuerySchema,
  executionMapSchema,
  hospitalizationDetailSchema,
  hospitalizationEntryInputSchema,
  hospitalizationListQuerySchema,
  hospitalizationListSchema,
  hospitalizationOptionsSchema,
  moveBoxSchema,
  prescriptionDayQuerySchema,
  prescriptionDaySchema,
  prescriptionInputSchema,
  prescriptionTemplateInputSchema,
  prescriptionTemplateSchema,
  stopPrescriptionSchema,
  updateHospitalizationSchema,
} from '@clinica/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../../http/access-guard.js';
import type { PrescriptionService } from './prescriptions.js';
import type { HospitalizationService } from './service.js';

const idParams = z.object({ id: z.uuid() });
const view = { access: { kind: 'permission', permission: 'hospitalization.view' } } as const;
const manage = { access: { kind: 'permission', permission: 'hospitalization.manage' } } as const;
const record = { access: { kind: 'permission', permission: 'hospitalization.record' } } as const;
const prescribe = {
  access: { kind: 'permission', permission: 'hospitalization.prescribe' },
} as const;
const prescriptionParams = z.object({ id: z.uuid(), prescriptionId: z.uuid() });
const created = z.object({ id: z.uuid() });
const configure = {
  access: { kind: 'permission', permission: 'hospitalization.configure' },
} as const;

/** Internação [p.14–16]: boxes, painel, ficha, histórico, desfecho, prescrição e mapa. */
export const hospitalizationRoutes: FastifyPluginAsyncZod<{
  hospitalizations: HospitalizationService;
  prescriptions: PrescriptionService;
}> = async (app, { hospitalizations, prescriptions }) => {
  app.get(
    '/boxes',
    { config: view, schema: { response: { 200: z.array(boxSchema) } } },
    async (request) => hospitalizations.listBoxes(requireAuth(request)),
  );
  app.post(
    '/boxes',
    { config: configure, schema: { body: boxInputSchema, response: { 201: boxSchema } } },
    async (request, reply) => {
      const box = await hospitalizations.saveBox(requireAuth(request), null, request.body);
      return reply.status(201).send(box);
    },
  );
  app.put(
    '/boxes/:id',
    {
      config: configure,
      schema: { params: idParams, body: boxInputSchema, response: { 200: boxSchema } },
    },
    async (request) =>
      hospitalizations.saveBox(requireAuth(request), request.params.id, request.body),
  );

  app.get(
    '/options',
    { config: manage, schema: { response: { 200: hospitalizationOptionsSchema } } },
    async (request) => hospitalizations.options(requireAuth(request)),
  );
  app.get(
    '/',
    {
      config: view,
      schema: {
        querystring: hospitalizationListQuerySchema,
        response: { 200: hospitalizationListSchema },
      },
    },
    async (request) => hospitalizations.list(requireAuth(request), request.query),
  );
  app.get(
    '/patient/:patientId',
    {
      config: view,
      schema: {
        params: z.object({ patientId: z.uuid() }),
        response: { 200: z.object({ id: z.uuid() }).nullable() },
      },
    },
    async (request) => hospitalizations.openFor(requireAuth(request), request.params.patientId),
  );
  app.get(
    '/:id',
    { config: view, schema: { params: idParams, response: { 200: hospitalizationDetailSchema } } },
    async (request) => hospitalizations.get(requireAuth(request), request.params.id),
  );
  app.post(
    '/',
    {
      config: manage,
      schema: { body: admitSchema, response: { 201: hospitalizationDetailSchema } },
    },
    async (request, reply) => {
      const created = await hospitalizations.admit(requireAuth(request), request.body);
      return reply.status(201).send(created);
    },
  );
  app.put(
    '/:id',
    {
      config: manage,
      schema: {
        params: idParams,
        body: updateHospitalizationSchema,
        response: { 200: hospitalizationDetailSchema },
      },
    },
    async (request) =>
      hospitalizations.update(requireAuth(request), request.params.id, request.body),
  );
  app.post(
    '/:id/box',
    {
      config: manage,
      schema: {
        params: idParams,
        body: moveBoxSchema,
        response: { 200: hospitalizationDetailSchema },
      },
    },
    async (request) =>
      hospitalizations.moveBox(requireAuth(request), request.params.id, request.body.boxId),
  );
  app.post(
    '/:id/close',
    {
      config: manage,
      schema: {
        params: idParams,
        body: closeHospitalizationSchema,
        response: { 200: hospitalizationDetailSchema },
      },
    },
    async (request) =>
      hospitalizations.close(requireAuth(request), request.params.id, request.body),
  );
  app.post(
    '/:id/cancel',
    {
      config: manage,
      schema: {
        params: idParams,
        body: cancelHospitalizationSchema,
        response: { 200: hospitalizationDetailSchema },
      },
    },
    async (request) =>
      hospitalizations.cancel(requireAuth(request), request.params.id, request.body.reason),
  );
  app.post(
    '/:id/entries',
    {
      config: record,
      schema: {
        params: idParams,
        body: hospitalizationEntryInputSchema,
        response: { 200: hospitalizationDetailSchema },
      },
    },
    async (request) =>
      hospitalizations.addEntry(requireAuth(request), request.params.id, request.body),
  );

  app.get(
    '/execution-map',
    {
      config: view,
      schema: { querystring: executionMapQuerySchema, response: { 200: executionMapSchema } },
    },
    async (request) => prescriptions.map(requireAuth(request), request.query),
  );
  app.get(
    '/:id/prescriptions',
    {
      config: view,
      schema: {
        params: idParams,
        querystring: prescriptionDayQuerySchema,
        response: { 200: prescriptionDaySchema },
      },
    },
    async (request) =>
      prescriptions.day(requireAuth(request), request.params.id, request.query.date),
  );
  app.post(
    '/:id/prescriptions',
    {
      config: prescribe,
      schema: { params: idParams, body: prescriptionInputSchema, response: { 201: created } },
    },
    async (request, reply) => {
      const result = await prescriptions.prescribe(
        requireAuth(request),
        request.params.id,
        request.body,
      );
      return reply.status(201).send(result);
    },
  );
  app.post(
    '/:id/prescriptions/:prescriptionId/stop',
    {
      config: prescribe,
      schema: {
        params: prescriptionParams,
        body: stopPrescriptionSchema,
        response: { 200: created },
      },
    },
    async (request) =>
      prescriptions.stop(
        requireAuth(request),
        request.params.id,
        request.params.prescriptionId,
        request.body.reason,
      ),
  );
  app.post(
    '/:id/prescriptions/:prescriptionId/executions',
    {
      config: record,
      schema: { params: prescriptionParams, body: executeDoseSchema, response: { 201: created } },
    },
    async (request, reply) => {
      const result = await prescriptions.execute(
        requireAuth(request),
        request.params.id,
        request.params.prescriptionId,
        request.body,
      );
      return reply.status(201).send(result);
    },
  );

  app.get(
    '/prescription-templates',
    { config: view, schema: { response: { 200: z.array(prescriptionTemplateSchema) } } },
    async (request) => prescriptions.listTemplates(requireAuth(request)),
  );
  app.post(
    '/prescription-templates',
    {
      config: prescribe,
      schema: {
        body: prescriptionTemplateInputSchema,
        response: { 200: prescriptionTemplateSchema },
      },
    },
    async (request) => prescriptions.saveTemplate(requireAuth(request), request.body),
  );
  app.delete(
    '/prescription-templates/:id',
    { config: prescribe, schema: { params: idParams } },
    async (request, reply) => {
      await prescriptions.deleteTemplate(requireAuth(request), request.params.id);
      return reply.status(204).send();
    },
  );
  app.post(
    '/:id/prescriptions/template',
    {
      config: prescribe,
      schema: {
        params: idParams,
        body: applyTemplateSchema,
        response: { 201: z.object({ ids: z.array(z.uuid()) }) },
      },
    },
    async (request, reply) => {
      const result = await prescriptions.applyTemplate(
        requireAuth(request),
        request.params.id,
        request.body,
      );
      return reply.status(201).send(result);
    },
  );
};
