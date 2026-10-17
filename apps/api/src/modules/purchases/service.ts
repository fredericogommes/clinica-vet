import {
  fromCents,
  fromMilli,
  purchaseInputSchema,
  toCents,
  toMilli,
  type Purchase,
  type PurchaseCancelInput,
  type PurchaseInput,
  type PurchaseList,
  type PurchaseOptions,
  type PurchaseQuery,
} from '@clinica/contracts';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { actorOf } from '../../core/actor.js';
import { recordAudit } from '../../core/audit.js';
import { nextCounter } from '../../core/counters.js';
import { AppError, conflict, notFound } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import { containsText } from '../../core/search.js';
import type { Database, Executor } from '../../db/client.js';
import { isUniqueViolation, violatedConstraint } from '../../db/errors.js';
import {
  financialAccounts,
  financialCategories,
  financialEntries,
  products,
  purchaseInstallments,
  purchaseItems,
  purchases,
  supplierProducts,
  suppliers,
  users,
} from '../../db/schema.js';
import type { AuthContext } from '../auth/sessions.js';
import type { FinanceService } from '../finance/service.js';
import type { InventoryService } from '../inventory/service.js';
import { unitToday } from '../inventory/lots.js';
import { parseNfe, type ParsedNfe } from './nfe.js';

type PurchaseRow = typeof purchases.$inferSelect;

const invalid = (path: string, message: string) =>
  new AppError('validation_failed', `${message}.`, [{ path, message }]);

const brl = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const duplicateKey = (code: number | null) =>
  conflict(
    code === null
      ? 'Esta nota já foi lançada em outra compra.'
      : `Esta nota já foi lançada na compra ${String(code)}.`,
  );

/** Totais da compra recalculados no servidor, em centavos. */
function totalsOf(input: {
  items: { total: number }[];
  freight: number;
  otherCosts: number;
  discount: number;
}) {
  const items = input.items.reduce((sum, i) => sum + toCents(i.total), 0);
  const total =
    items + toCents(input.freight) + toCents(input.otherCosts) - toCents(input.discount);
  return { items, total };
}

/**
 * Custo de cada unidade do produto: o valor do item mais a sua parte de frete, outras despesas e
 * desconto, rateados pelo valor dos itens, dividido pela quantidade já convertida.
 */
function unitCosts(purchase: {
  items: { total: number; quantity: number; factor: number }[];
  itemsTotal: number;
  total: number;
}): number[] {
  const extra = toCents(purchase.total) - toCents(purchase.itemsTotal);
  const base = toCents(purchase.itemsTotal);
  return purchase.items.map((i) => {
    const share = base > 0 ? (extra * toCents(i.total)) / base : 0;
    const units = fromMilli(toMilli(i.quantity * i.factor));
    return units > 0 ? (toCents(i.total) + share) / 100 / units : 0;
  });
}

/**
 * Compras por nota [p.17]. O rascunho guarda o que foi digitado ou importado do XML; confirmar dá
 * entrada no estoque com lote e validade, atualiza o custo dos produtos, aprende o código do
 * fornecedor e lança as parcelas a pagar, tudo numa transação.
 */
