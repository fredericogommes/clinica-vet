import { z } from 'zod';

/**
 * Inteligência › Vendas [p.11–12]: indicadores de vendas, clientes e animais. O corte por animal
 * (espécie, raça, idade, peso, esterilização) e a receita por espécie são o que distingue o BI
 * veterinário do BI de varejo.
 */

/** Turnos da venda, pela hora no fuso da unidade [p.12]. */
export const saleShifts = ['morning', 'afternoon', 'night', 'dawn'] as const;
export type SaleShift = (typeof saleShifts)[number];
export const saleShiftLabels: Record<SaleShift, string> = {
  morning: 'Manhã (6h–12h)',
  afternoon: 'Tarde (12h–18h)',
  night: 'Noite (18h–0h)',
  dawn: 'Madrugada (0h–6h)',
};

export const weekdayLabels = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
] as const;

export const intelligenceTabs = ['sales', 'clients', 'patients'] as const;
export type IntelligenceTab = (typeof intelligenceTabs)[number];

/** Indicadores de cada aba, na ordem da tela; a chave é o que o usuário favorita. */
export const indicators = {
  'sales.evolution': 'Evolução das vendas',
  'sales.byDate': 'Vendas por data',
  'sales.topItems': 'Produtos e serviços mais vendidos',
  'sales.byGroup': 'Vendas por grupo',
  'sales.topBrands': 'Marcas mais vendidas',
  'sales.byWeekday': 'Vendas por dia da semana',
  'sales.topPackages': 'Pacotes mais vendidos',
  'sales.byShift': 'Vendas por turno',
  'sales.byKind': 'Tipo de item',
  'sales.bySpecies': 'Receita por espécie',
  'clients.newClients': 'Evolução de novos clientes',
  'clients.topClients': 'Clientes que mais compraram',
  'clients.attended': 'Clientes que compareceram',
  'clients.byOrigin': 'Clientes por origem',
  'clients.byRelationship': 'Clientes por tempo de relacionamento',
  'clients.byCity': 'Clientes por cidade',
  'clients.byDistrict': 'Clientes por bairro',
  'clients.bySex': 'Clientes por sexo',
  'clients.byProfession': 'Clientes por profissão',
  'clients.byPersonType': 'Clientes por tipo de pessoa',
  'patients.newPatients': 'Evolução de novos animais',
  'patients.bySpecies': 'Animais por espécie',
  'patients.byAge': 'Animais por faixa de idade',
  'patients.bySex': 'Animais por sexo',
  'patients.byBreed': 'Animais por raça',
  'patients.byWeight': 'Animais por faixa de peso',
  'patients.sterilization': 'Esterilização',
} as const;
export type IndicatorKey = keyof typeof indicators;
export const indicatorKeys = Object.keys(indicators) as IndicatorKey[];
export const indicatorTab = (key: IndicatorKey): IntelligenceTab =>
  key.split('.')[0] as IntelligenceTab;

const isoDate = z.iso.date({ message: 'Data inválida' });

export const intelligenceQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    /** Só vendas deste dia da semana (0 = domingo). */
    weekday: z.coerce.number().int().min(0).max(6).optional(),
    shift: z.enum(saleShifts).optional(),
  })
  .superRefine((q, ctx) => {
    if (q.to < q.from) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'A data final vem antes da inicial' });
    } else if ((Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 > 366) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'Consulte no máximo um ano por vez' });
    }
  });
export type IntelligenceQuery = z.output<typeof intelligenceQuerySchema>;

/**
 * Uma barra de ranking ou distribuição. Em vendas, `value` é o líquido e `count` a quantidade
 * (vendas ou itens, conforme o indicador); em clientes e animais, `value` é a contagem.
 */
export const rankEntrySchema = z.object({
  label: z.string(),
  value: z.number(),
  count: z.number(),
});
export type RankEntry = z.infer<typeof rankEntrySchema>;

/** Ponto de evolução: por dia até 62 dias de período, por mês acima disso. */
export const evolutionSchema = z.object({
  granularity: z.enum(['day', 'month']),
  points: z.array(
    z.object({
      /** AAAA-MM-DD no dia, AAAA-MM no mês. */
      period: z.string(),
      value: z.number(),
      count: z.number().int(),
    }),
  ),
});
export type Evolution = z.infer<typeof evolutionSchema>;

const rank = z.array(rankEntrySchema);

export const salesIntelligenceSchema = z.object({
  totals: z.object({
    count: z.number().int(),
    net: z.number(),
    averageTicket: z.number(),
  }),
  evolution: evolutionSchema,
  byDate: z.array(
    z.object({
      date: isoDate,
      count: z.number().int(),
      net: z.number(),
      averageTicket: z.number(),
    }),
  ),
  topItems: rank,
  byGroup: rank,
  topBrands: rank,
  byWeekday: rank,
  topPackages: rank,
  byShift: rank,
  byKind: rank,
  bySpecies: rank,
});
export type SalesIntelligence = z.infer<typeof salesIntelligenceSchema>;

export const clientsIntelligenceSchema = z.object({
  /** Clientes ativos cadastrados até o fim do período: a base das distribuições. */
  base: z.number().int(),
  newClients: evolutionSchema,
  topClients: rank,
  attended: rank,
  attendedCount: z.number().int(),
  byOrigin: rank,
  byRelationship: rank,
  byCity: rank,
  byDistrict: rank,
  bySex: rank,
  byProfession: rank,
  byPersonType: rank,
});
export type ClientsIntelligence = z.infer<typeof clientsIntelligenceSchema>;

export const patientsIntelligenceSchema = z.object({
  /** Animais vivos e ativos cadastrados até o fim do período. */
  base: z.number().int(),
  newPatients: evolutionSchema,
  bySpecies: rank,
  byAge: rank,
  bySex: rank,
  byBreed: rank,
  byWeight: rank,
  sterilization: rank,
});
export type PatientsIntelligence = z.infer<typeof patientsIntelligenceSchema>;

export const intelligenceFavoritesSchema = z.object({
  keys: z
    .array(z.enum(indicatorKeys as [IndicatorKey, ...IndicatorKey[]]))
    .max(indicatorKeys.length),
});
export type IntelligenceFavorites = z.infer<typeof intelligenceFavoritesSchema>;
