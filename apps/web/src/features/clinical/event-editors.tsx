import {
  clinicalEventInputSchema,
  clinicalEventSchema,
  examFlag,
  parseExamValue,
  PHOTO_MAX_BYTES,
  photoContentTypes,
  vitalKeys,
  vitalLimits,
  type Appointment,
  type ClinicalEvent,
  type ClinicalEventInput,
  type ClinicalEventKind,
  type ClinicalRecord,
  type ExamAttribute,
  type VitalKey,
} from '@clinica/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '../../design-system/button';
import { Dialog } from '../../design-system/dialog';
import { SelectField, TextField, TextareaField } from '../../design-system/field';
import { useToast } from '../../design-system/toast';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { useCan } from '../../lib/session';
import { appointmentTypesQuery } from '../schedule/queries';
import { FlagBadge, formatRange } from './exam-result';
import { isoToLocalInput, kindLabel, localInputToIso, zoned } from './labels';
import {
  clinicalTemplatesQuery,
  examFormQuery,
  examsQuery,
  pathologiesQuery,
  renderTemplate,
} from './queries';

export interface EditorState {
  kind: ClinicalEventKind;
  /** Evento existente (correção ou rascunho) ou null para um novo. */
  event: ClinicalEvent | null;
  /** Agendamento de origem, quando o atendimento começa pela coluna da agenda. */
  appointment: Appointment | null;
}

type Errors = Record<string, string>;

/** Erros do contrato (no navegador) ou da API, indexados pelo caminho do campo. */
function errorsOf(error: unknown): Errors {
  if (!(error instanceof ApiRequestError)) return {};
  return Object.fromEntries(error.fieldErrors.map((f) => [f.path, f.message]));
}

function validate(input: ClinicalEventInput): Errors | null {
  const parsed = clinicalEventInputSchema.safeParse(input);
  if (parsed.success) return null;
  return Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message]));
}

/** Escolhe o formulário pelo tipo de evento. */
export function EventEditor({
  state,
  record,
  onClose,
}: {
  state: EditorState;
  record: ClinicalRecord;
  onClose: () => void;
}) {
  switch (state.kind) {
    case 'encounter':
      return <EncounterEditor state={state} record={record} onClose={onClose} />;
    case 'photo':
      return <PhotoEditor record={record} onClose={onClose} />;
    case 'exam':
      return <ExamEditor event={state.event} record={record} onClose={onClose} />;
    case 'document':
    case 'prescription':
      return (
        <DocumentEditor kind={state.kind} event={state.event} record={record} onClose={onClose} />
      );
    default:
      return (
        <SimpleEditor kind={state.kind} event={state.event} record={record} onClose={onClose} />
      );
  }
}

/** Gravação comum: cria ou corrige, atualiza a ficha e fecha. */
function useSaveEvent(record: ClinicalRecord, event: ClinicalEvent | null, onClose: () => void) {
  const toast = useToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ClinicalEventInput) =>
      event
        ? api('PUT', `/clinical/events/${event.id}`, clinicalEventSchema, input)
        : api('POST', `/clinical/patients/${record.patient.id}/events`, clinicalEventSchema, input),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({
        queryKey: ['clinical', 'timeline', record.patient.id],
      });
      await queryClient.invalidateQueries({ queryKey: ['clinical', 'record', record.patient.id] });
      // Atendimento finalizado pode ter lançado o serviço na venda aberta [RN-19].
      await queryClient.invalidateQueries({ queryKey: ['sales', 'patient', record.patient.id] });
      toast.success(
        saved.status === 'draft'
          ? 'Rascunho salvo. Só você o vê até finalizar.'
          : event?.status === 'published'
            ? 'Correção salva e registrada no histórico.'
            : `${kindLabel(saved.kind)} registrado na ficha.`,
      );
      onClose();
    },
  });
}

/**
 * Data e hora do evento. Só aparece para quem pode registrar com data retroativa; em branco,
 * vale o momento do salvamento (ou a data original, numa correção).
 */
function useOccurredAt(record: ClinicalRecord, event: ClinicalEvent | null) {
  const can = useCan();
  const initial = event ? isoToLocalInput(event.occurredAt, record.timeZone) : '';
  const [value, setValue] = useState(initial);
  const iso = value && value !== initial ? localInputToIso(value, record.timeZone) : null;
  const field = (error: string | undefined) =>
    can('clinical.change_datetime') ? (
      <TextField
        label="Data e hora"
        type="datetime-local"
        value={value}
        max={isoToLocalInput(new Date().toISOString(), record.timeZone)}
        hint={event ? 'Altere só para corrigir quando aconteceu.' : 'Em branco, vale agora.'}
        error={error}
        onChange={(e) => {
          setValue(e.target.value);
        }}
      />
    ) : null;
  return { iso, value, field };
}

