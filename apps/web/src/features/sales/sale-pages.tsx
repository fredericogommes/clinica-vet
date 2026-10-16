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
import { Ban, History, Plus, Receipt, Search, Wallet } from 'lucide-react';
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
import { formatBrDate } from '../schedule/dates';
import { useCan } from '../../lib/session';
import { useDebounced } from '../../lib/use-debounced';
import { formatMoney, formatPercent, quantityInput } from '../products/format';
import { saleContextQuery, saleQuery, salesListQuery } from './queries';
import { CashPanel } from '../cash/cash-panel';
import { useCashGate } from '../cash/cash-gate';
import { ReceiveDialog } from './receive-dialog';
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
  const can = useCan();
  const editor = useSaleEditor(emptySale(context));
  // "Registrar recebimento" grava a venda e abre o recebimento em seguida [p.9].
  const [receiving, setReceiving] = useState<Sale | null>(null);
  const open = (saleId: string) => navigate({ to: '/vendas/$saleId', params: { saleId } });
  const save = useMutation({
    mutationFn: (args: { data: SaleData; receive: boolean }) =>
      api('POST', '/sales', saleSchema, args.data),
    onSuccess: async (saved, { receive }) => {
      queryClient.setQueryData(saleQuery(saved.id).queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: ['sales'] });
      if (receive && saved.receivable) {
        setReceiving(saved);
        return;
      }
      toast.success(
        `${saved.status === 'quote' ? 'Orçamento' : 'Venda'} ${String(saved.code)} gravad${saved.status === 'quote' ? 'o' : 'a'}: ${formatMoney(saved.netTotal)}.`,
      );
      await open(saved.id);
    },
    onError: editor.serverErrors,
  });
  const submit = (receive: boolean) => {
    const data = editor.validate();
    if (data) save.mutate({ data, receive });
  };
  const canReceive = can('sales.receive') && editor.state.kind === 'sale';
  const cashGate = useCashGate('O recebimento entra no seu caixa. Abra-o para continuar.');

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
              submit(false);
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
              <Button
                type="submit"
                variant={canReceive ? 'secondary' : 'primary'}
                pending={save.isPending && !save.variables.receive}
              >
                {editor.state.kind === 'quote' ? 'Salvar orçamento' : 'Salvar em aberto'}
              </Button>
              {canReceive ? (
                <Button
                  icon={<Wallet className="size-4" aria-hidden />}
                  pending={save.isPending && save.variables.receive}
                  onClick={() => {
                    cashGate.gate(() => {
                      submit(true);
                    });
                  }}
                >
                  Registrar recebimento
                </Button>
              ) : null}
            </FormActions>
          </form>
        }
        side={<SidePanels />}
      />
      {cashGate.dialog}
      {receiving ? (
        <ReceiveDialog
          sale={receiving}
          methods={context.paymentMethods}
          onClose={() => {
            // A venda já está gravada: fechar sem receber a deixa em aberto.
            void open(receiving.id);
          }}
        />
      ) : null}
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
              {sale.status === 'closed'
                ? 'Estornar venda'
                : `Cancelar ${sale.status === 'quote' ? 'orçamento' : 'venda'}`}
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
  const [receiving, setReceiving] = useState<Sale | null>(null);
  const save = useMutation({
    mutationFn: (args: { data: SaleData; receive: boolean }) =>
      api('PUT', `/sales/${sale.id}`, saleSchema, args.data),
    onSuccess: async (saved, { receive }) => {
      queryClient.setQueryData(saleQuery(saved.id).queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: ['sales'] });
      editor.reset(saleToForm(saved));
      if (receive && saved.receivable) {
        setReceiving(saved);
        return;
      }
      toast.success(
        sale.status === 'quote' && saved.status === 'open'
          ? `Orçamento convertido na venda ${String(saved.code)}.`
          : 'Alterações salvas.',
      );
    },
    onError: editor.serverErrors,
  });
  // Receber grava antes o que estiver na tela, para baixar exatamente o que se vê.
  const submit = (receive: boolean) => {
    const data = editor.validate();
    if (data) save.mutate({ data, receive });
  };
  const converting = sale.status === 'quote' && editor.state.kind === 'sale';
  const canReceive = sale.receivable && editor.state.kind === 'sale';
  const cashGate = useCashGate('O recebimento entra no seu caixa. Abra-o para continuar.');

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
              submit(false);
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
              <Button
                type="submit"
                variant={canReceive ? 'secondary' : 'primary'}
                pending={save.isPending && !save.variables.receive}
              >
                {converting ? 'Converter em venda' : 'Salvar alterações'}
              </Button>
              {canReceive ? (
                <Button
                  icon={<Wallet className="size-4" aria-hidden />}
                  pending={save.isPending && save.variables.receive}
                  onClick={() => {
                    cashGate.gate(() => {
                      submit(true);
                    });
                  }}
                >
                  Registrar recebimento
                </Button>
              ) : null}
            </FormActions>
          </form>
        }
        side={<SidePanels currentId={sale.id} />}
      />
      {cashGate.dialog}
      {receiving ? (
        <ReceiveDialog
          sale={receiving}
          methods={context.paymentMethods}
          onClose={() => {
            setReceiving(null);
          }}
        />
      ) : null}
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
  // Venda baixada é estornada pelo caixa aberto do operador [RN-29].
  const cashGate = useCashGate('O estorno devolve o valor pelo seu caixa. Abra-o para continuar.');
  return (
    <>
      <SaleHeader
        sale={sale}
        onCancel={
          sale.reversible
            ? () => {
                cashGate.gate(() => {
                  setCancelling(true);
                });
              }
            : sale.cancellable
              ? () => {
                  setCancelling(true);
                }
              : null
        }
      />
      {cashGate.dialog}
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
            {sale.closed ? <Payments sale={sale} /> : null}
            {sale.notes ? (
              <Section title="Observações">
                <p className="text-sm whitespace-pre-wrap">{sale.notes}</p>
              </Section>
            ) : null}
          </div>
        }
        side={<SidePanels currentId={sale.id} />}
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

