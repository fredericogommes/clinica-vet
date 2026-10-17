import {
  choiceParameters,
  clinicalParameterOptions,
  formatAge,
  hospitalizationEntryKindLabels,
  hospitalizationPriorityLabels,
  hospitalizationStatusLabels,
  numericParameterLimits,
  numericParameters,
  type ClinicalParameters,
  type HospitalizationDetail,
  type HospitalizationEntry,
} from '@clinica/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Activity,
  ArrowLeftRight,
  BedDouble,
  ClipboardPlus,
  FileText,
  HeartPulse,
  LogOut,
  Pencil,
  Phone,
  Scale,
  Stethoscope,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { Button, buttonClasses } from '../../design-system/button';
import { Badge, PageHeader, Panel, Section } from '../../design-system/layout';
import { ErrorState, SkeletonRows } from '../../design-system/states';
import { errorMessage } from '../../lib/api';
import { formatCalendarDate, formatDateTime } from '../../lib/format';
import { useCan } from '../../lib/session';
import { formatPhone } from '../clients/format';
import { formatKg } from '../clinical/labels';
import { patientSexLabels } from '../patients/labels';
import { localToday } from '../schedule/dates';
import {
  BoxDialog,
  CancelDialog,
  CloseDialog,
  EditDialog,
  EntryDialog,
  type EntryKind,
} from './dialogs';
import { formatDuration, priorityTone, statusTone } from './labels';
import { hospitalizationQuery } from './queries';

type Open =
  | { kind: 'edit' }
  | { kind: 'box' }
  | { kind: 'close'; outcome: 'discharged' | 'deceased' }
  | { kind: 'cancel' }
  | { kind: 'entry'; entry: EntryKind };

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

const entryIcons = {
  admission: BedDouble,
  occurrence: ClipboardPlus,
  weight: Scale,
  parameters: HeartPulse,
  report: FileText,
  box: ArrowLeftRight,
  update: Pencil,
  discharge: LogOut,
  death: XCircle,
  cancel: XCircle,
} as const;

function Entry({ e }: { e: HospitalizationEntry }) {
  const Icon = entryIcons[e.kind];
  return (
    <li className="flex gap-3 py-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-sage-50 text-sage-700">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-medium text-ink">{hospitalizationEntryKindLabels[e.kind]}</span>
          <span className="text-xs text-ink-muted">
            {formatDateTime(e.occurredAt)} · {e.author}
          </span>
        </p>
        {e.weightKg !== null ? (
          <p className="mt-0.5 font-mono text-sm tabular-nums">{formatKg(e.weightKg)}</p>
        ) : null}
        {e.parameters ? (
          <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Parâmetros registrados">
            {parameterItems(e.parameters).map((item) => (
              <li
                key={item}
                className="rounded-full border border-line bg-sunken px-2 py-0.5 text-xs text-ink"
              >
                {item}
              </li>
            ))}
          </ul>
        ) : null}
        {e.text ? (
          <p className="mt-1 text-sm break-words whitespace-pre-line text-ink">{e.text}</p>
        ) : null}
      </div>
    </li>
  );
}

