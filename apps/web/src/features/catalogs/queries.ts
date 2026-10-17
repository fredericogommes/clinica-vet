import {
  breedSchema,
  catalogItemSchema,
  pageSchema,
  productListItemSchema,
  type CatalogKind,
} from '@clinica/contracts';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../../lib/api';

export const catalogQuery = (kind: CatalogKind) =>
  queryOptions({
    queryKey: ['catalogs', kind],
    queryFn: () => api('GET', `/catalogs/${kind}`, z.array(catalogItemSchema)),
    staleTime: 5 * 60_000,
  });

export const breedsQuery = (speciesId: string) =>
  queryOptions({
    queryKey: ['catalogs', 'species', speciesId, 'breeds'],
    queryFn: () => api('GET', `/catalogs/species/${speciesId}/breeds`, z.array(breedSchema)),
    staleTime: 5 * 60_000,
  });

/**
 * Serviços ativos, para ligar ao tipo de atendimento e ao exame [RN-19]. Busca todas as páginas:
 * a lista aceita no máximo 100 por vez, e a clínica pode ter mais serviços que isso.
 */
export const servicesQuery = queryOptions({
  queryKey: ['products', 'list', 'services-for-types'],
  queryFn: async () => {
    const items = [];
    for (let page = 1; ; page++) {
      const result = await api(
        'GET',
        `/products?kind=service&pageSize=100&page=${String(page)}`,
        pageSchema(productListItemSchema),
      );
      items.push(...result.items);
      if (result.items.length === 0 || items.length >= result.total) return items;
    }
  },
  retry: false,
});