export class PurchasesService {
  constructor(
    private readonly db: Database,
    private readonly inventory: InventoryService,
    private readonly finance: FinanceService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private today(executor: Executor, unitId: string) {
    return unitToday(executor, unitId, this.now());
  }

  async options(auth: AuthContext): Promise<PurchaseOptions> {
    const today = await this.today(this.db, auth.unitId);
    await this.db.transaction((tx) => this.finance.ensure(tx, auth.organizationId, today));
    const org = auth.organizationId;
    const [supplierRows, accounts, categories, productRows] = await Promise.all([
      this.db
        .select({ id: suppliers.id, name: suppliers.name, document: suppliers.document })
        .from(suppliers)
        .where(and(eq(suppliers.organizationId, org), isNull(suppliers.archivedAt)))
        .orderBy(asc(suppliers.name)),
      this.db
        .select({
          id: financialAccounts.id,
          name: financialAccounts.name,
          kind: financialAccounts.kind,
        })
        .from(financialAccounts)
        .where(and(eq(financialAccounts.organizationId, org), isNull(financialAccounts.archivedAt)))
        .orderBy(asc(financialAccounts.createdAt), asc(financialAccounts.id)),
      this.db
        .select({ id: financialCategories.id, name: financialCategories.name })
        .from(financialCategories)
        .where(
          and(
            eq(financialCategories.organizationId, org),
            eq(financialCategories.kind, 'expense'),
            isNull(financialCategories.archivedAt),
          ),
        )
        .orderBy(asc(financialCategories.name)),
      this.db
        .select({
          id: products.id,
          name: products.name,
          unit: products.unit,
          barcode: products.barcode,
          tracksStock: products.tracksStock,
          tracksLots: products.tracksLots,
          cost: products.cost,
        })
        .from(products)
        .where(
          and(
            eq(products.organizationId, org),
            eq(products.kind, 'product'),
            isNull(products.archivedAt),
          ),
        )
        .orderBy(asc(products.name)),
    ]);
    const seeCost = auth.permissions.has('products.view_cost');
    return {
      suppliers: supplierRows,
      accounts: accounts.map(({ id, name }) => ({ id, name })),
      categories,
      defaults: {
        accountId: (accounts.find((a) => a.kind === 'bank') ?? accounts[0])?.id ?? null,
        categoryId: categories.find((c) => c.name === 'Compras de mercadorias')?.id ?? null,
      },
      products: productRows.map((p) => ({ ...p, cost: seeCost ? p.cost : null })),
      today,
    };
  }

  async list(auth: AuthContext, query: PurchaseQuery): Promise<PurchaseList> {
    const filters: SQL[] = [
      eq(purchases.organizationId, auth.organizationId),
      eq(purchases.unitId, auth.unitId),
    ];
    const status = {
      todas: null,
      rascunhos: 'draft',
      confirmadas: 'confirmed',
      canceladas: 'cancelled',
    } as const;
    const wanted = status[query.situacao];
    if (wanted) filters.push(eq(purchases.status, wanted));
    if (query.de) filters.push(gte(purchases.enteredOn, query.de));
    if (query.ate) filters.push(lte(purchases.enteredOn, query.ate));
    if (query.q) {
      const term = query.q;
      const digits = term.replace(/\D/g, '');
      const match = [
        containsText(suppliers.name, term),
        containsText(purchases.invoiceNumber, term),
      ];
      if (/^\d+$/.test(term)) match.push(eq(purchases.code, Number(term)));
      if (digits.length >= 8) match.push(sql`${purchases.invoiceKey} like ${`%${digits}%`}`);
      const any = or(...match);
      if (any) filters.push(any);
    }
    const where = and(...filters);
    const itemCount = this.db
      .select({ purchaseId: purchaseItems.purchaseId, n: count().as('n') })
      .from(purchaseItems)
      .groupBy(purchaseItems.purchaseId)
      .as('item_count');
    const [rows, [totalRow]] = await Promise.all([
      this.db
        .select({
          id: purchases.id,
          code: purchases.code,
          status: purchases.status,
          source: purchases.source,
          enteredOn: purchases.enteredOn,
          supplier: { id: suppliers.id, name: suppliers.name },
          invoiceNumber: purchases.invoiceNumber,
          itemCount: sql<number>`coalesce(${itemCount.n}, 0)::int`,
          total: purchases.total,
        })
        .from(purchases)
        .innerJoin(suppliers, eq(suppliers.id, purchases.supplierId))
        .leftJoin(itemCount, eq(itemCount.purchaseId, purchases.id))
        .where(where)
        .orderBy(desc(purchases.enteredOn), desc(purchases.code))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db
        .select({ n: count() })
        .from(purchases)
        .innerJoin(suppliers, eq(suppliers.id, purchases.supplierId))
        .where(where),
    ]);
    return { items: rows, total: totalRow?.n ?? 0, page: query.page, pageSize: query.pageSize };
  }

  async get(auth: AuthContext, id: string, db: Executor = this.db): Promise<Purchase> {
    const creator = alias(users, 'creator');
    const confirmer = alias(users, 'confirmer');
    const [row] = await db
      .select({
        purchase: purchases,
        supplier: { id: suppliers.id, name: suppliers.name, document: suppliers.document },
        account: { id: financialAccounts.id, name: financialAccounts.name },
        category: { id: financialCategories.id, name: financialCategories.name },
        createdBy: creator.name,
        confirmedBy: confirmer.name,
      })
      .from(purchases)
      .innerJoin(suppliers, eq(suppliers.id, purchases.supplierId))
      .innerJoin(financialAccounts, eq(financialAccounts.id, purchases.accountId))
      .innerJoin(financialCategories, eq(financialCategories.id, purchases.categoryId))
      .innerJoin(creator, eq(creator.id, purchases.createdBy))
      .leftJoin(confirmer, eq(confirmer.id, purchases.confirmedBy))
      .where(
        and(
          eq(purchases.id, id),
          eq(purchases.organizationId, auth.organizationId),
          eq(purchases.unitId, auth.unitId),
        ),
      );
    if (!row) throw notFound('Compra');
    const p = row.purchase;
    const [items, installments, entries] = await Promise.all([
      db
        .select({
          item: purchaseItems,
          product: {
            id: products.id,
            name: products.name,
            unit: products.unit,
            tracksStock: products.tracksStock,
            tracksLots: products.tracksLots,
          },
        })
        .from(purchaseItems)
        .leftJoin(products, eq(products.id, purchaseItems.productId))
        .where(eq(purchaseItems.purchaseId, id))
        .orderBy(asc(purchaseItems.position)),
      db
        .select()
        .from(purchaseInstallments)
        .where(eq(purchaseInstallments.purchaseId, id))
        .orderBy(asc(purchaseInstallments.number)),
      db
        .select({
          id: financialEntries.id,
          installment: financialEntries.installmentNumber,
          dueDate: financialEntries.dueDate,
          amount: financialEntries.amount,
          status: financialEntries.status,
        })
        .from(financialEntries)
        .where(eq(financialEntries.purchaseId, id))
        .orderBy(asc(financialEntries.dueDate), asc(financialEntries.installmentNumber)),
    ]);
    const costs = unitCosts({
      items: items.map((i) => i.item),
      itemsTotal: p.itemsTotal,
      total: p.total,
    });
    const seeCost = auth.permissions.has('products.view_cost');
    return {
      id: p.id,
      code: p.code,
      status: p.status,
      source: p.source,
      supplier: row.supplier,
      invoiceNumber: p.invoiceNumber,
      invoiceSeries: p.invoiceSeries,
      invoiceKey: p.invoiceKey,
      issuedOn: p.issuedOn,
      enteredOn: p.enteredOn,
      freight: p.freight,
      otherCosts: p.otherCosts,
      discount: p.discount,
      itemsTotal: p.itemsTotal,
      total: p.total,
      account: row.account,
      category: row.category,
      notes: p.notes,
      items: items.map(({ item, product }, index) => ({
        id: item.id,
        product: product?.id ? product : null,
        description: item.description,
        supplierCode: item.supplierCode,
        ean: item.ean,
        supplierUnit: item.supplierUnit,
        quantity: item.quantity,
        factor: item.factor,
        total: item.total,
        unitCost: seeCost && product?.id ? Math.round((costs[index] ?? 0) * 100) / 100 : null,
        lot:
          item.lotCode && item.expiresOn ? { code: item.lotCode, expiresOn: item.expiresOn } : null,
      })),
      installments: installments.map((i) => ({
        number: i.number,
        dueDate: i.dueDate,
        amount: i.amount,
      })),
      entries,
      createdBy: row.createdBy,
      createdAt: p.createdAt.toISOString(),
      confirmedBy: row.confirmedBy,
      confirmedAt: p.confirmedAt?.toISOString() ?? null,
      cancelReason: p.cancelReason,
      cancelledAt: p.cancelledAt?.toISOString() ?? null,
    };
  }

  async create(auth: AuthContext, input: PurchaseInput): Promise<Purchase> {
    return this.db.transaction(async (tx) => {
      const id = await this.insert(tx, auth, 'manual', input);
      await recordAudit(tx, actorOf(auth), {
        entity: 'purchase',
        entityId: id,
        action: 'create',
        after: await this.snapshot(tx, auth, id),
      });
      return this.get(auth, id, tx);
    });
  }

  async update(auth: AuthContext, id: string, input: PurchaseInput): Promise<Purchase> {
    return this.db.transaction(async (tx) => {
      const current = await this.lock(tx, auth, id);
      if (current.status !== 'draft') {
        throw conflict('Só a compra em rascunho pode ser alterada.');
      }
      const before = await this.snapshot(tx, auth, id);
      const values = await this.validate(tx, auth, input, current);
      try {
        await tx
          .update(purchases)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(purchases.id, id));
      } catch (error) {
        throw await this.translate(tx, auth, error, values.invoiceKey);
      }
      await tx.delete(purchaseItems).where(eq(purchaseItems.purchaseId, id));
      await tx.delete(purchaseInstallments).where(eq(purchaseInstallments.purchaseId, id));
      await this.insertLines(tx, id, input);
      await recordAudit(tx, actorOf(auth), {
        entity: 'purchase',
        entityId: id,
        action: 'update',
        before,
        after: await this.snapshot(tx, auth, id),
      });
      return this.get(auth, id, tx);
    });
  }

