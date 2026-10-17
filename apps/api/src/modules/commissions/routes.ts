import {
  commissionOpenQuerySchema,
  commissionOpenSchema,
  commissionSettingsInputSchema,
  commissionSettingsSchema,
  commissionStaffInputSchema,
  commissionStatementCloseSchema,
  commissionStatementCreateSchema,
  commissionStatementListSchema,
  commissionStatementPaySchema,
  commissionStatementQuerySchema,
  commissionStatementRefreshSchema,
  commissionStatementReviewSchema,
  commissionStatementSchema,
  myCommissionsSchema,
} from '@clinica/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../../http/access-guard.js';
import type { CommissionsService } from './service.js';

const idParams = z.object({ id: z.uuid() });
const view = { access: { kind: 'permission', permission: 'commissions.view' } } as const;
const manage = { access: { kind: 'permission', permission: 'commissions.manage' } } as const;
const configure = {
  access: { kind: 'permission', permission: 'commissions.configure' },
} as const;
const own = { access: { kind: 'permission', permission: 'commissions.view_own' } } as const;
// O extrato é visto por quem vê todos ou pelo próprio profissional; a regra fica no serviço.
const signedIn = { access: { kind: 'authenticated' } } as const;

export const commissionRoutes: FastifyPluginAsyncZod<{ commissions: CommissionsService }> = async (
  app,
  { commissions },
) => {
  app.get(
    '/settings',
    { config: configure, schema: { response: { 200: commissionSettingsSchema } } },
    async (request) => commissions.settings(requireAuth(request)),
  );

  app.put(
    '/settings',
    {
      config: configure,
      schema: { body: commissionSettingsInputSchema, response: { 200: commissionSettingsSchema } },
    },
    async (request) => commissions.updateSettings(requireAuth(request), request.body),
  );

  app.put(
    '/staff/:id',
    {
      config: configure,
      schema: {
        params: idParams,
        body: commissionStaffInputSchema,
        response: { 200: commissionSettingsSchema },
      },
    },
    async (request) => commissions.setStaff(requireAuth(request), request.params.id, request.body),
  );

  app.get(
    '/open',
    {
      config: view,
      schema: { querystring: commissionOpenQuerySchema, response: { 200: commissionOpenSchema } },
    },
    async (request) => commissions.open(requireAuth(request), request.query.ate),
  );

  app.get(
    '/mine',
    { config: own, schema: { response: { 200: myCommissionsSchema } } },
    async (request) => commissions.mine(requireAuth(request)),
  );

  app.get(
    '/statements',
    {
      config: view,
      schema: {
        querystring: commissionStatementQuerySchema,
        response: { 200: commissionStatementListSchema },
      },
    },
    async (request) => commissions.list(requireAuth(request), request.query),
  );

  app.post(
    '/statements',
    {
      config: manage,
      schema: {
        body: commissionStatementCreateSchema,
        response: { 201: commissionStatementSchema },
      },
    },
    async (request, reply) => {
      const created = await commissions.create(requireAuth(request), request.body);
      return reply.status(201).send(created);
    },
  );

  app.get(
    '/statements/:id',
    {
      config: signedIn,
      schema: { params: idParams, response: { 200: commissionStatementSchema } },
    },
    async (request) => commissions.read(requireAuth(request), request.params.id),
  );

  app.post(
    '/statements/:id/refresh',
    {
      config: manage,
      schema: {
        params: idParams,
        body: commissionStatementRefreshSchema,
        response: { 200: commissionStatementSchema },
      },
    },
    async (request) => commissions.refresh(requireAuth(request), request.params.id, request.body),
  );

  app.delete(
    '/statements/:id',
    { config: manage, schema: { params: idParams } },
    async (request, reply) => {
      await commissions.discard(requireAuth(request), request.params.id);
      return reply.status(204).send();
    },
  );

  app.post(
    '/statements/:id/close',
    {
      config: manage,
      schema: {
        params: idParams,
        body: commissionStatementCloseSchema,
        response: { 200: commissionStatementSchema },
      },
    },
    async (request) => commissions.close(requireAuth(request), request.params.id, request.body),
  );

  app.post(
    '/statements/:id/pay',
    {
      config: manage,
      schema: {
        params: idParams,
        body: commissionStatementPaySchema,
        response: { 200: commissionStatementSchema },
      },
    },
    async (request) => commissions.pay(requireAuth(request), request.params.id, request.body),
  );

  app.post(
    '/statements/:id/unpay',
    { config: manage, schema: { params: idParams, response: { 200: commissionStatementSchema } } },
    async (request) => commissions.unpay(requireAuth(request), request.params.id),
  );

  app.post(
    '/statements/:id/review',
    {
      config: manage,
      schema: {
        params: idParams,
        body: commissionStatementReviewSchema,
        response: { 200: commissionStatementSchema },
      },
    },
    async (request) => commissions.review(requireAuth(request), request.params.id, request.body),
  );

  app.post(
    '/statements/:id/archive',
    { config: manage, schema: { params: idParams, response: { 200: commissionStatementSchema } } },
    async (request) => commissions.archive(requireAuth(request), request.params.id),
  );
};
