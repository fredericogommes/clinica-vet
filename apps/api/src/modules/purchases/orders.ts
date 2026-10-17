import {
  fromCents,
  toCents,
  type PurchaseOrder,
  type PurchaseOrderCancelInput,
  type PurchaseOrderInput,
  type PurchaseOrderList,
  type PurchaseOrderOptions,
  type PurchaseOrderQuery,
  type PurchaseSuggestion,
} from '@clinica/contracts';
import { and, asc, count, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { actorOf } from '../../core/actor.js';
import { recordAudit } from '../../core/audit.js';
import { nextCounter } from '../../core/counters.js';
import { AppError, conflict, notFound } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import type { Database, Executor } from '../../db/client.js';
import {
  organizations,
  products,
  purchaseOrderItems,
  purchaseOrders,
  purchases,
  supplierProducts,
  suppliers,
  users,
} from '../../db/schema.js';
import type { AuthContext } from '../auth/sessions.js';
import { analysisRows, indicatorsOf } from '../inventory/analysis.js';
import { unitToday } from '../inventory/lots.js';
import type { PurchasesService } from './service.js';

const invalid = (path: string, message: string) =>
  new AppError('validation_failed', `${message}.`, [{ path, message }]);

const qty = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const date = (iso: string) => iso.split('-').reverse().join('/');

/** Sem ideal cadastrado, o pedido sugerido cobre dois meses de consumo. */
const SUGGESTED_MONTHS = 2;

type OrderRow = typeof purchaseOrders.$inferSelect;

/**
 * Pedido de compra [p.17]: rascunho editável, enviado ao fornecedor por WhatsApp ou e-mail (o
 * texto vem pronto) e, quando a mercadoria chega, transformado numa compra em rascunho.
 */
export class PurchaseOrdersService {
  constructor(
    private readonly db: Database,
    private readonly purchases: PurchasesService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async options(auth: AuthContext): Promise<PurchaseOrderOptions> {
    const org = auth.organizationId;
    const [supplierRows, productRows] = await Promise.all([
      this.db
        .select({ id: suppliers.id, name: suppliers.name })
        .from(suppliers)
        .where(and(eq(suppliers.organizationId, org), isNull(suppliers.archivedAt)))
        .orderBy(asc(suppliers.name)),
      this.db
        .select({ id: products.id, name: products.name, unit: products.unit, cost: products.cost })
        .from(products)
        .where(
          and(
            eq(products.organizationId, org),
            eq(products.kind, 'product'),
            eq(products.tracksStock, true),
            isNull(products.archivedAt),
          ),
        )
        .orderBy(asc(products.name)),
    ]);
    return { suppliers: supplierRows, products: productRows };
  }

  /**
   * Produtos em Repor, com a quantidade que leva o saldo ao ideal (ou a dois meses de consumo, ou
   * ao dobro do mínimo), descontado o que já foi pedido e não chegou.
   */
  async suggestion(auth: AuthContext, supplierId: string | undefined): Promise<PurchaseSuggestion> {
    const now = this.now();
    const rows = await analysisRows(this.db, auth.organizationId, auth.unitId, now);
    const pending = await this.db
      .select({
        productId: purchaseOrderItems.productId,
        quantity: sql<string>`sum(${purchaseOrderItems.quantity})`,
      })
      .from(purchaseOrderItems)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderItems.orderId))
      .where(
        and(
          eq(purchaseOrders.organizationId, auth.organizationId),
          eq(purchaseOrders.unitId, auth.unitId),
          eq(purchaseOrders.status, 'sent'),
        ),
      )
      .groupBy(purchaseOrderItems.productId);
    const onOrder = new Map(pending.map((p) => [p.productId, Number(p.quantity)]));
    const bought = supplierId
      ? new Set(
          (
            await this.db
              .selectDistinct({ productId: supplierProducts.productId })
              .from(supplierProducts)
              .where(eq(supplierProducts.supplierId, supplierId))
          ).map((r) => r.productId),
        )
      : new Set<string>();
    const items = rows.flatMap((row) => {
      const ind = indicatorsOf(row, now, true);
      if (ind.situation !== 'repor') return [];
      const target =
        row.idealStock ??
        Math.max((row.minStock ?? 0) * 2, ind.monthlyConsumption * SUGGESTED_MONTHS);
      const ordered = onOrder.get(row.id) ?? 0;
      const suggested = Math.ceil(target - row.net - ordered);
      if (suggested <= 0) return [];
      return [
        {
          productId: row.id,
          name: row.name,
          unit: row.unit,
          onHand: row.net,
          minStock: row.minStock,
          idealStock: row.idealStock,
          monthlyConsumption: ind.monthlyConsumption,
          onOrder: ordered,
          suggested,
          unitCost: row.cost,
          fromSupplier: bought.has(row.id),
        },
      ];
    });
    // Primeiro o que já se compra deste fornecedor.
    items.sort((a, b) => Number(b.fromSupplier) - Number(a.fromSupplier));
    return { items };
  }

  async list(auth: AuthContext, query: PurchaseOrderQuery): Promise<PurchaseOrderList> {
    const filters: SQL[] = [eq(purchaseOrders.organizationId, auth.organizationId)];
    if (query.situacao === 'abertos') {
      filters.push(inArray(purchaseOrders.status, ['draft', 'sent']));
    } else if (query.situacao === 'recebidos') {
      filters.push(eq(purchaseOrders.status, 'received'));
    } else if (query.situacao === 'cancelados') {
      filters.push(eq(purchaseOrders.status, 'cancelled'));
    }
    const where = and(...filters);
    const counts = this.db
      .select({ orderId: purchaseOrderItems.orderId, n: count().as('n') })
      .from(purchaseOrderItems)
      .groupBy(purchaseOrderItems.orderId)
      .as('counts');
    const [rows, [totals]] = await Promise.all([
      this.db
        .select({
          id: purchaseOrders.id,
          code: purchaseOrders.code,
          status: purchaseOrders.status,
          supplier: suppliers.name,
          createdAt: purchaseOrders.createdAt,
          expectedOn: purchaseOrders.expectedOn,
          itemCount: sql<number>`coalesce(${counts.n}, 0)::int`,
          total: purchaseOrders.total,
        })
        .from(purchaseOrders)
        .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
        .leftJoin(counts, eq(counts.orderId, purchaseOrders.id))
        .where(where)
        .orderBy(desc(purchaseOrders.code))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ n: count() }).from(purchaseOrders).where(where),
    ]);
    return {
      items: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      total: totals?.n ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(auth: AuthContext, id: string, db: Executor = this.db): Promise<PurchaseOrder> {
    const creator = alias(users, 'creator');
    const sender = alias(users, 'sender');
    const canceller = alias(users, 'canceller');
    const [row] = await db
      .select({
        order: purchaseOrders,
        supplier: {
          id: suppliers.id,
          name: suppliers.name,
          phone: suppliers.phone,
          email: suppliers.email,
        },
        clinic: organizations.name,
        purchaseCode: purchases.code,
        createdBy: creator.name,
        sentBy: sender.name,
        cancelledBy: canceller.name,
      })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .innerJoin(organizations, eq(organizations.id, purchaseOrders.organizationId))
      .innerJoin(creator, eq(creator.id, purchaseOrders.createdBy))
      .leftJoin(sender, eq(sender.id, purchaseOrders.sentBy))
      .leftJoin(canceller, eq(canceller.id, purchaseOrders.cancelledBy))
      .leftJoin(purchases, eq(purchases.id, purchaseOrders.purchaseId))
      .where(
        and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, auth.organizationId)),
      );
    if (!row) throw notFound('Pedido de compra');
    const o = row.order;
    const items = await db
      .select({
        id: purchaseOrderItems.id,
        product: { id: products.id, name: products.name, unit: products.unit },
        supplierCode: sql<
          string | null
        >`(select min(${supplierProducts.supplierCode}) from ${supplierProducts} where ${supplierProducts.supplierId} = ${o.supplierId} and ${supplierProducts.productId} = ${purchaseOrderItems.productId})`,
        quantity: purchaseOrderItems.quantity,
        unitCost: purchaseOrderItems.unitCost,
      })
      .from(purchaseOrderItems)
      .innerJoin(products, eq(products.id, purchaseOrderItems.productId))
      .where(eq(purchaseOrderItems.orderId, id))
      .orderBy(asc(purchaseOrderItems.position));
    const lines = items.map((i) => ({
      ...i,
      total: i.unitCost === null ? 0 : fromCents(toCents(i.unitCost * i.quantity)),
    }));
    const message = [
      `Pedido de compra ${String(o.code)} · ${row.clinic}`,
      '',
      ...lines.map(
        (l) =>
          `- ${qty(l.quantity)} ${l.product.unit} de ${l.product.name}${
            l.supplierCode ? ` (cód. ${l.supplierCode})` : ''
          }`,
      ),
      ...(o.expectedOn ? ['', `Entrega desejada: ${date(o.expectedOn)}`] : []),
      ...(o.notes ? ['', o.notes] : []),
      '',
      'Por favor, confirme a disponibilidade e o prazo. Obrigado!',
    ].join('\n');
    return {
      id: o.id,
      code: o.code,
      status: o.status,
      supplier: row.supplier,
      expectedOn: o.expectedOn,
      notes: o.notes,
      total: o.total,
      items: lines,
      message,
      purchase:
        o.purchaseId && row.purchaseCode !== null
          ? { id: o.purchaseId, code: row.purchaseCode }
          : null,
      createdBy: row.createdBy,
      createdAt: o.createdAt.toISOString(),
      sentBy: row.sentBy,
      sentAt: o.sentAt?.toISOString() ?? null,
      receivedAt: o.receivedAt?.toISOString() ?? null,
      cancelledBy: row.cancelledBy,
      cancelledAt: o.cancelledAt?.toISOString() ?? null,
      cancelReason: o.cancelReason,
    };
  }

  async create(auth: AuthContext, input: PurchaseOrderInput): Promise<PurchaseOrder> {
    return this.db.transaction(async (tx) => {
      const total = await this.validate(tx, auth, input);
      const id = newId();
      await tx.insert(purchaseOrders).values({
        id,
        organizationId: auth.organizationId,
        unitId: auth.unitId,
        code: await nextCounter(tx, auth.organizationId, 'purchase_order'),
        status: 'draft',
        supplierId: input.supplierId,
        expectedOn: input.expectedOn,
        notes: input.notes,
        total,
        createdBy: auth.userId,
      });
      await this.insertItems(tx, id, input);
      const created = await this.get(auth, id, tx);
      await recordAudit(tx, actorOf(auth), {
        entity: 'purchase_order',
        entityId: id,
        action: 'create',
        after: this.snapshot(created),
      });
      return created;
    });
  }

  async update(auth: AuthContext, id: string, input: PurchaseOrderInput): Promise<PurchaseOrder> {
    return this.db.transaction(async (tx) => {
      const current = await this.lock(tx, auth, id);
      if (current.status !== 'draft') throw conflict('Só o pedido em rascunho pode ser alterado.');
      const before = this.snapshot(await this.get(auth, id, tx));
      const total = await this.validate(tx, auth, input);
      await tx
        .update(purchaseOrders)
        .set({
          supplierId: input.supplierId,
          expectedOn: input.expectedOn,
          notes: input.notes,
          total,
          updatedAt: this.now(),
        })
        .where(eq(purchaseOrders.id, id));
      await tx.delete(purchaseOrderItems).where(eq(purchaseOrderItems.orderId, id));
      await this.insertItems(tx, id, input);
      const updated = await this.get(auth, id, tx);
      await recordAudit(tx, actorOf(auth), {
        entity: 'purchase_order',
        entityId: id,
        action: 'update',
        before,
        after: this.snapshot(updated),
      });
      return updated;
    });
  }

  /** Marca como enviado; o envio em si é pelo texto pronto, no WhatsApp ou e-mail da clínica. */
  async send(auth: AuthContext, id: string): Promise<PurchaseOrder> {
    return this.transition(auth, id, ['draft'], 'send', {
      status: 'sent',
      sentBy: auth.userId,
      sentAt: this.now(),
    });
  }

  /** A mercadoria chegou: lança a compra em rascunho com os itens do pedido. */
  async receive(auth: AuthContext, id: string): Promise<PurchaseOrder> {
    return this.db.transaction(async (tx) => {
      const current = await this.lock(tx, auth, id);
      if (current.status !== 'draft' && current.status !== 'sent') {
        throw conflict('Este pedido já foi recebido ou cancelado.');
      }
      const order = await this.get(auth, id, tx);
      const purchaseId = await this.purchases.draftFrom(tx, auth, {
        supplierId: order.supplier.id,
        notes: `Pedido de compra ${String(order.code)}`,
        items: order.items.map((i) => ({
          productId: i.product.id,
          description: i.product.name,
          supplierCode: i.supplierCode ?? '',
          quantity: i.quantity,
          factor: 1,
          total: i.total,
        })),
      });
      const now = this.now();
      await tx
        .update(purchaseOrders)
        .set({
          status: 'received',
          sentBy: current.sentBy ?? auth.userId,
          sentAt: current.sentAt ?? now,
          purchaseId,
          receivedBy: auth.userId,
          receivedAt: now,
          updatedAt: now,
        })
        .where(eq(purchaseOrders.id, id));
      await recordAudit(tx, actorOf(auth), {
        entity: 'purchase_order',
        entityId: id,
        action: 'receive',
        before: { status: current.status },
        after: { status: 'received', purchaseId },
      });
      return this.get(auth, id, tx);
    });
  }

  async cancel(
    auth: AuthContext,
    id: string,
    input: PurchaseOrderCancelInput,
  ): Promise<PurchaseOrder> {
    return this.transition(auth, id, ['draft', 'sent'], 'cancel', {
      status: 'cancelled',
      cancelledBy: auth.userId,
      cancelledAt: this.now(),
      cancelReason: input.reason,
    });
  }

  private async transition(
    auth: AuthContext,
    id: string,
    from: OrderRow['status'][],
    action: string,
    values: Partial<OrderRow>,
  ): Promise<PurchaseOrder> {
    return this.db.transaction(async (tx) => {
      const current = await this.lock(tx, auth, id);
      if (!from.includes(current.status)) {
        throw conflict(
          current.status === 'sent'
            ? 'Este pedido já foi enviado.'
            : 'Este pedido já foi recebido ou cancelado.',
        );
      }
      await tx
        .update(purchaseOrders)
        .set({ ...values, updatedAt: this.now() })
        .where(eq(purchaseOrders.id, id));
      await recordAudit(tx, actorOf(auth), {
        entity: 'purchase_order',
        entityId: id,
        action,
        before: { status: current.status },
        after: { status: values.status, reason: values.cancelReason ?? undefined },
      });
      return this.get(auth, id, tx);
    });
  }

  private async lock(tx: Executor, auth: AuthContext, id: string): Promise<OrderRow> {
    const [row] = await tx
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, auth.organizationId)))
      .for('update');
    if (!row) throw notFound('Pedido de compra');
    return row;
  }

  /** Confere fornecedor, produtos e data; devolve o total estimado. */
  private async validate(tx: Executor, auth: AuthContext, input: PurchaseOrderInput) {
    const org = auth.organizationId;
    const [supplier] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(
        and(
          eq(suppliers.id, input.supplierId),
          eq(suppliers.organizationId, org),
          isNull(suppliers.archivedAt),
        ),
      );
    if (!supplier) throw invalid('supplierId', 'Fornecedor indisponível');
    if (input.expectedOn && input.expectedOn < (await unitToday(tx, auth.unitId, this.now()))) {
      throw invalid('expectedOn', 'A entrega desejada não pode estar no passado');
    }
    const ids = input.items.map((i) => i.productId);
    const found = await tx
      .select({ id: products.id })
      .from(products)
      .where(
        and(
          inArray(products.id, ids),
          eq(products.organizationId, org),
          eq(products.kind, 'product'),
          eq(products.tracksStock, true),
          isNull(products.archivedAt),
        ),
      );
    const valid = new Set(found.map((p) => p.id));
    const seen = new Set<string>();
    input.items.forEach((item, index) => {
      if (!valid.has(item.productId)) {
        throw invalid(`items.${String(index)}.productId`, 'Produto indisponível');
      }
      if (seen.has(item.productId)) {
        throw invalid(`items.${String(index)}.productId`, 'Produto repetido no pedido');
      }
      seen.add(item.productId);
    });
    return fromCents(input.items.reduce((t, i) => t + toCents((i.unitCost ?? 0) * i.quantity), 0));
  }

  private async insertItems(tx: Executor, orderId: string, input: PurchaseOrderInput) {
    await tx.insert(purchaseOrderItems).values(
      input.items.map((item, position) => ({
        id: newId(),
        orderId,
        position,
        productId: item.productId,
        quantity: item.quantity,
        unitCost: item.unitCost,
      })),
    );
  }

  private snapshot(o: PurchaseOrder) {
    return {
      code: o.code,
      supplier: o.supplier.name,
      total: o.total,
      items: o.items.map((i) => `${String(i.quantity)} ${i.product.name}`),
    };
  }
}
