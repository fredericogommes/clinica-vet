import {
  doseLabel,
  nextDoseOn,
  protocolStatus,
  vaccinePeriodicity,
  type Protocol,
  type VaccinationDue,
  type VaccinationForm,
  type Vaccine,
  type VaccineKind,
  type vaccinationDueQuerySchema,
  type vaccineInputSchema,
} from '@clinica/contracts';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { actorOf } from '../../core/actor.js';
import { recordAudit } from '../../core/audit.js';
import { AppError, conflict, notFound } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import { addDays, instantToZoned } from '../../core/zoned-time.js';
import type { Database, Executor } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import { products, vaccineProtocolClosures, vaccines } from '../../db/schema.js';
import type { AuthContext } from '../auth/sessions.js';
import { unitTimeZone } from '../scheduling/availability.js';

type VaccineInput = z.output<typeof vaccineInputSchema>;
type DueQuery = z.output<typeof vaccinationDueQuerySchema>;

const invalid = (path: string, message: string) =>
  new AppError('validation_failed', 'Dados inválidos.', [{ path, message }]);

type VaccineRow = typeof vaccines.$inferSelect;

function toVaccine(row: VaccineRow, serviceName: string | null): Vaccine {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    primaryDoses: row.primaryDoses,
    primaryIntervalDays: row.primaryIntervalDays,
    boosterIntervalDays: row.boosterIntervalDays,
    service: row.serviceId && serviceName ? { id: row.serviceId, name: serviceName } : null,
    archived: row.archivedAt !== null,
  };
}

/** A aplicação calculada para o formulário e gravada no evento. */
export interface VaccinationDetails {
  vaccine: Vaccine;
  doseNumber: number;
  doseLabel: string;
}

/** Cadastro de vacinas e protocolos dos animais [RN-20]. */
export class VaccineService {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Hoje no fuso da unidade: a régua de vencida e a vencer. */
  async today(auth: AuthContext): Promise<string> {
    return instantToZoned(this.now(), await unitTimeZone(this.db, auth.unitId)).date;
  }

  async list(auth: AuthContext): Promise<Vaccine[]> {
    const rows = await this.db
      .select({ v: vaccines, serviceName: products.name })
      .from(vaccines)
      .leftJoin(products, eq(products.id, vaccines.serviceId))
      .where(eq(vaccines.organizationId, auth.organizationId))
      .orderBy(asc(vaccines.name));
    return rows.map((r) => toVaccine(r.v, r.serviceName));
  }

  async get(auth: AuthContext, id: string, db: Executor = this.db): Promise<Vaccine> {
    const [row] = await db
      .select({ v: vaccines, serviceName: products.name })
      .from(vaccines)
      .leftJoin(products, eq(products.id, vaccines.serviceId))
      .where(and(eq(vaccines.id, id), eq(vaccines.organizationId, auth.organizationId)));
    if (!row) throw notFound('Vacina');
    return toVaccine(row.v, row.serviceName);
  }

