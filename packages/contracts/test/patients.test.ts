import { describe, expect, it } from 'vitest';
import { formatAge, patientInputSchema } from '../src/patients.js';

const base = {
  name: 'Thor',
  status: 'alive',
  deceasedOn: '',
  sex: 'male',
  sterilized: null,
  birthDate: '',
  speciesId: null,
  breedId: null,
  coatId: null,
  microchip: '',
  hasPedigree: false,
  pedigreeNumber: '',
  markings: [],
} as const;

describe('animal', () => {
  it('idade derivada do nascimento em anos e meses (RN-07)', () => {
    const ref = new Date(2026, 9, 16);
    expect(formatAge('2026-09-01', ref)).toBe('1 mês');
    expect(formatAge('2026-09-20', ref)).toBe('0 meses');
    expect(formatAge('2024-10-16', ref)).toBe('2 anos');
    expect(formatAge('2023-07-10', ref)).toBe('3 anos e 3 meses');
  });

  it('raça exige espécie', () => {
    const r = patientInputSchema.safeParse({
      ...base,
      breedId: '0199e9a0-0000-7000-8000-000000000000',
    });
    expect(r.success).toBe(false);
  });

  it('óbito não pode ser anterior ao nascimento', () => {
    const r = patientInputSchema.safeParse({
      ...base,
      status: 'deceased',
      birthDate: '2020-05-01',
      deceasedOn: '2019-01-01',
    });
    expect(r.error?.issues[0]?.message).toBe('Óbito anterior ao nascimento');
  });

  it('número de pedigree só com pedigree marcado; vazios viram null', () => {
    expect(patientInputSchema.safeParse({ ...base, pedigreeNumber: 'ABC' }).success).toBe(false);
    const ok = patientInputSchema.parse(base);
    expect(ok.microchip).toBeNull();
    expect(ok.birthDate).toBeNull();
  });
});
