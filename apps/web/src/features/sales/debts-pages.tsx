import type { ClientDebt, Sale } from '@clinica/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { HandCoins, Search, Wallet, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '../../design-system/button';
import { Checkbox } from '../../design-system/checkbox';
import { SearchField } from '../../design-system/field';
import { Badge, PageHeader, Panel, Stats } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { DataTable, Pagination } from '../../design-system/table';
import { useToast } from '../../design-system/toast';
import { errorMessage } from '../../lib/api';
import { formatCalendarDate } from '../../lib/format';
import { useCan } from '../../lib/session';
import { useDebounced } from '../../lib/use-debounced';
import { useCashGate } from '../cash/cash-gate';
import { formatMoney } from '../products/format';
import { clientBalancesQuery, clientDebtsQuery, saleQuery } from './queries';
import { SettleDialog } from './sale-pages';

const money = (value: number) => (
  <span className="font-mono whitespace-nowrap tabular-nums">{formatMoney(value)}</span>
);
const clients = (n: number) => `${String(n)} ${n === 1 ? 'cliente' : 'clientes'}`;

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

function ClientCell({ client }: { client: { id: string; code: number; name: string } }) {
  const can = useCan();
  return can('clients.view') ? (
    <Link
      to="/clientes/$clientId"
      params={{ clientId: client.id }}
      className="block font-medium hover:underline"
    >
      {client.name}
    </Link>
  ) : (
    <span className="block font-medium">{client.name}</span>
  );
}

export interface DebtSearch {
  q: string;
  clientId: string | undefined;
  overdue: boolean;
  page: number;
}

/** Mudança nos filtros da URL; `undefined` volta ao padrão. */
interface DebtPatch {
  q?: string | undefined;
  cliente?: string | undefined;
  vencidos?: boolean | undefined;
  page?: number | undefined;
}

/**
 * Recebimentos [p.10]: o que ficou na conta do cliente, venda a venda, com o vencimento. Cada
 * linha recebe tudo ou uma parte pelo caixa do operador, em qualquer forma.
 */
