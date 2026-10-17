import {
  boxSchema,
  hospitalizationDetailSchema,
  hospitalizationListSchema,
  hospitalizationOptionsSchema,
  type HospitalizationStatus,
} from '@clinica/contracts';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../../lib/api';

export interface HospitalizationSearch {
  q: string;
  scope: 'current' | 'closed';
  status?: HospitalizationStatus | undefined;
  page: number;
}

export const hospitalizationsQuery = (s: HospitalizationSearch) =>
  queryOptions({
    queryKey: ['hospitalizations', 'list', s],
    queryFn: () => {
      const qs = new URLSearchParams({
        scope: s.scope,
        page: String(s.page),
        pageSize: s.scope === 'current' ? '100' : '25',
      });
      if (s.q) qs.set('q', s.q);
      if (s.status) qs.set('status', s.status);
      return api('GET', `/hospitalizations?${qs.toString()}`, hospitalizationListSchema);
    },
    placeholderData: keepPreviousData,
  });

export const hospitalizationQuery = (id: string) =>
  queryOptions({
    queryKey: ['hospitalizations', 'detail', id],
    queryFn: () => api('GET', `/hospitalizations/${id}`, hospitalizationDetailSchema),
  });

export const boxesQuery = queryOptions({
  queryKey: ['hospitalizations', 'boxes'],
  queryFn: () => api('GET', '/hospitalizations/boxes', z.array(boxSchema)),
});

export const hospitalizationOptionsQuery = queryOptions({
  queryKey: ['hospitalizations', 'options'],
  queryFn: () => api('GET', '/hospitalizations/options', hospitalizationOptionsSchema),
  staleTime: 0,
});

/** Internação aberta do animal, para a ficha clínica mostrar o atalho. */
export const openHospitalizationQuery = (patientId: string) =>
  queryOptions({
    queryKey: ['hospitalizations', 'patient', patientId],
    queryFn: () =>
      api('GET', `/hospitalizations/patient/${patientId}`, z.object({ id: z.uuid() }).nullable()),
  });
