import {
  acquirerKinds,
  cardDepositListSchema,
  cardDepositStatusLabels,
  reconcileInputSchema,
  type CardDeposit,
  type CardDepositStatus,
} from '@clinica/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { CreditCard } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { Button } from '../../design-system/button';
import { Dialog } from '../../design-system/dialog';
import { Segmented, SelectField, TextField } from '../../design-system/field';
import { Badge, PageHeader, Panel, Stats } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { DataTable } from '../../design-system/table';
import { useToast } from '../../design-system/toast';
import { api, ApiRequestError, apiVoid, errorMessage } from '../../lib/api';
import { formatCalendarDate } from '../../lib/format';
import { useCan } from '../../lib/session';
import { formatMoney, moneyInput, parseDecimal } from '../products/format';
import { paymentMethodsQuery } from '../sales/payment-methods-page';

export const depositSituations = ['nao-conciliados', 'previstos', 'conciliados', 'todos'] as const;
export type DepositSituation = (typeof depositSituations)[number];

export interface DepositSearch {
  situacao: DepositSituation;
  forma: string | undefined;
  de: string | undefined;
  ate: string | undefined;
}

interface UrlPatch {
  situacao?: Exclude<DepositSituation, 'nao-conciliados'> | undefined;
  forma?: string | undefined;
  de?: string | undefined;
  ate?: string | undefined;
}

const depositsQuery = (s: DepositSearch) => ({
  queryKey: ['finance', 'card-deposits', s],
  queryFn: () => {
    const params = new URLSearchParams({ situacao: s.situacao });
    if (s.forma) params.set('forma', s.forma);
    if (s.de) params.set('de', s.de);
    if (s.ate) params.set('ate', s.ate);
    return api('GET', `/finance/card-deposits?${params.toString()}`, cardDepositListSchema);
  },
  placeholderData: keepPreviousData,
});

const tones: Record<CardDepositStatus, 'amber' | 'neutral' | 'sage'> = {
  unreconciled: 'amber',
  expected: 'neutral',
  reconciled: 'sage',
};

/**
 * Conciliação de cartões [p.18, RN-37]: cada linha é um depósito que a adquirente deve fazer
 * (forma, data e conta). Conciliar confirma o que caiu; a diferença vira lançamento.
 */
