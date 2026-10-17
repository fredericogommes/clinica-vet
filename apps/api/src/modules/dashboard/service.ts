import {
  clientActiveDays,
  clientAttentionDays,
  dashboardWidgetPermissions,
  dashboardWidgets,
  type Dashboard,
  type DashboardLayout,
  type DashboardWidget,
} from '@clinica/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { addMonths, instantToZoned, zonedToInstant } from '../../core/zoned-time.js';
import type { Database } from '../../db/client.js';
import { dashboardLayouts } from '../../db/schema.js';
import type { AuthContext } from '../auth/sessions.js';
import type { SalesReportService } from '../sales/reports.js';
import { unitTimeZone } from '../scheduling/availability.js';

type Row = Record<string, unknown>;
type Layout = DashboardLayout['widgets'];

const int = (value: unknown) => Number(value ?? 0);
const money = (value: unknown) => Math.round(Number(value ?? 0) * 100) / 100;
const iso = (value: unknown) =>
  (value instanceof Date ? value : new Date(String(value))).toISOString();
const text = (value: unknown) => (typeof value === 'string' ? value : null);

/** Meses do gráfico: os 12 últimos, com o corrente. */
const MONTHS = 12;
/** Anos do gráfico de crescimento acumulado. */
const YEARS = 10;
const LIST_LIMIT = 10;
const LOW_STOCK_LIMIT = 20;

/**
 * Widgets liberados ao perfil, na ordem que o usuário salvou. Widget recém-liberado (ou que o
 * usuário nunca viu) entra ligado no fim; widget que o perfil perdeu sai da montagem.
 */
export function resolveLayout(saved: Layout | null, can: (w: DashboardWidget) => boolean): Layout {
  const allowed = dashboardWidgets.filter(can);
  const known = (saved ?? []).filter((w) => allowed.includes(w.id));
  const missing = allowed.filter((id) => !known.some((w) => w.id === id));
  return [...known, ...missing.map((id) => ({ id, visible: true }))];
}

/**
 * Painel de controle [p.3]: indicadores e widgets da aba Principal, cada um liberado por uma
 * chave do perfil e montado (ordem e liga/desliga) por usuário.
 */
