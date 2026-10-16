import { z } from 'zod';
import { moneySchema } from './products.js';

/**
 * Formas de recebimento por adquirente e bandeira, não genéricas [RN-27, p.9]: "Rede Visa
 * Crédito" e "Rede Visa Débito" são formas diferentes, cada uma com prazo e parcelamento.
 */
export const paymentKinds = ['cash', 'pix', 'debit', 'credit', 'voucher', 'other'] as const;
export type PaymentKind = (typeof paymentKinds)[number];
export const paymentKindLabels: Record<PaymentKind, string> = {
  cash: 'Dinheiro',
  pix: 'PIX',
  debit: 'Cartão de débito',
  credit: 'Cartão de crédito',
  voucher: 'Convênio ou voucher',
  other: 'Outra',
};

/** Só cartão de crédito e convênio parcelam. */
export const installableKinds: readonly PaymentKind[] = ['credit', 'voucher'];

export const MAX_INSTALLMENTS = 24;

const feePercent = z
  .number({ message: 'Informe a taxa' })
  .min(0, 'Não pode ser negativa')
  .max(30, 'Taxa acima de 30% parece engano')
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'Use no máximo duas casas');

export const paymentMethodInputSchema = z
  .object({
    name: z.string().trim().min(2, 'Informe o nome').max(80, 'Máximo de 80 caracteres'),
    kind: z.enum(paymentKinds, { message: 'Escolha o tipo' }),
    acquirer: z.string().trim().max(60, 'Máximo de 60 caracteres').default(''),
    brand: z.string().trim().max(40, 'Máximo de 40 caracteres').default(''),
    /** Dias até o dinheiro cair na conta (0 = no mesmo dia). */
    settlementDays: z
      .number({ message: 'Informe o prazo' })
      .int('Use um número inteiro de dias')
      .min(0, 'Não pode ser negativo')
      .max(365, 'Máximo de 365 dias'),
    maxInstallments: z
      .number({ message: 'Informe o número de parcelas' })
      .int('Use um número inteiro')
      .min(1, 'Mínimo de 1 parcela')
      .max(MAX_INSTALLMENTS, `Máximo de ${String(MAX_INSTALLMENTS)} parcelas`),
    /** Taxa da adquirente sobre o valor recebido; alimenta a conciliação de cartões. */
    feePercent,
    archived: z.boolean().default(false),
  })
  .superRefine((m, ctx) => {
    if (m.maxInstallments > 1 && !installableKinds.includes(m.kind)) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxInstallments'],
        message: 'Só cartão de crédito e convênio parcelam',
      });
    }
  });
export type PaymentMethodInput = z.input<typeof paymentMethodInputSchema>;
export type PaymentMethodData = z.output<typeof paymentMethodInputSchema>;

export const paymentMethodSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: z.enum(paymentKinds),
  acquirer: z.string(),
  brand: z.string(),
  settlementDays: z.number().int(),
  maxInstallments: z.number().int(),
  feePercent: z.number(),
  archived: z.boolean(),
});
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const salePaymentInputSchema = z.object({
  methodId: z.uuid({ message: 'Escolha a forma de recebimento' }),
  amount: moneySchema.refine((v) => v > 0, 'Informe um valor maior que zero'),
  installments: z
    .number({ message: 'Informe as parcelas' })
    .int()
    .min(1, 'Mínimo de 1 parcela')
    .max(MAX_INSTALLMENTS),
});
export type SalePaymentInput = z.infer<typeof salePaymentInputSchema>;

/** Registrar recebimento: as formas somam exatamente o líquido da venda [RN-27]. */
export const receiveSaleSchema = z.object({
  payments: z.array(salePaymentInputSchema).max(10, 'Máximo de 10 formas numa venda'),
});
export type ReceiveSaleInput = z.infer<typeof receiveSaleSchema>;

export const receivableSchema = z.object({
  number: z.number().int(),
  dueDate: z.iso.date(),
  amount: z.number(),
  feeAmount: z.number(),
  netAmount: z.number(),
});
export type Receivable = z.infer<typeof receivableSchema>;

export const salePaymentSchema = z.object({
  id: z.uuid(),
  methodName: z.string(),
  kind: z.enum(paymentKinds),
  amount: z.number(),
  installments: z.number().int(),
  feePercent: z.number(),
  receivables: z.array(receivableSchema),
});
export type SalePayment = z.infer<typeof salePaymentSchema>;

/**
 * Divide um valor (centavos) em parcelas iguais; os centavos que sobram vão para a primeira,
 * como fazem as adquirentes. A soma das parcelas é exatamente o valor.
 */
export function splitInstallments(amountCents: number, installments: number): number[] {
  const base = Math.floor(amountCents / installments);
  const parts = Array.from({ length: installments }, () => base);
  parts[0] = (parts[0] ?? 0) + amountCents - base * installments;
  return parts;
}

/** Taxa da adquirente sobre uma parcela, em centavos, arredondada ao centavo. */
export const feeCents = (amountCents: number, percent: number): number =>
  Math.round((amountCents * Math.round(percent * 100)) / 10_000);

/**
 * Data prevista de cada parcela: a primeira no prazo de liquidação da forma, as seguintes de 30
 * em 30 dias, como na agenda de recebíveis das adquirentes.
 */
export const receivableOffsetDays = (settlementDays: number, number: number): number =>
  settlementDays + (number - 1) * 30;
