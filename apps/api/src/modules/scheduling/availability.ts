import { and, asc, between, eq, inArray, isNotNull } from 'drizzle-orm';
import { notFound } from '../../core/errors.js';
import { datesBetween, weekdayOf } from '../../core/zoned-time.js';
import type { Executor } from '../../db/client.js';
import {
  scheduleFixedHours,
  scheduleMembers,
  scheduleShifts,
  unitOpeningHours,
  units,
  users,
} from '../../db/schema.js';
import { intersect, type Range } from './slots.js';

export interface Professional {
  id: string;
  name: string;
  mode: 'fixed' | 'variable';
}

export interface UnitCalendar {
  timeZone: string;
  professionals: Professional[];
  /** Faixa de funcionamento por data (null = fechado). */
  opening: Map<string, Range | null>;
  /** userId → data → faixas abertas para agendamento. */
  availability: Map<string, Map<string, Range[]>>;
}

export async function unitTimeZone(db: Executor, unitId: string): Promise<string> {
  const [unit] = await db
    .select({ timeZone: units.timeZone })
    .from(units)
    .where(eq(units.id, unitId));
  if (!unit) throw notFound('Unidade');
  return unit.timeZone;
}

/** Profissionais com agenda ativos na unidade, em ordem alfabética. */
export async function listProfessionals(db: Executor, unitId: string): Promise<Professional[]> {
  return db
    .select({ id: users.id, name: users.name, mode: scheduleMembers.mode })
    .from(scheduleMembers)
    .innerJoin(users, eq(users.id, scheduleMembers.userId))
    .where(and(eq(scheduleMembers.unitId, unitId), eq(users.active, true)))
    .orderBy(asc(users.name));
}

/**
 * Monta a disponibilidade de cada profissional no período: horário fixo do dia da semana ou
 * turnos confirmados da escala, sempre recortados pelo horário de funcionamento da unidade.
 */
export async function loadCalendar(
  db: Executor,
  unitId: string,
  from: string,
  to: string,
): Promise<UnitCalendar> {
  const timeZone = await unitTimeZone(db, unitId);
  const professionals = await listProfessionals(db, unitId);
  const openingRows = await db
    .select()
    .from(unitOpeningHours)
    .where(eq(unitOpeningHours.unitId, unitId));
  const fixedRows = await db
    .select()
    .from(scheduleFixedHours)
    .where(eq(scheduleFixedHours.unitId, unitId));
  const ids = professionals.map((p) => p.id);
  const shiftRows =
    ids.length === 0
      ? []
      : await db
          .select()
          .from(scheduleShifts)
          .where(
            and(
              eq(scheduleShifts.unitId, unitId),
              inArray(scheduleShifts.userId, ids),
              between(scheduleShifts.date, from, to),
              isNotNull(scheduleShifts.confirmedAt),
            ),
          );

  const dates = datesBetween(from, to);
  const opening = new Map<string, Range | null>();
  for (const date of dates) {
    const row = openingRows.find((r) => r.weekday === weekdayOf(date));
    opening.set(date, row ? { start: row.startMinute, end: row.endMinute } : null);
  }

  const availability = new Map<string, Map<string, Range[]>>();
  for (const p of professionals) {
    const byDate = new Map<string, Range[]>();
    for (const date of dates) {
      const open = opening.get(date);
      if (!open) {
        byDate.set(date, []);
        continue;
      }
      const own =
        p.mode === 'fixed'
          ? fixedRows
              .filter((r) => r.userId === p.id && r.weekday === weekdayOf(date))
              .map((r) => ({ start: r.startMinute, end: r.endMinute }))
          : shiftRows
              .filter((r) => r.userId === p.id && r.date === date)
              .map((r) => ({ start: r.startMinute, end: r.endMinute }));
      byDate.set(date, intersect(own, [open]));
    }
    availability.set(p.id, byDate);
  }
  return { timeZone, professionals, opening, availability };
}
