import type { Entry, EntryList, FinanceOptions } from '@clinica/contracts';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { ArrowLeftRight, Landmark, Minus, Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../design-system/button';
import { Segmented, SearchField, SelectField, TextField } from '../../design-system/field';
import { Badge, PageHeader, Panel, Stats } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { DataTable, Pagination } from '../../design-system/table';
import { errorMessage } from '../../lib/api';
import { formatCalendarDate } from '../../lib/format';
import { useCan } from '../../lib/session';
import { useDebounced } from '../../lib/use-debounced';
import { formatMoney } from '../products/format';
import {
  CancelEntryDialog,
  EntryDetailDialog,
  EntryFormDialog,
  entryStatus,
  PayDialog,
  TransferDialog,
  type EntryAction,
} from './entry-dialogs';
import {
  categoryLabel,
  categoryTree,
  entriesQuery,
  financeOptionsQuery,
  type EntrySearch,
  type EntrySituation,
  type EntryType,
} from './queries';

export type EntriesMode = 'ledger' | 'payable' | 'receivable';

const modes: Record<
  EntriesMode,
  {
    path: '/financeiro' | '/financeiro/contas-a-pagar' | '/financeiro/contas-a-receber';
    title: string;
    description: string;
    situations: { value: EntrySituation; label: string }[];
  }
> = {
  ledger: {
    path: '/financeiro',
    title: 'Lançamentos',
    description:
      'Receitas, despesas e transferências de todas as contas. As vendas entram sozinhas quando são recebidas.',
    situations: [
      { value: 'todos', label: 'Todos' },
      { value: 'abertos', label: 'Em aberto' },
      { value: 'pagos', label: 'Pagos' },
      { value: 'vencidos', label: 'Vencidos' },
      { value: 'cancelados', label: 'Cancelados' },
    ],
  },
  payable: {
    path: '/financeiro/contas-a-pagar',
    title: 'Contas a pagar',
    description: 'Despesas lançadas, das vencidas às próximas. Registre o pagamento quando sair.',
    situations: [
      { value: 'abertos', label: 'A pagar' },
      { value: 'vencidos', label: 'Vencidas' },
      { value: 'pagos', label: 'Pagas' },
    ],
  },
  receivable: {
    path: '/financeiro/contas-a-receber',
    title: 'Contas a receber',
    description:
      'Parcelas de cartão e demais receitas a receber. Confirme quando o dinheiro cair na conta.',
    situations: [
      { value: 'abertos', label: 'A receber' },
      { value: 'vencidos', label: 'Vencidas' },
      { value: 'pagos', label: 'Recebidas' },
    ],
  },
};

type DialogState =
  | { type: 'new'; kind: 'income' | 'expense' }
  | { type: 'transfer' }
  | { type: 'detail' | EntryAction; entry: Entry }
  | null;

/** Mudança nos filtros da URL; `undefined` volta ao padrão. */
interface UrlPatch {
  de?: string | undefined;
  ate?: string | undefined;
  conta?: string | undefined;
  categoria?: string | undefined;
  situacao?: EntrySituation | undefined;
  tipo?: EntryType | undefined;
  q?: string | undefined;
}

/** Extrato, contas a pagar e contas a receber [p.18–19]: a mesma lista com filtros diferentes. */
export function EntriesPage({ mode, search }: { mode: EntriesMode; search: EntrySearch }) {
  const config = modes[mode];
  const can = useCan();
  const navigate = useNavigate({ from: config.path });
  const set = (patch: UrlPatch) => {
    void navigate({ search: (prev) => ({ ...prev, page: undefined, ...patch }), replace: true });
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

  const options = useQuery(financeOptionsQuery);
  const list = useQuery(entriesQuery(search));
  const [dialog, setDialog] = useState<DialogState>(null);
  const close = () => {
    setDialog(null);
  };
  const manage = can('finance.manage');

  const newButtons = manage ? (
    <>
      {mode !== 'payable' ? (
        <Button
          variant={mode === 'receivable' ? 'primary' : 'secondary'}
          icon={<Plus className="size-4" aria-hidden />}
          onClick={() => {
            setDialog({ type: 'new', kind: 'income' });
          }}
        >
          Nova receita
        </Button>
      ) : null}
      {mode !== 'receivable' ? (
        <Button
          variant={mode === 'payable' ? 'primary' : 'secondary'}
          icon={<Minus className="size-4" aria-hidden />}
          onClick={() => {
            setDialog({ type: 'new', kind: 'expense' });
          }}
        >
          Nova despesa
        </Button>
      ) : null}
      {mode === 'ledger' ? (
        <Button
          variant="secondary"
          icon={<ArrowLeftRight className="size-4" aria-hidden />}
          onClick={() => {
            setDialog({ type: 'transfer' });
          }}
        >
          Transferência
        </Button>
      ) : null}
    </>
  ) : null;

  const categoryOptions = options.data
    ? categoryTree(options.data.categories)
        .filter((c) => mode === 'ledger' || c.kind === (mode === 'payable' ? 'expense' : 'income'))
        .map((c) => ({ value: c.id, label: categoryLabel(c, options.data.categories) }))
    : [];

  return (
    <>
      <PageHeader
        area="Financeiro"
        title={config.title}
        description={config.description}
        actions={newButtons}
      />

      {options.data && mode === 'ledger' ? <AccountBalances options={options.data} /> : null}
      {list.data && mode !== 'ledger' ? <PendingSummary list={list.data} mode={mode} /> : null}

      <Panel className="mb-5 space-y-4 p-4">
        <Segmented
          label="Situação"
          value={search.situacao}
          options={config.situations}
          onChange={(situacao) => {
            set({ situacao: situacao === config.situations[0]?.value ? undefined : situacao });
          }}
        />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <TextField
            label="De"
            type="date"
            value={search.de ?? list.data?.from ?? ''}
            onChange={(e) => {
              set({ de: e.target.value || undefined });
            }}
          />
          <TextField
            label="Até"
            type="date"
            value={search.ate ?? list.data?.to ?? ''}
            onChange={(e) => {
              set({ ate: e.target.value || undefined });
            }}
          />
          <SelectField
            label="Conta"
            value={search.conta ?? ''}
            placeholder="Todas"
            options={(options.data?.accounts ?? []).map((a) => ({ value: a.id, label: a.name }))}
            onChange={(e) => {
              set({ conta: e.target.value || undefined });
            }}
          />
          <SelectField
            label="Categoria"
            value={search.categoria ?? ''}
            placeholder="Todas"
            options={categoryOptions}
            onChange={(e) => {
              set({ categoria: e.target.value || undefined });
            }}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_16rem] sm:items-end">
          <SearchField
            label="Buscar lançamento"
            icon={<Search className="size-4" aria-hidden />}
            placeholder="Descrição, documento, fornecedor ou cliente"
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
            }}
          />
          {mode === 'ledger' ? (
            <SelectField
              label="Tipo"
              value={search.tipo}
              options={[
                { value: 'todos', label: 'Todos' },
                { value: 'receitas', label: 'Receitas' },
                { value: 'despesas', label: 'Despesas' },
                { value: 'transferencias', label: 'Transferências' },
              ]}
              onChange={(e) => {
                const tipo = e.target.value as EntryType;
                set({ tipo: tipo === 'todos' ? undefined : tipo });
              }}
            />
          ) : null}
        </div>
      </Panel>

      {list.isPending ? (
        <SkeletonRows rows={6} columns={4} />
      ) : list.isError ? (
        <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
      ) : (
        <Panel>
          {list.data.items.length === 0 ? (
            <EmptyState
              icon={Landmark}
              title="Nenhum lançamento nesta busca"
              description={
                mode === 'payable'
                  ? 'Lance aluguel, fornecedores e demais despesas para acompanhar o que vence.'
                  : 'Mude o período ou os filtros, ou faça um lançamento novo.'
              }
            />
          ) : (
            <div aria-busy={list.isFetching || undefined}>
              {list.data.openingBalance !== null ? (
                <p className="flex justify-between border-b border-line px-4 py-2.5 text-sm text-ink-muted">
                  <span>Saldo anterior</span>
                  <span className="font-mono tabular-nums">
                    {formatMoney(list.data.openingBalance)}
                  </span>
                </p>
              ) : null}
              <EntriesTable
                list={list.data}
                showAccount={!search.conta}
                onOpen={(entry) => {
                  setDialog({ type: 'detail', entry });
                }}
              />
              {mode === 'ledger' ? <Totals list={list.data} /> : null}
              <Pagination
                page={list.data.page}
                pageSize={list.data.pageSize}
                total={list.data.total}
                onPageChange={(page) => {
                  void navigate({ search: (prev) => ({ ...prev, page }), replace: true });
                }}
              />
            </div>
          )}
        </Panel>
      )}

      {options.data && dialog ? (
        dialog.type === 'new' ? (
          <EntryFormDialog kind={dialog.kind} entry={null} options={options.data} onClose={close} />
        ) : dialog.type === 'transfer' ? (
          <TransferDialog options={options.data} onClose={close} />
        ) : dialog.type === 'detail' ? (
          <EntryDetailDialog
            entry={dialog.entry}
            onClose={close}
            onAction={(action) => {
              setDialog({ type: action, entry: dialog.entry });
            }}
          />
        ) : dialog.type === 'pay' ? (
          <PayDialog entry={dialog.entry} options={options.data} onClose={close} />
        ) : dialog.type === 'edit' ? (
          <EntryFormDialog
            kind={dialog.entry.kind === 'income' ? 'income' : 'expense'}
            entry={dialog.entry}
            options={options.data}
            onClose={close}
          />
        ) : (
          <CancelEntryDialog entry={dialog.entry} onClose={close} />
        )
      ) : null}
    </>
  );
}

