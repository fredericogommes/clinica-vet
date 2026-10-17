import {
  fromCents,
  saleSchema,
  splitInstallments,
  toCents,
  type PaymentMethod,
  type Sale,
  type SalePaymentInput,
} from '@clinica/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../design-system/button';
import { Dialog } from '../../design-system/dialog';
import { SelectField, TextField } from '../../design-system/field';
import { useToast } from '../../design-system/toast';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { formatCalendarDate } from '../../lib/format';
import { addDays, localToday } from '../schedule/dates';
import { formatMoney, moneyInput, parseDecimal } from '../products/format';
import { saleQuery } from './queries';

interface Line {
  key: number;
  methodId: string;
  amount: string;
  installments: number;
}

/** "3× de R$ 50,00", ou "1ª de R$ 33,34 e 2× de R$ 33,33" quando sobram centavos. */
function installmentsHint(parts: number[]): string {
  const first = parts[0] ?? 0;
  const rest = parts[parts.length - 1] ?? 0;
  if (first === rest) return `${String(parts.length)}× de ${formatMoney(fromCents(rest))}`;
  return `1ª de ${formatMoney(fromCents(first))} e ${String(parts.length - 1)}× de ${formatMoney(fromCents(rest))}`;
}

const centsOf = (text: string) => {
  const value = parseDecimal(text);
  return value === null || Number.isNaN(value) ? 0 : toCents(value);
};

/**
 * Registrar recebimento [p.9, RN-27]: uma ou mais formas que somam o total da venda. O servidor
 * confere a soma e o parcelamento de cada forma e baixa a venda. Em `settle`, recebe o que ficou
 * na conta do cliente [p.10]: tudo ou uma parte, sem a própria conta como forma.
 */
