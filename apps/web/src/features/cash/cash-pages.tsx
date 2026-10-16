import {
  cashEntryLabels,
  cashSessionSchema,
  cashSessionStatusLabels,
  fromCents,
  paymentKindLabels,
  toCents,
  type CashMovementKind,
  type CashSession,
  type CashSessionStatus,
} from '@clinica/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowDownToLine, ArrowUpFromLine, Lock, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Button, buttonClasses } from '../../design-system/button';
import { Dialog } from '../../design-system/dialog';
import { Segmented, TextareaField, TextField } from '../../design-system/field';
import { Badge, Facts, PageHeader, Section } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { DataTable } from '../../design-system/table';
import { useToast } from '../../design-system/toast';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useCan } from '../../lib/session';
import { formatMoney, parseDecimal } from '../products/format';
import { OpenCashDialog } from './open-cash-dialog';
import { cashListQuery, cashQuery, currentCashQuery } from './queries';

const statusTone = (status: CashSessionStatus) => (status === 'open' ? 'sage' : 'neutral');

const signed = (value: number) => (value < 0 ? `− ${formatMoney(-value)}` : formatMoney(value));

/** Movimentos de caixa [p.10]: caixas por operador e por dia, com status. */
export function CashListPage() {
  const can = useCan();
  const [status, setStatus] = useState<'all' | CashSessionStatus>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [opening, setOpening] = useState(false);
  const list = useQuery(
    cashListQuery({
      ...(status === 'all' ? {} : { status }),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    }),
  );
  const current = useQuery({ ...currentCashQuery, enabled: can('cash.operate') });
  const mine = current.data?.session ?? null;

  return (
    <>
      <PageHeader
        area="Vendas"
        title="Movimentos de caixa"
        description={
          can('cash.supervise')
            ? 'Caixas de todos os operadores desta unidade, por dia.'
            : 'Os seus caixas nesta unidade, por dia.'
        }
        actions={
          can('cash.operate') && current.isSuccess ? (
            mine ? (
              <Link
                to="/vendas/caixas/$cashId"
                params={{ cashId: mine.id }}
                className={buttonClasses()}
              >
                <Wallet className="size-4" aria-hidden />
                Meu caixa aberto
              </Link>
            ) : (
              <Button
                icon={<Wallet className="size-4" aria-hidden />}
                onClick={() => {
                  setOpening(true);
                }}
              >
                Abrir caixa
              </Button>
            )
          ) : null
        }
      />
      <Section title="Caixas">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Segmented
            label="Situação"
            value={status}
            options={[
              { value: 'all', label: 'Todos' },
              { value: 'open', label: 'Abertos' },
              { value: 'closed', label: 'Fechados' },
            ]}
            onChange={setStatus}
          />
          <div className="w-40">
            <TextField
              label="De"
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
              }}
            />
          </div>
          <div className="w-40">
            <TextField
              label="Até"
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
              }}
            />
          </div>
        </div>
        {list.isPending ? (
          <SkeletonRows rows={4} columns={4} />
        ) : list.isError ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="Nenhum caixa no período"
            description="Os caixas abertos no PDV aparecem aqui, com o que entrou e saiu."
          />
        ) : (
          <DataTable
            caption="Caixas"
            rows={list.data.items}
            rowKey={(s) => s.id}
            columns={[
              {
                header: 'Caixa',
                cell: (s) => (
                  <Link
                    to="/vendas/caixas/$cashId"
                    params={{ cashId: s.id }}
                    className="block min-w-0 hover:underline"
                  >
                    <span className="font-medium">Caixa {s.code}</span>
                    <span className="block text-xs text-ink-muted">
                      {s.operator.name} · {formatDateTime(s.openedAt)}
                    </span>
                  </Link>
                ),
              },
              {
                header: 'Situação',
                cell: (s) => (
                  <Badge tone={statusTone(s.status)}>{cashSessionStatusLabels[s.status]}</Badge>
                ),
              },
              {
                header: 'Vendas',
                hideOnMobile: true,
                className: 'text-right',
                cell: (s) => (
                  <span className="font-mono tabular-nums">{formatMoney(s.salesTotal)}</span>
                ),
              },
              {
                header: 'Dinheiro',
                className: 'text-right',
                cell: (s) => (
                  <span className="font-mono tabular-nums">{formatMoney(s.expectedCash)}</span>
                ),
              },
              {
                header: 'Diferença',
                hideOnMobile: true,
                className: 'text-right',
                cell: (s) =>
                  s.difference === null ? (
                    <span className="text-ink-faint">—</span>
                  ) : (
                    <span
                      className={
                        s.difference === 0
                          ? 'font-mono tabular-nums'
                          : 'font-mono text-danger-600 tabular-nums'
                      }
                    >
                      {signed(s.difference)}
                    </span>
                  ),
              },
            ]}
          />
        )}
      </Section>
      {opening ? (
        <OpenCashDialog
          onClose={() => {
            setOpening(false);
          }}
        />
      ) : null}
    </>
  );
}

