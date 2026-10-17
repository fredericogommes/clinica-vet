import {
  installableKinds,
  paymentKindLabels,
  paymentKinds,
  paymentMethodInputSchema,
  paymentMethodSchema,
  type FinancialAccount,
  type PaymentKind,
  type PaymentMethod,
} from '@clinica/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Plus } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { Button } from '../../design-system/button';
import { Checkbox } from '../../design-system/checkbox';
import { Dialog } from '../../design-system/dialog';
import { SelectField, TextField } from '../../design-system/field';
import { Badge, PageHeader, Section } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { useToast } from '../../design-system/toast';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { useCan } from '../../lib/session';
import { accountsQuery } from '../finance/queries';
import { formatPercent, parseDecimal, percentInput } from '../products/format';

export const paymentMethodsQuery = queryOptions({
  queryKey: ['payment-methods'],
  queryFn: () => api('GET', '/payment-methods', z.array(paymentMethodSchema)),
});

const settlementLabel = (days: number) =>
  days === 0 ? 'Cai no mesmo dia' : `Cai em ${String(days)} ${days === 1 ? 'dia' : 'dias'}`;

/** Formas de recebimento por adquirente e bandeira [p.9, RN-27]. */
export function PaymentMethodsPage() {
  const methods = useQuery(paymentMethodsQuery);
  const can = useCan();
  // A conta de destino é do financeiro: só aparece para quem o enxerga.
  const accounts = useQuery({ ...accountsQuery, enabled: can('finance.view') });
  const [editing, setEditing] = useState<PaymentMethod | null | undefined>(undefined);
  return (
    <>
      <PageHeader
        area="Vendas"
        title="Formas de recebimento"
        description="Cadastre cada combinação de adquirente e bandeira que a clínica aceita, com o prazo em que o dinheiro cai, o parcelamento e a taxa. Arquive o que não usa mais em vez de excluir."
      />
      <Section
        title="Formas cadastradas"
        actions={
          <Button
            variant="ghost"
            size="sm"
            icon={<Plus className="size-4" aria-hidden />}
            onClick={() => {
              setEditing(null);
            }}
          >
            Adicionar
          </Button>
        }
      >
        {methods.isPending ? (
          <SkeletonRows rows={4} columns={2} />
        ) : methods.isError ? (
          <ErrorState
            message={errorMessage(methods.error)}
            onRetry={() => void methods.refetch()}
          />
        ) : methods.data.length === 0 ? (
          <EmptyState
            icon={CreditCard}
            title="Nenhuma forma cadastrada"
            description="Cadastre dinheiro, PIX e os cartões de cada adquirente."
          />
        ) : (
          <ul className="-mx-2 divide-y divide-line">
            {methods.data.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-2 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{m.name}</span>
                  <span className="block truncate text-xs text-ink-muted">
                    {[
                      paymentKindLabels[m.kind],
                      settlementLabel(m.settlementDays),
                      m.maxInstallments > 1 ? `até ${String(m.maxInstallments)}×` : null,
                      m.feePercent > 0 ? `taxa ${formatPercent(m.feePercent)}` : null,
                      m.accountId
                        ? `cai em ${accounts.data?.find((a) => a.id === m.accountId)?.name ?? '…'}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                {m.archived ? <Badge>Arquivada</Badge> : null}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Editar ${m.name}`}
                  onClick={() => {
                    setEditing(m);
                  }}
                >
                  Editar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {editing !== undefined ? (
        <MethodDialog
          method={editing}
          accounts={accounts.data ?? null}
          onClose={() => {
            setEditing(undefined);
          }}
        />
      ) : null}
    </>
  );
}

function MethodDialog({
  method,
  accounts,
  onClose,
}: {
  method: PaymentMethod | null;
  /** Contas financeiras; nulo para quem não vê o financeiro (a conta atual é mantida). */
  accounts: FinancialAccount[] | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState(method?.name ?? '');
  const [kind, setKind] = useState<PaymentKind>(method?.kind ?? 'credit');
  const [acquirer, setAcquirer] = useState(method?.acquirer ?? '');
  const [brand, setBrand] = useState(method?.brand ?? '');
  const [settlementDays, setSettlementDays] = useState(String(method?.settlementDays ?? 30));
  const [maxInstallments, setMaxInstallments] = useState(method?.maxInstallments ?? 1);
  const [accountId, setAccountId] = useState(method?.accountId ?? '');
  const [fee, setFee] = useState(percentInput(method?.feePercent ?? 0));
  const [archived, setArchived] = useState(method?.archived ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const installable = installableKinds.includes(kind);

  const save = useMutation({
    mutationFn: (body: z.output<typeof paymentMethodInputSchema>) =>
      method
        ? api('PUT', `/payment-methods/${method.id}`, paymentMethodSchema, body)
        : api('POST', '/payment-methods', paymentMethodSchema, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: paymentMethodsQuery.queryKey });
      await queryClient.invalidateQueries({ queryKey: ['sales', 'context'] });
      toast.success(method ? 'Alterações salvas.' : 'Forma de recebimento incluída.');
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.fieldErrors.length > 0) {
        setErrors(Object.fromEntries(e.fieldErrors.map((f) => [f.path, f.message])));
      }
    },
  });

  const submit = () => {
    const days = settlementDays.trim() === '' ? Number.NaN : Number(settlementDays);
    const parsed = paymentMethodInputSchema.safeParse({
      name,
      kind,
      acquirer,
      brand,
      settlementDays: days,
      maxInstallments: installable ? maxInstallments : 1,
      feePercent: parseDecimal(fee) ?? 0,
      accountId: accountId || null,
      archived,
    });
    if (!parsed.success) {
      // A primeira mensagem de cada campo é a que aparece.
      const found: Record<string, string> = {};
      for (const issue of parsed.error.issues) found[issue.path.join('.')] ??= issue.message;
      setErrors(found);
      return;
    }
    save.mutate(parsed.data);
  };
  const clear = (field: string) => {
    if (errors[field]) setErrors(({ [field]: _, ...rest }) => rest);
  };
  const generalError =
    save.isError && !(save.error instanceof ApiRequestError && save.error.fieldErrors.length > 0)
      ? errorMessage(save.error)
      : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={method ? `Editar ${method.name}` : 'Nova forma de recebimento'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="method-form" pending={save.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <form
        id="method-form"
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
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
        <TextField
          label="Nome"
          autoComplete="off"
          placeholder="Ex.: Rede Visa Crédito"
          value={name}
          error={errors.name}
          onChange={(e) => {
            setName(e.target.value);
            clear('name');
          }}
        />
        <SelectField
          label="Tipo"
          value={kind}
          options={paymentKinds.map((k) => ({ value: k, label: paymentKindLabels[k] }))}
          error={errors.kind}
          onChange={(e) => {
            const next = e.target.value as PaymentKind;
            setKind(next);
            if (!installableKinds.includes(next)) setMaxInstallments(1);
            clear('maxInstallments');
          }}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Adquirente"
            autoComplete="off"
            placeholder="Ex.: Rede, Cielo, Stone"
            value={acquirer}
            error={errors.acquirer}
            onChange={(e) => {
              setAcquirer(e.target.value);
            }}
          />
          <TextField
            label="Bandeira"
            autoComplete="off"
            placeholder="Ex.: Visa, Master, Elo"
            value={brand}
            error={errors.brand}
            onChange={(e) => {
              setBrand(e.target.value);
            }}
          />
          <TextField
            label="Prazo de liquidação (dias)"
            inputMode="numeric"
            autoComplete="off"
            value={settlementDays}
            error={errors.settlementDays}
            hint="Em quantos dias o dinheiro cai na conta. As demais parcelas seguem de 30 em 30 dias."
            onChange={(e) => {
              setSettlementDays(e.target.value);
              clear('settlementDays');
            }}
          />
          <TextField
            label="Taxa da adquirente (%)"
            inputMode="decimal"
            autoComplete="off"
            value={fee}
            error={errors.feePercent}
            onChange={(e) => {
              setFee(e.target.value);
              clear('feePercent');
            }}
          />
          <SelectField
            label="Parcelamento"
            value={String(maxInstallments)}
            disabled={!installable}
            options={Array.from({ length: 24 }, (_, n) => ({
              value: String(n + 1),
              label: n === 0 ? 'Só à vista' : `Até ${String(n + 1)}×`,
            }))}
            error={errors.maxInstallments}
            hint={installable ? undefined : 'Só cartão de crédito e convênio parcelam.'}
            onChange={(e) => {
              setMaxInstallments(Number(e.target.value));
              clear('maxInstallments');
            }}
          />
        </div>
        {accounts ? (
          <SelectField
            label="Conta de destino"
            value={accountId}
            placeholder={kind === 'cash' ? 'Padrão: conta de dinheiro' : 'Padrão: conta bancária'}
            options={accounts
              .filter((a) => !a.archived || a.id === method?.accountId)
              .map((a) => ({ value: a.id, label: a.name }))}
            error={errors.accountId}
            hint="Onde o dinheiro cai no financeiro e onde a conciliação de cartões confere o depósito."
            onChange={(e) => {
              setAccountId(e.target.value);
              clear('accountId');
            }}
          />
        ) : null}
        {method ? (
          <Checkbox
            label="Arquivada"
            description="Some do ponto de venda; os recebimentos já registrados continuam com ela."
            checked={archived}
            onCheckedChange={setArchived}
          />
        ) : null}
      </form>
    </Dialog>
  );
}
