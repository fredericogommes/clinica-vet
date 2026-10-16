import {
  patientInputSchema,
  type Patient,
  type PatientData,
  type PatientInput,
} from '@clinica/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Checkbox } from '../../design-system/checkbox';
import { Segmented, SelectField, TextField } from '../../design-system/field';
import { Section } from '../../design-system/layout';
import { applyFieldErrors } from '../../lib/forms';
import { breedsQuery, catalogQuery } from '../catalogs/queries';
import { patientSexLabels } from './labels';
import { MarkingsField } from './markings-field';

export const emptyPatient: PatientInput = {
  name: '',
  status: 'alive',
  deceasedOn: '',
  sex: 'unknown',
  sterilized: null,
  birthDate: '',
  speciesId: null,
  breedId: null,
  coatId: null,
  microchip: '',
  hasPedigree: false,
  pedigreeNumber: '',
  markings: [],
};

export function patientToInput(p: Patient): PatientInput {
  return {
    name: p.name,
    status: p.status,
    deceasedOn: p.deceasedOn ?? '',
    sex: p.sex,
    sterilized: p.sterilized,
    birthDate: p.birthDate ?? '',
    speciesId: p.speciesId,
    breedId: p.breedId,
    coatId: p.coatId,
    microchip: p.microchip ?? '',
    hasPedigree: p.hasPedigree,
    pedigreeNumber: p.pedigreeNumber ?? '',
    markings: p.markings,
  };
}

const toBoolOrNull = (v: unknown) => (v === 'true' ? true : v === 'false' ? false : null);
const fromBoolOrNull = (v: boolean | null) => (v === null ? '' : String(v));

/** Itens arquivados só aparecem quando já estão na ficha, para não sumirem da edição. */
const visible = <T extends { id: string; archived: boolean }>(
  items: T[] | undefined,
  keep: string | null,
) => (items ?? []).filter((i) => !i.archived || i.id === keep);

