import type {
  ClientPackage,
  ClientPackageDetail,
  PackageList,
  PackageListQuery,
} from '@clinica/contracts';
import { clientPackageStatuses } from '@clinica/contracts';
import { and, asc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { actorOf } from '../../core/actor.js';
import { recordAudit } from '../../core/audit.js';
import { AppError, conflict, notFound } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import { containsText } from '../../core/search.js';
import { addDays, instantToZoned } from '../../core/zoned-time.js';
import type { Database, Executor } from '../../db/client.js';
import {
  clientPackages,
  packageUsages,
  patients,
  products,
  saleItems,
  users,
} from '../../db/schema.js';
import type { sales } from '../../db/schema.js';
import type { AuthContext } from '../auth/sessions.js';
import { unitTimeZone } from '../scheduling/availability.js';

type Row = Record<string, unknown>;
type SaleRow = typeof sales.$inferSelect;

const invalid = (path: string, message: string) =>
  new AppError('validation_failed', 'Dados do pacote inválidos.', [{ path, message }]);

const today = async (db: Executor, unitId: string) =>
  instantToZoned(new Date(), await unitTimeZone(db, unitId)).date;

/**
 * Pacotes da venda que está sendo baixada [p.10]: um pacote do cliente por unidade vendida de cada
 * item que é pacote, com a validade contada do dia da venda no fuso da unidade. Pacote exige
 * cliente e quantidade inteira.
 */
export async function openSalePackages(tx: Executor, sale: SaleRow, soldAt: Date): Promise<void> {
  const items = await tx
    .select({
      id: saleItems.id,
      position: saleItems.position,
      name: saleItems.name,
      quantity: saleItems.quantity,
      productId: saleItems.productId,
      serviceId: products.packageServiceId,
      sessions: products.packageSessions,
      validityDays: products.packageValidityDays,
    })
    .from(saleItems)
    .innerJoin(products, eq(products.id, saleItems.productId))
    .where(and(eq(saleItems.saleId, sale.id), eq(products.serviceKind, 'package')))
    .orderBy(asc(saleItems.position));
  if (items.length === 0) return;
  if (!sale.clientId) {
    throw invalid('clientId', 'Pacote é do cliente: escolha o cliente da venda antes de receber');
  }
  const soldOn = instantToZoned(soldAt, await unitTimeZone(tx, sale.unitId)).date;
  const rows = [];
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || !item.serviceId || !item.sessions) {
      throw invalid(
        `items.${String(item.position)}.quantity`,
        'Pacote é vendido em unidades inteiras',
      );
    }
    for (let n = 0; n < item.quantity; n++) {
      rows.push({
        id: newId(),
        organizationId: sale.organizationId,
        saleId: sale.id,
        saleItemId: item.id,
        clientId: sale.clientId,
        patientId: sale.patientId,
        productId: item.productId,
        serviceId: item.serviceId,
        name: item.name,
        sessions: item.sessions,
        validUntil: item.validityDays ? addDays(soldOn, item.validityDays) : null,
        createdAt: soldAt,
      });
    }
  }
  await tx.insert(clientPackages).values(rows);
}

/**
 * Estorno da venda [RN-29]: cancela os pacotes que ela abriu. Com sessão já usada, o estorno espera
 * as sessões serem desfeitas, para a devolução não pagar o que o cliente consumiu.
 */
export async function cancelSalePackages(tx: Executor, saleId: string, now: Date): Promise<void> {
  const { rows } = await tx.execute<Row>(sql`select count(*) as used
    from package_usages u join client_packages p on p.id = u.client_package_id
    where p.sale_id = ${saleId} and u.undone_at is null`);
  if (Number(rows[0]?.used ?? 0) > 0) {
    throw conflict(
      'Esta venda tem pacote com sessão usada. Desfaça as sessões em Pacotes vendidos antes de estornar.',
    );
  }
  await tx
    .update(clientPackages)
    .set({ cancelledAt: now })
    .where(and(eq(clientPackages.saleId, saleId), isNull(clientPackages.cancelledAt)));
}

/** CTE `k`: os pacotes da organização com sessões usadas e a situação de hoje. */
function packagesCte(organizationId: string, day: string): SQL {
  return sql`with k as (
    select p.id, p.name, p.sessions, p.valid_until, p.cancelled_at, p.created_at,
      p.service_id, sv.name as service_name,
      c.id as client_id, c.code as client_code, c.name as client_name,
      pt.id as patient_id, pt.name as patient_name,
      s.id as sale_id, s.code as sale_code, coalesce(s.sold_at, s.created_at) as sold_at,
      (select count(*) from package_usages u
        where u.client_package_id = p.id and u.undone_at is null)::int as used
    from client_packages p
    join clients c on c.id = p.client_id
    join products sv on sv.id = p.service_id
    join sales s on s.id = p.sale_id
    left join patients pt on pt.id = p.patient_id
    where p.organization_id = ${organizationId}
  ), q as (
    select k.*, case
      when k.cancelled_at is not null then 'cancelled'
      when k.used >= k.sessions then 'finished'
      when k.valid_until < ${day}::date then 'expired'
      else 'active' end as status
    from k
  )`;
}

