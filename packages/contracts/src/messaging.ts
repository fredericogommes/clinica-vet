import { z } from 'zod';

/**
 * Mensagens automáticas [p.20–21, RN-34]: gatilhos que geram mensagens de WhatsApp para os
 * clientes, ligados por padrão. Cada mensagem entra numa fila; com a API oficial configurada
 * ela sai sozinha, e sem ela a recepção envia pelo próprio WhatsApp a partir da fila.
 */
export const messageTriggers = [
  'vaccine_reminder',
  'appointment_reminder',
  'exam_result',
  'welcome_client',
  'welcome_patient',
  'patient_birthday',
  'client_birthday',
] as const;
export type MessageTrigger = (typeof messageTriggers)[number];

export const messageTriggerLabels: Record<MessageTrigger, string> = {
  vaccine_reminder: 'Lembrete de vacina e vermifugação',
  appointment_reminder: 'Lembrete de agendamento',
  exam_result: 'Resultado de exame',
  welcome_client: 'Boas-vindas para novos clientes',
  welcome_patient: 'Boas-vindas para novos animais',
  patient_birthday: 'Aniversário do animal',
  client_birthday: 'Aniversário do cliente',
};

export const messageTriggerDescriptions: Record<MessageTrigger, string> = {
  vaccine_reminder:
    'Sai antes da próxima dose de cada protocolo vacinal em aberto. Protocolos encerrados e animais em óbito ficam de fora.',
  appointment_reminder:
    'Sai antes de cada agendamento ainda não iniciado, para o responsável confirmar ou remarcar.',
  exam_result: 'Sai quando um resultado de exame é finalizado na ficha.',
  welcome_client: 'Sai quando um cliente novo é cadastrado.',
  welcome_patient: 'Sai quando um animal novo é cadastrado.',
  patient_birthday: 'Sai no dia do aniversário do animal, para quem tem data de nascimento.',
  client_birthday: 'Sai no dia do aniversário do cliente, para quem tem data de nascimento.',
};

/** Variáveis aceitas no texto; `{cliente}` é o primeiro nome do responsável. */
export const messageVariables = {
  cliente: 'Primeiro nome do cliente',
  clinica: 'Nome da clínica',
  animal: 'Nome do animal',
  vacina: 'Vacina ou vermífugo',
  exame: 'Nome do exame',
  data: 'Data (dd/mm/aaaa)',
  hora: 'Hora (hh:mm)',
  profissional: 'Profissional do agendamento',
} as const;
export type MessageVariable = keyof typeof messageVariables;

export const triggerVariables: Record<MessageTrigger, readonly MessageVariable[]> = {
  vaccine_reminder: ['cliente', 'animal', 'vacina', 'data', 'clinica'],
  appointment_reminder: ['cliente', 'animal', 'data', 'hora', 'profissional', 'clinica'],
  exam_result: ['cliente', 'animal', 'exame', 'clinica'],
  welcome_client: ['cliente', 'clinica'],
  welcome_patient: ['cliente', 'animal', 'clinica'],
  patient_birthday: ['cliente', 'animal', 'clinica'],
  client_birthday: ['cliente', 'clinica'],
};

/** Antecedência: dias para o lembrete de vacina, horas para o de agendamento. */
export const triggerOffsets: Partial<
  Record<MessageTrigger, { unit: 'days' | 'hours'; min: number; max: number; default: number }>
> = {
  vaccine_reminder: { unit: 'days', min: 0, max: 30, default: 3 },
  appointment_reminder: { unit: 'hours', min: 1, max: 72, default: 24 },
};

export const defaultTemplates: Record<MessageTrigger, string> = {
  vaccine_reminder:
    'Olá, {cliente}! A próxima dose de {vacina} de {animal} vence em {data}. Responda esta mensagem para agendar a aplicação na {clinica}.',
  appointment_reminder:
    'Olá, {cliente}! Lembrete: {animal} tem horário na {clinica} em {data} às {hora} com {profissional}. Para confirmar ou remarcar, responda esta mensagem.',
  exam_result:
    'Olá, {cliente}! O resultado do exame {exame} de {animal} já está pronto na {clinica}. Responda esta mensagem se quiser falar com o veterinário.',
  welcome_client:
    'Olá, {cliente}! Que bom ter você com a gente na {clinica}. Qualquer dúvida, é só responder esta mensagem.',
  welcome_patient:
    'Olá, {cliente}! O cadastro de {animal} está pronto na {clinica}. Estamos à disposição para cuidar bem de vocês.',
  patient_birthday:
    'Parabéns, {animal}! Hoje é dia de festa, {cliente}. Toda a equipe da {clinica} deseja muita saúde e alegria.',
  client_birthday:
    'Feliz aniversário, {cliente}! A equipe da {clinica} deseja um dia muito especial.',
};

export const MESSAGE_TEMPLATE_MAX = 700;

/** Variáveis na ordem em que aparecem no texto (é a ordem dos parâmetros do modelo da Meta). */
export function templateVariables(template: string): string[] {
  return [...template.matchAll(/\{([a-z]+)\}/g)].map((m) => m[1] ?? '');
}

/** Troca cada `{variável}` pelo valor; variável sem valor vira texto vazio. */
export function renderTemplate(
  template: string,
  values: Partial<Record<MessageVariable, string>>,
): string {
  return template.replace(/\{([a-z]+)\}/g, (_, name: string) =>
    Object.hasOwn(values, name) ? (values[name as MessageVariable] ?? '') : '',
  );
}

