import { z } from 'zod';
import { passwordSchema } from './admin.js';
import { weightPointSchema } from './clinical.js';
import { examResultValueSchema } from './exams.js';
import { appointmentStatuses, isoDateSchema, timeSchema } from './scheduling.js';
import { vaccineKinds } from './vaccines.js';

/**
 * Portal do tutor [p.20–21, RN-44]: área do cliente com login próprio, aberta por convite. A clínica
 * escolhe o que o tutor vê de cada animal; o portal só lê o que já foi publicado na ficha.
 */
export const portalSections = [
  'appointments',
  'weight',
  'vaccines',
  'exams',
  'prescriptions',
] as const;
export type PortalSection = (typeof portalSections)[number];
export const portalSectionLabels: Record<PortalSection, string> = {
  appointments: 'Próximos agendamentos',
  weight: 'Peso',
  vaccines: 'Vacinas',
  exams: 'Exames',
  prescriptions: 'Receitas',
};
export const portalSectionHints: Record<PortalSection, string> = {
  appointments: 'Data, horário, tipo e profissional dos agendamentos que ainda vão acontecer.',
  weight: 'A curva do peso, com as pesagens e os atendimentos que registraram peso.',
  vaccines: 'Vacinas, vermífugos e antiparasitários aplicados, com a próxima dose.',
  exams: 'Resultados de exame publicados, com os valores e a faixa de referência.',
  prescriptions: 'Receitas publicadas na ficha, com o texto completo.',
};

export const portalSettingsSchema = z
  .object({
    enabled: z.boolean(),
    sections: z.object(
      Object.fromEntries(portalSections.map((s) => [s, z.boolean()])) as Record<
        PortalSection,
        z.ZodBoolean
      >,
    ),
    /** Agendamento online [p.20–21]: tipos que o tutor pode marcar, antecedência e alcance. */
    booking: z.object({
      enabled: z.boolean(),
      typeIds: z.array(z.uuid()).max(50),
      leadHours: z
        .number({ message: 'Informe a antecedência' })
        .int('Use horas inteiras')
        .min(0, 'Mínimo de 0 horas')
        .max(168, 'Máximo de 168 horas (7 dias)'),
      windowDays: z
        .number({ message: 'Informe o alcance' })
        .int('Use dias inteiros')
        .min(1, 'Mínimo de 1 dia')
        .max(180, 'Máximo de 180 dias'),
    }),
  })
  .superRefine((s, ctx) => {
    if (s.booking.enabled && s.booking.typeIds.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['booking', 'typeIds'],
        message: 'Escolha ao menos um tipo de atendimento para o agendamento online',
      });
    }
  });
export type PortalSettings = z.infer<typeof portalSettingsSchema>;

export const portalAccountStatuses = ['none', 'invited', 'active', 'blocked'] as const;
export type PortalAccountStatus = (typeof portalAccountStatuses)[number];
export const portalAccountStatusLabels: Record<PortalAccountStatus, string> = {
  none: 'Sem acesso',
  invited: 'Convite enviado',
  active: 'Ativo',
  blocked: 'Bloqueado',
};

/** Acesso do cliente ao portal, como aparece na ficha do cliente [RN-44]. */
export const portalAccountSchema = z.object({
  /** Portal ligado na clínica; desligado, o tutor não entra mesmo com acesso. */
  portalEnabled: z.boolean(),
  status: z.enum(portalAccountStatuses),
  email: z.string().nullable(),
  invitedAt: z.string().nullable(),
  /** Validade do link pendente (convite ou recuperação de senha); nula sem link pendente. */
  linkExpiresAt: z.string().nullable(),
  activatedAt: z.string().nullable(),
  lastLoginAt: z.string().nullable(),
  /** E-mail sugerido para o convite: o primeiro e-mail do cadastro. */
  suggestedEmail: z.string().nullable(),
  /** Celular com WhatsApp do cadastro, para enviar o link. */
  whatsapp: z.string().nullable(),
});
export type PortalAccount = z.infer<typeof portalAccountSchema>;

export const portalInviteInputSchema = z.object({
  email: z.email('Informe um e-mail válido').trim().toLowerCase().max(160),
});
export type PortalInviteInput = z.input<typeof portalInviteInputSchema>;

/** O link só é mostrado uma vez; no banco fica apenas o hash do token. */
export const portalInviteResultSchema = z.object({
  account: portalAccountSchema,
  link: z.string(),
  expiresAt: z.string(),
});
export type PortalInviteResult = z.infer<typeof portalInviteResultSchema>;

export const portalAccountListSchema = z.object({
  items: z.array(
    z.object({
      client: z.object({ id: z.uuid(), code: z.number().int(), name: z.string() }),
      email: z.string(),
      status: z.enum(portalAccountStatuses),
      invitedAt: z.string(),
      lastLoginAt: z.string().nullable(),
    }),
  ),
});
export type PortalAccountList = z.infer<typeof portalAccountListSchema>;

// Lado do tutor.

