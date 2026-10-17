import {
  commissionBaseLabels,
  commissionBases,
  commissionCriteria,
  commissionCriterionLabels,
  commissionSettingsSchema,
  type CommissionBase,
  type CommissionCriterion,
  type CommissionSettings,
  type CommissionSettingsInput,
} from '@clinica/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../design-system/button';
import { Checkbox } from '../../design-system/checkbox';
import { SelectField } from '../../design-system/field';
import { FormActions, PageHeader, Section } from '../../design-system/layout';
import { ErrorState, SkeletonRows } from '../../design-system/states';
import { useToast } from '../../design-system/toast';
import { api, errorMessage } from '../../lib/api';
import { formatCalendarDate } from '../../lib/format';
import { commissionSettingsQuery } from './queries';

/** Configuração de comissões [p.10–11]: as quatro decisões da clínica e quem é comissionado. */
export function CommissionSettingsPage() {
  const settings = useQuery(commissionSettingsQuery);
  if (settings.isPending) return <SkeletonRows />;
  if (settings.isError) {
    return (
      <ErrorState message={errorMessage(settings.error)} onRetry={() => void settings.refetch()} />
    );
  }
  return (
    <>
      <RulesForm initial={settings.data} />
      <Staff settings={settings.data} />
    </>
  );
}

function RulesForm({ initial }: { initial: CommissionSettings }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [base, setBase] = useState<CommissionBase>(initial.base);
  const [criterion, setCriterion] = useState<CommissionCriterion>(initial.criterion);
  const [financeIntegration, setFinanceIntegration] = useState(initial.financeIntegration);
  const [staffCanSeeOwn, setStaffCanSeeOwn] = useState(initial.staffCanSeeOwn);
  const save = useMutation({
    mutationFn: (body: CommissionSettingsInput) =>
      api('PUT', '/commissions/settings', commissionSettingsSchema, body),
    onSuccess: async (saved) => {
      queryClient.setQueryData(commissionSettingsQuery.queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: ['commissions', 'open'] });
      toast.success('Configuração de comissões salva.');
    },
  });
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ base, criterion, financeIntegration, staffCanSeeOwn });
      }}
    >
      <PageHeader
        area="Comissionamento"
        title="Configuração de comissões"
        description="O percentual vem do cadastro de cada produto e serviço, com o profissional lançado no item da venda. Aqui ficam as regras da clínica."
      />
      {save.isError ? (
        <p
          role="alert"
          className="mb-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600"
        >
          {errorMessage(save.error)}
        </p>
      ) : null}
      <Section title="Regras">
        <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
          <SelectField
            label="Base de cálculo"
            value={base}
            options={commissionBases.map((b) => ({ value: b, label: commissionBaseLabels[b] }))}
            hint="Vale para as vendas que ainda não entraram em extrato."
            onChange={(e) => {
              setBase(e.target.value as CommissionBase);
            }}
          />
          <SelectField
            label="Critério de pagamento"
            value={criterion}
            options={commissionCriteria.map((c) => ({
              value: c,
              label: commissionCriterionLabels[c],
            }))}
            hint="Recebida é a venda baixada no caixa, mesmo que o cartão ou convênio ainda não tenha caído."
            onChange={(e) => {
              setCriterion(e.target.value as CommissionCriterion);
            }}
          />
        </div>
        <div className="mt-5 max-w-3xl space-y-4">
          <Checkbox
            label="Fechar o extrato lança em contas a pagar"
            description="A despesa entra na categoria Comissões e o extrato fica pago quando ela for baixada no financeiro."
            checked={financeIntegration}
            onCheckedChange={setFinanceIntegration}
          />
          <Checkbox
            label="A equipe vê as próprias comissões"
            description="Cada profissional acompanha o que tem em aberto e os seus extratos em Minhas comissões."
            checked={staffCanSeeOwn}
            onCheckedChange={setStaffCanSeeOwn}
          />
        </div>
      </Section>
      <FormActions>
        <Button type="submit" pending={save.isPending}>
          Salvar regras
        </Button>
      </FormActions>
    </form>
  );
}

function Staff({ settings }: { settings: CommissionSettings }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const toggle = useMutation({
    mutationFn: ({ id, commissioned }: { id: string; commissioned: boolean }) =>
      api('PUT', `/commissions/staff/${id}`, commissionSettingsSchema, { commissioned }),
    onSuccess: async (saved, { id, commissioned }) => {
      queryClient.setQueryData(commissionSettingsQuery.queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: ['commissions', 'open'] });
      const name = saved.staff.find((s) => s.id === id)?.name ?? '';
      toast.success(
        commissioned ? `${name} passa a receber comissão.` : `${name} deixa de receber comissão.`,
      );
    },
    onError: (e) => {
      toast.error(errorMessage(e));
    },
  });
  const count = settings.staff.filter((s) => s.since !== null).length;
  return (
    <Section
      title="Quem recebe comissão"
      description={`${String(count)} de ${String(settings.staff.length)} pessoas da equipe. Ligada hoje, a comissão vale para as vendas a partir de hoje.`}
    >
      <div className="max-w-3xl divide-y divide-line">
        {settings.staff.map((s) => (
          <div key={s.id} className="py-3">
            <Checkbox
              label={s.name}
              description={s.since ? `${s.role} · desde ${formatCalendarDate(s.since)}` : s.role}
              checked={s.since !== null}
              disabled={toggle.isPending}
              onCheckedChange={(commissioned) => {
                toggle.mutate({ id: s.id, commissioned });
              }}
            />
          </div>
        ))}
      </div>
    </Section>
  );
}
