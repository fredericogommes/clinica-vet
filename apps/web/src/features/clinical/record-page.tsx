import {
  formatAge,
  type Appointment,
  type ClinicalEvent,
  type ClinicalEventKind,
  type ClinicalRecord,
} from '@clinica/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { CalendarDays, Mail, PawPrint, Phone, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { buttonClasses } from '../../design-system/button';
import { Badge, Panel } from '../../design-system/layout';
import { ErrorState, SkeletonRows } from '../../design-system/states';
import { errorMessage } from '../../lib/api';
import { useCan } from '../../lib/session';
import { formatPhone } from '../clients/format';
import { patientSexLabels } from '../patients/labels';
import { AppointmentDialog } from '../schedule/appointment-dialog';
import { formatBrDate } from '../schedule/dates';
import { statusLabel, statusTone } from '../schedule/status';
import { EventEditor, type EditorState } from './event-editors';
import { formatKg, kindIcons, kindLabel, kindOrder, zoned } from './labels';
import { clinicalRecordQuery } from './queries';
import { ProtocolsPanel } from './protocols-panel';
import { TimelinePanel } from './timeline';
import { WeightChart } from './weight-chart';
import { PatientSalePanel } from '../sales/patient-sale-panel';

/**
 * Ficha clínica em três colunas [RN-16]: venda aberta e agenda do animal, linha do tempo e ações.
 * O que se lança na ficha cai na venda aberta do animal [RN-19].
 */
