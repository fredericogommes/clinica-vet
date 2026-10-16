import { patientSchema, type PatientData } from '@clinica/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Button, buttonClasses } from '../../design-system/button';
import { FormActions, PageHeader } from '../../design-system/layout';
import { ErrorState, SkeletonRows } from '../../design-system/states';
import { useToast } from '../../design-system/toast';
import { api, errorMessage } from '../../lib/api';
import { PatientForm, patientToInput } from './patient-form';
import { patientQuery } from './queries';

const formId = 'patient-edit';

export function PatientEditPage({ patientId }: { patientId: string }) {
  const patient = useQuery(patientQuery(patientId));
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const save = useMutation({
    mutationFn: ({ data }: { data: PatientData; onFieldErrors: (e: unknown) => void }) =>
      api('PUT', `/patients/${patientId}`, patientSchema, data),
    onSuccess: async (saved) => {
      queryClient.setQueryData(patientQuery(patientId).queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: ['patients', 'list'] });
      await queryClient.invalidateQueries({ queryKey: ['clients'] });
      toast.success('Alterações salvas.');
      await navigate({ to: '/animais/$patientId', params: { patientId } });
    },
    onError: (error, { onFieldErrors }) => {
      onFieldErrors(error);
    },
  });

  if (patient.isPending) return <SkeletonRows />;
  if (patient.isError) {
    return (
      <ErrorState message={errorMessage(patient.error)} onRetry={() => void patient.refetch()} />
    );
  }

  return (
    <>
      <PageHeader area={`Animal #${patient.data.code}`} title={`Editar ${patient.data.name}`} />
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
        defaultValues={patientToInput(patient.data)}
        onSubmit={(data, onFieldErrors) => {
          save.mutate({ data, onFieldErrors });
        }}
      />
      <FormActions>
        <Link
          to="/animais/$patientId"
          params={{ patientId }}
          className={buttonClasses('secondary')}
        >
          Cancelar
        </Link>
        <Button type="submit" form={formId} pending={save.isPending}>
          Salvar alterações
        </Button>
      </FormActions>
    </>
  );
}
