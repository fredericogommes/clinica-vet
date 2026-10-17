import {
  purchaseCancelSchema,
  purchaseInputSchema,
  purchaseSchema,
  purchaseStatusLabels,
  type Purchase,
  type PurchaseOptions,
  type PurchaseSituation,
  type PurchaseStatus,
  type PurchaseSummary,
} from '@clinica/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { FileUp, Plus, Search, Trash2, Truck } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { z } from 'zod';
import { Button, buttonClasses } from '../../design-system/button';
import { Dialog } from '../../design-system/dialog';
import {
  Segmented,
  SearchField,
  SelectField,
  TextareaField,
  TextField,
} from '../../design-system/field';
import { Badge, Facts, FormActions, PageHeader, Panel, Section } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { DataTable, Pagination } from '../../design-system/table';
import { useToast } from '../../design-system/toast';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { formatCalendarDate, formatDateTime } from '../../lib/format';
import { useCan } from '../../lib/session';
import { useDebounced } from '../../lib/use-debounced';
import { formatMoney, moneyInput, parseDecimal, quantityInput } from '../products/format';
import {
  purchaseOptionsQuery,
  purchaseQuery,
  purchasesQuery,
  type PurchaseSearch,
} from './queries';

type Errors = Record<string, string>;

const issuesOf = (error: z.ZodError): Errors => {
  const errors: Errors = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.');
    errors[path] ??= issue.message;
  }
  return errors;
};

const statusTone: Record<PurchaseStatus, 'amber' | 'sage' | 'neutral'> = {
  draft: 'amber',
  confirmed: 'sage',
  cancelled: 'neutral',
};

function StatusBadge({ status }: { status: PurchaseStatus }) {
  return <Badge tone={statusTone[status]}>{purchaseStatusLabels[status]}</Badge>;
}

const entryLabel = { open: 'Em aberto', paid: 'Paga', cancelled: 'Cancelada' } as const;

const linkClass = 'font-medium text-ink hover:text-sage-700 hover:underline';

// Lista ---------------------------------------------------------------------------------------------

