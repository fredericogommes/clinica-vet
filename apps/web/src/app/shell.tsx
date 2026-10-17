import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { Building2, Check, ChevronsUpDown, LogOut, Menu, X } from 'lucide-react';
import { Suspense, useState } from 'react';
import { apiVoid, errorMessage } from '../lib/api';
import { useCan, useSession } from '../lib/session';
import { SkeletonRows } from '../design-system/states';
import { useToast } from '../design-system/toast';
import { navigation } from './navigation';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function UnitSwitcher() {
  const session = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const switchUnit = useMutation({
    mutationFn: (unitId: string) => apiVoid('POST', '/auth/unit', { unitId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      toast.success('Unidade alterada.');
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });

  return (
    <Dropdown.Root>
      <Dropdown.Trigger
        className="flex w-full items-center gap-2.5 rounded-control px-2 py-2 text-left hover:bg-sage-700/60"
        disabled={switchUnit.isPending}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sage-500/40">
          <Building2 className="size-4 text-sage-50" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-white">
            {session.organization.name}
          </span>
          <span className="block truncate text-xs text-sage-100/80">
            {session.currentUnit.name}
          </span>
        </span>
        {session.units.length > 1 ? (
          <ChevronsUpDown className="size-4 text-sage-100/70" aria-hidden />
        ) : null}
      </Dropdown.Trigger>
      {session.units.length > 1 ? (
        <Dropdown.Portal>
          <Dropdown.Content
            align="start"
            sideOffset={6}
            className="z-50 min-w-56 rounded-panel border border-line bg-surface p-1 shadow-overlay"
          >
            <Dropdown.Label className="px-2 py-1.5 text-xs text-ink-muted">
              Trocar unidade
            </Dropdown.Label>
            {session.units.map((unit) => (
              <Dropdown.Item
                key={unit.id}
                onSelect={() => {
                  if (unit.id !== session.currentUnit.id) switchUnit.mutate(unit.id);
                }}
                className="flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-sm outline-none data-highlighted:bg-sunken"
              >
                {unit.name}
                {unit.id === session.currentUnit.id ? (
                  <Check className="size-4 text-sage-600" aria-hidden />
                ) : null}
              </Dropdown.Item>
            ))}
          </Dropdown.Content>
        </Dropdown.Portal>
      ) : null}
    </Dropdown.Root>
  );
}

function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const can = useCan();
  const session = useSession();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const logout = useMutation({
    mutationFn: () => apiVoid('POST', '/auth/logout'),
    onSuccess: async () => {
      queryClient.clear();
      await navigate({ to: '/entrar' });
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });

  // Só o item mais específico fica ativo: /financeiro/contas não acende /financeiro.
  const current = navigation
    .flatMap((section) => section.items)
    .filter((item) =>
      item.to === '/'
        ? pathname === '/'
        : pathname === item.to || pathname.startsWith(`${item.to}/`),
    )
    .sort((a, b) => b.to.length - a.to.length)[0]?.to;

  return (
    <div className="flex h-full flex-col bg-sage-900 text-sage-50">
      <div className="border-b border-white/10 p-3">
        <UnitSwitcher />
      </div>
      <nav aria-label="Principal" className="flex-1 overflow-y-auto px-3 py-4">
        {navigation.map((section) => {
          const items = section.items.filter((item) => !item.permission || can(item.permission));
          if (items.length === 0) return null;
          return (
            <div key={section.label} className="mb-5">
              <p className="px-2 pb-1.5 font-mono text-[10.5px] tracking-[0.1em] text-sage-100/55 uppercase">
                {section.label}
              </p>
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const active = item.to === current;
                  return (
                    <li key={item.to}>
                      <Link
                        to={item.to}
                        onClick={onNavigate}
                        aria-current={active ? 'page' : undefined}
                        activeOptions={{ exact: true, includeSearch: false }}
                        className={clsx(
                          'relative flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13.5px] transition-colors',
                          active
                            ? 'bg-white/10 font-medium text-white before:absolute before:top-1.5 before:bottom-1.5 before:-left-3 before:w-[3px] before:rounded-r before:bg-amber-500'
                            : 'text-sage-100/80 hover:bg-white/5 hover:text-white',
                        )}
                      >
                        <item.icon className="size-4 shrink-0" aria-hidden />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="flex items-center gap-2.5 border-t border-white/10 p-3">
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sage-100 text-xs font-semibold text-sage-900"
          aria-hidden
        >
          {initials(session.user.name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-white">{session.user.name}</span>
          <span className="block truncate text-xs text-sage-100/70">{session.user.email}</span>
        </span>
        <button
          type="button"
          onClick={() => {
            logout.mutate();
          }}
          disabled={logout.isPending}
          className="rounded-md p-1.5 text-sage-100/70 hover:bg-white/10 hover:text-white"
          aria-label="Sair"
          title="Sair"
        >
          <LogOut className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const close = () => {
    setMobileOpen(false);
  };
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-dvh lg:block">
        <Sidebar onNavigate={close} />
      </aside>

      <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface px-4 lg:hidden">
        <button
          type="button"
          onClick={() => {
            setMobileOpen(true);
          }}
          aria-label="Abrir menu"
          aria-expanded={mobileOpen}
          className="rounded-md p-1.5 text-ink hover:bg-sunken"
        >
          <Menu className="size-5" aria-hidden />
        </button>
        <span className="font-display font-semibold">Clínica Vet</span>
      </div>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
        >
          <div className="absolute inset-0 bg-ink/40" onClick={close} aria-hidden />
          <div className="absolute inset-y-0 left-0 w-[min(280px,85vw)]">
            <Sidebar onNavigate={close} />
            <button
              type="button"
              onClick={close}
              aria-label="Fechar menu"
              className="absolute top-3 -right-11 rounded-md bg-surface p-1.5 text-ink"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
        </div>
      ) : null}

      <main className="min-w-0 px-4 py-6 sm:px-8 sm:py-8">
        <div className="mx-auto max-w-6xl">
          <Suspense fallback={<SkeletonRows />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
