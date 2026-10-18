import {
  abcClassHints,
  clientRankingSchema,
  mySalesSchema,
  pageSchema,
  paymentKindLabels,
  productKindLabels,
  saleListItemSchema,
  saleStatusLabels,
  salesByItemSchema,
  salesSummarySchema,
  type ProductKind,
  type SaleStatus,
} from '@clinica/contracts';
import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { BarChart3, Receipt, Search, Trophy } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '../../design-system/button';
import { SearchField, TextField } from '../../design-system/field';
import { Badge, PageHeader, Panel, Section, Stats } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { DataTable, Pagination } from '../../design-system/table';
import { Tabs, tabPanelProps } from '../../design-system/tabs';
import { api, errorMessage } from '../../lib/api';
import { formatCalendarDate, formatDateTime } from '../../lib/format';
import { useCan } from '../../lib/session';
import { useDebounced } from '../../lib/use-debounced';
import { formatMoney, quantityInput } from '../products/format';
import { addDays, addMonths, endOfMonth, localToday, startOfMonth } from '../schedule/dates';
import { lastTwelveMonths, type ReportSearch, type ReportTab } from './report-search';
import { StatusBadge } from './status-badge';

const LIST_PAGE_SIZE = 25;

const qs = (params: Record<string, string | undefined>) =>
  new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();

const summaryQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: ['sales', 'reports', 'summary', from, to],
    queryFn: () => api('GET', `/sales/reports/summary?${qs({ from, to })}`, salesSummarySchema),
    placeholderData: keepPreviousData,
  });

const byItemQuery = (from: string, to: string, kind: ProductKind | undefined) =>
  queryOptions({
    queryKey: ['sales', 'reports', 'items', from, to, kind],
    queryFn: () => api('GET', `/sales/reports/items?${qs({ from, to, kind })}`, salesByItemSchema),
    placeholderData: keepPreviousData,
  });

const periodListQuery = (s: ReportSearch) =>
  queryOptions({
    queryKey: ['sales', 'list', 'period', s.from, s.to, s.status, s.q, s.page],
    queryFn: () =>
      api(
        'GET',
        `/sales?${qs({
          from: s.from,
          to: s.to,
          status: s.status,
          q: s.q,
          page: String(s.page),
          pageSize: String(LIST_PAGE_SIZE),
        })}`,
        pageSchema(saleListItemSchema),
      ),
    placeholderData: keepPreviousData,
  });

const mineQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: ['sales', 'mine', from, to],
    queryFn: () => api('GET', `/sales/mine?${qs({ from, to })}`, mySalesSchema),
    placeholderData: keepPreviousData,
  });

const rankingQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: ['sales', 'reports', 'clients', from, to],
    queryFn: () => api('GET', `/sales/reports/clients?${qs({ from, to })}`, clientRankingSchema),
    placeholderData: keepPreviousData,
  });

const money = (value: number) => (
  <span className="font-mono whitespace-nowrap">{formatMoney(value)}</span>
);
const num = (value: number) => <span className="font-mono tabular-nums">{value}</span>;

