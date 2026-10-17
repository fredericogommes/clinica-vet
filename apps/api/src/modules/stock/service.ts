import {
  fromCents,
  stockExitReasonLabels,
  toCents,
  type StockCancelInput,
  type StockCount,
  type StockCountCreateInput,
  type StockCountList,
  type StockCountUpdateInput,
  type StockExit,
  type StockExitInput,
  type StockExitList,
  type StockExitQuery,
  type StockOptions,
} from '@clinica/contracts';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lte,
  sql,
  sum,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { actorOf } from '../../core/actor.js';
import { recordAudit } from '../../core/audit.js';
import { nextCounter } from '../../core/counters.js';
import { AppError, conflict, notFound } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import type { Database, Executor } from '../../db/client.js';
import {
  productGroups,
  products,
  stockBalances,
  stockCountLines,
  stockCounts,
  stockExitItems,
  stockExits,
  stockLots,
  users,
} from '../../db/schema.js';
import type { AuthContext } from '../auth/sessions.js';
import type { InventoryService } from '../inventory/service.js';
import { fefo, unitToday } from '../inventory/lots.js';

const invalid = (path: string, message: string) =>
  new AppError('validation_failed', `${message}.`, [{ path, message }]);

const brl = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Outras saídas e inventário [p.17]. A saída baixa na hora e guarda o custo do momento; o
 * inventário é aberto, contado aos poucos e aplicado de uma vez, como contagem do saldo.
 */
