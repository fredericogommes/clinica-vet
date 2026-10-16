import {
  appointmentStatusLabels,
  type Appointment,
  type AppointmentStatus,
} from '@clinica/contracts';

/** Rótulo exibido: "Atrasado" sobrepõe Agendado/Confirmado quando o horário já passou. */
export function statusLabel(a: Pick<Appointment, 'status' | 'late'>): string {
  return a.late ? 'Atrasado' : appointmentStatusLabels[a.status];
}

type Tone = 'neutral' | 'sage' | 'amber' | 'danger';

export function statusTone(a: Pick<Appointment, 'status' | 'late'>): Tone {
  if (a.late) return 'danger';
  switch (a.status) {
    case 'confirmed':
    case 'in_progress':
    case 'ready':
      return 'sage';
    case 'waiting':
      return 'amber';
    default:
      return 'neutral';
  }
}

/** Classes do bloco na grade: a borda esquerda carrega o status. */
export function blockClasses(a: Pick<Appointment, 'status' | 'late'>): string {
  if (a.status === 'cancelled' || a.status === 'no_show') {
    return 'border-line-strong bg-sunken text-ink-faint line-through';
  }
  if (a.late) return 'border-danger-600 bg-danger-50 text-ink';
  switch (a.status) {
    case 'scheduled':
      return 'border-line-strong bg-surface text-ink';
    case 'confirmed':
      return 'border-sage-500 bg-sage-50 text-ink';
    case 'waiting':
      return 'border-amber-500 bg-amber-50 text-ink';
    case 'in_progress':
      return 'border-sage-700 bg-sage-100 text-ink';
    case 'ready':
      return 'border-success-600 bg-success-50 text-ink';
  }
}

/** Verbo do botão que leva a cada status. */
export const actionLabels: Record<AppointmentStatus, string> = {
  scheduled: 'Reativar',
  confirmed: 'Confirmar',
  waiting: 'Registrar chegada',
  in_progress: 'Iniciar atendimento',
  ready: 'Animal pronto',
  cancelled: 'Cancelar agendamento',
  no_show: 'Não compareceu',
};

export const isClosed = (status: AppointmentStatus) =>
  status === 'cancelled' || status === 'no_show';
