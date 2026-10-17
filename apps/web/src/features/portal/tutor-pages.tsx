import {
  formatAge,
  portalLoginSchema,
  portalSetPasswordSchema,
  vaccineKindLabels,
  type PortalLogin,
  type PortalPatient,
  type PortalSetPassword,
} from '@clinica/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FileText,
  FlaskConical,
  Link2Off,
  LogOut,
  PawPrint,
  Syringe,
} from 'lucide-react';
import { Suspense, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Button, buttonClasses } from '../../design-system/button';
import { TextField } from '../../design-system/field';
import { Badge, Section } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { errorMessage, portalApiVoid, setPortalCsrfToken } from '../../lib/api';
import { ExamValuesTable } from '../clinical/exam-result';
import { zoned } from '../clinical/labels';
import { WeightChart } from '../clinical/weight-chart';
import {
  portalHomeQuery,
  portalLinkQuery,
  portalPatientQuery,
  portalSessionQuery,
  usePortalSession,
} from './queries';

const sexLabels = { female: 'Fêmea', male: 'Macho', unknown: 'Sexo não informado' } as const;

/** Moldura do portal: só o nome da clínica, o tutor e o botão de sair. */
export function PortalShell() {
  const session = usePortalSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const logout = useMutation({
    mutationFn: () => portalApiVoid('POST', '/logout'),
    onSettled: async () => {
      setPortalCsrfToken(undefined);
      queryClient.removeQueries({ queryKey: ['portal'] });
      await navigate({ to: '/portal/entrar' });
    },
  });
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/portal" className="min-w-0">
            <p className="truncate font-display text-[15px] font-semibold text-sage-700">
              {session.clinic}
            </p>
            <p className="truncate text-xs text-ink-muted">
              Portal do tutor · {session.client.name}
            </p>
          </Link>
          <Button
            variant="ghost"
            size="sm"
            icon={<LogOut className="size-4" aria-hidden />}
            pending={logout.isPending}
            onClick={() => {
              logout.mutate();
            }}
          >
            Sair
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        <Suspense fallback={<SkeletonRows />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}

function AccessFrame({
  title,
  intro,
  children,
}: {
  title: string;
  intro: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-5 py-12">
      <div className="w-full max-w-sm">
        <p className="mb-8 font-display text-lg font-semibold text-sage-700">Portal do tutor</p>
        <h1 className="font-display text-2xl font-semibold tracking-[-0.01em] text-ink">{title}</h1>
        <div className="mt-1 text-sm text-ink-muted">{intro}</div>
        {children}
      </div>
    </div>
  );
}

function FormError({ error }: { error: unknown }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-control border border-danger-600/25 bg-danger-50 px-3 py-2.5 text-sm text-danger-600"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      {errorMessage(error)}
    </div>
  );
}

export function PortalLoginPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const form = useForm<PortalLogin>({
    resolver: zodResolver(portalLoginSchema),
    defaultValues: { email: '', password: '' },
  });
  const login = useMutation({
    mutationFn: (values: PortalLogin) => portalApiVoid('POST', '/login', values),
    onSuccess: async () => {
      await queryClient.query({ ...portalSessionQuery, staleTime: 0 });
      await navigate({ to: '/portal' });
    },
  });
  const { errors } = form.formState;
  return (
    <AccessFrame
      title="Entrar"
      intro="Acompanhe os seus animais: agendamentos, peso, vacinas e o que a clínica compartilhar com você."
    >
      <form
        noValidate
        className="mt-8 space-y-4"
        onSubmit={form.handleSubmit((values) => {
          login.mutate(values);
        })}
      >
        {login.isError ? <FormError error={login.error} /> : null}
        <TextField
          label="E-mail"
          type="email"
          autoComplete="username"
          autoFocus
          error={errors.email?.message}
          {...form.register('email')}
        />
        <TextField
          label="Senha"
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...form.register('password')}
        />
        <Button type="submit" className="w-full" pending={login.isPending}>
          Entrar
        </Button>
        <p className="text-xs text-ink-muted">
          Ainda não tem acesso ou esqueceu a senha? Peça à clínica um link de acesso.
        </p>
      </form>
    </AccessFrame>
  );
}

