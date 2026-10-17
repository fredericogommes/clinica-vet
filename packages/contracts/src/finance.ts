import { z } from 'zod';
import { isValidCnpj, isValidCpf, onlyDigits } from './documents.js';
import { MONEY_MAX, moneySchema } from './products.js';

/**
 * Financeiro [p.18–19, RN-35]: contas, plano de contas, fornecedores e lançamentos. As vendas
 * lançam sozinhas (receita e taxa de cartão por parcela); contas a pagar e transferências são
 * lançadas à mão. Valores sempre positivos: a direção diz se entra ou sai da conta.
 */

const isoDate = z.iso.date({ message: 'Informe a data' });
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${String(max)} caracteres`);
const positiveMoney = moneySchema.refine((v) => v > 0, 'Informe um valor maior que zero');
/** Saldo inicial pode ser negativo (conta no cheque especial). */
const signedMoney = z
  .number({ message: 'Informe um valor' })
  .min(-MONEY_MAX, 'Valor alto demais')
  .max(MONEY_MAX, 'Valor alto demais')
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'Use no máximo duas casas');
const ref = z.object({ id: z.string(), name: z.string() });

// Contas e cartões ---------------------------------------------------------------------------------

export const financialAccountKinds = ['bank', 'cash', 'other'] as const;
export type FinancialAccountKind = (typeof financialAccountKinds)[number];
export const financialAccountKindLabels: Record<FinancialAccountKind, string> = {
  bank: 'Conta bancária',
  cash: 'Dinheiro',
  other: 'Outra',
};

export const financialAccountInputSchema = z.object({
  name: text(60).min(2, 'Informe o nome'),
  kind: z.enum(financialAccountKinds),
  openingBalance: signedMoney,
  openingDate: isoDate,
  archived: z.boolean().default(false),
});
export type FinancialAccountInput = z.input<typeof financialAccountInputSchema>;

export const financialAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(financialAccountKinds),
  openingBalance: z.number(),
  openingDate: z.string(),
  archived: z.boolean(),
  /** Saldo real: inicial + lançamentos pagos. */
  balance: z.number(),
  /** Saldo previsto: real + lançamentos em aberto. */
  forecast: z.number(),
});
export type FinancialAccount = z.infer<typeof financialAccountSchema>;

// Plano de contas ----------------------------------------------------------------------------------

export const categoryKinds = ['income', 'expense'] as const;
export type CategoryKind = (typeof categoryKinds)[number];
export const categoryKindLabels: Record<CategoryKind, string> = {
  income: 'Receita',
  expense: 'Despesa',
};

export const financialCategoryInputSchema = z.object({
  name: text(60).min(2, 'Informe o nome'),
  kind: z.enum(categoryKinds),
  /** Um nível de subcategoria: a categoria-mãe não pode ter mãe. */
  parentId: z.uuid().nullable(),
  archived: z.boolean().default(false),
});
export type FinancialCategoryInput = z.input<typeof financialCategoryInputSchema>;

export const financialCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(categoryKinds),
  parentId: z.string().nullable(),
  /** Usada pelos lançamentos automáticos; não muda de tipo nem é arquivada. */
  system: z.boolean(),
  archived: z.boolean(),
});
export type FinancialCategory = z.infer<typeof financialCategorySchema>;

// Fornecedores -------------------------------------------------------------------------------------

export const supplierInputSchema = z.object({
  name: text(120).min(2, 'Informe o nome'),
  /** CPF ou CNPJ, opcional. */
  document: z
    .string()
    .transform(onlyDigits)
    .refine(
      (v) => v === '' || (v.length === 11 ? isValidCpf(v) : v.length === 14 && isValidCnpj(v)),
      'CPF ou CNPJ inválido',
    ),
  phone: z
    .string()
    .transform(onlyDigits)
    .refine((v) => v === '' || v.length === 10 || v.length === 11, 'Telefone com DDD'),
  email: z
    .string()
    .trim()
    .max(120)
    .refine((v) => v === '' || z.email().safeParse(v).success, 'E-mail inválido'),
  notes: text(500),
  archived: z.boolean().default(false),
});
export type SupplierInput = z.input<typeof supplierInputSchema>;

export const supplierSchema = z.object({
  id: z.string(),
  name: z.string(),
  document: z.string(),
  phone: z.string(),
  email: z.string(),
  notes: z.string(),
  archived: z.boolean(),
});
export type Supplier = z.infer<typeof supplierSchema>;

// Lançamentos --------------------------------------------------------------------------------------

export const entryKinds = ['income', 'expense', 'transfer'] as const;
export type EntryKind = (typeof entryKinds)[number];
export const entryStatuses = ['open', 'paid', 'cancelled'] as const;
export type EntryStatus = (typeof entryStatuses)[number];
export const entryStatusLabels: Record<EntryStatus, string> = {
  open: 'Em aberto',
  paid: 'Pago',
  cancelled: 'Cancelado',
};
export const entryOrigins = ['manual', 'sale', 'card_fee', 'card_adjustment', 'transfer'] as const;
export type EntryOrigin = (typeof entryOrigins)[number];

export const ENTRY_MAX_REPEAT = 60;

export const entryInputSchema = z
  .object({
    kind: z.enum(['income', 'expense']),
    description: text(120).min(2, 'Descreva o lançamento'),
    /** Nota, boleto ou recibo. */
    document: text(60),
    accountId: z.uuid({ message: 'Escolha a conta' }),
    categoryId: z.uuid({ message: 'Escolha a categoria' }),
    supplierId: z.uuid().nullable(),
    costCenterId: z.uuid().nullable(),
    amount: positiveMoney,
    dueDate: isoDate,
    /** Mês a que a receita ou despesa pertence (regime de competência); padrão: vencimento. */
    competenceDate: isoDate.nullable(),
    /** `installments`: divide o valor; `monthly`: repete o valor todo mês. */
    repeat: z.enum(['none', 'installments', 'monthly']),
    count: z
      .number({ message: 'Informe a quantidade' })
      .int('Use um número inteiro')
      .min(1, 'Ao menos 1')
      .max(ENTRY_MAX_REPEAT, `No máximo ${String(ENTRY_MAX_REPEAT)}`),
    /** Já pago: baixa a primeira parcela nesta data. */
    paidOn: isoDate.nullable(),
    notes: text(500),
  })
  .superRefine((v, ctx) => {
    if (v.repeat === 'none' && v.count !== 1) {
      ctx.addIssue({ code: 'custom', path: ['count'], message: 'Sem repetição, é 1 lançamento' });
    }
    if (v.repeat !== 'none' && v.count < 2) {
      ctx.addIssue({ code: 'custom', path: ['count'], message: 'Ao menos 2' });
    }
    if (v.repeat === 'installments' && Math.round(v.amount * 100) < v.count) {
      ctx.addIssue({ code: 'custom', path: ['count'], message: 'Parcelas menores que um centavo' });
    }
  });
export type EntryInput = z.input<typeof entryInputSchema>;

export const entryUpdateSchema = z.object({
  description: text(120).min(2, 'Descreva o lançamento'),
  document: text(60),
  accountId: z.uuid({ message: 'Escolha a conta' }),
  categoryId: z.uuid({ message: 'Escolha a categoria' }),
  supplierId: z.uuid().nullable(),
  costCenterId: z.uuid().nullable(),
  amount: positiveMoney,
  dueDate: isoDate,
  competenceDate: isoDate,
  notes: text(500),
});
export type EntryUpdate = z.input<typeof entryUpdateSchema>;

export const payEntrySchema = z.object({
  paidOn: isoDate,
  accountId: z.uuid({ message: 'Escolha a conta' }),
  /** Valor efetivamente pago (com juros ou desconto). */
  amount: positiveMoney,
});
export type PayEntryInput = z.input<typeof payEntrySchema>;

export const cancelEntrySchema = z.object({
  reason: text(200).min(3, 'Explique o motivo em poucas palavras'),
  /** Cancela também as próximas parcelas em aberto da mesma série. */
  following: z.boolean().default(false),
});
export type CancelEntryInput = z.input<typeof cancelEntrySchema>;

export const transferInputSchema = z
  .object({
    fromAccountId: z.uuid({ message: 'Escolha a conta de origem' }),
    toAccountId: z.uuid({ message: 'Escolha a conta de destino' }),
    amount: positiveMoney,
    date: isoDate,
    description: text(120),
  })
  .refine((v) => v.fromAccountId !== v.toAccountId, {
    path: ['toAccountId'],
    message: 'Escolha uma conta diferente da origem',
  });
export type TransferInput = z.input<typeof transferInputSchema>;

export const entrySchema = z.object({
  id: z.string(),
  kind: z.enum(entryKinds),
  /** `in` soma na conta, `out` subtrai. */
  direction: z.enum(['in', 'out']),
  origin: z.enum(entryOrigins),
  status: z.enum(entryStatuses),
  description: z.string(),
  document: z.string(),
  account: ref,
  category: ref.nullable(),
  supplier: ref.nullable(),
  client: ref.nullable(),
  costCenter: ref.nullable(),
  sale: z.object({ id: z.string(), code: z.number().int() }).nullable(),
  /** Outra ponta da transferência. */
  counterpart: ref.nullable(),
  installment: z.object({ number: z.number().int(), total: z.number().int() }).nullable(),
  amount: z.number(),
  paidAmount: z.number().nullable(),
  dueDate: z.string(),
  competenceDate: z.string(),
  paidOn: z.string().nullable(),
  overdue: z.boolean(),
  notes: z.string(),
  cancelReason: z.string().nullable(),
  /** Saldo da conta depois deste lançamento (só na lista filtrada por uma conta). */
  runningBalance: z.number().nullable(),
});
export type Entry = z.infer<typeof entrySchema>;

export const entryQuerySchema = z.object({
  de: isoDate.optional(),
  ate: isoDate.optional(),
  conta: z.uuid().optional(),
  categoria: z.uuid().optional(),
  situacao: z.enum(['todos', 'abertos', 'pagos', 'vencidos', 'cancelados']).default('todos'),
  tipo: z.enum(['todos', 'receitas', 'despesas', 'transferencias']).default('todos'),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type EntryQuery = z.infer<typeof entryQuerySchema>;

export const entryListSchema = z.object({
  items: z.array(entrySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  /** Período usado; nulo nas listas de contas em aberto sem período, que mostram tudo. */
  from: z.string().nullable(),
  to: z.string().nullable(),
  /** Soma dos lançamentos filtrados, sem os cancelados. */
  totals: z.object({ income: z.number(), expense: z.number() }),
  /** Saldo da conta filtrada no início do período (só com uma conta). */
  openingBalance: z.number().nullable(),
  /** Em aberto, com os mesmos filtros de tipo, conta e categoria, sem o período. */
  pending: z.object({
    overdue: z.object({ count: z.number().int(), amount: z.number() }),
    next7: z.object({ count: z.number().int(), amount: z.number() }),
  }),
});
export type EntryList = z.infer<typeof entryListSchema>;

export const financeOptionsSchema = z.object({
  accounts: z.array(financialAccountSchema),
  categories: z.array(financialCategorySchema),
  suppliers: z.array(ref),
  costCenters: z.array(ref),
  today: z.string(),
});
export type FinanceOptions = z.infer<typeof financeOptionsSchema>;

// Conciliação de cartões ---------------------------------------------------------------------------

/**
 * Depósito esperado de uma adquirente [p.18, RN-37]: as parcelas de uma forma de recebimento que
 * vencem no mesmo dia na mesma conta. Conciliar confirma o que caiu e lança a diferença.
 */
export const cardDepositStatuses = ['expected', 'unreconciled', 'reconciled'] as const;
export type CardDepositStatus = (typeof cardDepositStatuses)[number];
export const cardDepositStatusLabels: Record<CardDepositStatus, string> = {
  expected: 'Previsto',
  unreconciled: 'Não conciliado',
  reconciled: 'Conciliado',
};

export const cardDepositSchema = z.object({
  /** Forma, data prevista e conta: identifica o depósito ainda não conciliado. */
  key: z.string(),
  paymentMethod: ref,
  account: ref,
  expectedDate: z.string(),
  status: z.enum(cardDepositStatuses),
  /** Parcelas de venda no depósito. */
  count: z.number().int(),
  gross: z.number(),
  fee: z.number(),
  expectedNet: z.number(),
  settlement: z
    .object({
      id: z.string(),
      depositDate: z.string(),
      receivedNet: z.number(),
      /** Recebido menos o líquido previsto: negativo é dinheiro a menos. */
      difference: z.number(),
      by: z.string(),
      at: z.string(),
    })
    .nullable(),
});
export type CardDeposit = z.infer<typeof cardDepositSchema>;

export const cardDepositQuerySchema = z.object({
  situacao: z
    .enum(['nao-conciliados', 'previstos', 'conciliados', 'todos'])
    .default('nao-conciliados'),
  forma: z.uuid().optional(),
  de: isoDate.optional(),
  ate: isoDate.optional(),
});
export type CardDepositQuery = z.infer<typeof cardDepositQuerySchema>;

const countAmount = z.object({ count: z.number().int(), amount: z.number() });
export const cardDepositListSchema = z.object({
  items: z.array(cardDepositSchema),
  /** Contadores do topo, com os filtros de forma e período. */
  counts: z.object({
    unreconciled: countAmount,
    expected: countAmount,
    reconciled: countAmount,
    difference: z.number(),
  }),
  today: z.string(),
});
export type CardDepositList = z.infer<typeof cardDepositListSchema>;

export const reconcileInputSchema = z.object({
  paymentMethodId: z.uuid(),
  accountId: z.uuid(),
  expectedDate: isoDate,
  depositDate: isoDate,
  /** Valor que caiu na conta. */
  receivedNet: positiveMoney,
});
export type ReconcileInput = z.input<typeof reconcileInputSchema>;
