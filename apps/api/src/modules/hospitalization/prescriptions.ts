import type {
  ExecuteDoseInput,
  ExecutionMap,
  Prescription,
  PrescriptionDay,
  PrescriptionInput,
} from '@clinica/contracts';
import {
  calculateDose,
  doseUnits,
  executeDoseSchema,
  executionStatusLabels,
  executionStatuses,
  hospitalizationPriorities,
  prescriptionInputSchema,
  prescriptionRoutes,
  scheduleTimes,
} from '@clinica/contracts';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { actorOf } from '../../core/actor.js';
import { recordAudit } from '../../core/audit.js';
import { AppError, conflict, notFound } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import { containsText } from '../../core/search.js';
import { addDays, instantToZoned, zonedToInstant } from '../../core/zoned-time.js';
import type { Database, Executor } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import {
  hospitalizationEntries,
  hospitalizationExecutions,
  hospitalizationPrescriptions,
  hospitalizations,
  users,
} from '../../db/schema.js';
import type { AuthContext } from '../auth/sessions.js';
import { unitTimeZone } from '../scheduling/availability.js';

type Row = Record<string, unknown>;
type PrescriptionRow = typeof hospitalizationPrescriptions.$inferSelect;
type HospitalizationRow = typeof hospitalizations.$inferSelect;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Até quanto tempo antes do horário a enfermagem pode registrar a execução. */
const EARLY_LIMIT = 6 * HOUR;

const invalid = (path: string, message: string) =>
  new AppError('validation_failed', 'Dados da prescrição inválidos.', [{ path, message }]);

const pick = <T extends string>(list: readonly T[], v: unknown, fallback: T): T =>
  list.find((x) => x === v) ?? fallback;

const decimal = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

/** Fim do aprazamento: duração, suspensão ou fim da internação, o que vier antes. */
function endsAtOf(p: PrescriptionRow, endedAt: Date | null): Date | null {
  const limits = [
    p.durationDays === null ? null : p.firstAt.getTime() + p.durationDays * DAY,
    p.stoppedAt?.getTime() ?? null,
    endedAt?.getTime() ?? null,
  ].filter((t): t is number => t !== null);
  return limits.length ? new Date(Math.min(...limits)) : null;
}

const scheduleOf = (p: PrescriptionRow, endedAt: Date | null) => ({
  firstAt: p.firstAt.toISOString(),
  intervalHours: p.intervalHours,
  endsAt: endsAtOf(p, endedAt)?.toISOString() ?? null,
});

/** Peso atual do animal: o último peso publicado no prontuário. */
async function currentWeight(db: Executor, patientId: string): Promise<number | null> {
  const { rows } = await db.execute<Row>(sql`select cv.weight_kg from clinical_vitals cv
    join clinical_events e on e.id = cv.event_id
    where e.patient_id = ${patientId} and e.status = 'published' and cv.weight_kg is not null
    order by e.occurred_at desc, e.id desc limit 1`);
  const w = rows[0]?.weight_kg;
  return w === undefined || w === null ? null : Number(w);
}

/**
 * Prescrição aprazada da internação [p.15, RN-42]: prescrever, suspender, executar cada horário
 * (programado × executado, com autor e a dose calculada pelo peso) e o mapa de execução da
 * unidade. A execução escreve também no histórico da internação.
 */
export class PrescriptionService {
  constructor(private readonly db: Database) {}

