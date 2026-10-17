import { z } from 'zod';
import { moneySchema } from './products.js';

/**
 * Compras por nota [p.17]: a compra nasce como rascunho, digitada ou importada do XML da NF-e,
 * e só mexe no estoque, no custo e no financeiro quando é confirmada. Cancelar a confirmada
 * desfaz a entrada no estoque e as parcelas ainda em aberto.
 */
export const purchaseStatuses = ['draft', 'confirmed', 'cancelled'] as const;
export type PurchaseStatus = (typeof purchaseStatuses)[number];
export const purchaseStatusLabels: Record<PurchaseStatus, string> = {
  draft: 'Rascunho',
  confirmed: 'Confirmada',
  cancelled: 'Cancelada',
};

const isoDate = z.iso.date({ message: 'Informe a data' });
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${String(max)} caracteres`);
const threeDecimals = (v: number) => Math.abs(Math.round(v * 1000) - v * 1000) < 1e-6;
const quantity = (label: string) =>
  z
    .number({ message: `Informe ${label}` })
    .gt(0, 'Precisa ser maior que zero')
    .max(99_999, 'Valor alto demais')
    .refine(threeDecimals, 'Use no máximo três casas');
const positiveMoney = moneySchema.refine((v) => v > 0, 'Informe um valor maior que zero');
const ref = z.object({ id: z.string(), name: z.string() });

export const purchaseItemInputSchema = z.object({
  /** Nulo enquanto o item da nota não foi casado com um produto da clínica. */
  productId: z.uuid().nullable(),
  description: text(200).min(1, 'Descreva o item'),
  supplierCode: text(60).default(''),
  ean: text(14).default(''),
  supplierUnit: text(10).default(''),
  quantity: quantity('a quantidade'),
  /** Unidades do produto em cada unidade da nota (caixa com 10 = 10). */
  factor: quantity('o fator').default(1),
  /** Valor total do item na nota. */
  total: moneySchema,
  lot: z
    .object({
      code: z
        .string()
        .trim()
        .min(1, 'Informe o lote')
        .max(40, 'Máximo de 40 caracteres')
        .transform((v) => v.toUpperCase()),
      expiresOn: isoDate,
    })
    .nullable()
    .default(null),
});
export type PurchaseItemInput = z.input<typeof purchaseItemInputSchema>;

export const purchaseInputSchema = z.object({
  supplierId: z.uuid({ message: 'Escolha o fornecedor' }),
  invoiceNumber: text(20),
  invoiceSeries: text(5),
  invoiceKey: z
    .string()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v === '' || v.length === 44, 'A chave de acesso tem 44 dígitos'),
  issuedOn: isoDate.nullable(),
  enteredOn: isoDate,
  freight: moneySchema,
  otherCosts: moneySchema,
  discount: moneySchema,
  accountId: z.uuid({ message: 'Escolha a conta' }),
  categoryId: z.uuid({ message: 'Escolha a categoria' }),
  notes: text(500),
  items: z
    .array(purchaseItemInputSchema)
    .min(1, 'Inclua ao menos um item')
    .max(300, 'No máximo 300 itens'),
  /** Vazio: uma parcela só, vencendo na data de entrada. */
  installments: z
    .array(z.object({ dueDate: isoDate, amount: positiveMoney }))
    .max(60, 'No máximo 60 parcelas'),
});
export type PurchaseInput = z.input<typeof purchaseInputSchema>;

/** XML da NF-e de compra, como texto. */
export const purchaseImportSchema = z.object({
  xml: z
    .string()
    .min(1, 'Escolha o arquivo XML da nota')
    .max(2_000_000, 'Arquivo grande demais para uma NF-e'),
});
export type PurchaseImportInput = z.infer<typeof purchaseImportSchema>;

export const purchaseCancelSchema = z.object({
  reason: text(200).min(3, 'Explique o motivo em poucas palavras'),
});
export type PurchaseCancelInput = z.infer<typeof purchaseCancelSchema>;

export const purchaseItemSchema = z.object({
  id: z.uuid(),
  product: z
    .object({
      id: z.uuid(),
      name: z.string(),
      unit: z.string(),
      tracksStock: z.boolean(),
      tracksLots: z.boolean(),
    })
    .nullable(),
  description: z.string(),
  supplierCode: z.string(),
  ean: z.string(),
  supplierUnit: z.string(),
  quantity: z.number(),
  factor: z.number(),
  total: z.number(),
  /** Custo de cada unidade do produto, já com frete, outras despesas e desconto rateados. */
  unitCost: z.number().nullable(),
  lot: z.object({ code: z.string(), expiresOn: z.string() }).nullable(),
});
export type PurchaseItem = z.infer<typeof purchaseItemSchema>;

export const purchaseSchema = z.object({
  id: z.uuid(),
  code: z.number().int(),
  status: z.enum(purchaseStatuses),
  source: z.enum(['manual', 'xml']),
  supplier: ref.extend({ document: z.string() }),
  invoiceNumber: z.string(),
  invoiceSeries: z.string(),
  invoiceKey: z.string(),
  issuedOn: z.string().nullable(),
  enteredOn: z.string(),
  freight: z.number(),
  otherCosts: z.number(),
  discount: z.number(),
  itemsTotal: z.number(),
  total: z.number(),
  account: ref,
  category: ref,
  notes: z.string(),
  items: z.array(purchaseItemSchema),
  installments: z.array(
    z.object({ number: z.number().int(), dueDate: z.string(), amount: z.number() }),
  ),
  /** Parcelas lançadas no financeiro, depois de confirmada. */
  entries: z.array(
    z.object({
      id: z.uuid(),
      installment: z.number().int().nullable(),
      dueDate: z.string(),
      amount: z.number(),
      status: z.enum(['open', 'paid', 'cancelled']),
    }),
  ),
  createdBy: z.string(),
  createdAt: z.string(),
  confirmedBy: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  cancelledAt: z.string().nullable(),
});
export type Purchase = z.infer<typeof purchaseSchema>;

export const purchaseSituations = ['todas', 'rascunhos', 'confirmadas', 'canceladas'] as const;
export type PurchaseSituation = (typeof purchaseSituations)[number];

export const purchaseQuerySchema = z.object({
  situacao: z.enum(purchaseSituations).default('todas'),
  q: z.string().trim().max(100).optional(),
  de: isoDate.optional(),
  ate: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type PurchaseQuery = z.infer<typeof purchaseQuerySchema>;

export const purchaseSummarySchema = z.object({
  id: z.uuid(),
  code: z.number().int(),
  status: z.enum(purchaseStatuses),
  source: z.enum(['manual', 'xml']),
  enteredOn: z.string(),
  supplier: ref,
  invoiceNumber: z.string(),
  itemCount: z.number().int(),
  total: z.number(),
});
export type PurchaseSummary = z.infer<typeof purchaseSummarySchema>;

export const purchaseListSchema = z.object({
  items: z.array(purchaseSummarySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type PurchaseList = z.infer<typeof purchaseListSchema>;

/** O que a tela de compra precisa sem depender da permissão do financeiro. */
export const purchaseOptionsSchema = z.object({
  suppliers: z.array(ref.extend({ document: z.string() })),
  accounts: z.array(ref),
  categories: z.array(ref),
  defaults: z.object({ accountId: z.string().nullable(), categoryId: z.string().nullable() }),
  products: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      unit: z.string(),
      barcode: z.string().nullable(),
      tracksStock: z.boolean(),
      tracksLots: z.boolean(),
      cost: z.number().nullable(),
    }),
  ),
  today: z.string(),
});
export type PurchaseOptions = z.infer<typeof purchaseOptionsSchema>;
