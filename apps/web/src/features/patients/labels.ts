import type { Patient } from '@clinica/contracts';

export const patientSexLabels: Record<Patient['sex'], string> = {
  female: 'Fêmea',
  male: 'Macho',
  unknown: 'Não informado',
};

export const sterilizedLabel = (value: boolean | null): string | null =>
  value === null ? null : value ? 'Sim' : 'Não';
