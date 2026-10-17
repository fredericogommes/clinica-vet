import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Config } from '../core/config.js';
import type { Database } from '../db/client.js';
import { adminRoutes } from '../modules/admin/routes.js';
import { AdminService } from '../modules/admin/service.js';
import { catalogRoutes } from '../modules/catalogs/routes.js';
import { CatalogService } from '../modules/catalogs/service.js';
import { clinicalRoutes } from '../modules/clinical/routes.js';
import { ClinicalService } from '../modules/clinical/service.js';
import { clientRoutes } from '../modules/clients/routes.js';
import { ClientService } from '../modules/clients/service.js';
import { patientRoutes } from '../modules/patients/routes.js';
import { PatientService } from '../modules/patients/service.js';
import { productRoutes } from '../modules/products/routes.js';
import { ProductService } from '../modules/products/service.js';
import { cashRoutes } from '../modules/cash/routes.js';
import { InventoryService } from '../modules/inventory/service.js';
import { CashService } from '../modules/cash/service.js';
import { paymentMethodRoutes } from '../modules/payments/routes.js';
import { PaymentMethodService } from '../modules/payments/service.js';
import { examRoutes } from '../modules/exams/routes.js';
import { ExamService } from '../modules/exams/service.js';
import { messagingRoutes } from '../modules/messaging/routes.js';
import { CloudApiSender } from '../modules/messaging/sender.js';
import { MessagingService } from '../modules/messaging/service.js';
import { financeRoutes } from '../modules/finance/routes.js';
import { CardReconciliationService } from '../modules/finance/reconciliation.js';
import { FinanceReportsService } from '../modules/finance/reports.js';
import { FinanceService } from '../modules/finance/service.js';
import { purchaseOrderRoutes } from '../modules/purchases/order-routes.js';
import { commissionRoutes } from '../modules/commissions/routes.js';
import { CommissionsService } from '../modules/commissions/service.js';
import { PurchaseOrdersService } from '../modules/purchases/orders.js';
import { purchaseRoutes } from '../modules/purchases/routes.js';
import { PurchasesService } from '../modules/purchases/service.js';
import { stockRoutes } from '../modules/stock/routes.js';
import { StockOpsService } from '../modules/stock/service.js';
import { vaccineRoutes } from '../modules/vaccines/routes.js';
import { VaccineService } from '../modules/vaccines/service.js';
import { DashboardService } from '../modules/dashboard/service.js';
import { dashboardRoutes } from '../modules/dashboard/routes.js';
import { ClientDebtService } from '../modules/sales/client-debts.js';
import { PackageService } from '../modules/sales/packages.js';
import { hospitalizationRoutes } from '../modules/hospitalization/routes.js';
import { PrescriptionService } from '../modules/hospitalization/prescriptions.js';
import { HospitalizationService } from '../modules/hospitalization/service.js';
import { ClientRankingService } from '../modules/sales/client-ranking.js';
import { SalesReportService } from '../modules/sales/reports.js';
import { saleRoutes } from '../modules/sales/routes.js';
import { SaleService } from '../modules/sales/service.js';
import { AppointmentService } from '../modules/scheduling/appointment-service.js';
import { ScheduleConfigService } from '../modules/scheduling/config-service.js';
import { appointmentRoutes, scheduleRoutes } from '../modules/scheduling/routes.js';
import { authRoutes } from '../modules/auth/routes.js';
import { portalAdminRoutes, portalRoutes } from '../modules/portal/routes.js';
import { PortalAdminService, PortalService } from '../modules/portal/service.js';
import { PortalSessionService } from '../modules/portal/sessions.js';
import { SessionService } from '../modules/auth/sessions.js';
import { accessGuard } from './access-guard.js';
import { registerErrorHandling } from './error-handler.js';

