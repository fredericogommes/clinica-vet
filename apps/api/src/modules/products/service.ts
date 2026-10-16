import {
  markupPercent,
  priceForMarkup,
  type Product,
  type ProductData,
  type ProductListItem,
  type ProductListQuery,
} from '@clinica/contracts';
import { and, asc, count, eq, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { actorOf } from '../../core/actor.js';
import { recordAudit } from '../../core/audit.js';
import { nextCounter } from '../../core/counters.js';
import { AppError, conflict, notFound } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import { containsText } from '../../core/search.js';
import type { Database, Executor } from '../../db/client.js';
import { isUniqueViolation, violatedConstraint } from '../../db/errors.js';
import {
  productBrands,
  productCommissions,
  productGroups,
  products,
  users,
} from '../../db/schema.js';
import type { AuthContext } from '../auth/sessions.js';

const conflictMessages: Record<string, string> = {
  products_org_barcode_uq: 'Já existe um produto com este código de barras.',
};

const invalid = (path: string, message: string) =>
  new AppError('validation_failed', 'Dados do produto inválidos.', [{ path, message }]);

type Row = typeof products.$inferSelect;

/** Produtos e serviços [RN-22]: cadastro único, preço, custo, markup, comissão e fiscal. */
export class ProductService {
  constructor(private readonly db: Database) {}

  /** Busca por nome, código interno ou código de barras, com filtros de tipo e grupo. */
  async list(
    auth: AuthContext,
    query: ProductListQuery,
  ): Promise<{ items: ProductListItem[]; total: number }> {
    const filters: SQL[] = [
      eq(products.organizationId, auth.organizationId),
      query.archived ? isNotNull(products.archivedAt) : isNull(products.archivedAt),
    ];
    if (query.kind) filters.push(eq(products.kind, query.kind));
    if (query.serviceKind) filters.push(eq(products.serviceKind, query.serviceKind));
    if (query.groupId) filters.push(eq(products.groupId, query.groupId));
    if (query.priceList) filters.push(eq(products.showInPriceList, true));
    if (query.q) {
      const matches: SQL[] = [containsText(products.name, query.q)];
      if (/^\d+$/.test(query.q)) {
        if (query.q.length <= 9) matches.push(eq(products.code, Number(query.q)));
        matches.push(eq(products.barcode, query.q));
      }
      const any = or(...matches);
      if (any) filters.push(any);
    }
    const where = and(...filters);
    const [rows, totals] = await Promise.all([
      this.db
        .select({
          id: products.id,
          code: products.code,
          kind: products.kind,
          serviceKind: products.serviceKind,
          name: products.name,
          unit: products.unit,
          barcode: products.barcode,
          groupName: productGroups.name,
          brandName: productBrands.name,
          salePrice: products.salePrice,
          archivedAt: products.archivedAt,
        })
        .from(products)
        .leftJoin(productGroups, eq(productGroups.id, products.groupId))
        .leftJoin(productBrands, eq(productBrands.id, products.brandId))
        .where(where)
        .orderBy(asc(sql`lower(${products.name})`), asc(products.code))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ n: count() }).from(products).where(where),
    ]);
    return {
      items: rows.map(({ archivedAt, ...r }) => ({
        ...r,
        serviceKind: r.serviceKind as ProductListItem['serviceKind'],
        unit: r.unit as ProductListItem['unit'],
        archived: archivedAt !== null,
      })),
      total: totals[0]?.n ?? 0,
    };
  }

  /** Usuários ativos da clínica, para a comissão diferenciada; sem exigir acesso a Usuários. */
  async professionals(auth: AuthContext): Promise<{ id: string; name: string }[]> {
    return this.db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.organizationId, auth.organizationId), eq(users.active, true)))
      .orderBy(asc(sql`lower(${users.name})`));
  }

  async get(auth: AuthContext, id: string, executor?: Executor): Promise<Product> {
    const db = executor ?? this.db;
    const [row] = await db
      .select({ product: products, groupName: productGroups.name, brandName: productBrands.name })
      .from(products)
      .leftJoin(productGroups, eq(productGroups.id, products.groupId))
      .leftJoin(productBrands, eq(productBrands.id, products.brandId))
      .where(and(eq(products.id, id), eq(products.organizationId, auth.organizationId)));
    if (!row) throw notFound('Produto');
    const commissions = await db
      .select({
        userId: productCommissions.userId,
        userName: users.name,
        percent: productCommissions.percent,
      })
      .from(productCommissions)
      .innerJoin(users, eq(users.id, productCommissions.userId))
      .where(eq(productCommissions.productId, id))
      .orderBy(asc(sql`lower(${users.name})`));
    return toProduct(row.product, row.groupName, row.brandName, commissions, canSeeCost(auth));
  }

  async create(auth: AuthContext, input: ProductData): Promise<Product> {
    const id = newId();
    return this.write(async (tx) => {
      await this.assertRefs(tx, auth, input, null);
      const code = await nextCounter(tx, auth.organizationId, 'product');
      const cost = canSeeCost(auth) ? costColumnsOf(input) : { cost: null, desiredMarkup: null };
      await tx.insert(products).values({
        id,
        organizationId: auth.organizationId,
        code,
        ...columnsOf(input),
        ...cost,
      });
      await this.replaceCommissions(tx, id, input);
      const after = await this.get(auth, id, tx);
      await recordAudit(tx, actorOf(auth), {
        entity: 'product',
        entityId: id,
        action: 'create',
        after: await this.auditSnapshot(tx, id),
      });
      return after;
    });
  }

  /**
   * Quem não vê custo também não o altera: custo e markup desejado guardados ficam como estão,
   * qualquer que seja o valor enviado.
   */
  async update(auth: AuthContext, id: string, input: ProductData): Promise<Product> {
    return this.write(async (tx) => {
      const current = await this.lock(tx, auth, id);
      if (current.archivedAt) throw conflict('Restaure o item antes de editá-lo.');
      await this.assertRefs(tx, auth, input, current);
      const before = await this.auditSnapshot(tx, id);
      await tx
        .update(products)
        .set({
          ...columnsOf(input),
          ...(canSeeCost(auth) ? costColumnsOf(input) : {}),
          updatedAt: new Date(),
        })
        .where(eq(products.id, id));
      await this.replaceCommissions(tx, id, input);
      const after = await this.auditSnapshot(tx, id);
      await recordAudit(tx, actorOf(auth), {
        entity: 'product',
        entityId: id,
        action: 'update',
        before,
        after,
      });
      return this.get(auth, id, tx);
    });
  }

  async setArchived(auth: AuthContext, id: string, archived: boolean): Promise<Product> {
    return this.write(async (tx) => {
      const current = await this.lock(tx, auth, id);
      if ((current.archivedAt !== null) === archived) return this.get(auth, id, tx);
      await tx
        .update(products)
        .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
        .where(eq(products.id, id));
      await recordAudit(tx, actorOf(auth), {
        entity: 'product',
        entityId: id,
        action: archived ? 'archive' : 'restore',
        before: { name: current.name, archived: !archived },
        after: { name: current.name, archived },
      });
      return this.get(auth, id, tx);
    });
  }

  private async lock(tx: Executor, auth: AuthContext, id: string): Promise<Row> {
    const [row] = await tx
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.organizationId, auth.organizationId)))
      .for('update');
    if (!row) throw notFound('Produto');
    return row;
  }

  /**
   * Grupo, marca e profissionais precisam ser da organização e estar ativos; o que o item já
   * tinha antes de ser arquivado ou desativado continua aceito.
   */
  private async assertRefs(
    tx: Executor,
    auth: AuthContext,
    input: ProductData,
    current: Row | null,
  ): Promise<void> {
    const checks = [
      ['groupId', productGroups, input.groupId, current?.groupId, 'Grupo inválido'],
      ['brandId', productBrands, input.brandId, current?.brandId, 'Marca inválida'],
    ] as const;
    for (const [path, table, id, previous, message] of checks) {
      if (!id) continue;
      const [row] = await tx
        .select({ archivedAt: table.archivedAt })
        .from(table)
        .where(and(eq(table.id, id), eq(table.organizationId, auth.organizationId)));
      if (!row || (row.archivedAt && id !== previous)) throw invalid(path, message);
    }
    const userIds = input.commissions.map((c) => c.userId);
    if (userIds.length === 0) return;
    const found = await tx
      .select({ id: users.id, active: users.active })
      .from(users)
      .where(and(inArray(users.id, userIds), eq(users.organizationId, auth.organizationId)));
    const previous = current
      ? new Set(
          (
            await tx
              .select({ userId: productCommissions.userId })
              .from(productCommissions)
              .where(eq(productCommissions.productId, current.id))
          ).map((r) => r.userId),
        )
      : new Set<string>();
    input.commissions.forEach((c, i) => {
      const user = found.find((u) => u.id === c.userId);
      if (!user || (!user.active && !previous.has(c.userId))) {
        throw invalid(`commissions.${i}.userId`, 'Profissional inválido');
      }
    });
  }

  private async replaceCommissions(tx: Executor, productId: string, input: ProductData) {
    await tx.delete(productCommissions).where(eq(productCommissions.productId, productId));
    if (input.commissions.length === 0) return;
    await tx
      .insert(productCommissions)
      .values(input.commissions.map((c) => ({ productId, userId: c.userId, percent: c.percent })));
  }

  /** Estado completo, com custo, para o log: o log de auditoria tem permissão própria. */
  private async auditSnapshot(tx: Executor, id: string) {
    const [row] = await tx
      .select({ p: products, group: productGroups.name, brand: productBrands.name })
      .from(products)
      .leftJoin(productGroups, eq(productGroups.id, products.groupId))
      .leftJoin(productBrands, eq(productBrands.id, products.brandId))
      .where(eq(products.id, id));
    if (!row) throw notFound('Produto');
    const p = row.p;
    const commissions = await tx
      .select({ name: users.name, percent: productCommissions.percent })
      .from(productCommissions)
      .innerJoin(users, eq(users.id, productCommissions.userId))
      .where(eq(productCommissions.productId, id))
      .orderBy(asc(sql`lower(${users.name})`));
    return {
      code: p.code,
      kind: p.kind,
      serviceKind: p.serviceKind,
      name: p.name,
      unit: p.unit,
      barcode: p.barcode,
      brand: row.brand,
      group: row.group,
      ncm: p.ncm,
      origin: p.origin,
      acquisition: p.acquisition,
      cfop: p.cfop,
      taxSituation: p.taxSituation,
      municipalServiceCode: p.municipalServiceCode,
      taxProfile: p.taxProfile,
      salePrice: p.salePrice,
      cost: p.cost,
      purpose: p.purpose,
      desiredMarkup: p.desiredMarkup,
      allowPriceChange: p.allowPriceChange,
      showInPriceList: p.showInPriceList,
      discountLimitPercent: p.discountLimitPercent,
      defaultCommissionPercent: p.defaultCommissionPercent,
      commissions: commissions.map((c) => `${c.name}: ${c.percent}%`).join(', '),
      tracksStock: p.tracksStock,
      minStock: p.minStock,
      idealStock: p.idealStock,
    };
  }

  private async write<T>(work: (tx: Executor) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(work);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const constraint = violatedConstraint(error);
        throw conflict(
          (constraint && conflictMessages[constraint]) ?? 'Já existe um registro com estes dados.',
        );
      }
      throw error;
    }
  }
}

