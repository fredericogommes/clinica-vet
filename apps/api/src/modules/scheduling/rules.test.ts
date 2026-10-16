import { describe, expect, it } from 'vitest';
import { addMonths, instantToZoned, zonedToInstant } from '../../core/zoned-time.js';
import { metricsOf } from './appointment-service.js';
import { occurrenceDates } from './recurrence.js';
import { canTransition, isLate, nextStatuses } from './status.js';

describe('ciclo de status', () => {
  it('segue Agendado → Confirmado → Em espera → Em atendimento → Animal pronto', () => {
    expect(canTransition('scheduled', 'confirmed')).toBe(true);
    expect(canTransition('confirmed', 'waiting')).toBe(true);
    expect(canTransition('waiting', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'ready')).toBe(true);
  });

  it('rejeita pular etapas ou voltar', () => {
    expect(canTransition('scheduled', 'in_progress')).toBe(false);
    expect(canTransition('in_progress', 'waiting')).toBe(false);
    expect(canTransition('ready', 'scheduled')).toBe(false);
    expect(nextStatuses('ready')).toEqual([]);
  });

  it('atrasado é derivado: horário passou e o animal não chegou', () => {
    const past = new Date('2026-01-01T10:00:00Z');
    const now = new Date('2026-01-01T10:05:00Z');
    expect(isLate('scheduled', past, now)).toBe(true);
    expect(isLate('confirmed', past, now)).toBe(true);
    expect(isLate('waiting', past, now)).toBe(false);
    expect(isLate('scheduled', now, past)).toBe(false);
  });
});

describe('recorrência', () => {
  it('gera as datas pela frequência', () => {
    expect(occurrenceDates('2026-10-19', 'weekly', 3)).toEqual([
      '2026-10-19',
      '2026-10-26',
      '2026-11-02',
    ]);
    expect(occurrenceDates('2026-10-19', 'biweekly', 2)).toEqual(['2026-10-19', '2026-11-02']);
    expect(occurrenceDates('2026-12-30', 'daily', 3)).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
    ]);
  });

  it('mensal no dia 31 cai no último dia dos meses mais curtos', () => {
    expect(occurrenceDates('2027-01-31', 'monthly', 3)).toEqual([
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
    ]);
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
  });
});

describe('fuso da unidade', () => {
  it('converte hora de parede de São Paulo para UTC e de volta', () => {
    const instant = zonedToInstant('2026-10-19', 9 * 60, 'America/Sao_Paulo');
    expect(instant.toISOString()).toBe('2026-10-19T12:00:00.000Z');
    expect(instantToZoned(instant, 'America/Sao_Paulo')).toEqual({
      date: '2026-10-19',
      minutes: 540,
    });
  });

  it('respeita horário de verão em fusos que o adotam', () => {
    expect(zonedToInstant('2026-07-01', 9 * 60, 'Europe/Lisbon').toISOString()).toBe(
      '2026-07-01T08:00:00.000Z',
    );
    expect(zonedToInstant('2026-01-15', 9 * 60, 'Europe/Lisbon').toISOString()).toBe(
      '2026-01-15T09:00:00.000Z',
    );
  });
});

describe('indicadores', () => {
  it('calcula média de espera e de atendimento em minutos', () => {
    const m = (arrivedAt: string, startedAt: string, readyAt: string | null) => ({
      milestones: { confirmedAt: null, arrivedAt, startedAt, readyAt, cancelledAt: null },
    });
    expect(
      metricsOf([
        m('2026-10-19T12:00:00Z', '2026-10-19T12:10:00Z', '2026-10-19T12:40:00Z'),
        m('2026-10-19T13:00:00Z', '2026-10-19T13:20:00Z', null),
      ]),
    ).toEqual({ averageWaitMinutes: 15, averageServiceMinutes: 30 });
    expect(metricsOf([])).toEqual({ averageWaitMinutes: null, averageServiceMinutes: null });
  });
});
