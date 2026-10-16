import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Wallet } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../design-system/button';
import { Panel } from '../../design-system/layout';
import { SkeletonRows } from '../../design-system/states';
import { errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useCan } from '../../lib/session';
import { formatMoney } from '../products/format';
import { OpenCashDialog } from './open-cash-dialog';
import { currentCashQuery } from './queries';

/** Painel lateral do PDV [p.9]: o caixa aberto do operador, ou o botão para abrir um. */
export function CashPanel() {
  const can = useCan();
  const current = useQuery({ ...currentCashQuery, enabled: can('cash.operate') });
  const [opening, setOpening] = useState(false);
  if (!can('cash.operate')) return null;
  const session = current.data?.session ?? null;
  return (
    <Panel labelledBy="cash-title">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <h2
          id="cash-title"
          className="flex items-center gap-2 font-display text-[15px] font-semibold"
        >
          <Wallet className="size-4 text-ink-muted" aria-hidden />
          {session ? `Caixa ${String(session.code)}` : 'Caixa'}
        </h2>
        {session ? (
          <Link
            to="/vendas/caixas/$cashId"
            params={{ cashId: session.id }}
            className="text-xs text-sage-700 hover:underline"
          >
            Movimentos
          </Link>
        ) : null}
      </div>
      <div className="border-t border-line px-4 py-3 text-sm">
        {current.isPending ? (
          <SkeletonRows rows={1} columns={1} />
        ) : current.isError ? (
          <p role="alert" className="text-danger-600">
            {errorMessage(current.error)}
          </p>
        ) : session ? (
          <dl className="space-y-0.5">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">Aberto em</dt>
              <dd>{formatDateTime(session.openedAt)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">Vendas recebidas</dt>
              <dd className="font-mono tabular-nums">{formatMoney(session.salesTotal)}</dd>
            </div>
            <div className="flex justify-between gap-3 font-medium">
              <dt>Dinheiro em caixa</dt>
              <dd className="font-mono tabular-nums">{formatMoney(session.expectedCash)}</dd>
            </div>
          </dl>
        ) : (
          <div className="space-y-3">
            <p className="text-ink-muted">Abra o seu caixa para registrar recebimentos.</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setOpening(true);
              }}
            >
              Abrir caixa
            </Button>
          </div>
        )}
      </div>
      {opening ? (
        <OpenCashDialog
          onClose={() => {
            setOpening(false);
          }}
        />
      ) : null}
    </Panel>
  );
}
