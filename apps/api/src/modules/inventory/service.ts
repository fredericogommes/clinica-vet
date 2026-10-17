import {
  fromMilli,
  toMilli,
  type ProductStock,
  type StockAdjustmentInput,
  type StockSummary,
} from '@clinica/contracts';
import { and, asc, desc, eq, gte, inArray, ne, sql, sum } from 'drizzle-orm';
import { actorOf } from '../../core/actor.js';
import { recordAudit } from '../../core/audit.js';
import { AppError, conflict, notFound } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import type { Database, Executor } from '../../db/client.js';
import {
  productGroups,
  products,
  saleItems,
  sales,
  stockBalances,
  stockMovements,
  units,
  users,
} from '../../db/schema.js';
import type { AuthContext } from '../auth/sessions.js';

const qty = (milli: number) =>
  fromMilli(milli).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

/** Produto com estoque controlado e o saldo travado nesta transação, em milésimos. */
interface Locked {
  productId: string;
  name: string;
  unit: string;
  blocks: boolean;
  onHand: number;
  shortfall: number;
}

/** Entrada quita a pendência antes de somar ao saldo; o saldo nunca fica negativo. */
function applyEntry(b: { onHand: number; shortfall: number }, milli: number) {
  const paid = Math.min(b.shortfall, milli);
  return { onHand: b.onHand + milli - paid, shortfall: b.shortfall - paid };
}

/** Soma as quantidades por produto, guardando a posição da primeira linha (para o erro). */
function perProduct(items: { productId: string; quantity: number }[]) {
  const map = new Map<string, { milli: number; index: number }>();
  items.forEach((item, index) => {
    const current = map.get(item.productId);
    if (current) current.milli += toMilli(item.quantity);
    else map.set(item.productId, { milli: toMilli(item.quantity), index });
  });
  return map;
}

/**
 * Estoque por unidade com reserva na venda [RN-31, D4]. Venda em aberto reserva; a baixa tira
 * do saldo; o estorno devolve. Grupo que bloqueia recusa venda acima do disponível; grupo
 * liberado deixa a baixa seguir e a falta vira pendência, nunca saldo negativo.
 */
export class InventoryService {
  constructor(private readonly db: Database) {}

  /**
   * Trava, em ordem de produto, o saldo dos itens com estoque controlado (criando a linha na
   * primeira vez). Quem chega depois espera e enxerga as reservas já gravadas.
   */
  private async lock(
    tx: Executor,
    organizationId: string,
    unitId: string,
    productIds: string[],
  ): Promise<Map<string, Locked>> {
    if (productIds.length === 0) return new Map();
    const tracked = await tx
      .select({
        id: products.id,
        name: products.name,
        unit: products.unit,
        blocks: sql<boolean>`coalesce(${productGroups.blocksSaleWithoutStock}, true)`,
      })
      .from(products)
      .leftJoin(productGroups, eq(productGroups.id, products.groupId))
      .where(
        and(
          inArray(products.id, productIds),
          eq(products.organizationId, organizationId),
          eq(products.tracksStock, true),
        ),
      );
    if (tracked.length === 0) return new Map();
    tracked.sort((a, b) => (a.id < b.id ? -1 : 1));
    await tx
      .insert(stockBalances)
      .values(tracked.map((p) => ({ organizationId, unitId, productId: p.id })))
      .onConflictDoNothing();
    const balances = await tx
      .select()
      .from(stockBalances)
      .where(
        and(
          eq(stockBalances.unitId, unitId),
          inArray(
            stockBalances.productId,
            tracked.map((p) => p.id),
          ),
        ),
      )
      .orderBy(asc(stockBalances.productId))
      .for('update');
    const byId = new Map(tracked.map((p) => [p.id, p]));
    const result = new Map<string, Locked>();
    for (const b of balances) {
      const p = byId.get(b.productId);
      if (!p) continue;
      result.set(b.productId, {
        productId: b.productId,
        name: p.name,
        unit: p.unit,
        blocks: p.blocks,
        onHand: toMilli(b.onHand),
        shortfall: toMilli(b.shortfall),
      });
    }
    return result;
  }