function toPackage(r: Row): ClientPackage {
  const sessions = Number(r.sessions);
  const used = Number(r.used);
  const status = clientPackageStatuses.find((s) => s === r.status) ?? 'active';
  return {
    id: String(r.id),
    name: String(r.name),
    service: { id: String(r.service_id), name: String(r.service_name) },
    client: { id: String(r.client_id), code: Number(r.client_code), name: String(r.client_name) },
    patient:
      typeof r.patient_id === 'string' && typeof r.patient_name === 'string'
        ? { id: r.patient_id, name: r.patient_name }
        : null,
    sale: {
      id: String(r.sale_id),
      code: Number(r.sale_code),
      soldAt: new Date(String(r.sold_at)).toISOString(),
    },
    sessions,
    used,
    remaining: status === 'cancelled' ? 0 : Math.max(0, sessions - used),
    validUntil: typeof r.valid_until === 'string' ? r.valid_until : null,
    status,
  };
}

/** Pacotes vendidos [p.10]: consulta, sessões usadas e desfeitas, na clínica toda. */
export class PackageService {
  constructor(private readonly db: Database) {}

  async list(auth: AuthContext, query: PackageListQuery): Promise<PackageList> {
    const day = await today(this.db, auth.unitId);
    const filters: SQL[] = [sql`true`];
    if (query.q) {
      const digits = /^\d+$/.test(query.q) ? Number(query.q) : null;
      filters.push(
        sql`(${containsText(sql`q.client_name`, query.q)} or ${containsText(sql`q.name`, query.q)}
          or ${containsText(sql`coalesce(q.patient_name, '')`, query.q)}${
            digits === null ? sql`` : sql` or q.client_code = ${digits} or q.sale_code = ${digits}`
          })`,
      );
    }
    if (query.clientId) filters.push(sql`q.client_id = ${query.clientId}`);
    if (query.status) filters.push(sql`q.status = ${query.status}`);
    const where = sql.join(filters, sql` and `);
    const cte = packagesCte(auth.organizationId, day);
    const offset = (query.page - 1) * query.pageSize;
    const [rows, count] = await Promise.all([
      this.db.execute<Row>(sql`${cte} select * from q where ${where}
        order by (q.status = 'active') desc, q.created_at desc, q.id
        limit ${query.pageSize} offset ${offset}`),
      this.db.execute<Row>(sql`${cte} select count(*) as count from q where ${where}`),
    ]);
    return {
      items: rows.rows.map(toPackage),
      total: Number(count.rows[0]?.count ?? 0),
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(auth: AuthContext, id: string, executor?: Executor): Promise<ClientPackageDetail> {
    const db = executor ?? this.db;
    const day = await today(db, auth.unitId);
    const { rows } = await db.execute<Row>(
      sql`${packagesCte(auth.organizationId, day)} select * from q where q.id = ${id}`,
    );
    const row = rows[0];
    if (!row) throw notFound('Pacote');
    const pkg = toPackage(row);
    const creator = sql<string>`(select name from users where id = ${packageUsages.createdBy})`;
    const undoer = sql<
      string | null
    >`(select name from users where id = ${packageUsages.undoneBy})`;
    const [usages, owned, professionals] = await Promise.all([
      db
        .select({
          u: packageUsages,
          patientName: patients.name,
          professionalName: users.name,
          createdBy: creator,
          undoneBy: undoer,
        })
        .from(packageUsages)
        .innerJoin(users, eq(users.id, packageUsages.professionalId))
        .leftJoin(patients, eq(patients.id, packageUsages.patientId))
        .where(eq(packageUsages.clientPackageId, id))
        .orderBy(asc(packageUsages.usedOn), asc(packageUsages.createdAt)),
      db
        .select({ id: patients.id, name: patients.name })
        .from(patients)
        .where(and(eq(patients.clientId, pkg.client.id), isNull(patients.archivedAt)))
        .orderBy(asc(sql`lower(${patients.name})`)),
      db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(and(eq(users.organizationId, auth.organizationId), eq(users.active, true)))
        .orderBy(asc(sql`lower(${users.name})`)),
    ]);
    return {
      ...pkg,
      usages: usages.map(({ u, patientName, professionalName, createdBy, undoneBy }) => ({
        id: u.id,
        usedOn: u.usedOn,
        patient: u.patientId && patientName ? { id: u.patientId, name: patientName } : null,
        professional: { id: u.professionalId, name: professionalName },
        notes: u.notes,
        createdBy,
        createdAt: u.createdAt.toISOString(),
        undone:
          u.undoneAt && u.undoReason
            ? { at: u.undoneAt.toISOString(), by: undoneBy ?? '', reason: u.undoReason }
            : null,
      })),
      patients: owned,
      professionals,
    };
  }

  /**
   * Registra uma sessão usada: pacote em uso, data entre a venda e hoje e dentro da validade,
   * animal do próprio cliente e profissional ativo da clínica.
   */
  async use(
    auth: AuthContext,
    id: string,
    input: { usedOn: string; patientId: string | null; professionalId: string; notes: string },
  ): Promise<ClientPackageDetail> {
    return this.db.transaction(async (tx) => {
      const pkg = await this.lockOpen(tx, auth, id);
      const day = await today(tx, auth.unitId);
      const current = await this.get(auth, id, tx);
      if (current.status === 'finished') {
        throw conflict('Todas as sessões deste pacote já foram usadas.');
      }
      const soldOn = instantToZoned(
        new Date(current.sale.soldAt),
        await unitTimeZone(tx, auth.unitId),
      ).date;
      if (input.usedOn > day) throw invalid('usedOn', 'A sessão não pode ser em data futura');
      if (input.usedOn < soldOn) throw invalid('usedOn', 'A sessão não pode ser antes da venda');
      if (pkg.validUntil && input.usedOn > pkg.validUntil) {
        throw invalid('usedOn', 'O pacote já estava vencido nesta data');
      }
      if (input.patientId && !current.patients.some((p) => p.id === input.patientId)) {
        throw invalid('patientId', 'Escolha um animal do cliente do pacote');
      }
      const [professional] = await tx
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(
          and(
            eq(users.id, input.professionalId),
            eq(users.organizationId, auth.organizationId),
            eq(users.active, true),
          ),
        );
      if (!professional) throw invalid('professionalId', 'Escolha um profissional ativo');
      const usageId = newId();
      await tx.insert(packageUsages).values({
        id: usageId,
        clientPackageId: id,
        usedOn: input.usedOn,
        patientId: input.patientId,
        professionalId: professional.id,
        notes: input.notes,
        createdBy: auth.userId,
      });
      await recordAudit(tx, actorOf(auth), {
        entity: 'client_package',
        entityId: id,
        action: 'use_session',
        after: {
          package: pkg.name,
          client: current.client.name,
          usedOn: input.usedOn,
          professional: professional.name,
          session: `${String(current.used + 1)} de ${String(current.sessions)}`,
        },
      });
      return this.get(auth, id, tx);
    });
  }

  /** Desfaz uma sessão com motivo: ela deixa de contar e fica no histórico do pacote. */
  async undo(
    auth: AuthContext,
    id: string,
    usageId: string,
    reason: string,
  ): Promise<ClientPackageDetail> {
    return this.db.transaction(async (tx) => {
      const pkg = await this.lockOpen(tx, auth, id);
      const [usage] = await tx
        .select()
        .from(packageUsages)
        .where(and(eq(packageUsages.id, usageId), eq(packageUsages.clientPackageId, id)));
      if (!usage) throw notFound('Sessão');
      if (usage.undoneAt) throw conflict('Esta sessão já foi desfeita.');
      await tx
        .update(packageUsages)
        .set({ undoneAt: new Date(), undoneBy: auth.userId, undoReason: reason })
        .where(eq(packageUsages.id, usageId));
      await recordAudit(tx, actorOf(auth), {
        entity: 'client_package',
        entityId: id,
        action: 'undo_session',
        before: { package: pkg.name, usedOn: usage.usedOn },
        after: { package: pkg.name, usedOn: usage.usedOn, reason },
      });
      return this.get(auth, id, tx);
    });
  }

  /** Trava o pacote da organização; pacote cancelado não usa nem desfaz sessão. */
  private async lockOpen(tx: Executor, auth: AuthContext, id: string) {
    const [pkg] = await tx
      .select()
      .from(clientPackages)
      .where(and(eq(clientPackages.id, id), eq(clientPackages.organizationId, auth.organizationId)))
      .for('update');
    if (!pkg) throw notFound('Pacote');
    if (pkg.cancelledAt) throw conflict('Pacote cancelado pelo estorno da venda.');
    return pkg;
  }
}
