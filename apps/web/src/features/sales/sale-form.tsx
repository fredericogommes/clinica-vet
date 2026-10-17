import {
  saleInputSchema,
  saleTotals,
  saleTypeLabels,
  saleTypes,
  saleUnitLabels,
  type DiscountMode,
  type Sale,
  type SaleContext,
  type SaleData,
  type SaleType,
  type SellableItem,
  type StockSummary,
} from '@clinica/contracts';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Search, Trash2, UserRound, X } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Button } from '../../design-system/button';
import {
  SearchField,
  Segmented,
  SelectField,
  TextareaField,
  TextField,
} from '../../design-system/field';
import { Badge, Section } from '../../design-system/layout';
import { errorMessage } from '../../lib/api';
import { useCan, useSession } from '../../lib/session';
import { useDebounced } from '../../lib/use-debounced';
import { clientQuery, clientsQuery } from '../clients/queries';
import {
  formatMoney,
  formatPercent,
  moneyInput,
  parseDecimal,
  quantityInput,
} from '../products/format';
import { sellableQuery } from './queries';

interface Row {
  key: string;
  /** Id do item já gravado; preserva a origem dele (ex. lançado pela ficha clínica). */
  itemId: string | null;
  fromRecord: boolean;
  productId: string;
  code: number;
  name: string;
  kind: SellableItem['kind'];
  unit: SellableItem['unit'];
  listPrice: number;
  allowPriceChange: boolean;
  professionalId: string;
  quantity: string;
  unitPrice: string;
  /** Item que já estava gravado: o preço dele vai como está, mesmo que o cadastro mude. */
  saved: boolean;
  /** Disponível fora desta venda; nulo quando o item não controla estoque [RN-31]. */
  stock: StockSummary | null;
}

export interface SaleFormState {
  kind: 'quote' | 'sale';
  saleType: SaleType;
  client: { id: string; name: string; code: number } | null;
  patientId: string;
  rows: Row[];
  discountMode: DiscountMode;
  discountValue: string;
  notes: string;
}

let rowSeq = 0;
const nextKey = () => `row-${String(++rowSeq)}`;

export function emptySale(context: SaleContext): SaleFormState {
  return {
    kind: 'sale',
    saleType: context.defaultSaleType,
    client: null,
    patientId: '',
    rows: [],
    discountMode: 'amount',
    discountValue: '',
    notes: '',
  };
}

export function saleToForm(sale: Sale): SaleFormState {
  return {
    kind: sale.status === 'quote' ? 'quote' : 'sale',
    saleType: sale.saleType,
    client: sale.client,
    patientId: sale.patient?.id ?? '',
    rows: sale.items.map((i) => ({
      key: nextKey(),
      itemId: i.id,
      fromRecord: i.clinicalEventId !== null,
      productId: i.productId,
      code: i.code,
      name: i.name,
      kind: i.kind,
      unit: i.unit,
      listPrice: i.listPrice,
      allowPriceChange: i.allowPriceChange,
      professionalId: i.professional.id,
      quantity: quantityInput(i.quantity),
      unitPrice: moneyInput(i.unitPrice),
      saved: true,
      stock: i.stock,
    })),
    discountMode: sale.discount.mode,
    discountValue: sale.discount.value === 0 ? '' : moneyInput(sale.discount.value),
    notes: sale.notes,
  };
}

const num = (text: string) => parseDecimal(text) ?? Number.NaN;

/** Monta o corpo da requisição; a API recalcula tudo e é quem decide. */
function toInput(state: SaleFormState): unknown {
  return {
    kind: state.kind,
    saleType: state.saleType,
    clientId: state.client?.id ?? null,
    patientId: state.patientId || null,
    items: state.rows.map((r) => {
      const price = num(r.unitPrice);
      return {
        id: r.itemId,
        productId: r.productId,
        professionalId: r.professionalId,
        quantity: num(r.quantity),
        unitPrice:
          r.saved || Math.round(price * 100) !== Math.round(r.listPrice * 100) ? price : null,
      };
    }),
    discount: { mode: state.discountMode, value: parseDecimal(state.discountValue) ?? 0 },
    notes: state.notes,
  };
}

export type FieldErrors = Record<string, string>;

