import {
  copayCents,
  insurerPricesInputSchema,
  insurerPricesSchema,
  productKindLabels,
  type InsurerCandidate,
  type InsurerPrices,
} from '@clinica/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, ListPlus, Plus, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button, buttonClasses } from '../../design-system/button';
import { Checkbox } from '../../design-system/checkbox';
import { SearchField, TextField } from '../../design-system/field';
import { Badge, PageHeader, Section } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { useToast } from '../../design-system/toast';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { useDebounced } from '../../lib/use-debounced';
import {
  formatMoney,
  formatPercent,
  moneyInput,
  parseDecimal,
  percentInput,
} from '../products/format';
import { InsurerDialog, insurerSummary } from './insurers-page';
import { insurerCandidatesQuery, insurerPricesQuery } from './queries';

interface Row {
  productId: string;
  code: number;
  name: string;
  kind: InsurerCandidate['kind'];
  salePrice: number;
  archived: boolean;
  price: string;
  copay: string;
  requiresAuthorization: boolean;
}

const rowsOf = (t: InsurerPrices): Row[] =>
  t.items.map((i) => ({
    productId: i.productId,
    code: i.code,
    name: i.name,
    kind: i.kind,
    salePrice: i.salePrice,
    archived: i.archived,
    price: moneyInput(i.price),
    copay: percentInput(i.copayPercent),
    requiresAuthorization: i.requiresAuthorization,
  }));

const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR');

/** Tabela de preços do convênio [D3]: o mesmo item do catálogo, com o preço deste plano. */
export function InsurerPricesPage({ id }: { id: string }) {
  const table = useQuery(insurerPricesQuery(id));
  if (table.isPending) return <SkeletonRows rows={5} columns={2} />;
  if (table.isError) {
    return <ErrorState message={errorMessage(table.error)} onRetry={() => void table.refetch()} />;
  }
  // Editar o convênio recarrega a tabela; a chave é o convênio para não perder o que não foi salvo.
  return <PricesEditor key={id} table={table.data} />;
}

