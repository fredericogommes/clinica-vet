import { insurerCandidateSchema, insurerPricesSchema, insurerSchema } from '@clinica/contracts';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../../lib/api';

export const insurersQuery = queryOptions({
  queryKey: ['insurers', 'list'],
  queryFn: () => api('GET', '/insurers', z.array(insurerSchema)),
});

export const insurerPricesQuery = (id: string) =>
  queryOptions({
    queryKey: ['insurers', 'prices', id],
    queryFn: () => api('GET', `/insurers/${id}/prices`, insurerPricesSchema),
  });

export const insurerCandidatesQuery = (q: string) =>
  queryOptions({
    queryKey: ['insurers', 'candidates', q],
    queryFn: () =>
      api('GET', `/insurers/products?q=${encodeURIComponent(q)}`, z.array(insurerCandidateSchema)),
  });
