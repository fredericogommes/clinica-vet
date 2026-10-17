import {
  clinicalEventSchema,
  type ClinicalEvent,
  type ClinicalEventKind,
} from '@clinica/contracts';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { ArrowDownUp, History, Printer, ScrollText } from 'lucide-react';
import { useState } from 'react';
import { Button, buttonClasses } from '../../design-system/button';
import { Dialog } from '../../design-system/dialog';
import { SelectField, TextField, TextareaField } from '../../design-system/field';
import { Badge } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { useToast } from '../../design-system/toast';
import { api, apiVoid, errorMessage } from '../../lib/api';
import { useCan } from '../../lib/session';
import { formatBrDate } from '../schedule/dates';
import { ExamSeriesDialog, ExamValuesTable } from './exam-result';
import { eventHeadline, kindIcons, kindLabel, kindOrder, vitalsSummary, zoned } from './labels';
import { timelineQuery, type TimelineFilters } from './queries';

const noFilters: TimelineFilters = {
  from: '',
  to: '',
  kinds: [],
  professionalId: '',
  order: 'desc',
};

/** Linha do tempo [p.4]: filtros por período, tipo e profissional, aplicados no servidor. */
export function TimelinePanel({
  patientId,
  patientName,
  timeZone,
  onEdit,
}: {
  patientId: string;
  patientName: string;
  timeZone: string;
  onEdit: (event: ClinicalEvent) => void;
}) {
  const [filters, setFilters] = useState<TimelineFilters>(noFilters);
  const timeline = useInfiniteQuery(timelineQuery(patientId, filters));
  const [voiding, setVoiding] = useState<ClinicalEvent | null>(null);
  const [discarding, setDiscarding] = useState<ClinicalEvent | null>(null);
  const [series, setSeries] = useState<{ attributeId: string; name: string } | null>(null);
  const z = zoned(timeZone);

  const items = timeline.data?.pages.flatMap((p) => p.items) ?? [];
  const professionals = timeline.data?.pages[0]?.professionals ?? [];
  const filtered =
    filters.from || filters.to || filters.kinds.length > 0 || filters.professionalId !== '';
  const toggleKind = (kind: ClinicalEventKind) => {
    setFilters((f) => ({
      ...f,
      kinds: f.kinds.includes(kind) ? f.kinds.filter((k) => k !== kind) : [...f.kinds, kind],
    }));
  };

  // Agrupa por dia no fuso da unidade, mantendo a ordem escolhida.
  const groups: { day: string; label: string; items: ClinicalEvent[] }[] = [];
  for (const e of items) {
    const day = z.isoDay(e.occurredAt);
    const last = groups.at(-1);
    if (last?.day === day) last.items.push(e);
    else groups.push({ day, label: z.day(e.occurredAt), items: [e] });
  }

  return (
    <div>
      <div className="@container space-y-3 border-b border-line p-4">
        <div className="grid grid-cols-2 gap-3 items-end @xl:grid-cols-[1fr_1fr_1.4fr_auto]">
          <TextField
            label="De"
            type="date"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(e) => {
              setFilters((f) => ({ ...f, from: e.target.value }));
            }}
          />
          <TextField
            label="Até"
            type="date"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(e) => {
              setFilters((f) => ({ ...f, to: e.target.value }));
            }}
          />
          <SelectField
            label="Profissional"
            value={filters.professionalId}
            placeholder="Todos"
            options={professionals.map((p) => ({ value: p.id, label: p.name }))}
            onChange={(e) => {
              setFilters((f) => ({ ...f, professionalId: e.target.value }));
            }}
          />
          <Button
            variant="secondary"
            icon={<ArrowDownUp className="size-4" aria-hidden />}
            onClick={() => {
              setFilters((f) => ({ ...f, order: f.order === 'desc' ? 'asc' : 'desc' }));
            }}
          >
            {filters.order === 'desc' ? 'Mais recentes' : 'Mais antigos'}
          </Button>
        </div>
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Tipos de evento"
        >
          {kindOrder.map((kind) => {
            const Icon = kindIcons[kind];
            const on = filters.kinds.includes(kind);
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  toggleKind(kind);
                }}
                className={clsx(
                  'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                  on
                    ? 'border-sage-600 bg-sage-600 text-white'
                    : 'border-line-strong bg-surface text-ink-muted hover:text-ink',
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                {kindLabel(kind)}
              </button>
            );
          })}
          {filtered ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilters((f) => ({ ...noFilters, order: f.order }));
              }}
            >
              Limpar filtros
            </Button>
          ) : null}
        </div>
      </div>

      {timeline.isPending ? (
        <SkeletonRows rows={5} columns={2} />
      ) : timeline.isError ? (
        <ErrorState
          message={errorMessage(timeline.error)}
          onRetry={() => void timeline.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={filtered ? 'Nada com estes filtros' : 'Linha do tempo vazia'}
          description={
            filtered
              ? 'Amplie o período ou desmarque alguns tipos.'
              : `Os atendimentos, pesagens, receitas e demais registros de ${patientName} aparecem aqui.`
          }
        />
      ) : (
        <div aria-busy={timeline.isFetching || undefined}>
          {groups.map((g) => (
            <section key={g.day} aria-label={g.label} className="px-4 pt-3 pb-1">
              <h3 className="mb-2 font-mono text-[11px] font-medium tracking-[0.06em] text-ink-muted uppercase">
                {g.label}
              </h3>
              <ol className="relative space-y-3 border-l border-line pl-5">
                {g.items.map((e) => (
                  <EventItem
                    key={e.id}
                    event={e}
                    time={z.time(e.occurredAt)}
                    patientName={patientName}
                    onEdit={onEdit}
                    onVoid={setVoiding}
                    onDiscard={setDiscarding}
                    onSeries={setSeries}
                  />
                ))}
              </ol>
            </section>
          ))}
          <div className="flex justify-center p-4">
            {timeline.hasNextPage ? (
              <Button
                variant="secondary"
                size="sm"
                pending={timeline.isFetchingNextPage}
                onClick={() => void timeline.fetchNextPage()}
              >
                Carregar mais
              </Button>
            ) : (
              <p className="text-xs text-ink-faint">Fim do histórico</p>
            )}
          </div>
        </div>
      )}

      {voiding ? (
        <VoidDialog
          event={voiding}
          onClose={() => {
            setVoiding(null);
          }}
        />
      ) : null}
      {series ? (
        <ExamSeriesDialog
          patientId={patientId}
          attribute={series}
          timeZone={timeZone}
          onClose={() => {
            setSeries(null);
          }}
        />
      ) : null}
      {discarding ? (
        <DiscardDialog
          event={discarding}
          onClose={() => {
            setDiscarding(null);
          }}
        />
      ) : null}
    </div>
  );
}