export const portalLoginSchema = z.object({
  email: z.email('Informe um e-mail válido').trim().toLowerCase(),
  password: z.string().min(1, 'Informe a senha').max(256),
});
export type PortalLogin = z.infer<typeof portalLoginSchema>;

export const portalLinkInfoSchema = z.object({
  clinic: z.string(),
  clientName: z.string(),
  email: z.string(),
  /** Primeiro acesso (cria a senha) ou recuperação (troca a senha). */
  firstAccess: z.boolean(),
});
export type PortalLinkInfo = z.infer<typeof portalLinkInfoSchema>;

export const portalSetPasswordSchema = z
  .object({ password: passwordSchema, confirmation: z.string() })
  .refine((v) => v.password === v.confirmation, {
    path: ['confirmation'],
    message: 'As senhas não conferem',
  });
export type PortalSetPassword = z.infer<typeof portalSetPasswordSchema>;

export const portalSessionSchema = z.object({
  clinic: z.string(),
  client: z.object({ name: z.string(), email: z.string() }),
  timeZone: z.string(),
  sections: portalSettingsSchema.shape.sections,
  /** O tutor pode marcar horário pelo portal. */
  booking: z.boolean(),
  csrfToken: z.string(),
});
export type PortalSession = z.infer<typeof portalSessionSchema>;

const portalPatientSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  species: z.string().nullable(),
  breed: z.string().nullable(),
  sex: z.enum(['female', 'male', 'unknown']),
  birthDate: z.string().nullable(),
  deceased: z.boolean(),
});

export const portalHomeSchema = z.object({
  patients: z.array(portalPatientSummarySchema),
  /** Nulo quando a clínica não mostra os agendamentos. */
  appointments: z
    .array(
      z.object({
        id: z.uuid(),
        startsAt: z.string(),
        type: z.string(),
        professional: z.string(),
        unit: z.string(),
        status: z.enum(appointmentStatuses),
        patients: z.array(z.string()),
        bookedOnline: z.boolean(),
        /** Marcado pelo portal e ainda dentro da antecedência: o tutor pode cancelar. */
        cancellable: z.boolean(),
      }),
    )
    .nullable(),
});
export type PortalHome = z.infer<typeof portalHomeSchema>;

/** Ficha do animal no portal: cada seção é nula quando a clínica não a mostra. */
export const portalPatientSchema = z.object({
  patient: portalPatientSummarySchema,
  weights: z.array(weightPointSchema).nullable(),
  vaccines: z
    .array(
      z.object({
        id: z.uuid(),
        appliedAt: z.string(),
        name: z.string(),
        kind: z.enum(vaccineKinds),
        dose: z.string(),
        nextDueOn: z.string().nullable(),
      }),
    )
    .nullable(),
  exams: z
    .array(
      z.object({
        id: z.uuid(),
        at: z.string(),
        name: z.string(),
        referenceLabel: z.string().nullable(),
        values: z.array(examResultValueSchema),
        notes: z.string(),
      }),
    )
    .nullable(),
  prescriptions: z
    .array(
      z.object({
        id: z.uuid(),
        at: z.string(),
        title: z.string(),
        body: z.string(),
        professional: z.string(),
      }),
    )
    .nullable(),
});
export type PortalPatient = z.infer<typeof portalPatientSchema>;

/** O que o tutor escolhe ao agendar: unidade, tipo, animais e o período aberto. */
export const portalBookingOptionsSchema = z.object({
  units: z.array(z.object({ id: z.uuid(), name: z.string() })),
  types: z.array(z.object({ id: z.uuid(), name: z.string(), durationMinutes: z.number().int() })),
  patients: z.array(z.object({ id: z.uuid(), name: z.string() })),
  firstDate: z.string(),
  lastDate: z.string(),
  leadHours: z.number().int(),
});
export type PortalBookingOptions = z.infer<typeof portalBookingOptionsSchema>;

export const portalSlotQuerySchema = z.object({
  unitId: z.uuid(),
  typeId: z.uuid(),
  date: isoDateSchema,
});
export type PortalSlotQuery = z.infer<typeof portalSlotQuerySchema>;

export const portalSlotsSchema = z.array(
  z.object({ start: z.string(), professionalId: z.uuid(), professionalName: z.string() }),
);
export type PortalSlots = z.infer<typeof portalSlotsSchema>;

export const portalBookSchema = z.object({
  unitId: z.uuid({ message: 'Escolha a unidade' }),
  typeId: z.uuid({ message: 'Escolha o atendimento' }),
  patientIds: z
    .array(z.uuid())
    .min(1, 'Escolha ao menos um animal')
    .max(10, 'Máximo de 10 animais')
    .refine((ids) => new Set(ids).size === ids.length, 'Animal repetido'),
  date: isoDateSchema,
  start: timeSchema,
  professionalId: z.uuid({ message: 'Escolha um horário' }),
  notes: z.string().trim().max(500, 'Máximo de 500 caracteres'),
});
export type PortalBook = z.infer<typeof portalBookSchema>;
