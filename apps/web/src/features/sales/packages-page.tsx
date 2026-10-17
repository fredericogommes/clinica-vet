import {
  clientPackageDetailSchema,
  clientPackageStatuses,
  clientPackageStatusLabels,
  packageListSchema,
  type ClientPackage,
  type ClientPackageDetail,
  type ClientPackageStatus,
  type PackageUsage,
} from '@clinica/contracts';
import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Layers, Search, Undo2, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '../../design-system/button';
import { Dialog } from '../../design-system/dialog';
import { SearchField, SelectField, TextareaField, TextField } from '../../design-system/field';
import { Badge, PageHeader, Panel } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { DataTable, Pagination } from '../../design-system/table';
import { useToast } from '../../design-system/toast';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { formatCalendarDate, formatDateTime } from '../../lib/format';
import { useCan } from '../../lib/session';
import { useDebounced } from '../../lib/use-debounced';
import { localToday } from '../schedule/dates';

export interface PackageSearch {
  q: string;
  status: ClientPackageStatus | undefined;
  clientId: string | undefined;
  page: number;
}

/** Mudança nos filtros da URL; `undefined` volta ao padrão. */
interface PackagePatch {
  q?: string | undefined;
  situacao?: ClientPackageStatus | undefined;
  cliente?: string | undefined;
  page?: number | undefined;
}

const packagesQuery = (s: PackageSearch) =>
  queryOptions({
    queryKey: ['sales', 'packages', 'list', s],
    queryFn: () => {
      const qs = new URLSearchParams({ page: String(s.page), pageSize: '25' });
      if (s.q) qs.set('q', s.q);
      if (s.status) qs.set('status', s.status);
      if (s.clientId) qs.set('clientId', s.clientId);
      return api('GET', `/sales/packages?${qs.toString()}`, packageListSchema);
    },
    placeholderData: keepPreviousData,
  });

const packageQuery = (id: string) =>
  queryOptions({
    queryKey: ['sales', 'packages', 'detail', id],
    queryFn: () => api('GET', `/sales/packages/${id}`, clientPackageDetailSchema),
  });

const statusTone = {
  active: 'sage',
  finished: 'neutral',
  expired: 'amber',
  cancelled: 'danger',
} as const;

function StatusTag({ status }: { status: ClientPackageStatus }) {
  return <Badge tone={statusTone[status]}>{clientPackageStatusLabels[status]}</Badge>;
}

/** "2 de 10" com uma barra de progresso das sessões usadas. */
function Sessions({ pkg }: { pkg: ClientPackage }) {
  const share = Math.min(100, Math.round((pkg.used / pkg.sessions) * 100));
  return (
    <span className="block w-16 sm:w-24">
      <span className="font-mono text-sm tabular-nums">
        {pkg.used} de {pkg.sessions}
      </span>
      <span
        className="mt-1 block h-1.5 rounded-full bg-sunken"
        role="progressbar"
        aria-label={`Sessões usadas de ${pkg.name}`}
        aria-valuemin={0}
        aria-valuemax={pkg.sessions}
        aria-valuenow={pkg.used}
      >
        <span
          className="block h-full rounded-full bg-sage-600"
          style={{ width: `${String(share)}%` }}
        />
      </span>
    </span>
  );
}

const validity = (pkg: ClientPackage) =>
  pkg.validUntil ? `Vale até ${formatCalendarDate(pkg.validUntil)}` : 'Sem validade';

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

