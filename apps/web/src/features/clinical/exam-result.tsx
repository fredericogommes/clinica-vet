import {
  examFlagLabels,
  type ExamFlag,
  type ExamResultValue,
  type ExamSeries,
} from '@clinica/contracts';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { LineChart } from 'lucide-react';
import { Fragment } from 'react';
import { Button } from '../../design-system/button';
import { Dialog } from '../../design-system/dialog';
import { Badge } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { errorMessage } from '../../lib/api';
import { weightAxis } from './weight-chart';
import { zoned } from './labels';
import { examSeriesQuery } from './queries';

const numberFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });
export const formatExamNumber = (value: number) => numberFormat.format(value);

/** "5,5 – 8,5", "até 5", "a partir de 2"; vazio quando não há faixa. */
export function formatRange(low: number | null, high: number | null): string {
  if (low !== null && high !== null) return `${formatExamNumber(low)} – ${formatExamNumber(high)}`;
  if (high !== null) return `até ${formatExamNumber(high)}`;
  if (low !== null) return `a partir de ${formatExamNumber(low)}`;
  return '';
}

export function FlagBadge({ flag }: { flag: ExamFlag | null }) {
  if (flag === null || flag === 'normal') return null;
  return <Badge tone={flag === 'high' ? 'danger' : 'amber'}>{examFlagLabels[flag]}</Badge>;
}

