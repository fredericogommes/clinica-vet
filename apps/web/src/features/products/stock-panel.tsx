import {
  productStockSchema,
  stockMovementLabels,
  type ProductStock,
  type SaleUnit,
} from '@clinica/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ClipboardCheck, PackagePlus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../design-system/button';
import { Dialog } from '../../design-system/dialog';
import { TextField } from '../../design-system/field';
import { Badge, Facts, Section } from '../../design-system/layout';
import { ErrorState, SkeletonRows } from '../../design-system/states';
import { useToast } from '../../design-system/toast';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { parseDecimal, quantityInput } from './format';

export const productStockQuery = (id: string) =>
  queryOptions({
    queryKey: ['products', 'stock', id],
    queryFn: () => api('GET', `/products/${id}/stock`, productStockSchema.nullable()),
  });

const signedQty = (value: number) =>
  value > 0 ? `+${quantityInput(value)}` : value < 0 ? `− ${quantityInput(-value)}` : '0';

/**
 * Estoque do produto na unidade atual [p.16–17]: saldo, reservas das vendas em aberto, o que
 * sobra para vender, pendência de venda sem saldo e as movimentações dos últimos 3 meses.
 */
export function ProductStockPanel({ productId, unit }: { productId: string; unit: SaleUnit }) {
  const stock = useQuery(productStockQuery(productId));
  const [adjusting, setAdjusting] = useState<'entry' | 'count' | null>(null);
  if (stock.isPending) return <SkeletonRows rows={2} columns={2} />;
  if (stock.isError) {
    return <ErrorState message={errorMessage(stock.error)} onRetry={() => void stock.refetch()} />;
  }
  const s = stock.data;
  // Item que não controla estoque não tem painel.
  if (!s) return null;
  const q = (value: number) => `${quantityInput(value)} ${unit}`;
  return (
    <Section
      title={`Estoque · ${s.unitName}`}
      description={
        s.blocksSaleWithoutStock
          ? 'O grupo bloqueia venda sem saldo.'
          : 'O grupo libera venda sem saldo: a falta vira pendência até a próxima entrada.'
      }
      actions={
        s.canAdjust ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              icon={<PackagePlus className="size-4" aria-hidden />}
              onClick={() => {
                setAdjusting('entry');
              }}
            >
              Lançar entrada
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<ClipboardCheck className="size-4" aria-hidden />}
              onClick={() => {
                setAdjusting('count');
              }}
            >
              Contagem
            </Button>
          </>
        ) : null
      }
    >
      <Facts
        items={[
          {
            label: 'Em estoque',
            value: (
              <span className="inline-flex items-center gap-2">
                <span>{q(s.onHand)}</span>
                {s.minStock !== null && s.onHand < s.minStock ? (
                  <Badge tone="amber">Abaixo do mínimo</Badge>
                ) : null}
              </span>
            ),
          },
          { label: 'Reservado em vendas em aberto', value: q(s.reserved) },
          { label: 'Disponível para venda', value: q(s.available) },
          {
            label: 'Pendência de venda sem saldo',
            value:
              s.shortfall > 0 ? (
                <span className="text-danger-600">{q(s.shortfall)}</span>
              ) : (
                'Nenhuma'
              ),
          },
          {
            label: 'Mínimo e ideal',
            value:
              s.minStock === null && s.idealStock === null
                ? null
                : `${s.minStock === null ? '—' : q(s.minStock)} · ${
                    s.idealStock === null ? '—' : q(s.idealStock)
                  }`,
          },
        ]}
      />
      <h3 className="mt-5 mb-1 text-xs font-medium text-ink-muted">
        Entradas e saídas dos últimos 3 meses
      </h3>
      {s.movements.length === 0 ? (
        <p className="text-sm text-ink-muted">Nenhuma movimentação ainda.</p>
      ) : (
        <ul className="-mx-2 divide-y divide-line" aria-label="Movimentações de estoque">
          {s.movements.map((m) => (
            <li key={m.id} className="flex items-start justify-between gap-3 px-2 py-2.5">
              <span className="min-w-0">
                <span className="block text-sm">
                  <span className="font-medium">{stockMovementLabels[m.kind]}</span>
                  {m.sale ? (
                    <>
                      {' · '}
                      <Link
                        to="/vendas/$saleId"
                        params={{ saleId: m.sale.id }}
                        className="text-sage-700 hover:underline"
                      >
                        Venda {m.sale.code}
                      </Link>
                    </>
                  ) : m.notes ? (
                    ` · ${m.notes}`
                  ) : null}
                </span>
                <span className="block text-xs text-ink-muted">
                  {[
                    formatDateTime(m.at),
                    m.by,
                    m.shortfall > 0 ? `${q(m.shortfall)} sem saldo, em pendência` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span
                  className={
                    m.quantity < 0
                      ? 'block font-mono text-sm text-danger-600 tabular-nums'
                      : 'block font-mono text-sm tabular-nums'
                  }
                >
                  {signedQty(m.quantity)}
                </span>
                <span className="block text-xs text-ink-muted">
                  saldo {quantityInput(m.onHandAfter)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {adjusting ? (
        <AdjustDialog
          productId={productId}
          kind={adjusting}
          stock={s}
          unit={unit}
          onClose={() => {
            setAdjusting(null);
          }}
        />
      ) : null}
    </Section>
  );
}

const fieldErrors = (error: unknown): Record<string, string> =>
  error instanceof ApiRequestError
    ? Object.fromEntries(error.fieldErrors.map((f) => [f.path, f.message]))
    : {};

/** Entrada manual (até Compras) ou contagem física, que vira o saldo e zera a pendência. */
function AdjustDialog({
  productId,
  kind,
  stock,
  unit,
  onClose,
}: {
  productId: string;
  kind: 'entry' | 'count';
  stock: ProductStock;
  unit: SaleUnit;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [local, setLocal] = useState<Record<string, string>>({});
  const field = kind === 'entry' ? 'quantity' : 'countedQuantity';
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api('POST', `/products/${productId}/stock`, productStockSchema, body),
    onSuccess: async (saved) => {
      queryClient.setQueryData(productStockQuery(productId).queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: ['products', 'list'] });
      await queryClient.invalidateQueries({ queryKey: ['sales'] });
      toast.success(
        kind === 'entry'
          ? `Entrada lançada. Saldo: ${quantityInput(saved.onHand)} ${unit}.`
          : `Contagem registrada. Saldo: ${quantityInput(saved.onHand)} ${unit}.`,
      );
      onClose();
    },
  });
  const errors = { ...fieldErrors(save.error), ...local };
  const submit = () => {
    const value = parseDecimal(amount);
    const found: Record<string, string> = {};
    if (value === null || Number.isNaN(value) || value < 0 || (kind === 'entry' && value === 0)) {
      found[field] =
        kind === 'entry' ? 'Informe uma quantidade maior que zero' : 'Informe a quantidade contada';
    }
    if (notes.trim().length < 3) {
      found.notes =
        kind === 'entry'
          ? 'Diga de onde veio, ex. nota, fornecedor ou doação'
          : 'Explique a contagem em poucas palavras';
    }
    setLocal(found);
    if (Object.keys(found).length === 0) save.mutate({ kind, [field]: value, notes });
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={kind === 'entry' ? 'Lançar entrada de estoque' : 'Registrar contagem'}
      description={
        kind === 'entry'
          ? stock.shortfall > 0
            ? `A entrada quita primeiro a pendência de ${quantityInput(stock.shortfall)} ${unit}.`
            : 'Para entradas avulsas; a entrada por nota fiscal chega com Compras.'
          : `O contado vira o saldo e zera a pendência. Saldo atual: ${quantityInput(stock.onHand)} ${unit}.`
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" form="stock-form" pending={save.isPending}>
            {kind === 'entry' ? 'Lançar entrada' : 'Registrar contagem'}
          </Button>
        </>
      }
    >
      <form
        id="stock-form"
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {save.isError && Object.keys(fieldErrors(save.error)).length === 0 ? (
          <p
            role="alert"
            className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600"
          >
            {errorMessage(save.error)}
          </p>
        ) : null}
        <TextField
          label={kind === 'entry' ? `Quantidade (${unit})` : `Quantidade contada (${unit})`}
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          error={errors[field]}
          onChange={(e) => {
            setAmount(e.target.value);
            setLocal({});
            save.reset();
          }}
        />
        <TextField
          label={kind === 'entry' ? 'Origem' : 'Observação'}
          autoComplete="off"
          maxLength={300}
          placeholder={
            kind === 'entry' ? 'Ex.: NF 1234, Distribuidora Pet' : 'Ex.: contagem mensal'
          }
          value={notes}
          error={errors.notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setLocal({});
          }}
        />
      </form>
    </Dialog>
  );
}
