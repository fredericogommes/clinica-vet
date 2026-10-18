import {
  clientsIntelligenceSchema,
  indicators,
  intelligenceFavoritesSchema,
  patientsIntelligenceSchema,
  salesIntelligenceSchema,
  saleShiftLabels,
  saleShifts,
  weekdayLabels,
  type ClientsIntelligence,
  type Evolution,
  type IndicatorKey,
  type IntelligenceTab,
  type PatientsIntelligence,
  type RankEntry,
  type SalesIntelligence,
  type SaleShift,
} from '@clinica/contracts';
import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { ChartPie, Star } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { BarChart, RankBars } from '../../design-system/chart';
import { Segmented, SelectField } from '../../design-system/field';
import { PageHeader, Panel, Stats } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { DataTable } from '../../design-system/table';
import { Tabs, tabPanelProps } from '../../design-system/tabs';
import { useToast } from '../../design-system/toast';
import { api, errorMessage } from '../../lib/api';
import { formatCalendarDate } from '../../lib/format';
import { formatMoney, quantityInput } from '../products/format';
import { PeriodPicker } from '../sales/reports-page';

export const intelligenceTabSlugs = ['vendas', 'clientes', 'animais'] as const;
export type IntelligenceTabSlug = (typeof intelligenceTabSlugs)[number];

const tabOf: Record<IntelligenceTabSlug, IntelligenceTab> = {
  vendas: 'sales',
  clientes: 'clients',
  animais: 'patients',
};

/** Filtros de Inteligência › Vendas, lidos da URL pelo roteador. */
export interface IntelligenceSearch {
  tab: IntelligenceTabSlug;
  from: string;
  to: string;
  weekday: number | undefined;
  shift: SaleShift | undefined;
}

interface UrlPatch {
  aba?: Exclude<IntelligenceTabSlug, 'vendas'> | undefined;
  de?: string | undefined;
  ate?: string | undefined;
  dia?: number | undefined;
  turno?: SaleShift | undefined;
}

const params = (s: IntelligenceSearch, withSaleFilters: boolean) => {
  const p = new URLSearchParams({ from: s.from, to: s.to });
  if (withSaleFilters && s.weekday !== undefined) p.set('weekday', String(s.weekday));
  if (withSaleFilters && s.shift) p.set('shift', s.shift);
  return p.toString();
};

const salesQuery = (s: IntelligenceSearch) =>
  queryOptions({
    queryKey: ['intelligence', 'sales', s.from, s.to, s.weekday, s.shift],
    queryFn: () => api('GET', `/intelligence/sales?${params(s, true)}`, salesIntelligenceSchema),
    placeholderData: keepPreviousData,
  });

const clientsQuery = (s: IntelligenceSearch) =>
  queryOptions({
    queryKey: ['intelligence', 'clients', s.from, s.to],
    queryFn: () =>
      api('GET', `/intelligence/clients?${params(s, false)}`, clientsIntelligenceSchema),
    placeholderData: keepPreviousData,
  });

const patientsQuery = (s: IntelligenceSearch) =>
  queryOptions({
    queryKey: ['intelligence', 'patients', s.from, s.to],
    queryFn: () =>
      api('GET', `/intelligence/patients?${params(s, false)}`, patientsIntelligenceSchema),
    placeholderData: keepPreviousData,
  });

const favoritesQuery = queryOptions({
  queryKey: ['intelligence', 'favorites'],
  queryFn: () => api('GET', '/intelligence/favorites', intelligenceFavoritesSchema),
});

const monthNames = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];
/** "2026-03-02" → "02/03"; "2026-03" → "mar/26". */
const periodLabel = (period: string) =>
  period.length === 7
    ? `${monthNames[Number(period.slice(5, 7)) - 1] ?? period}/${period.slice(2, 4)}`
    : `${period.slice(8, 10)}/${period.slice(5, 7)}`;

const compactMoney = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const compact = (value: number) => compactMoney.format(value);
const integer = (value: number) => value.toLocaleString('pt-BR');
const plural = (n: number, one: string, many: string) => `${integer(n)} ${n === 1 ? one : many}`;
const salesLabel = (n: number) => plural(n, 'venda', 'vendas');
const share = (value: number, base: number) =>
  base === 0 ? '0%' : `${(Math.round((value / base) * 1000) / 10).toLocaleString('pt-BR')}%`;

/** Ranking em reais; a quantidade vai ao lado, no texto que o indicador pede. */
const moneyEntries = (rows: RankEntry[], detail: (count: number) => string) =>
  rows.map((r) => ({ label: r.label, value: r.value, detail: detail(r.count) }));
