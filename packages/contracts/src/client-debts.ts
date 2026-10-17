import { z } from 'zod';

/**
 * Recebimentos e Saldo dos clientes [p.10]: o que ficou pendurado na conta do cliente, venda a
 * venda, com o que já foi abatido e o vencimento.
 */
export const clientDebtQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
  clientId: z.uuid().optional(),
  /** Só os vencidos. */
  overdue: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ClientDebtQuery = z.output<typeof clientDebtQuerySchema>;

const clientRef = z.object({ id: z.uuid(), code: z.number().int(), name: z.string() });

export const clientDebtSchema = z.object({
  /** O pagamento na conta do cliente. */
  id: z.uuid(),
  sale: z.object({ id: z.uuid(), code: z.number().int(), soldAt: z.string() }),
  client: clientRef,
  patientName: z.string().nullable(),
  dueDate: z.iso.date(),
  amount: z.number(),
  paid: z.number(),
  open: z.number(),
  overdue: z.boolean(),
});
export type ClientDebt = z.infer<typeof clientDebtSchema>;

export const clientDebtListSchema = z.object({
  items: z.array(clientDebtSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  totals: z.object({ open: z.number(), overdue: z.number(), clients: z.number().int() }),
});
export type ClientDebtList = z.infer<typeof clientDebtListSchema>;

export const clientBalancesSchema = z.object({
  items: z.array(
    z.object({
      client: clientRef,
      sales: z.number().int(),
      open: z.number(),
      overdue: z.number(),
      /** Vencimento mais antigo em aberto. */
      oldestDue: z.iso.date(),
    }),
  ),
  totals: z.object({ open: z.number(), overdue: z.number(), clients: z.number().int() }),
});
export type ClientBalances = z.infer<typeof clientBalancesSchema>;
