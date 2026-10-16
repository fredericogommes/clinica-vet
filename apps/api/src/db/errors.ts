/** Violação de UNIQUE do PostgreSQL (SQLSTATE 23505), inclusive quando o driver a embrulha em `cause`. */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && error.code === '23505') return true;
  return 'cause' in error && isUniqueViolation(error.cause);
}
