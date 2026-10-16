import { saleSchema, type SellableItem } from '@clinica/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ShoppingCart } from 'lucide-react';
import { Panel } from '../../design-system/layout';
import { SkeletonRows } from '../../design-system/states';
import { useToast } from '../../design-system/toast';
import { api, errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useCan, useSession } from '../../lib/session';
import { formatMoney, quantityInput } from '../products/format';
import { patientSalesQuery } from './queries';
import { ItemSearch } from './sale-form';
import { StatusBadge } from './status-badge';

/**
 * Coluna de vendas da ficha [p.4]: o carrinho aberto do animal. O que se lança aqui, ou o
 * serviço de um atendimento finalizado, cai na mesma venda, que segue para o PDV [RN-19].
 */
export function PatientSalePanel({
  patientId,
  patientName,
  writable,
}: {
  patientId: string;
  patientName: string;
  writable: boolean;
}) {
  const can = useCan();
  const session = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const data = useQuery(patientSalesQuery(patientId));
  const add = useMutation({
    mutationFn: (item: SellableItem) =>
      api('POST', `/sales/patient/${patientId}/items`, saleSchema, {
        productId: item.id,
        professionalId: session.user.id,
        quantity: 1,
      }),
    onSuccess: async (sale, item) => {
      await queryClient.invalidateQueries({ queryKey: ['sales'] });
      toast.success(`${item.name} lançado na venda ${String(sale.code)}.`);
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
  const canAdd = writable && can('sales.manage');
  const open = data.data?.open ?? null;
  const others = (data.data?.recent ?? []).filter((s) => s.id !== open?.id).slice(0, 5);

  return (
    <Panel labelledBy="sale-title">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 id="sale-title" className="font-display text-[15px] font-semibold">
          {open ? `Venda ${String(open.code)}` : 'Venda'}
        </h2>
        {open ? (
          <Link
            to="/vendas/$saleId"
            params={{ saleId: open.id }}
            className="text-xs text-sage-700 hover:underline"
          >
            Abrir no PDV
          </Link>
        ) : null}
      </div>
      {data.isPending ? (
        <div className="p-4">
          <SkeletonRows rows={2} columns={1} />
        </div>
      ) : data.isError ? (
        <p role="alert" className="px-4 py-3 text-sm text-danger-600">
          {errorMessage(data.error)}
        </p>
      ) : (
        <>
          {open ? (
            <>
              <ul className="divide-y divide-line" aria-label="Itens da venda aberta">
                {open.items.map((i) => (
                  <li key={i.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                    <span className="min-w-0">
                      <span className="block text-sm">{i.name}</span>
                      <span className="block text-xs text-ink-muted">
                        {quantityInput(i.quantity)} × {formatMoney(i.unitPrice)} ·{' '}
                        {i.professional.name}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-sm tabular-nums">
                      {formatMoney(i.grossTotal)}
                    </span>
                  </li>
                ))}
              </ul>
              <dl className="space-y-0.5 border-t border-line px-4 py-3 text-sm">
                {open.discountTotal > 0 ? (
                  <div className="flex justify-between text-ink-muted">
                    <dt>Desconto</dt>
                    <dd className="font-mono tabular-nums">− {formatMoney(open.discountTotal)}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between font-medium">
                  <dt>Total</dt>
                  <dd className="font-mono tabular-nums">{formatMoney(open.netTotal)}</dd>
                </div>
              </dl>
            </>
          ) : (
            <p className="flex gap-2 px-4 py-3 text-sm text-ink-muted">
              <ShoppingCart className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Nenhuma venda aberta para {patientName}.
                {canAdd ? ' O primeiro item lançado aqui abre uma.' : ''}
              </span>
            </p>
          )}
          {canAdd ? (
            <div className="border-t border-line px-4 py-3">
              <ItemSearch
                label="Lançar na venda"
                placeholder="Lançar produto ou serviço"
                onPick={(item) => {
                  add.mutate(item);
                }}
              />
              {add.isPending ? <p className="mt-2 text-xs text-ink-muted">Lançando…</p> : null}
            </div>
          ) : null}
          {others.length > 0 ? (
            <section className="border-t border-line">
              <h3 className="bg-sunken px-4 py-1.5 font-mono text-[11px] font-medium tracking-[0.06em] text-ink-muted uppercase">
                Vendas anteriores
              </h3>
              <ul>
                {others.map((s) => (
                  <li key={s.id}>
                    <Link
                      to="/vendas/$saleId"
                      params={{ saleId: s.id }}
                      className="flex items-center justify-between gap-2 px-4 py-2 hover:bg-sunken"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm">
                          <span className="font-mono text-xs text-ink-muted">{s.code}</span>{' '}
                          {formatMoney(s.netTotal)}
                        </span>
                        <span className="block text-xs text-ink-muted">
                          {formatDateTime(s.createdAt)}
                        </span>
                      </span>
                      <StatusBadge status={s.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </Panel>
  );
}
