import {
  saleSchema,
  saleTypeLabels,
  saleUnitLabels,
  type Sale,
  type SaleContext,
  type SaleData,
  type SaleListItem,
  type SaleStatus,
} from '@clinica/contracts';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Ban, History, Plus, Receipt, Search } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button, buttonClasses } from '../../design-system/button';
import { Dialog } from '../../design-system/dialog';
import { SearchField, TextareaField } from '../../design-system/field';
import { FormActions, PageHeader, Panel, Section } from '../../design-system/layout';
import { ErrorState, SkeletonRows } from '../../design-system/states';
import { DataTable } from '../../design-system/table';
import { useToast } from '../../design-system/toast';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useCan } from '../../lib/session';
import { useDebounced } from '../../lib/use-debounced';
import { formatMoney, formatPercent, quantityInput } from '../products/format';
import { saleContextQuery, saleQuery, salesListQuery } from './queries';
import { StatusBadge } from './status-badge';
import {
  emptySale,
  SaleForm,
  saleToForm,
  validateSale,
  type FieldErrors,
  type SaleFormState,
} from './sale-form';

/** Formulário com estado local, validação pelo contrato e erros do servidor por campo. */
function useSaleEditor(initial: SaleFormState) {
  const [state, setState] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  return {
    state,
    errors,
    onChange: (next: SaleFormState) => {
      setState(next);
      if (Object.keys(errors).length > 0) setErrors({});
    },
    reset: (next: SaleFormState) => {
      setState(next);
      setErrors({});
    },
    validate: (): SaleData | null => {
      const result = validateSale(state);
      if ('errors' in result) {
        setErrors(result.errors);
        return null;
      }
      return result.data;
    },
    serverErrors: (error: unknown) => {
      if (error instanceof ApiRequestError && error.fieldErrors.length > 0) {
        setErrors(Object.fromEntries(error.fieldErrors.map((f) => [f.path, f.message])));
      }
    },
  };
}

/** Erros de campo aparecem junto ao campo; aqui só o que não tem campo. */
function SaveError({ error }: { error: unknown }) {
  if (error instanceof ApiRequestError && error.fieldErrors.length > 0) return null;
  return (
    <p role="alert" className="mb-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600">
      {errorMessage(error)}
    </p>
  );
}

function Layout({ main, side }: { main: ReactNode; side: ReactNode }) {
  return (
    <div className="@container">
      <div className="grid gap-6 @5xl:grid-cols-[minmax(0,1fr)_20rem] @5xl:items-start">
        <div className="@container min-w-0">{main}</div>
        <aside className="min-w-0">{side}</aside>
      </div>
    </div>
  );
}

/** Ponto de venda [p.8]: venda ou orçamento num formulário só. */
export function PdvPage() {
  const context = useQuery(saleContextQuery);
  if (context.isPending) return <SkeletonRows />;
  if (context.isError) {
    return (
      <ErrorState message={errorMessage(context.error)} onRetry={() => void context.refetch()} />
    );
  }
  return <NewSale context={context.data} />;
}

function NewSale({ context }: { context: SaleContext }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const editor = useSaleEditor(emptySale(context));
  const save = useMutation({
    mutationFn: (data: SaleData) => api('POST', '/sales', saleSchema, data),
    onSuccess: async (saved) => {
      queryClient.setQueryData(saleQuery(saved.id).queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: ['sales'] });
      toast.success(
        `${saved.status === 'quote' ? 'Orçamento' : 'Venda'} ${String(saved.code)} gravad${saved.status === 'quote' ? 'o' : 'a'}: ${formatMoney(saved.netTotal)}.`,
      );
      await navigate({ to: '/vendas/$saleId', params: { saleId: saved.id } });
    },
    onError: editor.serverErrors,
  });
  const submit = () => {
    const data = editor.validate();
    if (data) save.mutate(data);
  };

  return (
    <>
      <PageHeader
        area="Vendas"
        title="Ponto de venda"
        description="Venda ou orçamento, com o profissional responsável em cada item."
      />
      <Layout
        main={
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            {save.isError ? <SaveError error={save.error} /> : null}
            <SaleForm
              state={editor.state}
              onChange={editor.onChange}
              errors={editor.errors}
              context={context}
              quoteLocked={false}
              extraProfessionals={[]}
            />
            <FormActions>
              <Button
                variant="secondary"
                onClick={() => {
                  editor.reset(emptySale(context));
                }}
              >
                Limpar
              </Button>
              <Button type="submit" pending={save.isPending}>
                {editor.state.kind === 'quote' ? 'Salvar orçamento' : 'Salvar venda'}
              </Button>
            </FormActions>
          </form>
        }
        side={<RecentSales />}
      />
    </>
  );
}

