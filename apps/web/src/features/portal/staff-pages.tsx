import {
  portalAccountSchema,
  portalAccountStatusLabels,
  portalInviteInputSchema,
  portalInviteResultSchema,
  portalSectionHints,
  portalSectionLabels,
  portalSections,
  portalSettingsSchema,
  type PortalAccount,
  type PortalAccountStatus,
  type PortalInviteInput,
  type PortalInviteResult,
  type PortalSettings,
} from '@clinica/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Copy, KeyRound, Lock, LockOpen, MessageCircle, Send, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '../../design-system/button';
import { Checkbox } from '../../design-system/checkbox';
import { Dialog } from '../../design-system/dialog';
import { TextField } from '../../design-system/field';
import { Badge, Facts, FormActions, PageHeader, Section } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { useToast } from '../../design-system/toast';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { whatsappUrl } from '../clients/format';
import { appointmentTypesQuery } from '../schedule/queries';
import { portalAccountQuery, portalAccountsQuery, portalSettingsQuery } from './queries';

const statusTones: Record<PortalAccountStatus, 'neutral' | 'sage' | 'amber' | 'danger'> = {
  none: 'neutral',
  invited: 'amber',
  active: 'sage',
  blocked: 'danger',
};

/** Bloco "Portal do cliente" da ficha do cliente [RN-44]: login, último acesso e o link. */
export function ClientPortalSection({
  clientId,
  clientName,
  archived,
}: {
  clientId: string;
  clientName: string;
  archived: boolean;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const account = useQuery(portalAccountQuery(clientId));
  const [linkOpen, setLinkOpen] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const block = useMutation({
    mutationFn: (blocked: boolean) =>
      api(
        'POST',
        `/portal-admin/clients/${clientId}/${blocked ? 'block' : 'unblock'}`,
        portalAccountSchema,
      ),
    onSuccess: async (saved) => {
      queryClient.setQueryData(portalAccountQuery(clientId).queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: ['portal-admin', 'accounts'] });
      toast.success(
        saved.status === 'blocked'
          ? 'Acesso ao portal bloqueado.'
          : 'Acesso ao portal desbloqueado.',
      );
      setConfirmBlock(false);
    },
    onError: (e) => {
      toast.error(errorMessage(e));
    },
  });

  if (account.isPending) return <SkeletonRows rows={2} columns={2} />;
  if (account.isError) {
    return (
      <ErrorState message={errorMessage(account.error)} onRetry={() => void account.refetch()} />
    );
  }
  const a = account.data;
  const canLink = !archived && a.status !== 'blocked';
  return (
    <Section
      title="Portal do cliente"
      description={
        a.portalEnabled
          ? 'Acesso do tutor ao portal, com login próprio.'
          : 'O portal está desligado na clínica: o tutor só entra depois que ele for ligado.'
      }
      actions={
        a.status === 'none' ? null : (
          <Button
            variant="ghost"
            size="sm"
            icon={
              a.status === 'blocked' ? (
                <LockOpen className="size-4" aria-hidden />
              ) : (
                <Lock className="size-4" aria-hidden />
              )
            }
            pending={block.isPending}
            onClick={() => {
              if (a.status === 'blocked') block.mutate(false);
              else setConfirmBlock(true);
            }}
          >
            {a.status === 'blocked' ? 'Desbloquear' : 'Bloquear'}
          </Button>
        )
      }
    >
      <div className="mb-3">
        <Badge tone={statusTones[a.status]}>{portalAccountStatusLabels[a.status]}</Badge>
      </div>
      {a.status === 'none' ? (
        <p className="text-sm text-ink-muted">
          Convide o tutor para acompanhar os animais pelo portal. Ele recebe um link para criar a
          senha.
        </p>
      ) : (
        <Facts
          items={[
            { label: 'Login', value: a.email },
            {
              label: 'Último acesso',
              value: a.lastLoginAt ? formatDateTime(a.lastLoginAt) : 'Nunca entrou',
            },
            ...(a.linkExpiresAt
              ? [{ label: 'Link válido até', value: formatDateTime(a.linkExpiresAt) }]
              : []),
          ]}
        />
      )}
      {canLink ? (
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          icon={
            a.status === 'active' ? (
              <KeyRound className="size-4" aria-hidden />
            ) : (
              <Send className="size-4" aria-hidden />
            )
          }
          onClick={() => {
            setLinkOpen(true);
          }}
        >
          {a.status === 'active'
            ? 'Recuperar senha do Portal'
            : a.status === 'invited'
              ? 'Gerar novo convite'
              : 'Convidar para o portal'}
        </Button>
      ) : null}
      {linkOpen ? (
        <LinkDialog
          clientId={clientId}
          clientName={clientName}
          account={a}
          onClose={() => {
            setLinkOpen(false);
          }}
        />
      ) : null}
      <Dialog
        open={confirmBlock}
        onOpenChange={setConfirmBlock}
        title="Bloquear o acesso ao portal?"
        description={`${clientName} sai do portal na hora e o link pendente deixa de valer. Dá para desbloquear depois.`}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirmBlock(false);
              }}
            >
              Cancelar
            </Button>
            <Button
              variant="danger"
              pending={block.isPending}
              onClick={() => {
                block.mutate(true);
              }}
            >
              Bloquear acesso
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">O histórico do cliente não muda.</p>
      </Dialog>
    </Section>
  );
}

