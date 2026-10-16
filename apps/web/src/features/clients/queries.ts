import { clientListItemSchema, clientSchema, pageSchema } from '@clinica/contracts';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { api } from '../../lib/api';

export interface ListParams {
  q: string;
  page: number;
  archived: boolean;
}

export const PAGE_SIZE = 25;

const listQueryString = ({ q, page, archived }: ListParams, pageSize = PAGE_SIZE) =>
  new URLSearchParams({
    q,
    page: String(page),
    pageSize: String(pageSize),
    archived: String(archived),
  }).toString();

export const clientsQuery = (params: ListParams, pageSize = PAGE_SIZE) =>
  queryOptions({
    queryKey: ['clients', 'list', params, pageSize],
    queryFn: () =>
      api('GET', `/clients?${listQueryString(params, pageSize)}`, pageSchema(clientListItemSchema)),
    placeholderData: keepPreviousData,
  });

export const clientQuery = (id: string) =>
  queryOptions({
    queryKey: ['clients', 'detail', id],
    queryFn: () => api('GET', `/clients/${id}`, clientSchema),
  });

export { listQueryString };
