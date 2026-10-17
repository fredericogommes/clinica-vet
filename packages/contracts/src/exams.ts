import { z } from 'zod';

/**
 * Exames [RN-33, p.13–14]: cada exame tem atributos tipados e ordenados, agrupados por seção, e
 * uma tabela de referência por espécie × faixa etária em meses. O resultado fora da faixa é
 * marcado no servidor, com a faixa copiada no resultado.
 */
export const examDataTypes = ['decimal', 'integer', 'text'] as const;
export type ExamDataType = (typeof examDataTypes)[number];
export const examDataTypeLabels: Record<ExamDataType, string> = {
  decimal: 'Decimal',
  integer: 'Inteiro',
  text: 'Texto',
};

/** Maior idade aceita na faixa de referência ("Adulto" vai até 9999 meses, como no original). */
export const EXAM_MAX_MONTHS = 9999;
/** Casas decimais aceitas num atributo decimal. */
export const EXAM_MAX_DECIMALS = 4;
/** Valor numérico cabe em numeric(14,4). */
const EXAM_MAX_ABS = 9_999_999_999;

const name = (max: number) =>
  z.string().trim().min(1, 'Informe o nome').max(max, `Máximo de ${max} caracteres`);

/** Linha da lista de atributos: título de seção ou campo de resultado. */
export const examAttributeInputSchema = z
  .object({
    /** Ausente em atributo novo. */
    id: z.uuid().nullable(),
    kind: z.enum(['section', 'field']),
    name: name(80),
    unit: z.string().trim().max(20, 'Máximo de 20 caracteres').default(''),
    dataType: z.enum(examDataTypes).nullable(),
    /** Casas decimais do tipo decimal. */
    decimals: z.number().int().min(0).max(EXAM_MAX_DECIMALS).nullable(),
    /** Tamanho máximo do tipo texto. */
    maxLength: z.number().int().min(1).max(200).nullable(),
  })
  .superRefine((a, ctx) => {
    if (a.kind === 'section') return;
    if (!a.dataType) {
      ctx.addIssue({ code: 'custom', path: ['dataType'], message: 'Escolha o tipo do campo' });
    } else if (a.dataType === 'decimal' && a.decimals === null) {
      ctx.addIssue({ code: 'custom', path: ['decimals'], message: 'Informe as casas decimais' });
    } else if (a.dataType === 'text' && a.maxLength === null) {
      ctx.addIssue({ code: 'custom', path: ['maxLength'], message: 'Informe o tamanho máximo' });
    }
  });
export type ExamAttributeInput = z.input<typeof examAttributeInputSchema>;

export const examInputSchema = z
  .object({
    name: name(80),
    /** Serviço lançado na venda aberta do animal quando o resultado é registrado [RN-19]. */
    serviceId: z.uuid().nullable(),
    attributes: z.array(examAttributeInputSchema).max(120, 'Máximo de 120 linhas'),
    archived: z.boolean().default(false),
  })
  .superRefine((e, ctx) => {
    if (!e.attributes.some((a) => a.kind === 'field')) {
      ctx.addIssue({ code: 'custom', path: ['attributes'], message: 'Inclua ao menos um campo' });
    }
    const seen = new Set<string>();
    e.attributes.forEach((a, i) => {
      if (a.kind !== 'field') return;
      const key = a.name.toLocaleLowerCase('pt-BR');
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['attributes', i, 'name'],
          message: 'Campo repetido',
        });
      }
      seen.add(key);
    });
  });
export type ExamInput = z.input<typeof examInputSchema>;

export const examAttributeSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['section', 'field']),
  name: z.string(),
  unit: z.string(),
  dataType: z.enum(examDataTypes).nullable(),
  decimals: z.number().int().nullable(),
  maxLength: z.number().int().nullable(),
});
export type ExamAttribute = z.infer<typeof examAttributeSchema>;

const ref = z.object({ id: z.uuid(), name: z.string() });

export const examListItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  service: ref.nullable(),
  fieldCount: z.number().int(),
  referenceCount: z.number().int(),
  archived: z.boolean(),
});
export type ExamListItem = z.infer<typeof examListItemSchema>;

/** Faixa normal de um campo numérico; um dos lados pode faltar ("até 5", "acima de 2"). */
export const examRangeSchema = z
  .object({
    attributeId: z.uuid(),
    low: z.number().min(-EXAM_MAX_ABS).max(EXAM_MAX_ABS).nullable(),
    high: z.number().min(-EXAM_MAX_ABS).max(EXAM_MAX_ABS).nullable(),
  })
  .superRefine((r, ctx) => {
    if (r.low === null && r.high === null) {
      ctx.addIssue({ code: 'custom', path: ['low'], message: 'Informe o mínimo ou o máximo' });
    } else if (r.low !== null && r.high !== null && r.low > r.high) {
      ctx.addIssue({ code: 'custom', path: ['high'], message: 'O máximo é menor que o mínimo' });
    }
  });
export type ExamRange = z.infer<typeof examRangeSchema>;