function AccountBalances({ options }: { options: FinanceOptions }) {
  const active = options.accounts.filter((a) => !a.archived);
  if (active.length === 0) return null;
  const total = active.reduce((a, b) => a + b.balance, 0);
  return (
    <div className="mb-5">
      <Stats
        label="Saldos das contas"
        items={[
          ...active.map((a) => ({
            label: a.name,
            value: <Money value={a.balance} />,
            detail: `Previsto ${formatMoney(a.forecast)}`,
          })),
          ...(active.length > 1 ? [{ label: 'Total', value: <Money value={total} /> }] : []),
        ]}
      />
    </div>
  );
}

function PendingSummary({ list, mode }: { list: EntryList; mode: 'payable' | 'receivable' }) {
  const listed = mode === 'payable' ? list.totals.expense : list.totals.income;
  return (
    <div className="mb-5">
      <Stats
        label={mode === 'payable' ? 'Resumo das contas a pagar' : 'Resumo das contas a receber'}
        items={[
          {
            label: 'Vencidas',
            value: formatMoney(list.pending.overdue.amount),
            detail: plural(list.pending.overdue.count),
          },
          {
            label: 'Próximos 7 dias',
            value: formatMoney(list.pending.next7.amount),
            detail: plural(list.pending.next7.count),
          },
          { label: 'Total nesta lista', value: formatMoney(listed), detail: plural(list.total) },
        ]}
      />
    </div>
  );
}

