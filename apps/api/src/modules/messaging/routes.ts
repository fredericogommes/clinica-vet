import {
  messageListSchema,
  messageQuerySchema,
  messageRunSchema,
  messageSettingInputSchema,
  messagingSettingsSchema,
} from '@clinica/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../../http/access-guard.js';
import type { MessagingService } from './service.js';

const idParams = z.object({ id: z.uuid() });

/** Mensagens automáticas [RN-34]: configuração dos gatilhos e fila de envio. */
export const messagingRoutes: FastifyPluginAsyncZod<{ messaging: MessagingService }> = async (
  app,
  { messaging },
) => {
  app.get(
    '/settings',
    {
      config: { access: { kind: 'permission', permission: 'messages.configure' } },
      schema: { response: { 200: messagingSettingsSchema } },
    },
    async (request) => messaging.view(requireAuth(request)),
  );

  app.put(
    '/settings',
    {
      config: { access: { kind: 'permission', permission: 'messages.configure' } },
      schema: { body: messageSettingInputSchema, response: { 200: messagingSettingsSchema } },
    },
    async (request) => messaging.save(requireAuth(request), request.body),
  );

  /** Gera e envia agora, sem esperar a próxima rodada automática. */
  app.post(
    '/run',
    {
      config: { access: { kind: 'permission', permission: 'messages.configure' } },
      schema: { response: { 200: messageRunSchema } },
    },
    async (request) => messaging.run(requireAuth(request).organizationId),
  );

  app.get(
    '/',
    {
      config: { access: { kind: 'permission', permission: 'messages.view' } },
      schema: { querystring: messageQuerySchema, response: { 200: messageListSchema } },
    },
    async (request) => messaging.list(requireAuth(request), request.query),
  );

  app.post(
    '/:id/sent',
    {
      config: { access: { kind: 'permission', permission: 'messages.view' } },
      schema: { params: idParams, response: { 204: z.null() } },
    },
    async (request, reply) => {
      await messaging.markSent(requireAuth(request), request.params.id);
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/:id/cancel',
    {
      config: { access: { kind: 'permission', permission: 'messages.view' } },
      schema: { params: idParams, response: { 204: z.null() } },
    },
    async (request, reply) => {
      await messaging.cancel(requireAuth(request), request.params.id);
      return reply.status(204).send(null);
    },
  );
};