function Header({ h }: { h: HospitalizationDetail }) {
  const can = useCan();
  const p = h.patient;
  const animal = [
    p.species,
    p.breed,
    patientSexLabels[p.sex],
    p.birthDate ? formatAge(p.birthDate) : null,
  ].filter(Boolean);
  const late =
    h.status === 'admitted' &&
    h.expectedDischargeOn !== null &&
    h.expectedDischargeOn < localToday();
  return (
    <Panel className="mb-5 p-4 sm:p-5" labelledBy="hospitalization-facts">
      <h2 id="hospitalization-facts" className="sr-only">
        Dados da internação
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={statusTone[h.status]}>{hospitalizationStatusLabels[h.status]}</Badge>
        {h.status === 'admitted' ? (
          <Badge tone={priorityTone[h.priority]}>{hospitalizationPriorityLabels[h.priority]}</Badge>
        ) : null}
        <span className="font-mono text-xs text-ink-muted">Internação nº {h.code}</span>
      </div>
      <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-w-0">
          <dt className="text-xs text-ink-muted">Animal</dt>
          <dd className="font-medium">
            {can('clinical.view') ? (
              <Link
                to="/atendimento/$patientId"
                params={{ patientId: p.id }}
                className="hover:text-sage-700 hover:underline"
              >
                {p.name}
              </Link>
            ) : (
              p.name
            )}
          </dd>
          <dd className="text-xs text-ink-muted">{animal.join(' · ')}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-ink-muted">Peso atual</dt>
          <dd className="font-medium">
            {p.weightKg === null ? 'Sem pesagem' : formatKg(p.weightKg)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-ink-muted">Responsável</dt>
          <dd className="truncate font-medium">{h.client.name}</dd>
          {h.client.phone ? (
            <dd>
              <a
                href={`tel:${h.client.phone}`}
                className="inline-flex items-center gap-1 text-xs hover:underline"
              >
                <Phone className="size-3 text-ink-muted" aria-hidden />
                {formatPhone(h.client.phone)}
              </a>
            </dd>
          ) : null}
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-ink-muted">Veterinário responsável</dt>
          <dd className="truncate font-medium">{h.veterinarian.name}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Internado em</dt>
          <dd className="font-medium">{formatDateTime(h.admittedAt)}</dd>
          <dd className="text-xs text-ink-muted">
            {h.status === 'admitted' ? 'Há ' : 'Durou '}
            {formatDuration(h.admittedAt, h.endedAt)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">
            {h.status === 'admitted' ? 'Previsão de alta' : 'Encerrada em'}
          </dt>
          <dd className={late ? 'font-medium text-danger-600' : 'font-medium'}>
            {h.status !== 'admitted' && h.endedAt
              ? formatDateTime(h.endedAt)
              : h.expectedDischargeOn
                ? formatCalendarDate(h.expectedDischargeOn)
                : 'Sem previsão'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Box</dt>
          <dd className="font-medium">{h.box ? `${h.box.code} · ${h.box.name}` : 'Sem box'}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Unidade</dt>
          <dd className="font-medium">{h.unit.name}</dd>
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
          <dt className="text-xs text-ink-muted">Motivo da internação</dt>
          <dd className="break-words whitespace-pre-line">{h.reason}</dd>
        </div>
        {h.outcome ? (
          <div className="sm:col-span-2 lg:col-span-4">
            <dt className="text-xs text-ink-muted">
              {h.status === 'cancelled'
                ? 'Motivo do cancelamento'
                : h.status === 'deceased'
                  ? 'Observação do óbito'
                  : 'Observações da alta'}
            </dt>
            <dd className="break-words whitespace-pre-line">{h.outcome}</dd>
          </div>
        ) : null}
      </dl>
    </Panel>
  );
}

/**
 * Ficha de internação [p.14–15]: cabeçalho com animal, responsável e prazos; ações de editar, box,
 * alta, óbito e cancelar; e o histórico com ocorrência, peso, parâmetros e relatório médico.
 */
export function HospitalizationRecordPage({ id }: { id: string }) {
  const can = useCan();
  const detail = useQuery(hospitalizationQuery(id));
  const [open, setOpen] = useState<Open | null>(null);
  if (detail.isPending) return <SkeletonRows rows={8} />;
  if (detail.isError) {
    return (
      <ErrorState message={errorMessage(detail.error)} onRetry={() => void detail.refetch()} />
    );
  }
  const h = detail.data;
  const admitted = h.status === 'admitted';
  const manage = admitted && can('hospitalization.manage');
  const record = admitted && can('hospitalization.record');
  const close = () => {
    setOpen(null);
  };
  const newest = [...h.entries].reverse();

  return (
    <>
      <PageHeader
        area="Internação"
        title={h.patient.name}
        description={`${h.client.name} · internado em ${formatDateTime(h.admittedAt)}`}
        actions={
          <>
            <Link to="/internacao" className={buttonClasses('ghost')}>
              Internados
            </Link>
            {can('clinical.view') ? (
              <Link
                to="/atendimento/$patientId"
                params={{ patientId: h.patient.id }}
                className={buttonClasses('secondary')}
              >
                <Stethoscope className="size-4" aria-hidden />
                Ficha clínica
              </Link>
            ) : null}
          </>
        }
      />
      <Header h={h} />
      {manage ? (
        <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Ações da internação">
          <Button
            variant="secondary"
            icon={<Pencil className="size-4" aria-hidden />}
            onClick={() => {
              setOpen({ kind: 'edit' });
            }}
          >
            Editar
          </Button>
          <Button
            variant="secondary"
            icon={<ArrowLeftRight className="size-4" aria-hidden />}
            onClick={() => {
              setOpen({ kind: 'box' });
            }}
          >
            Box
          </Button>
          <Button
            icon={<LogOut className="size-4" aria-hidden />}
            onClick={() => {
              setOpen({ kind: 'close', outcome: 'discharged' });
            }}
          >
            Alta
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setOpen({ kind: 'close', outcome: 'deceased' });
            }}
          >
            Óbito
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setOpen({ kind: 'cancel' });
            }}
          >
            Cancelar internação
          </Button>
        </div>
      ) : null}
      <Section title="Histórico" description="Do mais recente para o mais antigo.">
        {record ? (
          <div
            className="mb-4 flex flex-wrap gap-2"
            role="group"
            aria-label="Registrar no histórico"
          >
            {(
              [
                ['occurrence', 'Ocorrência', ClipboardPlus],
                ['weight', 'Peso', Scale],
                ['parameters', 'Parâmetros', Activity],
                ['report', 'Relatório médico', FileText],
              ] as const
            ).map(([entry, label, Icon]) => (
              <Button
                key={entry}
                size="sm"
                variant="secondary"
                icon={<Icon className="size-4" aria-hidden />}
                onClick={() => {
                  setOpen({ kind: 'entry', entry });
                }}
              >
                {label}
              </Button>
            ))}
          </div>
        ) : null}
        <ol aria-label="Histórico da internação" className="-mb-3 divide-y divide-line">
          {newest.map((e) => (
            <Entry key={e.id} e={e} />
          ))}
        </ol>
      </Section>
      {open?.kind === 'edit' ? <EditDialog h={h} onClose={close} /> : null}
      {open?.kind === 'box' ? <BoxDialog h={h} onClose={close} /> : null}
      {open?.kind === 'close' ? <CloseDialog h={h} outcome={open.outcome} onClose={close} /> : null}
      {open?.kind === 'cancel' ? <CancelDialog h={h} onClose={close} /> : null}
      {open?.kind === 'entry' ? <EntryDialog h={h} kind={open.entry} onClose={close} /> : null}
    </>
  );
}
