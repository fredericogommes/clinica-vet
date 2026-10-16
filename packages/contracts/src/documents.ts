/** Mantém só dígitos. Normalização única de CPF, CNPJ, CEP e telefones na fronteira. */
export const onlyDigits = (value: string): string => value.replace(/\D/g, '');

function checkDigit(digits: number[], weights: number[]): number {
  const sum = digits.reduce((acc, d, i) => acc + d * (weights[i] ?? 0), 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/** CPF com 11 dígitos e dígitos verificadores corretos. Rejeita sequências repetidas. */
export function isValidCpf(value: string): boolean {
  if (!/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false;
  const d = Array.from(value, Number);
  const first = checkDigit(d.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(d.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === d[9] && second === d[10];
}

/** CNPJ numérico com 14 dígitos e dígitos verificadores corretos. */
export function isValidCnpj(value: string): boolean {
  if (!/^\d{14}$/.test(value) || /^(\d)\1{13}$/.test(value)) return false;
  const d = Array.from(value, Number);
  const first = checkDigit(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(d.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === d[12] && second === d[13];
}

export const formatCpf = (v: string) => v.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
export const formatCnpj = (v: string) =>
  v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
export const formatCep = (v: string) => v.replace(/^(\d{5})(\d{3})$/, '$1-$2');
export function formatPhone(v: string): string {
  if (v.length === 11) return v.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  if (v.length === 10) return v.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
  return v;
}
