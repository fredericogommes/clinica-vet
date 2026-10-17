import {
  stockCountListSchema,
  stockCountSchema,
  stockExitListSchema,
  stockExitSchema,
  stockOptionsSchema,
  type StockExitReason,
} from '@clinica/contracts';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { api } from '../../lib/api';

export interface StockExitSearch {
  situacao: 'ativas' | 'canceladas' | 'todas';
  motivo: StockExitReason | undefined;
  de: string | undefined;
  ate: string | undefined;
  page: number;
}

export const stockOptionsQuery = queryOptions({
  queryKey: ['stock', 'options'],
  queryFn: () => api('GET', '/stock/options', stockOptionsSchema),
});

export const stockExitsQuery = (s: StockExitSearch) =>
  queryOptions({
    queryKey: ['stock', 'exits', s],
    queryFn: () => {
      const params = new URLSearchParams({ situacao: s.situacao, page: String(s.page) });
      for (const [key, value] of [
        ['motivo', s.motivo],
        ['de', s.de],
        ['ate', s.ate],
      ] as const) {
        if (value) params.set(key, value);
      }
      return api('GET', `/stock/exits?${params.toString()}`, stockExitListSchema);
    },
    placeholderData: keepPreviousData,
  });

export const stockExitQuery = (id: string) =>
  queryOptions({
    queryKey: ['stock', 'exit', id],
    queryFn: () => api('GET', `/stock/exits/${id}`, stockExitSchema),
  });

export const stockCountsQuery = (page: number) =>
  queryOptions({
    queryKey: ['stock', 'counts', page],
    queryFn: () => api('GET', `/stock/counts?page=${String(page)}`, stockCountListSchema),
    placeholderData: keepPreviousData,
  });

export const stockCountQuery = (id: string) =>
  queryOptions({
    queryKey: ['stock', 'count', id],
    queryFn: () => api('GET', `/stock/counts/${id}`, stockCountSchema),
  });
