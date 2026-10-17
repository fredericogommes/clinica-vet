import { z } from 'zod';

/**
 * Prescrição da internação [p.15, RN-40/42]: medicamento, dose, via e intervalo, aprazada a partir
 * do primeiro horário. Cada horário vira uma execução com programado × executado e autor. A dose
 * por peso é calculada do peso atual do animal, com o volume final quando há concentração.
 */

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${String(max)} caracteres`);

export const doseUnits = [
  'mg/kg',
  'mcg/kg',
  'UI/kg',
  'mL/kg',
  'mg',
  'mcg',
  'UI',
  'mL',
  'comprimido',
  'gota',
] as const;
export type DoseUnit = (typeof doseUnits)[number];

export const prescriptionRoutes = [
  'IV',
  'IM',
  'SC',
  'VO',
  'Tópica',
  'Oftálmica',
  'Otológica',
  'Inalatória',
  'Retal',
] as const;
export type PrescriptionRoute = (typeof prescriptionRoutes)[number];
export const routeLabels: Record<PrescriptionRoute, string> = {
  IV: 'Intravenosa (IV)',
  IM: 'Intramuscular (IM)',
  SC: 'Subcutânea (SC)',
  VO: 'Oral (VO)',
  Tópica: 'Tópica',
  Oftálmica: 'Oftálmica',
  Otológica: 'Otológica',
  Inalatória: 'Inalatória',
  Retal: 'Retal',
};

/** Unidade da quantidade (a dose sem o "/kg") e da concentração por mL, quando faz sentido. */
export function amountUnitOf(unit: DoseUnit): string {
  return unit.endsWith('/kg') ? unit.slice(0, -3) : unit;
}
export function concentrationUnitOf(unit: DoseUnit): string | null {
  const amount = amountUnitOf(unit);
  return amount === 'mg' || amount === 'mcg' || amount === 'UI' ? `${amount}/mL` : null;
}

export interface DoseCalculation {
  /** Quantidade a dar por horário, na unidade `amountUnit`; nula sem o peso para dose por kg. */
  amount: number | null;
  amountUnit: string;
  /** Volume final em mL: dose em mL, ou quantidade ÷ concentração. */
  volumeMl: number | null;
  /** Dose por kg sem peso registrado: a enfermagem não tem como calcular. */
  missingWeight: boolean;
}

const round = (value: number, places: number) => {
  const f = 10 ** places;
  return Math.round(value * f) / f;
};

/**
 * Dose por peso [RN-42, D5]: dose × peso atual para as unidades por kg; o volume sai da
 * concentração (mg/mL, mcg/mL, UI/mL) ou é a própria dose em mL.
 */
export function calculateDose(input: {
  dose: number;
  doseUnit: DoseUnit;
  concentration: number | null;
  weightKg: number | null;
}): DoseCalculation {
  const perKg = input.doseUnit.endsWith('/kg');
  const amountUnit = amountUnitOf(input.doseUnit);
  if (perKg && input.weightKg === null) {
    return { amount: null, amountUnit, volumeMl: null, missingWeight: true };
  }
  const amount = round(perKg ? input.dose * (input.weightKg ?? 0) : input.dose, 3);
  let volumeMl: number | null = null;
  if (amountUnit === 'mL') volumeMl = amount;
  else if (input.concentration && concentrationUnitOf(input.doseUnit)) {
    volumeMl = round(amount / input.concentration, 2);
  }
  return { amount, amountUnit, volumeMl, missingWeight: false };
}

/**
 * Horários previstos de uma prescrição entre `from` (inclusive) e `to` (exclusive): o primeiro
 * horário mais múltiplos do intervalo, até o fim da duração, a suspensão ou o fim da internação.
 */
export function scheduleTimes(
  p: { firstAt: string; intervalHours: number; endsAt: string | null },
  from: Date,
  to: Date,
): Date[] {
  const first = new Date(p.firstAt).getTime();
  const step = p.intervalHours * 3_600_000;
  const end = Math.min(to.getTime(), p.endsAt ? new Date(p.endsAt).getTime() : Infinity);
  const startK = Math.max(0, Math.ceil((from.getTime() - first) / step));
  const times: Date[] = [];
  for (let t = first + startK * step; t < end; t += step) times.push(new Date(t));
  return times;
}

export const executionStatuses = ['done', 'skipped'] as const;
export type ExecutionStatus = (typeof executionStatuses)[number];
export const executionStatusLabels: Record<ExecutionStatus, string> = {
  done: 'Executado',
  skipped: 'Não executado',
};

export const executionSchema = z.object({
  id: z.uuid(),
  scheduledAt: z.iso.datetime({ offset: true }),
  executedAt: z.iso.datetime({ offset: true }),
  status: z.enum(executionStatuses),
  notes: z.string(),
  by: z.string(),
  /** O que foi calculado no momento: peso usado, quantidade e volume. */
  weightKg: z.number().nullable(),
  amount: z.number().nullable(),
  volumeMl: z.number().nullable(),
});
export type Execution = z.infer<typeof executionSchema>;

/** Horário do dia: previsto, com a execução se houve; pendente ou vencido se não. */
export const scheduledDoseSchema = z.object({
  scheduledAt: z.iso.datetime({ offset: true }),
  execution: executionSchema.nullable(),
});
export type ScheduledDose = z.infer<typeof scheduledDoseSchema>;

export const prescriptionSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  dose: z.number(),
  doseUnit: z.enum(doseUnits),
  concentration: z.number().nullable(),
  route: z.enum(prescriptionRoutes),
  intervalHours: z.number().int(),
  firstAt: z.iso.datetime({ offset: true }),
  durationDays: z.number().int().nullable(),
  /** Fim do aprazamento: duração, suspensão ou fim da internação, o que vier antes. */
  endsAt: z.iso.datetime({ offset: true }).nullable(),
  notes: z.string(),
  prescribedBy: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  stopped: z
    .object({ at: z.iso.datetime({ offset: true }), by: z.string(), reason: z.string() })
    .nullable(),
  /** Horários do dia consultado. */
  doses: z.array(scheduledDoseSchema),
});
export type Prescription = z.infer<typeof prescriptionSchema>;

export const prescriptionDayQuerySchema = z.object({ date: z.iso.date() });

export const prescriptionDaySchema = z.object({
  date: z.iso.date(),
  timeZone: z.string(),
  /** Peso atual do animal, usado no cálculo da dose. */
  weightKg: z.number().nullable(),
  prescriptions: z.array(prescriptionSchema),
});
export type PrescriptionDay = z.infer<typeof prescriptionDaySchema>;

export const prescriptionInputSchema = z
  .object({
    name: text(120).min(2, 'Informe o medicamento'),
    dose: z
      .number({ message: 'Informe a dose' })
      .positive('A dose precisa ser maior que zero')
      .max(100_000, 'Dose alta demais'),
    doseUnit: z.enum(doseUnits),
    concentration: z
      .number({ message: 'Informe um número' })
      .positive('A concentração precisa ser maior que zero')
      .max(1_000_000, 'Concentração alta demais')
      .nullable()
      .default(null),
    route: z.enum(prescriptionRoutes, { message: 'Escolha a via' }),
    intervalHours: z
      .number({ message: 'Informe o intervalo' })
      .int('Use horas inteiras')
      .min(1, 'Mínimo de 1 hora')
      .max(72, 'Máximo de 72 horas'),
    firstAt: z.iso.datetime({ offset: true, message: 'Informe o primeiro horário' }),
    durationDays: z
      .number({ message: 'Informe um número' })
      .int('Use dias inteiros')
      .min(1, 'Mínimo de 1 dia')
      .max(90, 'Máximo de 90 dias')
      .nullable()
      .default(null),
    notes: text(500).default(''),
  })
  .refine((p) => p.concentration === null || concentrationUnitOf(p.doseUnit) !== null, {
    path: ['concentration'],
    message: 'Concentração só vale para dose em mg, mcg ou UI',
  });
export type PrescriptionInput = z.input<typeof prescriptionInputSchema>;

export const stopPrescriptionSchema = z.object({
  reason: text(300).min(3, 'Explique o motivo em poucas palavras'),
});

export const executeDoseSchema = z
  .object({
    scheduledAt: z.iso.datetime({ offset: true }),
    executedAt: z.iso.datetime({ offset: true, message: 'Informe quando foi executado' }),
    status: z.enum(executionStatuses),
    notes: text(500).default(''),
  })
  .refine((e) => e.status === 'done' || e.notes.length > 0, {
    path: ['notes'],
    message: 'Diga por que não foi executado',
  });
export type ExecuteDoseInput = z.input<typeof executeDoseSchema>;

/** Mapa de execução [p.15]: internados em linhas, 24 horas em colunas. */
export const executionMapQuerySchema = z.object({
  date: z.iso.date(),
  q: z.string().trim().max(100).default(''),
  /** Só quem tem horário pendente ou vencido no dia. */
  pendingOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export const executionMapCellSchema = z.object({
  hour: z.number().int(),
  /** Ainda por fazer, com horário no futuro. */
  pending: z.number().int(),
  /** Horário passado sem execução. */
  overdue: z.number().int(),
  done: z.number().int(),
});

export const executionMapSchema = z.object({
  date: z.iso.date(),
  rows: z.array(
    z.object({
      hospitalizationId: z.uuid(),
      patient: z.string(),
      box: z.string().nullable(),
      priority: z.enum(['routine', 'attention', 'urgent']),
      cells: z.array(executionMapCellSchema),
    }),
  ),
  totals: z.object({
    pending: z.number().int(),
    overdue: z.number().int(),
    done: z.number().int(),
  }),
});
export type ExecutionMap = z.infer<typeof executionMapSchema>;