/** Diálogo com proteção contra perder o que foi digitado. */
function EditorDialog({
  title,
  description,
  dirty,
  onClose,
  actions,
  size,
  children,
}: {
  title: string;
  description?: string;
  dirty: boolean;
  onClose: () => void;
  actions: ReactNode;
  size?: 'md' | 'lg';
  children: ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  const attemptClose = () => {
    if (dirty) setConfirming(true);
    else onClose();
  };
  return (
    <Dialog
      open
      size={size ?? 'md'}
      onOpenChange={(open) => {
        if (!open) attemptClose();
      }}
      title={title}
      {...(description ? { description } : {})}
      footer={
        confirming ? (
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <span role="alert" className="mr-auto text-sm text-ink">
              Sair sem salvar o que foi digitado?
            </span>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Continuar editando
            </Button>
            <Button variant="danger" onClick={onClose}>
              Sair sem salvar
            </Button>
          </div>
        ) : (
          <>
            <Button variant="secondary" onClick={attemptClose}>
              Cancelar
            </Button>
            {actions}
          </>
        )
      }
    >
      {children}
    </Dialog>
  );
}

function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  if (error instanceof ApiRequestError && error.fieldErrors.length > 0) {
    return (
      <p role="alert" className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600">
        Confira os campos destacados.
      </p>
    );
  }
  return (
    <p role="alert" className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600">
      {errorMessage(error)}
    </p>
  );
}

/** Compara com o estado do primeiro render: houve digitação desde que o formulário abriu? */
function useDirty(value: unknown): boolean {
  const [first] = useState(() => JSON.stringify(value));
  return JSON.stringify(value) !== first;
}

const toNumber = (text: string): number | null => {
  const normalized = text.trim().replace(',', '.');
  if (normalized === '') return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : Number.NaN;
};
const fromNumber = (value: number | null) =>
  value === null ? '' : String(value).replace('.', ',');

// Atendimento ---------------------------------------------------------------------------------

