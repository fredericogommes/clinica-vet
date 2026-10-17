import {
  messageListSchema,
  messageRunSchema,
  messageStatusLabels,
  messageTriggerLabels,
  messageTriggers,
  skipReasonLabels,
  whatsappLink,
  type Message,
  type MessageStatus,
  type MessageTrigger,
} from '@clinica/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { MessageCircle, RefreshCw } from 'lucide-react';
import { Button, buttonClasses } from '../../design-system/button';
import { Segmented, SelectField } from '../../design-system/field';
import { Badge, PageHeader, Panel, Stats } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { Pagination } from '../../design-system/table';
import { useToast } from '../../design-system/toast';
import { api, apiVoid, errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useCan } from '../../lib/session';
import { formatPhone } from '../clients/format';

export const queueSituations = ['aguardando', 'enviadas', 'nao-enviadas', 'todas'] as const;
export type QueueSituation = (typeof queueSituations)[number];

export interface QueueSearch {
  situacao: QueueSituation;
  tipo: MessageTrigger | undefined;
  page: number;
}

/** Mudança nos filtros da URL; `undefined` volta ao padrão. */
interface UrlPatch {
  situacao?: Exclude<QueueSituation, 'aguardando'> | undefined;
  tipo?: MessageTrigger | undefined;
}

const PAGE_SIZE = 30;

const queueQuery = (s: QueueSearch) => ({
  queryKey: ['messages', 'queue', s],
  queryFn: () => {
    const params = new URLSearchParams({
      situacao: s.situacao,
      page: String(s.page),
      pageSize: String(PAGE_SIZE),
    });
    if (s.tipo) params.set('tipo', s.tipo);
    return api('GET', `/messages?${params.toString()}`, messageListSchema);
  },
  placeholderData: keepPreviousData,
});

const statusTones: Record<MessageStatus, 'neutral' | 'sage' | 'amber' | 'danger'> = {
  pending: 'amber',
  sent: 'sage',
  failed: 'danger',
  skipped: 'neutral',
  cancelled: 'neutral',
};

/** Fila e histórico das mensagens automáticas [p.20]: o que saiu, o que espera e o porquê. */
export function MessagesPage({ search }: { search: QueueSearch }) {
  const can = useCan();
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: '/mensagens' });
  const set = (patch: UrlPatch) => {
    void navigate({ search: (prev) => ({ ...prev, page: undefined, ...patch }), replace: true });
  };
  const queue = useQuery(queueQuery(search));
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['messages', 'queue'] });
  const generate = useMutation({
    mutationFn: () => api('POST', '/messages/run', messageRunSchema),
    onSuccess: async (result) => {
      await refresh();
      toast.success(
        result.created === 0
          ? 'Nenhuma mensagem nova: a fila já está em dia.'
          : result.created === 1
            ? '1 mensagem nova na fila.'
            : `${String(result.created)} mensagens novas na fila.`,
      );
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });

  return (
    <>
      <PageHeader
        area="Mensagens"
        title="Fila de mensagens"
        description="Lembretes e avisos gerados pelas mensagens automáticas. As novas entram a cada poucos minutos."
        actions={
          can('messages.configure') ? (
            <Button
              variant="secondary"
              icon={<RefreshCw className="size-4" aria-hidden />}
              pending={generate.isPending}
              onClick={() => {
                generate.mutate();
              }}
            >
              Gerar agora
            </Button>
          ) : null
        }
      />
      {queue.data ? <DeliveryNotice delivery={queue.data.delivery} /> : null}
      <Panel className="mb-5 p-4">
        <div className="grid gap-4 sm:grid-cols-[auto_16rem] sm:items-end">
          <Segmented
            label="Situação"
            value={search.situacao}
            options={[
              { value: 'aguardando', label: 'Aguardando' },
              { value: 'enviadas', label: 'Enviadas' },
              { value: 'nao-enviadas', label: 'Não enviadas' },
              { value: 'todas', label: 'Todas' },
            ]}
            onChange={(situacao) => {
              set({ situacao: situacao === 'aguardando' ? undefined : situacao });
            }}
          />
          <SelectField
            label="Mensagem"
            value={search.tipo ?? ''}
            placeholder="Todas"
            options={messageTriggers.map((t) => ({ value: t, label: messageTriggerLabels[t] }))}
            onChange={(e) => {
              set({ tipo: (e.target.value || undefined) as MessageTrigger | undefined });
            }}
          />
        </div>
      </Panel>

      {queue.isPending ? (
        <SkeletonRows rows={5} columns={3} />
      ) : queue.isError ? (
        <ErrorState message={errorMessage(queue.error)} onRetry={() => void queue.refetch()} />
      ) : (
        <>
          <div className="mb-5">
            <Stats
              label="Resumo das mensagens"
              items={[
                {
                  label: 'Aguardando envio',
                  value: queue.data.counts.pending,
                  detail: 'Na fila agora',
                },
                { label: 'Enviadas hoje', value: queue.data.counts.sentToday },
                {
                  label: 'Não enviadas',
                  value: queue.data.counts.notSent,
                  detail: 'Sem celular, recusa ou falha',
                },
              ]}
            />
          </div>
          <Panel>
            {queue.data.items.length === 0 ? (
              <EmptyState
                icon={MessageCircle}
                title={
                  search.situacao === 'aguardando'
                    ? 'Nenhuma mensagem esperando envio'
                    : 'Nenhuma mensagem nesta busca'
                }
                description="Lembretes de vacina, agendamento, aniversários e boas-vindas aparecem aqui quando chega a hora."
              />
            ) : (
              <div aria-busy={queue.isFetching || undefined}>
                <ul className="divide-y divide-line" aria-label="Mensagens">
                  {queue.data.items.map((m) => (
                    <MessageRow key={m.id} message={m} onChange={refresh} />
                  ))}
                </ul>
                <div className="border-t border-line px-4 py-3">
                  <Pagination
                    page={queue.data.page}
                    pageSize={queue.data.pageSize}
                    total={queue.data.total}
                    onPageChange={(page) => {
                      void navigate({ search: (prev) => ({ ...prev, page }), replace: true });
                    }}
                  />
                </div>
              </div>
            )}
          </Panel>
        </>
      )}
    </>
  );
}

