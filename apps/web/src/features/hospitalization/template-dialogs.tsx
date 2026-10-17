import {
  prescriptionTemplateSchema,
  type HospitalizationDetail,
  type Prescription,
  type PrescriptionTemplateItem,
} from '@clinica/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pill, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { Button } from '../../design-system/button';
import { Checkbox } from '../../design-system/checkbox';
import { SelectField, TextField } from '../../design-system/field';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { useToast } from '../../design-system/toast';
import { api, apiVoid, errorMessage } from '../../lib/api';
import { isoToLocalInput, localInputToIso } from '../clinical/labels';
import { Alert, fieldErrorsOf, FormDialog, generalError } from './dialogs';
import { doseText, nextFullHour, posology } from './dose';
import { prescriptionTemplatesQuery } from './queries';

const itemOf = (p: Prescription): PrescriptionTemplateItem => ({
  name: p.name,
  dose: p.dose,
  doseUnit: p.doseUnit,
  concentration: p.concentration,
  route: p.route,
  intervalHours: p.intervalHours,
  durationDays: p.durationDays,
  notes: p.notes,
});

/**
 * Salvar como modelo [p.15]: as prescrições escolhidas viram um protocolo da clínica. Um nome que
 * já existe substitui as prescrições daquele modelo.
 */
export function SaveTemplateDialog({
  prescriptions,
  onClose,
}: {
  prescriptions: Prescription[];
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const templates = useQuery(prescriptionTemplatesQuery);
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState(() => new Set(prescriptions.map((p) => p.id)));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (body: unknown) =>
      api('POST', '/hospitalizations/prescription-templates', prescriptionTemplateSchema, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['hospitalizations', 'templates'] });
    },
  });
  const replaces = templates.data?.find(
    (t) => t.name.toLocaleLowerCase('pt-BR') === name.trim().toLocaleLowerCase('pt-BR'),
  );

  return (
    <FormDialog
      title="Salvar como modelo"
      description="O modelo guarda medicamento, dose, via, intervalo e duração. O primeiro horário é dado quando ele for usado."
      formId="save-template"
      submitLabel={replaces ? 'Substituir modelo' : 'Salvar modelo'}
      pending={save.isPending}
      onClose={onClose}
      onSubmit={() => {
        const found: Record<string, string> = {};
        if (name.trim().length < 2) found.name = 'Dê um nome ao modelo';
        if (chosen.size === 0) found.items = 'Escolha ao menos uma prescrição';
        setErrors(found);
        if (Object.keys(found).length > 0) return;
        save.mutate(
          {
            name,
            items: prescriptions.filter((p) => chosen.has(p.id)).map(itemOf),
          },
          {
            onSuccess: (t) => {
              toast.success(`Modelo ${t.name} salvo.`);
              onClose();
            },
            onError: (e) => {
              setErrors(fieldErrorsOf(e));
            },
          },
        );
      }}
    >
      <Alert message={generalError(save.error)} />
      <TextField
        label="Nome do modelo"
        placeholder="Ex.: Gastroenterite canina"
        maxLength={80}
        value={name}
        error={errors.name}
        hint={replaces ? `Já existe um modelo ${replaces.name}: ele será substituído.` : undefined}
        onChange={(e) => {
          setName(e.target.value);
          setErrors({});
        }}
      />
      <fieldset className="space-y-2">
        <legend className="mb-1 text-[13px] font-medium text-ink">Prescrições do modelo</legend>
        {prescriptions.map((p) => (
          <Checkbox
            key={p.id}
            label={p.name}
            description={posology(p)}
            checked={chosen.has(p.id)}
            onCheckedChange={(checked) => {
              setChosen((prev) => {
                const next = new Set(prev);
                if (checked) next.add(p.id);
                else next.delete(p.id);
                return next;
              });
              setErrors({});
            }}
          />
        ))}
        {errors.items ? (
          <p role="alert" className="text-xs font-medium text-danger-600">
            {errors.items}
          </p>
        ) : null}
      </fieldset>
    </FormDialog>
  );
}

