import { z } from 'zod';

/** Produto e serviço são a mesma entidade, com um campo tipo [RN-22]. */
export const productKinds = ['product', 'service'] as const;
export type ProductKind = (typeof productKinds)[number];
export const productKindLabels: Record<ProductKind, string> = {
  product: 'Produto',
  service: 'Serviço',
};

/**
 * Classificação do serviço em campo próprio [p.3]: os indicadores (consultas do mês, vacinas
 * aplicadas) saem deste campo, nunca de busca de texto no nome.
 */
export const serviceKinds = [
  'consultation',
  'return',
  'vaccine',
  'exam',
  'surgery',
  'procedure',
  'grooming',
  'hospitalization',
  'other',
] as const;
export type ServiceKind = (typeof serviceKinds)[number];
export const serviceKindLabels: Record<ServiceKind, string> = {
  consultation: 'Consulta',
  return: 'Retorno',
  vaccine: 'Vacina',
  exam: 'Exame',
  surgery: 'Cirurgia',
  procedure: 'Procedimento',
  grooming: 'Banho e tosa',
  hospitalization: 'Internação',
  other: 'Outro',
};

export const saleUnits = [
  'un',
  'cx',
  'fr',
  'amp',
  'cp',
  'ml',
  'l',
  'g',
  'kg',
  'dose',
  'sessao',
] as const;
export type SaleUnit = (typeof saleUnits)[number];
export const saleUnitLabels: Record<SaleUnit, string> = {
  un: 'Unidade',
  cx: 'Caixa',
  fr: 'Frasco',
  amp: 'Ampola',
  cp: 'Comprimido',
  ml: 'Mililitro',
  l: 'Litro',
  g: 'Grama',
  kg: 'Quilograma',
  dose: 'Dose',
  sessao: 'Sessão',
};

export const productPurposes = ['sale', 'internal', 'both'] as const;
export type ProductPurpose = (typeof productPurposes)[number];
export const productPurposeLabels: Record<ProductPurpose, string> = {
  sale: 'Venda',
  internal: 'Consumo interno',
  both: 'Venda e consumo interno',
};

/** Origem da mercadoria, tabela da NF-e (CST tabela A). */
export const productOrigins = ['0', '1', '2', '3', '4', '5', '6', '7', '8'] as const;
export type ProductOrigin = (typeof productOrigins)[number];
export const productOriginLabels: Record<ProductOrigin, string> = {
  '0': '0 - Nacional',
  '1': '1 - Estrangeira, importação direta',
  '2': '2 - Estrangeira, adquirida no mercado interno',
  '3': '3 - Nacional, conteúdo de importação acima de 40% e até 70%',
  '4': '4 - Nacional, produzida conforme processos produtivos básicos',
  '5': '5 - Nacional, conteúdo de importação até 40%',
  '6': '6 - Estrangeira, importação direta, sem similar nacional',
  '7': '7 - Estrangeira, mercado interno, sem similar nacional',
  '8': '8 - Nacional, conteúdo de importação acima de 70%',
};

export const acquisitionForms = ['resale', 'own_production'] as const;
export type AcquisitionForm = (typeof acquisitionForms)[number];
export const acquisitionFormLabels: Record<AcquisitionForm, string> = {
  resale: 'Adquirido de terceiros (revenda)',
  own_production: 'Produção própria',
};

export const MONEY_MAX = 9_999_999.99;

/** Valor em reais com no máximo duas casas. */
export const moneySchema = z
  .number({ message: 'Informe um valor' })
  .min(0, 'Não pode ser negativo')
  .max(MONEY_MAX, 'Valor alto demais')
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'Use no máximo duas casas');

const percentSchema = (max: number) =>
  z
    .number({ message: 'Informe um percentual' })
    .min(0, 'Não pode ser negativo')
    .max(max, `Máximo de ${max}%`)
    .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'Use no máximo duas casas');

const quantitySchema = z
  .number({ message: 'Informe uma quantidade' })
  .min(0, 'Não pode ser negativa')
  .max(99_999_999, 'Quantidade alta demais');

/** Código de barras GTIN (EAN-8, UPC-12, EAN-13, GTIN-14) com dígito verificador. */
export function isValidGtin(code: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(code)) return false;
  const digits = Array.from(code, Number);
  const check = digits.pop() ?? 0;
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

const optionalCode = (pattern: RegExp, message: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, message)
    .refine((v) => v === '' || pattern.test(v), message)
    .transform((v) => (v === '' ? null : v))
    .nullable();

/** Markup real: quanto o preço está acima do custo, em % do custo. Sem custo, não há markup. */
export function markupPercent(price: number, cost: number | null): number | null {
  if (cost === null || cost <= 0) return null;
  return Math.round(((price - cost) / cost) * 10_000) / 100;
}

/** Preço que atinge o markup desejado sobre o custo, arredondado ao centavo. */
export function priceForMarkup(cost: number | null, markup: number | null): number | null {
  if (cost === null || markup === null) return null;
  return Math.round(cost * (100 + markup)) / 100;
}

export const productCommissionSchema = z.object({
  userId: z.uuid(),
  percent: percentSchema(100),
});

