import {
  claimListSchema,
  claimSchema,
  claimStatusLabels,
  glossClaimSchema,
  reconcileClaimsSchema,
  type Claim,
  type ClaimFilter,
  type ClaimStatus,
} from '@clinica/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { FileCheck2 } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { Button } from '../../design-system/button';
import { Checkbox } from '../../design-system/checkbox';
import { Dialog } from '../../design-system/dialog';
import { Segmented, SelectField, TextareaField, TextField } from '../../design-system/field';
import { Badge, PageHeader, Panel, Stats } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { DataTable } from '../../design-system/table';
import { useToast } from '../../design-system/toast';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { formatCalendarDate } from '../../lib/format';
import { formatMoney, moneyInput, parseDecimal } from '../products/format';
import { addMonths, localToday, startOfMonth } from '../schedule/dates';

export const claimSituations = ['nao-conciliados', 'conciliados', 'glosados', 'todos'] as const;
export type ClaimSituation = (typeof claimSituations)[number];

const filterOf: Record<ClaimSituation, ClaimFilter> = {
  'nao-conciliados': 'pending',
  conciliados: 'reconciled',
  glosados: 'glossed',
  todos: 'all',
};

export interface ClaimSearch {
  situacao: ClaimSituation;
  convenio: string | undefined;
  de: string | undefined;
  ate: string | undefined;
}

interface UrlPatch {
  situacao?: Exclude<ClaimSituation, 'nao-conciliados'> | undefined;
  convenio?: string | undefined;
  de?: string | undefined;
  ate?: string | undefined;
}

/** Sem período na URL, os últimos três meses até hoje: repasse costuma cair em 30 a 60 dias. */
const defaultFrom = () => startOfMonth(addMonths(localToday(), -2));

const claimsQuery = (s: ClaimSearch) => ({
  queryKey: ['insurers', 'claims', s],
  queryFn: () => {
    const params = new URLSearchParams({
      status: filterOf[s.situacao],
      from: s.de ?? defaultFrom(),
      to: s.ate ?? localToday(),
    });
    if (s.convenio) params.set('insurerId', s.convenio);
    return api('GET', `/insurers/claims?${params.toString()}`, claimListSchema);
  },
  placeholderData: keepPreviousData,
});

const tones: Record<ClaimStatus, 'amber' | 'sage' | 'danger' | 'neutral'> = {
  pending: 'amber',
  reconciled: 'sage',
  glossed: 'danger',
  cancelled: 'neutral',
};

const proceduresLabel = (n: number) => (n === 1 ? '1 procedimento' : `${String(n)} procedimentos`);

/**
 * Repasses dos convênios [p.20]: os procedimentos atendidos pelo convênio, por data. Concilie o
 * que caiu na conta, glose o que o convênio recusou e desfaça a conciliação feita por engano.
 */