/** Link de convite ou de recuperação: o tutor cria a senha e já entra. */
export function PortalLinkPage({ token }: { token: string }) {
  const info = useQuery(portalLinkQuery(token));
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const form = useForm<PortalSetPassword>({
    resolver: zodResolver(portalSetPasswordSchema),
    defaultValues: { password: '', confirmation: '' },
  });
  const save = useMutation({
    mutationFn: (values: PortalSetPassword) => portalApiVoid('POST', `/link/${token}`, values),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: ['portal'] });
      await queryClient.query({ ...portalSessionQuery, staleTime: 0 });
      await navigate({ to: '/portal' });
    },
  });
  if (info.isPending) return <SkeletonRows />;
  if (info.isError) {
    return (
      <AccessFrame title="Link expirado" intro={errorMessage(info.error)}>
        <div className="mt-8 flex flex-col items-start gap-3">
          <Link2Off className="size-6 text-ink-faint" aria-hidden />
          <Link to="/portal/entrar" className={buttonClasses('secondary')}>
            Ir para a entrada do portal
          </Link>
        </div>
      </AccessFrame>
    );
  }
  const { firstAccess, clientName, clinic, email } = info.data;
  const { errors } = form.formState;
  return (
    <AccessFrame
      title={firstAccess ? 'Crie a sua senha' : 'Troque a sua senha'}
      intro={
        <>
          Olá, {clientName}. {firstAccess ? 'Este é o seu acesso' : 'Este link troca a senha'} ao
          portal da {clinic}. O seu login é <strong className="text-ink">{email}</strong>.
        </>
      }
    >
      <form
        noValidate
        className="mt-8 space-y-4"
        onSubmit={form.handleSubmit((values) => {
          save.mutate(values);
        })}
      >
        {save.isError ? <FormError error={save.error} /> : null}
        {/* Campo de usuário oculto para o gerenciador de senhas guardar o par certo. */}
        <input type="email" value={email} autoComplete="username" readOnly hidden />
        <TextField
          label="Nova senha"
          type="password"
          autoComplete="new-password"
          hint="Pelo menos 10 caracteres."
          autoFocus
          error={errors.password?.message}
          {...form.register('password')}
        />
        <TextField
          label="Repita a senha"
          type="password"
          autoComplete="new-password"
          error={errors.confirmation?.message}
          {...form.register('confirmation')}
        />
        <Button type="submit" className="w-full" pending={save.isPending}>
          {firstAccess ? 'Criar senha e entrar' : 'Trocar senha e entrar'}
        </Button>
      </form>
    </AccessFrame>
  );
}

