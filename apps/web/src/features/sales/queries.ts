import {
  clientBalancesSchema,
  clientDebtListSchema,
  pageSchema,
  paymentMethodSchema,
  patientSalesSchema,
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

export const patientSalesQuery = (patientId: string) =>
  queryOptions({
    queryKey: ['sales', 'patient', patientId],
    queryFn: () => api('GET', `/sales/patient/${patientId}`, patientSalesSchema),
  });

/** Recebimentos [p.10]: o que ficou na conta do cliente, com busca e filtro de vencidos. */
export const clientDebtsQuery = (params: {
  q: string;
  clientId?: string | undefined;
  overdue: boolean;
  page: number;
}) =>
  queryOptions({
    queryKey: ['sales', 'debts', 'list', params],
    queryFn: () => {
      const qs = new URLSearchParams({ page: String(params.page), pageSize: '25' });
      if (params.q) qs.set('q', params.q);
      if (params.clientId) qs.set('clientId', params.clientId);
      if (params.overdue) qs.set('overdue', 'true');
      return api('GET', `/sales/debts?${qs.toString()}`, clientDebtListSchema);
    },
    placeholderData: keepPreviousData,
  });

export const clientBalancesQuery = queryOptions({
  queryKey: ['sales', 'debts', 'clients'],
  queryFn: () => api('GET', '/sales/debts/clients', clientBalancesSchema),
});

/** Formas para receber a conta do cliente: as ativas, sem a própria conta. */
export const settleMethodsQuery = queryOptions({
  queryKey: ['sales', 'debts', 'methods'],
  queryFn: () => api('GET', '/sales/debts/methods', z.array(paymentMethodSchema)),
  staleTime: 60_000,
});