export function ClaimsPage({ search }: { search: ClaimSearch }) {
  const navigate = useNavigate({ from: '/convenios/repasses' });
  const set = (patch: UrlPatch) => {
    setSelected(new Set());
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  };
  const list = useQuery(claimsQuery(search));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reconciling, setReconciling] = useState<Claim[] | null>(null);
  const [glossing, setGlossing] = useState<Claim | null>(null);
  const [undoing, setUndoing] = useState<Claim | null>(null);
  const items = list.data?.items ?? [];
  const chosen = items.filter((c) => c.status === 'pending' && selected.has(c.id));
  const chosenTotal = chosen.reduce((a, c) => a + Math.round(c.expected * 100), 0) / 100;
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };

  return (
    <>
      <PageHeader
        area="Convênios"
        title="Repasses"
        description="Cada procedimento atendido pelo convênio vira um repasse a receber na data prevista. Confira o extrato do convênio, concilie o que caiu e glose o que foi recusado."
      />
      {list.data ? (
        <div className="mb-5">
          <Stats
            label="Resumo dos repasses"
            items={[
              {
                label: 'Todos',
                value: formatMoney(list.data.totals.all.amount),
                detail: proceduresLabel(list.data.totals.all.count),
              },
              {
                label: 'Não conciliados',
                value: formatMoney(list.data.totals.pending.amount),
                detail: proceduresLabel(list.data.totals.pending.count),
              },
              {
                label: 'Conciliados',
                value: formatMoney(list.data.totals.reconciled.amount),
                detail: proceduresLabel(list.data.totals.reconciled.count),
              },
              {
                label: 'Glosados',
                value: formatMoney(list.data.totals.glossed.amount),
                detail: proceduresLabel(list.data.totals.glossed.count),
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
            { value: 'conciliados', label: 'Conciliados' },
            { value: 'glosados', label: 'Glosados' },
            { value: 'todos', label: 'Todos' },
          ]}
          onChange={(situacao) => {
            set({ situacao: situacao === 'nao-conciliados' ? undefined : situacao });
          }}
        />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="col-span-2">
            <SelectField
              label="Convênio"
              value={search.convenio ?? ''}
              placeholder="Todos"
              options={(list.data?.insurers ?? []).map((i) => ({ value: i.id, label: i.name }))}
              onChange={(e) => {
                set({ convenio: e.target.value || undefined });
              }}
            />
          </div>
          <TextField
            label="Atendidos de"
            type="date"
            value={search.de ?? defaultFrom()}
            onChange={(e) => {
              set({ de: e.target.value || undefined });
            }}
          />
          <TextField
            label="Atendidos até"
            type="date"
            value={search.ate ?? localToday()}
            onChange={(e) => {
              set({ ate: e.target.value || undefined });
            }}
          />
        </div>
      </Panel>

      {chosen.length > 0 ? (
        <Panel className="mb-3 flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="text-sm" aria-live="polite">
            {chosen.length === 1 ? '1 selecionado' : `${String(chosen.length)} selecionados`} ·{' '}
            <span className="font-mono tabular-nums">{formatMoney(chosenTotal)}</span>
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelected(new Set());
              }}
            >
              Limpar
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setReconciling(chosen);
              }}
            >
              Conciliar selecionados
            </Button>
          </div>
        </Panel>
      ) : null}

      {list.isPending ? (
        <SkeletonRows rows={5} columns={4} />
      ) : list.isError ? (
        <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
      ) : (
        <Panel>
          {items.length === 0 ? (
            <EmptyState
              icon={FileCheck2}
              title={
                search.situacao === 'nao-conciliados'
                  ? 'Nenhum repasse esperando conciliação'
                  : 'Nenhum repasse nesta busca'
              }
              description="Os procedimentos de vendas pelo convênio aparecem aqui quando a venda é recebida."
            />
          ) : (
            <div aria-busy={list.isFetching || undefined}>
              <DataTable
                caption="Repasses dos convênios"
                rows={items}
                rowKey={(c) => c.id}
                columns={[
                  {
                    header: 'Procedimento',
                    cell: (c) => (
                      <div className="min-w-0 space-y-1">
                        {c.status === 'pending' ? (
                          <Checkbox
                            label={c.procedure}
                            description={`${c.patient} · ${c.client} · venda ${String(c.saleCode)}`}
                            checked={selected.has(c.id)}
                            onCheckedChange={(on) => {
                              toggle(c.id, on);
                            }}
                          />
                        ) : (
                          <p className="text-sm">
                            {c.procedure}
                            <span className="block text-xs text-ink-muted">
                              {c.patient} · {c.client} · venda {c.saleCode}
                            </span>
                          </p>
                        )}
                        <p className="text-xs text-ink-muted md:hidden">
                          {c.insurer.name} · atendido em {formatCalendarDate(c.serviceDate)}
                        </p>
                        {c.glossReason ? (
                          <p className="text-xs text-danger-600">Glosa: {c.glossReason}</p>
                        ) : null}
                        <span className="md:hidden">
                          <Badge tone={tones[c.status]}>{claimStatusLabels[c.status]}</Badge>
                        </span>
                      </div>
                    ),
                  },
                  {
                    header: 'Convênio',
                    hideOnMobile: true,
                    cell: (c) => (
                      <div className="min-w-0 text-sm">
                        <span className="block">{c.insurer.name}</span>
                        <span className="block text-xs text-ink-muted">
                          Carteirinha {c.cardNumber}
                          {c.authorizationCode ? ` · autorização ${c.authorizationCode}` : ''}
                        </span>
                        <span className="block text-xs text-ink-muted">{c.professional}</span>
                      </div>
                    ),
                  },
                  {
                    header: 'Datas',
                    hideOnMobile: true,
                    className: 'whitespace-nowrap',
                    cell: (c) => (
                      <div className="font-mono text-xs tabular-nums">
                        <span className="block">Atendido {formatCalendarDate(c.serviceDate)}</span>
                        <span className="block text-ink-muted">
                          {c.reconciledOn
                            ? `Caiu ${formatCalendarDate(c.reconciledOn)}`
                            : `Previsto ${formatCalendarDate(c.dueDate)}`}
                        </span>
                      </div>
                    ),
                  },
                  {
                    header: 'Valor',
                    className: 'text-right whitespace-nowrap',
                    cell: (c) => (
                      <>
                        <span className="block font-mono text-sm tabular-nums">
                          {formatMoney(c.expected)}
                        </span>
                        {c.glossAmount > 0 ? (
                          <span className="block font-mono text-xs text-danger-600 tabular-nums">
                            − {formatMoney(c.glossAmount)} glosa
                          </span>
                        ) : null}
                      </>
                    ),
                  },
                  {
                    header: 'Situação',
                    hideOnMobile: true,
                    cell: (c) => (
                      <>
                        <Badge tone={tones[c.status]}>{claimStatusLabels[c.status]}</Badge>
                        {c.reconciledBy ? (
                          <span className="mt-0.5 block text-xs text-ink-muted">
                            por {c.reconciledBy}
                          </span>
                        ) : null}
                      </>
                    ),
                  },
                  {
                    header: 'Ações',
                    className: 'text-right',
                    cell: (c: Claim) =>
                      c.status === 'reconciled' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Desfazer conciliação de ${c.procedure}, venda ${String(c.saleCode)}`}
                          onClick={() => {
                            setUndoing(c);
                          }}
                        >
                          Desfazer
                        </Button>
                      ) : c.status === 'pending' ? (
                        <div className="flex flex-col items-end gap-1 sm:flex-row sm:justify-end">
                          <Button
                            variant="secondary"
                            size="sm"
                            aria-label={`Conciliar ${c.procedure}, venda ${String(c.saleCode)}`}
                            onClick={() => {
                              setReconciling([c]);
                            }}
                          >
                            Conciliar
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Glosar ${c.procedure}, venda ${String(c.saleCode)}`}
                            onClick={() => {
                              setGlossing(c);
                            }}
                          >
                            Glosar
                          </Button>
                        </div>
                      ) : null,
                  },
                ]}
              />
            </div>
          )}
        </Panel>
      )}
      {reconciling && list.data ? (
        <ReconcileDialog
          claims={reconciling}
          today={list.data.today}
          onClose={(done) => {
            setReconciling(null);
            if (done) setSelected(new Set());
          }}
        />
      ) : null}
      {glossing ? (
        <GlossDialog
          claim={glossing}
          onClose={() => {
            setGlossing(null);
          }}
        />
      ) : null}
      {undoing ? (
        <UndoDialog
          claim={undoing}
          onClose={() => {
            setUndoing(null);
          }}
        />
      ) : null}
    </>
  );
}

