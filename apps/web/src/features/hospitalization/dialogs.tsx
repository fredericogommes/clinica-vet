import {
  boxKindLabels,
  choiceParameters,
  clinicalParameterOptions,
  hospitalizationDetailSchema,
  hospitalizationPriorities,
  hospitalizationPriorityLabels,
  numericParameterLimits,
  numericParameters,
  type Box,
  type ClinicalParameters,
  type HospitalizationDetail,
  type HospitalizationPriority,
} from '@clinica/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { Button, buttonClasses } from '../../design-system/button';
import { Dialog } from '../../design-system/dialog';
import { Segmented, SelectField, TextareaField, TextField } from '../../design-system/field';
import { ErrorState, SkeletonRows } from '../../design-system/states';
import { useToast } from '../../design-system/toast';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { useSession } from '../../lib/session';
import { useDebounced } from '../../lib/use-debounced';
import { formatPhone, whatsappUrl } from '../clients/format';
import { patientsQuery } from '../patients/queries';
import { localToday } from '../schedule/dates';
import { hospitalizationOptionsQuery, hospitalizationQuery } from './queries';

export const fieldErrorsOf = (error: unknown): Record<string, string> =>
  error instanceof ApiRequestError
    ? Object.fromEntries(error.fieldErrors.map((f) => [f.path, f.message]))
    : {};

/** Erro sem campo (conflito, permissão) aparece no topo do formulário. */
export const generalError = (error: unknown) =>
  error && Object.keys(fieldErrorsOf(error)).length === 0 ? errorMessage(error) : undefined;

export function Alert({ message }: { message: string | undefined }) {
  return message ? (
    <p role="alert" className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600">
      {message}
    </p>
  ) : null;
}

/** Escrita na internação: devolve a ficha atualizada e atualiza painel, histórico e boxes. */
function useHospitalizationMutation<T>(method: 'POST' | 'PUT', path: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: T) => api(method, path, hospitalizationDetailSchema, body),
    onSuccess: async (saved) => {
      queryClient.setQueryData(hospitalizationQuery(saved.id).queryKey, saved);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['hospitalizations', 'list'] }),
        queryClient.invalidateQueries({ queryKey: ['hospitalizations', 'boxes'] }),
        queryClient.invalidateQueries({ queryKey: ['hospitalizations', 'patient'] }),
        queryClient.invalidateQueries({ queryKey: ['clinical'] }),
        queryClient.invalidateQueries({ queryKey: ['patients'] }),
      ]);
    },
  });
}

const boxLabel = (b: Box) =>
  `${b.code} · ${b.name} (${boxKindLabels[b.kind]}) · ${String(b.occupied)} de ${String(b.capacity)}`;

function PriorityField({
  value,
  onChange,
}: {
  value: HospitalizationPriority;
  onChange: (value: HospitalizationPriority) => void;
}) {
  return (
    <Segmented
      label="Prioridade"
      value={value}
      options={hospitalizationPriorities.map((p) => ({
        value: p,
        label: hospitalizationPriorityLabels[p],
      }))}
      onChange={onChange}
    />
  );
}

