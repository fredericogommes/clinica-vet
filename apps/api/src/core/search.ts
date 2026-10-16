import { sql, type SQL, type AnyColumn } from 'drizzle-orm';

/** Escapa curingas do LIKE para que o termo digitado seja tratado literalmente. */
export const likeEscape = (term: string): string => term.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Busca por trecho sem diferenciar maiúsculas nem acentos. */
export function containsText(column: AnyColumn | SQL, term: string): SQL {
  return sql`unaccent(lower(${column})) like unaccent(lower(${`%${likeEscape(term)}%`}))`;
}
