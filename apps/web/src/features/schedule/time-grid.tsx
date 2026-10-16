import { formatMinutes, toMinutes, type Appointment, type TimeRange } from '@clinica/contracts';
import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { placeInLanes } from './lanes';
import { blockClasses, statusLabel } from './status';

const HOUR_PX = 80;
const px = (minutes: number) => (minutes / 60) * HOUR_PX;

export interface GridColumn {
  key: string;
  label: ReactNode;
  /** Faixas em que há atendimento; o resto do dia aparece sombreado. */
  ranges: TimeRange[];
  appointments: Appointment[];
  /** Minuto atual, só na coluna de hoje. */
  nowMinutes?: number | undefined;
}

/** Grade de horários com eixo de horas à esquerda e uma coluna por profissional ou por dia. */
export function TimeGrid({
  columns,
  startMinute,
  endMinute,
  minColumnWidth,
  showProfessional,
  onSelect,
}: {
  columns: GridColumn[];
  startMinute: number;
  endMinute: number;
  minColumnWidth: number;
  showProfessional: boolean;
  onSelect: (appointment: Appointment) => void;
}) {
  const hours: number[] = [];
  for (let m = Math.ceil(startMinute / 60) * 60; m < endMinute; m += 60) hours.push(m);
  const height = px(endMinute - startMinute);
  const template = `3.5rem repeat(${columns.length}, minmax(${minColumnWidth}px, 1fr))`;

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: 56 + columns.length * minColumnWidth }}>
        <div
          className="sticky top-0 z-20 grid border-b border-line bg-surface"
          style={{ gridTemplateColumns: template }}
        >
          <div />
          {columns.map((c) => (
            <div key={c.key} className="border-l border-line px-2 py-2 text-center text-sm">
              {c.label}
            </div>
          ))}
        </div>
        <div className="grid" style={{ gridTemplateColumns: template }}>
          <div className="relative" style={{ height }} aria-hidden>
            {hours.map((m) => (
              <span
                key={m}
                className={clsx(
                  'absolute right-2 font-mono text-[11px] text-ink-faint',
                  // O primeiro rótulo não pode subir para fora da grade.
                  m === startMinute ? 'translate-y-0.5' : '-translate-y-1/2',
                )}
                style={{ top: px(m - startMinute) }}
              >
                {formatMinutes(m)}
              </span>
            ))}
          </div>
          {columns.map((c) => (
            <div key={c.key} className="relative border-l border-line bg-sunken" style={{ height }}>
              {c.ranges.map((r) => (
                <div
                  key={r.start}
                  className="absolute inset-x-0 bg-surface"
                  style={{
                    top: px(toMinutes(r.start) - startMinute),
                    height: px(toMinutes(r.end) - toMinutes(r.start)),
                  }}
                />
              ))}
              {hours.map((m) => (
                <div
                  key={m}
                  className="pointer-events-none absolute inset-x-0 border-t border-line"
                  style={{ top: px(m - startMinute) }}
                />
              ))}
              {c.nowMinutes !== undefined &&
              c.nowMinutes >= startMinute &&
              c.nowMinutes <= endMinute ? (
                <div
                  className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-danger-600"
                  style={{ top: px(c.nowMinutes - startMinute) }}
                  aria-hidden
                />
              ) : null}
              {placeInLanes(c.appointments).map(({ item: a, lane, lanes }) => {
                const top = px(Math.max(toMinutes(a.start), startMinute) - startMinute);
                const bottom = px(Math.min(toMinutes(a.end), endMinute) - startMinute);
                const names = `${a.client.name} – ${a.patients.map((p) => p.name).join(', ')}`;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      onSelect(a);
                    }}
                    aria-label={`${a.start} às ${a.end}, ${names}, ${a.type.name}${showProfessional ? `, ${a.professional.name}` : ''}, ${statusLabel(a)}`}
                    className={clsx(
                      'absolute z-[5] overflow-hidden rounded-[6px] border border-l-4 px-1.5 py-1 text-left text-xs leading-tight shadow-panel hover:z-10 hover:shadow-overlay focus-visible:z-10',
                      blockClasses(a),
                    )}
                    style={{
                      top: top + 1,
                      height: Math.max(bottom - top - 2, 18),
                      left: `calc(${(lane / lanes) * 100}% + 2px)`,
                      width: `calc(${100 / lanes}% - 4px)`,
                    }}
                  >
                    {toMinutes(a.end) - toMinutes(a.start) <= 30 ? (
                      <span className="block truncate">
                        <span className="font-mono text-ink-muted">{a.start}</span>{' '}
                        <span className="font-medium">{names}</span>
                      </span>
                    ) : (
                      <>
                        <span className="block truncate font-medium">{names}</span>
                        <span className="block truncate text-ink-muted">
                          <span className="font-mono">{a.start}</span> · {a.type.name}
                        </span>
                        {showProfessional ? (
                          <span className="block truncate text-ink-muted">
                            {a.professional.name}
                          </span>
                        ) : null}
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Janela de horas exibida: o funcionamento do período, ampliado para caber os agendamentos. */
export function visibleWindow(
  opening: (TimeRange | null)[],
  appointments: Pick<Appointment, 'start' | 'end'>[],
): { start: number; end: number } {
  const starts = [
    ...opening.flatMap((r) => (r ? [toMinutes(r.start)] : [])),
    ...appointments.map((a) => toMinutes(a.start)),
  ];
  const ends = [
    ...opening.flatMap((r) => (r ? [toMinutes(r.end)] : [])),
    ...appointments.map((a) => toMinutes(a.end)),
  ];
  if (starts.length === 0) return { start: 8 * 60, end: 18 * 60 };
  return {
    start: Math.floor(Math.min(...starts) / 60) * 60,
    end: Math.min(24 * 60, Math.ceil(Math.max(...ends) / 60) * 60),
  };
}