export class DashboardService {
  constructor(
    private readonly db: Database,
    private readonly reports: SalesReportService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async rows(query: SQL): Promise<Row[]> {
    return (await this.db.execute<Row>(query)).rows;
  }

  private async savedLayout(auth: AuthContext): Promise<Layout | null> {
    const [row] = await this.db
      .select({ widgets: dashboardLayouts.widgets })
      .from(dashboardLayouts)
      .where(sql`${dashboardLayouts.userId} = ${auth.userId}`);
    return (row?.widgets as Layout | undefined) ?? null;
  }

  private canSee(auth: AuthContext) {
    return (w: DashboardWidget) => auth.permissions.has(dashboardWidgetPermissions[w]);
  }

  async layout(auth: AuthContext): Promise<Layout> {
    return resolveLayout(await this.savedLayout(auth), this.canSee(auth));
  }

  /** Grava a montagem; só os widgets liberados ao perfil são aceitos. */
  async saveLayout(auth: AuthContext, input: DashboardLayout): Promise<Layout> {
    const layout = resolveLayout(input.widgets, this.canSee(auth));
    await this.db
      .insert(dashboardLayouts)
      .values({ userId: auth.userId, organizationId: auth.organizationId, widgets: layout })
      .onConflictDoUpdate({
        target: dashboardLayouts.userId,
        set: { widgets: layout, updatedAt: sql`now()` },
      });
    return layout;
  }

  async get(auth: AuthContext): Promise<Dashboard> {
    const tz = await unitTimeZone(this.db, auth.unitId);
    const now = this.now();
    const today = instantToZoned(now, tz).date;
    const monthStart = `${today.slice(0, 7)}-01`;
    const months = Array.from({ length: MONTHS }, (_, i) =>
      addMonths(monthStart, i - MONTHS + 1).slice(0, 7),
    );
    const windowStart = zonedToInstant(`${months[0]}-01`, 0, tz);
    const layout = await this.layout(auth);
    const on = (w: DashboardWidget) => layout.some((l) => l.id === w && l.visible);
    const ctx = { auth, tz, now, today, monthStart, months, windowStart };

    const [base, sales, data] = await Promise.all([
      auth.permissions.has('dashboard.indicators') ? this.baseIndicators(ctx) : null,
      auth.permissions.has('dashboard.sales_indicators') ? this.salesIndicators(ctx) : null,
      this.widgets(ctx, on),
    ]);
    return { month: today.slice(0, 7), layout, indicators: { base, sales }, data };
  }

  private async baseIndicators({ auth, tz, monthStart }: Ctx) {
    const start = zonedToInstant(monthStart, 0, tz).toISOString();
    const [counts, agenda, files] = await Promise.all([
      this.rows(sql`select
        (select count(*) from patients where organization_id = ${auth.organizationId}
          and archived_at is null and status = 'alive') as patients,
        (select count(*) from clients where organization_id = ${auth.organizationId}
          and archived_at is null) as clients`),
      // Mesma regra da agenda: espera = chegada → início; atendimento = início → animal pronto.
      this.rows(sql`select
        round(avg(extract(epoch from started_at - arrived_at) / 60)
          filter (where started_at >= arrived_at)) as wait,
        round(avg(extract(epoch from ready_at - started_at) / 60)
          filter (where ready_at >= started_at)) as service
        from appointments
        where unit_id = ${auth.unitId} and organization_id = ${auth.organizationId}
          and starts_at >= ${start}`),
      this.rows(sql`select count(*) as count, coalesce(sum(byte_size), 0) as bytes
        from clinical_files where organization_id = ${auth.organizationId}`),
    ]);
    const c = counts[0] ?? {};
    const a = agenda[0] ?? {};
    const f = files[0] ?? {};
    return {
      patients: int(c.patients),
      clients: int(c.clients),
      averageWaitMinutes: a.wait === null || a.wait === undefined ? null : int(a.wait),
      averageServiceMinutes: a.service === null || a.service === undefined ? null : int(a.service),
      files: { count: int(f.count), bytes: int(f.bytes) },
    };
  }

  private async salesIndicators({ auth, today, monthStart }: Ctx) {
    const [summary, debts] = await Promise.all([
      this.reports.summary(auth, { from: monthStart, to: today }),
      // Vendas em aberto e o que ficou na conta do cliente nas baixadas [p.10].
      this.rows(sql`select coalesce(sum(s.net_total - coalesce((select sum(p.amount)
          from sale_payments p where p.sale_id = s.id and p.reversed_at is null
            and p.kind <> 'account'), 0)), 0) as open
        from sales s
        where s.organization_id = ${auth.organizationId} and s.unit_id = ${auth.unitId}
          and s.status in ('open', 'closed')`),
    ]);
    return {
      net: summary.totals.net,
      discountPercent: summary.totals.discountPercent,
      averageTicket: summary.totals.averageTicket,
      clientDebts: money(debts[0]?.open),
    };
  }

  private async widgets(ctx: Ctx, on: (w: DashboardWidget) => boolean) {
    const [byMonth, byYear, consultations, encounters, patients, lifecycle, stock, logins] =
      await Promise.all([
        on('patients_by_month') ? this.patientsByMonth(ctx) : undefined,
        on('patients_by_year') ? this.patientsByYear(ctx) : undefined,
        on('consultations_by_month') ? this.consultationsByMonth(ctx) : undefined,
        on('recent_encounters') ? this.recentEncounters(ctx) : undefined,
        on('recent_patients') ? this.recentPatients(ctx) : undefined,
        on('client_lifecycle') ? this.clientLifecycle(ctx) : undefined,
        on('low_stock') ? this.lowStock(ctx) : undefined,
        on('recent_logins') ? this.recentLogins(ctx) : undefined,
      ]);
    return {
      patientsByMonth: byMonth,
      patientsByYear: byYear,
      consultationsByMonth: consultations,
      recentEncounters: encounters,
      recentPatients: patients,
      clientLifecycle: lifecycle,
      lowStock: stock,
      recentLogins: logins,
    };
  }

  private fill(months: string[], rows: Row[]) {
    const counts = new Map(rows.map((r) => [String(r.month), int(r.count)]));
    return months.map((month) => ({ month, count: counts.get(month) ?? 0 }));
  }

  /** Animais cadastrados por mês, inclusive os depois arquivados: é o crescimento da base. */
  private async patientsByMonth({ auth, tz, months, windowStart }: Ctx) {
    const rows = await this.rows(sql`
      select to_char(created_at at time zone ${tz}, 'YYYY-MM') as month, count(*) as count
      from patients
      where organization_id = ${auth.organizationId} and created_at >= ${windowStart.toISOString()}
      group by 1`);
    return this.fill(months, rows);
  }

  private async patientsByYear({ auth, tz, today }: Ctx) {
    const rows = await this.rows(sql`
      select extract(year from created_at at time zone ${tz})::int as year, count(*) as count
      from patients where organization_id = ${auth.organizationId}
      group by 1 order by 1`);
    const added = new Map(rows.map((r) => [int(r.year), int(r.count)]));
    const current = Number(today.slice(0, 4));
    const first = Math.min(...added.keys(), current);
    let total = 0;
    const years = [];
    for (let year = first; year <= current; year++) {
      total += added.get(year) ?? 0;
      years.push({ year, added: added.get(year) ?? 0, total });
    }
    return years.slice(-YEARS);
  }

  /** Consultas pela classificação do serviço, não pelo nome [p.3]; quantidade vendida no mês. */
  private async consultationsByMonth({ auth, tz, months, windowStart }: Ctx) {
    const rows = await this.rows(sql`
      select to_char(s.sold_at at time zone ${tz}, 'YYYY-MM') as month,
        round(sum(i.quantity)) as count
      from sales s join sale_items i on i.sale_id = s.id
      where s.organization_id = ${auth.organizationId} and s.unit_id = ${auth.unitId}
        and s.status in ('open', 'closed') and i.service_kind = 'consultation'
        and s.sold_at >= ${windowStart.toISOString()}
      group by 1`);
    return this.fill(months, rows);
  }

  /** Atendimentos finalizados nas últimas 24 horas na unidade; rascunho e invalidado ficam fora. */
  private async recentEncounters({ auth, now }: Ctx) {
    const since = new Date(now.getTime() - 24 * 3_600_000).toISOString();
    const rows = await this.rows(sql`
      select e.id, e.occurred_at, p.id as patient_id, p.name as patient_name,
        c.id as client_id, c.name as client_name, u.name as professional_name, t.name as type_name
      from clinical_events e
      join patients p on p.id = e.patient_id
      join clients c on c.id = p.client_id
      join users u on u.id = e.author_id
      left join appointment_types t on t.id = e.appointment_type_id
      where e.organization_id = ${auth.organizationId} and e.unit_id = ${auth.unitId}
        and e.kind = 'encounter' and e.status = 'published' and e.occurred_at >= ${since}
      order by e.occurred_at desc, e.id desc
      limit ${LIST_LIMIT}`);
    return rows.map((r) => ({
      eventId: String(r.id),
      occurredAt: iso(r.occurred_at),
      patientId: String(r.patient_id),
      patientName: String(r.patient_name),
      clientId: String(r.client_id),
      clientName: String(r.client_name),
      professionalName: String(r.professional_name),
      typeName: text(r.type_name),
    }));
  }

  private async recentPatients({ auth }: Ctx) {
    const rows = await this.rows(sql`
      select p.id, p.code, p.name, s.name as species_name, c.id as client_id,
        c.name as client_name, p.created_at
      from patients p
      join clients c on c.id = p.client_id
      left join species s on s.id = p.species_id
      where p.organization_id = ${auth.organizationId} and p.archived_at is null
      order by p.created_at desc, p.code desc
      limit ${LIST_LIMIT}`);
    return rows.map((r) => ({
      patientId: String(r.id),
      code: int(r.code),
      name: String(r.name),
      speciesName: text(r.species_name),
      clientId: String(r.client_id),
      clientName: String(r.client_name),
      createdAt: iso(r.created_at),
    }));
  }

  /**
   * Ciclo de vida [p.3]: no fim de cada mês (ou agora, no corrente), cliente ativo teve venda ou
   * atendimento finalizado nos 180 dias anteriores; precisa de atenção, entre 181 e 365 dias.
   * Cliente arquivado fica de fora.
   */
  private async clientLifecycle({ auth, tz, now, months }: Ctx) {
    const refs = months.map((month, i) =>
      i === months.length - 1
        ? { month, at: now }
        : { month, at: zonedToInstant(addMonths(`${month}-01`, 1), 0, tz) },
    );
    const values = sql.join(
      refs.map((r) => sql`(${r.month}, ${r.at.toISOString()}::timestamptz)`),
      sql`, `,
    );
    const rows = await this.rows(sql`
      with refs(month, at) as (values ${values}),
      act as (
        select s.client_id, s.sold_at as at from sales s
        where s.organization_id = ${auth.organizationId} and s.status in ('open', 'closed')
          and s.client_id is not null
        union all
        select p.client_id, e.occurred_at from clinical_events e
        join patients p on p.id = e.patient_id
        where e.organization_id = ${auth.organizationId} and e.status = 'published'
      ),
      last as (
        select r.month, r.at as ref, a.client_id, max(a.at) as last
        from refs r join act a on a.at < r.at
        join clients c on c.id = a.client_id and c.archived_at is null
        group by r.month, r.at, a.client_id
      )
      select month,
        count(*) filter (where last >= ref - make_interval(days => ${clientActiveDays})) as active,
        count(*) filter (where last < ref - make_interval(days => ${clientActiveDays})
          and last >= ref - make_interval(days => ${clientAttentionDays})) as attention
      from last group by month`);
    const byMonth = new Map(rows.map((r) => [String(r.month), r]));
    return months.map((month) => ({
      month,
      active: int(byMonth.get(month)?.active),
      attention: int(byMonth.get(month)?.attention),
    }));
  }

  /** Mesma regra do alerta da lista de produtos: saldo da unidade abaixo do mínimo. */
  private async lowStock({ auth }: Ctx) {
    const rows = await this.rows(sql`
      select p.id, p.code, p.name, p.unit, coalesce(b.on_hand, 0) as on_hand, p.min_stock
      from products p
      left join stock_balances b on b.product_id = p.id and b.unit_id = ${auth.unitId}
      where p.organization_id = ${auth.organizationId} and p.archived_at is null
        and p.tracks_stock and p.min_stock is not null
        and coalesce(b.on_hand, 0) < p.min_stock
      order by coalesce(b.on_hand, 0) / nullif(p.min_stock, 0) nulls last, p.name
      limit ${LOW_STOCK_LIMIT}`);
    return rows.map((r) => ({
      productId: String(r.id),
      code: int(r.code),
      name: String(r.name),
      unit: r.unit as NonNullable<Dashboard['data']['lowStock']>[number]['unit'],
      onHand: Math.round(Number(r.on_hand) * 1000) / 1000,
      minStock: Math.round(Number(r.min_stock) * 1000) / 1000,
    }));
  }

  /** Entradas no sistema registradas na auditoria. */
  private async recentLogins({ auth }: Ctx) {
    const rows = await this.rows(sql`
      select u.id as user_id, u.name, a.occurred_at
      from audit_log a join users u on u.id = a.actor_user_id
      where a.organization_id = ${auth.organizationId} and a.entity = 'session'
        and a.action = 'login'
      order by a.occurred_at desc
      limit ${LIST_LIMIT}`);
    return rows.map((r) => ({
      userId: String(r.user_id),
      name: String(r.name),
      at: iso(r.occurred_at),
    }));
  }
}

interface Ctx {
  auth: AuthContext;
  tz: string;
  now: Date;
  today: string;
  monthStart: string;
  months: string[];
  windowStart: Date;
}