/** De/Até e atalhos de período; o período inválido aparece no campo, sem consultar. */
export function PeriodPicker({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (period: { from: string; to: string }) => void;
}) {
  const today = localToday();
  const lastMonth = addMonths(startOfMonth(today), -1);
  const presets = [
    { label: 'Hoje', from: today, to: today },
    { label: 'Últimos 7 dias', from: addDays(today, -6), to: today },
    { label: 'Este mês', from: startOfMonth(today), to: today },
    { label: 'Mês passado', from: lastMonth, to: endOfMonth(lastMonth) },
    { label: 'Últimos 12 meses', ...lastTwelveMonths() },
  ];
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-40">
        <TextField
          label="De"
          type="date"
          value={from}
          max={to}
          onChange={(e) => {
            if (e.target.value) onChange({ from: e.target.value, to });
          }}
        />
      </div>
      <div className="w-40">
        <TextField
          label="Até"
          type="date"
          value={to}
          min={from}
          onChange={(e) => {
            if (e.target.value) onChange({ from, to: e.target.value });
          }}
        />
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Atalhos de período">
        {presets.map((p) => (
          <Button
            key={p.label}
            size="sm"
            variant={p.from === from && p.to === to ? 'secondary' : 'ghost'}
            aria-pressed={p.from === from && p.to === to}
            onClick={() => {
              onChange({ from: p.from, to: p.to });
            }}
          >
            {p.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

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
  if (query.isPending) return <SkeletonRows rows={4} columns={4} />;
  if (query.isError || query.data === undefined) {
    return <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  }
  return <>{children(query.data)}</>;
}

const periodLabel = (from: string, to: string) =>
  from === to
    ? formatCalendarDate(from)
    : `${formatCalendarDate(from)} a ${formatCalendarDate(to)}`;

/** Mudança nos filtros da URL; `undefined` volta ao padrão. */
interface UrlPatch {
  aba?: ReportTab | undefined;
  de?: string | undefined;
  ate?: string | undefined;
  tipo?: ProductKind | undefined;
  situacao?: SaleStatus | undefined;
  q?: string | undefined;
  page?: number | undefined;
}

/** Consulta vendas [p.9]: resumo, totais por produto/serviço e lista, sobre o mesmo período. */
export function SalesReportPage({ search }: { search: ReportSearch }) {
  const navigate = useNavigate({ from: '/vendas/consulta' });
  const set = (patch: UrlPatch) => {
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  };
  return (
    <>
      <PageHeader
        area="Vendas"
        title="Consulta vendas"
        description="Vendas em aberto e baixadas desta unidade no período, pela data da venda. Orçamentos e vendas canceladas ficam fora dos totais."
      />
      <div className="mb-4">
        <PeriodPicker
          from={search.from}
          to={search.to}
          onChange={(p) => {
            set({ de: p.from, ate: p.to, page: undefined });
          }}
        />
      </div>
      <div className="mb-5">
        <Tabs
          label="Consulta vendas"
          value={search.tab}
          options={[
            { value: 'resumo', label: 'Resumo' },
            { value: 'itens', label: 'Por produto/serviço' },
            { value: 'lista', label: 'Lista de vendas' },
          ]}
          onChange={(tab) => {
            set({ aba: tab === 'resumo' ? undefined : tab, page: undefined });
          }}
        />
      </div>
      <div {...tabPanelProps(search.tab)}>
        {search.tab === 'resumo' ? (
          <SummaryTab from={search.from} to={search.to} />
        ) : search.tab === 'itens' ? (
          <ItemsTab
            search={search}
            onKind={(kind) => {
              set({ tipo: kind });
            }}
          />
        ) : (
          <ListTab
            search={search}
            onChange={(patch) => {
              set(patch);
            }}
          />
        )}
      </div>
    </>
  );
}

function SummaryTab({ from, to }: { from: string; to: string }) {
  const summary = useQuery(summaryQuery(from, to));
  return (
    <Loading query={summary}>
      {(s) =>
        s.totals.count === 0 ? (
          <Panel>
            <EmptyState
              icon={BarChart3}
              title="Nenhuma venda no período"
              description={`Não há vendas em aberto ou baixadas em ${periodLabel(from, to)}.`}
            />
          </Panel>
        ) : (
          <div className="space-y-5">
            <Stats
              label="Totais do período"
              items={[
                { label: 'Venda bruta', value: formatMoney(s.totals.gross) },
                {
                  label: 'Desconto',
                  value: formatMoney(s.totals.discount),
                  detail: `${s.totals.discountPercent.toLocaleString('pt-BR')}% do bruto`,
                },
                { label: 'Venda líquida', value: formatMoney(s.totals.net) },
                {
                  label: 'Ticket médio',
                  value: formatMoney(s.totals.averageTicket),
                  detail: `${String(s.totals.count)} ${s.totals.count === 1 ? 'venda' : 'vendas'}`,
                },
                { label: 'Recebido', value: formatMoney(s.totals.received) },
                { label: 'Em aberto (cliente)', value: formatMoney(s.totals.open) },
              ]}
            />
            <Section title="Vendas por data">
              <div className="-mx-5 -my-4">
                <DataTable
                  caption="Vendas por data"
                  rows={s.byDay}
                  rowKey={(d) => d.date}
                  columns={[
                    { header: 'Data', cell: (d) => formatCalendarDate(d.date) },
                    { header: 'Vendas', className: 'text-right', cell: (d) => num(d.count) },
                    {
                      header: 'Ticket médio',
                      className: 'text-right',
                      hideOnMobile: true,
                      cell: (d) => money(d.averageTicket),
                    },
                    {
                      header: 'Bruto',
                      className: 'text-right',
                      hideOnMobile: true,
                      cell: (d) => money(d.gross),
                    },
                    {
                      header: 'Desconto',
                      className: 'text-right',
                      hideOnMobile: true,
                      cell: (d) => money(d.discount),
                    },
                    { header: 'Líquido', className: 'text-right', cell: (d) => money(d.net) },
                    {
                      header: 'Recebido',
                      className: 'text-right',
                      hideOnMobile: true,
                      cell: (d) => money(d.received),
                    },
                    {
                      header: 'Em aberto',
                      className: 'text-right',
                      hideOnMobile: true,
                      cell: (d) => money(d.open),
                    },
                  ]}
                />
              </div>
            </Section>
            <Section
              title="Por forma de recebimento"
              description="Recebimentos não estornados das vendas do período."
            >
              {s.byMethod.length === 0 ? (
                <p className="text-sm text-ink-muted">Nenhum recebimento ainda.</p>
              ) : (
                <div className="-mx-5 -my-4">
                  <DataTable
                    caption="Por forma de recebimento"
                    rows={s.byMethod}
                    rowKey={(m) => m.methodName}
                    columns={[
                      {
                        header: 'Forma',
                        cell: (m) => (
                          <span className="block min-w-0">
                            <span className="block">{m.methodName}</span>
                            <span className="block text-xs text-ink-muted">
                              {paymentKindLabels[m.kind]} · {m.count}{' '}
                              {m.count === 1 ? 'recebimento' : 'recebimentos'}
                              {m.installments > 0 ? (
                                <span className="md:hidden">
                                  {` · parcelado ${formatMoney(m.installments)}`}
                                </span>
                              ) : null}
                            </span>
                          </span>
                        ),
                      },
                      {
                        header: 'À vista',
                        className: 'text-right',
                        hideOnMobile: true,
                        cell: (m) => money(m.upfront),
                      },
                      {
                        header: 'Parcelado',
                        className: 'text-right',
                        hideOnMobile: true,
                        cell: (m) => money(m.installments),
                      },
                      { header: 'Total', className: 'text-right', cell: (m) => money(m.total) },
                    ]}
                  />
                </div>
              )}
            </Section>
            <div className="grid gap-5 lg:grid-cols-2">
              <Section title="Por profissional" description="Pelo profissional de cada item.">
                <div className="-mx-5 -my-4">
                  <DataTable
                    caption="Por profissional"
                    rows={s.byProfessional}
                    rowKey={(p) => p.userId}
                    columns={[
                      {
                        header: 'Profissional',
                        cell: (p) => (
                          <span className="block min-w-0">
                            <span className="block">{p.name}</span>
                            <span className="block text-xs text-ink-muted">
                              {p.salesCount} {p.salesCount === 1 ? 'venda' : 'vendas'} ·{' '}
                              {p.itemsCount} {p.itemsCount === 1 ? 'item' : 'itens'}
                            </span>
                          </span>
                        ),
                      },
                      { header: 'Líquido', className: 'text-right', cell: (p) => money(p.net) },
                    ]}
                  />
                </div>
              </Section>
              <Section title="Por tipo">
                <div className="-mx-5 -my-4">
                  <DataTable
                    caption="Por tipo"
                    rows={s.byKind}
                    rowKey={(k) => k.kind}
                    columns={[
                      {
                        header: 'Tipo',
                        cell: (k) => (
                          <span className="block min-w-0">
                            <span className="block">{productKindLabels[k.kind]}s</span>
                            <span className="block text-xs text-ink-muted">
                              {k.itemsCount} {k.itemsCount === 1 ? 'item' : 'itens'} em{' '}
                              {k.salesCount} {k.salesCount === 1 ? 'venda' : 'vendas'}
                            </span>
                          </span>
                        ),
                      },
                      { header: 'Líquido', className: 'text-right', cell: (k) => money(k.net) },
                    ]}
                  />
                </div>
              </Section>
            </div>
          </div>
        )
      }
    </Loading>
  );
}

function KindFilter({
  value,
  onChange,
}: {
  value: ProductKind | undefined;
  onChange: (kind: ProductKind | undefined) => void;
}) {
  return (
    <div className="flex gap-1" role="group" aria-label="Tipo">
      {(
        [
          [undefined, 'Todos'],
          ['product', 'Produtos'],
          ['service', 'Serviços'],
        ] as const
      ).map(([kind, label]) => (
        <Button
          key={label}
          size="sm"
          variant={value === kind ? 'secondary' : 'ghost'}
          aria-pressed={value === kind}
          onClick={() => {
            onChange(kind);
          }}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

function ItemsTab({
  search,
  onKind,
}: {
  search: ReportSearch;
  onKind: (kind: ProductKind | undefined) => void;
}) {
  const report = useQuery(byItemQuery(search.from, search.to, search.kind));
  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
        <KindFilter value={search.kind} onChange={onKind} />
        {report.data && report.data.items.length > 0 ? (
          <p className="text-sm text-ink-muted">
            Líquido no período:{' '}
            <span className="font-mono text-ink">{formatMoney(report.data.totals.net)}</span>
          </p>
        ) : null}
      </div>
      <Loading query={report}>
        {(r) =>
          r.items.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title="Nada vendido no período"
              description="Os itens das vendas em aberto e baixadas aparecem aqui, do que mais vendeu ao que menos vendeu."
            />
          ) : (
            <DataTable
              caption="Totais por produto/serviço"
              rows={r.items}
              rowKey={(i) => i.productId}
              columns={[
                {
                  header: 'Item',
                  cell: (i) => (
                    <span className="block min-w-0">
                      <Link
                        to="/estoque/produtos/$productId"
                        params={{ productId: i.productId }}
                        className="block font-medium hover:underline"
                      >
                        {i.name}
                      </Link>
                      <span className="block font-mono text-xs text-ink-muted">
                        #{i.code} · {productKindLabels[i.kind]}
                      </span>
                    </span>
                  ),
                },
                {
                  header: 'Quantidade',
                  className: 'text-right',
                  cell: (i) => (
                    <span className="font-mono whitespace-nowrap tabular-nums">
                      {quantityInput(i.quantity)} {i.unit}
                    </span>
                  ),
                },
                {
                  header: 'Vendas',
                  className: 'text-right',
                  hideOnMobile: true,
                  cell: (i) => num(i.salesCount),
                },
                {
                  header: 'Bruto',
                  className: 'text-right',
                  hideOnMobile: true,
                  cell: (i) => money(i.gross),
                },
                {
                  header: 'Desconto',
                  className: 'text-right',
                  hideOnMobile: true,
                  cell: (i) => money(i.discount),
                },
                { header: 'Líquido', className: 'text-right', cell: (i) => money(i.net) },
              ]}
            />
          )
        }
      </Loading>
    </Panel>
  );
}

const statusFilters: (SaleStatus | undefined)[] = [
  undefined,
  'open',
  'closed',
  'quote',
  'cancelled',
];

function ListTab({
  search,
  onChange,
}: {
  search: ReportSearch;
  onChange: (patch: UrlPatch) => void;
}) {
  const can = useCan();
  const [term, setTerm] = useState(search.q);
  const debounced = useDebounced(term.trim());
  useEffect(() => {
    if (debounced !== search.q) onChange({ q: debounced || undefined, page: undefined });
  }, [debounced, search.q, onChange]);
  const list = useQuery({ ...periodListQuery(search), enabled: can('sales.view') });
  if (!can('sales.view')) {
    return (
      <Panel>
        <EmptyState
          icon={Receipt}
          title="Sem acesso à lista"
          description="Ver a lista de vendas exige a permissão de ver vendas e orçamentos."
        />
      </Panel>
    );
  }
  return (
    <Panel>
      <div className="space-y-3 border-b border-line p-4">
        <SearchField
          label="Buscar vendas"
          placeholder="Cliente, animal ou código da venda"
          icon={<Search className="size-4" aria-hidden />}
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
          }}
        />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Situação">
          {statusFilters.map((status) => (
            <Button
              key={status ?? 'all'}
              size="sm"
              variant={search.status === status ? 'secondary' : 'ghost'}
              aria-pressed={search.status === status}
              onClick={() => {
                onChange({ situacao: status, page: undefined });
              }}
            >
              {status ? saleStatusLabels[status] : 'Todas'}
            </Button>
          ))}
        </div>
      </div>
      <Loading query={list}>
        {(page) =>
          page.items.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="Nenhuma venda encontrada"
              description="Ajuste o período, a situação ou a busca."
            />
          ) : (
            <>
              <DataTable
                caption="Lista de vendas"
                rows={page.items}
                rowKey={(s) => s.id}
                columns={[
                  {
                    header: 'Venda',
                    cell: (s) => (
                      <span className="block min-w-0">
                        <Link
                          to="/vendas/$saleId"
                          params={{ saleId: s.id }}
                          className="block font-mono font-medium hover:underline"
                        >
                          {s.code}
                        </Link>
                        <span className="block text-xs text-ink-muted">
                          {formatDateTime(s.soldAt ?? s.createdAt)}
                        </span>
                      </span>
                    ),
                  },
                  {
                    header: 'Cliente',
                    cell: (s) => (
                      <span className="block min-w-0">
                        <span className="block">{s.clientName ?? 'Consumidor'}</span>
                        {s.patientName ? (
                          <span className="block text-xs text-ink-muted">{s.patientName}</span>
                        ) : null}
                      </span>
                    ),
                  },
                  {
                    header: 'Situação',
                    hideOnMobile: true,
                    cell: (s) => <StatusBadge status={s.status} />,
                  },
                  { header: 'Valor', className: 'text-right', cell: (s) => money(s.netTotal) },
                ]}
              />
              <Pagination
                page={search.page}
                pageSize={LIST_PAGE_SIZE}
                total={page.total}
                onPageChange={(p) => {
                  onChange({ page: p });
                }}
              />
            </>
          )
        }
      </Loading>
    </Panel>
  );
}

/** Minhas vendas [p.10]: o que o próprio profissional vendeu no período, item a item. */
export function MySalesPage({ from, to }: { from: string; to: string }) {
  const can = useCan();
  const navigate = useNavigate({ from: '/vendas/minhas' });
  const mine = useQuery(mineQuery(from, to));
  return (
    <>
      <PageHeader
        area="Vendas"
        title="Minhas vendas"
        description="Os itens em que você é o profissional responsável, nas vendas em aberto e baixadas desta unidade."
      />
      <div className="mb-5">
        <PeriodPicker
          from={from}
          to={to}
          onChange={(p) => {
            void navigate({ search: { de: p.from, ate: p.to }, replace: true });
          }}
        />
      </div>
      <Loading query={mine}>
        {(m) => (
          <div className="space-y-5">
            <Stats
              label="Seus totais no período"
              items={[
                { label: 'Vendas', value: m.totals.salesCount },
                { label: 'Itens', value: m.totals.itemsCount },
                { label: 'Líquido dos seus itens', value: formatMoney(m.totals.net) },
                { label: 'Ainda em aberto', value: formatMoney(m.totals.open) },
              ]}
            />
            <Panel>
              {m.items.length === 0 ? (
                <EmptyState
                  icon={Receipt}
                  title="Nenhuma venda sua no período"
                  description="Os itens lançados com você como profissional aparecem aqui."
                />
              ) : (
                <>
                  <DataTable
                    caption="Meus itens vendidos"
                    rows={m.items}
                    rowKey={(i) => i.itemId}
                    columns={[
                      {
                        header: 'Item',
                        cell: (i) => (
                          <span className="block min-w-0">
                            <span className="block font-medium">{i.name}</span>
                            <span className="block text-xs text-ink-muted">
                              {[i.clientName, i.patientName].filter(Boolean).join(' · ') ||
                                'Consumidor'}
                            </span>
                          </span>
                        ),
                      },
                      {
                        header: 'Venda',
                        cell: (i) => (
                          <span className="block min-w-0">
                            {can('sales.view') ? (
                              <Link
                                to="/vendas/$saleId"
                                params={{ saleId: i.saleId }}
                                className="block font-mono hover:underline"
                              >
                                {i.code}
                              </Link>
                            ) : (
                              <span className="block font-mono">{i.code}</span>
                            )}
                            <span className="block text-xs text-ink-muted">
                              {formatDateTime(i.soldAt)}
                            </span>
                          </span>
                        ),
                      },
                      {
                        header: 'Quantidade',
                        className: 'text-right',
                        hideOnMobile: true,
                        cell: (i) => (
                          <span className="font-mono whitespace-nowrap tabular-nums">
                            {quantityInput(i.quantity)} {i.unit}
                          </span>
                        ),
                      },
                      {
                        header: 'Situação',
                        hideOnMobile: true,
                        cell: (i) => <StatusBadge status={i.status} />,
                      },
                      { header: 'Líquido', className: 'text-right', cell: (i) => money(i.net) },
                    ]}
                  />
                  {m.truncated ? (
                    <p className="border-t border-line px-4 py-3 text-xs text-ink-muted">
                      Mostrando os 500 itens mais recentes; os totais acima valem para o período
                      inteiro.
                    </p>
                  ) : null}
                </>
              )}
            </Panel>
          </div>
        )}
      </Loading>
    </>
  );
}

const percent = (value: number) => (
  <span className="font-mono whitespace-nowrap tabular-nums">
    {value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%
  </span>
);

const classTone = { A: 'sage', B: 'amber', C: 'neutral' } as const;

/** Ranking de clientes [p.10, RN-10]: curva ABC do valor comprado no período. */
export function ClientRankingPage({ from, to }: { from: string; to: string }) {
  const can = useCan();
  const navigate = useNavigate({ from: '/vendas/ranking-clientes' });
  const ranking = useQuery(rankingQuery(from, to));
  return (
    <>
      <PageHeader
        area="Vendas"
        title="Ranking de clientes"
        description="Curva ABC pelo valor líquido comprado no período, somando as vendas em aberto e baixadas de todas as unidades. Orçamentos e vendas canceladas ficam de fora."
      />
      <div className="mb-5">
        <PeriodPicker
          from={from}
          to={to}
          onChange={(p) => {
            void navigate({ search: { de: p.from, ate: p.to }, replace: true });
          }}
        />
      </div>
      <Loading query={ranking}>
        {(r) => (
          <div className="space-y-5">
            <Stats
              label={`Curva ABC de ${periodLabel(from, to)}`}
              items={[
                {
                  label: 'Comprado por clientes',
                  value: formatMoney(r.total),
                  detail: `${String(r.items.length)} ${r.items.length === 1 ? 'cliente' : 'clientes'}`,
                },
                ...r.classes.map((c) => ({
                  label: `Classe ${c.class}`,
                  value: formatMoney(c.net),
                  detail: `${String(c.clients)} ${c.clients === 1 ? 'cliente' : 'clientes'} · ${c.share.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% do valor`,
                })),
              ]}
            />
            <Panel>
              {r.items.length === 0 ? (
                <EmptyState
                  icon={Trophy}
                  title="Nenhuma compra de cliente no período"
                  description="Vendas sem cliente (consumidor) não entram no ranking."
                />
              ) : (
                <>
                  <DataTable
                    caption="Clientes por valor comprado"
                    rows={r.items}
                    rowKey={(i) => i.client.id}
                    columns={[
                      {
                        header: 'Posição',
                        className: 'w-16 text-right',
                        hideOnMobile: true,
                        cell: (i) => num(i.position),
                      },
                      {
                        header: 'Cliente',
                        cell: (i) => (
                          <span className="block min-w-0">
                            {can('clients.view') ? (
                              <Link
                                to="/clientes/$clientId"
                                params={{ clientId: i.client.id }}
                                className="block font-medium hover:underline"
                              >
                                {i.client.name}
                              </Link>
                            ) : (
                              <span className="block font-medium">{i.client.name}</span>
                            )}
                            <span className="block font-mono text-xs text-ink-muted">
                              #{i.client.code} ·{' '}
                              {i.salesCount === 1 ? '1 venda' : `${String(i.salesCount)} vendas`}
                            </span>
                          </span>
                        ),
                      },
                      {
                        header: 'Comprado',
                        className: 'text-right',
                        cell: (i) => money(i.net),
                      },
                      {
                        header: 'Participação',
                        className: 'text-right',
                        hideOnMobile: true,
                        cell: (i) => percent(i.share),
                      },
                      {
                        header: 'Acumulado',
                        className: 'text-right',
                        hideOnMobile: true,
                        cell: (i) => percent(i.cumulativeShare),
                      },
                      {
                        header: 'Classe',
                        cell: (i) => <Badge tone={classTone[i.class]}>{i.class}</Badge>,
                      },
                    ]}
                  />
                  <p className="border-t border-line px-4 py-3 text-xs text-ink-muted">
                    A: {abcClassHints.A.toLowerCase()}. B: {abcClassHints.B.toLowerCase()}. C:{' '}
                    {abcClassHints.C.toLowerCase()}.
                  </p>
                </>
              )}
            </Panel>
          </div>
        )}
      </Loading>
    </>
  );
}
