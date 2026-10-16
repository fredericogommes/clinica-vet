import type { PatientListItem } from '@clinica/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { PawPrint, Search, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../design-system/button';
import { SearchField } from '../../design-system/field';
import { Badge, PageHeader, Panel } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { DataTable, Pagination } from '../../design-system/table';
import { errorMessage } from '../../lib/api';
import { useDebounced } from '../../lib/use-debounced';
import type { ListParams } from '../clients/queries';
import { PAGE_SIZE, patientsQuery } from './queries';

export function PatientsPage({ search }: { search: ListParams }) {
  const navigate = useNavigate({ from: '/animais' });
  const [term, setTerm] = useState(search.q);
  const debounced = useDebounced(term.trim());

  useEffect(() => {
    if (debounced !== search.q) {
      void navigate({ search: (prev) => ({ ...prev, q: debounced, page: 1 }), replace: true });
    }
  }, [debounced, search.q, navigate]);

  const patients = useQuery(patientsQuery(search));

  return (
    <>
      <PageHeader
        area="Clientes e animais"
        title="Animais"
        description="Busque pelo nome do animal, do responsável, pelo código ou pelo microchip. Para cadastrar, abra a ficha do responsável."
      />
      <Panel>
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
          <SearchField
            label="Buscar animais"
            placeholder="Animal, responsável, código ou microchip"
            icon={<Search className="size-4" aria-hidden />}
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
            }}
            className="flex-1"
          />
          <div className="flex gap-1" role="group" aria-label="Situação">
            {[
              { value: false, label: 'Ativos' },
              { value: true, label: 'Arquivados' },
            ].map((o) => (
              <Button
                key={o.label}
                size="sm"
                variant={search.archived === o.value ? 'secondary' : 'ghost'}
                aria-pressed={search.archived === o.value}
                onClick={() => {
                  void navigate({ search: (prev) => ({ ...prev, archived: o.value, page: 1 }) });
                }}
              >
                {o.label}
              </Button>
            ))}
          </div>
        </div>
        {patients.isPending ? (
          <SkeletonRows />
        ) : patients.isError ? (
          <ErrorState
            message={errorMessage(patients.error)}
            onRetry={() => void patients.refetch()}
          />
        ) : patients.data.items.length === 0 ? (
          <EmptyState
            icon={PawPrint}
            title={search.q ? 'Nenhum animal encontrado' : 'Nenhum animal cadastrado'}
            description={
              search.q
                ? 'Tente o nome do responsável ou o código da ficha.'
                : 'Animais são cadastrados a partir da ficha do responsável.'
            }
          />
        ) : (
          <>
            <DataTable<PatientListItem>
              caption="Animais"
              rows={patients.data.items}
              rowKey={(p) => p.id}
              columns={[
                {
                  header: 'Animal',
                  cell: (p) => (
                    <div className="min-w-0">
                      <Link
                        to="/animais/$patientId"
                        params={{ patientId: p.id }}
                        className="font-medium text-ink hover:text-sage-700 hover:underline"
                      >
                        {p.name}
                      </Link>
                      <p className="text-xs text-ink-muted">
                        <span className="font-mono">#{p.code}</span>
                        {p.speciesName ? ` · ${p.speciesName}` : ''}
                        <span className="md:hidden"> · {p.owner.name}</span>
                      </p>
                    </div>
                  ),
                },
                {
                  header: 'Raça',
                  hideOnMobile: true,
                  cell: (p) => p.breedName ?? <span className="text-ink-faint">—</span>,
                },
                {
                  header: 'Responsável',
                  hideOnMobile: true,
                  cell: (p) => (
                    <Link
                      to="/clientes/$clientId"
                      params={{ clientId: p.owner.id }}
                      className="hover:underline"
                    >
                      {p.owner.name}
                    </Link>
                  ),
                },
                {
                  header: 'Alertas',
                  cell: (p) => (
                    <div className="flex flex-wrap gap-1">
                      {p.status === 'deceased' ? <Badge>Óbito</Badge> : null}
                      {p.markings.slice(0, 2).map((m) => (
                        <Badge key={m} tone="amber">
                          <TriangleAlert className="mr-1 size-3" aria-hidden />
                          {m}
                        </Badge>
                      ))}
                      {p.markings.length > 2 ? (
                        <Badge tone="amber">+{p.markings.length - 2}</Badge>
                      ) : null}
                    </div>
                  ),
                },
              ]}
            />
            <Pagination
              page={search.page}
              pageSize={PAGE_SIZE}
              total={patients.data.total}
              onPageChange={(page) => {
                void navigate({ search: (prev) => ({ ...prev, page }) });
              }}
            />
          </>
        )}
      </Panel>
    </>
  );
}