export function ReconciliationPage({ search }: { search: DepositSearch }) {
  const can = useCan();
  const navigate = useNavigate({ from: '/financeiro/conciliacao' });
  const set = (patch: UrlPatch) => {
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  };
  const list = useQuery(depositsQuery(search));
  const methods = useQuery(paymentMethodsQuery);
  const [reconciling, setReconciling] = useState<CardDeposit | null>(null);
  const [undoing, setUndoing] = useState<CardDeposit | null>(null);
  const cardMethods = (methods.data ?? []).filter((m) => acquirerKinds.includes(m.kind));
  const manage = can('finance.manage');

  return (
    <>
      <PageHeader
        area="Financeiro"
        title="Conciliação de cartões"
        description="Cada linha é um depósito que a adquirente deve fazer: as parcelas de uma forma de recebimento previstas para o mesmo dia. Confira no extrato do banco e concilie com o valor que caiu."
      />
      {list.data ? (
        <div className="mb-5">
          <Stats
            label="Resumo da conciliação"
            items={[
              {
                label: 'Não conciliados',
                value: formatMoney(list.data.counts.unreconciled.amount),
                detail: depositsLabel(list.data.counts.unreconciled.count),
              },
              {
                label: 'Previstos',
                value: formatMoney(list.data.counts.expected.amount),
                detail: depositsLabel(list.data.counts.expected.count),
              },
              {
                label: 'Conciliados',
                value: formatMoney(list.data.counts.reconciled.amount),
                detail: depositsLabel(list.data.counts.reconciled.count),
              },
              {
                label: 'Diferença',
                value: <Signed value={list.data.counts.difference} />,
                detail: 'Recebido menos o previsto',
              },
            ]}
          />
        </div>
      ) : null}
      <Panel className="mb-5 space-y-4 p-4">
        <Segmented
          label="Situação"
          value={search.situacao}
          options={[
            { value: 'nao-conciliados', label: 'Não conciliados' },
            { value: 'previstos', label: 'Previstos' },
            { value: 'conciliados', label: 'Conciliados' },
            { value: 'todos', label: 'Todos' },
          ]}
          onChange={(situacao) => {
            set({ situacao: situacao === 'nao-conciliados' ? undefined : situacao });
          }}
        />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="col-span-2">
            <SelectField
              label="Forma de recebimento"
              value={search.forma ?? ''}
              placeholder="Todas"
              options={cardMethods.map((m) => ({ value: m.id, label: m.name }))}
              onChange={(e) => {
                set({ forma: e.target.value || undefined });
              }}
            />
          </div>
          <TextField
            label="Previsto de"
            type="date"
            value={search.de ?? ''}
            onChange={(e) => {
              set({ de: e.target.value || undefined });
            }}
          />
          <TextField
            label="Previsto até"
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
              icon={CreditCard}
              title={
                search.situacao === 'nao-conciliados'
                  ? 'Nenhum depósito esperando conciliação'
                  : 'Nenhum depósito nesta busca'
              }
              description="As vendas em cartão de débito, crédito e convênio aparecem aqui na data em que a adquirente deve depositar."
            />
          ) : (
            <div aria-busy={list.isFetching || undefined}>
              <DataTable
                caption="Depósitos de cartão"
                rows={list.data.items}
                rowKey={(d) => d.settlement?.id ?? d.key}
                columns={[
                  {
                    header: 'Previsto para',
                    className: 'w-32',
                    hideOnMobile: true,
                    cell: (d) => (
                      <span className="font-mono text-sm tabular-nums">
                        {formatCalendarDate(d.expectedDate)}
                      </span>
                    ),
                  },
                  {
                    header: 'Depósito',
                    cell: (d) => (
                      <div className="min-w-0">
                        <span className="block text-sm font-medium">{d.paymentMethod.name}</span>
                        <span className="block text-xs text-ink-muted">
                          {d.account.name} ·{' '}
                          {d.count === 1 ? '1 parcela' : `${String(d.count)} parcelas`}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-2 md:hidden">
                          <span className="font-mono text-xs text-ink-muted tabular-nums">
                            {formatCalendarDate(d.expectedDate)}
                          </span>
                          <Badge tone={tones[d.status]}>{cardDepositStatusLabels[d.status]}</Badge>
                        </span>
                      </div>
                    ),
                  },
                  {
                    header: 'Bruto',
                    hideOnMobile: true,
                    className: 'text-right whitespace-nowrap',
                    cell: (d) => (
                      <span className="font-mono text-sm tabular-nums">{formatMoney(d.gross)}</span>
                    ),
                  },
                  {
                    header: 'Taxa',
                    hideOnMobile: true,
                    className: 'text-right whitespace-nowrap',
                    cell: (d) => (
                      <span className="font-mono text-sm text-ink-muted tabular-nums">
                        {formatMoney(d.fee)}
                      </span>
                    ),
                  },
                  {
                    header: 'Líquido',
                    className: 'text-right whitespace-nowrap',
                    cell: (d) => (
                      <>
                        <span className="block font-mono text-sm tabular-nums">
                          {formatMoney(d.settlement?.receivedNet ?? d.expectedNet)}
                        </span>
                        {d.settlement && d.settlement.difference !== 0 ? (
                          <span className="block text-xs">
                            <Signed value={d.settlement.difference} />
                          </span>
                        ) : (
                          <span className="block text-xs text-ink-muted">
                            {d.settlement ? 'Sem diferença' : 'Previsto'}
                          </span>
                        )}
                      </>
                    ),
                  },
                  {
                    header: 'Situação',
                    hideOnMobile: true,
                    cell: (d) => (
                      <>
                        <Badge tone={tones[d.status]}>{cardDepositStatusLabels[d.status]}</Badge>
                        {d.settlement ? (
                          <span className="mt-0.5 block text-xs text-ink-muted">
                            Caiu em {formatCalendarDate(d.settlement.depositDate)}
                          </span>
                        ) : null}
                      </>
                    ),
                  },
                  ...(manage
                    ? [
                        {
                          header: 'Ações',
                          className: 'text-right',
                          cell: (d: CardDeposit) =>
                            d.settlement ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label={`Desfazer conciliação de ${d.paymentMethod.name} em ${formatCalendarDate(d.expectedDate)}`}
                                onClick={() => {
                                  setUndoing(d);
                                }}
                              >
                                Desfazer
                              </Button>
                            ) : (
                              <Button
                                variant={d.status === 'unreconciled' ? 'primary' : 'secondary'}
                                size="sm"
                                aria-label={`Conciliar ${d.paymentMethod.name} em ${formatCalendarDate(d.expectedDate)}`}
                                onClick={() => {
                                  setReconciling(d);
                                }}
                              >
                                Conciliar
                              </Button>
                            ),
                        },
                      ]
                    : []),
                ]}
              />
            </div>
          )}
        </Panel>
      )}
      {reconciling && list.data ? (
        <ReconcileDialog
          deposit={reconciling}
          today={list.data.today}
          onClose={() => {
            setReconciling(null);
          }}
        />
      ) : null}
      {undoing ? (
        <UndoDialog
          deposit={undoing}
          onClose={() => {
            setUndoing(null);
          }}
        />
      ) : null}
    </>
  );
}

const depositsLabel = (n: number) => (n === 1 ? '1 depósito' : `${String(n)} depósitos`);

