import {
  fromMilli,
  toMilli,
  type LotTrace,
  type ProductStock,
  type StockAdjustmentInput,
  type StockMovementKind,
  type StockSummary,
} from '@clinica/contracts';
import { and, asc, desc, eq, gt, gte, inArray, ne, sql, sum } from 'drizzle-orm';
import { actorOf } from '../../core/actor.js';
import { recordAudit } from '../../core/audit.js';
import { AppError, conflict, notFound } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import type { Database, Executor } from '../../db/client.js';
import {
  clients,
  patients,
  productGroups,
  products,
  purchases,
  saleItems,
  sales,
  stockBalances,
  stockLots,
  stockMovementLots,
  stockMovements,
  units,
  users,
} from '../../db/schema.js';
import type { AuthContext } from '../auth/sessions.js';
import { expiryState, fefo, legacyLot, lotExpiry, unitToday } from './lots.js';

const qty = (milli: number) =>
  fromMilli(milli).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

const brDate = (iso: string) => iso.split('-').reverse().join('/');

const invalid = (path: string, message: string) =>
  new AppError('validation_failed', `${message}.`, [{ path, message }]);

/** Mudança de saldo de um lote dentro de um movimento, em milésimos. */
interface LotChange {
  lotId: string;
  milli: number;
}

/**
 * Tira `milli` dos lotes na ordem recebida (validade mais próxima primeiro) e devolve o que
 * sobrou em cada um; é a regra de saída e também a de quitar pendência no estorno.
 */
function takeInOrder<T extends { milli: number }>(lots: T[], milli: number): T[] {
  let left = milli;
  return lots.map((lot) => {
    const taken = Math.min(lot.milli, left);
    left -= taken;
    return { ...lot, milli: taken };
  });
}

