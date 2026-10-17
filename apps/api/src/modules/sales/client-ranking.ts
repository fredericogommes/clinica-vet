import type { AbcClass, ClientRanking, SalesPeriod } from '@clinica/contracts';
import { abcClasses } from '@clinica/contracts';
import { sql } from 'drizzle-orm';
import { addDays, zonedToInstant } from '../../core/zoned-time.js';
import type { Database, Executor } from '../../db/client.js';
import type { AuthContext } from '../auth/sessions.js';
import { unitTimeZone } from '../scheduling/availability.js';

const money = (value: unknown) => Math.round(Number(value ?? 0) * 100) / 100;
const pct = (part: number, whole: number) =>
  whole === 0 ? 0 : Math.round((part / whole) * 10_000) / 100;

/** Janela da classe mostrada na ficha do cliente. */
const CLASS_WINDOW_DAYS = 365;

/**
 * Curva ABC [RN-10]: o líquido das vendas em aberto e baixadas de cada cliente no intervalo, na
 * clínica toda; orçamento e venda cancelada (inclusive a estornada) ficam de fora. Em ordem de
 * valor (empate pelo código), o cliente é A enquanto o acumulado antes dele não chega a 80% do
 * total, B até 95% e C depois; quem não comprou não entra.
 */
function rankingQuery(organizationId: string, start: Date, end: Date) {
  return sql`with t as (
      select s.client_id, count(*) as sales_count, sum(s.net_total) as net
      from sales s
      where s.organization_id = ${organizationId}
        and s.client_id is not null
        and s.status in ('open', 'closed')
        and s.sold_at >= ${start.toISOString()} and s.sold_at < ${end.toISOString()}
      group by s.client_id
      having sum(s.net_total) > 0
    ), r as (
      select t.*, c.code, c.name,
        sum(t.net) over () as total,
        coalesce(sum(t.net) over (order by t.net desc, c.code
          rows between unbounded preceding and 1 preceding), 0) as before,
        row_number() over (order by t.net desc, c.code) as position
      from t join clients c on c.id = t.client_id
    )
    select r.*, case
        when r.before < r.total * 0.8 then 'A'
        when r.before < r.total * 0.95 then 'B'
        else 'C' end as abc
    from r`;
}

type Row = Record<string, unknown>;

/** Classe do cliente nos últimos 12 meses, para a ficha 360º; nula sem compras. */
export async function clientAbcClass(
  db: Executor,
  organizationId: string,
  clientId: string,
  now = new Date(),
): Promise<AbcClass | null> {
  const start = new Date(now.getTime() - CLASS_WINDOW_DAYS * 86_400_000);
  const { rows } = await db.execute<Row>(
    sql`select q.abc from (${rankingQuery(organizationId, start, now)}) q
      where q.client_id = ${clientId}`,
  );
  const abc = rows[0]?.abc;
  return abcClasses.find((c) => c === abc) ?? null;
}

export class ClientRankingService {
  constructor(private readonly db: Database) {}

  /** Ranking de clientes [p.10]: período em datas do fuso da unidade atual. */
  async ranking(auth: AuthContext, period: SalesPeriod): Promise<ClientRanking> {
    const tz = await unitTimeZone(this.db, auth.unitId);
    const start = zonedToInstant(period.from, 0, tz);
    const end = zonedToInstant(addDays(period.to, 1), 0, tz);
    const { rows } = await this.db.execute<Row>(
      sql`${rankingQuery(auth.organizationId, start, end)} order by position`,
    );
    const total = money(rows[0]?.total);
    let cumulative = 0;
    const items = rows.map((r) => {
      const net = money(r.net);
      cumulative = money(cumulative + net);
      return {
        position: Number(r.position),
        client: { id: String(r.client_id), code: Number(r.code), name: String(r.name) },
        salesCount: Number(r.sales_count),
        net,
        share: pct(net, total),
        cumulativeShare: pct(cumulative, total),
        class: abcClasses.find((c) => c === r.abc) ?? 'C',
      };
    });
    return {
      total,
      classes: abcClasses.map((c) => {
        const mine = items.filter((i) => i.class === c);
        const net = mine.reduce((sum, i) => money(sum + i.net), 0);
        return { class: c, clients: mine.length, net, share: pct(net, total) };
      }),
      items,
    };
  }
}
