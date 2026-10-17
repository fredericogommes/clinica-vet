import { z } from 'zod';

/**
 * Outras saídas de estoque [p.17]: perda, quebra, vencimento, uso interno e doação. A saída baixa
 * na hora, lote a lote, e guarda o custo do momento; cancelar devolve ao estoque.
 */
export const stockExitReasons = [
  'loss',
  'breakage',
  'expired',
  'internal_use',
  'donation',
  'other',
] as const;
export type StockExitReason = (typeof stockExitReasons)[number];
export const stockExitReasonLabels: Record<StockExitReason, string> = {
  loss: 'Perda',
  breakage: 'Quebra',
  expired: 'Vencimento',
  internal_use: 'Uso interno',
  donation: 'Doação',
  other: 'Outro motivo',
};

const isoDate = z.iso.date({ message: 'Informe a data' });
const threeDecimals = (v: number) => Math.abs(Math.round(v * 1000) - v * 1000) < 1e-6;
const ref = z.object({ id: z.string(), name: z.string() });
const lotRef = z.object({ id: z.uuid(), code: z.string(), expiresOn: z.string().nullable() });

export const stockExitInputSchema = z
  .object({
    reason: z.enum(stockExitReasons, { message: 'Escolha o motivo' }),
    occurredOn: isoDate,
    notes: z.string().trim().max(500, 'Máximo de 500 caracteres'),
    items: z
      .array(
        z.object({
          productId: z.uuid({ message: 'Escolha o produto' }),
          /** Obrigatório no produto que controla lote. */
          lotId: z.uuid().nullable(),
          quantity: z
            .number({ message: 'Informe a quantidade' })
            .gt(0, 'Precisa ser maior que zero')
            .max(99_999, 'Valor alto demais')
            .refine(threeDecimals, 'Use no máximo três casas'),
        }),
      )
      .min(1, 'Inclua ao menos um item')
      .max(100, 'No máximo 100 itens'),
  })
  .refine((v) => v.reason !== 'other' || v.notes.length >= 3, {
    path: ['notes'],
    message: 'Descreva o motivo',
  });
export type StockExitInput = z.input<typeof stockExitInputSchema>;

export const stockCancelSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, 'Explique o motivo em poucas palavras')
    .max(200, 'Máximo de 200 caracteres'),
});
export type StockCancelInput = z.infer<typeof stockCancelSchema>;

export const stockExitSchema = z.object({
  id: z.uuid(),
  code: z.number().int(),
  reason: z.enum(stockExitReasons),
  occurredOn: z.string(),
  notes: z.string(),
  /** Custo total da saída; nulo para quem não vê custo. */
  totalCost: z.number().nullable(),
  items: z.array(
    z.object({
      id: z.uuid(),
      product: z.object({ id: z.uuid(), name: z.string(), unit: z.string() }),
      lot: lotRef.nullable(),
      quantity: z.number(),
      unitCost: z.number().nullable(),
    }),
  ),
  createdBy: z.string(),
  createdAt: z.string(),
  cancelledBy: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
});
export type StockExit = z.infer<typeof stockExitSchema>;

export const stockExitSituations = ['ativas', 'canceladas', 'todas'] as const;

export const stockExitQuerySchema = z.object({
  situacao: z.enum(stockExitSituations).default('ativas'),
  motivo: z.enum(stockExitReasons).optional(),
  de: isoDate.optional(),
  ate: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type StockExitQuery = z.infer<typeof stockExitQuerySchema>;

export const stockExitListSchema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      code: z.number().int(),
      reason: z.enum(stockExitReasons),
      occurredOn: z.string(),
      /** Produtos da saída, para a lista: "Vacina V10, Seringa 3 ml". */
      products: z.string(),
      itemCount: z.number().int(),
      totalCost: z.number().nullable(),
      cancelled: z.boolean(),
    }),
  ),
  total: z.number().int(),
  /** Custo das saídas ativas no filtro; nulo para quem não vê custo. */
  totalCost: z.number().nullable(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type StockExitList = z.infer<typeof stockExitListSchema>;

/** Produtos com estoque e os lotes com saldo, para escolher o que sai. */
export const stockOptionsSchema = z.object({
  products: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      unit: z.string(),
      tracksLots: z.boolean(),
      onHand: z.number(),
      lots: z.array(lotRef.extend({ onHand: z.number(), expired: z.boolean() })),
    }),
  ),
  groups: z.array(ref),
  today: z.string(),
});
export type StockOptions = z.infer<typeof stockOptionsSchema>;

/**
 * Inventário [p.17]: contagem física de todos os produtos com estoque (ou de um grupo). Enquanto
 * aberto, guarda o que foi contado; aplicar transforma cada contagem em saldo.
 */
export const stockCountStatuses = ['open', 'applied', 'cancelled'] as const;
export type StockCountStatus = (typeof stockCountStatuses)[number];
export const stockCountStatusLabels: Record<StockCountStatus, string> = {
  open: 'Em contagem',
  applied: 'Aplicado',
  cancelled: 'Cancelado',
};

export const stockCountCreateSchema = z.object({
  groupId: z.uuid().nullable(),
  notes: z.string().trim().max(500, 'Máximo de 500 caracteres'),
});
export type StockCountCreateInput = z.infer<typeof stockCountCreateSchema>;

export const stockCountUpdateSchema = z.object({
  lines: z
    .array(
      z.object({
        id: z.uuid(),
        counted: z
          .number({ message: 'Informe a quantidade' })
          .min(0, 'Não pode ser negativa')
          .max(9_999_999, 'Valor alto demais')
          .refine(threeDecimals, 'Use no máximo três casas')
          .nullable(),
      }),
    )
    .max(5000),
});
export type StockCountUpdateInput = z.infer<typeof stockCountUpdateSchema>;

export const stockCountSchema = z.object({
  id: z.uuid(),
  code: z.number().int(),
  status: z.enum(stockCountStatuses),
  group: ref.nullable(),
  notes: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
  closedBy: z.string().nullable(),
  closedAt: z.string().nullable(),
  lines: z.array(
    z.object({
      id: z.uuid(),
      product: z.object({ id: z.uuid(), name: z.string(), unit: z.string() }),
      lot: lotRef.nullable(),
      /** Saldo do sistema: o atual enquanto em contagem; o do momento em que foi aplicado. */
      expected: z.number(),
      counted: z.number().nullable(),
    }),
  ),
});
export type StockCount = z.infer<typeof stockCountSchema>;

export const stockCountListSchema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      code: z.number().int(),
      status: z.enum(stockCountStatuses),
      group: z.string().nullable(),
      createdAt: z.string(),
      lines: z.number().int(),
      counted: z.number().int(),
    }),
  ),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type StockCountList = z.infer<typeof stockCountListSchema>;

export const stockCountQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});
