import type { Permission } from '@clinica/contracts';
import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { ShieldOff } from 'lucide-react';
import { lazy, type ReactNode } from 'react';
import { z } from 'zod';
import { Panel } from '../design-system/layout';
import { EmptyState, ErrorState } from '../design-system/states';
import { LoginPage } from '../features/auth/login-page';
import { HomePage } from '../features/home/home-page';
import { errorMessage } from '../lib/api';
import { sessionQuery, useCan } from '../lib/session';
import { AppShell } from './shell';

// Telas de módulos carregadas sob demanda; o login e o shell ficam no pacote inicial.
const UsersPage = lazy(() =>
  import('../features/admin/users-page').then((m) => ({ default: m.UsersPage })),
);
const RolesPage = lazy(() =>
  import('../features/admin/roles-page').then((m) => ({ default: m.RolesPage })),
);
const RoleDetailPage = lazy(() =>
  import('../features/admin/role-detail-page').then((m) => ({ default: m.RoleDetailPage })),
);
const AuditPage = lazy(() =>
  import('../features/admin/audit-page').then((m) => ({ default: m.AuditPage })),
);

function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const can = useCan();
  if (can(permission)) return <>{children}</>;
  return (
    <Panel>
      <EmptyState
        icon={ShieldOff}
        title="Sem acesso a esta tela"
        description="Seu perfil não inclui esta permissão. Peça ao administrador da clínica para revisar o seu perfil de acesso."
      />
    </Panel>
  );
}

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Outlet,
  errorComponent: ({ error, reset }) => (
    <ErrorState message={errorMessage(error)} onRetry={reset} />
  ),
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/entrar',
  validateSearch: z.object({ redirect: z.string().optional() }),
  beforeLoad: async ({ context }) => {
    if (await context.queryClient.query(sessionQuery)) throw redirect({ to: '/' });
  },
  component: function Login() {
    const { redirect: target } = loginRoute.useSearch();
    return <LoginPage redirectTo={target} />;
  },
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.query(sessionQuery);
    if (!session) throw redirect({ to: '/entrar', search: { redirect: location.href } });
  },
  component: AppShell,
});

const homeRoute = createRoute({ getParentRoute: () => appRoute, path: '/', component: HomePage });

const usersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/configuracao/usuarios',
  component: () => (
    <RequirePermission permission="admin.users.view">
      <UsersPage />
    </RequirePermission>
  ),
});

const rolesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/configuracao/perfis',
  component: () => (
    <RequirePermission permission="admin.roles.view">
      <RolesPage />
    </RequirePermission>
  ),
});

const roleDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/configuracao/perfis/$roleId',
  component: function RoleDetail() {
    const { roleId } = roleDetailRoute.useParams();
    return (
      <RequirePermission permission="admin.roles.view">
        <RoleDetailPage roleId={roleId} />
      </RequirePermission>
    );
  },
});

const auditRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/consultas/auditoria',
  component: () => (
    <RequirePermission permission="admin.audit.view">
      <AuditPage />
    </RequirePermission>
  ),
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([homeRoute, usersRoute, rolesRoute, roleDetailRoute, auditRoute]),
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    defaultNotFoundComponent: () => (
      <EmptyState
        icon={ShieldOff}
        title="Página não encontrada"
        description="Confira o endereço ou use o menu."
      />
    ),
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