  /** Prescrições da internação com os horários do dia `date` (no fuso da unidade). */
  async day(
    auth: AuthContext,
    hospitalizationId: string,
    date: string,
    executor?: Executor,
  ): Promise<PrescriptionDay> {
    const db = executor ?? this.db;
    const h = await this.find(db, auth, hospitalizationId);
    const timeZone = await unitTimeZone(db, h.unitId);
    const from = zonedToInstant(date, 0, timeZone);
    const to = zonedToInstant(addDays(date, 1), 0, timeZone);
    const stopper = alias(users, 'stopper');
    const rows = await db
      .select({ p: hospitalizationPrescriptions, by: users.name, stoppedBy: stopper.name })
      .from(hospitalizationPrescriptions)
      .innerJoin(users, eq(users.id, hospitalizationPrescriptions.createdBy))
      .leftJoin(stopper, eq(stopper.id, hospitalizationPrescriptions.stoppedBy))
      .where(eq(hospitalizationPrescriptions.hospitalizationId, hospitalizationId))
      .orderBy(asc(hospitalizationPrescriptions.createdAt), asc(hospitalizationPrescriptions.id));
    const executions = rows.length
      ? await db
          .select({ e: hospitalizationExecutions, by: users.name })
          .from(hospitalizationExecutions)
          .innerJoin(users, eq(users.id, hospitalizationExecutions.executedBy))
          .where(
            and(
              inArray(
                hospitalizationExecutions.prescriptionId,
                rows.map((r) => r.p.id),
              ),
              sql`${hospitalizationExecutions.scheduledAt} >= ${from.toISOString()}`,
              sql`${hospitalizationExecutions.scheduledAt} < ${to.toISOString()}`,
            ),
          )
      : [];
    const prescriptions: Prescription[] = rows
      .map(({ p, by, stoppedBy }) => {
        const schedule = scheduleOf(p, h.endedAt);
        const doses = scheduleTimes(schedule, from, to).map((at) => {
          const found = executions.find(
            ({ e }) => e.prescriptionId === p.id && e.scheduledAt.getTime() === at.getTime(),
          );
          return {
            scheduledAt: at.toISOString(),
            execution: found
              ? {
                  id: found.e.id,
                  scheduledAt: found.e.scheduledAt.toISOString(),
                  executedAt: found.e.executedAt.toISOString(),
                  status: pick(executionStatuses, found.e.status, 'done'),
                  notes: found.e.notes,
                  by: found.by,
                  weightKg: found.e.weightKg,
                  amount: found.e.amount,
                  volumeMl: found.e.volumeMl,
                }
              : null,
          };
        });
        return {
          id: p.id,
          name: p.name,
          dose: p.dose,
          doseUnit: pick(doseUnits, p.doseUnit, 'mg'),
          concentration: p.concentration,
          route: pick(prescriptionRoutes, p.route, 'VO'),
          intervalHours: p.intervalHours,
          firstAt: p.firstAt.toISOString(),
          durationDays: p.durationDays,
          endsAt: schedule.endsAt,
          notes: p.notes,
          prescribedBy: by,
          createdAt: p.createdAt.toISOString(),
          stopped:
            p.stoppedAt && p.stopReason
              ? { at: p.stoppedAt.toISOString(), by: stoppedBy ?? '', reason: p.stopReason }
              : null,
          doses,
        };
      })
      // No dia: as que têm horário nele ou ainda valem nele (começam antes e não terminaram).
      .filter(
        (p) =>
          p.doses.length > 0 ||
          (new Date(p.firstAt) < to && (p.endsAt === null || new Date(p.endsAt) > from)),
      );
    return {
      date,
      timeZone,
      weightKg: await currentWeight(db, h.patientId),
      prescriptions,
    };
  }

  async prescribe(
    auth: AuthContext,
    hospitalizationId: string,
    raw: PrescriptionInput,
  ): Promise<{ id: string }> {
    const input = prescriptionInputSchema.parse(raw);
    return this.db.transaction(async (tx) => {
      const h = await this.lockOpen(tx, auth, hospitalizationId);
      const firstAt = new Date(input.firstAt);
      if (firstAt.getTime() < h.admittedAt.getTime() - HOUR) {
        throw invalid('firstAt', 'O primeiro horário não pode ser antes da internação');
      }
      if (firstAt.getTime() > Date.now() + 7 * DAY) {
        throw invalid('firstAt', 'O primeiro horário precisa estar nos próximos 7 dias');
      }
      const id = newId();
      await tx.insert(hospitalizationPrescriptions).values({
        id,
        hospitalizationId,
        name: input.name,
        dose: input.dose,
        doseUnit: input.doseUnit,
        concentration: input.concentration,
        route: input.route,
        intervalHours: input.intervalHours,
        firstAt,
        durationDays: input.durationDays,
        notes: input.notes,
        createdBy: auth.userId,
      });
      const timeZone = await unitTimeZone(tx, h.unitId);
      const duration = input.durationDays
        ? `por ${String(input.durationDays)} ${input.durationDays === 1 ? 'dia' : 'dias'}`
        : 'até nova ordem';
      await this.entry(
        tx,
        auth,
        hospitalizationId,
        'prescription',
        [
          `${input.name}: ${decimal(input.dose)} ${input.doseUnit} ${input.route} a cada ${String(input.intervalHours)} h, ${duration}, a partir de ${when(firstAt, timeZone)}`,
          input.notes,
        ]
          .filter(Boolean)
          .join('\n'),
      );
      await recordAudit(tx, actorOf(auth), {
        entity: 'prescription',
        entityId: id,
        action: 'create',
        after: { hospitalizationId, ...input },
      });
      return { id };
    });
  }