export function SalePage({ saleId }: { saleId: string }) {
  const sale = useQuery(saleQuery(saleId));
  const context = useQuery({ ...saleContextQuery, enabled: sale.data?.editable ?? false });
  if (sale.isPending) return <SkeletonRows />;
  if (sale.isError) {
    return <ErrorState message={errorMessage(sale.error)} onRetry={() => void sale.refetch()} />;
  }
  if (!sale.data.editable) return <SaleView sale={sale.data} />;
  if (context.isPending) return <SkeletonRows />;
  if (context.isError) {
    return (
      <ErrorState message={errorMessage(context.error)} onRetry={() => void context.refetch()} />
    );
  }
  return <EditSale key={sale.data.id} sale={sale.data} context={context.data} />;
}

function SaleHeader({ sale, onCancel }: { sale: Sale; onCancel: (() => void) | null }) {
  const can = useCan();
  return (
    <PageHeader
      area={`${sale.status === 'quote' ? 'Orçamento' : 'Venda'} ${String(sale.code)}`}
      title={sale.client ? sale.client.name : 'Venda de balcão'}
      description={[
        sale.patient ? `Animal: ${sale.patient.name}` : null,
        `${formatDateTime(sale.createdAt)} por ${sale.createdBy}`,
        sale.unitName,
      ]
        .filter(Boolean)
        .join(' · ')}
      actions={
        <>
          <StatusBadge status={sale.status} />
          {can('admin.audit.view') ? (
            <Link
              to="/consultas/auditoria"
              search={{ entidade: 'sale', id: sale.id, nome: `Venda ${String(sale.code)}` }}
              className={buttonClasses('ghost')}
            >
              <History className="size-4" aria-hidden />
              Histórico
            </Link>
          ) : null}
          {onCancel ? (
            <Button
              variant="ghost"
              icon={<Ban className="size-4" aria-hidden />}
              onClick={onCancel}
            >
              Cancelar {sale.status === 'quote' ? 'orçamento' : 'venda'}
            </Button>
          ) : null}
          {can('sales.manage') ? (
            <Link to="/vendas/pdv" className={buttonClasses('secondary')}>
              <Plus className="size-4" aria-hidden />
              Nova venda
            </Link>
          ) : null}
        </>
      }
    />
  );
}

function EditSale({ sale, context }: { sale: Sale; context: SaleContext }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const editor = useSaleEditor(saleToForm(sale));
  const [cancelling, setCancelling] = useState(false);
  const save = useMutation({
    mutationFn: (data: SaleData) => api('PUT', `/sales/${sale.id}`, saleSchema, data),
    onSuccess: async (saved) => {
      queryClient.setQueryData(saleQuery(saved.id).queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: ['sales'] });
      editor.reset(saleToForm(saved));
      toast.success(
        sale.status === 'quote' && saved.status === 'open'
          ? `Orçamento convertido na venda ${String(saved.code)}.`
          : 'Alterações salvas.',
      );
    },
    onError: editor.serverErrors,
  });
  const submit = () => {
    const data = editor.validate();
    if (data) save.mutate(data);
  };
  const converting = sale.status === 'quote' && editor.state.kind === 'sale';

  return (
    <>
      <SaleHeader
        sale={sale}
        onCancel={
          sale.cancellable
            ? () => {
                setCancelling(true);
              }
            : null
        }
      />
      <Layout
        main={
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            {save.isError ? <SaveError error={save.error} /> : null}
            <SaleForm
              state={editor.state}
              onChange={editor.onChange}
              errors={editor.errors}
              context={context}
              quoteLocked={sale.status === 'open'}
              extraProfessionals={sale.items.map((i) => i.professional)}
            />
            <FormActions>
              <Button type="submit" pending={save.isPending}>
                {converting ? 'Converter em venda' : 'Salvar alterações'}
              </Button>
            </FormActions>
          </form>
        }
        side={<RecentSales currentId={sale.id} />}
      />
      <CancelDialog
        sale={sale}
        open={cancelling}
        onClose={() => {
          setCancelling(false);
        }}
      />
    </>
  );
}

