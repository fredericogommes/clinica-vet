import { clientSchema, patientSchema, type ClientData } from '@clinica/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button, buttonClasses } from '../../design-system/button';
import { SelectField, TextField } from '../../design-system/field';
import { FormActions, PageHeader, Section } from '../../design-system/layout';
import { useToast } from '../../design-system/toast';
import { api, errorMessage } from '../../lib/api';
import { useCan } from '../../lib/session';
import { catalogQuery } from '../catalogs/queries';
import { emptyPatient } from '../patients/patient-form';
import { ClientForm, emptyClient } from './client-form';

const formId = 'client-new';

/**
 * Cadastro de balcão (RN-06): só o nome é obrigatório. O primeiro animal pode ser cadastrado
 * junto; o restante da ficha do animal é completado depois.
 */
export function ClientNewPage() {
  const can = useCan();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const species = useQuery(catalogQuery('species'));
  const withPatient = can('patients.manage');
  const [pet, setPet] = useState({ name: '', speciesId: '' });

  const save = useMutation({
    mutationFn: async ({ data }: { data: ClientData; onFieldErrors: (e: unknown) => void }) => {
      const client = await api('POST', '/clients', clientSchema, data);
      let petError: unknown = null;
      if (withPatient && pet.name.trim()) {
        try {
          await api('POST', '/patients', patientSchema, {
            clientId: client.id,
            patient: { ...emptyPatient, name: pet.name.trim(), speciesId: pet.speciesId || null },
          });
        } catch (error) {
          petError = error;
        }
      }
      return { client, petError };
    },
    onSuccess: async ({ client, petError }) => {
      await queryClient.invalidateQueries({ queryKey: ['clients'] });
      await queryClient.invalidateQueries({ queryKey: ['patients'] });
      if (petError) {
        toast.error(`Cliente salvo, mas o animal não: ${errorMessage(petError)}`);
      } else {
        toast.success(`Cliente ${client.name} cadastrado.`);
      }
      await navigate({ to: '/clientes/$clientId', params: { clientId: client.id } });
    },
    onError: (error, { onFieldErrors }) => {
      onFieldErrors(error);
    },
  });

  return (
    <>
      <PageHeader
        area="Clientes e animais"
        title="Novo cliente"
        description="Só o nome é obrigatório. CPF, nascimento e endereço podem ser completados depois."
      />
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
        defaultValues={emptyClient}
        onSubmit={(data, onFieldErrors) => {
          save.mutate({ data, onFieldErrors });
        }}
      >
        {withPatient ? (
          <Section
            title="Primeiro animal"
            description="Opcional. Os demais dados do animal ficam na ficha dele."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Nome do animal"
                autoComplete="off"
                value={pet.name}
                maxLength={80}
                onChange={(e) => {
                  setPet((p) => ({ ...p, name: e.target.value }));
                }}
              />
              <SelectField
                label="Espécie do animal"
                placeholder="Não informada"
                options={(species.data ?? [])
                  .filter((s) => !s.archived)
                  .map((s) => ({ value: s.id, label: s.name }))}
                value={pet.speciesId}
                onChange={(e) => {
                  setPet((p) => ({ ...p, speciesId: e.target.value }));
                }}
              />
            </div>
          </Section>
        ) : null}
      </ClientForm>
      <FormActions>
        <Link to="/clientes" className={buttonClasses('secondary')}>
          Cancelar
        </Link>
        <Button type="submit" form={formId} pending={save.isPending}>
          Cadastrar cliente
        </Button>
      </FormActions>
    </>
  );
}