const plural = (n: number) => (n === 1 ? '1 lançamento' : `${String(n)} lançamentos`);

function Money({ value }: { value: number }) {
  return <span className={value < 0 ? 'text-danger-600' : undefined}>{formatMoney(value)}</span>;
}

function EntriesTable({
  list,
  showAccount,
  onOpen,
}: {
  list: EntryList;
  showAccount: boolean;
  onOpen: (entry: Entry) => void;
}) {
  const withBalance = list.items.some((e) => e.runningBalance !== null);
  return (
    <DataTable
      caption="Lançamentos"
      rows={list.items}
      rowKey={(e) => e.id}
      columns={[
        {
          header: 'Data',
          hideOnMobile: true,
          className: 'w-28',
          cell: (e) => (
            <>
              <span className="block font-mono text-sm tabular-nums">
                {formatCalendarDate(e.paidOn ?? e.dueDate)}
              </span>
              <span className="block text-xs text-ink-muted">{e.paidOn ? 'Pago' : 'Vence'}</span>
            </>
          ),
        },
        {
          header: 'Lançamento',
          cell: (e) => {
            const status = entryStatus(e);
            const meta = [
              e.kind === 'transfer' && e.counterpart
                ? `${e.direction === 'out' ? 'Para' : 'De'} ${e.counterpart.name}`
                : e.category?.name,
              e.supplier?.name ?? e.client?.name,
              e.installment
                ? `Parcela ${String(e.installment.number)}/${String(e.installment.total)}`
                : null,
              showAccount ? e.account.name : null,
            ].filter(Boolean);
            return (
              <div className="min-w-0">
                <button
                  type="button"
                  className={clsx(
                    'text-left text-sm font-medium text-ink hover:text-sage-700 hover:underline',
                    e.status === 'cancelled' && 'text-ink-muted line-through',
                  )}
                  onClick={() => {
                    onOpen(e);
                  }}
                >
                  {e.description}
                </button>
                <span className="block text-xs text-ink-muted">{meta.join(' · ')}</span>
                <span className="mt-1 flex items-center gap-2 md:hidden">
                  <span className="font-mono text-xs text-ink-muted tabular-nums">
                    {formatCalendarDate(e.paidOn ?? e.dueDate)}
                  </span>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </span>
              </div>
            );
          },
        },
        {
          header: 'Situação',
          hideOnMobile: true,
          className: 'w-28',
          cell: (e) => {
            const status = entryStatus(e);
            return <Badge tone={status.tone}>{status.label}</Badge>;
          },
        },
        {
          header: 'Valor',
          className: 'text-right whitespace-nowrap',
          cell: (e) => (
            <span
              className={clsx(
                'font-mono text-sm tabular-nums',
                e.status === 'cancelled'
                  ? 'text-ink-faint line-through'
                  : e.direction === 'in'
                    ? 'text-sage-700'
                    : 'text-danger-600',
              )}
            >
              {e.direction === 'in' ? '+' : '−'}
              {formatMoney(e.paidAmount ?? e.amount)}
            </span>
          ),
        },
        ...(withBalance
          ? [
              {
                header: 'Saldo',
                hideOnMobile: true,
                className: 'text-right whitespace-nowrap',
                cell: (e: Entry) =>
                  e.runningBalance === null ? null : (
                    <span className="font-mono text-sm tabular-nums">
                      <Money value={e.runningBalance} />
                    </span>
                  ),
              },
            ]
          : []),
      ]}
    />
  );
}

function Totals({ list }: { list: EntryList }) {
  const result = list.totals.income - list.totals.expense;
  return (
    <dl
      aria-label="Totais da busca"
      className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-line px-4 py-3 text-sm"
    >
      <div className="flex gap-2">
        <dt className="text-ink-muted">Receitas</dt>
        <dd className="font-mono text-sage-700 tabular-nums">{formatMoney(list.totals.income)}</dd>
      </div>
      <div className="flex gap-2">
        <dt className="text-ink-muted">Despesas</dt>
        <dd className="font-mono text-danger-600 tabular-nums">
          {formatMoney(list.totals.expense)}
        </dd>
      </div>
      <div className="flex gap-2">
        <dt className="text-ink-muted">Resultado</dt>
        <dd className="font-mono font-medium tabular-nums">
          <Money value={result} />
        </dd>
      </div>
    </dl>
  );
}
