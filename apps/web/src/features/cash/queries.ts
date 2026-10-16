import {
  cashSessionSchema,
  cashSessionSummarySchema,
  currentCashSchema,
  pageSchema,
  type CashSessionStatus,
} from '@clinica/contracts';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { api } from '../../lib/api';

/** Caixa aberto do usuário nesta unidade. */
export const currentCashQuery = queryOptions({
  queryKey: ['cash', 'current'],
  queryFn: () => api('GET', '/cash/current', currentCashSchema),
});

export const cashListQuery = (params: { status?: CashSessionStatus; from?: string; to?: string }) =>
  queryOptions({
    queryKey: ['cash', 'list', params],
    queryFn: () => {
      const qs = new URLSearchParams({ pageSize: '50' });
      if (params.status) qs.set('status', params.status);
      if (params.from) qs.set('from', params.from);
      if (params.to) qs.set('to', params.to);
      return api('GET', `/cash?${qs.toString()}`, pageSchema(cashSessionSummarySchema));
    },
    placeholderData: keepPreviousData,
  });

export const cashQuery = (id: string) =>
  queryOptions({
    queryKey: ['cash', 'detail', id],
    queryFn: () => api('GET', `/cash/${id}`, cashSessionSchema),
  });
