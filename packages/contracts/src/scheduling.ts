import { z } from 'zod';

/** 0 = domingo … 6 = sábado, como `Date.getDay()`. */
export const weekdays = [0, 1, 2, 3, 4, 5, 6] as const;
export const weekdaySchema = z.number().int().min(0).max(6);

/** Passo da grade de horários livres e da escala, em minutos. */
export const SLOT_STEP_MINUTES = 15;
export const DEFAULT_DURATION_MINUTES = 60;

const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "08:30" → 510. Aceita "24:00" como fim do dia. */
export function toMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/** 510 → "08:30". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export const timeSchema = z.string().regex(hhmm, 'Hora inválida');
/** Fim de faixa: aceita também "24:00" (turno que vai até a meia-noite). */
export const endTimeSchema = z
  .string()
  .refine((v) => hhmm.test(v) || v === '24:00', 'Hora inválida');

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Data inválida');

export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês inválido');

/** Faixa de horário de um dia, sempre dentro do mesmo dia. */
export const timeRangeSchema = z
  .object({ start: timeSchema, end: endTimeSchema })
  .refine((r) => toMinutes(r.end) > toMinutes(r.start), {
    path: ['end'],
    message: 'O fim deve ser depois do início',
  });
export type TimeRange = z.infer<typeof timeRangeSchema>;

const weekdayRangeSchema = z
  .object({ weekday: weekdaySchema, start: timeSchema, end: endTimeSchema })
  .refine((r) => toMinutes(r.end) > toMinutes(r.start), {
    path: ['end'],
    message: 'O fim deve ser depois do início',
  });
export type WeekdayRange = z.infer<typeof weekdayRangeSchema>;

const oneRangePerWeekday = (ranges: WeekdayRange[], ctx: z.RefinementCtx) => {
  const seen = new Set<number>();
  ranges.forEach((r, i) => {
    if (seen.has(r.weekday)) {
      ctx.addIssue({ code: 'custom', path: [i, 'weekday'], message: 'Dia repetido' });
    }
    seen.add(r.weekday);
  });
};

/** Horário de funcionamento da unidade: uma faixa por dia; dia ausente = fechado. */
export const openingHoursInputSchema = z.object({
  days: z.array(weekdayRangeSchema).max(7).superRefine(oneRangePerWeekday),
});
export type OpeningHoursInput = z.infer<typeof openingHoursInputSchema>;

export const scheduleModes = ['fixed', 'variable'] as const;
export type ScheduleMode = (typeof scheduleModes)[number];

/** Profissional com agenda: horário fixo semanal ou escala variável (plantões lançados na Escala). */
export const scheduleMemberInputSchema = z
  .object({
    mode: z.enum(scheduleModes),
    fixedHours: z.array(weekdayRangeSchema).max(7).superRefine(oneRangePerWeekday),
  })
  .superRefine((m, ctx) => {
    if (m.mode === 'fixed' && m.fixedHours.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['fixedHours'],
        message: 'Informe ao menos um dia de atendimento',
      });
    }
  })
  .transform((m) => (m.mode === 'variable' ? { ...m, fixedHours: [] } : m));
export type ScheduleMemberInput = z.input<typeof scheduleMemberInputSchema>;

export const scheduleConfigSchema = z.object({
  timeZone: z.string(),
  openingHours: z.array(weekdayRangeSchema),
  members: z.array(
    z.object({
      userId: z.uuid(),
      name: z.string(),
      mode: z.enum(scheduleModes),
      fixedHours: z.array(weekdayRangeSchema),
    }),
  ),
  /** Usuários ativos da unidade que ainda não têm agenda. */
  candidates: z.array(z.object({ id: z.uuid(), name: z.string() })),
});
export type ScheduleConfig = z.infer<typeof scheduleConfigSchema>;

export const shiftInputSchema = z
  .object({
    userId: z.uuid(),
    date: isoDateSchema,
    start: timeSchema,
    end: endTimeSchema,
  })
  .refine((s) => toMinutes(s.end) > toMinutes(s.start), {
    path: ['end'],
    message: 'O fim deve ser depois do início',
  });
