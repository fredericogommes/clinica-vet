import {
  appointmentListSchema,
  appointmentSchema,
  DEFAULT_DURATION_MINUTES,
  MAX_OCCURRENCES,
  recurrenceFrequencies,
  recurrenceFrequencyLabels,
  type Appointment,
  type RecurrenceFrequency,
  type Slot,
} from '@clinica/contracts';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { ChevronRight, Search, TriangleAlert, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Button, buttonClasses } from '../../design-system/button';
import { Checkbox } from '../../design-system/checkbox';
import { Dialog } from '../../design-system/dialog';
import {
  SearchField,
  Segmented,
  SelectField,
  TextareaField,
  TextField,
} from '../../design-system/field';
import { useToast } from '../../design-system/toast';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { useCan } from '../../lib/session';
import { useDebounced } from '../../lib/use-debounced';
import { formatPhone } from '../clients/format';
import { clientQuery, clientsQuery } from '../clients/queries';
import { addDays, formatLongDay, localToday } from './dates';
import { appointmentTypesQuery, scheduleConfigQuery, slotsQuery } from './queries';

const durations = Array.from({ length: 16 }, (_, i) => (i + 1) * 15);
const durationLabel = (m: number) =>
  m < 60 ? `${m} min` : m % 60 === 0 ? `${m / 60} h` : `${Math.floor(m / 60)} h ${m % 60} min`;

interface Picked {
  clientId: string;
  patientIds: string[];
}

/**
 * Agendamento em dois passos [p.7]: localizar o cliente e escolher o animal; depois tipo,
 * duração, data e um horário livre já cruzado com o profissional.
 */
export function BookingDialog({
  initialDate,
  editing,
  onClose,
  onSaved,
}: {
  initialDate: string;
  /** Agendamento a remarcar; ausente para um novo. */
  editing?: Appointment | undefined;
  onClose: () => void;
  onSaved: (date: string) => void;
}) {
  const [picked, setPicked] = useState<Picked | null>(
    editing ? { clientId: editing.client.id, patientIds: editing.patients.map((p) => p.id) } : null,
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={editing ? 'Remarcar agendamento' : 'Novo agendamento'}
      {...(picked ? {} : { description: 'Passo 1 de 2: localize o cliente e escolha o animal.' })}
      footer={
        picked ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" form="booking-form">
              {editing ? 'Salvar alterações' : 'Agendar'}
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
        )
      }
    >
      {picked ? (
        <BookingForm
          picked={picked}
          editing={editing}
          initialDate={editing?.date ?? initialDate}
          onChangeClient={
            editing
              ? undefined
              : () => {
                  setPicked(null);
                }
          }
          onSaved={onSaved}
        />
      ) : (
        <ClientStep onPick={setPicked} />
      )}
    </Dialog>
  );
}

