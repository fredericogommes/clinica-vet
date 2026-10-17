import {
  cancelEntrySchema,
  entryInputSchema,
  entrySchema,
  entryStatusLabels,
  entryUpdateSchema,
  payEntrySchema,
  transferInputSchema,
  type Entry,
  type FinanceOptions,
} from '@clinica/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { z } from 'zod';
import { Button } from '../../design-system/button';
import { Checkbox } from '../../design-system/checkbox';
import { Dialog } from '../../design-system/dialog';
import { SelectField, TextareaField, TextField } from '../../design-system/field';
import { Badge, Facts } from '../../design-system/layout';
import { useToast } from '../../design-system/toast';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { formatCalendarDate } from '../../lib/format';
import { useCan } from '../../lib/session';
import { formatMoney, moneyInput, parseDecimal } from '../products/format';
import { categoryLabel, categoryTree } from './queries';

type Errors = Record<string, string>;

/** Primeira mensagem de cada campo, como os demais formulários. */
const issuesOf = (error: z.ZodError): Errors => {
  const found: Errors = {};
  for (const issue of error.issues) found[issue.path.join('.')] ??= issue.message;
  return found;
};

function useFinanceMutation<V>(
  fn: (vars: V) => Promise<unknown>,
  success: string,
  onDone: () => void,
) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<Errors>({});
  const mutation = useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance'] });
      toast.success(success);
      onDone();
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.fieldErrors.length > 0) {
        setErrors(Object.fromEntries(e.fieldErrors.map((f) => [f.path, f.message])));
      }
    },
  });
  const generalError =
    mutation.isError &&
    !(mutation.error instanceof ApiRequestError && mutation.error.fieldErrors.length > 0)
      ? errorMessage(mutation.error)
      : null;
  return { mutation, errors, setErrors, generalError };
}

function GeneralError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600">
      {message}
    </p>
  ) : null;
}

function FormDialog({
  id,
  title,
  description,
  submitLabel,
  pending,
  onClose,
  onSubmit,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  submitLabel: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      {...(description ? { description } : {})}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" form={id} pending={pending}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        id={id}
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        {children}
      </form>
    </Dialog>
  );
}

const money = (text: string) => parseDecimal(text) ?? Number.NaN;

// Lançamento novo ou edição ------------------------------------------------------------------------