export function CashPage({ cashId }: { cashId: string }) {
  const cash = useQuery(cashQuery(cashId));
  if (cash.isPending) return <SkeletonRows />;
  if (cash.isError) {
    return <ErrorState message={errorMessage(cash.error)} onRetry={() => void cash.refetch()} />;
  }
  return <CashDetail session={cash.data} />;
}

function CashDetail({ session }: { session: CashSession }) {
  const [moving, setMoving] = useState<CashMovementKind | null>(null);
  const [closing, setClosing] = useState(false);
  return (
    <>
      <PageHeader
        area={`Caixa ${String(session.code)}`}
        title={session.operator.name}
        description={[
          `Aberto em ${formatDateTime(session.openedAt)}`,
          session.closedAt
            ? `fechado em ${formatDateTime(session.closedAt)}${session.closedBy ? ` por ${session.closedBy}` : ''}`
            : null,
          session.unitName,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <>
            <Badge tone={statusTone(session.status)}>
              {cashSessionStatusLabels[session.status]}
            </Badge>
            {session.canMove ? (
              <>
                <Button
                  variant="ghost"
                  icon={<ArrowDownToLine className="size-4" aria-hidden />}
                  onClick={() => {
                    setMoving('supply');
                  }}
                >
                  Suprimento
                </Button>
                <Button
                  variant="ghost"
                  icon={<ArrowUpFromLine className="size-4" aria-hidden />}
                  onClick={() => {
                    setMoving('withdrawal');
                  }}
                >
                  Sangria
                </Button>
              </>
            ) : null}
            {session.canClose ? (
              <Button
                icon={<Lock className="size-4" aria-hidden />}
                onClick={() => {
                  setClosing(true);
                }}
              >
                Fechar caixa
              </Button>
            ) : null}
          </>
        }
      />
      <div className="space-y-5">
        <Section title="Resumo">
          <Facts
            items={[
              { label: 'Troco inicial', value: formatMoney(session.openingAmount) },
              { label: 'Vendas recebidas', value: formatMoney(session.salesTotal) },
              { label: 'Suprimentos', value: formatMoney(session.supplies) },
              { label: 'Sangrias', value: formatMoney(session.withdrawals) },
              {
                label: session.status === 'open' ? 'Dinheiro em caixa' : 'Dinheiro esperado',
                value: formatMoney(session.expectedCash),
              },
              ...(session.countedCash !== null && session.difference !== null
                ? [
                    { label: 'Dinheiro contado', value: formatMoney(session.countedCash) },
                    {
                      label: 'Diferença',
                      value: (
                        <span className={session.difference === 0 ? '' : 'text-danger-600'}>
                          {signed(session.difference)}
                          {session.difference < 0
                            ? ' (falta)'
                            : session.difference > 0
                              ? ' (sobra)'
                              : ''}
                        </span>
                      ),
                    },
                  ]
                : []),
            ]}
          />
          {session.closingNotes ? (
            <p className="mt-3 text-sm text-ink-muted">Fechamento: {session.closingNotes}</p>
          ) : null}
        </Section>
        <Section title="Por forma de recebimento">
          {session.byMethod.length === 0 ? (
            <p className="text-sm text-ink-muted">Nenhum recebimento neste caixa.</p>
          ) : (
            <DataTable
              caption="Totais por forma de recebimento"
              rows={session.byMethod}
              rowKey={(m) => `${m.paymentKind}|${m.methodName}`}
              columns={[
                {
                  header: 'Forma',
                  cell: (m) => (
                    <span className="min-w-0">
                      <span className="block font-medium">{m.methodName}</span>
                      <span className="block text-xs text-ink-muted">
                        {paymentKindLabels[m.paymentKind]}
                      </span>
                    </span>
                  ),
                },
                {
                  header: 'Recebido',
                  hideOnMobile: true,
                  className: 'text-right',
                  cell: (m) => (
                    <span className="font-mono tabular-nums">{formatMoney(m.received)}</span>
                  ),
                },
                {
                  header: 'Estornado',
                  hideOnMobile: true,
                  className: 'text-right',
                  cell: (m) => (
                    <span className="font-mono tabular-nums">{formatMoney(m.refunded)}</span>
                  ),
                },
                {
                  header: 'Líquido',
                  className: 'text-right',
                  cell: (m) => (
                    <span className="font-mono font-medium tabular-nums">{formatMoney(m.net)}</span>
                  ),
                },
              ]}
            />
          )}
        </Section>
        <Section title="Movimentos">
          <ul className="-mx-2 divide-y divide-line" aria-label="Movimentos do caixa">
            {session.entries.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-3 px-2 py-2.5">
                <span className="min-w-0">
                  <span className="block text-sm">
                    <span className="font-medium">{cashEntryLabels[e.kind]}</span>
                    {' · '}
                    {e.sale && e.kind === 'receipt' ? (
                      <Link
                        to="/vendas/$saleId"
                        params={{ saleId: e.sale.id }}
                        className="text-sage-700 hover:underline"
                      >
                        {e.description}
                      </Link>
                    ) : (
                      e.description
                    )}
                  </span>
                  <span className="block text-xs text-ink-muted">
                    {[formatDateTime(e.at), e.methodName, e.by].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span
                  className={
                    e.amount < 0
                      ? 'shrink-0 font-mono text-sm text-danger-600 tabular-nums'
                      : 'shrink-0 font-mono text-sm tabular-nums'
                  }
                >
                  {signed(e.amount)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
      {moving ? (
        <MovementDialog
          session={session}
          kind={moving}
          onClose={() => {
            setMoving(null);
          }}
        />
      ) : null}
      {closing ? (
        <CloseDialog
          session={session}
          onClose={() => {
            setClosing(false);
          }}
        />
      ) : null}
    </>
  );
}

function useCashMutation<T>(session: CashSession, path: string, onDone: () => void, ok: string) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (body: T) => api('POST', `/cash/${session.id}/${path}`, cashSessionSchema, body),
    onSuccess: async (saved) => {
      queryClient.setQueryData(cashQuery(saved.id).queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: ['cash'] });
      toast.success(ok);
      onDone();
    },
  });
}

