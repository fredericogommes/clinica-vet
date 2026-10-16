import { weekdays, type WeekdayRange } from '@clinica/contracts';
import { Checkbox } from '../../design-system/checkbox';
import { weekdayLong, weekdayShort } from './dates';

/**
 * Editor de uma faixa por dia da semana (funcionamento da clínica ou horário fixo do
 * profissional). Dia desmarcado = sem atendimento.
 */
export function WeekHours({
  value,
  onChange,
  defaultRange,
  errors,
}: {
  value: WeekdayRange[];
  onChange: (value: WeekdayRange[]) => void;
  defaultRange: { start: string; end: string };
  errors?: Record<number, string | undefined>;
}) {
  const byDay = new Map(value.map((r) => [r.weekday, r]));
  const set = (weekday: number, range: { start: string; end: string } | null) => {
    const rest = value.filter((r) => r.weekday !== weekday);
    onChange(
      (range ? [...rest, { weekday, ...range }] : rest).toSorted((a, b) => a.weekday - b.weekday),
    );
  };
  return (
    <div className="divide-y divide-line">
      {weekdays.map((weekday) => {
        const range = byDay.get(weekday);
        const error = errors?.[weekday];
        return (
          <div key={weekday} className="py-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="w-36">
                <Checkbox
                  label={weekdayLong[weekday] ?? ''}
                  checked={Boolean(range)}
                  onCheckedChange={(checked) => {
                    set(weekday, checked ? defaultRange : null);
                  }}
                />
              </div>
              {range ? (
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    step={900}
                    aria-label={`Início, ${weekdayLong[weekday] ?? ''}`}
                    value={range.start}
                    onChange={(e) => {
                      set(weekday, { start: e.target.value, end: range.end });
                    }}
                    className="h-9 rounded-control border border-line-strong bg-surface px-2 font-mono text-sm"
                  />
                  <span className="text-sm text-ink-muted">às</span>
                  <input
                    type="time"
                    step={900}
                    aria-label={`Fim, ${weekdayLong[weekday] ?? ''}`}
                    value={range.end === '24:00' ? '23:59' : range.end}
                    onChange={(e) => {
                      set(weekday, { start: range.start, end: e.target.value });
                    }}
                    className="h-9 rounded-control border border-line-strong bg-surface px-2 font-mono text-sm"
                  />
                </div>
              ) : (
                <span className="text-sm text-ink-faint">Sem atendimento</span>
              )}
            </div>
            {error ? (
              <p role="alert" className="mt-1 text-xs font-medium text-danger-600">
                {error}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** "Seg, Qua, Qui 09:00–21:00 · Sáb 08:00–12:00". */
export function summarizeWeek(ranges: WeekdayRange[]): string {
  if (ranges.length === 0) return 'Sem dias definidos';
  const groups = new Map<string, number[]>();
  for (const r of ranges.toSorted((a, b) => a.weekday - b.weekday)) {
    const key = `${r.start}–${r.end}`;
    groups.set(key, [...(groups.get(key) ?? []), r.weekday]);
  }
  return [...groups]
    .map(([hours, days]) => `${days.map((d) => weekdayShort[d]).join(', ')} ${hours}`)
    .join(' · ');
}

/** Erros da API no formato "days.3.end" ou "fixedHours.3.end" → mensagem por dia da semana. */
export function errorsByWeekday(
  details: { path: string; message: string }[],
  ranges: WeekdayRange[],
): Record<number, string | undefined> {
  const out: Record<number, string | undefined> = {};
  for (const d of details) {
    const index = Number(d.path.split('.')[1]);
    const weekday = ranges[index]?.weekday;
    if (weekday !== undefined) out[weekday] = d.message;
  }
  return out;
}
