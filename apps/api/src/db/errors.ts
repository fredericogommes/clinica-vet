/** Violação de UNIQUE do PostgreSQL (SQLSTATE 23505), inclusive quando o driver a embrulha em `cause`. */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && error.code === '23505') return true;
  return 'cause' in error && isUniqueViolation(error.cause);
}

/** Nome da constraint UNIQUE violada, para traduzir o conflito em mensagem específica. */
export function violatedConstraint(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  if ('code' in error && error.code === '23505') {
    return 'constraint' in error && typeof error.constraint === 'string' ? error.constraint : null;
  }
  return 'cause' in error ? violatedConstraint(error.cause) : null;
}

/** Violação de EXCLUDE (SQLSTATE 23P01), usada na agenda para impedir sobreposição. */
export function isExclusionViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && error.code === '23P01') return true;
  return 'cause' in error && isExclusionViolation(error.cause);
}