/** Venda baixada, cancelada ou sem permissão de edição: só leitura. */
function SaleView({ sale }: { sale: Sale }) {
  const [cancelling, setCancelling] = useState(false);
  return (
    <>
      <SaleHeader
        sale={sale}
        onCancel={
          sale.cancellable
            ? () => {
                setCancelling(true);
              }
            : null
        }
      />
      <Layout
        main={
          <div className="space-y-5">
            {sale.cancelled ? (
              <p
                role="note"
                className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600"
              >
                Cancelada em {formatDateTime(sale.cancelled.at)} por {sale.cancelled.by}. Motivo:{' '}
                {sale.cancelled.reason}
              </p>
            ) : null}
            <Section title="Itens" description={saleTypeLabels[sale.saleType]}>
              <DataTable
                caption="Itens da venda"
                rows={sale.items}
                rowKey={(i) => i.id}
                columns={[
                  {
                    header: 'Item',
                    cell: (i) => (
                      <div className="min-w-0">
                        <p className="font-medium">{i.name}</p>
                        <p className="text-xs text-ink-muted">{i.professional.name}</p>
                        <p className="text-xs text-ink-muted md:hidden">
                          {quantityInput(i.quantity)} × {formatMoney(i.unitPrice)}
                        </p>
                      </div>
                    ),
                  },
                  {
                    header: 'Qtd.',
                    hideOnMobile: true,
                    className: 'text-right',
                    cell: (i) => (
                      <span className="font-mono tabular-nums">
                        {quantityInput(i.quantity)} {saleUnitLabels[i.unit].toLowerCase()}
                      </span>
                    ),
                  },
                  {
                    header: 'Preço',
                    hideOnMobile: true,
                    className: 'text-right',
                    cell: (i) => (
                      <span className="font-mono tabular-nums">{formatMoney(i.unitPrice)}</span>
                    ),
                  },
                  {
                    header: 'Subtotal',
                    className: 'text-right',
                    cell: (i) => (
                      <span className="font-mono tabular-nums">{formatMoney(i.grossTotal)}</span>
                    ),
                  },
                ]}
              />
              <dl className="mt-4 space-y-1 border-t border-line pt-3 text-sm">
                <Line label="Bruto" value={formatMoney(sale.grossTotal)} />
                <Line
                  label={
                    sale.discount.mode === 'percent'
                      ? `Desconto (${formatPercent(sale.discount.value)})`
                      : 'Desconto'
                  }
                  value={`− ${formatMoney(sale.discountTotal)}`}
                />
                <Line label="Total" value={formatMoney(sale.netTotal)} strong />
              </dl>
            </Section>
            {sale.notes ? (
              <Section title="Observações">
                <p className="text-sm whitespace-pre-wrap">{sale.notes}</p>
              </Section>
            ) : null}
          </div>
        }
        side={<RecentSales currentId={sale.id} />}
      />
      <CancelDialog
        sale={sale}
        open={cancelling}
        onClose={() => {
          setCancelling(false);
        }}
      />
    </>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd
        className={
          strong ? 'font-mono text-base font-semibold tabular-nums' : 'font-mono tabular-nums'
        }
      >
        {value}
      </dd>
    </div>
  );
}

function CancelDialog({ sale, open, onClose }: { sale: Sale; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const cancel = useMutation({
    mutationFn: () => api('POST', `/sales/${sale.id}/cancel`, saleSchema, { reason }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(saleQuery(saved.id).queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: ['sales'] });
      toast.success(
        `${sale.status === 'quote' ? 'Orçamento' : 'Venda'} ${String(sale.code)} cancelad${sale.status === 'quote' ? 'o' : 'a'}.`,
      );
      onClose();
    },
    onError: (e) => {
      setError(
        e instanceof ApiRequestError ? (e.fieldErrors[0]?.message ?? e.message) : errorMessage(e),
      );
    },
  });
  const noun = sale.status === 'quote' ? 'orçamento' : 'venda';
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={`Cancelar ${noun} ${String(sale.code)}`}
      description="O registro continua no histórico, marcado como cancelado."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button
            variant="danger"
            pending={cancel.isPending}
            onClick={() => {
              if (reason.trim().length < 3) {
                setError('Explique o motivo em poucas palavras');
                return;
              }
              cancel.mutate();
            }}
          >
            Cancelar {noun}
          </Button>
        </>
      }
    >
      <TextareaField
        label="Motivo"
        rows={3}
        maxLength={300}
        value={reason}
        error={error}
        onChange={(e) => {
          setReason(e.target.value);
          setError(undefined);
        }}
      />
    </Dialog>
  );
}