export function EntryFormDialog({
  kind,
  entry,
  options,
  onClose,
}: {
  kind: 'income' | 'expense';
  entry: Entry | null;
  options: FinanceOptions;
  onClose: () => void;
}) {
  const isIncome = kind === 'income';
  const activeAccounts = options.accounts.filter((a) => !a.archived || a.id === entry?.account.id);
  const categories = categoryTree(options.categories).filter(
    (c) => c.kind === kind && (!c.archived || c.id === entry?.category?.id),
  );
  const [description, setDescription] = useState(entry?.description ?? '');
  const [amount, setAmount] = useState(entry ? moneyInput(entry.amount) : '');
  const [dueDate, setDueDate] = useState(entry?.dueDate ?? options.today);
  const [competenceDate, setCompetenceDate] = useState(entry?.competenceDate ?? '');
  const [accountId, setAccountId] = useState(
    entry?.account.id ??
      activeAccounts.find((a) => a.kind === 'bank')?.id ??
      activeAccounts[0]?.id ??
      '',
  );
  const [categoryId, setCategoryId] = useState(entry?.category?.id ?? '');
  const [supplierId, setSupplierId] = useState(entry?.supplier?.id ?? '');
  const [costCenterId, setCostCenterId] = useState(entry?.costCenter?.id ?? '');
  const [document, setDocument] = useState(entry?.document ?? '');
  const [repeat, setRepeat] = useState<'none' | 'installments' | 'monthly'>('none');
  const [count, setCount] = useState('2');
  const [paid, setPaid] = useState(false);
  const [paidOn, setPaidOn] = useState(options.today);
  const [notes, setNotes] = useState(entry?.notes ?? '');

  const noun = isIncome ? 'receita' : 'despesa';
  const { mutation, errors, setErrors, generalError } = useFinanceMutation(
    (body: unknown) =>
      entry
        ? api('PUT', `/finance/entries/${entry.id}`, entrySchema, body)
        : api('POST', '/finance/entries', z.array(entrySchema), body),
    entry ? 'Lançamento alterado.' : isIncome ? 'Receita lançada.' : 'Despesa lançada.',
    onClose,
  );
  const clear = (field: string) => {
    if (errors[field]) setErrors(({ [field]: _, ...rest }) => rest);
  };

  const submit = () => {
    const common = {
      description,
      document,
      accountId,
      categoryId,
      supplierId: isIncome ? null : supplierId || null,
      costCenterId: costCenterId || null,
      amount: money(amount),
      dueDate,
      notes,
    };
    const parsed = entry
      ? entryUpdateSchema.safeParse({ ...common, competenceDate })
      : entryInputSchema.safeParse({
          ...common,
          kind,
          competenceDate: competenceDate || null,
          repeat,
          count: repeat === 'none' ? 1 : Number(count),
          paidOn: paid ? paidOn : null,
        });
    if (!parsed.success) {
      setErrors(issuesOf(parsed.error));
      return;
    }
    mutation.mutate(parsed.data);
  };

  return (
    <FormDialog
      id="entry-form"
      title={entry ? `Editar ${noun}` : `Nova ${noun}`}
      submitLabel="Salvar"
      pending={mutation.isPending}
      onClose={onClose}
      onSubmit={submit}
    >
      <GeneralError message={generalError} />
      <TextField
        label="Descrição"
        autoComplete="off"
        placeholder={isIncome ? 'Ex.: Aluguel de sala para parceiro' : 'Ex.: Aluguel de março'}
        value={description}
        error={errors.description}
        onChange={(e) => {
          setDescription(e.target.value);
          clear('description');
        }}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={repeat === 'installments' ? 'Valor total' : 'Valor'}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0,00"
          value={amount}
          error={errors.amount}
          onChange={(e) => {
            setAmount(e.target.value);
            clear('amount');
          }}
        />
        <TextField
          label={repeat === 'none' ? 'Vencimento' : 'Primeiro vencimento'}
          type="date"
          value={dueDate}
          error={errors.dueDate}
          onChange={(e) => {
            setDueDate(e.target.value);
            clear('dueDate');
          }}
        />
        <SelectField
          label="Conta"
          value={accountId}
          placeholder="Escolha"
          options={activeAccounts.map((a) => ({ value: a.id, label: a.name }))}
          error={errors.accountId}
          onChange={(e) => {
            setAccountId(e.target.value);
            clear('accountId');
          }}
        />
        <SelectField
          label="Categoria"
          value={categoryId}
          placeholder="Escolha"
          options={categories.map((c) => ({
            value: c.id,
            label: categoryLabel(c, options.categories),
          }))}
          error={errors.categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            clear('categoryId');
          }}
        />
        {isIncome ? null : (
          <SelectField
            label="Fornecedor"
            value={supplierId}
            placeholder="Nenhum"
            options={options.suppliers
              .concat(
                entry?.supplier && !options.suppliers.some((s) => s.id === entry.supplier?.id)
                  ? [entry.supplier]
                  : [],
              )
              .map((s) => ({ value: s.id, label: s.name }))}
            error={errors.supplierId}
            onChange={(e) => {
              setSupplierId(e.target.value);
            }}
          />
        )}
        <TextField
          label="Documento"
          autoComplete="off"
          placeholder="Nota, boleto ou recibo"
          value={document}
          error={errors.document}
          onChange={(e) => {
            setDocument(e.target.value);
          }}
        />
        <TextField
          label="Competência"
          type="date"
          value={competenceDate}
          error={errors.competenceDate}
          hint={entry ? undefined : 'Mês a que pertence. Vazio, vale o vencimento.'}
          onChange={(e) => {
            setCompetenceDate(e.target.value);
            clear('competenceDate');
          }}
        />
        {options.costCenters.length > 1 ? (
          <SelectField
            label="Centro de custo"
            value={costCenterId}
            placeholder="Padrão da unidade"
            options={options.costCenters.map((c) => ({ value: c.id, label: c.name }))}
            error={errors.costCenterId}
            onChange={(e) => {
              setCostCenterId(e.target.value);
            }}
          />
        ) : null}
      </div>
      {entry ? null : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Repetição"
              value={repeat}
              options={[
                { value: 'none', label: 'Não repete' },
                { value: 'installments', label: 'Parcelado (divide o valor)' },
                { value: 'monthly', label: 'Todo mês (repete o valor)' },
              ]}
              onChange={(e) => {
                setRepeat(e.target.value as typeof repeat);
                clear('count');
              }}
            />
            {repeat === 'none' ? null : (
              <TextField
                label={repeat === 'installments' ? 'Parcelas' : 'Meses'}
                inputMode="numeric"
                autoComplete="off"
                value={count}
                error={errors.count}
                onChange={(e) => {
                  setCount(e.target.value.replace(/\D/g, '').slice(0, 2));
                  clear('count');
                }}
              />
            )}
          </div>
          <Checkbox
            label={isIncome ? 'Já recebida' : 'Já paga'}
            description={
              repeat === 'none'
                ? 'Registra o pagamento junto com o lançamento.'
                : 'Registra o pagamento da primeira parcela; as demais ficam em aberto.'
            }
            checked={paid}
            onCheckedChange={setPaid}
          />
          {paid ? (
            <div className="sm:w-1/2">
              <TextField
                label={isIncome ? 'Recebida em' : 'Paga em'}
                type="date"
                value={paidOn}
                error={errors.paidOn}
                onChange={(e) => {
                  setPaidOn(e.target.value);
                  clear('paidOn');
                }}
              />
            </div>
          ) : null}
        </>
      )}
      <TextareaField
        label="Observações"
        rows={2}
        value={notes}
        error={errors.notes}
        onChange={(e) => {
          setNotes(e.target.value);
        }}
      />
    </FormDialog>
  );
}

