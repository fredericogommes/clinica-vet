import type { ClientBalances, ClientDebtList, ClientDebtQuery } from '@clinica/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { containsText } from '../../core/search.js';
import { instantToZoned } from '../../core/zoned-time.js';
import type { Database } from '../../db/client.js';
import type { AuthContext } from '../auth/sessions.js';
import { unitTimeZone } from '../scheduling/availability.js';

const money = (value: unknown) => Math.round(Number(value ?? 0) * 100) / 100;
type Row = Record<string, unknown>;

/**
 * Recebimentos e Saldo dos clientes [p.10]: o que ficou na conta do cliente nas vendas baixadas
 * da clínica toda (o cliente é da clínica), com o que já foi recebido depois. Venda estornada
 * não entra.
 */
export class ClientDebtService {
  constructor(private readonly db: Database) {}

  /** CTE `d`: uma linha por conta do cliente ainda em aberto, com o vencimento e o abatido. */
  private async base(auth: AuthContext): Promise<{ cte: SQL; today: string }> {
    const tz = await unitTimeZone(this.db, auth.unitId);
    const today = instantToZoned(new Date(), tz).date;
    const cte = sql`with d as (
      select p.id, p.amount, s.id as sale_id, s.code as sale_code, s.sold_at,
        c.id as client_id, c.code as client_code, c.name as client_name,
        pt.name as patient_name, r.due_date,
        coalesce((select sum(x.amount) from sale_payments x
          where x.settles_payment_id = p.id and x.reversed_at is null), 0) as paid
      from sale_payments p
      join sales s on s.id = p.sale_id
      join clients c on c.id = s.client_id
      left join patients pt on pt.id = s.patient_id
      join sale_receivables r on r.sale_payment_id = p.id and r.number = 1
      where s.organization_id = ${auth.organizationId}
        and s.status = 'closed'
        and p.kind = 'account'
        and p.reversed_at is null
    ), o as (
      select d.*, d.amount - d.paid as open, d.due_date < ${today}::date as overdue
      from d where d.amount - d.paid > 0
    )`;
    return { cte, today };
  }

  async list(auth: AuthContext, query: ClientDebtQuery): Promise<ClientDebtList> {
    const { cte } = await this.base(auth);
    const digits = /^\d+$/.test(query.q) ? Number(query.q) : null;
    const filters = [sql`true`];
    if (query.q) {
      filters.push(
        sql`(${containsText(sql`o.client_name`, query.q)}${
          digits === null ? sql`` : sql` or o.client_code = ${digits} or o.sale_code = ${digits}`
        })`,
      );
    }
    if (query.clientId) filters.push(sql`o.client_id = ${query.clientId}`);
    if (query.overdue) filters.push(sql`o.overdue`);
    const where = sql.join(filters, sql` and `);
    const offset = (query.page - 1) * query.pageSize;
    const [rows, totals] = await Promise.all([
      this.db.execute<Row>(sql`${cte} select * from o where ${where}
        order by o.due_date, o.sale_code limit ${query.pageSize} offset ${offset}`),
      this.db.execute<Row>(sql`${cte} select count(*) as count,
          coalesce(sum(o.open), 0) as open,
          coalesce(sum(o.open) filter (where o.overdue), 0) as overdue,
          count(distinct o.client_id) as clients
        from o where ${where}`),
    ]);
    const t = totals.rows[0] ?? {};
    return {
      items: rows.rows.map((r) => ({
        id: String(r.id),
        sale: {
          id: String(r.sale_id),
          code: Number(r.sale_code),
          soldAt: new Date(String(r.sold_at)).toISOString(),
        },
        client: {
          id: String(r.client_id),
          code: Number(r.client_code),
          name: String(r.client_name),
        },
        patientName: typeof r.patient_name === 'string' ? r.patient_name : null,
        dueDate: String(r.due_date),
        amount: money(r.amount),
        paid: money(r.paid),
        open: money(r.open),
        overdue: Boolean(r.overdue),
      })),
      total: Number(t.count ?? 0),
      page: query.page,
      pageSize: query.pageSize,
      totals: { open: money(t.open), overdue: money(t.overdue), clients: Number(t.clients ?? 0) },
    };
  }

  /** Saldo dos clientes: o débito em aberto de cada cliente, do maior para o menor. */
  async balances(auth: AuthContext): Promise<ClientBalances> {
    const { cte } = await this.base(auth);
    const { rows } = await this.db.execute<Row>(sql`${cte}
      select o.client_id, o.client_code, o.client_name, count(*) as sales,
        sum(o.open) as open, coalesce(sum(o.open) filter (where o.overdue), 0) as overdue,
        min(o.due_date) as oldest_due
      from o group by o.client_id, o.client_code, o.client_name
      order by sum(o.open) desc, o.client_code`);
    const items = rows.map((r) => ({
      client: { id: String(r.client_id), code: Number(r.client_code), name: String(r.client_name) },
      sales: Number(r.sales),
      open: money(r.open),
      overdue: money(r.overdue),
      oldestDue: String(r.oldest_due),
    }));
    return {
      items,
      totals: {
        open: items.reduce((a, i) => money(a + i.open), 0),
        overdue: items.reduce((a, i) => money(a + i.overdue), 0),
        clients: items.length,
      },
    };
  }
}
