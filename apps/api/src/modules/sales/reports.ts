import type {
  MySales,
  SalesByItem,
  SalesByItemQuery,
  SalesPeriod,
  SalesSummary,
  SalesTotals,
} from '@clinica/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { addDays, zonedToInstant } from '../../core/zoned-time.js';
import type { Database } from '../../db/client.js';
import type { AuthContext } from '../auth/sessions.js';
import { unitTimeZone } from '../scheduling/availability.js';

/** Soma do PostgreSQL (numeric vem como texto) para reais com duas casas. */
const money = (value: unknown) => Math.round(Number(value ?? 0) * 100) / 100;
const int = (value: unknown) => Number(value ?? 0);
const pct = (part: number, whole: number) =>
  whole === 0 ? 0 : Math.round((part / whole) * 10_000) / 100;

type Row = Record<string, unknown>;

function totalsOf(r: Row): SalesTotals {
  const count = int(r.count);
  const gross = money(r.gross);
  const discount = money(r.discount);
  const net = money(r.net);
  return {
    count,
    gross,
    discount,
    discountPercent: pct(discount, gross),
    net,
    averageTicket: count === 0 ? 0 : Math.round((net / count) * 100) / 100,
    received: money(r.received),
    open: money(r.open),
  };
}

/**
 * Consulta vendas e Minhas vendas [p.9–10]. Conta as vendas em aberto e baixadas da unidade pela
 * data da venda, no fuso da unidade; orçamento e venda cancelada (inclusive a estornada) ficam
 * de fora. Os totais são somados no banco, em numeric, sem ponto flutuante.
 */
export class SalesReportService {
  constructor(private readonly db: Database) {}

  /** Filtro das vendas do período: CTE `s` com o recebido não estornado de cada venda. */
  private async base(auth: AuthContext, period: SalesPeriod): Promise<SQL> {
    const tz = await unitTimeZone(this.db, auth.unitId);
    const start = zonedToInstant(period.from, 0, tz);
    const end = zonedToInstant(addDays(period.to, 1), 0, tz);
    return sql`with s as (
      select sales.*, (sales.sold_at at time zone ${tz})::date as day,
        coalesce((select sum(p.amount) from sale_payments p
          where p.sale_id = sales.id and p.reversed_at is null and p.kind <> 'account'), 0)
          as received
      from sales
      where sales.organization_id = ${auth.organizationId}
        and sales.unit_id = ${auth.unitId}
        and sales.status in ('open', 'closed')
        and sales.sold_at >= ${start.toISOString()} and sales.sold_at < ${end.toISOString()}
    )`;
  }

  private async rows(query: SQL): Promise<Row[]> {
    return (await this.db.execute<Row>(query)).rows;
  }

  async summary(auth: AuthContext, period: SalesPeriod): Promise<SalesSummary> {
    const base = await this.base(auth, period);
    const totals = sql`count(*) as count, sum(s.gross_total) as gross,
      sum(s.discount_total) as discount, sum(s.net_total) as net, sum(s.received) as received,
      coalesce(sum(s.net_total - s.received), 0) as open`;
    const [all, days, methods, people, kinds] = await Promise.all([
      this.rows(sql`${base} select ${totals} from s`),
      this.rows(
        sql`${base} select s.day::text as date, ${totals} from s group by s.day order by s.day`,
      ),
      this.rows(sql`${base}
        select m.name as method_name, m.kind, count(*) as count,
          coalesce(sum(p.amount) filter (where p.installments = 1), 0) as upfront,
          coalesce(sum(p.amount) filter (where p.installments > 1), 0) as installments,
          sum(p.amount) as total
        from s join sale_payments p on p.sale_id = s.id and p.reversed_at is null
          and p.kind <> 'account'
        join payment_methods m on m.id = p.payment_method_id
        group by m.id, m.name, m.kind order by total desc, m.name`),
      this.rows(sql`${base}
        select u.id as user_id, u.name, count(distinct s.id) as sales_count,
          count(*) as items_count, sum(i.net_total) as net
        from s join sale_items i on i.sale_id = s.id join users u on u.id = i.professional_id
        group by u.id, u.name order by net desc, u.name`),
      this.rows(sql`${base}
        select i.kind, count(distinct s.id) as sales_count, count(*) as items_count,
          sum(i.net_total) as net
        from s join sale_items i on i.sale_id = s.id
        group by i.kind order by i.kind`),
    ]);
    return {
      totals: totalsOf(all[0] ?? {}),
      byDay: days.map((d) => ({ date: String(d.date), ...totalsOf(d) })),
      byMethod: methods.map((m) => ({
        methodName: String(m.method_name),
        kind: m.kind as SalesSummary['byMethod'][number]['kind'],
        count: int(m.count),
        upfront: money(m.upfront),
        installments: money(m.installments),
        total: money(m.total),
      })),
      byProfessional: people.map((p) => ({
        userId: String(p.user_id),
        name: String(p.name),
        salesCount: int(p.sales_count),
        itemsCount: int(p.items_count),
        net: money(p.net),
      })),
      byKind: kinds.map((k) => ({
        kind: k.kind as 'product' | 'service',
        salesCount: int(k.sales_count),
        itemsCount: int(k.items_count),
        net: money(k.net),
      })),
    };
  }

