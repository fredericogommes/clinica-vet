import {
  cashFlowSchema,
  statementRegimeLabels,
  statementRegimes,
  statementSchema,
  type CashFlow,
  type Statement,
  type StatementRegime,
  type StatementRow,
} from '@clinica/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { LineChart as LineChartIcon, Scale } from 'lucide-react';
import { BarChart, LineChart, type ChartSeries } from '../../design-system/chart';
import { Segmented, SelectField, TextField } from '../../design-system/field';
import { PageHeader, Panel, Stats } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { DataTable } from '../../design-system/table';
import { api, errorMessage } from '../../lib/api';
import { formatCalendarDate } from '../../lib/format';
import { useCan } from '../../lib/session';
import { formatMoney } from '../products/format';
import { financeOptionsQuery } from './queries';

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
/** "2026-03" → "mar/26". */
const monthLabel = (month: string) =>
  `${monthNames[Number(month.slice(5, 7)) - 1] ?? month}/${month.slice(2, 4)}`;
const compactMoney = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const compact = (value: number) => compactMoney.format(value);

function Signed({ value, strong }: { value: number; strong?: boolean }) {
  return (
    <span
      className={clsx(
        'font-mono whitespace-nowrap tabular-nums',
        value < 0 && 'text-danger-600',
        value > 0 && strong && 'text-sage-700',
      )}
    >
      {formatMoney(value)}
    </span>
  );
}

// Demonstrativo ------------------------------------------------------------------------------------

export interface StatementSearch {
  regime: StatementRegime;
  de: string | undefined;
  ate: string | undefined;
  centro: string | undefined;
}

const statementQuery = (s: StatementSearch) => ({
  queryKey: ['finance', 'statement', s],
  queryFn: () => {
    const params = new URLSearchParams({ regime: s.regime });
    if (s.de) params.set('de', s.de);
    if (s.ate) params.set('ate', s.ate);
    if (s.centro) params.set('centro', s.centro);
    return api('GET', `/finance/statement?${params.toString()}`, statementSchema);
  },
  placeholderData: keepPreviousData,
});

/**
 * Demonstrativo gerencial [p.18]: categorias em linhas e meses em colunas, com o alternador de
 * regime de caixa ou competência e filtro por centro de custo.
 */
export function StatementPage({ search }: { search: StatementSearch }) {
  const can = useCan();
  const navigate = useNavigate({ from: '/financeiro/demonstrativo' });
  const set = (patch: Partial<StatementSearch>) => {
    void navigate({
      search: (prev) => {
        const next = { ...prev, ...patch };
        return { ...next, regime: next.regime === 'competencia' ? undefined : next.regime };
      },
      replace: true,
    });
  };
  const statement = useQuery(statementQuery(search));
  const options = useQuery({ ...financeOptionsQuery, enabled: can('finance.view') });
  const data = statement.data;
  const competencia = search.regime === 'competencia';

  return (
    <>
      <PageHeader
        area="Financeiro"
        title="Demonstrativo"
        description="Receitas e despesas por categoria, mês a mês. Na competência, cada lançamento conta no mês a que se refere, mesmo em aberto; no caixa, só o que foi pago, no dia do pagamento."
      />
      {data ? (
        <div className="mb-5">
          <Stats
            label="Resumo do demonstrativo"
            items={[
              { label: 'Receitas', value: formatMoney(data.income.total) },
              { label: 'Despesas', value: formatMoney(data.expense.total) },
              {
                label: 'Resultado',
                value: <Signed value={data.result.total} strong />,
                detail: `${monthLabel(data.months[0] ?? '')} a ${monthLabel(data.months.at(-1) ?? '')}`,
              },
              ...(competencia
                ? [
                    {
                      label: 'Ainda em aberto',
                      value: <Signed value={data.open.total} />,
                      detail: 'A receber menos a pagar',
                    },
                  ]
                : []),
            ]}
          />
        </div>
      ) : null}
      <Panel className="mb-5 space-y-4 p-4">
        <Segmented
          label="Regime"
          value={search.regime}
          options={statementRegimes.map((r) => ({ value: r, label: statementRegimeLabels[r] }))}
          onChange={(regime) => {
            set({ regime });
          }}
        />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <TextField
            label="De"
            type="month"
            value={search.de ?? data?.months[0] ?? ''}
            onChange={(e) => {
              set({ de: e.target.value || undefined });
            }}
          />
          <TextField
            label="Até"
            type="month"
            value={search.ate ?? data?.months.at(-1) ?? ''}
            onChange={(e) => {
              set({ ate: e.target.value || undefined });
            }}
          />
          {options.data ? (
            <div className="col-span-2">
              <SelectField
                label="Centro de custo"
                value={search.centro ?? ''}
                placeholder="Todos"
                options={options.data.costCenters.map((c) => ({ value: c.id, label: c.name }))}
                onChange={(e) => {
                  set({ centro: e.target.value || undefined });
                }}
              />
            </div>
          ) : null}
        </div>
      </Panel>

      {statement.isPending ? (
        <SkeletonRows rows={8} columns={6} />
      ) : statement.isError ? (
        <ErrorState
          message={errorMessage(statement.error)}
          onRetry={() => void statement.refetch()}
        />
      ) : statement.data.income.rows.length === 0 && statement.data.expense.rows.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Scale}
            title="Nenhuma receita ou despesa no período"
            description="Os lançamentos do financeiro e das vendas aparecem aqui por categoria."
          />
        </Panel>
      ) : (
        <Panel>
          <StatementTable data={statement.data} />
        </Panel>
      )}
    </>
  );
}

