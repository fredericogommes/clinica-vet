import type { StockSituation } from '@clinica/contracts';
import { quantityInput } from '../products/format';

/** Cor de cada situação da análise de estoque, nas listas e na ficha do produto. */
export const situationTones: Record<StockSituation, 'danger' | 'amber' | 'neutral' | 'sage'> = {
  repor: 'danger',
  excesso: 'amber',
  parado: 'neutral',
  novos: 'neutral',
  adequado: 'sage',
};

export function durationLabel(days: number | null) {
  if (days === null) return 'Sem consumo';
  if (days === 1) return '1 dia';
  return `${quantityInput(days)} dias`;
}