/** Pacotes vendidos [p.10]: o que cada cliente comprou em sessões e quanto já usou. */
export function PackagesPage({ search }: { search: PackageSearch }) {
  const navigate = useNavigate({ from: '/vendas/pacotes' });
  const can = useCan();
  const [term, setTerm] = useState(search.q);
  const debounced = useDebounced(term.trim());
  const change = (patch: PackagePatch) => {
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
  const list = useQuery(packagesQuery(search));
  const [openId, setOpenId] = useState<string | null>(null);
  const filteredClient = search.clientId
    ? list.data?.items.find((p) => p.client.id === search.clientId)?.client
    : undefined;
  const filtered = Boolean(search.q || search.status || search.clientId);

  return (
    <>
      <PageHeader
        area="Vendas"
        title="Pacotes vendidos"
        description="Pacotes de sessões (como 10 banhos) abertos pelas vendas baixadas de todas as unidades. Registre aqui cada sessão usada."
      />
      <Panel>
        <div className="space-y-3 border-b border-line p-4">
          <SearchField
            label="Buscar pacotes"
            placeholder="Cliente, animal, pacote ou código"
            icon={<Search className="size-4" aria-hidden />}
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
            }}
          />
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Situação">
            {[undefined, ...clientPackageStatuses].map((status) => (
              <Button
                key={status ?? 'all'}
                size="sm"
                variant={search.status === status ? 'secondary' : 'ghost'}
                aria-pressed={search.status === status}
                onClick={() => {
                  change({ situacao: status, page: undefined });
                }}
              >
                {status ? clientPackageStatusLabels[status] : 'Todos'}
              </Button>
            ))}
            {search.clientId ? (
              <Button
                size="sm"
                variant="secondary"
                icon={<X className="size-4" aria-hidden />}
                onClick={() => {
                  change({ cliente: undefined, page: undefined });
                }}
              >
                {filteredClient ? `Cliente: ${filteredClient.name}` : 'Um cliente'} · ver todos
              </Button>
            ) : null}
          </div>
        </div>
        <Loading query={list}>
          {(page) =>
            page.items.length === 0 ? (
              <EmptyState
                icon={Layers}
                title={filtered ? 'Nenhum pacote encontrado' : 'Nenhum pacote vendido'}
                description={
                  filtered
                    ? 'Ajuste a busca ou a situação.'
                    : 'Cadastre um serviço classificado como Pacote e venda-o no PDV; ao baixar a venda, o pacote do cliente aparece aqui.'
                }
              />
            ) : (
              <>
                <DataTable
                  caption="Pacotes vendidos"
                  rows={page.items}
                  rowKey={(p) => p.id}
                  columns={[
                    {
                      header: 'Cliente',
                      cell: (p) => (
                        <span className="block min-w-0">
                          {can('clients.view') ? (
                            <Link
                              to="/clientes/$clientId"
                              params={{ clientId: p.client.id }}
                              className="block font-medium hover:underline"
                            >
                              {p.client.name}
                            </Link>
                          ) : (
                            <span className="block font-medium">{p.client.name}</span>
                          )}
                          <span className="block text-xs text-ink-muted">
                            {[p.patient?.name, p.name].filter(Boolean).join(' · ')}
                          </span>
                          <span className="block text-xs text-ink-muted md:hidden">
                            {validity(p)}
                          </span>
                        </span>
                      ),
                    },
                    {
                      header: 'Venda',
                      hideOnMobile: true,
                      cell: (p) => (
                        <span className="block">
                          <Link
                            to="/vendas/$saleId"
                            params={{ saleId: p.sale.id }}
                            className="font-mono hover:underline"
                          >
                            {p.sale.code}
                          </Link>
                          <span className="block text-xs text-ink-muted">{validity(p)}</span>
                        </span>
                      ),
                    },
                    { header: 'Sessões', cell: (p) => <Sessions pkg={p} /> },
                    {
                      header: 'Situação',
                      hideOnMobile: true,
                      cell: (p) => <StatusTag status={p.status} />,
                    },
                    {
                      header: 'Ação',
                      className: 'text-right',
                      cell: (p) => (
                        <Button
                          size="sm"
                          variant={p.status === 'active' ? 'secondary' : 'ghost'}
                          aria-label={`${p.status === 'active' ? 'Usar sessão' : 'Ver sessões'} de ${p.name}, ${p.client.name}`}
                          onClick={() => {
                            setOpenId(p.id);
                          }}
                        >
                          {p.status === 'active' ? 'Usar sessão' : 'Ver'}
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
            )
          }
        </Loading>
      </Panel>
      {openId ? (
        <PackageDialog
          id={openId}
          onClose={() => {
            setOpenId(null);
          }}
        />
      ) : null}
    </>
  );
}

/** Sessões do pacote: o histórico, desfazer com motivo e registrar a próxima. */
function PackageDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const detail = useQuery(packageQuery(id));
  const [undoing, setUndoing] = useState<PackageUsage | null>(null);
  const title = detail.data ? `${detail.data.name}, ${detail.data.client.name}` : 'Pacote';
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      {...(detail.data
        ? {
            description: `${[detail.data.patient?.name, `venda ${String(detail.data.sale.code)}`, validity(detail.data)].filter(Boolean).join(' · ')}. ${String(detail.data.remaining)} de ${String(detail.data.sessions)} sessões restantes.`,
          }
        : {})}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Fechar
        </Button>
      }
    >
      <Loading query={detail}>
        {(pkg) => (
          <div className="space-y-5">
            {pkg.status === 'active' ? (
              <UseSessionForm pkg={pkg} />
            ) : (
              <p role="note" className="rounded-control bg-sunken px-3 py-2 text-sm text-ink-muted">
                {pkg.status === 'finished'
                  ? 'Todas as sessões foram usadas.'
                  : pkg.status === 'expired'
                    ? `O pacote venceu em ${formatCalendarDate(pkg.validUntil ?? '')}.`
                    : 'Pacote cancelado pelo estorno da venda.'}
              </p>
            )}
            <section aria-labelledby="usages-title">
              <h3 id="usages-title" className="mb-2 font-display text-[15px] font-semibold">
                Sessões registradas
              </h3>
              {pkg.usages.length === 0 ? (
                <p className="text-sm text-ink-muted">Nenhuma sessão usada ainda.</p>
              ) : (
                <ol className="divide-y divide-line" aria-label="Sessões do pacote">
                  {pkg.usages.map((u) => (
                    <li key={u.id} className="flex items-start justify-between gap-3 py-2.5">
                      <span className="min-w-0 text-sm">
                        <span className={u.undone ? 'text-ink-muted line-through' : 'font-medium'}>
                          {formatCalendarDate(u.usedOn)}
                          {u.patient ? ` · ${u.patient.name}` : ''} · {u.professional.name}
                        </span>
                        {u.notes ? (
                          <span className="block text-xs text-ink-muted">{u.notes}</span>
                        ) : null}
                        <span className="block text-xs text-ink-muted">
                          {u.undone
                            ? `Desfeita em ${formatDateTime(u.undone.at)} por ${u.undone.by}: ${u.undone.reason}`
                            : `Registrada por ${u.createdBy} em ${formatDateTime(u.createdAt)}`}
                        </span>
                      </span>
                      {!u.undone && pkg.status !== 'cancelled' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Undo2 className="size-4" aria-hidden />}
                          aria-label={`Desfazer sessão de ${formatCalendarDate(u.usedOn)}`}
                          onClick={() => {
                            setUndoing(u);
                          }}
                        >
                          Desfazer
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </section>
            {undoing ? (
              <UndoForm
                pkg={pkg}
                usage={undoing}
                onDone={() => {
                  setUndoing(null);
                }}
              />
            ) : null}
          </div>
        )}
      </Loading>
    </Dialog>
  );
}

function usePackageMutation<T>(
  pkg: ClientPackageDetail,
  path: string,
  onSaved: (saved: ClientPackageDetail) => void,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: T) => api('POST', path, clientPackageDetailSchema, body),
    onSuccess: async (saved) => {
      queryClient.setQueryData(packageQuery(pkg.id).queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: ['sales', 'packages', 'list'] });
      onSaved(saved);
    },
  });
}

const fieldErrorsOf = (error: unknown): Record<string, string> =>
  error instanceof ApiRequestError
    ? Object.fromEntries(error.fieldErrors.map((f) => [f.path, f.message]))
    : {};

function UseSessionForm({ pkg }: { pkg: ClientPackageDetail }) {
  const toast = useToast();
  const [usedOn, setUsedOn] = useState(localToday());
  const [patientId, setPatientId] = useState(pkg.patient?.id ?? pkg.patients[0]?.id ?? '');
  const [professionalId, setProfessionalId] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = usePackageMutation<{
    usedOn: string;
    patientId: string | null;
    professionalId: string;
    notes: string;
  }>(pkg, `/sales/packages/${pkg.id}/usages`, (saved) => {
    toast.success(
      saved.remaining > 0
        ? `Sessão registrada. Restam ${String(saved.remaining)} de ${String(saved.sessions)}.`
        : 'Sessão registrada. Pacote concluído.',
    );
    setNotes('');
  });
  const submit = () => {
    const found: Record<string, string> = {};
    if (!usedOn) found.usedOn = 'Informe a data';
    if (!professionalId) found.professionalId = 'Escolha o profissional';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    save.mutate(
      { usedOn, patientId: patientId || null, professionalId, notes },
      {
        onError: (e) => {
          setErrors(fieldErrorsOf(e));
        },
      },
    );
  };
  const general =
    save.isError && Object.keys(fieldErrorsOf(save.error)).length === 0
      ? errorMessage(save.error)
      : undefined;
  return (
    <form
      noValidate
      aria-label="Registrar sessão"
      className="space-y-3 rounded-control border border-line p-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h3 className="font-display text-[15px] font-semibold">
        Registrar a sessão {pkg.used + 1} de {pkg.sessions}
      </h3>
      {general ? (
        <p role="alert" className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600">
          {general}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField
          label="Data"
          type="date"
          value={usedOn}
          max={localToday()}
          error={errors.usedOn}
          onChange={(e) => {
            setUsedOn(e.target.value);
          }}
        />
        <SelectField
          label="Animal"
          placeholder="Sem animal"
          value={patientId}
          options={pkg.patients.map((p) => ({ value: p.id, label: p.name }))}
          error={errors.patientId}
          onChange={(e) => {
            setPatientId(e.target.value);
          }}
        />
        <SelectField
          label="Profissional"
          placeholder="Escolha"
          value={professionalId}
          options={pkg.professionals.map((p) => ({ value: p.id, label: p.name }))}
          error={errors.professionalId}
          onChange={(e) => {
            setProfessionalId(e.target.value);
          }}
        />
      </div>
      <TextField
        label="Observação"
        autoComplete="off"
        maxLength={300}
        value={notes}
        error={errors.notes}
        onChange={(e) => {
          setNotes(e.target.value);
        }}
      />
      <div className="flex justify-end">
        <Button type="submit" pending={save.isPending}>
          Registrar sessão
        </Button>
      </div>
    </form>
  );
}

function UndoForm({
  pkg,
  usage,
  onDone,
}: {
  pkg: ClientPackageDetail;
  usage: PackageUsage;
  onDone: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const undo = usePackageMutation<{ reason: string }>(
    pkg,
    `/sales/packages/${pkg.id}/usages/${usage.id}/undo`,
    () => {
      toast.success('Sessão desfeita; ela volta a ficar disponível.');
      onDone();
    },
  );
  return (
    <form
      noValidate
      aria-label="Desfazer sessão"
      className="space-y-3 rounded-control border border-danger-600/30 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (reason.trim().length < 3) {
          setError('Explique o motivo em poucas palavras');
          return;
        }
        undo.mutate(
          { reason },
          {
            onError: (err) => {
              setError(fieldErrorsOf(err).reason ?? errorMessage(err));
            },
          },
        );
      }}
    >
      <h3 className="font-display text-[15px] font-semibold">
        Desfazer a sessão de {formatCalendarDate(usage.usedOn)}
      </h3>
      <TextareaField
        label="Motivo"
        rows={2}
        maxLength={300}
        value={reason}
        error={error}
        onChange={(e) => {
          setReason(e.target.value);
          setError(undefined);
        }}
      />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Voltar
        </Button>
        <Button type="submit" variant="danger" pending={undo.isPending}>
          Desfazer sessão
        </Button>
      </div>
    </form>
  );
}
