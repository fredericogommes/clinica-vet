import {
  appointmentTypeInputSchema,
  appointmentTypeSchema,
  type AppointmentType,
  type AppointmentTypeInput,
} from '@clinica/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Stethoscope } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Button } from '../../design-system/button';
import { Checkbox } from '../../design-system/checkbox';
import { Dialog } from '../../design-system/dialog';
import { SelectField, TextareaField, TextField } from '../../design-system/field';
import { Badge, PageHeader, Section } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { useToast } from '../../design-system/toast';
import { api, errorMessage } from '../../lib/api';
import { applyFieldErrors } from '../../lib/forms';
import { appointmentTypesQuery } from '../schedule/queries';
import { PlaceholderHelp } from './clinical-catalog-pages';

const durations = Array.from({ length: 16 }, (_, i) => (i + 1) * 15);

/** Tipos de atendimento [p.5]: duração sugerida no agendamento e modelo do prontuário [RN-18]. */
export function AppointmentTypesPage() {
  const types = useQuery(appointmentTypesQuery);
  const [editing, setEditing] = useState<AppointmentType | null | undefined>(undefined);
  return (
    <>
      <PageHeader
        area="Cadastros"
        title="Tipos de atendimento"
        description="Cada tipo traz a duração sugerida no agendamento e o modelo de prontuário que abre no atendimento. Arquive o que não é mais usado em vez de excluir."
      />
      <Section
        title="Tipos cadastrados"
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
        {types.isPending ? (
          <SkeletonRows rows={4} columns={2} />
        ) : types.isError ? (
          <ErrorState message={errorMessage(types.error)} onRetry={() => void types.refetch()} />
        ) : types.data.length === 0 ? (
          <EmptyState
            icon={Stethoscope}
            title="Nenhum tipo cadastrado"
            description="Cadastre consulta, retorno, vacinação e os demais atendimentos da clínica."
          />
        ) : (
          <ul className="-mx-2 divide-y divide-line">
            {types.data.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-2 py-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.name}</span>
                {t.recordTemplate ? <Badge tone="sage">Com modelo</Badge> : null}
                <span className="font-mono text-xs text-ink-muted">{t.durationMinutes} min</span>
                {t.archived ? <Badge>Arquivado</Badge> : null}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Editar ${t.name}`}
                  onClick={() => {
                    setEditing(t);
                  }}
                >
                  Editar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {editing !== undefined ? (
        <TypeDialog
          type={editing}
          onClose={() => {
            setEditing(undefined);
          }}
        />
      ) : null}
    </>
  );
}

function TypeDialog({ type, onClose }: { type: AppointmentType | null; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const form = useForm<AppointmentTypeInput>({
    resolver: zodResolver(appointmentTypeInputSchema),
    defaultValues: {
      name: type?.name ?? '',
      durationMinutes: type?.durationMinutes ?? 60,
      recordTemplate: type?.recordTemplate ?? '',
      archived: type?.archived ?? false,
    },
  });
  const save = useMutation({
    mutationFn: (input: AppointmentTypeInput) =>
      type
        ? api('PUT', `/catalogs/appointment-types/${type.id}`, appointmentTypeSchema, input)
        : api('POST', '/catalogs/appointment-types', appointmentTypeSchema, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: appointmentTypesQuery.queryKey });
      toast.success(type ? 'Alterações salvas.' : 'Tipo de atendimento incluído.');
      onClose();
    },
    onError: (error) => {
      applyFieldErrors(form.setError, error);
    },
  });

  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={type ? `Editar ${type.name}` : 'Novo tipo de atendimento'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="type-form" pending={save.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <form
        id="type-form"
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit((values) => {
          save.mutate(values);
        })}
      >
        {save.isError ? (
          <p
            role="alert"
            className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600"
          >
            {errorMessage(save.error)}
          </p>
        ) : null}
        <TextField
          label="Nome"
          autoComplete="off"
          error={form.formState.errors.name?.message}
          {...form.register('name')}
        />
        <Controller
          control={form.control}
          name="durationMinutes"
          render={({ field }) => (
            <SelectField
              label="Duração padrão"
              value={String(field.value)}
              options={durations.map((m) => ({ value: String(m), label: `${m} min` }))}
              error={form.formState.errors.durationMinutes?.message}
              onChange={(e) => {
                field.onChange(Number(e.target.value));
              }}
            />
          )}
        />
        <TextareaField
          label="Modelo de prontuário"
          rows={10}
          hint="Abre preenchido no atendimento deste tipo. FC, FR, temperatura, TPC, peso e escore corporal já têm campos próprios."
          error={form.formState.errors.recordTemplate?.message}
          {...form.register('recordTemplate')}
        />
        <PlaceholderHelp />
        {type ? (
          <Controller
            control={form.control}
            name="archived"
            render={({ field }) => (
              <Checkbox
                label="Arquivado"
                description="Some das opções de novos agendamentos; os já marcados continuam exibindo."
                checked={field.value ?? false}
                onCheckedChange={field.onChange}
              />
            )}
          />
        ) : null}
      </form>
    </Dialog>
  );
}
