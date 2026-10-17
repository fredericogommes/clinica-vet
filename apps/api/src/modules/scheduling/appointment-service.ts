import {
  appointmentStatusLabels,
  formatMinutes,
  SLOT_STEP_MINUTES,
  toMinutes,
  type Agenda,
  type AgendaQuery,
  type Appointment,
  type AppointmentStatus,
  type ChangeStatusInput,
  type CreateAppointmentData,
  type Slot,
  type SlotQuery,
  type UpdateAppointmentData,
} from '@clinica/contracts';
import { and, asc, eq, gte, inArray, lt, ne, notInArray, sql, type SQL } from 'drizzle-orm';
import { actorOf } from '../../core/actor.js';
import { recordAudit } from '../../core/audit.js';
import { AppError, conflict, forbidden, notFound } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import { addDays, instantToZoned, zonedToInstant } from '../../core/zoned-time.js';
import type { Database, Executor } from '../../db/client.js';
import { isExclusionViolation } from '../../db/errors.js';
import {
  appointmentPatients,
  appointments,
  appointmentTypes,
  clientContacts,
  clients,
  patients,
  users,
} from '../../db/schema.js';
import type { AuthContext } from '../auth/sessions.js';
import { loadCalendar, unitTimeZone, type UnitCalendar } from './availability.js';
import { occurrenceDates } from './recurrence.js';
import { fitsIn, freeSlots, type Range } from './slots.js';
import { canTransition, isEditable, isLate, milestoneOf, nextStatuses } from './status.js';

const invalid = (path: string, message: string) =>
  new AppError('validation_failed', 'Dados do agendamento inválidos.', [{ path, message }]);

const slotTaken = () =>
  conflict('Este horário acabou de ser ocupado para o profissional. Escolha outro horário.');

const brDate = (date: string) => date.split('-').reverse().join('/');

/** Status que ocupam horário: os demais liberam o profissional. */
const inactiveStatuses: AppointmentStatus[] = ['cancelled', 'no_show'];

/** Organização e unidade onde o agendamento acontece; a sessão da equipe já é uma. */
export interface Scope {
  organizationId: string;
  unitId: string;
}

interface Schedule {
  professionalId: string;
  date: string;
  start: string;
  durationMinutes: number;
  fitIn: boolean;
}

export class AppointmentService {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Tudo o que a tela de agenda precisa para um período: profissionais, escala e agendamentos. */
  async agenda(auth: AuthContext, query: AgendaQuery): Promise<Agenda> {
    const calendar = await loadCalendar(this.db, auth.unitId, query.from, query.to);
    const filters: SQL[] = [
      eq(appointments.unitId, auth.unitId),
      gte(appointments.startsAt, zonedToInstant(query.from, 0, calendar.timeZone)),
      lt(appointments.startsAt, zonedToInstant(addDays(query.to, 1), 0, calendar.timeZone)),
    ];
    if (query.professionalId) filters.push(eq(appointments.professionalId, query.professionalId));
    const items = await this.load(this.db, calendar.timeZone, and(...filters));

    // Quem saiu da agenda mas ainda tem atendimentos marcados continua aparecendo.
    const professionals = calendar.professionals.map(({ id, name }) => ({ id, name }));
    for (const a of items) {
      if (!professionals.some((p) => p.id === a.professional.id))
        professionals.push(a.professional);
    }
    const visible = query.professionalId
      ? professionals.filter((p) => p.id === query.professionalId)
      : professionals;

    const now = instantToZoned(this.now(), calendar.timeZone);
    return {
      timeZone: calendar.timeZone,
      today: now.date,
      nowMinutes: now.minutes,
      professionals: visible,
      availability: visible.flatMap((p) =>
        [...(calendar.availability.get(p.id) ?? new Map<string, Range[]>())].map(
          ([date, ranges]) => ({ userId: p.id, date, ranges: ranges.map(toTimeRange) }),
        ),
      ),
      openingHours: [...calendar.opening].map(([date, range]) => ({
        date,
        range: range ? toTimeRange(range) : null,
      })),
      appointments: items,
      metrics: metricsOf(items),
    };
  }

