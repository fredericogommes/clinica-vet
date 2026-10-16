import {
  auditEntrySchema,
  cloneRoleRequestSchema,
  createUserRequestSchema,
  auditQuerySchema,
  pageSchema,
  roleSchema,
  updateRoleRequestSchema,
  updateUserRequestSchema,
  userSchema,
} from '@clinica/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuth } from '../../http/access-guard.js';
import type { AdminService } from './service.js';

const idParams = z.object({ id: z.uuid() });

export const adminRoutes: FastifyPluginAsyncZod<{ admin: AdminService }> = async (
  app,
  { admin },
) => {
  app.get(
    '/roles',
    {
      config: { access: { kind: 'permission', permission: 'admin.roles.view' } },
      schema: { response: { 200: z.array(roleSchema) } },
    },
    async (request) => admin.listRoles(requireAuth(request)),
  );

  app.post(
    '/roles/:id/clone',
    {
      config: { access: { kind: 'permission', permission: 'admin.roles.manage' } },
      schema: { params: idParams, body: cloneRoleRequestSchema, response: { 201: roleSchema } },
    },
    async (request, reply) => {
      const role = await admin.cloneRole(
        requireAuth(request),
        request.params.id,
        request.body.name,
      );
      return reply.status(201).send(role);
    },
  );

  app.put(
    '/roles/:id',
    {
      config: { access: { kind: 'permission', permission: 'admin.roles.manage' } },
      schema: { params: idParams, body: updateRoleRequestSchema, response: { 200: roleSchema } },
    },
    async (request) => admin.updateRole(requireAuth(request), request.params.id, request.body),
  );

  app.delete(
    '/roles/:id',
    {
      config: { access: { kind: 'permission', permission: 'admin.roles.manage' } },
      schema: { params: idParams, response: { 204: z.null() } },
    },
    async (request, reply) => {
      await admin.deleteRole(requireAuth(request), request.params.id);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/users',
    {
      config: { access: { kind: 'permission', permission: 'admin.users.view' } },
      schema: { response: { 200: z.array(userSchema) } },
    },
    async (request) => admin.listUsers(requireAuth(request)),
  );

  app.post(
    '/users',
    {
      config: { access: { kind: 'permission', permission: 'admin.users.manage' } },
      schema: { body: createUserRequestSchema, response: { 201: userSchema } },
    },
    async (request, reply) => {
      const user = await admin.createUser(requireAuth(request), request.body);
      return reply.status(201).send(user);
    },
  );

  app.put(
    '/users/:id',
    {
      config: { access: { kind: 'permission', permission: 'admin.users.manage' } },
      schema: { params: idParams, body: updateUserRequestSchema, response: { 200: userSchema } },
    },
    async (request) => admin.updateUser(requireAuth(request), request.params.id, request.body),
  );

  app.get(
    '/audit',
    {
      config: { access: { kind: 'permission', permission: 'admin.audit.view' } },
      schema: { querystring: auditQuerySchema, response: { 200: pageSchema(auditEntrySchema) } },
    },
    async (request) => {
      const { page, pageSize, entity, entityId } = request.query;
      const result = await admin.listAudit(requireAuth(request), page, pageSize, {
        entity,
        entityId,
      });
      return { ...result, page, pageSize };
    },
  );
};
