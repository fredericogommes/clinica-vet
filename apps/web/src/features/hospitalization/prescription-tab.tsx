import {
  calculateDose,
  concentrationUnitOf,
  doseUnits,
  executionStatusLabels,
  prescriptionRoutes,
  routeLabels,
  type DoseUnit,
  type ExecutionStatus,
  type HospitalizationDetail,
  type Prescription,
  type PrescriptionRoute,
  type ScheduledDose,
} from '@clinica/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight, ClipboardList, Pill, Plus, Save } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { z } from 'zod';
import { Button } from '../../design-system/button';
import { Dialog } from '../../design-system/dialog';
import { Segmented, SelectField, TextareaField, TextField } from '../../design-system/field';
import { Badge, Facts, Section } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { useToast } from '../../design-system/toast';
import { api, errorMessage } from '../../lib/api';
import { useCan } from '../../lib/session';
import { formatKg, isoToLocalInput, localInputToIso, zoned } from '../clinical/labels';
import { addDays, formatLongDay, localToday } from '../schedule/dates';
import { Alert, decimal, fieldErrorsOf, FormDialog, generalError } from './dialogs';
import {
  doseState,
  doseStateLabels,
  doseText,
  nextFullHour,
  number,
  posology,
  type DoseState,
} from './dose';
import { prescriptionDayQuery } from './queries';
import { ApplyTemplateDialog, SaveTemplateDialog } from './template-dialogs';

const hours = Array.from({ length: 24 }, (_, h) => h);

const doseClasses: Record<DoseState, string> = {
  done: 'border-success-600/30 bg-success-50 text-success-600',
  skipped: 'border-amber-500/40 bg-amber-50 text-amber-700',
  overdue: 'border-danger-600/40 bg-danger-50 text-danger-600',
  pending: 'border-line-strong bg-surface text-ink',
};

/** "22/10 18:23": data e hora curtas no fuso da unidade. */
const shortDateTime = (z: ReturnType<typeof zoned>, iso: string) =>
  z.dateTime(iso).replace(/\/\d{4},?/, '');

/**
 * Grade de 24 horas: ao abrir, rola até a hora pedida (a hora atual, ou o primeiro horário do
 * dia), descontando a coluna fixa da esquerda.
 */
export function useScrollToHour(ref: RefObject<HTMLDivElement | null>, hour: number | null) {
  useEffect(() => {
    const box = ref.current;
    if (!box || hour === null) return;
    const th = box.querySelector<HTMLElement>(`th[data-hour="${String(Math.max(0, hour))}"]`);
    const sticky = box.querySelector<HTMLElement>('th[data-sticky]');
    if (th) box.scrollLeft = th.offsetLeft - (sticky?.offsetWidth ?? 0);
  }, [ref, hour]);
}

/** Escrita de prescrição: atualiza a grade, a ficha (histórico) e o mapa de execução. */
function usePrescriptionMutation<T>(path: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: T) => api('POST', path, z.object({ id: z.uuid() }), body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['hospitalizations'] });
    },
  });
}

/** Navegação de um dia para outro, usada na grade da prescrição e no mapa de execução. */
export function DayNav({
  date,
  today,
  onChange,
}: {
  date: string;
  today: string;
  onChange: (date: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Dia">
      <Button
        size="sm"
        variant="secondary"
        aria-label="Dia anterior"
        icon={<ChevronLeft className="size-4" aria-hidden />}
        onClick={() => {
          onChange(addDays(date, -1));
        }}
      />
      <Button
        size="sm"
        variant="secondary"
        aria-label="Próximo dia"
        icon={<ChevronRight className="size-4" aria-hidden />}
        onClick={() => {
          onChange(addDays(date, 1));
        }}
      />
      <span className="text-sm font-medium text-ink" aria-live="polite">
        {formatLongDay(date)}
      </span>
      {date === today ? null : (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            onChange(today);
          }}
        >
          Hoje
        </Button>
      )}
    </div>
  );
}

type Open =
  | { kind: 'new' }
  | { kind: 'apply' }
  | { kind: 'save'; prescriptions: Prescription[] }
  | { kind: 'stop'; p: Prescription }
  | { kind: 'dose'; p: Prescription; dose: ScheduledDose };

/**
 * Prescrição médica [p.15, RN-42]: grade de 24 horas do dia com cada horário aprazado, a dose
 * calculada pelo peso atual e o registro de execução (programado × executado, com autor).
 */