  /** Horários livres do dia já cruzados com o profissional, como "15/10 às 12:00 – Laís". */
  async slots(auth: AuthContext, query: SlotQuery): Promise<Slot[]> {
    return this.openSlots(auth, query, this.now());
  }

  /** Horários livres que começam depois de `earliest` (agora, ou agora + antecedência). */
  async openSlots(scope: Scope, query: SlotQuery, earliest: Date): Promise<Slot[]> {
    const calendar = await loadCalendar(this.db, scope.unitId, query.date, query.date);
    const first = instantToZoned(earliest, calendar.timeZone);
    if (query.date < first.date) return [];
    const notBefore = query.date === first.date ? first.minutes + 1 : 0;
    const professionals = calendar.professionals.filter(
      (p) => !query.professionalId || p.id === query.professionalId,
    );
    const busy = await this.busyByProfessional(
      this.db,
      calendar,
      query.date,
      professionals.map((p) => p.id),
      query.excludeAppointmentId,
    );
    const out: Slot[] = [];
    for (const p of professionals) {
      const starts = freeSlots({
        available: calendar.availability.get(p.id)?.get(query.date) ?? [],
        busy: busy.get(p.id) ?? [],
        duration: query.durationMinutes,
        step: SLOT_STEP_MINUTES,
        notBefore,
      });
      for (const start of starts) {
        out.push({
          date: query.date,
          start: formatMinutes(start),
          professionalId: p.id,
          professionalName: p.name,
        });
      }
    }
    return out.sort(
      (a, b) =>
        a.start.localeCompare(b.start) || a.professionalName.localeCompare(b.professionalName),
    );
  }

  /** Agendamentos ativos do animal nesta unidade, de hoje em diante, para a ficha clínica. */
  async forPatient(auth: AuthContext, patientId: string): Promise<Appointment[]> {
    const timeZone = await unitTimeZone(this.db, auth.unitId);
    const today = instantToZoned(this.now(), timeZone).date;
    const ofPatient = this.db
      .select({ id: appointmentPatients.appointmentId })
      .from(appointmentPatients)
      .where(eq(appointmentPatients.patientId, patientId));
    const items = await this.load(
      this.db,
      timeZone,
      and(
        eq(appointments.unitId, auth.unitId),
        inArray(appointments.id, ofPatient),
        gte(appointments.startsAt, zonedToInstant(today, 0, timeZone)),
        notInArray(appointments.status, inactiveStatuses),
      ),
    );
    return items.slice(0, 10);
  }

  async get(auth: AuthContext, id: string, executor?: Executor): Promise<Appointment> {
    const db = executor ?? this.db;
    const timeZone = await unitTimeZone(db, auth.unitId);
    const [item] = await this.load(
      db,
      timeZone,
      and(eq(appointments.id, id), eq(appointments.unitId, auth.unitId)),
    );
    if (!item) throw notFound('Agendamento');
    return item;
  }