function DeliveryNotice({ delivery }: { delivery: 'api' | 'manual' }) {
  return (
    <p className="mb-5 rounded-control border border-line bg-sage-50 px-4 py-3 text-sm text-sage-700">
      {delivery === 'api'
        ? 'Envio automático ligado: as mensagens com modelo aprovado na Meta saem sozinhas, das 8h às 20h. As demais esperam aqui para envio pela recepção.'
        : 'Envio pela recepção: abra cada mensagem no WhatsApp da clínica, envie e marque como enviada. O envio automático depende da conta oficial do WhatsApp Business da clínica.'}
    </p>
  );
}

function MessageRow({ message: m, onChange }: { message: Message; onChange: () => Promise<void> }) {
  const toast = useToast();
  const act = useMutation({
    mutationFn: (action: 'sent' | 'cancel') => apiVoid('POST', `/messages/${m.id}/${action}`),
    onSuccess: async (_, action) => {
      await onChange();
      toast.success(action === 'sent' ? 'Mensagem marcada como enviada.' : 'Mensagem cancelada.');
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
  const open = m.status === 'pending' || m.status === 'failed';
  const who = m.patient ? `${m.client.name} · ${m.patient.name}` : m.client.name;
  return (
    <li className="space-y-2 px-4 py-3" aria-label={`${messageTriggerLabels[m.trigger]}: ${who}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Link
          to="/clientes/$clientId"
          params={{ clientId: m.client.id }}
          className="text-sm font-medium text-sage-700 hover:underline"
        >
          {m.client.name}
        </Link>
        {m.patient ? <span className="text-sm text-ink-muted">· {m.patient.name}</span> : null}
        <Badge tone={statusTones[m.status]}>{messageStatusLabels[m.status]}</Badge>
        <span className="text-xs text-ink-muted">{messageTriggerLabels[m.trigger]}</span>
      </div>
      <p className="rounded-control bg-sunken px-3 py-2 text-sm whitespace-pre-line text-ink">
        {m.body}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">
          {m.phone ? <span className="font-mono">{formatPhone(m.phone)}</span> : null}
          {m.phone ? ' · ' : ''}
          {m.status === 'sent' && m.sentAt
            ? `${m.channel === 'api' ? 'Enviada automaticamente' : `Enviada por ${m.sentBy ?? 'alguém da equipe'}`} em ${formatDateTime(m.sentAt)}`
            : m.skipReason
              ? skipReasonLabels[m.skipReason]
              : `Gerada em ${formatDateTime(m.createdAt)}`}
          {m.error && m.status !== 'sent' ? (
            <span className="block text-danger-600">{m.error}</span>
          ) : null}
        </p>
        {open && m.phone ? (
          <div className="flex flex-wrap gap-1">
            <a
              href={whatsappLink(m.phone, m.body)}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClasses('secondary', 'sm')}
            >
              <MessageCircle className="size-4" aria-hidden />
              Abrir no WhatsApp
            </a>
            <Button
              size="sm"
              pending={act.isPending && act.variables === 'sent'}
              onClick={() => {
                act.mutate('sent');
              }}
            >
              Marcar como enviada
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Cancelar mensagem para ${who}`}
              pending={act.isPending && act.variables === 'cancel'}
              onClick={() => {
                act.mutate('cancel');
              }}
            >
              Cancelar
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}
