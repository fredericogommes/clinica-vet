import {
  purchaseOrderCancelSchema,
  purchaseOrderInputSchema,
  purchaseOrderSchema,
  purchaseOrderStatusLabels,
  type PurchaseOrder,
  type PurchaseOrderList,
  type PurchaseOrderOptions,
  type PurchaseOrderStatus,
  type PurchaseSuggestion,
} from '@clinica/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ClipboardList, Copy, Mail, MessageCircle, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { z } from 'zod';
import { Button, buttonClasses } from '../../design-system/button';
import { Dialog } from '../../design-system/dialog';
import { Segmented, SelectField, TextareaField, TextField } from '../../design-system/field';
import { Badge, Facts, FormActions, PageHeader, Panel, Section } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { DataTable, Pagination } from '../../design-system/table';
import { useToast } from '../../design-system/toast';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { formatCalendarDate, formatDateTime } from '../../lib/format';
import { useCan } from '../../lib/session';
import { formatMoney, moneyInput, parseDecimal, quantityInput } from '../products/format';
import {
  purchaseOrderOptionsQuery,
  purchaseOrderQuery,
  purchaseOrdersQuery,
  purchaseSuggestionQuery,
  type PurchaseOrderSearch,
} from './order-queries';

type Errors = Record<string, string>;

const issuesOf = (error: z.ZodError): Errors => {
  const errors: Errors = {};
  for (const issue of error.issues) errors[issue.path.join('.')] ??= issue.message;
  return errors;
};

const statusTone: Record<PurchaseOrderStatus, 'amber' | 'sage' | 'neutral'> = {
  draft: 'amber',
  sent: 'sage',
  received: 'neutral',
  cancelled: 'neutral',
};

function StatusBadge({ status }: { status: PurchaseOrderStatus }) {
  return <Badge tone={statusTone[status]}>{purchaseOrderStatusLabels[status]}</Badge>;
}

const linkClass = 'font-medium text-ink hover:text-sage-700 hover:underline';
const q = (value: number) => quantityInput(value);

function GeneralError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600">
      {message}
    </p>
  ) : null;
}

// Lista ---------------------------------------------------------------------------------------------