// Baixa --------------------------------------------------------------------------------------------

export function PayDialog({
  entry,
  options,
  onClose,
}: {
  entry: Entry;
  options: FinanceOptions;
  onClose: () => void;
}) {
  const isIncome = entry.direction === 'in';
  const [paidOn, setPaidOn] = useState(options.today);
  const [accountId, setAccountId] = useState(entry.account.id);
  const [amount, setAmount] = useState(moneyInput(entry.amount));
  const { mutation, errors, setErrors, generalError } = useFinanceMutation(
    (body: unknown) => api('POST', `/finance/entries/${entry.id}/pay`, entrySchema, body),
    isIncome ? 'Recebimento registrado.' : 'Pagamento registrado.',
    onClose,
  );
  const submit = () => {
    const parsed = payEntrySchema.safeParse({ paidOn, accountId, amount: money(amount) });
    if (!parsed.success) {
      setErrors(issuesOf(parsed.error));
      return;
    }
    mutation.mutate(parsed.data);
  };
  return (
    <FormDialog
      id="pay-form"
      title={isIncome ? 'Registrar recebimento' : 'Registrar pagamento'}
      description={`${entry.description} · ${formatMoney(entry.amount)} com vencimento em ${formatCalendarDate(entry.dueDate)}`}
      submitLabel={isIncome ? 'Confirmar recebimento' : 'Confirmar pagamento'}
      pending={mutation.isPending}
      onClose={onClose}
      onSubmit={submit}
    >
      <GeneralError message={generalError} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={isIncome ? 'Recebido em' : 'Pago em'}
          type="date"
          value={paidOn}
          error={errors.paidOn}
          onChange={(e) => {
            setPaidOn(e.target.value);
          }}
        />
        <TextField
          label="Valor pago"
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          error={errors.amount}
          hint="Com juros ou desconto, informe o valor efetivo."
          onChange={(e) => {
            setAmount(e.target.value);
          }}
        />
      </div>
      <SelectField
        label="Conta"
        value={accountId}
        options={options.accounts
          .filter((a) => !a.archived || a.id === entry.account.id)
          .map((a) => ({ value: a.id, label: a.name }))}
        error={errors.accountId}
        onChange={(e) => {
          setAccountId(e.target.value);
        }}
      />
    </FormDialog>
  );
}

// Cancelamento -------------------------------------------------------------------------------------

