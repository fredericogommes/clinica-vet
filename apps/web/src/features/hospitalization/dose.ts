import { calculateDose, type Prescription, type ScheduledDose } from '@clinica/contracts';
import { isoToLocalInput } from '../clinical/labels';

export const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });

type Posology = Pick<Prescription, 'dose' | 'doseUnit' | 'route' | 'intervalHours'>;

/** "25 mg/kg IV a cada 8 h". */
export const posology = (p: Posology) =>
  `${number.format(p.dose)} ${p.doseUnit} ${p.route} a cada ${String(p.intervalHours)} h`;

/** Dose do horário pelo peso atual: "310 mg · 0,62 mL". */
export function doseText(
  p: Pick<Prescription, 'dose' | 'doseUnit' | 'concentration'>,
  weightKg: number | null,
) {
  const calc = calculateDose({ ...p, weightKg });
  if (calc.missingWeight) return 'Registre o peso para calcular a dose';
  if (calc.amount === null) return '';
  const amount = `${number.format(calc.amount)} ${calc.amountUnit}`;
  return calc.volumeMl === null || calc.amountUnit === 'mL'
    ? amount
    : `${amount} · ${number.format(calc.volumeMl)} mL`;
}

/** Próxima hora cheia, como valor de datetime-local no fuso da unidade. */
export function nextFullHour(timeZone: string) {
  const local = isoToLocalInput(new Date(Date.now() + 3_600_000).toISOString(), timeZone);
  return `${local.slice(0, 13)}:00`;
}

export type DoseState = 'done' | 'skipped' | 'overdue' | 'pending';

export const doseStateLabels: Record<DoseState, string> = {
  done: 'Executado',
  skipped: 'Não executado',
  overdue: 'Vencido',
  pending: 'Programado',
};

export function doseState(d: ScheduledDose, now = Date.now()): DoseState {
  if (d.execution) return d.execution.status;
  return new Date(d.scheduledAt).getTime() < now ? 'overdue' : 'pending';
}
