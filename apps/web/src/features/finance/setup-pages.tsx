import {
  categoryKindLabels,
  financialAccountInputSchema,
  financialAccountKindLabels,
  financialAccountKinds,
  financialAccountSchema,
  financialCategoryInputSchema,
  financialCategorySchema,
  supplierInputSchema,
  supplierSchema,
  type CategoryKind,
  type FinancialAccount,
  type FinancialAccountKind,
  type FinancialCategory,
  type Supplier,
} from '@clinica/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Landmark, ListTree, Plus, Search, Truck } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { z } from 'zod';
import { Button } from '../../design-system/button';
import { Checkbox } from '../../design-system/checkbox';
import { Dialog } from '../../design-system/dialog';
import { SearchField, SelectField, TextareaField, TextField } from '../../design-system/field';
import { Badge, PageHeader, Section } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { useToast } from '../../design-system/toast';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { formatCalendarDate } from '../../lib/format';
import { useCan } from '../../lib/session';
import { formatDocument, formatPhone } from '../clients/format';
import { formatMoney, moneyInput, parseDecimal } from '../products/format';
import { accountsQuery, categoriesQuery, financeOptionsQuery, suppliersQuery } from './queries';

type Errors = Record<string, string>;

/** Diálogo de cadastro com erros por campo vindos do Zod ou da API. */
function useSave<T>(request: (body: T) => Promise<unknown>, success: string, onDone: () => void) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<Errors>({});
  const mutation = useMutation({
    mutationFn: request,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance'] });
      toast.success(success);
      onDone();
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.fieldErrors.length > 0) {
        setErrors(Object.fromEntries(e.fieldErrors.map((f) => [f.path, f.message])));
      }
    },
  });
  const validate = (schema: z.ZodType, value: unknown) => {
    const parsed = schema.safeParse(value);
    if (parsed.success) {
      setErrors({});
      mutation.mutate(parsed.data as T);
      return;
    }
    const found: Errors = {};
    for (const issue of parsed.error.issues) found[issue.path.join('.')] ??= issue.message;
    setErrors(found);
  };
  const generalError =
    mutation.isError &&
    !(mutation.error instanceof ApiRequestError && mutation.error.fieldErrors.length > 0)
      ? errorMessage(mutation.error)
      : null;
  return { mutation, errors, validate, generalError };
}

function EditDialog({
  id,
  title,
  pending,
  generalError,
  onClose,
  onSubmit,
  children,
}: {
  id: string;
  title: string;
  pending: boolean;
  generalError: string | null;
  onClose: () => void;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={id} pending={pending}>
            Salvar
          </Button>
        </>
      }
    >
      <form
        id={id}
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        {generalError ? (
          <p
            role="alert"
            className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600"
          >
            {generalError}
          </p>
        ) : null}
        {children}
      </form>
    </Dialog>
  );
}

function AddButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={<Plus className="size-4" aria-hidden />}
      onClick={onClick}
    >
      Adicionar
    </Button>
  );
}

function EditButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" aria-label={`Editar ${name}`} onClick={onClick}>
      Editar
    </Button>
  );
}

// Contas -------------------------------------------------------------------------------------------

