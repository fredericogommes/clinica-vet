import { z } from 'zod';

/**
 * Análise de estoque [p.17]: cada produto com estoque cai numa situação, com contagem e valor.
 * O consumo é o que saiu por venda e outras saídas nos últimos 90 dias, descontadas devoluções.
 */
export const stockSituations = ['repor', 'excesso', 'parado', 'novos', 'adequado'] as const;
export type StockSituation = (typeof stockSituations)[number];
export const stockSituationLabels: Record<StockSituation, string> = {
  repor: 'Repor',
  excesso: 'Em excesso',
  parado: 'Parado',
  novos: 'Novos',
  adequado: 'Adequado',
};
export const stockSituationHints: Record<StockSituation, string> = {
  repor: 'No mínimo, em falta ou com saldo para menos de 30 dias de consumo',
  excesso: 'Acima do ideal ou com saldo para mais de 180 dias de consumo',
  parado: 'Com saldo e sem nenhuma saída nos últimos 90 dias',
  novos: 'Primeira movimentação há menos de 60 dias: ainda sem histórico',
  adequado: 'Saldo compatível com o consumo',
};

/** Indicadores de estoque do produto; valores em R$ nulos para quem não vê custo. */
export const stockIndicatorsSchema = z.object({
  /** Nula quando o produto está sem saldo e sem giro: não há o que analisar. */
  situation: z.enum(stockSituations).nullable(),
  /** Média mensal de consumo nos últimos 90 dias. */
  monthlyConsumption: z.number(),
  /** Quantos dias o saldo dura no consumo médio; nula sem consumo. */
  durationDays: z.number().int().nullable(),
  /** Quantidade acima do ideal (ou de 180 dias de consumo); nula fora do excesso. */
  excess: z.number().nullable(),
  totalCost: z.number().nullable(),
  excessCost: z.number().nullable(),
  /** Última saída por venda ou outra saída. */
  lastOutAt: z.string().nullable(),
});
export type StockIndicators = z.infer<typeof stockIndicatorsSchema>;

export const stockAnalysisQuerySchema = z.object({
  situacao: z.enum(stockSituations).optional(),
  grupo: z.uuid().optional(),
  q: z.string().trim().max(100).default(''),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type StockAnalysisQuery = z.infer<typeof stockAnalysisQuerySchema>;

const bucket = z.object({ count: z.number().int(), value: z.number().nullable() });

export const stockAnalysisSchema = z.object({
  /** Contagem e valor por situação, já com o filtro de grupo e busca, sem o de situação. */
  summary: z.array(bucket.extend({ situation: z.enum(stockSituations) })),
  total: bucket,
  /** Produtos sem saldo e sem giro, que ficam fora da análise. */
  idle: z.number().int(),
  items: z.array(
    stockIndicatorsSchema.extend({
      id: z.uuid(),
      name: z.string(),
      unit: z.string(),
      group: z.string().nullable(),
      onHand: z.number(),
      minStock: z.number().nullable(),
      idealStock: z.number().nullable(),
      situation: z.enum(stockSituations),
    }),
  ),
  matches: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  groups: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type StockAnalysis = z.infer<typeof stockAnalysisSchema>;