  async create(auth: AuthContext, input: CreateAppointmentData): Promise<Appointment[]> {
    this.assertFitInAllowed(auth, input.fitIn);
    return this.write(async (tx) => {
      await this.assertClientAndPatients(tx, auth, input.clientId, input.patientIds);
      await this.assertType(tx, auth, input.typeId, null);
      const dates = input.recurrence
        ? occurrenceDates(input.date, input.recurrence.frequency, input.recurrence.count)
        : [input.date];
      const timeZone = await unitTimeZone(tx, auth.unitId);
      const ranges = await this.checkSchedule(tx, auth, input, dates, null);
      const seriesId = dates.length > 1 ? newId() : null;
      const created: Appointment[] = [];
      for (const range of ranges) {
        const id = newId();
        await tx.insert(appointments).values({
          id,
          organizationId: auth.organizationId,
          unitId: auth.unitId,
          professionalId: input.professionalId,
          clientId: input.clientId,
          typeId: input.typeId,
          startsAt: range.startsAt,
          endsAt: range.endsAt,
          status: input.status,
          confirmedAt: input.status === 'confirmed' ? this.now() : null,
          notes: input.notes,
          fitIn: input.fitIn,
          seriesId,
          createdBy: auth.userId,
        });
        await tx.insert(appointmentPatients).values(
          input.patientIds.map((patientId, position) => ({
            appointmentId: id,
            patientId,
            position,
          })),
        );
        const [after] = await this.load(tx, timeZone, eq(appointments.id, id));
        if (!after) throw notFound('Agendamento');
        await recordAudit(tx, actorOf(auth), {
          entity: 'appointment',
          entityId: id,
          action: 'create',
          after: snapshot(after),
        });
        created.push(after);
      }
      return created;
    });
  }

  /**
   * Agendamento feito pelo tutor no portal: sem encaixe, dentro da escala e sem sobreposição,
   * como o da recepção. Sem usuário autor; a auditoria registra a conta do portal.
   */
  async bookFromPortal(
    scope: Scope,
    input: Omit<Schedule, 'fitIn'> & {
      clientId: string;
      patientIds: string[];
      typeId: string;
      notes: string | null;
    },
    portalAccountId: string,
  ): Promise<Appointment> {
    return this.write(async (tx) => {
      await this.assertClientAndPatients(tx, scope, input.clientId, input.patientIds);
      await this.assertType(tx, scope, input.typeId, null);
      const timeZone = await unitTimeZone(tx, scope.unitId);
      const [range] = await this.checkSchedule(
        tx,
        scope,
        { ...input, fitIn: false },
        [input.date],
        null,
      );
      if (!range) throw invalid('date', 'Informe a data');
      const id = newId();
      await tx.insert(appointments).values({
        id,
        organizationId: scope.organizationId,
        unitId: scope.unitId,
        professionalId: input.professionalId,
        clientId: input.clientId,
        typeId: input.typeId,
        startsAt: range.startsAt,
        endsAt: range.endsAt,
        status: 'scheduled',
        notes: input.notes,
        origin: 'portal',
      });
      await tx.insert(appointmentPatients).values(
        input.patientIds.map((patientId, position) => ({
          appointmentId: id,
          patientId,
          position,
        })),
      );
      const [after] = await this.load(tx, timeZone, eq(appointments.id, id));
      if (!after) throw notFound('Agendamento');
      await recordAudit(
        tx,
        { organizationId: scope.organizationId, unitId: scope.unitId, userId: null },
        {
          entity: 'appointment',
          entityId: id,
          action: 'portal_create',
          after: { ...snapshot(after), portalAccountId },
        },
      );
      return after;
    });
  }

