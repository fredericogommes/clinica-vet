import { z } from 'zod';
import { stockIndicatorsSchema } from './stock-analysis.js';

/**
 * Estoque por unidade com reserva na venda [RN-31, D4]: o saldo nunca fica negativo. A venda em
 * aberto reserva os itens; o grupo do produto decide se falta de saldo bloqueia a venda ou se a
 * baixa segue e a falta fica como pendência, quitada pela próxima entrada ou contagem.
 */
export const stockMovementKinds = [
  'entry',
  'count',
  'sale',
  'sale_return',
  'purchase',
  'purchase_cancel',
  'exit',
  'exit_cancel',
] as const;
export type StockMovementKind = (typeof stockMovementKinds)[number];
export const stockMovementLabels: Record<StockMovementKind, string> = {
  entry: 'Entrada',
  count: 'Contagem',
  sale: 'Venda',
  sale_return: 'Estorno de venda',
  purchase: 'Compra',
  purchase_cancel: 'Compra cancelada',
  exit: 'Saída',
  exit_cancel: 'Saída cancelada',
};

/** Quantidades em milésimos, para somar e comparar sem erro de ponto flutuante. */
export const toMilli = (value: number): number => Math.round(value * 1000);
export const fromMilli = (milli: number): number => milli / 1000;

const threeDecimals = (v: number) => Math.abs(Math.round(v * 1000) - v * 1000) < 1e-6;

const quantitySchema = z
  .number({ message: 'Informe a quantidade' })
  .gt(0, 'A quantidade precisa ser maior que zero')
  .max(99_999, 'Quantidade alta demais')
  .refine(threeDecimals, 'Use no máximo três casas');

/** Lote a vencer: aviso a partir de 30 dias da validade. */
export const lotExpiringDays = 30;
export const lotExpiryStates = ['ok', 'expiring', 'expired'] as const;
export type LotExpiryState = (typeof lotExpiryStates)[number];
/** Saldo que existia antes de o produto passar a controlar lote. */
export const legacyLotCode = 'SEM LOTE';

const lotInputSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Informe o lote')
    .max(40, 'Máximo de 40 caracteres')
    .transform((v) => v.toUpperCase())
    .refine((v) => v !== legacyLotCode, 'Use o número do lote impresso na embalagem'),
  expiresOn: z.iso.date({ message: 'Informe a validade' }),
});

const notes = (message: string) =>
  z.string().trim().min(3, message).max(300, 'Máximo de 300 caracteres');

export const stockAdjustmentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('entry'),
    quantity: quantitySchema,
    /** Obrigatório quando o produto controla lote [RN-32]; ignorado nos demais. */
    lot: lotInputSchema.optional(),
    notes: notes('Diga de onde veio, ex. nota, fornecedor ou doação'),
  }),
  z.object({
    kind: z.literal('count'),
    /** Quantidade contada na prateleira; vira o saldo e zera a pendência. */
    countedQuantity: z
      .number({ message: 'Informe a quantidade contada' })
      .min(0, 'Não pode ser negativa')
      .max(99_999, 'Quantidade alta demais')
      .refine(threeDecimals, 'Use no máximo três casas'),
    /** Produto com lote conta lote a lote; o contado vira o saldo daquele lote. */
    lotId: z.uuid().optional(),
    notes: notes('Explique a contagem em poucas palavras'),
  }),
]);
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;

export const stockMovementSchema = z.object({
  id: z.uuid(),
  kind: z.enum(stockMovementKinds),
  at: z.iso.datetime({ offset: true }),
  /** Positivo entra, negativo sai. */
  quantity: z.number(),
  /** Parte da saída que faltou e virou pendência (só em venda de grupo liberado). */
  shortfall: z.number(),
  onHandAfter: z.number(),
  notes: z.string(),
  sale: z.object({ id: z.uuid(), code: z.number().int() }).nullable(),
  purchase: z.object({ id: z.uuid(), code: z.number().int() }).nullable(),
  exit: z.object({ id: z.uuid(), code: z.number().int() }).nullable(),
  count: z.object({ id: z.uuid(), code: z.number().int() }).nullable(),
  /** Quanto entrou ou saiu de cada lote neste movimento. */
  lots: z.array(z.object({ code: z.string(), quantity: z.number() })),
  by: z.string(),
});
export type StockMovement = z.infer<typeof stockMovementSchema>;

export const stockLotSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  /** Nula só no lote "SEM LOTE", do saldo anterior ao controle de lote. */
  expiresOn: z.iso.date().nullable(),
  onHand: z.number(),
  expiry: z.enum(lotExpiryStates),
});
export type StockLot = z.infer<typeof stockLotSchema>;

export const productStockSchema = z.object({
  unitName: z.string(),
  onHand: z.number(),
  /** Reservado por vendas em aberto desta unidade. */
  reserved: z.number(),
  /** Saldo menos reservas; é o que uma nova venda pode levar. */
  available: z.number(),
  /** Saída sem saldo de grupo liberado, à espera de entrada ou contagem. */
  shortfall: z.number(),
  minStock: z.number().nullable(),
  idealStock: z.number().nullable(),
  blocksSaleWithoutStock: z.boolean(),
  tracksLots: z.boolean(),
  /** Saldo em lotes vencidos: fica fora do disponível até ser baixado pela contagem. */
  expired: z.number(),
  /** Lotes com saldo, da validade mais próxima para a mais distante. */
  lots: z.array(stockLotSchema),
  /** Entradas e saídas dos últimos 3 meses [p.17]. */
  movements: z.array(stockMovementSchema),
  /** Situação, consumo, duração e excesso, como na análise de estoque. */
  indicators: stockIndicatorsSchema,
  canAdjust: z.boolean(),
});
export type ProductStock = z.infer<typeof productStockSchema>;

/** Saldo resumido para listas e para o PDV; nulo quando o item não controla estoque. */
export const stockSummarySchema = z.object({
  available: z.number(),
  shortfall: z.number(),
  blocksSaleWithoutStock: z.boolean(),
});
export type StockSummary = z.infer<typeof stockSummarySchema>;

/** Rastreio do lote [RN-32]: de onde veio e para quais vendas e animais saiu. */
export const lotTraceSchema = z.object({
  lot: stockLotSchema,
  movements: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(stockMovementKinds),
      at: z.iso.datetime({ offset: true }),
      quantity: z.number(),
      notes: z.string(),
      /** Venda, animal e tutor aparecem só para quem pode vê-los. */
      sale: z.object({ id: z.uuid(), code: z.number().int() }).nullable(),
      purchase: z.object({ id: z.uuid(), code: z.number().int() }).nullable(),
      exit: z.object({ id: z.uuid(), code: z.number().int() }).nullable(),
      patient: z.object({ id: z.uuid(), name: z.string() }).nullable(),
      client: z.object({ id: z.uuid(), name: z.string() }).nullable(),
      by: z.string(),
    }),
  ),
});
export type LotTrace = z.infer<typeof lotTraceSchema>;