/** Usar modelo: aplica todas as prescrições do protocolo a partir do mesmo primeiro horário. */
export function ApplyTemplateDialog({
  h,
  timeZone,
  weightKg,
  onClose,
}: {
  h: HospitalizationDetail;
  timeZone: string;
  weightKg: number | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const templates = useQuery(prescriptionTemplatesQuery);
  const [templateId, setTemplateId] = useState('');
  const [firstAt, setFirstAt] = useState(() => nextFullHour(timeZone));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const apply = useMutation({
    mutationFn: (body: unknown) =>
      api(
        'POST',
        `/hospitalizations/${h.id}/prescriptions/template`,
        z.object({ ids: z.array(z.uuid()) }),
        body,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['hospitalizations'] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiVoid('DELETE', `/hospitalizations/prescription-templates/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['hospitalizations', 'templates'] });
    },
  });
  const selected = templates.data?.find((t) => t.id === templateId);

  return (
    <FormDialog
      title="Usar modelo de prescrição"
      description={`${h.patient.name}, internação ${String(h.code)}.`}
      formId="apply-template"
      submitLabel="Prescrever modelo"
      pending={apply.isPending}
      onClose={onClose}
      onSubmit={() => {
        const found: Record<string, string> = {};
        if (!templateId) found.templateId = 'Escolha o modelo';
        if (!firstAt) found.firstAt = 'Informe o primeiro horário';
        setErrors(found);
        if (Object.keys(found).length > 0 || !selected) return;
        apply.mutate(
          { templateId, firstAt: localInputToIso(firstAt, timeZone) },
          {
            onSuccess: ({ ids }) => {
              toast.success(
                `${String(ids.length)} ${ids.length === 1 ? 'prescrição' : 'prescrições'} do modelo ${selected.name}.`,
              );
              onClose();
            },
            onError: (e) => {
              setErrors(fieldErrorsOf(e));
            },
          },
        );
      }}
    >
      <Alert message={generalError(apply.error ?? remove.error)} />
      {templates.isPending ? (
        <SkeletonRows rows={2} columns={1} />
      ) : templates.isError ? (
        <ErrorState
          message={errorMessage(templates.error)}
          onRetry={() => void templates.refetch()}
        />
      ) : templates.data.length === 0 ? (
        <EmptyState
          icon={Pill}
          title="Nenhum modelo salvo"
          description="Monte a prescrição de um internado e use Salvar como modelo."
        />
      ) : (
        <>
          <SelectField
            label="Modelo"
            placeholder="Escolha o modelo"
            value={templateId}
            error={errors.templateId}
            options={templates.data.map((t) => ({
              value: t.id,
              label: `${t.name} (${String(t.items.length)})`,
            }))}
            onChange={(e) => {
              setTemplateId(e.target.value);
              setErrors({});
            }}
          />
          {selected ? (
            <div className="rounded-control border border-line">
              <ul aria-label="Prescrições do modelo" className="divide-y divide-line text-sm">
                {selected.items.map((item, i) => (
                  <li key={`${item.name}-${String(i)}`} className="px-3 py-2">
                    <span className="font-medium text-ink">{item.name}</span>
                    <span className="block text-xs text-ink-muted">
                      {posology(item)} ·{' '}
                      {item.durationDays
                        ? `${String(item.durationDays)} ${item.durationDays === 1 ? 'dia' : 'dias'}`
                        : 'até nova ordem'}
                    </span>
                    <span className="block text-xs text-ink">{doseText(item, weightKg)}</span>
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-1.5 text-xs text-ink-muted">
                <span>
                  {selected.createdBy} ·{' '}
                  {isoToLocalInput(selected.updatedAt, timeZone)
                    .slice(0, 10)
                    .split('-')
                    .reverse()
                    .join('/')}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 className="size-4" aria-hidden />}
                  pending={remove.isPending}
                  onClick={() => {
                    if (!window.confirm(`Excluir o modelo ${selected.name}?`)) return;
                    remove.mutate(selected.id, {
                      onSuccess: () => {
                        toast.success(`Modelo ${selected.name} excluído.`);
                        setTemplateId('');
                      },
                    });
                  }}
                >
                  Excluir modelo
                </Button>
              </div>
            </div>
          ) : null}
          <TextField
            label="Primeiro horário"
            hint="Todas as prescrições do modelo começam neste horário."
            type="datetime-local"
            value={firstAt}
            error={errors.firstAt}
            onChange={(e) => {
              setFirstAt(e.target.value);
              setErrors({});
            }}
          />
        </>
      )}
    </FormDialog>
  );
}
