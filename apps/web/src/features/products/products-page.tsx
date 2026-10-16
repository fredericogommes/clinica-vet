import {
  productKinds,
  productKindLabels,
  saleUnitLabels,
  serviceKindLabels,
  type ProductKind,
  type ProductListItem,
} from '@clinica/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Package, Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, buttonClasses } from '../../design-system/button';
import { SearchField, SelectField } from '../../design-system/field';
import { Badge, PageHeader, Panel } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { DataTable, Pagination } from '../../design-system/table';
import { errorMessage } from '../../lib/api';
import { useCan } from '../../lib/session';
import { useDebounced } from '../../lib/use-debounced';
import { catalogQuery } from '../catalogs/queries';
import { formatMoney } from './format';
import { PRODUCTS_PAGE_SIZE, productsQuery, type ProductListParams } from './queries';

export function ProductsPage({ search }: { search: ProductListParams }) {
  const can = useCan();
  const navigate = useNavigate({ from: '/estoque/produtos' });
  const [term, setTerm] = useState(search.q);
  const debounced = useDebounced(term.trim());
  const groups = useQuery(catalogQuery('product-groups'));

  useEffect(() => {
    if (debounced !== search.q) {
      void navigate({ search: (prev) => ({ ...prev, q: debounced, page: 1 }), replace: true });
    }
  }, [debounced, search.q, navigate]);

  const products = useQuery(productsQuery(search));
  const filtered = Boolean(search.q || search.kind || search.groupId || search.priceList);

  return (
    <>
      <PageHeader
        area="Estoque e serviços"
        title="Produtos e serviços"
        description="Tudo o que a clínica vende ou usa, num cadastro só. Busque por nome, código ou código de barras."
        actions={
          can('products.manage') ? (
            <Link to="/estoque/produtos/novo" className={buttonClasses()}>
              <Plus className="size-4" aria-hidden />
              Novo item
            </Link>
          ) : null
        }
      />
      <Panel>
        <div className="space-y-3 border-b border-line p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <SearchField
              label="Buscar produtos e serviços"
              placeholder="Nome, código ou código de barras"
              icon={<Search className="size-4" aria-hidden />}
              value={term}
              onChange={(e) => {
                setTerm(e.target.value);
              }}
              className="flex-1"
            />
            <div className="md:w-56">
              <SelectField
                label="Grupo"
                placeholder="Todos os grupos"
                options={(groups.data ?? [])
                  .filter((g) => !g.archived || g.id === search.groupId)
                  .map((g) => ({ value: g.id, label: g.name }))}
                value={search.groupId ?? ''}
                onChange={(e) => {
                  const groupId = e.target.value || undefined;
                  void navigate({ search: (prev) => ({ ...prev, grupo: groupId, page: 1 }) });
                }}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex gap-1" role="group" aria-label="Tipo">
              {([undefined, ...productKinds] as (ProductKind | undefined)[]).map((k) => (
                <Button
                  key={k ?? 'all'}
                  size="sm"
                  variant={search.kind === k ? 'secondary' : 'ghost'}
                  aria-pressed={search.kind === k}
                  onClick={() => {
                    void navigate({ search: (prev) => ({ ...prev, tipo: k, page: 1 }) });
                  }}
                >
                  {k ? `${productKindLabels[k]}s` : 'Todos'}
                </Button>
              ))}
            </div>
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
                    void navigate({
                      search: (prev) => ({ ...prev, arquivados: o.value || undefined, page: 1 }),
                    });
                  }}
                >
                  {o.label}
                </Button>
              ))}
            </div>
            <Button
              size="sm"
              variant={search.priceList ? 'secondary' : 'ghost'}
              aria-pressed={search.priceList}
              onClick={() => {
                void navigate({
                  search: (prev) => ({ ...prev, lista: !search.priceList || undefined, page: 1 }),
                });
              }}
            >
              Só lista de preços
            </Button>
          </div>
        </div>
        {products.isPending ? (
          <SkeletonRows />
        ) : products.isError ? (
          <ErrorState
            message={errorMessage(products.error)}
            onRetry={() => void products.refetch()}
          />
        ) : products.data.items.length === 0 ? (
          <EmptyState
            icon={Package}
            title={filtered ? 'Nada encontrado' : 'Nenhum item cadastrado'}
            description={
              filtered
                ? 'Confira a grafia ou limpe os filtros.'
                : search.archived
                  ? 'Itens arquivados aparecem aqui.'
                  : 'Cadastre os serviços (consulta, vacina, banho) e os produtos que a clínica vende.'
            }
          />
        ) : (
          <>
            <DataTable<ProductListItem>
              caption="Produtos e serviços"
              rows={products.data.items}
              rowKey={(p) => p.id}
              columns={[
                {
                  header: 'Item',
                  cell: (p) => (
                    <div className="min-w-0">
                      <Link
                        to="/estoque/produtos/$productId"
                        params={{ productId: p.id }}
                        className="font-medium text-ink hover:text-sage-700 hover:underline"
                      >
                        {p.name}
                      </Link>
                      <p className="font-mono text-xs text-ink-muted">
                        #{p.code} · {saleUnitLabels[p.unit]}
                        {p.barcode ? ` · ${p.barcode}` : ''}
                      </p>
                      <div className="mt-1 md:hidden">
                        <KindBadge item={p} />
                      </div>
                    </div>
                  ),
                },
                {
                  header: 'Tipo',
                  hideOnMobile: true,
                  cell: (p) => <KindBadge item={p} />,
                },
                {
                  header: 'Grupo',
                  hideOnMobile: true,
                  cell: (p) => p.groupName ?? <span className="text-ink-faint">—</span>,
                },
                {
                  header: 'Marca',
                  hideOnMobile: true,
                  cell: (p) => p.brandName ?? <span className="text-ink-faint">—</span>,
                },
                {
                  header: 'Preço',
                  className: 'text-right',
                  cell: (p) => (
                    <span className="font-mono text-[13px] whitespace-nowrap">
                      {formatMoney(p.salePrice)}
                    </span>
                  ),
                },
              ]}
            />
            <Pagination
              page={search.page}
              pageSize={PRODUCTS_PAGE_SIZE}
              total={products.data.total}
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

function KindBadge({ item }: { item: ProductListItem }) {
  return item.serviceKind ? (
    <Badge tone="sage">{serviceKindLabels[item.serviceKind]}</Badge>
  ) : (
    <Badge>Produto</Badge>
  );
}
