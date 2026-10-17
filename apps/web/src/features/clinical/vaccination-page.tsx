import {
  vaccinationDueSchema,
  vaccineKindLabels,
  vaccineKinds,
  type VaccinationDueItem,
  type VaccineKind,
} from '@clinica/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { MessageCircle, Phone, Syringe } from 'lucide-react';
import { Segmented, SelectField, TextField } from '../../design-system/field';
import { Badge, PageHeader, Panel, Stats } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { DataTable, Pagination, type Column } from '../../design-system/table';
import { api, errorMessage } from '../../lib/api';
import { catalogQuery } from '../catalogs/queries';
import { formatPhone, whatsappUrl } from '../clients/format';
import { formatBrDate } from '../schedule/dates';

export const vaccinationSituations = ['todas', 'vencidas', 'a-vencer'] as const;
export type VaccinationSituation = (typeof vaccinationSituations)[number];

export interface VaccinationSearch {
  situacao: VaccinationSituation;
  ate: string | undefined;
  tipo: VaccineKind | undefined;
  especie: string | undefined;
  page: number;
}

/** Mudança nos filtros da URL; `undefined` volta ao padrão. */
interface UrlPatch {
  situacao?: Exclude<VaccinationSituation, 'todas'> | undefined;
  ate?: string | undefined;
  tipo?: VaccineKind | undefined;
  especie?: string | undefined;
}

const PAGE_SIZE = 50;

const dueQuery = (s: VaccinationSearch) => ({
  queryKey: ['vaccines', 'due', s],
  queryFn: () => {
    const params = new URLSearchParams({
      situacao: s.situacao,
      page: String(s.page),
      pageSize: String(PAGE_SIZE),
    });
    if (s.ate) params.set('ate', s.ate);
    if (s.tipo) params.set('tipo', s.tipo);
    if (s.especie) params.set('especie', s.especie);
    return api('GET', `/vaccines/due?${params.toString()}`, vaccinationDueSchema);
  },
  placeholderData: keepPreviousData,
});

function lateness(days: number) {
  if (days > 0) {
    return (
      <Badge tone="danger">
        {days === 1 ? 'Vencida há 1 dia' : `Vencida há ${String(days)} dias`}
      </Badge>
    );
  }
  if (days === 0) return <Badge tone="amber">Vence hoje</Badge>;
  return (
    <Badge tone="amber">{days === -1 ? 'Vence amanhã' : `Vence em ${String(-days)} dias`}</Badge>
  );
}

