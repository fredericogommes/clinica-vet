import { z } from 'zod';
import { isValidCnpj, onlyDigits } from './documents.js';
import { moneySchema, productKinds } from './products.js';

/**
 * Convênio genérico [RN-43, D3]: o plano de saúde é uma entidade com tabela de preços própria,
 * prazo de repasse, coparticipação do tutor e autorização prévia. O item do catálogo é um só;
 * o preço do convênio fica na tabela dele, nunca num item duplicado com sufixo no nome.
 */

const percent = z
  .number({ message: 'Informe um percentual' })
  .min(0, 'Não pode ser negativo')
  .max(100, 'Máximo de 100%')
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'Use no máximo duas casas');

export const insurerInputSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(80, 'Máximo de 80 caracteres'),
  /** CNPJ da operadora, opcional. */
  document: z
    .string()
    .transform(onlyDigits)
    .refine((v) => v === '' || (v.length === 14 && isValidCnpj(v)), 'CNPJ inválido')
    .default(''),
  /** Dias entre o atendimento e o repasse do convênio. */
  paymentDays: z
    .number({ message: 'Informe o prazo' })
    .int('Use um número inteiro de dias')
    .min(0, 'Não pode ser negativo')
    .max(365, 'Máximo de 365 dias'),
  /** Parte do valor da tabela paga pelo tutor; o resto é repassado pelo convênio. */
  copayPercent: percent,
  /** Padrão para os itens incluídos na tabela: exigem número de autorização antes da baixa. */
  requiresAuthorization: z.boolean().default(false),
  notes: z.string().trim().max(500, 'Máximo de 500 caracteres').default(''),
  archived: z.boolean().default(false),
});
export type InsurerInput = z.input<typeof insurerInputSchema>;
export type InsurerData = z.output<typeof insurerInputSchema>;

export const insurerSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  document: z.string(),
  paymentDays: z.number().int(),
  copayPercent: z.number(),
  requiresAuthorization: z.boolean(),
  notes: z.string(),
  archived: z.boolean(),
  /** Itens com preço na tabela. */
  priceCount: z.number().int(),
  /** Animais com plano ativo neste convênio. */
  patientCount: z.number().int(),
});
export type Insurer = z.infer<typeof insurerSchema>;

/** Convênio para escolher no cadastro do animal: só os ativos. */
export const insurerOptionSchema = z.object({ id: z.uuid(), name: z.string() });
export type InsurerOption = z.infer<typeof insurerOptionSchema>;

export const insurerPriceInputSchema = z.object({
  productId: z.uuid({ message: 'Escolha o item' }),
  /** Valor total do procedimento no convênio (coparticipação mais repasse). */
  price: moneySchema,
  /** Coparticipação deste item; nula segue a do convênio. */
  copayPercent: percent.nullable(),
  requiresAuthorization: z.boolean(),
});
export type InsurerPriceInput = z.infer<typeof insurerPriceInputSchema>;

/** A tabela inteira é salva de uma vez: o que sai da lista deixa de ser coberto. */
export const insurerPricesInputSchema = z
  .object({
    items: z.array(insurerPriceInputSchema).max(1000, 'Máximo de 1.000 itens na tabela'),
  })
  .superRefine((t, ctx) => {
    const seen = new Set<string>();
    t.items.forEach((item, i) => {
      if (seen.has(item.productId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', i, 'productId'],
          message: 'Item repetido na tabela',
        });
      }
      seen.add(item.productId);
    });
  });
export type InsurerPricesInput = z.infer<typeof insurerPricesInputSchema>;

export const insurerPriceSchema = z.object({
  productId: z.uuid(),
  code: z.number().int(),
  name: z.string(),
  kind: z.enum(productKinds),
  /** Preço de venda do item fora do convênio, para comparar. */
  salePrice: z.number(),
  price: z.number(),
  copayPercent: z.number().nullable(),
  requiresAuthorization: z.boolean(),
  archived: z.boolean(),
});
export type InsurerPrice = z.infer<typeof insurerPriceSchema>;

/** Item que pode entrar na tabela: ativo e com finalidade de venda. */
export const insurerCandidateSchema = z.object({
  id: z.uuid(),
  code: z.number().int(),
  name: z.string(),
  kind: z.enum(productKinds),
  salePrice: z.number(),
});
export type InsurerCandidate = z.infer<typeof insurerCandidateSchema>;

export const insurerPricesSchema = z.object({
  insurer: insurerSchema,
  items: z.array(insurerPriceSchema),
});
export type InsurerPrices = z.infer<typeof insurerPricesSchema>;

/** Plano de saúde do animal: convênio, carteirinha e validade opcional. */
export const patientInsuranceInputSchema = z.object({
  insurerId: z.uuid({ message: 'Escolha o convênio' }),
  cardNumber: z
    .string()
    .trim()
    .min(1, 'Informe o número da carteirinha')
    .max(40, 'Máximo de 40 caracteres'),
  validUntil: z
    .union([z.literal(''), z.iso.date({ message: 'Data inválida' })])
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .default(null),
});
export type PatientInsuranceInput = z.input<typeof patientInsuranceInputSchema>;

export const patientInsuranceSchema = z.object({
  insurerId: z.uuid(),
  insurerName: z.string(),
  cardNumber: z.string(),
  validUntil: z.iso.date().nullable(),
  /** Convênio arquivado ou validade passada: o plano não vale para novas vendas. */
  active: z.boolean(),
});
export type PatientInsurance = z.infer<typeof patientInsuranceSchema>;

/** Valor de coparticipação (centavos) sobre o valor da tabela, arredondado ao centavo. */
export const copayCents = (amountCents: number, copayPercent: number): number =>
  Math.round((amountCents * Math.round(copayPercent * 100)) / 10_000);

/** O plano vale na data: convênio ativo e validade (se houver) não vencida. */
export const insuranceActiveOn = (
  insurance: { validUntil: string | null },
  insurerArchived: boolean,
  date: string,
): boolean => !insurerArchived && (insurance.validUntil === null || insurance.validUntil >= date);