export type ShiftInput = z.infer<typeof shiftInputSchema>;

export const shiftSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  userName: z.string(),
  date: z.string(),
  start: z.string(),
  end: z.string(),
  confirmed: z.boolean(),
});
export type Shift = z.infer<typeof shiftSchema>;

export const shiftMonthQuerySchema = z.object({ month: monthSchema });
export const confirmShiftsResultSchema = z.object({ confirmed: z.number().int() });

export const appointmentTypeSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  durationMinutes: z.number().int(),
  archived: z.boolean(),
});
export type AppointmentType = z.infer<typeof appointmentTypeSchema>;

export const durationSchema = z
  .number({ message: 'Informe a duração' })
  .int()
  .min(SLOT_STEP_MINUTES, `Mínimo de ${SLOT_STEP_MINUTES} minutos`)
  .max(12 * 60, 'Máximo de 12 horas')
  .refine((v) => v % SLOT_STEP_MINUTES === 0, `Use múltiplos de ${SLOT_STEP_MINUTES} minutos`);

export const appointmentTypeInputSchema = z.object({
  name: z.string().trim().min(2, 'Mínimo de 2 caracteres').max(80, 'Máximo de 80 caracteres'),
  durationMinutes: durationSchema,
  archived: z.boolean().default(false),
});
export type AppointmentTypeInput = z.input<typeof appointmentTypeInputSchema>;

/**
 * Ciclo do agendamento [RN-13]. "Atrasado" não é status: é derivado de horário vencido sem
 * chegada (premissa L7). Cancelado e Não compareceu encerram o ciclo e liberam o horário.
 */
export const appointmentStatuses = [
  'scheduled',
  'confirmed',
  'waiting',
  'in_progress',
  'ready',
  'cancelled',
  'no_show',
] as const;
export type AppointmentStatus = (typeof appointmentStatuses)[number];

export const appointmentStatusLabels: Record<AppointmentStatus, string> = {
  scheduled: 'Agendado',
  confirmed: 'Confirmado',
  waiting: 'Em espera',
  in_progress: 'Em atendimento',
  ready: 'Animal pronto',
  cancelled: 'Cancelado',
  no_show: 'Não compareceu',
};

export const recurrenceFrequencies = ['daily', 'weekly', 'biweekly', 'monthly'] as const;
export type RecurrenceFrequency = (typeof recurrenceFrequencies)[number];

export const recurrenceFrequencyLabels: Record<RecurrenceFrequency, string> = {
  daily: 'Todo dia',
  weekly: 'Toda semana',
  biweekly: 'A cada 2 semanas',
  monthly: 'Todo mês',
};

export const MAX_OCCURRENCES = 52;

const notes = z
  .string()
  .trim()
  .max(1000, 'Máximo de 1000 caracteres')
  .transform((v) => (v === '' ? null : v))
  .nullable();

const appointmentFields = {
  patientIds: z
    .array(z.uuid())
    .min(1, 'Selecione ao menos um animal')
    .max(10, 'Máximo de 10 animais')
    .refine((ids) => new Set(ids).size === ids.length, 'Animal repetido'),
  typeId: z.uuid({ message: 'Selecione o tipo de atendimento' }),
  durationMinutes: durationSchema,
  date: isoDateSchema,
  start: timeSchema,
  professionalId: z.uuid({ message: 'Selecione o profissional' }),
  notes,
  /** Encaixe: horário fora da escala do profissional. Exige permissão própria. */
  fitIn: z.boolean().default(false),
};

export const createAppointmentSchema = z.object({
  clientId: z.uuid(),
  ...appointmentFields,
  status: z.enum(['scheduled', 'confirmed']).default('scheduled'),
  recurrence: z
    .object({
      frequency: z.enum(recurrenceFrequencies),
      count: z
        .number()
        .int()
        .min(2, 'Mínimo de 2 ocorrências')
        .max(MAX_OCCURRENCES, `Máximo de ${MAX_OCCURRENCES} ocorrências`),
    })
    .nullable()
    .default(null),
});
export type CreateAppointmentInput = z.input<typeof createAppointmentSchema>;
export type CreateAppointmentData = z.output<typeof createAppointmentSchema>;

