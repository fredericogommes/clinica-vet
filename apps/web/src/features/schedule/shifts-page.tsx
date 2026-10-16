import { confirmShiftsResultSchema, shiftSchema, type Shift } from '@clinica/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { clsx } from 'clsx';
import {
  CalendarCheck,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../design-system/button';
import { Dialog } from '../../design-system/dialog';
import { SelectField, TextField } from '../../design-system/field';
import { Badge, PageHeader, Panel } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { useToast } from '../../design-system/toast';
import { api, apiVoid, ApiRequestError, errorMessage } from '../../lib/api';
import { useCan } from '../../lib/session';
import {
  addMonths,
  daysBetween,
  endOfMonth,
  formatMonth,
  formatShortDay,
  localToday,
  weekdayOf,
  weekdayShort,
} from './dates';
import { scheduleConfigQuery, shiftsQuery } from './queries';

/** Escala [p.8]: turnos dia a dia dos profissionais com escala variável. */
export function ShiftsPage({ month }: { month: string | undefined }) {
  const can = useCan();
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: '/agenda/escala' });
  const current = month ?? localToday().slice(0, 7);
  const first = `${current}-01`;
  const shifts = useQuery(shiftsQuery(current));
  const config = useQuery(scheduleConfigQuery);
  const [adding, setAdding] = useState<string | null>(null);
  const configure = can('schedule.configure');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['schedule'] });
  const remove = useMutation({
    mutationFn: (id: string) => apiVoid('DELETE', `/schedule/shifts/${id}`),
    onSuccess: async () => {
      await invalidate();
      toast.success('Turno removido.');
    },
  });
  const confirm = useMutation({
    mutationFn: () =>
      api('POST', '/schedule/shifts/confirm', confirmShiftsResultSchema, { month: current }),
    onSuccess: async ({ confirmed }) => {
      await invalidate();
      toast.success(confirmed === 1 ? '1 turno confirmado.' : `${confirmed} turnos confirmados.`);
    },
  });

  const variable = (config.data?.members ?? []).filter((m) => m.mode === 'variable');
  const drafts = (shifts.data ?? []).filter((s) => !s.confirmed).length;
  const goMonth = (delta: number) => {
    void navigate({ search: { mes: addMonths(first, delta).slice(0, 7) } });
  };

  return (
    <>
      <PageHeader
        area="Agenda"
        title="Escala"
        description="Turnos dos profissionais com escala variável. Turno em rascunho não abre horários; confirme o mês para publicá-los na agenda."
        actions={
          configure ? (
            <>
              <Button
                variant="secondary"
                icon={<CalendarCheck className="size-4" aria-hidden />}
                disabled={drafts === 0}
                pending={confirm.isPending}
                onClick={() => {
                  confirm.mutate();
                }}
              >
                Confirmar o mês inteiro
              </Button>
              <Button
                icon={<Plus className="size-4" aria-hidden />}
                disabled={variable.length === 0}
                onClick={() => {
                  setAdding(first);
                }}
              >
                Adicionar turno
              </Button>
            </>
          ) : undefined
        }
      />
      <Panel>
        <div className="flex items-center justify-between gap-3 border-b border-line p-4">
          <div className="flex items-center gap-1">
            <Button
              variant="secondary"
              size="sm"
              aria-label="Mês anterior"
              onClick={() => {
                goMonth(-1);
              }}
            >
              <ChevronLeft className="size-4" aria-hidden />
            </Button>
            <Button
              variant="secondary"
              size="sm"
              aria-label="Próximo mês"
              onClick={() => {
                goMonth(1);
              }}
            >
              <ChevronRight className="size-4" aria-hidden />
            </Button>
            <h2 className="ml-2 font-display text-base font-semibold">{formatMonth(first)}</h2>
          </div>
          {drafts > 0 ? (
            <Badge tone="amber">{drafts === 1 ? '1 em rascunho' : `${drafts} em rascunho`}</Badge>
          ) : null}
        </div>
        {confirm.isError || remove.isError ? (
          <p
            role="alert"
            className="m-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600"
          >
            {errorMessage(confirm.error ?? remove.error)}
          </p>
        ) : null}
        {shifts.isPending || config.isPending ? (
          <SkeletonRows rows={6} columns={3} />
        ) : shifts.isError ? (
          <ErrorState message={errorMessage(shifts.error)} onRetry={() => void shifts.refetch()} />
        ) : variable.length === 0 && shifts.data.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="Nenhum profissional com escala variável"
            description="Na configuração da agenda, marque como escala variável quem trabalha em plantões ou dias alternados."
          />
        ) : (
          <MonthList
            days={daysBetween(first, endOfMonth(first))}
            shifts={shifts.data}
            configure={configure}
            removing={remove.isPending ? remove.variables : undefined}
            onAdd={(day) => {
              setAdding(day);
            }}
            onRemove={(id) => {
              remove.mutate(id);
            }}
          />
        )}
      </Panel>
      {adding ? (
        <ShiftDialog
          date={adding}
          professionals={variable.map((m) => ({ id: m.userId, name: m.name }))}
          onClose={() => {
            setAdding(null);
          }}
        />
      ) : null}
    </>
  );
}