export function CancelEntryDialog({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [following, setFollowing] = useState(false);
  const { mutation, errors, setErrors, generalError } = useFinanceMutation(
    (body: unknown) => api('POST', `/finance/entries/${entry.id}/cancel`, entrySchema, body),
    'Lançamento cancelado.',
    onClose,
  );
  const hasNext = entry.installment !== null && entry.installment.number < entry.installment.total;
  const submit = () => {
    const parsed = cancelEntrySchema.safeParse({ reason, following });
    if (!parsed.success) {
      setErrors(issuesOf(parsed.error));
      return;
    }
    mutation.mutate(parsed.data);
  };
  return (
    <FormDialog
      id="cancel-entry-form"
      title="Cancelar lançamento"
      description={
        entry.kind === 'transfer'
          ? 'As duas pontas da transferência são canceladas juntas.'
          : `${entry.description} · ${formatMoney(entry.amount)}`
      }
      submitLabel="Cancelar lançamento"
      pending={mutation.isPending}
      onClose={onClose}
      onSubmit={submit}
    >
      <GeneralError message={generalError} />
      <TextField
        label="Motivo"
        autoComplete="off"
        value={reason}
        error={errors.reason}
        onChange={(e) => {
          setReason(e.target.value);
        }}
      />
      {hasNext ? (
        <Checkbox
          label="Cancelar também as próximas parcelas em aberto"
          checked={following}
          onCheckedChange={setFollowing}
        />
      ) : null}
    </FormDialog>
  );
}

// Transferência ------------------------------------------------------------------------------------

export function TransferDialog({
  options,
  onClose,
}: {
  options: FinanceOptions;
  onClose: () => void;
}) {
  const active = options.accounts.filter((a) => !a.archived);
  const [fromAccountId, setFrom] = useState(active.find((a) => a.kind === 'cash')?.id ?? '');
  const [toAccountId, setTo] = useState(active.find((a) => a.kind === 'bank')?.id ?? '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(options.today);
  const [description, setDescription] = useState('');
  const { mutation, errors, setErrors, generalError } = useFinanceMutation(
    (body: unknown) => api('POST', '/finance/transfers', z.array(entrySchema), body),
    'Transferência registrada.',
    onClose,
  );
  const submit = () => {
    const parsed = transferInputSchema.safeParse({
      fromAccountId,
      toAccountId,
      amount: money(amount),
      date,
      description,
    });
    if (!parsed.success) {
      setErrors(issuesOf(parsed.error));
      return;
    }
    mutation.mutate(parsed.data);
  };
  const accountOptions = active.map((a) => ({ value: a.id, label: a.name }));
  return (
    <FormDialog
      id="transfer-form"
      title="Transferência entre contas"
      description="Ex.: depósito do dinheiro do caixa no banco. Não conta como receita nem despesa."
      submitLabel="Transferir"
      pending={mutation.isPending}
      onClose={onClose}
      onSubmit={submit}
    >
      <GeneralError message={generalError} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Sai de"
          value={fromAccountId}
          placeholder="Escolha"
          options={accountOptions}
          error={errors.fromAccountId}
          onChange={(e) => {
            setFrom(e.target.value);
          }}
        />
        <SelectField
          label="Entra em"
          value={toAccountId}
          placeholder="Escolha"
          options={accountOptions}
          error={errors.toAccountId}
          onChange={(e) => {
            setTo(e.target.value);
          }}
        />
        <TextField
          label="Valor"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0,00"
          value={amount}
          error={errors.amount}
          onChange={(e) => {
            setAmount(e.target.value);
          }}
        />
        <TextField
          label="Data"
          type="date"
          value={date}
          error={errors.date}
          onChange={(e) => {
            setDate(e.target.value);
          }}
        />
      </div>
      <TextField
        label="Descrição"
        autoComplete="off"
        placeholder="Opcional"
        value={description}
        error={errors.description}
        onChange={(e) => {
          setDescription(e.target.value);
        }}
      />
    </FormDialog>
  );
}

// Detalhe ------------------------------------------------------------------------------------------

export type EntryAction = 'pay' | 'edit' | 'cancel';

export function entryStatus(e: Entry): {
  label: string;
  tone: 'neutral' | 'sage' | 'amber' | 'danger';
} {
  if (e.status === 'cancelled') return { label: entryStatusLabels.cancelled, tone: 'neutral' };
  if (e.status === 'paid') {
    return {
      label: e.kind === 'transfer' ? 'Efetivada' : e.direction === 'in' ? 'Recebido' : 'Pago',
      tone: 'sage',
    };
  }
  return e.overdue
    ? { label: 'Vencido', tone: 'danger' }
    : { label: e.direction === 'in' ? 'A receber' : 'A pagar', tone: 'amber' };
}

export function EntryDetailDialog({
  entry,
  onAction,
  onClose,
}: {
  entry: Entry;
  onAction: (action: EntryAction) => void;
  onClose: () => void;
}) {
  const can = useCan();
  const fromSale =
    entry.origin === 'sale' ||
    entry.origin === 'card_fee' ||
    entry.origin === 'purchase' ||
    entry.origin === 'commission';
  const adjustment = entry.origin === 'card_adjustment';
  const status = entryStatus(entry);
  const { mutation: reopen, generalError } = useFinanceMutation(
    (_: null) => api('POST', `/finance/entries/${entry.id}/reopen`, entrySchema),
    'Lançamento reaberto.',
    onClose,
  );
  const manage = can('finance.manage');
  const actions: ReactNode[] = [];
  if (manage && entry.status === 'open') {
    actions.push(
      <Button
        key="pay"
        onClick={() => {
          onAction('pay');
        }}
      >
        {entry.direction === 'in' ? 'Registrar recebimento' : 'Registrar pagamento'}
      </Button>,
    );
    if (entry.origin === 'manual') {
      actions.push(
        <Button
          key="edit"
          variant="secondary"
          onClick={() => {
            onAction('edit');
          }}
        >
          Editar
        </Button>,
      );
    }
  }
  if (manage && entry.status === 'paid' && entry.kind !== 'transfer' && !adjustment) {
    actions.push(
      <Button
        key="reopen"
        variant="secondary"
        pending={reopen.isPending}
        onClick={() => {
          reopen.mutate(null);
        }}
      >
        Desfazer baixa
      </Button>,
    );
  }
  if (manage && entry.status !== 'cancelled' && !fromSale && !adjustment) {
    actions.push(
      <Button
        key="cancel"
        variant="ghost"
        onClick={() => {
          onAction('cancel');
        }}
      >
        Cancelar lançamento
      </Button>,
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={entry.description}
      footer={
        actions.length ? (
          actions
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
        )
      }
    >
      <div className="space-y-4">
        <GeneralError message={generalError} />
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={status.tone}>{status.label}</Badge>
          {entry.installment ? (
            <span className="text-xs text-ink-muted">
              Parcela {entry.installment.number} de {entry.installment.total}
            </span>
          ) : null}
        </div>
        <Facts
          items={[
            {
              label: 'Valor',
              value: <span className="font-mono">{formatMoney(entry.amount)}</span>,
            },
            ...(entry.paidOn && entry.paidAmount !== null
              ? [
                  {
                    label: entry.direction === 'in' ? 'Recebido' : 'Pago',
                    value: `${formatMoney(entry.paidAmount)} em ${formatCalendarDate(entry.paidOn)}`,
                  },
                ]
              : []),
            { label: 'Vencimento', value: formatCalendarDate(entry.dueDate) },
            { label: 'Competência', value: formatCalendarDate(entry.competenceDate) },
            {
              label: 'Conta',
              value: entry.counterpart
                ? `${entry.account.name} (${entry.direction === 'out' ? 'para' : 'de'} ${entry.counterpart.name})`
                : entry.account.name,
            },
            { label: 'Categoria', value: entry.category?.name },
            ...(entry.supplier ? [{ label: 'Fornecedor', value: entry.supplier.name }] : []),
            ...(entry.client
              ? [
                  {
                    label: 'Cliente',
                    value: (
                      <Link
                        to="/clientes/$clientId"
                        params={{ clientId: entry.client.id }}
                        className="text-sage-700 hover:underline"
                      >
                        {entry.client.name}
                      </Link>
                    ),
                  },
                ]
              : []),
            ...(entry.sale
              ? [
                  {
                    label: 'Venda',
                    value: (
                      <Link
                        to="/vendas/$saleId"
                        params={{ saleId: entry.sale.id }}
                        className="text-sage-700 hover:underline"
                      >
                        Venda {entry.sale.code}
                      </Link>
                    ),
                  },
                ]
              : []),
            ...(entry.purchase
              ? [
                  {
                    label: 'Compra',
                    value: (
                      <Link
                        to="/estoque/compras/$purchaseId"
                        params={{ purchaseId: entry.purchase.id }}
                        className="text-sage-700 hover:underline"
                      >
                        Compra {entry.purchase.code}
                      </Link>
                    ),
                  },
                ]
              : []),
            ...(entry.commissionStatement
              ? [
                  {
                    label: 'Comissão',
                    value: (
                      <Link
                        to="/comissoes/extratos/$statementId"
                        params={{ statementId: entry.commissionStatement.id }}
                        className="text-sage-700 hover:underline"
                      >
                        Extrato {entry.commissionStatement.code}
                      </Link>
                    ),
                  },
                ]
              : []),
            ...(entry.costCenter
              ? [{ label: 'Centro de custo', value: entry.costCenter.name }]
              : []),
            ...(entry.document ? [{ label: 'Documento', value: entry.document }] : []),
            ...(entry.notes ? [{ label: 'Observações', value: entry.notes }] : []),
            ...(entry.cancelReason
              ? [{ label: 'Motivo do cancelamento', value: entry.cancelReason }]
              : []),
          ]}
        />
        {fromSale && entry.status !== 'cancelled' ? (
          <p className="text-xs text-ink-muted">
            {entry.origin === 'purchase'
              ? 'Lançado pela compra. Para cancelar, cancele a compra.'
              : entry.origin === 'commission'
                ? 'Lançado pelo extrato de comissão. Para cancelar, ponha o extrato em revisão.'
                : 'Lançado pela venda. Para cancelar, estorne a venda.'}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
