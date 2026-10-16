import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createAppRouter } from './app/router';
import { ToastProvider } from './design-system/toast';
import { ApiRequestError } from './lib/api';
import './styles.css';

/** Sessão expirada em qualquer chamada: limpa o cache e volta ao login. */
function onUnauthenticated(error: unknown) {
  if (error instanceof ApiRequestError && error.status === 401) {
    queryClient.setQueryData(['session'], null);
    void router.navigate({ to: '/entrar', search: { redirect: router.state.location.href } });
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onUnauthenticated }),
  mutationCache: new MutationCache({ onError: onUnauthenticated }),
  defaultOptions: {
    queries: {
      retry: (count, error) =>
        !(error instanceof ApiRequestError && error.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});
const router = createAppRouter(queryClient);

const root = document.getElementById('root');
if (!root) throw new Error('Elemento #root ausente');
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
