import {
  stockCancelSchema,
  stockCountSchema,
  stockCountStatusLabels,
  stockExitInputSchema,
  stockExitReasonLabels,
  stockExitReasons,
  stockExitSchema,
  type StockCount,
  type StockCountStatus,
  type StockExitList,
  type StockExitReason,
  type StockOptions,
} from '@clinica/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ClipboardCheck, PackageMinus, Plus, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { z } from 'zod';
import { Button } from '../../design-system/button';
import { Dialog } from '../../design-system/dialog';
import {
  Segmented,
  SearchField,
  SelectField,
  TextareaField,
  TextField,
} from '../../design-system/field';
import { Badge, Facts, FormActions, PageHeader, Panel } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { DataTable, Pagination } from '../../design-system/table';
import { useToast } from '../../design-system/toast';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { formatCalendarDate, formatDateTime } from '../../lib/format';
import { formatMoney, parseDecimal, quantityInput } from '../products/format';
import {
  stockCountQuery,
  stockCountsQuery,
  stockExitQuery,
  stockExitsQuery,
  stockOptionsQuery,
  type StockExitSearch,
} from './queries';

type Errors = Record<string, string>;

const issuesOf = (error: z.ZodError): Errors => {
  const errors: Errors = {};
  for (const issue of error.issues) errors[issue.path.join('.')] ??= issue.message;
  return errors;
};

const fieldErrorsOf = (e: unknown): Errors | null =>
  e instanceof ApiRequestError && e.fieldErrors.length > 0
    ? Object.fromEntries(e.fieldErrors.map((f) => [f.path, f.message]))
    : null;

function GeneralError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600">
      {message}
    </p>
  ) : null;
}

const linkClass = 'font-medium text-ink hover:text-sage-700 hover:underline';
const q = (value: number) => quantityInput(value);

// Outras saídas -----------------------------------------------------------------------------------

