import { clsx } from 'clsx';

export interface ChartSeries {
  name: string;
  /** Cor da série, sempre dos tokens do tema. */
  tone: 'sage' | 'amber' | 'sage-light';
}

const barTones: Record<ChartSeries['tone'], string> = {
  sage: 'bg-sage-500',
  'sage-light': 'bg-sage-100',
  amber: 'bg-amber-500',
};

/** Divisão "redonda" do eixo: 0, passo, 2×passo... até cobrir o maior valor. */
export function niceMax(max: number): number {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  return [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= max) ?? max;
}

/** Tabela invisível com os mesmos números, para leitor de tela e para conferência. */
function DataTableSr({
  caption,
  labels,
  series,
  values,
}: {
  caption: string;
  labels: string[];
  series: string[];
  values: number[][];
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Período</th>
          {series.map((s) => (
            <th key={s} scope="col">
              {s}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {labels.map((label, i) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            {series.map((s, j) => (
              <td key={s}>{values[i]?.[j] ?? 0}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Legend({ series }: { series: ChartSeries[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted" aria-hidden>
      {series.map((s) => (
        <li key={s.name} className="flex items-center gap-1.5">
          <span className={clsx('size-2.5 rounded-[3px]', barTones[s.tone])} />
          {s.name}
        </li>
      ))}
    </ul>
  );
}

/** Barras verticais (agrupadas quando há mais de uma série), uma coluna por período. */
export function BarChart({
  caption,
  labels,
  series,
  values,
}: {
  caption: string;
  /** Rótulo curto de cada coluna (ex. "out"). */
  labels: string[];
  series: ChartSeries[];
  /** values[coluna][série]. */
  values: number[][];
}) {
  const max = niceMax(Math.max(0, ...values.flat()));
  return (
    <figure className="space-y-3">
      <div className="flex gap-2" aria-hidden>
        <div className="flex h-36 flex-col justify-between py-0 text-right font-mono text-[10px] text-ink-faint">
          <span>{max}</span>
          <span>{max / 2}</span>
          <span>0</span>
        </div>
        <div className="relative flex h-36 flex-1 items-end gap-1 border-b border-line">
          <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-line" />
          <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-line" />
          {labels.map((label, i) => (
            <div
              key={label}
              className="relative flex h-full min-w-0 flex-1 items-end justify-center gap-px"
            >
              {series.map((s, j) => {
                const v = values[i]?.[j] ?? 0;
                return (
                  <div
                    key={s.name}
                    title={`${label}: ${String(v)} ${s.name}`}
                    className={clsx('min-w-0 max-w-10 flex-1 rounded-t-[3px]', barTones[s.tone])}
                    style={{ height: `${String((v / max) * 100)}%` }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="ml-7 flex gap-1 font-mono text-[10px] text-ink-faint" aria-hidden>
        {labels.map((label) => (
          <span key={label} className="min-w-0 flex-1 truncate text-center">
            {label}
          </span>
        ))}
      </div>
      <Legend series={series} />
      <DataTableSr
        caption={caption}
        labels={labels}
        series={series.map((s) => s.name)}
        values={values}
      />
    </figure>
  );
}

const W = 320;
const H = 120;

/** Área acumulada (crescimento de longo prazo), com o valor de cada ponto abaixo. */
export function AreaChart({
  caption,
  labels,
  name,
  values,
}: {
  caption: string;
  labels: string[];
  name: string;
  values: number[];
}) {
  const max = niceMax(Math.max(0, ...values));
  const x = (i: number) => (values.length === 1 ? W / 2 : (i / (values.length - 1)) * W);
  const y = (v: number) => H - (v / max) * (H - 8);
  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const area = values.length === 1 ? '' : `${line.join(' ')} L${W},${H} L0,${H} Z`;
  return (
    <figure className="space-y-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-36 w-full overflow-visible"
        aria-hidden
      >
        <line x1={0} x2={W} y1={H} y2={H} className="stroke-line" strokeWidth={1} />
        <line
          x1={0}
          x2={W}
          y1={y(max / 2)}
          y2={y(max / 2)}
          className="stroke-line"
          strokeDasharray="4 4"
          strokeWidth={1}
        />
        {area ? <path d={area} className="fill-sage-100" /> : null}
        <path
          d={line.join(' ')}
          fill="none"
          className="stroke-sage-600"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex justify-between gap-1 font-mono text-[10px] text-ink-faint" aria-hidden>
        {labels.map((label, i) => (
          <span key={label} className="min-w-0 truncate text-center">
            {label}
            <span className="block text-ink-muted">{values[i]}</span>
          </span>
        ))}
      </div>
      <DataTableSr
        caption={caption}
        labels={labels}
        series={[name]}
        values={values.map((v) => [v])}
      />
    </figure>
  );
}