const fieldErrors = (error: unknown): Record<string, string> =>
  error instanceof ApiRequestError
    ? Object.fromEntries(error.fieldErrors.map((f) => [f.path, f.message]))
    : {};

/** Sangria (retirada) ou suprimento (reforço de troco) [RN-29]. */
function MovementDialog({
  session,
  kind,
  onClose,
}: {
  session: CashSession;
  kind: CashMovementKind;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [local, setLocal] = useState<Record<string, string>>({});
  const label = kind === 'supply' ? 'Suprimento' : 'Sangria';
  const save = useCashMutation<{ kind: CashMovementKind; amount: number; description: string }>(
    session,
    'movements',
    onClose,
    `${label} de ${formatMoney(parseDecimal(amount) ?? 0)} lançada no caixa ${String(session.code)}.`,
  );
  const errors = { ...fieldErrors(save.error), ...local };
  const submit = () => {
    const value = parseDecimal(amount);
    const found: Record<string, string> = {};
    if (value === null || Number.isNaN(value) || value <= 0) {
      found.amount = 'Informe um valor maior que zero';
    }
    if (description.trim().length < 3)
      found.description = 'Explique o movimento em poucas palavras';
    setLocal(found);
    if (Object.keys(found).length === 0) save.mutate({ kind, amount: value ?? 0, description });
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={`${label} no caixa ${String(session.code)}`}
      description={
        kind === 'supply'
          ? 'Dinheiro que entra na gaveta, como reforço de troco.'
          : `Dinheiro retirado da gaveta. Há ${formatMoney(session.expectedCash)} em caixa.`
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" form="movement-form" pending={save.isPending}>
            Lançar {label.toLowerCase()}
          </Button>
        </>
      }
    >
      <form
        id="movement-form"
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {save.isError && Object.keys(fieldErrors(save.error)).length === 0 ? (
          <p
            role="alert"
            className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600"
          >
            {errorMessage(save.error)}
          </p>
        ) : null}
        <TextField
          label="Valor (R$)"
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          error={errors.amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setLocal({});
            save.reset();
          }}
        />
        <TextField
          label="Descrição"
          autoComplete="off"
          maxLength={200}
          placeholder={kind === 'supply' ? 'Ex.: troco do cofre' : 'Ex.: depósito no banco'}
          value={description}
          error={errors.description}
          onChange={(e) => {
            setDescription(e.target.value);
            setLocal({});
          }}
        />
      </form>
    </Dialog>
  );
}

