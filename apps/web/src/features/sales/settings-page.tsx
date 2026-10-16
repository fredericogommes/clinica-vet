import {
  saleTypeLabels,
  saleTypes,
  salesSettingsSchema,
  type SalesSettings,
  type SaleType,
} from '@clinica/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../design-system/button';
import { SelectField, TextField } from '../../design-system/field';
import { FormActions, PageHeader, Section } from '../../design-system/layout';
import { ErrorState, SkeletonRows } from '../../design-system/states';
import { useToast } from '../../design-system/toast';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { parseDecimal, percentInput } from '../products/format';
import { salesSettingsQuery } from './queries';

export function SalesSettingsPage() {
  const settings = useQuery(salesSettingsQuery);
  if (settings.isPending) return <SkeletonRows />;
  if (settings.isError) {
    return (
      <ErrorState message={errorMessage(settings.error)} onRetry={() => void settings.refetch()} />
    );
  }
  return <SettingsForm initial={settings.data} />;
}

function SettingsForm({ initial }: { initial: SalesSettings }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [limit, setLimit] = useState(percentInput(initial.discountLimitPercent));
  const [saleType, setSaleType] = useState<SaleType>(initial.defaultSaleType);
  const [error, setError] = useState<string | undefined>();
  const save = useMutation({
    mutationFn: (body: SalesSettings) => api('PUT', '/sales/settings', salesSettingsSchema, body),
    onSuccess: async (saved) => {
      queryClient.setQueryData(salesSettingsQuery.queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: ['sales', 'context'] });
      toast.success('Configuração de vendas salva.');
    },
    onError: (e) => {
      if (e instanceof ApiRequestError) setError(e.fieldErrors[0]?.message);
    },
  });

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = salesSettingsSchema.safeParse({
          discountLimitPercent: parseDecimal(limit) ?? Number.NaN,
          defaultSaleType: saleType,
        });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message);
          return;
        }
        save.mutate(parsed.data);
      }}
    >
      <PageHeader
        area="Vendas"
        title="Configuração de vendas"
        description="Parâmetros usados pelo ponto de venda em todas as unidades."
      />
      {save.isError && !error ? (
        <p
          role="alert"
          className="mb-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600"
        >
          {errorMessage(save.error)}
        </p>
      ) : null}
      <Section title="Desconto e tipo de venda">
        <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
          <TextField
            label="Limite de desconto da clínica (%)"
            inputMode="decimal"
            autoComplete="off"
            value={limit}
            error={error}
            hint="Vale para quem não tem limite próprio no cadastro de usuários. O limite de cada item, quando menor, prevalece."
            onChange={(e) => {
              setLimit(e.target.value);
              setError(undefined);
            }}
          />
          <SelectField
            label="Tipo de venda padrão"
            value={saleType}
            options={saleTypes.map((t) => ({ value: t, label: saleTypeLabels[t] }))}
            hint="Já vem marcado em cada venda nova."
            onChange={(e) => {
              setSaleType(e.target.value as SaleType);
            }}
          />
        </div>
      </Section>
      <FormActions>
        <Button type="submit" pending={save.isPending}>
          Salvar configuração
        </Button>
      </FormActions>
    </form>
  );
}
