import {
  stockSituationHints,
  stockSituationLabels,
  stockSituations,
  type StockAnalysis,
  type StockSituation,
} from '@clinica/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { ChartColumn, Search } from 'lucide-react';
import { SearchField, SelectField } from '../../design-system/field';
import { Badge, PageHeader, Panel } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { DataTable, Pagination } from '../../design-system/table';
import { errorMessage } from '../../lib/api';
import { formatMoney, quantityInput } from '../products/format';
import { stockAnalysisQuery, type StockAnalysisSearch } from './queries';
import { durationLabel, situationTones } from './situation';

const q = (value: number) => quantityInput(value);

/**
 * Análise de estoque [p.17]: a carteira inteira em cinco situações, com contagem e valor, e a
 * lista para agir em cada uma.
 */
export function StockAnalysisPage({ search }: { search: StockAnalysisSearch }) {
  const navigate = useNavigate({ from: '/estoque/analise' });
  const set = (patch: Partial<Omit<StockAnalysisSearch, 'page'>>) => {
    void navigate({ search: (prev) => ({ ...prev, page: undefined, ...patch }), replace: true });
  };
  const analysis = useQuery(stockAnalysisQuery(search));

  return (
    <>
      <PageHeader
        area="Estoque e serviços"
        title="Análise de estoque"
        description="Cada produto com estoque numa situação, pelo saldo e pelo consumo dos últimos 90 dias em vendas e outras saídas."
      />
      {analysis.isPending ? (
        <SkeletonRows rows={6} columns={4} />
      ) : analysis.isError ? (
        <ErrorState
          message={errorMessage(analysis.error)}
          onRetry={() => void analysis.refetch()}
        />
      ) : (
        <>
          <Summary
            data={analysis.data}
            selected={search.situacao}
            onSelect={(situacao) => {
              set({ situacao });
            }}
          />
          <Panel className="my-5 grid gap-4 p-4 sm:grid-cols-2 sm:items-end">
            <SearchField
              label="Buscar produto"
              icon={<Search className="size-4" aria-hidden />}
              placeholder="Nome do produto"
              value={search.q}
              onChange={(e) => {
                set({ q: e.target.value });
              }}
            />
            <SelectField
              label="Grupo"
              value={search.grupo ?? ''}
              placeholder="Todos os grupos"
              options={analysis.data.groups.map((g) => ({ value: g.id, label: g.name }))}
              onChange={(e) => {
                set({ grupo: e.target.value || undefined });
              }}
            />
          </Panel>
          <Panel>
            {analysis.data.items.length === 0 ? (
              <EmptyState
                icon={ChartColumn}
                title="Nenhum produto nesta situação"
                description="Mude a situação, o grupo ou a busca para ver outros produtos."
              />
            ) : (
              <div aria-busy={analysis.isFetching || undefined}>
                <AnalysisTable data={analysis.data} />
                <Pagination
                  page={analysis.data.page}
                  pageSize={analysis.data.pageSize}
                  total={analysis.data.matches}
                  onPageChange={(page) => {
                    void navigate({ search: (prev) => ({ ...prev, page }), replace: true });
                  }}
                />
              </div>
            )}
          </Panel>
          {analysis.data.idle > 0 ? (
            <p className="mt-3 text-sm text-ink-muted">
              {analysis.data.idle === 1
                ? '1 produto sem saldo e sem saída nos últimos 90 dias fica fora da análise.'
                : `${String(analysis.data.idle)} produtos sem saldo e sem saída nos últimos 90 dias ficam fora da análise.`}
            </p>
          ) : null}
        </>
      )}
    </>
  );
}

