import {
  formatMinutes,
  toMinutes,
  type OpeningHoursInput,
  type ScheduleConfig,
  type ScheduleMemberInput,
  type Shift,
  type ShiftInput,
} from '@clinica/contracts';
import { and, asc, between, eq, isNull, notInArray, sql } from 'drizzle-orm';
import { actorOf } from '../../core/actor.js';
import { recordAudit } from '../../core/audit.js';
import { AppError, notFound } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import type { Database, Executor } from '../../db/client.js';
import {
  scheduleFixedHours,
  scheduleMembers,
  scheduleShifts,
  unitOpeningHours,
  userUnits,
  users,
} from '../../db/schema.js';
import type { AuthContext } from '../auth/sessions.js';
import { listProfessionals, unitTimeZone } from './availability.js';

const invalid = (path: string, message: string) =>
  new AppError('validation_failed', message, [{ path, message }]);

type MinuteRow = { weekday: number; startMinute: number; endMinute: number };
const toWeekdayRange = (r: MinuteRow) => ({
  weekday: r.weekday,
  start: formatMinutes(r.startMinute),
  end: formatMinutes(r.endMinute),
});

function monthBounds(month: string): { first: string; last: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { first: `${month}-01`, last };
}

/** Configuração da agenda da unidade atual: funcionamento, profissionais e escala variável. */
export class ScheduleConfigService {
  constructor(private readonly db: Database) {}

  async getConfig(auth: AuthContext): Promise<ScheduleConfig> {
    const timeZone = await unitTimeZone(this.db, auth.unitId);
    const opening = await this.db
      .select()
      .from(unitOpeningHours)
      .where(eq(unitOpeningHours.unitId, auth.unitId))
      .orderBy(asc(unitOpeningHours.weekday));
    const professionals = await listProfessionals(this.db, auth.unitId);
    const fixed = await this.db
      .select()
      .from(scheduleFixedHours)
      .where(eq(scheduleFixedHours.unitId, auth.unitId))
      .orderBy(asc(scheduleFixedHours.weekday));
    const memberIds = professionals.map((p) => p.id);
    const candidates = await this.db
      .select({ id: users.id, name: users.name })
      .from(users)
      .innerJoin(userUnits, eq(userUnits.userId, users.id))
      .where(
        and(
          eq(userUnits.unitId, auth.unitId),
          eq(users.active, true),
          memberIds.length > 0 ? notInArray(users.id, memberIds) : undefined,
        ),
      )
      .orderBy(asc(users.name));
    return {
      timeZone,
      openingHours: opening.map(toWeekdayRange),
      members: professionals.map((p) => ({
        userId: p.id,
        name: p.name,
        mode: p.mode,
        fixedHours: fixed.filter((f) => f.userId === p.id).map(toWeekdayRange),
      })),
      candidates,
    };
  }

  async setOpeningHours(auth: AuthContext, input: OpeningHoursInput): Promise<ScheduleConfig> {
    await this.db.transaction(async (tx) => {
      const before = await tx
        .select()
        .from(unitOpeningHours)
        .where(eq(unitOpeningHours.unitId, auth.unitId))
        .orderBy(asc(unitOpeningHours.weekday))
        .for('update');
      await tx.delete(unitOpeningHours).where(eq(unitOpeningHours.unitId, auth.unitId));
      if (input.days.length > 0) {
        await tx.insert(unitOpeningHours).values(
          input.days.map((d) => ({
            unitId: auth.unitId,
            weekday: d.weekday,
            startMinute: toMinutes(d.start),
            endMinute: toMinutes(d.end),
          })),
        );
      }
      await recordAudit(tx, actorOf(auth), {
        entity: 'opening_hours',
        entityId: auth.unitId,
        action: 'update',
        before: { days: before.map(toWeekdayRange) },
        after: { days: input.days.toSorted((a, b) => a.weekday - b.weekday) },
      });
    });
    return this.getConfig(auth);
  }

