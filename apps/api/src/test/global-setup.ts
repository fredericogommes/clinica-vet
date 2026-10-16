import { randomBytes } from 'node:crypto';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { createDatabase } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';

/**
 * Cria um banco PostgreSQL descartável a partir de TEST_DATABASE_ADMIN_URL (uma conexão com
 * permissão de CREATE DATABASE), aplica as migrações reais e remove o banco no final.
 */
export default async function setup(project: TestProject) {
  const adminUrl =
    process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://clinica:clinica_dev@127.0.0.1:5432/postgres';
  const name = `clinica_test_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const { db, pool } = createDatabase(url.toString());
  await runMigrations(db);
  await pool.end();
  project.provide('databaseUrl', url.toString());

  return async () => {
    const cleanup = new pg.Client({ connectionString: adminUrl });
    await cleanup.connect();
    await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await cleanup.end();
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
