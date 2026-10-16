import { loginRequestSchema, type LoginRequest } from '@clinica/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { CircleAlert } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Button } from '../../design-system/button';
import { TextField } from '../../design-system/field';
import { apiVoid, errorMessage } from '../../lib/api';
import { sessionQuery } from '../../lib/session';
import { ScheduleGrid } from './schedule-grid';

export function LoginPage({ redirectTo }: { redirectTo: string | undefined }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const form = useForm<LoginRequest>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: '', password: '' },
  });
  const login = useMutation({
    mutationFn: (values: LoginRequest) => apiVoid('POST', '/auth/login', values),
    onSuccess: async () => {
      await queryClient.query({ ...sessionQuery, staleTime: 0 });
      // Só aceita destinos internos para não virar redirecionamento aberto.
      const target = redirectTo?.startsWith('/') && !redirectTo.startsWith('//') ? redirectTo : '/';
      await navigate({ to: target });
    },
  });
  const { errors } = form.formState;

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-sage-900 p-12 text-sage-50 lg:flex">
        <p className="font-display text-lg font-semibold tracking-tight text-white">Clínica Vet</p>
        <div className="space-y-8">
          <ScheduleGrid />
          <div className="max-w-md space-y-3">
            <h2 className="font-display text-[34px] leading-[1.1] font-semibold tracking-[-0.02em] text-white">
              Do balcão à alta, cada etapa registrada com hora e autor.
            </h2>
            <p className="text-sm leading-relaxed text-sage-100/75">
              Agenda, prontuário, internação, vendas e financeiro no mesmo lugar.
            </p>
          </div>
        </div>
        <p className="font-mono text-[11px] text-sage-100/50">
          Acesso restrito à equipe da clínica
        </p>
      </section>

      <section className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <p className="mb-8 font-display text-lg font-semibold text-sage-700 lg:hidden">
            Clínica Vet
          </p>
          <h1 className="font-display text-2xl font-semibold tracking-[-0.01em] text-ink">
            Entrar
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Use o e-mail e a senha cadastrados pelo administrador.
          </p>

          <form
            noValidate
            className="mt-8 space-y-4"
            onSubmit={form.handleSubmit((values) => {
              login.mutate(values);
            })}
          >
            {login.isError ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-control border border-danger-600/25 bg-danger-50 px-3 py-2.5 text-sm text-danger-600"
              >
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                {errorMessage(login.error)}
              </div>
            ) : null}
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
          </form>
        </div>
      </section>
    </div>
  );
}
