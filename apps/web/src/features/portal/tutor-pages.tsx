import {
  formatAge,
  portalLoginSchema,
  portalSetPasswordSchema,
  vaccineKindLabels,
  portalBookSchema,
  type PortalBook,
  type PortalBookingOptions,
  type PortalHome,
  type PortalLogin,
  type PortalSlots,
  type PortalPatient,
  type PortalSetPassword,
} from '@clinica/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import {
  CalendarClock,
  CalendarPlus,
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
import { clsx } from 'clsx';
import { Suspense, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Button, buttonClasses } from '../../design-system/button';
import { Checkbox } from '../../design-system/checkbox';
import { Dialog } from '../../design-system/dialog';
import { SelectField, TextareaField, TextField } from '../../design-system/field';
import { useToast } from '../../design-system/toast';
import { formatCalendarDate } from '../../lib/format';
import { Badge, Section } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { errorMessage, portalApiVoid, setPortalCsrfToken } from '../../lib/api';
import { ExamValuesTable } from '../clinical/exam-result';
import { zoned } from '../clinical/labels';
import { WeightChart } from '../clinical/weight-chart';
import {
  portalBookingQuery,
  portalHomeQuery,
  portalLinkQuery,
  portalSlotsQuery,
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

function FormError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-control border border-danger-600/25 bg-danger-50 px-3 py-2.5 text-sm text-danger-600"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      {message}
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
        {login.isError ? <FormError message={errorMessage(login.error)} /> : null}
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
        {save.isError ? <FormError message={errorMessage(save.error)} /> : null}
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
  const queryClient = useQueryClient();
  const toast = useToast();
  const [cancelling, setCancelling] = useState<
    NonNullable<PortalHome['appointments']>[number] | null
  >(null);
  const cancel = useMutation({
    mutationFn: (id: string) => portalApiVoid('POST', `/appointments/${id}/cancel`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['portal'] });
      toast.success('Agendamento cancelado.');
      setCancelling(null);
    },
    onError: (e) => {
      toast.error(errorMessage(e));
    },
  });
  if (home.isPending) return <SkeletonRows />;
  if (home.isError) {
    return <ErrorState message={errorMessage(home.error)} onRetry={() => void home.refetch()} />;
  }
  const z = zoned(session.timeZone);
  const { patients, appointments } = home.data;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-[26px] leading-tight font-semibold text-ink">
          Seus animais
        </h1>
        {session.booking && patients.some((p) => !p.deceased) ? (
          <Link to="/portal/agendar" className={buttonClasses()}>
            <CalendarPlus className="size-4" aria-hidden />
            Agendar horário
          </Link>
        ) : null}
      </div>
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
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-[13px] text-ink">{z.dateTime(a.startsAt)}</p>
                    {a.cancellable ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Cancelar ${a.type} de ${z.dateTime(a.startsAt)}`}
                        onClick={() => {
                          setCancelling(a);
                        }}
                      >
                        Cancelar
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}
      <Dialog
        open={cancelling !== null}
        onOpenChange={(open) => {
          if (!open) setCancelling(null);
        }}
        title="Cancelar o agendamento?"
        description={
          cancelling
            ? `${cancelling.type} em ${z.dateTime(cancelling.startsAt)}. O horário fica livre para outra pessoa.`
            : ''
        }
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setCancelling(null);
              }}
            >
              Manter
            </Button>
            <Button
              variant="danger"
              pending={cancel.isPending}
              onClick={() => {
                if (cancelling) cancel.mutate(cancelling.id);
              }}
            >
              Cancelar agendamento
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">Para remarcar, cancele e agende de novo.</p>
      </Dialog>
    </div>
  );
}

/** Agendar pelo portal: animal, atendimento, dia e um horário livre da escala. */
export function PortalBookingPage() {
  const options = useQuery(portalBookingQuery);
  if (options.isPending) return <SkeletonRows />;
  if (options.isError) {
    return (
      <ErrorState message={errorMessage(options.error)} onRetry={() => void options.refetch()} />
    );
  }
  return <BookingForm options={options.data} />;
}

function BookingForm({ options }: { options: PortalBookingOptions }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [patientIds, setPatientIds] = useState<string[]>(
    options.patients.length === 1 && options.patients[0] ? [options.patients[0].id] : [],
  );
  const [unitId, setUnitId] = useState(options.units[0]?.id ?? '');
  const [typeId, setTypeId] = useState(
    options.types.length === 1 ? (options.types[0]?.id ?? '') : '',
  );
  const [date, setDate] = useState('');
  const [slot, setSlot] = useState<PortalSlots[number] | null>(null);
  const [professionalId, setProfessionalId] = useState('');
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const slots = useQuery(portalSlotsQuery(unitId, typeId, date));
  const book = useMutation({
    mutationFn: (body: PortalBook) => portalApiVoid('POST', '/appointments', body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['portal'] });
      toast.success('Horário agendado. A clínica já vê o seu agendamento.');
      await navigate({ to: '/portal' });
    },
    onError: async (e) => {
      setProblem(errorMessage(e));
      setSlot(null);
      await slots.refetch();
    },
  });
  const type = options.types.find((t) => t.id === typeId);
  // Um botão por horário: sem preferência, o horário fica com o primeiro profissional livre.
  const free = slots.data ?? [];
  const professionals = [...new Map(free.map((s) => [s.professionalId, s.professionalName]))];
  const chosen = professionals.some(([id]) => id === professionalId) ? professionalId : '';
  const shown = chosen
    ? free.filter((s) => s.professionalId === chosen)
    : free.filter((s, i) => free.findIndex((o) => o.start === s.start) === i);
  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        // Avisa o que falta na ordem em que aparece na tela.
        const missing =
          patientIds.length === 0
            ? 'Escolha ao menos um animal'
            : typeId === ''
              ? 'Escolha o atendimento'
              : date === ''
                ? 'Escolha o dia'
                : slot === null
                  ? 'Escolha um horário'
                  : null;
        if (missing) {
          setProblem(missing);
          return;
        }
        const parsed = portalBookSchema.safeParse({
          unitId,
          typeId,
          patientIds,
          date,
          start: slot?.start ?? '',
          professionalId: slot?.professionalId ?? '',
          notes,
        });
        if (!parsed.success) {
          setProblem(parsed.error.issues[0]?.message ?? 'Confira os dados do agendamento.');
          return;
        }
        setProblem(null);
        book.mutate(parsed.data);
      }}
    >
      <div>
        <Link
          to="/portal"
          className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Seus animais
        </Link>
        <h1 className="mt-2 font-display text-[26px] leading-tight font-semibold text-ink">
          Agendar horário
        </h1>
        <p className="mt-0.5 text-sm text-ink-muted">
          Horários de {formatCalendarDate(options.firstDate)} a{' '}
          {formatCalendarDate(options.lastDate)}
          {options.leadHours > 0
            ? `, com pelo menos ${String(options.leadHours)} ${options.leadHours === 1 ? 'hora' : 'horas'} de antecedência`
            : ''}
          .
        </p>
      </div>
      {problem ? <FormError message={problem} /> : null}
      <Section title="Para quem">
        <div className="space-y-3">
          {options.patients.map((p) => (
            <Checkbox
              key={p.id}
              label={p.name}
              checked={patientIds.includes(p.id)}
              onCheckedChange={(on) => {
                setPatientIds(on ? [...patientIds, p.id] : patientIds.filter((id) => id !== p.id));
              }}
            />
          ))}
        </div>
      </Section>
      <Section title="Atendimento e dia">
        <div className="grid gap-4 sm:grid-cols-2">
          {options.units.length > 1 ? (
            <SelectField
              label="Unidade"
              value={unitId}
              options={options.units.map((u) => ({ value: u.id, label: u.name }))}
              onChange={(e) => {
                setUnitId(e.target.value);
                setSlot(null);
              }}
            />
          ) : null}
          <SelectField
            label="Atendimento"
            value={typeId}
            placeholder="Selecione"
            options={options.types.map((t) => ({
              value: t.id,
              label: `${t.name} (${String(t.durationMinutes)} min)`,
            }))}
            onChange={(e) => {
              setTypeId(e.target.value);
              setSlot(null);
            }}
          />
          <TextField
            label="Dia"
            type="date"
            min={options.firstDate}
            max={options.lastDate}
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setSlot(null);
            }}
          />
        </div>
      </Section>
      <Section
        title="Horário"
        description={
          type && date
            ? `${type.name} em ${formatCalendarDate(date)}`
            : 'Escolha o atendimento e o dia.'
        }
      >
        {!type || !date ? (
          <p className="text-sm text-ink-muted">Os horários livres aparecem aqui.</p>
        ) : slots.isPending ? (
          <SkeletonRows rows={2} columns={4} />
        ) : slots.isError ? (
          <ErrorState message={errorMessage(slots.error)} onRetry={() => void slots.refetch()} />
        ) : slots.data.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="Nenhum horário livre neste dia"
            description="Tente outro dia ou fale com a clínica."
          />
        ) : (
          <div className="space-y-4">
            {professionals.length > 1 ? (
              <div className="sm:max-w-xs">
                <SelectField
                  label="Profissional"
                  value={chosen}
                  options={[
                    { value: '', label: 'Sem preferência' },
                    ...professionals.map(([id, name]) => ({ value: id, label: name })),
                  ]}
                  onChange={(e) => {
                    setProfessionalId(e.target.value);
                    setSlot(null);
                  }}
                />
              </div>
            ) : null}
            <div
              role="radiogroup"
              aria-label="Horários livres"
              className="grid grid-cols-3 gap-2 sm:grid-cols-6"
            >
              {shown.map((s) => {
                const selected =
                  slot?.start === s.start && slot.professionalId === s.professionalId;
                return (
                  <button
                    key={`${s.start}-${s.professionalId}`}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={
                      chosen || professionals.length === 1
                        ? `${s.start} com ${s.professionalName}`
                        : s.start
                    }
                    onClick={() => {
                      setSlot(s);
                    }}
                    className={clsx(
                      'rounded-control border px-3 py-2 text-center transition-colors',
                      selected
                        ? 'border-sage-600 bg-sage-50 text-sage-700'
                        : 'border-line bg-surface hover:border-sage-600',
                    )}
                  >
                    <span className="font-mono text-sm font-medium">{s.start}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </Section>
      <Section title="Recado para a clínica">
        <TextareaField
          label="Observações (opcional)"
          rows={3}
          maxLength={500}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
          }}
        />
      </Section>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {slot && type && date ? (
          <p className="text-sm text-ink-muted">
            {type.name} em {formatCalendarDate(date)} às {slot.start} com {slot.professionalName}
          </p>
        ) : null}
        <Button type="submit" pending={book.isPending}>
          Confirmar agendamento
        </Button>
      </div>
    </form>
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
