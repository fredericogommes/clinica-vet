import { loadConfig } from './core/config.js';
import { createDatabase } from './db/client.js';
import { buildApp } from './http/app.js';

const config = loadConfig();
const { db, pool } = createDatabase(config.DATABASE_URL);
const app = await buildApp(config, db);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'encerrando');
  await app.close();
  await pool.end();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.API_HOST, port: config.API_PORT });