function ClientStep({ onPick }: { onPick: (picked: Picked) => void }) {
  const can = useCan();
  const [term, setTerm] = useState('');
  const q = useDebounced(term.trim());
  const results = useQuery({
    ...clientsQuery({ q, page: 1, archived: false }, 8),
    enabled: q.length >= 2,
  });

  return (
    <div className="space-y-3">
      <SearchField
        label="Localizar cliente"
        placeholder="Nome, ficha, telefone ou nome do animal"
        icon={<Search className="size-4" aria-hidden />}
        value={term}
        autoFocus
        onChange={(e) => {
          setTerm(e.target.value);
        }}
      />
      {q.length < 2 ? (
        <p className="px-1 text-sm text-ink-muted">Digite ao menos duas letras ou números.</p>
      ) : results.isPending ? (
        <p className="px-1 text-sm text-ink-muted">Buscando…</p>
      ) : results.isError ? (
        <p role="alert" className="px-1 text-sm text-danger-600">
          {errorMessage(results.error)}
        </p>
      ) : results.data.items.length === 0 ? (
        <p className="px-1 text-sm text-ink-muted">Nenhum cliente encontrado.</p>
      ) : (
        <ul className="space-y-2" aria-label="Clientes encontrados">
          {results.data.items.map((c) => (
            <li key={c.id} className="rounded-control border border-line px-3 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium">{c.name}</span>
                <span className="shrink-0 font-mono text-xs text-ink-muted">
                  {c.primaryPhone ? formatPhone(c.primaryPhone) : `#${c.code}`}
                </span>
              </div>
              {c.patients.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {c.patients.map((p) => (
                    <Button
                      key={p.id}
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        onPick({ clientId: c.id, patientIds: [p.id] });
                      }}
                    >
                      {p.name}
                      <ChevronRight className="size-3.5" aria-hidden />
                    </Button>
                  ))}
                </div>
              ) : can('patients.manage') ? (
                <Link
                  to="/clientes/$clientId/animais/novo"
                  params={{ clientId: c.id }}
                  className="mt-1 inline-block text-xs text-sage-700 hover:underline"
                >
                  Sem animais ativos. Cadastrar animal
                </Link>
              ) : (
                <p className="mt-1 text-xs text-ink-muted">Sem animais ativos.</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {can('clients.manage') ? (
        <Link to="/clientes/novo" className={buttonClasses('ghost', 'sm')}>
          <UserPlus className="size-4" aria-hidden />
          Cadastrar cliente novo
        </Link>
      ) : null}
    </div>
  );
}

function BookingForm({
  picked,
  editing,
  initialDate,
  onChangeClient,
  onSaved,
}: {
  picked: Picked;
  editing: Appointment | undefined;
  initialDate: string;
  onChangeClient: (() => void) | undefined;
  onSaved: (date: string) => void;
}) {
  const can = useCan();
  const toast = useToast();
  const queryClient = useQueryClient();
  const client = useQuery(clientQuery(picked.clientId));
  const types = useQuery(appointmentTypesQuery);
  const config = useQuery(scheduleConfigQuery);

  const [patientIds, setPatientIds] = useState(picked.patientIds);
  const [typeId, setTypeId] = useState(editing?.type.id ?? '');
  const [duration, setDuration] = useState(editing?.durationMinutes ?? DEFAULT_DURATION_MINUTES);
  const [date, setDate] = useState(
    initialDate < localToday() && !editing ? localToday() : initialDate,
  );
  const [professionalId, setProfessionalId] = useState(editing?.professional.id ?? '');
  const [slot, setSlot] = useState<{ professionalId: string; start: string } | null>(
    editing ? { professionalId: editing.professional.id, start: editing.start } : null,
  );
  const [fitIn, setFitIn] = useState(editing?.fitIn ?? false);
  const [fitInTime, setFitInTime] = useState(editing?.fitIn ? editing.start : '');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [status, setStatus] = useState<'scheduled' | 'confirmed'>('scheduled');
  const [repeat, setRepeat] = useState(false);
  const [frequency, setFrequency] = useState<RecurrenceFrequency>('weekly');
  const [count, setCount] = useState(4);
  const [problem, setProblem] = useState<string | null>(null);

  const slots = useQuery({
    ...slotsQuery({
      date,
      durationMinutes: duration,
      professionalId: professionalId || undefined,
      excludeAppointmentId: editing?.id,
    }),
    enabled: !fitIn && date !== '',
  });

  const save = useMutation({
    mutationFn: () => {
      const chosenProfessional = fitIn ? professionalId : (slot?.professionalId ?? '');
      const body = {
        patientIds,
        typeId,
        durationMinutes: duration,
        date,
        start: fitIn ? fitInTime : (slot?.start ?? ''),
        professionalId: chosenProfessional,
        notes,
        fitIn,
      };
      return editing
        ? api('PUT', `/appointments/${editing.id}`, appointmentSchema, body).then((a) => [a])
        : api('POST', '/appointments', appointmentListSchema, {
            ...body,
            clientId: picked.clientId,
            status,
            recurrence: repeat ? { frequency, count } : null,
          }).then((r) => r.items);
    },
    onSuccess: async (items) => {
      await queryClient.invalidateQueries({ queryKey: ['schedule'] });
      toast.success(
        editing
          ? 'Agendamento remarcado.'
          : items.length > 1
            ? `${items.length} agendamentos criados.`
            : 'Agendamento criado.',
      );
      onSaved(date);
    },
    onError: async (error) => {
      if (error instanceof ApiRequestError && error.code === 'conflict') {
        await queryClient.invalidateQueries({ queryKey: ['schedule', 'slots'] });
      }
    },
  });

  const activeTypes = (types.data ?? []).filter((t) => !t.archived || t.id === editing?.type.id);
  const members = config.data?.members ?? [];
  const animals = (client.data?.patients ?? []).filter(
    (p) => (!p.archived && p.status === 'alive') || patientIds.includes(p.id),
  );
  const errorDetails =
    save.error instanceof ApiRequestError
      ? save.error.fieldErrors.filter((f) => f.path.startsWith('occurrences'))
      : [];

  return (
    <form
      id="booking-form"
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const missing =
          patientIds.length === 0
            ? 'Selecione ao menos um animal.'
            : !typeId
              ? 'Selecione o tipo de atendimento.'
              : fitIn && (!professionalId || !fitInTime)
                ? 'No encaixe, informe o profissional e a hora.'
                : !fitIn && !slot
                  ? 'Escolha um horário livre.'
                  : null;
        setProblem(missing);
        if (!missing) save.mutate();
      }}
    >
      {problem || save.isError ? (
        <div
          role="alert"
          className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600"
        >
          <p>{problem ?? errorMessage(save.error)}</p>
          {errorDetails.length > 0 && !problem ? (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {errorDetails.map((d) => (
                <li key={d.path}>{d.message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-3 rounded-control bg-sunken px-3 py-2">
        <div className="min-w-0">
          <p className="text-xs text-ink-muted">{editing ? 'Cliente' : 'Passo 2 de 2 · Cliente'}</p>
          <p className="truncate text-sm font-medium">{client.data?.name ?? '…'}</p>
        </div>
        {onChangeClient ? (
          <Button variant="ghost" size="sm" onClick={onChangeClient}>
            Trocar
          </Button>
        ) : null}
      </div>

      <fieldset className="space-y-2">
        <legend className="text-[13px] font-medium text-ink">Animais</legend>
        {animals.map((p) => (
          <Checkbox
            key={p.id}
            label={p.name}
            description={p.speciesName ?? undefined}
            checked={patientIds.includes(p.id)}
            onCheckedChange={(checked) => {
              setPatientIds((ids) => (checked ? [...ids, p.id] : ids.filter((id) => id !== p.id)));
            }}
          />
        ))}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Tipo de atendimento"
          placeholder="Selecione"
          value={typeId}
          options={activeTypes.map((t) => ({ value: t.id, label: t.name }))}
          onChange={(e) => {
            setTypeId(e.target.value);
            const type = activeTypes.find((t) => t.id === e.target.value);
            if (type) {
              setDuration(type.durationMinutes);
              setSlot(null);
            }
          }}
        />
        <SelectField
          label="Duração"
          value={String(duration)}
          options={durations.map((m) => ({ value: String(m), label: durationLabel(m) }))}
          onChange={(e) => {
            setDuration(Number(e.target.value));
            setSlot(null);
          }}
        />
        <TextField
          label="Data"
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setSlot(null);
          }}
        />
        <SelectField
          label="Profissional"
          value={professionalId}
          placeholder={fitIn ? 'Selecione' : 'Qualquer profissional'}
          options={members.map((m) => ({ value: m.userId, label: m.name }))}
          onChange={(e) => {
            setProfessionalId(e.target.value);
            setSlot(null);
          }}
        />
      </div>

      {can('schedule.fit_in') ? (
        <Checkbox
          label="Encaixe fora da escala"
          description="Permite marcar fora do horário do profissional. Nunca sobrepõe outro agendamento."
          checked={fitIn}
          onCheckedChange={setFitIn}
        />
      ) : null}

      {fitIn ? (
        <TextField
          label="Hora do encaixe"
          type="time"
          step={900}
          value={fitInTime}
          onChange={(e) => {
            setFitInTime(e.target.value);
          }}
        />
      ) : (
        <SlotPicker
          date={date}
          query={slots}
          selected={slot}
          onSelect={setSlot}
          onNextDay={() => {
            setDate(addDays(date, 1));
            setSlot(null);
          }}
        />
      )}

      <TextareaField
        label="Observações"
        rows={2}
        maxLength={1000}
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
        }}
      />

      {editing ? null : (
        <>
          <Segmented
            label="Status inicial"
            value={status}
            options={[
              { value: 'scheduled', label: 'Agendado' },
              { value: 'confirmed', label: 'Confirmado' },
            ]}
            onChange={setStatus}
          />
          <Checkbox
            label="Ativar recorrência"
            description="Cria a série inteira de uma vez; se alguma data estiver ocupada, nada é gravado."
            checked={repeat}
            onCheckedChange={setRepeat}
          />
          {repeat ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="Repetir"
                value={frequency}
                options={recurrenceFrequencies.map((f) => ({
                  value: f,
                  label: recurrenceFrequencyLabels[f],
                }))}
                onChange={(e) => {
                  setFrequency(e.target.value as RecurrenceFrequency);
                }}
              />
              <TextField
                label="Número de ocorrências"
                type="number"
                min={2}
                max={MAX_OCCURRENCES}
                value={count}
                onChange={(e) => {
                  setCount(Number(e.target.value));
                }}
              />
            </div>
          ) : null}
        </>
      )}
    </form>
  );
}

function SlotPicker({
  date,
  query,
  selected,
  onSelect,
  onNextDay,
}: {
  date: string;
  query: UseQueryResult<Slot[]>;
  selected: { professionalId: string; start: string } | null;
  onSelect: (slot: { professionalId: string; start: string }) => void;
  onNextDay: () => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-[13px] font-medium text-ink">
        Horário livre {date ? `· ${formatLongDay(date)}` : ''}
      </legend>
      {query.isPending ? (
        <p className="text-sm text-ink-muted">Calculando horários…</p>
      ) : query.isError ? (
        <p role="alert" className="text-sm text-danger-600">
          {errorMessage(query.error)}
        </p>
      ) : query.data.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-control bg-sunken px-3 py-2">
          <p className="flex items-center gap-1.5 text-sm text-ink-muted">
            <TriangleAlert className="size-4 text-amber-500" aria-hidden />
            Nenhum horário livre neste dia.
          </p>
          <Button variant="secondary" size="sm" onClick={onNextDay}>
            Dia seguinte
          </Button>
        </div>
      ) : (
        <div
          role="radiogroup"
          aria-label="Horários livres"
          className="grid max-h-56 grid-cols-1 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2"
        >
          {query.data.map((s) => {
            const checked =
              selected?.professionalId === s.professionalId && selected.start === s.start;
            return (
              <button
                key={`${s.professionalId}-${s.start}`}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => {
                  onSelect({ professionalId: s.professionalId, start: s.start });
                }}
                className={clsx(
                  'min-w-0 rounded-control border px-2.5 py-1.5 text-left text-sm',
                  checked
                    ? 'border-sage-600 bg-sage-50 font-medium'
                    : 'border-line hover:bg-sunken',
                )}
              >
                <span className="block truncate">
                  <span className="font-mono">{s.start}</span> – {s.professionalName}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}
