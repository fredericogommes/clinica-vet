import {
  commissionOpenSchema,
  commissionSettingsSchema,
  commissionStatementListSchema,
  commissionStatementSchema,
  myCommissionsSchema,
  type commissionStatementSituations,
} from '@clinica/contracts';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { api } from '../../lib/api';

export interface CommissionStatementSearch {
  situacao: (typeof commissionStatementSituations)[number];
  page: number;
}

export const commissionSettingsQuery = queryOptions({
  queryKey: ['commissions', 'settings'],
  queryFn: () => api('GET', '/commissions/settings', commissionSettingsSchema),
});

export const commissionOpenQuery = (ate: string | undefined) =>
  queryOptions({
    queryKey: ['commissions', 'open', ate ?? null],
    queryFn: () => api('GET', `/commissions/open${ate ? `?ate=${ate}` : ''}`, commissionOpenSchema),
    placeholderData: keepPreviousData,
  });

export const commissionStatementsQuery = (s: CommissionStatementSearch) =>
  queryOptions({
    queryKey: ['commissions', 'statements', s],
    queryFn: () =>
      api(
        'GET',
        `/commissions/statements?situacao=${s.situacao}&page=${String(s.page)}`,
        commissionStatementListSchema,
      ),
    placeholderData: keepPreviousData,
  });

export const commissionStatementQuery = (id: string) =>
  queryOptions({
    queryKey: ['commissions', 'statement', id],
    queryFn: () => api('GET', `/commissions/statements/${id}`, commissionStatementSchema),
  });

export const myCommissionsQuery = queryOptions({
  queryKey: ['commissions', 'mine'],
  queryFn: () => api('GET', '/commissions/mine', myCommissionsSchema),
});