const canSeeCost = (auth: AuthContext) => auth.permissions.has('products.view_cost');

/**
 * Normaliza pelo tipo: serviço não tem código de barras, NCM, CFOP, CST nem estoque; produto não
 * tem classificação de serviço nem código de serviço municipal.
 */
function columnsOf(input: ProductData) {
  const service = input.kind === 'service';
  return {
    kind: input.kind,
    serviceKind: service ? input.serviceKind : null,
    name: input.name,
    unit: input.unit,
    barcode: service ? null : input.barcode,
    brandId: input.brandId,
    groupId: input.groupId,
    ncm: service ? null : input.ncm,
    origin: input.origin,
    acquisition: input.acquisition,
    cfop: service ? null : input.cfop,
    taxSituation: service ? null : input.taxSituation,
    municipalServiceCode: service ? input.municipalServiceCode : null,
    taxProfile: input.taxProfile,
    salePrice: input.salePrice,
    purpose: input.purpose,
    allowPriceChange: input.allowPriceChange,
    showInPriceList: input.showInPriceList,
    discountLimitPercent: input.discountLimitPercent,
    defaultCommissionPercent: input.defaultCommissionPercent,
    tracksStock: service ? false : input.tracksStock,
    minStock: service || !input.tracksStock ? null : input.minStock,
    idealStock: service || !input.tracksStock ? null : input.idealStock,
  };
}

