import {
  scheduleConfigSchema,
  type ScheduleConfig,
  type ScheduleMode,
  type WeekdayRange,
} from '@clinica/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CalendarClock, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button, buttonClasses } from '../../design-system/button';
import { Dialog } from '../../design-system/dialog';
import { Segmented, SelectField } from '../../design-system/field';
import { Badge, PageHeader, Section } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { useToast } from '../../design-system/toast';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { scheduleConfigQuery } from './queries';
import { errorsByWeekday, summarizeWeek, WeekHours } from './week-hours';

const modeLabels: Record<ScheduleMode, string> = {
  fixed: 'Horário fixo',
  variable: 'Escala variável',
};

/** Configuração da agenda [p.8]: funcionamento por dia e quem atende, com fixo ou escala. */
export function ScheduleConfigPage() {
  const config = useQuery(scheduleConfigQuery);
  return (
    <>
      <PageHeader
        area="Agenda"
        title="Configuração da agenda"
        description="O horário de funcionamento recorta a escala de cada profissional. Os horários livres oferecidos no agendamento saem do cruzamento dos dois."
        actions={
          <Link to="/agenda/escala" className={buttonClasses('secondary')}>
            <CalendarClock className="size-4" aria-hidden />
            Escala
          </Link>
        }
      />
      {config.isPending ? (
        <SkeletonRows rows={7} columns={2} />
      ) : config.isError ? (
        <ErrorState message={errorMessage(config.error)} onRetry={() => void config.refetch()} />
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          <OpeningHours key={JSON.stringify(config.data.openingHours)} config={config.data} />
          <Members config={config.data} />
        </div>
      )}
    </>
  );
}

function useSaveConfig() {
  const queryClient = useQueryClient();
  return (data: ScheduleConfig) => {
    queryClient.setQueryData(scheduleConfigQuery.queryKey, data);
    return queryClient.invalidateQueries({ queryKey: ['schedule', 'agenda'] });
  };
}

function OpeningHours({ config }: { config: ScheduleConfig }) {
  const toast = useToast();
  const saved = useSaveConfig();
  const [days, setDays] = useState<WeekdayRange[]>(config.openingHours);
  const save = useMutation({
    mutationFn: () => api('PUT', '/schedule/opening-hours', scheduleConfigSchema, { days }),
    onSuccess: async (data) => {
      await saved(data);
      toast.success('Horário de funcionamento salvo.');
    },
  });
  const errors =
    save.error instanceof ApiRequestError ? errorsByWeekday(save.error.fieldErrors, days) : {};
  return (
    <Section
      title="Horário de funcionamento"
      description={`Fuso da unidade: ${config.timeZone.replace('_', ' ')}. Dia desmarcado = clínica fechada.`}
    >
      {save.isError && Object.keys(errors).length === 0 ? (
        <p
          role="alert"
          className="mb-3 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600"
        >
          {errorMessage(save.error)}
        </p>
      ) : null}
      <WeekHours
        value={days}
        onChange={setDays}
        defaultRange={{ start: '08:00', end: '18:00' }}
        errors={errors}
      />
      <div className="mt-4 flex justify-end">
        <Button
          pending={save.isPending}
          onClick={() => {
            save.mutate();
          }}
        >
          Salvar funcionamento
        </Button>
      </div>
    </Section>
  );
}

