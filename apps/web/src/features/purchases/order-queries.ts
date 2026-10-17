import {
  purchaseOrderListSchema,
  purchaseOrderOptionsSchema,
  purchaseOrderSchema,
  purchaseSuggestionSchema,
  type purchaseOrderSituations,
} from '@clinica/contracts';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { api } from '../../lib/api';

export interface PurchaseOrderSearch {
  situacao: (typeof purchaseOrderSituations)[number];
  page: number;
}

export const purchaseOrderOptionsQuery = queryOptions({
  queryKey: ['purchase-orders', 'options'],
  queryFn: () => api('GET', '/purchase-orders/options', purchaseOrderOptionsSchema),
});

export const purchaseOrdersQuery = (s: PurchaseOrderSearch) =>
  queryOptions({
    queryKey: ['purchase-orders', 'list', s],
    queryFn: () =>
      api(
        'GET',
        `/purchase-orders?situacao=${s.situacao}&page=${String(s.page)}`,
        purchaseOrderListSchema,
      ),
    placeholderData: keepPreviousData,
  });

export const purchaseOrderQuery = (id: string) =>
  queryOptions({
    queryKey: ['purchase-orders', 'detail', id],
    queryFn: () => api('GET', `/purchase-orders/${id}`, purchaseOrderSchema),
  });

export const purchaseSuggestionQuery = (supplierId: string) =>
  queryOptions({
    queryKey: ['purchase-orders', 'suggestion', supplierId],
    queryFn: () =>
      api(
        'GET',
        `/purchase-orders/suggestion${supplierId ? `?supplierId=${supplierId}` : ''}`,
        purchaseSuggestionSchema,
      ),
  });