/** Atendimento [RN-18, D1, D2]: sinais vitais e diagnóstico estruturados + narrativa por modelo. */
function EncounterEditor({
  state,
  record,
  onClose,
}: {
  state: EditorState;
  record: ClinicalRecord;
  onClose: () => void;
}) {
  const event = state.event;
  const initial = event?.data.kind === 'encounter' ? event.data : null;
  const types = useQuery(appointmentTypesQuery);
  const pathologies = useQuery(pathologiesQuery);
  const save = useSaveEvent(record, event, onClose);
  const occurred = useOccurredAt(record, event);

  const [typeId, setTypeId] = useState(initial?.type?.id ?? state.appointment?.type.id ?? '');
  const [appointmentId, setAppointmentId] = useState(
    event?.appointmentId ?? state.appointment?.id ?? '',
  );
  const [summary, setSummary] = useState(initial?.summary ?? '');
  const [narrative, setNarrative] = useState(initial?.narrative ?? '');
  const [vitals, setVitals] = useState<Record<VitalKey, string>>(
    () =>
      Object.fromEntries(
        vitalKeys.map((k) => [k, fromNumber(initial?.vitals[k] ?? null)]),
      ) as Record<VitalKey, string>,
  );
  const [diagnoses, setDiagnoses] = useState(initial?.pathologies ?? []);
  const [pick, setPick] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  /** Último texto de modelo carregado: trocar o tipo só substitui a narrativa se ela não foi editada. */
  const [template, setTemplate] = useState<string | null>(null);
  const [offer, setOffer] = useState<{ typeName: string; body: string } | null>(null);

  const loadTemplate = async (id: string, replace: boolean) => {
    if (!id) return;
    const rendered = await renderTemplate(record.patient.id, { typeId: id });
    if (!rendered.body) return;
    if (replace) {
      setTemplate(rendered.body);
      setNarrative(rendered.body);
      setOffer(null);
    } else {
      setOffer({ typeName: rendered.title, body: rendered.body });
    }
  };

  // Atendimento novo com tipo já definido (pela agenda) abre com o modelo do tipo.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || event || !typeId) return;
    opened.current = true;
    void loadTemplate(typeId, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const input: ClinicalEventInput = {
    kind: 'encounter',
    occurredAt: occurred.iso,
    typeId: typeId || null,
    appointmentId: appointmentId || null,
    summary,
    narrative,
    vitals: Object.fromEntries(vitalKeys.map((k) => [k, toNumber(vitals[k])])) as Record<
      VitalKey,
      number | null
    >,
    pathologyIds: diagnoses.map((d) => d.id),
    publish: false,
  };
  // O texto do modelo recém-carregado não conta como digitação.
  const dirty = useDirty({
    ...input,
    narrative: narrative === '' || narrative === template ? null : narrative,
  });
  const [publishing, setPublishing] = useState(false);
  const submit = (publish: boolean) => {
    const body = { ...input, publish };
    const local = validate(body);
    setErrors(local ?? {});
    setPublishing(publish);
    if (!local) {
      save.mutate(body, {
        onError: (error) => {
          setErrors(errorsOf(error));
        },
      });
    }
  };

  const typeOptions = (types.data ?? [])
    .filter((t) => !t.archived || t.id === typeId)
    .map((t) => ({ value: t.id, label: t.name }));
  const z = zoned(record.timeZone);
  const today = z.isoDay(new Date().toISOString());
  const appointmentOptions = (record.appointments ?? [])
    .filter((a) => a.date === today || a.id === appointmentId)
    .map((a) => ({ value: a.id, label: `${a.start} · ${a.type.name} · ${a.professional.name}` }));
  const available = (pathologies.data ?? []).filter(
    (p) => !p.archived && !diagnoses.some((d) => d.id === p.id),
  );
  const isDraft = !event || event.status === 'draft';

  return (
    <EditorDialog
      size="lg"
      title={
        event ? (isDraft ? 'Continuar atendimento' : 'Corrigir atendimento') : 'Novo atendimento'
      }
      description={`${record.patient.name} · ${record.owner.name}`}
      dirty={dirty}
      onClose={onClose}
      actions={
        <>
          {isDraft ? (
            <Button
              variant="secondary"
              pending={save.isPending && !publishing}
              disabled={save.isPending}
              onClick={() => {
                submit(false);
              }}
            >
              Salvar rascunho
            </Button>
          ) : null}
          <Button
            pending={save.isPending && publishing}
            disabled={save.isPending}
            onClick={() => {
              submit(true);
            }}
          >
            {isDraft ? 'Finalizar atendimento' : 'Salvar correção'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <FormError error={save.error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Tipo de atendimento"
            value={typeId}
            placeholder="Selecione"
            options={typeOptions}
            error={errors.typeId}
            onChange={(e) => {
              const id = e.target.value;
              setTypeId(id);
              const untouched = narrative.trim() === '' || narrative === template;
              void loadTemplate(id, untouched);
            }}
          />
          {appointmentOptions.length > 0 ? (
            <SelectField
              label="Agendamento"
              value={appointmentId}
              placeholder="Sem agendamento"
              options={appointmentOptions}
              error={errors.appointmentId}
              onChange={(e) => {
                setAppointmentId(e.target.value);
              }}
            />
          ) : null}
        </div>

        <fieldset>
          <legend className="mb-2 text-[13px] font-medium">Sinais vitais</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {vitalKeys.map((key) => {
              const limit = vitalLimits[key];
              return (
                <TextField
                  key={key}
                  label={`${limit.label} (${limit.unit.replace('/', '')})`}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={`${String(limit.min).replace('.', ',')}–${limit.max}`}
                  value={vitals[key]}
                  error={errors[`vitals.${key}`]}
                  onChange={(e) => {
                    setVitals((v) => ({ ...v, [key]: e.target.value }));
                  }}
                />
              );
            })}
          </div>
          <p className="mt-1.5 text-xs text-ink-muted">
            TPC: tempo de preenchimento capilar. Escore corporal de 1 a 9. O peso entra na curva de
            evolução.
          </p>
        </fieldset>

        <div>
          <p className="mb-1.5 text-[13px] font-medium">Diagnóstico</p>
          {diagnoses.length ? (
            <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Diagnósticos escolhidos">
              {diagnoses.map((d) => (
                <li
                  key={d.id}
                  className="inline-flex items-center gap-1 rounded-full bg-sage-50 py-0.5 pr-1 pl-2.5 text-sm text-sage-700"
                >
                  {d.code ? <span className="font-mono text-xs">{d.code}</span> : null}
                  {d.name}
                  <button
                    type="button"
                    aria-label={`Remover ${d.name}`}
                    onClick={() => {
                      setDiagnoses((all) => all.filter((x) => x.id !== d.id));
                    }}
                    className="rounded-full p-0.5 hover:bg-sage-100"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {pathologies.data && pathologies.data.length === 0 ? (
            <NoPathologies />
          ) : (
            <div className="flex gap-2">
              <select
                aria-label="Patologia"
                value={pick}
                onChange={(e) => {
                  setPick(e.target.value);
                }}
                className="h-10 min-w-0 flex-1 rounded-control border border-line-strong bg-surface px-3 text-sm"
              >
                <option value="">Escolha a patologia</option>
                {available.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code ? `${p.code} · ${p.name}` : p.name}
                  </option>
                ))}
              </select>
              <Button
                variant="secondary"
                disabled={!pick || diagnoses.length >= 10}
                onClick={() => {
                  const chosen = available.find((p) => p.id === pick);
                  if (chosen) {
                    setDiagnoses((all) => [
                      ...all,
                      { id: chosen.id, code: chosen.code, name: chosen.name },
                    ]);
                  }
                  setPick('');
                }}
              >
                Adicionar
              </Button>
            </div>
          )}
          {errors.pathologyIds ? (
            <p role="alert" className="mt-1 text-xs font-medium text-danger-600">
              {errors.pathologyIds}
            </p>
          ) : null}
        </div>

        <TextField
          label="Resumo"
          hint="Uma linha que aparece na linha do tempo, ex. Otite bilateral, retorno em 10 dias."
          maxLength={200}
          value={summary}
          error={errors.summary}
          onChange={(e) => {
            setSummary(e.target.value);
          }}
        />
        <div className="space-y-1.5">
          <TextareaField
            label="Prontuário"
            rows={14}
            value={narrative}
            error={errors.narrative}
            onChange={(e) => {
              setNarrative(e.target.value);
            }}
          />
          {offer ? (
            <p className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
              O tipo {offer.typeName} tem modelo próprio.
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setTemplate(offer.body);
                  setNarrative(offer.body);
                  setOffer(null);
                }}
              >
                Substituir pelo modelo
              </Button>
            </p>
          ) : null}
        </div>
        {occurred.field(errors.occurredAt)}
        {isDraft ? (
          <p className="text-xs text-ink-muted">
            Nada é gravado até você salvar. O rascunho fica visível só para você; ao finalizar,
            entra na linha do tempo.
          </p>
        ) : null}
      </div>
    </EditorDialog>
  );
}

function NoPathologies() {
  const can = useCan();
  return (
    <p className="text-sm text-ink-muted">
      Nenhuma patologia cadastrada.{' '}
      {can('catalogs.manage') ? (
        <Link to="/cadastros/patologias" className="text-sage-700 hover:underline">
          Cadastrar patologias
        </Link>
      ) : (
        'Peça ao gestor para cadastrar as patologias usadas na clínica.'
      )}
    </p>
  );
}

// Peso, patologia e observação ----------------------------------------------------------------

function SimpleEditor({
  kind,
  event,
  record,
  onClose,
}: {
  kind: Exclude<ClinicalEventKind, 'encounter' | 'photo' | 'document' | 'prescription' | 'exam'>;
  event: ClinicalEvent | null;
  record: ClinicalRecord;
  onClose: () => void;
}) {
  const d = event?.data;
  const save = useSaveEvent(record, event, onClose);
  const occurred = useOccurredAt(record, event);
  const pathologies = useQuery({ ...pathologiesQuery, enabled: kind === 'pathology' });
  const [weight, setWeight] = useState(d?.kind === 'weight' ? fromNumber(d.weightKg) : '');
  const [pathologyId, setPathologyId] = useState(d?.kind === 'pathology' ? d.pathology.id : '');
  const [notes, setNotes] = useState(
    d?.kind === 'weight' || d?.kind === 'pathology' ? d.notes : '',
  );
  const [text, setText] = useState(d?.kind === 'observation' ? d.text : '');
  const [errors, setErrors] = useState<Errors>({});

  const input: ClinicalEventInput =
    kind === 'weight'
      ? { kind, occurredAt: occurred.iso, weightKg: toNumber(weight) ?? Number.NaN, notes }
      : kind === 'pathology'
        ? { kind, occurredAt: occurred.iso, pathologyId, notes }
        : { kind, occurredAt: occurred.iso, text };
  const dirty = useDirty([weight, pathologyId, notes, text, occurred.value]);
  const submit = () => {
    const local = validate(input);
    setErrors(local ?? {});
    if (!local) {
      save.mutate(input, {
        onError: (error) => {
          setErrors(errorsOf(error));
        },
      });
    }
  };
  const options = (pathologies.data ?? [])
    .filter((p) => !p.archived || p.id === pathologyId)
    .map((p) => ({ value: p.id, label: p.code ? `${p.code} · ${p.name}` : p.name }));

  return (
    <EditorDialog
      title={event ? `Corrigir ${kindLabel(kind).toLowerCase()}` : kindLabel(kind)}
      description={record.patient.name}
      dirty={dirty}
      onClose={onClose}
      actions={
        <Button pending={save.isPending} onClick={submit}>
          {event ? 'Salvar correção' : 'Registrar'}
        </Button>
      }
    >
      <form
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <FormError error={save.error} />
        {kind === 'weight' ? (
          <>
            <TextField
              label="Peso (kg)"
              inputMode="decimal"
              autoComplete="off"
              autoFocus
              placeholder="Ex. 12,4"
              value={weight}
              error={errors.weightKg}
              onChange={(e) => {
                setWeight(e.target.value);
              }}
            />
            <TextField
              label="Observações"
              placeholder="Opcional, ex. em jejum"
              maxLength={500}
              value={notes}
              error={errors.notes}
              onChange={(e) => {
                setNotes(e.target.value);
              }}
            />
          </>
        ) : null}
        {kind === 'pathology' ? (
          pathologies.data && options.length === 0 ? (
            <NoPathologies />
          ) : (
            <>
              <SelectField
                label="Patologia"
                value={pathologyId}
                placeholder="Selecione"
                options={options}
                error={errors.pathologyId}
                onChange={(e) => {
                  setPathologyId(e.target.value);
                }}
              />
              <TextareaField
                label="Observações"
                placeholder="Opcional"
                maxLength={2000}
                value={notes}
                error={errors.notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                }}
              />
            </>
          )
        ) : null}
        {kind === 'observation' ? (
          <TextareaField
            label="Observação"
            rows={6}
            autoFocus
            maxLength={5000}
            value={text}
            error={errors.text}
            onChange={(e) => {
              setText(e.target.value);
            }}
          />
        ) : null}
        {occurred.field(errors.occurredAt)}
      </form>
    </EditorDialog>
  );
}

// Receita e documento -------------------------------------------------------------------------

function DocumentEditor({
  kind,
  event,
  record,
  onClose,
}: {
  kind: 'document' | 'prescription';
  event: ClinicalEvent | null;
  record: ClinicalRecord;
  onClose: () => void;
}) {
  const d = event?.data.kind === kind ? event.data : null;
  const templates = useQuery(clinicalTemplatesQuery);
  const save = useSaveEvent(record, event, onClose);
  const occurred = useOccurredAt(record, event);
  const [templateId, setTemplateId] = useState(d?.template?.id ?? '');
  const [title, setTitle] = useState(d?.title ?? (kind === 'prescription' ? 'Receita' : ''));
  const [body, setBody] = useState(d?.body ?? '');
  const [loaded, setLoaded] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [loading, setLoading] = useState(false);

  const input = (publish: boolean): ClinicalEventInput => ({
    kind,
    occurredAt: occurred.iso,
    templateId: templateId || null,
    title,
    body,
    publish,
  });
  // O texto vindo do modelo não conta como digitação.
  const dirty = useDirty([title, body === loaded ? null : body, occurred.value]);
  const submit = (publish: boolean) => {
    const local = validate(input(publish));
    setErrors(local ?? {});
    if (!local) {
      save.mutate(input(publish), {
        onError: (error) => {
          setErrors(errorsOf(error));
        },
      });
    }
  };
  const choose = async (id: string) => {
    setTemplateId(id);
    if (!id) return;
    setLoading(true);
    try {
      const rendered = await renderTemplate(record.patient.id, { templateId: id });
      setTitle(rendered.title);
      setBody(rendered.body);
      setLoaded(rendered.body);
    } finally {
      setLoading(false);
    }
  };
  const options = (templates.data ?? [])
    .filter((t) => t.kind === kind && (!t.archived || t.id === templateId))
    .map((t) => ({ value: t.id, label: t.name }));
  const isDraft = !event || event.status === 'draft';
  const noun = kind === 'prescription' ? 'receita' : 'documento';

  return (
    <EditorDialog
      size="lg"
      title={
        event
          ? `${isDraft ? 'Continuar' : 'Corrigir'} ${noun}`
          : kind === 'prescription'
            ? 'Nova receita'
            : 'Novo documento'
      }
      description={`${record.patient.name} · ${record.owner.name}`}
      dirty={dirty}
      onClose={onClose}
      actions={
        <>
          {isDraft ? (
            <Button
              variant="secondary"
              disabled={save.isPending}
              onClick={() => {
                submit(false);
              }}
            >
              Salvar rascunho
            </Button>
          ) : null}
          <Button
            pending={save.isPending}
            onClick={() => {
              submit(true);
            }}
          >
            {isDraft ? `Finalizar ${noun}` : 'Salvar correção'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError error={save.error} />
        <SelectField
          label="Modelo"
          value={templateId}
          placeholder={options.length ? 'Sem modelo' : 'Nenhum modelo cadastrado'}
          options={options}
          hint={
            event ? undefined : 'O modelo preenche o texto com os dados do animal e do responsável.'
          }
          disabled={loading}
          error={errors.templateId}
          onChange={(e) => {
            void choose(e.target.value);
          }}
        />
        <TextField
          label="Título"
          maxLength={120}
          value={title}
          error={errors.title}
          onChange={(e) => {
            setTitle(e.target.value);
          }}
        />
        <TextareaField
          label="Texto"
          rows={14}
          value={body}
          error={errors.body}
          onChange={(e) => {
            setBody(e.target.value);
          }}
        />
        {occurred.field(errors.occurredAt)}
      </div>
    </EditorDialog>
  );
}

// Exame ---------------------------------------------------------------------------------------

/** Linha do formulário de resultado: título de seção ou campo com seu tipo. */
type ExamRow =
  { kind: 'section'; id: string; name: string } | { kind: 'field'; attribute: ExamAttribute };

/**
 * Resultado de exame [RN-33, p.13–14]: campos do cadastro na ordem, com a faixa que vale para o
 * animal na data. A marcação ao lado é só uma prévia; quem decide é o servidor, que copia a faixa
 * no resultado.
 */
function ExamEditor({
  event,
  record,
  onClose,
}: {
  event: ClinicalEvent | null;
  record: ClinicalRecord;
  onClose: () => void;
}) {
  const d = event?.data.kind === 'exam' ? event.data : null;
  const exams = useQuery(examsQuery);
  const save = useSaveEvent(record, event, onClose);
  const occurred = useOccurredAt(record, event);
  const [examId, setExamId] = useState(d?.exam.id ?? '');
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (d?.values ?? []).map((v) => [
        v.attributeId,
        typeof v.value === 'number' ? fromNumber(v.value) : v.value,
      ]),
    ),
  );
  const [notes, setNotes] = useState(d?.notes ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const form = useQuery(
    examFormQuery(record.patient.id, examId, occurred.iso ?? event?.occurredAt ?? ''),
  );

  // Campos ativos do cadastro e, numa correção, os que saíram do cadastro mas estão no resultado.
  const rows = useMemo<ExamRow[]>(() => {
    if (!form.data) return [];
    const out: ExamRow[] = form.data.exam.attributes.map((a) =>
      a.kind === 'section'
        ? { kind: 'section', id: a.id, name: a.name }
        : { kind: 'field', attribute: a },
    );
    const known = new Set(form.data.exam.attributes.map((a) => a.id));
    for (const v of d?.values ?? []) {
      if (known.has(v.attributeId)) continue;
      out.push({
        kind: 'field',
        attribute: {
          id: v.attributeId,
          kind: 'field',
          name: v.name,
          unit: v.unit,
          dataType: v.dataType,
          decimals: v.dataType === 'decimal' ? 4 : null,
          maxLength: v.dataType === 'text' ? 200 : null,
        },
      });
    }
    return out;
  }, [form.data, d]);
  const fields = rows.flatMap((r) => (r.kind === 'field' ? [r.attribute] : []));
  const ranges = new Map((form.data?.reference?.ranges ?? []).map((r) => [r.attributeId, r]));

  const input = (publish: boolean): ClinicalEventInput => ({
    kind: 'exam',
    occurredAt: occurred.iso,
    examId,
    values: fields.map((a) => ({ attributeId: a.id, value: values[a.id] ?? '' })),
    notes,
    publish,
  });
  const dirty = useDirty([examId, values, notes, occurred.value]);
  const submit = (publish: boolean) => {
    const local: Errors = { ...validate(input(publish)) };
    fields.forEach((a, i) => {
      const raw = values[a.id]?.trim() ?? '';
      if (raw === '') return;
      const parsed = parseExamValue(a, raw);
      if (!parsed.ok) local[`values.${String(i)}.value`] = parsed.message;
    });
    if (publish && !fields.some((a) => (values[a.id]?.trim() ?? '') !== '')) {
      local.values = 'Preencha ao menos um resultado para finalizar';
    }
    setErrors(local);
    if (Object.keys(local).length === 0) {
      save.mutate(input(publish), {
        onError: (error) => {
          setErrors(errorsOf(error));
        },
      });
    }
  };
  const options = (exams.data ?? [])
    .filter((e) => !e.archived || e.id === examId)
    .map((e) => ({ value: e.id, label: e.name }));
  const isDraft = !event || event.status === 'draft';
  const can = useCan();

  return (
    <EditorDialog
      size="lg"
      title={event ? `${isDraft ? 'Continuar' : 'Corrigir'} exame` : 'Resultado de exame'}
      description={`${record.patient.name} · ${record.patient.speciesName ?? 'espécie não informada'}`}
      dirty={dirty}
      onClose={onClose}
      actions={
        examId ? (
          <>
            {isDraft ? (
              <Button
                variant="secondary"
                disabled={save.isPending}
                onClick={() => {
                  submit(false);
                }}
              >
                Salvar rascunho
              </Button>
            ) : null}
            <Button
              pending={save.isPending}
              onClick={() => {
                submit(true);
              }}
            >
              {isDraft ? 'Finalizar exame' : 'Salvar correção'}
            </Button>
          </>
        ) : null
      }
    >
      <form
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit(!isDraft);
        }}
      >
        <FormError error={save.error} />
        {exams.data && options.length === 0 ? (
          <div className="rounded-control border border-dashed border-line-strong p-4 text-sm">
            <p className="font-medium">Nenhum exame cadastrado</p>
            <p className="mt-1 text-ink-muted">
              {can('catalogs.manage') ? (
                <>
                  Cadastre os campos e as faixas de referência em{' '}
                  <Link to="/cadastros/exames" className="text-sage-700 underline">
                    Cadastros › Exames
                  </Link>
                  .
                </>
              ) : (
                'Peça a quem administra a clínica para cadastrar os exames.'
              )}
            </p>
          </div>
        ) : (
          <SelectField
            label="Exame"
            value={examId}
            placeholder="Selecione"
            options={options}
            disabled={event !== null}
            error={errors.examId}
            onChange={(e) => {
              setExamId(e.target.value);
              setValues({});
              setErrors({});
            }}
          />
        )}
        {examId && form.isPending ? (
          <p className="text-sm text-ink-muted">Carregando campos…</p>
        ) : null}
        {form.isError ? <FormError error={form.error} /> : null}
        {form.data ? (
          <>
            <p
              className={clsx(
                'rounded-control px-3 py-2 text-sm',
                form.data.reference ? 'bg-sage-50 text-sage-700' : 'bg-amber-50 text-amber-700',
              )}
            >
              {form.data.reference
                ? `Referência: ${form.data.reference.species}, ${form.data.reference.label}.`
                : form.data.referenceNote}
            </p>
            {errors.values ? (
              <p role="alert" className="text-sm text-danger-600">
                {errors.values}
              </p>
            ) : null}
            <div className="divide-y divide-line rounded-control border border-line">
              {rows.map((row) => {
                if (row.kind === 'section') {
                  return (
                    <h3
                      key={row.id}
                      className="bg-sunken px-3 py-1.5 font-mono text-[11px] font-medium tracking-[0.06em] text-ink-muted uppercase"
                    >
                      {row.name}
                    </h3>
                  );
                }
                const a = row.attribute;
                const index = fields.indexOf(a);
                const raw = values[a.id] ?? '';
                const range = ranges.get(a.id);
                const parsed = raw.trim() ? parseExamValue(a, raw) : null;
                const flag =
                  parsed?.ok && typeof parsed.value === 'number' && range
                    ? examFlag(parsed.value, range.low, range.high)
                    : null;
                return (
                  <div
                    key={a.id}
                    className="grid grid-cols-[1fr_8.5rem] items-start gap-x-3 gap-y-1 px-3 py-2 sm:grid-cols-[1fr_9rem_8rem_4.5rem]"
                  >
                    <label htmlFor={`exam-${a.id}`} className="pt-2 text-sm">
                      {a.name}
                      {a.unit ? (
                        <span className="ml-1 text-xs text-ink-muted">({a.unit})</span>
                      ) : null}
                    </label>
                    <div>
                      <input
                        id={`exam-${a.id}`}
                        inputMode={a.dataType === 'text' ? 'text' : 'decimal'}
                        autoComplete="off"
                        maxLength={a.dataType === 'text' ? (a.maxLength ?? 200) : 24}
                        value={raw}
                        aria-invalid={errors[`values.${String(index)}.value`] ? true : undefined}
                        aria-describedby={
                          errors[`values.${String(index)}.value`] ? `exam-${a.id}-error` : undefined
                        }
                        onChange={(e) => {
                          setValues((v) => ({ ...v, [a.id]: e.target.value }));
                        }}
                        className={clsx(
                          'h-9 w-full rounded-control border bg-surface px-2.5 text-right font-mono text-sm outline-none focus:border-sage-500',
                          a.dataType === 'text' && 'text-left font-sans',
                          errors[`values.${String(index)}.value`]
                            ? 'border-danger-600'
                            : 'border-line-strong',
                        )}
                      />
                      {errors[`values.${String(index)}.value`] ? (
                        <p id={`exam-${a.id}-error`} className="mt-1 text-xs text-danger-600">
                          {errors[`values.${String(index)}.value`]}
                        </p>
                      ) : null}
                    </div>
                    <span className="col-start-1 font-mono text-xs text-ink-muted sm:col-start-auto sm:pt-2.5">
                      {range ? formatRange(range.low, range.high) : ''}
                    </span>
                    <span className="sm:pt-2">
                      <FlagBadge flag={flag} />
                    </span>
                  </div>
                );
              })}
            </div>
            <TextareaField
              label="Observações"
              placeholder="Opcional, ex. amostra hemolisada"
              maxLength={2000}
              value={notes}
              error={errors.notes}
              onChange={(e) => {
                setNotes(e.target.value);
              }}
            />
            {occurred.field(errors.occurredAt)}
          </>
        ) : null}
      </form>
    </EditorDialog>
  );
}

// Fotos ---------------------------------------------------------------------------------------

function PhotoEditor({ record, onClose }: { record: ClinicalRecord; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const occurred = useOccurredAt(record, null);
  const [files, setFiles] = useState<File[]>([]);
  const [caption, setCaption] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(
    () => () => {
      for (const url of previews) URL.revokeObjectURL(url);
    },
    [previews],
  );

  const upload = useMutation({
    mutationFn: async () => {
      const query = new URLSearchParams({ caption });
      if (occurred.iso) query.set('occurredAt', occurred.iso);
      for (const [i, file] of files.entries()) {
        setProgress(i + 1);
        await api(
          'POST',
          `/clinical/patients/${record.patient.id}/photos?${query.toString()}`,
          clinicalEventSchema,
          file,
        );
      }
    },
    onSettled: async () => {
      setProgress(null);
      await queryClient.invalidateQueries({
        queryKey: ['clinical', 'timeline', record.patient.id],
      });
    },
    onSuccess: () => {
      toast.success(
        files.length === 1 ? 'Foto incluída na ficha.' : `${files.length} fotos incluídas.`,
      );
      onClose();
    },
  });

  return (
    <EditorDialog
      title="Fotos"
      description={record.patient.name}
      dirty={files.length > 0}
      onClose={onClose}
      actions={
        <Button
          pending={upload.isPending}
          disabled={files.length === 0}
          onClick={() => {
            upload.mutate();
          }}
        >
          {progress ? `Enviando ${progress} de ${files.length}` : 'Enviar'}
        </Button>
      }
    >
      <div className="space-y-4">
        <FormError error={upload.error} />
        <div className="space-y-1.5">
          <label htmlFor="photo-files" className="block text-[13px] font-medium">
            Imagens
          </label>
          <input
            id="photo-files"
            type="file"
            multiple
            accept={photoContentTypes.join(',')}
            aria-describedby="photo-hint"
            className="block w-full text-sm file:mr-3 file:rounded-control file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-sunken"
            onChange={(e) => {
              const chosen = [...(e.target.files ?? [])];
              const rejected = chosen.filter(
                (f) =>
                  !(photoContentTypes as readonly string[]).includes(f.type) ||
                  f.size > PHOTO_MAX_BYTES,
              );
              setProblem(
                rejected.length
                  ? `Ficaram de fora: ${rejected.map((f) => f.name).join(', ')}. Use JPEG, PNG ou WebP de até 8 MB.`
                  : null,
              );
              setFiles(chosen.filter((f) => !rejected.includes(f)).slice(0, 10));
            }}
          />
          <p id="photo-hint" className="text-xs text-ink-muted">
            JPEG, PNG ou WebP, até 8 MB cada e 10 por vez. Cada imagem vira um registro na linha do
            tempo.
          </p>
          {problem ? (
            <p role="alert" className="text-xs font-medium text-danger-600">
              {problem}
            </p>
          ) : null}
        </div>
        {previews.length ? (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {previews.map((url, i) => (
              <li key={url}>
                <img
                  src={url}
                  alt={files[i]?.name ?? ''}
                  className="aspect-square w-full rounded-control border border-line object-cover"
                />
              </li>
            ))}
          </ul>
        ) : null}
        <TextField
          label="Legenda"
          placeholder="Opcional, ex. lesão no membro anterior esquerdo"
          maxLength={300}
          value={caption}
          onChange={(e) => {
            setCaption(e.target.value);
          }}
        />
        {occurred.field(undefined)}
      </div>
    </EditorDialog>
  );
}
