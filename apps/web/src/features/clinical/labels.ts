import {
  clinicalEventKindLabels,
  vitalLimits,
  type ClinicalEvent,
  type ClinicalEventKind,
  type VitalKey,
  type Vitals,
} from '@clinica/contracts';
import {
  Activity,
  Camera,
  FlaskConical,
  FileText,
  Pill,
  Scale,
  Stethoscope,
  StickyNote,
  Syringe,
  type LucideIcon,
} from 'lucide-react';

export const kindIcons: Record<ClinicalEventKind, LucideIcon> = {
  encounter: Stethoscope,
  weight: Scale,
  pathology: Activity,
  observation: StickyNote,
  photo: Camera,
  document: FileText,
  prescription: Pill,
  exam: FlaskConical,
  vaccine: Syringe,
};

/** Ordem dos botões de "Adicionar" e dos filtros por tipo. */
export const kindOrder: ClinicalEventKind[] = [
  'encounter',
  'weight',
  'pathology',
  'exam',
  'vaccine',
  'prescription',
  'document',
  'photo',
  'observation',
];

export const kindLabel = (kind: ClinicalEventKind) => clinicalEventKindLabels[kind];

const number = (digits: number, min = 0) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: min, maximumFractionDigits: digits });
/** Sempre com uma casa ao menos, para a tabela de pesagens alinhar (29,0 kg ao lado de 28,6 kg). */
const kgFormat = number(3, 1);
const oneDecimal = number(1);

export const formatKg = (kg: number) => `${kgFormat.format(kg)} kg`;

export function formatVital(key: VitalKey, value: number): string {
  const { unit } = vitalLimits[key];
  switch (key) {
    case 'weightKg':
      return formatKg(value);
    case 'temperature':
    case 'capillaryRefill':
      return `${oneDecimal.format(value)} ${unit}`;
    case 'bodyScore':
      return `${value}${unit}`;
    default:
      return `${value} ${unit}`;
  }
}

/** Sinais preenchidos, na ordem do exame: "FC 110 bpm · T 38,6 °C". */
export function vitalsSummary(vitals: Vitals): { key: VitalKey; label: string; text: string }[] {
  return (Object.keys(vitalLimits) as VitalKey[]).flatMap((key) => {
    const value = vitals[key];
    return value === null
      ? []
      : [{ key, label: vitalLimits[key].label, text: formatVital(key, value) }];
  });
}

/** Linha de resumo do evento na linha do tempo. */
export function eventHeadline(e: ClinicalEvent): string {
  const d = e.data;
  switch (d.kind) {
    case 'encounter':
      return d.summary || d.type?.name || 'Atendimento';
    case 'weight':
      return formatKg(d.weightKg);
    case 'pathology':
      return d.pathology.code ? `${d.pathology.code} · ${d.pathology.name}` : d.pathology.name;
    case 'observation':
      return d.text.split('\n')[0] ?? '';
    case 'photo':
      return d.caption || 'Foto clínica';
    case 'document':
    case 'prescription':
      return d.title;
    case 'exam': {
      const out = d.values.filter((v) => v.flag === 'low' || v.flag === 'high').length;
      return out ? `${d.exam.name} · ${String(out)} fora da referência` : d.exam.name;
    }
    case 'vaccine':
      return `${d.vaccine.name} · ${d.dose}`;
  }
}

const dateTime = (timeZone: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
const dayLong = (timeZone: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
const timeOnly = (timeZone: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit' });
const isoDay = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Datas da ficha sempre no fuso da unidade, não no do navegador. */
export const zoned = (timeZone: string) => ({
  dateTime: (iso: string) => dateTime(timeZone).format(new Date(iso)),
  day: (iso: string) => dayLong(timeZone).format(new Date(iso)),
  time: (iso: string) => timeOnly(timeZone).format(new Date(iso)),
  isoDay: (iso: string) => isoDay(timeZone).format(new Date(iso)),
});

/** Valor de <input type="datetime-local"> no fuso da unidade → instante ISO com deslocamento. */
export function localInputToIso(value: string, timeZone: string): string {
  const [date, time] = value.split('T') as [string, string];
  const guess = Date.parse(`${date}T${time}:00Z`);
  const offset = (instant: number) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date(instant));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    return (
      Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute')) - instant
    );
  };
  const first = guess - offset(guess);
  return new Date(guess - offset(first)).toISOString();
}

/** Instante → valor de <input type="datetime-local"> no fuso da unidade. */
export function isoToLocalInput(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
