import { z } from 'zod';
import { patientSchema } from './patients.js';
import { appointmentSchema } from './scheduling.js';

/**
 * Evento clínico polimórfico [RN-17]: uma tabela de eventos com tipo e conteúdo validado por tipo.
 * Exame, vacina, vídeo e internação entram com os módulos das Fases 2 e 3.
 */
export const clinicalEventKinds = [
  'encounter',
  'weight',
  'pathology',
  'observation',
  'photo',
  'document',
  'prescription',
] as const;
export type ClinicalEventKind = (typeof clinicalEventKinds)[number];

export const clinicalEventKindLabels: Record<ClinicalEventKind, string> = {
  encounter: 'Atendimento',
  weight: 'Peso',
  pathology: 'Patologia',
  observation: 'Observação',
  photo: 'Foto',
  document: 'Documento',
  prescription: 'Receita',
};

/** Rascunho só é visto pelo autor; publicado entra na linha do tempo; invalidado fica visível riscado. */
export const clinicalEventStatuses = ['draft', 'published', 'voided'] as const;
export type ClinicalEventStatus = (typeof clinicalEventStatuses)[number];

const text = (max: number) => z.string().trim().max(max, `Máximo de ${max} caracteres`);

/** Limites fisiológicos plausíveis para qualquer espécie atendida; fora deles é erro de digitação. */
export const vitalLimits = {
  heartRate: { min: 10, max: 400, unit: 'bpm', label: 'FC', step: 1 },
  respiratoryRate: { min: 4, max: 200, unit: 'mpm', label: 'FR', step: 1 },
  temperature: { min: 30, max: 45, unit: '°C', label: 'Temperatura', step: 0.1 },
  capillaryRefill: { min: 0, max: 10, unit: 's', label: 'TPC', step: 0.5 },
  weightKg: { min: 0.001, max: 2000, unit: 'kg', label: 'Peso', step: 0.001 },
  bodyScore: { min: 1, max: 9, unit: '/9', label: 'Escore corporal', step: 1 },
} as const;
export type VitalKey = keyof typeof vitalLimits;
export const vitalKeys = Object.keys(vitalLimits) as VitalKey[];

const vital = (key: VitalKey) => {
  const { min, max, unit, step } = vitalLimits[key];
  let schema = z
    .number({ message: 'Informe um número' })
    .min(min, `Mínimo de ${String(min).replace('.', ',')} ${unit}`)
    .max(max, `Máximo de ${String(max).replace('.', ',')} ${unit}`);
  if (step === 1) schema = schema.int('Use um número inteiro');
  return schema.nullable();
};

/** Sinais vitais estruturados [D1]: consultáveis, ao contrário da narrativa. */
export const vitalsSchema = z.object({
  heartRate: vital('heartRate'),
  respiratoryRate: vital('respiratoryRate'),
  temperature: vital('temperature'),
  capillaryRefill: vital('capillaryRefill'),
  weightKg: vital('weightKg'),
  bodyScore: vital('bodyScore'),
});
export type Vitals = z.infer<typeof vitalsSchema>;
export const emptyVitals: Vitals = {
  heartRate: null,
  respiratoryRate: null,
  temperature: null,
  capillaryRefill: null,
  weightKg: null,
  bodyScore: null,
};

/** Data e hora do evento. Ausente = agora; retroativa exige permissão própria. */
const occurredAtSchema = z.iso
  .datetime({ offset: true, message: 'Data e hora inválidas' })
  .nullable();

const encounterInput = z.object({
  kind: z.literal('encounter'),
  occurredAt: occurredAtSchema,
  typeId: z.uuid().nullable(),
  appointmentId: z.uuid().nullable(),
  summary: text(200),
  narrative: text(50_000),
  vitals: vitalsSchema,
  pathologyIds: z.array(z.uuid()).max(10, 'Máximo de 10 diagnósticos'),
  publish: z.boolean(),
});
const weightInput = z.object({
  kind: z.literal('weight'),
  occurredAt: occurredAtSchema,
  weightKg: vital('weightKg').unwrap(),
  notes: text(500),
});
const pathologyInput = z.object({
  kind: z.literal('pathology'),
  occurredAt: occurredAtSchema,
  pathologyId: z.uuid({ message: 'Selecione a patologia' }),
  notes: text(2_000),
});
const observationInput = z.object({
  kind: z.literal('observation'),
  occurredAt: occurredAtSchema,
  text: text(5_000).min(1, 'Escreva a observação'),
});
const documentInput = (kind: 'document' | 'prescription') =>
  z.object({
    kind: z.literal(kind),
    occurredAt: occurredAtSchema,
    templateId: z.uuid().nullable(),
    title: text(120).min(1, 'Informe o título'),
    body: text(50_000).min(1, 'O texto não pode ficar vazio'),
    publish: z.boolean(),
  });

