import { hospitalizationPriorityLabels, type ExecutionMap } from '@clinica/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { ListChecks, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../design-system/button';
import { SearchField } from '../../design-system/field';
import { Badge, PageHeader, Panel, Stats } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { errorMessage } from '../../lib/api';
import { useDebounced } from '../../lib/use-debounced';
import { formatLongDay, localToday } from '../schedule/dates';
import { priorityStripe, priorityTone } from './labels';
import { DayNav, useScrollToHour } from './prescription-tab';
import { executionMapQuery, type ExecutionMapSearch } from './queries';

const hours = Array.from({ length: 24 }, (_, h) => h);

type Cell = ExecutionMap['rows'][number]['cells'][number];

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

function cellLabel(c: Cell) {
  return [
    c.overdue ? plural(c.overdue, 'vencido', 'vencidos') : null,
    c.pending ? plural(c.pending, 'programado', 'programados') : null,
    c.done ? plural(c.done, 'registrado', 'registrados') : null,
  ]
    .filter(Boolean)
    .join(', ');
}

function MapCell({ c }: { c: Cell }) {
  if (c.overdue + c.pending + c.done === 0) return null;
  // A cor da célula é a do que pede atenção primeiro: vencido, depois programado.
  const tone = c.overdue
    ? 'border-danger-600/40 bg-danger-50 text-danger-600'
    : c.pending
      ? 'border-line-strong bg-surface text-ink'
      : 'border-success-600/30 bg-success-50 text-success-600';
  const count = c.overdue || c.pending || c.done;
  return (
    <span
      className={clsx(
        'mx-auto flex h-7 min-w-8 items-center justify-center rounded-control border px-1 font-mono text-xs font-medium tabular-nums',
        tone,
      )}
    >
      {count}
      {c.overdue && (c.pending || c.done) ? '+' : ''}
    </span>
  );
}

/**
 * Mapa de execução [p.15]: os internados da unidade em linhas e as 24 horas do dia em colunas,
 * com quantos horários de prescrição estão vencidos, programados ou registrados em cada hora.
 */
export function ExecutionMapPage({ search }: { search: ExecutionMapSearch }) {
  const navigate = useNavigate({ from: '/internacao/mapa' });
  const today = localToday();
  const change = (patch: { data?: string; q?: string; pendentes?: boolean }) => {
    void navigate({
      search: (prev) => {
        const next = { ...prev, ...patch };
        return {
          data: next.data === today ? undefined : next.data,
          q: next.q || undefined,
          pendentes: next.pendentes ? true : undefined,
        };
      },
      replace: true,
    });
  };
  const [term, setTerm] = useState(search.q);
  const debounced = useDebounced(term.trim());
  useEffect(() => {
    if (debounced !== search.q) {
      void navigate({
        search: (prev) => ({ ...prev, q: debounced || undefined }),
        replace: true,
      });
    }
  }, [debounced, search.q, navigate]);
  const map = useQuery({ ...executionMapQuery(search), refetchInterval: 60_000 });
  const currentHour = search.date === today ? new Date().getHours() : null;
  const scroller = useRef<HTMLDivElement>(null);
  useScrollToHour(scroller, map.data && currentHour !== null ? currentHour - 1 : null);

  return (
    <>
      <PageHeader
        area="Internação"
        title="Mapa de execução"
        description="Os horários de medicação dos internados no dia. Abra o animal para registrar a execução."
      />
      <div className="space-y-5">
        {map.data ? (
          <Stats
            label="Resumo do dia"
            items={[
              { label: 'Vencidos', value: map.data.totals.overdue },
              { label: 'Programados', value: map.data.totals.pending },
              { label: 'Registrados', value: map.data.totals.done },
            ]}
          />
        ) : null}
        <Panel>
          <div className="space-y-3 border-b border-line p-4">
            <DayNav
              date={search.date}
              today={today}
              onChange={(data) => {
                change({ data });
              }}
            />
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-0 flex-1 basis-60">
                <SearchField
                  label="Buscar no mapa"
                  placeholder="Animal ou box"
                  icon={<Search className="size-4" aria-hidden />}
                  value={term}
                  onChange={(e) => {
                    setTerm(e.target.value);
                  }}
                />
              </div>
              <Button
                variant={search.pendingOnly ? 'secondary' : 'ghost'}
                aria-pressed={search.pendingOnly}
                onClick={() => {
                  change({ pendentes: !search.pendingOnly });
                }}
              >
                Só com pendências
              </Button>
            </div>
          </div>
          {map.isPending ? (
            <div className="p-4">
              <SkeletonRows rows={4} columns={4} />
            </div>
          ) : map.isError ? (
            <ErrorState message={errorMessage(map.error)} onRetry={() => void map.refetch()} />
          ) : map.data.rows.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title={
                search.q || search.pendingOnly
                  ? 'Nenhum internado encontrado'
                  : 'Nenhum internado neste dia'
              }
              description={
                search.q || search.pendingOnly
                  ? 'Ajuste a busca ou mostre todos.'
                  : 'Os internados da unidade aparecem aqui com os horários das prescrições.'
              }
            />
          ) : (
            <div ref={scroller} className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">
                  Mapa de execução de {formatLongDay(search.date)}
                </caption>
                <thead>
                  <tr className="bg-sunken text-xs text-ink-muted">
                    <th
                      scope="col"
                      data-sticky
                      className="sticky left-0 z-10 min-w-44 bg-sunken px-3 py-2 text-left font-medium"
                    >
                      Animal
                    </th>
                    {hours.map((hour) => (
                      <th
                        key={hour}
                        scope="col"
                        data-hour={hour}
                        className={clsx(
                          'min-w-11 px-1 py-2 text-center font-mono',
                          hour === currentHour && 'bg-sage-100 text-sage-700',
                        )}
                      >
                        {String(hour).padStart(2, '0')}h
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {map.data.rows.map((r) => (
                    <tr key={r.hospitalizationId}>
                      <th
                        scope="row"
                        className={clsx(
                          'sticky left-0 z-10 min-w-44 border-l-4 bg-surface px-3 py-2 text-left font-normal',
                          priorityStripe[r.priority],
                        )}
                      >
                        <Link
                          to="/internacao/$hospitalizationId"
                          params={{ hospitalizationId: r.hospitalizationId }}
                          search={{ aba: 'prescricao' }}
                          className="block truncate font-medium text-ink hover:underline"
                        >
                          {r.patient}
                        </Link>
                        <span className="flex items-center gap-1.5 text-xs text-ink-muted">
                          {r.box ?? 'Sem box'}
                          {r.priority === 'routine' ? null : (
                            <Badge tone={priorityTone[r.priority]}>
                              {hospitalizationPriorityLabels[r.priority]}
                            </Badge>
                          )}
                        </span>
                      </th>
                      {r.cells.map((c) => {
                        const label = cellLabel(c);
                        return (
                          <td
                            key={c.hour}
                            className={clsx(
                              'border-l border-line/60 px-1 py-2 text-center',
                              c.hour === currentHour && 'bg-sage-50',
                            )}
                            {...(label
                              ? {
                                  'aria-label': `${String(c.hour).padStart(2, '0')}h: ${label}`,
                                  title: label,
                                }
                              : {})}
                          >
                            <MapCell c={c} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