/** Resultado registrado [p.14]: valores por seção, faixa usada e marcação fora da referência. */
export function ExamValuesTable({
  values,
  referenceLabel,
  onSeries,
}: {
  values: ExamResultValue[];
  referenceLabel: string | null;
  /** Abre a evolução do campo numérico no animal. */
  onSeries?: ((value: ExamResultValue) => void) | undefined;
}) {
  if (values.length === 0) {
    return <p className="mt-1 text-sm text-ink-muted">Nenhum valor preenchido.</p>;
  }
  const rows: { section: string | null; values: ExamResultValue[] }[] = [];
  for (const v of values) {
    const last = rows.at(-1);
    if (last && last.section === v.section) last.values.push(v);
    else rows.push({ section: v.section, values: [v] });
  }
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[20rem] text-left text-sm">
        <caption className="pb-1 text-left text-xs text-ink-muted">
          {referenceLabel ? `Referência: ${referenceLabel}` : 'Sem faixa de referência'}
        </caption>
        <thead>
          <tr className="border-b border-line text-xs text-ink-muted">
            <th scope="col" className="py-1 pr-2 font-medium">
              Campo
            </th>
            <th scope="col" className="py-1 pr-2 text-right font-medium">
              Resultado
            </th>
            <th scope="col" className="py-1 pr-2 font-medium">
              Referência
            </th>
            <th scope="col" className="py-1 font-medium">
              <span className="sr-only">Situação</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((group, i) => (
            <Fragment key={`${group.section ?? ''}-${String(i)}`}>
              {group.section ? (
                <tr>
                  <th
                    scope="colgroup"
                    colSpan={4}
                    className="pt-2 pb-0.5 font-mono text-[11px] font-medium tracking-[0.06em] text-ink-muted uppercase"
                  >
                    {group.section}
                  </th>
                </tr>
              ) : null}
              {group.values.map((v) => {
                const numeric = typeof v.value === 'number';
                return (
                  <tr key={v.attributeId} className="border-b border-line last:border-0">
                    <th scope="row" className="py-1 pr-2 font-normal">
                      {numeric && onSeries ? (
                        <button
                          type="button"
                          className="text-left text-sage-700 hover:underline"
                          aria-label={`Evolução de ${v.name}`}
                          onClick={() => {
                            onSeries(v);
                          }}
                        >
                          {v.name}
                        </button>
                      ) : (
                        v.name
                      )}
                    </th>
                    <td
                      className={clsx(
                        'py-1 pr-2 text-right font-mono whitespace-nowrap',
                        (v.flag === 'low' || v.flag === 'high') && 'font-semibold',
                      )}
                    >
                      {typeof v.value === 'number' ? formatExamNumber(v.value) : v.value}
                      {v.unit ? (
                        <span className="ml-1 text-xs text-ink-muted">{v.unit}</span>
                      ) : null}
                    </td>
                    <td className="py-1 pr-2 font-mono text-xs whitespace-nowrap text-ink-muted">
                      {formatRange(v.low, v.high)}
                    </td>
                    <td className="py-1">
                      <FlagBadge flag={v.flag} />
                    </td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const W = 640;
const H = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 56 };

/** Evolução de um campo [p.14]: curva dos resultados publicados com a faixa normal ao fundo. */
export function ExamSeriesChart({ series, timeZone }: { series: ExamSeries; timeZone: string }) {
  const z = zoned(timeZone);
  const points = series.points;
  const latest = points.at(-1);
  const band = latest ? { low: latest.low, high: latest.high } : { low: null, high: null };
  const axis = weightAxis([
    ...points.map((p) => p.value),
    ...(band.low !== null ? [band.low] : []),
    ...(band.high !== null ? [band.high] : []),
  ]);
  const times = points.map((p) => Date.parse(p.occurredAt));
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const x = (t: number) =>
    t1 === t0
      ? PAD.left + (W - PAD.left - PAD.right) / 2
      : PAD.left + ((t - t0) / (t1 - t0)) * (W - PAD.left - PAD.right);
  const y = (v: number) =>
    PAD.top + (1 - (v - axis.min) / (axis.max - axis.min)) * (H - PAD.top - PAD.bottom);
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(times[i] ?? 0).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join(' ');
  const bandTop = y(band.high ?? axis.max);
  const bandBottom = y(band.low ?? axis.min);
  const unit = series.unit ? ` ${series.unit}` : '';

  return (
    <div className="space-y-4">
      <figure>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          role="img"
          aria-label={`${series.name}: ${String(points.length)} resultados`}
        >
          {band.low !== null || band.high !== null ? (
            <rect
              x={PAD.left}
              y={bandTop}
              width={W - PAD.left - PAD.right}
              height={Math.max(0, bandBottom - bandTop)}
              className="fill-sage-50"
            />
          ) : null}
          {axis.ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(t)}
                y2={y(t)}
                className="stroke-line"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y(t)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-ink-faint font-mono text-[11px]"
              >
                {formatExamNumber(t)}
              </text>
            </g>
          ))}
          {points[0] ? (
            <text x={PAD.left} y={H - 8} className="fill-ink-faint font-mono text-[11px]">
              {z.dateTime(points[0].occurredAt).slice(0, 10)}
            </text>
          ) : null}
          {points.length > 1 && latest ? (
            <text
              x={W - PAD.right}
              y={H - 8}
              textAnchor="end"
              className="fill-ink-faint font-mono text-[11px]"
            >
              {z.dateTime(latest.occurredAt).slice(0, 10)}
            </text>
          ) : null}
          <path d={path} fill="none" className="stroke-sage-600" strokeWidth={2} />
          {points.map((p, i) => (
            <circle
              key={p.eventId}
              cx={x(times[i] ?? 0)}
              cy={y(p.value)}
              r={4}
              className={clsx(
                'fill-surface',
                p.flag === 'high'
                  ? 'stroke-danger-600'
                  : p.flag === 'low'
                    ? 'stroke-amber-500'
                    : 'stroke-sage-600',
              )}
              strokeWidth={2}
            />
          ))}
        </svg>
        <figcaption className="mt-1 text-xs text-ink-muted">
          {band.low !== null || band.high !== null
            ? `Faixa sombreada: referência do resultado mais recente (${formatRange(band.low, band.high)}${unit}).`
            : 'Sem faixa de referência registrada.'}
        </figcaption>
      </figure>
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Resultados de {series.name}</caption>
        <thead>
          <tr className="border-b border-line text-xs text-ink-muted">
            <th scope="col" className="py-1.5 font-medium">
              Data
            </th>
            <th scope="col" className="py-1.5 text-right font-medium">
              Resultado
            </th>
            <th scope="col" className="py-1.5 pl-3 font-medium">
              Referência
            </th>
            <th scope="col" className="py-1.5 font-medium">
              <span className="sr-only">Situação</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {[...points].reverse().map((p) => (
            <tr key={p.eventId}>
              <td className="py-1.5 font-mono text-xs">{z.dateTime(p.occurredAt)}</td>
              <td className="py-1.5 text-right font-mono">
                {formatExamNumber(p.value)}
                {unit}
              </td>
              <td className="py-1.5 pl-3 font-mono text-xs text-ink-muted">
                {formatRange(p.low, p.high)}
              </td>
              <td className="py-1.5">
                <FlagBadge flag={p.flag} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ExamSeriesDialog({
  patientId,
  attribute,
  timeZone,
  onClose,
}: {
  patientId: string;
  attribute: { attributeId: string; name: string };
  timeZone: string;
  onClose: () => void;
}) {
  const series = useQuery(examSeriesQuery(patientId, attribute.attributeId));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size="lg"
      title={`Evolução: ${attribute.name}`}
      {...(series.data ? { description: `Resultados publicados de ${series.data.exam}.` } : {})}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Fechar
        </Button>
      }
    >
      {series.isPending ? (
        <SkeletonRows rows={4} columns={2} />
      ) : series.isError ? (
        <ErrorState message={errorMessage(series.error)} onRetry={() => void series.refetch()} />
      ) : series.data.points.length === 0 ? (
        <EmptyState
          icon={LineChart}
          title="Nenhum resultado publicado"
          description="Rascunhos e resultados invalidados não entram na evolução."
        />
      ) : (
        <ExamSeriesChart series={series.data} timeZone={timeZone} />
      )}
    </Dialog>
  );
}
