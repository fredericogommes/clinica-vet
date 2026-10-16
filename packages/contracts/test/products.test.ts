import { describe, expect, it } from 'vitest';
import { isValidGtin, markupPercent, priceForMarkup, productInputSchema } from '../src/products.js';

describe('código de barras GTIN', () => {
  it('aceita EAN-13, EAN-8, UPC-12 e GTIN-14 com dígito certo', () => {
    expect(isValidGtin('7891234567895')).toBe(true);
    expect(isValidGtin('96385074')).toBe(true);
    expect(isValidGtin('036000291452')).toBe(true);
    expect(isValidGtin('17891234567892')).toBe(true);
  });

  it('recusa dígito errado, tamanho fora do padrão e letras', () => {
    expect(isValidGtin('7891234567890')).toBe(false);
    expect(isValidGtin('12345')).toBe(false);
    expect(isValidGtin('789123456789X')).toBe(false);
  });
});

describe('markup', () => {
  it('é o ganho sobre o custo, em %', () => {
    expect(markupPercent(12.5, 8)).toBe(56.25);
    expect(markupPercent(10, 10)).toBe(0);
    expect(markupPercent(5, 10)).toBe(-50);
  });

  it('sem custo não há markup', () => {
    expect(markupPercent(10, null)).toBeNull();
    expect(markupPercent(10, 0)).toBeNull();
  });

  it('preço sugerido atinge o markup desejado, ao centavo', () => {
    expect(priceForMarkup(8, 60)).toBe(12.8);
    expect(priceForMarkup(3.33, 33.33)).toBe(4.44);
    expect(priceForMarkup(null, 60)).toBeNull();
  });
});

describe('productInputSchema', () => {
  const base = {
    kind: 'service',
    serviceKind: null,
    name: 'Consulta',
    unit: 'un',
    barcode: '',
    brandId: null,
    groupId: null,
    ncm: '',
    origin: '0',
    acquisition: 'resale',
    cfop: '',
    taxSituation: '',
    municipalServiceCode: '',
    taxProfile: '',
    salePrice: 150,
    cost: null,
    purpose: 'sale',
    desiredMarkup: null,
    allowPriceChange: false,
    showInPriceList: true,
    discountLimitPercent: null,
    defaultCommissionPercent: 0,
    commissions: [],
    tracksStock: false,
    minStock: null,
    idealStock: null,
  };

  it('serviço precisa de classificação', () => {
    const r = productInputSchema.safeParse(base);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['serviceKind']);
    expect(productInputSchema.safeParse({ ...base, serviceKind: 'consultation' }).success).toBe(
      true,
    );
  });

  it('valores em reais com no máximo duas casas', () => {
    const ok = { ...base, serviceKind: 'consultation' };
    expect(productInputSchema.safeParse({ ...ok, salePrice: 0.07 }).success).toBe(true);
    expect(productInputSchema.safeParse({ ...ok, salePrice: 19.99 }).success).toBe(true);
    expect(productInputSchema.safeParse({ ...ok, salePrice: 19.999 }).success).toBe(false);
  });
});