/** Contas financeiras [p.18]: banco, dinheiro e outras, com saldo inicial. */
export function AccountsPage() {
  const accounts = useQuery(accountsQuery);
  const options = useQuery(financeOptionsQuery);
  const can = useCan();
  const [editing, setEditing] = useState<FinancialAccount | null | undefined>(undefined);
  return (
    <>
      <PageHeader
        area="Financeiro"
        title="Contas financeiras"
        description="Cada conta bancária, o dinheiro do caixa e outras carteiras. O saldo é o inicial mais os lançamentos pagos; o previsto soma o que está em aberto."
      />
      <Section
        title="Contas"
        actions={
          can('finance.configure') && options.data ? (
            <AddButton
              onClick={() => {
                setEditing(null);
              }}
            />
          ) : null
        }
      >
        {accounts.isPending ? (
          <SkeletonRows rows={3} columns={2} />
        ) : accounts.isError ? (
          <ErrorState
            message={errorMessage(accounts.error)}
            onRetry={() => void accounts.refetch()}
          />
        ) : accounts.data.length === 0 ? (
          <EmptyState
            icon={Landmark}
            title="Nenhuma conta"
            description="Cadastre a conta do banco e o caixa."
          />
        ) : (
          <ul className="-mx-2 divide-y divide-line">
            {accounts.data.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{a.name}</span>
                  <span className="block truncate text-xs text-ink-muted">
                    {financialAccountKindLabels[a.kind]} · saldo inicial{' '}
                    {formatMoney(a.openingBalance)} em {formatCalendarDate(a.openingDate)}
                  </span>
                </span>
                {a.archived ? <Badge>Arquivada</Badge> : null}
                <span className="text-right">
                  <span
                    className={`block font-mono text-sm tabular-nums ${a.balance < 0 ? 'text-danger-600' : ''}`}
                  >
                    {formatMoney(a.balance)}
                  </span>
                  <span className="block text-xs text-ink-muted">
                    Previsto {formatMoney(a.forecast)}
                  </span>
                </span>
                {can('finance.configure') ? (
                  <EditButton
                    name={a.name}
                    onClick={() => {
                      setEditing(a);
                    }}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {editing !== undefined && options.data ? (
        <AccountDialog
          account={editing}
          today={options.data.today}
          onClose={() => {
            setEditing(undefined);
          }}
        />
      ) : null}
    </>
  );
}

function AccountDialog({
  account,
  today,
  onClose,
}: {
  account: FinancialAccount | null;
  today: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(account?.name ?? '');
  const [kind, setKind] = useState<FinancialAccountKind>(account?.kind ?? 'bank');
  const [opening, setOpening] = useState(moneyInput(account?.openingBalance ?? 0));
  const [openingDate, setOpeningDate] = useState(account?.openingDate ?? today);
  const [archived, setArchived] = useState(account?.archived ?? false);
  const { mutation, errors, validate, generalError } = useSave(
    (body: z.output<typeof financialAccountInputSchema>) =>
      account
        ? api('PUT', `/finance/accounts/${account.id}`, financialAccountSchema, body)
        : api('POST', '/finance/accounts', financialAccountSchema, body),
    account ? 'Conta alterada.' : 'Conta incluída.',
    onClose,
  );
  return (
    <EditDialog
      id="account-form"
      title={account ? `Editar ${account.name}` : 'Nova conta'}
      pending={mutation.isPending}
      generalError={generalError}
      onClose={onClose}
      onSubmit={() => {
        validate(financialAccountInputSchema, {
          name,
          kind,
          openingBalance: parseDecimal(opening) ?? 0,
          openingDate,
          archived,
        });
      }}
    >
      <TextField
        label="Nome"
        autoComplete="off"
        placeholder="Ex.: Banco do Brasil, Caixa da recepção"
        value={name}
        error={errors.name}
        onChange={(e) => {
          setName(e.target.value);
        }}
      />
      <SelectField
        label="Tipo"
        value={kind}
        options={financialAccountKinds.map((k) => ({
          value: k,
          label: financialAccountKindLabels[k],
        }))}
        hint="As vendas em dinheiro entram na primeira conta do tipo Dinheiro; as demais, na primeira conta bancária."
        onChange={(e) => {
          setKind(e.target.value as FinancialAccountKind);
        }}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Saldo inicial"
          inputMode="decimal"
          autoComplete="off"
          value={opening}
          error={errors.openingBalance}
          hint="Negativo se a conta começa no cheque especial."
          onChange={(e) => {
            setOpening(e.target.value);
          }}
        />
        <TextField
          label="Data do saldo inicial"
          type="date"
          value={openingDate}
          error={errors.openingDate}
          onChange={(e) => {
            setOpeningDate(e.target.value);
          }}
        />
      </div>
      {account ? (
        <Checkbox
          label="Arquivada"
          description="Some dos lançamentos novos; o histórico continua nela."
          checked={archived}
          onCheckedChange={setArchived}
        />
      ) : null}
    </EditDialog>
  );
}

// Plano de contas ----------------------------------------------------------------------------------

/** Plano de contas [p.18]: categorias de receita e despesa com um nível de subcategoria. */
export function CategoriesPage() {
  const categories = useQuery(categoriesQuery);
  const can = useCan();
  const [editing, setEditing] = useState<
    { category: FinancialCategory | null; kind: CategoryKind; parentId: string | null } | undefined
  >(undefined);
  const configure = can('finance.configure');
  return (
    <>
      <PageHeader
        area="Financeiro"
        title="Plano de contas"
        description="Categorias que organizam receitas e despesas nos lançamentos e relatórios. Vendas e Taxas de cartão são usadas pelos lançamentos automáticos das vendas."
      />
      {categories.isPending ? (
        <SkeletonRows rows={6} columns={2} />
      ) : categories.isError ? (
        <ErrorState
          message={errorMessage(categories.error)}
          onRetry={() => void categories.refetch()}
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {(['income', 'expense'] as const).map((kind) => {
            const roots = categories.data.filter((c) => c.kind === kind && !c.parentId);
            return (
              <Section
                key={kind}
                title={kind === 'income' ? 'Receitas' : 'Despesas'}
                actions={
                  configure ? (
                    <AddButton
                      onClick={() => {
                        setEditing({ category: null, kind, parentId: null });
                      }}
                    />
                  ) : null
                }
              >
                {roots.length === 0 ? (
                  <EmptyState
                    icon={ListTree}
                    title="Nenhuma categoria"
                    description="Adicione a primeira."
                  />
                ) : (
                  <ul
                    className="-mx-2 divide-y divide-line"
                    aria-label={`Categorias de ${kind === 'income' ? 'receita' : 'despesa'}`}
                  >
                    {roots.map((root) => (
                      <li key={root.id} className="py-1">
                        <CategoryRow
                          category={root}
                          configure={configure}
                          onEdit={() => {
                            setEditing({ category: root, kind, parentId: null });
                          }}
                          onAddChild={() => {
                            setEditing({ category: null, kind, parentId: root.id });
                          }}
                        />
                        {categories.data
                          .filter((c) => c.parentId === root.id)
                          .map((child) => (
                            <div key={child.id} className="pl-6">
                              <CategoryRow
                                category={child}
                                configure={configure}
                                onEdit={() => {
                                  setEditing({ category: child, kind, parentId: root.id });
                                }}
                              />
                            </div>
                          ))}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            );
          })}
        </div>
      )}
      {editing && categories.data ? (
        <CategoryDialog
          {...editing}
          all={categories.data}
          onClose={() => {
            setEditing(undefined);
          }}
        />
      ) : null}
    </>
  );
}

function CategoryRow({
  category: c,
  configure,
  onEdit,
  onAddChild,
}: {
  category: FinancialCategory;
  configure: boolean;
  onEdit: () => void;
  onAddChild?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <span
        className={`min-w-0 flex-1 truncate text-sm ${c.parentId ? '' : 'font-medium'} ${c.archived ? 'text-ink-muted line-through' : ''}`}
      >
        {c.name}
      </span>
      {c.system ? <Badge tone="sage">Automática</Badge> : null}
      {c.archived ? <Badge>Arquivada</Badge> : null}
      {configure && onAddChild ? (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Adicionar subcategoria em ${c.name}`}
          icon={<Plus className="size-4" aria-hidden />}
          onClick={onAddChild}
        />
      ) : null}
      {configure ? <EditButton name={c.name} onClick={onEdit} /> : null}
    </div>
  );
}

function CategoryDialog({
  category,
  kind: initialKind,
  parentId: initialParent,
  all,
  onClose,
}: {
  category: FinancialCategory | null;
  kind: CategoryKind;
  parentId: string | null;
  all: FinancialCategory[];
  onClose: () => void;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [kind] = useState<CategoryKind>(initialKind);
  const [parentId, setParentId] = useState(initialParent ?? '');
  const [archived, setArchived] = useState(category?.archived ?? false);
  const hasChildren = category ? all.some((c) => c.parentId === category.id) : false;
  const parents = all.filter(
    (c) => c.kind === kind && !c.parentId && c.id !== category?.id && !c.archived,
  );
  const { mutation, errors, validate, generalError } = useSave(
    (body: z.output<typeof financialCategoryInputSchema>) =>
      category
        ? api('PUT', `/finance/categories/${category.id}`, financialCategorySchema, body)
        : api('POST', '/finance/categories', financialCategorySchema, body),
    category ? 'Categoria alterada.' : 'Categoria incluída.',
    onClose,
  );
  const noun = categoryKindLabels[kind].toLowerCase();
  return (
    <EditDialog
      id="category-form"
      title={category ? `Editar ${category.name}` : `Nova categoria de ${noun}`}
      pending={mutation.isPending}
      generalError={generalError}
      onClose={onClose}
      onSubmit={() => {
        validate(financialCategoryInputSchema, {
          name,
          kind,
          parentId: parentId || null,
          archived,
        });
      }}
    >
      <TextField
        label="Nome"
        autoComplete="off"
        value={name}
        error={errors.name}
        onChange={(e) => {
          setName(e.target.value);
        }}
      />
      {category?.system || hasChildren ? null : (
        <SelectField
          label="Dentro de"
          value={parentId}
          placeholder="Nenhuma (categoria principal)"
          options={parents.map((p) => ({ value: p.id, label: p.name }))}
          error={errors.parentId}
          onChange={(e) => {
            setParentId(e.target.value);
          }}
        />
      )}
      {category && !category.system ? (
        <Checkbox
          label="Arquivada"
          description="Some dos lançamentos novos; o histórico continua com ela."
          checked={archived}
          onCheckedChange={setArchived}
        />
      ) : null}
    </EditDialog>
  );
}

// Fornecedores -------------------------------------------------------------------------------------

/** Fornecedores [p.18]: quem recebe as contas a pagar. */
export function SuppliersPage() {
  const suppliers = useQuery(suppliersQuery);
  const can = useCan();
  const [term, setTerm] = useState('');
  const [editing, setEditing] = useState<Supplier | null | undefined>(undefined);
  const needle = term.trim().toLowerCase();
  const shown = (suppliers.data ?? []).filter(
    (s) =>
      !needle ||
      s.name.toLowerCase().includes(needle) ||
      (needle.replace(/\D/g, '') !== '' && s.document.includes(needle.replace(/\D/g, ''))),
  );
  return (
    <>
      <PageHeader
        area="Financeiro"
        title="Fornecedores"
        description="Empresas e pessoas a quem a clínica paga: distribuidoras, laboratórios, prestadores e o proprietário do imóvel."
      />
      <Section
        title="Cadastrados"
        actions={
          can('finance.configure') ? (
            <AddButton
              onClick={() => {
                setEditing(null);
              }}
            />
          ) : null
        }
      >
        <SearchField
          label="Buscar fornecedor"
          icon={<Search className="size-4" aria-hidden />}
          placeholder="Nome, CPF ou CNPJ"
          className="mb-3"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
          }}
        />
        {suppliers.isPending ? (
          <SkeletonRows rows={4} columns={2} />
        ) : suppliers.isError ? (
          <ErrorState
            message={errorMessage(suppliers.error)}
            onRetry={() => void suppliers.refetch()}
          />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={Truck}
            title={needle ? 'Nenhum fornecedor nesta busca' : 'Nenhum fornecedor'}
            description="Cadastre quem recebe as contas a pagar para filtrar e buscar os lançamentos."
          />
        ) : (
          <ul className="-mx-2 divide-y divide-line">
            {shown.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-2 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{s.name}</span>
                  <span className="block truncate text-xs text-ink-muted">
                    {[formatDocument(s.document), s.phone ? formatPhone(s.phone) : null, s.email]
                      .filter(Boolean)
                      .join(' · ') || 'Sem contato cadastrado'}
                  </span>
                </span>
                {s.archived ? <Badge>Arquivado</Badge> : null}
                {can('finance.configure') ? (
                  <EditButton
                    name={s.name}
                    onClick={() => {
                      setEditing(s);
                    }}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {editing !== undefined ? (
        <SupplierDialog
          supplier={editing}
          onClose={() => {
            setEditing(undefined);
          }}
        />
      ) : null}
    </>
  );
}

function SupplierDialog({ supplier, onClose }: { supplier: Supplier | null; onClose: () => void }) {
  const [name, setName] = useState(supplier?.name ?? '');
  const [document, setDocument] = useState(formatDocument(supplier?.document ?? null) ?? '');
  const [phone, setPhone] = useState(supplier?.phone ? formatPhone(supplier.phone) : '');
  const [email, setEmail] = useState(supplier?.email ?? '');
  const [notes, setNotes] = useState(supplier?.notes ?? '');
  const [archived, setArchived] = useState(supplier?.archived ?? false);
  const { mutation, errors, validate, generalError } = useSave(
    (body: z.output<typeof supplierInputSchema>) =>
      supplier
        ? api('PUT', `/finance/suppliers/${supplier.id}`, supplierSchema, body)
        : api('POST', '/finance/suppliers', supplierSchema, body),
    supplier ? 'Fornecedor alterado.' : 'Fornecedor incluído.',
    onClose,
  );
  return (
    <EditDialog
      id="supplier-form"
      title={supplier ? `Editar ${supplier.name}` : 'Novo fornecedor'}
      pending={mutation.isPending}
      generalError={generalError}
      onClose={onClose}
      onSubmit={() => {
        validate(supplierInputSchema, { name, document, phone, email, notes, archived });
      }}
    >
      <TextField
        label="Nome ou razão social"
        autoComplete="off"
        value={name}
        error={errors.name}
        onChange={(e) => {
          setName(e.target.value);
        }}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="CPF ou CNPJ"
          inputMode="numeric"
          autoComplete="off"
          value={document}
          error={errors.document}
          onChange={(e) => {
            setDocument(e.target.value);
          }}
        />
        <TextField
          label="Telefone"
          inputMode="tel"
          autoComplete="off"
          value={phone}
          error={errors.phone}
          onChange={(e) => {
            setPhone(e.target.value);
          }}
        />
      </div>
      <TextField
        label="E-mail"
        type="email"
        autoComplete="off"
        value={email}
        error={errors.email}
        onChange={(e) => {
          setEmail(e.target.value);
        }}
      />
      <TextareaField
        label="Observações"
        rows={2}
        value={notes}
        error={errors.notes}
        onChange={(e) => {
          setNotes(e.target.value);
        }}
      />
      {supplier ? (
        <Checkbox
          label="Arquivado"
          description="Some dos lançamentos novos; o histórico continua com ele."
          checked={archived}
          onCheckedChange={setArchived}
        />
      ) : null}
    </EditDialog>
  );
}
