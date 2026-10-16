import { describe, expect, it } from 'vitest';
import {
  feeCents,
  paymentMethodInputSchema,
  receivableOffsetDays,
  splitInstallments,
} from '../src/payments.js';

describe('parcelas [RN-27]', () => {
  it('divide em parcelas iguais e põe os centavos que sobram na primeira', () => {
    expect(splitInstallments(10_000, 3)).toEqual([3_334, 3_333, 3_333]);
    expect(splitInstallments(24_000, 3)).toEqual([8_000, 8_000, 8_000]);
    expect(splitInstallments(5, 1)).toEqual([5]);
    for (const [amount, n] of [
      [99_999, 7],
      [1_001, 12],
      [3, 3],
    ] as const) {
      const parts = splitInstallments(amount, n);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(amount);
      expect(Math.max(...parts) - Math.min(...parts)).toBeLessThan(n);
    }
  });

  it('taxa arredonda ao centavo e a data segue o prazo mais 30 dias por parcela', () => {
    expect(feeCents(8_000, 3.5)).toBe(280);
    expect(feeCents(3_334, 2.99)).toBe(100);
    expect(feeCents(1_000, 0)).toBe(0);
    expect([1, 2, 3].map((n) => receivableOffsetDays(30, n))).toEqual([30, 60, 90]);
    expect(receivableOffsetDays(45, 1)).toBe(45);
  });

  it('só crédito e convênio parcelam', () => {
    const base = {
      name: 'Rede Elo Débito',
      acquirer: 'Rede',
      brand: 'Elo',
      settlementDays: 1,
      feePercent: 1.5,
    };
    expect(
      paymentMethodInputSchema.safeParse({ ...base, kind: 'debit', maxInstallments: 1 }).success,
    ).toBe(true);
    expect(
      paymentMethodInputSchema.safeParse({ ...base, kind: 'debit', maxInstallments: 2 }).success,
    ).toBe(false);
    expect(
      paymentMethodInputSchema.safeParse({ ...base, kind: 'voucher', maxInstallments: 3 }).success,
    ).toBe(true);
    expect(
      paymentMethodInputSchema.safeParse({ ...base, kind: 'credit', maxInstallments: 25 }).success,
    ).toBe(false);
  });
});