function MonthList({
  days,
  shifts,
  configure,
  removing,
  onAdd,
  onRemove,
}: {
  days: string[];
  shifts: Shift[];
  configure: boolean;
  removing: string | undefined;
  onAdd: (day: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <ul className="divide-y divide-line">
      {days.map((day) => {
        const items = shifts.filter((s) => s.date === day);
        const weekend = weekdayOf(day) === 0;
        return (
          <li
            key={day}
            className={clsx('flex gap-3 px-4 py-2', weekend && 'bg-canvas')}
            aria-label={`${formatShortDay(day)}: ${items.length} turnos`}
          >
            <div className="w-16 shrink-0 pt-1">
              <span className="block font-mono text-sm">{formatShortDay(day)}</span>
              <span className="text-xs text-ink-muted">{weekdayShort[weekdayOf(day)]}</span>
            </div>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {items.length === 0 ? (
                <span className="text-sm text-ink-faint">Sem turnos</span>
              ) : null}
              {items.map((s) => (
                <span
                  key={s.id}
                  className={clsx(
                    'inline-flex items-center gap-1.5 rounded-control border px-2 py-1 text-sm',
                    s.confirmed
                      ? 'border-sage-500 bg-sage-50'
                      : 'border-dashed border-amber-500 bg-amber-50',
                  )}
                >
                  <span className="font-medium">{s.userName}</span>
                  <span className="font-mono text-xs text-ink-muted">
                    {s.start}–{s.end}
                  </span>
                  {s.confirmed ? null : <span className="text-xs text-amber-700">rascunho</span>}
                  {configure ? (
                    <button
                      type="button"
                      aria-label={`Remover turno de ${s.userName} em ${formatShortDay(day)}`}
                      disabled={removing === s.id}
                      onClick={() => {
                        onRemove(s.id);
                      }}
                      className="rounded p-0.5 text-ink-faint hover:bg-surface hover:text-danger-600"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  ) : null}
                </span>
              ))}
            </div>
            {configure ? (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Adicionar turno em ${formatShortDay(day)}`}
                onClick={() => {
                  onAdd(day);
                }}
              >
                <Plus className="size-4" aria-hidden />
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function ShiftDialog({
  date: initialDate,
  professionals,
  onClose,
}: {
  date: string;
  professionals: { id: string; name: string }[];
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState(professionals[0]?.id ?? '');
  const [date, setDate] = useState(initialDate);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('21:00');
  const save = useMutation({
    mutationFn: () => api('POST', '/schedule/shifts', shiftSchema, { userId, date, start, end }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['schedule'] });
      toast.success('Turno incluído em rascunho.');
      onClose();
    },
  });
  const fieldError = (name: string) =>
    save.error instanceof ApiRequestError
      ? save.error.fieldErrors.find((f) => f.path === name)?.message
      : undefined;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Adicionar turno"
      description="O turno entra como rascunho e só abre horários depois de confirmado."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            pending={save.isPending}
            onClick={() => {
              save.mutate();
            }}
          >
            Salvar turno
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.isError &&
        !(save.error instanceof ApiRequestError && save.error.fieldErrors.length) ? (
          <p
            role="alert"
            className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600"
          >
            {errorMessage(save.error)}
          </p>
        ) : null}
        <SelectField
          label="Profissional"
          value={userId}
          options={professionals.map((p) => ({ value: p.id, label: p.name }))}
          error={fieldError('userId')}
          onChange={(e) => {
            setUserId(e.target.value);
          }}
        />
        <TextField
          label="Data"
          type="date"
          value={date}
          error={fieldError('date')}
          onChange={(e) => {
            setDate(e.target.value);
          }}
        />
        <div className="grid grid-cols-2 gap-4">
          <TextField
            label="Início"
            type="time"
            step={900}
            value={start}
            error={fieldError('start')}
            onChange={(e) => {
              setStart(e.target.value);
            }}
          />
          <TextField
            label="Fim"
            type="time"
            step={900}
            value={end}
            error={fieldError('end')}
            onChange={(e) => {
              setEnd(e.target.value);
            }}
          />
        </div>
      </div>
    </Dialog>
  );
}