/** Valida com o contrato compartilhado antes de enviar; o servidor revalida. */
export function validateSale(state: SaleFormState): { data: SaleData } | { errors: FieldErrors } {
  const parsed = saleInputSchema.safeParse(toInput(state));
  if (parsed.success) return { data: parsed.data };
  const errors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const path = issue.path.join('.');
    errors[path] ??= issue.message;
  }
  return { errors };
}

export function SaleForm({
  state,
  onChange,
  errors,
  context,
  quoteLocked,
  extraProfessionals,
}: {
  state: SaleFormState;
  onChange: (next: SaleFormState) => void;
  errors: FieldErrors;
  context: SaleContext;
  /** Venda em aberto não volta a ser orçamento. */
  quoteLocked: boolean;
  /** Profissionais já gravados na venda que hoje estão inativos. */
  extraProfessionals: { id: string; name: string }[];
}) {
  const can = useCan();
  const session = useSession();
  const set = (patch: Partial<SaleFormState>) => {
    onChange({ ...state, ...patch });
  };
  const professionals = [
    ...context.professionals,
    ...extraProfessionals.filter((p) => !context.professionals.some((c) => c.id === p.id)),
  ];
  const defaultProfessional =
    professionals.find((p) => p.id === session.user.id)?.id ?? professionals[0]?.id ?? '';

  const addItem = (item: SellableItem) => {
    const same = state.rows.find(
      (r) => r.productId === item.id && r.professionalId === defaultProfessional && !r.saved,
    );
    if (same) {
      const q = num(same.quantity);
      set({
        rows: state.rows.map((r) =>
          r === same ? { ...r, quantity: quantityInput(Number.isNaN(q) ? 1 : q + 1) } : r,
        ),
      });
      return;
    }
    set({
      rows: [
        ...state.rows,
        {
          key: nextKey(),
          itemId: null,
          fromRecord: false,
          productId: item.id,
          code: item.code,
          name: item.name,
          kind: item.kind,
          unit: item.unit,
          listPrice: item.salePrice,
          allowPriceChange: item.allowPriceChange,
          professionalId: defaultProfessional,
          quantity: '1',
          unitPrice: moneyInput(item.salePrice),
          saved: false,
          stock: item.stock,
        },
      ],
    });
  };

  const preview = saleTotals(
    state.rows.map((r) => ({
      unitPrice: Number.isNaN(num(r.unitPrice)) ? 0 : num(r.unitPrice),
      quantity: Number.isNaN(num(r.quantity)) ? 0 : num(r.quantity),
    })),
    {
      mode: state.discountMode,
      value: Math.max(
        0,
        Number.isNaN(num(state.discountValue)) ? 0 : (parseDecimal(state.discountValue) ?? 0),
      ),
    },
  );
  const canDiscount = can('sales.discount');
  const canChangePrice = can('sales.change_price');

  return (
    <div className="space-y-5">
      <Section title="Venda">
        <div className={clsx('grid gap-4', !quoteLocked && '@2xl:grid-cols-[auto_1fr]')}>
          {quoteLocked ? null : (
            <Segmented
              label="Registrar como"
              value={state.kind}
              options={[
                { value: 'sale', label: 'Venda' },
                { value: 'quote', label: 'Orçamento' },
              ]}
              onChange={(kind) => {
                set({ kind });
              }}
            />
          )}
          <SelectField
            label="Tipo de venda"
            value={state.saleType}
            options={saleTypes.map((t) => ({ value: t, label: saleTypeLabels[t] }))}
            error={errors.saleType}
            onChange={(e) => {
              set({ saleType: e.target.value as SaleType });
            }}
          />
        </div>
        <div className="mt-4">
          <CustomerField state={state} set={set} errors={errors} />
        </div>
      </Section>

      <Section
        title="Produtos e serviços"
        description="Cada linha tem um profissional responsável: é dele a comissão do item."
      >
        <ItemSearch onPick={addItem} />
        {errors.items ? (
          <p role="alert" className="mt-2 text-xs font-medium text-danger-600">
            {errors.items}
          </p>
        ) : null}
        {state.rows.length > 0 ? (
          <ul
            className="mt-4 divide-y divide-line rounded-control border border-line"
            aria-label="Itens da venda"
          >
            {state.rows.map((row, i) => (
              <ItemRow
                key={row.key}
                row={row}
                index={i}
                errors={errors}
                professionals={professionals}
                gross={preview.items[i]?.grossCents ?? 0}
                wanted={
                  state.kind === 'sale'
                    ? state.rows
                        .filter((r) => r.productId === row.productId)
                        .reduce(
                          (a, r) => a + (Number.isNaN(num(r.quantity)) ? 0 : num(r.quantity)),
                          0,
                        )
                    : null
                }
                priceEditable={row.allowPriceChange && canChangePrice}
                onChange={(next) => {
                  set({ rows: state.rows.map((r) => (r.key === row.key ? next : r)) });
                }}
                onRemove={() => {
                  set({ rows: state.rows.filter((r) => r.key !== row.key) });
                }}
              />
            ))}
          </ul>
        ) : (
          <p className="mt-3 rounded-control border border-dashed border-line px-3 py-6 text-center text-sm text-ink-muted">
            Nenhum item ainda. Busque acima por nome, código ou código de barras.
          </p>
        )}
      </Section>

      <Section title="Desconto e observações">
        <div className="grid gap-4 @2xl:grid-cols-[auto_minmax(0,14rem)_1fr]">
          <Segmented
            label="Desconto em"
            value={state.discountMode}
            options={[
              { value: 'amount', label: 'R$' },
              { value: 'percent', label: '%' },
            ]}
            onChange={(discountMode) => {
              set({ discountMode });
            }}
          />
          <TextField
            label={state.discountMode === 'amount' ? 'Desconto (R$)' : 'Desconto (%)'}
            inputMode="decimal"
            autoComplete="off"
            value={state.discountValue}
            disabled={!canDiscount && !state.discountValue}
            hint={
              canDiscount
                ? `Seu limite: ${formatPercent(context.discountLimitPercent)} da venda.`
                : 'Seu perfil não concede desconto.'
            }
            error={errors['discount.value']}
            onChange={(e) => {
              set({ discountValue: e.target.value });
            }}
          />
          <TextareaField
            label="Observações"
            rows={2}
            hint="Saem impressas no demonstrativo e no orçamento."
            value={state.notes}
            maxLength={1000}
            error={errors.notes}
            onChange={(e) => {
              set({ notes: e.target.value });
            }}
          />
        </div>
        <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-line pt-4 text-right">
          <Total label="Bruto" value={formatMoney(preview.grossCents / 100)} />
          <Total
            label="Desconto"
            value={
              preview.discountCents
                ? `− ${formatMoney(preview.discountCents / 100)}`
                : formatMoney(0)
            }
          />
          <Total label="Total" value={formatMoney(preview.netCents / 100)} strong />
        </dl>
      </Section>
    </div>
  );
}

