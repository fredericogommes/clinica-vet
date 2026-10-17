import { z } from 'zod';
import { moneySchema } from './products.js';

/**
 * Pedido de compra [p.17]: sugerido pela análise de estoque, enviado ao fornecedor e, quando a
 * mercadoria chega, transformado numa compra em rascunho. O pedido em si não mexe no estoque.
 */
export const purchaseOrderStatuses = ['draft', 'sent', 'received', 'cancelled'] as const;
export type PurchaseOrderStatus = (typeof purchaseOrderStatuses)[number];
export const purchaseOrderStatusLabels: Record<PurchaseOrderStatus, string> = {
  draft: 'Rascunho',
  sent: 'Enviado',
  received: 'Recebido',
  cancelled: 'Cancelado',
};

const isoDate = z.iso.date({ message: 'Informe a data' });
const threeDecimals = (v: number) => Math.abs(Math.round(v * 1000) - v * 1000) < 1e-6;

export const purchaseOrderInputSchema = z.object({
  supplierId: z.uuid({ message: 'Escolha o fornecedor' }),
  expectedOn: isoDate.nullable(),
  notes: z.string().trim().max(500, 'Máximo de 500 caracteres'),
  items: z
    .array(
      z.object({
        productId: z.uuid({ message: 'Escolha o produto' }),
        quantity: z
          .number({ message: 'Informe a quantidade' })
          .gt(0, 'Precisa ser maior que zero')
          .max(99_999, 'Valor alto demais')
          .refine(threeDecimals, 'Use no máximo três casas'),
        /** Custo unitário estimado; vazio quando ainda não se sabe. */
        unitCost: moneySchema.nullable(),
      }),
    )
    .min(1, 'Inclua ao menos um item')
    .max(300, 'No máximo 300 itens'),
});
export type PurchaseOrderInput = z.input<typeof purchaseOrderInputSchema>;

export const purchaseOrderCancelSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, 'Explique o motivo em poucas palavras')
    .max(200, 'Máximo de 200 caracteres'),
});
export type PurchaseOrderCancelInput = z.infer<typeof purchaseOrderCancelSchema>;

export const purchaseOrderSchema = z.object({
  id: z.uuid(),
  code: z.number().int(),
  status: z.enum(purchaseOrderStatuses),
  supplier: z.object({ id: z.uuid(), name: z.string(), phone: z.string(), email: z.string() }),
  expectedOn: z.string().nullable(),
  notes: z.string(),
  total: z.number(),
  items: z.array(
    z.object({
      id: z.uuid(),
      product: z.object({ id: z.uuid(), name: z.string(), unit: z.string() }),
      /** Código do item no fornecedor, quando já aprendido numa compra. */
      supplierCode: z.string().nullable(),
      quantity: z.number(),
      unitCost: z.number().nullable(),
      total: z.number(),
    }),
  ),
  /** Texto pronto para mandar ao fornecedor por WhatsApp ou e-mail. */
  message: z.string(),
  purchase: z.object({ id: z.uuid(), code: z.number().int() }).nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  sentBy: z.string().nullable(),
  sentAt: z.string().nullable(),
  receivedAt: z.string().nullable(),
  cancelledBy: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
});
export type PurchaseOrder = z.infer<typeof purchaseOrderSchema>;

export const purchaseOrderSituations = ['abertos', 'recebidos', 'cancelados', 'todos'] as const;

export const purchaseOrderQuerySchema = z.object({
  situacao: z.enum(purchaseOrderSituations).default('abertos'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type PurchaseOrderQuery = z.infer<typeof purchaseOrderQuerySchema>;

export const purchaseOrderListSchema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      code: z.number().int(),
      status: z.enum(purchaseOrderStatuses),
      supplier: z.string(),
      createdAt: z.string(),
      expectedOn: z.string().nullable(),
      itemCount: z.number().int(),
      total: z.number(),
    }),
  ),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type PurchaseOrderList = z.infer<typeof purchaseOrderListSchema>;

/** Fornecedores e produtos para montar o pedido. */
export const purchaseOrderOptionsSchema = z.object({
  suppliers: z.array(z.object({ id: z.uuid(), name: z.string() })),
  products: z.array(
    z.object({ id: z.uuid(), name: z.string(), unit: z.string(), cost: z.number().nullable() }),
  ),
});
export type PurchaseOrderOptions = z.infer<typeof purchaseOrderOptionsSchema>;

/**
 * Sugestão de pedido: os produtos em Repor na análise de estoque, com a quantidade que leva o
 * saldo ao ideal (ou a dois meses de consumo), descontado o que já está pedido.
 */
export const purchaseSuggestionSchema = z.object({
  items: z.array(
    z.object({
      productId: z.uuid(),
      name: z.string(),
      unit: z.string(),
      onHand: z.number(),
      minStock: z.number().nullable(),
      idealStock: z.number().nullable(),
      monthlyConsumption: z.number(),
      /** Em pedidos enviados ainda não recebidos. */
      onOrder: z.number(),
      suggested: z.number(),
      unitCost: z.number().nullable(),
      /** Comprado antes deste fornecedor. */
      fromSupplier: z.boolean(),
    }),
  ),
});
export type PurchaseSuggestion = z.infer<typeof purchaseSuggestionSchema>;