/** Outras saídas de estoque [p.17]: perda, quebra, vencimento, uso interno e doação. */
export function StockExitsPage({ search }: { search: StockExitSearch }) {
  const navigate = useNavigate({ from: '/estoque/saidas' });
  const set = (patch: Partial<Omit<StockExitSearch, 'page'>>) => {
    void navigate({ search: (prev) => ({ ...prev, page: undefined, ...patch }), replace: true });
  };
  const list = useQuery(stockExitsQuery(search));
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        area="Estoque e serviços"
        title="Outras saídas"
        description="Baixas que não são venda: perda, quebra, vencimento, uso interno e doação. Saem na hora, pelo lote escolhido, e guardam o custo do momento."
        actions={
          <Button
            icon={<Plus className="size-4" aria-hidden />}
            onClick={() => {
              setCreating(true);
            }}
          >
            Nova saída
          </Button>
        }
      />

      <Panel className="mb-5 space-y-4 p-4">
        <Segmented
          label="Situação"
          value={search.situacao}
          options={[
            { value: 'ativas', label: 'Ativas' },
            { value: 'canceladas', label: 'Canceladas' },
            { value: 'todas', label: 'Todas' },
          ]}
          onChange={(situacao) => {
            set({ situacao });
          }}
        />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="col-span-2 sm:col-span-1">
            <SelectField
              label="Motivo"
              value={search.motivo ?? ''}
              placeholder="Todos"
              options={stockExitReasons.map((r) => ({ value: r, label: stockExitReasonLabels[r] }))}
              onChange={(e) => {
                set({ motivo: (e.target.value || undefined) as StockExitReason | undefined });
              }}
            />
          </div>
          <TextField
            label="De"
            type="date"
            value={search.de ?? ''}
            onChange={(e) => {
              set({ de: e.target.value || undefined });
            }}
          />
          <TextField
            label="Até"
            type="date"
            value={search.ate ?? ''}
            onChange={(e) => {
              set({ ate: e.target.value || undefined });
            }}
          />
        </div>
      </Panel>

      {list.isPending ? (
        <SkeletonRows rows={5} columns={4} />
      ) : list.isError ? (
        <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
      ) : (
        <Panel>
          {list.data.items.length === 0 ? (
            <EmptyState
              icon={PackageMinus}
              title="Nenhuma saída nesta busca"
              description="Registre aqui o que quebrou, venceu ou foi usado na própria clínica, para o estoque bater com a prateleira."
            />
          ) : (
            <div aria-busy={list.isFetching || undefined}>
              {list.data.totalCost !== null ? (
                <p className="flex justify-between border-b border-line px-4 py-2.5 text-sm text-ink-muted">
                  <span>Custo das saídas ativas nesta busca</span>
                  <span className="font-mono text-ink tabular-nums">
                    {formatMoney(list.data.totalCost)}
                  </span>
                </p>
              ) : null}
              <ExitsTable
                list={list.data}
                onOpen={(id) => {
                  setOpenId(id);
                }}
              />
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

      {creating ? (
        <NewExitDialog
          onClose={() => {
            setCreating(false);
          }}
        />
      ) : null}
      {openId ? (
        <ExitDialog
          id={openId}
          onClose={() => {
            setOpenId(null);
          }}
        />
      ) : null}
    </>
  );
}

function ExitsTable({ list, onOpen }: { list: StockExitList; onOpen: (id: string) => void }) {
  const seeCost = list.totalCost !== null;
  return (
    <DataTable
      caption="Outras saídas"
      rows={list.items}
      rowKey={(e) => e.id}
      columns={[
        {
          header: 'Saída',
          cell: (e) => (
            <button
              type="button"
              className={linkClass}
              onClick={() => {
                onOpen(e.id);
              }}
            >
              {e.code}
            </button>
          ),
        },
        {
          header: 'Motivo',
          cell: (e) => (
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2">
                {stockExitReasonLabels[e.reason]}
                {e.cancelled ? <Badge>Cancelada</Badge> : null}
              </p>
              <p className="max-w-56 truncate text-xs text-ink-muted sm:max-w-80">
                {formatCalendarDate(e.occurredOn)} · {e.products}
              </p>
            </div>
          ),
        },
        ...(seeCost
          ? [
              {
                header: 'Custo',
                cell: (e: StockExitList['items'][number]) => (
                  <span className="font-mono whitespace-nowrap tabular-nums">
                    {formatMoney(e.totalCost ?? 0)}
                  </span>
                ),
                className: 'text-right',
              },
            ]
          : []),
      ]}
    />
  );
}

interface ExitLine {
  key: string;
  productId: string;
  lotId: string;
  quantity: string;
}

let nextKey = 0;
const newLine = (): ExitLine => ({
  key: `l${String((nextKey += 1))}`,
  productId: '',
  lotId: '',
  quantity: '',
});

function NewExitDialog({ onClose }: { onClose: () => void }) {
  const options = useQuery(stockOptionsQuery);
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Nova saída"
      description="A baixa é imediata. Nos produtos com lote, escolha o lote que saiu da prateleira."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" form="exit-form" disabled={!options.data}>
            Registrar saída
          </Button>
        </>
      }
    >
      {options.isPending ? (
        <SkeletonRows rows={3} columns={3} />
      ) : options.isError ? (
        <ErrorState message={errorMessage(options.error)} onRetry={() => void options.refetch()} />
      ) : (
        <ExitForm options={options.data} onDone={onClose} />
      )}
    </Dialog>
  );
}

function ExitForm({ options, onDone }: { options: StockOptions; onDone: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState<StockExitReason | ''>('');
  const [occurredOn, setOccurredOn] = useState(options.today);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<ExitLine[]>([newLine()]);
  const [errors, setErrors] = useState<Errors>({});
  const save = useMutation({
    mutationFn: (body: unknown) => api('POST', '/stock/exits', stockExitSchema, body),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['stock'] });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(`Saída ${String(saved.code)} registrada.`);
      onDone();
    },
    onError: (e) => {
      const fields = fieldErrorsOf(e);
      if (fields) setErrors(fields);
    },
  });
  const clear = (field: string) => {
    if (errors[field]) setErrors(({ [field]: _, ...rest }) => rest);
  };
  const setLine = (key: string, patch: Partial<ExitLine>) => {
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  return (
    <form
      id="exit-form"
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = stockExitInputSchema.safeParse({
          reason,
          occurredOn,
          notes,
          items: lines.map((l) => ({
            productId: l.productId,
            lotId: l.lotId || null,
            quantity: parseDecimal(l.quantity) ?? Number.NaN,
          })),
        });
        if (!parsed.success) {
          setErrors(issuesOf(parsed.error));
          return;
        }
        save.mutate(parsed.data);
      }}
    >
      <GeneralError
        message={save.isError && !fieldErrorsOf(save.error) ? errorMessage(save.error) : null}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Motivo"
          value={reason}
          placeholder="Escolha"
          options={stockExitReasons.map((r) => ({ value: r, label: stockExitReasonLabels[r] }))}
          error={errors.reason}
          onChange={(e) => {
            setReason(e.target.value as StockExitReason);
            clear('reason');
          }}
        />
        <TextField
          label="Data"
          type="date"
          value={occurredOn}
          error={errors.occurredOn}
          onChange={(e) => {
            setOccurredOn(e.target.value);
            clear('occurredOn');
          }}
        />
      </div>
      <ol className="space-y-3">
        {lines.map((line, index) => {
          const product = options.products.find((p) => p.id === line.productId);
          const path = `items.${String(index)}`;
          return (
            <li
              key={line.key}
              aria-label={`Item ${String(index + 1)}`}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-control border border-line p-3"
            >
              <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)]">
                <SelectField
                  label="Produto"
                  value={line.productId}
                  placeholder="Escolha"
                  options={options.products.map((p) => ({
                    value: p.id,
                    label: `${p.name} (${q(p.onHand)} ${p.unit})`,
                  }))}
                  error={errors[`${path}.productId`]}
                  onChange={(e) => {
                    setLine(line.key, { productId: e.target.value, lotId: '' });
                    clear(`${path}.productId`);
                  }}
                />
                {product?.tracksLots ? (
                  <SelectField
                    label="Lote"
                    value={line.lotId}
                    placeholder={product.lots.length ? 'Escolha' : 'Sem lote com saldo'}
                    options={product.lots.map((l) => ({
                      value: l.id,
                      label: `${l.code} · ${q(l.onHand)} ${product.unit}${
                        l.expiresOn
                          ? ` · ${l.expired ? 'vencido em' : 'vence'} ${formatCalendarDate(l.expiresOn)}`
                          : ''
                      }`,
                    }))}
                    error={errors[`${path}.lotId`]}
                    onChange={(e) => {
                      setLine(line.key, { lotId: e.target.value });
                      clear(`${path}.lotId`);
                    }}
                  />
                ) : (
                  <div className="hidden sm:block" />
                )}
                <TextField
                  label={product ? `Quantidade (${product.unit})` : 'Quantidade'}
                  inputMode="decimal"
                  autoComplete="off"
                  value={line.quantity}
                  error={errors[`${path}.quantity`]}
                  onChange={(e) => {
                    setLine(line.key, { quantity: e.target.value });
                    clear(`${path}.quantity`);
                  }}
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="mt-6"
                aria-label={`Remover item ${String(index + 1)}`}
                disabled={lines.length === 1}
                onClick={() => {
                  setLines((all) => all.filter((l) => l.key !== line.key));
                  setErrors({});
                }}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </li>
          );
        })}
      </ol>
      <Button
        variant="secondary"
        size="sm"
        icon={<Plus className="size-4" aria-hidden />}
        onClick={() => {
          setLines((all) => [...all, newLine()]);
        }}
      >
        Adicionar item
      </Button>
      <TextareaField
        label="Observações"
        hint={reason === 'other' ? 'Obrigatório: descreva o motivo.' : undefined}
        value={notes}
        error={errors.notes}
        onChange={(e) => {
          setNotes(e.target.value);
          clear('notes');
        }}
      />
    </form>
  );
}

function ExitDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const exit = useQuery(stockExitQuery(id));
  const queryClient = useQueryClient();
  const toast = useToast();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const cancel = useMutation({
    mutationFn: (body: { reason: string }) =>
      api('POST', `/stock/exits/${id}/cancel`, stockExitSchema, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['stock'] });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Saída cancelada; o estoque voltou.');
      onClose();
    },
  });
  const e = exit.data;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={e ? `Saída ${String(e.code)}` : 'Saída'}
      footer={
        e && !e.cancelledAt ? (
          cancelling ? (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setCancelling(false);
                }}
              >
                Voltar
              </Button>
              <Button
                variant="danger"
                pending={cancel.isPending}
                onClick={() => {
                  const parsed = stockCancelSchema.safeParse({ reason });
                  if (!parsed.success) {
                    setError(parsed.error.issues[0]?.message);
                    return;
                  }
                  cancel.mutate(parsed.data);
                }}
              >
                Cancelar saída
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              onClick={() => {
                setCancelling(true);
              }}
            >
              Cancelar saída
            </Button>
          )
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
        )
      }
    >
      {exit.isPending ? (
        <SkeletonRows rows={3} columns={2} />
      ) : exit.isError ? (
        <ErrorState message={errorMessage(exit.error)} onRetry={() => void exit.refetch()} />
      ) : (
        <div className="space-y-4">
          <GeneralError message={cancel.isError ? errorMessage(cancel.error) : null} />
          <Facts
            items={[
              { label: 'Motivo', value: stockExitReasonLabels[exit.data.reason] },
              { label: 'Data', value: formatCalendarDate(exit.data.occurredOn) },
              {
                label: 'Lançada',
                value: `${formatDateTime(exit.data.createdAt)} por ${exit.data.createdBy}`,
              },
              ...(exit.data.totalCost !== null
                ? [{ label: 'Custo', value: formatMoney(exit.data.totalCost) }]
                : []),
              ...(exit.data.notes ? [{ label: 'Observações', value: exit.data.notes }] : []),
              ...(exit.data.cancelledAt
                ? [
                    {
                      label: 'Cancelada',
                      value: `${formatDateTime(exit.data.cancelledAt)} por ${exit.data.cancelledBy ?? ''}`,
                    },
                    { label: 'Motivo do cancelamento', value: exit.data.cancelReason },
                  ]
                : []),
            ]}
          />
          <ul
            className="divide-y divide-line rounded-control border border-line"
            aria-label="Itens da saída"
          >
            {exit.data.items.map((i) => (
              <li key={i.id} className="flex justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <Link
                    to="/estoque/produtos/$productId"
                    params={{ productId: i.product.id }}
                    className={linkClass}
                  >
                    {i.product.name}
                  </Link>
                  {i.lot ? (
                    <span className="block text-xs text-ink-muted">Lote {i.lot.code}</span>
                  ) : null}
                </span>
                <span className="text-right whitespace-nowrap">
                  {q(i.quantity)} {i.product.unit}
                  {i.unitCost !== null ? (
                    <span className="block font-mono text-xs text-ink-muted">
                      {formatMoney(i.unitCost * i.quantity)}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          {cancelling ? (
            <TextField
              label="Motivo do cancelamento"
              autoComplete="off"
              value={reason}
              error={error}
              onChange={(ev) => {
                setReason(ev.target.value);
                setError(undefined);
              }}
            />
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

// Inventário -------------------------------------------------------------------------------------

const countTone: Record<StockCountStatus, 'amber' | 'sage' | 'neutral'> = {
  open: 'amber',
  applied: 'sage',
  cancelled: 'neutral',
};

/** Inventário [p.17]: contagem física, salva aos poucos e aplicada ao estoque de uma vez. */
export function StockCountsPage({ page }: { page: number }) {
  const navigate = useNavigate({ from: '/estoque/inventario' });
  const list = useQuery(stockCountsQuery(page));
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        area="Estoque e serviços"
        title="Inventário"
        description="Conte a prateleira, compare com o sistema e aplique: cada item contado vira o saldo, lote a lote."
        actions={
          <Button
            icon={<Plus className="size-4" aria-hidden />}
            onClick={() => {
              setCreating(true);
            }}
          >
            Novo inventário
          </Button>
        }
      />
      {list.isPending ? (
        <SkeletonRows rows={4} columns={4} />
      ) : list.isError ? (
        <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
      ) : (
        <Panel>
          {list.data.items.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title="Nenhum inventário ainda"
              description="Abra um inventário de todos os produtos ou só de um grupo, como Vacinas."
            />
          ) : (
            <>
              <DataTable
                caption="Inventários"
                rows={list.data.items}
                rowKey={(c) => c.id}
                columns={[
                  {
                    header: 'Inventário',
                    cell: (c) => (
                      <Link
                        to="/estoque/inventario/$countId"
                        params={{ countId: c.id }}
                        className={linkClass}
                      >
                        {c.code}
                      </Link>
                    ),
                  },
                  {
                    header: 'Aberto em',
                    cell: (c) => (
                      <div>
                        {formatDateTime(c.createdAt)}
                        <p className="text-xs text-ink-muted">{c.group ?? 'Todos os produtos'}</p>
                      </div>
                    ),
                  },
                  {
                    header: 'Contados',
                    cell: (c) => `${String(c.counted)} de ${String(c.lines)}`,
                    hideOnMobile: true,
                  },
                  {
                    header: 'Situação',
                    cell: (c) => (
                      <Badge tone={countTone[c.status]}>{stockCountStatusLabels[c.status]}</Badge>
                    ),
                  },
                ]}
              />
              <Pagination
                page={list.data.page}
                pageSize={list.data.pageSize}
                total={list.data.total}
                onPageChange={(p) => {
                  void navigate({ search: { page: p }, replace: true });
                }}
              />
            </>
          )}
        </Panel>
      )}
      {creating ? (
        <NewCountDialog
          onClose={() => {
            setCreating(false);
          }}
        />
      ) : null}
    </>
  );
}

function NewCountDialog({ onClose }: { onClose: () => void }) {
  const options = useQuery(stockOptionsQuery);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [groupId, setGroupId] = useState('');
  const [notes, setNotes] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api('POST', '/stock/counts', stockCountSchema, { groupId: groupId || null, notes }),
    onSuccess: async (count) => {
      await queryClient.invalidateQueries({ queryKey: ['stock', 'counts'] });
      void navigate({ to: '/estoque/inventario/$countId', params: { countId: count.id } });
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Novo inventário"
      description="Traz uma linha por produto com estoque, e uma por lote com saldo nos que controlam lote."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button
            pending={create.isPending}
            onClick={() => {
              create.mutate();
            }}
          >
            Abrir inventário
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <GeneralError message={create.isError ? errorMessage(create.error) : null} />
        <SelectField
          label="Produtos"
          value={groupId}
          placeholder="Todos os produtos com estoque"
          options={(options.data?.groups ?? []).map((g) => ({
            value: g.id,
            label: `Grupo ${g.name}`,
          }))}
          onChange={(e) => {
            setGroupId(e.target.value);
          }}
        />
        <TextareaField
          label="Observações"
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
          }}
        />
      </div>
    </Dialog>
  );
}

export function StockCountPage({ countId }: { countId: string }) {
  const count = useQuery(stockCountQuery(countId));
  if (count.isPending) return <SkeletonRows />;
  if (count.isError) {
    return <ErrorState message={errorMessage(count.error)} onRetry={() => void count.refetch()} />;
  }
  const c = count.data;
  return (
    <>
      <PageHeader
        area="Estoque e serviços"
        title={`Inventário ${String(c.code)}`}
        description={`${c.group ? `Grupo ${c.group.name}` : 'Todos os produtos com estoque'} · aberto em ${formatDateTime(c.createdAt)} por ${c.createdBy}`}
        actions={<Badge tone={countTone[c.status]}>{stockCountStatusLabels[c.status]}</Badge>}
      />
      {c.status === 'open' ? <CountEditor key={c.id} count={c} /> : <CountResult count={c} />}
    </>
  );
}

const diffOf = (expected: number, counted: number | null) =>
  counted === null ? null : Math.round((counted - expected) * 1000) / 1000;

function Diff({ value, unit }: { value: number | null; unit: string }) {
  if (value === null) return <span className="text-ink-faint">—</span>;
  if (value === 0) return <span className="text-ink-muted">Confere</span>;
  return (
    <span className={value < 0 ? 'text-danger-600' : 'text-sage-700'}>
      {value > 0 ? '+' : '−'}
      {q(Math.abs(value))} {unit}
    </span>
  );
}

function lineLabel(line: StockCount['lines'][number]) {
  return line.lot ? `${line.product.name}, lote ${line.lot.code}` : line.product.name;
}

function CountEditor({ count }: { count: StockCount }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(count.lines.map((l) => [l.id, l.counted === null ? '' : q(l.counted)])),
  );
  const [errors, setErrors] = useState<Errors>({});
  const [term, setTerm] = useState('');
  const [confirming, setConfirming] = useState(false);

  const parsedLines = () => {
    const problems: Errors = {};
    const lines = count.lines.map((l) => {
      const text = values[l.id] ?? '';
      const value = parseDecimal(text);
      if (value !== null && (Number.isNaN(value) || value < 0)) {
        problems[l.id] = 'Quantidade inválida';
      }
      return { id: l.id, counted: value };
    });
    return { lines, problems };
  };

  const save = useMutation({
    mutationFn: async (apply: boolean) => {
      const { lines } = parsedLines();
      const saved = await api('PUT', `/stock/counts/${count.id}`, stockCountSchema, { lines });
      return apply ? api('POST', `/stock/counts/${count.id}/apply`, stockCountSchema) : saved;
    },
    onSuccess: async (saved, apply) => {
      queryClient.setQueryData(stockCountQuery(count.id).queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: ['stock', 'counts'] });
      if (apply) {
        await queryClient.invalidateQueries({ queryKey: ['products'] });
        await queryClient.invalidateQueries({ queryKey: ['stock', 'options'] });
        toast.success('Inventário aplicado ao estoque.');
      } else {
        toast.success('Contagem salva.');
      }
      setConfirming(false);
    },
  });
  const discard = useMutation({
    mutationFn: () => api('POST', `/stock/counts/${count.id}/cancel`, stockCountSchema),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['stock'] });
      toast.success('Inventário cancelado; o estoque não mudou.');
      void navigate({ to: '/estoque/inventario' });
    },
  });

  const check = () => {
    const { problems } = parsedLines();
    setErrors(problems);
    return Object.keys(problems).length === 0;
  };
  const counted = count.lines.filter((l) => (values[l.id] ?? '').trim() !== '').length;
  const differences = count.lines.filter((l) => {
    const d = diffOf(l.expected, parseDecimal(values[l.id] ?? ''));
    return d !== null && !Number.isNaN(d) && d !== 0;
  }).length;
  const needle = term.trim().toLowerCase();
  const shown = needle
    ? count.lines.filter((l) => lineLabel(l).toLowerCase().includes(needle))
    : count.lines;

  return (
    <div className="space-y-5">
      <GeneralError message={save.isError ? errorMessage(save.error) : null} />
      <Panel className="space-y-3 p-4">
        <SearchField
          label="Buscar produto"
          icon={<Search className="size-4" aria-hidden />}
          placeholder="Nome do produto ou lote"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
          }}
        />
        <p className="text-sm text-ink-muted" aria-live="polite">
          {counted} de {count.lines.length} contados · {differences}{' '}
          {differences === 1 ? 'diferença' : 'diferenças'}. Deixe em branco o que não contou: não
          muda o saldo.
        </p>
      </Panel>
      <Panel>
        <DataTable
          caption="Itens do inventário"
          rows={shown}
          rowKey={(l) => l.id}
          columns={[
            {
              header: 'Produto',
              cell: (l) => (
                <div className="min-w-0">
                  <p>{l.product.name}</p>
                  {l.lot ? (
                    <p className="text-xs text-ink-muted">
                      Lote {l.lot.code}
                      {l.lot.expiresOn ? ` · validade ${formatCalendarDate(l.lot.expiresOn)}` : ''}
                    </p>
                  ) : null}
                </div>
              ),
            },
            {
              header: 'Sistema',
              cell: (l) => `${q(l.expected)} ${l.product.unit}`,
              className: 'whitespace-nowrap text-right',
            },
            {
              header: 'Contado',
              cell: (l) => (
                <div className="w-24">
                  <input
                    aria-label={`Contado de ${lineLabel(l)}`}
                    inputMode="decimal"
                    autoComplete="off"
                    value={values[l.id] ?? ''}
                    aria-invalid={errors[l.id] ? true : undefined}
                    className="block h-9 w-full rounded-control border border-line-strong bg-surface px-2 text-right text-sm focus:ring-2 focus:ring-sage-500/30 focus:outline-none aria-invalid:border-danger-600"
                    onChange={(e) => {
                      const text = e.target.value;
                      setValues((all) => ({ ...all, [l.id]: text }));
                      if (errors[l.id]) setErrors(({ [l.id]: _, ...rest }) => rest);
                    }}
                  />
                  {errors[l.id] ? (
                    <p role="alert" className="mt-1 text-xs text-danger-600">
                      {errors[l.id]}
                    </p>
                  ) : values[l.id] ? (
                    <p className="mt-1 text-right text-xs sm:hidden">
                      <Diff
                        value={diffOf(l.expected, parseDecimal(values[l.id] ?? ''))}
                        unit={l.product.unit}
                      />
                    </p>
                  ) : null}
                </div>
              ),
            },
            {
              header: 'Diferença',
              cell: (l) => (
                <Diff
                  value={diffOf(l.expected, parseDecimal(values[l.id] ?? ''))}
                  unit={l.product.unit}
                />
              ),
              className: 'whitespace-nowrap',
              hideOnMobile: true,
            },
          ]}
        />
      </Panel>
      <FormActions>
        <Button
          variant="ghost"
          className="mr-auto"
          pending={discard.isPending}
          onClick={() => {
            discard.mutate();
          }}
        >
          Cancelar inventário
        </Button>
        <Button
          variant="secondary"
          pending={save.isPending && !save.variables}
          onClick={() => {
            if (check()) save.mutate(false);
          }}
        >
          Salvar contagem
        </Button>
        <Button
          disabled={counted === 0}
          onClick={() => {
            if (check()) setConfirming(true);
          }}
        >
          Aplicar ao estoque
        </Button>
      </FormActions>
      {confirming ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirming(false);
          }}
          title="Aplicar inventário"
          description={`${String(counted)} ${counted === 1 ? 'item contado vira' : 'itens contados viram'} o saldo do estoque, com ${String(differences)} ${differences === 1 ? 'diferença' : 'diferenças'}. O que ficou em branco não muda. Depois de aplicado, o inventário não se edita.`}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Voltar
              </Button>
              <Button
                pending={save.isPending}
                onClick={() => {
                  save.mutate(true);
                }}
              >
                Aplicar
              </Button>
            </>
          }
        >
          <GeneralError message={save.isError ? errorMessage(save.error) : null} />
        </Dialog>
      ) : null}
    </div>
  );
}