/** Pedidos de compra [p.17]: em aberto (rascunho e enviados), recebidos e cancelados. */
export function PurchaseOrdersPage({ search }: { search: PurchaseOrderSearch }) {
  const can = useCan();
  const navigate = useNavigate({ from: '/estoque/pedidos' });
  const list = useQuery(purchaseOrdersQuery(search));
  return (
    <>
      <PageHeader
        area="Estoque e serviços"
        title="Pedidos de compra"
        description="O que a clínica pede aos fornecedores. A sugestão vem da análise de estoque; quando a mercadoria chega, o pedido vira uma compra."
        actions={
          can('purchases.manage') ? (
            <Link
              to="/estoque/pedidos/novo"
              className={buttonClasses('primary')}
              aria-label="Novo pedido"
            >
              <Plus className="mr-2 size-4" aria-hidden />
              Novo pedido
            </Link>
          ) : null
        }
      />
      <Panel className="mb-5 p-4">
        <Segmented
          label="Situação"
          value={search.situacao}
          options={[
            { value: 'abertos', label: 'Em aberto' },
            { value: 'recebidos', label: 'Recebidos' },
            { value: 'cancelados', label: 'Cancelados' },
            { value: 'todos', label: 'Todos' },
          ]}
          onChange={(situacao) => {
            void navigate({ search: { situacao, page: undefined }, replace: true });
          }}
        />
      </Panel>
      {list.isPending ? (
        <SkeletonRows rows={5} columns={4} />
      ) : list.isError ? (
        <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
      ) : (
        <Panel>
          {list.data.items.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="Nenhum pedido nesta situação"
              description="Monte um pedido com os produtos que estão para repor e mande ao fornecedor pelo WhatsApp ou e-mail."
            />
          ) : (
            <div aria-busy={list.isFetching || undefined}>
              <OrdersTable list={list.data} />
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
    </>
  );
}

function OrdersTable({ list }: { list: PurchaseOrderList }) {
  type Row = PurchaseOrderList['items'][number];
  return (
    <DataTable
      caption="Pedidos de compra"
      rows={list.items}
      rowKey={(o) => o.id}
      columns={[
        {
          header: 'Pedido',
          cell: (o: Row) => (
            <Link to="/estoque/pedidos/$orderId" params={{ orderId: o.id }} className={linkClass}>
              {o.code}
            </Link>
          ),
        },
        {
          header: 'Fornecedor',
          cell: (o: Row) => (
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2">
                <span className="max-w-48 truncate sm:max-w-80">{o.supplier}</span>
                <StatusBadge status={o.status} />
              </p>
              <p className="text-xs text-ink-muted">
                {formatDateTime(o.createdAt).split(',')[0]} · {o.itemCount}{' '}
                {o.itemCount === 1 ? 'item' : 'itens'}
                {o.expectedOn ? ` · entrega ${formatCalendarDate(o.expectedOn)}` : ''}
              </p>
            </div>
          ),
        },
        {
          header: 'Estimado',
          cell: (o: Row) => (
            <span className="font-mono whitespace-nowrap tabular-nums">{formatMoney(o.total)}</span>
          ),
          className: 'text-right',
          hideOnMobile: true,
        },
      ]}
    />
  );
}

// Novo e detalhe ------------------------------------------------------------------------------------

export function PurchaseOrderNewPage() {
  const options = useQuery(purchaseOrderOptionsQuery);
  return (
    <>
      <PageHeader
        area="Estoque e serviços"
        title="Novo pedido de compra"
        description="Escolha o fornecedor e use a sugestão para trazer o que está para repor. Salve como rascunho ou envie."
      />
      {options.isPending ? (
        <SkeletonRows />
      ) : options.isError ? (
        <ErrorState message={errorMessage(options.error)} onRetry={() => void options.refetch()} />
      ) : (
        <OrderEditor order={null} options={options.data} />
      )}
    </>
  );
}

export function PurchaseOrderPage({ orderId }: { orderId: string }) {
  const can = useCan();
  const order = useQuery(purchaseOrderQuery(orderId));
  const editable = order.data?.status === 'draft' && can('purchases.manage');
  const options = useQuery({ ...purchaseOrderOptionsQuery, enabled: editable });
  if (order.isPending) return <SkeletonRows />;
  if (order.isError) {
    return <ErrorState message={errorMessage(order.error)} onRetry={() => void order.refetch()} />;
  }
  const o = order.data;
  return (
    <>
      <PageHeader
        area="Estoque e serviços"
        title={`Pedido ${String(o.code)}`}
        description={o.supplier.name}
        actions={<StatusBadge status={o.status} />}
      />
      {editable ? (
        options.data ? (
          <OrderEditor key={o.id} order={o} options={options.data} />
        ) : options.isError ? (
          <ErrorState
            message={errorMessage(options.error)}
            onRetry={() => void options.refetch()}
          />
        ) : (
          <SkeletonRows />
        )
      ) : (
        <OrderView order={o} />
      )}
    </>
  );
}

// Editor --------------------------------------------------------------------------------------------

interface Line {
  key: string;
  productId: string;
  quantity: string;
  unitCost: string;
}

let nextKey = 0;
const newKey = () => `o${String((nextKey += 1))}`;
const emptyLine = (): Line => ({ key: newKey(), productId: '', quantity: '', unitCost: '' });

function OrderEditor({
  order,
  options,
}: {
  order: PurchaseOrder | null;
  options: PurchaseOrderOptions;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [supplierId, setSupplierId] = useState(order?.supplier.id ?? '');
  const [expectedOn, setExpectedOn] = useState(order?.expectedOn ?? '');
  const [notes, setNotes] = useState(order?.notes ?? '');
  const [lines, setLines] = useState<Line[]>(
    order
      ? order.items.map((i) => ({
          key: newKey(),
          productId: i.product.id,
          quantity: q(i.quantity),
          unitCost: i.unitCost === null ? '' : moneyInput(i.unitCost),
        }))
      : [emptyLine()],
  );
  const [hints, setHints] = useState<Map<string, PurchaseSuggestion['items'][number]>>(new Map());
  const [errors, setErrors] = useState<Errors>({});
  const [cancelling, setCancelling] = useState(false);

  const clear = (field: string) => {
    if (errors[field]) setErrors(({ [field]: _, ...rest }) => rest);
  };
  const setLine = (key: string, patch: Partial<Line>, field?: string) => {
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    if (field) clear(field);
  };

  const suggest = useMutation({
    mutationFn: () => queryClient.query({ ...purchaseSuggestionQuery(supplierId), staleTime: 0 }),
    onSuccess: (data) => {
      setHints(new Map(data.items.map((i) => [i.productId, i])));
      const present = new Set(lines.map((l) => l.productId));
      const added = data.items
        .filter((i) => !present.has(i.productId))
        .map((i) => ({
          key: newKey(),
          productId: i.productId,
          quantity: q(i.suggested),
          unitCost: i.unitCost === null ? '' : moneyInput(i.unitCost),
        }));
      setLines((all) => [...all.filter((l) => l.productId || l.quantity), ...added]);
      if (added.length === 0) {
        toast.success(
          data.items.length === 0
            ? 'Nada para repor agora: nenhum produto abaixo do mínimo ou acabando.'
            : 'Os produtos sugeridos já estão no pedido.',
        );
      } else {
        toast.success(
          added.length === 1
            ? '1 produto sugerido incluído.'
            : `${String(added.length)} produtos sugeridos incluídos.`,
        );
      }
    },
    onError: (e) => {
      toast.error(errorMessage(e));
    },
  });

  const cents = (text: string) => Math.round((parseDecimal(text) ?? 0) * 100);
  const total = lines.reduce(
    (sum, l) => sum + Math.round(cents(l.unitCost) * (parseDecimal(l.quantity) ?? 0)),
    0,
  );

  const save = useMutation({
    mutationFn: async ({ send }: { send: boolean }) => {
      const parsed = purchaseOrderInputSchema.safeParse({
        supplierId,
        expectedOn: expectedOn || null,
        notes,
        items: lines
          .filter((l) => l.productId || l.quantity)
          .map((l) => ({
            productId: l.productId,
            quantity: parseDecimal(l.quantity) ?? Number.NaN,
            unitCost: l.unitCost ? (parseDecimal(l.unitCost) ?? Number.NaN) : null,
          })),
      });
      if (!parsed.success) {
        setErrors(issuesOf(parsed.error));
        throw new ApiRequestError(400, 'validation_failed', 'Confira os campos destacados.');
      }
      const saved = order
        ? await api('PUT', `/purchase-orders/${order.id}`, purchaseOrderSchema, parsed.data)
        : await api('POST', '/purchase-orders', purchaseOrderSchema, parsed.data);
      return send ? api('POST', `/purchase-orders/${saved.id}/send`, purchaseOrderSchema) : saved;
    },
    onSuccess: async (saved, { send }) => {
      queryClient.setQueryData(purchaseOrderQuery(saved.id).queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: ['purchase-orders', 'list'] });
      toast.success(
        send ? 'Pedido marcado como enviado. Mande o texto ao fornecedor.' : 'Rascunho salvo.',
      );
      if (!order) {
        void navigate({ to: '/estoque/pedidos/$orderId', params: { orderId: saved.id } });
      }
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.fieldErrors.length > 0) {
        setErrors(Object.fromEntries(e.fieldErrors.map((f) => [f.path, f.message])));
      }
    },
  });

  const productById = new Map(options.products.map((p) => [p.id, p]));

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ send: false });
      }}
    >
      <GeneralError
        message={
          save.isError && !(save.error instanceof ApiRequestError && save.error.fieldErrors.length)
            ? errorMessage(save.error)
            : null
        }
      />
      <Section title="Fornecedor e entrega">
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Fornecedor"
            value={supplierId}
            placeholder="Escolha"
            options={options.suppliers.map((s) => ({ value: s.id, label: s.name }))}
            error={errors.supplierId}
            hint={
              options.suppliers.length === 0
                ? 'Cadastre o fornecedor em Financeiro › Fornecedores.'
                : undefined
            }
            onChange={(e) => {
              setSupplierId(e.target.value);
              clear('supplierId');
            }}
          />
          <TextField
            label="Entrega desejada"
            type="date"
            value={expectedOn}
            error={errors.expectedOn}
            onChange={(e) => {
              setExpectedOn(e.target.value);
              clear('expectedOn');
            }}
          />
        </div>
        <TextareaField
          label="Observações para o fornecedor"
          value={notes}
          error={errors.notes}
          onChange={(e) => {
            setNotes(e.target.value);
          }}
        />
      </Section>

      <Section
        title="Itens"
        description="Quantidade na unidade do produto. O custo é uma estimativa; o valor certo vem na nota."
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<Sparkles className="size-4" aria-hidden />}
            pending={suggest.isPending}
            onClick={() => {
              suggest.mutate();
            }}
          >
            Sugerir o que repor
          </Button>
        }
      >
        {errors.items ? (
          <p role="alert" className="text-sm text-danger-600">
            {errors.items}
          </p>
        ) : null}
        <ol className="space-y-3">
          {lines.map((line, index) => {
            const path = `items.${String(index)}`;
            const product = productById.get(line.productId);
            const hint = hints.get(line.productId);
            return (
              <li
                key={line.key}
                aria-label={`Item ${String(index + 1)}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-control border border-line p-3"
              >
                <div className="space-y-1">
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,1fr)_minmax(0,1fr)]">
                    <SelectField
                      label="Produto"
                      value={line.productId}
                      placeholder="Escolha"
                      options={options.products.map((p) => ({
                        value: p.id,
                        label: `${p.name} (${p.unit})`,
                      }))}
                      error={errors[`${path}.productId`]}
                      onChange={(e) => {
                        const picked = productById.get(e.target.value);
                        setLine(
                          line.key,
                          {
                            productId: e.target.value,
                            unitCost:
                              line.unitCost || picked?.cost == null
                                ? line.unitCost
                                : moneyInput(picked.cost),
                          },
                          `${path}.productId`,
                        );
                      }}
                    />
                    <TextField
                      label={product ? `Quantidade (${product.unit})` : 'Quantidade'}
                      inputMode="decimal"
                      autoComplete="off"
                      value={line.quantity}
                      error={errors[`${path}.quantity`]}
                      onChange={(e) => {
                        setLine(line.key, { quantity: e.target.value }, `${path}.quantity`);
                      }}
                    />
                    <TextField
                      label="Custo unitário (R$)"
                      inputMode="decimal"
                      autoComplete="off"
                      value={line.unitCost}
                      error={errors[`${path}.unitCost`]}
                      onChange={(e) => {
                        setLine(line.key, { unitCost: e.target.value }, `${path}.unitCost`);
                      }}
                    />
                  </div>
                  {hint ? (
                    <p className="text-xs text-ink-muted">
                      Saldo {q(hint.onHand)} {hint.unit}
                      {hint.minStock !== null ? ` · mínimo ${q(hint.minStock)}` : ''}
                      {hint.idealStock !== null ? ` · ideal ${q(hint.idealStock)}` : ''}
                      {` · consumo ${q(hint.monthlyConsumption)} por mês`}
                      {hint.onOrder > 0 ? ` · ${q(hint.onOrder)} já pedido` : ''}
                    </p>
                  ) : null}
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus className="size-4" aria-hidden />}
            onClick={() => {
              setLines((all) => [...all, emptyLine()]);
            }}
          >
            Adicionar item
          </Button>
          <p className="text-sm text-ink-muted">
            Estimado{' '}
            <span className="font-mono text-ink tabular-nums">{formatMoney(total / 100)}</span>
          </p>
        </div>
      </Section>

      <FormActions>
        {order ? (
          <Button
            variant="ghost"
            className="mr-auto"
            onClick={() => {
              setCancelling(true);
            }}
          >
            Cancelar pedido
          </Button>
        ) : null}
        <Button type="submit" variant="secondary" pending={save.isPending && !save.variables.send}>
          Salvar rascunho
        </Button>
        <Button
          pending={save.isPending && save.variables.send}
          onClick={() => {
            save.mutate({ send: true });
          }}
        >
          Salvar e enviar
        </Button>
      </FormActions>
      {cancelling && order ? (
        <CancelDialog
          order={order}
          onClose={() => {
            setCancelling(false);
          }}
        />
      ) : null}
    </form>
  );
}

// Visualização ---------------------------------------------------------------------------------------

/** Celular brasileiro ou fixo com DDD; sem o 55, ele é acrescentado para o WhatsApp. */
function whatsappLink(phone: string, text: string) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  const full = digits.length <= 11 ? `55${digits}` : digits;
  return `https://wa.me/${full}?text=${encodeURIComponent(text)}`;
}

function OrderView({ order: o }: { order: PurchaseOrder }) {
  const can = useCan();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState(false);
  const open = o.status === 'sent' && can('purchases.manage');
  const whatsapp = whatsappLink(o.supplier.phone, o.message);

  const receive = useMutation({
    mutationFn: () => api('POST', `/purchase-orders/${o.id}/receive`, purchaseOrderSchema),
    onSuccess: async (saved) => {
      queryClient.setQueryData(purchaseOrderQuery(saved.id).queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: ['purchase-orders', 'list'] });
      await queryClient.invalidateQueries({ queryKey: ['purchases', 'list'] });
      toast.success('Compra lançada em rascunho. Confira lotes e valores da nota e confirme.');
      if (saved.purchase) {
        void navigate({
          to: '/estoque/compras/$purchaseId',
          params: { purchaseId: saved.purchase.id },
        });
      }
    },
    onError: (e) => {
      toast.error(errorMessage(e));
    },
  });

  return (
    <div className="space-y-5">
      {o.status === 'sent' ? (
        <Panel className="space-y-3 p-4">
          <h2 className="text-sm font-medium">Envie ao fornecedor</h2>
          <pre
            aria-label="Texto do pedido"
            className="max-h-72 overflow-auto rounded-control bg-sunken px-3 py-2 font-sans text-sm whitespace-pre-wrap"
          >
            {o.message}
          </pre>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<Copy className="size-4" aria-hidden />}
              onClick={() => {
                void navigator.clipboard.writeText(o.message).then(
                  () => {
                    toast.success('Texto copiado.');
                  },
                  () => {
                    toast.error('Não deu para copiar. Selecione o texto e copie.');
                  },
                );
              }}
            >
              Copiar texto
            </Button>
            {whatsapp ? (
              <a
                href={whatsapp}
                target="_blank"
                rel="noreferrer"
                className={buttonClasses('secondary', 'sm')}
              >
                <MessageCircle className="mr-2 size-4" aria-hidden />
                WhatsApp
              </a>
            ) : null}
            {o.supplier.email ? (
              <a
                href={`mailto:${o.supplier.email}?subject=${encodeURIComponent(
                  `Pedido de compra ${String(o.code)}`,
                )}&body=${encodeURIComponent(o.message)}`}
                className={buttonClasses('secondary', 'sm')}
              >
                <Mail className="mr-2 size-4" aria-hidden />
                E-mail
              </a>
            ) : null}
          </div>
          {!whatsapp && !o.supplier.email ? (
            <p className="text-xs text-ink-muted">
              O fornecedor está sem telefone e e-mail no cadastro: copie o texto e mande pelo canal
              de costume.
            </p>
          ) : null}
        </Panel>
      ) : null}

      <Panel className="p-4">
        <Facts
          items={[
            { label: 'Fornecedor', value: o.supplier.name },
            {
              label: 'Entrega desejada',
              value: o.expectedOn ? formatCalendarDate(o.expectedOn) : null,
            },
            { label: 'Criado', value: `${formatDateTime(o.createdAt)} por ${o.createdBy}` },
            ...(o.sentAt
              ? [
                  {
                    label: 'Enviado',
                    value: `${formatDateTime(o.sentAt)}${o.sentBy ? ` por ${o.sentBy}` : ''}`,
                  },
                ]
              : []),
            ...(o.purchase
              ? [
                  {
                    label: 'Compra',
                    value: (
                      <Link
                        to="/estoque/compras/$purchaseId"
                        params={{ purchaseId: o.purchase.id }}
                        className="text-sage-700 hover:underline"
                      >
                        Compra {o.purchase.code}
                      </Link>
                    ),
                  },
                ]
              : []),
            ...(o.cancelledAt
              ? [
                  {
                    label: 'Cancelado',
                    value: `${formatDateTime(o.cancelledAt)}${
                      o.cancelledBy ? ` por ${o.cancelledBy}` : ''
                    } · ${o.cancelReason ?? ''}`,
                  },
                ]
              : []),
            { label: 'Observações', value: o.notes },
          ]}
        />
      </Panel>

      <Panel>
        <DataTable
          caption="Itens do pedido"
          rows={o.items}
          rowKey={(i) => i.id}
          columns={[
            {
              header: 'Produto',
              cell: (i) => (
                <div className="min-w-0">
                  <p>{i.product.name}</p>
                  {i.supplierCode ? (
                    <p className="text-xs text-ink-muted">Cód. fornecedor {i.supplierCode}</p>
                  ) : null}
                </div>
              ),
            },
            {
              header: 'Quantidade',
              cell: (i) => `${q(i.quantity)} ${i.product.unit}`,
              className: 'whitespace-nowrap text-right',
            },
            {
              header: 'Custo estimado',
              cell: (i) =>
                i.unitCost === null ? (
                  <span className="text-ink-faint">—</span>
                ) : (
                  <span className="font-mono tabular-nums">{formatMoney(i.total)}</span>
                ),
              className: 'whitespace-nowrap text-right',
              hideOnMobile: true,
            },
          ]}
        />
        <p className="flex justify-between border-t border-line px-4 py-2.5 text-sm">
          <span className="text-ink-muted">Estimado</span>
          <span className="font-mono tabular-nums">{formatMoney(o.total)}</span>
        </p>
      </Panel>

      {open ? (
        <FormActions>
          <Button
            variant="ghost"
            className="mr-auto"
            onClick={() => {
              setCancelling(true);
            }}
          >
            Cancelar pedido
          </Button>
          <Button
            pending={receive.isPending}
            onClick={() => {
              receive.mutate();
            }}
          >
            Mercadoria chegou: lançar compra
          </Button>
        </FormActions>
      ) : null}
      {cancelling ? (
        <CancelDialog
          order={o}
          onClose={() => {
            setCancelling(false);
          }}
        />
      ) : null}
    </div>
  );
}

function CancelDialog({ order, onClose }: { order: PurchaseOrder; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const cancel = useMutation({
    mutationFn: (body: { reason: string }) =>
      api('POST', `/purchase-orders/${order.id}/cancel`, purchaseOrderSchema, body),
    onSuccess: async (saved) => {
      queryClient.setQueryData(purchaseOrderQuery(saved.id).queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: ['purchase-orders', 'list'] });
      toast.success('Pedido cancelado.');
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Cancelar pedido ${String(order.code)}`}
      description="O pedido sai da lista em aberto e deixa de contar como já pedido na sugestão."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button
            variant="danger"
            pending={cancel.isPending}
            onClick={() => {
              const parsed = purchaseOrderCancelSchema.safeParse({ reason });
              if (!parsed.success) {
                setError(parsed.error.issues[0]?.message);
                return;
              }
              cancel.mutate(parsed.data);
            }}
          >
            Cancelar pedido
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <GeneralError message={cancel.isError ? errorMessage(cancel.error) : null} />
        <TextField
          label="Motivo"
          value={reason}
          error={error}
          onChange={(e) => {
            setReason(e.target.value);
            setError(undefined);
          }}
        />
      </div>
    </Dialog>
  );
}