/** Exemplo usado na prévia da tela de configuração. */
export const sampleMessageValues: Record<MessageVariable, string> = {
  cliente: 'Ana',
  clinica: 'Clínica Exemplo',
  animal: 'Thor',
  vacina: 'Antirrábica',
  exame: 'Hemograma',
  data: '18/11/2026',
  hora: '14:30',
  profissional: 'Dra. Marina',
};

export const messageSettingInputSchema = z
  .object({
    trigger: z.enum(messageTriggers),
    enabled: z.boolean(),
    offset: z.number({ message: 'Informe a antecedência' }).int('Use um número inteiro').nullable(),
    template: z
      .string()
      .trim()
      .min(10, 'Escreva a mensagem')
      .max(MESSAGE_TEMPLATE_MAX, `No máximo ${String(MESSAGE_TEMPLATE_MAX)} caracteres`),
    /** Nome do modelo aprovado na Meta para o envio automático; vazio = envio pela fila. */
    providerTemplate: z
      .string()
      .trim()
      .max(512)
      .regex(/^[a-z0-9_]*$/, 'Use letras minúsculas, números e _ como na Meta'),
  })
  .superRefine((v, ctx) => {
    const allowed = triggerVariables[v.trigger] as readonly string[];
    const unknown = templateVariables(v.template).filter((name) => !allowed.includes(name));
    if (unknown.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['template'],
        message: `Variável que esta mensagem não conhece: ${unknown.map((n) => `{${n}}`).join(', ')}`,
      });
    }
    const offset = triggerOffsets[v.trigger];
    if (offset) {
      const unit = offset.unit === 'days' ? 'dias' : 'horas';
      if (v.offset === null || v.offset < offset.min || v.offset > offset.max) {
        ctx.addIssue({
          code: 'custom',
          path: ['offset'],
          message: `Entre ${String(offset.min)} e ${String(offset.max)} ${unit}`,
        });
      }
    } else if (v.offset !== null) {
      ctx.addIssue({ code: 'custom', path: ['offset'], message: 'Sem antecedência' });
    }
  });
export type MessageSettingInput = z.input<typeof messageSettingInputSchema>;

export const messageSettingSchema = z.object({
  trigger: z.enum(messageTriggers),
  enabled: z.boolean(),
  offset: z.number().nullable(),
  template: z.string(),
  providerTemplate: z.string(),
  /** Desde quando está ligado: boas-vindas e resultados anteriores não geram mensagem. */
  activeSince: z.string(),
});
export type MessageSetting = z.infer<typeof messageSettingSchema>;

export const messagingSettingsSchema = z.object({
  /** `api`: credenciais da API oficial no servidor; `manual`: envio pela fila. */
  delivery: z.enum(['api', 'manual']),
  settings: z.array(messageSettingSchema),
});
export type MessagingSettings = z.infer<typeof messagingSettingsSchema>;

export const messageStatuses = ['pending', 'sent', 'failed', 'skipped', 'cancelled'] as const;
export type MessageStatus = (typeof messageStatuses)[number];
export const messageStatusLabels: Record<MessageStatus, string> = {
  pending: 'Aguardando envio',
  sent: 'Enviada',
  failed: 'Falhou',
  skipped: 'Não enviada',
  cancelled: 'Cancelada',
};

export const skipReasons = ['no_phone', 'no_consent'] as const;
export type SkipReason = (typeof skipReasons)[number];
export const skipReasonLabels: Record<SkipReason, string> = {
  no_phone: 'Cliente sem celular',
  no_consent: 'Cliente recusou WhatsApp',
};

export const messageQuerySchema = z.object({
  situacao: z.enum(['aguardando', 'enviadas', 'nao-enviadas', 'todas']).default('aguardando'),
  tipo: z.enum(messageTriggers).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type MessageQuery = z.input<typeof messageQuerySchema>;

export const messageSchema = z.object({
  id: z.string(),
  trigger: z.enum(messageTriggers),
  status: z.enum(messageStatuses),
  client: z.object({ id: z.string(), name: z.string() }),
  patient: z.object({ id: z.string(), name: z.string() }).nullable(),
  /** Celular com DDD, só dígitos; nulo quando o cliente não tem. */
  phone: z.string().nullable(),
  body: z.string(),
  skipReason: z.enum(skipReasons).nullable(),
  /** `api` ou `manual` (enviada pela fila). */
  channel: z.enum(['api', 'manual']).nullable(),
  sentAt: z.string().nullable(),
  sentBy: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
});
export type Message = z.infer<typeof messageSchema>;

export const messageListSchema = z.object({
  items: z.array(messageSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  counts: z.object({
    pending: z.number().int(),
    sentToday: z.number().int(),
    notSent: z.number().int(),
  }),
  delivery: z.enum(['api', 'manual']),
});
export type MessageList = z.infer<typeof messageListSchema>;

export const messageRunSchema = z.object({ created: z.number().int(), sent: z.number().int() });
export type MessageRun = z.infer<typeof messageRunSchema>;

/** Link do WhatsApp com o texto pronto (envio manual). Celular brasileiro: prefixo 55. */
export function whatsappLink(phone: string, text: string): string {
  return `https://wa.me/55${phone}?text=${encodeURIComponent(text)}`;
}
