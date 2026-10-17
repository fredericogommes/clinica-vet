import {
  purchaseListSchema,
  purchaseOptionsSchema,
  purchaseSchema,
  type PurchaseSituation,
} from '@clinica/contracts';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { api } from '../../lib/api';

/** Filtros da lista de compras, como ficam na URL. */
export interface PurchaseSearch {
  situacao: PurchaseSituation;
  q: string;
  de: string | undefined;
  ate: string | undefined;
  page: number;
}

export const PURCHASE_PAGE_SIZE = 50;

export const purchaseOptionsQuery = queryOptions({
  queryKey: ['purchases', 'options'],
  queryFn: () => api('GET', '/purchases/options', purchaseOptionsSchema),
});

export const purchasesQuery = (s: PurchaseSearch) =>
  queryOptions({
    queryKey: ['purchases', 'list', s],
    queryFn: () => {
      const params = new URLSearchParams({
        situacao: s.situacao,
        page: String(s.page),
        pageSize: String(PURCHASE_PAGE_SIZE),
      });
      for (const [key, value] of [
        ['q', s.q],
        ['de', s.de],
        ['ate', s.ate],
      ] as const) {
        if (value) params.set(key, value);
      }
      return api('GET', `/purchases?${params.toString()}`, purchaseListSchema);
    },
    placeholderData: keepPreviousData,
  });

export const purchaseQuery = (id: string) =>
  queryOptions({
    queryKey: ['purchases', 'detail', id],
    queryFn: () => api('GET', `/purchases/${id}`, purchaseSchema),
  });