export async function buildApp(config: Config, db: Database): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: ['req.headers.cookie', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'],
    },
    // Em produção a API só é alcançada pelo Caddy: confia apenas nesse salto para obter o IP real.
    trustProxy:
      config.NODE_ENV === 'production' ? (_address: string, hop: number) => hop < 1 : false,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);

  await app.register(helmet);
  await app.register(cors, { origin: config.WEB_ORIGIN, credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  // A descrição da API só é publicada fora de produção, para não expor o mapa de rotas.
  const publishDocs = config.NODE_ENV !== 'production';
  if (publishDocs) {
    await app.register(swagger, {
      openapi: { info: { title: 'Clínica Vet API', version: '0.1.0' } },
      transform: jsonSchemaTransform,
    });
  }

  const sessions = new SessionService(db, config.SESSION_TTL_HOURS * 3_600_000);
  // Sessão do tutor: 30 dias deslizantes, separada da equipe.
  const portalSessions = new PortalSessionService(db, 30 * 24 * 3_600_000);
  await app.register(accessGuard, { sessions, portalSessions });

  app.get('/api/health', { config: { access: { kind: 'public' } } }, async () => ({
    status: 'ok',
  }));
  if (publishDocs) {
    app.get('/api/docs/openapi.json', { config: { access: { kind: 'public' } } }, async () =>
      app.swagger(),
    );
  }
  await app.register(authRoutes, {
    prefix: '/api/auth',
    sessions,
    secureCookies: config.NODE_ENV === 'production',
  });
  const appointments = new AppointmentService(db);
  await app.register(portalRoutes, {
    prefix: '/api/portal',
    portal: new PortalService(db, portalSessions, appointments),
    sessions: portalSessions,
    secureCookies: config.NODE_ENV === 'production',
  });
  await app.register(portalAdminRoutes, {
    prefix: '/api/portal-admin',
    admin: new PortalAdminService(db, config.WEB_ORIGIN),
  });
  await app.register(adminRoutes, { prefix: '/api/admin', admin: new AdminService(db) });
  await app.register(catalogRoutes, { prefix: '/api/catalogs', catalogs: new CatalogService(db) });
  await app.register(clientRoutes, { prefix: '/api/clients', clients: new ClientService(db) });
  const patients = new PatientService(db);
  await app.register(patientRoutes, { prefix: '/api/patients', patients });
  await app.register(scheduleRoutes, {
    prefix: '/api/schedule',
    config: new ScheduleConfigService(db),
    appointments,
  });
  await app.register(appointmentRoutes, { prefix: '/api/appointments', appointments });
  const paymentMethods = new PaymentMethodService(db);
  const cash = new CashService(db);
  const inventory = new InventoryService(db);
  const finance = new FinanceService(db);
  const sales = new SaleService(db, paymentMethods, cash, inventory, finance);
  const exams = new ExamService(db);
  const vaccines = new VaccineService(db);
  await app.register(clinicalRoutes, {
    prefix: '/api/clinical',
    clinical: new ClinicalService(db, patients, appointments, sales, exams, vaccines),
  });
  await app.register(hospitalizationRoutes, {
    prefix: '/api/hospitalizations',
    hospitalizations: new HospitalizationService(db),
    prescriptions: new PrescriptionService(db),
  });
  await app.register(examRoutes, { prefix: '/api/exams', exams });
  await app.register(vaccineRoutes, { prefix: '/api/vaccines', vaccines });
  await app.register(productRoutes, {
    prefix: '/api/products',
    products: new ProductService(db),
    inventory,
  });
  const reports = new SalesReportService(db);
  await app.register(saleRoutes, {
    prefix: '/api/sales',
    sales,
    reports,
    ranking: new ClientRankingService(db),
    debts: new ClientDebtService(db),
    packages: new PackageService(db),
  });
  await app.register(dashboardRoutes, {
    prefix: '/api/dashboard',
    dashboard: new DashboardService(db, reports),
  });
  await app.register(paymentMethodRoutes, {
    prefix: '/api/payment-methods',
    methods: paymentMethods,
  });
  await app.register(cashRoutes, { prefix: '/api/cash', cash });
  await app.register(financeRoutes, {
    prefix: '/api/finance',
    finance,
    reconciliation: new CardReconciliationService(db, finance),
    reports: new FinanceReportsService(db, finance),
  });
  const purchases = new PurchasesService(db, inventory, finance);
  await app.register(purchaseRoutes, { prefix: '/api/purchases', purchases });
  await app.register(purchaseOrderRoutes, {
    prefix: '/api/purchase-orders',
    orders: new PurchaseOrdersService(db, purchases),
  });
  await app.register(commissionRoutes, {
    prefix: '/api/commissions',
    commissions: new CommissionsService(db, finance),
  });
  await app.register(stockRoutes, {
    prefix: '/api/stock',
    stock: new StockOpsService(db, inventory),
  });
  await app.register(messagingRoutes, {
    prefix: '/api/messages',
    messaging: new MessagingService(db, whatsappSender(config)),
  });

  return app;
}

export const whatsappSender = (config: Config): CloudApiSender =>
  new CloudApiSender({
    token: config.WHATSAPP_TOKEN,
    phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID,
    apiUrl: config.WHATSAPP_API_URL,
    language: config.WHATSAPP_TEMPLATE_LANGUAGE,
  });
