import {
  messageTriggers,
  productKinds,
  purchaseSituations,
  saleStatuses,
  vaccineKinds,
  type Permission,
} from '@clinica/contracts';
import { defaultPeriod, reportTabs } from '../features/sales/report-search';
import {
  entrySituations,
  entryTypes,
  type EntrySearch,
  type EntrySituation,
  type EntryType,
} from '../features/finance/queries';
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
const PdvPage = lazy(() =>
  import('../features/sales/sale-pages').then((m) => ({ default: m.PdvPage })),
);
const SalePage = lazy(() =>
  import('../features/sales/sale-pages').then((m) => ({ default: m.SalePage })),
);
const SalesReportPage = lazy(() =>
  import('../features/sales/reports-page').then((m) => ({ default: m.SalesReportPage })),
);
const MySalesPage = lazy(() =>
  import('../features/sales/reports-page').then((m) => ({ default: m.MySalesPage })),
);
const CashListPage = lazy(() =>
  import('../features/cash/cash-pages').then((m) => ({ default: m.CashListPage })),
);
const CashPage = lazy(() =>
  import('../features/cash/cash-pages').then((m) => ({ default: m.CashPage })),
);
const PaymentMethodsPage = lazy(() =>
  import('../features/sales/payment-methods-page').then((m) => ({
    default: m.PaymentMethodsPage,
  })),
);
const SalesSettingsPage = lazy(() =>
  import('../features/sales/settings-page').then((m) => ({ default: m.SalesSettingsPage })),
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
const VaccinesPage = lazy(() =>
  import('../features/catalogs/vaccines-page').then((m) => ({ default: m.VaccinesPage })),
);
const MessagesPage = lazy(() =>
  import('../features/messaging/queue-page').then((m) => ({ default: m.MessagesPage })),
);
const EntriesPage = lazy(() =>
  import('../features/finance/entries-page').then((m) => ({ default: m.EntriesPage })),
);
const ReconciliationPage = lazy(() =>
  import('../features/finance/reconciliation-page').then((m) => ({
    default: m.ReconciliationPage,
  })),
);
const StatementPage = lazy(() =>
  import('../features/finance/reports-pages').then((m) => ({ default: m.StatementPage })),
);
const CashFlowPage = lazy(() =>
  import('../features/finance/reports-pages').then((m) => ({ default: m.CashFlowPage })),
);
const PurchasesPage = lazy(() =>
  import('../features/purchases/purchase-pages').then((m) => ({ default: m.PurchasesPage })),
);
const PurchaseNewPage = lazy(() =>
  import('../features/purchases/purchase-pages').then((m) => ({ default: m.PurchaseNewPage })),
);
const PurchasePage = lazy(() =>
  import('../features/purchases/purchase-pages').then((m) => ({ default: m.PurchasePage })),
);
const AccountsPage = lazy(() =>
  import('../features/finance/setup-pages').then((m) => ({ default: m.AccountsPage })),
);
const FinanceCategoriesPage = lazy(() =>
  import('../features/finance/setup-pages').then((m) => ({ default: m.CategoriesPage })),
);
const SuppliersPage = lazy(() =>
  import('../features/finance/setup-pages').then((m) => ({ default: m.SuppliersPage })),
);
const AutomaticMessagesPage = lazy(() =>
  import('../features/messaging/settings-page').then((m) => ({
    default: m.AutomaticMessagesPage,
  })),
);
const VaccinationPage = lazy(() =>
  import('../features/clinical/vaccination-page').then((m) => ({
    default: m.VaccinationPage,
  })),
);
const ExamsPage = lazy(() =>
  import('../features/catalogs/exams-pages').then((m) => ({ default: m.ExamsPage })),
);
const ExamEditPage = lazy(() =>
  import('../features/catalogs/exams-pages').then((m) => ({ default: m.ExamEditPage })),
);
const AppointmentTypesPage = lazy(() =>
  import('../features/catalogs/appointment-types-page').then((m) => ({
    default: m.AppointmentTypesPage,
  })),
);
const ProductsPage = lazy(() =>
  import('../features/products/products-page').then((m) => ({ default: m.ProductsPage })),
);
const ProductNewPage = lazy(() =>
  import('../features/products/product-pages').then((m) => ({ default: m.ProductNewPage })),
);
const ProductPage = lazy(() =>
  import('../features/products/product-pages').then((m) => ({ default: m.ProductPage })),
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
    entidade: z
      .enum(['client', 'patient', 'clinical_event', 'product', 'sale'])
      .optional()
      .catch(undefined),
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

const vaccinesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/cadastros/vacinas',
  component: () => (
    <RequirePermission permission="catalogs.manage">
      <VaccinesPage />
    </RequirePermission>
  ),
});

