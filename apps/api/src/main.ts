import { loadConfig } from './core/config.js';
import { createDatabase } from './db/client.js';
import { buildApp, whatsappSender } from './http/app.js';
import { MessagingService } from './modules/messaging/service.js';

const config = loadConfig();
const { db, pool } = createDatabase(config.DATABASE_URL);
const app = await buildApp(config, db);

// Mensagens automáticas [RN-34]: gera e envia em rodadas; a chave única da fila evita duplicar.
const messaging = new MessagingService(db, whatsappSender(config));
let running = false;
const runMessages = async () => {
  if (running) return;
  running = true;
  try {
    const result = await messaging.runAll();
    if (result.created || result.sent) app.log.info(result, 'mensagens automáticas');
  } catch (error) {
    app.log.error({ err: error }, 'falha nas mensagens automáticas');
  } finally {
    running = false;
  }
};
const timer =
  config.MESSAGES_INTERVAL_MINUTES > 0
    ? setInterval(() => void runMessages(), config.MESSAGES_INTERVAL_MINUTES * 60_000)
    : undefined;

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'encerrando');
  clearInterval(timer);
  await app.close();
  await pool.end();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.API_HOST, port: config.API_PORT });
if (timer) void runMessages();
