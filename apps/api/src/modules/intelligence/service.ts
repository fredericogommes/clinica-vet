import {
  indicatorKeys,
  saleShiftLabels,
  weekdayLabels,
  type ClientsIntelligence,
  type Evolution,
  type IndicatorKey,
  type IntelligenceQuery,
  type PatientsIntelligence,
  type RankEntry,
  type SalesIntelligence,
} from '@clinica/contracts';
import { asc, eq, sql, type SQL } from 'drizzle-orm';
import { addDays, datesBetween, zonedToInstant } from '../../core/zoned-time.js';
import type { Database } from '../../db/client.js';
import { intelligenceFavorites } from '../../db/schema.js';
import type { AuthContext } from '../auth/sessions.js';
import { unitTimeZone } from '../scheduling/availability.js';

type Row = Record<string, unknown>;

const money = (value: unknown) => Math.round(Number(value ?? 0) * 100) / 100;
const num = (value: unknown) => Number(value ?? 0);
const ticket = (net: number, count: number) =>
  count === 0 ? 0 : Math.round((net / count) * 100) / 100;

/** Ranking com o valor em reais e a contagem como veio do banco. */
const moneyRank = (rows: Row[]): RankEntry[] =>
  rows.map((r) => ({ label: String(r.label), value: money(r.value), count: num(r.count) }));

/** Distribuição: o valor é a própria contagem. */
const countRank = (rows: Row[]): RankEntry[] =>
  rows.map((r) => ({ label: String(r.label), value: num(r.count), count: num(r.count) }));

/** Faixas fixas na ordem dada, com zero nas que não aparecem. */
function fixedBuckets(rows: Row[], labels: readonly string[]): RankEntry[] {
  const found = new Map(rows.map((r) => [String(r.label), r]));
  return labels.map((label) => {
    const r = found.get(label);
    return { label, value: num(r?.count), count: num(r?.count) };
  });
}

/** Os dez maiores e o resto somado em "Outras", para a barra não virar lista. */
function topWithRest(entries: RankEntry[], rest = 'Outras', size = 10): RankEntry[] {
  if (entries.length <= size + 1) return entries;
  const tail = entries.slice(size);
  return [
    ...entries.slice(0, size),
    {
      label: rest,
      value: tail.reduce((a, e) => a + e.value, 0),
      count: tail.reduce((a, e) => a + e.count, 0),
    },
  ];
}

const relationshipBuckets = [
  'Menos de 6 meses',
  '6 a 12 meses',
  '1 a 2 anos',
  '2 a 5 anos',
  '5 anos ou mais',
] as const;
const ageBuckets = [
  'Até 1 ano',
  '1 a 3 anos',
  '4 a 7 anos',
  '8 a 11 anos',
  '12 anos ou mais',
  'Sem data de nascimento',
] as const;
const weightBuckets = [
  'Até 5 kg',
  '5 a 10 kg',
  '10 a 20 kg',
  '20 a 40 kg',
  'Acima de 40 kg',
  'Sem peso registrado',
] as const;

interface Scope {
  tz: string;
  start: Date;
  end: Date;
  /** Período longo (mais de 62 dias) evolui por mês. */
  granularity: 'day' | 'month';
}

/**
 * Inteligência › Vendas [p.11–12]. Vendas contam como na Consulta vendas: em aberto e baixadas
 * da unidade, pela data da venda no fuso da unidade. Clientes e animais são da clínica toda; as
 * distribuições olham o cadastro ativo até o fim do período. Tudo é somado no banco.
 */
export class IntelligenceService {
  constructor(private readonly db: Database) {}

  private async scope(auth: AuthContext, q: IntelligenceQuery): Promise<Scope> {
    const tz = await unitTimeZone(this.db, auth.unitId);
    return {
      tz,
      start: zonedToInstant(q.from, 0, tz),
      end: zonedToInstant(addDays(q.to, 1), 0, tz),
      granularity: datesBetween(q.from, q.to).length > 62 ? 'month' : 'day',
    };
  }

  private async rows(query: SQL): Promise<Row[]> {
    return (await this.db.execute<Row>(query)).rows;
  }

  /** Série completa do período, com zero nos dias (ou meses) sem movimento. */
  private evolution(q: IntelligenceQuery, scope: Scope, rows: Row[], isMoney: boolean): Evolution {
    const found = new Map(rows.map((r) => [String(r.period), r]));
    const periods =
      scope.granularity === 'day'
        ? datesBetween(q.from, q.to)
        : [...new Set(datesBetween(q.from, q.to).map((d) => d.slice(0, 7)))];
    return {
      granularity: scope.granularity,
      points: periods.map((period) => {
        const r = found.get(period);
        return {
          period,
          value: isMoney ? money(r?.value) : num(r?.count),
          count: num(r?.count),
        };
      }),
    };
  }