function StatementTable({ data }: { data: Statement }) {
  const cell = 'px-3 py-2 text-right font-mono text-sm whitespace-nowrap tabular-nums';
  const first =
    'sticky left-0 z-10 bg-surface px-4 py-2 text-left whitespace-nowrap shadow-[1px_0_0_var(--color-line)]';
  const sectionRow = (title: string, line: { values: number[]; total: number }) => (
    <tr className="border-t border-line bg-sunken/60">
      <th scope="row" className={clsx(first, 'bg-sunken font-medium text-ink')}>
        {title}
      </th>
      {line.values.map((v, i) => (
        <td key={data.months[i]} className={clsx(cell, 'font-medium')}>
          {formatMoney(v)}
        </td>
      ))}
      <td className={clsx(cell, 'font-semibold')}>{formatMoney(line.total)}</td>
    </tr>
  );
  const categoryRow = (r: StatementRow) => (
    <tr key={`${r.categoryId ?? 'none'}:${r.name}`} className="border-t border-line/60">
      <th
        scope="row"
        className={clsx(first, 'font-normal', r.depth === 0 ? 'text-ink' : 'pl-8 text-ink-muted')}
      >
        {r.name}
      </th>
      {r.values.map((v, i) => (
        <td key={data.months[i]} className={clsx(cell, v === 0 ? 'text-ink-faint' : 'text-ink')}>
          {v === 0 ? '—' : formatMoney(v)}
        </td>
      ))}
      <td className={clsx(cell, 'text-ink')}>{formatMoney(r.total)}</td>
    </tr>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">
          Demonstrativo por categoria e mês, regime de {statementRegimeLabels[data.regime]}
        </caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={clsx(first, 'text-xs font-medium text-ink-muted')}>
              Categoria
            </th>
            {data.months.map((m) => (
              <th
                key={m}
                scope="col"
                className="px-3 py-2.5 text-right text-xs font-medium text-ink-muted"
              >
                {monthLabel(m)}
              </th>
            ))}
            <th scope="col" className="px-3 py-2.5 text-right text-xs font-medium text-ink-muted">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {sectionRow('Receitas', data.income)}
          {data.income.rows.map(categoryRow)}
          {sectionRow('Despesas', data.expense)}
          {data.expense.rows.map(categoryRow)}
          <tr className="border-t-2 border-line-strong">
            <th scope="row" className={clsx(first, 'font-semibold text-ink')}>
              Resultado
            </th>
            {data.result.values.map((v, i) => (
              <td key={data.months[i]} className={clsx(cell, 'font-medium')}>
                <Signed value={v} strong />
              </td>
            ))}
            <td className={clsx(cell, 'font-semibold')}>
              <Signed value={data.result.total} strong />
            </td>
          </tr>
          {data.regime === 'competencia' ? (
            <tr className="border-t border-line/60 text-ink-muted">
              <th scope="row" className={clsx(first, 'text-xs font-normal')}>
                Ainda em aberto
              </th>
              {data.open.values.map((v, i) => (
                <td key={data.months[i]} className={clsx(cell, 'text-xs')}>
                  {v === 0 ? '—' : formatMoney(v)}
                </td>
              ))}
              <td className={clsx(cell, 'text-xs')}>{formatMoney(data.open.total)}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

// Fluxo de caixa -----------------------------------------------------------------------------------

export const cashFlowKinds = ['ambos', 'receitas', 'despesas'] as const;
export const cashFlowSituations = ['todos', 'realizado', 'previsto'] as const;

export interface CashFlowSearch {
  de: string | undefined;
  ate: string | undefined;
  conta: string | undefined;
  tipo: (typeof cashFlowKinds)[number];
  situacao: (typeof cashFlowSituations)[number];
}

const cashFlowQuery = (s: CashFlowSearch) => ({
  queryKey: ['finance', 'cash-flow', s.de, s.ate, s.conta],
  queryFn: () => {
    const params = new URLSearchParams();
    if (s.de) params.set('de', s.de);
    if (s.ate) params.set('ate', s.ate);
    if (s.conta) params.set('conta', s.conta);
    return api('GET', `/finance/cash-flow?${params.toString()}`, cashFlowSchema);
  },
  placeholderData: keepPreviousData,
});

/** Fluxo de caixa [p.18]: receitas × despesas por mês e saldo diário real × previsto. */
export function CashFlowPage({ search }: { search: CashFlowSearch }) {
  const can = useCan();
  const navigate = useNavigate({ from: '/financeiro/fluxo-de-caixa' });
  const set = (patch: Partial<CashFlowSearch>) => {
    void navigate({
      search: (prev) => {
        const next = { ...prev, ...patch };
        return {
          ...next,
          tipo: next.tipo === 'ambos' ? undefined : next.tipo,
          situacao: next.situacao === 'todos' ? undefined : next.situacao,
        };
      },
      replace: true,
    });
  };
  const flow = useQuery(cashFlowQuery(search));
  const options = useQuery({ ...financeOptionsQuery, enabled: can('finance.view') });
  const data = flow.data;
  const realOn = data ? (data.to < data.today ? data.to : data.today) : '';

  return (
    <>
      <PageHeader
        area="Financeiro"
        title="Fluxo de caixa"
        description="O que entrou e saiu em cada mês e o saldo dia a dia: o real, com o que já foi pago, e o previsto, somando o que vence e ainda está em aberto."
      />
      {data ? (
        <div className="mb-5">
          <Stats
            label="Resumo do fluxo de caixa"
            items={[
              {
                label: 'Saldo inicial',
                value: <Signed value={data.summary.openingBalance} />,
                detail: `Antes de ${formatCalendarDate(data.from)}`,
              },
              {
                label: 'Saldo real',
                value: <Signed value={data.summary.realBalance} />,
                detail: data.from > data.today ? 'Hoje' : `Em ${formatCalendarDate(realOn)}`,
              },
              {
                label: 'Saldo previsto',
                value: <Signed value={data.summary.forecastBalance} />,
                detail: `Em ${formatCalendarDate(data.to)}`,
              },
              {
                label: 'Receitas',
                value: formatMoney(data.summary.income.paid + data.summary.income.open),
                detail: `${formatMoney(data.summary.income.open)} a receber`,
              },
              {
                label: 'Despesas',
                value: formatMoney(data.summary.expense.paid + data.summary.expense.open),
                detail: `${formatMoney(data.summary.expense.open)} a pagar`,
              },
            ]}
          />
        </div>
      ) : null}
      <Panel className="mb-5 space-y-4 p-4">
        <div className="flex flex-wrap gap-x-6 gap-y-4">
          <Segmented
            label="Tipo"
            value={search.tipo}
            options={[
              { value: 'ambos', label: 'Receitas e despesas' },
              { value: 'receitas', label: 'Receitas' },
              { value: 'despesas', label: 'Despesas' },
            ]}
            onChange={(tipo) => {
              set({ tipo });
            }}
          />
          <Segmented
            label="Situação"
            value={search.situacao}
            options={[
              { value: 'todos', label: 'Realizado e previsto' },
              { value: 'realizado', label: 'Realizado' },
              { value: 'previsto', label: 'Previsto' },
            ]}
            onChange={(situacao) => {
              set({ situacao });
            }}
          />
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <TextField
            label="De"
            type="date"
            value={search.de ?? data?.from ?? ''}
            onChange={(e) => {
              set({ de: e.target.value || undefined });
            }}
          />
          <TextField
            label="Até"
            type="date"
            value={search.ate ?? data?.to ?? ''}
            onChange={(e) => {
              set({ ate: e.target.value || undefined });
            }}
          />
          {options.data ? (
            <div className="col-span-2">
              <SelectField
                label="Conta"
                value={search.conta ?? ''}
                placeholder="Todas"
                options={options.data.accounts.map((a) => ({ value: a.id, label: a.name }))}
                onChange={(e) => {
                  set({ conta: e.target.value || undefined });
                }}
              />
            </div>
          ) : null}
        </div>
      </Panel>

      {flow.isPending ? (
        <SkeletonRows rows={6} columns={4} />
      ) : flow.isError ? (
        <ErrorState message={errorMessage(flow.error)} onRetry={() => void flow.refetch()} />
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          <MonthlyPanel data={flow.data} search={search} />
          <DailyPanel data={flow.data} />
        </div>
      )}
    </>
  );
}

function MonthlyPanel({ data, search }: { data: CashFlow; search: CashFlowSearch }) {
  const showIncome = search.tipo !== 'despesas';
  const showExpense = search.tipo !== 'receitas';
  const showPaid = search.situacao !== 'previsto';
  const showOpen = search.situacao !== 'realizado';
  const series: (ChartSeries & { pick: (m: CashFlow['months'][number]) => number })[] = [
    ...(showIncome && showPaid
      ? [
          {
            name: 'Receitas realizadas',
            tone: 'sage' as const,
            pick: (m: CashFlow['months'][number]) => m.income.paid,
          },
        ]
      : []),
    ...(showIncome && showOpen
      ? [
          {
            name: 'Receitas previstas',
            tone: 'sage-light' as const,
            pick: (m: CashFlow['months'][number]) => m.income.open,
          },
        ]
      : []),
    ...(showExpense && showPaid
      ? [
          {
            name: 'Despesas realizadas',
            tone: 'amber' as const,
            pick: (m: CashFlow['months'][number]) => m.expense.paid,
          },
        ]
      : []),
    ...(showExpense && showOpen
      ? [
          {
            name: 'Despesas previstas',
            tone: 'amber-light' as const,
            pick: (m: CashFlow['months'][number]) => m.expense.open,
          },
        ]
      : []),
  ];
  const empty = data.months.every((m) => series.every((s) => s.pick(m) === 0));
  return (
    <Panel labelledBy="cash-flow-months" className="min-w-0 p-4">
      <h2 id="cash-flow-months" className="mb-4 font-display text-base font-semibold text-ink">
        Receitas × despesas por mês
      </h2>
      {empty ? (
        <EmptyState
          icon={LineChartIcon}
          title="Nada neste período"
          description="Mude o período, a conta ou os filtros de tipo e situação."
        />
      ) : (
        <>
          <BarChart
            caption="Receitas e despesas por mês"
            labels={data.months.map((m) => monthLabel(m.month))}
            series={series}
            values={data.months.map((m) => series.map((s) => s.pick(m)))}
            format={compact}
          />
          <div className="mt-4 border-t border-line pt-2">
            <DataTable
              caption="Resultado por mês"
              rowKey={(m) => m.month}
              rows={data.months}
              columns={[
                { header: 'Mês', cell: (m) => monthLabel(m.month) },
                ...(showIncome
                  ? [
                      {
                        header: 'Receitas',
                        className: 'text-right',
                        cell: (m: CashFlow['months'][number]) => (
                          <span className="font-mono tabular-nums">
                            {formatMoney(
                              (showPaid ? m.income.paid : 0) + (showOpen ? m.income.open : 0),
                            )}
                          </span>
                        ),
                      },
                    ]
                  : []),
                ...(showExpense
                  ? [
                      {
                        header: 'Despesas',
                        className: 'text-right',
                        cell: (m: CashFlow['months'][number]) => (
                          <span className="font-mono tabular-nums">
                            {formatMoney(
                              (showPaid ? m.expense.paid : 0) + (showOpen ? m.expense.open : 0),
                            )}
                          </span>
                        ),
                      },
                    ]
                  : []),
                {
                  header: 'Resultado',
                  className: 'text-right',
                  hideOnMobile: true,
                  cell: (m) => (
                    <Signed
                      strong
                      value={
                        (showIncome
                          ? (showPaid ? m.income.paid : 0) + (showOpen ? m.income.open : 0)
                          : 0) -
                        (showExpense
                          ? (showPaid ? m.expense.paid : 0) + (showOpen ? m.expense.open : 0)
                          : 0)
                      }
                    />
                  ),
                },
              ]}
            />
          </div>
        </>
      )}
    </Panel>
  );
}

function DailyPanel({ data }: { data: CashFlow }) {
  const n = data.days.length;
  const ticks = Array.from({ length: Math.min(5, n) }, (_, i) =>
    n <= 1 ? 0 : Math.round((i * (n - 1)) / (Math.min(5, n) - 1)),
  );
  return (
    <Panel labelledBy="cash-flow-days" className="min-w-0 p-4">
      <h2 id="cash-flow-days" className="mb-4 font-display text-base font-semibold text-ink">
        Saldo diário
      </h2>
      <LineChart
        caption="Saldo diário real e previsto"
        labels={data.days.map((d) => formatCalendarDate(d.date))}
        tickLabels={ticks.map((i) => formatCalendarDate(data.days[i]?.date ?? '').slice(0, 5))}
        format={compact}
        series={[
          { name: 'Saldo real', tone: 'sage', values: data.days.map((d) => d.real) },
          {
            name: 'Saldo previsto',
            tone: 'amber',
            dashed: true,
            values: data.days.map((d) => d.forecast),
          },
        ]}
      />
    </Panel>
  );
}
