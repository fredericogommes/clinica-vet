import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { PawPrint, Search, TriangleAlert, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SearchField } from '../../design-system/field';
import { Badge, PageHeader, Panel } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { Pagination } from '../../design-system/table';
import { errorMessage } from '../../lib/api';
import { useDebounced } from '../../lib/use-debounced';
import { formatPhone } from '../clients/format';
import { clinicalSearchQuery } from './queries';

const PAGE_SIZE = 25;

export interface ClinicalSearchParams {
  client: string;
  patient: string;
  page: number;
}

/** Entrada do atendimento [p.4]: responsáveis com os animais ao lado; o nome do animal abre a ficha. */
export function ClinicalSearchPage({ search }: { search: ClinicalSearchParams }) {
  const navigate = useNavigate({ from: '/atendimento' });
  const [client, setClient] = useState(search.client);
  const [patient, setPatient] = useState(search.patient);
  const debouncedClient = useDebounced(client.trim());
  const debouncedPatient = useDebounced(patient.trim());

  useEffect(() => {
    if (debouncedClient !== search.client || debouncedPatient !== search.patient) {
      void navigate({
        search: { cliente: debouncedClient, animal: debouncedPatient, pagina: 1 },
        replace: true,
      });
    }
  }, [debouncedClient, debouncedPatient, search.client, search.patient, navigate]);

  const results = useQuery(clinicalSearchQuery(search));
  const filtered = Boolean(search.client || search.patient);

  return (
    <>
      <PageHeader
        area="Atendimento clínico"
        title="Atendimento"
        description="Localize o responsável ou o animal e abra a ficha clínica pelo nome do animal."
      />
      <Panel>
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2">
          <SearchField
            label="Responsável"
            placeholder="Responsável: nome, código ou telefone"
            icon={<UserRound className="size-4" aria-hidden />}
            value={client}
            onChange={(e) => {
              setClient(e.target.value);
            }}
          />
          <SearchField
            label="Animal"
            placeholder="Animal: nome, código ou microchip"
            icon={<Search className="size-4" aria-hidden />}
            value={patient}
            onChange={(e) => {
              setPatient(e.target.value);
            }}
          />
        </div>
        {results.isPending ? (
          <SkeletonRows rows={6} columns={2} />
        ) : results.isError ? (
          <ErrorState
            message={errorMessage(results.error)}
            onRetry={() => void results.refetch()}
          />
        ) : results.data.items.length === 0 ? (
          <EmptyState
            icon={PawPrint}
            title={filtered ? 'Ninguém encontrado' : 'Nenhum animal cadastrado'}
            description={
              filtered
                ? 'Confira a grafia ou busque pelo código da ficha. Fichas arquivadas não aparecem aqui.'
                : 'Cadastre o responsável e o animal em Clientes para abrir a primeira ficha.'
            }
          />
        ) : (
          <>
            <ul className="divide-y divide-line" aria-label="Responsáveis e animais">
              {results.data.items.map(({ owner, patients }) => (
                <li
                  key={owner.id}
                  className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,16rem)_1fr] sm:gap-6"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{owner.name}</p>
                    <p className="font-mono text-xs text-ink-muted">
                      #{owner.code}
                      {owner.phone ? ` · ${formatPhone(owner.phone)}` : ''}
                    </p>
                  </div>
                  <ul className="flex flex-wrap gap-2">
                    {patients.map((p) => (
                      <li key={p.id}>
                        <Link
                          to="/atendimento/$patientId"
                          params={{ patientId: p.id }}
                          className="inline-flex max-w-full items-center gap-2 rounded-control border border-line-strong bg-surface px-3 py-1.5 text-sm hover:border-sage-500 hover:bg-sage-50"
                        >
                          <PawPrint className="size-3.5 shrink-0 text-sage-600" aria-hidden />
                          <span className="font-medium">{p.name}</span>
                          <span className="truncate text-xs text-ink-muted">
                            {[p.speciesName, p.breedName].filter(Boolean).join(' · ')}
                          </span>
                          {p.status === 'deceased' ? <Badge>Óbito</Badge> : null}
                          {p.markings.length ? (
                            <TriangleAlert
                              className="size-3.5 shrink-0 text-amber-700"
                              aria-label={`Marcações: ${p.markings.join(', ')}`}
                            />
                          ) : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            <Pagination
              page={search.page}
              pageSize={PAGE_SIZE}
              total={results.data.total}
              onPageChange={(page) => {
                void navigate({ search: (prev) => ({ ...prev, pagina: page }) });
              }}
            />
          </>
        )}
      </Panel>
    </>
  );
}