/** Distribuição de cadastro: a contagem e a fatia da base. */
const countEntries = (rows: RankEntry[], base: number) =>
  rows.map((r) => ({ label: r.label, value: r.value, detail: share(r.value, base) }));

const units = (n: number) => `× ${quantityInput(n)}`;

/**
 * Inteligência › Vendas [p.11–12]: indicadores de vendas, clientes e animais no período, com o
 * corte por animal que distingue o BI veterinário. Cada usuário favorita os indicadores que
 * quer ver primeiro.
 */
export function IntelligencePage({ search }: { search: IntelligenceSearch }) {
  const navigate = useNavigate({ from: '/inteligencia/vendas' });
  const set = (patch: UrlPatch) => {
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  };
  const [onlyFavorites, setOnlyFavorites] = useState<'todos' | 'favoritos'>('todos');
  const favorites = useFavorites();
  const tab = tabOf[search.tab];

  return (
    <>
      <PageHeader
        area="Inteligência"
        title="Vendas"
        description="Indicadores de vendas desta unidade e da base de clientes e animais da clínica. Vendas contam como na Consulta vendas: em aberto e baixadas, pela data da venda."
      />
      <div className="mb-4">
        <PeriodPicker
          from={search.from}
          to={search.to}
          onChange={(p) => {
            set({ de: p.from, ate: p.to });
          }}
        />
      </div>
      <div className="mb-5">
        <Tabs
          label="Indicadores"
          value={search.tab}
          options={[
            { value: 'vendas', label: 'Vendas' },
            { value: 'clientes', label: 'Clientes' },
            { value: 'animais', label: 'Animais' },
          ]}
          onChange={(slug) => {
            set({ aba: slug === 'vendas' ? undefined : slug });
          }}
        />
      </div>
      <div {...tabPanelProps(search.tab)} className="space-y-5">
        <div className="flex flex-wrap items-end gap-4">
          {tab === 'sales' ? (
            <>
              <div className="w-full sm:w-44">
                <SelectField
                  label="Dia da semana"
                  value={search.weekday === undefined ? '' : String(search.weekday)}
                  placeholder="Todos"
                  options={weekdayLabels.map((label, i) => ({ value: String(i), label }))}
                  onChange={(e) => {
                    set({ dia: e.target.value === '' ? undefined : Number(e.target.value) });
                  }}
                />
              </div>
              <div className="w-full sm:w-48">
                <SelectField
                  label="Turno"
                  value={search.shift ?? ''}
                  placeholder="Todos"
                  options={saleShifts.map((s) => ({ value: s, label: saleShiftLabels[s] }))}
                  onChange={(e) => {
                    set({ turno: (e.target.value || undefined) as SaleShift | undefined });
                  }}
                />
              </div>
            </>
          ) : null}
          <Segmented
            label="Mostrar"
            value={onlyFavorites}
            options={[
              { value: 'todos', label: 'Todos os indicadores' },
              { value: 'favoritos', label: 'Só favoritos' },
            ]}
            onChange={setOnlyFavorites}
          />
        </div>
        {tab === 'sales' ? (
          <SalesTab search={search} favorites={favorites} onlyFavorites={onlyFavorites} />
        ) : tab === 'clients' ? (
          <ClientsTab search={search} favorites={favorites} onlyFavorites={onlyFavorites} />
        ) : (
          <PatientsTab search={search} favorites={favorites} onlyFavorites={onlyFavorites} />
        )}
      </div>
    </>
  );
}

interface Favorites {
  keys: IndicatorKey[];
  toggle: (key: IndicatorKey) => void;
}

/** Favoritos do usuário: a estrela muda na hora e volta atrás se o servidor recusar. */
function useFavorites(): Favorites {
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery(favoritesQuery);
  const save = useMutation({
    mutationFn: (keys: IndicatorKey[]) =>
      api('PUT', '/intelligence/favorites', intelligenceFavoritesSchema, { keys }),
    onMutate: async (keys) => {
      await queryClient.cancelQueries({ queryKey: favoritesQuery.queryKey });
      const previous = queryClient.getQueryData(favoritesQuery.queryKey);
      queryClient.setQueryData(favoritesQuery.queryKey, { keys });
      return { previous };
    },
    onError: (error, _keys, context) => {
      if (context?.previous) queryClient.setQueryData(favoritesQuery.queryKey, context.previous);
      toast.error(errorMessage(error));
    },
    onSuccess: (data) => {
      queryClient.setQueryData(favoritesQuery.queryKey, data);
    },
  });
  const keys = query.data?.keys ?? [];
  return {
    keys,
    toggle: (key) => {
      save.mutate(keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]);
    },
  };
}

