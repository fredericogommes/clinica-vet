import type { Agenda, Appointment, TimeRange } from '@clinica/contracts';
import { toMinutes } from '@clinica/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { CalendarX2, ChevronLeft, ChevronRight, Plus, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { Button, buttonClasses } from '../../design-system/button';
import { Checkbox } from '../../design-system/checkbox';
import { Segmented, SelectField } from '../../design-system/field';
import { PageHeader, Panel } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { errorMessage } from '../../lib/api';
import { useCan } from '../../lib/session';
import { AppointmentDialog } from './appointment-dialog';
import { BookingDialog } from './booking-dialog';
import {
  addDays,
  addMonths,
  daysBetween,
  endOfMonth,
  formatLongDay,
  formatMonth,
  formatShortDay,
  localToday,
  startOfMonth,
  startOfWeek,
  weekdayOf,
  weekdayShort,
} from './dates';
import { agendaQuery } from './queries';
import { isClosed, statusLabel } from './status';
import { TimeGrid, visibleWindow, type GridColumn } from './time-grid';

export type AgendaView = 'dia' | 'semana' | 'mes';

export interface AgendaSearch {
  view: AgendaView;
  date: string | undefined;
  professionalId: string | undefined;
  showCancelled: boolean;
}

function periodOf(view: AgendaView, date: string): { from: string; to: string } {
  if (view === 'dia') return { from: date, to: date };
  if (view === 'semana') {
    const from = startOfWeek(date);
    return { from, to: addDays(from, 6) };
  }
  // Mês: semanas inteiras, para a grade começar no domingo e terminar no sábado.
  const from = startOfWeek(startOfMonth(date));
  return { from, to: addDays(startOfWeek(endOfMonth(date)), 6) };
}

function step(view: AgendaView, date: string, direction: 1 | -1): string {
  if (view === 'dia') return addDays(date, direction);
  if (view === 'semana') return addDays(date, 7 * direction);
  return addMonths(date, direction);
}

/** Une faixas que se sobrepõem (vários profissionais no mesmo dia). */
function union(ranges: TimeRange[]): TimeRange[] {
  const sorted = ranges.toSorted((a, b) => toMinutes(a.start) - toMinutes(b.start));
  const out: TimeRange[] = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && toMinutes(r.start) <= toMinutes(last.end)) {
      if (toMinutes(r.end) > toMinutes(last.end)) last.end = r.end;
    } else out.push({ ...r });
  }
  return out;
}

