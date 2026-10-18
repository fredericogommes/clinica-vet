import { insurerInputSchema, insurerSchema, type Insurer } from '@clinica/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Plus, ShieldPlus } from 'lucide-react';
import { useState } from 'react';
import type { z } from 'zod';
import { Button, buttonClasses } from '../../design-system/button';
import { Checkbox } from '../../design-system/checkbox';
import { Dialog } from '../../design-system/dialog';
import { TextareaField, TextField } from '../../design-system/field';
import { Badge, PageHeader, Section } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { useToast } from '../../design-system/toast';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { formatDocument } from '../clients/format';
import { formatPercent, parseDecimal, percentInput } from '../products/format';
import { insurersQuery } from './queries';

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

export const insurerSummary = (i: Insurer) =>
  [
    i.paymentDays === 0
      ? 'Repasse no mesmo dia'
      : `Repasse em ${plural(i.paymentDays, 'dia', 'dias')}`,
    i.copayPercent > 0 ? `coparticipação ${formatPercent(i.copayPercent)}` : 'sem coparticipação',
    i.requiresAuthorization ? 'autorização prévia' : null,
  ]
    .filter(Boolean)
    .join(' · ');

/**
 * Convênios [RN-43, D3]: cada plano de saúde com prazo de repasse, coparticipação do tutor e
 * autorização prévia, e a tabela de preços própria.
 */
export function InsurersPage() {
  const insurers = useQuery(insurersQuery);
  const [editing, setEditing] = useState<Insurer | null | undefined>(undefined);
  return (
    <>
      <PageHeader
        area="Convênios"
        title="Convênios"
        description="Cadastre os planos de saúde que a clínica atende. Cada convênio tem a própria tabela de preços sobre os mesmos itens do catálogo."
      />
      <Section
        title="Convênios cadastrados"
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
        {insurers.isPending ? (
          <SkeletonRows rows={3} columns={2} />
        ) : insurers.isError ? (
          <ErrorState
            message={errorMessage(insurers.error)}
            onRetry={() => void insurers.refetch()}
          />
        ) : insurers.data.length === 0 ? (
          <EmptyState
            icon={ShieldPlus}
            title="Nenhum convênio cadastrado"
            description="Cadastre o plano de saúde e monte a tabela de preços dele."
          />
        ) : (
          <ul className="-mx-2 divide-y divide-line" aria-label="Convênios">
            {insurers.data.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-2 py-2.5">
                <span className="min-w-0 flex-1 basis-60">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{i.name}</span>
                    {i.archived ? <Badge>Arquivado</Badge> : null}
                  </span>
                  <span className="block text-xs text-ink-muted">{insurerSummary(i)}</span>
                  <span className="block text-xs text-ink-muted">
                    {plural(i.priceCount, 'item na tabela', 'itens na tabela')} ·{' '}
                    {plural(i.patientCount, 'animal com plano', 'animais com plano')}
                  </span>
                </span>
                <span className="flex gap-1">
                  <Link
                    to="/convenios/$insurerId"
                    params={{ insurerId: i.id }}
                    className={buttonClasses('secondary', 'sm')}
                    aria-label={`Tabela de preços de ${i.name}`}
                  >
                    Tabela de preços
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Editar ${i.name}`}
                    onClick={() => {
                      setEditing(i);
                    }}
                  >
                    Editar
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {editing !== undefined ? (
        <InsurerDialog
          insurer={editing}
          onClose={() => {
            setEditing(undefined);
          }}
        />
      ) : null}
    </>
  );
}

export function InsurerDialog({
  insurer,
  onClose,
}: {
  insurer: Insurer | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState(insurer?.name ?? '');
  const [document, setDocument] = useState(formatDocument(insurer?.document ?? '') ?? '');
  const [paymentDays, setPaymentDays] = useState(String(insurer?.paymentDays ?? 30));
  const [copay, setCopay] = useState(percentInput(insurer?.copayPercent ?? 0));
  const [requiresAuthorization, setRequiresAuthorization] = useState(
    insurer?.requiresAuthorization ?? false,
  );
  const [notes, setNotes] = useState(insurer?.notes ?? '');
  const [archived, setArchived] = useState(insurer?.archived ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: (body: z.output<typeof insurerInputSchema>) =>
      insurer
        ? api('PUT', `/insurers/${insurer.id}`, insurerSchema, body)
        : api('POST', '/insurers', insurerSchema, body),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['insurers'] });
      toast.success(insurer ? 'Alterações salvas.' : `Convênio ${saved.name} incluído.`);
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.fieldErrors.length > 0) {
        setErrors(Object.fromEntries(e.fieldErrors.map((f) => [f.path, f.message])));
      }
    },
  });

  const submit = () => {
    const parsed = insurerInputSchema.safeParse({
      name,
      document,
      paymentDays: paymentDays.trim() === '' ? Number.NaN : Number(paymentDays),
      copayPercent: parseDecimal(copay) ?? 0,
      requiresAuthorization,
      notes,
      archived,
    });
    if (!parsed.success) {
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
      title={insurer ? `Editar ${insurer.name}` : 'Novo convênio'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="insurer-form" pending={save.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <form
        id="insurer-form"
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
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Nome"
            autoComplete="off"
            placeholder="Ex.: PetSaúde"
            value={name}
            error={errors.name}
            onChange={(e) => {
              setName(e.target.value);
              clear('name');
            }}
          />
          <TextField
            label="CNPJ"
            inputMode="numeric"
            autoComplete="off"
            hint="Opcional."
            value={document}
            error={errors.document}
            onChange={(e) => {
              setDocument(e.target.value);
              clear('document');
            }}
          />
          <TextField
            label="Prazo de repasse (dias)"
            inputMode="numeric"
            autoComplete="off"
            hint="Dias entre o atendimento e o pagamento do convênio."
            value={paymentDays}
            error={errors.paymentDays}
            onChange={(e) => {
              setPaymentDays(e.target.value);
              clear('paymentDays');
            }}
          />
          <TextField
            label="Coparticipação do tutor (%)"
            inputMode="decimal"
            autoComplete="off"
            hint="Parte do valor da tabela que o tutor paga no balcão."
            value={copay}
            error={errors.copayPercent}
            onChange={(e) => {
              setCopay(e.target.value);
              clear('copayPercent');
            }}
          />
        </div>
        <Checkbox
          label="Exige autorização prévia"
          description="Padrão para os itens incluídos na tabela: a venda só é baixada com o número da autorização."
          checked={requiresAuthorization}
          onCheckedChange={setRequiresAuthorization}
        />
        <TextareaField
          label="Observações"
          rows={2}
          value={notes}
          error={errors.notes}
          onChange={(e) => {
            setNotes(e.target.value);
          }}
        />
        {insurer ? (
          <Checkbox
            label="Arquivado"
            description="Não vale para novos planos nem novas vendas; o histórico continua com ele."
            checked={archived}
            onCheckedChange={setArchived}
          />
        ) : null}
      </form>
    </Dialog>
  );
}
