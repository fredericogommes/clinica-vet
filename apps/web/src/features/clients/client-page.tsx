import {
  abcClassHints,
  clientSchema,
  consentChannelLabels,
  consentChannels,
  formatAge,
  formatCep,
} from '@clinica/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  Archive,
  History,
  ArchiveRestore,
  Mail,
  MessageCircle,
  PawPrint,
  Pencil,
  Phone,
  Plus,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { useState } from 'react';
import { Button, buttonClasses } from '../../design-system/button';
import { Dialog } from '../../design-system/dialog';
import { Badge, Facts, PageHeader, Section } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { useToast } from '../../design-system/toast';
import { api, errorMessage } from '../../lib/api';
import { formatDateTime, formatDay } from '../../lib/format';
import { useCan } from '../../lib/session';
import { ClientPortalSection } from '../portal/staff-pages';
import { DeleteRecordButton } from '../shared/delete-record';
import { ConsentsDialog, currentConsents } from './consents-dialog';
import { formatDate, formatDocument, formatPhone, whatsappUrl } from './format';
import { clientQuery } from './queries';

const contactIcons = { mobile: Smartphone, phone: Phone, email: Mail } as const;

export function ClientPage({ clientId }: { clientId: string }) {
  const can = useCan();
  const client = useQuery(clientQuery(clientId));
  const queryClient = useQueryClient();
  const toast = useToast();
  const [consentsOpen, setConsentsOpen] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const navigate = useNavigate();

  const archive = useMutation({
    mutationFn: (archived: boolean) =>
      api('POST', `/clients/${clientId}/${archived ? 'archive' : 'restore'}`, clientSchema),
    onSuccess: async (saved) => {
      queryClient.setQueryData(clientQuery(clientId).queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: ['clients', 'list'] });
      toast.success(saved.archived ? 'Cliente arquivado.' : 'Cliente restaurado.');
      setConfirmArchive(false);
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });

  if (client.isPending) return <SkeletonRows />;
  if (client.isError) {
    return (
      <ErrorState message={errorMessage(client.error)} onRetry={() => void client.refetch()} />
    );
  }
  const c = client.data;
  const consents = currentConsents(c);
  const address = [
    [c.address.street, c.address.number].filter(Boolean).join(', '),
    c.address.complement,
    c.address.district,
    [c.address.city, c.address.state].filter(Boolean).join(' / '),
    c.address.cep ? `CEP ${formatCep(c.address.cep)}` : null,
  ].filter(Boolean);
  const activePatients = c.patients.filter((p) => !p.archived);
  const archivedPatients = c.patients.filter((p) => p.archived);

  return (
    <>
      <PageHeader
        area={`Cliente #${c.code}${c.personType === 'company' ? ' · Pessoa jurídica' : ''}`}
        title={c.name}
        actions={
          <>
            {c.abcClass ? (
              <span
                title={`Curva ABC dos últimos 12 meses: ${abcClassHints[c.abcClass].toLowerCase()}`}
              >
                <Badge
                  tone={c.abcClass === 'A' ? 'sage' : c.abcClass === 'B' ? 'amber' : 'neutral'}
                >
                  Classe {c.abcClass}
                </Badge>
              </span>
            ) : null}
            {c.archived ? <Badge tone="amber">Arquivado</Badge> : null}
            {can('clients.manage') && !c.archived ? (
              <Link
                to="/clientes/$clientId/editar"
                params={{ clientId }}
                className={buttonClasses('secondary')}
              >
                <Pencil className="size-4" aria-hidden />
                Editar
              </Link>
            ) : null}
            {can('admin.audit.view') ? (
              <Link
                to="/consultas/auditoria"
                search={{ entidade: 'client', id: clientId, nome: c.name }}
                className={buttonClasses('ghost')}
              >
                <History className="size-4" aria-hidden />
                Histórico
              </Link>
            ) : null}
            {can('clients.archive') ? (
              c.archived ? (
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
            {can('clients.delete') && c.patients.length === 0 ? (
              <DeleteRecordButton
                name={c.name}
                path={`/clients/${clientId}`}
                description="Para cadastros feitos por engano. Contatos e consentimentos saem junto."
                onDeleted={async () => {
                  queryClient.removeQueries({ queryKey: clientQuery(clientId).queryKey });
                  await queryClient.invalidateQueries({ queryKey: ['clients', 'list'] });
                  toast.success('Cliente excluído.');
                  await navigate({ to: '/clientes' });
                }}
              />
            ) : null}
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          <Section
            title="Animais"
            actions={
              can('patients.manage') && !c.archived ? (
                <Link
                  to="/clientes/$clientId/animais/novo"
                  params={{ clientId }}
                  className={buttonClasses('ghost', 'sm')}
                >
                  <Plus className="size-4" aria-hidden />
                  Novo animal
                </Link>
              ) : null
            }
          >
            {activePatients.length === 0 ? (
              <EmptyState
                icon={PawPrint}
                title="Nenhum animal"
                description="Cadastre os animais deste responsável para atendê-los."
              />
            ) : (
              <ul className="divide-y divide-line">
                {activePatients.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <Link
                        to="/animais/$patientId"
                        params={{ patientId: p.id }}
                        className="font-medium text-ink hover:text-sage-700 hover:underline"
                      >
                        {p.name}
                      </Link>
                      <p className="text-xs text-ink-muted">
                        <span className="font-mono">#{p.code}</span>
                        {p.speciesName ? ` · ${p.speciesName}` : ''}
                      </p>
                    </div>
                    {p.status === 'deceased' ? <Badge>Óbito</Badge> : null}
                  </li>
                ))}
              </ul>
            )}
            {archivedPatients.length > 0 ? (
              <p className="mt-3 border-t border-line pt-3 text-xs text-ink-muted">
                Arquivados:{' '}
                {archivedPatients.map((p, i) => (
                  <span key={p.id}>
                    {i > 0 ? ', ' : ''}
                    <Link
                      to="/animais/$patientId"
                      params={{ patientId: p.id }}
                      className="underline hover:text-ink"
                    >
                      {p.name}
                    </Link>
                  </span>
                ))}
              </p>
            ) : null}
          </Section>

          <Section title="Dados cadastrais">
            <Facts
              items={[
                {
                  label: c.personType === 'company' ? 'CNPJ' : 'CPF',
                  value: formatDocument(c.cpf ?? c.cnpj),
                },
                ...(c.personType === 'individual'
                  ? [
                      { label: 'RG', value: c.rg },
                      {
                        label: 'Nascimento',
                        value: c.birthDate
                          ? `${formatDate(c.birthDate)} (${formatAge(c.birthDate)})`
                          : null,
                      },
                      {
                        label: 'Sexo',
                        value:
                          c.sex === 'female' ? 'Feminino' : c.sex === 'male' ? 'Masculino' : null,
                      },
                    ]
                  : [{ label: 'Inscrição municipal', value: c.municipalRegistration }]),
                { label: 'Nacionalidade', value: c.nationality },
                { label: 'Profissão', value: c.profession },
                { label: 'Como conheceu', value: c.originName },
                { label: 'Cliente desde', value: formatDay(c.createdAt) },
              ]}
            />
            {c.notes ? (
              <div className="mt-4 rounded-control bg-sunken px-3 py-2.5">
                <p className="text-xs text-ink-muted">Observações</p>
                <p className="mt-0.5 text-sm whitespace-pre-line">{c.notes}</p>
              </div>
            ) : null}
          </Section>
        </div>

        <div className="space-y-5">
          <Section title="Contatos">
            {c.contacts.length === 0 ? (
              <p className="text-sm text-ink-muted">Nenhum contato cadastrado.</p>
            ) : (
              <ul className="space-y-2.5">
                {c.contacts.map((k) => {
                  const Icon = contactIcons[k.kind];
                  const text = k.kind === 'email' ? k.value : formatPhone(k.value);
                  return (
                    <li key={`${k.kind}-${k.value}`} className="flex items-center gap-2.5 text-sm">
                      <Icon className="size-4 shrink-0 text-ink-faint" aria-hidden />
                      <a
                        href={k.kind === 'email' ? `mailto:${k.value}` : `tel:+55${k.value}`}
                        className="min-w-0 flex-1 truncate font-mono text-[13px] hover:underline"
                      >
                        {text}
                      </a>
                      {k.isWhatsapp ? (
                        <a
                          href={whatsappUrl(k.value)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-full bg-success-50 px-2 py-0.5 text-xs font-medium text-success-600 hover:bg-success-600 hover:text-white"
                        >
                          <MessageCircle className="size-3.5" aria-hidden />
                          WhatsApp
                        </a>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          {can('portal.manage') ? (
            <ClientPortalSection clientId={clientId} clientName={c.name} archived={c.archived} />
          ) : null}

          <Section title="Endereço">
            {address.length === 0 ? (
              <p className="text-sm text-ink-muted">Não informado.</p>
            ) : (
              <address className="space-y-0.5 text-sm not-italic">
                {address.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </address>
            )}
          </Section>

          <Section
            title="Privacidade"
            description="Canais em que o cliente aceita receber mensagens (LGPD)."
            actions={
              can('clients.manage') && !c.archived ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<ShieldCheck className="size-4" aria-hidden />}
                  onClick={() => {
                    setConsentsOpen(true);
                  }}
                >
                  Atualizar
                </Button>
              ) : null
            }
          >
            <ul className="space-y-1.5">
              {consentChannels.map((channel) => (
                <li key={channel} className="flex items-center justify-between text-sm">
                  {consentChannelLabels[channel]}
                  {consents[channel] === null ? (
                    <Badge>Não registrado</Badge>
                  ) : consents[channel] ? (
                    <Badge tone="sage">Aceita</Badge>
                  ) : (
                    <Badge tone="danger">Recusa</Badge>
                  )}
                </li>
              ))}
            </ul>
            {c.consents.length > 0 ? (
              <details className="mt-3 border-t border-line pt-3">
                <summary className="cursor-pointer text-xs font-medium text-ink-muted hover:text-ink">
                  Histórico ({c.consents.length})
                </summary>
                <ol className="mt-2 space-y-2">
                  {c.consents.map((h, i) => (
                    <li
                      key={`${h.recordedAt}-${h.channel}-${i}`}
                      className="text-xs text-ink-muted"
                    >
                      <span className="font-medium text-ink">
                        {consentChannelLabels[h.channel]}: {h.granted ? 'aceita' : 'recusa'}
                      </span>
                      <br />
                      <span className="font-mono">{formatDateTime(h.recordedAt)}</span> · {h.source}
                      {h.recordedByName ? ` · ${h.recordedByName}` : ''}
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}
          </Section>
        </div>
      </div>

      {consentsOpen ? <ConsentsDialog client={c} open onOpenChange={setConsentsOpen} /> : null}
      <Dialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={`Arquivar ${c.name}?`}
        description="O cliente sai das buscas e fica somente leitura. O histórico é mantido e ele pode ser restaurado depois."
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
              Arquivar cliente
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          Animais do cliente continuam acessíveis pela busca de animais.
        </p>
      </Dialog>
    </>
  );
}
