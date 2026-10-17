import { z } from 'zod';

/**
 * Internação [p.14–16, RN-40/41]: boxes da unidade, a internação do animal do começo ao fim
 * (alta, óbito ou cancelamento) e o histórico com ocorrências, peso, parâmetros clínicos e
 * relatório médico.
 */

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${String(max)} caracteres`);
const ref = z.object({ id: z.uuid(), name: z.string() });

/** Box com tipo, capacidade e espécies aceitas [p.15, "o que melhorar"]. */
export const boxKinds = ['general', 'isolation', 'icu', 'feline'] as const;
export type BoxKind = (typeof boxKinds)[number];
export const boxKindLabels: Record<BoxKind, string> = {
  general: 'Geral',
  isolation: 'Isolamento',
  icu: 'UTI',
  feline: 'Felinos',
};

export const boxSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  code: z.string(),
  kind: z.enum(boxKinds),
  capacity: z.number().int(),
  /** Espécies aceitas; vazio aceita qualquer espécie. */
  species: z.array(ref),
  archived: z.boolean(),
  /** Animais internados agora no box. */
  occupied: z.number().int(),
});
export type Box = z.infer<typeof boxSchema>;

export const boxInputSchema = z.object({
  name: text(60).min(1, 'Informe o nome'),
  code: text(12).min(1, 'Informe a sigla'),
  kind: z.enum(boxKinds),
  capacity: z
    .number({ message: 'Informe a capacidade' })
    .int('Use um número inteiro')
    .min(1, 'Mínimo de 1 animal')
    .max(50, 'Máximo de 50 animais'),
  speciesIds: z.array(z.uuid()).max(20).default([]),
  archived: z.boolean().default(false),
});
export type BoxInput = z.input<typeof boxInputSchema>;

/** Prioridade da internação: define a tarja do cartão no painel [p.14]. */
export const hospitalizationPriorities = ['routine', 'attention', 'urgent'] as const;
export type HospitalizationPriority = (typeof hospitalizationPriorities)[number];
export const hospitalizationPriorityLabels: Record<HospitalizationPriority, string> = {
  routine: 'Estável',
  attention: 'Atenção',
  urgent: 'Urgente',
};

export const hospitalizationStatuses = ['admitted', 'discharged', 'deceased', 'cancelled'] as const;
export type HospitalizationStatus = (typeof hospitalizationStatuses)[number];
export const hospitalizationStatusLabels: Record<HospitalizationStatus, string> = {
  admitted: 'Internado',
  discharged: 'Alta',
  deceased: 'Óbito',
  cancelled: 'Cancelada',
};

/**
 * Parâmetros clínicos da internação com opções fechadas [RN-41, p.15]; FC, FR, PAS, glicemia e
 * desidratação são numéricos.
 */
export const clinicalParameterOptions = {
  appetite: { label: 'Apetite', options: ['Normal', 'Diminuído', 'Ausente', 'Seletivo'] },
  behavior: {
    label: 'Comportamento',
    options: [
      'Normal',
      'Alerta',
      'Responsivo',
      'Pouco responsivo',
      'Inquietação',
      'Agressivo',
      'Medroso',
      'Alteração de orientação',
    ],
  },
  feces: {
    label: 'Fezes',
    options: [
      'Normal',
      'Pastosa',
      'Amolecidas',
      'Diarreicas',
      'Líquidas',
      'Ressecadas',
      'Constipação',
      'Com muco',
      'Presença de sangue',
      'Enegrecidas',
      'Ausentes',
    ],
  },
  urine: { label: 'Urina', options: ['Normal', 'Límpida', 'Hematúria'] },
  vomit: {
    label: 'Vômito',
    options: [
      'Ausente',
      'Presente',
      'Regurgitação',
      'Náusea',
      'Com bile',
      'Com presença de sangue',
    ],
  },
  temperature: { label: 'Temperatura', options: ['Normal', 'Hipertermia', 'Hipotermia'] },
} as const;
export type ChoiceParameter = keyof typeof clinicalParameterOptions;
export const choiceParameters = Object.keys(clinicalParameterOptions) as ChoiceParameter[];

export const numericParameterLimits = {
  heartRate: { label: 'FC', unit: 'bpm', min: 10, max: 400, step: 1 },
  respiratoryRate: { label: 'FR', unit: 'mpm', min: 4, max: 200, step: 1 },
  systolicPressure: { label: 'PAS', unit: 'mmHg', min: 20, max: 350, step: 1 },
  glucose: { label: 'Glicemia', unit: 'mg/dL', min: 10, max: 1500, step: 1 },
  dehydration: { label: 'Desidratação', unit: '%', min: 0, max: 15, step: 0.5 },
} as const;
export type NumericParameter = keyof typeof numericParameterLimits;
export const numericParameters = Object.keys(numericParameterLimits) as NumericParameter[];

const choice = (key: ChoiceParameter) =>
  z
    .enum(clinicalParameterOptions[key].options as unknown as [string, ...string[]], {
      message: `Escolha uma opção de ${clinicalParameterOptions[key].label.toLowerCase()}`,
    })
    .nullable()
    .default(null);
const numeric = (key: NumericParameter) => {
  const { min, max, unit, step } = numericParameterLimits[key];
  let schema = z
    .number({ message: 'Informe um número' })
    .min(min, `Mínimo de ${String(min).replace('.', ',')} ${unit}`)
    .max(max, `Máximo de ${String(max).replace('.', ',')} ${unit}`);
  if (step === 1) schema = schema.int('Use um número inteiro');
  return schema.nullable().default(null);
};

export const clinicalParametersSchema = z.object({
  appetite: choice('appetite'),
  behavior: choice('behavior'),
  feces: choice('feces'),
  urine: choice('urine'),
  vomit: choice('vomit'),
  temperature: choice('temperature'),
  heartRate: numeric('heartRate'),
  respiratoryRate: numeric('respiratoryRate'),
  systolicPressure: numeric('systolicPressure'),
  glucose: numeric('glucose'),
  dehydration: numeric('dehydration'),
});
export type ClinicalParameters = z.output<typeof clinicalParametersSchema>;

/** Registro do histórico da internação. Os de sistema contam a abertura, o box e o desfecho. */
export const hospitalizationEntryKinds = [
  'admission',
  'occurrence',
  'weight',
  'parameters',
  'report',
  'box',
  'update',
  'discharge',
  'death',
  'cancel',
  'prescription',
  'prescription_stop',
  'execution',
] as const;
export type HospitalizationEntryKind = (typeof hospitalizationEntryKinds)[number];
export const hospitalizationEntryKindLabels: Record<HospitalizationEntryKind, string> = {
  admission: 'Internação',
  occurrence: 'Ocorrência',
  weight: 'Peso',
  parameters: 'Parâmetros clínicos',
  report: 'Relatório médico',
  box: 'Box',
  update: 'Dados da internação',
  discharge: 'Alta',
  death: 'Óbito',
  cancel: 'Cancelamento',
  prescription: 'Prescrição',
  prescription_stop: 'Prescrição suspensa',
  execution: 'Execução',
};

export const hospitalizationEntrySchema = z.object({
  id: z.uuid(),
  kind: z.enum(hospitalizationEntryKinds),
  occurredAt: z.iso.datetime({ offset: true }),
  author: z.string(),
  text: z.string(),
  weightKg: z.number().nullable(),
  parameters: clinicalParametersSchema.nullable(),
});
export type HospitalizationEntry = z.infer<typeof hospitalizationEntrySchema>;

export const hospitalizationSchema = z.object({
  id: z.uuid(),
  code: z.number().int(),
  status: z.enum(hospitalizationStatuses),
  priority: z.enum(hospitalizationPriorities),
  reason: z.string(),
  admittedAt: z.iso.datetime({ offset: true }),
  /** Alta, óbito ou cancelamento; nulo enquanto internado. */
  endedAt: z.iso.datetime({ offset: true }).nullable(),
  expectedDischargeOn: z.iso.date().nullable(),
  patient: z.object({
    id: z.uuid(),
    code: z.number().int(),
    name: z.string(),
    species: z.string().nullable(),
    breed: z.string().nullable(),
    sex: z.enum(['female', 'male', 'unknown']),
    birthDate: z.iso.date().nullable(),
    /** Último peso registrado no prontuário. */
    weightKg: z.number().nullable(),
  }),
  client: z.object({
    id: z.uuid(),
    code: z.number().int(),
    name: z.string(),
    phone: z.string().nullable(),
  }),
  veterinarian: ref,
  box: z.object({ id: z.uuid(), name: z.string(), code: z.string() }).nullable(),
  unit: ref,
});
export type Hospitalization = z.infer<typeof hospitalizationSchema>;

export const hospitalizationDetailSchema = hospitalizationSchema.extend({
  entries: z.array(hospitalizationEntrySchema),
  /** Desfecho registrado: observação da alta ou do óbito, ou motivo do cancelamento. */
  outcome: z.string().nullable(),
});
export type HospitalizationDetail = z.infer<typeof hospitalizationDetailSchema>;

export const hospitalizationListQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
  /** `current`: internados agora na unidade; `closed`: encerradas (histórico de internações). */
  scope: z.enum(['current', 'closed']).default('current'),
  status: z.enum(hospitalizationStatuses).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type HospitalizationListQuery = z.output<typeof hospitalizationListQuerySchema>;

export const hospitalizationListSchema = z.object({
  items: z.array(hospitalizationSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type HospitalizationList = z.infer<typeof hospitalizationListSchema>;

/** O que o formulário de internação oferece: veterinários ativos e boxes da unidade. */
export const hospitalizationOptionsSchema = z.object({
  veterinarians: z.array(ref),
  boxes: z.array(boxSchema),
});
export type HospitalizationOptions = z.infer<typeof hospitalizationOptionsSchema>;

const hospitalizationFields = {
  veterinarianId: z.uuid('Escolha o veterinário responsável'),
  priority: z.enum(hospitalizationPriorities),
  reason: text(1000).min(3, 'Descreva o motivo da internação'),
  expectedDischargeOn: z.iso.date('Data inválida').nullable(),
};

export const admitSchema = z.object({
  patientId: z.uuid('Escolha o animal'),
  ...hospitalizationFields,
  boxId: z.uuid().nullable().default(null),
});
export type AdmitInput = z.input<typeof admitSchema>;

export const updateHospitalizationSchema = z.object(hospitalizationFields);
export type UpdateHospitalizationInput = z.input<typeof updateHospitalizationSchema>;

export const moveBoxSchema = z.object({ boxId: z.uuid().nullable() });

export const closeHospitalizationSchema = z.object({
  outcome: z.enum(['discharged', 'deceased']),
  notes: text(2000).default(''),
});
export type CloseHospitalizationInput = z.input<typeof closeHospitalizationSchema>;

export const cancelHospitalizationSchema = z.object({
  reason: text(300).min(3, 'Explique o motivo em poucas palavras'),
});

export const hospitalizationEntryInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('occurrence'),
    text: text(2000).min(1, 'Descreva a ocorrência'),
  }),
  z.object({
    kind: z.literal('report'),
    text: text(5000).min(1, 'Escreva o relatório'),
  }),
  z.object({
    kind: z.literal('weight'),
    weightKg: z
      .number({ message: 'Informe o peso' })
      .min(0.001, 'Mínimo de 0,001 kg')
      .max(2000, 'Máximo de 2000 kg'),
    text: text(300).default(''),
  }),
  z.object({
    kind: z.literal('parameters'),
    parameters: clinicalParametersSchema.refine(
      (p) => Object.values(p).some((v) => v !== null),
      'Preencha ao menos um parâmetro',
    ),
    text: text(500).default(''),
  }),
]);
export type HospitalizationEntryInput = z.input<typeof hospitalizationEntryInputSchema>;
