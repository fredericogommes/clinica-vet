import { z } from 'zod';
import { paymentKinds } from './payments.js';
import { moneySchema } from './products.js';

/**
 * Caixa por operador e unidade [RN-29, p.9–10]: abre com o troco inicial, recebe as vendas,
 * registra sangria e suprimento e fecha com a contagem do dinheiro.
 */
export const cashSessionStatuses = ['open', 'closed'] as const;
export type CashSessionStatus = (typeof cashSessionStatuses)[number];
export const cashSessionStatusLabels: Record<CashSessionStatus, string> = {
  open: 'Aberto',
  closed: 'Fechado',
};

/** Movimentos lançados à mão; recebimentos e estornos de venda entram sozinhos. */
export const cashMovementKinds = ['supply', 'withdrawal'] as const;
export type CashMovementKind = (typeof cashMovementKinds)[number];

export const cashEntryKinds = ['opening', 'receipt', 'refund', 'supply', 'withdrawal'] as const;
export type CashEntryKind = (typeof cashEntryKinds)[number];
export const cashEntryLabels: Record<CashEntryKind, string> = {
  opening: 'Abertura',
  receipt: 'Recebimento',
  refund: 'Estorno',
  supply: 'Suprimento',
  withdrawal: 'Sangria',
};

const notes = z.string().trim().max(300, 'Máximo de 300 caracteres');
const positiveMoney = moneySchema.refine((v) => v > 0, 'Informe um valor maior que zero');

export const openCashSchema = z.object({
  /** Troco inicial na gaveta. */
  openingAmount: moneySchema,
  notes: notes.default(''),
});
export type OpenCashInput = z.input<typeof openCashSchema>;

export const cashMovementInputSchema = z.object({
  kind: z.enum(cashMovementKinds),
  amount: positiveMoney,
  description: z
    .string()
    .trim()
    .min(3, 'Explique o movimento em poucas palavras')
    .max(200, 'Máximo de 200 caracteres'),
});
export type CashMovementInput = z.infer<typeof cashMovementInputSchema>;

export const closeCashSchema = z.object({
  /** Dinheiro contado na gaveta no fechamento. */
  countedCash: moneySchema,
  notes: notes.default(''),
});
export type CloseCashInput = z.input<typeof closeCashSchema>;

export const reverseSaleSchema = z.object({
  reason: z.string().trim().min(3, 'Explique o motivo em poucas palavras').max(300),
});

const ref = z.object({ id: z.uuid(), name: z.string() });

export const cashEntrySchema = z.object({
  id: z.string(),
  kind: z.enum(cashEntryKinds),
  at: z.iso.datetime({ offset: true }),
  description: z.string(),
  methodName: z.string().nullable(),
  paymentKind: z.enum(paymentKinds).nullable(),
  /** Positivo entra, negativo sai. */
  amount: z.number(),
  sale: z.object({ id: z.uuid(), code: z.number().int() }).nullable(),
  by: z.string(),
});
export type CashEntry = z.infer<typeof cashEntrySchema>;

export const cashSessionSummarySchema = z.object({
  id: z.uuid(),
  code: z.number().int(),
  status: z.enum(cashSessionStatuses),
  operator: ref,
  unitName: z.string(),
  openedAt: z.iso.datetime({ offset: true }),
  closedAt: z.iso.datetime({ offset: true }).nullable(),
  openingAmount: z.number(),
  /** Dinheiro que deveria estar na gaveta agora (ou no fechamento). */
  expectedCash: z.number(),
  countedCash: z.number().nullable(),
  /** Contado − esperado; negativo é falta. */
  difference: z.number().nullable(),
  /** Recebido em vendas menos estornos, todas as formas. */
  salesTotal: z.number(),
});
export type CashSessionSummary = z.infer<typeof cashSessionSummarySchema>;

export const cashSessionSchema = cashSessionSummarySchema.extend({
  openingNotes: z.string(),
  closingNotes: z.string(),
  closedBy: z.string().nullable(),
  /** Totais por forma de recebimento: recebido, estornado e líquido. */
  byMethod: z.array(
    z.object({
      methodName: z.string(),
      paymentKind: z.enum(paymentKinds),
      received: z.number(),
      refunded: z.number(),
      net: z.number(),
    }),
  ),
  supplies: z.number(),
  withdrawals: z.number(),
  entries: z.array(cashEntrySchema),
  /** O que o usuário logado pode fazer agora. */
  canMove: z.boolean(),
  canClose: z.boolean(),
});
export type CashSession = z.infer<typeof cashSessionSchema>;

export const cashListQuerySchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  status: z.enum(cashSessionStatuses).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type CashListQuery = z.output<typeof cashListQuerySchema>;

/** Caixa aberto do usuário nesta unidade, ou nenhum. */
export const currentCashSchema = z.object({ session: cashSessionSummarySchema.nullable() });
export type CurrentCash = z.infer<typeof currentCashSchema>;
