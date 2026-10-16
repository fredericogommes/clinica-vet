import { describe, expect, it } from 'vitest';
import { formatKg, formatVital, isoToLocalInput, localInputToIso } from './labels';
import { weightAxis } from './weight-chart';

describe('data e hora no fuso da unidade', () => {
  it('converte o valor do campo para o instante certo em São Paulo (UTC-3)', () => {
    expect(localInputToIso('2026-10-16T14:30', 'America/Sao_Paulo')).toBe(
      '2026-10-16T17:30:00.000Z',
    );
  });

  it('respeita fusos com horário de verão', () => {
    expect(localInputToIso('2026-07-01T09:00', 'Europe/Lisbon')).toBe('2026-07-01T08:00:00.000Z');
    expect(localInputToIso('2026-01-15T09:00', 'Europe/Lisbon')).toBe('2026-01-15T09:00:00.000Z');
  });

  it('ida e volta preservam o horário digitado', () => {
    for (const tz of ['America/Sao_Paulo', 'America/Manaus', 'America/Noronha']) {
      const value = '2026-03-01T23:45';
      expect(isoToLocalInput(localInputToIso(value, tz), tz)).toBe(value);
    }
  });

  it('mostra o instante no relógio da unidade, não no do navegador', () => {
    expect(isoToLocalInput('2026-10-16T02:10:00.000Z', 'America/Sao_Paulo')).toBe(
      '2026-10-15T23:10',
    );
  });
});

describe('formatação de medidas', () => {
  it('peso sempre com ao menos uma casa decimal', () => {
    expect(formatKg(29)).toBe('29,0 kg');
    expect(formatKg(4.25)).toBe('4,25 kg');
  });

  it('sinais vitais com unidade', () => {
    expect(formatVital('temperature', 39.4)).toContain('39,4');
    expect(formatVital('heartRate', 112)).toContain('112');
  });
});

describe('weightAxis', () => {
  it('abrange todos os valores com marcas redondas', () => {
    const axis = weightAxis([27.4, 28.1, 29.3]);
    expect(axis.min).toBeLessThanOrEqual(27.4);
    expect(axis.max).toBeGreaterThanOrEqual(29.3);
    expect(axis.ticks[0]).toBe(axis.min);
    expect(axis.ticks.at(-1)).toBe(axis.max);
    const steps = axis.ticks.slice(1).map((t, i) => Number((t - (axis.ticks[i] ?? 0)).toFixed(6)));
    expect(new Set(steps).size).toBe(1);
  });

  it('um único valor ainda gera um eixo com altura', () => {
    const axis = weightAxis([4.2]);
    expect(axis.max).toBeGreaterThan(axis.min);
    expect(axis.min).toBeLessThan(4.2);
  });

  it('nunca desce abaixo de zero', () => {
    expect(weightAxis([0.05, 0.08]).min).toBeGreaterThanOrEqual(0);
  });
});
