import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiRequestError } from './api';

/**
 * Mostra no campo certo os erros de validação devolvidos pela API. `prefix` remove o caminho do
 * envelope da requisição, ex. "patient." em `{ clientId, patient }`.
 */
export function applyFieldErrors<T extends FieldValues>(
  setError: UseFormSetError<T>,
  error: unknown,
  prefix = '',
): void {
  if (!(error instanceof ApiRequestError)) return;
  for (const field of error.fieldErrors) {
    const path = field.path.startsWith(prefix) ? field.path.slice(prefix.length) : field.path;
    setError(path as Path<T>, { message: field.message });
  }
}

/** Selects devolvem texto; campos opcionais de id usam null quando nada foi escolhido. */
export const emptyToNull = (value: unknown): unknown => (value === '' ? null : value);
