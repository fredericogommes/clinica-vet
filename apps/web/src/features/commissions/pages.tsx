import {
  commissionBaseLabels,
  commissionCriterionLabels,
  commissionLineKindLabels,
  commissionStatementCloseSchema,
  commissionStatementReviewSchema,
  commissionStatementSchema,
  commissionStatementStatusLabels,
  type CommissionOpen,
  type CommissionStatement,
  type CommissionStatementList,
  type CommissionStatementStatus,
} from '@clinica/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { BadgePercent, FileText } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '../../design-system/button';
import { Dialog } from '../../design-system/dialog';
import { Segmented, TextareaField, TextField } from '../../design-system/field';
import { Badge, Facts, PageHeader, Panel, Stats } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { DataTable, Pagination } from '../../design-system/table';
import { useToast } from '../../design-system/toast';
import { api, ApiRequestError, apiVoid, errorMessage } from '../../lib/api';
import { formatCalendarDate, formatDateTime } from '../../lib/format';
import { useCan } from '../../lib/session';
import { formatMoney } from '../products/format';
import {
  commissionOpenQuery,
  commissionStatementQuery,
  commissionStatementsQuery,
  myCommissionsQuery,
  type CommissionStatementSearch,
} from './queries';

const statusTone: Record<CommissionStatementStatus, 'amber' | 'sage' | 'neutral' | 'danger'> = {
  open: 'amber',
  review: 'danger',
  closed: 'sage',
  paid: 'neutral',
  archived: 'neutral',
};

function StatusBadge({ status }: { status: CommissionStatementStatus }) {
  return <Badge tone={statusTone[status]}>{commissionStatementStatusLabels[status]}</Badge>;
}

const linkClass = 'font-medium text-ink hover:text-sage-700 hover:underline';

function Money({ value }: { value: number }) {
  return <span className="font-mono whitespace-nowrap tabular-nums">{formatMoney(value)}</span>;
}

function GeneralError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600">
      {message}
    </p>
  ) : null;
}

function useRefreshCommissions() {
  const queryClient = useQueryClient();
  return async (saved?: CommissionStatement) => {
    if (saved) queryClient.setQueryData(commissionStatementQuery(saved.id).queryKey, saved);
    await queryClient.invalidateQueries({ queryKey: ['commissions'] });
    await queryClient.invalidateQueries({ queryKey: ['finance'] });
  };
}

// Comissões em aberto -------------------------------------------------------------------------------

/** Comissões em aberto [p.10]: o que cada profissional acumulou até a data de corte. */
export function CommissionsOpenPage({ ate }: { ate: string | undefined }) {
  const can = useCan();
  const navigate = useNavigate({ from: '/comissoes' });
  const open = useQuery(commissionOpenQuery(ate));
  return (
    <>
      <PageHeader
        area="Comissionamento"
        title="Comissões em aberto"
        description="O que cada profissional tem a receber e ainda não entrou num extrato. Gere o extrato para conferir, fechar e mandar a contas a pagar."
      />
      {open.isPending ? (
        <SkeletonRows rows={5} columns={4} />
      ) : open.isError ? (
        <ErrorState message={errorMessage(open.error)} onRetry={() => void open.refetch()} />
      ) : (
        <>
          <Panel className="mb-5 flex flex-col gap-4 p-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="w-full sm:w-56">
              <TextField
                label="Vendas até"
                type="date"
                value={open.data.cutoff}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value) void navigate({ search: { ate: value }, replace: true });
                }}
              />
            </div>
            <p className="text-sm text-ink-muted sm:max-w-md sm:text-right">
              Base: {commissionBaseLabels[open.data.base].toLowerCase()}.{' '}
              {commissionCriterionLabels[open.data.criterion]}.{' '}
              {can('commissions.configure') ? (
                <Link to="/comissoes/configuracao" className="text-sage-700 hover:underline">
                  Mudar regras
                </Link>
              ) : null}
            </p>
          </Panel>
          <div className="mb-5">
            <Stats
              label="Resumo das comissões"
              items={[
                { label: 'Total em aberto', value: formatMoney(open.data.total) },
                {
                  label: 'Profissionais com valor',
                  value: open.data.rows.filter((r) => r.amount !== 0).length,
                },
              ]}
            />
          </div>
          <Panel>
            {open.data.rows.length === 0 ? (
              <EmptyState
                icon={BadgePercent}
                title="Ninguém na equipe desta unidade"
                description="Cadastre os profissionais em Usuários e ligue a comissão na configuração."
              />
            ) : (
              <div aria-busy={open.isFetching || undefined}>
                <OpenTable data={open.data} canManage={can('commissions.manage')} />
              </div>
            )}
          </Panel>
        </>
      )}
    </>
  );
}

