import type {
  AdmitInput,
  Box,
  BoxInput,
  ClinicalParameters,
  Hospitalization,
  HospitalizationDetail,
  HospitalizationEntryInput,
  HospitalizationList,
  HospitalizationListQuery,
  HospitalizationOptions,
  UpdateHospitalizationInput,
} from '@clinica/contracts';
import {
  boxKinds,
  boxInputSchema,
  hospitalizationEntryInputSchema,
  hospitalizationEntryKinds,
  hospitalizationPriorities,
  hospitalizationPriorityLabels,
  hospitalizationStatuses,
} from '@clinica/contracts';
import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { actorOf } from '../../core/actor.js';
import { recordAudit } from '../../core/audit.js';
import { nextCounter } from '../../core/counters.js';
import { AppError, conflict, notFound } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import { containsText } from '../../core/search.js';
import { instantToZoned } from '../../core/zoned-time.js';
import type { Database, Executor } from '../../db/client.js';
import { isUniqueViolation, violatedConstraint } from '../../db/errors.js';
import {
  boxSpecies,
  boxes,
  clinicalEvents,
  clinicalVitals,
  hospitalizationEntries,
  hospitalizations,
  patients,
  species,
  users,
} from '../../db/schema.js';
import type { AuthContext } from '../auth/sessions.js';
import { unitTimeZone } from '../scheduling/availability.js';

type Row = Record<string, unknown>;
type HospitalizationRow = typeof hospitalizations.$inferSelect;
type EntryKind = (typeof hospitalizationEntryKinds)[number];

const invalid = (path: string, message: string) =>
  new AppError('validation_failed', 'Dados da internação inválidos.', [{ path, message }]);

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown) => new Date(String(v)).toISOString();
const brDate = (d: string | null) => (d ? d.split('-').reverse().join('/') : 'sem previsão');

const pick = <T extends string>(list: readonly T[], v: unknown, fallback: T): T =>
  list.find((x) => x === v) ?? fallback;

/** Internações com animal, responsável, veterinário, box e o último peso do prontuário. */
const baseSelect = sql`select h.*, p.code as patient_code, p.name as patient_name,
    p.sex as patient_sex, p.birth_date as patient_birth_date,
    sp.name as species_name, br.name as breed_name,
    c.code as client_code, c.name as client_name,
    (select cc.value from client_contacts cc where cc.client_id = c.id and cc.kind <> 'email'
      order by cc.position limit 1) as client_phone,
    v.name as vet_name, b.name as box_name, b.code as box_code, u.name as unit_name,
    (select cv.weight_kg from clinical_vitals cv join clinical_events e on e.id = cv.event_id
      where e.patient_id = p.id and e.status = 'published' and cv.weight_kg is not null
      order by e.occurred_at desc, e.id desc limit 1) as weight_kg
  from hospitalizations h
  join patients p on p.id = h.patient_id
  left join species sp on sp.id = p.species_id
  left join breeds br on br.id = p.breed_id
  join clients c on c.id = h.client_id
  join users v on v.id = h.veterinarian_id
  join units u on u.id = h.unit_id
  left join boxes b on b.id = h.box_id`;

function toHospitalization(r: Row): Hospitalization {
  return {
    id: String(r.id),
    code: Number(r.code),
    status: pick(hospitalizationStatuses, r.status, 'admitted'),
    priority: pick(hospitalizationPriorities, r.priority, 'routine'),
    reason: String(r.reason),
    admittedAt: iso(r.admitted_at),
    endedAt: r.ended_at ? iso(r.ended_at) : null,
    expectedDischargeOn: str(r.expected_discharge_on),
    patient: {
      id: String(r.patient_id),
      code: Number(r.patient_code),
      name: String(r.patient_name),
      species: str(r.species_name),
      breed: str(r.breed_name),
      sex: pick(['female', 'male', 'unknown'] as const, r.patient_sex, 'unknown'),
      birthDate: str(r.patient_birth_date),
      weightKg: num(r.weight_kg),
    },
    client: {
      id: String(r.client_id),
      code: Number(r.client_code),
      name: String(r.client_name),
      phone: str(r.client_phone),
    },
    veterinarian: { id: String(r.veterinarian_id), name: String(r.vet_name) },
    box:
      typeof r.box_id === 'string'
        ? { id: r.box_id, name: String(r.box_name), code: String(r.box_code) }
        : null,
    unit: { id: String(r.unit_id), name: String(r.unit_name) },
  };
}