function CountResult({ count }: { count: StockCount }) {
  const [onlyDiff, setOnlyDiff] = useState(false);
  const rows = onlyDiff
    ? count.lines.filter((l) => diffOf(l.expected, l.counted) !== 0)
    : count.lines;
  return (
    <div className="space-y-5">
      <Panel className="p-4">
        <Facts
          items={[
            {
              label: count.status === 'applied' ? 'Aplicado' : 'Cancelado',
              value: count.closedAt
                ? `${formatDateTime(count.closedAt)} por ${count.closedBy ?? ''}`
                : null,
            },
            ...(count.notes ? [{ label: 'Observações', value: count.notes }] : []),
          ]}
        />
      </Panel>
      {count.status === 'applied' ? (
        <Panel>
          <div className="border-b border-line px-4 py-3">
            <Segmented
              label="Mostrar"
              value={onlyDiff ? 'diff' : 'all'}
              options={[
                { value: 'all', label: 'Todos os contados' },
                { value: 'diff', label: 'Só diferenças' },
              ]}
              onChange={(v) => {
                setOnlyDiff(v === 'diff');
              }}
            />
          </div>
          <DataTable
            caption="Resultado do inventário"
            rows={rows}
            rowKey={(l) => l.id}
            columns={[
              {
                header: 'Produto',
                cell: (l) => (
                  <div className="min-w-0">
                    <Link
                      to="/estoque/produtos/$productId"
                      params={{ productId: l.product.id }}
                      className={linkClass}
                    >
                      {l.product.name}
                    </Link>
                    {l.lot ? <p className="text-xs text-ink-muted">Lote {l.lot.code}</p> : null}
                  </div>
                ),
              },
              {
                header: 'Sistema',
                cell: (l) => `${q(l.expected)} ${l.product.unit}`,
                className: 'whitespace-nowrap text-right',
                hideOnMobile: true,
              },
              {
                header: 'Contado',
                cell: (l) => (l.counted === null ? '' : `${q(l.counted)} ${l.product.unit}`),
                className: 'whitespace-nowrap text-right',
              },
              {
                header: 'Diferença',
                cell: (l) => <Diff value={diffOf(l.expected, l.counted)} unit={l.product.unit} />,
                className: 'whitespace-nowrap',
              },
            ]}
          />
        </Panel>
      ) : null}
    </div>
  );
}