/** Produto com estoque controlado e o saldo travado nesta transação, em milésimos. */
interface Locked {
  productId: string;
  name: string;
  unit: string;
  blocks: boolean;
  tracksLots: boolean;
  onHand: number;
  shortfall: number;
  /** Saldo em lote vencido: conta no saldo, mas não sai em venda. */
  expired: number;
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
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private today(executor: Executor, unitId: string): Promise<string> {
    return unitToday(executor, unitId, this.now());
  }

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
        tracksLots: products.tracksLots,
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
    const withLots = tracked.filter((p) => p.tracksLots).map((p) => p.id);
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
    const expiry =
      withLots.length > 0
        ? await lotExpiry(tx, unitId, withLots, await this.today(tx, unitId))
        : new Map<string, { expired: number }>();
    const result = new Map<string, Locked>();
    for (const b of balances) {
      const p = byId.get(b.productId);
      if (!p) continue;
      result.set(b.productId, {
        productId: b.productId,
        name: p.name,
        unit: p.unit,
        blocks: p.blocks,
        tracksLots: p.tracksLots,
        onHand: toMilli(b.onHand),
        shortfall: toMilli(b.shortfall),
        expired: p.tracksLots ? toMilli(expiry.get(b.productId)?.expired ?? 0) : 0,
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
      const available = Math.max(0, b.onHand - b.expired - (reserved.get(productId) ?? 0));
      if (want.milli > available) {
        const message =
          (available === 0
            ? `${b.name} está sem estoque disponível`
            : `Só há ${qty(available)} ${b.unit} de ${b.name} disponível`) +
          (b.expired > 0 ? ` (${qty(b.expired)} ${b.unit} vencidas ficam de fora)` : '');
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
      const valid = b.onHand - b.expired;
      if (b.blocks && want.milli > valid) {
        const expired =
          b.expired > 0 ? ` ${qty(b.expired)} ${b.unit} vencidas não podem sair.` : '';
        throw conflict(
          valid === 0
            ? `${b.name} está sem estoque válido; lance a entrada antes de baixar a venda.${expired}`
            : `Só há ${qty(valid)} ${b.unit} de ${b.name} em estoque para baixar a venda.${expired}`,
        );
      }
      const taken = Math.min(want.milli, valid);
      const after = { onHand: b.onHand - taken, shortfall: b.shortfall + want.milli - taken };
      const lots = b.tracksLots
        ? takeInOrder(await this.validLots(tx, sale.unitId, productId), taken)
            .filter((l) => l.milli > 0)
            .map((l) => ({ lotId: l.lotId, milli: -l.milli }))
        : [];
      await this.write(
        tx,
        auth,
        sale,
        productId,
        after,
        { kind: 'sale', quantity: -want.milli, shortfall: want.milli - taken, notes: '' },
        lots,
      );
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
      const after = applyEntry(b, milli);
      const lots = b.tracksLots
        ? await this.returnedLots(tx, sale, o.productId, after.onHand - b.onHand)
        : [];
      await this.write(
        tx,
        auth,
        sale,
        o.productId,
        after,
        { kind: 'sale_return', quantity: milli, shortfall: 0, notes: '' },
        lots,
      );
    }
  }

  /**
   * Entrada da compra confirmada [p.17]: cada linha da nota vira um movimento, já convertida para
   * a unidade do produto; a entrada quita a pendência antes e só o restante entra no lote.
   */
  async receive(
    tx: Executor,
    auth: AuthContext,
    purchase: { id: string; organizationId: string; unitId: string; code: number },
    lines: {
      index: number;
      productId: string;
      quantity: number;
      lot: { code: string; expiresOn: string } | null;
    }[],
  ): Promise<void> {
    const locked = await this.lock(
      tx,
      purchase.organizationId,
      purchase.unitId,
      lines.map((l) => l.productId),
    );
    for (const line of lines) {
      const b = locked.get(line.productId);
      if (!b) continue;
      const milli = toMilli(line.quantity);
      const after = applyEntry(b, milli);
      const lot = b.tracksLots
        ? await this.entryLot(tx, auth, line.productId, line.lot, `items.${String(line.index)}.lot`)
        : null;
      await this.write(
        tx,
        auth,
        purchase,
        line.productId,
        after,
        {
          kind: 'purchase',
          quantity: milli,
          shortfall: 0,
          notes: `Compra ${String(purchase.code)}`,
        },
        lot ? [{ lotId: lot.id, milli: after.onHand - b.onHand }] : [],
      );
      locked.set(line.productId, { ...b, ...after });
    }
  }

  /**
   * Cancelamento da compra: tira do estoque o que ela pôs. Se parte já saiu, recusa; a clínica
   * acerta pela contagem antes. O que a entrada quitou de pendência volta a ser pendência.
   */
  async unreceive(
    tx: Executor,
    auth: AuthContext,
    purchase: { id: string; organizationId: string; unitId: string; code: number },
  ): Promise<void> {
    const moves = await tx
      .select({
        id: stockMovements.id,
        productId: stockMovements.productId,
        quantity: stockMovements.quantity,
      })
      .from(stockMovements)
      .where(and(eq(stockMovements.purchaseId, purchase.id), eq(stockMovements.kind, 'purchase')))
      .orderBy(asc(stockMovements.id));
    if (moves.length === 0) return;
    const locked = await this.lock(
      tx,
      purchase.organizationId,
      purchase.unitId,
      moves.map((m) => m.productId),
    );
    const lotRows = await tx
      .select({
        movementId: stockMovementLots.movementId,
        lotId: stockMovementLots.lotId,
        quantity: stockMovementLots.quantity,
        code: stockLots.code,
        onHand: stockLots.onHand,
      })
      .from(stockMovementLots)
      .innerJoin(stockLots, eq(stockLots.id, stockMovementLots.lotId))
      .where(
        inArray(
          stockMovementLots.movementId,
          moves.map((m) => m.id),
        ),
      )
      .for('update');
    const lotLeft = new Map(lotRows.map((l) => [l.lotId, toMilli(l.onHand)]));
    for (const move of moves) {
      const b = locked.get(move.productId);
      if (!b) continue;
      const received = toMilli(move.quantity);
      const lots = lotRows.filter((l) => l.movementId === move.id);
      // Produto com lote: sai exatamente o que entrou em cada lote; sem lote, a quantidade toda.
      const removed = b.tracksLots
        ? lots.reduce((total, l) => total + toMilli(l.quantity), 0)
        : received;
      for (const l of lots) {
        const left = lotLeft.get(l.lotId) ?? 0;
        if (left < toMilli(l.quantity)) {
          throw conflict(
            `O lote ${l.code} de ${b.name} já teve saída depois desta compra. Acerte o estoque pela contagem antes de cancelar.`,
          );
        }
        lotLeft.set(l.lotId, left - toMilli(l.quantity));
      }
      if (b.onHand < removed) {
        throw conflict(
          `Só há ${qty(b.onHand)} ${b.unit} de ${b.name} em estoque, menos do que esta compra trouxe. Acerte o estoque pela contagem antes de cancelar.`,
        );
      }
      const after = { onHand: b.onHand - removed, shortfall: b.shortfall + received - removed };
      await this.write(
        tx,
        auth,
        purchase,
        move.productId,
        after,
        {
          kind: 'purchase_cancel',
          quantity: -received,
          shortfall: 0,
          notes: `Compra ${String(purchase.code)} cancelada`,
        },
        lots.map((l) => ({ lotId: l.lotId, milli: -toMilli(l.quantity) })),
      );
      locked.set(move.productId, { ...b, ...after });
    }
  }

  /** Lotes não vencidos com saldo, na ordem de saída. */
  private async validLots(tx: Executor, unitId: string, productId: string) {
    const today = await this.today(tx, unitId);
    const rows = await tx
      .select({ lotId: stockLots.id, onHand: stockLots.onHand })
      .from(stockLots)
      .where(
        and(
          eq(stockLots.unitId, unitId),
          eq(stockLots.productId, productId),
          gt(stockLots.onHand, 0),
          sql`(${stockLots.expiresOn} is null or ${stockLots.expiresOn} >= ${today})`,
        ),
      )
      .orderBy(...fefo);
    return rows.map((r) => ({ lotId: r.lotId, milli: toMilli(r.onHand) }));
  }

  /**
   * No estorno, cada unidade volta ao lote de onde saiu. Se parte do que volta quita pendência,
   * sai primeiro do lote que vence antes; se volta mais do que saiu de lote (a venda baixou
   * antes do controle de lote), o excedente vai para o "SEM LOTE".
   */
  private async returnedLots(
    tx: Executor,
    sale: { id: string; organizationId: string; unitId: string },
    productId: string,
    increase: number,
  ): Promise<LotChange[]> {
    const rows = await tx
      .select({ lotId: stockMovementLots.lotId, total: sum(stockMovementLots.quantity) })
      .from(stockMovementLots)
      .innerJoin(stockMovements, eq(stockMovements.id, stockMovementLots.movementId))
      .innerJoin(stockLots, eq(stockLots.id, stockMovementLots.lotId))
      .where(
        and(
          eq(stockMovements.saleId, sale.id),
          eq(stockMovements.kind, 'sale'),
          eq(stockMovements.productId, productId),
        ),
      )
      .groupBy(stockMovementLots.lotId, stockLots.expiresOn, stockLots.createdAt)
      .orderBy(sql`${stockLots.expiresOn} desc nulls first`, desc(stockLots.createdAt));
    // Ordem inversa: o que quita pendência sai do lote que vence antes, então ele volta por último.
    const out = rows.map((r) => ({ lotId: r.lotId, milli: -toMilli(Number(r.total ?? 0)) }));
    const back = takeInOrder(out, increase).filter((l) => l.milli > 0);
    const extra = increase - back.reduce((total, l) => total + l.milli, 0);
    if (extra > 0) back.push({ lotId: await legacyLot(tx, sale, productId), milli: extra });
    return back;
  }

  private async write(
    tx: Executor,
    auth: AuthContext,
    scope: { organizationId: string; unitId: string; id?: string },
    productId: string,
    after: { onHand: number; shortfall: number },
    movement: {
      kind: StockMovementKind;
      quantity: number;
      shortfall: number;
      notes: string;
    },
    lots: LotChange[] = [],
  ) {
    await tx
      .update(stockBalances)
      .set({
        onHand: fromMilli(after.onHand),
        shortfall: fromMilli(after.shortfall),
        updatedAt: new Date(),
      })
      .where(and(eq(stockBalances.unitId, scope.unitId), eq(stockBalances.productId, productId)));
    const id = newId();
    await tx.insert(stockMovements).values({
      id,
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
      purchaseId:
        movement.kind === 'purchase' || movement.kind === 'purchase_cancel'
          ? (scope.id ?? null)
          : null,
      createdBy: auth.userId,
    });
    for (const lot of lots) {
      if (lot.milli === 0) continue;
      await tx
        .update(stockLots)
        .set({ onHand: sql`${stockLots.onHand} + ${fromMilli(lot.milli)}` })
        .where(eq(stockLots.id, lot.lotId));
      await tx
        .insert(stockMovementLots)
        .values({ movementId: id, lotId: lot.lotId, quantity: fromMilli(lot.milli) });
    }
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
  ): Promise<Map<string, StockSummary & { onHand: number; expired: number }>> {
    if (productIds.length === 0) return new Map();
    const rows = await executor
      .select({
        id: products.id,
        blocks: sql<boolean>`coalesce(${productGroups.blocksSaleWithoutStock}, true)`,
        tracksLots: products.tracksLots,
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
    const withLots = rows.filter((r) => r.tracksLots).map((r) => r.id);
    const expiry =
      withLots.length > 0
        ? await lotExpiry(executor, unitId, withLots, await this.today(executor, unitId))
        : new Map<string, { expired: number }>();
    return new Map(
      rows.map((r) => {
        const onHand = toMilli(r.onHand ?? 0);
        const expired = r.tracksLots ? toMilli(expiry.get(r.id)?.expired ?? 0) : 0;
        return [
          r.id,
          {
            onHand: fromMilli(onHand),
            expired: fromMilli(expired),
            available: fromMilli(Math.max(0, onHand - expired - (reserved.get(r.id) ?? 0))),
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
        tracksLots: products.tracksLots,
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
        purchaseId: stockMovements.purchaseId,
        purchaseCode: purchases.code,
        by: users.name,
      })
      .from(stockMovements)
      .innerJoin(users, eq(users.id, stockMovements.createdBy))
      .leftJoin(sales, eq(sales.id, stockMovements.saleId))
      .leftJoin(purchases, eq(purchases.id, stockMovements.purchaseId))
      .where(
        and(
          eq(stockMovements.unitId, auth.unitId),
          eq(stockMovements.productId, productId),
          gte(stockMovements.createdAt, since),
        ),
      )
      .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
      .limit(200);
    const today = await this.today(executor, auth.unitId);
    const lots = product.tracksLots
      ? await executor
          .select({
            id: stockLots.id,
            code: stockLots.code,
            expiresOn: stockLots.expiresOn,
            onHand: stockLots.onHand,
          })
          .from(stockLots)
          .where(
            and(
              eq(stockLots.unitId, auth.unitId),
              eq(stockLots.productId, productId),
              gt(stockLots.onHand, 0),
            ),
          )
          .orderBy(...fefo)
      : [];
    const movementLots =
      movements.length > 0
        ? await executor
            .select({
              movementId: stockMovementLots.movementId,
              code: stockLots.code,
              quantity: stockMovementLots.quantity,
            })
            .from(stockMovementLots)
            .innerJoin(stockLots, eq(stockLots.id, stockMovementLots.lotId))
            .where(
              inArray(
                stockMovementLots.movementId,
                movements.map((m) => m.id),
              ),
            )
            .orderBy(...fefo)
        : [];
    const result: ProductStock = {
      unitName: unit?.name ?? '',
      onHand,
      reserved: fromMilli(
        (await this.reserved(executor, auth.unitId, [productId], null)).get(productId) ?? 0,
      ),
      available: summary?.available ?? 0,
      shortfall: summary?.shortfall ?? 0,
      minStock: product.minStock,
      idealStock: product.idealStock,
      blocksSaleWithoutStock: product.blocks,
      tracksLots: product.tracksLots,
      expired: summary?.expired ?? 0,
      lots: lots.map((l) => ({ ...l, expiry: expiryState(l.expiresOn, today) })),
      movements: movements.map((m) => ({
        id: m.id,
        kind: m.kind,
        at: m.at.toISOString(),
        quantity: m.quantity,
        shortfall: m.shortfall,
        onHandAfter: m.onHandAfter,
        notes: m.notes,
        sale: m.saleId && m.saleCode !== null ? { id: m.saleId, code: m.saleCode } : null,
        purchase:
          m.purchaseId && m.purchaseCode !== null && auth.permissions.has('purchases.view')
            ? { id: m.purchaseId, code: m.purchaseCode }
            : null,
        lots: movementLots
          .filter((l) => l.movementId === m.id)
          .map((l) => ({ code: l.code, quantity: l.quantity })),
        by: m.by,
      })),
      canAdjust: auth.permissions.has('inventory.adjust'),
    };
    return result;
  }

  /**
   * Entrada avulsa (sem nota, como doação ou bonificação) ou contagem: a contagem vira o saldo e zera a pendência.
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
      let lot: { id: string; code: string; onHand: number } | null = null;
      if (input.kind === 'entry') {
        const milli = toMilli(input.quantity);
        after = applyEntry(b, milli);
        if (b.tracksLots) lot = await this.entryLot(tx, auth, productId, input.lot);
        await this.write(
          tx,
          auth,
          scope,
          productId,
          after,
          { kind: 'entry', quantity: milli, shortfall: 0, notes: input.notes },
          // O que quita pendência já saiu da prateleira; só o restante entra no lote.
          lot ? [{ lotId: lot.id, milli: after.onHand - b.onHand }] : [],
        );
      } else {
        let counted = toMilli(input.countedQuantity);
        if (b.tracksLots) {
          lot = await this.countedLot(tx, auth, productId, input.lotId);
          counted = b.onHand - lot.onHand + counted;
        }
        after = { onHand: counted, shortfall: 0 };
        await this.write(
          tx,
          auth,
          scope,
          productId,
          after,
          {
            kind: 'count',
            // Diferença entre o contado e o saldo líquido (saldo − pendência).
            quantity: after.onHand - (b.onHand - b.shortfall),
            shortfall: 0,
            notes: input.notes,
          },
          lot ? [{ lotId: lot.id, milli: toMilli(input.countedQuantity) - lot.onHand }] : [],
        );
      }
      await recordAudit(tx, actorOf(auth), {
        entity: 'product',
        entityId: productId,
        action: input.kind === 'entry' ? 'stock_entry' : 'stock_count',
        before: { onHand: fromMilli(b.onHand), shortfall: fromMilli(b.shortfall) },
        after: {
          onHand: fromMilli(after.onHand),
          shortfall: fromMilli(after.shortfall),
          ...(lot ? { lot: lot.code } : {}),
          notes: input.notes,
        },
      });
      const stock = await this.stock(auth, productId, tx);
      if (!stock) throw notFound('Produto');
      return stock;
    });
  }

  /**
   * Lote da entrada [RN-32]: obrigatório no produto que controla lote; o mesmo número volta a
   * receber entrada só com a mesma validade, e lote vencido não entra.
   */
  private async entryLot(
    tx: Executor,
    auth: AuthContext,
    productId: string,
    input: { code: string; expiresOn: string } | null | undefined,
    path = 'lot',
  ) {
    if (!input) throw invalid(`${path}.code`, 'Informe o lote e a validade da embalagem');
    if (input.expiresOn < (await this.today(tx, auth.unitId))) {
      throw invalid(`${path}.expiresOn`, 'Lote vencido não entra no estoque');
    }
    const [found] = await tx
      .select({ id: stockLots.id, expiresOn: stockLots.expiresOn, onHand: stockLots.onHand })
      .from(stockLots)
      .where(
        and(
          eq(stockLots.unitId, auth.unitId),
          eq(stockLots.productId, productId),
          eq(stockLots.code, input.code),
        ),
      );
    if (found) {
      if (found.expiresOn !== input.expiresOn) {
        throw invalid(
          `${path}.expiresOn`,
          `O lote ${input.code} já está cadastrado com validade ${brDate(found.expiresOn ?? '')}`,
        );
      }
      return { id: found.id, code: input.code, onHand: toMilli(found.onHand) };
    }
    const id = newId();
    await tx.insert(stockLots).values({
      id,
      organizationId: auth.organizationId,
      unitId: auth.unitId,
      productId,
      code: input.code,
      expiresOn: input.expiresOn,
    });
    return { id, code: input.code, onHand: 0 };
  }

  /** Lote contado: produto com lote conta lote a lote. */
  private async countedLot(
    tx: Executor,
    auth: AuthContext,
    productId: string,
    lotId: string | undefined,
  ) {
    if (!lotId) throw invalid('lotId', 'Escolha o lote contado');
    const [found] = await tx
      .select({ id: stockLots.id, code: stockLots.code, onHand: stockLots.onHand })
      .from(stockLots)
      .where(
        and(
          eq(stockLots.id, lotId),
          eq(stockLots.unitId, auth.unitId),
          eq(stockLots.productId, productId),
        ),
      );
    if (!found) throw invalid('lotId', 'Lote inválido');
    return { id: found.id, code: found.code, onHand: toMilli(found.onHand) };
  }

  /**
   * Rastreio do lote até o paciente [RN-32]: entradas, contagens e cada venda que levou dele,
   * com o animal e o tutor da venda para quem tem acesso a eles.
   */
  async trace(auth: AuthContext, productId: string, lotId: string): Promise<LotTrace> {
    const [lot] = await this.db
      .select({
        id: stockLots.id,
        code: stockLots.code,
        expiresOn: stockLots.expiresOn,
        onHand: stockLots.onHand,
      })
      .from(stockLots)
      .where(
        and(
          eq(stockLots.id, lotId),
          eq(stockLots.productId, productId),
          eq(stockLots.organizationId, auth.organizationId),
          eq(stockLots.unitId, auth.unitId),
        ),
      );
    if (!lot) throw notFound('Lote');
    const rows = await this.db
      .select({
        id: stockMovements.id,
        kind: stockMovements.kind,
        at: stockMovements.createdAt,
        quantity: stockMovementLots.quantity,
        notes: stockMovements.notes,
        saleId: sales.id,
        saleCode: sales.code,
        purchaseId: purchases.id,
        purchaseCode: purchases.code,
        patientId: patients.id,
        patientName: patients.name,
        clientId: clients.id,
        clientName: clients.name,
        by: users.name,
      })
      .from(stockMovementLots)
      .innerJoin(stockMovements, eq(stockMovements.id, stockMovementLots.movementId))
      .innerJoin(users, eq(users.id, stockMovements.createdBy))
      .leftJoin(sales, eq(sales.id, stockMovements.saleId))
      .leftJoin(purchases, eq(purchases.id, stockMovements.purchaseId))
      .leftJoin(patients, eq(patients.id, sales.patientId))
      .leftJoin(clients, eq(clients.id, sales.clientId))
      .where(eq(stockMovementLots.lotId, lotId))
      .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
      .limit(500);
    const can = (key: 'sales.view' | 'purchases.view' | 'patients.view' | 'clients.view') =>
      auth.permissions.has(key);
    const today = await this.today(this.db, auth.unitId);
    return {
      lot: { ...lot, expiry: expiryState(lot.expiresOn, today) },
      movements: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        at: r.at.toISOString(),
        quantity: r.quantity,
        notes: r.notes,
        sale:
          r.saleId && r.saleCode !== null && can('sales.view')
            ? { id: r.saleId, code: r.saleCode }
            : null,
        purchase:
          r.purchaseId && r.purchaseCode !== null && can('purchases.view')
            ? { id: r.purchaseId, code: r.purchaseCode }
            : null,
        patient:
          r.patientId && r.patientName !== null && can('patients.view')
            ? { id: r.patientId, name: r.patientName }
            : null,
        client:
          r.clientId && r.clientName !== null && can('clients.view')
            ? { id: r.clientId, name: r.clientName }
            : null,
        by: r.by,
      })),
    };
  }
}
