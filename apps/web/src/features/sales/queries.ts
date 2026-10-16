import {
  pageSchema,
  saleContextSchema,
  saleListItemSchema,
  saleSchema,
  salesSettingsSchema,
  sellableItemSchema,
  type SaleStatus,
} from '@clinica/contracts';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../../lib/api';

export const saleContextQuery = queryOptions({
  queryKey: ['sales', 'context'],
  queryFn: () => api('GET', '/sales/context', saleContextSchema),
  staleTime: 60_000,
});

export const sellableQuery = (q: string) =>
  queryOptions({
    queryKey: ['sales', 'sellable', q],
    queryFn: () =>
      api('GET', `/sales/sellable?q=${encodeURIComponent(q)}`, z.array(sellableItemSchema)),
    placeholderData: keepPreviousData,
  });

export const saleQuery = (id: string) =>
  queryOptions({
    queryKey: ['sales', 'detail', id],
    queryFn: () => api('GET', `/sales/${id}`, saleSchema),
  });

export const salesListQuery = (params: {
  q?: string;
  status?: SaleStatus;
  sinceHours?: number;
  pageSize?: number;
}) =>
  queryOptions({
    queryKey: ['sales', 'list', params],
    queryFn: () => {
      const qs = new URLSearchParams({ pageSize: String(params.pageSize ?? 25) });
      if (params.q) qs.set('q', params.q);
      if (params.status) qs.set('status', params.status);
      if (params.sinceHours) qs.set('sinceHours', String(params.sinceHours));
      return api('GET', `/sales?${qs.toString()}`, pageSchema(saleListItemSchema));
    },
    placeholderData: keepPreviousData,
  });

export const salesSettingsQuery = queryOptions({
  queryKey: ['sales', 'settings'],
  queryFn: () => api('GET', '/sales/settings', salesSettingsSchema),
});
