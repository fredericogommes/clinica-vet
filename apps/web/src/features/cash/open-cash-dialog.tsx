import { cashSessionSchema, type CashSession } from '@clinica/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../design-system/button';
import { Dialog } from '../../design-system/dialog';
import { TextField } from '../../design-system/field';
import { useToast } from '../../design-system/toast';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { formatMoney, parseDecimal } from '../products/format';

/** Abrir caixa [RN-29]: o troco inicial que está na gaveta. */
export function OpenCashDialog({
  reason,
  onOpened,
  onClose,
}: {
  /** Por que o caixa está sendo pedido agora (ex. para registrar um recebimento). */
  reason?: string;
  onOpened?: (session: CashSession) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | undefined>();
  const open = useMutation({
    mutationFn: (openingAmount: number) =>
      api('POST', '/cash', cashSessionSchema, { openingAmount, notes }),
    onSuccess: async (session) => {
      await queryClient.invalidateQueries({ queryKey: ['cash'] });
      toast.success(
        `Caixa ${String(session.code)} aberto com ${formatMoney(session.openingAmount)} de troco.`,
      );
      onClose();
      onOpened?.(session);
    },
    onError: (e) => {
      setError(
        e instanceof ApiRequestError ? (e.fieldErrors[0]?.message ?? e.message) : errorMessage(e),
      );
    },
  });
  const submit = () => {
    const value = parseDecimal(amount) ?? 0;
    if (Number.isNaN(value) || value < 0) {
      setError('Informe o troco em reais, por exemplo 100,00');
      return;
    }
    open.mutate(value);
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Abrir caixa"
      description={
        reason ?? 'Os recebimentos, sangrias e suprimentos entram no seu caixa até você fechá-lo.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" form="open-cash-form" pending={open.isPending}>
            Abrir caixa
          </Button>
        </>
      }
    >
      <form
        id="open-cash-form"
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <TextField
          label="Troco inicial (R$)"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0,00"
          value={amount}
          error={error}
          hint="Dinheiro que já está na gaveta ao abrir."
          onChange={(e) => {
            setAmount(e.target.value);
            setError(undefined);
          }}
        />
        <TextField
          label="Observação"
          autoComplete="off"
          maxLength={300}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
          }}
        />
      </form>
    </Dialog>
  );
}
