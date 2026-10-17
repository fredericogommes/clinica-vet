import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createAppRouter } from './app/router';
import { ToastProvider } from './design-system/toast';
import { ApiRequestError } from './lib/api';
import './styles.css';

/** Sessão expirada em qualquer chamada: limpa o cache e volta ao login (da equipe ou do portal). */
function onUnauthenticated(error: unknown) {
  if (!(error instanceof ApiRequestError) || error.status !== 401) return;
  const path = router.state.location.pathname;
  if (path === '/portal' || path.startsWith('/portal/')) {
    // Na entrada e no link de acesso o 401 é a própria resposta do formulário.
    if (path === '/portal/entrar' || path.startsWith('/portal/acesso/')) return;
    queryClient.setQueryData(['portal', 'session'], null);
    void router.navigate({ to: '/portal/entrar' });
    return;
  }
  queryClient.setQueryData(['session'], null);
  void router.navigate({ to: '/entrar', search: { redirect: router.state.location.href } });
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
