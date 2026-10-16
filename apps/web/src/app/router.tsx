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
const ClientsPage = lazy(() =>
  import('../features/clients/clients-page').then((m) => ({ default: m.ClientsPage })),
);
const ClientNewPage = lazy(() =>
  import('../features/clients/client-new-page').then((m) => ({ default: m.ClientNewPage })),
);
const ClientPage = lazy(() =>
  import('../features/clients/client-page').then((m) => ({ default: m.ClientPage })),
);
const ClientEditPage = lazy(() =>
  import('../features/clients/client-edit-page').then((m) => ({ default: m.ClientEditPage })),
);
const PatientsPage = lazy(() =>
  import('../features/patients/patients-page').then((m) => ({ default: m.PatientsPage })),
);
const PatientNewPage = lazy(() =>
  import('../features/patients/patient-new-page').then((m) => ({ default: m.PatientNewPage })),
);
const PatientPage = lazy(() =>
  import('../features/patients/patient-page').then((m) => ({ default: m.PatientPage })),
);
const PatientEditPage = lazy(() =>
  import('../features/patients/patient-edit-page').then((m) => ({ default: m.PatientEditPage })),
);
const SpeciesPage = lazy(() =>
  import('../features/catalogs/catalog-pages').then((m) => ({ default: m.SpeciesPage })),
);
const SimpleCatalogPage = lazy(() =>
  import('../features/catalogs/catalog-pages').then((m) => ({ default: m.SimpleCatalogPage })),
);

/** Busca, página e filtro de arquivados ficam na URL para que a lista sobreviva ao voltar. */
const listSearchSchema = z.object({
  q: z.string().max(100).optional().catch(undefined),
  page: z.number().int().min(1).optional().catch(undefined),
  archived: z.boolean().optional().catch(undefined),
});
const listParams = (s: z.infer<typeof listSearchSchema>) => ({
  q: s.q ?? '',
  page: s.page ?? 1,
  archived: s.archived ?? false,
});

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
  validateSearch: z.object({
    entidade: z.enum(['client', 'patient']).optional().catch(undefined),
    id: z.uuid().optional().catch(undefined),
    nome: z.string().max(160).optional().catch(undefined),
  }),
  component: function Audit() {
    const { entidade, id, nome } = auditRoute.useSearch();
    const filter =
      entidade && id ? { entity: entidade, entityId: id, label: nome ?? '' } : undefined;
    return (
      <RequirePermission permission="admin.audit.view">
        <AuditPage key={id ?? 'all'} filter={filter} />
      </RequirePermission>
    );
  },
});

const clientsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/clientes',
  validateSearch: listSearchSchema,
  component: function Clients() {
    const search = clientsRoute.useSearch();
    return (
      <RequirePermission permission="clients.view">
        <ClientsPage search={listParams(search)} />
      </RequirePermission>
    );
  },
});

const clientNewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/clientes/novo',
  component: () => (
    <RequirePermission permission="clients.manage">
      <ClientNewPage />
    </RequirePermission>
  ),
});

const clientRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/clientes/$clientId',
  component: function Client() {
    const { clientId } = clientRoute.useParams();
    return (
      <RequirePermission permission="clients.view">
        <ClientPage key={clientId} clientId={clientId} />
      </RequirePermission>
    );
  },
});

const clientEditRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/clientes/$clientId/editar',
  component: function ClientEdit() {
    const { clientId } = clientEditRoute.useParams();
    return (
      <RequirePermission permission="clients.manage">
        <ClientEditPage clientId={clientId} />
      </RequirePermission>
    );
  },
});

const patientNewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/clientes/$clientId/animais/novo',
  component: function PatientNew() {
    const { clientId } = patientNewRoute.useParams();
    return (
      <RequirePermission permission="patients.manage">
        <PatientNewPage clientId={clientId} />
      </RequirePermission>
    );
  },
});

const patientsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/animais',
  validateSearch: listSearchSchema,
  component: function Patients() {
    const search = patientsRoute.useSearch();
    return (
      <RequirePermission permission="patients.view">
        <PatientsPage search={listParams(search)} />
      </RequirePermission>
    );
  },
});

const patientRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/animais/$patientId',
  component: function Patient() {
    const { patientId } = patientRoute.useParams();
    return (
      <RequirePermission permission="patients.view">
        <PatientPage key={patientId} patientId={patientId} />
      </RequirePermission>
    );
  },
});

const patientEditRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/animais/$patientId/editar',
  component: function PatientEdit() {
    const { patientId } = patientEditRoute.useParams();
    return (
      <RequirePermission permission="patients.manage">
        <PatientEditPage patientId={patientId} />
      </RequirePermission>
    );
  },
});

const speciesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/cadastros/especies',
  component: () => (
    <RequirePermission permission="catalogs.manage">
      <SpeciesPage />
    </RequirePermission>
  ),
});

const coatsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/cadastros/pelagens',
  component: () => (
    <RequirePermission permission="catalogs.manage">
      <SimpleCatalogPage
        kind="coats"
        title="Pelagens"
        noun="pelagem"
        description="Cores e padrões de pelagem usados na ficha do animal."
      />
    </RequirePermission>
  ),
});

const originsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/cadastros/origens',
  component: () => (
    <RequirePermission permission="catalogs.manage">
      <SimpleCatalogPage
        kind="client-origins"
        title="Origens de clientes"
        noun="origem"
        description="Como o cliente conheceu a clínica. Alimenta os relatórios de captação."
      />
    </RequirePermission>
  ),
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([
    homeRoute,
    clientsRoute,
    clientNewRoute,
    clientRoute,
    clientEditRoute,
    patientNewRoute,
    patientsRoute,
    patientRoute,
    patientEditRoute,
    speciesRoute,
    coatsRoute,
    originsRoute,
    usersRoute,
    rolesRoute,
    roleDetailRoute,
    auditRoute,
  ]),
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
