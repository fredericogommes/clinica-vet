import { formatAge, patientSchema } from '@clinica/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  Archive,
  History,
  ArchiveRestore,
  ArrowRightLeft,
  Pencil,
  Stethoscope,
  TriangleAlert,
} from 'lucide-react';
import { useState } from 'react';
import { Button, buttonClasses } from '../../design-system/button';
import { Dialog } from '../../design-system/dialog';
import { Badge, Facts, PageHeader, Section } from '../../design-system/layout';
import { ErrorState, SkeletonRows } from '../../design-system/states';
import { useToast } from '../../design-system/toast';
import { api, errorMessage } from '../../lib/api';
import { formatDay } from '../../lib/format';
import { useCan } from '../../lib/session';
import { formatDate, formatPhone } from '../clients/format';
import { patientSexLabels, sterilizedLabel } from './labels';
import { patientQuery } from './queries';
import { DeleteRecordButton } from '../shared/delete-record';
import { TransferDialog } from './transfer-dialog';

export function PatientPage({ patientId }: { patientId: string }) {
  const can = useCan();
  const patient = useQuery(patientQuery(patientId));
  const queryClient = useQueryClient();
  const toast = useToast();
  const [transferOpen, setTransferOpen] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const navigate = useNavigate();

  const archive = useMutation({
    mutationFn: (archived: boolean) =>
      api('POST', `/patients/${patientId}/${archived ? 'archive' : 'restore'}`, patientSchema),
    onSuccess: async (saved) => {
      queryClient.setQueryData(patientQuery(patientId).queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: ['patients', 'list'] });
      await queryClient.invalidateQueries({ queryKey: ['clients'] });
      toast.success(saved.archived ? 'Ficha arquivada.' : 'Ficha restaurada.');
      setConfirmArchive(false);
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });

  if (patient.isPending) return <SkeletonRows />;
  if (patient.isError) {
    return (
      <ErrorState message={errorMessage(patient.error)} onRetry={() => void patient.refetch()} />
    );
  }
  const p = patient.data;
  const summary = [
    p.speciesName,
    p.breedName,
    p.sex === 'unknown' ? null : patientSexLabels[p.sex],
    p.birthDate && p.status === 'alive' ? formatAge(p.birthDate) : null,
  ].filter(Boolean);
  const editable = !p.archived;

  return (
    <>
      <PageHeader
        area={`Animal #${p.code}`}
        title={p.name}
        {...(summary.length ? { description: summary.join(' · ') } : {})}
        actions={
          <>
            {p.status === 'deceased' ? <Badge>Óbito</Badge> : null}
            {p.archived ? <Badge tone="amber">Arquivado</Badge> : null}
            {can('clinical.view') ? (
              <Link
                to="/atendimento/$patientId"
                params={{ patientId }}
                className={buttonClasses('primary')}
              >
                <Stethoscope className="size-4" aria-hidden />
                Ficha clínica
              </Link>
            ) : null}
            {can('patients.manage') && editable ? (
              <Link
                to="/animais/$patientId/editar"
                params={{ patientId }}
                className={buttonClasses('secondary')}
              >
                <Pencil className="size-4" aria-hidden />
                Editar
              </Link>
            ) : null}
            {can('patients.transfer_owner') && editable ? (
              <Button
                variant="secondary"
                icon={<ArrowRightLeft className="size-4" aria-hidden />}
                onClick={() => {
                  setTransferOpen(true);
                }}
              >
                Trocar responsável
              </Button>
            ) : null}
            {can('admin.audit.view') ? (
              <Link
                to="/consultas/auditoria"
                search={{ entidade: 'patient', id: patientId, nome: p.name }}
                className={buttonClasses('ghost')}
              >
                <History className="size-4" aria-hidden />
                Histórico
              </Link>
            ) : null}
            {can('patients.archive') ? (
              p.archived ? (
                <Button
                  variant="secondary"
                  icon={<ArchiveRestore className="size-4" aria-hidden />}
                  pending={archive.isPending}
                  onClick={() => {
                    archive.mutate(false);
                  }}
                >
                  Restaurar
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  icon={<Archive className="size-4" aria-hidden />}
                  onClick={() => {
                    setConfirmArchive(true);
                  }}
                >
                  Arquivar
                </Button>
              )
            ) : null}
            {can('patients.delete') ? (
              <DeleteRecordButton
                name={p.name}
                path={`/patients/${patientId}`}
                description="Para cadastros feitos por engano. Animal com prontuário ou agendamento não é excluído: arquive a ficha."
                onDeleted={async () => {
                  queryClient.removeQueries({ queryKey: patientQuery(patientId).queryKey });
                  await queryClient.invalidateQueries({ queryKey: ['patients', 'list'] });
                  await queryClient.invalidateQueries({ queryKey: ['clients'] });
                  toast.success('Animal excluído.');
                  await navigate({ to: '/clientes/$clientId', params: { clientId: p.owner.id } });
                }}
              />
            ) : null}
          </>
        }
      />

      {p.markings.length > 0 ? (
        <div
          role="note"
          aria-label="Marcações do animal"
          className="mb-5 flex flex-wrap items-center gap-2 rounded-panel border border-amber-500/40 border-l-4 border-l-amber-500 bg-amber-50 px-4 py-3"
        >
          <TriangleAlert className="size-4 text-amber-700" aria-hidden />
          {p.markings.map((m) => (
            <span
              key={m}
              className="rounded-full border border-amber-500/40 bg-surface px-2.5 py-0.5 text-sm font-semibold text-amber-700"
            >
              {m}
            </span>
          ))}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <Section title="Dados do animal">
          <Facts
            items={[
              { label: 'Espécie', value: p.speciesName },
              { label: 'Raça', value: p.breedName },
              { label: 'Sexo', value: patientSexLabels[p.sex] },
              { label: 'Castrado', value: sterilizedLabel(p.sterilized) },
              {
                label: 'Nascimento',
                value: p.birthDate
                  ? `${formatDate(p.birthDate)}${p.status === 'alive' ? ` (${formatAge(p.birthDate)})` : ''}`
                  : null,
              },
              { label: 'Pelagem', value: p.coatName },
              {
                label: 'Microchip',
                value: p.microchip ? <span className="font-mono">{p.microchip}</span> : null,
              },
              {
                label: 'Pedigree',
                value: p.hasPedigree ? (p.pedigreeNumber ?? 'Sim, sem número informado') : 'Não',
              },
              {
                label: 'Plano de saúde',
                value: p.insurance ? (
                  <span>
                    {p.insurance.insurerName} · carteirinha{' '}
                    <span className="font-mono">{p.insurance.cardNumber}</span>
                    {p.insurance.validUntil
                      ? ` · validade ${formatDate(p.insurance.validUntil)}`
                      : ''}
                    {p.insurance.active ? null : (
                      <>
                        {' '}
                        <Badge tone="danger">Fora da validade</Badge>
                      </>
                    )}
                  </span>
                ) : (
                  'Não'
                ),
              },
              ...(p.status === 'deceased'
                ? [
                    {
                      label: 'Óbito',
                      value: p.deceasedOn ? formatDate(p.deceasedOn) : 'Data não informada',
                    },
                  ]
                : []),
            ]}
          />
        </Section>

        <div className="space-y-5">
          <Section title="Responsável">
            <Link
              to="/clientes/$clientId"
              params={{ clientId: p.owner.id }}
              className="font-medium text-ink hover:text-sage-700 hover:underline"
            >
              {p.owner.name}
            </Link>
            <p className="mt-0.5 font-mono text-xs text-ink-muted">
              #{p.owner.code}
              {p.owner.primaryPhone ? ` · ${formatPhone(p.owner.primaryPhone)}` : ''}
            </p>
          </Section>

          <Section title="Histórico de responsáveis">
            <ol className="relative space-y-3 border-l border-line pl-4">
              {p.ownerHistory.map((h) => (
                <li key={h.from} className="text-sm">
                  <span
                    className={`absolute -left-[5px] mt-1.5 size-2.5 rounded-full ${h.to === null ? 'bg-sage-600' : 'bg-line-strong'}`}
                    aria-hidden
                  />
                  <p className="font-medium">{h.clientName}</p>
                  <p className="font-mono text-xs text-ink-muted">
                    {formatDay(h.from)} – {h.to ? formatDay(h.to) : 'atual'}
                  </p>
                  {h.reason ? <p className="text-xs text-ink-muted">{h.reason}</p> : null}
                </li>
              ))}
            </ol>
          </Section>
        </div>
      </div>

      {transferOpen ? <TransferDialog patient={p} onOpenChange={setTransferOpen} /> : null}
      <Dialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={`Arquivar a ficha de ${p.name}?`}
        description="A ficha sai das buscas e fica somente leitura. Nada é apagado e ela pode ser restaurada depois."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirmArchive(false);
              }}
            >
              Cancelar
            </Button>
            <Button
              variant="danger"
              pending={archive.isPending}
              onClick={() => {
                archive.mutate(true);
              }}
            >
              Arquivar ficha
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          Use quando a ficha foi criada por engano ou o animal não é mais atendido pela clínica.
        </p>
      </Dialog>
    </>
  );
}
