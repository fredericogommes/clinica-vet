import {
  clinicalEventInputSchema,
  clinicalEventSchema,
  clinicalRecordSchema,
  clinicalSearchItemSchema,
  clinicalSearchQuerySchema,
  closeProtocolSchema,
  examFormSchema,
  examSeriesQuerySchema,
  examSeriesSchema,
  pageSchema,
  protocolSchema,
  PHOTO_MAX_BYTES,
  photoContentTypes,
  renderedTemplateSchema,
  renderQuerySchema,
  timelineQuerySchema,
  timelineSchema,
  vaccinationFormSchema,
  voidEventSchema,
} from '@clinica/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../../core/errors.js';
import { requireAuth } from '../../http/access-guard.js';
import { sniffImageType } from './image-type.js';
import type { ClinicalService } from './service.js';

const idParams = z.object({ id: z.uuid() });
const patientParams = z.object({ patientId: z.uuid() });
const photoQuery = z.object({
  caption: z.string().trim().max(300).default(''),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
});

export const clinicalRoutes: FastifyPluginAsyncZod<{ clinical: ClinicalService }> = async (
  app,
  { clinical },
) => {
  // A imagem chega crua no corpo; o parser vale só dentro deste módulo e com limite próprio.
  app.addContentTypeParser(
    [...photoContentTypes],
    { parseAs: 'buffer', bodyLimit: PHOTO_MAX_BYTES },
    (_request, body, done) => {
      done(null, body);
    },
  );

  app.get(
    '/patients/:patientId/vaccination-form/:vaccineId',
    {
      config: { access: { kind: 'permission', permission: 'clinical.record' } },
      schema: {
        params: z.object({ patientId: z.uuid(), vaccineId: z.uuid() }),
        querystring: z.object({ occurredAt: z.iso.datetime({ offset: true }).optional() }),
        response: { 200: vaccinationFormSchema },
      },
    },
    async (request) =>
      clinical.vaccinationForm(
        requireAuth(request),
        request.params.patientId,
        request.params.vaccineId,
        request.query.occurredAt,
      ),
  );

  app.get(
    '/patients/:patientId/protocols',
    {
      config: { access: { kind: 'permission', permission: 'clinical.view' } },
      schema: { params: patientParams, response: { 200: z.array(protocolSchema) } },
    },
    async (request) => clinical.protocols(requireAuth(request), request.params.patientId),
  );

  app.post(
    '/patients/:patientId/protocols/:vaccineId/close',
    {
      config: { access: { kind: 'permission', permission: 'clinical.record' } },
      schema: {
        params: z.object({ patientId: z.uuid(), vaccineId: z.uuid() }),
        body: closeProtocolSchema,
        response: { 200: z.array(protocolSchema) },
      },
    },
    async (request) =>
      clinical.closeProtocol(
        requireAuth(request),
        request.params.patientId,
        request.params.vaccineId,
        request.body.reason,
      ),
  );

  app.get(
    '/patients/:patientId/exam-form/:examId',
    {
      config: { access: { kind: 'permission', permission: 'clinical.record' } },
      schema: {
        params: z.object({ patientId: z.uuid(), examId: z.uuid() }),
        querystring: z.object({ occurredAt: z.iso.datetime({ offset: true }).optional() }),
        response: { 200: examFormSchema },
      },
    },
    async (request) =>
      clinical.examForm(
        requireAuth(request),
        request.params.patientId,
        request.params.examId,
        request.query.occurredAt,
      ),
  );

  app.get(
    '/patients/:patientId/exam-series',
    {
      config: { access: { kind: 'permission', permission: 'clinical.view' } },
      schema: {
        params: patientParams,
        querystring: examSeriesQuerySchema,
        response: { 200: examSeriesSchema },
      },
    },
    async (request) =>
      clinical.examSeries(
        requireAuth(request),
        request.params.patientId,
        request.query.attributeId,
      ),
  );

  app.get(
    '/search',
    {
      config: { access: { kind: 'permission', permission: 'clinical.view' } },
      schema: {
        querystring: clinicalSearchQuerySchema,
        response: { 200: pageSchema(clinicalSearchItemSchema) },
      },
    },
    async (request) => clinical.search(requireAuth(request), request.query),
  );

  app.get(
    '/patients/:patientId',
    {
      config: { access: { kind: 'permission', permission: 'clinical.view' } },
      schema: { params: patientParams, response: { 200: clinicalRecordSchema } },
    },
    async (request) => clinical.record(requireAuth(request), request.params.patientId),
  );

  app.get(
    '/patients/:patientId/timeline',
    {
      config: { access: { kind: 'permission', permission: 'clinical.view' } },
      schema: {
        params: patientParams,
        querystring: timelineQuerySchema,
        response: { 200: timelineSchema },
      },
    },
    async (request) =>
      clinical.timeline(requireAuth(request), request.params.patientId, request.query),
  );

  app.get(
    '/patients/:patientId/render',
    {
      config: { access: { kind: 'permission', permission: 'clinical.record' } },
      schema: {
        params: patientParams,
        querystring: renderQuerySchema,
        response: { 200: renderedTemplateSchema },
      },
    },
    async (request) =>
      clinical.render(requireAuth(request), request.params.patientId, request.query),
  );

  app.post(
    '/patients/:patientId/events',
    {
      config: { access: { kind: 'permission', permission: 'clinical.record' } },
      schema: {
        params: patientParams,
        body: clinicalEventInputSchema,
        response: { 201: clinicalEventSchema },
      },
    },
    async (request, reply) => {
      const event = await clinical.create(
        requireAuth(request),
        request.params.patientId,
        request.body,
      );
      return reply.status(201).send(event);
    },
  );

  app.post(
    '/patients/:patientId/photos',
    {
      config: {
        access: { kind: 'permission', permission: 'clinical.record' },
        rateLimit: { max: 60, timeWindow: '1 minute' },
      },
      bodyLimit: PHOTO_MAX_BYTES,
      schema: {
        params: patientParams,
        querystring: photoQuery,
        response: { 201: clinicalEventSchema },
      },
    },
    async (request, reply) => {
      const data = request.body;
      const contentType = Buffer.isBuffer(data) ? sniffImageType(data) : null;
      if (!Buffer.isBuffer(data) || !contentType) {
        throw new AppError('validation_failed', 'Envie uma imagem JPEG, PNG ou WebP.');
      }
      const event = await clinical.addPhoto(requireAuth(request), request.params.patientId, {
        data,
        contentType,
        caption: request.query.caption,
        occurredAt: request.query.occurredAt ?? null,
      });
      return reply.status(201).send(event);
    },
  );

  app.get(
    '/events/:id',
    {
      config: { access: { kind: 'permission', permission: 'clinical.view' } },
      schema: { params: idParams, response: { 200: clinicalEventSchema } },
    },
    async (request) => clinical.get(requireAuth(request), request.params.id),
  );

  app.put(
    '/events/:id',
    {
      config: { access: { kind: 'permission', permission: 'clinical.record' } },
      schema: {
        params: idParams,
        body: clinicalEventInputSchema,
        response: { 200: clinicalEventSchema },
      },
    },
    async (request) => clinical.update(requireAuth(request), request.params.id, request.body),
  );

  app.delete(
    '/events/:id',
    {
      config: { access: { kind: 'permission', permission: 'clinical.record' } },
      schema: { params: idParams },
    },
    async (request, reply) => {
      await clinical.discard(requireAuth(request), request.params.id);
      return reply.status(204).send();
    },
  );

  app.post(
    '/events/:id/void',
    {
      config: { access: { kind: 'permission', permission: 'clinical.record' } },
      schema: { params: idParams, body: voidEventSchema, response: { 200: clinicalEventSchema } },
    },
    async (request) =>
      clinical.invalidate(requireAuth(request), request.params.id, request.body.reason),
  );

  app.get(
    '/files/:id',
    {
      config: { access: { kind: 'permission', permission: 'clinical.view' } },
      schema: { params: idParams },
    },
    async (request, reply) => {
      const file = await clinical.file(requireAuth(request), request.params.id);
      return reply
        .header('content-type', file.contentType)
        .header('content-disposition', 'inline')
        .header('cache-control', 'private, max-age=86400, immutable')
        .header('etag', `"${file.sha256}"`)
        .header('content-security-policy', "default-src 'none'; sandbox")
        .send(file.data);
    },
  );
};
