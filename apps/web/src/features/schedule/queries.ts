import {
  agendaSchema,
  appointmentTypeSchema,
  scheduleConfigSchema,
  shiftSchema,
  slotSchema,
} from '@clinica/contracts';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../../lib/api';

export const agendaQuery = (from: string, to: string, professionalId?: string) =>
  queryOptions({
    queryKey: ['schedule', 'agenda', from, to, professionalId ?? null],
    queryFn: () => {
      const params = new URLSearchParams({ from, to });
      if (professionalId) params.set('professionalId', professionalId);
      return api('GET', `/schedule/agenda?${params.toString()}`, agendaSchema);
    },
    placeholderData: keepPreviousData,
    // A recepção deixa a agenda aberta o dia todo: atualiza status e atrasos sozinha.
    refetchInterval: 60_000,
  });

export const slotsQuery = (params: {
  date: string;
  durationMinutes: number;
  professionalId?: string | undefined;
  excludeAppointmentId?: string | undefined;
}) =>
  queryOptions({
    queryKey: ['schedule', 'slots', params],
    queryFn: () => {
      const search = new URLSearchParams({
        date: params.date,
        durationMinutes: String(params.durationMinutes),
      });
      if (params.professionalId) search.set('professionalId', params.professionalId);
      if (params.excludeAppointmentId) {
        search.set('excludeAppointmentId', params.excludeAppointmentId);
      }
      return api('GET', `/schedule/slots?${search.toString()}`, z.array(slotSchema));
    },
  });

export const scheduleConfigQuery = queryOptions({
  queryKey: ['schedule', 'config'],
  queryFn: () => api('GET', '/schedule/config', scheduleConfigSchema),
});

export const shiftsQuery = (month: string) =>
  queryOptions({
    queryKey: ['schedule', 'shifts', month],
    queryFn: () => api('GET', `/schedule/shifts?month=${month}`, z.array(shiftSchema)),
    placeholderData: keepPreviousData,
  });

export const appointmentTypesQuery = queryOptions({
  queryKey: ['catalogs', 'appointment-types'],
  queryFn: () => api('GET', '/catalogs/appointment-types', z.array(appointmentTypeSchema)),
  staleTime: 5 * 60_000,
});