export function PatientForm({
  formId,
  defaultValues,
  errorPrefix = '',
  onSubmit,
}: {
  formId: string;
  defaultValues: PatientInput;
  /** Prefixo dos caminhos de erro na resposta da API, ex. "patient." na criação. */
  errorPrefix?: string;
  onSubmit: (data: PatientData, setServerErrors: (error: unknown) => void) => void;
}) {
  const form = useForm<PatientInput, unknown, PatientData>({
    resolver: zodResolver(patientInputSchema),
    defaultValues,
  });
  const { errors } = form.formState;
  const [status, speciesId, hasPedigree] = useWatch({
    control: form.control,
    name: ['status', 'speciesId', 'hasPedigree'],
  });
  const species = useQuery(catalogQuery('species'));
  const coats = useQuery(catalogQuery('coats'));
  const breeds = useQuery({ ...breedsQuery(speciesId ?? ''), enabled: Boolean(speciesId) });

  return (
    <form
      id={formId}
      noValidate
      className="space-y-5"
      onSubmit={form.handleSubmit((data) => {
        onSubmit(data, (error) => {
          applyFieldErrors(form.setError, error, errorPrefix);
        });
      })}
    >
      <Section title="Situação">
        <div className="grid gap-4 sm:grid-cols-2">
          <Controller
            control={form.control}
            name="status"
            render={({ field }) => (
              <Segmented
                label="Situação do animal"
                value={field.value}
                onChange={(v) => {
                  field.onChange(v);
                  if (v === 'alive') form.setValue('deceasedOn', '');
                }}
                options={[
                  { value: 'alive', label: 'Vivo' },
                  { value: 'deceased', label: 'Óbito' },
                ]}
              />
            )}
          />
          {status === 'deceased' ? (
            <TextField
              label="Data do óbito"
              type="date"
              error={errors.deceasedOn?.message}
              {...form.register('deceasedOn')}
            />
          ) : null}
        </div>
      </Section>

      <Section title="Identificação">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <TextField
              label="Nome do animal"
              autoComplete="off"
              error={errors.name?.message}
              {...form.register('name')}
            />
          </div>
          <Controller
            control={form.control}
            name="speciesId"
            render={({ field }) => (
              <SelectField
                label="Espécie"
                placeholder={species.isPending ? 'Carregando…' : 'Não informada'}
                options={visible(species.data, defaultValues.speciesId).map((s) => ({
                  value: s.id,
                  label: s.name,
                }))}
                error={errors.speciesId?.message}
                value={field.value ?? ''}
                onBlur={field.onBlur}
                onChange={(e) => {
                  field.onChange(e.target.value === '' ? null : e.target.value);
                  // Raça depende da espécie (RN-07): trocar a espécie limpa a raça.
                  form.setValue('breedId', null);
                }}
              />
            )}
          />
          <Controller
            control={form.control}
            name="breedId"
            render={({ field }) => (
              <SelectField
                label="Raça"
                disabled={!speciesId}
                placeholder={
                  !speciesId
                    ? 'Escolha a espécie primeiro'
                    : breeds.isPending
                      ? 'Carregando…'
                      : 'Não informada'
                }
                options={visible(breeds.data, defaultValues.breedId).map((b) => ({
                  value: b.id,
                  label: b.name,
                }))}
                error={errors.breedId?.message}
                value={field.value ?? ''}
                onBlur={field.onBlur}
                onChange={(e) => {
                  field.onChange(e.target.value === '' ? null : e.target.value);
                }}
              />
            )}
          />
          <SelectField
            label="Sexo"
            options={Object.entries(patientSexLabels).map(([value, label]) => ({ value, label }))}
            error={errors.sex?.message}
            {...form.register('sex')}
          />
          <Controller
            control={form.control}
            name="sterilized"
            render={({ field }) => (
              <SelectField
                label="Castrado"
                placeholder="Não informado"
                options={[
                  { value: 'true', label: 'Sim' },
                  { value: 'false', label: 'Não' },
                ]}
                value={fromBoolOrNull(field.value)}
                onChange={(e) => {
                  field.onChange(toBoolOrNull(e.target.value));
                }}
                onBlur={field.onBlur}
              />
            )}
          />
          <TextField
            label="Nascimento"
            type="date"
            hint="A idade é calculada a partir desta data."
            error={errors.birthDate?.message}
            {...form.register('birthDate')}
          />
          <Controller
            control={form.control}
            name="coatId"
            render={({ field }) => (
              <SelectField
                label="Pelagem"
                placeholder={coats.isPending ? 'Carregando…' : 'Não informada'}
                options={visible(coats.data, defaultValues.coatId).map((c) => ({
                  value: c.id,
                  label: c.name,
                }))}
                error={errors.coatId?.message}
                value={field.value ?? ''}
                onBlur={field.onBlur}
                onChange={(e) => {
                  field.onChange(e.target.value === '' ? null : e.target.value);
                }}
              />
            )}
          />
          <div className="sm:col-span-2">
            <Controller
              control={form.control}
              name="markings"
              render={({ field }) => (
                <MarkingsField
                  value={field.value}
                  onChange={field.onChange}
                  error={errors.markings?.message}
                />
              )}
            />
          </div>
        </div>
      </Section>

      <Section title="Registro">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Microchip"
            inputMode="numeric"
            error={errors.microchip?.message}
            {...form.register('microchip')}
          />
          <div className="space-y-3">
            <Controller
              control={form.control}
              name="hasPedigree"
              render={({ field }) => (
                <div className="sm:mt-7">
                  <Checkbox
                    label="Tem pedigree"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </div>
              )}
            />
            {hasPedigree ? (
              <TextField
                label="Número do pedigree"
                error={errors.pedigreeNumber?.message}
                {...form.register('pedigreeNumber')}
              />
            ) : null}
          </div>
        </div>
      </Section>
    </form>
  );
}