function Total({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd
        className={clsx(
          'mt-0.5 font-mono tabular-nums',
          strong ? 'text-lg font-semibold text-ink' : 'text-sm text-ink',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function ItemRow({
  row,
  index,
  errors,
  professionals,
  gross,
  wanted,
  priceEditable,
  onChange,
  onRemove,
}: {
  row: Row;
  index: number;
  errors: FieldErrors;
  professionals: { id: string; name: string }[];
  gross: number;
  /** Quantidade do item somada em todas as linhas; nulo em orçamento, que não reserva. */
  wanted: number | null;
  priceEditable: boolean;
  onChange: (row: Row) => void;
  onRemove: () => void;
}) {
  const err = (field: string) => errors[`items.${String(index)}.${field}`];
  return (
    <li className="space-y-3 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{row.name}</p>
          <p className="text-xs text-ink-muted">
            <span className="font-mono">#{row.code}</span> · {saleUnitLabels[row.unit]}
            {row.kind === 'service' ? ' · Serviço' : ''}
            {row.fromRecord ? ' · Lançado pela ficha clínica' : ''}
          </p>
          {err('productId') ? (
            <p role="alert" className="mt-1 text-xs font-medium text-danger-600">
              {err('productId')}
            </p>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Remover ${row.name}`}
          icon={<Trash2 className="size-4" aria-hidden />}
          onClick={onRemove}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 @3xl:grid-cols-[minmax(0,1fr)_7rem_9rem_8rem]">
        <div className="col-span-2 @3xl:col-span-1">
          <SelectField
            label="Profissional"
            aria-label={`Profissional de ${row.name}`}
            value={row.professionalId}
            options={professionals.map((p) => ({ value: p.id, label: p.name }))}
            error={err('professionalId')}
            onChange={(e) => {
              onChange({ ...row, professionalId: e.target.value });
            }}
          />
        </div>
        <TextField
          label="Quantidade"
          aria-label={`Quantidade de ${row.name}`}
          inputMode="decimal"
          autoComplete="off"
          value={row.quantity}
          error={err('quantity')}
          onChange={(e) => {
            onChange({ ...row, quantity: e.target.value });
          }}
        />
        {priceEditable ? (
          <TextField
            label="Preço (R$)"
            aria-label={`Preço de ${row.name}`}
            inputMode="decimal"
            autoComplete="off"
            value={row.unitPrice}
            error={err('unitPrice')}
            hint={`Tabela: ${formatMoney(row.listPrice)}`}
            onChange={(e) => {
              onChange({ ...row, unitPrice: e.target.value });
            }}
          />
        ) : (
          <ReadValue label="Preço" error={err('unitPrice')}>
            {formatMoney(num(row.unitPrice) || 0)}
          </ReadValue>
        )}
        <div className="col-span-2 @3xl:col-span-1">
          <ReadValue label="Subtotal" end>
            {formatMoney(gross / 100)}
          </ReadValue>
        </div>
        {row.stock ? <StockHint stock={row.stock} unit={row.unit} wanted={wanted} /> : null}
      </div>
    </li>
  );
}

function ReadValue({
  label,
  error,
  end,
  children,
}: {
  label: string;
  error?: string | undefined;
  /** Alinha à direita, como coluna de valores. */
  end?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={clsx('space-y-1.5', end && 'text-right')}>
      <p className="text-[13px] font-medium text-ink-muted">{label}</p>
      <p
        className={clsx(
          'flex h-10 items-center font-mono text-sm tabular-nums',
          end && 'justify-end',
        )}
      >
        {children}
      </p>
      {error ? (
        <p role="alert" className="text-xs font-medium text-danger-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Busca de item; Enter adiciona o primeiro resultado, como faz o leitor de código de barras. */
export function ItemSearch({
  onPick,
  label = 'Adicionar item',
  placeholder = 'Nome, código ou código de barras',
}: {
  onPick: (item: SellableItem) => void;
  label?: string;
  placeholder?: string;
}) {
  const [term, setTerm] = useState('');
  const q = useDebounced(term.trim(), 200);
  const results = useQuery({ ...sellableQuery(q), enabled: q.length >= 1 });
  const listId = useId();
  const pick = (item: SellableItem) => {
    onPick(item);
    setTerm('');
  };
  const items = q.length >= 1 && q === term.trim() ? (results.data ?? []) : [];

  return (
    <div className="relative">
      <SearchField
        label={label}
        placeholder={placeholder}
        icon={<Search className="size-4" aria-hidden />}
        value={term}
        aria-controls={listId}
        onChange={(e) => {
          setTerm(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const first = items[0];
            if (first) pick(first);
          }
        }}
      />
      {term.trim() ? (
        <div
          id={listId}
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-control border border-line bg-surface shadow-overlay"
        >
          {results.isError ? (
            <p role="alert" className="px-3 py-2 text-sm text-danger-600">
              {errorMessage(results.error)}
            </p>
          ) : items.length === 0 ? (
            <p className="px-3 py-2 text-sm text-ink-muted">
              {results.isFetching || q !== term.trim()
                ? 'Buscando…'
                : 'Nenhum item à venda com esse termo.'}
            </p>
          ) : (
            <ul aria-label="Itens encontrados">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-sunken focus:bg-sunken focus:outline-none"
                    onClick={() => {
                      pick(item);
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{item.name}</span>
                      <span className="text-xs text-ink-muted">
                        <span className="font-mono">#{item.code}</span>
                        {item.barcode ? <span className="font-mono"> · {item.barcode}</span> : null}
                        {item.stock ? (
                          <span className={item.stock.available > 0 ? '' : 'text-danger-600'}>
                            {' · '}
                            {item.stock.available > 0
                              ? `${quantityInput(item.stock.available)} ${item.unit} disponível`
                              : 'sem estoque'}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {item.kind === 'service' ? <Badge tone="sage">Serviço</Badge> : null}
                      <span className="font-mono text-sm tabular-nums">
                        {formatMoney(item.salePrice)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Cliente por nome, ficha, telefone ou animal [p.8]; sem cliente é venda de balcão. */
function CustomerField({
  state,
  set,
  errors,
}: {
  state: SaleFormState;
  set: (patch: Partial<SaleFormState>) => void;
  errors: FieldErrors;
}) {
  const [term, setTerm] = useState('');
  const q = useDebounced(term.trim());
  const results = useQuery({
    ...clientsQuery({ q, page: 1, archived: false }, 6),
    enabled: q.length >= 2 && !state.client,
  });
  const client = useQuery({
    ...clientQuery(state.client?.id ?? ''),
    enabled: Boolean(state.client),
  });

  if (state.client) {
    const animals = (client.data?.patients ?? []).filter(
      (p) => !p.archived || p.id === state.patientId,
    );
    return (
      <div className="grid gap-4 @2xl:grid-cols-2">
        <div className="space-y-1.5">
          <p className="text-[13px] font-medium text-ink">Cliente</p>
          <div className="flex h-10 items-center justify-between gap-2 rounded-control border border-line-strong bg-sunken px-3">
            <span className="flex min-w-0 items-center gap-2 text-sm">
              <UserRound className="size-4 shrink-0 text-ink-muted" aria-hidden />
              <span className="truncate">{state.client.name}</span>
              <span className="font-mono text-xs text-ink-muted">#{state.client.code}</span>
            </span>
            <button
              type="button"
              className="rounded-control p-1 text-ink-muted hover:bg-surface hover:text-ink"
              aria-label="Trocar cliente"
              onClick={() => {
                set({ client: null, patientId: '' });
                setTerm('');
              }}
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
          {errors.clientId ? (
            <p role="alert" className="text-xs font-medium text-danger-600">
              {errors.clientId}
            </p>
          ) : null}
        </div>
        <SelectField
          label="Animal"
          placeholder={client.isPending ? 'Carregando…' : 'Sem animal (só o responsável)'}
          value={state.patientId}
          options={animals.map((p) => ({ value: p.id, label: p.name }))}
          error={errors.patientId}
          onChange={(e) => {
            set({ patientId: e.target.value });
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <SearchField
        label="Localizar cliente"
        placeholder="Cliente: nome, ficha, telefone ou animal"
        icon={<Search className="size-4" aria-hidden />}
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
        }}
      />
      {q.length < 2 ? (
        <p className="px-1 text-xs text-ink-muted">
          Sem cliente, a venda fica como venda de balcão.
        </p>
      ) : results.isPending ? (
        <p className="px-1 text-sm text-ink-muted">Buscando…</p>
      ) : results.isError ? (
        <p role="alert" className="px-1 text-sm text-danger-600">
          {errorMessage(results.error)}
        </p>
      ) : results.data.items.length === 0 ? (
        <p className="px-1 text-sm text-ink-muted">Nenhum cliente encontrado.</p>
      ) : (
        <ul className="space-y-2" aria-label="Clientes encontrados">
          {results.data.items.map((c) => {
            const pickClient = (patientId: string) => {
              set({ client: { id: c.id, name: c.name, code: c.code }, patientId });
            };
            return (
              <li key={c.id} className="rounded-control border border-line px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium">{c.name}</span>
                  <span className="shrink-0 font-mono text-xs text-ink-muted">#{c.code}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {c.patients.map((p) => (
                    <Button
                      key={p.id}
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        pickClient(p.id);
                      }}
                    >
                      {p.name}
                    </Button>
                  ))}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      pickClient('');
                    }}
                  >
                    Só o responsável
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Saldo do item na unidade: avisa antes de salvar quando a venda passa do disponível [RN-31]. */
function StockHint({
  stock,
  unit,
  wanted,
}: {
  stock: StockSummary;
  unit: SellableItem['unit'];
  wanted: number | null;
}) {
  const available = `${quantityInput(stock.available)} ${unit}`;
  const short = wanted !== null && wanted > stock.available;
  return (
    <p
      className={clsx(
        'col-span-2 text-xs @3xl:col-span-4',
        !short
          ? 'text-ink-muted'
          : stock.blocksSaleWithoutStock
            ? 'text-danger-600'
            : 'text-amber-700',
      )}
    >
      {!short
        ? `Estoque: ${available} disponível.`
        : stock.blocksSaleWithoutStock
          ? stock.available === 0
            ? 'Sem estoque disponível, e o grupo do item bloqueia venda sem saldo.'
            : `Só ${available} disponível, e o grupo do item bloqueia venda sem saldo.`
          : `${stock.available === 0 ? 'Sem estoque disponível' : `Só ${available} disponível`}. A venda segue e a falta fica como pendência no estoque.`}
    </p>
  );
}
