import { paymentMethodInputSchema, paymentMethodSchema } from '@clinica/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../../http/access-guard.js';
import type { PaymentMethodService } from './service.js';

const idParams = z.object({ id: z.uuid() });

/** Cadastro das formas de recebimento; o PDV recebe as ativas pelo contexto de vendas. */
export const paymentMethodRoutes: FastifyPluginAsyncZod<{ methods: PaymentMethodService }> = async (
  app,
  { methods },
) => {
  app.get(
    '/',
    {
      config: { access: { kind: 'permission', permission: 'sales.configure' } },
      schema: { response: { 200: z.array(paymentMethodSchema) } },
    },
    async (request) => methods.list(requireAuth(request), { activeOnly: false }),
  );

  app.post(
    '/',
    {
      config: { access: { kind: 'permission', permission: 'sales.configure' } },
      schema: { body: paymentMethodInputSchema, response: { 201: paymentMethodSchema } },
    },
    async (request, reply) => {
      const method = await methods.create(requireAuth(request), request.body);
      return reply.status(201).send(method);
    },
  );

  app.put(
    '/:id',
    {
      config: { access: { kind: 'permission', permission: 'sales.configure' } },
      schema: {
        params: idParams,
        body: paymentMethodInputSchema,
        response: { 200: paymentMethodSchema },
      },
    },
    async (request) => methods.update(requireAuth(request), request.params.id, request.body),
  );
};