  /**
   * Cancelamento pelo tutor: só o que ele marcou pelo portal, ainda agendado ou confirmado e
   * que começa depois de `earliest` (agora + antecedência).
   */
  async cancelFromPortal(
    organizationId: string,
    clientId: string,
    id: string,
    earliest: Date,
    portalAccountId: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(appointments)
        .where(
          and(
            eq(appointments.id, id),
            eq(appointments.organizationId, organizationId),
            eq(appointments.clientId, clientId),
          ),
        )
        .for('update');
      if (!row) throw notFound('Agendamento');
      if (
        row.origin !== 'portal' ||
        !['scheduled', 'confirmed'].includes(row.status) ||
        row.startsAt <= earliest
      ) {
        throw conflict(
          'Este agendamento não pode mais ser cancelado pelo portal. Fale com a clínica.',
        );
      }
      const now = this.now();
      await tx
        .update(appointments)
        .set({
          status: 'cancelled',
          cancelledAt: now,
          cancelReason: 'Cancelado pelo tutor no portal',
          updatedAt: now,
        })
        .where(eq(appointments.id, id));
      await recordAudit(
        tx,
        { organizationId, unitId: row.unitId, userId: null },
        {
          entity: 'appointment',
          entityId: id,
          action: 'status',
          before: { status: row.status },
          after: { status: 'cancelled', reason: 'Cancelado pelo tutor no portal', portalAccountId },
        },
      );
    });
  }

  /** Remarcar ou corrigir dados: só antes da chegada do animal. */
  async update(auth: AuthContext, id: string, input: UpdateAppointmentData): Promise<Appointment> {
    return this.write(async (tx) => {
      const before = await this.lockAndGet(tx, auth, id);
      if (!isEditable(before.status)) {
        throw conflict('Só é possível alterar agendamentos que ainda não começaram.');
      }
      // Encaixe já gravado pode ser mantido por quem não tem a permissão, desde que o horário não mude.
      const keepsSchedule =
        before.fitIn &&
        input.fitIn &&
        before.date === input.date &&
        before.start === input.start &&
        before.professional.id === input.professionalId &&
        before.durationMinutes === input.durationMinutes;
      if (!keepsSchedule) this.assertFitInAllowed(auth, input.fitIn);
      await this.assertClientAndPatients(tx, auth, before.client.id, input.patientIds);
      await this.assertType(tx, auth, input.typeId, before.type.id);
      const [range] = keepsSchedule
        ? [{ startsAt: new Date(before.startsAt), endsAt: new Date(before.endsAt) }]
        : await this.checkSchedule(tx, auth, input, [input.date], id);
      if (!range) throw notFound('Agendamento');
      await tx
        .update(appointments)
        .set({
          professionalId: input.professionalId,
          typeId: input.typeId,
          startsAt: range.startsAt,
          endsAt: range.endsAt,
          notes: input.notes,
          fitIn: input.fitIn,
          updatedAt: this.now(),
        })
        .where(eq(appointments.id, id));
      await tx.delete(appointmentPatients).where(eq(appointmentPatients.appointmentId, id));
      await tx.insert(appointmentPatients).values(
        input.patientIds.map((patientId, position) => ({
          appointmentId: id,
          patientId,
          position,
        })),
      );
      const after = await this.get(auth, id, tx);
      await recordAudit(tx, actorOf(auth), {
        entity: 'appointment',
        entityId: id,
        action: 'update',
        before: snapshot(before),
        after: snapshot(after),
      });
      return after;
    });
  }

  async changeStatus(
    auth: AuthContext,
    id: string,
    input: ChangeStatusInput,
  ): Promise<Appointment> {
    const target = input.status;
    return this.write(async (tx) => {
      const before = await this.lockAndGet(tx, auth, id);
      if (!canTransition(before.status, target)) {
        throw conflict(
          `Não é possível passar de "${statusLabel(before.status)}" para "${statusLabel(target)}".`,
        );
      }
      const now = this.now();
      const changes: Partial<typeof appointments.$inferInsert> = { status: target, updatedAt: now };
      if (target === 'scheduled') {
        // Reativação: o horário volta a ser ocupado e a restrição do banco confere se está livre.
        Object.assign(changes, { cancelledAt: null, cancelReason: null, confirmedAt: null });
      } else {
        Object.assign(changes, { [milestoneOf[target]]: now });
        if (target === 'cancelled' || target === 'no_show')
          changes.cancelReason = input.reason ?? null;
      }
      await tx.update(appointments).set(changes).where(eq(appointments.id, id));
      const after = await this.get(auth, id, tx);
      await recordAudit(tx, actorOf(auth), {
        entity: 'appointment',
        entityId: id,
        action: 'status',
        before: { status: before.status },
        after: { status: after.status, reason: input.reason ?? null },
      });
      return after;
    });
  }

  /**
   * Confere cada ocorrência: profissional com agenda, dentro da escala (exceto encaixe), no
   * futuro e sem sobreposição. Junta todos os problemas para a recepção ver de uma vez.
   */
  private async checkSchedule(
    tx: Executor,
    auth: Scope,
    schedule: Schedule,
    dates: string[],
    excludeId: string | null,
  ): Promise<{ startsAt: Date; endsAt: Date }[]> {
    const [first] = dates;
    const last = dates.at(-1);
    if (!first || !last) throw invalid('date', 'Informe a data');
    const calendar = await loadCalendar(tx, auth.unitId, first, last);
    const professional = calendar.professionals.find((p) => p.id === schedule.professionalId);
    if (!professional) {
      throw invalid('professionalId', 'Este profissional não tem agenda nesta unidade');
    }
    const start = toMinutes(schedule.start);
    if (start + schedule.durationMinutes > 24 * 60) {
      throw invalid('durationMinutes', 'O atendimento precisa terminar no mesmo dia');
    }
    const now = this.now();
    const problems: { path: string; message: string }[] = [];
    const ranges = dates.map((date) => ({
      date,
      startsAt: zonedToInstant(date, start, calendar.timeZone),
      endsAt: zonedToInstant(date, start + schedule.durationMinutes, calendar.timeZone),
    }));
    for (const [i, r] of ranges.entries()) {
      const when = `${brDate(r.date)} às ${schedule.start}`;
      if (schedule.fitIn) continue;
      if (r.startsAt.getTime() <= now.getTime()) {
        problems.push({ path: `occurrences.${i}`, message: `${when}: horário já passou` });
        continue;
      }
      const available = calendar.availability.get(professional.id)?.get(r.date) ?? [];
      if (!fitsIn(available, start, schedule.durationMinutes)) {
        problems.push({
          path: `occurrences.${i}`,
          message: `${when}: fora da escala de ${professional.name}`,
        });
      }
    }
    const clashes = await tx
      .select({ startsAt: appointments.startsAt, endsAt: appointments.endsAt })
      .from(appointments)
      .where(
        and(
          eq(appointments.professionalId, schedule.professionalId),
          notInArray(appointments.status, inactiveStatuses),
          excludeId ? ne(appointments.id, excludeId) : undefined,
          lt(
            appointments.startsAt,
            zonedToInstant(last, start + schedule.durationMinutes, calendar.timeZone),
          ),
          sql`${appointments.endsAt} > ${zonedToInstant(first, start, calendar.timeZone)}`,
        ),
      );
    for (const [i, r] of ranges.entries()) {
      if (clashes.some((c) => c.startsAt < r.endsAt && r.startsAt < c.endsAt)) {
        problems.push({
          path: `occurrences.${i}`,
          message: `${brDate(r.date)} às ${schedule.start}: ${professional.name} já tem atendimento nesse horário`,
        });
      }
    }
    if (problems.length > 0) {
      const message =
        dates.length > 1
          ? `${problems.length} de ${dates.length} ocorrências não podem ser agendadas. Nada foi gravado.`
          : (problems[0]?.message ?? 'Horário indisponível.');
      throw new AppError('conflict', message, problems);
    }
    return ranges;
  }

  private async busyByProfessional(
    db: Executor,
    calendar: UnitCalendar,
    date: string,
    professionalIds: string[],
    excludeId: string | undefined,
  ): Promise<Map<string, Range[]>> {
    const busy = new Map<string, Range[]>();
    if (professionalIds.length === 0) return busy;
    const dayStart = zonedToInstant(date, 0, calendar.timeZone);
    const dayEnd = zonedToInstant(addDays(date, 1), 0, calendar.timeZone);
    const rows = await db
      .select({
        professionalId: appointments.professionalId,
        startsAt: appointments.startsAt,
        endsAt: appointments.endsAt,
      })
      .from(appointments)
      .where(
        and(
          inArray(appointments.professionalId, professionalIds),
          notInArray(appointments.status, inactiveStatuses),
          excludeId ? ne(appointments.id, excludeId) : undefined,
          lt(appointments.startsAt, dayEnd),
          sql`${appointments.endsAt} > ${dayStart}`,
        ),
      );
    for (const row of rows) {
      const s = instantToZoned(row.startsAt, calendar.timeZone);
      const e = instantToZoned(row.endsAt, calendar.timeZone);
      const range = {
        start: s.date === date ? s.minutes : 0,
        end: e.date === date ? e.minutes : 1440,
      };
      busy.set(row.professionalId, [...(busy.get(row.professionalId) ?? []), range]);
    }
    return busy;
  }

  private assertFitInAllowed(auth: AuthContext, fitIn: boolean): void {
    if (fitIn && !auth.permissions.has('schedule.fit_in')) throw forbidden();
  }

  private async assertClientAndPatients(
    tx: Executor,
    auth: Pick<Scope, 'organizationId'>,
    clientId: string,
    patientIds: string[],
  ): Promise<void> {
    const [client] = await tx
      .select({ archivedAt: clients.archivedAt })
      .from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.organizationId, auth.organizationId)));
    if (!client) throw invalid('clientId', 'Cliente não encontrado');
    if (client.archivedAt) throw invalid('clientId', 'Cliente arquivado');
    const rows = await tx
      .select({
        id: patients.id,
        name: patients.name,
        clientId: patients.clientId,
        status: patients.status,
        archivedAt: patients.archivedAt,
      })
      .from(patients)
      .where(
        and(inArray(patients.id, patientIds), eq(patients.organizationId, auth.organizationId)),
      );
    for (const id of patientIds) {
      const p = rows.find((r) => r.id === id);
      if (!p || p.clientId !== clientId) {
        throw invalid('patientIds', 'O animal não pertence a este cliente');
      }
      if (p.archivedAt) throw invalid('patientIds', `${p.name} está arquivado`);
      if (p.status === 'deceased')
        throw invalid('patientIds', `${p.name} está registrado como óbito`);
    }
  }

  /** O tipo precisa estar ativo, salvo quando é o mesmo já gravado no agendamento. */
  private async assertType(
    tx: Executor,
    auth: Pick<Scope, 'organizationId'>,
    typeId: string,
    currentTypeId: string | null,
  ): Promise<void> {
    const [type] = await tx
      .select({ archivedAt: appointmentTypes.archivedAt })
      .from(appointmentTypes)
      .where(
        and(
          eq(appointmentTypes.id, typeId),
          eq(appointmentTypes.organizationId, auth.organizationId),
        ),
      );
    if (!type || (type.archivedAt && typeId !== currentTypeId)) {
      throw invalid('typeId', 'Tipo de atendimento não encontrado ou arquivado');
    }
  }

  private async lockAndGet(tx: Executor, auth: AuthContext, id: string): Promise<Appointment> {
    const [row] = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(and(eq(appointments.id, id), eq(appointments.unitId, auth.unitId)))
      .for('update');
    if (!row) throw notFound('Agendamento');
    return this.get(auth, id, tx);
  }

  /** Carrega agendamentos com profissional, cliente, telefone, animais e tipo. */
  private async load(
    db: Executor,
    timeZone: string,
    where: SQL | undefined,
  ): Promise<Appointment[]> {
    const rows = await db
      .select({
        a: appointments,
        professionalName: users.name,
        clientCode: clients.code,
        clientName: clients.name,
        typeName: appointmentTypes.name,
      })
      .from(appointments)
      .innerJoin(users, eq(users.id, appointments.professionalId))
      .innerJoin(clients, eq(clients.id, appointments.clientId))
      .innerJoin(appointmentTypes, eq(appointmentTypes.id, appointments.typeId))
      .where(where)
      .orderBy(asc(appointments.startsAt), asc(users.name));
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.a.id);
    const animalRows = await db
      .select({
        appointmentId: appointmentPatients.appointmentId,
        id: patients.id,
        name: patients.name,
        markings: patients.markings,
      })
      .from(appointmentPatients)
      .innerJoin(patients, eq(patients.id, appointmentPatients.patientId))
      .where(inArray(appointmentPatients.appointmentId, ids))
      .orderBy(asc(appointmentPatients.position));
    const clientIds = [...new Set(rows.map((r) => r.a.clientId))];
    const phoneRows = await db
      .select({ clientId: clientContacts.clientId, value: clientContacts.value })
      .from(clientContacts)
      .where(and(inArray(clientContacts.clientId, clientIds), ne(clientContacts.kind, 'email')))
      .orderBy(asc(clientContacts.position));
    const now = this.now();
    return rows.map(({ a, professionalName, clientCode, clientName, typeName }) => {
      const s = instantToZoned(a.startsAt, timeZone);
      const e = instantToZoned(a.endsAt, timeZone);
      return {
        id: a.id,
        date: s.date,
        start: formatMinutes(s.minutes),
        end: formatMinutes(e.date === s.date ? e.minutes : 1440),
        startsAt: a.startsAt.toISOString(),
        endsAt: a.endsAt.toISOString(),
        durationMinutes: Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / 60_000),
        status: a.status,
        late: isLate(a.status, a.startsAt, now),
        nextStatuses: [...nextStatuses(a.status)],
        editable: isEditable(a.status),
        fitIn: a.fitIn,
        bookedOnline: a.origin === 'portal',
        seriesId: a.seriesId,
        professional: { id: a.professionalId, name: professionalName },
        client: {
          id: a.clientId,
          code: clientCode,
          name: clientName,
          phone: phoneRows.find((p) => p.clientId === a.clientId)?.value ?? null,
        },
        patients: animalRows
          .filter((p) => p.appointmentId === a.id)
          .map(({ id, name, markings }) => ({ id, name, markings })),
        type: { id: a.typeId, name: typeName },
        notes: a.notes,
        cancelReason: a.cancelReason,
        milestones: {
          confirmedAt: a.confirmedAt?.toISOString() ?? null,
          arrivedAt: a.arrivedAt?.toISOString() ?? null,
          startedAt: a.startedAt?.toISOString() ?? null,
          readyAt: a.readyAt?.toISOString() ?? null,
          cancelledAt: a.cancelledAt?.toISOString() ?? null,
        },
      };
    });
  }

  private async write<T>(work: (tx: Executor) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(work);
    } catch (error) {
      if (isExclusionViolation(error)) throw slotTaken();
      throw error;
    }
  }
}

