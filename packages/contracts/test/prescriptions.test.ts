import { describe, expect, it } from 'vitest';
import {
  calculateDose,
  executeDoseSchema,
  prescriptionInputSchema,
  scheduleTimes,
} from '../src/prescriptions.js';

describe('dose pelo peso [RN-42, D5]', () => {
  it('multiplica a dose por kg pelo peso e calcula o volume pela concentração', () => {
    expect(
      calculateDose({ dose: 25, doseUnit: 'mg/kg', concentration: 500, weightKg: 12.4 }),
    ).toEqual({ amount: 310, amountUnit: 'mg', volumeMl: 0.62, missingWeight: false });
  });

  it('dose em mL por kg já é o volume', () => {
    expect(
      calculateDose({ dose: 0.1, doseUnit: 'mL/kg', concentration: null, weightKg: 8 }),
    ).toMatchObject({ amount: 0.8, amountUnit: 'mL', volumeMl: 0.8 });
  });

  it('dose fixa não depende do peso; comprimido não tem volume', () => {
    expect(
      calculateDose({ dose: 1, doseUnit: 'comprimido', concentration: null, weightKg: null }),
    ).toEqual({ amount: 1, amountUnit: 'comprimido', volumeMl: null, missingWeight: false });
  });

  it('dose por kg sem peso registrado não é calculada', () => {
    expect(
      calculateDose({ dose: 25, doseUnit: 'mg/kg', concentration: 500, weightKg: null }),
    ).toMatchObject({ amount: null, volumeMl: null, missingWeight: true });
  });
});

describe('aprazamento', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 9, 17, h));
  it('gera os horários do intervalo dentro da janela e até o fim', () => {
    const p = { firstAt: at(8).toISOString(), intervalHours: 8, endsAt: null };
    expect(scheduleTimes(p, at(0), at(24)).map((d) => d.getUTCHours())).toEqual([8, 16]);
    expect(scheduleTimes(p, at(9), at(33))).toHaveLength(3);
    const stopped = { ...p, endsAt: at(16).toISOString() };
    expect(scheduleTimes(stopped, at(0), at(48))).toEqual([at(8)]);
  });
});

describe('prescrição e execução', () => {
  const base = {
    name: 'Dipirona',
    dose: 25,
    doseUnit: 'mg/kg',
    route: 'IV',
    intervalHours: 8,
    firstAt: '2026-10-17T11:00:00.000Z',
  } as const;
  it('concentração só para mg, mcg ou UI', () => {
    expect(prescriptionInputSchema.safeParse({ ...base, concentration: 500 }).success).toBe(true);
    const bad = prescriptionInputSchema.safeParse({ ...base, doseUnit: 'mL', concentration: 5 });
    expect(bad.error?.issues[0]?.path).toEqual(['concentration']);
  });
  it('não executado exige o motivo', () => {
    const skip = {
      scheduledAt: base.firstAt,
      executedAt: base.firstAt,
      status: 'skipped',
    } as const;
    expect(executeDoseSchema.safeParse(skip).success).toBe(false);
    expect(executeDoseSchema.safeParse({ ...skip, notes: 'Animal em jejum' }).success).toBe(true);
  });
});