/** Animal a internar: busca por nome, código ou responsável; só animais vivos e ativos. */
function PatientPicker({
  value,
  onChange,
  error,
}: {
  value: { id: string; name: string; detail: string } | null;
  onChange: (value: { id: string; name: string; detail: string } | null) => void;
  error: string | undefined;
}) {
  const [term, setTerm] = useState('');
  const q = useDebounced(term.trim());
  const found = useQuery({
    ...patientsQuery({ q, page: 1, archived: false }),
    enabled: q.length >= 2 && !value,
  });
  if (value) {
    return (
      <div className="space-y-1.5">
        <p className="text-[13px] font-medium text-ink">Animal</p>
        <div className="flex items-center justify-between gap-3 rounded-control border border-line bg-sunken px-3 py-2">
          <span className="min-w-0 text-sm">
            <span className="block font-medium">{value.name}</span>
            <span className="block truncate text-xs text-ink-muted">{value.detail}</span>
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onChange(null);
            }}
          >
            Trocar
          </Button>
        </div>
      </div>
    );
  }
  const alive = (found.data?.items ?? []).filter((p) => p.status === 'alive');
  return (
    <div className="space-y-2">
      <TextField
        label="Animal"
        type="search"
        autoComplete="off"
        placeholder="Busque por nome, código ou responsável"
        value={term}
        error={error}
        onChange={(e) => {
          setTerm(e.target.value);
        }}
      />
      {q.length >= 2 && found.data ? (
        alive.length === 0 ? (
          <p className="text-sm text-ink-muted">Nenhum animal vivo encontrado.</p>
        ) : (
          <ul
            aria-label="Animais encontrados"
            className="max-h-48 divide-y divide-line overflow-y-auto rounded-control border border-line"
          >
            {alive.map((p) => {
              const detail = [p.speciesName, p.breedName, p.owner.name].filter(Boolean).join(' · ');
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left hover:bg-sage-50"
                    onClick={() => {
                      onChange({ id: p.id, name: p.name, detail });
                    }}
                  >
                    <span className="block text-sm font-medium">{p.name}</span>
                    <span className="block text-xs text-ink-muted">{detail}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </div>
  );
}

/** Internar [p.14]: animal, veterinário responsável, prioridade, box, motivo e previsão de alta. */
export function AdmitDialog({
  patient: preset,
  onClose,
}: {
  patient?: { id: string; name: string; detail: string };
  onClose: () => void;
}) {
  const session = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const options = useQuery(hospitalizationOptionsQuery);
  const [patient, setPatient] = useState(preset ?? null);
  const [veterinarianId, setVeterinarianId] = useState<string | null>(null);
  const [priority, setPriority] = useState<HospitalizationPriority>('routine');
  const [boxId, setBoxId] = useState('');
  const [reason, setReason] = useState('');
  const [expected, setExpected] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const admit = useHospitalizationMutation<unknown>('POST', '/hospitalizations');
  // Sem escolha, o veterinário responsável é quem está internando, se puder ser escolhido.
  const vet =
    veterinarianId ??
    (options.data?.veterinarians.some((v) => v.id === session.user.id) ? session.user.id : '');

  const submit = () => {
    const found: Record<string, string> = {};
    if (!patient) found.patientId = 'Escolha o animal';
    if (!vet) found.veterinarianId = 'Escolha o veterinário responsável';
    if (reason.trim().length < 3) found.reason = 'Descreva o motivo da internação';
    setErrors(found);
    if (!patient || Object.keys(found).length > 0) return;
    // A ficha clínica troca o botão Internar pelo atalho assim que a internação existe, o que
    // desmonta este diálogo: a navegação segue a promessa, não o callback do componente.
    admit
      .mutateAsync({
        patientId: patient.id,
        veterinarianId: vet,
        priority,
        reason,
        expectedDischargeOn: expected || null,
        boxId: boxId || null,
      })
      .then((saved) => {
        toast.success(`${saved.patient.name} internado. Internação ${String(saved.code)}.`);
        onClose();
        void navigate({
          to: '/internacao/$hospitalizationId',
          params: { hospitalizationId: saved.id },
        });
      })
      .catch((e: unknown) => {
        setErrors(fieldErrorsOf(e));
      });
  };

  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={preset ? `Internar ${preset.name}` : 'Internar animal'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="admit-form" pending={admit.isPending}>
            Internar
          </Button>
        </>
      }
    >
      {options.isPending ? (
        <SkeletonRows rows={4} columns={2} />
      ) : options.isError ? (
        <ErrorState message={errorMessage(options.error)} onRetry={() => void options.refetch()} />
      ) : (
        <form
          id="admit-form"
          noValidate
          aria-label="Internação"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Alert message={generalError(admit.error)} />
          {preset ? null : (
            <PatientPicker value={patient} onChange={setPatient} error={errors.patientId} />
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Veterinário responsável"
              placeholder="Escolha"
              value={vet}
              options={options.data.veterinarians.map((v) => ({ value: v.id, label: v.name }))}
              error={errors.veterinarianId}
              onChange={(e) => {
                setVeterinarianId(e.target.value);
              }}
            />
            <SelectField
              label="Box"
              placeholder="Sem box por enquanto"
              value={boxId}
              options={options.data.boxes.map((b) => ({ value: b.id, label: boxLabel(b) }))}
              error={errors.boxId}
              onChange={(e) => {
                setBoxId(e.target.value);
              }}
            />
          </div>
          <PriorityField value={priority} onChange={setPriority} />
          <TextareaField
            label="Motivo da internação"
            rows={3}
            maxLength={1000}
            value={reason}
            error={errors.reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
          />
          <TextField
            label="Previsão de alta"
            type="date"
            min={localToday()}
            value={expected}
            error={errors.expectedDischargeOn}
            hint="Opcional; pode ser ajustada depois."
            onChange={(e) => {
              setExpected(e.target.value);
            }}
          />
        </form>
      )}
    </Dialog>
  );
}

export function FormDialog({
  title,
  description,
  formId,
  submitLabel,
  danger,
  pending,
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  description?: string;
  formId: string;
  submitLabel: string;
  danger?: boolean;
  pending: boolean;
  onClose: () => void;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      {...(description ? { description } : {})}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button
            type="submit"
            form={formId}
            variant={danger ? 'danger' : 'primary'}
            pending={pending}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        aria-label={title}
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        {children}
      </form>
    </Dialog>
  );
}

export function EditDialog({ h, onClose }: { h: HospitalizationDetail; onClose: () => void }) {
  const toast = useToast();
  const options = useQuery(hospitalizationOptionsQuery);
  const [veterinarianId, setVeterinarianId] = useState(h.veterinarian.id);
  const [priority, setPriority] = useState(h.priority);
  const [reason, setReason] = useState(h.reason);
  const [expected, setExpected] = useState(h.expectedDischargeOn ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useHospitalizationMutation<unknown>('PUT', `/hospitalizations/${h.id}`);
  const vets = options.data?.veterinarians ?? [h.veterinarian];
  return (
    <FormDialog
      title="Editar internação"
      formId="edit-hospitalization"
      submitLabel="Salvar"
      pending={save.isPending}
      onClose={onClose}
      onSubmit={() => {
        if (reason.trim().length < 3) {
          setErrors({ reason: 'Descreva o motivo da internação' });
          return;
        }
        save.mutate(
          { veterinarianId, priority, reason, expectedDischargeOn: expected || null },
          {
            onSuccess: () => {
              toast.success('Internação atualizada.');
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
      <SelectField
        label="Veterinário responsável"
        value={veterinarianId}
        options={(vets.some((v) => v.id === h.veterinarian.id)
          ? vets
          : [h.veterinarian, ...vets]
        ).map((v) => ({ value: v.id, label: v.name }))}
        error={errors.veterinarianId}
        onChange={(e) => {
          setVeterinarianId(e.target.value);
        }}
      />
      <PriorityField value={priority} onChange={setPriority} />
      <TextareaField
        label="Motivo da internação"
        rows={3}
        maxLength={1000}
        value={reason}
        error={errors.reason}
        onChange={(e) => {
          setReason(e.target.value);
        }}
      />
      <TextField
        label="Previsão de alta"
        type="date"
        value={expected}
        error={errors.expectedDischargeOn}
        onChange={(e) => {
          setExpected(e.target.value);
        }}
      />
    </FormDialog>
  );
}

export function BoxDialog({ h, onClose }: { h: HospitalizationDetail; onClose: () => void }) {
  const toast = useToast();
  const options = useQuery(hospitalizationOptionsQuery);
  const [boxId, setBoxId] = useState(h.box?.id ?? '');
  const [error, setError] = useState<string | undefined>();
  const move = useHospitalizationMutation<{ boxId: string | null }>(
    'POST',
    `/hospitalizations/${h.id}/box`,
  );
  return (
    <FormDialog
      title="Trocar de box"
      description={h.box ? `Hoje em ${h.box.code} (${h.box.name}).` : 'Hoje sem box.'}
      formId="move-box"
      submitLabel="Salvar box"
      pending={move.isPending}
      onClose={onClose}
      onSubmit={() => {
        move.mutate(
          { boxId: boxId || null },
          {
            onSuccess: (saved) => {
              toast.success(saved.box ? `Box: ${saved.box.code}.` : 'Animal sem box.');
              onClose();
            },
            onError: (e) => {
              setError(fieldErrorsOf(e).boxId ?? errorMessage(e));
            },
          },
        );
      }}
    >
      <SelectField
        label="Box"
        placeholder="Sem box"
        value={boxId}
        options={(options.data?.boxes ?? []).map((b) => ({ value: b.id, label: boxLabel(b) }))}
        error={error}
        onChange={(e) => {
          setBoxId(e.target.value);
          setError(undefined);
        }}
      />
    </FormDialog>
  );
}

/** Alta ou óbito. O óbito também marca o animal como falecido. */
export function CloseDialog({
  h,
  outcome,
  onClose,
}: {
  h: HospitalizationDetail;
  outcome: 'discharged' | 'deceased';
  onClose: () => void;
}) {
  const toast = useToast();
  const [notes, setNotes] = useState('');
  const close = useHospitalizationMutation<unknown>('POST', `/hospitalizations/${h.id}/close`);
  const death = outcome === 'deceased';
  return (
    <FormDialog
      title={death ? `Registrar óbito de ${h.patient.name}` : `Dar alta a ${h.patient.name}`}
      description={
        death
          ? 'Encerra a internação e marca o animal como falecido na data de hoje.'
          : 'Encerra a internação; ela passa para o histórico de internações.'
      }
      formId="close-hospitalization"
      submitLabel={death ? 'Registrar óbito' : 'Dar alta'}
      danger={death}
      pending={close.isPending}
      onClose={onClose}
      onSubmit={() => {
        close.mutate(
          { outcome, notes },
          {
            onSuccess: () => {
              toast.success(death ? 'Óbito registrado.' : 'Alta registrada.');
              onClose();
            },
          },
        );
      }}
    >
      <Alert message={close.isError ? errorMessage(close.error) : undefined} />
      <TextareaField
        label={death ? 'Observação do óbito' : 'Orientações e observações da alta'}
        rows={4}
        maxLength={2000}
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
        }}
      />
    </FormDialog>
  );
}

export function CancelDialog({ h, onClose }: { h: HospitalizationDetail; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const cancel = useHospitalizationMutation<{ reason: string }>(
    'POST',
    `/hospitalizations/${h.id}/cancel`,
  );
  return (
    <FormDialog
      title="Cancelar internação"
      description="Para internação aberta por engano. Ela fica no histórico como cancelada, com o motivo."
      formId="cancel-hospitalization"
      submitLabel="Cancelar internação"
      danger
      pending={cancel.isPending}
      onClose={onClose}
      onSubmit={() => {
        if (reason.trim().length < 3) {
          setError('Explique o motivo em poucas palavras');
          return;
        }
        cancel.mutate(
          { reason },
          {
            onSuccess: () => {
              toast.success('Internação cancelada.');
              onClose();
            },
            onError: (e) => {
              setError(fieldErrorsOf(e).reason ?? errorMessage(e));
            },
          },
        );
      }}
    >
      <TextareaField
        label="Motivo"
        rows={2}
        maxLength={300}
        value={reason}
        error={error}
        onChange={(e) => {
          setReason(e.target.value);
          setError(undefined);
        }}
      />
    </FormDialog>
  );
}

export type EntryKind = 'occurrence' | 'weight' | 'parameters' | 'report';

const entryTitles: Record<EntryKind, string> = {
  occurrence: 'Registrar ocorrência',
  weight: 'Registrar peso',
  parameters: 'Registrar parâmetros clínicos',
  report: 'Relatório médico',
};

const emptyParameters: Record<keyof ClinicalParameters, string> = {
  appetite: '',
  behavior: '',
  feces: '',
  urine: '',
  vomit: '',
  temperature: '',
  heartRate: '',
  respiratoryRate: '',
  systolicPressure: '',
  glucose: '',
  dehydration: '',
};

export const decimal = (value: string) => Number(value.replace(',', '.'));

/** Ocorrência, peso, parâmetros clínicos (opções fechadas) ou relatório médico. */
export function EntryDialog({
  h,
  kind,
  onClose,
}: {
  h: HospitalizationDetail;
  kind: EntryKind;
  onClose: () => void;
}) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [weight, setWeight] = useState('');
  const [params, setParams] = useState(emptyParameters);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const add = useHospitalizationMutation<unknown>('POST', `/hospitalizations/${h.id}/entries`);

  const submit = () => {
    const found: Record<string, string> = {};
    let body: unknown;
    if (kind === 'weight') {
      const kg = decimal(weight);
      if (!weight || !Number.isFinite(kg) || kg <= 0) found.weightKg = 'Informe o peso em kg';
      body = { kind, weightKg: kg, text };
    } else if (kind === 'parameters') {
      const parameters: Record<string, string | number | null> = {};
      for (const key of choiceParameters) parameters[key] = params[key] || null;
      for (const key of numericParameters) {
        const raw = params[key].trim();
        const value = decimal(raw);
        if (raw && !Number.isFinite(value)) found[`parameters.${key}`] = 'Informe um número';
        parameters[key] = raw ? value : null;
      }
      if (Object.values(parameters).every((v) => v === null)) {
        found.parameters = 'Preencha ao menos um parâmetro';
      }
      body = { kind, parameters, text };
    } else {
      if (!text.trim()) {
        found.text = kind === 'report' ? 'Escreva o relatório' : 'Descreva a ocorrência';
      }
      body = { kind, text };
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    add.mutate(body, {
      onSuccess: () => {
        toast.success(
          kind === 'weight'
            ? 'Peso registrado na internação e no prontuário.'
            : 'Registro incluído no histórico.',
        );
        onClose();
      },
      onError: (e) => {
        setErrors(fieldErrorsOf(e));
      },
    });
  };

  return (
    <Dialog
      open
      size={kind === 'parameters' ? 'lg' : 'md'}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={entryTitles[kind]}
      description={`${h.patient.name}, internação ${String(h.code)}.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" form="entry-form" pending={add.isPending}>
            Registrar
          </Button>
        </>
      }
    >
      <form
        id="entry-form"
        noValidate
        aria-label={entryTitles[kind]}
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Alert message={generalError(add.error) ?? errors.parameters} />
        {kind === 'weight' ? (
          <TextField
            label="Peso (kg)"
            inputMode="decimal"
            autoComplete="off"
            value={weight}
            error={errors.weightKg}
            hint={
              h.patient.weightKg === null
                ? 'Sem pesagem anterior.'
                : `Último peso: ${String(h.patient.weightKg).replace('.', ',')} kg.`
            }
            onChange={(e) => {
              setWeight(e.target.value);
            }}
          />
        ) : null}
        {kind === 'parameters' ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {choiceParameters.map((key) => (
                <SelectField
                  key={key}
                  label={clinicalParameterOptions[key].label}
                  placeholder="Não avaliado"
                  value={params[key]}
                  options={clinicalParameterOptions[key].options.map((o) => ({
                    value: o,
                    label: o,
                  }))}
                  error={errors[`parameters.${key}`]}
                  onChange={(e) => {
                    setParams({ ...params, [key]: e.target.value });
                  }}
                />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {numericParameters.map((key) => {
                const limit = numericParameterLimits[key];
                return (
                  <TextField
                    key={key}
                    label={`${limit.label} (${limit.unit})`}
                    inputMode="decimal"
                    autoComplete="off"
                    value={params[key]}
                    error={errors[`parameters.${key}`]}
                    onChange={(e) => {
                      setParams({ ...params, [key]: e.target.value });
                    }}
                  />
                );
              })}
            </div>
          </>
        ) : null}
        <TextareaField
          label={
            kind === 'occurrence'
              ? 'Ocorrência'
              : kind === 'report'
                ? 'Relatório'
                : 'Observação (opcional)'
          }
          rows={kind === 'report' ? 8 : 3}
          maxLength={kind === 'report' ? 5000 : kind === 'occurrence' ? 2000 : 300}
          value={text}
          error={errors.text}
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
      </form>
    </Dialog>
  );
}

/**
 * Enviar mensagem ao tutor [p.15]: a mensagem fica registrada no histórico da internação e sai
 * pronta para o WhatsApp do responsável (ou para copiar, quando não há telefone).
 */
export function MessageDialog({ h, onClose }: { h: HospitalizationDetail; onClose: () => void }) {
  const toast = useToast();
  const session = useSession();
  const first = h.client.name.split(' ')[0] ?? h.client.name;
  const [text, setText] = useState(`Olá, ${first}! Notícias do ${h.patient.name} na internação: `);
  const [error, setError] = useState<string | undefined>();
  const [sent, setSent] = useState<string | null>(null);
  const add = useHospitalizationMutation<unknown>('POST', `/hospitalizations/${h.id}/entries`);
  const signed = (body: string) => `${body.trim()}\n\n${session.organization.name}`;

  if (sent !== null) {
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        title="Mensagem registrada"
        description="Ela já está no histórico da internação. Envie ao responsável pelo WhatsApp ou copie o texto."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(sent).then(
                  () => {
                    toast.success('Mensagem copiada.');
                  },
                  () => {
                    toast.error('Não foi possível copiar. Selecione o texto e copie.');
                  },
                );
              }}
            >
              Copiar texto
            </Button>
            {h.client.phone ? (
              <a
                href={`${whatsappUrl(h.client.phone)}?text=${encodeURIComponent(sent)}`}
                target="_blank"
                rel="noreferrer"
                className={buttonClasses('primary')}
                onClick={onClose}
              >
                Abrir no WhatsApp
              </a>
            ) : (
              <Button onClick={onClose}>Concluir</Button>
            )}
          </>
        }
      >
        <p className="rounded-control bg-sunken px-3 py-2 text-sm break-words whitespace-pre-line text-ink">
          {sent}
        </p>
        <p className="mt-3 text-xs text-ink-muted">
          {h.client.phone
            ? `Para ${h.client.name}, ${formatPhone(h.client.phone)}.`
            : `${h.client.name} não tem telefone no cadastro.`}
        </p>
      </Dialog>
    );
  }

  return (
    <FormDialog
      title="Enviar mensagem ao tutor"
      description={`Para ${h.client.name}${h.client.phone ? `, ${formatPhone(h.client.phone)}` : ''}.`}
      formId="message-form"
      submitLabel="Registrar mensagem"
      pending={add.isPending}
      onClose={onClose}
      onSubmit={() => {
        if (!text.trim()) {
          setError('Escreva a mensagem');
          return;
        }
        add.mutate(
          { kind: 'message', text: text.trim() },
          {
            onSuccess: () => {
              setSent(signed(text));
            },
            onError: (e) => {
              setError(fieldErrorsOf(e).text ?? errorMessage(e));
            },
          },
        );
      }}
    >
      <TextareaField
        label="Mensagem"
        rows={5}
        maxLength={2000}
        value={text}
        error={error}
        onChange={(e) => {
          setText(e.target.value);
          setError(undefined);
        }}
      />
    </FormDialog>
  );
}