type FieldErrors = Record<string, string>;

/** Erros por campo da API ficam no campo; o resto aparece no topo do diálogo. */
function useClaimMutation<T>(
  fn: (body: T) => Promise<unknown>,
  message: string,
  onDone: () => void,
) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<FieldErrors>({});
  const mutation = useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['insurers', 'claims'] });
      await queryClient.invalidateQueries({ queryKey: ['finance'] });
      toast.success(message);
      onDone();
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.fieldErrors.length > 0) {
        setErrors(Object.fromEntries(e.fieldErrors.map((f) => [f.path, f.message])));
      }
    },
  });
  const generalError =
    mutation.isError &&
    !(mutation.error instanceof ApiRequestError && mutation.error.fieldErrors.length > 0)
      ? errorMessage(mutation.error)
      : null;
  return { mutation, errors, setErrors, generalError };
}

function GeneralError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600">
      {message}
    </p>
  ) : null;
}

function ReconcileDialog({
  claims,
  today,
  onClose,
}: {
  claims: Claim[];
  today: string;
  onClose: (done: boolean) => void;
}) {
  const latestDue = claims.reduce((a, c) => (c.dueDate > a ? c.dueDate : a), '');
  const [receivedOn, setReceivedOn] = useState(latestDue && latestDue < today ? latestDue : today);
  const total = claims.reduce((a, c) => a + Math.round(c.expected * 100), 0) / 100;
  const { mutation, errors, setErrors, generalError } = useClaimMutation(
    (body: z.output<typeof reconcileClaimsSchema>) =>
      api('POST', '/insurers/claims/reconcile', z.object({ count: z.number() }), body),
    claims.length === 1 ? 'Repasse conciliado.' : `${String(claims.length)} repasses conciliados.`,
    () => {
      onClose(true);
    },
  );
  const submit = () => {
    const parsed = reconcileClaimsSchema.safeParse({
      claimIds: claims.map((c) => c.id),
      receivedOn,
    });
    if (!parsed.success) {
      const found: FieldErrors = {};
      for (const issue of parsed.error.issues) found[issue.path.join('.')] ??= issue.message;
      setErrors(found);
      return;
    }
    mutation.mutate(parsed.data);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose(false);
      }}
      title="Conciliar repasse"
      description={`${proceduresLabel(claims.length)} · ${formatMoney(total)}. Os lançamentos a receber ficam pagos na data em que o repasse caiu.`}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              onClose(false);
            }}
          >
            Voltar
          </Button>
          <Button type="submit" form="claim-reconcile-form" pending={mutation.isPending}>
            Conciliar
          </Button>
        </>
      }
    >
      <form
        id="claim-reconcile-form"
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <GeneralError message={generalError} />
        <ul className="max-h-48 divide-y divide-line overflow-y-auto rounded-control bg-sunken text-sm">
          {claims.map((c) => (
            <li key={c.id} className="flex justify-between gap-3 px-3 py-2">
              <span className="min-w-0 truncate">
                {c.procedure} · {c.patient}
              </span>
              <span className="shrink-0 font-mono tabular-nums">{formatMoney(c.expected)}</span>
            </li>
          ))}
        </ul>
        <TextField
          label="Caiu em"
          type="date"
          max={today}
          value={receivedOn}
          error={errors.receivedOn ?? errors.claimIds}
          onChange={(e) => {
            setReceivedOn(e.target.value);
          }}
        />
      </form>
    </Dialog>
  );
}