  /** Ranking de produtos e serviços vendidos no período, pelo líquido. */
  async byItem(auth: AuthContext, query: SalesByItemQuery): Promise<SalesByItem> {
    const base = await this.base(auth, query);
    const kind = query.kind ? sql`where i.kind = ${query.kind}` : sql``;
    const rows = await this.rows(sql`${base}
      select p.id as product_id, p.code, p.name, i.kind, p.unit,
        sum(i.quantity) as quantity, count(distinct s.id) as sales_count,
        sum(i.gross_total) as gross, sum(i.discount_amount) as discount, sum(i.net_total) as net
      from s join sale_items i on i.sale_id = s.id join products p on p.id = i.product_id
      ${kind}
      group by p.id, p.code, p.name, i.kind, p.unit
      order by net desc, p.name`);
    const items = rows.map((r) => ({
      productId: String(r.product_id),
      code: int(r.code),
      name: String(r.name),
      kind: r.kind as 'product' | 'service',
      unit: r.unit as SalesByItem['items'][number]['unit'],
      quantity: Math.round(Number(r.quantity ?? 0) * 1000) / 1000,
      salesCount: int(r.sales_count),
      gross: money(r.gross),
      discount: money(r.discount),
      net: money(r.net),
    }));
    const cents = (pick: (i: (typeof items)[number]) => number) =>
      items.reduce((total, i) => total + Math.round(pick(i) * 100), 0) / 100;
    return {
      items,
      totals: {
        net: cents((i) => i.net),
        gross: cents((i) => i.gross),
        discount: cents((i) => i.discount),
      },
    };
  }

  /** Itens em que o usuário é o profissional responsável [RN-24], com os totais do período. */
  async mine(auth: AuthContext, period: SalesPeriod): Promise<MySales> {
    const base = await this.base(auth, period);
    const limit = 500;
    const [totals, items] = await Promise.all([
      this.rows(sql`${base}
        select count(distinct s.id) as sales_count, count(*) as items_count,
          sum(i.net_total) as net,
          coalesce(sum(i.net_total) filter (where s.status = 'open'), 0) as open
        from s join sale_items i on i.sale_id = s.id
        where i.professional_id = ${auth.userId}`),
      this.rows(sql`${base}
        select i.id as item_id, s.id as sale_id, s.code, s.sold_at, s.status, c.name as client_name,
          a.name as patient_name, i.name, i.kind, i.unit, i.quantity, i.net_total
        from s join sale_items i on i.sale_id = s.id
        left join clients c on c.id = s.client_id
        left join patients a on a.id = s.patient_id
        where i.professional_id = ${auth.userId}
        order by s.sold_at desc, s.code desc, i.position
        limit ${limit + 1}`),
    ]);
    const t = totals[0] ?? {};
    return {
      totals: {
        salesCount: int(t.sales_count),
        itemsCount: int(t.items_count),
        net: money(t.net),
        open: money(t.open),
      },
      items: items.slice(0, limit).map((r) => ({
        itemId: String(r.item_id),
        saleId: String(r.sale_id),
        code: int(r.code),
        soldAt: (r.sold_at instanceof Date ? r.sold_at : new Date(String(r.sold_at))).toISOString(),
        status: r.status as MySales['items'][number]['status'],
        clientName: typeof r.client_name === 'string' ? r.client_name : null,
        patientName: typeof r.patient_name === 'string' ? r.patient_name : null,
        name: String(r.name),
        kind: r.kind as 'product' | 'service',
        unit: r.unit as MySales['items'][number]['unit'],
        quantity: Math.round(Number(r.quantity) * 1000) / 1000,
        net: money(r.net_total),
      })),
      truncated: items.length > limit,
    };
  }
}