export function ReceiveDialog({
  sale,
  methods: allMethods,
  mode = 'receive',
  onClose,
  onReceived,
}: {
  sale: Sale;
  methods: PaymentMethod[];
  mode?: 'receive' | 'settle';
  onClose: () => void;
  onReceived?: (sale: Sale) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const settling = mode === 'settle';
  // A conta do cliente só serve para venda com cliente, e nunca para quitar a própria conta.
  const methods = allMethods.filter((m) => m.kind !== 'account' || (!settling && sale.client));
  const target = settling ? sale.clientDebt : sale.netTotal;
  const [lines, setLines] = useState<Line[]>(() =>
    target > 0
      ? [
          {
            key: 0,
            methodId: methods.find((m) => m.kind !== 'account')?.id ?? '',
            amount: moneyInput(target),
            installments: 1,
          },
        ]
      : [],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const totalCents = toCents(target);
  const paidCents = lines.reduce((a, l) => a + centsOf(l.amount), 0);
  const remaining = totalCents - paidCents;

  const receive = useMutation({
    mutationFn: (payments: SalePaymentInput[]) =>
      api('POST', `/sales/${sale.id}/${settling ? 'settle' : 'receive'}`, saleSchema, {
        payments,
      }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(saleQuery(saved.id).queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: ['sales'] });
      await queryClient.invalidateQueries({ queryKey: ['cash'] });
      toast.success(
        settling
          ? `Recebido ${formatMoney(fromCents(paidCents))} da venda ${String(saved.code)}.` +
              (saved.clientDebt > 0
                ? ` Continua pendurado ${formatMoney(saved.clientDebt)}.`
                : ' Conta quitada.')
          : `Venda ${String(saved.code)} recebida e baixada.`,
      );
      onReceived?.(saved);
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.fieldErrors.length > 0) {
        setErrors(Object.fromEntries(e.fieldErrors.map((f) => [f.path, f.message])));
      }
    },
  });

  const change = (key: number, patch: Partial<Line>) => {
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setErrors({});
  };

  const submit = () => {
    const found: Record<string, string> = {};
    const payments = lines.map((l, i) => {
      const amount = parseDecimal(l.amount);
      if (!l.methodId) found[`payments.${String(i)}.methodId`] = 'Escolha a forma';
      if (amount === null || Number.isNaN(amount) || amount <= 0) {
        found[`payments.${String(i)}.amount`] = 'Informe um valor maior que zero';
      }
      return { methodId: l.methodId, amount: amount ?? 0, installments: l.installments };
    });
    if (settling) {
      if (Object.keys(found).length === 0 && remaining < 0) {
        found.payments = `Passou ${formatMoney(fromCents(-remaining))} do que falta receber`;
      }
      if (lines.length === 0) found.payments = 'Informe ao menos uma forma';
    } else if (Object.keys(found).length === 0 && remaining !== 0) {
      found.payments =
        remaining > 0
          ? `Faltam ${formatMoney(fromCents(remaining))} para fechar o total`
          : `Passou ${formatMoney(fromCents(-remaining))} do total`;
    }
    setErrors(found);
    if (Object.keys(found).length === 0) receive.mutate(payments);
  };

  const generalError =
    errors.payments ??
    (receive.isError &&
    !(receive.error instanceof ApiRequestError && receive.error.fieldErrors.length > 0)
      ? errorMessage(receive.error)
      : undefined);

  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={
        settling
          ? `Receber da conta do cliente, venda ${String(sale.code)}`
          : `Registrar recebimento da venda ${String(sale.code)}`
      }
      description={
        settling
          ? `Falta receber ${formatMoney(sale.clientDebt)}. O cliente pode pagar tudo ou só uma parte.`
          : `Total de ${formatMoney(sale.netTotal)}. Divida entre várias formas se o cliente pagar de mais de um jeito.`
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button pending={receive.isPending} onClick={submit}>
            {settling ? 'Receber' : 'Receber e baixar venda'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {methods.length === 0 ? (
          <p
            role="alert"
            className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600"
          >
            Nenhuma forma de recebimento ativa. Cadastre em Vendas › Formas de recebimento.
          </p>
        ) : null}
        <ul className="space-y-3" aria-label="Formas de recebimento da venda">
          {lines.map((line, i) => {
            const method = methods.find((m) => m.id === line.methodId);
            const max = method?.maxInstallments ?? 1;
            const cents = centsOf(line.amount);
            const parts = cents > 0 ? splitInstallments(cents, line.installments) : [];
            const label = `Forma ${String(i + 1)}`;
            return (
              <li
                key={line.key}
                className="grid gap-3 rounded-control border border-line p-3 sm:grid-cols-[minmax(0,1fr)_9rem_9rem_auto] sm:items-start"
              >
                <SelectField
                  label="Forma de recebimento"
                  aria-label={`${label}: forma de recebimento`}
                  value={line.methodId}
                  options={methods.map((m) => ({ value: m.id, label: m.name }))}
                  error={errors[`payments.${String(i)}.methodId`]}
                  onChange={(e) => {
                    const next = methods.find((m) => m.id === e.target.value);
                    change(line.key, {
                      methodId: e.target.value,
                      installments: Math.min(line.installments, next?.maxInstallments ?? 1),
                    });
                  }}
                />
                <TextField
                  label="Valor (R$)"
                  aria-label={`${label}: valor`}
                  inputMode="decimal"
                  autoComplete="off"
                  value={line.amount}
                  error={errors[`payments.${String(i)}.amount`]}
                  onChange={(e) => {
                    change(line.key, { amount: e.target.value });
                  }}
                />
                {max > 1 ? (
                  <SelectField
                    label="Parcelas"
                    aria-label={`${label}: parcelas`}
                    value={String(line.installments)}
                    options={Array.from({ length: max }, (_, n) => ({
                      value: String(n + 1),
                      label: n === 0 ? 'À vista' : `${String(n + 1)}×`,
                    }))}
                    error={errors[`payments.${String(i)}.installments`]}
                    hint={
                      line.installments > 1 && parts.length > 0
                        ? installmentsHint(parts)
                        : undefined
                    }
                    onChange={(e) => {
                      change(line.key, { installments: Number(e.target.value) });
                    }}
                  />
                ) : method?.kind === 'account' ? (
                  <p className="text-xs text-ink-muted sm:pt-8">
                    Fica na conta, vence em{' '}
                    {formatCalendarDate(addDays(localToday(), method.settlementDays))}
                  </p>
                ) : (
                  <p className="hidden text-xs text-ink-muted sm:block sm:pt-8">À vista</p>
                )}
                <div className="flex justify-end sm:pt-6">
                  {lines.length > 1 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remover ${label.toLowerCase()}`}
                      icon={<Trash2 className="size-4" aria-hidden />}
                      onClick={() => {
                        setLines((all) => all.filter((l) => l.key !== line.key));
                        setErrors({});
                      }}
                    >
                      <span className="sm:hidden">Remover</span>
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
        {methods.length > 0 && lines.length < 10 ? (
          <Button
            variant="ghost"
            size="sm"
            icon={<Plus className="size-4" aria-hidden />}
            onClick={() => {
              const used = new Set(lines.map((l) => l.methodId));
              const next = methods.find((m) => !used.has(m.id)) ?? methods[0];
              setLines((all) => [
                ...all,
                {
                  key: Math.max(-1, ...all.map((l) => l.key)) + 1,
                  methodId: next?.id ?? '',
                  amount: remaining > 0 ? moneyInput(fromCents(remaining)) : '',
                  installments: 1,
                },
              ]);
              setErrors({});
            }}
          >
            Dividir com outra forma
          </Button>
        ) : null}
        <dl className="space-y-1 border-t border-line pt-3 text-sm" aria-live="polite">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-muted">
              {settling ? 'Na conta do cliente' : 'Total da venda'}
            </dt>
            <dd className="font-mono tabular-nums">{formatMoney(target)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-muted">Informado</dt>
            <dd className="font-mono tabular-nums">{formatMoney(fromCents(paidCents))}</dd>
          </div>
          <div className="flex justify-between gap-3 font-medium">
            <dt>{remaining < 0 ? 'Passou' : settling ? 'Continua pendurado' : 'Falta'}</dt>
            <dd
              className={
                remaining === 0 || (settling && remaining > 0)
                  ? 'font-mono tabular-nums text-sage-700'
                  : 'font-mono tabular-nums text-danger-600'
              }
            >
              {formatMoney(fromCents(Math.abs(remaining)))}
            </dd>
          </div>
        </dl>
        {generalError ? (
          <p
            role="alert"
            className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600"
          >
            {generalError}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
