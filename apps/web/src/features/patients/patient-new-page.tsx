import { patientSchema, type PatientData } from '@clinica/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Button, buttonClasses } from '../../design-system/button';
import { FormActions, PageHeader } from '../../design-system/layout';
import { ErrorState, SkeletonRows } from '../../design-system/states';
import { useToast } from '../../design-system/toast';
import { api, errorMessage } from '../../lib/api';
import { clientQuery } from '../clients/queries';
import { emptyPatient, PatientForm } from './patient-form';

const formId = 'patient-new';

export function PatientNewPage({ clientId }: { clientId: string }) {
  const client = useQuery(clientQuery(clientId));
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const save = useMutation({
    mutationFn: ({ data }: { data: PatientData; onFieldErrors: (e: unknown) => void }) =>
      api('POST', '/patients', patientSchema, { clientId, patient: data }),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['clients'] });
      await queryClient.invalidateQueries({ queryKey: ['patients', 'list'] });
      toast.success(`${saved.name} cadastrado.`);
      await navigate({ to: '/animais/$patientId', params: { patientId: saved.id } });
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
      <PageHeader
        area="Clientes e animais"
        title="Novo animal"
        description={`Responsável: ${client.data.name}`}
      />
      {save.isError ? (
        <p
          role="alert"
          className="mb-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600"
        >
          {errorMessage(save.error)}
        </p>
      ) : null}
      <PatientForm
        formId={formId}
        defaultValues={emptyPatient}
        errorPrefix="patient."
        onSubmit={(data, onFieldErrors) => {
          save.mutate({ data, onFieldErrors });
        }}
      />
      <FormActions>
        <Link to="/clientes/$clientId" params={{ clientId }} className={buttonClasses('secondary')}>
          Cancelar
        </Link>
        <Button type="submit" form={formId} pending={save.isPending}>
          Cadastrar animal
        </Button>
      </FormActions>
    </>
  );
}