function Summary({
  data,
  selected,
  onSelect,
}: {
  data: StockAnalysis;
  selected: StockSituation | undefined;
  onSelect: (situation: StockSituation | undefined) => void;
}) {
  const card = (active: boolean) =>
    clsx(
      'min-w-0 rounded-panel border bg-surface px-4 py-3 text-left shadow-panel transition-colors hover:border-sage-500 focus-visible:ring-2 focus-visible:ring-sage-500/30 focus-visible:outline-none',
      active ? 'border-sage-600 ring-1 ring-sage-600' : 'border-line',
    );
  const value = (v: number | null) =>
    v === null ? null : (
      <span className="block font-mono text-sm text-ink-muted tabular-nums">{formatMoney(v)}</span>
    );
  return (
    <div
      role="group"
      aria-label="Situações do estoque"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6"
    >
      <button
        type="button"
        aria-pressed={selected === undefined}
        className={card(selected === undefined)}
        onClick={() => {
          onSelect(undefined);
        }}
      >
        <span className="block text-xs text-ink-muted">Total</span>
        <span className="mt-1 block text-lg font-medium text-ink">
          {data.total.count} {data.total.count === 1 ? 'produto' : 'produtos'}
        </span>
        {value(data.total.value)}
      </button>
      {stockSituations.map((situation) => {
        const bucket = data.summary.find((b) => b.situation === situation);
        return (
          <button
            key={situation}
            type="button"
            aria-pressed={selected === situation}
            title={stockSituationHints[situation]}
            className={card(selected === situation)}
            onClick={() => {
              onSelect(selected === situation ? undefined : situation);
            }}
          >
            <span className="block">
              <Badge tone={situationTones[situation]}>{stockSituationLabels[situation]}</Badge>
            </span>
            <span className="mt-1 block text-lg font-medium text-ink">
              {bucket?.count ?? 0} {bucket?.count === 1 ? 'produto' : 'produtos'}
            </span>
            {value(bucket?.value ?? null)}
          </button>
        );
      })}
    </div>
  );
}

function AnalysisTable({ data }: { data: StockAnalysis }) {
  const seeCost = data.total.value !== null;
  type Item = StockAnalysis['items'][number];
  return (
    <DataTable
      caption="Análise de estoque"
      rows={data.items}
      rowKey={(i) => i.id}
      columns={[
        {
          header: 'Produto',
          cell: (i: Item) => (
            <div className="min-w-0">
              <Link
                to="/estoque/produtos/$productId"
                params={{ productId: i.id }}
                className="font-medium text-ink hover:text-sage-700 hover:underline"
              >
                {i.name}
              </Link>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
                <Badge tone={situationTones[i.situation]}>
                  {stockSituationLabels[i.situation]}
                </Badge>
                {i.group ?? 'Sem grupo'}
              </p>
              {i.totalCost !== null ? (
                <p className="mt-1 font-mono text-xs text-ink-muted tabular-nums sm:hidden">
                  {formatMoney(i.totalCost)}
                  {i.excessCost !== null ? ` · excedente ${formatMoney(i.excessCost)}` : ''}
                </p>
              ) : null}
            </div>
          ),
        },
        {
          header: 'Estoque',
          cell: (i: Item) => (
            <div className="whitespace-nowrap">
              <p className={clsx('tabular-nums', i.onHand < 0 && 'text-danger-600')}>
                {q(i.onHand)} {i.unit}
              </p>
              <p className="text-xs text-ink-muted">
                {i.minStock !== null || i.idealStock !== null
                  ? `mín. ${i.minStock === null ? '—' : q(i.minStock)} · ideal ${
                      i.idealStock === null ? '—' : q(i.idealStock)
                    }`
                  : 'sem mínimo e ideal'}
              </p>
            </div>
          ),
          className: 'text-right',
        },
        {
          header: 'Consumo por mês',
          cell: (i: Item) => `${q(i.monthlyConsumption)} ${i.unit}`,
          className: 'whitespace-nowrap text-right tabular-nums',
          hideOnMobile: true,
        },
        {
          header: 'Duração',
          cell: (i: Item) => durationLabel(i.durationDays),
          className: 'whitespace-nowrap text-right',
          hideOnMobile: true,
        },
        ...(seeCost
          ? [
              {
                header: 'Valor',
                cell: (i: Item) => (
                  <div className="font-mono whitespace-nowrap tabular-nums">
                    <p>{formatMoney(i.totalCost ?? 0)}</p>
                    {i.excess !== null ? (
                      <p className="text-xs text-amber-700">
                        excedente {formatMoney(i.excessCost ?? 0)}
                      </p>
                    ) : null}
                  </div>
                ),
                className: 'text-right',
                hideOnMobile: true,
              },
            ]
          : []),
      ]}
    />
  );
}