const statusLabel = (s: AppointmentStatus) => appointmentStatusLabels[s];

const toTimeRange = (r: Range) => ({ start: formatMinutes(r.start), end: formatMinutes(r.end) });

/** Média de espera (chegada → início) e de atendimento (início → animal pronto), em minutos. */
export function metricsOf(items: Pick<Appointment, 'milestones'>[]): Agenda['metrics'] {
  const minutes = (from: string | null, to: string | null) =>
    from && to ? (Date.parse(to) - Date.parse(from)) / 60_000 : null;
  const average = (values: (number | null)[]) => {
    const valid = values.filter((v): v is number => v !== null && v >= 0);
    return valid.length === 0 ? null : Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
  };
  return {
    averageWaitMinutes: average(
      items.map((i) => minutes(i.milestones.arrivedAt, i.milestones.startedAt)),
    ),
    averageServiceMinutes: average(
      items.map((i) => minutes(i.milestones.startedAt, i.milestones.readyAt)),
    ),
  };
}

function snapshot(a: Appointment) {
  return {
    date: a.date,
    start: a.start,
    end: a.end,
    professional: a.professional,
    client: { id: a.client.id, name: a.client.name },
    patients: a.patients.map((p) => p.name),
    type: a.type,
    status: a.status,
    notes: a.notes,
    fitIn: a.fitIn,
  };
}
