import type {
  Insurer,
  InsurerCandidate,
  InsurerData,
  InsurerOption,
  InsurerPrices,
  InsurerPricesInput,
} from '@clinica/contracts';
import { and, asc, count, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { actorOf } from '../../core/actor.js';
import { recordAudit } from '../../core/audit.js';
import { AppError, conflict, notFound } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import { containsText } from '../../core/search.js';
import type { Database, Executor } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import { insurerPrices, insurers, patients, products } from '../../db/schema.js';
import type { AuthContext } from '../auth/sessions.js';

type Row = typeof insurers.$inferSelect;

const brl = (value: number) =>
  `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (value: number) => `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

const snapshot = (i: Row) => ({
  name: i.name,
  document: i.document,
  paymentDays: i.paymentDays,
  copayPercent: i.copayPercent,
  requiresAuthorization: i.requiresAuthorization,
  notes: i.notes,
  archived: i.archivedAt !== null,
});

/** Convênios [RN-43, D3]: cadastro e tabela de preços de cada um. */
export class InsurerService {
  constructor(private readonly db: Database) {}

  async list(auth: AuthContext, executor?: Executor): Promise<Insurer[]> {
    const db = executor ?? this.db;
    const rows = await db
      .select()
      .from(insurers)
      .where(eq(insurers.organizationId, auth.organizationId))
      .orderBy(sql`${insurers.archivedAt} is not null`, asc(sql`lower(${insurers.name})`));
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const prices = await db
      .select({ insurerId: insurerPrices.insurerId, n: count() })
      .from(insurerPrices)
      .where(inArray(insurerPrices.insurerId, ids))
      .groupBy(insurerPrices.insurerId);
    const members = await db
      .select({ insurerId: patients.insurerId, n: count() })
      .from(patients)
      .where(
        and(
          inArray(patients.insurerId, ids),
          isNull(patients.archivedAt),
          sql`(${patients.insuranceValidUntil} is null or ${patients.insuranceValidUntil} >= current_date)`,
        ),
      )
      .groupBy(patients.insurerId);
    return rows.map((r) => this.toInsurer(r, prices, members));
  }

  /** Convênios ativos, para o plano do animal. */
  async options(auth: AuthContext): Promise<InsurerOption[]> {
    return this.db
      .select({ id: insurers.id, name: insurers.name })
      .from(insurers)
      .where(and(eq(insurers.organizationId, auth.organizationId), isNull(insurers.archivedAt)))
      .orderBy(asc(sql`lower(${insurers.name})`));
  }

  /** Itens para a tabela: ativos e de venda, por nome ou código. */
  async candidates(auth: AuthContext, q: string): Promise<InsurerCandidate[]> {
    const filters: SQL[] = [
      eq(products.organizationId, auth.organizationId),
      isNull(products.archivedAt),
      ne(products.purpose, 'internal'),
    ];
    if (q) {
      const any = or(
        containsText(products.name, q),
        ...(/^\d{1,9}$/.test(q) ? [eq(products.code, Number(q))] : []),
      );
      if (any) filters.push(any);
    }
    return this.db
      .select({
        id: products.id,
        code: products.code,
        name: products.name,
        kind: products.kind,
        salePrice: products.salePrice,
      })
      .from(products)
      .where(and(...filters))
      .orderBy(asc(sql`lower(${products.name})`))
      .limit(20);
  }

  async create(auth: AuthContext, input: InsurerData): Promise<Insurer> {
    return this.write(async (tx) => {
      const now = new Date();
      const row: Row = {
        id: newId(),
        organizationId: auth.organizationId,
        ...fields(input),
        archivedAt: input.archived ? now : null,
        createdAt: now,
        updatedAt: now,
      };
      await tx.insert(insurers).values(row);
      await recordAudit(tx, actorOf(auth), {
        entity: 'insurer',
        entityId: row.id,
        action: 'create',
        after: snapshot(row),
      });
      return this.one(tx, auth, row.id);
    });
  }

  async update(auth: AuthContext, id: string, input: InsurerData): Promise<Insurer> {
    return this.write(async (tx) => {
      const current = await this.lock(tx, auth, id);
      // Arquivar de novo não muda a data original do arquivamento.
      const archivedAt = input.archived ? (current.archivedAt ?? new Date()) : null;
      const [row] = await tx
        .update(insurers)
        .set({ ...fields(input), archivedAt, updatedAt: new Date() })
        .where(eq(insurers.id, id))
        .returning();
      if (!row) throw notFound('Convênio');
      await recordAudit(tx, actorOf(auth), {
        entity: 'insurer',
        entityId: id,
        action: 'update',
        before: snapshot(current),
        after: snapshot(row),
      });
      return this.one(tx, auth, id);
    });
  }

  async prices(auth: AuthContext, id: string, executor?: Executor): Promise<InsurerPrices> {
    const db = executor ?? this.db;
    const insurer = await this.one(db, auth, id);
    const rows = await db
      .select({
        productId: insurerPrices.productId,
        code: products.code,
        name: products.name,
        kind: products.kind,
        salePrice: products.salePrice,
        price: insurerPrices.price,
        copayPercent: insurerPrices.copayPercent,
        requiresAuthorization: insurerPrices.requiresAuthorization,
        archivedAt: products.archivedAt,
      })
      .from(insurerPrices)
      .innerJoin(products, eq(products.id, insurerPrices.productId))
      .where(eq(insurerPrices.insurerId, id))
      .orderBy(asc(sql`lower(${products.name})`));
    return {
      insurer,
      items: rows.map(({ archivedAt, ...r }) => ({ ...r, archived: archivedAt !== null })),
    };
  }

  /**
   * Salva a tabela inteira: o que sai da lista deixa de ser coberto. Item arquivado ou só de uso
   * interno não entra, a menos que já estivesse na tabela.
   */
  async savePrices(
    auth: AuthContext,
    id: string,
    input: InsurerPricesInput,
  ): Promise<InsurerPrices> {
    return this.db.transaction(async (tx) => {
      const insurer = await this.lock(tx, auth, id);
      const before = await this.prices(auth, id, tx);
      const known = new Set(before.items.map((i) => i.productId));
      const ids = input.items.map((i) => i.productId);
      const found = ids.length
        ? await tx
            .select({
              id: products.id,
              archivedAt: products.archivedAt,
              purpose: products.purpose,
            })
            .from(products)
            .where(and(inArray(products.id, ids), eq(products.organizationId, auth.organizationId)))
        : [];
      input.items.forEach((item, i) => {
        const p = found.find((f) => f.id === item.productId);
        if (!p || ((p.archivedAt || p.purpose === 'internal') && !known.has(item.productId))) {
          throw new AppError('validation_failed', 'Tabela de preços inválida.', [
            { path: `items.${String(i)}.productId`, message: 'Item indisponível para venda' },
          ]);
        }
      });
      await tx.delete(insurerPrices).where(eq(insurerPrices.insurerId, id));
      if (input.items.length > 0) {
        await tx.insert(insurerPrices).values(
          input.items.map((item) => ({
            insurerId: id,
            productId: item.productId,
            price: item.price,
            copayPercent: item.copayPercent,
            requiresAuthorization: item.requiresAuthorization,
          })),
        );
      }
      await tx.update(insurers).set({ updatedAt: new Date() }).where(eq(insurers.id, id));
      const after = await this.prices(auth, id, tx);
      const line = (i: InsurerPrices['items'][number]) =>
        `${i.name} ${brl(i.price)}` +
        (i.copayPercent === null ? '' : ` (coparticipação ${pct(i.copayPercent)})`) +
        (i.requiresAuthorization ? ' com autorização' : '');
      await recordAudit(tx, actorOf(auth), {
        entity: 'insurer_prices',
        entityId: id,
        action: 'update',
        before: { insurer: insurer.name, items: before.items.map(line).join('; ') },
        after: { insurer: insurer.name, items: after.items.map(line).join('; ') },
      });
      return after;
    });
  }

  private async one(db: Executor, auth: AuthContext, id: string): Promise<Insurer> {
    const all = await this.list(auth, db);
    const found = all.find((i) => i.id === id);
    if (!found) throw notFound('Convênio');
    return found;
  }

  private async lock(tx: Executor, auth: AuthContext, id: string): Promise<Row> {
    const [row] = await tx
      .select()
      .from(insurers)
      .where(and(eq(insurers.id, id), eq(insurers.organizationId, auth.organizationId)))
      .for('update');
    if (!row) throw notFound('Convênio');
    return row;
  }

  private toInsurer(
    r: Row,
    prices: { insurerId: string; n: number }[],
    members: { insurerId: string | null; n: number }[],
  ): Insurer {
    return {
      id: r.id,
      name: r.name,
      document: r.document,
      paymentDays: r.paymentDays,
      copayPercent: r.copayPercent,
      requiresAuthorization: r.requiresAuthorization,
      notes: r.notes,
      archived: r.archivedAt !== null,
      priceCount: prices.find((p) => p.insurerId === r.id)?.n ?? 0,
      patientCount: members.find((m) => m.insurerId === r.id)?.n ?? 0,
    };
  }

  private async write<T>(work: (tx: Executor) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(work);
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('Já existe um convênio com este nome.');
      throw error;
    }
  }
}

function fields(input: InsurerData) {
  return {
    name: input.name,
    document: input.document,
    paymentDays: input.paymentDays,
    copayPercent: input.copayPercent,
    requiresAuthorization: input.requiresAuthorization,
    notes: input.notes,
  };
}