/** Faixa etária de uma espécie, com idade em meses completos (inclusiva nas duas pontas). */
export const examReferenceInputSchema = z
  .object({
    speciesId: z.uuid({ message: 'Escolha a espécie' }),
    label: name(40),
    minMonths: z.number().int().min(0).max(EXAM_MAX_MONTHS),
    maxMonths: z.number().int().min(0).max(EXAM_MAX_MONTHS),
    ranges: z.array(examRangeSchema).max(120),
  })
  .superRefine((r, ctx) => {
    if (r.maxMonths < r.minMonths) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxMonths'],
        message: 'Idade final antes da inicial',
      });
    }
  });
export type ExamReferenceInput = z.input<typeof examReferenceInputSchema>;

/** Tabela de referência inteira do exame; faixas da mesma espécie não podem se sobrepor. */
export const examReferencesInputSchema = z
  .object({ references: z.array(examReferenceInputSchema).max(60) })
  .superRefine(({ references }, ctx) => {
    references.forEach((a, i) => {
      references.slice(0, i).forEach((b) => {
        if (
          a.speciesId === b.speciesId &&
          a.minMonths <= b.maxMonths &&
          b.minMonths <= a.maxMonths
        ) {
          ctx.addIssue({
            code: 'custom',
            path: ['references', i, 'minMonths'],
            message: `Sobrepõe a faixa "${b.label}" da mesma espécie`,
          });
        }
      });
    });
  });
export type ExamReferencesInput = z.input<typeof examReferencesInputSchema>;

export const examReferenceSchema = z.object({
  id: z.uuid(),
  species: ref,
  label: z.string(),
  minMonths: z.number().int(),
  maxMonths: z.number().int(),
  ranges: z.array(examRangeSchema),
});
export type ExamReference = z.infer<typeof examReferenceSchema>;

export const examSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  service: ref.nullable(),
  attributes: z.array(examAttributeSchema),
  references: z.array(examReferenceSchema),
  archived: z.boolean(),
});
export type Exam = z.infer<typeof examSchema>;

export const examFlags = ['low', 'normal', 'high'] as const;
export type ExamFlag = (typeof examFlags)[number];
export const examFlagLabels: Record<ExamFlag, string> = {
  low: 'Abaixo',
  normal: 'Normal',
  high: 'Acima',
};

/** Marca o resultado contra a faixa; sem faixa, não marca. */
export function examFlag(value: number, low: number | null, high: number | null): ExamFlag | null {
  if (low === null && high === null) return null;
  if (low !== null && value < low) return 'low';
  if (high !== null && value > high) return 'high';
  return 'normal';
}

/** Texto digitado ("12,5") convertido pelo tipo do campo; a mesma regra no formulário e na API. */
export function parseExamValue(
  attribute: Pick<ExamAttribute, 'dataType' | 'decimals' | 'maxLength'>,
  raw: string,
): { ok: true; value: number | string } | { ok: false; message: string } {
  const text = raw.trim();
  if (attribute.dataType === 'text') {
    const max = attribute.maxLength ?? 200;
    return text.length > max
      ? { ok: false, message: `Máximo de ${String(max)} caracteres` }
      : { ok: true, value: text };
  }
  const normalized = text.replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return { ok: false, message: 'Informe um número' };
  const decimals = attribute.dataType === 'integer' ? 0 : (attribute.decimals ?? 0);
  const places = normalized.split('.')[1]?.length ?? 0;
  if (places > decimals) {
    return {
      ok: false,
      message: decimals === 0 ? 'Use um número inteiro' : `Até ${String(decimals)} casas decimais`,
    };
  }
  const value = Number(normalized);
  if (Math.abs(value) > EXAM_MAX_ABS) return { ok: false, message: 'Número grande demais' };
  return { ok: true, value };
}

/** Formulário de resultado: o exame e a faixa que vale para o animal na data. */
export const examFormSchema = z.object({
  exam: examSchema.omit({ references: true }),
  reference: z
    .object({ label: z.string(), species: z.string(), ranges: z.array(examRangeSchema) })
    .nullable(),
  /** Por que não há referência, quando não há. */
  referenceNote: z.string().nullable(),
});
export type ExamForm = z.infer<typeof examFormSchema>;

/** Valor de um campo no resultado, com o que valia no cadastro e na referência ao registrar. */
export const examResultValueSchema = z.object({
  attributeId: z.uuid(),
  section: z.string().nullable(),
  name: z.string(),
  unit: z.string(),
  dataType: z.enum(examDataTypes),
  value: z.union([z.number(), z.string()]),
  low: z.number().nullable(),
  high: z.number().nullable(),
  flag: z.enum(examFlags).nullable(),
});
export type ExamResultValue = z.infer<typeof examResultValueSchema>;

/** Evolução de um campo no animal [p.14]: os resultados numéricos ao longo do tempo. */
export const examSeriesQuerySchema = z.object({ attributeId: z.uuid() });
export const examSeriesSchema = z.object({
  exam: z.string(),
  name: z.string(),
  unit: z.string(),
  points: z.array(
    z.object({
      eventId: z.uuid(),
      occurredAt: z.string(),
      value: z.number(),
      low: z.number().nullable(),
      high: z.number().nullable(),
      flag: z.enum(examFlags).nullable(),
    }),
  ),
});
export type ExamSeries = z.infer<typeof examSeriesSchema>;