/** Consulta Vacinação [p.17]: busca ativa de animais com dose vencida ou a vencer. */
export function VaccinationPage({ search }: { search: VaccinationSearch }) {
  const navigate = useNavigate({ from: '/consultas/vacinacao' });
  const set = (patch: UrlPatch) => {
    void navigate({ search: (prev) => ({ ...prev, page: undefined, ...patch }), replace: true });
  };
  const due = useQuery(dueQuery(search));
  const species = useQuery(catalogQuery('species'));

  const columns: Column<VaccinationDueItem>[] = [
    {
      header: 'Animal',
      cell: (r) => (
        <div className="min-w-0">
          <Link
            to="/atendimento/$patientId"
            params={{ patientId: r.patient.id }}
            className="font-medium text-sage-700 hover:underline"
          >
            {r.patient.name}
          </Link>
          <p className="text-xs text-ink-muted">
            #{r.patient.code}
            {r.species ? ` · ${r.species}` : ''}
          </p>
          <div className="mt-1 space-y-1 md:hidden">
            <p className="text-xs">
              {r.vaccine.name} · <span className="font-mono">{formatBrDate(r.nextDueOn)}</span>
            </p>
            {lateness(r.daysLate)}
          </div>
        </div>
      ),
    },
    {
      header: 'Responsável',
      cell: (r) => (
        <div className="min-w-0">
          <Link
            to="/clientes/$clientId"
            params={{ clientId: r.client.id }}
            className="hover:underline"
          >
            {r.client.name}
          </Link>
          {r.client.phone ? (
            <p className="flex items-center gap-1.5 text-xs text-ink-muted">
              <Phone className="size-3" aria-hidden />
              <span className="font-mono whitespace-nowrap">{formatPhone(r.client.phone)}</span>
              {r.client.whatsapp ? (
                <a
                  href={whatsappUrl(r.client.phone)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`WhatsApp de ${r.client.name}`}
                  className="text-sage-700 hover:text-sage-600"
                >
                  <MessageCircle className="size-3.5" aria-hidden />
                </a>
              ) : null}
            </p>
          ) : (
            <p className="text-xs text-ink-faint">Sem telefone</p>
          )}
        </div>
      ),
    },
    {
      header: 'Vacina',
      cell: (r) => (
        <div className="min-w-0">
          <p>{r.vaccine.name}</p>
          <p className="text-xs text-ink-muted">
            {vaccineKindLabels[r.vaccine.kind]} · última: {r.lastDose.toLowerCase()}
          </p>
        </div>
      ),
      hideOnMobile: true,
    },
    {
      header: 'Próxima dose',
      cell: (r) => (
        <div className="space-y-1">
          <p className="font-mono">{formatBrDate(r.nextDueOn)}</p>
          {lateness(r.daysLate)}
        </div>
      ),
      hideOnMobile: true,
    },
  ];

  return (
    <>
      <PageHeader
        area="Consultas"
        title="Vacinação"
        description="Animais com vacina, vermífugo ou antiparasitário vencido ou a vencer, com o contato do responsável. Protocolos encerrados e animais em óbito ou arquivados ficam de fora."
      />
      <Panel className="mb-5 p-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[auto_10rem_12rem_12rem] lg:items-end">
          <Segmented
            label="Situação"
            value={search.situacao}
            options={[
              { value: 'todas', label: 'Todas' },
              { value: 'vencidas', label: 'Vencidas' },
              { value: 'a-vencer', label: 'A vencer' },
            ]}
            onChange={(situacao) => {
              set({ situacao: situacao === 'todas' ? undefined : situacao });
            }}
          />
          <TextField
            label="A vencer até"
            type="date"
            value={search.ate ?? due.data?.until ?? ''}
            onChange={(e) => {
              set({ ate: e.target.value || undefined });
            }}
          />
          <SelectField
            label="Tipo"
            value={search.tipo ?? ''}
            placeholder="Todos"
            options={vaccineKinds.map((k) => ({ value: k, label: vaccineKindLabels[k] }))}
            onChange={(e) => {
              set({ tipo: (e.target.value || undefined) as VaccineKind | undefined });
            }}
          />
          <SelectField
            label="Espécie"
            value={search.especie ?? ''}
            placeholder="Todas"
            options={(species.data ?? [])
              .filter((s) => !s.archived)
              .map((s) => ({ value: s.id, label: s.name }))}
            onChange={(e) => {
              set({ especie: e.target.value || undefined });
            }}
          />
        </div>
      </Panel>

      {due.isPending ? (
        <SkeletonRows rows={6} columns={4} />
      ) : due.isError ? (
        <ErrorState message={errorMessage(due.error)} onRetry={() => void due.refetch()} />
      ) : (
        <>
          <div className="mb-5">
            <Stats
              label="Resumo da vacinação"
              items={[
                {
                  label: 'Vencidas',
                  value: due.data.overdue,
                  detail: 'Próxima dose antes de hoje',
                },
                {
                  label: 'A vencer',
                  value: due.data.dueSoon,
                  detail: `De hoje até ${formatBrDate(due.data.until)}`,
                },
              ]}
            />
          </div>
          <Panel>
            {due.data.items.length === 0 ? (
              <EmptyState
                icon={Syringe}
                title="Nenhuma dose nesta busca"
                description="Amplie a data ou tire os filtros de tipo e espécie."
              />
            ) : (
              <div aria-busy={due.isFetching || undefined}>
                <DataTable
                  caption="Doses vencidas e a vencer"
                  columns={columns}
                  rows={due.data.items}
                  rowKey={(r) => `${r.patient.id}-${r.vaccine.id}`}
                />
                <div className="border-t border-line px-4 py-3">
                  <Pagination
                    page={due.data.page}
                    pageSize={due.data.pageSize}
                    total={due.data.total}
                    onPageChange={(page) => {
                      void navigate({ search: (prev) => ({ ...prev, page }), replace: true });
                    }}
                  />
                </div>
              </div>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
