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

export const auditQuery = (page: number, pageSize: number) =>
  queryOptions({
    queryKey: ['admin', 'audit', page, pageSize],
    queryFn: () =>
      api('GET', `/admin/audit?page=${page}&pageSize=${pageSize}`, pageSchema(auditEntrySchema)),
    placeholderData: keepPreviousData,
  });