function Signed({ value }: { value: number }) {
  return (
    <span
      className={clsx(
        'font-mono tabular-nums',
        value < 0 ? 'text-danger-600' : value > 0 ? 'text-sage-700' : undefined,
      )}
    >
      {value > 0 ? '+' : ''}
      {formatMoney(value)}
    </span>
  );
}

function ReconcileDialog({
  deposit,
  today,
  onClose,
}: {
  deposit: CardDeposit;
  today: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [depositDate, setDepositDate] = useState(
    deposit.expectedDate < today ? deposit.expectedDate : today,
  );
  const [received, setReceived] = useState(moneyInput(deposit.expectedNet));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const value = parseDecimal(received);
  const difference =
    value === null || Number.isNaN(value)
      ? null
      : Math.round(value * 100 - deposit.expectedNet * 100) / 100;
  const save = useMutation({
    mutationFn: (body: z.output<typeof reconcileInputSchema>) =>
      api('POST', '/finance/card-deposits/reconcile', z.object({ id: z.string() }), body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance'] });
      toast.success('Depósito conciliado.');
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.fieldErrors.length > 0) {
        setErrors(Object.fromEntries(e.fieldErrors.map((f) => [f.path, f.message])));
      }
    },
  });
  const submit = () => {
    const parsed = reconcileInputSchema.safeParse({
      paymentMethodId: deposit.paymentMethod.id,
      accountId: deposit.account.id,
      expectedDate: deposit.expectedDate,
      depositDate,
      receivedNet: value ?? Number.NaN,
    });
    if (!parsed.success) {
      const found: Record<string, string> = {};
      for (const issue of parsed.error.issues) found[issue.path.join('.')] ??= issue.message;
      setErrors(found);
      return;
    }
    save.mutate(parsed.data);
  };
  const generalError =
    save.isError && !(save.error instanceof ApiRequestError && save.error.fieldErrors.length > 0)
      ? errorMessage(save.error)
      : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Conciliar depósito"
      description={`${deposit.paymentMethod.name} · ${deposit.account.name} · previsto para ${formatCalendarDate(deposit.expectedDate)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" form="reconcile-form" pending={save.isPending}>
            Conciliar
          </Button>
        </>
      }
    >
      <form
        id="reconcile-form"
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {generalError ? (
          <p
            role="alert"
            className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600"
          >
            {generalError}
          </p>
        ) : null}
        <dl className="grid grid-cols-3 gap-3 rounded-control bg-sunken px-3 py-2 text-sm">
          <div>
            <dt className="text-xs text-ink-muted">Bruto</dt>
            <dd className="font-mono tabular-nums">{formatMoney(deposit.gross)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Taxa</dt>
            <dd className="font-mono tabular-nums">{formatMoney(deposit.fee)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Líquido previsto</dt>
            <dd className="font-mono font-medium tabular-nums">
              {formatMoney(deposit.expectedNet)}
            </dd>
          </div>
        </dl>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Caiu em"
            type="date"
            value={depositDate}
            error={errors.depositDate}
            onChange={(e) => {
              setDepositDate(e.target.value);
            }}
          />
          <TextField
            label="Valor que caiu"
            inputMode="decimal"
            autoComplete="off"
            value={received}
            error={errors.receivedNet}
            onChange={(e) => {
              setReceived(e.target.value);
            }}
          />
        </div>
        <p className="text-sm" aria-live="polite">
          {difference === null || difference === 0 ? (
            <span className="text-ink-muted">Sem diferença para o previsto.</span>
          ) : (
            <>
              Diferença de <Signed value={difference} />:{' '}
              {difference < 0
                ? 'entra como despesa em Taxas de cartão.'
                : 'entra como receita em Vendas.'}
            </>
          )}
        </p>
      </form>
    </Dialog>
  );
}

function UndoDialog({ deposit, onClose }: { deposit: CardDeposit; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const undo = useMutation({
    mutationFn: () =>
      apiVoid('POST', `/finance/card-deposits/${deposit.settlement?.id ?? ''}/undo`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance'] });
      toast.success('Conciliação desfeita.');
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Desfazer conciliação"
      description="As parcelas voltam a aguardar o depósito e o ajuste da diferença é cancelado."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button
            pending={undo.isPending}
            onClick={() => {
              undo.mutate();
            }}
          >
            Desfazer conciliação
          </Button>
        </>
      }
    >
      {undo.isError ? (
        <p
          role="alert"
          className="mb-3 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600"
        >
          {errorMessage(undo.error)}
        </p>
      ) : null}
      <p className="text-sm">
        {deposit.paymentMethod.name}, previsto para {formatCalendarDate(deposit.expectedDate)}:{' '}
        <span className="font-mono">{formatMoney(deposit.settlement?.receivedNet ?? 0)}</span>{' '}
        conciliado.
      </p>
    </Dialog>
  );
}