/** Compras por nota [p.17]: rascunhos, confirmadas e canceladas, com busca e período na URL. */
export function PurchasesPage({ search }: { search: PurchaseSearch }) {
  const can = useCan();
  const navigate = useNavigate({ from: '/estoque/compras' });
  const set = (patch: {
    situacao?: PurchaseSituation | undefined;
    de?: string | undefined;
    ate?: string | undefined;
  }) => {
    void navigate({ search: (prev) => ({ ...prev, page: undefined, ...patch }), replace: true });
  };
  const [term, setTerm] = useState(search.q);
  const debounced = useDebounced(term.trim());
  useEffect(() => {
    if (debounced !== search.q) {
      void navigate({
        search: (prev) => ({ ...prev, q: debounced || undefined, page: undefined }),
        replace: true,
      });
    }
  }, [debounced, search.q, navigate]);
  const list = useQuery(purchasesQuery(search));
  const [importing, setImporting] = useState(false);
  const manage = can('purchases.manage');

  return (
    <>
      <PageHeader
        area="Estoque e serviços"
        title="Compras"
        description="Notas de entrada de mercadoria. Importe o XML da NF-e ou digite a compra; ao confirmar, o estoque, o custo e as contas a pagar se atualizam."
        actions={
          manage ? (
            <>
              <Button
                icon={<FileUp className="size-4" aria-hidden />}
                onClick={() => {
                  setImporting(true);
                }}
              >
                Importar XML
              </Button>
              <Link to="/estoque/compras/nova" className={buttonClasses('secondary')}>
                <Plus className="size-4" aria-hidden />
                Nova compra
              </Link>
            </>
          ) : null
        }
      />

      <Panel className="mb-5 space-y-4 p-4">
        <Segmented
          label="Situação"
          value={search.situacao}
          options={[
            { value: 'todas', label: 'Todas' },
            { value: 'rascunhos', label: 'Rascunhos' },
            { value: 'confirmadas', label: 'Confirmadas' },
            { value: 'canceladas', label: 'Canceladas' },
          ]}
          onChange={(situacao) => {
            set({ situacao: situacao === 'todas' ? undefined : situacao });
          }}
        />
        <div className="grid gap-4 sm:grid-cols-[1fr_10rem_10rem] sm:items-end">
          <SearchField
            label="Buscar compra"
            icon={<Search className="size-4" aria-hidden />}
            placeholder="Fornecedor, número da nota, chave ou código"
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
            }}
          />
          <TextField
            label="Entrada de"
            type="date"
            value={search.de ?? ''}
            onChange={(e) => {
              set({ de: e.target.value || undefined });
            }}
          />
          <TextField
            label="Até"
            type="date"
            value={search.ate ?? ''}
            onChange={(e) => {
              set({ ate: e.target.value || undefined });
            }}
          />
        </div>
      </Panel>

      {list.isPending ? (
        <SkeletonRows rows={6} columns={5} />
      ) : list.isError ? (
        <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
      ) : (
        <Panel>
          {list.data.items.length === 0 ? (
            <EmptyState
              icon={Truck}
              title="Nenhuma compra nesta busca"
              description="Importe o XML da nota do fornecedor para lançar a entrada com lote, validade e parcelas."
            />
          ) : (
            <div aria-busy={list.isFetching || undefined}>
              <DataTable<PurchaseSummary>
                caption="Compras"
                rows={list.data.items}
                rowKey={(p) => p.id}
                columns={[
                  {
                    header: 'Compra',
                    cell: (p) => (
                      <Link
                        to="/estoque/compras/$purchaseId"
                        params={{ purchaseId: p.id }}
                        className={linkClass}
                      >
                        {p.code}
                      </Link>
                    ),
                  },
                  {
                    header: 'Entrada',
                    cell: (p) => formatCalendarDate(p.enteredOn),
                    hideOnMobile: true,
                  },
                  {
                    header: 'Fornecedor',
                    cell: (p) => (
                      <div className="min-w-0">
                        <p className="truncate">{p.supplier.name}</p>
                        <p className="truncate text-xs text-ink-muted">
                          {p.invoiceNumber ? `NF ${p.invoiceNumber}` : 'Sem nota'}
                          <span className="md:hidden"> · {purchaseStatusLabels[p.status]}</span>
                        </p>
                      </div>
                    ),
                    className: 'max-w-40 sm:max-w-64',
                  },
                  {
                    header: 'Itens',
                    cell: (p) => p.itemCount,
                    hideOnMobile: true,
                    className: 'text-right tabular-nums',
                  },
                  {
                    header: 'Total',
                    cell: (p) => (
                      <span className="font-mono whitespace-nowrap tabular-nums">
                        {formatMoney(p.total)}
                      </span>
                    ),
                    className: 'text-right',
                  },
                  {
                    header: 'Situação',
                    cell: (p) => <StatusBadge status={p.status} />,
                    hideOnMobile: true,
                  },
                ]}
              />
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

      {importing ? (
        <ImportDialog
          onClose={() => {
            setImporting(false);
          }}
        />
      ) : null}
    </>
  );
}

/** Lê o arquivo XML no navegador e manda o texto; a API valida e monta o rascunho. */
function ImportDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: async (chosen: File) =>
      api('POST', '/purchases/import', purchaseSchema, { xml: await chosen.text() }),
    onSuccess: async (purchase) => {
      await queryClient.invalidateQueries({ queryKey: ['purchases'] });
      toast.success(`Nota importada como compra ${String(purchase.code)}. Confira e confirme.`);
      void navigate({
        to: '/estoque/compras/$purchaseId',
        params: { purchaseId: purchase.id },
      });
    },
  });
  const error = run.isError ? errorMessage(run.error) : problem;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Importar XML da NF-e"
      description="O fornecedor, os itens com lote e validade, o frete e as duplicatas vêm da nota. Nada entra no estoque antes de você confirmar."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button
            pending={run.isPending}
            disabled={!file}
            onClick={() => {
              if (file) run.mutate(file);
            }}
          >
            Importar
          </Button>
        </>
      }
    >
      <div className="space-y-1.5">
        <label htmlFor="nfe-file" className="block text-[13px] font-medium">
          Arquivo XML
        </label>
        <input
          id="nfe-file"
          type="file"
          accept=".xml,text/xml,application/xml"
          aria-describedby="nfe-hint"
          className="block w-full text-sm file:mr-3 file:rounded-control file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-sunken"
          onChange={(e) => {
            const chosen = e.target.files?.[0] ?? null;
            run.reset();
            if (chosen && chosen.size > 2_000_000) {
              setProblem('Arquivo grande demais para uma NF-e.');
              setFile(null);
              return;
            }
            setProblem(null);
            setFile(chosen);
          }}
        />
        <p id="nfe-hint" className="text-xs text-ink-muted">
          O arquivo que o fornecedor envia por e-mail, com a chave de acesso de 44 dígitos.
        </p>
        {error ? (
          <p role="alert" className="text-xs font-medium text-danger-600">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

// Compra ---------------------------------------------------------------------------------------------

export function PurchaseNewPage() {
  const options = useQuery(purchaseOptionsQuery);
  if (options.isPending) return <SkeletonRows />;
  if (options.isError) {
    return (
      <ErrorState message={errorMessage(options.error)} onRetry={() => void options.refetch()} />
    );
  }
  return (
    <>
      <PageHeader
        area="Estoque e serviços"
        title="Nova compra"
        description="Para compra sem XML. Salve como rascunho e confirme quando conferir a mercadoria."
      />
      <PurchaseEditor purchase={null} options={options.data} />
    </>
  );
}

export function PurchasePage({ purchaseId }: { purchaseId: string }) {
  const can = useCan();
  const purchase = useQuery(purchaseQuery(purchaseId));
  const options = useQuery({ ...purchaseOptionsQuery, enabled: can('purchases.manage') });
  if (purchase.isPending) return <SkeletonRows />;
  if (purchase.isError) {
    return (
      <ErrorState message={errorMessage(purchase.error)} onRetry={() => void purchase.refetch()} />
    );
  }
  const p = purchase.data;
  const editable = p.status === 'draft' && can('purchases.manage');
  return (
    <>
      <PageHeader
        area="Estoque e serviços"
        title={`Compra ${String(p.code)}`}
        description={`${p.supplier.name}${p.invoiceNumber ? ` · NF ${p.invoiceNumber}` : ''}`}
        actions={<StatusBadge status={p.status} />}
      />
      {editable ? (
        options.data ? (
          <PurchaseEditor key={p.id} purchase={p} options={options.data} />
        ) : options.isError ? (
          <ErrorState
            message={errorMessage(options.error)}
            onRetry={() => void options.refetch()}
          />
        ) : (
          <SkeletonRows />
        )
      ) : (
        <PurchaseView purchase={p} />
      )}
    </>
  );
}

// Editor --------------------------------------------------------------------------------------------

interface ItemState {
  key: string;
  productId: string;
  description: string;
  supplierCode: string;
  ean: string;
  supplierUnit: string;
  quantity: string;
  factor: string;
  total: string;
  lotCode: string;
  expiresOn: string;
}

interface InstallmentState {
  key: string;
  dueDate: string;
  amount: string;
}

let nextKey = 0;
const newKey = () => `k${String((nextKey += 1))}`;

const emptyItem = (): ItemState => ({
  key: newKey(),
  productId: '',
  description: '',
  supplierCode: '',
  ean: '',
  supplierUnit: '',
  quantity: '',
  factor: '1',
  total: '',
  lotCode: '',
  expiresOn: '',
});

const num = (text: string) => parseDecimal(text) ?? Number.NaN;
const optionalMoney = (text: string) => parseDecimal(text) ?? 0;

function PurchaseEditor({
  purchase,
  options,
}: {
  purchase: Purchase | null;
  options: PurchaseOptions;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [supplierId, setSupplierId] = useState(purchase?.supplier.id ?? '');
  const [invoiceNumber, setInvoiceNumber] = useState(purchase?.invoiceNumber ?? '');
  const [invoiceSeries, setInvoiceSeries] = useState(purchase?.invoiceSeries ?? '');
  const [issuedOn, setIssuedOn] = useState(purchase?.issuedOn ?? '');
  const [enteredOn, setEnteredOn] = useState(purchase?.enteredOn ?? options.today);
  const [accountId, setAccountId] = useState(
    purchase?.account.id ?? options.defaults.accountId ?? '',
  );
  const [categoryId, setCategoryId] = useState(
    purchase?.category.id ?? options.defaults.categoryId ?? '',
  );
  const [freight, setFreight] = useState(purchase ? moneyInput(purchase.freight) : '');
  const [otherCosts, setOtherCosts] = useState(purchase ? moneyInput(purchase.otherCosts) : '');
  const [discount, setDiscount] = useState(purchase ? moneyInput(purchase.discount) : '');
  const [notes, setNotes] = useState(purchase?.notes ?? '');
  const [items, setItems] = useState<ItemState[]>(
    purchase
      ? purchase.items.map((i) => ({
          key: newKey(),
          productId: i.product?.id ?? '',
          description: i.description,
          supplierCode: i.supplierCode,
          ean: i.ean,
          supplierUnit: i.supplierUnit,
          quantity: quantityInput(i.quantity),
          factor: quantityInput(i.factor),
          total: moneyInput(i.total),
          lotCode: i.lot?.code ?? '',
          expiresOn: i.lot?.expiresOn ?? '',
        }))
      : [emptyItem()],
  );
  const [installments, setInstallments] = useState<InstallmentState[]>(
    (purchase?.installments ?? []).map((i) => ({
      key: newKey(),
      dueDate: i.dueDate,
      amount: moneyInput(i.amount),
    })),
  );
  const [errors, setErrors] = useState<Errors>({});
  const [discarding, setDiscarding] = useState(false);

  const clear = (field: string) => {
    if (errors[field]) setErrors(({ [field]: _, ...rest }) => rest);
  };
  const setItem = (key: string, patch: Partial<ItemState>, field?: string) => {
    setItems((all) => all.map((i) => (i.key === key ? { ...i, ...patch } : i)));
    if (field) clear(field);
  };

  // Prévia dos totais; a API recalcula ao salvar.
  const cents = (text: string) => Math.round((parseDecimal(text) ?? 0) * 100);
  const itemsTotal = items.reduce((sum, i) => sum + cents(i.total), 0);
  const total = itemsTotal + cents(freight) + cents(otherCosts) - cents(discount);
  const planned = installments.reduce((sum, i) => sum + cents(i.amount), 0);

  const input = () => ({
    supplierId,
    invoiceNumber,
    invoiceSeries,
    invoiceKey: purchase?.invoiceKey ?? '',
    issuedOn: issuedOn || null,
    enteredOn,
    freight: optionalMoney(freight),
    otherCosts: optionalMoney(otherCosts),
    discount: optionalMoney(discount),
    accountId,
    categoryId,
    notes,
    items: items.map((i) => ({
      productId: i.productId || null,
      description: i.description,
      supplierCode: i.supplierCode,
      ean: i.ean,
      supplierUnit: i.supplierUnit,
      quantity: num(i.quantity),
      factor: num(i.factor),
      total: num(i.total),
      lot: i.lotCode || i.expiresOn ? { code: i.lotCode, expiresOn: i.expiresOn } : null,
    })),
    installments: installments.map((i) => ({ dueDate: i.dueDate, amount: num(i.amount) })),
  });

  const save = useMutation({
    mutationFn: async ({ confirm }: { confirm: boolean }) => {
      const parsed = purchaseInputSchema.safeParse(input());
      if (!parsed.success) {
        setErrors(issuesOf(parsed.error));
        throw new ApiRequestError(400, 'validation_failed', 'Confira os campos destacados.');
      }
      const saved = purchase
        ? await api('PUT', `/purchases/${purchase.id}`, purchaseSchema, parsed.data)
        : await api('POST', '/purchases', purchaseSchema, parsed.data);
      return confirm ? api('POST', `/purchases/${saved.id}/confirm`, purchaseSchema) : saved;
    },
    onSuccess: async (saved, { confirm }) => {
      queryClient.setQueryData(purchaseQuery(saved.id).queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: ['purchases', 'list'] });
      if (confirm) {
        await queryClient.invalidateQueries({ queryKey: ['products'] });
        await queryClient.invalidateQueries({ queryKey: ['finance'] });
        toast.success('Compra confirmada: estoque, custo e contas a pagar atualizados.');
      } else {
        toast.success('Rascunho salvo.');
      }
      if (!purchase) {
        void navigate({ to: '/estoque/compras/$purchaseId', params: { purchaseId: saved.id } });
      }
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.fieldErrors.length > 0) {
        setErrors(Object.fromEntries(e.fieldErrors.map((f) => [f.path, f.message])));
      }
    },
  });
  const generalError =
    save.isError && !(save.error instanceof ApiRequestError && save.error.fieldErrors.length > 0)
      ? errorMessage(save.error)
      : null;

  const supplierOptions = options.suppliers.map((s) => ({ value: s.id, label: s.name }));
  if (purchase && !options.suppliers.some((s) => s.id === purchase.supplier.id)) {
    supplierOptions.unshift({ value: purchase.supplier.id, label: purchase.supplier.name });
  }

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ confirm: false });
      }}
    >
      {generalError ? (
        <p role="alert" className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600">
          {generalError}
        </p>
      ) : null}

      <Section title="Nota" description="Fornecedor, datas e para onde vão as parcelas.">
        {purchase?.invoiceKey ? (
          <p className="mb-4 text-xs break-all text-ink-muted">
            Chave de acesso <span className="font-mono">{purchase.invoiceKey}</span>
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <SelectField
              label="Fornecedor"
              value={supplierId}
              placeholder="Escolha"
              options={supplierOptions}
              error={errors.supplierId}
              onChange={(e) => {
                setSupplierId(e.target.value);
                clear('supplierId');
              }}
            />
          </div>
          <TextField
            label="Número da nota"
            autoComplete="off"
            value={invoiceNumber}
            error={errors.invoiceNumber}
            onChange={(e) => {
              setInvoiceNumber(e.target.value);
            }}
          />
          <TextField
            label="Série"
            autoComplete="off"
            value={invoiceSeries}
            error={errors.invoiceSeries}
            onChange={(e) => {
              setInvoiceSeries(e.target.value);
            }}
          />
          <TextField
            label="Emissão"
            type="date"
            value={issuedOn}
            error={errors.issuedOn}
            onChange={(e) => {
              setIssuedOn(e.target.value);
              clear('issuedOn');
            }}
          />
          <TextField
            label="Entrada"
            type="date"
            value={enteredOn}
            error={errors.enteredOn}
            onChange={(e) => {
              setEnteredOn(e.target.value);
              clear('enteredOn');
            }}
          />
          <SelectField
            label="Conta de pagamento"
            value={accountId}
            placeholder="Escolha"
            options={options.accounts.map((a) => ({ value: a.id, label: a.name }))}
            error={errors.accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              clear('accountId');
            }}
          />
          <SelectField
            label="Categoria"
            value={categoryId}
            placeholder="Escolha"
            options={options.categories.map((c) => ({ value: c.id, label: c.name }))}
            error={errors.categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              clear('categoryId');
            }}
          />
        </div>
      </Section>

      <Section
        title="Itens"
        description="Escolha o produto da clínica de cada item. O fator converte a unidade da nota (ex. caixa com 10 = 10) e fica aprendido para a próxima nota deste fornecedor."
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus className="size-4" aria-hidden />}
            onClick={() => {
              setItems((all) => [...all, emptyItem()]);
            }}
          >
            Adicionar item
          </Button>
        }
      >
        {errors.items ? (
          <p role="alert" className="mb-3 text-xs font-medium text-danger-600">
            {errors.items}
          </p>
        ) : null}
        <ol className="space-y-4">
          {items.map((item, index) => (
            <ItemEditor
              key={item.key}
              item={item}
              index={index}
              options={options}
              errors={errors}
              canRemove={items.length > 1}
              onChange={(patch, field) => {
                setItem(item.key, patch, field);
              }}
              onRemove={() => {
                setItems((all) => all.filter((i) => i.key !== item.key));
                setErrors({});
              }}
            />
          ))}
        </ol>
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section
          title="Totais"
          description="Frete, outras despesas e desconto entram no custo dos itens."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField
              label="Frete"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              value={freight}
              error={errors.freight}
              onChange={(e) => {
                setFreight(e.target.value);
                clear('freight');
              }}
            />
            <TextField
              label="Outras despesas"
              hint="Seguro, IPI, ST"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              value={otherCosts}
              error={errors.otherCosts}
              onChange={(e) => {
                setOtherCosts(e.target.value);
                clear('otherCosts');
              }}
            />
            <TextField
              label="Desconto"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              value={discount}
              error={errors.discount}
              onChange={(e) => {
                setDiscount(e.target.value);
                clear('discount');
              }}
            />
          </div>
          <dl
            className="mt-4 space-y-1.5 border-t border-line pt-3 text-sm"
            aria-label="Totais da compra"
          >
            <div className="flex justify-between">
              <dt className="text-ink-muted">Itens</dt>
              <dd className="font-mono tabular-nums">{formatMoney(itemsTotal / 100)}</dd>
            </div>
            <div className="flex justify-between font-medium">
              <dt>Total da compra</dt>
              <dd className="font-mono tabular-nums">{formatMoney(total / 100)}</dd>
            </div>
          </dl>
        </Section>

        <Section
          title="Parcelas a pagar"
          description="Sem parcelas, a compra vira uma conta a pagar na data de entrada."
          actions={
            <Button
              variant="secondary"
              size="sm"
              icon={<Plus className="size-4" aria-hidden />}
              onClick={() => {
                const left = Math.max(0, total - planned);
                setInstallments((all) => [
                  ...all,
                  {
                    key: newKey(),
                    dueDate: all.at(-1)?.dueDate ?? enteredOn,
                    amount: left > 0 ? moneyInput(left / 100) : '',
                  },
                ]);
                clear('installments');
              }}
            >
              Adicionar parcela
            </Button>
          }
        >
          {installments.length === 0 ? (
            <p className="text-sm text-ink-muted">
              Uma parcela de {formatMoney(total / 100)} em {formatCalendarDate(enteredOn)}.
            </p>
          ) : (
            <ol className="space-y-3">
              {installments.map((inst, index) => (
                <li
                  key={inst.key}
                  className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2 sm:gap-3"
                >
                  <span className="pb-2.5 text-sm text-ink-muted tabular-nums">{index + 1}ª</span>
                  <TextField
                    label="Vencimento"
                    type="date"
                    value={inst.dueDate}
                    error={errors[`installments.${String(index)}.dueDate`]}
                    onChange={(e) => {
                      const dueDate = e.target.value;
                      setInstallments((all) =>
                        all.map((i) => (i.key === inst.key ? { ...i, dueDate } : i)),
                      );
                    }}
                  />
                  <TextField
                    label="Valor"
                    inputMode="decimal"
                    autoComplete="off"
                    value={inst.amount}
                    error={errors[`installments.${String(index)}.amount`]}
                    onChange={(e) => {
                      const amount = e.target.value;
                      setInstallments((all) =>
                        all.map((i) => (i.key === inst.key ? { ...i, amount } : i)),
                      );
                      clear('installments');
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remover parcela ${String(index + 1)}`}
                    className="mb-1"
                    onClick={() => {
                      setInstallments((all) => all.filter((i) => i.key !== inst.key));
                      setErrors({});
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ol>
          )}
          {installments.length > 0 && planned !== total ? (
            <p className="mt-3 text-xs text-amber-700">
              As parcelas somam {formatMoney(planned / 100)}; faltam{' '}
              {formatMoney((total - planned) / 100)} para fechar com o total.
            </p>
          ) : null}
          {errors.installments ? (
            <p role="alert" className="mt-3 text-xs font-medium text-danger-600">
              {errors.installments}
            </p>
          ) : null}
        </Section>
      </div>

      <Section title="Observações">
        <TextareaField
          label="Observações"
          value={notes}
          error={errors.notes}
          onChange={(e) => {
            setNotes(e.target.value);
          }}
        />
      </Section>

      <FormActions>
        {purchase ? (
          <Button
            variant="ghost"
            className="mr-auto"
            onClick={() => {
              setDiscarding(true);
            }}
          >
            Descartar
          </Button>
        ) : null}
        <Button
          type="submit"
          variant="secondary"
          pending={save.isPending && !save.variables.confirm}
        >
          Salvar rascunho
        </Button>
        {purchase ? (
          <Button
            pending={save.isPending && save.variables.confirm}
            onClick={() => {
              save.mutate({ confirm: true });
            }}
          >
            Confirmar compra
          </Button>
        ) : null}
      </FormActions>

      {discarding && purchase ? (
        <CancelDialog
          purchase={purchase}
          onClose={() => {
            setDiscarding(false);
          }}
        />
      ) : null}
    </form>
  );
}

function ItemEditor({
  item,
  index,
  options,
  errors,
  canRemove,
  onChange,
  onRemove,
}: {
  item: ItemState;
  index: number;
  options: PurchaseOptions;
  errors: Errors;
  canRemove: boolean;
  onChange: (patch: Partial<ItemState>, field?: string) => void;
  onRemove: () => void;
}) {
  const path = (field: string) => `items.${String(index)}.${field}`;
  const product = options.products.find((p) => p.id === item.productId);
  const quantity = parseDecimal(item.quantity);
  const factor = parseDecimal(item.factor);
  const units =
    quantity !== null && factor !== null && quantity > 0 && factor > 0
      ? Math.round(quantity * factor * 1000) / 1000
      : null;
  const showLot = Boolean(product?.tracksLots || item.lotCode || item.expiresOn);
  const unitName = item.supplierUnit || 'unidade da nota';
  return (
    <li className="rounded-control border border-line p-4" aria-label={`Item ${String(index + 1)}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-ink-muted">
            Item {index + 1}
            {item.supplierCode ? ` · código ${item.supplierCode}` : ''}
            {item.ean ? ` · EAN ${item.ean}` : ''}
          </p>
        </div>
        {canRemove ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Remover item ${String(index + 1)}`}
            onClick={onRemove}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        ) : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Produto da clínica"
          value={item.productId}
          placeholder="Escolha o produto"
          options={options.products.map((p) => ({ value: p.id, label: `${p.name} (${p.unit})` }))}
          error={errors[path('productId')]}
          onChange={(e) => {
            const chosen = options.products.find((p) => p.id === e.target.value);
            onChange(
              {
                productId: e.target.value,
                ...(item.description || !chosen ? {} : { description: chosen.name }),
              },
              path('productId'),
            );
          }}
        />
        <TextField
          label="Descrição na nota"
          autoComplete="off"
          value={item.description}
          error={errors[path('description')]}
          onChange={(e) => {
            onChange({ description: e.target.value }, path('description'));
          }}
        />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <TextField
          label="Quantidade"
          inputMode="decimal"
          autoComplete="off"
          value={item.quantity}
          error={errors[path('quantity')]}
          onChange={(e) => {
            onChange({ quantity: e.target.value }, path('quantity'));
          }}
        />
        <TextField
          label="Unidade da nota"
          autoComplete="off"
          placeholder="UN, CX, SC"
          value={item.supplierUnit}
          error={errors[path('supplierUnit')]}
          onChange={(e) => {
            onChange({ supplierUnit: e.target.value });
          }}
        />
        <TextField
          label="Fator"
          hint={product ? `${product.unit} por ${unitName}` : undefined}
          inputMode="decimal"
          autoComplete="off"
          value={item.factor}
          error={errors[path('factor')]}
          onChange={(e) => {
            onChange({ factor: e.target.value }, path('factor'));
          }}
        />
        <TextField
          label="Valor total"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0,00"
          value={item.total}
          error={errors[path('total')]}
          onChange={(e) => {
            onChange({ total: e.target.value }, path('total'));
          }}
        />
      </div>
      {showLot ? (
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <TextField
            label="Lote"
            autoComplete="off"
            value={item.lotCode}
            error={errors[path('lot.code')] ?? errors[path('lot')]}
            onChange={(e) => {
              onChange({ lotCode: e.target.value }, path('lot.code'));
            }}
          />
          <TextField
            label="Validade"
            type="date"
            value={item.expiresOn}
            error={errors[path('lot.expiresOn')]}
            onChange={(e) => {
              onChange({ expiresOn: e.target.value }, path('lot.expiresOn'));
            }}
          />
        </div>
      ) : null}
      {product && units !== null ? (
        <p className="mt-3 text-xs text-ink-muted">
          {product.tracksStock
            ? `Entra no estoque: ${quantityInput(units)} ${product.unit}.`
            : 'Este produto não controla estoque; a compra atualiza só o custo.'}
        </p>
      ) : null}
    </li>
  );
}

// Consulta -------------------------------------------------------------------------------------------

function PurchaseView({ purchase: p }: { purchase: Purchase }) {
  const can = useCan();
  const [cancelling, setCancelling] = useState(false);
  const extras = p.total - p.itemsTotal;
  return (
    <div className="space-y-5">
      <Section title="Nota">
        <Facts
          items={[
            { label: 'Fornecedor', value: p.supplier.name },
            {
              label: 'Nota',
              value: p.invoiceNumber
                ? `${p.invoiceNumber}${p.invoiceSeries ? ` · série ${p.invoiceSeries}` : ''}`
                : null,
            },
            { label: 'Emissão', value: p.issuedOn ? formatCalendarDate(p.issuedOn) : null },
            { label: 'Entrada', value: formatCalendarDate(p.enteredOn) },
            { label: 'Conta de pagamento', value: p.account.name },
            { label: 'Categoria', value: p.category.name },
            ...(p.invoiceKey
              ? [
                  {
                    label: 'Chave de acesso',
                    value: <span className="font-mono text-xs">{p.invoiceKey}</span>,
                  },
                ]
              : []),
            ...(p.confirmedAt
              ? [
                  {
                    label: 'Confirmada',
                    value: `${formatDateTime(p.confirmedAt)} por ${p.confirmedBy ?? ''}`,
                  },
                ]
              : []),
            ...(p.cancelledAt
              ? [
                  { label: 'Cancelada', value: formatDateTime(p.cancelledAt) },
                  { label: 'Motivo do cancelamento', value: p.cancelReason },
                ]
              : []),
            ...(p.notes ? [{ label: 'Observações', value: p.notes }] : []),
          ]}
        />
      </Section>

      <Panel>
        <h2 className="border-b border-line px-5 py-3.5 font-display text-[15px] font-semibold">
          Itens
        </h2>
        <DataTable
          caption="Itens da compra"
          rows={p.items}
          rowKey={(i) => i.id}
          columns={[
            {
              header: 'Produto',
              cell: (i) => (
                <div className="min-w-0">
                  {i.product ? (
                    <Link
                      to="/estoque/produtos/$productId"
                      params={{ productId: i.product.id }}
                      className={linkClass}
                    >
                      {i.product.name}
                    </Link>
                  ) : (
                    <span className="text-ink-muted">Sem produto</span>
                  )}
                  <p className="text-xs text-ink-muted">
                    {i.description}
                    {i.lot
                      ? ` · lote ${i.lot.code}, validade ${formatCalendarDate(i.lot.expiresOn)}`
                      : ''}
                  </p>
                </div>
              ),
            },
            {
              header: 'Na nota',
              cell: (i) => `${quantityInput(i.quantity)} ${i.supplierUnit}`.trim(),
              hideOnMobile: true,
              className: 'whitespace-nowrap',
            },
            {
              header: 'No estoque',
              cell: (i) =>
                i.product
                  ? `${quantityInput(Math.round(i.quantity * i.factor * 1000) / 1000)} ${i.product.unit}`
                  : '',
              className: 'whitespace-nowrap',
            },
            ...(can('products.view_cost')
              ? [
                  {
                    header: 'Custo unitário',
                    cell: (i: Purchase['items'][number]) =>
                      i.unitCost === null ? (
                        ''
                      ) : (
                        <span className="font-mono tabular-nums">{formatMoney(i.unitCost)}</span>
                      ),
                    hideOnMobile: true,
                    className: 'text-right',
                  },
                ]
              : []),
            {
              header: 'Total',
              cell: (i) => <span className="font-mono tabular-nums">{formatMoney(i.total)}</span>,
              className: 'text-right whitespace-nowrap',
            },
          ]}
        />
        <dl
          className="space-y-1.5 border-t border-line px-5 py-3 text-sm"
          aria-label="Totais da compra"
        >
          <div className="flex justify-between">
            <dt className="text-ink-muted">Itens</dt>
            <dd className="font-mono tabular-nums">{formatMoney(p.itemsTotal)}</dd>
          </div>
          {extras !== 0 ? (
            <div className="flex justify-between">
              <dt className="text-ink-muted">Frete, despesas e desconto</dt>
              <dd className="font-mono tabular-nums">{formatMoney(extras)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between font-medium">
            <dt>Total da compra</dt>
            <dd className="font-mono tabular-nums">{formatMoney(p.total)}</dd>
          </div>
        </dl>
      </Panel>

      {p.entries.length > 0 ? (
        <Panel>
          <h2 className="border-b border-line px-5 py-3.5 font-display text-[15px] font-semibold">
            Contas a pagar
          </h2>
          <DataTable
            caption="Parcelas lançadas no financeiro"
            rows={p.entries}
            rowKey={(e) => e.id}
            columns={[
              {
                header: 'Parcela',
                cell: (e) => (e.installment ? `${String(e.installment)}ª` : 'Única'),
              },
              {
                header: 'Vencimento',
                cell: (e) => (
                  <>
                    {formatCalendarDate(e.dueDate)}
                    <span className="block text-xs text-ink-muted md:hidden">
                      {entryLabel[e.status]}
                    </span>
                  </>
                ),
              },
              {
                header: 'Valor',
                cell: (e) => (
                  <span className="font-mono tabular-nums">{formatMoney(e.amount)}</span>
                ),
                className: 'text-right whitespace-nowrap',
              },
              {
                header: 'Situação',
                cell: (e) => (
                  <Badge
                    tone={e.status === 'paid' ? 'sage' : e.status === 'open' ? 'amber' : 'neutral'}
                  >
                    {entryLabel[e.status]}
                  </Badge>
                ),
                hideOnMobile: true,
              },
            ]}
          />
        </Panel>
      ) : null}

      {p.status === 'confirmed' && can('purchases.manage') ? (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            onClick={() => {
              setCancelling(true);
            }}
          >
            Cancelar compra
          </Button>
        </div>
      ) : null}
      {cancelling ? (
        <CancelDialog
          purchase={p}
          onClose={() => {
            setCancelling(false);
          }}
        />
      ) : null}
    </div>
  );
}

function CancelDialog({ purchase, onClose }: { purchase: Purchase; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const draft = purchase.status === 'draft';
  const cancel = useMutation({
    mutationFn: (body: { reason: string }) =>
      api('POST', `/purchases/${purchase.id}/cancel`, purchaseSchema, body),
    onSuccess: async (saved) => {
      queryClient.setQueryData(purchaseQuery(saved.id).queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: ['purchases', 'list'] });
      if (!draft) {
        await queryClient.invalidateQueries({ queryKey: ['products'] });
        await queryClient.invalidateQueries({ queryKey: ['finance'] });
      }
      toast.success(draft ? 'Rascunho descartado.' : 'Compra cancelada.');
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={draft ? 'Descartar rascunho' : `Cancelar compra ${String(purchase.code)}`}
      description={
        draft
          ? 'O rascunho fica na lista como cancelado, sem mexer no estoque nem no financeiro.'
          : 'Tira do estoque o que esta compra trouxe e cancela as parcelas em aberto. Parcela já paga precisa ter a baixa desfeita antes.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button
            variant="danger"
            pending={cancel.isPending}
            onClick={() => {
              const parsed = purchaseCancelSchema.safeParse({ reason });
              if (!parsed.success) {
                setError(parsed.error.issues[0]?.message);
                return;
              }
              cancel.mutate(parsed.data);
            }}
          >
            {draft ? 'Descartar' : 'Cancelar compra'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {cancel.isError ? (
          <p
            role="alert"
            className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600"
          >
            {errorMessage(cancel.error)}
          </p>
        ) : null}
        <TextField
          label="Motivo"
          autoComplete="off"
          value={reason}
          error={error}
          onChange={(e) => {
            setReason(e.target.value);
            setError(undefined);
          }}
        />
      </div>
    </Dialog>
  );
}