export function AgendaPage({ search }: { search: AgendaSearch }) {
  const can = useCan();
  const navigate = useNavigate({ from: '/agenda' });
  const date = search.date ?? localToday();
  const { from, to } = periodOf(search.view, date);
  const agenda = useQuery(agendaQuery(from, to, search.professionalId));
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [booking, setBooking] = useState<{ editing?: Appointment } | null>(null);

  const go = (
    patch: Partial<{
      view: AgendaView;
      data: string;
      profissional: string | undefined;
      cancelados: boolean;
    }>,
  ) => {
    void navigate({ search: (prev) => ({ ...prev, ...patch }) });
  };

  const title =
    search.view === 'dia'
      ? formatLongDay(date)
      : search.view === 'semana'
        ? `Semana de ${formatShortDay(from)} a ${formatShortDay(to)}`
        : formatMonth(date);

  return (
    <>
      <PageHeader
        area="Agenda"
        title={title}
        actions={
          <>
            {can('schedule.configure') ? (
              <Link to="/agenda/configuracao" className={buttonClasses('secondary')}>
                <Settings2 className="size-4" aria-hidden />
                Configuração
              </Link>
            ) : null}
            {can('schedule.manage') ? (
              <Button
                icon={<Plus className="size-4" aria-hidden />}
                onClick={() => {
                  setBooking({});
                }}
              >
                Novo agendamento
              </Button>
            ) : null}
          </>
        }
      />
      <Panel>
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-1">
              <Button
                variant="secondary"
                size="sm"
                aria-label="Período anterior"
                onClick={() => {
                  go({ data: step(search.view, date, -1) });
                }}
              >
                <ChevronLeft className="size-4" aria-hidden />
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  go({ data: agenda.data?.today ?? localToday() });
                }}
              >
                Hoje
              </Button>
              <Button
                variant="secondary"
                size="sm"
                aria-label="Próximo período"
                onClick={() => {
                  go({ data: step(search.view, date, 1) });
                }}
              >
                <ChevronRight className="size-4" aria-hidden />
              </Button>
            </div>
            <Segmented
              label="Visão"
              value={search.view}
              options={[
                { value: 'dia', label: 'Dia' },
                { value: 'semana', label: 'Semana' },
                { value: 'mes', label: 'Mês' },
              ]}
              onChange={(view) => {
                go({ view });
              }}
            />
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-56">
              <SelectField
                label="Profissional"
                value={search.professionalId ?? ''}
                placeholder="Todos"
                options={(agenda.data?.professionals ?? []).map((p) => ({
                  value: p.id,
                  label: p.name,
                }))}
                onChange={(e) => {
                  go({ profissional: e.target.value || undefined });
                }}
              />
            </div>
            <div className="pb-2">
              <Checkbox
                label="Mostrar cancelados"
                checked={search.showCancelled}
                onCheckedChange={(checked) => {
                  go({ cancelados: checked });
                }}
              />
            </div>
          </div>
        </div>
        {agenda.isPending ? (
          <SkeletonRows rows={6} columns={3} />
        ) : agenda.isError ? (
          <ErrorState message={errorMessage(agenda.error)} onRetry={() => void agenda.refetch()} />
        ) : agenda.data.professionals.length === 0 ? (
          <EmptyState
            icon={CalendarX2}
            title="Nenhum profissional com agenda"
            description="Inclua os profissionais que atendem, com horário fixo ou escala variável, na configuração da agenda."
            action={
              can('schedule.configure') ? (
                <Link to="/agenda/configuracao" className={buttonClasses('secondary', 'sm')}>
                  Configurar agenda
                </Link>
              ) : undefined
            }
          />
        ) : (
          <AgendaBody
            agenda={agenda.data}
            view={search.view}
            date={date}
            showCancelled={search.showCancelled}
            onSelect={setSelected}
            onOpenDay={(day) => {
              go({ view: 'dia', data: day });
            }}
          />
        )}
      </Panel>
      {selected ? (
        <AppointmentDialog
          key={selected.id}
          appointment={selected}
          onClose={() => {
            setSelected(null);
          }}
          onReschedule={(a) => {
            setSelected(null);
            setBooking({ editing: a });
          }}
        />
      ) : null}
      {booking ? (
        <BookingDialog
          initialDate={date}
          editing={booking.editing}
          onClose={() => {
            setBooking(null);
          }}
          onSaved={(day) => {
            setBooking(null);
            if (search.view === 'dia' && day !== date) go({ data: day });
          }}
        />
      ) : null}
    </>
  );
}