/** Corpo de criação e de edição. Foto tem rota própria, porque o corpo é a imagem. */
export const clinicalEventInputSchema = z
  .discriminatedUnion('kind', [
    encounterInput,
    weightInput,
    pathologyInput,
    observationInput,
    documentInput('document'),
    documentInput('prescription'),
  ])
  .superRefine((e, ctx) => {
    if (e.kind !== 'encounter' || !e.publish) return;
    const hasVital = Object.values(e.vitals).some((v) => v !== null);
    if (!e.summary && !e.narrative && !hasVital && e.pathologyIds.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['summary'],
        message: 'Preencha o resumo, a narrativa, um sinal vital ou um diagnóstico para finalizar',
      });
    }
  });
export type ClinicalEventInput = z.input<typeof clinicalEventInputSchema>;
export type ClinicalEventData = z.output<typeof clinicalEventInputSchema>;

export const voidEventSchema = z.object({
  reason: text(300).min(3, 'Explique o motivo em poucas palavras'),
});

const ref = z.object({ id: z.uuid(), name: z.string() });
export const pathologyRefSchema = z.object({
  id: z.uuid(),
  code: z.string().nullable(),
  name: z.string(),
});

export const clinicalEventDataSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('encounter'),
    type: ref.nullable(),
    summary: z.string(),
    narrative: z.string(),
    vitals: vitalsSchema,
    pathologies: z.array(pathologyRefSchema),
  }),
  z.object({ kind: z.literal('weight'), weightKg: z.number(), notes: z.string() }),
  z.object({ kind: z.literal('pathology'), pathology: pathologyRefSchema, notes: z.string() }),
  z.object({ kind: z.literal('observation'), text: z.string() }),
  z.object({
    kind: z.literal('photo'),
    fileId: z.uuid(),
    contentType: z.string(),
    byteSize: z.number().int(),
    caption: z.string(),
  }),
  z.object({
    kind: z.literal('document'),
    template: ref.nullable(),
    title: z.string(),
    body: z.string(),
  }),
  z.object({
    kind: z.literal('prescription'),
    template: ref.nullable(),
    title: z.string(),
    body: z.string(),
  }),
]);
export type ClinicalEventContent = z.infer<typeof clinicalEventDataSchema>;

export const clinicalEventSchema = z.object({
  id: z.uuid(),
  patientId: z.uuid(),
  kind: z.enum(clinicalEventKinds),
  status: z.enum(clinicalEventStatuses),
  occurredAt: z.string(),
  professional: ref,
  appointmentId: z.uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  publishedAt: z.string().nullable(),
  void: z.object({ at: z.string(), by: z.string(), reason: z.string() }).nullable(),
  /** O usuário atual pode corrigir o conteúdo. */
  editable: z.boolean(),
  /** O usuário atual pode invalidar (publicado) ou descartar (rascunho). */
  removable: z.boolean(),
  data: clinicalEventDataSchema,
});
export type ClinicalEvent = z.infer<typeof clinicalEventSchema>;

const kindList = z
  .string()
  .transform((v) => v.split(',').filter(Boolean))
  .pipe(z.array(z.enum(clinicalEventKinds)).max(20));