/** Painel lateral [p.9]: vendas das últimas 24 horas e busca de venda. */
function RecentSales({ currentId }: { currentId?: string }) {
  const [term, setTerm] = useState('');
  const q = useDebounced(term.trim());
  const recent = useQuery(salesListQuery({ sinceHours: 24, pageSize: 50 }));
  const found = useQuery({ ...salesListQuery({ q, pageSize: 10 }), enabled: q.length >= 1 });
  const groups: { title: string; statuses: SaleStatus[] }[] = [
    { title: 'Em aberto', statuses: ['open'] },
    { title: 'Orçamentos', statuses: ['quote'] },
    { title: 'Canceladas', statuses: ['cancelled'] },
  ];

  return (
    <Panel className="overflow-hidden">
      <div className="border-b border-line p-4">
        <h2 className="font-display text-[15px] font-semibold">Vendas recentes</h2>
        <SearchField
          className="mt-3"
          label="Localizar venda"
          placeholder="Código, cliente ou animal"
          icon={<Search className="size-4" aria-hidden />}
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
          }}
        />
      </div>
      {q ? (
        <SaleList title="Resultado da busca" query={found} currentId={currentId} />
      ) : recent.isPending ? (
        <div className="p-4">
          <SkeletonRows rows={3} columns={1} />
        </div>
      ) : recent.isError ? (
        <p role="alert" className="p-4 text-sm text-danger-600">
          {errorMessage(recent.error)}
        </p>
      ) : recent.data.items.length === 0 ? (
        <p className="p-4 text-sm text-ink-muted">Nenhuma venda nas últimas 24 horas.</p>
      ) : (
        groups.map((g) => {
          const items = recent.data.items.filter((s) => g.statuses.includes(s.status));
          return items.length > 0 ? (
            <SaleList key={g.title} title={g.title} items={items} currentId={currentId} />
          ) : null;
        })
      )}
    </Panel>
  );
}

function SaleList({
  title,
  items,
  query,
  currentId,
}: {
  title: string;
  items?: SaleListItem[];
  query?: UseQueryResult<{ items: SaleListItem[] }>;
  currentId: string | undefined;
}) {
  const rows = items ?? query?.data?.items ?? [];
  return (
    <section className="border-b border-line last:border-b-0">
      <h3 className="bg-sunken px-4 py-1.5 font-mono text-[11px] font-medium tracking-[0.06em] text-ink-muted uppercase">
        {title}
      </h3>
      {query?.isPending ? (
        <p className="px-4 py-3 text-sm text-ink-muted">Buscando…</p>
      ) : query?.isError ? (
        <p role="alert" className="px-4 py-3 text-sm text-danger-600">
          {errorMessage(query.error)}
        </p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-ink-muted">Nenhuma venda encontrada.</p>
      ) : (
        <ul>
          {rows.map((s) => (
            <li key={s.id}>
              <Link
                to="/vendas/$saleId"
                params={{ saleId: s.id }}
                aria-current={s.id === currentId ? 'page' : undefined}
                className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-sunken aria-[current=page]:bg-sage-50"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm">
                    <Receipt className="size-3.5 shrink-0 text-ink-faint" aria-hidden />
                    <span className="font-mono text-xs text-ink-muted">{s.code}</span>
                    <span className="truncate">{s.clientName ?? 'Balcão'}</span>
                  </span>
                  <span className="block truncate text-xs text-ink-muted">
                    {[s.patientName, formatDateTime(s.createdAt)].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-sm tabular-nums">
                  {formatMoney(s.netTotal)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
