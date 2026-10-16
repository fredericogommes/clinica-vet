import {
  clientInputSchema,
  formatCep,
  formatCnpj,
  formatCpf,
  formatPhone,
  type Client,
  type ClientData,
  type ClientInput,
} from '@clinica/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Controller, useFieldArray, useForm, useWatch, type Resolver } from 'react-hook-form';
import { Button } from '../../design-system/button';
import { Checkbox } from '../../design-system/checkbox';
import { Segmented, SelectField, TextareaField, TextField } from '../../design-system/field';
import { Section } from '../../design-system/layout';
import { applyFieldErrors, emptyToNull } from '../../lib/forms';
import { catalogQuery } from '../catalogs/queries';

const baseResolver = zodResolver(clientInputSchema);

/** Linhas de contato deixadas em branco no fim da lista são descartadas, não reprovadas. */
const resolver: Resolver<ClientInput, unknown, ClientData> = (values, context, options) => {
  const contacts = [...values.contacts];
  while (contacts.length > 0 && contacts.at(-1)?.value.trim() === '') contacts.pop();
  return baseResolver({ ...values, contacts }, context, options);
};

export const emptyClient: ClientInput = {
  personType: 'individual',
  name: '',
  nationality: '',
  sex: null,
  cpf: '',
  cnpj: '',
  rg: '',
  birthDate: '',
  originId: null,
  profession: '',
  municipalRegistration: '',
  notes: '',
  contacts: [{ kind: 'mobile', value: '', isWhatsapp: true }],
  address: { cep: '', street: '', number: '', complement: '', district: '', city: '', state: '' },
};

export function clientToInput(c: Client): ClientInput {
  const text = (v: string | null) => v ?? '';
  return {
    personType: c.personType,
    name: c.name,
    nationality: text(c.nationality),
    sex: c.sex,
    cpf: c.cpf ? formatCpf(c.cpf) : '',
    cnpj: c.cnpj ? formatCnpj(c.cnpj) : '',
    rg: text(c.rg),
    birthDate: text(c.birthDate),
    originId: c.originId,
    profession: text(c.profession),
    municipalRegistration: text(c.municipalRegistration),
    notes: text(c.notes),
    contacts: c.contacts.map((k) => ({
      ...k,
      value: k.kind === 'email' ? k.value : formatPhone(k.value),
    })),
    address: {
      cep: c.address.cep ? formatCep(c.address.cep) : '',
      street: text(c.address.street),
      number: text(c.address.number),
      complement: text(c.address.complement),
      district: text(c.address.district),
      city: text(c.address.city),
      state: text(c.address.state),
    },
  };
}

const contactKinds = [
  { value: 'mobile', label: 'Celular' },
  { value: 'phone', label: 'Telefone fixo' },
  { value: 'email', label: 'E-mail' },
];

interface ClientFormProps {
  formId: string;
  defaultValues: ClientInput;
  /** Recebe os dados já validados; erros de campo da API voltam pelo segundo argumento. */
  onSubmit: (data: ClientData, setServerErrors: (error: unknown) => void) => void;
  /** Blocos extras dentro do mesmo formulário, ex. o primeiro animal no cadastro de balcão. */
  children?: ReactNode;
}

