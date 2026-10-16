import { sessionSchema, type Permission, type Session } from '@clinica/contracts';
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import { api, ApiRequestError, setCsrfToken } from './api';

export const sessionQuery = queryOptions({
  queryKey: ['session'],
  queryFn: async (): Promise<Session | null> => {
    try {
      const session = await api('GET', '/auth/session', sessionSchema);
      setCsrfToken(session.csrfToken);
      return session;
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        setCsrfToken(undefined);
        return null;
      }
      throw error;
    }
  },
  staleTime: 60_000,
});

export function useSession(): Session {
  const { data } = useSuspenseQuery(sessionQuery);
  if (!data) throw new Error('useSession usado fora de rota autenticada');
  return data;
}

/** Apenas para exibir ou esconder controles. A autorização efetiva é sempre do servidor. */
export function useCan(): (permission: Permission) => boolean {
  const session = useSession();
  return (permission) => session.permissions.includes(permission);
}