/** Formas que baixaram a venda e a agenda de parcelas a receber [RN-27]. */
function Payments({ sale }: { sale: Sale }) {
  return (
    <Section
      title="Recebimento"
      {...(sale.closed
        ? { description: `Baixada em ${formatDateTime(sale.closed.at)} por ${sale.closed.by}` }
        : {})}
    >
      {sale.payments.length === 0 ? (
        <p className="text-sm text-ink-muted">Venda sem valor a receber.</p>
      ) : (
        <ul className="divide-y divide-line" aria-label="Formas de recebimento">
          {sale.payments.map((p) => (
            <li key={p.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 text-sm font-medium">
                  {p.methodName}
                  {p.installments > 1 ? (
                    <span className="font-normal text-ink-muted"> em {p.installments}×</span>
                  ) : null}
                  {p.reversed ? (
                    <span className="font-normal text-danger-600"> · estornado</span>
                  ) : null}
                </span>
                <span className="shrink-0 font-mono text-sm tabular-nums">
                  {formatMoney(p.amount)}
                </span>
              </div>
              <ul
                className="mt-1.5 space-y-0.5 text-xs text-ink-muted"
                aria-label={`Parcelas de ${p.methodName}`}
              >
                {p.receivables.map((r) => (
                  <li key={r.number} className="flex flex-wrap justify-between gap-x-3">
                    <span>
                      {p.installments > 1 ? `${String(r.number)}/${String(p.installments)} · ` : ''}
                      Previsto para {formatBrDate(r.dueDate)}
                    </span>
                    <span className="font-mono tabular-nums">
                      {formatMoney(r.amount)}
                      {r.feeAmount > 0
                        ? ` − taxa ${formatMoney(r.feeAmount)} = ${formatMoney(r.netAmount)}`
                        : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Section>
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
    mutationFn: () =>
      api('POST', `/sales/${sale.id}/${reversing ? 'reverse' : 'cancel'}`, saleSchema, { reason }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(saleQuery(saved.id).queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: ['sales'] });
      await queryClient.invalidateQueries({ queryKey: ['cash'] });
      toast.success(
        reversing
          ? `Venda ${String(sale.code)} estornada; a devolução entrou no seu caixa.`
          : `${sale.status === 'quote' ? 'Orçamento' : 'Venda'} ${String(sale.code)} cancelad${sale.status === 'quote' ? 'o' : 'a'}.`,
      );
      onClose();
    },
    onError: (e) => {
      setError(
        e instanceof ApiRequestError ? (e.fieldErrors[0]?.message ?? e.message) : errorMessage(e),
      );
    },
  });
  const reversing = sale.status === 'closed';
  const noun = sale.status === 'quote' ? 'orçamento' : 'venda';
  const refunds = sale.payments.filter((p) => !p.reversed);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={
        reversing ? `Estornar venda ${String(sale.code)}` : `Cancelar ${noun} ${String(sale.code)}`
      }
      description={
        reversing
          ? 'A devolução sai do seu caixa na forma em que foi recebida, e a venda fica cancelada no histórico.'
          : 'O registro continua no histórico, marcado como cancelado.'
      }
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
            {reversing ? 'Estornar venda' : `Cancelar ${noun}`}
          </Button>
        </>
      }
    >
      {reversing && refunds.length > 0 ? (
        <ul
          className="mb-4 space-y-1 rounded-control bg-sunken px-3 py-2 text-sm"
          aria-label="Devoluções"
        >
          {refunds.map((p) => (
            <li key={p.id} className="flex justify-between gap-3">
              <span>Devolver em {p.methodName}</span>
              <span className="font-mono tabular-nums">{formatMoney(p.amount)}</span>
            </li>
          ))}
        </ul>
      ) : null}
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

/** Painel lateral do PDV [p.9]: caixa do operador e vendas recentes. */
function SidePanels({ currentId }: { currentId?: string }) {
  return (
    <div className="space-y-5">
      <CashPanel />
      <RecentSales {...(currentId ? { currentId } : {})} />
    </div>
  );
}

/** Painel lateral [p.9]: vendas das últimas 24 horas e busca de venda. */
function RecentSales({ currentId }: { currentId?: string }) {
  const [term, setTerm] = useState('');
  const q = useDebounced(term.trim());
  const recent = useQuery(salesListQuery({ sinceHours: 24, pageSize: 50 }));
  const found = useQuery({ ...salesListQuery({ q, pageSize: 10 }), enabled: q.length >= 1 });
  const groups: { title: string; statuses: SaleStatus[] }[] = [
    { title: 'Não pagas', statuses: ['open'] },
    { title: 'Pagas', statuses: ['closed'] },
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
