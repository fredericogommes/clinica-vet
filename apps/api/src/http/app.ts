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
import { clientRoutes } from '../modules/clients/routes.js';
import { ClientService } from '../modules/clients/service.js';
import { patientRoutes } from '../modules/patients/routes.js';
import { PatientService } from '../modules/patients/service.js';
import { authRoutes } from '../modules/auth/routes.js';
import { SessionService } from '../modules/auth/sessions.js';
import { accessGuard } from './access-guard.js';
import { registerErrorHandling } from './error-handler.js';

export async function buildApp(config: Config, db: Database): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: ['req.headers.cookie', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'],
    },
    trustProxy: config.NODE_ENV === 'production',
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);

  await app.register(helmet);
  await app.register(cors, { origin: config.WEB_ORIGIN, credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(swagger, {
    openapi: { info: { title: 'Clínica Vet API', version: '0.1.0' } },
    transform: jsonSchemaTransform,
  });

  const sessions = new SessionService(db, config.SESSION_TTL_HOURS * 3_600_000);
  await app.register(accessGuard, { sessions });

  app.get('/api/health', { config: { access: { kind: 'public' } } }, async () => ({
    status: 'ok',
  }));
  app.get('/api/docs/openapi.json', { config: { access: { kind: 'public' } } }, async () =>
    app.swagger(),
  );
  await app.register(authRoutes, {
    prefix: '/api/auth',
    sessions,
    secureCookies: config.NODE_ENV === 'production',
  });
  await app.register(adminRoutes, { prefix: '/api/admin', admin: new AdminService(db) });
  await app.register(catalogRoutes, { prefix: '/api/catalogs', catalogs: new CatalogService(db) });
  await app.register(clientRoutes, { prefix: '/api/clients', clients: new ClientService(db) });
  await app.register(patientRoutes, { prefix: '/api/patients', patients: new PatientService(db) });

  return app;
}
