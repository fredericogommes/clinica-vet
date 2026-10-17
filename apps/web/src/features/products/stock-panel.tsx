import {
  lotTraceSchema,
  productStockSchema,
  stockMovementLabels,
  type ProductStock,
  type SaleUnit,
  type StockLot,
} from '@clinica/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ClipboardCheck, PackagePlus, Route } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../design-system/button';
import { Dialog } from '../../design-system/dialog';
import { SelectField, TextField } from '../../design-system/field';
import { Badge, Facts, Section } from '../../design-system/layout';
import { ErrorState, SkeletonRows } from '../../design-system/states';
import { useToast } from '../../design-system/toast';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { formatCalendarDate, formatDateTime } from '../../lib/format';
import { parseDecimal, quantityInput } from './format';

export const productStockQuery = (id: string) =>
  queryOptions({
    queryKey: ['products', 'stock', id],
    queryFn: () => api('GET', `/products/${id}/stock`, productStockSchema.nullable()),
  });

const lotTraceQuery = (productId: string, lotId: string) =>
  queryOptions({
    queryKey: ['products', 'stock', productId, 'lot', lotId],
    queryFn: () => api('GET', `/products/${productId}/lots/${lotId}`, lotTraceSchema),
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
  const [tracing, setTracing] = useState<StockLot | null>(null);
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
          ...(s.tracksLots
            ? [
                {
                  label: 'Em lote vencido',
                  value:
                    s.expired > 0 ? (
                      <span className="text-danger-600">
                        {q(s.expired)}, fora da venda até a baixa pela contagem
                      </span>
                    ) : (
                      'Nenhum'
                    ),
                },
                {
                  label: 'Validade mais antiga em estoque',
                  value: s.lots[0]?.expiresOn ? formatCalendarDate(s.lots[0].expiresOn) : null,
                },
              ]
            : []),
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
      {s.tracksLots ? (
        <>
          <h3 className="mt-5 mb-1 text-xs font-medium text-ink-muted">
            Lotes em estoque, do que vence antes ao que vence depois
          </h3>
          {s.lots.length === 0 ? (
            <p className="text-sm text-ink-muted">Nenhum lote com saldo.</p>
          ) : (
            <ul className="-mx-2 divide-y divide-line" aria-label="Lotes em estoque">
              {s.lots.map((lot) => (
                <li key={lot.id} className="flex items-center justify-between gap-3 px-2 py-2">
                  <span className="min-w-0">
                    <span className="block font-mono text-sm">{lot.code}</span>
                    <span className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                      {lot.expiresOn
                        ? `Validade ${formatCalendarDate(lot.expiresOn)}`
                        : 'Saldo anterior ao controle de lote'}
                      {lot.expiry === 'expired' ? (
                        <Badge tone="danger">Vencido</Badge>
                      ) : lot.expiry === 'expiring' ? (
                        <Badge tone="amber">Vence em breve</Badge>
                      ) : null}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-sm tabular-nums">{q(lot.onHand)}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Rastrear lote ${lot.code}`}
                      icon={<Route className="size-4" aria-hidden />}
                      onClick={() => {
                        setTracing(lot);
                      }}
                    >
                      Rastrear
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
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
                  ) : m.purchase ? (
                    <>
                      {' · '}
                      <Link
                        to="/estoque/compras/$purchaseId"
                        params={{ purchaseId: m.purchase.id }}
                        className="text-sage-700 hover:underline"
                      >
                        Compra {m.purchase.code}
                      </Link>
                    </>
                  ) : m.exit ? (
                    <>
                      {' · '}
                      <Link
                        to="/estoque/saidas"
                        search={{ situacao: 'todas' }}
                        className="text-sage-700 hover:underline"
                      >
                        Saída {m.exit.code}
                      </Link>
                    </>
                  ) : m.count ? (
                    <>
                      {' · '}
                      <Link
                        to="/estoque/inventario/$countId"
                        params={{ countId: m.count.id }}
                        className="text-sage-700 hover:underline"
                      >
                        Inventário {m.count.code}
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
                    m.lots.length > 0
                      ? m.lots.map((l) => `lote ${l.code} ${signedQty(l.quantity)}`).join(', ')
                      : null,
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
      {tracing ? (
        <TraceDialog
          productId={productId}
          lot={tracing}
          unit={unit}
          onClose={() => {
            setTracing(null);
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
  const [lotCode, setLotCode] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [lotId, setLotId] = useState('');
  const [local, setLocal] = useState<Record<string, string>>({});
  const withLot = stock.tracksLots;
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
    if (withLot && kind === 'entry') {
      if (lotCode.trim() === '') found['lot.code'] = 'Informe o lote';
      if (expiresOn === '') found['lot.expiresOn'] = 'Informe a validade';
    }
    if (withLot && kind === 'count' && lotId === '') found.lotId = 'Escolha o lote contado';
    if (notes.trim().length < 3) {
      found.notes =
        kind === 'entry'
          ? 'Diga de onde veio, ex. nota, fornecedor ou doação'
          : 'Explique a contagem em poucas palavras';
    }
    setLocal(found);
    if (Object.keys(found).length > 0) return;
    save.mutate({
      kind,
      [field]: value,
      notes,
      ...(withLot && kind === 'entry' ? { lot: { code: lotCode, expiresOn } } : {}),
      ...(withLot && kind === 'count' ? { lotId } : {}),
    });
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
          : withLot
            ? 'O contado vira o saldo do lote e zera a pendência. Lote vencido sai do estoque contando zero.'
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
        {withLot && kind === 'count' ? (
          <SelectField
            label="Lote"
            placeholder="Escolha o lote"
            options={stock.lots.map((l) => ({
              value: l.id,
              label: `${l.code} · ${
                l.expiresOn ? `validade ${formatCalendarDate(l.expiresOn)}` : 'sem validade'
              } · ${quantityInput(l.onHand)} ${unit}`,
            }))}
            value={lotId}
            error={errors.lotId}
            onChange={(e) => {
              setLotId(e.target.value);
              setLocal({});
              save.reset();
            }}
          />
        ) : null}
        {withLot && kind === 'entry' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Lote"
              autoComplete="off"
              maxLength={40}
              className="uppercase"
              value={lotCode}
              error={errors['lot.code']}
              onChange={(e) => {
                setLotCode(e.target.value);
                setLocal({});
                save.reset();
              }}
            />
            <TextField
              label="Validade"
              type="date"
              value={expiresOn}
              error={errors['lot.expiresOn']}
              onChange={(e) => {
                setExpiresOn(e.target.value);
                setLocal({});
                save.reset();
              }}
            />
          </div>
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

/** Rastreio do lote [RN-32]: de onde veio e para quais vendas e animais saiu. */
function TraceDialog({
  productId,
  lot,
  unit,
  onClose,
}: {
  productId: string;
  lot: StockLot;
  unit: SaleUnit;
  onClose: () => void;
}) {
  const trace = useQuery(lotTraceQuery(productId, lot.id));
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={`Lote ${lot.code}`}
      description={`${
        lot.expiresOn ? `Validade ${formatCalendarDate(lot.expiresOn)}` : 'Sem validade'
      } · saldo ${quantityInput(lot.onHand)} ${unit}`}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Fechar
        </Button>
      }
    >
      {trace.isPending ? (
        <SkeletonRows rows={3} columns={1} />
      ) : trace.isError ? (
        <ErrorState message={errorMessage(trace.error)} onRetry={() => void trace.refetch()} />
      ) : (
        <ul className="-mx-2 divide-y divide-line" aria-label="Rastreio do lote">
          {trace.data.movements.map((m) => (
            <li key={m.id} className="flex items-start justify-between gap-3 px-2 py-2.5">
              <span className="min-w-0 text-sm">
                <span className="block">
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
                  ) : m.purchase ? (
                    <>
                      {' · '}
                      <Link
                        to="/estoque/compras/$purchaseId"
                        params={{ purchaseId: m.purchase.id }}
                        className="text-sage-700 hover:underline"
                      >
                        Compra {m.purchase.code}
                      </Link>
                    </>
                  ) : m.exit ? (
                    <>
                      {' · '}
                      <Link
                        to="/estoque/saidas"
                        search={{ situacao: 'todas' }}
                        className="text-sage-700 hover:underline"
                      >
                        Saída {m.exit.code}
                      </Link>
                    </>
                  ) : m.notes ? (
                    ` · ${m.notes}`
                  ) : null}
                </span>
                {m.patient || m.client ? (
                  <span className="block">
                    {m.patient ? (
                      <Link
                        to="/animais/$patientId"
                        params={{ patientId: m.patient.id }}
                        className="text-sage-700 hover:underline"
                      >
                        {m.patient.name}
                      </Link>
                    ) : null}
                    {m.patient && m.client ? ' · ' : null}
                    {m.client ? (
                      <span className="text-ink-muted">tutor {m.client.name}</span>
                    ) : null}
                  </span>
                ) : null}
                <span className="block text-xs text-ink-muted">
                  {formatDateTime(m.at)} · {m.by}
                </span>
              </span>
              <span
                className={
                  m.quantity < 0
                    ? 'shrink-0 font-mono text-sm text-danger-600 tabular-nums'
                    : 'shrink-0 font-mono text-sm tabular-nums'
                }
              >
                {signedQty(m.quantity)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