/** Fechamento: conta o dinheiro; diferença em relação ao esperado exige explicação. */
function CloseDialog({ session, onClose }: { session: CashSession; onClose: () => void }) {
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [local, setLocal] = useState<Record<string, string>>({});
  const save = useCashMutation<{ countedCash: number; notes: string }>(
    session,
    'close',
    onClose,
    `Caixa ${String(session.code)} fechado.`,
  );
  const errors = { ...fieldErrors(save.error), ...local };
  const value = parseDecimal(counted);
  const difference =
    value === null || Number.isNaN(value)
      ? null
      : fromCents(toCents(value) - toCents(session.expectedCash));
  const submit = () => {
    const found: Record<string, string> = {};
    if (value === null || Number.isNaN(value) || value < 0) {
      found.countedCash = 'Informe o dinheiro contado na gaveta';
    } else if (difference !== 0 && notes.trim().length < 3) {
      found.notes = 'Explique a diferença entre o contado e o esperado';
    }
    setLocal(found);
    if (Object.keys(found).length === 0) save.mutate({ countedCash: value ?? 0, notes });
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={`Fechar caixa ${String(session.code)}`}
      description="Conte o dinheiro da gaveta. Cartão e PIX não entram na contagem."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" form="close-cash-form" pending={save.isPending}>
            Fechar caixa
          </Button>
        </>
      }
    >
      <form
        id="close-cash-form"
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {save.isError && Object.keys(fieldErrors(save.error)).length === 0 ? (
          <p
            role="alert"
            className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600"
          >
            {errorMessage(save.error)}
          </p>
        ) : null}
        <dl className="space-y-1 rounded-control bg-sunken px-3 py-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-muted">Dinheiro esperado</dt>
            <dd className="font-mono tabular-nums">{formatMoney(session.expectedCash)}</dd>
          </div>
          {session.byMethod
            .filter((m) => m.paymentKind !== 'cash')
            .map((m) => (
              <div key={m.methodName} className="flex justify-between gap-3">
                <dt className="text-ink-muted">{m.methodName}</dt>
                <dd className="font-mono tabular-nums">{formatMoney(m.net)}</dd>
              </div>
            ))}
        </dl>
        <TextField
          label="Dinheiro contado (R$)"
          inputMode="decimal"
          autoComplete="off"
          value={counted}
          error={errors.countedCash}
          hint={
            difference === null
              ? undefined
              : difference === 0
                ? 'Confere com o esperado.'
                : `${difference < 0 ? 'Falta' : 'Sobra'} de ${formatMoney(Math.abs(difference))}.`
          }
          onChange={(e) => {
            setCounted(e.target.value);
            setLocal({});
          }}
        />
        <TextareaField
          label="Observação"
          rows={3}
          maxLength={300}
          value={notes}
          error={errors.notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setLocal({});
          }}
        />
      </form>
    </Dialog>
  );
}
