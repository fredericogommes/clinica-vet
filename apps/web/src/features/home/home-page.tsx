import {
  dashboardLayoutSchema,
  dashboardSchema,
  dashboardWidgetLabels,
  type Dashboard,
  type DashboardLayout,
  type DashboardWidget,
} from '@clinica/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Hourglass,
  LayoutDashboard,
  PackageCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { navigation } from '../../app/navigation';
import { Button } from '../../design-system/button';
import { AreaChart, BarChart } from '../../design-system/chart';
import { Checkbox } from '../../design-system/checkbox';
import { Dialog } from '../../design-system/dialog';
import { PageHeader, Panel } from '../../design-system/layout';
import { EmptyState, ErrorState, SkeletonRows } from '../../design-system/states';
import { useToast } from '../../design-system/toast';
import { api, errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useCan, useSession } from '../../lib/session';
import { formatMoney, quantityInput } from '../products/format';

export const dashboardQuery = queryOptions({
  queryKey: ['dashboard'],
  queryFn: () => api('GET', '/dashboard', dashboardSchema),
});

const monthNames = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];
/** "2026-10" → "out". */
const monthLabel = (month: string) => monthNames[Number(month.slice(5, 7)) - 1] ?? month;

const minutes = (value: number | null) => (value === null ? '—' : `${String(value)} min`);
const percent = (value: number) =>
  `${value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`;
const count = (value: number) => value.toLocaleString('pt-BR');