export function ClinicalRecordPage({ patientId }: { patientId: string }) {
  const can = useCan();
  const record = useQuery(clinicalRecordQuery(patientId));
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [tab, setTab] = useState<'timeline' | 'weight' | 'protocols'>('timeline');

  if (record.isPending) return <SkeletonRows rows={8} />;
  if (record.isError) {
    return (
      <ErrorState message={errorMessage(record.error)} onRetry={() => void record.refetch()} />
    );
  }
  const r = record.data;
  const writable = can('clinical.record') && !r.patient.archived;
  const open = (kind: ClinicalEventKind, appointment?: Appointment) => {
    setEditor({ kind, event: null, appointment: appointment ?? null });
  };
  const applyVaccine = (vaccineId: string) => {
    setEditor({ kind: 'vaccine', event: null, appointment: null, vaccineId });
  };
  const edit = (event: ClinicalEvent) => {
    setEditor({ kind: event.kind, event, appointment: null });
  };

  return (
    <>
      <RecordHeader record={r} />

      <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)_15rem]">
        {writable ? (
          <Panel
            className="order-1 p-4 lg:col-span-2 xl:order-3 xl:col-span-1 xl:self-start"
            labelledBy="add-title"
          >
            <h2 id="add-title" className="mb-3 font-display text-[15px] font-semibold">
              Adicionar
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2">
              {kindOrder.map((kind) => {
                const Icon = kindIcons[kind];
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => {
                      open(kind);
                    }}
                    className="flex flex-col items-center gap-1.5 rounded-control border border-line bg-surface px-2 py-3 text-[13px] font-medium text-ink transition-colors hover:border-sage-500 hover:bg-sage-50"
                  >
                    <Icon className="size-5 text-sage-600" aria-hidden />
                    {kindLabel(kind)}
                  </button>
                );
              })}
            </div>
          </Panel>
        ) : null}

        <div className="order-3 space-y-5 lg:order-2 xl:order-1">
          {can('sales.view') ? (
            <PatientSalePanel
              patientId={patientId}
              patientName={r.patient.name}
              writable={!r.patient.archived}
            />
          ) : null}
          <AppointmentsColumn
            record={r}
            onStartEncounter={
              writable
                ? (appointment) => {
                    open('encounter', appointment);
                  }
                : undefined
            }
          />
        </div>

        <Panel className="order-2 min-w-0 lg:order-3 xl:order-2" labelledBy="history-title">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 pt-3">
            <h2 id="history-title" className="sr-only">
              Histórico
            </h2>
            <div role="tablist" aria-label="Histórico" className="flex gap-4 overflow-x-auto">
              {(
                [
                  ['timeline', 'Linha do tempo'],
                  ['weight', 'Evolução do peso'],
                  ['protocols', 'Protocolos'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  onClick={() => {
                    setTab(value);
                  }}
                  className={clsx(
                    '-mb-px shrink-0 border-b-2 pb-2.5 text-sm font-medium whitespace-nowrap',
                    tab === value
                      ? 'border-sage-600 text-ink'
                      : 'border-transparent text-ink-muted hover:text-ink',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div
            role="tabpanel"
            aria-label={
              tab === 'timeline'
                ? 'Linha do tempo'
                : tab === 'weight'
                  ? 'Evolução do peso'
                  : 'Protocolos'
            }
          >
            {tab === 'timeline' ? (
              <TimelinePanel
                patientId={patientId}
                timeZone={r.timeZone}
                patientName={r.patient.name}
                onEdit={edit}
              />
            ) : tab === 'weight' ? (
              <WeightChart weights={r.weights} timeZone={r.timeZone} />
            ) : (
              <ProtocolsPanel
                patientId={patientId}
                patientName={r.patient.name}
                timeZone={r.timeZone}
                writable={writable}
                onApply={applyVaccine}
              />
            )}
          </div>
        </Panel>
      </div>

      {editor ? (
        <EventEditor
          state={editor}
          record={r}
          onClose={() => {
            setEditor(null);
          }}
        />
      ) : null}
    </>
  );
}

function RecordHeader({ record }: { record: ClinicalRecord }) {
  const can = useCan();
  const p = record.patient;
  const z = zoned(record.timeZone);
  const facts = [
    p.speciesName,
    p.breedName,
    p.sex === 'unknown' ? null : patientSexLabels[p.sex],
    p.sterilized === null ? null : p.sterilized ? 'Castrado' : 'Não castrado',
    p.birthDate && p.status === 'alive' ? formatAge(p.birthDate) : null,
  ].filter(Boolean);

  return (
    <header className="mb-5 space-y-3">
      <Panel className="flex flex-col gap-4 p-4 md:flex-row md:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            className="flex size-14 shrink-0 items-center justify-center rounded-full bg-sage-50 text-sage-600"
            aria-hidden
          >
            <PawPrint className="size-6" />
          </span>
          <div className="min-w-0">
            <p className="font-mono text-[11px] font-medium tracking-[0.08em] text-sage-600 uppercase">
              Ficha clínica · #{p.code}
            </p>
            <h1 className="flex flex-wrap items-center gap-2 font-display text-[24px] leading-tight font-semibold">
              {p.name}
              {p.status === 'deceased' ? <Badge>Óbito</Badge> : null}
              {p.archived ? <Badge tone="amber">Arquivada</Badge> : null}
            </h1>
            <p className="text-sm text-ink-muted">{facts.join(' · ') || 'Sem dados de cadastro'}</p>
          </div>
        </div>
        <dl className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-1 text-sm md:border-l md:border-line md:pl-5">
          <div className="col-span-2 sm:col-span-1">
            <dt className="text-xs text-ink-muted">Peso atual</dt>
            <dd className="font-medium">
              {record.currentWeight ? (
                <>
                  {formatKg(record.currentWeight.weightKg)}{' '}
                  <span className="text-xs font-normal text-ink-muted">
                    em {z.day(record.currentWeight.occurredAt)}
                  </span>
                </>
              ) : (
                <span className="text-ink-faint">Sem pesagem</span>
              )}
            </dd>
          </div>
          <div className="col-span-2 min-w-0 sm:col-span-1">
            <dt className="text-xs text-ink-muted">Responsável</dt>
            <dd className="truncate font-medium">
              {can('clients.view') ? (
                <Link
                  to="/clientes/$clientId"
                  params={{ clientId: record.owner.id }}
                  className="hover:text-sage-700 hover:underline"
                >
                  {record.owner.name}
                </Link>
              ) : (
                record.owner.name
              )}{' '}
              <span className="font-mono text-xs font-normal text-ink-muted">
                #{record.owner.code}
              </span>
            </dd>
          </div>
          <div className="col-span-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            {record.owner.phone ? (
              <a
                href={`tel:${record.owner.phone}`}
                className="inline-flex items-center gap-1 hover:underline"
              >
                <Phone className="size-3.5 text-ink-muted" aria-hidden />
                {formatPhone(record.owner.phone)}
              </a>
            ) : null}
            {record.owner.email ? (
              <a
                href={`mailto:${record.owner.email}`}
                className="inline-flex min-w-0 items-center gap-1 hover:underline"
              >
                <Mail className="size-3.5 shrink-0 text-ink-muted" aria-hidden />
                <span className="truncate">{record.owner.email}</span>
              </a>
            ) : null}
          </div>
        </dl>
        {can('patients.view') ? (
          <Link
            to="/animais/$patientId"
            params={{ patientId: p.id }}
            className={clsx(buttonClasses('secondary', 'sm'), 'self-start md:self-center')}
          >
            Cadastro do animal
          </Link>
        ) : null}
      </Panel>
      {p.markings.length > 0 ? (
        <div
          role="note"
          aria-label="Marcações do animal"
          className="flex flex-wrap items-center gap-2 rounded-panel border border-amber-500/40 border-l-4 border-l-amber-500 bg-amber-50 px-4 py-2.5"
        >
          <TriangleAlert className="size-4 text-amber-700" aria-hidden />
          {p.markings.map((m) => (
            <span
              key={m}
              className="rounded-full border border-amber-500/40 bg-surface px-2.5 py-0.5 text-sm font-semibold text-amber-700"
            >
              {m}
            </span>
          ))}
        </div>
      ) : null}
      {p.archived ? (
        <p className="rounded-control bg-sunken px-3 py-2 text-sm text-ink-muted">
          Ficha arquivada: o histórico continua disponível, mas nada novo é registrado até ela ser
          restaurada no cadastro do animal.
        </p>
      ) : null}
    </header>
  );
}

function AppointmentsColumn({
  record,
  onStartEncounter,
}: {
  record: ClinicalRecord;
  onStartEncounter: ((appointment: Appointment) => void) | undefined;
}) {
  const [selected, setSelected] = useState<Appointment | null>(null);
  if (record.appointments === null) return null;
  const today = zoned(record.timeZone).isoDay(new Date().toISOString());
  return (
    <Panel labelledBy="agenda-title">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 id="agenda-title" className="font-display text-[15px] font-semibold">
          Hoje e próximos
        </h2>
        <Link
          to="/agenda"
          className="text-xs text-sage-700 hover:underline"
          aria-label="Abrir a agenda"
        >
          Agenda
        </Link>
      </div>
      {record.appointments.length === 0 ? (
        <p className="flex items-center gap-2 px-4 py-4 text-sm text-ink-muted">
          <CalendarDays className="size-4 shrink-0" aria-hidden />
          Nenhum agendamento a partir de hoje nesta unidade.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {record.appointments.map((a) => (
            <li key={a.id} className="space-y-2 px-4 py-3">
              <button
                type="button"
                onClick={() => {
                  setSelected(a);
                }}
                className="block w-full text-left"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm">
                    {a.date === today ? 'Hoje' : formatBrDate(a.date)}, {a.start}
                  </span>
                  <Badge tone={statusTone(a)}>{statusLabel(a)}</Badge>
                </span>
                <span className="mt-0.5 block text-sm">{a.type.name}</span>
                <span className="block text-xs text-ink-muted">{a.professional.name}</span>
              </button>
              {onStartEncounter && a.date === today ? (
                <button
                  type="button"
                  onClick={() => {
                    onStartEncounter(a);
                  }}
                  className={buttonClasses('secondary', 'sm')}
                >
                  Registrar atendimento
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {selected ? (
        <AppointmentDialog
          appointment={selected}
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </Panel>
  );
}
