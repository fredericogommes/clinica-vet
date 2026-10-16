import type { RecurrenceFrequency } from '@clinica/contracts';
import { addDays, addMonths } from '../../core/zoned-time.js';

/** Datas das ocorrências de uma série [RN-14], começando pela própria data. */
export function occurrenceDates(
  first: string,
  frequency: RecurrenceFrequency,
  count: number,
): string[] {
  return Array.from({ length: count }, (_, i) => {
    switch (frequency) {
      case 'daily':
        return addDays(first, i);
      case 'weekly':
        return addDays(first, 7 * i);
      case 'biweekly':
        return addDays(first, 14 * i);
      case 'monthly':
        return addMonths(first, i);
    }
  });
}
