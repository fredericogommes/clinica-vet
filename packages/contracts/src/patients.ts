import { z } from 'zod';
import { patientInsuranceInputSchema, patientInsuranceSchema } from './insurers.js';

export const patientStatuses = ['alive', 'deceased'] as const;
export const patientSexes = ['female', 'male', 'unknown'] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres`)
    .transform((v) => (v === '' ? null : v))
    .nullable();

const today = () => new Date().toISOString().slice(0, 10);
const optionalDate = z
  .union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')])
  .transform((v) => (v === '' ? null : v))
  .refine((v) => v === null || v <= today(), 'A data não pode ser futura')
  .nullable();

export const patientInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Informe o nome do animal').max(80),
    status: z.enum(patientStatuses),
    deceasedOn: optionalDate,
    sex: z.enum(patientSexes),
    sterilized: z.boolean().nullable(),
    birthDate: optionalDate,
    speciesId: z.uuid().nullable(),
    breedId: z.uuid().nullable(),
    coatId: z.uuid().nullable(),
    microchip: optionalText(30),
    pedigreeNumber: optionalText(40),
    hasPedigree: z.boolean(),
    /** Alertas fixos exibidos no atendimento, ex. "Agressivo", "Alergia a dipirona". */
    markings: z.array(z.string().trim().min(1).max(60)).max(10),
    /** Plano de saúde [p.7]; nulo quando o animal não tem convênio. */
    insurance: patientInsuranceInputSchema.nullable().default(null),
  })
  .superRefine((p, ctx) => {
    if (p.breedId && !p.speciesId) {
      ctx.addIssue({ code: 'custom', path: ['speciesId'], message: 'Selecione a espécie da raça' });
    }
    if (p.status === 'alive' && p.deceasedOn) {
      ctx.addIssue({
        code: 'custom',
        path: ['deceasedOn'],
        message: 'Data de óbito só para animal em óbito',
      });
    }
    if (p.deceasedOn && p.birthDate && p.deceasedOn < p.birthDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['deceasedOn'],
        message: 'Óbito anterior ao nascimento',
      });
    }
    if (!p.hasPedigree && p.pedigreeNumber) {
      ctx.addIssue({
        code: 'custom',
        path: ['pedigreeNumber'],
        message: 'Marque que o animal tem pedigree',
      });
    }
  });
export type PatientInput = z.input<typeof patientInputSchema>;
export type PatientData = z.output<typeof patientInputSchema>;

export const createPatientRequestSchema = z.object({
  clientId: z.uuid(),
  patient: patientInputSchema,
});

export const transferOwnerRequestSchema = z.object({
  clientId: z.uuid(),
  reason: z
    .string()
    .trim()
    .max(200)
    .transform((v) => (v === '' ? null : v))
    .nullable(),
});

export const ownerHistoryEntrySchema = z.object({
  clientId: z.uuid(),
  clientName: z.string(),
  from: z.string(),
  to: z.string().nullable(),
  reason: z.string().nullable(),
});

export const patientSchema = z.object({
  id: z.uuid(),
  code: z.number().int(),
  name: z.string(),
  status: z.enum(patientStatuses),
  deceasedOn: z.string().nullable(),
  sex: z.enum(patientSexes),
  sterilized: z.boolean().nullable(),
  birthDate: z.string().nullable(),
  speciesId: z.uuid().nullable(),
  speciesName: z.string().nullable(),
  breedId: z.uuid().nullable(),
  breedName: z.string().nullable(),
  coatId: z.uuid().nullable(),
  coatName: z.string().nullable(),
  microchip: z.string().nullable(),
  hasPedigree: z.boolean(),
  pedigreeNumber: z.string().nullable(),
  markings: z.array(z.string()),
  insurance: patientInsuranceSchema.nullable(),
  archived: z.boolean(),
  owner: z.object({
    id: z.uuid(),
    code: z.number().int(),
    name: z.string(),
    primaryPhone: z.string().nullable(),
  }),
  ownerHistory: z.array(ownerHistoryEntrySchema),
});
export type Patient = z.infer<typeof patientSchema>;

export const patientListItemSchema = z.object({
  id: z.uuid(),
  code: z.number().int(),
  name: z.string(),
  speciesName: z.string().nullable(),
  breedName: z.string().nullable(),
  status: z.enum(patientStatuses),
  markings: z.array(z.string()),
  owner: z.object({ id: z.uuid(), name: z.string() }),
  archived: z.boolean(),
});
export type PatientListItem = z.infer<typeof patientListItemSchema>;

/** Idade em anos e meses completos na data de referência (padrão: hoje). */
export function ageInMonths(birthDate: string, reference: Date = new Date()): number {
  const [y, m, d] = birthDate.split('-').map(Number) as [number, number, number];
  let months = (reference.getFullYear() - y) * 12 + (reference.getMonth() + 1 - m);
  if (reference.getDate() < d) months -= 1;
  return Math.max(0, months);
}

export function formatAge(birthDate: string, reference?: Date): string {
  const months = ageInMonths(birthDate, reference);
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return rest === 1 ? '1 mês' : `${rest} meses`;
  const y = years === 1 ? '1 ano' : `${years} anos`;
  return rest === 0 ? y : `${y} e ${rest === 1 ? '1 mês' : `${rest} meses`}`;
}