  private periodOf(scope: Scope, column: SQL): SQL {
    return scope.granularity === 'day'
      ? sql`to_char((${column} at time zone ${scope.tz})::date, 'YYYY-MM-DD')`
      : sql`to_char((${column} at time zone ${scope.tz})::date, 'YYYY-MM')`;
  }

  async sales(auth: AuthContext, q: IntelligenceQuery): Promise<SalesIntelligence> {
    const scope = await this.scope(auth, q);
    const local = sql`(sales.sold_at at time zone ${scope.tz})`;
    const filters: SQL[] = [];
    if (q.weekday !== undefined) filters.push(sql`and extract(dow from ${local}) = ${q.weekday}`);
    if (q.shift) {
      const [from, to] = { dawn: [0, 5], morning: [6, 11], afternoon: [12, 17], night: [18, 23] }[
        q.shift
      ];
      filters.push(sql`and extract(hour from ${local}) between ${from} and ${to}`);
    }
    const base = sql`with s as (
      select sales.*, ${local} as local
      from sales
      where sales.organization_id = ${auth.organizationId}
        and sales.unit_id = ${auth.unitId}
        and sales.status in ('open', 'closed')
        and sales.sold_at >= ${scope.start.toISOString()} and sales.sold_at < ${scope.end.toISOString()}
        ${sql.join(filters, sql` `)}
    )`;
    const items = sql`from s join sale_items i on i.sale_id = s.id
      join products p on p.id = i.product_id`;
    const [
      totals,
      evolution,
      days,
      top,
      groups,
      brands,
      weekdays,
      packages,
      shifts,
      kinds,
      species,
    ] = await Promise.all([
      this.rows(sql`${base} select count(*) as count, coalesce(sum(net_total), 0) as net from s`),
      this.rows(sql`${base} select ${this.periodOf(scope, sql`s.sold_at`)} as period,
          count(*) as count, sum(s.net_total) as value from s group by 1`),
      this.rows(sql`${base} select s.local::date::text as date, count(*) as count,
          sum(s.net_total) as net from s group by 1 order by 1`),
      this.rows(sql`${base} select max(i.name) as label, sum(i.net_total) as value,
          sum(i.quantity) as count ${items}
          group by i.product_id order by value desc, label limit 10`),
      this.rows(sql`${base} select coalesce(g.name, 'Sem grupo') as label,
          sum(i.net_total) as value, sum(i.quantity) as count ${items}
          left join product_groups g on g.id = p.group_id
          group by 1 order by value desc, label`),
      this.rows(sql`${base} select b.name as label, sum(i.net_total) as value,
          sum(i.quantity) as count ${items} join product_brands b on b.id = p.brand_id
          group by b.id, b.name order by value desc, label limit 10`),
      this.rows(sql`${base} select extract(dow from s.local)::int as dow, count(*) as count,
          sum(s.net_total) as value from s group by 1`),
      this.rows(sql`${base} select max(i.name) as label, sum(i.net_total) as value,
          sum(i.quantity) as count ${items} where i.service_kind = 'package'
          group by i.product_id order by value desc, label limit 10`),
      this.rows(sql`${base} select case
            when extract(hour from s.local) < 6 then 'dawn'
            when extract(hour from s.local) < 12 then 'morning'
            when extract(hour from s.local) < 18 then 'afternoon'
            else 'night' end as shift,
          count(*) as count, sum(s.net_total) as value from s group by 1`),
      this.rows(sql`${base} select i.kind, sum(i.net_total) as value, sum(i.quantity) as count
          from s join sale_items i on i.sale_id = s.id group by 1`),
      this.rows(sql`${base} select case
            when s.patient_id is null then 'Sem animal'
            else coalesce(sp.name, 'Espécie não informada') end as label,
          sum(s.net_total) as value, count(*) as count
          from s left join patients pt on pt.id = s.patient_id
          left join species sp on sp.id = pt.species_id
          group by 1 order by value desc, label`),
    ]);
    const count = num(totals[0]?.count);
    const net = money(totals[0]?.net);
    const byDow = new Map(weekdays.map((r) => [num(r.dow), r]));
    const byShift = new Map(shifts.map((r) => [String(r.shift), r]));
    const byKind = new Map(kinds.map((r) => [String(r.kind), r]));
    return {
      totals: { count, net, averageTicket: ticket(net, count) },
      evolution: this.evolution(q, scope, evolution, true),
      byDate: days.map((d) => {
        const c = num(d.count);
        const n = money(d.net);
        return { date: String(d.date), count: c, net: n, averageTicket: ticket(n, c) };
      }),
      topItems: moneyRank(top),
      byGroup: topWithRest(moneyRank(groups), 'Outros grupos'),
      topBrands: moneyRank(brands),
      byWeekday: weekdayLabels.map((label, dow) => ({
        label,
        value: money(byDow.get(dow)?.value),
        count: num(byDow.get(dow)?.count),
      })),
      topPackages: moneyRank(packages),
      byShift: (['morning', 'afternoon', 'night', 'dawn'] as const).map((shift) => ({
        label: saleShiftLabels[shift],
        value: money(byShift.get(shift)?.value),
        count: num(byShift.get(shift)?.count),
      })),
      byKind: [
        ['product', 'Produtos'],
        ['service', 'Serviços'],
      ].map(([kind, label]) => ({
        label: label ?? '',
        value: money(byKind.get(kind ?? '')?.value),
        count: num(byKind.get(kind ?? '')?.count),
      })),
      bySpecies: moneyRank(species),
    };
  }

