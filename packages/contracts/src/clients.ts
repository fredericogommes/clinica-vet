import { z } from 'zod';
import { isValidCnpj, isValidCpf, onlyDigits } from './documents.js';

export const personTypes = ['individual', 'company'] as const;
export const sexes = ['female', 'male'] as const;
export const consentChannels = ['email', 'sms', 'sms_campaign', 'whatsapp'] as const;
export type ConsentChannel = (typeof consentChannels)[number];

export const consentChannelLabels: Record<ConsentChannel, string> = {
  email: 'E-mail',
  sms: 'SMS',
  sms_campaign: 'Campanhas por SMS',
  whatsapp: 'WhatsApp',
};

/** Campo de texto opcional: vazio vira null, para não guardar strings vazias. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres`)
    .transform((v) => (v === '' ? null : v))
    .nullable();

const optionalDigits = (label: string, valid: (v: string) => boolean) =>
  z
    .string()
    .transform(onlyDigits)
    .refine((v) => v === '' || valid(v), `${label} inválido`)
    .transform((v) => (v === '' ? null : v))
    .nullable();

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Data inválida');

const optionalPastDate = z
  .union([z.literal(''), isoDate])
  .transform((v) => (v === '' ? null : v))
  .refine(
    (v) => v === null || v <= new Date().toISOString().slice(0, 10),
    'A data não pode ser futura',
  )
  .nullable();

export const contactSchema = z
  .object({
    kind: z.enum(['mobile', 'phone', 'email']),
    value: z.string().trim().min(1, 'Informe o contato').max(254),
    isWhatsapp: z.boolean().default(false),
  })
  .transform((c, ctx) => {
    if (c.kind === 'email') {
      const parsed = z.email().safeParse(c.value.toLowerCase());
      if (!parsed.success)
        ctx.addIssue({ code: 'custom', path: ['value'], message: 'E-mail inválido' });
      return { ...c, value: c.value.toLowerCase(), isWhatsapp: false };
    }
    const digits = onlyDigits(c.value);
    if (digits.length < 10 || digits.length > 11) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Telefone com DDD, 10 ou 11 dígitos',
      });
    }
    return { ...c, value: digits, isWhatsapp: c.kind === 'mobile' && c.isWhatsapp };
  });
export type ContactInput = z.input<typeof contactSchema>;

export const clientInputSchema = z
  .object({
    personType: z.enum(personTypes),
    name: z.string().trim().min(2, 'Informe o nome completo').max(160),
    nationality: optionalText(60),
    sex: z.enum(sexes).nullable(),
    cpf: optionalDigits('CPF', isValidCpf),
    cnpj: optionalDigits('CNPJ', isValidCnpj),
    rg: optionalText(20),
    birthDate: optionalPastDate,
    originId: z.uuid().nullable(),
    profession: optionalText(80),
    municipalRegistration: optionalText(30),
    notes: optionalText(2000),
    contacts: z.array(contactSchema).max(10),
    address: z.object({
      cep: optionalDigits('CEP', (v) => v.length === 8),
      street: optionalText(160),
      number: optionalText(20),
      complement: optionalText(80),
      district: optionalText(80),
      city: optionalText(80),
      state: z
        .string()
        .trim()
        .toUpperCase()
        .refine((v) => v === '' || /^[A-Z]{2}$/.test(v), 'UF com 2 letras')
        .transform((v) => (v === '' ? null : v))
        .nullable(),
    }),
  })
  .superRefine((c, ctx) => {
    if (c.personType === 'individual' && c.cnpj) {
      ctx.addIssue({ code: 'custom', path: ['cnpj'], message: 'CNPJ é só para pessoa jurídica' });
    }
    if (c.personType === 'company' && c.cpf) {
      ctx.addIssue({ code: 'custom', path: ['cpf'], message: 'CPF é só para pessoa física' });
    }
  });
export type ClientInput = z.input<typeof clientInputSchema>;
export type ClientData = z.output<typeof clientInputSchema>;

export const consentSchema = z.object({
  channel: z.enum(consentChannels),
  granted: z.boolean(),
  source: z.string(),
  recordedAt: z.string(),
  recordedByName: z.string().nullable(),
});
export type Consent = z.infer<typeof consentSchema>;

export const updateConsentsRequestSchema = z.object({
  /** Origem do consentimento, ex. "Formulário assinado no balcão". */
  source: z.string().trim().min(3, 'Informe como o consentimento foi obtido').max(120),
  channels: z.array(z.object({ channel: z.enum(consentChannels), granted: z.boolean() })).min(1),
});
export type UpdateConsentsRequest = z.input<typeof updateConsentsRequestSchema>;

export const patientSummarySchema = z.object({
  id: z.uuid(),
  code: z.number().int(),
  name: z.string(),
  speciesName: z.string().nullable(),
  status: z.enum(['alive', 'deceased']),
  archived: z.boolean(),
});

const storedContactSchema = z.object({
  kind: z.enum(['mobile', 'phone', 'email']),
  value: z.string(),
  isWhatsapp: z.boolean(),
});

/** Curva ABC [RN-10]: A até 80% do valor comprado acumulado, B até 95%, C o restante. */
export const abcClasses = ['A', 'B', 'C'] as const;
export type AbcClass = (typeof abcClasses)[number];
export const abcClassHints: Record<AbcClass, string> = {
  A: 'Clientes que somam os primeiros 80% do valor comprado',
  B: 'Clientes que levam o acumulado de 80% a 95%',
  C: 'Clientes dos últimos 5% do valor comprado',
};

export const clientSchema = z.object({
  id: z.uuid(),
  code: z.number().int(),
  personType: z.enum(personTypes),
  name: z.string(),
  nationality: z.string().nullable(),
  sex: z.enum(sexes).nullable(),
  cpf: z.string().nullable(),
  cnpj: z.string().nullable(),
  rg: z.string().nullable(),
  birthDate: z.string().nullable(),
  originId: z.uuid().nullable(),
  originName: z.string().nullable(),
  profession: z.string().nullable(),
  municipalRegistration: z.string().nullable(),
  notes: z.string().nullable(),
  contacts: z.array(storedContactSchema),
  address: z.object({
    cep: z.string().nullable(),
    street: z.string().nullable(),
    number: z.string().nullable(),
    complement: z.string().nullable(),
    district: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
  }),
  consents: z.array(consentSchema),
  patients: z.array(patientSummarySchema),
  archived: z.boolean(),
  createdAt: z.string(),
  /** Classe na curva ABC dos últimos 12 meses; nula sem compras no período [RN-10]. */
  abcClass: z.enum(abcClasses).nullable(),
});
export type Client = z.infer<typeof clientSchema>;

export const clientListItemSchema = z.object({
  id: z.uuid(),
  code: z.number().int(),
  personType: z.enum(personTypes),
  name: z.string(),
  document: z.string().nullable(),
  primaryPhone: z.string().nullable(),
  primaryPhoneIsWhatsapp: z.boolean(),
  patients: z.array(z.object({ id: z.uuid(), name: z.string() })),
  archived: z.boolean(),
});
export type ClientListItem = z.infer<typeof clientListItemSchema>;

export const listQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  archived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