  /** Inclui ou altera um profissional com agenda na unidade. */
  async saveMember(
    auth: AuthContext,
    userId: string,
    input: { mode: 'fixed' | 'variable'; fixedHours: ScheduleMemberInput['fixedHours'] },
  ): Promise<ScheduleConfig> {
    await this.db.transaction(async (tx) => {
      await this.assertUnitUser(tx, auth, userId);
      const [current] = await tx
        .select()
        .from(scheduleMembers)
        .where(and(eq(scheduleMembers.unitId, auth.unitId), eq(scheduleMembers.userId, userId)))
        .for('update');
      const beforeHours = current
        ? await tx
            .select()
            .from(scheduleFixedHours)
            .where(
              and(
                eq(scheduleFixedHours.unitId, auth.unitId),
                eq(scheduleFixedHours.userId, userId),
              ),
            )
            .orderBy(asc(scheduleFixedHours.weekday))
        : [];
      if (current) {
        await tx
          .update(scheduleMembers)
          .set({ mode: input.mode, updatedAt: new Date() })
          .where(and(eq(scheduleMembers.unitId, auth.unitId), eq(scheduleMembers.userId, userId)));
        await tx
          .delete(scheduleFixedHours)
          .where(
            and(eq(scheduleFixedHours.unitId, auth.unitId), eq(scheduleFixedHours.userId, userId)),
          );
      } else {
        await tx.insert(scheduleMembers).values({ unitId: auth.unitId, userId, mode: input.mode });
      }
      if (input.fixedHours.length > 0) {
        await tx.insert(scheduleFixedHours).values(
          input.fixedHours.map((h) => ({
            unitId: auth.unitId,
            userId,
            weekday: h.weekday,
            startMinute: toMinutes(h.start),
            endMinute: toMinutes(h.end),
          })),
        );
      }
      await recordAudit(tx, actorOf(auth), {
        entity: 'schedule_member',
        entityId: userId,
        action: current ? 'update' : 'create',
        before: current
          ? { mode: current.mode, fixedHours: beforeHours.map(toWeekdayRange) }
          : null,
        after: {
          mode: input.mode,
          fixedHours: input.fixedHours.toSorted((a, b) => a.weekday - b.weekday),
        },
      });
    });
    return this.getConfig(auth);
  }

