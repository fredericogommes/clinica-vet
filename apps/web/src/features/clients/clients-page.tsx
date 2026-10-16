import type { ClientListItem } from '@clinica/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { MessageCircle, Plus, Search, UsersRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, buttonClasses } from '../../design-system/button';
import { SearchField } from '../../design-system/field';
import { Badge, PageHeader, Panel } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { DataTable, Pagination } from '../../design-system/table';
import { errorMessage } from '../../lib/api';
import { useCan } from '../../lib/session';
import { useDebounced } from '../../lib/use-debounced';
import { formatDocument, formatPhone } from './format';
import { clientsQuery, PAGE_SIZE, type ListParams } from './queries';

export function ClientsPage({ search }: { search: ListParams }) {
  const can = useCan();
  const navigate = useNavigate({ from: '/clientes' });
  const [term, setTerm] = useState(search.q);
  const debounced = useDebounced(term.trim());

  useEffect(() => {
    if (debounced !== search.q) {
      void navigate({ search: (prev) => ({ ...prev, q: debounced, page: 1 }), replace: true });
    }
  }, [debounced, search.q, navigate]);

  const clients = useQuery(clientsQuery(search));

  return (
    <>
      <PageHeader
        area="Clientes e animais"
        title="Clientes"
        description="Responsáveis pelos animais atendidos. Busque por nome, CPF/CNPJ, telefone, e-mail, código ou nome do animal."
        actions={
          can('clients.manage') ? (
            <Link to="/clientes/novo" className={buttonClasses()}>
              <Plus className="size-4" aria-hidden />
              Novo cliente
            </Link>
          ) : null
        }
      />
      <Panel>
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
          <SearchField
            label="Buscar clientes"
            placeholder="Nome, documento, telefone ou animal"
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
        {clients.isPending ? (
          <SkeletonRows />
        ) : clients.isError ? (
          <ErrorState
            message={errorMessage(clients.error)}
            onRetry={() => void clients.refetch()}
          />
        ) : clients.data.items.length === 0 ? (
          <EmptyState
            icon={UsersRound}
            title={search.q ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado'}
            description={
              search.q
                ? 'Confira a grafia ou busque pelo telefone ou pelo nome do animal.'
                : search.archived
                  ? 'Clientes arquivados aparecem aqui.'
                  : 'Cadastre o primeiro responsável. Só nome e telefone já bastam.'
            }
          />
        ) : (
          <>
            <DataTable<ClientListItem>
              caption="Clientes"
              rows={clients.data.items}
              rowKey={(c) => c.id}
              columns={[
                {
                  header: 'Cliente',
                  cell: (c) => (
                    <div className="min-w-0">
                      <Link
                        to="/clientes/$clientId"
                        params={{ clientId: c.id }}
                        className="font-medium text-ink hover:text-sage-700 hover:underline"
                      >
                        {c.name}
                      </Link>
                      <p className="font-mono text-xs text-ink-muted">
                        #{c.code}
                        {c.personType === 'company' ? ' · PJ' : ''}
                      </p>
                      {c.primaryPhone ? (
                        <p className="mt-0.5 text-xs text-ink-muted md:hidden">
                          {formatPhone(c.primaryPhone)}
                        </p>
                      ) : null}
                    </div>
                  ),
                },
                {
                  header: 'Telefone',
                  hideOnMobile: true,
                  cell: (c) =>
                    c.primaryPhone ? (
                      <span className="inline-flex items-center gap-1.5 font-mono text-[13px]">
                        {formatPhone(c.primaryPhone)}
                        {c.primaryPhoneIsWhatsapp ? (
                          <MessageCircle
                            className="size-3.5 text-success-600"
                            aria-label="WhatsApp"
                          />
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    ),
                },
                {
                  header: 'CPF/CNPJ',
                  hideOnMobile: true,
                  cell: (c) => (
                    <span className="font-mono text-[13px] text-ink-muted">
                      {formatDocument(c.document) ?? '—'}
                    </span>
                  ),
                },
                {
                  header: 'Animais',
                  cell: (c) =>
                    c.patients.length === 0 ? (
                      <span className="text-xs text-ink-faint">Nenhum</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {c.patients.slice(0, 3).map((p) => (
                          <Badge key={p.id} tone="sage">
                            {p.name}
                          </Badge>
                        ))}
                        {c.patients.length > 3 ? <Badge>+{c.patients.length - 3}</Badge> : null}
                      </div>
                    ),
                },
              ]}
            />
            <Pagination
              page={search.page}
              pageSize={PAGE_SIZE}
              total={clients.data.total}
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