  async clients(auth: AuthContext, q: IntelligenceQuery): Promise<ClientsIntelligence> {
    const scope = await this.scope(auth, q);
    const end = scope.end.toISOString();
    const base = sql`with c as (
      select clients.* from clients
      where clients.organization_id = ${auth.organizationId}
        and clients.archived_at is null and clients.created_at < ${end}
    )`;
    const sold = sql`with s as (
      select sales.* from sales
      where sales.organization_id = ${auth.organizationId}
        and sales.unit_id = ${auth.unitId}
        and sales.status in ('open', 'closed') and sales.client_id is not null
        and sales.sold_at >= ${scope.start.toISOString()} and sales.sold_at < ${end}
    )`;
    const text = (column: SQL, empty: string) =>
      sql`coalesce(nullif(trim(${column}), ''), ${empty})`;
    const [
      total,
      created,
      top,
      attended,
      attendedCount,
      origins,
      relationship,
      cities,
      districts,
      sexes,
      professions,
      types,
    ] = await Promise.all([
      this.rows(sql`${base} select count(*) as count from c`),
      this.rows(sql`select ${this.periodOf(scope, sql`created_at`)} as period, count(*) as count
          from clients where organization_id = ${auth.organizationId}
            and created_at >= ${scope.start.toISOString()} and created_at < ${end}
          group by 1`),
      this.rows(sql`${sold} select c.name as label, sum(s.net_total) as value, count(*) as count
          from s join clients c on c.id = s.client_id
          group by c.id, c.name order by value desc, label limit 10`),
      this.rows(sql`${sold} select c.name as label,
          count(distinct (s.sold_at at time zone ${scope.tz})::date) as count
          from s join clients c on c.id = s.client_id
          group by c.id, c.name order by count desc, label limit 10`),
      this.rows(sql`${sold} select count(distinct s.client_id) as count from s`),
      this.rows(sql`${base} select coalesce(o.name, 'Sem origem') as label, count(*) as count
          from c left join client_origins o on o.id = c.origin_id
          group by 1 order by count desc, label`),
      this.rows(sql`${base} select case
            when c.created_at > ${end}::timestamptz - interval '6 months' then ${relationshipBuckets[0]}
            when c.created_at > ${end}::timestamptz - interval '1 year' then ${relationshipBuckets[1]}
            when c.created_at > ${end}::timestamptz - interval '2 years' then ${relationshipBuckets[2]}
            when c.created_at > ${end}::timestamptz - interval '5 years' then ${relationshipBuckets[3]}
            else ${relationshipBuckets[4]} end as label, count(*) as count
          from c group by 1`),
      this.rows(sql`${base} select ${text(sql`c.city`, 'Cidade não informada')} as label,
          count(*) as count from c group by 1 order by count desc, label`),
      this.rows(sql`${base} select ${text(sql`c.district`, 'Bairro não informado')} as label,
          count(*) as count from c group by 1 order by count desc, label`),
      this.rows(sql`${base} select case c.sex when 'female' then 'Feminino'
            when 'male' then 'Masculino' else 'Não informado' end as label, count(*) as count
          from c group by 1`),
      this.rows(sql`${base} select ${text(sql`c.profession`, 'Profissão não informada')} as label,
          count(*) as count from c group by 1 order by count desc, label`),
      this.rows(sql`${base} select case c.person_type when 'company' then 'Pessoa jurídica'
            else 'Pessoa física' end as label, count(*) as count from c group by 1`),
    ]);
    return {
      base: num(total[0]?.count),
      newClients: this.evolution(q, scope, created, false),
      topClients: moneyRank(top),
      attended: countRank(attended),
      attendedCount: num(attendedCount[0]?.count),
      byOrigin: topWithRest(countRank(origins)),
      byRelationship: fixedBuckets(relationship, relationshipBuckets),
      byCity: topWithRest(countRank(cities)),
      byDistrict: topWithRest(countRank(districts), 'Outros'),
      bySex: fixedBuckets(sexes, ['Feminino', 'Masculino', 'Não informado']),
      byProfession: topWithRest(countRank(professions)),
      byPersonType: fixedBuckets(types, ['Pessoa física', 'Pessoa jurídica']),
    };
  }

