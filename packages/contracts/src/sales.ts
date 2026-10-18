import { z } from 'zod';
import { paymentMethodSchema, salePaymentSchema } from './payments.js';
import { stockSummarySchema } from './inventory.js';
import { moneySchema, productKinds, saleUnits, serviceKinds } from './products.js';

/** Venda e orçamento são a mesma entidade, com status [RN-23]. */
export const saleStatuses = ['quote', 'open', 'closed', 'cancelled'] as const;
export type SaleStatus = (typeof saleStatuses)[number];
export const saleStatusLabels: Record<SaleStatus, string> = {
  quote: 'Orçamento',
  open: 'Em aberto',
  closed: 'Baixada',
  cancelled: 'Cancelada',
};

/** Classificação fiscal da venda [RN-30, p.8]. */
export const saleTypes = [
  'in_person_consumer',
  'in_person_resale',
  'delivery_consumer',
  'delivery_resale',
  'internet_shipping',
  'phone_shipping',
] as const;
export type SaleType = (typeof saleTypes)[number];
export const saleTypeLabels: Record<SaleType, string> = {
  in_person_consumer: 'Presencial, consumidor final',
  in_person_resale: 'Presencial, para revenda',
  delivery_consumer: 'Delivery ou atendimento domiciliar',
  delivery_resale: 'Delivery para revenda',
  internet_shipping: 'Pedido pela internet com envio por transportador',
  phone_shipping: 'Pedido por telefone com envio por transportador',
};

export const discountModes = ['amount', 'percent'] as const;
export type DiscountMode = (typeof discountModes)[number];

const percent = z
  .number({ message: 'Informe um percentual' })
  .min(0, 'Não pode ser negativo')
  .max(100, 'Máximo de 100%')
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'Use no máximo duas casas');

export const quantitySchema = z
  .number({ message: 'Informe a quantidade' })
  .gt(0, 'A quantidade precisa ser maior que zero')
  .max(99_999, 'Quantidade alta demais')
  .refine((v) => Math.abs(Math.round(v * 1000) - v * 1000) < 1e-6, 'Use no máximo três casas');

export const saleItemInputSchema = z.object({
  /** Item já gravado na venda; preserva a origem (ex. lançado pela ficha clínica). */
  id: z.uuid().nullable().default(null),
  productId: z.uuid({ message: 'Escolha o item' }),
  professionalId: z.uuid({ message: 'Escolha o profissional' }),
  quantity: quantitySchema,
  /** Nulo = preço de tabela. Outro valor só com a flag do produto e a permissão própria. */
  unitPrice: moneySchema.nullable(),
  /** Número da autorização do convênio, quando o item a exige [RN-43]. */
  authorizationCode: z.string().trim().max(40, 'Máximo de 40 caracteres').default(''),
});
export type SaleItemInput = z.infer<typeof saleItemInputSchema>;

export const saleInputSchema = z
  .object({
    /** "quote" grava orçamento; "sale" grava venda em aberto. */
    kind: z.enum(['quote', 'sale']),
    saleType: z.enum(saleTypes),
    clientId: z.uuid().nullable(),
    patientId: z.uuid().nullable(),
    /** Atendimento pelo convênio do plano do animal; nulo é particular [RN-43]. */
    insurerId: z.uuid().nullable().default(null),
    items: z
      .array(saleItemInputSchema)
      .min(1, 'Inclua ao menos um item')
      .max(200, 'Máximo de 200 itens'),
    discount: z.object({
      mode: z.enum(discountModes),
      value: z.number({ message: 'Informe o desconto' }).min(0, 'Não pode ser negativo'),
    }),
    notes: z.string().trim().max(1000, 'Máximo de 1000 caracteres'),
  })
  .superRefine((s, ctx) => {
    if (s.patientId && !s.clientId) {
      ctx.addIssue({ code: 'custom', path: ['clientId'], message: 'Escolha o responsável' });
    }
    if (s.insurerId && !s.patientId) {
      ctx.addIssue({
        code: 'custom',
        path: ['insurerId'],
        message: 'Venda pelo convênio precisa do animal com o plano',
      });
    }
    if (s.discount.mode === 'percent' && !percent.safeParse(s.discount.value).success) {
      ctx.addIssue({
        code: 'custom',
        path: ['discount', 'value'],
        message: 'Percentual entre 0 e 100, com até duas casas',
      });
    }
    if (s.discount.mode === 'amount' && !moneySchema.safeParse(s.discount.value).success) {
      ctx.addIssue({
        code: 'custom',
        path: ['discount', 'value'],
        message: 'Valor em reais com até duas casas',
      });
    }
  });