export function ClientDebtsPage({ search }: { search: DebtSearch }) {
  const navigate = useNavigate({ from: '/vendas/recebimentos' });
  const queryClient = useQueryClient();
  const toast = useToast();
  const [term, setTerm] = useState(search.q);
  const debounced = useDebounced(term.trim());
  const change = (patch: DebtPatch) => {
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  };
  useEffect(() => {
    if (debounced !== search.q) {
      void navigate({
        search: (prev) => ({ ...prev, q: debounced || undefined, page: undefined }),
        replace: true,
      });
    }
  }, [debounced, search.q, navigate]);
  const list = useQuery(clientDebtsQuery(search));
  const [settling, setSettling] = useState<Sale | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const cashGate = useCashGate('O recebimento entra no seu caixa. Abra-o para continuar.');
  // A venda é lida na hora: o diálogo confere o que falta com o servidor, não com a lista.
  const receive = (debt: ClientDebt) => {
    cashGate.gate(() => {
      setOpening(debt.id);
      queryClient
        .query({ ...saleQuery(debt.sale.id), staleTime: 0 })
        .then(setSettling)
        .catch((e: unknown) => {
          toast.error(errorMessage(e));
        })
        .finally(() => {
          setOpening(null);
        });
    });
  };
  const filteredClient = search.clientId
    ? list.data?.items.find((d) => d.client.id === search.clientId)?.client
    : undefined;

  return (
    <>
      <PageHeader
        area="Vendas"
        title="Recebimentos"
        description="O que ficou na conta do cliente nas vendas baixadas de todas as unidades. O recebimento entra no seu caixa, inteiro ou em parte."
      />
      {cashGate.dialog}
      <Loading query={list}>
        {(page) => (
          <div className="space-y-5">
            <Stats
              label="Totais dos recebimentos filtrados"
              items={[
                {
                  label: 'A receber',
                  value: formatMoney(page.totals.open),
                  detail: clients(page.totals.clients),
                },
                { label: 'Vencido', value: formatMoney(page.totals.overdue) },
              ]}
            />
            <Panel>
              <div className="space-y-3 border-b border-line p-4">
                <SearchField
                  label="Buscar recebimentos"
                  placeholder="Cliente, código do cliente ou da venda"
                  icon={<Search className="size-4" aria-hidden />}
                  value={term}
                  onChange={(e) => {
                    setTerm(e.target.value);
                  }}
                />
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  <Checkbox
                    label="Só vencidos"
                    checked={search.overdue}
                    onCheckedChange={(checked) => {
                      change({ vencidos: checked || undefined, page: undefined });
                    }}
                  />
                  {search.clientId ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<X className="size-4" aria-hidden />}
                      onClick={() => {
                        change({ cliente: undefined, page: undefined });
                      }}
                    >
                      {filteredClient ? `Cliente: ${filteredClient.name}` : 'Um cliente'} · ver
                      todos
                    </Button>
                  ) : null}
                </div>
              </div>
              {page.items.length === 0 ? (
                <EmptyState
                  icon={HandCoins}
                  title={
                    search.q || search.overdue || search.clientId
                      ? 'Nenhum recebimento encontrado'
                      : 'Nenhuma conta de cliente em aberto'
                  }
                  description={
                    search.q || search.overdue || search.clientId
                      ? 'Ajuste a busca ou os filtros.'
                      : 'Quando uma venda for baixada com parte na conta do cliente, ela aparece aqui.'
                  }
                />
              ) : (
                <>
                  <DataTable
                    caption="Contas de cliente em aberto"
                    rows={page.items}
                    rowKey={(d) => d.id}
                    columns={[
                      {
                        header: 'Cliente',
                        cell: (d) => (
                          <span className="block min-w-0">
                            <ClientCell client={d.client} />
                            <span className="block text-xs text-ink-muted">
                              <Link
                                to="/vendas/$saleId"
                                params={{ saleId: d.sale.id }}
                                className="font-mono hover:underline"
                              >
                                Venda {d.sale.code}
                              </Link>
                              {d.patientName ? ` · ${d.patientName}` : ''}
                            </span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted md:hidden">
                              Vence em {formatCalendarDate(d.dueDate)}
                              {d.overdue ? <Badge tone="danger">Vencido</Badge> : null}
                            </span>
                          </span>
                        ),
                      },
                      {
                        header: 'Vencimento',
                        hideOnMobile: true,
                        cell: (d) => (
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="whitespace-nowrap">
                              {formatCalendarDate(d.dueDate)}
                            </span>
                            {d.overdue ? <Badge tone="danger">Vencido</Badge> : null}
                          </span>
                        ),
                      },
                      {
                        header: 'Valor',
                        className: 'text-right',
                        hideOnMobile: true,
                        cell: (d) => money(d.amount),
                      },
                      {
                        header: 'Recebido',
                        className: 'text-right',
                        hideOnMobile: true,
                        cell: (d) => money(d.paid),
                      },
                      {
                        header: 'Falta',
                        className: 'text-right',
                        cell: (d) => <strong>{money(d.open)}</strong>,
                      },
                      {
                        header: 'Ação',
                        className: 'text-right',
                        cell: (d) => (
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<Wallet className="size-4" aria-hidden />}
                            pending={opening === d.id}
                            aria-label={`Receber venda ${String(d.sale.code)} de ${d.client.name}`}
                            onClick={() => {
                              receive(d);
                            }}
                          >
                            Receber
                          </Button>
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
              )}
            </Panel>
          </div>
        )}
      </Loading>
      {settling ? (
        <SettleDialog
          sale={settling}
          onClose={() => {
            setSettling(null);
          }}
        />
      ) : null}
    </>
  );
}

/** Saldo dos clientes [p.10]: quanto cada cliente deve na conta, do maior débito ao menor. */
export function ClientBalancesPage() {
  const balances = useQuery(clientBalancesQuery);
  const can = useCan();
  return (
    <>
      <PageHeader
        area="Vendas"
        title="Saldo dos clientes"
        description="Débitos em aberto na conta de cada cliente, somando as vendas de todas as unidades."
      />
      <Loading query={balances}>
        {(b) => (
          <div className="space-y-5">
            <Stats
              label="Totais do saldo dos clientes"
              items={[
                {
                  label: 'A receber',
                  value: formatMoney(b.totals.open),
                  detail: clients(b.totals.clients),
                },
                { label: 'Vencido', value: formatMoney(b.totals.overdue) },
              ]}
            />
            <Panel>
              {b.items.length === 0 ? (
                <EmptyState
                  icon={HandCoins}
                  title="Nenhum cliente com débito"
                  description="Quando uma venda for baixada com parte na conta do cliente, o saldo aparece aqui."
                />
              ) : (
                <DataTable
                  caption="Débito por cliente"
                  rows={b.items}
                  rowKey={(i) => i.client.id}
                  columns={[
                    {
                      header: 'Cliente',
                      cell: (i) => (
                        <span className="block min-w-0">
                          <ClientCell client={i.client} />
                          <span className="block font-mono text-xs text-ink-muted">
                            #{i.client.code} ·{' '}
                            {i.sales === 1 ? '1 venda' : `${String(i.sales)} vendas`}
                          </span>
                        </span>
                      ),
                    },
                    {
                      header: 'Vence primeiro',
                      hideOnMobile: true,
                      cell: (i) => (
                        <span className="whitespace-nowrap">{formatCalendarDate(i.oldestDue)}</span>
                      ),
                    },
                    {
                      header: 'Vencido',
                      className: 'text-right',
                      hideOnMobile: true,
                      cell: (i) =>
                        i.overdue > 0 ? (
                          <span className="text-danger-600">{money(i.overdue)}</span>
                        ) : (
                          money(0)
                        ),
                    },
                    {
                      header: 'Em aberto',
                      className: 'text-right',
                      cell: (i) => <strong>{money(i.open)}</strong>,
                    },
                    {
                      header: 'Ação',
                      className: 'text-right',
                      cell: (i) =>
                        can('sales.debts') ? (
                          <Link
                            to="/vendas/recebimentos"
                            search={{ cliente: i.client.id }}
                            aria-label={`Ver recebimentos de ${i.client.name}`}
                            className="text-sm font-medium whitespace-nowrap text-sage-700 hover:underline"
                          >
                            Ver vendas
                          </Link>
                        ) : null,
                    },
                  ]}
                />
              )}
            </Panel>
          </div>
        )}
      </Loading>
    </>
  );
}