export class StockOpsService {
  constructor(
    private readonly db: Database,
    private readonly inventory: InventoryService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private today(executor: Executor, unitId: string) {
    return unitToday(executor, unitId, this.now());
  }

  private seeCost(auth: AuthContext) {
    return auth.permissions.has('products.view_cost');
  }

  /** Produtos com estoque controlado, ativos, com os lotes que têm saldo na unidade. */
  async options(auth: AuthContext): Promise<StockOptions> {
    const today = await this.today(this.db, auth.unitId);
    const [rows, lots, groups] = await Promise.all([
      this.db
        .select({
          id: products.id,
          name: products.name,
          unit: products.unit,
          tracksLots: products.tracksLots,
          onHand: sql<number>`coalesce(${stockBalances.onHand}, 0)::float8`,
        })
        .from(products)
        .leftJoin(
          stockBalances,
          and(eq(stockBalances.productId, products.id), eq(stockBalances.unitId, auth.unitId)),
        )
        .where(
          and(
            eq(products.organizationId, auth.organizationId),
            eq(products.tracksStock, true),
            isNull(products.archivedAt),
          ),
        )
        .orderBy(asc(products.name)),
      this.db
        .select({
          id: stockLots.id,
          productId: stockLots.productId,
          code: stockLots.code,
          expiresOn: stockLots.expiresOn,
          onHand: stockLots.onHand,
        })
        .from(stockLots)
        .where(and(eq(stockLots.unitId, auth.unitId), gt(stockLots.onHand, 0)))
        .orderBy(...fefo),
      this.db
        .select({ id: productGroups.id, name: productGroups.name })
        .from(productGroups)
        .where(
          and(
            eq(productGroups.organizationId, auth.organizationId),
            isNull(productGroups.archivedAt),
          ),
        )
        .orderBy(asc(productGroups.name)),
    ]);
    return {
      products: rows.map((p) => ({
        ...p,
        lots: lots
          .filter((l) => l.productId === p.id)
          .map(({ id, code, expiresOn, onHand }) => ({
            id,
            code,
            expiresOn,
            onHand,
            expired: expiresOn !== null && expiresOn < today,
          })),
      })),
      groups,
      today,
    };
  }

  // Outras saídas ----------------------------------------------------------------------------------

  async listExits(auth: AuthContext, query: StockExitQuery): Promise<StockExitList> {
    const filters: SQL[] = [
      eq(stockExits.organizationId, auth.organizationId),
      eq(stockExits.unitId, auth.unitId),
    ];
    if (query.situacao === 'ativas') filters.push(isNull(stockExits.cancelledAt));
    if (query.situacao === 'canceladas') filters.push(sql`${stockExits.cancelledAt} is not null`);
    if (query.motivo) filters.push(eq(stockExits.reason, query.motivo));
    if (query.de) filters.push(gte(stockExits.occurredOn, query.de));
    if (query.ate) filters.push(lte(stockExits.occurredOn, query.ate));
    const where = and(...filters);
    const names = this.db
      .select({
        exitId: stockExitItems.exitId,
        products:
          sql<string>`string_agg(${products.name}, ', ' order by ${stockExitItems.position})`.as(
            'products',
          ),
        n: count().as('n'),
      })
      .from(stockExitItems)
      .innerJoin(products, eq(products.id, stockExitItems.productId))
      .groupBy(stockExitItems.exitId)
      .as('names');
    const [rows, [totals]] = await Promise.all([
      this.db
        .select({
          id: stockExits.id,
          code: stockExits.code,
          reason: stockExits.reason,
          occurredOn: stockExits.occurredOn,
          products: sql<string>`coalesce(${names.products}, '')`,
          itemCount: sql<number>`coalesce(${names.n}, 0)::int`,
          totalCost: stockExits.totalCost,
          cancelledAt: stockExits.cancelledAt,
        })
        .from(stockExits)
        .leftJoin(names, eq(names.exitId, stockExits.id))
        .where(where)
        .orderBy(desc(stockExits.occurredOn), desc(stockExits.code))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db
        .select({
          n: count(),
          cost: sum(
            sql`case when ${stockExits.cancelledAt} is null then ${stockExits.totalCost} else 0 end`,
          ),
        })
        .from(stockExits)
        .where(where),
    ]);
    const seeCost = this.seeCost(auth);
    return {
      items: rows.map((r) => ({
        id: r.id,
        code: r.code,
        reason: r.reason,
        occurredOn: r.occurredOn,
        products: r.products,
        itemCount: r.itemCount,
        totalCost: seeCost ? r.totalCost : null,
        cancelled: r.cancelledAt !== null,
      })),
      total: totals?.n ?? 0,
      totalCost: seeCost ? Number(totals?.cost ?? 0) : null,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async getExit(auth: AuthContext, id: string, db: Executor = this.db): Promise<StockExit> {
    const creator = alias(users, 'creator');
    const canceller = alias(users, 'canceller');
    const [row] = await db
      .select({ exit: stockExits, createdBy: creator.name, cancelledBy: canceller.name })
      .from(stockExits)
      .innerJoin(creator, eq(creator.id, stockExits.createdBy))
      .leftJoin(canceller, eq(canceller.id, stockExits.cancelledBy))
      .where(
        and(
          eq(stockExits.id, id),
          eq(stockExits.organizationId, auth.organizationId),
          eq(stockExits.unitId, auth.unitId),
        ),
      );
    if (!row) throw notFound('Saída');
    const items = await db
      .select({
        item: stockExitItems,
        product: { id: products.id, name: products.name, unit: products.unit },
        lot: { id: stockLots.id, code: stockLots.code, expiresOn: stockLots.expiresOn },
      })
      .from(stockExitItems)
      .innerJoin(products, eq(products.id, stockExitItems.productId))
      .leftJoin(stockLots, eq(stockLots.id, stockExitItems.lotId))
      .where(eq(stockExitItems.exitId, id))
      .orderBy(asc(stockExitItems.position));
    const e = row.exit;
    const seeCost = this.seeCost(auth);
    return {
      id: e.id,
      code: e.code,
      reason: e.reason,
      occurredOn: e.occurredOn,
      notes: e.notes,
      totalCost: seeCost ? e.totalCost : null,
      items: items.map((i) => ({
        id: i.item.id,
        product: i.product,
        lot: i.lot?.id ? i.lot : null,
        quantity: i.item.quantity,
        unitCost: seeCost ? i.item.unitCost : null,
      })),
      createdBy: row.createdBy,
      createdAt: e.createdAt.toISOString(),
      cancelledBy: row.cancelledBy,
      cancelledAt: e.cancelledAt?.toISOString() ?? null,
      cancelReason: e.cancelReason,
    };
  }

  async createExit(auth: AuthContext, input: StockExitInput): Promise<StockExit> {
    return this.db.transaction(async (tx) => {
      const today = await this.today(tx, auth.unitId);
      if (input.occurredOn > today) throw invalid('occurredOn', 'A saída não pode ser no futuro');
      const productIds = [...new Set(input.items.map((i) => i.productId))];
      const found = await tx
        .select({ id: products.id, name: products.name, cost: products.cost })
        .from(products)
        .where(
          and(inArray(products.id, productIds), eq(products.organizationId, auth.organizationId)),
        );
      input.items.forEach((item, index) => {
        if (!found.some((p) => p.id === item.productId)) {
          throw invalid(`items.${String(index)}.productId`, 'Produto indisponível');
        }
      });
      const id = newId();
      const code = await nextCounter(tx, auth.organizationId, 'stock_exit');
      const costOf = (productId: string) => found.find((p) => p.id === productId)?.cost ?? null;
      const totalCents = input.items.reduce((total, i) => {
        const cost = costOf(i.productId);
        return total + (cost === null ? 0 : Math.round(toCents(cost) * i.quantity));
      }, 0);
      await tx.insert(stockExits).values({
        id,
        organizationId: auth.organizationId,
        unitId: auth.unitId,
        code,
        reason: input.reason,
        occurredOn: input.occurredOn,
        notes: input.notes,
        totalCost: fromCents(totalCents),
        createdBy: auth.userId,
      });
      await tx.insert(stockExitItems).values(
        input.items.map((item, position) => ({
          id: newId(),
          exitId: id,
          position,
          productId: item.productId,
          lotId: item.lotId,
          quantity: item.quantity,
          unitCost: costOf(item.productId),
        })),
      );
      await this.inventory.issue(
        tx,
        auth,
        { id, organizationId: auth.organizationId, unitId: auth.unitId, code },
        input.items.map((item, index) => ({ index, ...item })),
      );
      await recordAudit(tx, actorOf(auth), {
        entity: 'stock_exit',
        entityId: id,
        action: 'create',
        after: {
          code,
          reason: stockExitReasonLabels[input.reason],
          occurredOn: input.occurredOn,
          items: input.items.map(
            (i) => `${String(i.quantity)} ${found.find((p) => p.id === i.productId)?.name ?? ''}`,
          ),
          totalCost: brl(fromCents(totalCents)),
          notes: input.notes,
        },
      });
      return this.getExit(auth, id, tx);
    });
  }

  async cancelExit(auth: AuthContext, id: string, input: StockCancelInput): Promise<StockExit> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(stockExits)
        .where(
          and(
            eq(stockExits.id, id),
            eq(stockExits.organizationId, auth.organizationId),
            eq(stockExits.unitId, auth.unitId),
          ),
        )
        .for('update');
      if (!current) throw notFound('Saída');
      if (current.cancelledAt) throw conflict('Esta saída já está cancelada.');
      await this.inventory.unissue(tx, auth, current);
      await tx
        .update(stockExits)
        .set({ cancelledAt: new Date(), cancelledBy: auth.userId, cancelReason: input.reason })
        .where(eq(stockExits.id, id));
      await recordAudit(tx, actorOf(auth), {
        entity: 'stock_exit',
        entityId: id,
        action: 'cancel',
        after: { code: current.code, reason: input.reason },
      });
      return this.getExit(auth, id, tx);
    });
  }

