/** Datas de calendário como texto AAAA-MM-DD, sem fuso: a agenda pensa no dia da unidade. */

export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const asUtc = (date: string) => new Date(`${date}T00:00:00Z`);

export function addDays(date: string, days: number): string {
  return new Date(asUtc(date).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

export function addMonths(date: string, months: number): string {
  const d = asUtc(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1))
    .toISOString()
    .slice(0, 10);
}

export const weekdayOf = (date: string): number => asUtc(date).getUTCDay();

/** Semana de domingo a sábado, como no calendário brasileiro. */
export const startOfWeek = (date: string): string => addDays(date, -weekdayOf(date));

export const startOfMonth = (date: string): string => `${date.slice(0, 7)}-01`;

export function endOfMonth(date: string): string {
  return addDays(addMonths(startOfMonth(date), 1), -1);
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export const weekdayShort = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const weekdayLong = [
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
];

const monthFormat = new Intl.DateTimeFormat('pt-BR', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const longFormat = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
const shortFormat = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'UTC',
});

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "outubro de 2026" → "Outubro de 2026". */
export const formatMonth = (date: string) => capitalize(monthFormat.format(asUtc(date)));
/** "segunda-feira, 19 de outubro". */
export const formatLongDay = (date: string) => capitalize(longFormat.format(asUtc(date)));
/** "19/10". */
export const formatShortDay = (date: string) => shortFormat.format(asUtc(date));
/** "19/10/2026". */
export const formatBrDate = (date: string) => date.split('-').reverse().join('/');
