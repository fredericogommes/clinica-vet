import { clientSchema, type ClientData } from '@clinica/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Button, buttonClasses } from '../../design-system/button';
import { FormActions, PageHeader } from '../../design-system/layout';
import { ErrorState, SkeletonRows } from '../../design-system/states';
import { useToast } from '../../design-system/toast';
import { api, errorMessage } from '../../lib/api';
import { ClientForm, clientToInput } from './client-form';
import { clientQuery } from './queries';

const formId = 'client-edit';

export function ClientEditPage({ clientId }: { clientId: string }) {
  const client = useQuery(clientQuery(clientId));
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const save = useMutation({
    mutationFn: ({ data }: { data: ClientData; onFieldErrors: (e: unknown) => void }) =>
      api('PUT', `/clients/${clientId}`, clientSchema, data),
    onSuccess: async (saved) => {
      queryClient.setQueryData(clientQuery(clientId).queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: ['clients', 'list'] });
      toast.success('Alterações salvas.');
      await navigate({ to: '/clientes/$clientId', params: { clientId } });
    },
    onError: (error, { onFieldErrors }) => {
      onFieldErrors(error);
    },
  });

  if (client.isPending) return <SkeletonRows />;
  if (client.isError) {
    return (
      <ErrorState message={errorMessage(client.error)} onRetry={() => void client.refetch()} />
    );
  }

  return (
    <>
      <PageHeader area={`Cliente #${client.data.code}`} title={`Editar ${client.data.name}`} />
      {save.isError ? (
        <p
          role="alert"
          className="mb-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600"
        >
          {errorMessage(save.error)}
        </p>
      ) : null}
      <ClientForm
        formId={formId}
        defaultValues={clientToInput(client.data)}
        onSubmit={(data, onFieldErrors) => {
          save.mutate({ data, onFieldErrors });
        }}
      />
      <FormActions>
        <Link to="/clientes/$clientId" params={{ clientId }} className={buttonClasses('secondary')}>
          Cancelar
        </Link>
        <Button type="submit" form={formId} pending={save.isPending}>
          Salvar alterações
        </Button>
      </FormActions>
    </>
  );
}