function OpenTable({ data, canManage }: { data: CommissionOpen; canManage: boolean }) {
  type Row = CommissionOpen['rows'][number];
  const navigate = useNavigate();
  const toast = useToast();
  const refresh = useRefreshCommissions();
  // Quem não recebe comissão aparece com traço, mas só quando pedido: a equipe toda é longa.
  const [showAll, setShowAll] = useState(false);
  const hidden = data.rows.filter((r) => !r.commissioned).length;
  const rows = showAll ? data.rows : data.rows.filter((r) => r.commissioned);
  const generate = useMutation({
    mutationFn: (userId: string) =>
      api('POST', '/commissions/statements', commissionStatementSchema, {
        userId,
        cutoff: data.cutoff,
      }),
    onSuccess: async (saved) => {
      await refresh(saved);
      toast.success(`Extrato ${String(saved.code)} gerado. Confira e feche.`);
      void navigate({
        to: '/comissoes/extratos/$statementId',
        params: { statementId: saved.id },
      });
    },
    onError: (e) => {
      toast.error(errorMessage(e));
    },
  });
  return (
    <>
      {rows.length === 0 ? (
        <p className="p-5 text-sm text-ink-muted">
          Ninguém recebe comissão ainda. Escolha quem recebe na configuração de comissões.
        </p>
      ) : (
        <DataTable
          caption="Comissões em aberto por profissional"
          rows={rows}
          rowKey={(r) => r.user.id}
          columns={[
            {
              header: 'Profissional',
              cell: (r: Row) => (
                <div className="min-w-0">
                  <p className="font-medium text-ink">{r.user.name}</p>
                  <p className="text-xs text-ink-muted">
                    {r.commissioned
                      ? `${String(r.sales)} ${r.sales === 1 ? 'venda' : 'vendas'} · base ${formatMoney(r.baseAmount)}`
                      : 'Não recebe comissão'}
                  </p>
                </div>
              ),
            },
            {
              header: 'Comissão',
              cell: (r: Row) =>
                r.commissioned ? (
                  <Money value={r.amount} />
                ) : (
                  <span className="text-ink-muted" aria-label="Sem comissão">
                    —
                  </span>
                ),
              className: 'text-right',
            },
            {
              header: 'Extrato',
              cell: (r: Row) =>
                r.statement ? (
                  <Link
                    to="/comissoes/extratos/$statementId"
                    params={{ statementId: r.statement.id }}
                    className={linkClass}
                  >
                    Extrato {r.statement.code}{' '}
                    <span className="text-xs font-normal text-ink-muted">
                      ({commissionStatementStatusLabels[r.statement.status].toLowerCase()})
                    </span>
                  </Link>
                ) : canManage && r.commissioned && r.amount !== 0 ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    pending={generate.isPending && generate.variables === r.user.id}
                    onClick={() => {
                      generate.mutate(r.user.id);
                    }}
                    aria-label={`Gerar extrato de ${r.user.name}`}
                  >
                    Gerar extrato
                  </Button>
                ) : null,
              className: 'text-right',
            },
          ]}
        />
      )}
      {hidden > 0 ? (
        <div className="border-t border-line px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowAll(!showAll);
            }}
          >
            {showAll
              ? 'Esconder quem não recebe comissão'
              : `Mostrar quem não recebe comissão (${String(hidden)})`}
          </Button>
        </div>
      ) : null}
    </>
  );
}

// Extratos ------------------------------------------------------------------------------------------