  /** Tira o profissional da agenda. Agendamentos já marcados continuam visíveis. */
  async removeMember(auth: AuthContext, userId: string): Promise<ScheduleConfig> {
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .delete(scheduleMembers)
        .where(and(eq(scheduleMembers.unitId, auth.unitId), eq(scheduleMembers.userId, userId)))
        .returning();
      if (!current) throw notFound('Profissional');
      await recordAudit(tx, actorOf(auth), {
        entity: 'schedule_member',
        entityId: userId,
        action: 'delete',
        before: { mode: current.mode },
      });
    });
    return this.getConfig(auth);
  }

  async listShifts(auth: AuthContext, month: string): Promise<Shift[]> {
    const { first, last } = monthBounds(month);
    const rows = await this.db
      .select({ shift: scheduleShifts, userName: users.name })
      .from(scheduleShifts)
      .innerJoin(users, eq(users.id, scheduleShifts.userId))
      .where(and(eq(scheduleShifts.unitId, auth.unitId), between(scheduleShifts.date, first, last)))
      .orderBy(asc(scheduleShifts.date), asc(scheduleShifts.startMinute), asc(users.name));
    return rows.map(({ shift, userName }) => ({
      id: shift.id,
      userId: shift.userId,
      userName,
      date: shift.date,
      start: formatMinutes(shift.startMinute),
      end: formatMinutes(shift.endMinute),
      confirmed: shift.confirmedAt !== null,
    }));
  }

  async createShift(auth: AuthContext, input: ShiftInput): Promise<Shift> {
    const id = newId();
    const startMinute = toMinutes(input.start);
    const endMinute = toMinutes(input.end);
    await this.db.transaction(async (tx) => {
      // Trava o profissional na unidade: dois lançamentos simultâneos não se sobrepõem.
      const [member] = await tx
        .select({ mode: scheduleMembers.mode })
        .from(scheduleMembers)
        .where(
          and(eq(scheduleMembers.unitId, auth.unitId), eq(scheduleMembers.userId, input.userId)),
        )
        .for('update');
      if (!member) throw invalid('userId', 'Este usuário não tem agenda nesta unidade.');
      if (member.mode !== 'variable') {
        throw invalid(
          'userId',
          'Este profissional tem horário fixo; a escala é só para horário variável.',
        );
      }
      const [overlap] = await tx
        .select({ id: scheduleShifts.id })
        .from(scheduleShifts)
        .where(
          and(
            eq(scheduleShifts.unitId, auth.unitId),
            eq(scheduleShifts.userId, input.userId),
            eq(scheduleShifts.date, input.date),
            sql`${scheduleShifts.startMinute} < ${endMinute}`,
            sql`${startMinute} < ${scheduleShifts.endMinute}`,
          ),
        );
      if (overlap) throw invalid('start', 'Já existe um turno deste profissional nesse horário.');
      await tx.insert(scheduleShifts).values({
        id,
        unitId: auth.unitId,
        userId: input.userId,
        date: input.date,
        startMinute,
        endMinute,
      });
      await recordAudit(tx, actorOf(auth), {
        entity: 'shift',
        entityId: id,
        action: 'create',
        after: { date: input.date, start: input.start, end: input.end, confirmed: false },
      });
    });
    const [created] = (await this.listShifts(auth, input.date.slice(0, 7))).filter(
      (s) => s.id === id,
    );
    if (!created) throw notFound('Turno');
    return created;
  }

  async deleteShift(auth: AuthContext, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [removed] = await tx
        .delete(scheduleShifts)
        .where(and(eq(scheduleShifts.id, id), eq(scheduleShifts.unitId, auth.unitId)))
        .returning();
      if (!removed) throw notFound('Turno');
      await recordAudit(tx, actorOf(auth), {
        entity: 'shift',
        entityId: id,
        action: 'delete',
        before: {
          date: removed.date,
          start: formatMinutes(removed.startMinute),
          end: formatMinutes(removed.endMinute),
          confirmed: removed.confirmedAt !== null,
        },
      });
    });
  }

  /** "Confirmar o mês inteiro": publica os turnos ainda em rascunho; só então abrem horários. */
  async confirmMonth(auth: AuthContext, month: string): Promise<number> {
    const { first, last } = monthBounds(month);
    return this.db.transaction(async (tx) => {
      const confirmed = await tx
        .update(scheduleShifts)
        .set({ confirmedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(scheduleShifts.unitId, auth.unitId),
            between(scheduleShifts.date, first, last),
            isNull(scheduleShifts.confirmedAt),
          ),
        )
        .returning({ id: scheduleShifts.id });
      if (confirmed.length > 0) {
        await recordAudit(tx, actorOf(auth), {
          entity: 'shift',
          entityId: auth.unitId,
          action: 'confirm_month',
          after: { month, shifts: confirmed.length },
        });
      }
      return confirmed.length;
    });
  }

  private async assertUnitUser(tx: Executor, auth: AuthContext, userId: string): Promise<void> {
    const [row] = await tx
      .select({ id: users.id })
      .from(users)
      .innerJoin(userUnits, eq(userUnits.userId, users.id))
      .where(
        and(
          eq(users.id, userId),
          eq(users.organizationId, auth.organizationId),
          eq(users.active, true),
          eq(userUnits.unitId, auth.unitId),
        ),
      );
    if (!row) throw notFound('Usuário');
  }
}
