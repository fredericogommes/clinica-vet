import type { Session } from '@clinica/contracts';
import { sql } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { inject } from 'vitest';
import { loadConfig } from '../core/config.js';
import { createDatabase, type Database } from '../db/client.js';
import { buildApp } from '../http/app.js';
import { provisionOrganization, type Provisioned } from '../modules/admin/provisioning.js';

export const ADMIN = { name: 'Ana Admin', email: 'ana@clinica.test', password: 'senha-forte-123' };

export interface Harness {
  app: FastifyInstance;
  db: Database;
  org: Provisioned;
  close(): Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: inject('databaseUrl'),
    WEB_ORIGIN: 'http://localhost:5173',
    LOG_LEVEL: 'silent',
  });
  const { db, pool } = createDatabase(config.DATABASE_URL);
  // Limpa todas as tabelas da aplicação; as migrações ficam no schema `drizzle`.
  const tables = await db.execute<{ name: string }>(
    sql`select quote_ident(tablename) as name from pg_tables where schemaname = 'public'`,
  );
  await db.execute(
    sql.raw(`truncate ${tables.rows.map((t) => t.name).join(', ')} restart identity cascade`),
  );
  const org = await db.transaction((tx) =>
    provisionOrganization(tx, {
      organizationName: 'Clínica Teste',
      unitName: 'Matriz',
      admin: ADMIN,
    }),
  );
  const app = await buildApp(config, db);
  return {
    app,
    db,
    org,
    async close() {
      await app.close();
      await pool.end();
    },
  };
}

/** Cliente HTTP que mantém o cookie de sessão e envia o token CSRF como o frontend faz. */
export class TestClient {
  private cookie: string | undefined;
  private csrf: string | undefined;

  constructor(private readonly app: FastifyInstance) {}

  async login(email: string, password: string): Promise<LightMyRequestResponse> {
    const res = await this.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password },
    });
    const setCookie = res.headers['set-cookie'];
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (res.statusCode === 204 && raw) {
      this.cookie = raw.split(';')[0];
      const session = await this.get('/api/auth/session');
      this.csrf = session.json<Session>().csrfToken;
    }
    return res;
  }

  get(url: string) {
    return this.app.inject({ method: 'GET', url, headers: this.headers() });
  }

  send(
    method: 'POST' | 'PUT' | 'DELETE',
    url: string,
    payload?: unknown,
    options: { csrf?: boolean } = {},
  ) {
    const headers = this.headers();
    if (options.csrf !== false && this.csrf) headers['x-csrf-token'] = this.csrf;
    return this.app.inject({
      method,
      url,
      headers,
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  }

  /** Cookie e token CSRF, para requisições montadas à mão (ex. corpo binário). */
  authHeaders(): Record<string, string> {
    const headers = this.headers();
    if (this.csrf) headers['x-csrf-token'] = this.csrf;
    return headers;
  }

  private headers(): Record<string, string> {
    return this.cookie ? { cookie: this.cookie } : {};
  }
}

/** Cria um usuário com um perfil-modelo e devolve um cliente HTTP já autenticado como ele. */
export async function loginAs(
  h: Harness,
  admin: TestClient,
  roleName: string,
): Promise<TestClient> {
  const roles = (await admin.get('/api/admin/roles')).json<{ id: string; name: string }[]>();
  const role = roles.find((r) => r.name === roleName);
  if (!role) throw new Error(`Perfil ${roleName} não existe.`);
  const email = `${roleName.toLowerCase().replace(/[^a-z]/g, '')}@clinica.test`;
  const password = 'senha-forte-456';
  const res = await admin.send('POST', '/api/admin/users', {
    name: roleName,
    email,
    password,
    roleId: role.id,
    unitIds: [h.org.unitId],
  });
  if (res.statusCode !== 201) throw new Error(`Falha ao criar usuário: ${res.body}`);
  const user = new TestClient(h.app);
  await user.login(email, password);
  return user;
}