export function CommissionStatementsPage({ search }: { search: CommissionStatementSearch }) {
  const navigate = useNavigate({ from: '/comissoes/extratos' });
  const list = useQuery(commissionStatementsQuery(search));
  return (
    <>
      <PageHeader
        area="Comissionamento"
        title="Extratos de comissão"
        description="Não fechado, fechado, pago, em revisão ou arquivado. Fechado, o extrato vira uma conta a pagar."
      />
      <Panel className="mb-5 p-4">
        <Segmented
          label="Situação"
          value={search.situacao}
          options={[
            { value: 'abertos', label: 'Não fechados' },
            { value: 'fechados', label: 'Fechados' },
            { value: 'pagos', label: 'Pagos' },
            { value: 'arquivados', label: 'Arquivados' },
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
              icon={FileText}
              title="Nenhum extrato nesta situação"
              description="Os extratos nascem em Comissões em aberto, um por profissional."
            />
          ) : (
            <div aria-busy={list.isFetching || undefined}>
              <StatementsTable items={list.data.items} />
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

function StatementsTable({
  items,
  showUser = true,
}: {
  items: CommissionStatementList['items'];
  showUser?: boolean;
}) {
  type Row = CommissionStatementList['items'][number];
  return (
    <DataTable
      caption="Extratos de comissão"
      rows={items}
      rowKey={(s) => s.id}
      columns={[
        {
          header: 'Extrato',
          cell: (s: Row) => (
            <Link
              to="/comissoes/extratos/$statementId"
              params={{ statementId: s.id }}
              className={linkClass}
            >
              {s.code}
            </Link>
          ),
        },
        {
          header: showUser ? 'Profissional' : 'Situação',
          cell: (s: Row) => (
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2">
                {showUser ? (
                  <span className="max-w-48 truncate sm:max-w-72">{s.user.name}</span>
                ) : null}
                <StatusBadge status={s.status} />
              </p>
              <p className="text-xs text-ink-muted">
                Vendas até {formatCalendarDate(s.cutoff)} · {s.lines}{' '}
                {s.lines === 1 ? 'venda' : 'vendas'}
                {s.paidOn
                  ? ` · pago em ${formatCalendarDate(s.paidOn)}`
                  : s.dueDate
                    ? ` · vence ${formatCalendarDate(s.dueDate)}`
                    : ''}
              </p>
            </div>
          ),
        },
        {
          header: 'Total',
          cell: (s: Row) => <Money value={s.total} />,
          className: 'text-right',
        },
      ]}
    />
  );
}

type DialogKind = 'refresh' | 'close' | 'discard' | 'review' | 'pay';

export function CommissionStatementPage({ statementId }: { statementId: string }) {
  const statement = useQuery(commissionStatementQuery(statementId));
  if (statement.isPending) return <SkeletonRows />;
  if (statement.isError) {
    return (
      <ErrorState
        message={errorMessage(statement.error)}
        onRetry={() => void statement.refetch()}
      />
    );
  }
  return <StatementView statement={statement.data} />;
}

function StatementView({ statement }: { statement: CommissionStatement }) {
  const can = useCan();
  const toast = useToast();
  const refresh = useRefreshCommissions();
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const manage = can('commissions.manage');
  const action = useMutation({
    mutationFn: (path: 'archive' | 'unpay') =>
      api('POST', `/commissions/statements/${statement.id}/${path}`, commissionStatementSchema),
    onSuccess: async (saved, path) => {
      await refresh(saved);
      toast.success(path === 'archive' ? 'Extrato arquivado.' : 'Pagamento desfeito.');
    },
    onError: (e) => {
      toast.error(errorMessage(e));
    },
  });
  const s = statement;
  const editable = s.status === 'open' || s.status === 'review';
  const actions: ReactNode[] = [];
  if (manage && editable) {
    actions.push(
      <Button
        key="close"
        onClick={() => {
          setDialog('close');
        }}
      >
        Fechar extrato
      </Button>,
      <Button
        key="refresh"
        variant="secondary"
        onClick={() => {
          setDialog('refresh');
        }}
      >
        Atualizar
      </Button>,
      <Button
        key="discard"
        variant="ghost"
        onClick={() => {
          setDialog('discard');
        }}
      >
        Descartar
      </Button>,
    );
  }
  if (manage && s.status === 'closed') {
    if (!s.entry) {
      actions.push(
        <Button
          key="pay"
          onClick={() => {
            setDialog('pay');
          }}
        >
          Marcar como pago
        </Button>,
      );
    }
    actions.push(
      <Button
        key="review"
        variant="secondary"
        onClick={() => {
          setDialog('review');
        }}
      >
        Pôr em revisão
      </Button>,
    );
  }
  if (manage && s.status === 'paid') {
    actions.push(
      <Button
        key="archive"
        variant="secondary"
        pending={action.isPending && action.variables === 'archive'}
        onClick={() => {
          action.mutate('archive');
        }}
      >
        Arquivar
      </Button>,
    );
    if (!s.entry) {
      actions.push(
        <Button
          key="unpay"
          variant="ghost"
          pending={action.isPending && action.variables === 'unpay'}
          onClick={() => {
            action.mutate('unpay');
          }}
        >
          Desfazer pagamento
        </Button>,
      );
    }
  }

  return (
    <>
      <PageHeader
        area="Comissionamento"
        title={`Extrato ${String(s.code)} · ${s.user.name}`}
        description={`Vendas até ${formatCalendarDate(s.cutoff)}.`}
        actions={actions.length ? actions : undefined}
      />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <StatusBadge status={s.status} />
        <Link
          to={can('commissions.view') ? '/comissoes/extratos' : '/comissoes/minhas'}
          className="text-sm text-sage-700 hover:underline"
        >
          {can('commissions.view') ? 'Todos os extratos' : 'Minhas comissões'}
        </Link>
      </div>
      {s.status === 'review' && s.reviewReason ? (
        <p className="mb-5 rounded-control bg-amber-50 px-3 py-2 text-sm text-ink">
          Em revisão: {s.reviewReason}. Atualize se precisar e feche de novo.
        </p>
      ) : null}
      {s.status === 'closed' && s.entry ? (
        <p className="mb-5 rounded-control bg-sage-50 px-3 py-2 text-sm text-ink">
          Está em contas a pagar com vencimento em {formatCalendarDate(s.entry.dueDate)}. O
          pagamento é registrado lá e o extrato passa a pago sozinho.{' '}
          {can('finance.view') ? (
            <Link to="/financeiro/contas-a-pagar" className="text-sage-700 hover:underline">
              Abrir contas a pagar
            </Link>
          ) : null}
        </p>
      ) : null}
      <Panel className="mb-5 p-5">
        <Facts
          items={[
            { label: 'Total', value: <Money value={s.total} /> },
            { label: 'Vendas até', value: formatCalendarDate(s.cutoff) },
            ...(s.dueDate ? [{ label: 'Vencimento', value: formatCalendarDate(s.dueDate) }] : []),
            ...(s.paidOn ? [{ label: 'Pago em', value: formatCalendarDate(s.paidOn) }] : []),
            { label: 'Geração', value: `${formatDateTime(s.createdAt)} por ${s.createdBy}` },
            ...(s.closedAt && s.closedBy
              ? [{ label: 'Fechamento', value: `${formatDateTime(s.closedAt)} por ${s.closedBy}` }]
              : []),
            ...(s.notes ? [{ label: 'Observações', value: s.notes }] : []),
          ]}
        />
      </Panel>
      <h2 className="mb-2 font-display text-[15px] font-semibold text-ink">Vendas do extrato</h2>
      <Panel>
        {s.lines.length === 0 ? (
          <p className="p-5 text-sm text-ink-muted">
            Nenhuma venda a comissionar até esta data. Atualize com outra data ou descarte o
            extrato.
          </p>
        ) : (
          <LinesTable statement={s} />
        )}
      </Panel>
      {dialog === 'refresh' ? (
        <RefreshDialog
          statement={s}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : dialog === 'close' ? (
        <CloseDialog
          statement={s}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : dialog === 'discard' ? (
        <DiscardDialog
          statement={s}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : dialog === 'review' ? (
        <ReviewDialog
          statement={s}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : dialog === 'pay' ? (
        <PayDialog
          statement={s}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : null}
    </>
  );
}

function LinesTable({ statement }: { statement: CommissionStatement }) {
  type Row = CommissionStatement['lines'][number];
  const can = useCan();
  return (
    <DataTable
      caption="Vendas do extrato"
      rows={statement.lines}
      rowKey={(l) => l.id}
      columns={[
        {
          header: 'Venda',
          cell: (l: Row) => (
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2">
                {can('sales.view') ? (
                  <Link to="/vendas/$saleId" params={{ saleId: l.sale.id }} className={linkClass}>
                    Venda {l.sale.code}
                  </Link>
                ) : (
                  <span className="font-medium">Venda {l.sale.code}</span>
                )}
                {l.kind !== 'sale' ? (
                  <Badge tone={l.kind === 'reversal' ? 'danger' : 'amber'}>
                    {commissionLineKindLabels[l.kind]}
                  </Badge>
                ) : null}
              </p>
              <p className="text-xs text-ink-muted">
                {formatCalendarDate(l.sale.soldAt)} · {l.sale.client ?? 'Ao consumidor'}
              </p>
              <p className="mt-0.5 max-w-xl text-xs break-words text-ink-muted">{l.description}</p>
            </div>
          ),
        },
        {
          header: 'Base',
          cell: (l: Row) => <Money value={l.baseAmount} />,
          className: 'text-right',
          hideOnMobile: true,
        },
        {
          header: 'Comissão',
          cell: (l: Row) => <Money value={l.amount} />,
          className: 'text-right',
        },
      ]}
    />
  );
}

function ActionDialog({
  title,
  description,
  confirm,
  danger,
  pending,
  error,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  description: string;
  confirm: string;
  danger?: boolean;
  pending: boolean;
  error: unknown;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const general =
    error && !(error instanceof ApiRequestError && error.fieldErrors.length > 0)
      ? errorMessage(error)
      : null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} pending={pending} onClick={onConfirm}>
            {confirm}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <GeneralError message={general} />
        {children}
      </div>
    </Dialog>
  );
}

const fieldError = (error: unknown, path: string) =>
  error instanceof ApiRequestError
    ? error.fieldErrors.find((f) => f.path === path)?.message
    : undefined;

function useStatementMutation<T>(
  statement: CommissionStatement,
  path: string,
  done: string,
  onClose: () => void,
) {
  const toast = useToast();
  const refresh = useRefreshCommissions();
  return useMutation({
    mutationFn: (body: T) =>
      api(
        'POST',
        `/commissions/statements/${statement.id}/${path}`,
        commissionStatementSchema,
        body,
      ),
    onSuccess: async (saved) => {
      await refresh(saved);
      toast.success(done);
      onClose();
    },
  });
}

function RefreshDialog({
  statement,
  onClose,
}: {
  statement: CommissionStatement;
  onClose: () => void;
}) {
  const [cutoff, setCutoff] = useState(statement.cutoff);
  const save = useStatementMutation<{ cutoff: string }>(
    statement,
    'refresh',
    'Extrato atualizado.',
    onClose,
  );
  return (
    <ActionDialog
      title={`Atualizar extrato ${String(statement.code)}`}
      description="Recalcula as vendas do extrato até a data escolhida, com as edições e estornos feitos desde a geração."
      confirm="Atualizar"
      pending={save.isPending}
      error={save.error}
      onConfirm={() => {
        save.mutate({ cutoff });
      }}
      onClose={onClose}
    >
      <TextField
        label="Vendas até"
        type="date"
        value={cutoff}
        error={fieldError(save.error, 'cutoff')}
        onChange={(e) => {
          setCutoff(e.target.value);
        }}
      />
    </ActionDialog>
  );
}

function CloseDialog({
  statement,
  onClose,
}: {
  statement: CommissionStatement;
  onClose: () => void;
}) {
  const [dueDate, setDueDate] = useState(statement.cutoff);
  const [notes, setNotes] = useState(statement.notes);
  const [error, setError] = useState<string | undefined>();
  const save = useStatementMutation<{ dueDate: string; notes: string }>(
    statement,
    'close',
    statement.financeIntegration
      ? 'Extrato fechado e lançado em contas a pagar.'
      : 'Extrato fechado.',
    onClose,
  );
  return (
    <ActionDialog
      title={`Fechar extrato ${String(statement.code)}`}
      description={
        statement.financeIntegration
          ? `O total de ${formatMoney(statement.total)} vira uma despesa em contas a pagar, na categoria Comissões.`
          : `O total de ${formatMoney(statement.total)} fica fechado; o pagamento é marcado aqui no extrato.`
      }
      confirm="Fechar extrato"
      pending={save.isPending}
      error={save.error}
      onConfirm={() => {
        const parsed = commissionStatementCloseSchema.safeParse({ dueDate, notes });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message);
          return;
        }
        save.mutate(parsed.data);
      }}
      onClose={onClose}
    >
      <TextField
        label="Vencimento"
        type="date"
        value={dueDate}
        error={error ?? fieldError(save.error, 'dueDate')}
        onChange={(e) => {
          setDueDate(e.target.value);
          setError(undefined);
        }}
      />
      <TextareaField
        label="Observações"
        value={notes}
        rows={2}
        onChange={(e) => {
          setNotes(e.target.value);
        }}
      />
    </ActionDialog>
  );
}

function ReviewDialog({
  statement,
  onClose,
}: {
  statement: CommissionStatement;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const save = useStatementMutation<{ reason: string }>(
    statement,
    'review',
    'Extrato em revisão.',
    onClose,
  );
  return (
    <ActionDialog
      title={`Revisar extrato ${String(statement.code)}`}
      description={
        statement.entry
          ? 'A despesa em contas a pagar é cancelada; ao fechar de novo, outra é lançada com o valor revisto.'
          : 'O extrato volta a ser editável até ser fechado de novo.'
      }
      confirm="Pôr em revisão"
      pending={save.isPending}
      error={save.error}
      onConfirm={() => {
        const parsed = commissionStatementReviewSchema.safeParse({ reason });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message);
          return;
        }
        save.mutate(parsed.data);
      }}
      onClose={onClose}
    >
      <TextField
        label="Motivo"
        value={reason}
        error={error}
        onChange={(e) => {
          setReason(e.target.value);
          setError(undefined);
        }}
      />
    </ActionDialog>
  );
}

function PayDialog({
  statement,
  onClose,
}: {
  statement: CommissionStatement;
  onClose: () => void;
}) {
  const [paidOn, setPaidOn] = useState(statement.dueDate ?? statement.cutoff);
  const save = useStatementMutation<{ paidOn: string }>(
    statement,
    'pay',
    'Extrato marcado como pago.',
    onClose,
  );
  return (
    <ActionDialog
      title={`Pagar extrato ${String(statement.code)}`}
      description={`Registra o pagamento de ${formatMoney(statement.total)} a ${statement.user.name}.`}
      confirm="Marcar como pago"
      pending={save.isPending}
      error={save.error}
      onConfirm={() => {
        save.mutate({ paidOn });
      }}
      onClose={onClose}
    >
      <TextField
        label="Data do pagamento"
        type="date"
        value={paidOn}
        error={fieldError(save.error, 'paidOn')}
        onChange={(e) => {
          setPaidOn(e.target.value);
        }}
      />
    </ActionDialog>
  );
}

function DiscardDialog({
  statement,
  onClose,
}: {
  statement: CommissionStatement;
  onClose: () => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const discard = useMutation({
    mutationFn: () => apiVoid('DELETE', `/commissions/statements/${statement.id}`),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: commissionStatementQuery(statement.id).queryKey });
      await queryClient.invalidateQueries({ queryKey: ['commissions'] });
      toast.success('Extrato descartado. As vendas voltaram para as comissões em aberto.');
      void navigate({ to: '/comissoes' });
    },
  });
  return (
    <ActionDialog
      title={`Descartar extrato ${String(statement.code)}`}
      description="As vendas do extrato voltam para as comissões em aberto e podem entrar num extrato novo."
      confirm="Descartar"
      danger
      pending={discard.isPending}
      error={discard.error}
      onConfirm={() => {
        discard.mutate();
      }}
      onClose={onClose}
    />
  );
}

// Minhas comissões ----------------------------------------------------------------------------------

export function MyCommissionsPage() {
  const mine = useQuery({ ...myCommissionsQuery, retry: false });
  const header = (
    <PageHeader
      area="Comissionamento"
      title="Minhas comissões"
      description="O que você tem a receber e os seus extratos nesta unidade."
    />
  );
  if (mine.isPending) {
    return (
      <>
        {header}
        <SkeletonRows />
      </>
    );
  }
  if (mine.isError) {
    const hidden = mine.error instanceof ApiRequestError && mine.error.status === 403;
    return (
      <>
        {header}
        {hidden ? (
          <Panel>
            <EmptyState
              icon={BadgePercent}
              title="Comissões não visíveis"
              description={errorMessage(mine.error)}
            />
          </Panel>
        ) : (
          <ErrorState message={errorMessage(mine.error)} onRetry={() => void mine.refetch()} />
        )}
      </>
    );
  }
  const m = mine.data;
  return (
    <>
      {header}
      {m.commissioned ? (
        <div className="mb-5">
          <Stats
            label="Minhas comissões em aberto"
            items={[
              {
                label: `Em aberto até ${formatCalendarDate(m.cutoff)}`,
                value: formatMoney(m.open.amount),
                detail: `${String(m.open.sales)} ${m.open.sales === 1 ? 'venda' : 'vendas'}`,
              },
            ]}
          />
          <p className="mt-2 text-xs text-ink-muted">
            Comissionado desde {formatCalendarDate(m.since ?? m.cutoff)}.{' '}
            {commissionCriterionLabels[m.criterion]}.
          </p>
        </div>
      ) : (
        <p className="mb-5 rounded-control bg-canvas px-3 py-2 text-sm text-ink-muted">
          Você não está entre os comissionados da clínica.
        </p>
      )}
      <h2 className="mb-2 font-display text-[15px] font-semibold text-ink">Meus extratos</h2>
      <Panel>
        {m.statements.length === 0 ? (
          <p className="p-5 text-sm text-ink-muted">Nenhum extrato ainda.</p>
        ) : (
          <StatementsTable items={m.statements} showUser={false} />
        )}
      </Panel>
    </>
  );
}
