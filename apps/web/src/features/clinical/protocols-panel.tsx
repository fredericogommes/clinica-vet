import {
  closeProtocolSchema,
  protocolSchema,
  protocolStatusLabels,
  vaccineKindLabels,
  type Protocol,
  type ProtocolStatus,
} from '@clinica/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Syringe } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { Button } from '../../design-system/button';
import { Dialog } from '../../design-system/dialog';
import { TextareaField } from '../../design-system/field';
import { Badge } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { useToast } from '../../design-system/toast';
import { api, errorMessage } from '../../lib/api';
import { formatBrDate } from '../schedule/dates';
import { zoned } from './labels';
import { protocolsQuery } from './queries';

const statusTones: Record<ProtocolStatus, 'neutral' | 'sage' | 'amber' | 'danger'> = {
  scheduled: 'sage',
  due_soon: 'amber',
  overdue: 'danger',
  no_next: 'neutral',
  closed: 'neutral',
};

/** Protocolos vacinais do animal [p.5]: periodicidade, próxima data e situação. */
export function ProtocolsPanel({
  patientId,
  patientName,
  timeZone,
  writable,
  onApply,
}: {
  patientId: string;
  patientName: string;
  timeZone: string;
  writable: boolean;
  onApply: (vaccineId: string) => void;
}) {
  const protocols = useQuery(protocolsQuery(patientId));
  const [closing, setClosing] = useState<Protocol | null>(null);
  const z = zoned(timeZone);

  if (protocols.isPending) return <SkeletonRows rows={3} columns={2} />;
  if (protocols.isError) {
    return (
      <ErrorState
        message={errorMessage(protocols.error)}
        onRetry={() => void protocols.refetch()}
      />
    );
  }
  if (protocols.data.length === 0) {
    return (
      <EmptyState
        icon={Syringe}
        title="Nenhum protocolo"
        description={`Cada vacina aplicada em ${patientName} abre um protocolo com a próxima dose.`}
      />
    );
  }
  return (
    <>
      <ul className="divide-y divide-line">
        {protocols.data.map((p) => (
          <li key={p.vaccine.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {p.vaccine.name}
                <Badge tone={statusTones[p.status]}>{protocolStatusLabels[p.status]}</Badge>
              </p>
              <p className="text-xs text-ink-muted">
                {vaccineKindLabels[p.vaccine.kind]} · {p.vaccine.periodicity}
              </p>
              <p className="mt-1 text-sm">
                {p.nextDueOn ? (
                  <>
                    Próxima: <span className="font-mono">{formatBrDate(p.nextDueOn)}</span>
                  </>
                ) : (
                  <span className="text-ink-muted">Sem próxima dose</span>
                )}
                <span className="text-ink-muted">
                  {' '}
                  · última: {p.lastDose.toLowerCase()} em {z.dateTime(p.lastAppliedAt).slice(0, 10)}
                  {p.doses > 1 ? ` · ${String(p.doses)} aplicações` : ''}
                </span>
              </p>
              {p.closure ? (
                <p className="mt-1 text-xs text-ink-muted">
                  Encerrado por {p.closure.by} em {z.dateTime(p.closure.at).slice(0, 10)}:{' '}
                  {p.closure.reason}
                </p>
              ) : null}
            </div>
            {writable ? (
              <div className="flex gap-1">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    onApply(p.vaccine.id);
                  }}
                >
                  Aplicar
                </Button>
                {p.closure ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Encerrar protocolo de ${p.vaccine.name}`}
                    onClick={() => {
                      setClosing(p);
                    }}
                  >
                    Encerrar
                  </Button>
                )}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {closing ? (
        <CloseDialog
          patientId={patientId}
          protocol={closing}
          onClose={() => {
            setClosing(null);
          }}
        />
      ) : null}
    </>
  );
}

function CloseDialog({
  patientId,
  protocol,
  onClose,
}: {
  patientId: string;
  protocol: Protocol;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () =>
      api(
        'POST',
        `/clinical/patients/${patientId}/protocols/${protocol.vaccine.id}/close`,
        z.array(protocolSchema),
        { reason },
      ),
    onSuccess: (protocols) => {
      queryClient.setQueryData(protocolsQuery(patientId).queryKey, protocols);
      toast.success('Protocolo encerrado. Uma nova aplicação o reabre.');
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Encerrar ${protocol.vaccine.name}?`}
      description="O animal sai da consulta Vacinação para esta vacina. As aplicações continuam na ficha."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button
            variant="danger"
            pending={mutation.isPending}
            onClick={() => {
              const parsed = closeProtocolSchema.safeParse({ reason });
              setError(parsed.success ? null : (parsed.error.issues[0]?.message ?? null));
              if (parsed.success) mutation.mutate();
            }}
          >
            Encerrar protocolo
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {mutation.isError ? (
          <p
            role="alert"
            className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600"
          >
            {errorMessage(mutation.error)}
          </p>
        ) : null}
        <TextareaField
          label="Motivo"
          hint="Ex.: aplicada em outra clínica, tutor mudou de cidade."
          maxLength={300}
          autoFocus
          value={reason}
          error={error ?? undefined}
          onChange={(e) => {
            setReason(e.target.value);
          }}
        />
      </div>
    </Dialog>
  );
}