export const updateAppointmentSchema = z.object(appointmentFields);
export type UpdateAppointmentInput = z.input<typeof updateAppointmentSchema>;
export type UpdateAppointmentData = z.output<typeof updateAppointmentSchema>;

export const changeStatusSchema = z.object({
  status: z.enum(appointmentStatuses),
  reason: z
    .string()
    .trim()
    .max(200)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .default(null),
});
export type ChangeStatusInput = z.input<typeof changeStatusSchema>;

export const appointmentSchema = z.object({
  id: z.uuid(),
  /** Data e horas no fuso da unidade. */
  date: z.string(),
  start: z.string(),
  end: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  durationMinutes: z.number().int(),
  status: z.enum(appointmentStatuses),
  late: z.boolean(),
  /** Próximos status permitidos, calculados no servidor. */
  nextStatuses: z.array(z.enum(appointmentStatuses)),
  editable: z.boolean(),
  fitIn: z.boolean(),
  seriesId: z.uuid().nullable(),
  professional: z.object({ id: z.uuid(), name: z.string() }),
  client: z.object({
    id: z.uuid(),
    code: z.number().int(),
    name: z.string(),
    phone: z.string().nullable(),
  }),
  patients: z.array(z.object({ id: z.uuid(), name: z.string(), markings: z.array(z.string()) })),
  type: z.object({ id: z.uuid(), name: z.string() }),
  notes: z.string().nullable(),
  cancelReason: z.string().nullable(),
  milestones: z.object({
    confirmedAt: z.string().nullable(),
    arrivedAt: z.string().nullable(),
    startedAt: z.string().nullable(),
    readyAt: z.string().nullable(),
    cancelledAt: z.string().nullable(),
  }),
});
export type Appointment = z.infer<typeof appointmentSchema>;

export const appointmentListSchema = z.object({ items: z.array(appointmentSchema) });

export const agendaQuerySchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
    professionalId: z.uuid().optional(),
  })
  .refine((q) => q.to >= q.from, { path: ['to'], message: 'Período inválido' })
  .refine(
    (q) => (Date.parse(`${q.to}T00:00:00Z`) - Date.parse(`${q.from}T00:00:00Z`)) / 86_400_000 <= 42,
    { path: ['to'], message: 'Período máximo de 6 semanas' },
  );
export type AgendaQuery = z.infer<typeof agendaQuerySchema>;

export const agendaSchema = z.object({
  timeZone: z.string(),
  /** Data e minuto atuais no fuso da unidade, para a linha do "agora" e o "Hoje". */
  today: z.string(),
  nowMinutes: z.number().int(),
  professionals: z.array(z.object({ id: z.uuid(), name: z.string() })),
  /** Faixas abertas para agendamento por profissional e dia (escala ∩ funcionamento). */
  availability: z.array(
    z.object({ userId: z.uuid(), date: z.string(), ranges: z.array(timeRangeSchema) }),
  ),
  openingHours: z.array(z.object({ date: z.string(), range: timeRangeSchema.nullable() })),
  appointments: z.array(appointmentSchema),
  metrics: z.object({
    averageWaitMinutes: z.number().nullable(),
    averageServiceMinutes: z.number().nullable(),
  }),
});
export type Agenda = z.infer<typeof agendaSchema>;

export const slotQuerySchema = z.object({
  date: isoDateSchema,
  durationMinutes: z.coerce.number().pipe(durationSchema),
  professionalId: z.uuid().optional(),
  /** Ao remarcar, o próprio agendamento não ocupa o horário. */
  excludeAppointmentId: z.uuid().optional(),
});
export type SlotQuery = z.infer<typeof slotQuerySchema>;

export const slotSchema = z.object({
  date: z.string(),
  start: z.string(),
  professionalId: z.uuid(),
  professionalName: z.string(),
});
export type Slot = z.infer<typeof slotSchema>;