  async save(auth: AuthContext, id: string | null, input: VaccineInput): Promise<Vaccine> {
    try {
      return await this.db.transaction(async (tx) => {
        const before = id ? await this.get(auth, id, tx) : null;
        await this.assertService(tx, auth, input.serviceId, before?.service?.id ?? null);
        const values = {
          name: input.name,
          kind: input.kind,
          primaryDoses: input.primaryDoses,
          // Dose única não tem intervalo de série.
          primaryIntervalDays: input.primaryDoses > 1 ? input.primaryIntervalDays : null,
          boosterIntervalDays: input.boosterIntervalDays,
          serviceId: input.serviceId,
          updatedAt: new Date(),
        };
        const vaccineId = id ?? newId();
        if (before) {
          await tx
            .update(vaccines)
            .set({
              ...values,
              archivedAt: input.archived ? (before.archived ? undefined : new Date()) : null,
            })
            .where(eq(vaccines.id, vaccineId));
        } else {
          await tx.insert(vaccines).values({
            ...values,
            id: vaccineId,
            organizationId: auth.organizationId,
            archivedAt: input.archived ? new Date() : null,
          });
        }
        const after = await this.get(auth, vaccineId, tx);
        await recordAudit(tx, actorOf(auth), {
          entity: 'vaccine',
          entityId: vaccineId,
          action: before ? 'update' : 'create',
          ...(before ? { before: vaccineSnapshot(before) } : {}),
          after: vaccineSnapshot(after),
        });
        return after;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('Já existe uma vacina com este nome.');
      throw error;
    }
  }

  /**
   * Dose da aplicação: a seguinte às já publicadas do mesmo animal e vacina (o veterinário
   * pode corrigir, como num animal vacinado em outra clínica). Próxima pela série ou reforço.
   */
  async details(
    tx: Executor,
    auth: AuthContext,
    patientId: string,
    vaccineId: string,
    exceptEventId: string | null,
    allowArchived: boolean,
  ): Promise<VaccinationDetails> {
    const vaccine = await this.get(auth, vaccineId, tx).catch(() => null);
    if (!vaccine || (vaccine.archived && !allowArchived)) {
      throw invalid('vaccineId', 'Escolha uma vacina ativa');
    }
    const [row] = (
      await tx.execute<{ doses: number }>(sql`
        select count(*)::int as doses
        from clinical_vaccinations cv
        join clinical_events e on e.id = cv.event_id and e.status = 'published'
        where cv.patient_id = ${patientId} and cv.vaccine_id = ${vaccineId}
          and (${exceptEventId}::uuid is null or cv.event_id <> ${exceptEventId}::uuid)`)
    ).rows;
    const doseNumber = (row?.doses ?? 0) + 1;
    return { vaccine, doseNumber, doseLabel: doseLabel(doseNumber, vaccine.primaryDoses) };
  }

  /** Sugestão para o formulário de aplicação na data informada. */
  async form(
    auth: AuthContext,
    patientId: string,
    vaccineId: string,
    appliedOn: string,
  ): Promise<VaccinationForm> {
    const d = await this.details(this.db, auth, patientId, vaccineId, null, false);
    return {
      vaccine: d.vaccine,
      doseNumber: d.doseNumber,
      appliedOn,
      nextDueOn: nextDoseOn(d.vaccine, d.doseNumber, appliedOn),
    };
  }

  /** Protocolos do animal [p.5]: a última aplicação publicada de cada vacina. */
  async protocols(
    auth: AuthContext,
    patientId: string,
    today: string,
    db: Executor = this.db,
  ): Promise<Protocol[]> {
    const rows = (
      await db.execute<{
        vaccine_id: string;
        vaccine_name: string;
        kind: VaccineKind;
        primary_doses: number;
        primary_interval_days: number | null;
        booster_interval_days: number | null;
        event_id: string;
        occurred_at: Date | string;
        dose_label: string;
        next_due_on: string | null;
        doses: number;
        closed_at: Date | string | null;
        closed_reason: string | null;
        closed_by: string | null;
      }>(sql`
        select distinct on (cv.vaccine_id)
          cv.vaccine_id, v.name as vaccine_name, v.kind, v.primary_doses,
          v.primary_interval_days, v.booster_interval_days,
          cv.event_id, e.occurred_at, cv.dose_label, cv.next_due_on::text as next_due_on,
          count(*) over (partition by cv.vaccine_id)::int as doses,
          pc.closed_at, pc.reason as closed_reason, u.name as closed_by
        from clinical_vaccinations cv
        join clinical_events e on e.id = cv.event_id and e.status = 'published'
        join vaccines v on v.id = cv.vaccine_id
        left join vaccine_protocol_closures pc
          on pc.patient_id = cv.patient_id and pc.vaccine_id = cv.vaccine_id
        left join users u on u.id = pc.closed_by
        where cv.patient_id = ${patientId} and e.organization_id = ${auth.organizationId}
        order by cv.vaccine_id, e.occurred_at desc, e.id desc`)
    ).rows;
    const iso = (d: Date | string) => new Date(d).toISOString();
    return rows
      .map((r) => ({
        vaccine: {
          id: r.vaccine_id,
          name: r.vaccine_name,
          kind: r.kind,
          periodicity: vaccinePeriodicity({
            primaryDoses: r.primary_doses,
            primaryIntervalDays: r.primary_interval_days,
            boosterIntervalDays: r.booster_interval_days,
          }),
        },
        lastEventId: r.event_id,
        lastAppliedAt: iso(r.occurred_at),
        lastDose: r.dose_label,
        doses: r.doses,
        nextDueOn: r.next_due_on,
        status: protocolStatus(r.next_due_on, today, r.closed_at !== null),
        closure:
          r.closed_at !== null
            ? { at: iso(r.closed_at), by: r.closed_by ?? '', reason: r.closed_reason ?? '' }
            : null,
      }))
      .sort((a, b) => {
        // Abertos antes de encerrados; entre eles, a próxima dose mais cedo primeiro.
        if ((a.closure === null) !== (b.closure === null)) return a.closure ? 1 : -1;
        return (a.nextDueOn ?? '9999-12-31').localeCompare(b.nextDueOn ?? '9999-12-31');
      });
  }

  /** Encerra o protocolo; a próxima aplicação da mesma vacina o reabre. */
  async close(
    tx: Executor,
    auth: AuthContext,
    patientId: string,
    vaccineId: string,
    reason: string,
    at: Date,
  ): Promise<void> {
    await tx
      .insert(vaccineProtocolClosures)
      .values({ patientId, vaccineId, closedAt: at, closedBy: auth.userId, reason })
      .onConflictDoUpdate({
        target: [vaccineProtocolClosures.patientId, vaccineProtocolClosures.vaccineId],
        set: { closedAt: at, closedBy: auth.userId, reason },
      });
  }

  async reopen(tx: Executor, patientId: string, vaccineId: string): Promise<void> {
    await tx
      .delete(vaccineProtocolClosures)
      .where(
        and(
          eq(vaccineProtocolClosures.patientId, patientId),
          eq(vaccineProtocolClosures.vaccineId, vaccineId),
        ),
      );
  }

  /**
   * Consulta Vacinação [p.17]: protocolos abertos de animais vivos e ativos com próxima dose
   * vencida ou até a data pedida, com o contato do responsável para a busca ativa.
   */
  async due(auth: AuthContext, query: DueQuery, today: string): Promise<VaccinationDue> {
    const until = query.ate ?? addDays(today, 30);
    const base = sql`
      with latest as (
        select distinct on (cv.patient_id, cv.vaccine_id)
          cv.patient_id, cv.vaccine_id, cv.dose_label, cv.next_due_on, e.occurred_at
        from clinical_vaccinations cv
        join clinical_events e on e.id = cv.event_id and e.status = 'published'
        where e.organization_id = ${auth.organizationId}
        order by cv.patient_id, cv.vaccine_id, e.occurred_at desc, e.id desc
      )
      select l.*, p.code, p.name as patient_name, s.name as species_name,
        c.id as client_id, c.name as client_name, v.name as vaccine_name, v.kind,
        (select cc.value from client_contacts cc
          where cc.client_id = c.id and cc.kind in ('mobile', 'phone')
          order by cc.is_whatsapp desc, cc.position limit 1) as phone,
        coalesce((select cc.is_whatsapp from client_contacts cc
          where cc.client_id = c.id and cc.kind in ('mobile', 'phone')
          order by cc.is_whatsapp desc, cc.position limit 1), false) as whatsapp
      from latest l
      join patients p on p.id = l.patient_id
      join clients c on c.id = p.client_id
      join vaccines v on v.id = l.vaccine_id
      left join species s on s.id = p.species_id
      where l.next_due_on is not null and l.next_due_on <= ${until}::date
        and p.status = 'alive' and p.archived_at is null and c.archived_at is null
        and not exists (select 1 from vaccine_protocol_closures pc
          where pc.patient_id = l.patient_id and pc.vaccine_id = l.vaccine_id)
        and (${query.tipo ?? null}::text is null or v.kind = ${query.tipo ?? null}::text)
        and (${query.especie ?? null}::uuid is null or p.species_id = ${query.especie ?? null}::uuid)`;
    const situation =
      query.situacao === 'vencidas'
        ? sql`next_due_on < ${today}::date`
        : query.situacao === 'a-vencer'
          ? sql`next_due_on >= ${today}::date`
          : sql`true`;
    const [counts] = (
      await this.db.execute<{ total: number; overdue: number; due_soon: number }>(sql`
        select count(*) filter (where ${situation})::int as total,
          count(*) filter (where next_due_on < ${today}::date)::int as overdue,
          count(*) filter (where next_due_on >= ${today}::date)::int as due_soon
        from (${base}) b`)
    ).rows;
    const rows = (
      await this.db.execute<{
        patient_id: string;
        code: number;
        patient_name: string;
        species_name: string | null;
        client_id: string;
        client_name: string;
        phone: string | null;
        whatsapp: boolean;
        vaccine_id: string;
        vaccine_name: string;
        kind: VaccineKind;
        dose_label: string;
        occurred_at: Date | string;
        next_due_on: string;
      }>(sql`
        select b.*, b.next_due_on::text as next_due_on from (${base}) b
        where ${situation}
        order by b.next_due_on, b.patient_name, b.vaccine_name
        limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}`)
    ).rows;
    const dayNumber = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
    return {
      items: rows.map((r) => ({
        patient: { id: r.patient_id, code: r.code, name: r.patient_name },
        species: r.species_name,
        client: { id: r.client_id, name: r.client_name, phone: r.phone, whatsapp: r.whatsapp },
        vaccine: { id: r.vaccine_id, name: r.vaccine_name, kind: r.kind },
        lastAppliedAt: new Date(r.occurred_at).toISOString(),
        lastDose: r.dose_label,
        nextDueOn: r.next_due_on,
        daysLate: dayNumber(today) - dayNumber(r.next_due_on),
      })),
      total: counts?.total ?? 0,
      page: query.page,
      pageSize: query.pageSize,
      overdue: counts?.overdue ?? 0,
      dueSoon: counts?.due_soon ?? 0,
      until,
      today,
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
}

function vaccineSnapshot(v: Vaccine) {
  return {
    name: v.name,
    kind: v.kind,
    periodicity: vaccinePeriodicity(v),
    service: v.service?.name ?? null,
    archived: v.archived,
  };
}
