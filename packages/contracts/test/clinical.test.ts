import { describe, expect, it } from 'vitest';
import { clinicalEventInputSchema, emptyVitals, vitalsSchema } from '../src/clinical.js';

describe('sinais vitais [D1]', () => {
  it('aceita valores dentro dos limites fisiológicos', () => {
    const ok = vitalsSchema.safeParse({
      heartRate: 120,
      respiratoryRate: 24,
      temperature: 38.5,
      capillaryRefill: 1.5,
      weightKg: 0.035,
      bodyScore: 5,
    });
    expect(ok.success).toBe(true);
  });

  it.each([
    ['heartRate', 5],
    ['heartRate', 120.5],
    ['respiratoryRate', 250],
    ['temperature', 29.9],
    ['temperature', 45.1],
    ['capillaryRefill', 11],
    ['weightKg', 0],
    ['weightKg', 2500],
    ['bodyScore', 0],
    ['bodyScore', 4.5],
  ])('recusa %s = %s', (key, value) => {
    expect(vitalsSchema.safeParse({ ...emptyVitals, [key]: value }).success).toBe(false);
  });
});

describe('evento clínico', () => {
  const encounter = {
    kind: 'encounter',
    occurredAt: null,
    typeId: null,
    appointmentId: null,
    summary: '',
    narrative: '',
    vitals: emptyVitals,
    pathologyIds: [],
  };

  it('rascunho vazio é aceito; atendimento finalizado precisa de conteúdo [D2]', () => {
    expect(clinicalEventInputSchema.safeParse({ ...encounter, publish: false }).success).toBe(true);
    expect(clinicalEventInputSchema.safeParse({ ...encounter, publish: true }).success).toBe(false);
    expect(
      clinicalEventInputSchema.safeParse({
        ...encounter,
        publish: true,
        vitals: { ...emptyVitals, temperature: 39 },
      }).success,
    ).toBe(true);
  });

  it('foto não é criada pelo corpo JSON e tipo desconhecido é recusado', () => {
    expect(clinicalEventInputSchema.safeParse({ kind: 'photo', occurredAt: null }).success).toBe(
      false,
    );
    expect(clinicalEventInputSchema.safeParse({ kind: 'exam', occurredAt: null }).success).toBe(
      false,
    );
  });
});