/** Situação, data e filtros na URL: a recepção compartilha a lista da busca ativa. */
const vaccinationRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/consultas/vacinacao',
  validateSearch: z.object({
    situacao: z.enum(['vencidas', 'a-vencer']).optional().catch(undefined),
    ate: z.iso.date().optional().catch(undefined),
    tipo: z.enum(vaccineKinds).optional().catch(undefined),
    especie: z.uuid().optional().catch(undefined),
    page: z.number().int().min(1).optional().catch(undefined),
  }),
  component: function Vaccination() {
    const s = vaccinationRoute.useSearch();
    return (
      <RequirePermission permission="reports.vaccination">
        <VaccinationPage
          search={{
            situacao: s.situacao ?? 'todas',
            ate: s.ate,
            tipo: s.tipo,
            especie: s.especie,
            page: s.page ?? 1,
          }}
        />
      </RequirePermission>
    );
  },
});

/** Situação e tipo na URL, como nas demais consultas. */
const messagesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/mensagens',
  validateSearch: z.object({
    situacao: z.enum(['enviadas', 'nao-enviadas', 'todas']).optional().catch(undefined),
    tipo: z.enum(messageTriggers).optional().catch(undefined),
    page: z.number().int().min(1).optional().catch(undefined),
  }),
  component: function Messages() {
    const s = messagesRoute.useSearch();
    return (
      <RequirePermission permission="messages.view">
        <MessagesPage
          search={{ situacao: s.situacao ?? 'aguardando', tipo: s.tipo, page: s.page ?? 1 }}
        />
      </RequirePermission>
    );
  },
});

const automaticMessagesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/mensagens/automaticas',
  component: () => (
    <RequirePermission permission="messages.configure">
      <AutomaticMessagesPage />
    </RequirePermission>
  ),
});

/** Filtros do financeiro na URL: período, conta, categoria, situação, tipo e busca. */
const entrySearch = z.object({
  de: z.iso.date().optional().catch(undefined),
  ate: z.iso.date().optional().catch(undefined),
  conta: z.uuid().optional().catch(undefined),
  categoria: z.uuid().optional().catch(undefined),
  situacao: z.enum(entrySituations).optional().catch(undefined),
  tipo: z.enum(entryTypes).optional().catch(undefined),
  q: z.string().optional().catch(undefined),
  page: z.number().int().min(1).optional().catch(undefined),
});
type EntryUrl = z.infer<typeof entrySearch>;
const toEntrySearch = (s: EntryUrl, situacao: EntrySituation, tipo: EntryType): EntrySearch => ({
  de: s.de,
  ate: s.ate,
  conta: s.conta,
  categoria: s.categoria,
  situacao: s.situacao ?? situacao,
  tipo,
  q: s.q ?? '',
  page: s.page ?? 1,
});

const ledgerRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/financeiro',
  validateSearch: entrySearch,
  component: function Ledger() {
    const s = ledgerRoute.useSearch();
    return (
      <RequirePermission permission="finance.view">
        <EntriesPage mode="ledger" search={toEntrySearch(s, 'todos', s.tipo ?? 'todos')} />
      </RequirePermission>
    );
  },
});

const payableRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/financeiro/contas-a-pagar',
  validateSearch: entrySearch,
  component: function Payable() {
    const s = payableRoute.useSearch();
    return (
      <RequirePermission permission="finance.view">
        <EntriesPage mode="payable" search={toEntrySearch(s, 'abertos', 'despesas')} />
      </RequirePermission>
    );
  },
});

const receivableRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/financeiro/contas-a-receber',
  validateSearch: entrySearch,
  component: function Receivable() {
    const s = receivableRoute.useSearch();
    return (
      <RequirePermission permission="finance.view">
        <EntriesPage mode="receivable" search={toEntrySearch(s, 'abertos', 'receitas')} />
      </RequirePermission>
    );
  },
});

const reconciliationRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/financeiro/conciliacao',
  validateSearch: z.object({
    situacao: z.enum(['previstos', 'conciliados', 'todos']).optional().catch(undefined),
    forma: z.uuid().optional().catch(undefined),
    de: z.iso.date().optional().catch(undefined),
    ate: z.iso.date().optional().catch(undefined),
  }),
  component: function Reconciliation() {
    const s = reconciliationRoute.useSearch();
    return (
      <RequirePermission permission="finance.view">
        <ReconciliationPage
          search={{
            situacao: s.situacao ?? 'nao-conciliados',
            forma: s.forma,
            de: s.de,
            ate: s.ate,
          }}
        />
      </RequirePermission>
    );
  },
});

const isoMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

const statementRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/financeiro/demonstrativo',
  validateSearch: z.object({
    regime: z.enum(['caixa']).optional().catch(undefined),
    de: isoMonth.optional().catch(undefined),
    ate: isoMonth.optional().catch(undefined),
    centro: z.uuid().optional().catch(undefined),
  }),
  component: function Statement() {
    const s = statementRoute.useSearch();
    return (
      <RequirePermission permission="finance.reports">
        <StatementPage
          search={{ regime: s.regime ?? 'competencia', de: s.de, ate: s.ate, centro: s.centro }}
        />
      </RequirePermission>
    );
  },
});

const cashFlowRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/financeiro/fluxo-de-caixa',
  validateSearch: z.object({
    de: z.iso.date().optional().catch(undefined),
    ate: z.iso.date().optional().catch(undefined),
    conta: z.uuid().optional().catch(undefined),
    tipo: z.enum(['receitas', 'despesas']).optional().catch(undefined),
    situacao: z.enum(['realizado', 'previsto']).optional().catch(undefined),
  }),
  component: function CashFlow() {
    const s = cashFlowRoute.useSearch();
    return (
      <RequirePermission permission="finance.reports">
        <CashFlowPage
          search={{
            de: s.de,
            ate: s.ate,
            conta: s.conta,
            tipo: s.tipo ?? 'ambos',
            situacao: s.situacao ?? 'todos',
          }}
        />
      </RequirePermission>
    );
  },
});

const accountsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/financeiro/contas',
  component: () => (
    <RequirePermission permission="finance.view">
      <AccountsPage />
    </RequirePermission>
  ),
});

const financeCategoriesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/financeiro/plano-de-contas',
  component: () => (
    <RequirePermission permission="finance.view">
      <FinanceCategoriesPage />
    </RequirePermission>
  ),
});

const suppliersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/financeiro/fornecedores',
  component: () => (
    <RequirePermission permission="finance.view">
      <SuppliersPage />
    </RequirePermission>
  ),
});

const examsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/cadastros/exames',
  component: () => (
    <RequirePermission permission="catalogs.manage">
      <ExamsPage />
    </RequirePermission>
  ),
});

const examNewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/cadastros/exames/novo',
  component: () => (
    <RequirePermission permission="catalogs.manage">
      <ExamEditPage examId={null} />
    </RequirePermission>
  ),
});

const examEditRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/cadastros/exames/$examId',
  component: function ExamEdit() {
    const { examId } = examEditRoute.useParams();
    return (
      <RequirePermission permission="catalogs.manage">
        <ExamEditPage key={examId} examId={examId} />
      </RequirePermission>
    );
  },
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

/** Busca e filtros da lista ficam na URL, em português, como nas demais listas. */
const productsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/estoque/produtos',
  validateSearch: z.object({
    q: z.string().max(100).optional().catch(undefined),
    tipo: z.enum(productKinds).optional().catch(undefined),
    grupo: z.uuid().optional().catch(undefined),
    lista: z.boolean().optional().catch(undefined),
    arquivados: z.boolean().optional().catch(undefined),
    page: z.number().int().min(1).optional().catch(undefined),
  }),
  component: function Products() {
    const s = productsRoute.useSearch();
    return (
      <RequirePermission permission="products.view">
        <ProductsPage
          search={{
            q: s.q ?? '',
            kind: s.tipo,
            serviceKind: undefined,
            groupId: s.grupo,
            priceList: s.lista ?? false,
            archived: s.arquivados ?? false,
            page: s.page ?? 1,
          }}
        />
      </RequirePermission>
    );
  },
});

const productNewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/estoque/produtos/novo',
  component: () => (
    <RequirePermission permission="products.manage">
      <ProductNewPage />
    </RequirePermission>
  ),
});

const productRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/estoque/produtos/$productId',
  component: function Product() {
    const { productId } = productRoute.useParams();
    return (
      <RequirePermission permission="products.view">
        <ProductPage key={productId} productId={productId} />
      </RequirePermission>
    );
  },
});

const productGroupsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/estoque/grupos',
  component: () => (
    <RequirePermission permission="catalogs.manage">
      <SimpleCatalogPage
        kind="product-groups"
        area="Estoque e serviços"
        title="Grupos de produtos"
        noun="grupo"
        masculine
        stockPolicy
        description="Organizam o catálogo e os relatórios, ex. Medicamentos, Vacinas, Rações. Cada grupo decide se falta de saldo bloqueia a venda."
      />
    </RequirePermission>
  ),
});

const purchasesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/estoque/compras',
  validateSearch: z.object({
    situacao: z.enum(purchaseSituations).optional().catch(undefined),
    q: z.string().max(100).optional().catch(undefined),
    de: z.iso.date().optional().catch(undefined),
    ate: z.iso.date().optional().catch(undefined),
    page: z.number().int().min(1).optional().catch(undefined),
  }),
  component: function Purchases() {
    const s = purchasesRoute.useSearch();
    return (
      <RequirePermission permission="purchases.view">
        <PurchasesPage
          search={{
            situacao: s.situacao ?? 'todas',
            q: s.q ?? '',
            de: s.de,
            ate: s.ate,
            page: s.page ?? 1,
          }}
        />
      </RequirePermission>
    );
  },
});

const purchaseNewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/estoque/compras/nova',
  component: () => (
    <RequirePermission permission="purchases.manage">
      <PurchaseNewPage />
    </RequirePermission>
  ),
});

const purchaseRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/estoque/compras/$purchaseId',
  component: function Purchase() {
    const { purchaseId } = purchaseRoute.useParams();
    return (
      <RequirePermission permission="purchases.view">
        <PurchasePage key={purchaseId} purchaseId={purchaseId} />
      </RequirePermission>
    );
  },
});

const productBrandsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/estoque/marcas',
  component: () => (
    <RequirePermission permission="catalogs.manage">
      <SimpleCatalogPage
        kind="product-brands"
        area="Estoque e serviços"
        title="Marcas"
        noun="marca"
        description="Fabricantes dos produtos vendidos e usados na clínica."
      />
    </RequirePermission>
  ),
});

const pdvRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/vendas/pdv',
  component: () => (
    <RequirePermission permission="sales.manage">
      <PdvPage />
    </RequirePermission>
  ),
});

const salesSettingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/vendas/configuracao',
  component: () => (
    <RequirePermission permission="sales.configure">
      <SalesSettingsPage />
    </RequirePermission>
  ),
});

const paymentMethodsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/vendas/formas-de-recebimento',
  component: () => (
    <RequirePermission permission="sales.configure">
      <PaymentMethodsPage />
    </RequirePermission>
  ),
});

const optionalDate = z.iso.date().optional().catch(undefined);

/** Período, aba e filtros na URL: o link copiado abre a mesma consulta. */
const salesReportRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/vendas/consulta',
  validateSearch: z.object({
    aba: z.enum(reportTabs).optional().catch(undefined),
    de: optionalDate,
    ate: optionalDate,
    tipo: z.enum(productKinds).optional().catch(undefined),
    situacao: z.enum(saleStatuses).optional().catch(undefined),
    q: z.string().max(100).optional().catch(undefined),
    page: z.number().int().min(1).optional().catch(undefined),
  }),
  component: function SalesReport() {
    const s = salesReportRoute.useSearch();
    const period = defaultPeriod();
    return (
      <RequirePermission permission="sales.reports">
        <SalesReportPage
          search={{
            tab: s.aba ?? 'resumo',
            from: s.de ?? period.from,
            to: s.ate ?? period.to,
            kind: s.tipo,
            status: s.situacao,
            q: s.q ?? '',
            page: s.page ?? 1,
          }}
        />
      </RequirePermission>
    );
  },
});

const mySalesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/vendas/minhas',
  validateSearch: z.object({ de: optionalDate, ate: optionalDate }),
  component: function MySales() {
    const s = mySalesRoute.useSearch();
    const period = defaultPeriod();
    return (
      <RequirePermission permission="sales.view_own">
        <MySalesPage from={s.de ?? period.from} to={s.ate ?? period.to} />
      </RequirePermission>
    );
  },
});

const cashListRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/vendas/caixas',
  component: () => (
    <RequirePermission permission="cash.operate">
      <CashListPage />
    </RequirePermission>
  ),
});

const cashRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/vendas/caixas/$cashId',
  component: function CashDetail() {
    const { cashId } = cashRoute.useParams();
    return (
      <RequirePermission permission="cash.operate">
        <CashPage key={cashId} cashId={cashId} />
      </RequirePermission>
    );
  },
});

const saleRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/vendas/$saleId',
  component: function SaleDetail() {
    const { saleId } = saleRoute.useParams();
    return (
      <RequirePermission permission="sales.view">
        <SalePage key={saleId} saleId={saleId} />
      </RequirePermission>
    );
  },
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
    examsRoute,
    vaccinesRoute,
    vaccinationRoute,
    messagesRoute,
    automaticMessagesRoute,
    ledgerRoute,
    payableRoute,
    receivableRoute,
    reconciliationRoute,
    statementRoute,
    cashFlowRoute,
    accountsRoute,
    financeCategoriesRoute,
    suppliersRoute,
    examNewRoute,
    examEditRoute,
    clinicalTemplatesRoute,
    productsRoute,
    productNewRoute,
    productRoute,
    productGroupsRoute,
    productBrandsRoute,
    purchasesRoute,
    purchaseNewRoute,
    purchaseRoute,
    pdvRoute,
    salesSettingsRoute,
    paymentMethodsRoute,
    salesReportRoute,
    mySalesRoute,
    cashListRoute,
    cashRoute,
    saleRoute,
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