function EventItem({
  event: e,
  time,
  patientName,
  onEdit,
  onVoid,
  onDiscard,
  onSeries,
}: {
  event: ClinicalEvent;
  time: string;
  patientName: string;
  onEdit: (event: ClinicalEvent) => void;
  onVoid: (event: ClinicalEvent) => void;
  onDiscard: (event: ClinicalEvent) => void;
  onSeries: (attribute: { attributeId: string; name: string }) => void;
}) {
  const can = useCan();
  const Icon = kindIcons[e.kind];
  const voided = e.status === 'voided';
  const d = e.data;
  return (
    <li className="relative">
      <span
        className={clsx(
          'absolute top-0.5 -left-[31px] flex size-5 items-center justify-center rounded-full border bg-surface',
          e.status === 'draft'
            ? 'border-amber-500 text-amber-700'
            : 'border-line-strong text-sage-600',
        )}
        aria-hidden
      >
        <Icon className="size-3" />
      </span>
      <article
        aria-label={`${kindLabel(e.kind)} ${time}: ${eventHeadline(e)}`}
        className={clsx(
          'rounded-control border px-3 py-2.5',
          e.status === 'draft'
            ? 'border-dashed border-amber-500 bg-amber-50/60'
            : 'border-line bg-surface',
          voided && 'opacity-70',
        )}
      >
        <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-xs font-semibold tracking-wide text-sage-700 uppercase">
            {kindLabel(e.kind)}
          </span>
          <span className="font-mono text-xs text-ink-muted">{time}</span>
          <span className="text-xs text-ink-muted">· {e.professional.name}</span>
          {e.status === 'draft' ? <Badge tone="amber">Rascunho</Badge> : null}
          {voided ? <Badge tone="danger">Invalidado</Badge> : null}
        </header>
        <p className={clsx('mt-1 text-sm font-medium break-words', voided && 'line-through')}>
          {eventHeadline(e)}
        </p>

        {d.kind === 'encounter' ? (
          <>
            {d.type && d.summary ? <p className="text-xs text-ink-muted">{d.type.name}</p> : null}
            {vitalsSummary(d.vitals).length ? (
              <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Sinais vitais">
                {vitalsSummary(d.vitals).map((v) => (
                  <li
                    key={v.key}
                    className="rounded-full bg-sunken px-2 py-0.5 font-mono text-[11.5px] text-ink"
                  >
                    {v.label} {v.text}
                  </li>
                ))}
              </ul>
            ) : null}
            {d.pathologies.length ? (
              <p className="mt-2 text-sm">
                <span className="text-xs text-ink-muted">Diagnóstico: </span>
                {d.pathologies.map((p) => (p.code ? `${p.code} ${p.name}` : p.name)).join('; ')}
              </p>
            ) : null}
            {d.narrative ? <LongText label="Ver prontuário" text={d.narrative} /> : null}
          </>
        ) : null}
        {d.kind === 'weight' || d.kind === 'pathology' ? (
          d.notes ? (
            <p className="mt-1 text-sm whitespace-pre-line text-ink-muted">{d.notes}</p>
          ) : null
        ) : null}
        {d.kind === 'observation' && d.text.includes('\n') ? (
          <p className="mt-1 text-sm whitespace-pre-line text-ink-muted">
            {d.text.split('\n').slice(1).join('\n')}
          </p>
        ) : null}
        {d.kind === 'document' || d.kind === 'prescription' ? (
          <LongText label="Ver texto" text={d.body} />
        ) : null}
        {d.kind === 'exam' ? (
          <>
            <ExamValuesTable
              values={d.values}
              referenceLabel={d.referenceLabel}
              onSeries={e.status === 'published' && !voided ? onSeries : undefined}
            />
            {d.notes ? (
              <p className="mt-2 text-sm whitespace-pre-line text-ink-muted">{d.notes}</p>
            ) : null}
          </>
        ) : null}
        {d.kind === 'vaccine' ? (
          <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-ink-muted">
            <div className="flex gap-1">
              <dt>Próxima dose:</dt>
              <dd className="text-ink">
                {d.nextDueOn ? formatBrDate(d.nextDueOn) : 'sem próxima dose'}
              </dd>
            </div>
            {d.lotNumber ? (
              <div className="flex gap-1">
                <dt>Lote:</dt>
                <dd className="font-mono text-ink">{d.lotNumber}</dd>
              </div>
            ) : null}
            {d.notes ? <p className="w-full text-sm whitespace-pre-line">{d.notes}</p> : null}
          </dl>
        ) : null}
        {d.kind === 'photo' ? (
          <a
            href={`/api/clinical/files/${d.fileId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 block w-fit"
          >
            <img
              src={`/api/clinical/files/${d.fileId}`}
              alt={d.caption || `Foto clínica de ${patientName}`}
              loading="lazy"
              className="h-32 max-w-full rounded-control border border-line object-cover"
            />
          </a>
        ) : null}
        {e.void ? (
          <p className="mt-2 text-xs text-danger-600">
            Invalidado por {e.void.by}: {e.void.reason}
          </p>
        ) : null}

        <footer className="mt-2 flex flex-wrap gap-1">
          {e.editable ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onEdit(e);
              }}
            >
              {e.status === 'draft' ? 'Continuar rascunho' : 'Corrigir'}
            </Button>
          ) : null}
          {e.removable && e.status === 'draft' ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onDiscard(e);
              }}
            >
              Descartar
            </Button>
          ) : null}
          {e.removable && e.status === 'published' ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onVoid(e);
              }}
            >
              Invalidar
            </Button>
          ) : null}
          {(d.kind === 'document' || d.kind === 'prescription') && e.status === 'published' ? (
            <a
              href={`/impressao/evento/${e.id}`}
              target="_blank"
              rel="noopener"
              className={buttonClasses('ghost', 'sm')}
            >
              <Printer className="size-3.5" aria-hidden />
              Imprimir
            </a>
          ) : null}
          {can('admin.audit.view') && e.status !== 'draft' ? (
            <Link
              to="/consultas/auditoria"
              search={{
                entidade: 'clinical_event',
                id: e.id,
                nome: `${kindLabel(e.kind)} de ${patientName}`,
              }}
              className={buttonClasses('ghost', 'sm')}
            >
              <History className="size-3.5" aria-hidden />
              Histórico
            </Link>
          ) : null}
        </footer>
      </article>
    </li>
  );
}

function LongText({ label, text }: { label: string; text: string }) {
  return (
    <details className="group mt-2">
      <summary className="cursor-pointer text-xs font-medium text-sage-700 hover:underline">
        {label}
      </summary>
      <p className="mt-2 rounded-control bg-canvas px-3 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap">
        {text}
      </p>
    </details>
  );
}

function useRefreshRecord(patientId: string) {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: ['clinical', 'timeline', patientId] });
    await queryClient.invalidateQueries({ queryKey: ['clinical', 'record', patientId] });
  };
}

function VoidDialog({ event, onClose }: { event: ClinicalEvent; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefreshRecord(event.patientId);
  const [reason, setReason] = useState('');
  const mutation = useMutation({
    mutationFn: () =>
      api('POST', `/clinical/events/${event.id}/void`, clinicalEventSchema, { reason }),
    onSuccess: async () => {
      await refresh();
      toast.success('Evento invalidado. Ele continua na linha do tempo, riscado.');
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Invalidar ${kindLabel(event.kind).toLowerCase()}?`}
      description="O registro não é apagado: fica riscado na linha do tempo, com o seu nome e o motivo."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button
            variant="danger"
            pending={mutation.isPending}
            disabled={reason.trim().length < 3}
            onClick={() => {
              mutation.mutate();
            }}
          >
            Invalidar
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
        <p className="text-sm">{eventHeadline(event)}</p>
        <TextareaField
          label="Motivo"
          hint="Ex.: lançado no animal errado, balança descalibrada."
          maxLength={300}
          autoFocus
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
          }}
        />
      </div>
    </Dialog>
  );
}

function DiscardDialog({ event, onClose }: { event: ClinicalEvent; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefreshRecord(event.patientId);
  const mutation = useMutation({
    mutationFn: () => apiVoid('DELETE', `/clinical/events/${event.id}`),
    onSuccess: async () => {
      await refresh();
      toast.success('Rascunho descartado.');
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Descartar o rascunho?"
      description="O rascunho nunca foi publicado e sai da ficha. Esta ação não pode ser desfeita."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button
            variant="danger"
            pending={mutation.isPending}
            onClick={() => {
              mutation.mutate();
            }}
          >
            Descartar rascunho
          </Button>
        </>
      }
    >
      {mutation.isError ? (
        <p role="alert" className="rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600">
          {errorMessage(mutation.error)}
        </p>
      ) : (
        <p className="text-sm">{eventHeadline(event)}</p>
      )}
    </Dialog>
  );
}
