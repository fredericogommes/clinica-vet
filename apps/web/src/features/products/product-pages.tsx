import {
  productKindLabels,
  productSchema,
  serviceKindLabels,
  type Product,
  type ProductData,
} from '@clinica/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Archive, ArchiveRestore, History } from 'lucide-react';
import { Button, buttonClasses } from '../../design-system/button';
import { Badge, FormActions, PageHeader } from '../../design-system/layout';
import { ErrorState, SkeletonRows } from '../../design-system/states';
import { useToast } from '../../design-system/toast';
import { api, errorMessage } from '../../lib/api';
import { useCan } from '../../lib/session';
import { emptyProduct, ProductForm, productToForm } from './product-form';
import { productQuery } from './queries';
import { ProductStockPanel } from './stock-panel';

function SaveError({ error }: { error: unknown }) {
  return (
    <p role="alert" className="mb-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600">
      {errorMessage(error)}
    </p>
  );
}

export function ProductNewPage() {
  const can = useCan();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: ({ data }: { data: ProductData; onFieldErrors: (e: unknown) => void }) =>
      api('POST', '/products', productSchema, data),
    onSuccess: async (saved) => {
      queryClient.setQueryData(productQuery(saved.id).queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: ['products', 'list'] });
      toast.success(`${productKindLabels[saved.kind]} cadastrado com o código ${saved.code}.`);
      await navigate({ to: '/estoque/produtos/$productId', params: { productId: saved.id } });
    },
    onError: (error, { onFieldErrors }) => {
      onFieldErrors(error);
    },
  });

  return (
    <>
      <PageHeader area="Estoque e serviços" title="Novo produto ou serviço" />
      {save.isError ? <SaveError error={save.error} /> : null}
      <ProductForm
        formId="product-new"
        defaultValues={emptyProduct}
        costVisible={can('products.view_cost')}
        readOnly={false}
        onSubmit={(data, onFieldErrors) => {
          save.mutate({ data, onFieldErrors });
        }}
      />
      <FormActions>
        <Link to="/estoque/produtos" className={buttonClasses('secondary')}>
          Cancelar
        </Link>
        <Button type="submit" form="product-new" pending={save.isPending}>
          Cadastrar
        </Button>
      </FormActions>
    </>
  );
}

export function ProductPage({ productId }: { productId: string }) {
  const can = useCan();
  const product = useQuery(productQuery(productId));
  const queryClient = useQueryClient();
  const toast = useToast();

  const refresh = async (saved: Product) => {
    queryClient.setQueryData(productQuery(productId).queryKey, saved);
    await queryClient.invalidateQueries({ queryKey: ['products', 'list'] });
    await queryClient.invalidateQueries({ queryKey: ['products', 'stock', productId] });
  };
  const save = useMutation({
    mutationFn: ({ data }: { data: ProductData; onFieldErrors: (e: unknown) => void }) =>
      api('PUT', `/products/${productId}`, productSchema, data),
    onSuccess: async (saved) => {
      await refresh(saved);
      toast.success('Alterações salvas.');
    },
    onError: (error, { onFieldErrors }) => {
      onFieldErrors(error);
    },
  });
  const archive = useMutation({
    mutationFn: (archived: boolean) =>
      api('POST', `/products/${productId}/${archived ? 'archive' : 'restore'}`, productSchema),
    onSuccess: async (saved) => {
      await refresh(saved);
      toast.success(saved.archived ? 'Item arquivado.' : 'Item restaurado.');
    },
  });

  if (product.isPending) return <SkeletonRows />;
  if (product.isError) {
    return (
      <ErrorState message={errorMessage(product.error)} onRetry={() => void product.refetch()} />
    );
  }
  const p = product.data;
  const manage = can('products.manage');
  const editable = manage && !p.archived;

  return (
    <>
      <PageHeader
        area={`${productKindLabels[p.kind]} #${p.code}`}
        title={p.name}
        description={p.serviceKind ? `Serviço · ${serviceKindLabels[p.serviceKind]}` : 'Produto'}
        actions={
          <>
            {p.archived ? <Badge tone="amber">Arquivado</Badge> : null}
            {can('admin.audit.view') ? (
              <Link
                to="/consultas/auditoria"
                search={{ entidade: 'product', id: productId, nome: p.name }}
                className={buttonClasses('ghost')}
              >
                <History className="size-4" aria-hidden />
                Histórico
              </Link>
            ) : null}
            {manage ? (
              <Button
                variant={p.archived ? 'secondary' : 'ghost'}
                icon={
                  p.archived ? (
                    <ArchiveRestore className="size-4" aria-hidden />
                  ) : (
                    <Archive className="size-4" aria-hidden />
                  )
                }
                pending={archive.isPending}
                onClick={() => {
                  archive.mutate(!p.archived);
                }}
              >
                {p.archived ? 'Restaurar' : 'Arquivar'}
              </Button>
            ) : null}
          </>
        }
      />
      {p.archived ? (
        <p
          role="note"
          className="mb-4 rounded-control bg-amber-50 px-3 py-2 text-sm text-amber-700"
        >
          Item arquivado: não aparece nas buscas nem na venda. Restaure para editar.
        </p>
      ) : null}
      {save.isError ? <SaveError error={save.error} /> : null}
      {archive.isError ? <SaveError error={archive.error} /> : null}
      {p.tracksStock ? (
        <div className="mb-5">
          <ProductStockPanel productId={p.id} unit={p.unit} />
        </div>
      ) : null}
      <ProductForm
        key={`${p.id}-${p.archived}`}
        formId="product-edit"
        defaultValues={productToForm(p)}
        costVisible={p.costVisible}
        readOnly={!editable}
        onSubmit={(data, onFieldErrors) => {
          save.mutate({ data, onFieldErrors });
        }}
      />
      <FormActions>
        <Link to="/estoque/produtos" className={buttonClasses('secondary')}>
          Voltar à lista
        </Link>
        {editable ? (
          <Button type="submit" form="product-edit" pending={save.isPending}>
            Salvar alterações
          </Button>
        ) : null}
      </FormActions>
    </>
  );
}