function AgendaBody({
  agenda,
  view,
  date,
  showCancelled,
  onSelect,
  onOpenDay,
}: {
  agenda: Agenda;
  view: AgendaView;
  date: string;
  showCancelled: boolean;
  onSelect: (a: Appointment) => void;
  onOpenDay: (date: string) => void;
}) {
  const appointments = agenda.appointments.filter((a) => showCancelled || !isClosed(a.status));
  const { averageWaitMinutes: wait, averageServiceMinutes: service } = agenda.metrics;
  const rangesOf = (userId: string, day: string) =>
    agenda.availability.find((x) => x.userId === userId && x.date === day)?.ranges ?? [];

  let body;
  if (view === 'mes') {
    body = (
      <MonthGrid agenda={agenda} month={date} appointments={appointments} onOpenDay={onOpenDay} />
    );
  } else {
    const days =
      view === 'dia' ? [date] : daysBetween(startOfWeek(date), addDays(startOfWeek(date), 6));
    const window = visibleWindow(
      agenda.openingHours.filter((o) => days.includes(o.date)).map((o) => o.range),
      appointments,
    );
    const columns: GridColumn[] =
      view === 'dia'
        ? agenda.professionals.map((p) => ({
            key: p.id,
            label: <span className="font-medium">{p.name}</span>,
            ranges: rangesOf(p.id, date),
            appointments: appointments.filter((a) => a.professional.id === p.id),
            nowMinutes: date === agenda.today ? agenda.nowMinutes : undefined,
          }))
        : days.map((day) => ({
            key: day,
            label: (
              <span className={clsx(day === agenda.today && 'font-semibold text-sage-700')}>
                {weekdayShort[weekdayOf(day)]} {formatShortDay(day)}
              </span>
            ),
            ranges: union(agenda.professionals.flatMap((p) => rangesOf(p.id, day))),
            appointments: appointments.filter((a) => a.date === day),
            nowMinutes: day === agenda.today ? agenda.nowMinutes : undefined,
          }));
    body = (
      <TimeGrid
        columns={columns}
        startMinute={window.start}
        endMinute={window.end}
        minColumnWidth={view === 'dia' ? 180 : 120}
        showProfessional={view === 'semana' && agenda.professionals.length > 1}
        onSelect={onSelect}
      />
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-line px-4 py-2 text-xs text-ink-muted">
        <span>
          {appointments.length === 1 ? '1 agendamento' : `${appointments.length} agendamentos`} no
          período
        </span>
        <span>
          Espera média: <strong className="text-ink">{wait === null ? '—' : `${wait} min`}</strong>
        </span>
        <span>
          Atendimento médio:{' '}
          <strong className="text-ink">{service === null ? '—' : `${service} min`}</strong>
        </span>
        {view !== 'mes' ? (
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block size-3 rounded-[3px] border border-line bg-sunken"
              aria-hidden
            />
            Fora do horário de trabalho
          </span>
        ) : null}
      </div>
      {body}
    </>
  );
}

function MonthGrid({
  agenda,
  month,
  appointments,
  onOpenDay,
}: {
  agenda: Agenda;
  month: string;
  appointments: Appointment[];
  onOpenDay: (date: string) => void;
}) {
  const days = agenda.openingHours.map((o) => o.date);
  const inMonth = (d: string) => d.slice(0, 7) === month.slice(0, 7);
  return (
    <div>
      <div className="grid grid-cols-7 border-b border-line text-center text-xs font-medium text-ink-muted">
        {weekdayShort.map((d) => (
          <div key={d} className="py-2">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const items = appointments.filter((a) => a.date === day);
          const closed = agenda.openingHours.find((o) => o.date === day)?.range === null;
          return (
            <button
              key={day}
              type="button"
              onClick={() => {
                onOpenDay(day);
              }}
              aria-label={`${formatLongDay(day)}: ${items.length} agendamentos`}
              className={clsx(
                'min-h-20 border-r border-b border-line p-1.5 text-left align-top hover:bg-sage-50 sm:min-h-28',
                closed ? 'bg-sunken' : 'bg-surface',
                !inMonth(day) && 'opacity-50',
              )}
            >
              <span
                className={clsx(
                  'inline-flex size-6 items-center justify-center rounded-full text-xs',
                  day === agenda.today ? 'bg-sage-600 font-semibold text-white' : 'text-ink',
                )}
              >
                {Number(day.slice(8))}
              </span>
              {items.length > 0 ? (
                <>
                  <span className="mt-1 block text-[11px] font-medium text-sage-700 sm:hidden">
                    {items.length}
                  </span>
                  <ul className="mt-1 hidden space-y-0.5 sm:block">
                    {items.slice(0, 3).map((a) => (
                      <li
                        key={a.id}
                        className="truncate text-[11px] text-ink"
                        title={statusLabel(a)}
                      >
                        <span className="font-mono text-ink-muted">{a.start}</span>{' '}
                        {a.patients.map((p) => p.name).join(', ')}
                      </li>
                    ))}
                    {items.length > 3 ? (
                      <li className="text-[11px] text-ink-muted">+{items.length - 3} mais</li>
                    ) : null}
                  </ul>
                </>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
