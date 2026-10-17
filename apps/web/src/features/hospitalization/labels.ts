import {
  choiceParameters,
  clinicalParameterOptions,
  numericParameterLimits,
  numericParameters,
  type ClinicalParameters,
  type HospitalizationPriority,
  type HospitalizationStatus,
} from '@clinica/contracts';

export const priorityTone = {
  routine: 'sage',
  attention: 'amber',
  urgent: 'danger',
} as const satisfies Record<HospitalizationPriority, string>;

/** Tarja do cartão no painel, pela prioridade [p.14]. */
export const priorityStripe: Record<HospitalizationPriority, string> = {
  routine: 'border-l-sage-500',
  attention: 'border-l-amber-500',
  urgent: 'border-l-danger-600',
};

export const statusTone = {
  admitted: 'sage',
  discharged: 'neutral',
  deceased: 'danger',
  cancelled: 'amber',
} as const satisfies Record<HospitalizationStatus, string>;

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

/** Duração acumulada como no painel de referência: "7 dias e 7 horas", "3 horas", "40 min". */
export function formatDuration(fromIso: string, toIso: string | null, now = new Date()): string {
  const end = toIso ? new Date(toIso) : now;
  const minutes = Math.max(0, Math.floor((end.getTime() - new Date(fromIso).getTime()) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) {
    return hours > 0
      ? `${plural(days, 'dia', 'dias')} e ${plural(hours, 'hora', 'horas')}`
      : plural(days, 'dia', 'dias');
  }
  if (hours > 0) return plural(hours, 'hora', 'horas');
  return `${String(minutes)} min`;
}

const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

/** Parâmetros preenchidos como "Apetite: Diminuído", "FC: 120 bpm". */
export function parameterItems(p: ClinicalParameters): string[] {
  const items: string[] = [];
  for (const key of choiceParameters) {
    const value = p[key];
    if (value) items.push(`${clinicalParameterOptions[key].label}: ${value}`);
  }
  for (const key of numericParameters) {
    const value = p[key];
    const limit = numericParameterLimits[key];
    if (value !== null) items.push(`${limit.label}: ${decimal.format(value)} ${limit.unit}`);
  }
  return items;
}