  /** Reservado por vendas em aberto da unidade, fora a venda informada. */
  private async reserved(
    tx: Executor,
    unitId: string,
    productIds: string[],
    exceptSaleId: string | null,
  ): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();
    const filters = [
      eq(sales.unitId, unitId),
      eq(sales.status, 'open'),
      inArray(saleItems.productId, productIds),
    ];
    if (exceptSaleId) filters.push(ne(sales.id, exceptSaleId));
    const rows = await tx
      .select({ productId: saleItems.productId, total: sum(saleItems.quantity) })
      .from(saleItems)
      .innerJoin(sales, eq(sales.id, saleItems.saleId))
      .where(and(...filters))
      .groupBy(saleItems.productId);
    return new Map(rows.map((r) => [r.productId, toMilli(Number(r.total ?? 0))]));
  }

  /**
   * Reserva os itens de uma venda em aberto, já gravados [RN-31]. Em grupo que bloqueia, o
   * pedido precisa caber no saldo menos o que as outras vendas em aberto reservam.
   */
  async reserve(
    tx: Executor,
    sale: { id: string; organizationId: string; unitId: string; status: string },
    items: { productId: string; quantity: number }[],
  ): Promise<void> {
    if (sale.status !== 'open') return;
    const wanted = perProduct(items);
    const locked = await this.lock(tx, sale.organizationId, sale.unitId, [...wanted.keys()]);
    const reserved = await this.reserved(tx, sale.unitId, [...locked.keys()], sale.id);
    for (const [productId, want] of wanted) {
      const b = locked.get(productId);
      if (!b?.blocks) continue;
      const available = Math.max(0, b.onHand - (reserved.get(productId) ?? 0));
      if (want.milli > available) {
        const message =
          available === 0
            ? `${b.name} está sem estoque disponível`
            : `Só há ${qty(available)} ${b.unit} de ${b.name} disponível`;
        // A mensagem geral repete o detalhe: a ficha clínica mostra só ela num aviso.
        throw new AppError('validation_failed', `${message}.`, [
          { path: `items.${String(want.index)}.quantity`, message },
        ]);
      }
    }
  }

  /** Baixa da venda: tira do saldo; em grupo liberado, o que faltar vira pendência. */
  async consume(
    tx: Executor,
    auth: AuthContext,
    sale: { id: string; organizationId: string; unitId: string },
  ): Promise<void> {
    const items = await tx
      .select({ productId: saleItems.productId, quantity: saleItems.quantity })
      .from(saleItems)
      .where(eq(saleItems.saleId, sale.id));
    const wanted = perProduct(items);
    const locked = await this.lock(tx, sale.organizationId, sale.unitId, [...wanted.keys()]);
    for (const [productId, want] of wanted) {
      const b = locked.get(productId);
      if (!b) continue;
      if (b.blocks && want.milli > b.onHand) {
        throw conflict(
          b.onHand === 0
            ? `${b.name} está sem estoque; lance a entrada antes de baixar a venda.`
            : `Só há ${qty(b.onHand)} ${b.unit} de ${b.name} em estoque para baixar a venda.`,
        );
      }
      const taken = Math.min(want.milli, b.onHand);
      const after = { onHand: b.onHand - taken, shortfall: b.shortfall + want.milli - taken };
      await this.write(tx, auth, sale, productId, after, {
        kind: 'sale',
        quantity: -want.milli,
        shortfall: want.milli - taken,
        notes: '',
      });
    }
  }

  /** Estorno da venda: devolve exatamente o que a baixa tirou, quitando pendências primeiro. */
  async restore(
    tx: Executor,
    auth: AuthContext,
    sale: { id: string; organizationId: string; unitId: string },
  ): Promise<void> {
    const out = await tx
      .select({ productId: stockMovements.productId, total: sum(stockMovements.quantity) })
      .from(stockMovements)
      .where(and(eq(stockMovements.saleId, sale.id), eq(stockMovements.kind, 'sale')))
      .groupBy(stockMovements.productId);
    const locked = await this.lock(
      tx,
      sale.organizationId,
      sale.unitId,
      out.map((o) => o.productId),
    );
    for (const o of out) {
      const b = locked.get(o.productId);
      if (!b) continue;
      const milli = -toMilli(Number(o.total ?? 0));
      if (milli <= 0) continue;
      await this.write(tx, auth, sale, o.productId, applyEntry(b, milli), {
        kind: 'sale_return',
        quantity: milli,
        shortfall: 0,
        notes: '',
      });
    }
  }

  private async write(
    tx: Executor,
    auth: AuthContext,
    scope: { organizationId: string; unitId: string; id?: string },
    productId: string,
    after: { onHand: number; shortfall: number },
    movement: {
      kind: 'entry' | 'count' | 'sale' | 'sale_return';
      quantity: number;
      shortfall: number;
      notes: string;
    },
  ) {
    await tx
      .update(stockBalances)
      .set({
        onHand: fromMilli(after.onHand),
        shortfall: fromMilli(after.shortfall),
        updatedAt: new Date(),
      })
      .where(and(eq(stockBalances.unitId, scope.unitId), eq(stockBalances.productId, productId)));
    await tx.insert(stockMovements).values({
      id: newId(),
      organizationId: scope.organizationId,
      unitId: scope.unitId,
      productId,
      kind: movement.kind,
      quantity: fromMilli(movement.quantity),
      shortfall: fromMilli(movement.shortfall),
      onHandAfter: fromMilli(after.onHand),
      shortfallAfter: fromMilli(after.shortfall),
      notes: movement.notes,
      saleId:
        movement.kind === 'sale' || movement.kind === 'sale_return' ? (scope.id ?? null) : null,
      createdBy: auth.userId,
    });
  }

  /**
   * Saldo para o PDV e as listas: disponível (saldo menos reservas de outras vendas em aberto) e
   * pendência, por produto com estoque controlado; os demais ficam de fora do mapa.
   */
  async summaries(
    executor: Executor,
    organizationId: string,
    unitId: string,
    productIds: string[],
    exceptSaleId: string | null = null,
  ): Promise<Map<string, StockSummary & { onHand: number }>> {
    if (productIds.length === 0) return new Map();
    const rows = await executor
      .select({
        id: products.id,
        blocks: sql<boolean>`coalesce(${productGroups.blocksSaleWithoutStock}, true)`,
        onHand: stockBalances.onHand,
        shortfall: stockBalances.shortfall,
      })
      .from(products)
      .leftJoin(productGroups, eq(productGroups.id, products.groupId))
      .leftJoin(
        stockBalances,
        and(eq(stockBalances.productId, products.id), eq(stockBalances.unitId, unitId)),
      )
      .where(
        and(
          inArray(products.id, productIds),
          eq(products.organizationId, organizationId),
          eq(products.tracksStock, true),
        ),
      );
    const reserved = await this.reserved(
      executor,
      unitId,
      rows.map((r) => r.id),
      exceptSaleId,
    );
    return new Map(
      rows.map((r) => {
        const onHand = toMilli(r.onHand ?? 0);
        return [
          r.id,
          {
            onHand: fromMilli(onHand),
            available: fromMilli(Math.max(0, onHand - (reserved.get(r.id) ?? 0))),
            shortfall: r.shortfall ?? 0,
            blocksSaleWithoutStock: r.blocks,
          },
        ];
      }),
    );
  }

  private async product(executor: Executor, auth: AuthContext, productId: string) {
    const [row] = await executor
      .select({
        id: products.id,
        name: products.name,
        kind: products.kind,
        tracksStock: products.tracksStock,
        minStock: products.minStock,
        idealStock: products.idealStock,
        blocks: sql<boolean>`coalesce(${productGroups.blocksSaleWithoutStock}, true)`,
      })
      .from(products)
      .leftJoin(productGroups, eq(productGroups.id, products.groupId))
      .where(and(eq(products.id, productId), eq(products.organizationId, auth.organizationId)));
    if (!row) throw notFound('Produto');
    return row;
  }

  /** Estoque do produto na unidade atual, com as movimentações dos últimos 3 meses [p.17]. */
  async stock(auth: AuthContext, productId: string, executor: Executor = this.db) {
    const product = await this.product(executor, auth, productId);
    if (!product.tracksStock) return null;
    const [unit] = await executor
      .select({ name: units.name })
      .from(units)
      .where(eq(units.id, auth.unitId));
    const summary = (
      await this.summaries(executor, auth.organizationId, auth.unitId, [productId])
    ).get(productId);
    const onHand = summary?.onHand ?? 0;
    const since = new Date(Date.now() - 92 * 24 * 60 * 60 * 1000);
    const movements = await executor
      .select({
        id: stockMovements.id,
        kind: stockMovements.kind,
        at: stockMovements.createdAt,
        quantity: stockMovements.quantity,
        shortfall: stockMovements.shortfall,
        onHandAfter: stockMovements.onHandAfter,
        notes: stockMovements.notes,
        saleId: stockMovements.saleId,
        saleCode: sales.code,
        by: users.name,
      })
      .from(stockMovements)
      .innerJoin(users, eq(users.id, stockMovements.createdBy))
      .leftJoin(sales, eq(sales.id, stockMovements.saleId))
      .where(
        and(
          eq(stockMovements.unitId, auth.unitId),
          eq(stockMovements.productId, productId),
          gte(stockMovements.createdAt, since),
        ),
      )
      .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
      .limit(200);
    const result: ProductStock = {
      unitName: unit?.name ?? '',
      onHand,
      reserved: fromMilli(Math.max(0, toMilli(onHand) - toMilli(summary?.available ?? 0))),
      available: summary?.available ?? 0,
      shortfall: summary?.shortfall ?? 0,
      minStock: product.minStock,
      idealStock: product.idealStock,
      blocksSaleWithoutStock: product.blocks,
      movements: movements.map((m) => ({
        id: m.id,
        kind: m.kind,
        at: m.at.toISOString(),
        quantity: m.quantity,
        shortfall: m.shortfall,
        onHandAfter: m.onHandAfter,
        notes: m.notes,
        sale: m.saleId && m.saleCode !== null ? { id: m.saleId, code: m.saleCode } : null,
        by: m.by,
      })),
      canAdjust: auth.permissions.has('inventory.adjust'),
    };
    return result;
  }

  /**
   * Entrada manual (até Compras, F2-7) ou contagem: a contagem vira o saldo e zera a pendência.
   * Grava o movimento e a auditoria na mesma transação [RN-03].
   */
  async adjust(
    auth: AuthContext,
    productId: string,
    input: StockAdjustmentInput,
  ): Promise<ProductStock> {
    return this.db.transaction(async (tx) => {
      const product = await this.product(tx, auth, productId);
      if (!product.tracksStock) {
        throw conflict('Este item não controla estoque. Ative "Controla estoque" no cadastro.');
      }
      const locked = await this.lock(tx, auth.organizationId, auth.unitId, [productId]);
      const b = locked.get(productId);
      if (!b) throw notFound('Produto');
      const scope = { organizationId: auth.organizationId, unitId: auth.unitId };
      let after: { onHand: number; shortfall: number };
      if (input.kind === 'entry') {
        const milli = toMilli(input.quantity);
        after = applyEntry(b, milli);
        await this.write(tx, auth, scope, productId, after, {
          kind: 'entry',
          quantity: milli,
          shortfall: 0,
          notes: input.notes,
        });
      } else {
        after = { onHand: toMilli(input.countedQuantity), shortfall: 0 };
        await this.write(tx, auth, scope, productId, after, {
          kind: 'count',
          // Diferença entre o contado e o saldo líquido (saldo − pendência).
          quantity: after.onHand - (b.onHand - b.shortfall),
          shortfall: 0,
          notes: input.notes,
        });
      }
      await recordAudit(tx, actorOf(auth), {
        entity: 'product',
        entityId: productId,
        action: input.kind === 'entry' ? 'stock_entry' : 'stock_count',
        before: { onHand: fromMilli(b.onHand), shortfall: fromMilli(b.shortfall) },
        after: {
          onHand: fromMilli(after.onHand),
          shortfall: fromMilli(after.shortfall),
          notes: input.notes,
        },
      });
      const stock = await this.stock(auth, productId, tx);
      if (!stock) throw notFound('Produto');
      return stock;
    });
  }
}