export function ClientForm({ formId, defaultValues, onSubmit, children }: ClientFormProps) {
  const origins = useQuery(catalogQuery('client-origins'));
  const form = useForm<ClientInput, unknown, ClientData>({ resolver, defaultValues });
  const contacts = useFieldArray({ control: form.control, name: 'contacts' });
  const { errors } = form.formState;
  const personType = useWatch({ control: form.control, name: 'personType' });
  const contactValues = useWatch({ control: form.control, name: 'contacts' });
  const currentOrigin = defaultValues.originId;

  return (
    <form
      id={formId}
      noValidate
      className="space-y-5"
      onSubmit={form.handleSubmit((data) => {
        onSubmit(data, (error) => {
          applyFieldErrors(form.setError, error);
        });
      })}
    >
      <Section title="Identificação">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Controller
              control={form.control}
              name="personType"
              render={({ field }) => (
                <Segmented
                  label="Tipo de pessoa"
                  value={field.value}
                  onChange={field.onChange}
                  options={[
                    { value: 'individual', label: 'Pessoa física' },
                    { value: 'company', label: 'Pessoa jurídica' },
                  ]}
                />
              )}
            />
          </div>
          <div className="sm:col-span-2">
            <TextField
              label={personType === 'company' ? 'Razão social ou nome fantasia' : 'Nome completo'}
              autoComplete="off"
              error={errors.name?.message}
              {...form.register('name')}
            />
          </div>
          {personType === 'individual' ? (
            <>
              <TextField
                label="CPF"
                inputMode="numeric"
                hint="Opcional no balcão; pode ser completado depois."
                error={errors.cpf?.message}
                {...form.register('cpf')}
              />
              <TextField label="RG" error={errors.rg?.message} {...form.register('rg')} />
              <TextField
                label="Nascimento"
                type="date"
                error={errors.birthDate?.message}
                {...form.register('birthDate')}
              />
              <SelectField
                label="Sexo"
                placeholder="Não informado"
                options={[
                  { value: 'female', label: 'Feminino' },
                  { value: 'male', label: 'Masculino' },
                ]}
                error={errors.sex?.message}
                {...form.register('sex', { setValueAs: emptyToNull })}
              />
            </>
          ) : (
            <>
              <TextField
                label="CNPJ"
                inputMode="numeric"
                error={errors.cnpj?.message}
                {...form.register('cnpj')}
              />
              <TextField
                label="Inscrição municipal"
                error={errors.municipalRegistration?.message}
                {...form.register('municipalRegistration')}
              />
            </>
          )}
          <TextField
            label="Nacionalidade"
            error={errors.nationality?.message}
            {...form.register('nationality')}
          />
          <TextField
            label="Profissão"
            error={errors.profession?.message}
            {...form.register('profession')}
          />
          <Controller
            control={form.control}
            name="originId"
            render={({ field }) => (
              <SelectField
                label="Como conheceu a clínica"
                placeholder={origins.isPending ? 'Carregando…' : 'Não informado'}
                options={(origins.data ?? [])
                  .filter((o) => !o.archived || o.id === currentOrigin)
                  .map((o) => ({ value: o.id, label: o.name }))}
                error={errors.originId?.message}
                value={field.value ?? ''}
                onBlur={field.onBlur}
                onChange={(e) => {
                  field.onChange(e.target.value === '' ? null : e.target.value);
                }}
              />
            )}
          />
        </div>
      </Section>

      <Section
        title="Contatos"
        description="O primeiro telefone é o principal. Marque o WhatsApp para habilitar o atalho de conversa."
        actions={
          contacts.fields.length < 10 ? (
            <Button
              variant="ghost"
              size="sm"
              icon={<Plus className="size-4" aria-hidden />}
              onClick={() => {
                contacts.append({ kind: 'mobile', value: '', isWhatsapp: false });
              }}
            >
              Adicionar
            </Button>
          ) : null
        }
      >
        {contacts.fields.length === 0 ? (
          <p className="text-sm text-ink-muted">Nenhum contato.</p>
        ) : (
          <ul className="space-y-3">
            {contacts.fields.map((field, index) => {
              const kind = contactValues[index]?.kind ?? field.kind;
              return (
                <li
                  key={field.id}
                  className="grid items-start gap-3 sm:grid-cols-[10rem_1fr_auto_auto]"
                >
                  <SelectField
                    label={`Tipo do contato ${index + 1}`}
                    options={contactKinds}
                    {...form.register(`contacts.${index}.kind`)}
                  />
                  <TextField
                    label={kind === 'email' ? 'E-mail' : 'Número com DDD'}
                    type={kind === 'email' ? 'email' : 'tel'}
                    inputMode={kind === 'email' ? 'email' : 'tel'}
                    autoComplete="off"
                    error={errors.contacts?.[index]?.value?.message}
                    {...form.register(`contacts.${index}.value`)}
                  />
                  <div className="flex h-10 items-center sm:mt-6">
                    {kind === 'mobile' ? (
                      <Controller
                        control={form.control}
                        name={`contacts.${index}.isWhatsapp`}
                        render={({ field: f }) => (
                          <Checkbox
                            label="WhatsApp"
                            checked={f.value ?? false}
                            onCheckedChange={f.onChange}
                          />
                        )}
                      />
                    ) : null}
                  </div>
                  <div className="flex h-10 items-center sm:mt-6">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remover contato ${index + 1}`}
                      icon={<Trash2 className="size-4" aria-hidden />}
                      onClick={() => {
                        contacts.remove(index);
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {children}

      <Section title="Endereço">
        <div className="grid gap-4 sm:grid-cols-6">
          <div className="sm:col-span-2">
            <TextField
              label="CEP"
              inputMode="numeric"
              error={errors.address?.cep?.message}
              {...form.register('address.cep')}
            />
          </div>
          <div className="sm:col-span-4">
            <TextField
              label="Logradouro"
              error={errors.address?.street?.message}
              {...form.register('address.street')}
            />
          </div>
          <div className="sm:col-span-2">
            <TextField
              label="Número"
              error={errors.address?.number?.message}
              {...form.register('address.number')}
            />
          </div>
          <div className="sm:col-span-4">
            <TextField
              label="Complemento"
              error={errors.address?.complement?.message}
              {...form.register('address.complement')}
            />
          </div>
          <div className="sm:col-span-2">
            <TextField
              label="Bairro"
              error={errors.address?.district?.message}
              {...form.register('address.district')}
            />
          </div>
          <div className="sm:col-span-3">
            <TextField
              label="Cidade"
              error={errors.address?.city?.message}
              {...form.register('address.city')}
            />
          </div>
          <div className="sm:col-span-1">
            <TextField
              label="UF"
              maxLength={2}
              className="uppercase"
              error={errors.address?.state?.message}
              {...form.register('address.state')}
            />
          </div>
        </div>
      </Section>

      <Section title="Observações">
        <TextareaField
          label="Observações internas"
          hint="Visível apenas para a equipe."
          error={errors.notes?.message}
          {...form.register('notes')}
        />
      </Section>
    </form>
  );
}