function bytes(value: number): string {
  if (value < 1024) return `${String(value)} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = value / 1024;
  let unit = 0;
  while (v >= 1024 && unit < units.length - 1) {
    v /= 1024;
    unit++;
  }
  return `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${units[unit] ?? 'GB'}`;
}

/** Painel de controle [p.3]: indicadores à direita e widgets montados por usuário. */
export function HomePage() {
  const session = useSession();
  const dashboard = useQuery(dashboardQuery);
  const [configuring, setConfiguring] = useState(false);
  const firstName = session.user.name.split(' ')[0] ?? session.user.name;
  const layout = dashboard.data?.layout ?? [];

  return (
    <>
      <PageHeader
        area={session.currentUnit.name}
        title={`Olá, ${firstName}`}
        description="Painel de controle da unidade."
        actions={
          layout.length > 0 ? (
            <Button
              variant="secondary"
              icon={<SlidersHorizontal className="size-4" aria-hidden />}
              onClick={() => {
                setConfiguring(true);
              }}
            >
              Configurar
            </Button>
          ) : null
        }
      />
      {dashboard.isPending ? (
        <Panel>
          <SkeletonRows rows={6} columns={3} />
        </Panel>
      ) : dashboard.isError ? (
        <Panel>
          <ErrorState
            message={errorMessage(dashboard.error)}
            onRetry={() => void dashboard.refetch()}
          />
        </Panel>
      ) : (
        <DashboardBody dashboard={dashboard.data} />
      )}
      {dashboard.data ? (
        <ConfigureDialog
          open={configuring}
          onOpenChange={setConfiguring}
          layout={dashboard.data.layout}
        />
      ) : null}
    </>
  );
}

function DashboardBody({ dashboard }: { dashboard: Dashboard }) {
  const visible = dashboard.layout.filter((w) => w.visible);
  const { base, sales } = dashboard.indicators;
  if (!base && !sales && dashboard.layout.length === 0) return <Shortcuts />;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
      {base || sales ? (
        <div className="lg:order-2">
          <Indicators dashboard={dashboard} />
        </div>
      ) : null}
      <div className="min-w-0 lg:order-1">
        {visible.length === 0 ? (
          <Panel>
            <EmptyState
              icon={LayoutDashboard}
              title="Nenhum widget ligado"
              description="Use Configurar para escolher o que aparece no seu painel."
            />
          </Panel>
        ) : (
          <div className="grid items-start gap-5 xl:grid-cols-2">
            {visible.map((w) => (
              <Widget key={w.id} id={w.id} dashboard={dashboard} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Coluna de indicadores, sempre visível [p.3]; cada grupo depende da sua chave. */
function Indicators({ dashboard }: { dashboard: Dashboard }) {
  const { base, sales } = dashboard.indicators;
  const items: { label: string; value: string; detail?: string }[] = [];
  if (base) {
    items.push(
      { label: 'Animais', value: count(base.patients) },
      { label: 'Responsáveis', value: count(base.clients) },
    );
  }
  if (sales) {
    items.push(
      { label: 'Venda líquida no mês', value: formatMoney(sales.net) },
      { label: 'Débitos de clientes', value: formatMoney(sales.clientDebts) },
      { label: 'Descontos no mês', value: percent(sales.discountPercent) },
      { label: 'Ticket médio no mês', value: formatMoney(sales.averageTicket) },
    );
  }
  if (base) {
    items.push(
      { label: 'Média de espera no mês', value: minutes(base.averageWaitMinutes) },
      { label: 'Média de atendimento no mês', value: minutes(base.averageServiceMinutes) },
      {
        label: 'Em arquivos',
        value: bytes(base.files.bytes),
        detail: `${count(base.files.count)} ${base.files.count === 1 ? 'anexo' : 'anexos'}`,
      },
    );
  }
  return (
    <Panel>
      <h2 className="border-b border-line px-4 py-3 text-sm font-medium">Indicadores</h2>
      <dl
        aria-label="Indicadores"
        className="grid grid-cols-2 divide-line sm:grid-cols-3 lg:grid-cols-1 lg:divide-y"
      >
        {items.map((item) => (
          <div key={item.label} className="min-w-0 px-4 py-2.5">
            <dt className="text-xs text-ink-muted">{item.label}</dt>
            <dd className="mt-0.5 font-mono text-base font-medium break-words text-ink tabular-nums">
              {item.value}
            </dd>
            {item.detail ? <dd className="text-xs text-ink-muted">{item.detail}</dd> : null}
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function WidgetPanel({
  id,
  description,
  children,
}: {
  id: DashboardWidget;
  description?: string;
  children: ReactNode;
}) {
  const titleId = `widget-${id}`;
  return (
    <Panel labelledBy={titleId} className="min-w-0">
      <div className="border-b border-line px-4 py-3">
        <h2 id={titleId} className="text-sm font-medium">
          {dashboardWidgetLabels[id]}
        </h2>
        {description ? <p className="text-xs text-ink-muted">{description}</p> : null}
      </div>
      <div className="p-4">{children}</div>
    </Panel>
  );
}

function EmptyList({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-ink-muted">{children}</p>;
}

function Widget({ id, dashboard }: { id: DashboardWidget; dashboard: Dashboard }) {
  const can = useCan();
  const d = dashboard.data;
  switch (id) {
    case 'patients_by_month': {
      const rows = d.patientsByMonth ?? [];
      return (
        <WidgetPanel id={id} description="Cadastros de animais nos últimos 12 meses.">
          <BarChart
            caption="Animais cadastrados por mês"
            labels={rows.map((r) => monthLabel(r.month))}
            series={[{ name: 'Animais', tone: 'sage' }]}
            values={rows.map((r) => [r.count])}
          />
        </WidgetPanel>
      );
    }
    case 'patients_by_year': {
      const rows = d.patientsByYear ?? [];
      return (
        <WidgetPanel id={id} description="Total acumulado de animais no fim de cada ano.">
          {rows.length < 2 ? (
            // Um ano só não forma curva: mostra a coluna do total.
            <BarChart
              caption="Animais acumulados por ano"
              labels={rows.map((r) => String(r.year))}
              series={[{ name: 'Animais', tone: 'sage' }]}
              values={rows.map((r) => [r.total])}
            />
          ) : (
            <AreaChart
              caption="Animais acumulados por ano"
              name="Animais"
              labels={rows.map((r) => String(r.year))}
              values={rows.map((r) => r.total)}
            />
          )}
        </WidgetPanel>
      );
    }
    case 'consultations_by_month': {
      const rows = d.consultationsByMonth ?? [];
      return (
        <WidgetPanel
          id={id}
          description="Serviços classificados como consulta vendidos nesta unidade."
        >
          <BarChart
            caption="Consultas vendidas por mês"
            labels={rows.map((r) => monthLabel(r.month))}
            series={[{ name: 'Consultas', tone: 'sage' }]}
            values={rows.map((r) => [r.count])}
          />
        </WidgetPanel>
      );
    }
    case 'client_lifecycle': {
      const rows = d.clientLifecycle ?? [];
      return (
        <WidgetPanel
          id={id}
          description="Ativo: venda ou atendimento nos últimos 180 dias. Precisa de atenção: entre 181 e 365 dias."
        >
          <BarChart
            caption="Ciclo de vida dos clientes por mês"
            labels={rows.map((r) => monthLabel(r.month))}
            series={[
              { name: 'Ativos', tone: 'sage' },
              { name: 'Precisam de atenção', tone: 'amber' },
            ]}
            values={rows.map((r) => [r.active, r.attention])}
          />
        </WidgetPanel>
      );
    }
    case 'recent_encounters': {
      const rows = d.recentEncounters ?? [];
      return (
        <WidgetPanel id={id} description="Atendimentos finalizados nas últimas 24 horas.">
          {rows.length === 0 ? (
            <EmptyList>Nenhum atendimento finalizado nas últimas 24 horas.</EmptyList>
          ) : (
            <ul className="-my-2 divide-y divide-line">
              {rows.map((r) => (
                <li key={r.eventId} className="flex items-start gap-3 py-2 text-sm">
                  <span className="w-12 shrink-0 font-mono text-xs text-ink-muted">
                    {formatDateTime(r.occurredAt).slice(-5)}
                  </span>
                  <span className="min-w-0 flex-1">
                    {can('clinical.view') ? (
                      <Link
                        to="/atendimento/$patientId"
                        params={{ patientId: r.patientId }}
                        className="font-medium text-sage-700 hover:underline"
                      >
                        {r.patientName}
                      </Link>
                    ) : (
                      <span className="font-medium">{r.patientName}</span>
                    )}
                    <span className="text-ink-muted"> · {r.clientName}</span>
                    <span className="block text-xs text-ink-muted">
                      {[r.typeName, r.professionalName].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </WidgetPanel>
      );
    }
    case 'recent_patients': {
      const rows = d.recentPatients ?? [];
      return (
        <WidgetPanel id={id}>
          {rows.length === 0 ? (
            <EmptyList>Nenhum animal cadastrado ainda.</EmptyList>
          ) : (
            <ul className="-my-2 divide-y divide-line">
              {rows.map((r) => (
                <li key={r.patientId} className="flex items-start gap-3 py-2 text-sm">
                  <span className="w-12 shrink-0 font-mono text-xs text-ink-muted">
                    {formatDateTime(r.createdAt).slice(0, 5)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <Link
                      to="/animais/$patientId"
                      params={{ patientId: r.patientId }}
                      className="font-medium text-sage-700 hover:underline"
                    >
                      {r.name}
                    </Link>
                    {r.speciesName ? (
                      <span className="text-ink-muted"> · {r.speciesName}</span>
                    ) : null}
                    <span className="block text-xs text-ink-muted">{r.clientName}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </WidgetPanel>
      );
    }
    case 'low_stock': {
      const rows = d.lowStock ?? [];
      return (
        <WidgetPanel id={id} description="Saldo desta unidade abaixo do estoque mínimo.">
          {rows.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-ink-muted">
              <PackageCheck className="size-4 text-success-600" aria-hidden />
              Nenhum produto abaixo do mínimo.
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Produtos abaixo do estoque mínimo</caption>
              <thead>
                <tr className="border-b border-line text-xs text-ink-muted">
                  <th scope="col" className="py-1.5 font-medium">
                    Produto
                  </th>
                  <th scope="col" className="py-1.5 text-right font-medium">
                    Saldo
                  </th>
                  <th scope="col" className="py-1.5 text-right font-medium">
                    Mínimo
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.productId}>
                    <td className="py-1.5 pr-2">
                      <Link
                        to="/estoque/produtos/$productId"
                        params={{ productId: r.productId }}
                        className="text-sage-700 hover:underline"
                      >
                        {r.name}
                      </Link>
                    </td>
                    <td className="py-1.5 text-right font-mono text-danger-600 tabular-nums">
                      {quantityInput(r.onHand)} {r.unit}
                    </td>
                    <td className="py-1.5 text-right font-mono text-ink-muted tabular-nums">
                      {quantityInput(r.minStock)} {r.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </WidgetPanel>
      );
    }
    case 'recent_logins': {
      const rows = d.recentLogins ?? [];
      return (
        <WidgetPanel id={id} description="Entradas no sistema registradas na auditoria.">
          {rows.length === 0 ? (
            <EmptyList>Nenhum acesso registrado.</EmptyList>
          ) : (
            <ul className="-my-2 divide-y divide-line">
              {rows.map((r, i) => (
                <li
                  key={`${r.userId}-${r.at}-${String(i)}`}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate">{r.name}</span>
                  <span className="shrink-0 font-mono text-xs text-ink-muted">
                    {formatDateTime(r.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </WidgetPanel>
      );
    }
  }
}

/** Configurar [p.3]: liga, desliga e reordena os widgets liberados ao perfil. */
function ConfigureDialog({
  open,
  onOpenChange,
  layout,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layout: DashboardLayout['widgets'];
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState(layout);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setDraft(layout);
  }
  const save = useMutation({
    mutationFn: () => api('PUT', '/dashboard/layout', dashboardLayoutSchema, { widgets: draft }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: dashboardQuery.queryKey });
      toast.success('Painel atualizado.');
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
  const move = (index: number, delta: number) => {
    setDraft((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      if (item) next.splice(index + delta, 0, item);
      return next;
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Configurar painel"
      description="Escolha os widgets e a ordem em que aparecem. Vale só para você."
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancelar
          </Button>
          <Button
            pending={save.isPending}
            onClick={() => {
              save.mutate();
            }}
          >
            Salvar
          </Button>
        </>
      }
    >
      <ol className="divide-y divide-line" aria-label="Widgets do painel">
        {draft.map((w, i) => {
          const label = dashboardWidgetLabels[w.id];
          return (
            <li key={w.id} className="flex items-center gap-2 py-2">
              <div className="flex-1">
                <Checkbox
                  label={label}
                  checked={w.visible}
                  onCheckedChange={(visible) => {
                    setDraft((list) => list.map((x) => (x.id === w.id ? { ...x, visible } : x)));
                  }}
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Subir ${label}`}
                disabled={i === 0}
                icon={<ArrowUp className="size-4" aria-hidden />}
                onClick={() => {
                  move(i, -1);
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Descer ${label}`}
                disabled={i === draft.length - 1}
                icon={<ArrowDown className="size-4" aria-hidden />}
                onClick={() => {
                  move(i, 1);
                }}
              />
            </li>
          );
        })}
      </ol>
    </Dialog>
  );
}

/** Perfil sem indicadores nem widgets: atalhos para o que o perfil acessa. */
function Shortcuts() {
  const can = useCan();
  const shortcuts = navigation
    .flatMap((s) => s.items)
    .filter((item) => item.to !== '/' && (!item.permission || can(item.permission)));
  return shortcuts.length > 0 ? (
    <Panel>
      <h2 className="border-b border-line px-4 py-3 text-sm font-medium">
        Acessos disponíveis para o seu perfil
      </h2>
      <ul className="divide-y divide-line">
        {shortcuts.map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              className="group flex items-center gap-3 px-4 py-3 text-sm hover:bg-canvas"
            >
              <item.icon className="size-4 text-sage-600" aria-hidden />
              <span className="flex-1">{item.label}</span>
              <ArrowRight className="size-4 text-ink-faint group-hover:text-ink" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  ) : (
    <Panel>
      <EmptyState
        icon={Hourglass}
        title="Seu perfil ainda não tem módulos liberados"
        description="Peça ao administrador da clínica para liberar os módulos de que você precisa."
      />
    </Panel>
  );
}
