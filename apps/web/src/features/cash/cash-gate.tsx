import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useCan } from '../../lib/session';
import { OpenCashDialog } from './open-cash-dialog';
import { currentCashQuery } from './queries';

/**
 * Recebimento e estorno passam pelo caixa aberto do operador [RN-29]. Sem caixa aberto, pede a
 * abertura antes e segue com a ação; o servidor confere de novo.
 */
export function useCashGate(reason: string): {
  gate: (action: () => void) => void;
  dialog: ReactNode;
} {
  const can = useCan();
  const current = useQuery({ ...currentCashQuery, enabled: can('cash.operate') });
  const [pending, setPending] = useState<(() => void) | null>(null);
  return {
    gate: (action) => {
      if (can('cash.operate') && current.isSuccess && !current.data.session) {
        setPending(() => action);
        return;
      }
      action();
    },
    dialog: pending ? (
      <OpenCashDialog
        reason={reason}
        onClose={() => {
          setPending(null);
        }}
        onOpened={() => {
          pending();
        }}
      />
    ) : null,
  };
}
