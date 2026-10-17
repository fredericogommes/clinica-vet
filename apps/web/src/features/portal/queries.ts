import {
  portalAccountListSchema,
  portalAccountSchema,
  portalHomeSchema,
  portalLinkInfoSchema,
  portalPatientSchema,
  portalSessionSchema,
  portalSettingsSchema,
  type PortalSession,
} from '@clinica/contracts';
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import { api, ApiRequestError, portalApi, setPortalCsrfToken } from '../../lib/api';

// Lado do tutor.

export const portalSessionQuery = queryOptions({
  queryKey: ['portal', 'session'],
  queryFn: async (): Promise<PortalSession | null> => {
    try {
      const session = await portalApi('GET', '/session', portalSessionSchema);
      setPortalCsrfToken(session.csrfToken);
      return session;
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        setPortalCsrfToken(undefined);
        return null;
      }
      throw error;
    }
  },
  staleTime: 60_000,
});

export function usePortalSession(): PortalSession {
  const { data } = useSuspenseQuery(portalSessionQuery);
  if (!data) throw new Error('usePortalSession usado fora do portal autenticado');
  return data;
}

export const portalHomeQuery = queryOptions({
  queryKey: ['portal', 'home'],
  queryFn: () => portalApi('GET', '/home', portalHomeSchema),
});

export const portalPatientQuery = (id: string) =>
  queryOptions({
    queryKey: ['portal', 'patient', id],
    queryFn: () => portalApi('GET', `/patients/${id}`, portalPatientSchema),
  });

export const portalLinkQuery = (token: string) =>
  queryOptions({
    queryKey: ['portal', 'link', token],
    queryFn: () => portalApi('GET', `/link/${token}`, portalLinkInfoSchema),
    retry: false,
  });

// Lado da equipe.

export const portalSettingsQuery = queryOptions({
  queryKey: ['portal-admin', 'settings'],
  queryFn: () => api('GET', '/portal-admin/settings', portalSettingsSchema),
});

export const portalAccountsQuery = queryOptions({
  queryKey: ['portal-admin', 'accounts'],
  queryFn: () => api('GET', '/portal-admin/accounts', portalAccountListSchema),
});

export const portalAccountQuery = (clientId: string) =>
  queryOptions({
    queryKey: ['portal-admin', 'client', clientId],
    queryFn: () => api('GET', `/portal-admin/clients/${clientId}`, portalAccountSchema),
  });