function PricesEditor({ table }: { table: InsurerPrices }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const insurer = table.insurer;
  const [rows, setRows] = useState<Row[]>(() => rowsOf(table));
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState(false);

  const save = useMutation({
    mutationFn: (body: unknown) =>
      api('PUT', `/insurers/${insurer.id}/prices`, insurerPricesSchema, body),
    onSuccess: async (saved) => {
      queryClient.setQueryData(insurerPricesQuery(insurer.id).queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: ['insurers', 'list'] });
      toast.success('Tabela de preços salva.');
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.fieldErrors.length > 0) {
        setErrors(Object.fromEntries(e.fieldErrors.map((f) => [f.path, f.message])));
      }
    },
  });

  const change = (productId: string, patch: Partial<Row>) => {
    const index = rows.findIndex((r) => r.productId === productId);
    setRows((prev) => prev.map((r) => (r.productId === productId ? { ...r, ...patch } : r)));
    setDirty(true);
    const stale = [`items.${String(index)}.price`, `items.${String(index)}.copayPercent`];
    setErrors((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([k]) => !stale.includes(k))),
    );
  };
  const add = (c: InsurerCandidate) => {
    if (rows.some((r) => r.productId === c.id)) {
      toast.error(`${c.name} já está na tabela.`);
      return;
    }
    setRows((prev) => [
      {
        productId: c.id,
        code: c.code,
        name: c.name,
        kind: c.kind,
        salePrice: c.salePrice,
        archived: false,
        price: moneyInput(c.salePrice),
        copay: '',
        requiresAuthorization: insurer.requiresAuthorization,
      },
      ...prev,
    ]);
    setFilter('');
    setDirty(true);
    setErrors({});
  };
  const remove = (productId: string) => {
    setRows((prev) => prev.filter((r) => r.productId !== productId));
    setDirty(true);
    setErrors({});
  };
  const submit = () => {
    const parsed = insurerPricesInputSchema.safeParse({
      items: rows.map((r) => ({
        productId: r.productId,
        price: parseDecimal(r.price) ?? Number.NaN,
        copayPercent: parseDecimal(r.copay),
        requiresAuthorization: r.requiresAuthorization,
      })),
    });
    if (!parsed.success) {
      const found: Record<string, string> = {};
      for (const issue of parsed.error.issues) found[issue.path.join('.')] ??= issue.message;
      setErrors(found);
      toast.error('Corrija os itens marcados antes de salvar.');
      return;
    }
    save.mutate(parsed.data, {
      onSuccess: (saved) => {
        setRows(rowsOf(saved));
        setDirty(false);
      },
    });
  };

  const term = normalize(filter.trim());
  const shown = rows
    .map((r, index) => ({ r, index }))
    .filter(({ r }) => !term || normalize(r.name).includes(term) || String(r.code) === term);

  return (
    <>
      <PageHeader
        area="Convênios"
        title={`Tabela de preços: ${insurer.name}`}
        description={insurerSummary(insurer)}
        actions={
          <>
            <Link to="/convenios" className={buttonClasses('ghost')}>
              <ArrowLeft className="mr-1.5 size-4" aria-hidden />
              Convênios
            </Link>
            <Button
              variant="secondary"
              onClick={() => {
                setEditing(true);
              }}
            >
              Editar convênio
            </Button>
          </>
        }
      />
      <div className="space-y-5">
        <AddItem onAdd={add} />
        <Section
          title={`Itens cobertos (${String(rows.length)})`}
          description="O valor da tabela é o total do procedimento no convênio: o tutor paga a coparticipação e o convênio repassa o resto. Coparticipação vazia segue a do convênio."
        >
          {rows.length > 8 ? (
            <div className="mb-3 max-w-sm">
              <SearchField
                label="Filtrar na tabela"
                placeholder="Nome ou código"
                icon={<Search className="size-4" aria-hidden />}
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                }}
              />
            </div>
          ) : null}
          {rows.length === 0 ? (
            <EmptyState
              icon={ListPlus}
              title="Nenhum item na tabela"
              description="Busque os serviços e produtos acima e informe o preço deste convênio."
            />
          ) : shown.length === 0 ? (
            <p className="py-4 text-sm text-ink-muted">Nenhum item da tabela com esse filtro.</p>
          ) : (
            <ul className="-mx-2 divide-y divide-line" aria-label="Itens da tabela">
              {shown.map(({ r, index }) => {
                const price = parseDecimal(r.price);
                const copayPercent = parseDecimal(r.copay) ?? insurer.copayPercent;
                const valid = price !== null && !Number.isNaN(price) && !Number.isNaN(copayPercent);
                const copay = valid ? copayCents(Math.round(price * 100), copayPercent) : 0;
                return (
                  <li key={r.productId} className="space-y-2 px-2 py-3">
                    <div className="flex items-start gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{r.name}</span>
                          {r.archived ? <Badge>Arquivado</Badge> : null}
                        </span>
                        <span className="block text-xs text-ink-muted">
                          #{r.code} · {productKindLabels[r.kind]} · preço de venda{' '}
                          {formatMoney(r.salePrice)}
                        </span>
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Trash2 className="size-4" aria-hidden />}
                        aria-label={`Tirar ${r.name} da tabela`}
                        onClick={() => {
                          remove(r.productId);
                        }}
                      />
                    </div>
                    <div className="grid items-start gap-3 sm:grid-cols-[1fr_1fr_auto]">
                      <TextField
                        label="Valor no convênio (R$)"
                        inputMode="decimal"
                        autoComplete="off"
                        value={r.price}
                        error={errors[`items.${String(index)}.price`]}
                        onChange={(e) => {
                          change(r.productId, { price: e.target.value });
                        }}
                      />
                      <TextField
                        label="Coparticipação (%)"
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder={`Do convênio (${formatPercent(insurer.copayPercent)})`}
                        value={r.copay}
                        error={errors[`items.${String(index)}.copayPercent`]}
                        onChange={(e) => {
                          change(r.productId, { copay: e.target.value });
                        }}
                      />
                      <div className="sm:pt-7">
                        <Checkbox
                          label="Exige autorização"
                          checked={r.requiresAuthorization}
                          onCheckedChange={(checked) => {
                            change(r.productId, { requiresAuthorization: checked });
                          }}
                        />
                      </div>
                    </div>
                    {valid ? (
                      <p className="text-xs text-ink-muted">
                        Tutor paga {formatMoney(copay / 100)} · convênio repassa{' '}
                        {formatMoney(Math.round(price * 100 - copay) / 100)}
                      </p>
                    ) : null}
                    {errors[`items.${String(index)}.productId`] ? (
                      <p role="alert" className="text-xs font-medium text-danger-600">
                        {errors[`items.${String(index)}.productId`]}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
        <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-panel sm:border">
          {save.isError &&
          !(save.error instanceof ApiRequestError && save.error.fieldErrors.length > 0) ? (
            <p role="alert" className="mr-auto text-sm text-danger-600">
              {errorMessage(save.error)}
            </p>
          ) : (
            <p className="mr-auto text-sm text-ink-muted">
              {dirty ? 'Alterações ainda não salvas.' : 'Tabela salva.'}
            </p>
          )}
          <Button pending={save.isPending} disabled={!dirty} onClick={submit}>
            Salvar tabela
          </Button>
        </div>
      </div>
      {editing ? (
        <InsurerDialog
          insurer={insurer}
          onClose={() => {
            setEditing(false);
          }}
        />
      ) : null}
    </>
  );
}

function AddItem({ onAdd }: { onAdd: (c: InsurerCandidate) => void }) {
  const [term, setTerm] = useState('');
  const q = useDebounced(term.trim());
  const candidates = useQuery({ ...insurerCandidatesQuery(q), enabled: q.length >= 2 });
  return (
    <Section title="Incluir item">
      <SearchField
        label="Buscar no catálogo"
        placeholder="Nome ou código do serviço ou produto"
        icon={<Search className="size-4" aria-hidden />}
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
        }}
      />
      {q.length >= 2 ? (
        candidates.isPending ? (
          <div className="mt-3">
            <SkeletonRows rows={2} columns={1} />
          </div>
        ) : candidates.isError ? (
          <ErrorState
            message={errorMessage(candidates.error)}
            onRetry={() => void candidates.refetch()}
          />
        ) : candidates.data.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">Nenhum item ativo de venda com esse nome.</p>
        ) : (
          <ul
            className="mt-3 divide-y divide-line rounded-control border border-line"
            aria-label="Itens encontrados"
          >
            {candidates.data.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{c.name}</span>
                  <span className="block text-xs text-ink-muted">
                    #{c.code} · {productKindLabels[c.kind]} · {formatMoney(c.salePrice)}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Plus className="size-4" aria-hidden />}
                  aria-label={`Incluir ${c.name}`}
                  onClick={() => {
                    onAdd(c);
                    setTerm('');
                  }}
                >
                  Incluir
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </Section>
  );
}