const parametersOf = (e: typeof hospitalizationEntries.$inferSelect): ClinicalParameters => ({
  appetite: e.appetite,
  behavior: e.behavior,
  feces: e.feces,
  urine: e.urine,
  vomit: e.vomit,
  temperature: e.temperature,
  heartRate: e.heartRate,
  respiratoryRate: e.respiratoryRate,
  systolicPressure: e.systolicPressure,
  glucose: e.glucose,
  dehydration: e.dehydration,
});

/**
 * Internação [p.14–16, RN-40/41]: boxes da unidade, abertura, edição, troca de box, alta, óbito e
 * cancelamento, com o histórico de ocorrências, peso, parâmetros clínicos e relatório médico.
 */
export class HospitalizationService {
  constructor(private readonly db: Database) {}

  // ---------------------------------------------------------------- boxes

  async listBoxes(auth: AuthContext, executor?: Executor): Promise<Box[]> {
    const db = executor ?? this.db;
    const rows = await db
      .select({
        b: boxes,
        occupied: sql<number>`(select count(*) from hospitalizations h
          where h.box_id = boxes.id and h.status = 'admitted')::int`,
      })
      .from(boxes)
      .where(eq(boxes.unitId, auth.unitId))
      .orderBy(asc(sql`upper(${boxes.code})`));
    const accepted = rows.length
      ? await db
          .select({ boxId: boxSpecies.boxId, id: species.id, name: species.name })
          .from(boxSpecies)
          .innerJoin(species, eq(species.id, boxSpecies.speciesId))
          .where(
            inArray(
              boxSpecies.boxId,
              rows.map((r) => r.b.id),
            ),
          )
          .orderBy(asc(sql`lower(${species.name})`))
      : [];
    return rows.map(({ b, occupied }) => ({
      id: b.id,
      name: b.name,
      code: b.code,
      kind: pick(boxKinds, b.kind, 'general'),
      capacity: b.capacity,
      species: accepted.filter((s) => s.boxId === b.id).map(({ id, name }) => ({ id, name })),
      archived: b.archivedAt !== null,
      occupied,
    }));
  }