  /**
   * Importa o XML da NF-e como rascunho: o emitente vira (ou encontra) o fornecedor, os itens
   * vêm casados pelo código já aprendido daquele fornecedor ou pelo código de barras, e as
   * duplicatas viram parcelas.
   */
  async importXml(auth: AuthContext, xml: string): Promise<Purchase> {
    const nfe = parseNfe(xml);
    const today = await this.today(this.db, auth.unitId);
    return this.db.transaction(async (tx) => {
      await this.finance.ensure(tx, auth.organizationId, today);
      const [taken] = await tx
        .select({ code: purchases.code })
        .from(purchases)
        .where(
          and(
            eq(purchases.organizationId, auth.organizationId),
            eq(purchases.invoiceKey, nfe.key),
            sql`${purchases.status} <> 'cancelled'`,
          ),
        );
      if (taken) throw duplicateKey(taken.code);
      const supplierId = await this.supplierFor(tx, auth, nfe.supplier);
      const options = await this.defaults(tx, auth);
      const learned = await tx
        .select()
        .from(supplierProducts)
        .where(eq(supplierProducts.supplierId, supplierId));
      const eans = [...new Set(nfe.items.map((i) => i.ean).filter(Boolean))];
      const byBarcode =
        eans.length > 0
          ? await tx
              .select({ id: products.id, barcode: products.barcode })
              .from(products)
              .where(
                and(
                  eq(products.organizationId, auth.organizationId),
                  eq(products.kind, 'product'),
                  isNull(products.archivedAt),
                  inArray(products.barcode, eans),
                ),
              )
          : [];
      const items = nfe.items.map((item) => {
        const known = item.supplierCode
          ? learned.find((l) => l.supplierCode === item.supplierCode)
          : undefined;
        const barcode = item.ean ? byBarcode.find((p) => p.barcode === item.ean) : undefined;
        return {
          ...item,
          productId: known?.productId ?? barcode?.id ?? null,
          factor: known?.factor ?? 1,
        };
      });
      const parsed = purchaseInputSchema.safeParse({
        supplierId,
        invoiceNumber: nfe.number,
        invoiceSeries: nfe.series,
        invoiceKey: nfe.key,
        issuedOn: nfe.issuedOn,
        enteredOn: today,
        freight: nfe.freight,
        otherCosts: nfe.otherCosts,
        discount: nfe.discount,
        accountId: options.accountId,
        categoryId: options.categoryId,
        notes: '',
        items,
        installments: nfe.installments,
      });
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw invalid(
          'xml',
          `A nota tem um dado que não dá para aproveitar: ${issue?.message ?? 'inválido'}`,
        );
      }
      const id = await this.insert(tx, auth, 'xml', parsed.data);
      await recordAudit(tx, actorOf(auth), {
        entity: 'purchase',
        entityId: id,
        action: 'import_xml',
        after: await this.snapshot(tx, auth, id),
      });
      return this.get(auth, id, tx);
    });
  }

  /**
   * Confirma a compra: todos os itens casados com produtos, lote nos que controlam lote, parcelas
   * fechando com o total. Entra no estoque, atualiza o custo e lança as parcelas a pagar.
   */
  async confirm(auth: AuthContext, id: string): Promise<Purchase> {
    return this.db.transaction(async (tx) => {
      const current = await this.lock(tx, auth, id);
      if (current.status !== 'draft') throw conflict('Esta compra já foi confirmada ou cancelada.');
      const today = await this.today(tx, auth.unitId);
      if (current.enteredOn > today) {
        throw invalid('enteredOn', 'A entrada não pode ser no futuro');
      }
      const items = await tx
        .select({
          item: purchaseItems,
          product: {
            id: products.id,
            name: products.name,
            kind: products.kind,
            tracksStock: products.tracksStock,
            tracksLots: products.tracksLots,
            archivedAt: products.archivedAt,
          },
        })
        .from(purchaseItems)
        .leftJoin(products, eq(products.id, purchaseItems.productId))
        .where(eq(purchaseItems.purchaseId, id))
        .orderBy(asc(purchaseItems.position));
      items.forEach(({ item, product }, index) => {
        if (!product?.id) {
          throw invalid(
            `items.${String(index)}.productId`,
            `Escolha o produto de "${item.description}"`,
          );
        }
        if (product.tracksLots && !item.lotCode) {
          throw invalid(
            `items.${String(index)}.lot.code`,
            `Informe o lote e a validade de ${product.name}`,
          );
        }
      });
      let installments = await tx
        .select()
        .from(purchaseInstallments)
        .where(eq(purchaseInstallments.purchaseId, id))
        .orderBy(asc(purchaseInstallments.number));
      const total = toCents(current.total);
      if (installments.length === 0 && total > 0) {
        installments = [
          { purchaseId: id, number: 1, dueDate: current.enteredOn, amount: current.total },
        ];
      }
      const planned = installments.reduce((sum, i) => sum + toCents(i.amount), 0);
      if (planned !== total) {
        throw invalid(
          'installments',
          `As parcelas somam ${brl(fromCents(planned))}, mas a compra soma ${brl(current.total)}`,
        );
      }

      const scope = {
        id,
        organizationId: current.organizationId,
        unitId: current.unitId,
        code: current.code,
      };
      await this.inventory.receive(
        tx,
        auth,
        scope,
        items.flatMap(({ item, product }, index) =>
          product?.tracksStock
            ? [
                {
                  index,
                  productId: product.id,
                  quantity: fromMilli(toMilli(item.quantity * item.factor)),
                  lot:
                    product.tracksLots && item.lotCode && item.expiresOn
                      ? { code: item.lotCode, expiresOn: item.expiresOn }
                      : null,
                },
              ]
            : [],
        ),
      );

      // Custo: a média do que esta nota trouxe de cada produto, com frete e desconto rateados.
      const costs = unitCosts({
        items: items.map((i) => i.item),
        itemsTotal: current.itemsTotal,
        total: current.total,
      });
      const perProduct = new Map<string, { value: number; units: number }>();
      items.forEach(({ item }, index) => {
        if (!item.productId) return;
        const units = item.quantity * item.factor;
        const acc = perProduct.get(item.productId) ?? { value: 0, units: 0 };
        acc.value += (costs[index] ?? 0) * units;
        acc.units += units;
        perProduct.set(item.productId, acc);
      });
      const costChanges: Record<string, string> = {};
      for (const [productId, acc] of perProduct) {
        if (acc.units <= 0) continue;
        const cost = Math.round((acc.value / acc.units) * 100) / 100;
        const [changed] = await tx
          .update(products)
          .set({ cost, updatedAt: new Date() })
          .where(eq(products.id, productId))
          .returning({ name: products.name });
        if (changed) costChanges[changed.name] = brl(cost);
      }

      // O código do item na nota passa a levar ao produto nas próximas importações.
      const learned = new Map<string, { productId: string; factor: number }>();
      for (const { item } of items) {
        if (item.supplierCode && item.productId) {
          learned.set(item.supplierCode, { productId: item.productId, factor: item.factor });
        }
      }
      for (const [supplierCode, link] of learned) {
        await tx
          .insert(supplierProducts)
          .values({
            organizationId: current.organizationId,
            supplierId: current.supplierId,
            supplierCode,
            productId: link.productId,
            factor: link.factor,
          })
          .onConflictDoUpdate({
            target: [supplierProducts.supplierId, supplierProducts.supplierCode],
            set: { productId: link.productId, factor: link.factor, updatedAt: new Date() },
          });
      }

      if (installments.length > 0) {
        const [supplier] = await tx
          .select({ name: suppliers.name })
          .from(suppliers)
          .where(eq(suppliers.id, current.supplierId));
        await this.finance.recordPurchase(
          tx,
          auth,
          {
            id,
            unitId: current.unitId,
            code: current.code,
            supplierId: current.supplierId,
            supplierName: supplier?.name ?? '',
            invoiceNumber: current.invoiceNumber,
            accountId: current.accountId,
            categoryId: current.categoryId,
            competenceDate: current.issuedOn ?? current.enteredOn,
          },
          installments,
          today,
        );
      }
      await tx
        .update(purchases)
        .set({
          status: 'confirmed',
          confirmedBy: auth.userId,
          confirmedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(purchases.id, id));
      await recordAudit(tx, actorOf(auth), {
        entity: 'purchase',
        entityId: id,
        action: 'confirm',
        before: { status: 'Rascunho' },
        after: {
          status: 'Confirmada',
          total: brl(current.total),
          installments: installments.length,
          costs: costChanges,
        },
      });
      return this.get(auth, id, tx);
    });
  }

  /**
   * Cancela a compra. Confirmada, desfaz a entrada no estoque e cancela as parcelas; recusa se
   * alguma parcela já foi paga ou se o que entrou já saiu do estoque.
   */
  async cancel(auth: AuthContext, id: string, input: PurchaseCancelInput): Promise<Purchase> {
    return this.db.transaction(async (tx) => {
      const current = await this.lock(tx, auth, id);
      if (current.status === 'cancelled') throw conflict('Esta compra já está cancelada.');
      if (current.status === 'confirmed') {
        await this.finance.cancelPurchaseEntries(tx, id, current.code, input.reason);
        await this.inventory.unreceive(tx, auth, {
          id,
          organizationId: current.organizationId,
          unitId: current.unitId,
          code: current.code,
        });
      }
      await tx
        .update(purchases)
        .set({
          status: 'cancelled',
          cancelledBy: auth.userId,
          cancelledAt: new Date(),
          cancelReason: input.reason,
          updatedAt: new Date(),
        })
        .where(eq(purchases.id, id));
      await recordAudit(tx, actorOf(auth), {
        entity: 'purchase',
        entityId: id,
        action: 'cancel',
        before: { status: current.status === 'draft' ? 'Rascunho' : 'Confirmada' },
        after: { status: 'Cancelada', reason: input.reason },
      });
      return this.get(auth, id, tx);
    });
  }

  // Apoio ------------------------------------------------------------------------------------------

  private async lock(tx: Executor, auth: AuthContext, id: string): Promise<PurchaseRow> {
    const [row] = await tx
      .select()
      .from(purchases)
      .where(
        and(
          eq(purchases.id, id),
          eq(purchases.organizationId, auth.organizationId),
          eq(purchases.unitId, auth.unitId),
        ),
      )
      .for('update');
    if (!row) throw notFound('Compra');
    return row;
  }

  private async insert(
    tx: Executor,
    auth: AuthContext,
    source: 'manual' | 'xml',
    input: PurchaseInput,
  ): Promise<string> {
    const values = await this.validate(tx, auth, input, null);
    const id = newId();
    const code = await nextCounter(tx, auth.organizationId, 'purchase');
    try {
      await tx.insert(purchases).values({
        ...values,
        id,
        organizationId: auth.organizationId,
        unitId: auth.unitId,
        code,
        status: 'draft',
        source,
        createdBy: auth.userId,
      });
    } catch (error) {
      throw await this.translate(tx, auth, error, values.invoiceKey);
    }
    await this.insertLines(tx, id, input);
    return id;
  }

  private async insertLines(tx: Executor, purchaseId: string, input: PurchaseInput) {
    await tx.insert(purchaseItems).values(
      input.items.map((item, position) => ({
        id: newId(),
        purchaseId,
        position,
        productId: item.productId,
        description: item.description,
        supplierCode: item.supplierCode ?? '',
        ean: item.ean ?? '',
        supplierUnit: item.supplierUnit ?? '',
        quantity: item.quantity,
        factor: item.factor ?? 1,
        total: item.total,
        lotCode: item.lot?.code ?? null,
        expiresOn: item.lot?.expiresOn ?? null,
      })),
    );
    if (input.installments.length > 0) {
      await tx.insert(purchaseInstallments).values(
        input.installments.map((i, index) => ({
          purchaseId,
          number: index + 1,
          dueDate: i.dueDate,
          amount: i.amount,
        })),
      );
    }
  }

  /** Confere as referências e recalcula os totais; devolve as colunas da compra. */
  private async validate(
    tx: Executor,
    auth: AuthContext,
    input: PurchaseInput,
    current: PurchaseRow | null,
  ) {
    const org = auth.organizationId;
    const [supplier] = await tx
      .select({ id: suppliers.id, archivedAt: suppliers.archivedAt })
      .from(suppliers)
      .where(and(eq(suppliers.id, input.supplierId), eq(suppliers.organizationId, org)));
    if (!supplier || (supplier.archivedAt && supplier.id !== current?.supplierId)) {
      throw invalid('supplierId', 'Fornecedor indisponível');
    }
    const [account] = await tx
      .select({ id: financialAccounts.id, archivedAt: financialAccounts.archivedAt })
      .from(financialAccounts)
      .where(
        and(eq(financialAccounts.id, input.accountId), eq(financialAccounts.organizationId, org)),
      );
    if (!account || (account.archivedAt && account.id !== current?.accountId)) {
      throw invalid('accountId', 'Conta indisponível');
    }
    const [category] = await tx
      .select({
        id: financialCategories.id,
        kind: financialCategories.kind,
        archivedAt: financialCategories.archivedAt,
      })
      .from(financialCategories)
      .where(
        and(
          eq(financialCategories.id, input.categoryId),
          eq(financialCategories.organizationId, org),
        ),
      );
    if (!category || (category.archivedAt && category.id !== current?.categoryId)) {
      throw invalid('categoryId', 'Categoria indisponível');
    }
    if (category.kind !== 'expense')
      throw invalid('categoryId', 'Escolha uma categoria de despesa');

    const productIds = [
      ...new Set(input.items.map((i) => i.productId).filter((v): v is string => v !== null)),
    ];
    const found =
      productIds.length > 0
        ? await tx
            .select({ id: products.id, kind: products.kind })
            .from(products)
            .where(and(inArray(products.id, productIds), eq(products.organizationId, org)))
        : [];
    input.items.forEach((item, index) => {
      if (item.productId === null) return;
      const product = found.find((p) => p.id === item.productId);
      if (!product) throw invalid(`items.${String(index)}.productId`, 'Produto indisponível');
      if (product.kind !== 'product') {
        throw invalid(`items.${String(index)}.productId`, 'Serviço não entra em compra');
      }
    });

    const totals = totalsOf(input);
    if (totals.total < 0) {
      throw invalid('discount', 'O desconto é maior que o valor da compra');
    }
    if (input.issuedOn && input.issuedOn > input.enteredOn) {
      throw invalid('issuedOn', 'A emissão vem antes da entrada');
    }
    return {
      supplierId: input.supplierId,
      invoiceNumber: input.invoiceNumber,
      invoiceSeries: input.invoiceSeries,
      invoiceKey: input.invoiceKey,
      issuedOn: input.issuedOn,
      enteredOn: input.enteredOn,
      freight: input.freight,
      otherCosts: input.otherCosts,
      discount: input.discount,
      itemsTotal: fromCents(totals.items),
      total: fromCents(totals.total),
      accountId: input.accountId,
      categoryId: input.categoryId,
      notes: input.notes,
    };
  }

  private async translate(tx: Executor, auth: AuthContext, error: unknown, key: string) {
    if (isUniqueViolation(error) && violatedConstraint(error) === 'purchases_org_key_uq') {
      const [taken] = await tx
        .select({ code: purchases.code })
        .from(purchases)
        .where(
          and(eq(purchases.organizationId, auth.organizationId), eq(purchases.invoiceKey, key)),
        );
      return duplicateKey(taken?.code ?? null);
    }
    return error;
  }

  /** Fornecedor do emitente: pelo CPF/CNPJ, depois pelo nome; senão, cadastra. */
  private async supplierFor(
    tx: Executor,
    auth: AuthContext,
    emitter: ParsedNfe['supplier'],
  ): Promise<string> {
    const org = auth.organizationId;
    const [byDocument] = await tx
      .select({ id: suppliers.id, archivedAt: suppliers.archivedAt })
      .from(suppliers)
      .where(and(eq(suppliers.organizationId, org), eq(suppliers.document, emitter.document)));
    if (byDocument) {
      if (byDocument.archivedAt) {
        throw conflict('O fornecedor desta nota está arquivado; reative-o no financeiro antes.');
      }
      return byDocument.id;
    }
    const [byName] = await tx
      .select({
        id: suppliers.id,
        document: suppliers.document,
        archivedAt: suppliers.archivedAt,
      })
      .from(suppliers)
      .where(
        and(
          eq(suppliers.organizationId, org),
          sql`lower(${suppliers.name}) = lower(${emitter.name})`,
        ),
      );
    if (byName && byName.document === '' && !byName.archivedAt) {
      await tx
        .update(suppliers)
        .set({ document: emitter.document, updatedAt: new Date() })
        .where(eq(suppliers.id, byName.id));
      await recordAudit(tx, actorOf(auth), {
        entity: 'supplier',
        entityId: byName.id,
        action: 'update',
        before: { document: '' },
        after: { document: emitter.document },
      });
      return byName.id;
    }
    const id = newId();
    // Mesmo nome com outro documento: o cadastro novo leva o documento no nome.
    const name = byName ? `${emitter.name} (${emitter.document})` : emitter.name;
    const phone = emitter.phone.length === 10 || emitter.phone.length === 11 ? emitter.phone : '';
    await tx.insert(suppliers).values({
      id,
      organizationId: org,
      name,
      document: emitter.document,
      phone,
      email: '',
      notes: 'Cadastrado pela importação de NF-e.',
    });
    await recordAudit(tx, actorOf(auth), {
      entity: 'supplier',
      entityId: id,
      action: 'create',
      after: { name, document: emitter.document },
    });
    return id;
  }

  private async defaults(tx: Executor, auth: AuthContext) {
    const [account] = await tx
      .select({ id: financialAccounts.id })
      .from(financialAccounts)
      .where(
        and(
          eq(financialAccounts.organizationId, auth.organizationId),
          isNull(financialAccounts.archivedAt),
        ),
      )
      .orderBy(sql`${financialAccounts.kind} <> 'bank'`, asc(financialAccounts.createdAt));
    const [category] = await tx
      .select({ id: financialCategories.id })
      .from(financialCategories)
      .where(
        and(
          eq(financialCategories.organizationId, auth.organizationId),
          eq(financialCategories.kind, 'expense'),
          isNull(financialCategories.archivedAt),
        ),
      )
      .orderBy(
        sql`${financialCategories.name} <> 'Compras de mercadorias'`,
        asc(financialCategories.name),
      );
    if (!account) throw conflict('Cadastre uma conta financeira antes de lançar compras.');
    if (!category) throw conflict('Cadastre uma categoria de despesa antes de lançar compras.');
    return { accountId: account.id, categoryId: category.id };
  }

  private async snapshot(tx: Executor, auth: AuthContext, id: string) {
    const p = await this.get(auth, id, tx);
    return {
      code: p.code,
      supplier: p.supplier.name,
      invoice: p.invoiceNumber,
      enteredOn: p.enteredOn,
      items: p.items.length,
      total: brl(p.total),
    };
  }
}
