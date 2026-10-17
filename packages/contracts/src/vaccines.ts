import { z } from 'zod';

/**
 * Vacinas e protocolos [RN-20, p.5, p.12]: cada item do cadastro diz quantas doses tem a série
 * inicial, o intervalo entre elas e o reforço. A aplicação na ficha calcula a próxima dose, e o
 * protocolo do animal é a última aplicação de cada vacina, até ser encerrado.
 */
export const vaccineKinds = ['vaccine', 'dewormer', 'antiparasitic'] as const;
export type VaccineKind = (typeof vaccineKinds)[number];
export const vaccineKindLabels: Record<VaccineKind, string> = {
  vaccine: 'Vacina',
  dewormer: 'Vermífugo',
  antiparasitic: 'Antiparasitário',
};

/** Maior intervalo aceito entre doses (3 anos, como algumas antirrábicas). */
export const VACCINE_MAX_INTERVAL_DAYS = 1095;
/** Maior série inicial aceita. */
export const VACCINE_MAX_DOSES = 6;

const days = (label: string) =>
  z
    .number({ message: 'Informe os dias' })
    .int('Use um número inteiro')
    .min(1, `${label}: ao menos 1 dia`)
    .max(
      VACCINE_MAX_INTERVAL_DAYS,
      `${label}: no máximo ${String(VACCINE_MAX_INTERVAL_DAYS)} dias`,
    );

export const vaccineInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Informe o nome').max(80, 'Máximo de 80 caracteres'),
    kind: z.enum(vaccineKinds),
    /** Doses da série inicial (ex. 3 da polivalente do filhote). */
    primaryDoses: z
      .number({ message: 'Informe as doses' })
      .int('Use um número inteiro')
      .min(1, 'Ao menos 1 dose')
      .max(VACCINE_MAX_DOSES, `No máximo ${String(VACCINE_MAX_DOSES)} doses`),
    /** Dias entre as doses da série inicial; só quando há mais de uma. */
    primaryIntervalDays: days('Intervalo').nullable(),
    /** Dias até o reforço depois da série; nulo quando não há reforço. */
    boosterIntervalDays: days('Reforço').nullable(),
    /** Serviço lançado na venda aberta do animal na aplicação [RN-19]. */
    serviceId: z.uuid().nullable(),
    archived: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.primaryDoses > 1 && v.primaryIntervalDays === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['primaryIntervalDays'],
        message: 'Informe o intervalo entre as doses',
      });
    }
  });
export type VaccineInput = z.input<typeof vaccineInputSchema>;

const ref = z.object({ id: z.uuid(), name: z.string() });

export const vaccineSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: z.enum(vaccineKinds),
  primaryDoses: z.number().int(),
  primaryIntervalDays: z.number().int().nullable(),
  boosterIntervalDays: z.number().int().nullable(),
  service: ref.nullable(),
  archived: z.boolean(),
});
export type Vaccine = z.infer<typeof vaccineSchema>;

/** "Anual", "A cada 90 dias", "3 doses a cada 21 dias, depois anual", "Dose única". */
export function vaccinePeriodicity(
  v: Pick<Vaccine, 'primaryDoses' | 'primaryIntervalDays' | 'boosterIntervalDays'>,
): string {
  const every = (d: number) =>
    d === 365
      ? 'anual'
      : d % 365 === 0
        ? `a cada ${String(d / 365)} anos`
        : `a cada ${String(d)} dias`;
  const booster = v.boosterIntervalDays === null ? null : every(v.boosterIntervalDays);
  if (v.primaryDoses === 1) {
    if (!booster) return 'Dose única';
    return booster.charAt(0).toUpperCase() + booster.slice(1);
  }
  const series = `${String(v.primaryDoses)} doses a cada ${String(v.primaryIntervalDays ?? 0)} dias`;
  return booster ? `${series}, depois ${booster}` : series;
}

/** Dose da aplicação: 1ª, 2ª... da série; depois dela, reforço. */
export function doseLabel(doseNumber: number, primaryDoses: number): string {
  return doseNumber > primaryDoses ? 'Reforço' : `${String(doseNumber)}ª dose`;
}

