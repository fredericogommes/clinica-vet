import { pageSchema, patientListItemSchema, patientSchema } from '@clinica/contracts';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { listQueryString, PAGE_SIZE, type ListParams } from '../clients/queries';

export const patientsQuery = (params: ListParams) =>
  queryOptions({
    queryKey: ['patients', 'list', params],
    queryFn: () =>
      api('GET', `/patients?${listQueryString(params)}`, pageSchema(patientListItemSchema)),
    placeholderData: keepPreviousData,
  });

export const patientQuery = (id: string) =>
  queryOptions({
    queryKey: ['patients', 'detail', id],
    queryFn: () => api('GET', `/patients/${id}`, patientSchema),
  });

export { PAGE_SIZE };