export const productInputSchema = z
  .object({
    kind: z.enum(productKinds),
    serviceKind: z.enum(serviceKinds).nullable(),
    name: z.string().trim().min(2, 'Mínimo de 2 caracteres').max(120, 'Máximo de 120 caracteres'),
    unit: z.enum(saleUnits),
    barcode: z
      .string()
      .trim()
      .max(14, 'Código de barras inválido')
      .refine((v) => v === '' || isValidGtin(v), 'Código de barras inválido')
      .transform((v) => (v === '' ? null : v))
      .nullable(),
    brandId: z.uuid().nullable(),
    groupId: z.uuid().nullable(),
    ncm: optionalCode(/^\d{8}$/, 'NCM tem 8 dígitos', 8),
    origin: z.enum(productOrigins),
    acquisition: z.enum(acquisitionForms),
    cfop: optionalCode(/^[1-7]\d{3}$/, 'CFOP tem 4 dígitos', 4),
    taxSituation: optionalCode(/^\d{2,3}$/, 'CST tem 2 ou 3 dígitos; CSOSN, 3', 3),
    municipalServiceCode: optionalCode(
      /^\d{1,2}\.\d{2}$/,
      'Use o item da lista de serviços, ex. 05.01',
      5,
    ),
    taxProfile: z.string().trim().max(60, 'Máximo de 60 caracteres'),
    salePrice: moneySchema,
    cost: moneySchema.nullable(),
    purpose: z.enum(productPurposes),
    desiredMarkup: percentSchema(10_000).nullable(),
    allowPriceChange: z.boolean(),
    showInPriceList: z.boolean(),
    discountLimitPercent: percentSchema(100).nullable(),
    defaultCommissionPercent: percentSchema(100),
    commissions: z.array(productCommissionSchema).max(100, 'Máximo de 100 profissionais'),
    tracksStock: z.boolean(),
    minStock: quantitySchema.nullable(),
    idealStock: quantitySchema.nullable(),
  })
  .superRefine((p, ctx) => {
    if (p.kind === 'service' && !p.serviceKind) {
      ctx.addIssue({
        code: 'custom',
        path: ['serviceKind'],
        message: 'Classifique o serviço',
      });
    }
    const users = new Set<string>();
    p.commissions.forEach((c, i) => {
      if (users.has(c.userId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['commissions', i, 'userId'],
          message: 'Profissional repetido',
        });
      }
      users.add(c.userId);
    });
    if (p.minStock !== null && p.idealStock !== null && p.idealStock < p.minStock) {
      ctx.addIssue({
        code: 'custom',
        path: ['idealStock'],
        message: 'O estoque ideal não pode ser menor que o mínimo',
      });
    }
  });
export type ProductInput = z.input<typeof productInputSchema>;
export type ProductData = z.output<typeof productInputSchema>;

const ref = z.object({ id: z.uuid(), name: z.string() });

export const productSchema = z.object({
  id: z.uuid(),
  code: z.number().int(),
  kind: z.enum(productKinds),
  serviceKind: z.enum(serviceKinds).nullable(),
  name: z.string(),
  unit: z.enum(saleUnits),
  barcode: z.string().nullable(),
  brand: ref.nullable(),
  group: ref.nullable(),
  ncm: z.string().nullable(),
  origin: z.enum(productOrigins),
  acquisition: z.enum(acquisitionForms),
  cfop: z.string().nullable(),
  taxSituation: z.string().nullable(),
  municipalServiceCode: z.string().nullable(),
  taxProfile: z.string(),
  salePrice: z.number(),
  /** Custo e markups só vêm para quem tem `products.view_cost`; senão, `costVisible` é falso. */
  costVisible: z.boolean(),
  cost: z.number().nullable(),
  desiredMarkup: z.number().nullable(),
  realMarkup: z.number().nullable(),
  suggestedPrice: z.number().nullable(),
  purpose: z.enum(productPurposes),
  allowPriceChange: z.boolean(),
  showInPriceList: z.boolean(),
  discountLimitPercent: z.number().nullable(),
  defaultCommissionPercent: z.number(),
  commissions: z.array(z.object({ userId: z.uuid(), userName: z.string(), percent: z.number() })),
  tracksStock: z.boolean(),
  minStock: z.number().nullable(),
  idealStock: z.number().nullable(),
  archived: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type Product = z.infer<typeof productSchema>;

export const productListQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
  kind: z.enum(productKinds).optional(),
  serviceKind: z.enum(serviceKinds).optional(),
  groupId: z.uuid().optional(),
  priceList: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  archived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ProductListQuery = z.output<typeof productListQuerySchema>;

export const productListItemSchema = z.object({
  id: z.uuid(),
  code: z.number().int(),
  kind: z.enum(productKinds),
  serviceKind: z.enum(serviceKinds).nullable(),
  name: z.string(),
  unit: z.enum(saleUnits),
  barcode: z.string().nullable(),
  groupName: z.string().nullable(),
  brandName: z.string().nullable(),
  salePrice: z.number(),
  archived: z.boolean(),
});
export type ProductListItem = z.infer<typeof productListItemSchema>;
