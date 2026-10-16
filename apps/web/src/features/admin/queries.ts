import { auditEntrySchema, pageSchema, roleSchema, userSchema } from '@clinica/contracts';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../../lib/api';

export const rolesQuery = queryOptions({
  queryKey: ['admin', 'roles'],
  queryFn: () => api('GET', '/admin/roles', z.array(roleSchema)),
});

export const usersQuery = queryOptions({
  queryKey: ['admin', 'users'],
  queryFn: () => api('GET', '/admin/users', z.array(userSchema)),
});

export const auditQuery = (
  page: number,
  pageSize: number,
  filter?: { entity: string; entityId: string },
) =>
  queryOptions({
    queryKey: ['admin', 'audit', page, pageSize, filter?.entity, filter?.entityId],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (filter) {
        params.set('entity', filter.entity);
        params.set('entityId', filter.entityId);
      }
      return api('GET', `/admin/audit?${params.toString()}`, pageSchema(auditEntrySchema));
    },
    placeholderData: keepPreviousData,
  });
