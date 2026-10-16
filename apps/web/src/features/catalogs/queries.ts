import { breedSchema, catalogItemSchema, type CatalogKind } from '@clinica/contracts';
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
