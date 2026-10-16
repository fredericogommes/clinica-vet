import { describe, expect, it } from 'vitest';
import { formatMoney, moneyInput, parseDecimal } from './format';

describe('parseDecimal', () => {
  it('lê vírgula decimal e milhar com ponto', () => {
    expect(parseDecimal('12,5')).toBe(12.5);
    expect(parseDecimal('1.234,56')).toBe(1234.56);
    expect(parseDecimal('R$ 99,90')).toBe(99.9);
    expect(parseDecimal('12.5')).toBe(12.5);
    expect(parseDecimal('15%')).toBe(15);
  });

  it('vazio é null e texto inválido é NaN', () => {
    expect(parseDecimal('  ')).toBeNull();
    expect(parseDecimal('doze')).toBeNaN();
    expect(parseDecimal('1,2,3')).toBeNaN();
  });
});

describe('formatação', () => {
  it('moeda em reais', () => {
    expect(formatMoney(1234.5).replace(/\s/g, ' ')).toBe('R$ 1.234,50');
  });

  it('valor do campo com duas casas e sem milhar, para editar sem atrito', () => {
    expect(moneyInput(1234.5)).toBe('1234,50');
    expect(moneyInput(null)).toBe('');
  });
});