/** Gera o link (convite ou recuperação) e mostra uma vez, para copiar ou mandar no WhatsApp. */
function LinkDialog({
  clientId,
  clientName,
  account,
  onClose,
}: {
  clientId: string;
  clientName: string;
  account: PortalAccount;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [result, setResult] = useState<PortalInviteResult | null>(null);
  const form = useForm<PortalInviteInput>({
    resolver: zodResolver(portalInviteInputSchema),
    defaultValues: { email: account.email ?? account.suggestedEmail ?? '' },
  });
  const generate = useMutation({
    mutationFn: (body: PortalInviteInput) =>
      api('POST', `/portal-admin/clients/${clientId}/link`, portalInviteResultSchema, body),
    onSuccess: async (saved) => {
      queryClient.setQueryData(portalAccountQuery(clientId).queryKey, saved.account);
      await queryClient.invalidateQueries({ queryKey: ['portal-admin', 'accounts'] });
      setResult(saved);
    },
    onError: (e) => {
      if (e instanceof ApiRequestError) {
        for (const d of e.fieldErrors) {
          if (d.path === 'email') form.setError('email', { message: d.message });
        }
      }
    },
  });
  const recovery = account.status === 'active';
  const message = result
    ? `Olá, ${clientName.split(' ')[0] ?? clientName}! ${
        recovery ? 'Para trocar a senha do portal' : 'Para acessar o portal do tutor'
      }, abra este link: ${result.link}`
    : '';
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={recovery ? 'Recuperar senha do Portal' : 'Convidar para o portal'}
      description={
        result
          ? `O link vale até ${formatDateTime(result.expiresAt)} e só pode ser usado uma vez.`
          : recovery
            ? 'O tutor recebe um link para criar uma senha nova. A senha atual vale até ele usar o link.'
            : 'O e-mail é o login do tutor. Ele recebe um link para criar a senha.'
      }
      footer={
        result ? (
          <Button onClick={onClose}>Concluir</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" form="portal-link-form" pending={generate.isPending}>
              Gerar link
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <TextField
            label="Link de acesso"
            value={result.link}
            readOnly
            onFocus={(e) => {
              e.currentTarget.select();
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<Copy className="size-4" aria-hidden />}
              onClick={() => {
                void navigator.clipboard.writeText(message).then(
                  () => {
                    toast.success('Mensagem com o link copiada.');
                  },
                  () => {
                    toast.error('Não foi possível copiar. Selecione o link e copie.');
                  },
                );
              }}
            >
              Copiar mensagem
            </Button>
            {account.whatsapp ? (
              <a
                href={`${whatsappUrl(account.whatsapp)}?text=${encodeURIComponent(message)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-control bg-success-50 px-3 text-[13px] font-medium text-success-600 hover:bg-success-600 hover:text-white"
              >
                <MessageCircle className="size-4" aria-hidden />
                Enviar pelo WhatsApp
              </a>
            ) : null}
          </div>
        </div>
      ) : (
        <form
          id="portal-link-form"
          noValidate
          onSubmit={form.handleSubmit((values) => {
            generate.mutate(values);
          })}
          className="space-y-3"
        >
          {generate.isError && !form.formState.errors.email ? (
            <p role="alert" className="text-sm text-danger-600">
              {errorMessage(generate.error)}
            </p>
          ) : null}
          <TextField
            label="E-mail de login"
            type="email"
            error={form.formState.errors.email?.message}
            {...form.register('email')}
          />
        </form>
      )}
    </Dialog>
  );
}

/** Configuração do portal [RN-44]: ligar, escolher o que o tutor vê e ver quem tem acesso. */
export function PortalSettingsPage() {
  const settings = useQuery(portalSettingsQuery);
  if (settings.isPending) return <SkeletonRows />;
  if (settings.isError) {
    return (
      <ErrorState message={errorMessage(settings.error)} onRetry={() => void settings.refetch()} />
    );
  }
  return (
    <>
      <SettingsForm initial={settings.data} />
      <Accounts />
    </>
  );
}

function SettingsForm({ initial }: { initial: PortalSettings }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [value, setValue] = useState(initial);
  const [lead, setLead] = useState(String(initial.booking.leadHours));
  const [reach, setReach] = useState(String(initial.booking.windowDays));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const types = useQuery(appointmentTypesQuery);
  const booking = (patch: Partial<PortalSettings['booking']>) => {
    setValue({ ...value, booking: { ...value.booking, ...patch } });
  };
  const save = useMutation({
    mutationFn: (body: PortalSettings) =>
      api('PUT', '/portal-admin/settings', portalSettingsSchema, body),
    onSuccess: async (saved) => {
      queryClient.setQueryData(portalSettingsQuery.queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: ['portal-admin', 'client'] });
      toast.success(
        saved.enabled ? 'Portal ligado e configuração salva.' : 'Configuração do portal salva.',
      );
    },
  });
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = portalSettingsSchema.safeParse({
          ...value,
          booking: {
            ...value.booking,
            leadHours: lead.trim() === '' ? Number.NaN : Number(lead),
            windowDays: reach.trim() === '' ? Number.NaN : Number(reach),
          },
        });
        if (!parsed.success) {
          setErrors(
            Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])),
          );
          return;
        }
        setErrors({});
        save.mutate(parsed.data);
      }}
    >
      <PageHeader
        area="Configuração"
        title="Portal do tutor"
        description="Área do cliente com login próprio. O tutor entra pelo link de convite gerado na ficha do cliente e vê só os próprios animais."
      />
      {save.isError ? (
        <p
          role="alert"
          className="mb-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-600"
        >
          {errorMessage(save.error)}
        </p>
      ) : null}
      <Section title="Acesso">
        <div className="max-w-3xl">
          <Checkbox
            label="Portal ligado"
            description="Desligado, ninguém entra e as sessões abertas caem. Os acessos e os convites ficam guardados."
            checked={value.enabled}
            onCheckedChange={(enabled) => {
              setValue({ ...value, enabled });
            }}
          />
        </div>
      </Section>
      <Section title="O que o tutor vê" className="mt-5">
        <div className="max-w-3xl space-y-4">
          {portalSections.map((s) => (
            <Checkbox
              key={s}
              label={portalSectionLabels[s]}
              description={portalSectionHints[s]}
              checked={value.sections[s]}
              onCheckedChange={(on) => {
                setValue({ ...value, sections: { ...value.sections, [s]: on } });
              }}
            />
          ))}
          <p className="text-xs text-ink-muted">
            Só aparece o que está publicado na ficha. Rascunhos e eventos invalidados nunca vão ao
            portal.
          </p>
        </div>
      </Section>
      <Section
        title="Agendamento online"
        description="O tutor escolhe o animal, o atendimento e um horário livre da escala. O horário entra na agenda como Agendado, marcado Pelo portal."
        className="mt-5"
      >
        <div className="max-w-3xl space-y-4">
          <Checkbox
            label="Tutor pode agendar pelo portal"
            description="Os próximos agendamentos aparecem no portal enquanto o agendamento online estiver ligado."
            checked={value.booking.enabled}
            onCheckedChange={(enabled) => {
              booking({ enabled });
            }}
          />
          <fieldset>
            <legend className="text-sm font-medium text-ink">
              Atendimentos que o tutor pode marcar
            </legend>
            {types.isPending ? (
              <SkeletonRows rows={2} columns={1} />
            ) : types.isError ? (
              <ErrorState
                message={errorMessage(types.error)}
                onRetry={() => void types.refetch()}
              />
            ) : (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {types.data
                  .filter((t) => !t.archived)
                  .map((t) => (
                    <Checkbox
                      key={t.id}
                      label={t.name}
                      description={`${String(t.durationMinutes)} minutos`}
                      checked={value.booking.typeIds.includes(t.id)}
                      onCheckedChange={(on) => {
                        booking({
                          typeIds: on
                            ? [...value.booking.typeIds, t.id]
                            : value.booking.typeIds.filter((id) => id !== t.id),
                        });
                      }}
                    />
                  ))}
              </div>
            )}
            {errors['booking.typeIds'] ? (
              <p role="alert" className="mt-1.5 text-xs text-danger-600">
                {errors['booking.typeIds']}
              </p>
            ) : null}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Antecedência mínima (horas)"
              inputMode="numeric"
              value={lead}
              hint="Também vale para o tutor cancelar o que marcou."
              error={errors['booking.leadHours']}
              onChange={(e) => {
                setLead(e.target.value);
              }}
            />
            <TextField
              label="Agenda aberta até (dias à frente)"
              inputMode="numeric"
              value={reach}
              error={errors['booking.windowDays']}
              onChange={(e) => {
                setReach(e.target.value);
              }}
            />
          </div>
        </div>
      </Section>
      <FormActions>
        <Button type="submit" pending={save.isPending}>
          Salvar
        </Button>
      </FormActions>
    </form>
  );
}

function Accounts() {
  const accounts = useQuery(portalAccountsQuery);
  return (
    <Section title="Clientes com acesso" className="mt-5">
      {accounts.isPending ? (
        <SkeletonRows rows={3} />
      ) : accounts.isError ? (
        <ErrorState
          message={errorMessage(accounts.error)}
          onRetry={() => void accounts.refetch()}
        />
      ) : accounts.data.items.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="Ninguém convidado ainda"
          description="Abra a ficha de um cliente e use Convidar para o portal."
        />
      ) : (
        <ul className="divide-y divide-line">
          {accounts.data.items.map((a) => (
            <li
              key={a.client.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5"
            >
              <div className="min-w-0">
                <Link
                  to="/clientes/$clientId"
                  params={{ clientId: a.client.id }}
                  className="font-medium text-ink hover:text-sage-700 hover:underline"
                >
                  {a.client.name}
                </Link>
                <p className="truncate font-mono text-xs text-ink-muted">{a.email}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-ink-muted">
                  {a.lastLoginAt
                    ? `Último acesso ${formatDateTime(a.lastLoginAt)}`
                    : 'Nunca entrou'}
                </span>
                <Badge tone={statusTones[a.status]}>{portalAccountStatusLabels[a.status]}</Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