export const timelineQuerySchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  kinds: kindList.optional(),
  professionalId: z.uuid().optional(),
  order: z.enum(['desc', 'asc']).default('desc'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type TimelineQuery = z.input<typeof timelineQuerySchema>;

export const timelineSchema = z.object({
  items: z.array(clinicalEventSchema),
  nextCursor: z.string().nullable(),
  /** Quem registrou eventos neste animal, para o filtro por profissional. */
  professionals: z.array(ref),
});
export type Timeline = z.infer<typeof timelineSchema>;

export const weightPointSchema = z.object({
  eventId: z.uuid(),
  occurredAt: z.string(),
  weightKg: z.number(),
});
export type WeightPoint = z.infer<typeof weightPointSchema>;

/** Cabeçalho da ficha: o animal, como falar com o responsável e o peso atual. */
export const clinicalRecordSchema = z.object({
  timeZone: z.string(),
  patient: patientSchema,
  owner: z.object({
    id: z.uuid(),
    code: z.number().int(),
    name: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
  }),
  currentWeight: z.object({ weightKg: z.number(), occurredAt: z.string() }).nullable(),
  weights: z.array(weightPointSchema),
  /** Agendamentos do animal nesta unidade, de hoje em diante (coluna "Hoje e próximos"). */
  appointments: z.array(appointmentSchema).nullable(),
});
export type ClinicalRecord = z.infer<typeof clinicalRecordSchema>;

export const clinicalSearchQuerySchema = z.object({
  client: z.string().trim().max(100).default(''),
  patient: z.string().trim().max(100).default(''),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const clinicalSearchItemSchema = z.object({
  owner: z.object({
    id: z.uuid(),
    code: z.number().int(),
    name: z.string(),
    phone: z.string().nullable(),
  }),
  patients: z.array(
    z.object({
      id: z.uuid(),
      code: z.number().int(),
      name: z.string(),
      speciesName: z.string().nullable(),
      breedName: z.string().nullable(),
      status: z.enum(['alive', 'deceased']),
      markings: z.array(z.string()),
    }),
  ),
});
export type ClinicalSearchItem = z.infer<typeof clinicalSearchItemSchema>;

/** Texto inicial de atendimento, receita ou documento, com os campos do animal preenchidos. */
export const renderQuerySchema = z
  .object({ typeId: z.uuid().optional(), templateId: z.uuid().optional() })
  .refine((q) => Boolean(q.typeId) !== Boolean(q.templateId), 'Informe typeId ou templateId');
export const renderedTemplateSchema = z.object({ title: z.string(), body: z.string() });

/** Campos aceitos nos modelos, entre chaves duplas: {{animal}}. */
export const templatePlaceholders = {
  animal: 'Nome do animal',
  especie: 'Espécie',
  raca: 'Raça',
  sexo: 'Sexo',
  idade: 'Idade',
  peso: 'Peso atual',
  microchip: 'Microchip',
  responsavel: 'Nome do responsável',
  documento_responsavel: 'CPF ou CNPJ do responsável',
  profissional: 'Quem está registrando',
  data: 'Data de hoje',
  unidade: 'Unidade da clínica',
} as const;
export type TemplatePlaceholder = keyof typeof templatePlaceholders;

// Cadastros clínicos de apoio.

export const pathologySchema = pathologyRefSchema.extend({ archived: z.boolean() });
export type Pathology = z.infer<typeof pathologySchema>;

export const pathologyInputSchema = z.object({
  code: z
    .string()
    .trim()
    .max(20, 'Máximo de 20 caracteres')
    .transform((v) => (v === '' ? null : v.toUpperCase()))
    .nullable(),
  name: z.string().trim().min(2, 'Mínimo de 2 caracteres').max(120, 'Máximo de 120 caracteres'),
  archived: z.boolean().default(false),
});
export type PathologyInput = z.input<typeof pathologyInputSchema>;

export const clinicalTemplateKinds = ['prescription', 'document'] as const;
export type ClinicalTemplateKind = (typeof clinicalTemplateKinds)[number];

export const clinicalTemplateSchema = z.object({
  id: z.uuid(),
  kind: z.enum(clinicalTemplateKinds),
  name: z.string(),
  body: z.string(),
  archived: z.boolean(),
});
export type ClinicalTemplate = z.infer<typeof clinicalTemplateSchema>;

export const clinicalTemplateInputSchema = z.object({
  kind: z.enum(clinicalTemplateKinds),
  name: z.string().trim().min(2, 'Mínimo de 2 caracteres').max(80, 'Máximo de 80 caracteres'),
  body: z.string().trim().min(1, 'Escreva o texto do modelo').max(20_000),
  archived: z.boolean().default(false),
});
export type ClinicalTemplateInput = z.input<typeof clinicalTemplateInputSchema>;

/** Imagens aceitas como foto clínica; o tipo é conferido pelo conteúdo, não só pelo cabeçalho. */
export const photoContentTypes = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