  // Inventário -------------------------------------------------------------------------------------

  async listCounts(
    auth: AuthContext,
    query: { page: number; pageSize: number },
  ): Promise<StockCountList> {
    const where = and(
      eq(stockCounts.organizationId, auth.organizationId),
      eq(stockCounts.unitId, auth.unitId),
    );
    const lines = this.db
      .select({
        countId: stockCountLines.countId,
        n: count().as('n'),
        counted: count(stockCountLines.counted).as('counted'),
      })
      .from(stockCountLines)
      .groupBy(stockCountLines.countId)
      .as('lines');
    const [rows, [total]] = await Promise.all([
      this.db
        .select({
          id: stockCounts.id,
          code: stockCounts.code,
          status: stockCounts.status,
          group: productGroups.name,
          createdAt: stockCounts.createdAt,
          lines: sql<number>`coalesce(${lines.n}, 0)::int`,
          counted: sql<number>`coalesce(${lines.counted}, 0)::int`,
        })
        .from(stockCounts)
        .leftJoin(productGroups, eq(productGroups.id, stockCounts.groupId))
        .leftJoin(lines, eq(lines.countId, stockCounts.id))
        .where(where)
        .orderBy(desc(stockCounts.code))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ n: count() }).from(stockCounts).where(where),
    ]);
    return {
      items: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      total: total?.n ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async getCount(auth: AuthContext, id: string, db: Executor = this.db): Promise<StockCount> {
    const creator = alias(users, 'creator');
    const closer = alias(users, 'closer');
    const [row] = await db
      .select({
        count: stockCounts,
        group: { id: productGroups.id, name: productGroups.name },
        createdBy: creator.name,
        closedBy: closer.name,
      })
      .from(stockCounts)
      .leftJoin(productGroups, eq(productGroups.id, stockCounts.groupId))
      .innerJoin(creator, eq(creator.id, stockCounts.createdBy))
      .leftJoin(closer, eq(closer.id, stockCounts.closedBy))
      .where(
        and(
          eq(stockCounts.id, id),
          eq(stockCounts.organizationId, auth.organizationId),
          eq(stockCounts.unitId, auth.unitId),
        ),
      );
    if (!row) throw notFound('Inventário');
    const c = row.count;
    const lines = await db
      .select({
        line: stockCountLines,
        product: { id: products.id, name: products.name, unit: products.unit },
        lot: {
          id: stockLots.id,
          code: stockLots.code,
          expiresOn: stockLots.expiresOn,
          onHand: stockLots.onHand,
        },
        onHand: stockBalances.onHand,
        shortfall: stockBalances.shortfall,
      })
      .from(stockCountLines)
      .innerJoin(products, eq(products.id, stockCountLines.productId))
      .leftJoin(stockLots, eq(stockLots.id, stockCountLines.lotId))
      .leftJoin(
        stockBalances,
        and(eq(stockBalances.productId, products.id), eq(stockBalances.unitId, c.unitId)),
      )
      .where(eq(stockCountLines.countId, id))
      .orderBy(asc(products.name), sql`${stockLots.expiresOn} nulls first`, asc(stockLots.code));
    return {
      id: c.id,
      code: c.code,
      status: c.status,
      group: row.group?.id ? row.group : null,
      notes: c.notes,
      createdBy: row.createdBy,
      createdAt: c.createdAt.toISOString(),
      closedBy: row.closedBy,
      closedAt: c.closedAt?.toISOString() ?? null,
      lines: lines.map((l) => {
        const current = l.lot?.id ? l.lot.onHand : (l.onHand ?? 0) - (l.shortfall ?? 0);
        return {
          id: l.line.id,
          product: l.product,
          lot: l.lot?.id ? { id: l.lot.id, code: l.lot.code, expiresOn: l.lot.expiresOn } : null,
          expected:
            c.status === 'applied' ? (l.line.expected ?? 0) : Math.round(current * 1000) / 1000,
          counted: l.line.counted,
        };
      }),
    };
  }

  /** Abre o inventário com uma linha por produto com estoque (por lote com saldo, se tem lote). */
  async createCount(auth: AuthContext, input: StockCountCreateInput): Promise<StockCount> {
    return this.db.transaction(async (tx) => {
      if (input.groupId) {
        const [group] = await tx
          .select({ id: productGroups.id })
          .from(productGroups)
          .where(
            and(
              eq(productGroups.id, input.groupId),
              eq(productGroups.organizationId, auth.organizationId),
            ),
          );
        if (!group) throw invalid('groupId', 'Grupo indisponível');
      }
      const filters: SQL[] = [
        eq(products.organizationId, auth.organizationId),
        eq(products.tracksStock, true),
        isNull(products.archivedAt),
      ];
      if (input.groupId) filters.push(eq(products.groupId, input.groupId));
      const tracked = await tx
        .select({ id: products.id, tracksLots: products.tracksLots })
        .from(products)
        .where(and(...filters));
      if (tracked.length === 0) {
        throw invalid(
          'groupId',
          input.groupId
            ? 'Nenhum produto com estoque neste grupo'
            : 'Nenhum produto controla estoque',
        );
      }
      const withLots = tracked.filter((p) => p.tracksLots).map((p) => p.id);
      const lots =
        withLots.length > 0
          ? await tx
              .select({ id: stockLots.id, productId: stockLots.productId })
              .from(stockLots)
              .where(
                and(
                  eq(stockLots.unitId, auth.unitId),
                  inArray(stockLots.productId, withLots),
                  gt(stockLots.onHand, 0),
                ),
              )
          : [];
      const id = newId();
      const code = await nextCounter(tx, auth.organizationId, 'stock_count');
      await tx.insert(stockCounts).values({
        id,
        organizationId: auth.organizationId,
        unitId: auth.unitId,
        code,
        status: 'open',
        groupId: input.groupId,
        notes: input.notes,
        createdBy: auth.userId,
      });
      const rows = tracked.flatMap((p): (typeof stockCountLines.$inferInsert)[] =>
        p.tracksLots
          ? lots
              .filter((l) => l.productId === p.id)
              .map((l) => ({ id: newId(), countId: id, productId: p.id, lotId: l.id }))
          : [{ id: newId(), countId: id, productId: p.id, lotId: null }],
      );
      if (rows.length > 0) await tx.insert(stockCountLines).values(rows);
      await recordAudit(tx, actorOf(auth), {
        entity: 'stock_count',
        entityId: id,
        action: 'create',
        after: { code, lines: rows.length },
      });
      return this.getCount(auth, id, tx);
    });
  }

  private async lockCount(tx: Executor, auth: AuthContext, id: string) {
    const [row] = await tx
      .select()
      .from(stockCounts)
      .where(
        and(
          eq(stockCounts.id, id),
          eq(stockCounts.organizationId, auth.organizationId),
          eq(stockCounts.unitId, auth.unitId),
        ),
      )
      .for('update');
    if (!row) throw notFound('Inventário');
    if (row.status !== 'open') throw conflict('Este inventário já foi aplicado ou cancelado.');
    return row;
  }

  /** Grava o que foi contado até agora; vazio volta a "não contado". */
  async updateCount(
    auth: AuthContext,
    id: string,
    input: StockCountUpdateInput,
  ): Promise<StockCount> {
    return this.db.transaction(async (tx) => {
      await this.lockCount(tx, auth, id);
      const ids = input.lines.map((l) => l.id);
      if (ids.length > 0) {
        const known = await tx
          .select({ id: stockCountLines.id })
          .from(stockCountLines)
          .where(and(eq(stockCountLines.countId, id), inArray(stockCountLines.id, ids)));
        input.lines.forEach((line, index) => {
          if (!known.some((k) => k.id === line.id)) {
            throw invalid(`lines.${String(index)}.id`, 'Linha de outro inventário');
          }
        });
        for (const line of input.lines) {
          await tx
            .update(stockCountLines)
            .set({ counted: line.counted })
            .where(eq(stockCountLines.id, line.id));
        }
      }
      return this.getCount(auth, id, tx);
    });
  }

  async applyCount(auth: AuthContext, id: string): Promise<StockCount> {
    return this.db.transaction(async (tx) => {
      const current = await this.lockCount(tx, auth, id);
      const lines = await tx
        .select()
        .from(stockCountLines)
        .where(and(eq(stockCountLines.countId, id), sql`${stockCountLines.counted} is not null`));
      if (lines.length === 0) throw conflict('Conte ao menos um item antes de aplicar.');
      const expected = await this.inventory.applyCount(
        tx,
        auth,
        current,
        lines.map((l) => ({ productId: l.productId, lotId: l.lotId, counted: l.counted ?? 0 })),
      );
      let differences = 0;
      for (const [index, line] of lines.entries()) {
        const before = expected[index] ?? null;
        if (
          before !== null &&
          Math.round(before * 1000) !== Math.round((line.counted ?? 0) * 1000)
        ) {
          differences += 1;
        }
        await tx
          .update(stockCountLines)
          .set({ expected: before })
          .where(eq(stockCountLines.id, line.id));
      }
      // O que não foi contado sai do inventário aplicado: não mexeu no saldo.
      await tx
        .delete(stockCountLines)
        .where(and(eq(stockCountLines.countId, id), isNull(stockCountLines.counted)));
      await tx
        .update(stockCounts)
        .set({ status: 'applied', closedAt: new Date(), closedBy: auth.userId })
        .where(eq(stockCounts.id, id));
      await recordAudit(tx, actorOf(auth), {
        entity: 'stock_count',
        entityId: id,
        action: 'apply',
        after: { code: current.code, counted: lines.length, differences },
      });
      return this.getCount(auth, id, tx);
    });
  }

  async cancelCount(auth: AuthContext, id: string): Promise<StockCount> {
    return this.db.transaction(async (tx) => {
      const current = await this.lockCount(tx, auth, id);
      await tx
        .update(stockCounts)
        .set({ status: 'cancelled', closedAt: new Date(), closedBy: auth.userId })
        .where(eq(stockCounts.id, id));
      await recordAudit(tx, actorOf(auth), {
        entity: 'stock_count',
        entityId: id,
        action: 'cancel',
        after: { code: current.code },
      });
      return this.getCount(auth, id, tx);
    });
  }
}