export type SaleInput = z.input<typeof saleInputSchema>;
export type SaleData = z.output<typeof saleInputSchema>;

const ref = z.object({ id: z.uuid(), name: z.string() });

export const saleItemSchema = z.object({
  id: z.uuid(),
  productId: z.uuid(),
  code: z.number().int(),
  name: z.string(),
  kind: z.enum(productKinds),
  serviceKind: z.enum(serviceKinds).nullable(),
  unit: z.enum(saleUnits),
  quantity: z.number(),
  listPrice: z.number(),
  unitPrice: z.number(),
  allowPriceChange: z.boolean(),
  discountLimitPercent: z.number().nullable(),
  professional: ref,
  /** Evento da ficha clínica que lançou o item [RN-19]. */
  clinicalEventId: z.uuid().nullable(),
  /** Saldo disponível para este item, fora o que a própria venda reserva [RN-31]. */
  stock: stockSummarySchema.nullable(),
  grossTotal: z.number(),
  discountAmount: z.number(),
  netTotal: z.number(),
  /** Cobertura do convênio; nula no item particular ou fora da tabela. */
  coverage: z
    .object({
      copayPercent: z.number(),
      /** O que o convênio repassa; o resto do líquido é do tutor. */
      insurerAmount: z.number(),
      requiresAuthorization: z.boolean(),
      authorizationCode: z.string(),
    })
    .nullable(),
});
export type SaleItem = z.infer<typeof saleItemSchema>;

export const saleSchema = z.object({
  id: z.uuid(),
  code: z.number().int(),
  status: z.enum(saleStatuses),
  saleType: z.enum(saleTypes),
  client: ref.extend({ code: z.number().int() }).nullable(),
  patient: ref.nullable(),
  insurer: ref.extend({ cardNumber: z.string() }).nullable(),
  items: z.array(saleItemSchema),
  discount: z.object({ mode: z.enum(discountModes), value: z.number() }),
  grossTotal: z.number(),
  discountTotal: z.number(),
  netTotal: z.number(),
  /** Parte do convênio, recebida pelo repasse e não no balcão. */
  insurerTotal: z.number(),
  /** O que o tutor paga no balcão: o líquido menos a parte do convênio. */
  customerTotal: z.number(),
  notes: z.string(),
  unitName: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  createdBy: z.string(),
  cancelled: z
    .object({ at: z.iso.datetime({ offset: true }), by: z.string(), reason: z.string() })
    .nullable(),
  /** Recebimento que baixou a venda [RN-27]. */
  closed: z.object({ at: z.iso.datetime({ offset: true }), by: z.string() }).nullable(),
  payments: z.array(salePaymentSchema),
  /** O que o usuário logado pode fazer com a venda agora. */
  editable: z.boolean(),
  cancellable: z.boolean(),
  receivable: z.boolean(),
  /** Venda baixada que o usuário pode estornar pelo caixa [RN-29]. */
  reversible: z.boolean(),
  /** Quanto o cliente ainda deve desta venda (conta do cliente) [p.10]. */
  clientDebt: z.number(),
  /** O usuário pode receber agora o que está pendurado. */
  settleable: z.boolean(),
});
export type Sale = z.infer<typeof saleSchema>;

export const cancelSaleSchema = z.object({
  reason: z.string().trim().min(3, 'Explique o motivo em poucas palavras').max(300),
});

export const saleListQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
  status: z.enum(saleStatuses).optional(),
  /** Últimas N horas, para o painel do PDV. */
  sinceHours: z.coerce.number().int().min(1).max(720).optional(),
  /** Período pela data da venda (ou da criação, no orçamento), no fuso da unidade. */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type SaleListQuery = z.output<typeof saleListQuerySchema>;

export const saleListItemSchema = z.object({
  id: z.uuid(),
  code: z.number().int(),
  status: z.enum(saleStatuses),
  clientName: z.string().nullable(),
  patientName: z.string().nullable(),
  netTotal: z.number(),
  createdAt: z.iso.datetime({ offset: true }),
  /** Quando virou venda; nulo no orçamento. */
  soldAt: z.iso.datetime({ offset: true }).nullable(),
});
export type SaleListItem = z.infer<typeof saleListItemSchema>;