  async patients(auth: AuthContext, q: IntelligenceQuery): Promise<PatientsIntelligence> {
    const scope = await this.scope(auth, q);
    const end = scope.end.toISOString();
    const base = sql`with a as (
      select patients.* from patients
      where patients.organization_id = ${auth.organizationId}
        and patients.archived_at is null and patients.status = 'alive'
        and patients.created_at < ${end}
    )`;
    const [total, created, species, ages, sexes, breeds, weights, sterilized] = await Promise.all([
      this.rows(sql`${base} select count(*) as count from a`),
      this.rows(sql`select ${this.periodOf(scope, sql`created_at`)} as period, count(*) as count
        from patients where organization_id = ${auth.organizationId}
          and created_at >= ${scope.start.toISOString()} and created_at < ${end}
        group by 1`),
      this.rows(sql`${base} select coalesce(sp.name, 'Espécie não informada') as label,
        count(*) as count from a left join species sp on sp.id = a.species_id
        group by 1 order by count desc, label`),
      this.rows(sql`${base}, ages as (
          select date_part('year', age(${q.to}::date, a.birth_date)) as years, a.birth_date from a)
        select case
          when birth_date is null then ${ageBuckets[5]}
          when years < 1 then ${ageBuckets[0]}
          when years <= 3 then ${ageBuckets[1]}
          when years <= 7 then ${ageBuckets[2]}
          when years <= 11 then ${ageBuckets[3]}
          else ${ageBuckets[4]} end as label, count(*) as count
        from ages group by 1`),
      this.rows(sql`${base} select case a.sex when 'female' then 'Fêmea' when 'male' then 'Macho'
          else 'Não informado' end as label, count(*) as count from a group by 1`),
      this.rows(sql`${base} select coalesce(b.name, 'Raça não informada') as label,
        count(*) as count from a left join breeds b on b.id = a.breed_id
        group by 1 order by count desc, label`),
      this.rows(sql`${base}, w as (
          select (select v.weight_kg from clinical_events e
              join clinical_vitals v on v.event_id = e.id
            where e.patient_id = a.id and e.status = 'published' and v.weight_kg is not null
              and e.occurred_at < ${end}
            order by e.occurred_at desc limit 1) as kg
          from a)
        select case
          when kg is null then ${weightBuckets[5]}
          when kg <= 5 then ${weightBuckets[0]}
          when kg <= 10 then ${weightBuckets[1]}
          when kg <= 20 then ${weightBuckets[2]}
          when kg <= 40 then ${weightBuckets[3]}
          else ${weightBuckets[4]} end as label, count(*) as count
        from w group by 1`),
      this.rows(sql`${base} select case a.sterilized when true then 'Castrado'
          when false then 'Não castrado' else 'Não informado' end as label, count(*) as count
        from a group by 1`),
    ]);
    return {
      base: num(total[0]?.count),
      newPatients: this.evolution(q, scope, created, false),
      bySpecies: topWithRest(countRank(species)),
      byAge: fixedBuckets(ages, ageBuckets),
      bySex: fixedBuckets(sexes, ['Fêmea', 'Macho', 'Não informado']),
      byBreed: topWithRest(countRank(breeds)),
      byWeight: fixedBuckets(weights, weightBuckets),
      sterilization: fixedBuckets(sterilized, ['Castrado', 'Não castrado', 'Não informado']),
    };
  }

  async favorites(auth: AuthContext): Promise<IndicatorKey[]> {
    const rows = await this.db
      .select({ indicator: intelligenceFavorites.indicator })
      .from(intelligenceFavorites)
      .where(eq(intelligenceFavorites.userId, auth.userId))
      .orderBy(asc(intelligenceFavorites.position));
    const known = new Set<string>(indicatorKeys);
    return rows.map((r) => r.indicator).filter((k): k is IndicatorKey => known.has(k));
  }

  /** Favoritos são do usuário: a lista inteira é trocada de uma vez, na ordem enviada. */
  async saveFavorites(auth: AuthContext, keys: IndicatorKey[]): Promise<IndicatorKey[]> {
    const unique = [...new Set(keys)];
    await this.db.transaction(async (tx) => {
      await tx.delete(intelligenceFavorites).where(eq(intelligenceFavorites.userId, auth.userId));
      if (unique.length) {
        await tx
          .insert(intelligenceFavorites)
          .values(
            unique.map((indicator, position) => ({ userId: auth.userId, indicator, position })),
          );
      }
    });
    return unique;
  }
}