  async saveBox(auth: AuthContext, id: string | null, raw: BoxInput): Promise<Box> {
    const input = boxInputSchema.parse(raw);
    try {
      return await this.db.transaction(async (tx) => {
        const before = id ? (await this.listBoxes(auth, tx)).find((b) => b.id === id) : null;
        if (id && !before) throw notFound('Box');
        if (input.speciesIds.length) {
          const found = await tx
            .select({ id: species.id })
            .from(species)
            .where(
              and(
                inArray(species.id, input.speciesIds),
                eq(species.organizationId, auth.organizationId),
              ),
            );
          if (found.length !== new Set(input.speciesIds).size) {
            throw new AppError('validation_failed', 'Dados do box inválidos.', [
              { path: 'speciesIds', message: 'Espécie inválida' },
            ]);
          }
        }
        if (before && input.capacity < before.occupied) {
          throw new AppError('validation_failed', 'Dados do box inválidos.', [
            {
              path: 'capacity',
              message: `O box tem ${String(before.occupied)} animais internados agora`,
            },
          ]);
        }
        if (before && input.archived && before.occupied > 0) {
          throw conflict('Há animais internados neste box. Troque-os de box antes de arquivar.');
        }
        const values = {
          name: input.name,
          code: input.code.toUpperCase(),
          kind: input.kind,
          capacity: input.capacity,
          archivedAt: input.archived ? (before?.archived ? undefined : new Date()) : null,
          updatedAt: new Date(),
        };
        const boxId = id ?? newId();
        if (id) {
          await tx.update(boxes).set(values).where(eq(boxes.id, id));
        } else {
          await tx.insert(boxes).values({
            id: boxId,
            organizationId: auth.organizationId,
            unitId: auth.unitId,
            ...values,
            archivedAt: values.archivedAt ?? null,
          });
        }
        await tx.delete(boxSpecies).where(eq(boxSpecies.boxId, boxId));
        if (input.speciesIds.length) {
          await tx
            .insert(boxSpecies)
            .values([...new Set(input.speciesIds)].map((speciesId) => ({ boxId, speciesId })));
        }
        const after = (await this.listBoxes(auth, tx)).find((b) => b.id === boxId);
        if (!after) throw notFound('Box');
        const snapshot = ({ id: _id, occupied: _o, ...rest }: Box) => ({
          ...rest,
          species: rest.species.map((s) => s.name),
        });
        await recordAudit(tx, actorOf(auth), {
          entity: 'box',
          entityId: boxId,
          action: id ? 'update' : 'create',
          before: before ? snapshot(before) : undefined,
          after: snapshot(after),
        });
        return after;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const constraint = violatedConstraint(error);
        throw new AppError('validation_failed', 'Dados do box inválidos.', [
          constraint === 'boxes_unit_code_uq'
            ? { path: 'code', message: 'Já existe um box com esta sigla na unidade' }
            : { path: 'name', message: 'Já existe um box com este nome na unidade' },
        ]);
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------- consulta

  async options(auth: AuthContext): Promise<HospitalizationOptions> {
    const [veterinarians, unitBoxes] = await Promise.all([
      this.db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(and(eq(users.organizationId, auth.organizationId), eq(users.active, true)))
        .orderBy(asc(sql`lower(${users.name})`)),
      this.listBoxes(auth),
    ]);
    return { veterinarians, boxes: unitBoxes.filter((b) => !b.archived) };
  }

  /** Internados agora na unidade (painel) ou internações encerradas da clínica (histórico). */
  async list(auth: AuthContext, query: HospitalizationListQuery): Promise<HospitalizationList> {
    const filters: SQL[] = [sql`h.organization_id = ${auth.organizationId}`];
    if (query.scope === 'current') {
      filters.push(sql`h.status = 'admitted' and h.unit_id = ${auth.unitId}`);
    } else {
      filters.push(sql`h.status <> 'admitted'`);
      if (query.status) filters.push(sql`h.status = ${query.status}`);
    }
    if (query.q) {
      const digits = /^\d+$/.test(query.q) ? Number(query.q) : null;
      filters.push(
        sql`(${containsText(sql`p.name`, query.q)} or ${containsText(sql`c.name`, query.q)}
          or ${containsText(sql`coalesce(b.code, '')`, query.q)}${
            digits === null ? sql`` : sql` or h.code = ${digits} or p.code = ${digits}`
          })`,
      );
    }
    const where = sql.join(filters, sql` and `);
    // Painel: urgentes primeiro; histórico: as encerradas mais recentes primeiro.
    const order =
      query.scope === 'current'
        ? sql`case h.priority when 'urgent' then 0 when 'attention' then 1 else 2 end, h.admitted_at`
        : sql`h.ended_at desc`;
    const offset = (query.page - 1) * query.pageSize;
    const [rows, count] = await Promise.all([
      this.db.execute<Row>(sql`${baseSelect} where ${where} order by ${order}, h.id
        limit ${query.pageSize} offset ${offset}`),
      this.db.execute<Row>(sql`select count(*) as count from hospitalizations h
        join patients p on p.id = h.patient_id join clients c on c.id = h.client_id
        left join boxes b on b.id = h.box_id where ${where}`),
    ]);
    return {
      items: rows.rows.map(toHospitalization),
      total: Number(count.rows[0]?.count ?? 0),
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(auth: AuthContext, id: string, executor?: Executor): Promise<HospitalizationDetail> {
    const db = executor ?? this.db;
    const { rows } = await db.execute<Row>(
      sql`${baseSelect} where h.id = ${id} and h.organization_id = ${auth.organizationId}`,
    );
    const row = rows[0];
    if (!row) throw notFound('Internação');
    const entries = await db
      .select({ e: hospitalizationEntries, author: users.name })
      .from(hospitalizationEntries)
      .innerJoin(users, eq(users.id, hospitalizationEntries.authorId))
      .where(eq(hospitalizationEntries.hospitalizationId, id))
      .orderBy(asc(hospitalizationEntries.occurredAt), asc(hospitalizationEntries.id));
    return {
      ...toHospitalization(row),
      outcome: str(row.outcome_notes),
      entries: entries.map(({ e, author }) => ({
        id: e.id,
        kind: pick(hospitalizationEntryKinds, e.kind, 'occurrence'),
        occurredAt: e.occurredAt.toISOString(),
        author,
        text: e.text,
        weightKg: e.weightKg,
        parameters: e.kind === 'parameters' ? parametersOf(e) : null,
      })),
    };
  }

  /** Internação aberta do animal, para a ficha clínica mostrar e levar até ela. */
  async openFor(auth: AuthContext, patientId: string): Promise<{ id: string } | null> {
    const [row] = await this.db
      .select({ id: hospitalizations.id })
      .from(hospitalizations)
      .where(
        and(
          eq(hospitalizations.patientId, patientId),
          eq(hospitalizations.organizationId, auth.organizationId),
          eq(hospitalizations.status, 'admitted'),
        ),
      );
    return row ?? null;
  }

  // ---------------------------------------------------------------- escrita

  /** Interna um animal vivo e ativo, sem outra internação aberta, no box escolhido (se houver). */
  async admit(auth: AuthContext, input: AdmitInput): Promise<HospitalizationDetail> {
    try {
      return await this.db.transaction(async (tx) => {
        const [patient] = await tx
          .select()
          .from(patients)
          .where(
            and(eq(patients.id, input.patientId), eq(patients.organizationId, auth.organizationId)),
          );
        if (!patient) throw invalid('patientId', 'Escolha o animal');
        if (patient.status === 'deceased') throw invalid('patientId', 'Este animal veio a óbito');
        if (patient.archivedAt) throw invalid('patientId', 'Este animal está arquivado');
        await this.assertVeterinarian(tx, auth, input.veterinarianId);
        await this.assertDischargeDate(tx, auth, input.expectedDischargeOn, new Date());
        const boxId = input.boxId ?? null;
        if (boxId) await this.assertBox(tx, auth, boxId, patient.speciesId, null);
        const id = newId();
        const now = new Date();
        await tx.insert(hospitalizations).values({
          id,
          organizationId: auth.organizationId,
          unitId: auth.unitId,
          code: await nextCounter(tx, auth.organizationId, 'hospitalization'),
          patientId: patient.id,
          clientId: patient.clientId,
          veterinarianId: input.veterinarianId,
          priority: input.priority,
          status: 'admitted',
          reason: input.reason,
          admittedAt: now,
          expectedDischargeOn: input.expectedDischargeOn,
          boxId,
          createdBy: auth.userId,
          createdAt: now,
          updatedAt: now,
        });
        await this.entry(tx, auth, id, 'admission', input.reason, now);
        const after = await this.get(auth, id, tx);
        await recordAudit(tx, actorOf(auth), {
          entity: 'hospitalization',
          entityId: id,
          action: 'admit',
          after: this.snapshot(after),
        });
        return after;
      });
    } catch (error) {
      if (violatedConstraint(error) === 'hospitalizations_patient_open_uq') {
        throw conflict('Este animal já está internado.');
      }
      throw error;
    }
  }

  async update(
    auth: AuthContext,
    id: string,
    input: UpdateHospitalizationInput,
  ): Promise<HospitalizationDetail> {
    return this.db.transaction(async (tx) => {
      const current = await this.lockOpen(tx, auth, id);
      const before = await this.get(auth, id, tx);
      await this.assertVeterinarian(tx, auth, input.veterinarianId);
      await this.assertDischargeDate(tx, auth, input.expectedDischargeOn, current.admittedAt);
      await tx
        .update(hospitalizations)
        .set({
          veterinarianId: input.veterinarianId,
          priority: input.priority,
          reason: input.reason,
          expectedDischargeOn: input.expectedDischargeOn,
          updatedAt: new Date(),
        })
        .where(eq(hospitalizations.id, id));
      const after = await this.get(auth, id, tx);
      const changes: string[] = [];
      if (before.priority !== after.priority) {
        changes.push(
          `Prioridade: ${hospitalizationPriorityLabels[before.priority]} → ${hospitalizationPriorityLabels[after.priority]}`,
        );
      }
      if (before.veterinarian.id !== after.veterinarian.id) {
        changes.push(`Veterinário: ${before.veterinarian.name} → ${after.veterinarian.name}`);
      }
      if (before.expectedDischargeOn !== after.expectedDischargeOn) {
        changes.push(
          `Previsão de alta: ${brDate(before.expectedDischargeOn)} → ${brDate(after.expectedDischargeOn)}`,
        );
      }
      if (before.reason !== after.reason) changes.push(`Motivo: ${after.reason}`);
      if (changes.length === 0) return after;
      await this.entry(tx, auth, id, 'update', changes.join('\n'), new Date());
      await recordAudit(tx, actorOf(auth), {
        entity: 'hospitalization',
        entityId: id,
        action: 'update',
        before: this.snapshot(before),
        after: this.snapshot(after),
      });
      return this.get(auth, id, tx);
    });
  }

  async moveBox(
    auth: AuthContext,
    id: string,
    boxId: string | null,
  ): Promise<HospitalizationDetail> {
    return this.db.transaction(async (tx) => {
      const current = await this.lockOpen(tx, auth, id);
      if (current.boxId === boxId) return this.get(auth, id, tx);
      const before = await this.get(auth, id, tx);
      if (boxId) {
        const [patient] = await tx
          .select({ speciesId: patients.speciesId })
          .from(patients)
          .where(eq(patients.id, current.patientId));
        await this.assertBox(tx, auth, boxId, patient?.speciesId ?? null, id);
      }
      await tx
        .update(hospitalizations)
        .set({ boxId, updatedAt: new Date() })
        .where(eq(hospitalizations.id, id));
      const after = await this.get(auth, id, tx);
      const label = (b: HospitalizationDetail['box']) => (b ? `${b.code} (${b.name})` : 'sem box');
      await this.entry(
        tx,
        auth,
        id,
        'box',
        `${label(before.box)} → ${label(after.box)}`,
        new Date(),
      );
      await recordAudit(tx, actorOf(auth), {
        entity: 'hospitalization',
        entityId: id,
        action: 'move_box',
        before: { box: before.box?.code ?? null },
        after: { box: after.box?.code ?? null },
      });
      return this.get(auth, id, tx);
    });
  }

  /** Alta ou óbito. O óbito também marca o animal como falecido na data de hoje. */
  async close(
    auth: AuthContext,
    id: string,
    input: { outcome: 'discharged' | 'deceased'; notes: string },
  ): Promise<HospitalizationDetail> {
    return this.db.transaction(async (tx) => {
      const current = await this.lockOpen(tx, auth, id);
      const now = new Date();
      await tx
        .update(hospitalizations)
        .set({
          status: input.outcome,
          endedAt: now,
          endedBy: auth.userId,
          outcomeNotes: input.notes,
          updatedAt: now,
        })
        .where(eq(hospitalizations.id, id));
      await this.entry(
        tx,
        auth,
        id,
        input.outcome === 'deceased' ? 'death' : 'discharge',
        input.notes,
        now,
      );
      if (input.outcome === 'deceased') {
        const day = instantToZoned(now, await unitTimeZone(tx, auth.unitId)).date;
        await tx
          .update(patients)
          .set({ status: 'deceased', deceasedOn: day, updatedAt: now })
          .where(eq(patients.id, current.patientId));
        await recordAudit(tx, actorOf(auth), {
          entity: 'patient',
          entityId: current.patientId,
          action: 'update',
          before: { status: 'alive' },
          after: { status: 'deceased', deceasedOn: day, origin: 'internação' },
        });
      }
      const after = await this.get(auth, id, tx);
      await recordAudit(tx, actorOf(auth), {
        entity: 'hospitalization',
        entityId: id,
        action: input.outcome === 'deceased' ? 'death' : 'discharge',
        after: { ...this.snapshot(after), notes: input.notes },
      });
      return after;
    });
  }

  /** Cancela uma internação aberta por engano, com motivo; ela fica no histórico como cancelada. */
  async cancel(auth: AuthContext, id: string, reason: string): Promise<HospitalizationDetail> {
    return this.db.transaction(async (tx) => {
      await this.lockOpen(tx, auth, id);
      const now = new Date();
      await tx
        .update(hospitalizations)
        .set({
          status: 'cancelled',
          endedAt: now,
          endedBy: auth.userId,
          outcomeNotes: reason,
          updatedAt: now,
        })
        .where(eq(hospitalizations.id, id));
      await this.entry(tx, auth, id, 'cancel', reason, now);
      const after = await this.get(auth, id, tx);
      await recordAudit(tx, actorOf(auth), {
        entity: 'hospitalization',
        entityId: id,
        action: 'cancel',
        after: { ...this.snapshot(after), reason },
      });
      return after;
    });
  }

  /**
   * Registro no histórico: ocorrência, relatório médico, peso ou parâmetros clínicos. O peso vira
   * também um evento de peso publicado no prontuário, e passa a ser o peso atual do animal.
   */
  async addEntry(
    auth: AuthContext,
    id: string,
    raw: HospitalizationEntryInput,
  ): Promise<HospitalizationDetail> {
    const input = hospitalizationEntryInputSchema.parse(raw);
    return this.db.transaction(async (tx) => {
      const current = await this.lockOpen(tx, auth, id);
      const now = new Date();
      let clinicalEventId: string | null = null;
      if (input.kind === 'weight') {
        clinicalEventId = newId();
        await tx.insert(clinicalEvents).values({
          id: clinicalEventId,
          organizationId: auth.organizationId,
          unitId: auth.unitId,
          patientId: current.patientId,
          kind: 'weight',
          status: 'published',
          occurredAt: now,
          authorId: auth.userId,
          payload: { notes: input.text || 'Pesagem na internação' },
          publishedAt: now,
          updatedBy: auth.userId,
          createdAt: now,
          updatedAt: now,
        });
        await tx
          .insert(clinicalVitals)
          .values({ eventId: clinicalEventId, weightKg: input.weightKg });
      }
      const entryId = newId();
      await tx.insert(hospitalizationEntries).values({
        id: entryId,
        hospitalizationId: id,
        kind: input.kind,
        occurredAt: now,
        authorId: auth.userId,
        text: input.text,
        weightKg: input.kind === 'weight' ? input.weightKg : null,
        clinicalEventId,
        ...(input.kind === 'parameters' ? input.parameters : {}),
      });
      await recordAudit(tx, actorOf(auth), {
        entity: 'hospitalization',
        entityId: id,
        action: `entry_${input.kind}`,
        after: input,
      });
      return this.get(auth, id, tx);
    });
  }

  // ---------------------------------------------------------------- apoio

  private async entry(
    tx: Executor,
    auth: AuthContext,
    hospitalizationId: string,
    kind: EntryKind,
    text: string,
    occurredAt: Date,
  ): Promise<void> {
    await tx.insert(hospitalizationEntries).values({
      id: newId(),
      hospitalizationId,
      kind,
      occurredAt,
      authorId: auth.userId,
      text,
    });
  }

  private snapshot(h: Hospitalization) {
    return {
      code: h.code,
      patient: h.patient.name,
      status: h.status,
      priority: h.priority,
      veterinarian: h.veterinarian.name,
      box: h.box?.code ?? null,
      expectedDischargeOn: h.expectedDischargeOn,
      reason: h.reason,
    };
  }

  /** Trava a internação da organização; só a internação aberta muda. */
  private async lockOpen(tx: Executor, auth: AuthContext, id: string): Promise<HospitalizationRow> {
    const [row] = await tx
      .select()
      .from(hospitalizations)
      .where(
        and(eq(hospitalizations.id, id), eq(hospitalizations.organizationId, auth.organizationId)),
      )
      .for('update');
    if (!row) throw notFound('Internação');
    if (row.status !== 'admitted') throw conflict('Esta internação já foi encerrada.');
    return row;
  }

  private async assertVeterinarian(tx: Executor, auth: AuthContext, userId: string) {
    const [vet] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, userId),
          eq(users.organizationId, auth.organizationId),
          eq(users.active, true),
        ),
      );
    if (!vet) throw invalid('veterinarianId', 'Escolha um veterinário ativo');
  }

  private async assertDischargeDate(
    tx: Executor,
    auth: AuthContext,
    on: string | null,
    admittedAt: Date,
  ) {
    if (!on) return;
    const admittedOn = instantToZoned(admittedAt, await unitTimeZone(tx, auth.unitId)).date;
    if (on < admittedOn) {
      throw invalid('expectedDischargeOn', 'A previsão de alta não pode ser antes da internação');
    }
  }

  /**
   * Box da unidade, ativo, que aceita a espécie do animal e com vaga. A trava no box impede que
   * duas internações simultâneas ocupem a última vaga.
   */
  private async assertBox(
    tx: Executor,
    auth: AuthContext,
    boxId: string,
    speciesId: string | null,
    hospitalizationId: string | null,
  ) {
    const [box] = await tx
      .select()
      .from(boxes)
      .where(and(eq(boxes.id, boxId), eq(boxes.unitId, auth.unitId), isNull(boxes.archivedAt)))
      .for('update');
    if (!box) throw invalid('boxId', 'Escolha um box ativo desta unidade');
    const accepted = await tx
      .select({ speciesId: boxSpecies.speciesId })
      .from(boxSpecies)
      .where(eq(boxSpecies.boxId, boxId));
    if (accepted.length && !accepted.some((s) => s.speciesId === speciesId)) {
      throw invalid('boxId', `O box ${box.code} não aceita a espécie deste animal`);
    }
    const { rows } = await tx.execute<Row>(sql`select count(*) as n from hospitalizations
      where box_id = ${boxId} and status = 'admitted'
      ${hospitalizationId ? sql`and id <> ${hospitalizationId}` : sql``}`);
    if (Number(rows[0]?.n ?? 0) >= box.capacity) {
      throw invalid('boxId', `O box ${box.code} está lotado`);
    }
  }
}
