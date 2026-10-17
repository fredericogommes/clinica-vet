import {
  clinicalEventSchema,
  clinicalRecordSchema,
  clinicalSearchItemSchema,
  clinicalTemplateSchema,
  examFormSchema,
  examListItemSchema,
  examSeriesSchema,
  pageSchema,
  pathologySchema,
  renderedTemplateSchema,
  timelineSchema,
  type ClinicalEventKind,
} from '@clinica/contracts';
import { infiniteQueryOptions, keepPreviousData, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../../lib/api';

export const clinicalSearchQuery = (params: { client: string; patient: string; page: number }) =>
  queryOptions({
    queryKey: ['clinical', 'search', params],
    queryFn: () => {
      const search = new URLSearchParams({
        client: params.client,
        patient: params.patient,
        page: String(params.page),
      });
      return api(
        'GET',
        `/clinical/search?${search.toString()}`,
        pageSchema(clinicalSearchItemSchema),
      );
    },
    placeholderData: keepPreviousData,
  });

export const clinicalRecordQuery = (patientId: string) =>
  queryOptions({
    queryKey: ['clinical', 'record', patientId],
    queryFn: () => api('GET', `/clinical/patients/${patientId}`, clinicalRecordSchema),
  });

export interface TimelineFilters {
  from: string;
  to: string;
  kinds: ClinicalEventKind[];
  professionalId: string;
  order: 'desc' | 'asc';
}

export const timelineQuery = (patientId: string, filters: TimelineFilters) =>
  infiniteQueryOptions({
    queryKey: ['clinical', 'timeline', patientId, filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams({ order: filters.order, limit: '30' });
      if (filters.from) search.set('from', filters.from);
      if (filters.to) search.set('to', filters.to);
      if (filters.kinds.length) search.set('kinds', filters.kinds.join(','));
      if (filters.professionalId) search.set('professionalId', filters.professionalId);
      if (pageParam) search.set('cursor', pageParam);
      return api(
        'GET',
        `/clinical/patients/${patientId}/timeline?${search.toString()}`,
        timelineSchema,
      );
    },
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  });

export const clinicalEventQuery = (eventId: string) =>
  queryOptions({
    queryKey: ['clinical', 'event', eventId],
    queryFn: () => api('GET', `/clinical/events/${eventId}`, clinicalEventSchema),
  });

export const pathologiesQuery = queryOptions({
  queryKey: ['catalogs', 'pathologies'],
  queryFn: () => api('GET', '/catalogs/pathologies', z.array(pathologySchema)),
  staleTime: 5 * 60_000,
});

export const clinicalTemplatesQuery = queryOptions({
  queryKey: ['catalogs', 'clinical-templates'],
  queryFn: () => api('GET', '/catalogs/clinical-templates', z.array(clinicalTemplateSchema)),
  staleTime: 5 * 60_000,
});

/** Texto inicial já preenchido com os dados do animal. */
export const renderTemplate = (
  patientId: string,
  source: { typeId: string } | { templateId: string },
) => {
  const search = new URLSearchParams(source);
  return api(
    'GET',
    `/clinical/patients/${patientId}/render?${search.toString()}`,
    renderedTemplateSchema,
  );
};

/** Exames ativos para o registro de resultado; o cadastro completo fica em Cadastros. */
export const examsQuery = queryOptions({
  queryKey: ['catalogs', 'exams'],
  queryFn: () => api('GET', '/exams', z.array(examListItemSchema)),
  staleTime: 60_000,
});

/** Campos do exame e a faixa de referência que vale para o animal na data do resultado. */
export const examFormQuery = (patientId: string, examId: string, occurredAt: string) =>
  queryOptions({
    queryKey: ['clinical', 'exam-form', patientId, examId, occurredAt],
    queryFn: () => {
      const search = occurredAt ? `?${new URLSearchParams({ occurredAt }).toString()}` : '';
      return api(
        'GET',
        `/clinical/patients/${patientId}/exam-form/${examId}${search}`,
        examFormSchema,
      );
    },
    enabled: examId !== '',
  });

export const examSeriesQuery = (patientId: string, attributeId: string) =>
  queryOptions({
    queryKey: ['clinical', 'timeline', patientId, 'exam-series', attributeId],
    queryFn: () =>
      api(
        'GET',
        `/clinical/patients/${patientId}/exam-series?attributeId=${attributeId}`,
        examSeriesSchema,
      ),
  });