function Members({ config }: { config: ScheduleConfig }) {
  const toast = useToast();
  const saved = useSaveConfig();
  const [editing, setEditing] = useState<ScheduleConfig['members'][number] | null | undefined>(
    undefined,
  );
  const remove = useMutation({
    mutationFn: (userId: string) =>
      api('DELETE', `/schedule/members/${userId}`, scheduleConfigSchema),
    onSuccess: async (data) => {
      await saved(data);
      toast.success('Profissional retirado da agenda.');
    },
  });

  return (
    <Section
      title="Profissionais com agenda"
      description="Horário fixo vale toda semana. Escala variável segue os turnos lançados e confirmados na Escala."
      actions={
        <Button
          variant="ghost"
          size="sm"
          icon={<Plus className="size-4" aria-hidden />}
          disabled={config.candidates.length === 0}
          title={
            config.candidates.length === 0
              ? 'Todos os usuários da unidade já têm agenda'
              : undefined
          }
          onClick={() => {
            setEditing(null);
          }}
        >
          Adicionar
        </Button>
      }
    >
      {remove.isError ? (
        <p
          role="alert"
          className="mb-3 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600"
        >
          {errorMessage(remove.error)}
        </p>
      ) : null}
      {config.members.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="Ninguém com agenda ainda"
          description="Adicione os veterinários, esteticistas e demais profissionais que recebem agendamentos."
        />
      ) : (
        <ul className="-mx-2 divide-y divide-line">
          {config.members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{m.name}</p>
                <p className="text-xs text-ink-muted">
                  {m.mode === 'fixed'
                    ? summarizeWeek(m.fixedHours)
                    : 'Disponibilidade vem da Escala'}
                </p>
              </div>
              <Badge tone={m.mode === 'fixed' ? 'sage' : 'amber'}>{modeLabels[m.mode]}</Badge>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Editar ${m.name}`}
                  onClick={() => {
                    setEditing(m);
                  }}
                >
                  Editar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Retirar ${m.name} da agenda`}
                  pending={remove.isPending && remove.variables === m.userId}
                  onClick={() => {
                    remove.mutate(m.userId);
                  }}
                >
                  Retirar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing !== undefined ? (
        <MemberDialog
          config={config}
          member={editing}
          onClose={() => {
            setEditing(undefined);
          }}
        />
      ) : null}
    </Section>
  );
}

function MemberDialog({
  config,
  member,
  onClose,
}: {
  config: ScheduleConfig;
  member: ScheduleConfig['members'][number] | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const saved = useSaveConfig();
  const [userId, setUserId] = useState(member?.userId ?? config.candidates[0]?.id ?? '');
  const [mode, setMode] = useState<ScheduleMode>(member?.mode ?? 'fixed');
  const [hours, setHours] = useState<WeekdayRange[]>(
    member?.fixedHours.length
      ? member.fixedHours
      : [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '09:00', end: '18:00' })),
  );
  const save = useMutation({
    mutationFn: () =>
      api('PUT', `/schedule/members/${userId}`, scheduleConfigSchema, {
        mode,
        fixedHours: mode === 'fixed' ? hours : [],
      }),
    onSuccess: async (data) => {
      await saved(data);
      toast.success(
        member ? 'Agenda do profissional atualizada.' : 'Profissional incluído na agenda.',
      );
      onClose();
    },
  });
  const fieldErrors = save.error instanceof ApiRequestError ? save.error.fieldErrors : [];
  const dayErrors = errorsByWeekday(
    fieldErrors.filter((f) => f.path.startsWith('fixedHours.')),
    hours,
  );
  const general = fieldErrors.find((f) => !f.path.startsWith('fixedHours.'))?.message;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={member ? `Agenda de ${member.name}` : 'Adicionar profissional à agenda'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            pending={save.isPending}
            disabled={!userId}
            onClick={() => {
              save.mutate();
            }}
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.isError && Object.keys(dayErrors).length === 0 ? (
          <p
            role="alert"
            className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600"
          >
            {general ?? errorMessage(save.error)}
          </p>
        ) : null}
        {member ? null : (
          <SelectField
            label="Usuário"
            value={userId}
            options={config.candidates.map((c) => ({ value: c.id, label: c.name }))}
            onChange={(e) => {
              setUserId(e.target.value);
            }}
          />
        )}
        <Segmented
          label="Disponibilidade"
          value={mode}
          options={[
            { value: 'fixed', label: modeLabels.fixed },
            { value: 'variable', label: modeLabels.variable },
          ]}
          onChange={setMode}
        />
        {mode === 'fixed' ? (
          <WeekHours
            value={hours}
            onChange={setHours}
            defaultRange={{ start: '09:00', end: '18:00' }}
            errors={dayErrors}
          />
        ) : (
          <p className="rounded-control bg-sunken px-3 py-2 text-sm text-ink-muted">
            Lance os turnos deste profissional na Escala e confirme o mês para abrir os horários.
          </p>
        )}
      </div>
    </Dialog>
  );
}
