import {
  examFlag,
  parseExamValue,
  type Exam,
  type ExamAttribute,
  type ExamForm,
  type ExamListItem,
  type ExamResultValue,
  type ExamSeries,
  type examInputSchema,
  type examReferencesInputSchema,
} from '@clinica/contracts';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { actorOf } from '../../core/actor.js';
import { recordAudit } from '../../core/audit.js';
import { AppError, conflict, notFound } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import type { Database, Executor } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import {
  clinicalEvents,
  clinicalExamValues,
  examAttributes,
  examReferenceRanges,
  examReferences,
  exams,
  products,
  species,
} from '../../db/schema.js';
import type { AuthContext } from '../auth/sessions.js';

type ExamInput = z.output<typeof examInputSchema>;
type ReferencesInput = z.output<typeof examReferencesInputSchema>;
type AttributeRow = typeof examAttributes.$inferSelect;

const invalid = (path: string, message: string) =>
  new AppError('validation_failed', 'Dados inválidos.', [{ path, message }]);

const isNumeric = (a: Pick<AttributeRow, 'kind' | 'dataType'>) =>
  a.kind === 'field' && (a.dataType === 'decimal' || a.dataType === 'integer');

function toAttribute(a: AttributeRow): ExamAttribute {
  return {
    id: a.id,
    kind: a.kind,
    name: a.name,
    unit: a.unit,
    dataType: a.dataType,
    decimals: a.decimals,
    maxLength: a.maxLength,
  };
}

