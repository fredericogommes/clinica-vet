import type { WeightPoint } from '@clinica/contracts';
import { Scale } from 'lucide-react';
import { EmptyState } from '../../design-system/states';
import { formatKg, zoned } from './labels';

const W = 640;
const H = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 52 };

/** Escala "redonda" para o eixo de peso, com folga acima e abaixo. */
export function weightAxis(values: number[]): { min: number; max: number; ticks: number[] } {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = Math.max(hi - lo, Math.max(hi * 0.1, 0.1));
  const rough = span / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? rough;
  const min = Math.max(0, Math.floor((lo - span * 0.15) / step) * step);
  const max = Math.ceil((hi + span * 0.15) / step) * step;
  const ticks: number[] = [];
  for (let t = min; t <= max + step / 2; t += step) ticks.push(Number(t.toFixed(6)));
  return { min, max, ticks };
}

/** Evolução do peso (RN-08): curva das pesagens e dos atendimentos com peso, e a tabela. */
export function WeightChart({ weights, timeZone }: { weights: WeightPoint[]; timeZone: string }) {
  if (weights.length === 0) {
    return (
      <EmptyState
        icon={Scale}
        title="Nenhuma pesagem"
        description="Registre o peso pelo botão Peso ou no atendimento; a curva aparece aqui."
      />
    );
  }
  const z = zoned(timeZone);
  const times = weights.map((w) => Date.parse(w.occurredAt));
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const axis = weightAxis(weights.map((w) => w.weightKg));
  const x = (t: number) =>
    t1 === t0
      ? PAD.left + (W - PAD.left - PAD.right) / 2
      : PAD.left + ((t - t0) / (t1 - t0)) * (W - PAD.left - PAD.right);
  const y = (kg: number) =>
    PAD.top + (1 - (kg - axis.min) / (axis.max - axis.min)) * (H - PAD.top - PAD.bottom);
  const path = weights
    .map(
      (w, i) => `${i === 0 ? 'M' : 'L'}${x(times[i] ?? 0).toFixed(1)},${y(w.weightKg).toFixed(1)}`,
    )
    .join(' ');
  const first = weights[0];
  const last = weights.at(-1);

  return (
    <div className="space-y-4 p-4">
      <figure>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          role="img"
          aria-label={`Peso de ${first ? formatKg(first.weightKg) : ''} a ${last ? formatKg(last.weightKg) : ''} em ${weights.length} registros`}
        >
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
                {formatKg(t).replace(' kg', '')}
              </text>
            </g>
          ))}
          <text x={PAD.left} y={H - 8} className="fill-ink-faint font-mono text-[11px]">
            {first ? z.dateTime(first.occurredAt).slice(0, 10) : ''}
          </text>
          {weights.length > 1 && last ? (
            <text
              x={W - PAD.right}
              y={H - 8}
              textAnchor="end"
              className="fill-ink-faint font-mono text-[11px]"
            >
              {z.dateTime(last.occurredAt).slice(0, 10)}
            </text>
          ) : null}
          <path d={path} fill="none" className="stroke-sage-600" strokeWidth={2} />
          {weights.map((w, i) => (
            <circle
              key={w.eventId}
              cx={x(times[i] ?? 0)}
              cy={y(w.weightKg)}
              r={3.5}
              className="fill-surface stroke-sage-600"
              strokeWidth={2}
            />
          ))}
        </svg>
        <figcaption className="sr-only">Gráfico de evolução do peso</figcaption>
      </figure>
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Pesagens</caption>
        <thead>
          <tr className="border-b border-line text-xs text-ink-muted">
            <th scope="col" className="py-1.5 font-medium">
              Data
            </th>
            <th scope="col" className="py-1.5 text-right font-medium">
              Peso
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {[...weights].reverse().map((w) => (
            <tr key={w.eventId}>
              <td className="py-1.5 font-mono text-xs">{z.dateTime(w.occurredAt)}</td>
              <td className="py-1.5 text-right">{formatKg(w.weightKg)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
