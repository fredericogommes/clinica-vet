import { appointmentSchema, type Appointment, type AppointmentStatus } from '@clinica/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Phone, Repeat, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../design-system/button';
import { Dialog } from '../../design-system/dialog';
import { TextField } from '../../design-system/field';
import { Badge, Facts } from '../../design-system/layout';
import { useToast } from '../../design-system/toast';
import { api, errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useCan } from '../../lib/session';
import { formatPhone } from '../clients/format';
import { formatBrDate } from './dates';
import { actionLabels, isClosed, statusLabel, statusTone } from './status';

const milestoneLabels: [keyof Appointment['milestones'], string][] = [
  ['confirmedAt', 'Confirmado'],
  ['arrivedAt', 'Chegada'],
  ['startedAt', 'Início do atendimento'],
  ['readyAt', 'Animal pronto'],
  ['cancelledAt', 'Encerrado'],
];

/** Detalhe do agendamento com as ações do ciclo de status [RN-13]. */
export function AppointmentDialog({
  appointment,
  onClose,
  onReschedule,
}: {
  appointment: Appointment;
  onClose: () => void;
  /** Ausente quando o diálogo é aberto fora da agenda (ex. ficha clínica). */
  onReschedule?: (appointment: Appointment) => void;
}) {
  const can = useCan();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState(appointment);
  const [closing, setClosing] = useState<'cancelled' | 'no_show' | null>(null);
  const [reason, setReason] = useState('');
  const manage = can('schedule.manage');

  const move = useMutation({
    mutationFn: (status: AppointmentStatus) =>
      api('POST', `/appointments/${current.id}/status`, appointmentSchema, {
        status,
        reason: status === 'cancelled' || status === 'no_show' ? reason : null,
      }),
    onSuccess: async (saved) => {
      setCurrent(saved);
      setClosing(null);
      setReason('');
      toast.success(`${statusLabel(saved)}: ${saved.patients.map((p) => p.name).join(', ')}.`);
      await queryClient.invalidateQueries({ queryKey: ['schedule'] });
      await queryClient.invalidateQueries({ queryKey: ['clinical', 'record'] });
    },
  });

  const markings = current.patients.flatMap((p) => p.markings.map((m) => `${p.name}: ${m}`));
  const forward = current.nextStatuses.filter((s) => s !== 'cancelled' && s !== 'no_show');
  const closers = current.nextStatuses.filter(
    (s): s is 'cancelled' | 'no_show' => s === 'cancelled' || s === 'no_show',
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`${current.client.name} – ${current.patients.map((p) => p.name).join(', ')}`}
      description={`${formatBrDate(current.date)}, ${current.start} às ${current.end} · ${current.professional.name}`}
      footer={
        closing ? (
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setClosing(null);
              }}
            >
              Voltar
            </Button>
            <Button
              variant="danger"
              pending={move.isPending}
              onClick={() => {
                move.mutate(closing);
              }}
            >
              {closing === 'cancelled' ? 'Confirmar cancelamento' : 'Registrar falta'}
            </Button>
          </>
        ) : (
          <>
            {manage && current.editable && onReschedule ? (
              <Button
                variant="secondary"
                onClick={() => {
                  onReschedule(current);
                }}
              >
                Remarcar ou editar
              </Button>
            ) : null}
            {manage
              ? forward.map((s) => (
                  <Button
                    key={s}
                    pending={move.isPending && move.variables === s}
                    disabled={move.isPending}
                    onClick={() => {
                      move.mutate(s);
                    }}
                  >
                    {actionLabels[s]}
                  </Button>
                ))
              : null}
            {!manage || forward.length === 0 ? (
              <Button variant="secondary" onClick={onClose}>
                Fechar
              </Button>
            ) : null}
          </>
        )
      }
    >
      <div className="space-y-4">
        {move.isError ? (
          <p
            role="alert"
            className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600"
          >
            {errorMessage(move.error)}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={statusTone(current)}>{statusLabel(current)}</Badge>
          {current.fitIn ? <Badge tone="amber">Encaixe</Badge> : null}
          {current.bookedOnline ? <Badge tone="sage">Pelo portal</Badge> : null}
          {current.seriesId ? (
            <Badge>
              <Repeat className="mr-1 size-3" aria-hidden />
              Recorrente
            </Badge>
          ) : null}
        </div>
        {markings.length > 0 ? (
          <ul className="space-y-1 rounded-control bg-amber-50 px-3 py-2 text-sm text-amber-700">
            {markings.map((m) => (
              <li key={m} className="flex items-center gap-1.5">
                <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
                {m}
              </li>
            ))}
          </ul>
        ) : null}
        <Facts
          items={[
            ...(can('clinical.view')
              ? [
                  {
                    label: current.patients.length > 1 ? 'Fichas clínicas' : 'Ficha clínica',
                    value: (
                      <span className="flex flex-wrap gap-x-3">
                        {current.patients.map((p) => (
                          <Link
                            key={p.id}
                            to="/atendimento/$patientId"
                            params={{ patientId: p.id }}
                            className="text-sage-700 hover:underline"
                          >
                            {p.name}
                          </Link>
                        ))}
                      </span>
                    ),
                  },
                ]
              : []),
            { label: 'Tipo de atendimento', value: current.type.name },
            { label: 'Duração', value: `${current.durationMinutes} min` },
            {
              label: 'Responsável',
              value: can('clients.view') ? (
                <Link
                  to="/clientes/$clientId"
                  params={{ clientId: current.client.id }}
                  className="text-sage-700 hover:underline"
                >
                  {current.client.name}
                </Link>
              ) : (
                current.client.name
              ),
            },
            {
              label: 'Telefone',
              value: current.client.phone ? (
                <a
                  href={`tel:${current.client.phone}`}
                  className="inline-flex items-center gap-1 hover:underline"
                >
                  <Phone className="size-3.5" aria-hidden />
                  {formatPhone(current.client.phone)}
                </a>
              ) : null,
            },
            { label: 'Observações', value: current.notes },
            ...(current.cancelReason
              ? [{ label: 'Motivo do encerramento', value: current.cancelReason }]
              : []),
          ]}
        />
        {milestoneLabels.some(([key]) => current.milestones[key]) ? (
          <div>
            <p className="text-xs text-ink-muted">Marcos</p>
            <ol className="mt-1 space-y-0.5 text-sm">
              {milestoneLabels
                .filter(([key]) => current.milestones[key])
                .map(([key, label]) => (
                  <li key={key} className="flex justify-between gap-4">
                    <span>{label}</span>
                    <span className="font-mono text-xs text-ink-muted">
                      {formatDateTime(current.milestones[key] ?? '')}
                    </span>
                  </li>
                ))}
            </ol>
          </div>
        ) : null}
        {manage && closing ? (
          <TextField
            label={closing === 'cancelled' ? 'Motivo do cancelamento' : 'Observação da falta'}
            placeholder="Opcional"
            maxLength={200}
            autoFocus
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
          />
        ) : null}
        {manage && !closing && closers.length > 0 ? (
          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            {closers.map((s) => (
              <Button
                key={s}
                variant="ghost"
                size="sm"
                onClick={() => {
                  setClosing(s);
                }}
              >
                {actionLabels[s]}
              </Button>
            ))}
          </div>
        ) : null}
        {isClosed(current.status) && manage ? (
          <p className="text-xs text-ink-muted">
            Reativar devolve o agendamento ao horário original, se ele ainda estiver livre.
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
