const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const decimal = (min: number, max: number) =>
  new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
    useGrouping: false,
  });
const twoPlaces = decimal(2, 2);
const upToTwo = decimal(0, 2);
const upToThree = decimal(0, 3);

export const formatMoney = (value: number): string => brl.format(value);

export const formatPercent = (value: number): string => `${upToTwo.format(value)}%`;

/** Valor para um campo de texto: dinheiro com duas casas, percentuais e quantidades enxutos. */
export const moneyInput = (value: number | null): string =>
  value === null ? '' : twoPlaces.format(value);
export const percentInput = (value: number | null): string =>
  value === null ? '' : upToTwo.format(value);
export const quantityInput = (value: number | null): string =>
  value === null ? '' : upToThree.format(value);

/**
 * Lê número digitado no padrão brasileiro ("1.234,56", "12,5") ou com ponto ("12.5"). Vazio vira
 * null; texto que não é número vira NaN, que a validação recusa com mensagem no campo.
 */
export function parseDecimal(text: string): number | null {
  const t = text.trim().replace(/\s|R\$|%/g, '');
  if (t === '') return null;
  const normalized = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : Number.NaN;
}
