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
import { lazy, Suspense, type ReactNode } from 'react';
import { z } from 'zod';
import { Panel } from '../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../design-system/states';
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
const AgendaPage = lazy(() =>
  import('../features/schedule/agenda-page').then((m) => ({ default: m.AgendaPage })),
);
const ShiftsPage = lazy(() =>
  import('../features/schedule/shifts-page').then((m) => ({ default: m.ShiftsPage })),
);
const ScheduleConfigPage = lazy(() =>
  import('../features/schedule/config-page').then((m) => ({ default: m.ScheduleConfigPage })),
);
const ClinicalSearchPage = lazy(() =>
  import('../features/clinical/search-page').then((m) => ({ default: m.ClinicalSearchPage })),
);
const ClinicalRecordPage = lazy(() =>
  import('../features/clinical/record-page').then((m) => ({ default: m.ClinicalRecordPage })),
);
const PrintEventPage = lazy(() =>
  import('../features/clinical/print-page').then((m) => ({ default: m.PrintEventPage })),
);
const PathologiesPage = lazy(() =>
  import('../features/catalogs/clinical-catalog-pages').then((m) => ({
    default: m.PathologiesPage,
  })),
);
const ClinicalTemplatesPage = lazy(() =>
  import('../features/catalogs/clinical-catalog-pages').then((m) => ({
    default: m.ClinicalTemplatesPage,
  })),
);
const AppointmentTypesPage = lazy(() =>
  import('../features/catalogs/appointment-types-page').then((m) => ({
    default: m.AppointmentTypesPage,
  })),
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

/** Folhas de impressão: exigem sessão, mas ficam fora do menu e do layout do sistema. */
const printRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'print',
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.query(sessionQuery);
    if (!session) throw redirect({ to: '/entrar', search: { redirect: location.href } });
  },
  component: () => (
    <Suspense fallback={<SkeletonRows />}>
      <Outlet />
    </Suspense>
  ),
});

const printEventRoute = createRoute({
  getParentRoute: () => printRoute,
  path: '/impressao/evento/$eventId',
  component: function PrintEvent() {
    const { eventId } = printEventRoute.useParams();
    return (
      <RequirePermission permission="clinical.view">
        <PrintEventPage eventId={eventId} />
      </RequirePermission>
    );
  },
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
    entidade: z.enum(['client', 'patient', 'clinical_event']).optional().catch(undefined),
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

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** As duas buscas do atendimento ficam na URL, como nas demais listas. */
const clinicalSearchRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/atendimento',
  validateSearch: z.object({
    cliente: z.string().max(100).optional().catch(undefined),
    animal: z.string().max(100).optional().catch(undefined),
    pagina: z.number().int().min(1).optional().catch(undefined),
  }),
  component: function ClinicalSearch() {
    const s = clinicalSearchRoute.useSearch();
    return (
      <RequirePermission permission="clinical.view">
        <ClinicalSearchPage
          search={{ client: s.cliente ?? '', patient: s.animal ?? '', page: s.pagina ?? 1 }}
        />
      </RequirePermission>
    );
  },
});

const clinicalRecordRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/atendimento/$patientId',
  component: function ClinicalRecord() {
    const { patientId } = clinicalRecordRoute.useParams();
    return (
      <RequirePermission permission="clinical.view">
        <ClinicalRecordPage key={patientId} patientId={patientId} />
      </RequirePermission>
    );
  },
});

const pathologiesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/cadastros/patologias',
  component: () => (
    <RequirePermission permission="catalogs.manage">
      <PathologiesPage />
    </RequirePermission>
  ),
});

const clinicalTemplatesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/cadastros/modelos',
  component: () => (
    <RequirePermission permission="catalogs.manage">
      <ClinicalTemplatesPage />
    </RequirePermission>
  ),
});

/** Visão, data, profissional e filtro de cancelados ficam na URL: a recepção compartilha o link. */
const agendaRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/agenda',
  validateSearch: z.object({
    view: z.enum(['dia', 'semana', 'mes']).optional().catch(undefined),
    data: isoDate.optional().catch(undefined),
    profissional: z.uuid().optional().catch(undefined),
    cancelados: z.boolean().optional().catch(undefined),
  }),
  component: function Agenda() {
    const s = agendaRoute.useSearch();
    return (
      <RequirePermission permission="schedule.view">
        <AgendaPage
          search={{
            view: s.view ?? 'dia',
            date: s.data,
            professionalId: s.profissional,
            showCancelled: s.cancelados ?? false,
          }}
        />
      </RequirePermission>
    );
  },
});

const shiftsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/agenda/escala',
  validateSearch: z.object({
    mes: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional()
      .catch(undefined),
  }),
  component: function Shifts() {
    const { mes } = shiftsRoute.useSearch();
    return (
      <RequirePermission permission="schedule.view">
        <ShiftsPage month={mes} />
      </RequirePermission>
    );
  },
});

const scheduleConfigRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/agenda/configuracao',
  component: () => (
    <RequirePermission permission="schedule.configure">
      <ScheduleConfigPage />
    </RequirePermission>
  ),
});

const appointmentTypesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/cadastros/tipos-de-atendimento',
  component: () => (
    <RequirePermission permission="catalogs.manage">
      <AppointmentTypesPage />
    </RequirePermission>
  ),
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  printRoute.addChildren([printEventRoute]),
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
    clinicalSearchRoute,
    clinicalRecordRoute,
    agendaRoute,
    shiftsRoute,
    scheduleConfigRoute,
    speciesRoute,
    appointmentTypesRoute,
    pathologiesRoute,
    clinicalTemplatesRoute,
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
