import { z } from 'zod';

/**
 * Comissionamento [p.10–11, RN-38, RN-39]. O percentual vem do item da venda (padrão do produto ou
 * diferenciado por profissional); aqui ficam as regras da clínica, as comissões em aberto e os
 * extratos, que fechados viram contas a pagar.
 */
export const commissionBases = ['net', 'gross'] as const;
export type CommissionBase = (typeof commissionBases)[number];
export const commissionBaseLabels: Record<CommissionBase, string> = {
  net: 'Valor líquido (depois do desconto)',
  gross: 'Valor bruto (antes do desconto)',
};

export const commissionCriteria = ['sold', 'received'] as const;
export type CommissionCriterion = (typeof commissionCriteria)[number];
export const commissionCriterionLabels: Record<CommissionCriterion, string> = {
  sold: 'Vendas realizadas, recebidas ou não',
  received: 'Só vendas recebidas (baixadas no caixa)',
};

export const commissionStatementStatuses = [
  'open',
  'closed',
  'paid',
  'review',
  'archived',
] as const;
export type CommissionStatementStatus = (typeof commissionStatementStatuses)[number];
export const commissionStatementStatusLabels: Record<CommissionStatementStatus, string> = {
  open: 'Não fechado',
  closed: 'Fechado',
  paid: 'Pago',
  review: 'Em revisão',
  archived: 'Arquivado',
};

export const commissionLineKinds = ['sale', 'adjustment', 'reversal'] as const;
export type CommissionLineKind = (typeof commissionLineKinds)[number];
export const commissionLineKindLabels: Record<CommissionLineKind, string> = {
  sale: 'Venda',
  adjustment: 'Ajuste',
  reversal: 'Estorno',
};

const isoDate = z.iso.date({ message: 'Informe a data' });
const reason = z
  .string()
  .trim()
  .min(3, 'Explique o motivo em poucas palavras')
  .max(200, 'Máximo de 200 caracteres');

export const commissionSettingsInputSchema = z.object({
  base: z.enum(commissionBases),
  criterion: z.enum(commissionCriteria),
  financeIntegration: z.boolean(),
  staffCanSeeOwn: z.boolean(),
});
export type CommissionSettingsInput = z.infer<typeof commissionSettingsInputSchema>;

export const commissionSettingsSchema = commissionSettingsInputSchema.extend({
  staff: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      role: z.string(),
      /** Desde quando recebe comissão; nulo não é comissionado. */
      since: z.string().nullable(),
    }),
  ),
});
export type CommissionSettings = z.infer<typeof commissionSettingsSchema>;

export const commissionStaffInputSchema = z.object({ commissioned: z.boolean() });
export type CommissionStaffInput = z.infer<typeof commissionStaffInputSchema>;

export const commissionOpenQuerySchema = z.object({ ate: isoDate.optional() });
export type CommissionOpenQuery = z.infer<typeof commissionOpenQuerySchema>;

/** Comissões em aberto: o que cada profissional acumulou até a data de corte, fora de extrato. */
export const commissionOpenSchema = z.object({
  cutoff: z.string(),
  base: z.enum(commissionBases),
  criterion: z.enum(commissionCriteria),
  rows: z.array(
    z.object({
      user: z.object({ id: z.uuid(), name: z.string() }),
      commissioned: z.boolean(),
      sales: z.number().int(),
      baseAmount: z.number(),
      amount: z.number(),
      /** Extrato não fechado ou em revisão do profissional, que já leva parte do valor. */
      statement: z
        .object({
          id: z.uuid(),
          code: z.number().int(),
          status: z.enum(commissionStatementStatuses),
        })
        .nullable(),
    }),
  ),
  total: z.number(),
});
export type CommissionOpen = z.infer<typeof commissionOpenSchema>;

export const commissionStatementCreateSchema = z.object({
  userId: z.uuid({ message: 'Escolha o profissional' }),
  cutoff: isoDate,
});
export type CommissionStatementCreate = z.infer<typeof commissionStatementCreateSchema>;

export const commissionStatementRefreshSchema = z.object({ cutoff: isoDate });
export type CommissionStatementRefresh = z.infer<typeof commissionStatementRefreshSchema>;

export const commissionStatementCloseSchema = z.object({
  dueDate: isoDate,
  notes: z.string().trim().max(500, 'Máximo de 500 caracteres'),
});
export type CommissionStatementClose = z.infer<typeof commissionStatementCloseSchema>;

export const commissionStatementPaySchema = z.object({ paidOn: isoDate });
export type CommissionStatementPay = z.infer<typeof commissionStatementPaySchema>;

export const commissionStatementReviewSchema = z.object({ reason });
export type CommissionStatementReview = z.infer<typeof commissionStatementReviewSchema>;

export const commissionStatementSchema = z.object({
  id: z.uuid(),
  code: z.number().int(),
  status: z.enum(commissionStatementStatuses),
  user: z.object({ id: z.uuid(), name: z.string() }),
  cutoff: z.string(),
  total: z.number(),
  dueDate: z.string().nullable(),
  paidOn: z.string().nullable(),
  notes: z.string(),
  reviewReason: z.string().nullable(),
  lines: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(commissionLineKinds),
      sale: z.object({
        id: z.uuid(),
        code: z.number().int(),
        soldAt: z.string(),
        client: z.string().nullable(),
        status: z.string(),
      }),
      base: z.enum(commissionBases),
      baseAmount: z.number(),
      amount: z.number(),
      description: z.string(),
    }),
  ),
  /** Despesa gerada em contas a pagar, quando a integração está ligada. */
  entry: z
    .object({ id: z.uuid(), status: z.string(), dueDate: z.string(), amount: z.number() })
    .nullable(),
  financeIntegration: z.boolean(),
  createdBy: z.string(),
  createdAt: z.string(),
  closedBy: z.string().nullable(),
  closedAt: z.string().nullable(),
});
export type CommissionStatement = z.infer<typeof commissionStatementSchema>;

export const commissionStatementSituations = [
  'abertos',
  'fechados',
  'pagos',
  'arquivados',
  'todos',
] as const;

export const commissionStatementQuerySchema = z.object({
  situacao: z.enum(commissionStatementSituations).default('abertos'),
  profissional: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type CommissionStatementQuery = z.infer<typeof commissionStatementQuerySchema>;

export const commissionStatementListSchema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      code: z.number().int(),
      status: z.enum(commissionStatementStatuses),
      user: z.object({ id: z.uuid(), name: z.string() }),
      cutoff: z.string(),
      lines: z.number().int(),
      total: z.number(),
      dueDate: z.string().nullable(),
      paidOn: z.string().nullable(),
    }),
  ),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type CommissionStatementList = z.infer<typeof commissionStatementListSchema>;

/** Minhas comissões: o que o próprio profissional tem em aberto e os seus extratos. */
export const myCommissionsSchema = z.object({
  commissioned: z.boolean(),
  since: z.string().nullable(),
  cutoff: z.string(),
  criterion: z.enum(commissionCriteria),
  open: z.object({ sales: z.number().int(), amount: z.number() }),
  statements: commissionStatementListSchema.shape.items,
});
export type MyCommissions = z.infer<typeof myCommissionsSchema>;