/** Idade em meses completos na data (AAAA-MM-DD), como na tabela de referência. */
export function ageInMonths(birthDate: string, on: string): number {
  const [y1, m1, d1] = birthDate.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = on.split('-').map(Number) as [number, number, number];
  return (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
}

/** O animal do resultado: espécie e nascimento escolhem a faixa de referência. */
export interface ExamPatient {
  speciesId: string | null;
  speciesName: string | null;
  birthDate: string | null;
}

interface AppliedReference {
  label: string;
  species: string;
  ranges: Map<string, { low: number | null; high: number | null }>;
}

/** Catálogo de exames [RN-33]: atributos tipados por seção e referência por espécie × idade. */
export class ExamService {
  constructor(private readonly db: Database) {}

  async list(auth: AuthContext): Promise<ExamListItem[]> {
    const rows = await this.db
      .select({
        id: exams.id,
        name: exams.name,
        serviceId: exams.serviceId,
        serviceName: products.name,
        archivedAt: exams.archivedAt,
        fieldCount: sql<number>`(select count(*)::int from exam_attributes a
          where a.exam_id = ${exams.id} and a.kind = 'field' and a.archived_at is null)`,
        referenceCount: sql<number>`(select count(*)::int from exam_references r
          where r.exam_id = ${exams.id})`,
      })
      .from(exams)
      .leftJoin(products, eq(products.id, exams.serviceId))
      .where(eq(exams.organizationId, auth.organizationId))
      .orderBy(asc(exams.name));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      service: r.serviceId && r.serviceName ? { id: r.serviceId, name: r.serviceName } : null,
      fieldCount: r.fieldCount,
      referenceCount: r.referenceCount,
      archived: r.archivedAt !== null,
    }));
  }

  async get(auth: AuthContext, id: string, db: Executor = this.db): Promise<Exam> {
    const [row] = await db
      .select({ e: exams, serviceName: products.name })
      .from(exams)
      .leftJoin(products, eq(products.id, exams.serviceId))
      .where(and(eq(exams.id, id), eq(exams.organizationId, auth.organizationId)));
    if (!row) throw notFound('Exame');
    const attributes = await this.activeAttributes(db, id);
    const refs = await db
      .select({ r: examReferences, speciesName: species.name })
      .from(examReferences)
      .innerJoin(species, eq(species.id, examReferences.speciesId))
      .where(eq(examReferences.examId, id))
      .orderBy(asc(species.name), asc(examReferences.minMonths));
    const ranges = refs.length
      ? await db
          .select()
          .from(examReferenceRanges)
          .where(
            inArray(
              examReferenceRanges.referenceId,
              refs.map((r) => r.r.id),
            ),
          )
      : [];
    const order = new Map(attributes.map((a, i) => [a.id, i]));
    return {
      id: row.e.id,
      name: row.e.name,
      service:
        row.e.serviceId && row.serviceName ? { id: row.e.serviceId, name: row.serviceName } : null,
      attributes: attributes.map(toAttribute),
      references: refs.map(({ r, speciesName }) => ({
        id: r.id,
        species: { id: r.speciesId, name: speciesName },
        label: r.label,
        minMonths: r.minMonths,
        maxMonths: r.maxMonths,
        ranges: ranges
          .filter((x) => x.referenceId === r.id && order.has(x.attributeId))
          .sort((a, b) => (order.get(a.attributeId) ?? 0) - (order.get(b.attributeId) ?? 0))
          .map((x) => ({ attributeId: x.attributeId, low: x.low, high: x.high })),
      })),
      archived: row.e.archivedAt !== null,
    };
  }

  private activeAttributes(db: Executor, examId: string): Promise<AttributeRow[]> {
    return db
      .select()
      .from(examAttributes)
      .where(and(eq(examAttributes.examId, examId), isNull(examAttributes.archivedAt)))
      .orderBy(asc(examAttributes.position));
  }

  /**
   * Cria ou corrige o exame com a lista inteira de atributos, na ordem. Campo retirado que já
   * tem resultado é arquivado (o histórico continua apontando para ele); sem resultado, sai.
   */
  async save(auth: AuthContext, id: string | null, input: ExamInput): Promise<Exam> {
    return this.write(async (tx) => {
      const [current] = id
        ? await tx
            .select()
            .from(exams)
            .where(and(eq(exams.id, id), eq(exams.organizationId, auth.organizationId)))
            .for('update')
        : [];
      if (id && !current) throw notFound('Exame');
      const before = current ? await this.get(auth, current.id, tx) : null;
      await this.assertService(tx, auth, input.serviceId, current?.serviceId ?? null);
      const examId = current?.id ?? newId();
      const values = {
        name: input.name,
        serviceId: input.serviceId,
        archivedAt: input.archived ? (current?.archivedAt ?? new Date()) : null,
      };
      if (current) {
        await tx
          .update(exams)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(exams.id, examId));
      } else {
        await tx
          .insert(exams)
          .values({ id: examId, organizationId: auth.organizationId, ...values });
      }
      await this.syncAttributes(tx, examId, input.attributes);
      const after = await this.get(auth, examId, tx);
      await recordAudit(tx, actorOf(auth), {
        entity: 'exam',
        entityId: examId,
        action: current ? 'update' : 'create',
        ...(before ? { before: examSnapshot(before) } : {}),
        after: examSnapshot(after),
      });
      return after;
    });
  }

  private async syncAttributes(tx: Executor, examId: string, input: ExamInput['attributes']) {
    const existing = await tx
      .select()
      .from(examAttributes)
      .where(eq(examAttributes.examId, examId));
    const known = new Map(existing.map((a) => [a.id, a]));
    input.forEach((a, i) => {
      if (a.id && !known.has(a.id))
        throw invalid(`attributes.${String(i)}.id`, 'Campo de outro exame');
    });
    const kept = new Set(input.map((a) => a.id).filter((x): x is string => x !== null));
    const removed = existing.filter((a) => !kept.has(a.id) && a.archivedAt === null);
    if (removed.length) {
      const usedRows: { id: string }[] = await tx
        .select({ id: clinicalExamValues.attributeId })
        .from(clinicalExamValues)
        .where(
          inArray(
            clinicalExamValues.attributeId,
            removed.map((a) => a.id),
          ),
        );
      const used = new Set(usedRows.map((r) => r.id));
      const archive = removed.filter((a) => used.has(a.id)).map((a) => a.id);
      const drop = removed.filter((a) => !used.has(a.id)).map((a) => a.id);
      if (archive.length) {
        await tx
          .update(examAttributes)
          .set({ archivedAt: new Date() })
          .where(inArray(examAttributes.id, archive));
        // Campo arquivado sai da referência.
        await tx
          .delete(examReferenceRanges)
          .where(inArray(examReferenceRanges.attributeId, archive));
      }
      if (drop.length) await tx.delete(examAttributes).where(inArray(examAttributes.id, drop));
    }
    for (const [position, a] of input.entries()) {
      const row = {
        position,
        kind: a.kind,
        name: a.name,
        unit: a.kind === 'section' ? '' : a.unit,
        dataType: a.kind === 'section' ? null : a.dataType,
        decimals: a.kind === 'field' && a.dataType === 'decimal' ? a.decimals : null,
        maxLength: a.kind === 'field' && a.dataType === 'text' ? a.maxLength : null,
        archivedAt: null,
      };
      if (a.id) {
        await tx.update(examAttributes).set(row).where(eq(examAttributes.id, a.id));
        // Campo que deixou de ser numérico não tem mais faixa.
        if (!isNumeric(row)) {
          await tx.delete(examReferenceRanges).where(eq(examReferenceRanges.attributeId, a.id));
        }
      } else {
        await tx.insert(examAttributes).values({ id: newId(), examId, ...row });
      }
    }
  }

  /** Substitui a tabela de referência do exame; só campos numéricos ativos têm faixa. */
  async saveReferences(auth: AuthContext, examId: string, input: ReferencesInput): Promise<Exam> {
    return this.write(async (tx) => {
      const [current] = await tx
        .select({ id: exams.id })
        .from(exams)
        .where(and(eq(exams.id, examId), eq(exams.organizationId, auth.organizationId)))
        .for('update');
      if (!current) throw notFound('Exame');
      const before = await this.get(auth, examId, tx);
      const numeric = new Set(
        (await this.activeAttributes(tx, examId)).filter(isNumeric).map((a) => a.id),
      );
      const speciesIds = [...new Set(input.references.map((r) => r.speciesId))];
      const found = speciesIds.length
        ? await tx
            .select({ id: species.id })
            .from(species)
            .where(
              and(inArray(species.id, speciesIds), eq(species.organizationId, auth.organizationId)),
            )
        : [];
      input.references.forEach((r, i) => {
        if (!found.some((f) => f.id === r.speciesId)) {
          throw invalid(`references.${String(i)}.speciesId`, 'Espécie inválida');
        }
        const seen = new Set<string>();
        r.ranges.forEach((range, j) => {
          if (!numeric.has(range.attributeId) || seen.has(range.attributeId)) {
            throw invalid(
              `references.${String(i)}.ranges.${String(j)}.attributeId`,
              'Faixa só para campo numérico do exame, uma por campo',
            );
          }
          seen.add(range.attributeId);
        });
      });
      await tx.delete(examReferences).where(eq(examReferences.examId, examId));
      for (const r of input.references) {
        const referenceId = newId();
        await tx.insert(examReferences).values({
          id: referenceId,
          examId,
          speciesId: r.speciesId,
          label: r.label,
          minMonths: r.minMonths,
          maxMonths: r.maxMonths,
        });
        if (r.ranges.length) {
          await tx
            .insert(examReferenceRanges)
            .values(r.ranges.map((range) => ({ referenceId, ...range })));
        }
      }
      await tx.update(exams).set({ updatedAt: new Date() }).where(eq(exams.id, examId));
      const after = await this.get(auth, examId, tx);
      await recordAudit(tx, actorOf(auth), {
        entity: 'exam',
        entityId: examId,
        action: 'update_references',
        before: referencesSnapshot(before),
        after: referencesSnapshot(after),
      });
      return after;
    });
  }

  /** A faixa que vale para o animal na data, ou o motivo de não haver. */
  private async applicable(
    db: Executor,
    examId: string,
    patient: ExamPatient,
    on: string,
  ): Promise<{ reference: AppliedReference | null; note: string | null }> {
    if (!patient.speciesId) {
      return { reference: null, note: 'O animal não tem espécie no cadastro.' };
    }
    if (!patient.birthDate) {
      return {
        reference: null,
        note: 'O animal não tem data de nascimento: a idade escolhe a faixa de referência.',
      };
    }
    const months = Math.max(0, ageInMonths(patient.birthDate, on));
    const [ref] = await db
      .select()
      .from(examReferences)
      .where(
        and(
          eq(examReferences.examId, examId),
          eq(examReferences.speciesId, patient.speciesId),
          sql`${examReferences.minMonths} <= ${months}`,
          sql`${examReferences.maxMonths} >= ${months}`,
        ),
      );
    if (!ref) {
      return {
        reference: null,
        note: `Sem faixa de referência para ${patient.speciesName ?? 'a espécie'} com ${String(months)} ${months === 1 ? 'mês' : 'meses'}.`,
      };
    }
    const ranges = await db
      .select()
      .from(examReferenceRanges)
      .where(eq(examReferenceRanges.referenceId, ref.id));
    return {
      reference: {
        label: ref.label,
        species: patient.speciesName ?? '',
        ranges: new Map(ranges.map((r) => [r.attributeId, { low: r.low, high: r.high }])),
      },
      note: null,
    };
  }

  /** Formulário de resultado: campos ativos do exame e a faixa do animal na data. */
  async form(
    auth: AuthContext,
    examId: string,
    patient: ExamPatient,
    on: string,
  ): Promise<ExamForm> {
    // Exame arquivado ainda abre o formulário para corrigir um resultado antigo; um resultado
    // novo é recusado em buildResult.
    const full = await this.get(auth, examId);
    const exam = {
      id: full.id,
      name: full.name,
      service: full.service,
      attributes: full.attributes,
      archived: full.archived,
    };
    const { reference, note } = await this.applicable(this.db, examId, patient, on);
    return {
      exam,
      reference: reference
        ? {
            label: reference.label,
            species: reference.species,
            ranges: [...reference.ranges].map(([attributeId, r]) => ({ attributeId, ...r })),
          }
        : null,
      referenceNote: note,
    };
  }

  /**
   * Converte e marca os valores digitados [RN-33]: tipo de cada campo, faixa do animal na data
   * copiada no resultado. Campo em branco fica de fora; campo arquivado só vale se já estava
   * no resultado que está sendo corrigido.
   */
  async buildResult(
    tx: Executor,
    auth: AuthContext,
    input: { examId: string; values: { attributeId: string; value: string }[] },
    patient: ExamPatient,
    on: string,
    previous: { examId: string; attributeIds: string[] } | null,
  ): Promise<{ referenceLabel: string | null; values: ExamResultValue[] }> {
    const [exam] = await tx
      .select({ archivedAt: exams.archivedAt })
      .from(exams)
      .where(and(eq(exams.id, input.examId), eq(exams.organizationId, auth.organizationId)));
    if (!exam || (exam.archivedAt && input.examId !== previous?.examId)) {
      throw invalid('examId', 'Exame inválido');
    }
    const all = await tx
      .select()
      .from(examAttributes)
      .where(eq(examAttributes.examId, input.examId))
      .orderBy(asc(examAttributes.position));
    const allowed = all.filter(
      (a) => a.archivedAt === null || (previous?.attributeIds.includes(a.id) ?? false),
    );
    const { reference } = await this.applicable(tx, input.examId, patient, on);
    const raw = new Map<string, string>();
    input.values.forEach((v, i) => {
      if (raw.has(v.attributeId)) throw invalid(`values.${String(i)}.value`, 'Campo repetido');
      raw.set(v.attributeId, v.value);
    });
    for (const [i, v] of input.values.entries()) {
      const attribute = allowed.find((a) => a.id === v.attributeId && a.kind === 'field');
      if (!attribute) throw invalid(`values.${String(i)}.value`, 'Campo não pertence ao exame');
    }
    const values: ExamResultValue[] = [];
    let section: string | null = null;
    for (const a of allowed) {
      if (a.kind === 'section') {
        section = a.name;
        continue;
      }
      const typed = raw.get(a.id)?.trim() ?? '';
      if (typed === '' || !a.dataType) continue;
      const parsed = parseExamValue(a, typed);
      if (!parsed.ok) {
        const index = input.values.findIndex((v) => v.attributeId === a.id);
        throw invalid(`values.${String(index)}.value`, parsed.message);
      }
      const range = reference?.ranges.get(a.id) ?? null;
      const numeric = typeof parsed.value === 'number';
      values.push({
        attributeId: a.id,
        section,
        name: a.name,
        unit: a.unit,
        dataType: a.dataType,
        value: parsed.value,
        low: numeric ? (range?.low ?? null) : null,
        high: numeric ? (range?.high ?? null) : null,
        flag: numeric && range ? examFlag(parsed.value as number, range.low, range.high) : null,
      });
    }
    return { referenceLabel: reference?.label ?? null, values };
  }

  /** Evolução de um campo numérico nos resultados publicados do animal [p.14]. */
  async series(auth: AuthContext, patientId: string, attributeId: string): Promise<ExamSeries> {
    const [attribute] = await this.db
      .select({ name: examAttributes.name, unit: examAttributes.unit, exam: exams.name })
      .from(examAttributes)
      .innerJoin(exams, eq(exams.id, examAttributes.examId))
      .where(
        and(eq(examAttributes.id, attributeId), eq(exams.organizationId, auth.organizationId)),
      );
    if (!attribute) throw notFound('Campo do exame');
    const rows = await this.db
      .select({
        eventId: clinicalEvents.id,
        occurredAt: clinicalEvents.occurredAt,
        value: clinicalExamValues.numericValue,
        low: clinicalExamValues.low,
        high: clinicalExamValues.high,
        flag: clinicalExamValues.flag,
      })
      .from(clinicalExamValues)
      .innerJoin(clinicalEvents, eq(clinicalEvents.id, clinicalExamValues.eventId))
      .where(
        and(
          eq(clinicalExamValues.attributeId, attributeId),
          eq(clinicalEvents.patientId, patientId),
          eq(clinicalEvents.organizationId, auth.organizationId),
          eq(clinicalEvents.status, 'published'),
          sql`${clinicalExamValues.numericValue} is not null`,
        ),
      )
      .orderBy(asc(clinicalEvents.occurredAt), asc(clinicalEvents.id));
    return {
      exam: attribute.exam,
      name: attribute.name,
      unit: attribute.unit,
      points: rows.map((r) => ({
        eventId: r.eventId,
        occurredAt: r.occurredAt.toISOString(),
        value: r.value ?? 0,
        low: r.low,
        high: r.high,
        flag: r.flag,
      })),
    };
  }

  private async assertService(
    tx: Executor,
    auth: AuthContext,
    serviceId: string | null,
    previous: string | null,
  ): Promise<void> {
    if (!serviceId) return;
    const [row] = await tx
      .select({ kind: products.kind, archivedAt: products.archivedAt })
      .from(products)
      .where(and(eq(products.id, serviceId), eq(products.organizationId, auth.organizationId)));
    if (!row || row.kind !== 'service' || (row.archivedAt && serviceId !== previous)) {
      throw invalid('serviceId', 'Escolha um serviço ativo');
    }
  }

  private async write<T>(work: (tx: Executor) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(work);
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('Já existe um exame com este nome.');
      throw error;
    }
  }
}

function examSnapshot(e: Exam) {
  return {
    name: e.name,
    service: e.service?.name ?? null,
    archived: e.archived,
    attributes: e.attributes.map((a) =>
      a.kind === 'section'
        ? `[${a.name}]`
        : `${a.name}${a.unit ? ` (${a.unit})` : ''}: ${a.dataType ?? ''}`,
    ),
  };
}

function referencesSnapshot(e: Exam) {
  const names = new Map(e.attributes.map((a) => [a.id, a.name]));
  return {
    references: e.references.map(
      (r) =>
        `${r.species.name} ${r.label} (${String(r.minMonths)}–${String(r.maxMonths)} meses): ${r.ranges
          .map(
            (x) =>
              `${names.get(x.attributeId) ?? '?'} ${String(x.low ?? '')}–${String(x.high ?? '')}`,
          )
          .join('; ')}`,
    ),
  };
}