export function PortalHomePage() {
  const session = usePortalSession();
  const home = useQuery(portalHomeQuery);
  if (home.isPending) return <SkeletonRows />;
  if (home.isError) {
    return <ErrorState message={errorMessage(home.error)} onRetry={() => void home.refetch()} />;
  }
  const z = zoned(session.timeZone);
  const { patients, appointments } = home.data;
  return (
    <div className="space-y-5">
      <h1 className="font-display text-[26px] leading-tight font-semibold text-ink">
        Seus animais
      </h1>
      {patients.length === 0 ? (
        <Section title="Animais">
          <EmptyState
            icon={PawPrint}
            title="Nenhum animal cadastrado"
            description="Quando a clínica cadastrar os seus animais, eles aparecem aqui."
          />
        </Section>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {patients.map((p) => (
            <li key={p.id}>
              <Link
                to="/portal/animais/$patientId"
                params={{ patientId: p.id }}
                className="flex items-center gap-3 rounded-panel border border-line bg-surface px-4 py-3 shadow-panel hover:border-sage-600"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sage-50">
                  <PawPrint className="size-5 text-sage-600" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-ink">{p.name}</span>
                  <span className="block truncate text-xs text-ink-muted">{describe(p)}</span>
                </span>
                {p.deceased ? <Badge>Óbito</Badge> : null}
                <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {appointments ? (
        <Section title="Próximos agendamentos">
          {appointments.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="Nenhum agendamento marcado"
              description="Os próximos horários marcados na clínica aparecem aqui."
            />
          ) : (
            <ul className="divide-y divide-line">
              {appointments.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-ink">
                      {a.type}
                      {a.patients.length ? ` · ${a.patients.join(', ')}` : ''}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {a.professional} · {a.unit}
                    </p>
                  </div>
                  <p className="font-mono text-[13px] text-ink">{z.dateTime(a.startsAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}
    </div>
  );
}

const describe = (p: PortalPatient['patient']) =>
  [p.species, p.breed, sexLabels[p.sex], p.birthDate && !p.deceased ? formatAge(p.birthDate) : null]
    .filter(Boolean)
    .join(' · ');

export function PortalPatientPage({ patientId }: { patientId: string }) {
  const session = usePortalSession();
  const data = useQuery(portalPatientQuery(patientId));
  if (data.isPending) return <SkeletonRows />;
  if (data.isError) {
    return <ErrorState message={errorMessage(data.error)} onRetry={() => void data.refetch()} />;
  }
  const z = zoned(session.timeZone);
  const { patient, weights, vaccines, exams, prescriptions } = data.data;
  const nothing = !weights && !vaccines && !exams && !prescriptions;
  return (
    <div className="space-y-5">
      <div>
        <Link
          to="/portal"
          className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Seus animais
        </Link>
        <h1 className="mt-2 font-display text-[26px] leading-tight font-semibold text-ink">
          {patient.name}
        </h1>
        <p className="mt-0.5 text-sm text-ink-muted">{describe(patient)}</p>
      </div>
      {nothing ? (
        <Section title="Histórico">
          <EmptyState
            icon={PawPrint}
            title="Histórico não compartilhado"
            description="A clínica ainda não mostra o histórico dos animais pelo portal."
          />
        </Section>
      ) : null}
      {weights ? (
        <Section title="Peso">
          <WeightChart weights={weights} timeZone={session.timeZone} />
        </Section>
      ) : null}
      {vaccines ? (
        <Section title="Vacinas" description="Vacinas, vermífugos e antiparasitários aplicados.">
          {vaccines.length === 0 ? (
            <EmptyState
              icon={Syringe}
              title="Nenhuma aplicação registrada"
              description="As aplicações feitas na clínica aparecem aqui, com a próxima dose."
            />
          ) : (
            <ul className="divide-y divide-line">
              {vaccines.map((v) => (
                <li
                  key={v.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{v.name}</p>
                    <p className="text-xs text-ink-muted">
                      {vaccineKindLabels[v.kind]} · {v.dose} · aplicada em {z.day(v.appliedAt)}
                    </p>
                  </div>
                  {v.nextDueOn ? (
                    <Badge tone="sage">
                      Próxima dose {v.nextDueOn.split('-').reverse().join('/')}
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}
      {exams ? (
        <Section title="Exames">
          {exams.length === 0 ? (
            <EmptyState
              icon={FlaskConical}
              title="Nenhum resultado publicado"
              description="Os resultados de exame publicados pela clínica aparecem aqui."
            />
          ) : (
            <ul className="space-y-5">
              {exams.map((e) => (
                <li key={e.id}>
                  <p className="font-medium text-ink">{e.name}</p>
                  <p className="text-xs text-ink-muted">{z.dateTime(e.at)}</p>
                  <ExamValuesTable values={e.values} referenceLabel={e.referenceLabel} />
                  {e.notes ? (
                    <p className="mt-2 text-sm whitespace-pre-line text-ink-muted">{e.notes}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}
      {prescriptions ? (
        <Section title="Receitas">
          {prescriptions.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="Nenhuma receita publicada"
              description="As receitas publicadas na ficha aparecem aqui com o texto completo."
            />
          ) : (
            <ul className="space-y-3">
              {prescriptions.map((p) => (
                <li key={p.id}>
                  <details className="rounded-control border border-line px-3 py-2.5">
                    <summary className="cursor-pointer">
                      <span className="font-medium text-ink">{p.title}</span>
                      <span className="block text-xs text-ink-muted">
                        {z.dateTime(p.at)} · {p.professional}
                      </span>
                    </summary>
                    <p className="mt-3 border-t border-line pt-3 text-sm whitespace-pre-line text-ink">
                      {p.body}
                    </p>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}
    </div>
  );
}