function GlossDialog({ claim, onClose }: { claim: Claim; onClose: () => void }) {
  const [amount, setAmount] = useState(moneyInput(claim.expected));
  const [reason, setReason] = useState('');
  const value = parseDecimal(amount);
  const full = value !== null && Math.round(value * 100) === Math.round(claim.expected * 100);
  const { mutation, errors, setErrors, generalError } = useClaimMutation(
    (body: z.output<typeof glossClaimSchema>) =>
      api('POST', `/insurers/claims/${claim.id}/gloss`, claimSchema, body),
    'Glosa registrada.',
    onClose,
  );
  const submit = () => {
    const parsed = glossClaimSchema.safeParse({ amount: value ?? Number.NaN, reason });
    if (!parsed.success) {
      const found: FieldErrors = {};
      for (const issue of parsed.error.issues) found[issue.path.join('.')] ??= issue.message;
      setErrors(found);
      return;
    }
    mutation.mutate(parsed.data);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Glosar procedimento"
      description={`${claim.procedure} · ${claim.patient} · venda ${String(claim.saleCode)}. Falta receber ${formatMoney(claim.expected)}.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" form="claim-gloss-form" pending={mutation.isPending}>
            Glosar
          </Button>
        </>
      }
    >
      <form
        id="claim-gloss-form"
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <GeneralError message={generalError} />
        <TextField
          label="Valor glosado (R$)"
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          error={errors.amount}
          hint={
            full
              ? 'Glosa total: o lançamento a receber é cancelado.'
              : 'Glosa parcial: o resto segue a conciliar.'
          }
          onChange={(e) => {
            setAmount(e.target.value);
          }}
        />
        <TextareaField
          label="Motivo"
          rows={2}
          maxLength={300}
          value={reason}
          error={errors.reason}
          onChange={(e) => {
            setReason(e.target.value);
          }}
        />
      </form>
    </Dialog>
  );
}

function UndoDialog({ claim, onClose }: { claim: Claim; onClose: () => void }) {
  const { mutation, generalError } = useClaimMutation(
    (_: null) => api('POST', `/insurers/claims/${claim.id}/undo`, claimSchema),
    'Conciliação desfeita.',
    onClose,
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Desfazer conciliação"
      description="O procedimento volta a não conciliado e o lançamento a receber volta a ficar aberto."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button
            pending={mutation.isPending}
            onClick={() => {
              mutation.mutate(null);
            }}
          >
            Desfazer conciliação
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <GeneralError message={generalError} />
        <p className="text-sm">
          {claim.procedure}, {claim.patient}:{' '}
          <span className="font-mono">{formatMoney(claim.expected)}</span> conciliado em{' '}
          {formatCalendarDate(claim.reconciledOn ?? claim.dueDate)}.
        </p>
      </div>
    </Dialog>
  );
}
