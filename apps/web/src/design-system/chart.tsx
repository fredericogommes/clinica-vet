import { clsx } from 'clsx';

export interface ChartSeries {
  name: string;
  /** Cor da série, sempre dos tokens do tema. */
  tone: 'sage' | 'amber' | 'sage-light' | 'amber-light';
}

const barTones: Record<ChartSeries['tone'], string> = {
  sage: 'bg-sage-500',
  'sage-light': 'bg-sage-100',
  amber: 'bg-amber-500',
  'amber-light': 'bg-amber-100',
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
  // A tabela fica dentro de uma div: overflow não vale para tabelas e as linhas vazariam a página.
  return (
    <div className="sr-only">
      <table>
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
    </div>
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
  format = String,
}: {
  caption: string;
  /** Rótulo curto de cada coluna (ex. "out"). */
  labels: string[];
  series: ChartSeries[];
  /** values[coluna][série]. */
  values: number[][];
  /** Formato dos números do eixo e das dicas (ex. moeda). */
  format?: (value: number) => string;
}) {
  const max = niceMax(Math.max(0, ...values.flat()));
  return (
    <figure className="space-y-3">
      <div className="flex gap-2" aria-hidden>
        <div className="flex h-36 flex-col justify-between py-0 text-right font-mono text-[10px] text-ink-faint">
          <span>{format(max)}</span>
          <span>{format(max / 2)}</span>
          <span>{format(0)}</span>
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
                    title={`${label}: ${s.name} ${format(v)}`}
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

export interface LineSeries {
  name: string;
  tone: 'sage' | 'amber';
  /** Tracejada para valores projetados. */
  dashed?: boolean;
  /** Um valor por rótulo; nulo interrompe a linha. */
  values: (number | null)[];
}

const lineTones: Record<LineSeries['tone'], { stroke: string; swatch: string }> = {
  sage: { stroke: 'stroke-sage-600', swatch: 'bg-sage-600' },
  amber: { stroke: 'stroke-amber-500', swatch: 'bg-amber-500' },
};

/** Linhas sobre o mesmo eixo, com valores negativos e a linha do zero marcada. */
export function LineChart({
  caption,
  labels,
  tickLabels,
  series,
  format = String,
}: {
  caption: string;
  /** Rótulo de cada ponto, usado na tabela acessível. */
  labels: string[];
  /** Poucos rótulos para o eixo horizontal, distribuídos de ponta a ponta. */
  tickLabels: string[];
  series: LineSeries[];
  format?: (value: number) => string;
}) {
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const top = niceMax(Math.max(0, ...all));
  const bottom = Math.min(0, ...all) < 0 ? -niceMax(-Math.min(...all)) : 0;
  const span = top - bottom || 1;
  const x = (i: number) => (labels.length <= 1 ? W / 2 : (i / (labels.length - 1)) * W);
  const y = (v: number) => 4 + (1 - (v - bottom) / span) * (H - 8);
  const path = (values: (number | null)[]) => {
    let d = '';
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };
  return (
    <figure className="space-y-3">
      <div className="flex gap-2" aria-hidden>
        <div className="relative h-44 text-right font-mono text-[10px] text-ink-faint">
          {/* O rótulo mais longo, invisível, dá a largura da coluna. */}
          <span className="invisible block whitespace-nowrap">
            {[format(top), format(bottom)].sort((p, q) => q.length - p.length)[0]}
          </span>
          {[...new Set([top, 0, bottom])].map((v) => (
            <span
              key={v}
              className="absolute right-0 -translate-y-1/2 whitespace-nowrap"
              style={{ top: `${String((y(v) / H) * 100)}%` }}
            >
              {format(v)}
            </span>
          ))}
        </div>
        <svg
          viewBox={`0 0 ${String(W)} ${String(H)}`}
          preserveAspectRatio="none"
          className="h-44 min-w-0 flex-1 overflow-visible"
        >
          <line
            x1={0}
            x2={W}
            y1={y(bottom)}
            y2={y(bottom)}
            className="stroke-line"
            strokeWidth={1}
          />
          <line
            x1={0}
            x2={W}
            y1={y(0)}
            y2={y(0)}
            className="stroke-line-strong"
            strokeDasharray={bottom < 0 ? undefined : '4 4'}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          {series.map((s) => (
            <path
              key={s.name}
              d={path(s.values)}
              fill="none"
              className={lineTones[s.tone].stroke}
              strokeWidth={2}
              strokeDasharray={s.dashed ? '5 4' : undefined}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>
      <div
        className="ml-7 flex justify-between gap-1 font-mono text-[10px] text-ink-faint"
        aria-hidden
      >
        {tickLabels.map((label) => (
          <span key={label} className="truncate">
            {label}
          </span>
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted" aria-hidden>
        {series.map((s) => (
          <li key={s.name} className="flex items-center gap-1.5">
            <span className={clsx('h-0.5 w-4 rounded-full', lineTones[s.tone].swatch)} />
            {s.name}
          </li>
        ))}
      </ul>
      <DataTableSr
        caption={caption}
        labels={labels}
        series={series.map((s) => s.name)}
        values={labels.map((_, i) => series.map((s) => s.values[i] ?? 0))}
      />
    </figure>
  );
}
