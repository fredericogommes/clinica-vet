import { describe, expect, it } from 'vitest';
import { stockAdjustmentSchema } from '../src/index.js';

const entry = (lot: unknown) => ({ kind: 'entry', quantity: 2, lot, notes: 'NF 10' });

describe('entrada com lote [RN-32]', () => {
  it('normaliza o número do lote em maiúsculas', () => {
    const parsed = stockAdjustmentSchema.parse(entry({ code: ' ab-12 ', expiresOn: '2027-03-31' }));
    expect(parsed.kind === 'entry' && parsed.lot).toEqual({
      code: 'AB-12',
      expiresOn: '2027-03-31',
    });
  });

  it('recusa lote vazio, "SEM LOTE" e validade inválida', () => {
    for (const lot of [
      { code: '  ', expiresOn: '2027-03-31' },
      { code: 'sem lote', expiresOn: '2027-03-31' },
      { code: 'AB-12', expiresOn: '31/03/2027' },
      { code: 'AB-12', expiresOn: '2027-02-30' },
    ]) {
      expect(stockAdjustmentSchema.safeParse(entry(lot)).success, JSON.stringify(lot)).toBe(false);
    }
  });

  it('lote é opcional no contrato; quem exige é o produto que controla lote', () => {
    expect(
      stockAdjustmentSchema.safeParse({ kind: 'entry', quantity: 1, notes: 'NF 1' }).success,
    ).toBe(true);
  });
});
