import { z } from 'zod';

/**
 * Pacotes vendidos [p.10]: cada pacote vendido numa venda baixada vira o pacote do cliente, com as
 * sessões a usar e a validade; cada sessão usada fica registrada e pode ser desfeita com motivo.
 */
export const clientPackageStatuses = ['active', 'finished', 'expired', 'cancelled'] as const;
export type ClientPackageStatus = (typeof clientPackageStatuses)[number];
export const clientPackageStatusLabels: Record<ClientPackageStatus, string> = {
  active: 'Em uso',
  finished: 'Concluído',
  expired: 'Vencido',
  cancelled: 'Cancelado',
};

const ref = z.object({ id: z.uuid(), name: z.string() });

export const clientPackageSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  service: ref,
  client: z.object({ id: z.uuid(), code: z.number().int(), name: z.string() }),
  patient: ref.nullable(),
  sale: z.object({ id: z.uuid(), code: z.number().int(), soldAt: z.string() }),
  sessions: z.number().int(),
  used: z.number().int(),
  remaining: z.number().int(),
  /** Último dia em que o pacote pode ser usado; nulo sem validade. */
  validUntil: z.iso.date().nullable(),
  status: z.enum(clientPackageStatuses),
});
export type ClientPackage = z.infer<typeof clientPackageSchema>;

export const packageUsageSchema = z.object({
  id: z.uuid(),
  usedOn: z.iso.date(),
  patient: ref.nullable(),
  professional: ref,
  notes: z.string(),
  createdBy: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  /** Sessão desfeita: deixa de contar, mas fica no histórico. */
  undone: z
    .object({ at: z.iso.datetime({ offset: true }), by: z.string(), reason: z.string() })
    .nullable(),
});
export type PackageUsage = z.infer<typeof packageUsageSchema>;

export const clientPackageDetailSchema = clientPackageSchema.extend({
  usages: z.array(packageUsageSchema),
  /** Os animais do cliente, para escolher em qual a sessão foi feita. */
  patients: z.array(ref),
  /** Profissionais ativos, para escolher quem fez a sessão. */
  professionals: z.array(ref),
});
export type ClientPackageDetail = z.infer<typeof clientPackageDetailSchema>;

export const packageListQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
  clientId: z.uuid().optional(),
  status: z.enum(clientPackageStatuses).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PackageListQuery = z.output<typeof packageListQuerySchema>;

export const packageListSchema = z.object({
  items: z.array(clientPackageSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type PackageList = z.infer<typeof packageListSchema>;

export const usePackageSchema = z.object({
  usedOn: z.iso.date('Informe a data'),
  patientId: z.uuid().nullable(),
  professionalId: z.uuid('Escolha o profissional'),
  notes: z.string().trim().max(300, 'Máximo de 300 caracteres').default(''),
});
export type UsePackageInput = z.input<typeof usePackageSchema>;

export const undoPackageUsageSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, 'Explique o motivo em poucas palavras')
    .max(300, 'Máximo de 300 caracteres'),
});
