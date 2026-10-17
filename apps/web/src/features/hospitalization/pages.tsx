import {
  hospitalizationPriorityLabels,
  hospitalizationStatuses,
  hospitalizationStatusLabels,
  type Hospitalization,
  type HospitalizationStatus,
} from '@clinica/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { BedDouble, History, Plus, Search } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button, buttonClasses } from '../../design-system/button';
import { SearchField } from '../../design-system/field';
import { Badge, PageHeader, Panel, Stats } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { DataTable, Pagination } from '../../design-system/table';
import { errorMessage } from '../../lib/api';
import { formatCalendarDate, formatDateTime } from '../../lib/format';
import { useCan } from '../../lib/session';
import { useDebounced } from '../../lib/use-debounced';
import { formatKg } from '../clinical/labels';
import { localToday } from '../schedule/dates';
import { AdmitDialog } from './dialogs';
import { formatDuration, priorityStripe, priorityTone, statusTone } from './labels';
import { hospitalizationsQuery } from './queries';

function Loading<T>({
  query,
  children,
}: {
  query: {
    isPending: boolean;
    isError: boolean;
    error: unknown;
    data: T | undefined;
    refetch: () => unknown;
  };
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <SkeletonRows rows={4} columns={3} />;
  if (query.isError || query.data === undefined) {
    return <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  }
  return <>{children(query.data)}</>;
}

const animalLine = (h: Hospitalization) =>
  [h.patient.species, h.patient.breed].filter(Boolean).join(' · ') || 'Espécie não informada';

function HospitalizedCard({ h }: { h: Hospitalization }) {
  const late = h.expectedDischargeOn !== null && h.expectedDischargeOn < localToday();
  return (
    <li>
      <Link
        to="/internacao/$hospitalizationId"
        params={{ hospitalizationId: h.id }}
        aria-label={`${h.patient.name}, ${hospitalizationPriorityLabels[h.priority]}, ${h.box ? h.box.code : 'sem box'}`}
        className={clsx(
          'block h-full rounded-panel border border-l-4 border-line bg-surface p-4 shadow-panel transition-colors hover:border-sage-500',
          priorityStripe[h.priority],
        )}
      >
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block truncate font-display text-[17px] font-semibold text-ink">
              {h.patient.name}
            </span>
            <span className="block truncate text-xs text-ink-muted">{animalLine(h)}</span>
          </span>
          <Badge tone={priorityTone[h.priority]}>{hospitalizationPriorityLabels[h.priority]}</Badge>
        </span>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div>
            <dt className="text-xs text-ink-muted">Box</dt>
            <dd className="font-medium">{h.box ? h.box.code : 'Sem box'}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Peso</dt>
            <dd className="font-medium">
              {h.patient.weightKg === null ? 'Sem pesagem' : formatKg(h.patient.weightKg)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Internado há</dt>
            <dd className="font-medium">{formatDuration(h.admittedAt, null)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Previsão de alta</dt>
            <dd className={clsx('font-medium', late && 'text-danger-600')}>
              {h.expectedDischargeOn ? formatCalendarDate(h.expectedDischargeOn) : 'Sem previsão'}
            </dd>
          </div>
        </dl>
        <span className="mt-3 block truncate border-t border-line pt-2 text-xs text-ink-muted">
          {h.veterinarian.name} · {h.client.name}
        </span>
      </Link>
    </li>
  );
}

/** Animais internados [p.14]: um cartão por paciente, com a tarja da prioridade. */
export function HospitalizedPage({ q }: { q: string }) {
  const can = useCan();
  const navigate = useNavigate({ from: '/internacao' });
  const [term, setTerm] = useState(q);
  const debounced = useDebounced(term.trim());
  useEffect(() => {
    if (debounced !== q) void navigate({ search: { q: debounced || undefined }, replace: true });
  }, [debounced, q, navigate]);
  const list = useQuery({
    ...hospitalizationsQuery({ q, scope: 'current', page: 1 }),
    // O painel fica aberto no plantão: duração e cartões se atualizam sozinhos.
    refetchInterval: 60_000,
  });
  const [admitting, setAdmitting] = useState(false);

  return (
    <>
      <PageHeader
        area="Internação"
        title="Animais internados"
        description="Os internados agora nesta unidade, os urgentes primeiro. Abra o cartão para a ficha de internação."
        actions={
          <>
            <Link to="/internacao/historico" className={buttonClasses('secondary')}>
              <History className="size-4" aria-hidden />
              Histórico
            </Link>
            {can('hospitalization.manage') ? (
              <Button
                icon={<Plus className="size-4" aria-hidden />}
                onClick={() => {
                  setAdmitting(true);
                }}
              >
                Internar animal
              </Button>
            ) : null}
          </>
        }
      />
      <Loading query={list}>
        {(page) => {
          const count = (p: Hospitalization['priority']) =>
            page.items.filter((h) => h.priority === p).length;
          return (
            <div className="space-y-5">
              {q ? null : (
                <Stats
                  label="Resumo dos internados"
                  items={[
                    { label: 'Internados', value: page.total },
                    { label: 'Urgentes', value: count('urgent') },
                    { label: 'Em atenção', value: count('attention') },
                    {
                      label: 'Sem box',
                      value: page.items.filter((h) => !h.box).length,
                    },
                  ]}
                />
              )}
              <SearchField
                label="Buscar internados"
                placeholder="Animal, responsável, box ou código"
                icon={<Search className="size-4" aria-hidden />}
                value={term}
                onChange={(e) => {
                  setTerm(e.target.value);
                }}
              />
              {page.items.length === 0 ? (
                <Panel>
                  <EmptyState
                    icon={BedDouble}
                    title={q ? 'Nenhum internado encontrado' : 'Nenhum animal internado'}
                    description={
                      q
                        ? 'Ajuste a busca.'
                        : 'Interne um animal por aqui ou pela ficha clínica dele.'
                    }
                  />
                </Panel>
              ) : (
                <ul
                  aria-label="Animais internados"
                  className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
                >
                  {page.items.map((h) => (
                    <HospitalizedCard key={h.id} h={h} />
                  ))}
                </ul>
              )}
            </div>
          );
        }}
      </Loading>
      {admitting ? (
        <AdmitDialog
          onClose={() => {
            setAdmitting(false);
          }}
        />
      ) : null}
    </>
  );
}

export interface HistorySearch {
  q: string;
  status: Exclude<HospitalizationStatus, 'admitted'> | undefined;
  page: number;
}

const closedStatuses = hospitalizationStatuses.filter(
  (s): s is Exclude<HospitalizationStatus, 'admitted'> => s !== 'admitted',
);

/** Histórico de internações [p.16]: as encerradas por alta, óbito ou cancelamento. */
export function HospitalizationHistoryPage({ search }: { search: HistorySearch }) {
  const navigate = useNavigate({ from: '/internacao/historico' });
  const change = (patch: {
    q?: string | undefined;
    situacao?: HistorySearch['status'];
    page?: number | undefined;
  }) => {
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  };
  const [term, setTerm] = useState(search.q);
  const debounced = useDebounced(term.trim());
  useEffect(() => {
    if (debounced !== search.q) {
      void navigate({
        search: (prev) => ({ ...prev, q: debounced || undefined, page: undefined }),
        replace: true,
      });
    }
  }, [debounced, search.q, navigate]);
  const list = useQuery(hospitalizationsQuery({ ...search, scope: 'closed' }));
  const filtered = Boolean(search.q || search.status);

  return (
    <>
      <PageHeader
        area="Internação"
        title="Histórico de internações"
        description="Internações encerradas de todas as unidades, das mais recentes para as mais antigas."
      />
      <Panel>
        <div className="space-y-3 border-b border-line p-4">
          <SearchField
            label="Buscar no histórico"
            placeholder="Animal, responsável, box ou código"
            icon={<Search className="size-4" aria-hidden />}
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
            }}
          />
          <div className="flex flex-wrap gap-1" role="group" aria-label="Desfecho">
            {[undefined, ...closedStatuses].map((status) => (
              <Button
                key={status ?? 'all'}
                size="sm"
                variant={search.status === status ? 'secondary' : 'ghost'}
                aria-pressed={search.status === status}
                onClick={() => {
                  change({ situacao: status, page: undefined });
                }}
              >
                {status ? hospitalizationStatusLabels[status] : 'Todas'}
              </Button>
            ))}
          </div>
        </div>
        <Loading query={list}>
          {(page) =>
            page.items.length === 0 ? (
              <EmptyState
                icon={History}
                title={filtered ? 'Nenhuma internação encontrada' : 'Nenhuma internação encerrada'}
                description={
                  filtered
                    ? 'Ajuste a busca ou o desfecho.'
                    : 'As internações aparecem aqui depois da alta, do óbito ou do cancelamento.'
                }
              />
            ) : (
              <>
                <DataTable
                  caption="Internações encerradas"
                  rows={page.items}
                  rowKey={(h) => h.id}
                  columns={[
                    {
                      header: 'Animal',
                      cell: (h) => (
                        <span className="block min-w-0">
                          <Link
                            to="/internacao/$hospitalizationId"
                            params={{ hospitalizationId: h.id }}
                            className="block font-medium hover:underline"
                          >
                            {h.patient.name}
                          </Link>
                          <span className="block text-xs text-ink-muted">
                            {h.client.name} · nº {h.code}
                          </span>
                          <span className="block text-xs text-ink-muted md:hidden">
                            {h.endedAt ? formatDateTime(h.endedAt) : ''}
                          </span>
                        </span>
                      ),
                    },
                    {
                      header: 'Internação',
                      hideOnMobile: true,
                      cell: (h) => (
                        <span className="block text-sm whitespace-nowrap">
                          {formatDateTime(h.admittedAt)}
                          <span className="block text-xs text-ink-muted">
                            {formatDuration(h.admittedAt, h.endedAt)}
                          </span>
                        </span>
                      ),
                    },
                    {
                      header: 'Encerrada',
                      hideOnMobile: true,
                      cell: (h) => (
                        <span className="whitespace-nowrap">
                          {h.endedAt ? formatDateTime(h.endedAt) : ''}
                        </span>
                      ),
                    },
                    {
                      header: 'Veterinário',
                      hideOnMobile: true,
                      cell: (h) => h.veterinarian.name,
                    },
                    {
                      header: 'Desfecho',
                      className: 'text-right',
                      cell: (h) => (
                        <Badge tone={statusTone[h.status]}>
                          {hospitalizationStatusLabels[h.status]}
                        </Badge>
                      ),
                    },
                  ]}
                />
                <Pagination
                  page={search.page}
                  pageSize={page.pageSize}
                  total={page.total}
                  onPageChange={(p) => {
                    change({ page: p });
                  }}
                />
              </>
            )
          }
        </Loading>
      </Panel>
    </>
  );
}