const costColumnsOf = (input: ProductData) => ({
  cost: input.cost,
  desiredMarkup: input.desiredMarkup,
});

function toProduct(
  p: Row,
  groupName: string | null,
  brandName: string | null,
  commissions: { userId: string; userName: string; percent: number }[],
  costVisible: boolean,
): Product {
  return {
    id: p.id,
    code: p.code,
    kind: p.kind,
    serviceKind: p.serviceKind as Product['serviceKind'],
    name: p.name,
    unit: p.unit as Product['unit'],
    barcode: p.barcode,
    brand: p.brandId && brandName ? { id: p.brandId, name: brandName } : null,
    group: p.groupId && groupName ? { id: p.groupId, name: groupName } : null,
    ncm: p.ncm,
    origin: p.origin as Product['origin'],
    acquisition: p.acquisition as Product['acquisition'],
    cfop: p.cfop,
    taxSituation: p.taxSituation,
    municipalServiceCode: p.municipalServiceCode,
    taxProfile: p.taxProfile,
    salePrice: p.salePrice,
    costVisible,
    cost: costVisible ? p.cost : null,
    desiredMarkup: costVisible ? p.desiredMarkup : null,
    realMarkup: costVisible ? markupPercent(p.salePrice, p.cost) : null,
    suggestedPrice: costVisible ? priceForMarkup(p.cost, p.desiredMarkup) : null,
    purpose: p.purpose as Product['purpose'],
    allowPriceChange: p.allowPriceChange,
    showInPriceList: p.showInPriceList,
    discountLimitPercent: p.discountLimitPercent,
    defaultCommissionPercent: p.defaultCommissionPercent,
    commissions,
    tracksStock: p.tracksStock,
    minStock: p.minStock,
    idealStock: p.idealStock,
    archived: p.archivedAt !== null,
    createdAt: p.createdAt.toISOString(),
  };
}
