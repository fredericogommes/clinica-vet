import { z } from 'zod';

/**
 * Estoque por unidade com reserva na venda [RN-31, D4]: o saldo nunca fica negativo. A venda em
 * aberto reserva os itens; o grupo do produto decide se falta de saldo bloqueia a venda ou se a
 * baixa segue e a falta fica como pendência, quitada pela próxima entrada ou contagem.
 */
export const stockMovementKinds = ['entry', 'count', 'sale', 'sale_return'] as const;
export type StockMovementKind = (typeof stockMovementKinds)[number];
export const stockMovementLabels: Record<StockMovementKind, string> = {
  entry: 'Entrada',
  count: 'Contagem',
  sale: 'Venda',
  sale_return: 'Estorno de venda',
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

const notes = (message: string) =>
  z.string().trim().min(3, message).max(300, 'Máximo de 300 caracteres');

export const stockAdjustmentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('entry'),
    quantity: quantitySchema,
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
  by: z.string(),
});
export type StockMovement = z.infer<typeof stockMovementSchema>;

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
  /** Entradas e saídas dos últimos 3 meses [p.17]. */
  movements: z.array(stockMovementSchema),
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