interface Card {
  key: IndicatorKey;
  description?: string;
  /** Ocupa a largura toda (séries no tempo e tabelas). */
  wide?: boolean;
  content: ReactNode;
}

interface TabProps {
  search: IntelligenceSearch;
  favorites: Favorites;
  onlyFavorites: 'todos' | 'favoritos';
}

/** Favoritos primeiro, na ordem em que foram marcados; o resto na ordem da especificação. */
function Cards({
  cards,
  favorites,
  onlyFavorites,
}: {
  cards: Card[];
  favorites: Favorites;
  onlyFavorites: 'todos' | 'favoritos';
}) {
  const rank = (key: IndicatorKey) => {
    const i = favorites.keys.indexOf(key);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const ordered = [...cards].sort((a, b) => rank(a.key) - rank(b.key));
  const shown =
    onlyFavorites === 'favoritos' ? ordered.filter((c) => favorites.keys.includes(c.key)) : ordered;
  if (shown.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon={Star}
          title="Nenhum favorito nesta aba"
          description="Marque a estrela de um indicador para que ele apareça primeiro e entre na lista de favoritos."
        />
      </Panel>
    );
  }
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {shown.map((card) => (
        <IndicatorCard
          key={card.key}
          card={card}
          favorite={favorites.keys.includes(card.key)}
          onToggle={() => {
            favorites.toggle(card.key);
          }}
        />
      ))}
    </div>
  );
}

function IndicatorCard({
  card,
  favorite,
  onToggle,
}: {
  card: Card;
  favorite: boolean;
  onToggle: () => void;
}) {
  const titleId = `indicador-${card.key.replace('.', '-')}`;
  const label = indicators[card.key];
  return (
    <div className={clsx('min-w-0', card.wide && 'lg:col-span-2')}>
      <Panel labelledBy={titleId} className="h-full">
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm font-medium">
              {label}
            </h2>
            {card.description ? <p className="text-xs text-ink-muted">{card.description}</p> : null}
          </div>
          <button
            type="button"
            aria-pressed={favorite}
            aria-label={`Favoritar ${label}`}
            title={favorite ? 'Tirar dos favoritos' : 'Favoritar'}
            onClick={onToggle}
            className={clsx(
              '-m-1 shrink-0 rounded-md p-1.5 hover:bg-sunken',
              favorite ? 'text-amber-500' : 'text-ink-faint hover:text-ink',
            )}
          >
            <Star className={clsx('size-4', favorite && 'fill-current')} aria-hidden />
          </button>
        </div>
        <div className="p-4">{card.content}</div>
      </Panel>
    </div>
  );
}