/** Próxima dose a partir da data da aplicação (AAAA-MM-DD), pela série e pelo reforço. */
export function nextDoseOn(
  v: Pick<Vaccine, 'primaryDoses' | 'primaryIntervalDays' | 'boosterIntervalDays'>,
  doseNumber: number,
  appliedOn: string,
): string | null {
  const interval = doseNumber < v.primaryDoses ? v.primaryIntervalDays : v.boosterIntervalDays;
  if (interval === null) return null;
  const date = new Date(`${appliedOn}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + interval);
  return date.toISOString().slice(0, 10);
}

/** Sugestão do formulário de aplicação: dose seguinte e data da próxima. */
export const vaccinationFormSchema = z.object({
  vaccine: vaccineSchema,
  doseNumber: z.number().int(),
  appliedOn: z.iso.date(),
  nextDueOn: z.iso.date().nullable(),
});
export type VaccinationForm = z.infer<typeof vaccinationFormSchema>;

/** Situação do protocolo na data de hoje da unidade. */
export const protocolStatuses = ['scheduled', 'due_soon', 'overdue', 'no_next', 'closed'] as const;
export type ProtocolStatus = (typeof protocolStatuses)[number];
export const protocolStatusLabels: Record<ProtocolStatus, string> = {
  scheduled: 'Programada',
  due_soon: 'A vencer',
  overdue: 'Vencida',
  no_next: 'Sem próxima dose',
  closed: 'Encerrado',
};
/** Janela de "a vencer", em dias. */
export const PROTOCOL_DUE_SOON_DAYS = 30;

export function protocolStatus(
  nextDueOn: string | null,
  today: string,
  closed: boolean,
): ProtocolStatus {
  if (closed) return 'closed';
  if (nextDueOn === null) return 'no_next';
  if (nextDueOn < today) return 'overdue';
  const soon = new Date(`${today}T12:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + PROTOCOL_DUE_SOON_DAYS);
  return nextDueOn <= soon.toISOString().slice(0, 10) ? 'due_soon' : 'scheduled';
}

/** Protocolo do animal [p.5]: a última aplicação publicada de cada vacina. */
export const protocolSchema = z.object({
  vaccine: ref.extend({ kind: z.enum(vaccineKinds), periodicity: z.string() }),
  lastEventId: z.uuid(),
  lastAppliedAt: z.string(),
  lastDose: z.string(),
  doses: z.number().int(),
  nextDueOn: z.iso.date().nullable(),
  status: z.enum(protocolStatuses),
  closure: z.object({ at: z.string(), by: z.string(), reason: z.string() }).nullable(),
});
export type Protocol = z.infer<typeof protocolSchema>;

export const closeProtocolSchema = z.object({
  reason: z.string().trim().min(3, 'Explique o motivo em poucas palavras').max(300),
});

/** Consulta Vacinação [p.17]: animais com dose vencida ou a vencer, para a busca ativa. */
export const vaccinationDueQuerySchema = z.object({
  situacao: z.enum(['vencidas', 'a-vencer', 'todas']).default('todas'),
  /** Considera as doses até esta data; padrão: hoje + 30 dias. */
  ate: z.iso.date().optional(),
  tipo: z.enum(vaccineKinds).optional(),
  especie: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type VaccinationDueQuery = z.input<typeof vaccinationDueQuerySchema>;

export const vaccinationDueItemSchema = z.object({
  patient: z.object({ id: z.uuid(), code: z.number().int(), name: z.string() }),
  species: z.string().nullable(),
  client: z.object({
    id: z.uuid(),
    name: z.string(),
    phone: z.string().nullable(),
    whatsapp: z.boolean(),
  }),
  vaccine: ref.extend({ kind: z.enum(vaccineKinds) }),
  lastAppliedAt: z.string(),
  lastDose: z.string(),
  nextDueOn: z.iso.date(),
  /** Positivo: dias de atraso; negativo: dias que faltam. */
  daysLate: z.number().int(),
});
export type VaccinationDueItem = z.infer<typeof vaccinationDueItemSchema>;

export const vaccinationDueSchema = z.object({
  items: z.array(vaccinationDueItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  overdue: z.number().int(),
  dueSoon: z.number().int(),
  until: z.iso.date(),
  today: z.iso.date(),
});
export type VaccinationDue = z.infer<typeof vaccinationDueSchema>;
