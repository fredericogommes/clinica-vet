import { z } from 'zod';
import { abcClasses } from './clients.js';
import { paymentKinds } from './payments.js';
import { productKinds, saleUnits } from './products.js';
import { saleStatuses } from './sales.js';

const periodShape = {
  from: z.iso.date({ message: 'Informe a data inicial' }),
  to: z.iso.date({ message: 'Informe a data final' }),
};

function checkPeriod(p: { from: string; to: string }, ctx: z.RefinementCtx) {
  if (p.to < p.from) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: 'A data final vem antes da inicial' });
  } else if ((Date.parse(p.to) - Date.parse(p.from)) / 86_400_000 > 366) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: 'Consulte no máximo um ano por vez' });
  }
}

/** Período de consulta de vendas, em datas do fuso da unidade; no máximo um ano. */
export const salesPeriodSchema = z.object(periodShape).superRefine(checkPeriod);
export type SalesPeriod = z.output<typeof salesPeriodSchema>;

const money = z.number();

/** Totais de um conjunto de vendas: bruto, desconto, líquido, recebido e em aberto. */
export const salesTotalsSchema = z.object({
  count: z.number().int(),
  gross: money,
  discount: money,
  /** Desconto sobre o bruto, em %. */
  discountPercent: z.number(),
  net: money,
  /** Líquido ÷ quantidade de vendas. */
  averageTicket: money,
  /** Recebimentos não estornados das vendas do período; a conta do cliente só quando recebida. */
  received: money,
  /** Falta receber: vendas não baixadas e o que ainda está na conta do cliente [p.10]. */
  open: money,
});
export type SalesTotals = z.infer<typeof salesTotalsSchema>;

/**
 * Consulta vendas, aba Resumo [p.9]: vendas em aberto e baixadas do período, pela data da venda
 * (a conversão do orçamento conta como venda no dia em que virou venda).
 */
export const salesSummarySchema = z.object({
  totals: salesTotalsSchema,
  byDay: z.array(salesTotalsSchema.extend({ date: z.iso.date() })),
  /** Por forma de recebimento, separando à vista (1×) e parcelado. */
  byMethod: z.array(
    z.object({
      methodName: z.string(),
      kind: z.enum(paymentKinds),
      count: z.number().int(),
      upfront: money,
      installments: money,
      total: money,
    }),
  ),
  /** Pelo profissional de cada item [RN-24]: uma venda pode contar para mais de um. */
  byProfessional: z.array(
    z.object({
      userId: z.uuid(),
      name: z.string(),
      salesCount: z.number().int(),
      itemsCount: z.number().int(),
      net: money,
    }),
  ),
  byKind: z.array(
    z.object({
      kind: z.enum(productKinds),
      salesCount: z.number().int(),
      itemsCount: z.number().int(),
      net: money,
    }),
  ),
});
export type SalesSummary = z.infer<typeof salesSummarySchema>;

export const salesByItemQuerySchema = z
  .object({ ...periodShape, kind: z.enum(productKinds).optional() })
  .superRefine(checkPeriod);
export type SalesByItemQuery = z.output<typeof salesByItemQuerySchema>;

/** Aba Totais por produto/serviço [p.9]: ranking do que mais vendeu, pelo líquido. */
export const salesByItemSchema = z.object({
  items: z.array(
    z.object({
      productId: z.uuid(),
      code: z.number().int(),
      name: z.string(),
      kind: z.enum(productKinds),
      unit: z.enum(saleUnits),
      quantity: z.number(),
      salesCount: z.number().int(),
      gross: money,
      discount: money,
      net: money,
    }),
  ),
  totals: z.object({ net: money, gross: money, discount: money }),
});
export type SalesByItem = z.infer<typeof salesByItemSchema>;

/** Minhas vendas [p.10]: os itens em que o usuário é o profissional responsável. */
export const mySalesSchema = z.object({
  totals: z.object({
    salesCount: z.number().int(),
    itemsCount: z.number().int(),
    net: money,
    open: money,
  }),
  items: z.array(
    z.object({
      itemId: z.uuid(),
      saleId: z.uuid(),
      code: z.number().int(),
      soldAt: z.iso.datetime({ offset: true }),
      status: z.enum(saleStatuses),
      clientName: z.string().nullable(),
      patientName: z.string().nullable(),
      name: z.string(),
      kind: z.enum(productKinds),
      unit: z.enum(saleUnits),
      quantity: z.number(),
      net: money,
    }),
  ),
  /** A lista mostra até 500 itens; os totais valem para o período inteiro. */
  truncated: z.boolean(),
});
export type MySales = z.infer<typeof mySalesSchema>;

/** Ranking de clientes [p.10, RN-10]: valor líquido comprado no período, da clínica toda. */
export const clientRankingSchema = z.object({
  total: money,
  classes: z.array(
    z.object({
      class: z.enum(abcClasses),
      clients: z.number().int(),
      net: money,
      share: z.number(),
    }),
  ),
  items: z.array(
    z.object({
      position: z.number().int(),
      client: z.object({ id: z.uuid(), code: z.number().int(), name: z.string() }),
      salesCount: z.number().int(),
      net: money,
      /** Participação no total, em %. */
      share: z.number(),
      cumulativeShare: z.number(),
      class: z.enum(abcClasses),
    }),
  ),
});
export type ClientRanking = z.infer<typeof clientRankingSchema>;