export function PrescriptionTab({ h }: { h: HospitalizationDetail }) {
  const can = useCan();
  const [date, setDate] = useState(localToday);
  const day = useQuery(prescriptionDayQuery(h.id, date));
  const [open, setOpen] = useState<Open | null>(null);
  const admitted = h.status === 'admitted';
  const prescribe = admitted && can('hospitalization.prescribe');
  const close = () => {
    setOpen(null);
  };
  const today = day.data ? zoned(day.data.timeZone).isoDay(new Date().toISOString()) : date;
  const active = day.data?.prescriptions.filter((p) => !p.stopped) ?? [];

  return (
    <Section
      title="Prescrição médica"
      description="Horários do dia no fuso da unidade. Toque em um horário para registrar a execução."
    >
      {can('hospitalization.prescribe') ? (
        <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Ações da prescrição">
          {prescribe ? (
            <>
              <Button
                size="sm"
                icon={<Plus className="size-4" aria-hidden />}
                onClick={() => {
                  setOpen({ kind: 'new' });
                }}
              >
                Prescrever
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={<ClipboardList className="size-4" aria-hidden />}
                onClick={() => {
                  setOpen({ kind: 'apply' });
                }}
              >
                Usar modelo
              </Button>
            </>
          ) : null}
          {active.length ? (
            <Button
              size="sm"
              variant="secondary"
              icon={<Save className="size-4" aria-hidden />}
              onClick={() => {
                setOpen({ kind: 'save', prescriptions: active });
              }}
            >
              Salvar como modelo
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <DayNav date={date} today={today} onChange={setDate} />
        <p className="text-xs text-ink-muted">
          Peso para o cálculo:{' '}
          <span className="font-medium text-ink">
            {day.data?.weightKg == null ? 'sem pesagem' : formatKg(day.data.weightKg)}
          </span>
        </p>
      </div>
      {day.isPending ? (
        <SkeletonRows rows={3} columns={4} />
      ) : day.isError ? (
        <ErrorState message={errorMessage(day.error)} onRetry={() => void day.refetch()} />
      ) : day.data.prescriptions.length === 0 ? (
        <EmptyState
          icon={Pill}
          title="Nenhuma prescrição neste dia"
          description={
            prescribe
              ? 'Prescreva o medicamento com dose, via, intervalo e primeiro horário.'
              : 'As prescrições do veterinário aparecem aqui com os horários do dia.'
          }
        />
      ) : (
        <PrescriptionGrid
          date={date}
          timeZone={day.data.timeZone}
          weightKg={day.data.weightKg}
          prescriptions={day.data.prescriptions}
          canStop={prescribe}
          onStop={(p) => {
            setOpen({ kind: 'stop', p });
          }}
          onDose={(p, dose) => {
            setOpen({ kind: 'dose', p, dose });
          }}
        />
      )}
      {open?.kind === 'new' && day.data ? (
        <PrescribeDialog
          h={h}
          timeZone={day.data.timeZone}
          weightKg={day.data.weightKg}
          onClose={close}
        />
      ) : null}
      {open?.kind === 'apply' && day.data ? (
        <ApplyTemplateDialog
          h={h}
          timeZone={day.data.timeZone}
          weightKg={day.data.weightKg}
          onClose={close}
        />
      ) : null}
      {open?.kind === 'save' ? (
        <SaveTemplateDialog prescriptions={open.prescriptions} onClose={close} />
      ) : null}
      {open?.kind === 'stop' ? <StopDialog h={h} p={open.p} onClose={close} /> : null}
      {open?.kind === 'dose' && day.data ? (
        <DoseDialog
          h={h}
          p={open.p}
          dose={open.dose}
          timeZone={day.data.timeZone}
          weightKg={day.data.weightKg}
          canRecord={admitted && can('hospitalization.record')}
          onClose={close}
        />
      ) : null}
    </Section>
  );
}

function PrescriptionGrid({
  date,
  timeZone,
  weightKg,
  prescriptions,
  canStop,
  onStop,
  onDose,
}: {
  date: string;
  timeZone: string;
  weightKg: number | null;
  prescriptions: Prescription[];
  canStop: boolean;
  onStop: (p: Prescription) => void;
  onDose: (p: Prescription, dose: ScheduledDose) => void;
}) {
  const z = zoned(timeZone);
  const hourOf = (iso: string) => Number(isoToLocalInput(iso, timeZone).slice(11, 13));
  const scroller = useRef<HTMLDivElement>(null);
  const isToday = z.isoDay(new Date().toISOString()) === date;
  const firstDose = prescriptions.flatMap((p) => p.doses.map((d) => hourOf(d.scheduledAt)));
  useScrollToHour(
    scroller,
    isToday
      ? hourOf(new Date().toISOString()) - 1
      : firstDose.length
        ? Math.min(...firstDose)
        : null,
  );
  return (
    <div className="-mx-5 border-y border-line">
      <div ref={scroller} className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Prescrições de {formatLongDay(date)}</caption>
          <thead>
            <tr className="bg-sunken text-xs text-ink-muted">
              <th
                scope="col"
                data-sticky
                className="sticky left-0 z-10 min-w-40 bg-sunken px-3 py-2 text-left font-medium sm:min-w-64"
              >
                Medicamento
              </th>
              {hours.map((hour) => (
                <th
                  key={hour}
                  scope="col"
                  data-hour={hour}
                  className="min-w-14 px-1 py-2 text-center font-mono"
                >
                  {String(hour).padStart(2, '0')}h
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {prescriptions.map((p) => (
              <tr key={p.id} className={p.stopped ? 'bg-sunken/50' : undefined}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 max-w-40 min-w-40 bg-surface px-3 py-2 text-left align-top font-normal sm:max-w-64 sm:min-w-64"
                >
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-ink">{p.name}</span>
                    {p.stopped ? <Badge tone="neutral">Suspensa</Badge> : null}
                  </span>
                  <span className="block text-xs text-ink-muted">{posology(p)}</span>
                  <span className="block text-xs text-ink">
                    {doseText(p, weightKg)}
                    {p.notes ? <span className="text-ink-muted"> · {p.notes}</span> : null}
                  </span>
                  <span className="block text-xs text-ink-faint">
                    {p.stopped
                      ? `Suspensa por ${p.stopped.by} em ${shortDateTime(z, p.stopped.at)}: ${p.stopped.reason}`
                      : `${p.prescribedBy} · ${p.endsAt ? `até ${shortDateTime(z, p.endsAt)}` : 'até nova ordem'}`}
                  </span>
                  {canStop &&
                  !p.stopped &&
                  (p.endsAt === null || new Date(p.endsAt) > new Date()) ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="-ml-2 h-7"
                      onClick={() => {
                        onStop(p);
                      }}
                    >
                      Suspender
                    </Button>
                  ) : null}
                </th>
                {hours.map((hour) => {
                  const dose = p.doses.find((d) => hourOf(d.scheduledAt) === hour);
                  if (!dose) return <td key={hour} className="border-l border-line/60" />;
                  const state = doseState(dose);
                  const time = z.time(dose.scheduledAt);
                  return (
                    <td key={hour} className="border-l border-line/60 px-1 py-2 text-center">
                      <button
                        type="button"
                        aria-label={`${p.name} às ${time}: ${doseStateLabels[state]}`}
                        onClick={() => {
                          onDose(p, dose);
                        }}
                        className={clsx(
                          'w-full rounded-control border px-1 py-1 font-mono text-xs tabular-nums transition-colors hover:border-sage-500',
                          doseClasses[state],
                        )}
                      >
                        {time}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul
        className="flex flex-wrap gap-3 border-t border-line px-3 py-2 text-xs text-ink-muted"
        aria-label="Legenda"
      >
        {(Object.keys(doseStateLabels) as DoseState[]).map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <span className={clsx('size-3 rounded-sm border', doseClasses[s])} aria-hidden />
            {doseStateLabels[s]}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PrescribeDialog({
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
  const [form, setForm] = useState({
    name: '',
    dose: '',
    doseUnit: 'mg/kg' as DoseUnit,
    concentration: '',
    route: 'IV' as PrescriptionRoute,
    intervalHours: '8',
    firstAt: nextFullHour(timeZone),
    durationDays: '',
    notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = usePrescriptionMutation<unknown>(`/hospitalizations/${h.id}/prescriptions`);
  const set = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setErrors({});
  };
  const concentrationUnit = concentrationUnitOf(form.doseUnit);
  const dose = decimal(form.dose);
  const concentration = form.concentration.trim() ? decimal(form.concentration) : null;
  const preview =
    form.dose && Number.isFinite(dose) && dose > 0
      ? doseText(
          {
            dose,
            doseUnit: form.doseUnit,
            concentration:
              concentrationUnit && concentration !== null && Number.isFinite(concentration)
                ? concentration
                : null,
          },
          weightKg,
        )
      : null;

  const submit = () => {
    const found: Record<string, string> = {};
    if (form.name.trim().length < 2) found.name = 'Informe o medicamento';
    if (!form.dose || !Number.isFinite(dose) || dose <= 0) found.dose = 'Informe a dose';
    if (concentration !== null && !(Number.isFinite(concentration) && concentration > 0)) {
      found.concentration = 'Informe um número maior que zero';
    }
    const interval = Number(form.intervalHours);
    if (!Number.isInteger(interval) || interval < 1 || interval > 72) {
      found.intervalHours = 'De 1 a 72 horas';
    }
    if (!form.firstAt) found.firstAt = 'Informe o primeiro horário';
    const days = form.durationDays.trim() ? Number(form.durationDays) : null;
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 90)) {
      found.durationDays = 'De 1 a 90 dias, ou vazio para até nova ordem';
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    save.mutate(
      {
        name: form.name,
        dose,
        doseUnit: form.doseUnit,
        concentration: concentrationUnit ? concentration : null,
        route: form.route,
        intervalHours: interval,
        firstAt: localInputToIso(form.firstAt, timeZone),
        durationDays: days,
        notes: form.notes,
      },
      {
        onSuccess: () => {
          toast.success(`${form.name.trim()} prescrito.`);
          onClose();
        },
        onError: (e) => {
          setErrors(fieldErrorsOf(e));
        },
      },
    );
  };

  return (
    <FormDialog
      title="Nova prescrição"
      description={`${h.patient.name}, internação ${String(h.code)}.`}
      formId="prescription-form"
      submitLabel="Prescrever"
      pending={save.isPending}
      onClose={onClose}
      onSubmit={submit}
    >
      <Alert message={generalError(save.error)} />
      <TextField
        label="Medicamento"
        maxLength={120}
        value={form.name}
        error={errors.name}
        onChange={(e) => {
          set({ name: e.target.value });
        }}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Dose"
          inputMode="decimal"
          value={form.dose}
          error={errors.dose}
          onChange={(e) => {
            set({ dose: e.target.value });
          }}
        />
        <SelectField
          label="Unidade da dose"
          value={form.doseUnit}
          onChange={(e) => {
            const unit = doseUnits.find((u) => u === e.target.value) ?? 'mg/kg';
            set({ doseUnit: unit, ...(concentrationUnitOf(unit) ? {} : { concentration: '' }) });
          }}
          options={doseUnits.map((u) => ({ value: u, label: u }))}
        />
        {concentrationUnit ? (
          <TextField
            label={`Concentração (${concentrationUnit})`}
            hint="Opcional. Com ela, a enfermagem vê o volume a aplicar."
            inputMode="decimal"
            value={form.concentration}
            error={errors.concentration}
            onChange={(e) => {
              set({ concentration: e.target.value });
            }}
          />
        ) : null}
        <SelectField
          label="Via"
          value={form.route}
          onChange={(e) => {
            set({ route: prescriptionRoutes.find((r) => r === e.target.value) ?? 'IV' });
          }}
          options={prescriptionRoutes.map((r) => ({ value: r, label: routeLabels[r] }))}
        />
        <TextField
          label="Intervalo (horas)"
          type="number"
          min={1}
          max={72}
          value={form.intervalHours}
          error={errors.intervalHours}
          onChange={(e) => {
            set({ intervalHours: e.target.value });
          }}
        />
        <TextField
          label="Primeiro horário"
          type="datetime-local"
          value={form.firstAt}
          error={errors.firstAt}
          onChange={(e) => {
            set({ firstAt: e.target.value });
          }}
        />
        <TextField
          label="Duração (dias)"
          hint="Vazio: até nova ordem."
          type="number"
          min={1}
          max={90}
          value={form.durationDays}
          error={errors.durationDays}
          onChange={(e) => {
            set({ durationDays: e.target.value });
          }}
        />
      </div>
      {preview ? (
        <p className="rounded-control bg-sage-50 px-3 py-2 text-sm text-sage-700" role="status">
          Dose por horário{weightKg === null ? '' : ` para ${formatKg(weightKg)}`}: {preview}
        </p>
      ) : null}
      <TextareaField
        label="Orientações"
        rows={2}
        maxLength={500}
        value={form.notes}
        onChange={(e) => {
          set({ notes: e.target.value });
        }}
      />
    </FormDialog>
  );
}

function StopDialog({
  h,
  p,
  onClose,
}: {
  h: HospitalizationDetail;
  p: Prescription;
  onClose: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const stop = usePrescriptionMutation<{ reason: string }>(
    `/hospitalizations/${h.id}/prescriptions/${p.id}/stop`,
  );
  return (
    <FormDialog
      title={`Suspender ${p.name}`}
      description="Os horários a partir de agora deixam de valer. O que já foi executado fica registrado."
      formId="stop-prescription"
      submitLabel="Suspender"
      danger
      pending={stop.isPending}
      onClose={onClose}
      onSubmit={() => {
        if (reason.trim().length < 3) {
          setError('Explique o motivo em poucas palavras');
          return;
        }
        stop.mutate(
          { reason },
          {
            onSuccess: () => {
              toast.success(`${p.name} suspenso.`);
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
        label="Motivo da suspensão"
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

/** Horário da prescrição: registra a execução ou mostra o que foi registrado. */
function DoseDialog({
  h,
  p,
  dose,
  timeZone,
  weightKg,
  canRecord,
  onClose,
}: {
  h: HospitalizationDetail;
  p: Prescription;
  dose: ScheduledDose;
  timeZone: string;
  weightKg: number | null;
  canRecord: boolean;
  onClose: () => void;
}) {
  const z = zoned(timeZone);
  const toast = useToast();
  const now = isoToLocalInput(new Date().toISOString(), timeZone);
  const [status, setStatus] = useState<ExecutionStatus>('done');
  const [executedAt, setExecutedAt] = useState(now);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const execute = usePrescriptionMutation<unknown>(
    `/hospitalizations/${h.id}/prescriptions/${p.id}/executions`,
  );
  const title = `${p.name} às ${z.time(dose.scheduledAt)}`;
  const e = dose.execution;

  if (e || !canRecord) {
    const state = doseState(dose);
    const given =
      e?.amount == null
        ? null
        : `${number.format(e.amount)} ${calculateDose({ ...p, weightKg: 1 }).amountUnit}${
            e.volumeMl === null || p.doseUnit.startsWith('mL')
              ? ''
              : ` · ${number.format(e.volumeMl)} mL`
          }`;
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        title={title}
        description={`${posology(p)}.`}
        footer={
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
        }
      >
        <Facts
          items={[
            { label: 'Situação', value: doseStateLabels[state] },
            { label: 'Programado para', value: z.dateTime(dose.scheduledAt) },
            ...(e
              ? [
                  {
                    label: e.status === 'done' ? 'Executado em' : 'Registrado em',
                    value: z.dateTime(e.executedAt),
                  },
                  { label: 'Por', value: e.by },
                  { label: 'Dose aplicada', value: given },
                  {
                    label: 'Peso usado',
                    value: e.weightKg === null ? null : formatKg(e.weightKg),
                  },
                  {
                    label: e.status === 'done' ? 'Observações' : 'Motivo',
                    value: e.notes,
                  },
                ]
              : [{ label: 'Dose prevista', value: doseText(p, weightKg) }]),
          ]}
        />
      </Dialog>
    );
  }

  return (
    <FormDialog
      title={title}
      description={`${posology(p)}. Programado para ${z.dateTime(dose.scheduledAt)}.`}
      formId="execute-dose"
      submitLabel="Registrar"
      pending={execute.isPending}
      onClose={onClose}
      onSubmit={() => {
        const found: Record<string, string> = {};
        if (!executedAt) found.executedAt = 'Informe quando foi executado';
        if (status === 'skipped' && !notes.trim()) found.notes = 'Diga por que não foi executado';
        setErrors(found);
        if (Object.keys(found).length > 0) return;
        execute.mutate(
          {
            scheduledAt: dose.scheduledAt,
            executedAt: localInputToIso(executedAt, timeZone),
            status,
            notes,
          },
          {
            onSuccess: () => {
              toast.success(`${executionStatusLabels[status]}: ${p.name}.`);
              onClose();
            },
            onError: (err) => {
              setErrors(fieldErrorsOf(err));
            },
          },
        );
      }}
    >
      <Alert message={errors.scheduledAt ?? generalError(execute.error)} />
      <p className="rounded-control bg-sage-50 px-3 py-2 text-sm text-sage-700">
        Dose a aplicar{weightKg === null ? '' : ` (${formatKg(weightKg)})`}: {doseText(p, weightKg)}{' '}
        · {routeLabels[p.route]}
      </p>
      <Segmented
        label="Situação"
        value={status}
        options={[
          { value: 'done', label: executionStatusLabels.done },
          { value: 'skipped', label: executionStatusLabels.skipped },
        ]}
        onChange={(v) => {
          setStatus(v);
          setErrors({});
        }}
      />
      <TextField
        label={status === 'done' ? 'Executado em' : 'Registrado em'}
        type="datetime-local"
        max={now}
        value={executedAt}
        error={errors.executedAt}
        onChange={(ev) => {
          setExecutedAt(ev.target.value);
        }}
      />
      <TextareaField
        label={status === 'done' ? 'Observações' : 'Motivo'}
        rows={2}
        maxLength={500}
        value={notes}
        error={errors.notes}
        onChange={(ev) => {
          setNotes(ev.target.value);
          setErrors({});
        }}
      />
    </FormDialog>
  );
}