function Nothing({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-ink-muted">{children}</p>;
}

function EvolutionChart({
  evolution,
  caption,
  name,
  money,
}: {
  evolution: Evolution;
  caption: string;
  name: string;
  money: boolean;
}) {
  return (
    <BarChart
      caption={caption}
      labels={evolution.points.map((p) =>
        // Muitos dias não cabem com o mês: fica só o dia, e o período está nos filtros.
        evolution.granularity === 'day' && evolution.points.length > 14
          ? p.period.slice(8, 10)
          : periodLabel(p.period),
      )}
      series={[{ name, tone: 'sage' }]}
      values={evolution.points.map((p) => [p.value])}
      format={money ? compact : integer}
    />
  );
}

function Ranking({
  caption,
  entries,
  money,
  empty,
  tone,
}: {
  caption: string;
  entries: { label: string; value: number; detail?: string }[];
  money: boolean;
  empty: string;
  tone?: 'sage' | 'amber';
}) {
  if (entries.length === 0 || entries.every((e) => e.value === 0))
    return <Nothing>{empty}</Nothing>;
  return (
    <RankBars
      caption={caption}
      entries={entries}
      format={money ? formatMoney : integer}
      tone={tone ?? 'sage'}
    />
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
  if (query.isPending) return <SkeletonRows rows={4} columns={3} />;
  if (query.isError || query.data === undefined) {
    return <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  }
  return <>{children(query.data)}</>;
}

const granularityNote = (e: Evolution) =>
  e.granularity === 'day' ? 'Por dia no período.' : 'Por mês: o período passa de 62 dias.';

function SalesTab({ search, favorites, onlyFavorites }: TabProps) {
  const query = useQuery(salesQuery(search));
  return (
    <Loading query={query}>
      {(s: SalesIntelligence) => (
        <div className="space-y-5">
          <Stats
            label="Totais das vendas"
            items={[
              { label: 'Venda líquida', value: formatMoney(s.totals.net) },
              { label: 'Vendas', value: integer(s.totals.count) },
              { label: 'Ticket médio', value: formatMoney(s.totals.averageTicket) },
            ]}
          />
          {s.totals.count === 0 ? (
            <Panel>
              <EmptyState
                icon={ChartPie}
                title="Nenhuma venda no período"
                description="Não há vendas em aberto ou baixadas com esses filtros. Mude o período, o dia da semana ou o turno."
              />
            </Panel>
          ) : (
            <Cards
              favorites={favorites}
              onlyFavorites={onlyFavorites}
              cards={[
                {
                  key: 'sales.evolution',
                  wide: true,
                  description: `Venda líquida. ${granularityNote(s.evolution)}`,
                  content: (
                    <EvolutionChart
                      evolution={s.evolution}
                      caption="Evolução das vendas"
                      name="Venda líquida"
                      money
                    />
                  ),
                },
                {
                  key: 'sales.byDate',

                  content: (
                    <div className="-mx-4 -my-4 max-h-80 overflow-y-auto">
                      <DataTable
                        caption="Vendas por data"
                        rows={s.byDate}
                        rowKey={(d) => d.date}
                        columns={[
                          { header: 'Data', cell: (d) => formatCalendarDate(d.date) },
                          {
                            header: 'Vendas',
                            className: 'text-right tabular-nums',
                            cell: (d) => integer(d.count),
                          },
                          {
                            header: 'Ticket médio',
                            className: 'text-right font-mono tabular-nums',
                            hideOnMobile: true,
                            cell: (d) => formatMoney(d.averageTicket),
                          },
                          {
                            header: 'Líquido',
                            className: 'text-right font-mono tabular-nums',
                            cell: (d) => formatMoney(d.net),
                          },
                        ]}
                      />
                    </div>
                  ),
                },
                {
                  key: 'sales.bySpecies',
                  description: 'Venda líquida pela espécie do animal da venda.',
                  content: (
                    <Ranking
                      caption="Receita por espécie"
                      entries={moneyEntries(s.bySpecies, salesLabel)}
                      money
                      empty="Nenhuma venda no período."
                    />
                  ),
                },
                {
                  key: 'sales.topItems',
                  description: 'Os dez de maior venda líquida, com a quantidade vendida.',
                  content: (
                    <Ranking
                      caption="Produtos e serviços mais vendidos"
                      entries={moneyEntries(s.topItems, units)}
                      money
                      empty="Nenhum item vendido."
                    />
                  ),
                },
                {
                  key: 'sales.byGroup',
                  content: (
                    <Ranking
                      caption="Vendas por grupo"
                      entries={moneyEntries(s.byGroup, units)}
                      money
                      empty="Nenhum item vendido."
                    />
                  ),
                },
                {
                  key: 'sales.topBrands',
                  content: (
                    <Ranking
                      caption="Marcas mais vendidas"
                      entries={moneyEntries(s.topBrands, units)}
                      money
                      empty="Nenhum item com marca vendido no período."
                    />
                  ),
                },
                {
                  key: 'sales.byWeekday',
                  content: (
                    <Ranking
                      caption="Vendas por dia da semana"
                      entries={moneyEntries(s.byWeekday, salesLabel)}
                      money
                      empty="Nenhuma venda no período."
                    />
                  ),
                },
                {
                  key: 'sales.byShift',
                  description: 'Pela hora da venda no fuso da unidade.',
                  content: (
                    <Ranking
                      caption="Vendas por turno"
                      entries={moneyEntries(s.byShift, salesLabel)}
                      money
                      empty="Nenhuma venda no período."
                    />
                  ),
                },
                {
                  key: 'sales.topPackages',
                  content: (
                    <Ranking
                      caption="Pacotes mais vendidos"
                      entries={moneyEntries(s.topPackages, units)}
                      money
                      empty="Nenhum pacote vendido no período."
                    />
                  ),
                },
                {
                  key: 'sales.byKind',
                  content: (
                    <Ranking
                      caption="Tipo de item"
                      entries={moneyEntries(s.byKind, units)}
                      money
                      tone="amber"
                      empty="Nenhum item vendido."
                    />
                  ),
                },
              ]}
            />
          )}
        </div>
      )}
    </Loading>
  );
}

const total = (e: Evolution) => e.points.reduce((a, p) => a + p.count, 0);

function ClientsTab({ search, favorites, onlyFavorites }: TabProps) {
  const query = useQuery(clientsQuery(search));
  return (
    <Loading query={query}>
      {(c: ClientsIntelligence) => (
        <div className="space-y-5">
          <Stats
            label="Totais dos clientes"
            items={[
              {
                label: 'Clientes ativos',
                value: integer(c.base),
                detail: 'Cadastrados até o fim do período',
              },
              { label: 'Novos no período', value: integer(total(c.newClients)) },
              {
                label: 'Compraram no período',
                value: integer(c.attendedCount),
                detail: share(c.attendedCount, c.base) + ' da base',
              },
            ]}
          />
          <Cards
            favorites={favorites}
            onlyFavorites={onlyFavorites}
            cards={[
              {
                key: 'clients.newClients',
                wide: true,
                description: granularityNote(c.newClients),
                content: (
                  <EvolutionChart
                    evolution={c.newClients}
                    caption="Evolução de novos clientes"
                    name="Novos clientes"
                    money={false}
                  />
                ),
              },
              {
                key: 'clients.topClients',
                description: 'Venda líquida nesta unidade no período.',
                content: (
                  <Ranking
                    caption="Clientes que mais compraram"
                    entries={moneyEntries(c.topClients, salesLabel)}
                    money
                    empty="Nenhum cliente comprou no período."
                  />
                ),
              },
              {
                key: 'clients.attended',
                description: 'Dias diferentes com venda no período.',
                content: (
                  <Ranking
                    caption="Clientes que compareceram"
                    entries={c.attended.map((r) => ({
                      label: r.label,
                      value: r.value,
                      detail: r.value === 1 ? 'dia' : 'dias',
                    }))}
                    money={false}
                    empty="Nenhum cliente compareceu no período."
                  />
                ),
              },
              ...(
                [
                  ['clients.byOrigin', c.byOrigin],
                  ['clients.byRelationship', c.byRelationship],
                  ['clients.byCity', c.byCity],
                  ['clients.byDistrict', c.byDistrict],
                  ['clients.bySex', c.bySex],
                  ['clients.byProfession', c.byProfession],
                  ['clients.byPersonType', c.byPersonType],
                ] as const
              ).map(([key, rows]) => ({
                key,
                content: (
                  <Ranking
                    caption={indicators[key]}
                    entries={countEntries(rows, c.base)}
                    money={false}
                    empty="Nenhum cliente cadastrado."
                  />
                ),
              })),
            ]}
          />
        </div>
      )}
    </Loading>
  );
}

function PatientsTab({ search, favorites, onlyFavorites }: TabProps) {
  const query = useQuery(patientsQuery(search));
  return (
    <Loading query={query}>
      {(p: PatientsIntelligence) => (
        <div className="space-y-5">
          <Stats
            label="Totais dos animais"
            items={[
              {
                label: 'Animais ativos',
                value: integer(p.base),
                detail: 'Vivos e cadastrados até o fim do período',
              },
              { label: 'Novos no período', value: integer(total(p.newPatients)) },
            ]}
          />
          <Cards
            favorites={favorites}
            onlyFavorites={onlyFavorites}
            cards={[
              {
                key: 'patients.newPatients',
                wide: true,
                description: granularityNote(p.newPatients),
                content: (
                  <EvolutionChart
                    evolution={p.newPatients}
                    caption="Evolução de novos animais"
                    name="Novos animais"
                    money={false}
                  />
                ),
              },
              ...(
                [
                  ['patients.bySpecies', p.bySpecies, undefined],
                  ['patients.byAge', p.byAge, 'Idade na data final do período.'],
                  ['patients.bySex', p.bySex, undefined],
                  ['patients.byBreed', p.byBreed, undefined],
                  [
                    'patients.byWeight',
                    p.byWeight,
                    'Último peso registrado no prontuário até o fim do período.',
                  ],
                  ['patients.sterilization', p.sterilization, undefined],
                ] as const
              ).map(([key, rows, description]) => ({
                key,
                ...(description ? { description } : {}),
                content: (
                  <Ranking
                    caption={indicators[key]}
                    entries={countEntries(rows, p.base)}
                    money={false}
                    empty="Nenhum animal cadastrado."
                  />
                ),
              })),
            ]}
          />
        </div>
      )}
    </Loading>
  );
}