  /** Suspende a prescrição: os horários a partir de agora deixam de existir. */
  async stop(
    auth: AuthContext,
    hospitalizationId: string,
    prescriptionId: string,
    reason: string,
  ): Promise<{ id: string }> {
    return this.db.transaction(async (tx) => {
      await this.lockOpen(tx, auth, hospitalizationId);
      const p = await this.prescription(tx, hospitalizationId, prescriptionId);
      if (p.stoppedAt) throw conflict('Esta prescrição já foi suspensa.');
      const now = new Date();
      await tx
        .update(hospitalizationPrescriptions)
        .set({ stoppedAt: now, stoppedBy: auth.userId, stopReason: reason })
        .where(eq(hospitalizationPrescriptions.id, prescriptionId));
      await this.entry(tx, auth, hospitalizationId, 'prescription_stop', `${p.name}: ${reason}`);
      await recordAudit(tx, actorOf(auth), {
        entity: 'prescription',
        entityId: prescriptionId,
        action: 'stop',
        after: { name: p.name, reason },
      });
      return { id: prescriptionId };
    });
  }

  /**
   * Registra a execução de um horário: só horários que a prescrição prevê, uma vez cada. A dose
   * e o volume são recalculados aqui com o peso atual e gravados com a execução.
   */
  async execute(
    auth: AuthContext,
    hospitalizationId: string,
    prescriptionId: string,
    raw: ExecuteDoseInput,
  ): Promise<{ id: string }> {
    const input = executeDoseSchema.parse(raw);
    try {
      return await this.db.transaction(async (tx) => {
        const h = await this.lockOpen(tx, auth, hospitalizationId);
        const p = await this.prescription(tx, hospitalizationId, prescriptionId);
        const scheduledAt = new Date(input.scheduledAt);
        const executedAt = new Date(input.executedAt);
        const now = Date.now();
        const planned = scheduleTimes(
          scheduleOf(p, null),
          scheduledAt,
          new Date(scheduledAt.getTime() + 1),
        );
        if (planned.length === 0) {
          throw invalid('scheduledAt', 'Este horário não está na prescrição');
        }
        if (scheduledAt.getTime() > now + EARLY_LIMIT) {
          throw invalid('scheduledAt', 'Este horário ainda não chegou');
        }
        if (executedAt.getTime() > now + 60_000) {
          throw invalid('executedAt', 'A execução não pode ser no futuro');
        }
        // O formulário registra em minutos: a execução no mesmo minuto da internação vale.
        if (executedAt.getTime() < h.admittedAt.getTime() - 60_000) {
          throw invalid('executedAt', 'A execução não pode ser antes da internação');
        }
        const weightKg = await currentWeight(tx, h.patientId);
        const calc = calculateDose({
          dose: p.dose,
          doseUnit: pick(doseUnits, p.doseUnit, 'mg'),
          concentration: p.concentration,
          weightKg,
        });
        const id = newId();
        const done = input.status === 'done';
        await tx.insert(hospitalizationExecutions).values({
          id,
          prescriptionId,
          scheduledAt,
          executedAt,
          status: input.status,
          notes: input.notes,
          executedBy: auth.userId,
          weightKg: done ? weightKg : null,
          amount: done ? calc.amount : null,
          volumeMl: done ? calc.volumeMl : null,
        });
        const timeZone = await unitTimeZone(tx, h.unitId);
        const given =
          done && calc.amount !== null
            ? ` ${decimal(calc.amount)} ${calc.amountUnit}${calc.volumeMl === null ? '' : ` (${decimal(calc.volumeMl)} mL)`}`
            : '';
        await this.entry(
          tx,
          auth,
          hospitalizationId,
          'execution',
          [
            `${executionStatusLabels[input.status]}: ${p.name}${given} ${p.route}`,
            `Programado para ${when(scheduledAt, timeZone)} · ${done ? 'executado' : 'registrado'} em ${when(executedAt, timeZone)}`,
            input.notes,
          ]
            .filter(Boolean)
            .join('\n'),
        );
        await recordAudit(tx, actorOf(auth), {
          entity: 'prescription',
          entityId: prescriptionId,
          action: 'execute',
          after: { ...input, weightKg, amount: calc.amount, volumeMl: calc.volumeMl },
        });
        return { id };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('Este horário já foi registrado.');
      throw error;
    }
  }

  /**
   * Mapa de execução [p.15]: internados da unidade no dia, com quantos horários estão pendentes,
   * vencidos ou registrados em cada hora.
   */
  async map(
    auth: AuthContext,
    query: { date: string; q: string; pendingOnly: boolean },
  ): Promise<ExecutionMap> {
    const timeZone = await unitTimeZone(this.db, auth.unitId);
    const from = zonedToInstant(query.date, 0, timeZone);
    const to = zonedToInstant(addDays(query.date, 1), 0, timeZone);
    const { rows } = await this.db.execute<Row>(sql`select h.id, h.priority, h.ended_at,
        p.name as patient_name, b.code as box_code
      from hospitalizations h
      join patients p on p.id = h.patient_id
      left join boxes b on b.id = h.box_id
      where h.unit_id = ${auth.unitId} and h.organization_id = ${auth.organizationId}
        and h.status <> 'cancelled'
        and h.admitted_at < ${to.toISOString()}
        and (h.ended_at is null or h.ended_at > ${from.toISOString()})
        ${query.q ? sql`and (${containsText(sql`p.name`, query.q)} or ${containsText(sql`coalesce(b.code, '')`, query.q)})` : sql``}
      order by case h.priority when 'urgent' then 0 when 'attention' then 1 else 2 end,
        p.name, h.id`);
    const ids = rows.map((r) => String(r.id));
    const prescriptions = ids.length
      ? await this.db
          .select()
          .from(hospitalizationPrescriptions)
          .where(inArray(hospitalizationPrescriptions.hospitalizationId, ids))
      : [];
    const executions = prescriptions.length
      ? await this.db
          .select({
            prescriptionId: hospitalizationExecutions.prescriptionId,
            scheduledAt: hospitalizationExecutions.scheduledAt,
          })
          .from(hospitalizationExecutions)
          .where(
            and(
              inArray(
                hospitalizationExecutions.prescriptionId,
                prescriptions.map((p) => p.id),
              ),
              sql`${hospitalizationExecutions.scheduledAt} >= ${from.toISOString()}`,
              sql`${hospitalizationExecutions.scheduledAt} < ${to.toISOString()}`,
            ),
          )
      : [];
    const registered = new Set(
      executions.map((e) => `${e.prescriptionId}@${String(e.scheduledAt.getTime())}`),
    );
    const now = Date.now();
    const totals = { pending: 0, overdue: 0, done: 0 };
    const result = rows.map((r) => {
      const endedAt = r.ended_at ? new Date(r.ended_at as string | Date) : null;
      const cells = Array.from({ length: 24 }, (_, hour) => ({
        hour,
        pending: 0,
        overdue: 0,
        done: 0,
      }));
      for (const p of prescriptions.filter((x) => x.hospitalizationId === r.id)) {
        for (const at of scheduleTimes(scheduleOf(p, endedAt), from, to)) {
          const cell = cells[Math.floor(instantToZoned(at, timeZone).minutes / 60)];
          if (!cell) continue;
          const state = registered.has(`${p.id}@${String(at.getTime())}`)
            ? 'done'
            : at.getTime() < now
              ? 'overdue'
              : 'pending';
          cell[state] += 1;
          totals[state] += 1;
        }
      }
      return {
        hospitalizationId: String(r.id),
        patient: String(r.patient_name),
        box: typeof r.box_code === 'string' ? r.box_code : null,
        priority: pick(hospitalizationPriorities, r.priority, 'routine'),
        cells,
      };
    });
    const visible = query.pendingOnly
      ? result.filter((r) => r.cells.some((c) => c.pending + c.overdue > 0))
      : result;
    return { date: query.date, rows: visible, totals };
  }

  // ---------------------------------------------------------------- apoio

  private async find(db: Executor, auth: AuthContext, id: string): Promise<HospitalizationRow> {
    const [row] = await db
      .select()
      .from(hospitalizations)
      .where(
        and(eq(hospitalizations.id, id), eq(hospitalizations.organizationId, auth.organizationId)),
      );
    if (!row) throw notFound('Internação');
    return row;
  }

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

  private async prescription(
    tx: Executor,
    hospitalizationId: string,
    id: string,
  ): Promise<PrescriptionRow> {
    const [row] = await tx
      .select()
      .from(hospitalizationPrescriptions)
      .where(
        and(
          eq(hospitalizationPrescriptions.id, id),
          eq(hospitalizationPrescriptions.hospitalizationId, hospitalizationId),
        ),
      );
    if (!row) throw notFound('Prescrição');
    return row;
  }

  private async entry(
    tx: Executor,
    auth: AuthContext,
    hospitalizationId: string,
    kind: 'prescription' | 'prescription_stop' | 'execution',
    text: string,
    occurredAt = new Date(),
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
}

/** "17/10 08:00" no fuso da unidade. */
function when(at: Date, timeZone: string): string {
  const z = instantToZoned(at, timeZone);
  const [, m, d] = z.date.split('-');
  const hh = String(Math.floor(z.minutes / 60)).padStart(2, '0');
  const mm = String(z.minutes % 60).padStart(2, '0');
  return `${d ?? ''}/${m ?? ''} ${hh}:${mm}`;
}
