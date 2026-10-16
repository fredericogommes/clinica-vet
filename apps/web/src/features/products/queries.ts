import {
  pageSchema,
  productListItemSchema,
  productSchema,
  type ProductKind,
  type ServiceKind,
} from '@clinica/contracts';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../../lib/api';

export interface ProductListParams {
  q: string;
  kind: ProductKind | undefined;
  serviceKind: ServiceKind | undefined;
  groupId: string | undefined;
  priceList: boolean;
  archived: boolean;
  page: number;
}

export const PRODUCTS_PAGE_SIZE = 25;

export const productsQuery = (params: ProductListParams) =>
  queryOptions({
    queryKey: ['products', 'list', params],
    queryFn: () => {
      const qs = new URLSearchParams({
        q: params.q,
        priceList: String(params.priceList),
        archived: String(params.archived),
        page: String(params.page),
        pageSize: String(PRODUCTS_PAGE_SIZE),
      });
      if (params.kind) qs.set('kind', params.kind);
      if (params.serviceKind) qs.set('serviceKind', params.serviceKind);
      if (params.groupId) qs.set('groupId', params.groupId);
      return api('GET', `/products?${qs.toString()}`, pageSchema(productListItemSchema));
    },
    placeholderData: keepPreviousData,
  });

export const productQuery = (id: string) =>
  queryOptions({
    queryKey: ['products', 'detail', id],
    queryFn: () => api('GET', `/products/${id}`, productSchema),
  });

export const professionalsQuery = () =>
  queryOptions({
    queryKey: ['products', 'professionals'],
    queryFn: () =>
      api('GET', '/products/professionals', z.array(z.object({ id: z.uuid(), name: z.string() }))),
    staleTime: 60_000,
  });