/** Item que pode entrar numa venda, com o que o PDV precisa saber dele. */
export const sellableItemSchema = z.object({
  id: z.uuid(),
  code: z.number().int(),
  name: z.string(),
  kind: z.enum(productKinds),
  serviceKind: z.enum(serviceKinds).nullable(),
  unit: z.enum(saleUnits),
  barcode: z.string().nullable(),
  salePrice: z.number(),
  allowPriceChange: z.boolean(),
  discountLimitPercent: z.number().nullable(),
  stock: stockSummarySchema.nullable(),
});
export type SellableItem = z.infer<typeof sellableItemSchema>;

export const salesSettingsSchema = z.object({
  /** Limite de desconto da clínica, usado quando o usuário não tem limite próprio. */
  discountLimitPercent: percent,
  defaultSaleType: z.enum(saleTypes),
});
export type SalesSettings = z.infer<typeof salesSettingsSchema>;

/** Valores em centavos, para somar e ratear sem erro de ponto flutuante. */
export const toCents = (value: number): number => Math.round(value * 100);
export const fromCents = (cents: number): number => cents / 100;

/**
 * Rateia um desconto (centavos) entre itens proporcionalmente ao bruto de cada um, pelo método
 * do maior resto: a soma das partes é exatamente o desconto.
 */
export function allocateDiscount(grossCents: number[], discountCents: number): number[] {
  const total = grossCents.reduce((a, b) => a + b, 0);
  if (total === 0 || discountCents === 0) return grossCents.map(() => 0);
  const raw = grossCents.map((g) => (g * discountCents) / total);
  const parts = raw.map(Math.floor);
  let left = discountCents - parts.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left === 0) break;
    parts[i] = (parts[i] ?? 0) + 1;
    left -= 1;
  }
  return parts;
}

/** Totais da venda a partir dos itens e do desconto; o servidor é quem grava estes valores. */
export function saleTotals(
  items: { unitPrice: number; quantity: number }[],
  discount: { mode: DiscountMode; value: number },
) {
  const gross = items.map((i) => Math.round(toCents(i.unitPrice) * i.quantity));
  const grossTotal = gross.reduce((a, b) => a + b, 0);
  const wanted =
    discount.mode === 'amount'
      ? toCents(discount.value)
      : Math.round((grossTotal * discount.value) / 100);
  const discountTotal = Math.min(wanted, grossTotal);
  const shares = allocateDiscount(gross, discountTotal);
  return {
    items: gross.map((g, i) => ({ grossCents: g, discountCents: shares[i] ?? 0 })),
    grossCents: grossTotal,
    discountCents: discountTotal,
    netCents: grossTotal - discountTotal,
    exceedsGross: wanted > grossTotal,
  };
}

/** O que o PDV precisa saber do usuário logado para orientar o formulário. */
export const saleContextSchema = z.object({
  /** Limite de desconto do usuário (o dele ou, sem limite próprio, o da clínica). */
  discountLimitPercent: z.number(),
  defaultSaleType: z.enum(saleTypes),
  professionals: z.array(ref),
  /** Formas de recebimento ativas, na ordem de cadastro. */
  paymentMethods: z.array(paymentMethodSchema),
});
export type SaleContext = z.infer<typeof saleContextSchema>;

export const sellableQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
});

/** Plano do animal e a tabela do convênio, para o PDV mostrar preços e coparticipação. */
export const saleCoverageSchema = z.object({
  insurer: ref.extend({ cardNumber: z.string(), copayPercent: z.number() }),
  /** Plano vale hoje (convênio ativo e dentro da validade). */
  active: z.boolean(),
  validUntil: z.iso.date().nullable(),
  prices: z.array(
    z.object({
      productId: z.uuid(),
      price: z.number(),
      copayPercent: z.number().nullable(),
      requiresAuthorization: z.boolean(),
      /** Preço particular do item, para voltar a ele quando a venda deixa o convênio. */
      salePrice: z.number(),
    }),
  ),
});
export type SaleCoverage = z.infer<typeof saleCoverageSchema>;

/** Item lançado pela ficha clínica na venda aberta do animal [RN-19]. */
export const patientSaleItemInputSchema = z.object({
  productId: z.uuid({ message: 'Escolha o item' }),
  professionalId: z.uuid({ message: 'Escolha o profissional' }),
  quantity: quantitySchema,
});
export type PatientSaleItemInput = z.infer<typeof patientSaleItemInputSchema>;

/** Coluna de vendas da ficha: a venda aberta do animal nesta unidade e as vendas recentes. */
export const patientSalesSchema = z.object({
  open: saleSchema.nullable(),
  recent: z.array(saleListItemSchema),
});
export type PatientSales = z.infer<typeof patientSalesSchema>;
