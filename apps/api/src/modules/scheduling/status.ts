import type { AppointmentStatus } from '@clinica/contracts';

/**
 * Máquina de estados do agendamento [RN-13]. O ciclo só anda para a frente; Cancelado e Não
 * compareceu podem ser reativados (o horário é conferido de novo pela restrição do banco).
 */
const transitions: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  scheduled: ['confirmed', 'waiting', 'cancelled', 'no_show'],
  confirmed: ['waiting', 'cancelled', 'no_show'],
  waiting: ['in_progress', 'cancelled'],
  in_progress: ['ready'],
  ready: [],
  cancelled: ['scheduled'],
  no_show: ['scheduled'],
};

export function nextStatuses(status: AppointmentStatus): readonly AppointmentStatus[] {
  return transitions[status];
}

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return transitions[from].includes(to);
}

/** Antes da chegada o agendamento ainda pode mudar de horário, profissional ou animais. */
export function isEditable(status: AppointmentStatus): boolean {
  return status === 'scheduled' || status === 'confirmed';
}

/** Ocupa horário na agenda (os demais liberam o profissional). */
export function isActive(status: AppointmentStatus): boolean {
  return status !== 'cancelled' && status !== 'no_show';
}

/** "Atrasado" é derivado: o horário começou e o animal ainda não chegou (premissa L7). */
export function isLate(status: AppointmentStatus, startsAt: Date, now: Date): boolean {
  return (status === 'scheduled' || status === 'confirmed') && startsAt.getTime() < now.getTime();
}

/** Marco de tempo gravado ao entrar em cada status; alimenta média de espera e de atendimento. */
export const milestoneOf = {
  confirmed: 'confirmedAt',
  waiting: 'arrivedAt',
  in_progress: 'startedAt',
  ready: 'readyAt',
  cancelled: 'cancelledAt',
  no_show: 'cancelledAt',
} as const satisfies Partial<Record<AppointmentStatus, string>>;
