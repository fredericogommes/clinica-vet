import { describe, expect, it } from 'vitest';
import { allocateDiscount, saleInputSchema, saleTotals } from '../src/sales.js';

const id = '0190a6f0-0000-7000-8000-000000000001';

describe('allocateDiscount', () => {
  it('soma exatamente o desconto, pelo maior resto', () => {
    expect(allocateDiscount([1000, 1000, 1000], 100)).toEqual([34, 33, 33]);
    expect(allocateDiscount([999, 1], 10)).toEqual([10, 0]);
    expect(allocateDiscount([0, 0], 10)).toEqual([0, 0]);
    expect(allocateDiscount([500, 1500], 0)).toEqual([0, 0]);
  });
});

describe('saleTotals', () => {
  it('calcula em centavos, sem erro de ponto flutuante', () => {
    const t = saleTotals(
      [
        { unitPrice: 0.1, quantity: 3 },
        { unitPrice: 19.99, quantity: 1.5 },
      ],
      { mode: 'percent', value: 10 },
    );
    // 0,30 + 29,985 → 29,99 (arredondado por item) = 30,29; 10% = 3,03.
    expect(t.grossCents).toBe(3029);
    expect(t.discountCents).toBe(303);
    expect(t.netCents).toBe(2726);
    expect(t.items.reduce((a, i) => a + i.discountCents, 0)).toBe(303);
  });

  it('desconto maior que o total é sinalizado e limitado', () => {
    const t = saleTotals([{ unitPrice: 10, quantity: 1 }], { mode: 'amount', value: 15 });
    expect(t.exceedsGross).toBe(true);
    expect(t.netCents).toBe(0);
  });
});

describe('saleInputSchema', () => {
  const base = {
    kind: 'sale',
    saleType: 'in_person_consumer',
    clientId: null,
    patientId: null,
    items: [{ productId: id, professionalId: id, quantity: 1, unitPrice: null }],
    discount: { mode: 'amount', value: 0 },
    notes: '',
  } as const;

  it('animal exige responsável', () => {
    expect(saleInputSchema.safeParse({ ...base, patientId: id }).success).toBe(false);
  });

  it('percentual acima de 100 e quantidade zero são recusados', () => {
    expect(
      saleInputSchema.safeParse({ ...base, discount: { mode: 'percent', value: 101 } }).success,
    ).toBe(false);
    expect(
      saleInputSchema.safeParse({ ...base, items: [{ ...base.items[0], quantity: 0 }] }).success,
    ).toBe(false);
    expect(saleInputSchema.safeParse({ ...base, items: [] }).success).toBe(false);
    expect(saleInputSchema.safeParse(base).success).toBe(true);
  });
});
