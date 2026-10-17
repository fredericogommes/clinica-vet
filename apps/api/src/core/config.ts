import { z } from 'zod';

/** Variável opcional; vazia (como o docker-compose repassa) conta como ausente. */
const optionalText = z
  .string()
  .optional()
  .transform((v) => v?.trim() || undefined);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url(),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** Origem do frontend, a única aceita por CORS. */
  WEB_ORIGIN: z.url(),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** WhatsApp Business (API oficial da Meta). Sem os dois, as mensagens saem pela fila manual. */
  WHATSAPP_TOKEN: optionalText,
  WHATSAPP_PHONE_NUMBER_ID: optionalText,
  WHATSAPP_API_URL: z.url().default('https://graph.facebook.com/v21.0'),
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().default('pt_BR'),
  /** Minutos entre as rodadas de geração e envio das mensagens automáticas; 0 desliga. */
  MESSAGES_INTERVAL_MINUTES: z.coerce.number().int().min(0).max(1440).default(5),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Configuração inválida:\n${problems.join('\n')}`);
  }
  return parsed.data;
}
