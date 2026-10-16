import {
  fromCents,
  saleStatusLabels,
  saleTotals,
  saleTypeLabels,
  toCents,
  type Sale,
  type SaleContext,
  type PatientSaleItemInput,
  type PatientSales,
  type SaleData,
  type SaleListItem,
  type SaleListQuery,
  type SalesSettings,
  type SellableItem,
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
  ne,
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
import {
  clients,
  costCenters,
  patients,
  productCommissions,
  products,
  saleItems,
  sales,
  salesSettings,
  units,
  users,
} from '../../db/schema.js';
import type { AuthContext } from '../auth/sessions.js';

const invalid = (path: string, message: string) =>
  new AppError('validation_failed', 'Dados da venda inválidos.', [{ path, message }]);

type SaleRow = typeof sales.$inferSelect;
type ItemRow = typeof saleItems.$inferSelect;

const DEFAULT_SETTINGS: SalesSettings = {
  discountLimitPercent: 10,
  defaultSaleType: 'in_person_consumer',
};

const brl = (value: number) =>
  `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const pct = (value: number) => `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

/**
 * PDV [RN-23..26, RN-28, RN-30]: venda e orçamento na mesma entidade, profissional por item,
 * desconto com limite e totais sempre recalculados aqui, nunca aceitos do cliente.
 */
export class SaleService {
  constructor(private readonly db: Database) {}

  async settings(auth: AuthContext, executor?: Executor): Promise<SalesSettings> {
    const [row] = await (executor ?? this.db)
      .select()
      .from(salesSettings)
      .where(eq(salesSettings.organizationId, auth.organizationId));
    if (!row) return DEFAULT_SETTINGS;
    return {
      discountLimitPercent: row.discountLimitPercent,
      defaultSaleType: row.defaultSaleType as SalesSettings['defaultSaleType'],
    };
  }

  async updateSettings(auth: AuthContext, input: SalesSettings): Promise<SalesSettings> {
    return this.db.transaction(async (tx) => {
      const before = await this.settings(auth, tx);
      await tx
        .insert(salesSettings)
        .values({ organizationId: auth.organizationId, ...input })
        .onConflictDoUpdate({
          target: salesSettings.organizationId,
          set: { ...input, updatedAt: new Date() },
        });
      await recordAudit(tx, actorOf(auth), {
        entity: 'sales_settings',
        entityId: auth.organizationId,
        action: 'update',
        before: settingsSnapshot(before),
        after: settingsSnapshot(input),
      });
      return input;
    });
  }

  /** Limite do usuário: o próprio, se houver; senão, o da clínica. */
  private async userLimit(tx: Executor, auth: AuthContext): Promise<number> {
    const [user] = await tx
      .select({ limit: users.discountLimitPercent })
      .from(users)
      .where(eq(users.id, auth.userId));
    return user?.limit ?? (await this.settings(auth, tx)).discountLimitPercent;
  }

  async context(auth: AuthContext): Promise<SaleContext> {
    const [settings, limit, professionals] = await Promise.all([
      this.settings(auth),
      this.userLimit(this.db, auth),
      this.db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(and(eq(users.organizationId, auth.organizationId), eq(users.active, true)))
        .orderBy(asc(sql`lower(${users.name})`)),
    ]);
    return {
      discountLimitPercent: auth.permissions.has('sales.discount') ? limit : 0,
      defaultSaleType: settings.defaultSaleType,
      professionals,
    };
  }

  /** Itens vendáveis: ativos e com finalidade de venda; busca por nome, código ou barras. */
  async sellable(auth: AuthContext, q: string): Promise<SellableItem[]> {
    const filters: SQL[] = [
      eq(products.organizationId, auth.organizationId),
      isNull(products.archivedAt),
      ne(products.purpose, 'internal'),
    ];
    if (q) {
      const matches: SQL[] = [containsText(products.name, q)];
      if (/^\d+$/.test(q)) {
        if (q.length <= 9) matches.push(eq(products.code, Number(q)));
        matches.push(eq(products.barcode, q));
      }
      const any = or(...matches);
      if (any) filters.push(any);
    }
    const rows = await this.db
      .select({
        id: products.id,
        code: products.code,
        name: products.name,
        kind: products.kind,
        serviceKind: products.serviceKind,
        unit: products.unit,
        barcode: products.barcode,
        salePrice: products.salePrice,
        allowPriceChange: products.allowPriceChange,
        discountLimitPercent: products.discountLimitPercent,
      })
      .from(products)
      .where(and(...filters))
      // Código de barras exato primeiro: o leitor costuma bipar e esperar o item certo no topo.
      .orderBy(
        sql`case when ${products.barcode} = ${q} then 0 else 1 end`,
        asc(sql`lower(${products.name})`),
      )
      .limit(20);
    return rows.map((r) => ({
      ...r,
      serviceKind: r.serviceKind as SellableItem['serviceKind'],
      unit: r.unit as SellableItem['unit'],
    }));
  }

  async list(
    auth: AuthContext,
    query: SaleListQuery,
  ): Promise<{ items: SaleListItem[]; total: number }> {
    const filters: SQL[] = [
      eq(sales.organizationId, auth.organizationId),
      eq(sales.unitId, auth.unitId),
    ];
    if (query.status) filters.push(eq(sales.status, query.status));
    if (query.sinceHours) {
      filters.push(gte(sales.createdAt, new Date(Date.now() - query.sinceHours * 3_600_000)));
    }
    if (query.q) {
      const matches: SQL[] = [
        containsText(clients.name, query.q),
        containsText(patients.name, query.q),
      ];
      if (/^\d{1,9}$/.test(query.q)) matches.push(eq(sales.code, Number(query.q)));
      const any = or(...matches);
      if (any) filters.push(any);
    }
    const where = and(...filters);
    const [rows, totals] = await Promise.all([
      this.db
        .select({
          id: sales.id,
          code: sales.code,
          status: sales.status,
          clientName: clients.name,
          patientName: patients.name,
          netTotal: sales.netTotal,
          createdAt: sales.createdAt,
        })
        .from(sales)
        .leftJoin(clients, eq(clients.id, sales.clientId))
        .leftJoin(patients, eq(patients.id, sales.patientId))
        .where(where)
        .orderBy(desc(sales.createdAt), desc(sales.code))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db
        .select({ n: count() })
        .from(sales)
        .leftJoin(clients, eq(clients.id, sales.clientId))
        .leftJoin(patients, eq(patients.id, sales.patientId))
        .where(where),
    ]);
    return {
      items: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      total: totals[0]?.n ?? 0,
    };
  }

  async get(auth: AuthContext, id: string, executor?: Executor): Promise<Sale> {
    const db = executor ?? this.db;
    const creator = alias(users, 'creator');
    const canceller = alias(users, 'canceller');
    const [row] = await db
      .select({
        sale: sales,
        clientName: clients.name,
        clientCode: clients.code,
        patientName: patients.name,
        unitName: units.name,
        createdBy: creator.name,
        cancelledBy: canceller.name,
      })
      .from(sales)
      .innerJoin(units, eq(units.id, sales.unitId))
      .innerJoin(creator, eq(creator.id, sales.createdBy))
      .leftJoin(canceller, eq(canceller.id, sales.cancelledBy))
      .leftJoin(clients, eq(clients.id, sales.clientId))
      .leftJoin(patients, eq(patients.id, sales.patientId))
      .where(and(eq(sales.id, id), eq(sales.organizationId, auth.organizationId)));
    if (!row) throw notFound('Venda');
    const items = await db
      .select({
        item: saleItems,
        professionalName: users.name,
        code: products.code,
        allowPriceChange: products.allowPriceChange,
        discountLimitPercent: products.discountLimitPercent,
      })
      .from(saleItems)
      .innerJoin(users, eq(users.id, saleItems.professionalId))
      .innerJoin(products, eq(products.id, saleItems.productId))
      .where(eq(saleItems.saleId, id))
      .orderBy(asc(saleItems.position));
    const s = row.sale;
    const pending = s.status === 'quote' || s.status === 'open';
    return {
      id: s.id,
      code: s.code,
      status: s.status,
      saleType: s.saleType as Sale['saleType'],
      client:
        s.clientId && row.clientName !== null && row.clientCode !== null
          ? { id: s.clientId, name: row.clientName, code: row.clientCode }
          : null,
      patient: s.patientId && row.patientName ? { id: s.patientId, name: row.patientName } : null,
      items: items.map(
        ({ item: i, professionalName, code, allowPriceChange, discountLimitPercent }) => ({
          id: i.id,
          productId: i.productId,
          code,
          name: i.name,
          kind: i.kind,
          serviceKind: i.serviceKind as Sale['items'][number]['serviceKind'],
          unit: i.unit as Sale['items'][number]['unit'],
          quantity: i.quantity,
          listPrice: i.listPrice,
          unitPrice: i.unitPrice,
          allowPriceChange,
          discountLimitPercent,
          professional: { id: i.professionalId, name: professionalName },
          clinicalEventId: i.clinicalEventId,
          grossTotal: i.grossTotal,
          discountAmount: i.discountAmount,
          netTotal: i.netTotal,
        }),
      ),
      discount: { mode: s.discountMode, value: s.discountValue },
      grossTotal: s.grossTotal,
      discountTotal: s.discountTotal,
      netTotal: s.netTotal,
      notes: s.notes,
      unitName: row.unitName,
      createdAt: s.createdAt.toISOString(),
      createdBy: row.createdBy,
      cancelled:
        s.cancelledAt && s.cancelReason
          ? { at: s.cancelledAt.toISOString(), by: row.cancelledBy ?? '', reason: s.cancelReason }
          : null,
      editable: pending && auth.permissions.has('sales.manage'),
      cancellable: pending && auth.permissions.has('sales.cancel'),
    };
  }

  async create(auth: AuthContext, input: SaleData): Promise<Sale> {
    return this.db.transaction(async (tx) => {
      const id = await this.insertSale(tx, auth, input);
      return this.get(auth, id, tx);
    });
  }

  private async insertSale(tx: Executor, auth: AuthContext, input: SaleData): Promise<string> {
    const id = newId();
    const prepared = await this.prepare(tx, auth, input, null);
    const code = await nextCounter(tx, auth.organizationId, 'sale');
    const [costCenter] = await tx
      .select({ id: costCenters.id })
      .from(costCenters)
      .where(
        and(
          eq(costCenters.unitId, auth.unitId),
          eq(costCenters.isDefault, true),
          isNull(costCenters.archivedAt),
        ),
      );
    await tx.insert(sales).values({
      id,
      organizationId: auth.organizationId,
      unitId: auth.unitId,
      costCenterId: costCenter?.id ?? null,
      code,
      status: input.kind === 'quote' ? 'quote' : 'open',
      createdBy: auth.userId,
      ...prepared.sale,
    });
    await this.insertItems(tx, id, prepared.items);
    await recordAudit(tx, actorOf(auth), {
      entity: 'sale',
      entityId: id,
      action: 'create',
      after: await this.auditSnapshot(tx, id),
    });
    return id;
  }

  /** Coluna de vendas da ficha [p.4]: venda aberta do animal nesta unidade e as recentes. */
  async forPatient(auth: AuthContext, patientId: string): Promise<PatientSales> {
    await this.patientOf(this.db, auth, patientId);
    const open = await this.openSaleOf(this.db, auth, patientId, false);
    const recent = await this.db
      .select({
        id: sales.id,
        code: sales.code,
        status: sales.status,
        clientName: clients.name,
        patientName: patients.name,
        netTotal: sales.netTotal,
        createdAt: sales.createdAt,
      })
      .from(sales)
      .leftJoin(clients, eq(clients.id, sales.clientId))
      .leftJoin(patients, eq(patients.id, sales.patientId))
      .where(and(eq(sales.organizationId, auth.organizationId), eq(sales.patientId, patientId)))
      .orderBy(desc(sales.createdAt), desc(sales.code))
      .limit(10);
    return {
      open: open ? await this.get(auth, open.id) : null,
      recent: recent.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    };
  }

  /**
   * Lança um item na venda aberta do animal nesta unidade, abrindo uma se não houver [RN-19].
   * O desconto e os preços já gravados na venda são mantidos; o total é recalculado.
   */
  async addToPatient(
    auth: AuthContext,
    patientId: string,
    item: PatientSaleItemInput,
    origin?: { tx: Executor; clinicalEventId: string },
  ): Promise<Sale> {
    const work = async (tx: Executor) => {
      const patient = await this.patientOf(tx, auth, patientId, true);
      const current = await this.openSaleOf(tx, auth, patientId, true);
      const newLine = { id: null, ...item, unitPrice: null };
      if (!current) {
        const settings = await this.settings(auth, tx);
        const id = await this.insertSale(tx, auth, {
          kind: 'sale',
          saleType: settings.defaultSaleType,
          clientId: patient.clientId,
          patientId,
          items: [newLine],
          discount: { mode: 'amount', value: 0 },
          notes: '',
        });
        if (origin) await this.markOrigin(tx, id, origin.clinicalEventId);
        return id;
      }
      const previousItems = await tx
        .select()
        .from(saleItems)
        .where(eq(saleItems.saleId, current.id))
        .orderBy(asc(saleItems.position));
      const input: SaleData = {
        kind: 'sale',
        saleType: current.saleType as SaleData['saleType'],
        clientId: current.clientId,
        patientId: current.patientId,
        items: [
          ...previousItems.map((p) => ({
            id: p.id,
            productId: p.productId,
            professionalId: p.professionalId,
            quantity: p.quantity,
            unitPrice: p.unitPrice,
          })),
          newLine,
        ],
        discount: { mode: current.discountMode, value: current.discountValue },
        notes: current.notes,
      };
      const prepared = await this.prepare(tx, auth, input, {
        sale: current,
        items: previousItems,
      });
      const before = await this.auditSnapshot(tx, current.id);
      await tx
        .update(sales)
        .set({ ...prepared.sale, updatedAt: new Date() })
        .where(eq(sales.id, current.id));
      await tx.delete(saleItems).where(eq(saleItems.saleId, current.id));
      await this.insertItems(tx, current.id, prepared.items);
      if (origin) await this.markOrigin(tx, current.id, origin.clinicalEventId);
      await recordAudit(tx, actorOf(auth), {
        entity: 'sale',
        entityId: current.id,
        action: 'add_item',
        before,
        after: await this.auditSnapshot(tx, current.id),
      });
      return current.id;
    };
    const id = origin ? await work(origin.tx) : await this.db.transaction(work);
    return this.get(auth, id, origin?.tx);
  }

  /** O último item lançado na venda veio deste evento clínico. */
  private async markOrigin(tx: Executor, saleId: string, clinicalEventId: string) {
    const [last] = await tx
      .select({ id: saleItems.id })
      .from(saleItems)
      .where(eq(saleItems.saleId, saleId))
      .orderBy(desc(saleItems.position))
      .limit(1);
    if (last) {
      await tx.update(saleItems).set({ clinicalEventId }).where(eq(saleItems.id, last.id));
    }
  }

  /** Com `lock`, serializa lançamentos simultâneos no mesmo animal: só uma venda é aberta. */
  private async patientOf(tx: Executor, auth: AuthContext, patientId: string, lock = false) {
    const query = tx
      .select({ clientId: patients.clientId })
      .from(patients)
      .where(and(eq(patients.id, patientId), eq(patients.organizationId, auth.organizationId)));
    const [patient] = lock ? await query.for('update') : await query;
    if (!patient) throw notFound('Animal');
    return patient;
  }

  /** Venda em aberto mais recente do animal nesta unidade. */
  private async openSaleOf(
    tx: Executor,
    auth: AuthContext,
    patientId: string,
    forUpdate: boolean,
  ): Promise<SaleRow | null> {
    const query = tx
      .select()
      .from(sales)
      .where(
        and(
          eq(sales.organizationId, auth.organizationId),
          eq(sales.unitId, auth.unitId),
          eq(sales.patientId, patientId),
          eq(sales.status, 'open'),
        ),
      )
      .orderBy(desc(sales.createdAt))
      .limit(1);
    const [row] = forUpdate ? await query.for('update') : await query;
    return row ?? null;
  }

  /** Edita orçamento ou venda em aberto; orçamento salvo como venda vira venda [RN-23]. */
  async update(auth: AuthContext, id: string, input: SaleData): Promise<Sale> {
    return this.db.transaction(async (tx) => {
      const current = await this.lock(tx, auth, id);
      if (current.status === 'closed' || current.status === 'cancelled') {
        throw conflict(
          `Venda ${saleStatusLabels[current.status].toLowerCase()} não pode ser editada.`,
        );
      }
      if (current.status === 'open' && input.kind === 'quote') {
        throw conflict('Uma venda em aberto não volta a ser orçamento.');
      }
      const previousItems = await tx.select().from(saleItems).where(eq(saleItems.saleId, id));
      const prepared = await this.prepare(tx, auth, input, { sale: current, items: previousItems });
      const before = await this.auditSnapshot(tx, id);
      await tx
        .update(sales)
        .set({
          ...prepared.sale,
          status: input.kind === 'quote' ? 'quote' : 'open',
          updatedAt: new Date(),
        })
        .where(eq(sales.id, id));
      await tx.delete(saleItems).where(eq(saleItems.saleId, id));
      await this.insertItems(tx, id, prepared.items);
      await recordAudit(tx, actorOf(auth), {
        entity: 'sale',
        entityId: id,
        action: current.status === 'quote' && input.kind === 'sale' ? 'convert' : 'update',
        before,
        after: await this.auditSnapshot(tx, id),
      });
      return this.get(auth, id, tx);
    });
  }

  async cancel(auth: AuthContext, id: string, reason: string): Promise<Sale> {
    return this.db.transaction(async (tx) => {
      const current = await this.lock(tx, auth, id);
      if (current.status === 'cancelled') throw conflict('Esta venda já está cancelada.');
      if (current.status === 'closed') {
        throw conflict('Venda baixada não pode ser cancelada por aqui.');
      }
      await tx
        .update(sales)
        .set({
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelledBy: auth.userId,
          cancelReason: reason,
          updatedAt: new Date(),
        })
        .where(eq(sales.id, id));
      await recordAudit(tx, actorOf(auth), {
        entity: 'sale',
        entityId: id,
        action: 'cancel',
        before: { code: current.code, status: saleStatusLabels[current.status] },
        after: { code: current.code, status: saleStatusLabels.cancelled, reason },
      });
      return this.get(auth, id, tx);
    });
  }

  private async lock(tx: Executor, auth: AuthContext, id: string): Promise<SaleRow> {
    const [row] = await tx
      .select()
      .from(sales)
      .where(and(eq(sales.id, id), eq(sales.organizationId, auth.organizationId)))
      .for('update');
    if (!row) throw notFound('Venda');
    return row;
  }

  /**
   * Valida referências e regras e devolve as linhas prontas para gravar. Na edição, o que a venda
   * já tinha (item arquivado depois, profissional desativado, preço ou desconto concedido por
   * quem podia) continua aceito: editar uma observação não pode derrubar a venda.
   */
  private async prepare(
    tx: Executor,
    auth: AuthContext,
    input: SaleData,
    previous: { sale: SaleRow; items: ItemRow[] } | null,
  ) {
    await this.assertCustomer(tx, auth, input, previous?.sale ?? null);

    const productIds = [...new Set(input.items.map((i) => i.productId))];
    const found = await tx
      .select()
      .from(products)
      .where(
        and(inArray(products.id, productIds), eq(products.organizationId, auth.organizationId)),
      );
    const byId = new Map(found.map((p) => [p.id, p]));
    const previousProducts = new Set(previous?.items.map((i) => i.productId) ?? []);
    const previousProfessionals = new Set(previous?.items.map((i) => i.professionalId) ?? []);

    const professionalIds = [...new Set(input.items.map((i) => i.professionalId))];
    const people = await tx
      .select({ id: users.id, active: users.active })
      .from(users)
      .where(
        and(inArray(users.id, professionalIds), eq(users.organizationId, auth.organizationId)),
      );
    const commissions = await tx
      .select()
      .from(productCommissions)
      .where(
        and(
          inArray(productCommissions.productId, productIds),
          inArray(productCommissions.userId, professionalIds),
        ),
      );

    const lines = input.items.map((item, i) => {
      const product = byId.get(item.productId);
      const known = previousProducts.has(item.productId);
      if (!product || ((product.archivedAt || product.purpose === 'internal') && !known)) {
        throw invalid(`items.${i}.productId`, 'Item indisponível para venda');
      }
      const person = people.find((p) => p.id === item.professionalId);
      if (!person || (!person.active && !previousProfessionals.has(item.professionalId))) {
        throw invalid(`items.${i}.professionalId`, 'Profissional inválido');
      }
      const unitPrice = item.unitPrice ?? product.salePrice;
      if (toCents(unitPrice) !== toCents(product.salePrice)) {
        const keptFromBefore = previous?.items.some(
          (p) => p.productId === item.productId && toCents(p.unitPrice) === toCents(unitPrice),
        );
        if (!keptFromBefore) {
          if (!product.allowPriceChange) {
            throw invalid(`items.${i}.unitPrice`, 'Este item não permite alterar o preço');
          }
          if (!auth.permissions.has('sales.change_price')) {
            throw invalid(`items.${i}.unitPrice`, 'Você não tem permissão para alterar o preço');
          }
        }
      }
      const commission =
        commissions.find((c) => c.productId === product.id && c.userId === item.professionalId)
          ?.percent ?? product.defaultCommissionPercent;
      // Item que já estava na venda mantém id, nome, preço de tabela e origem da cópia original.
      const kept = item.id ? previous?.items.find((p) => p.id === item.id) : undefined;
      return { item, product, unitPrice, commission, kept };
    });

    const totals = saleTotals(
      lines.map((l) => ({ unitPrice: l.unitPrice, quantity: l.item.quantity })),
      input.discount,
    );
    if (totals.exceedsGross) {
      throw invalid('discount.value', 'O desconto não pode passar do total da venda');
    }
    await this.assertDiscount(tx, auth, lines, totals, previous?.sale ?? null);

    return {
      sale: {
        saleType: input.saleType,
        clientId: input.clientId,
        patientId: input.patientId,
        discountMode: input.discount.mode,
        discountValue: input.discount.value,
        grossTotal: fromCents(totals.grossCents),
        discountTotal: fromCents(totals.discountCents),
        netTotal: fromCents(totals.netCents),
        notes: input.notes,
      },
      items: lines.map((l, i) => {
        const t = totals.items[i] ?? { grossCents: 0, discountCents: 0 };
        return {
          id: l.kept?.id ?? newId(),
          productId: l.product.id,
          professionalId: l.item.professionalId,
          name: l.kept?.productId === l.product.id ? l.kept.name : l.product.name,
          kind: l.product.kind,
          serviceKind: l.product.serviceKind,
          unit: l.product.unit,
          quantity: l.item.quantity,
          listPrice: l.kept?.productId === l.product.id ? l.kept.listPrice : l.product.salePrice,
          unitPrice: l.unitPrice,
          grossTotal: fromCents(t.grossCents),
          discountAmount: fromCents(t.discountCents),
          netTotal: fromCents(t.grossCents - t.discountCents),
          commissionPercent: l.commission,
          clinicalEventId: l.kept?.productId === l.product.id ? l.kept.clinicalEventId : null,
        };
      }),
    };
  }

  /** Cliente da organização e ativo; animal precisa ser dele [RN-25]. */
  private async assertCustomer(
    tx: Executor,
    auth: AuthContext,
    input: SaleData,
    previous: SaleRow | null,
  ) {
    if (input.clientId) {
      const [client] = await tx
        .select({ archivedAt: clients.archivedAt })
        .from(clients)
        .where(
          and(eq(clients.id, input.clientId), eq(clients.organizationId, auth.organizationId)),
        );
      if (!client || (client.archivedAt && input.clientId !== previous?.clientId)) {
        throw invalid('clientId', 'Cliente inválido');
      }
    }
    if (input.patientId) {
      const [patient] = await tx
        .select({ clientId: patients.clientId, archivedAt: patients.archivedAt })
        .from(patients)
        .where(
          and(eq(patients.id, input.patientId), eq(patients.organizationId, auth.organizationId)),
        );
      if (
        !patient ||
        patient.clientId !== input.clientId ||
        (patient.archivedAt && input.patientId !== previous?.patientId)
      ) {
        throw invalid('patientId', 'Animal não pertence a este cliente');
      }
    }
  }

  /**
   * Desconto exige permissão própria e respeita o menor limite entre o do usuário (ou da clínica)
   * e o de cada item [RN-26]. Como o desconto é rateado proporcionalmente, o percentual efetivo é o
   * mesmo em todos os itens, e basta compará-lo com o menor limite. Desconto igual ou menor que o
   * já gravado na venda passa sem nova checagem: quem concedeu tinha permissão para isso.
   */
  private async assertDiscount(
    tx: Executor,
    auth: AuthContext,
    lines: { product: typeof products.$inferSelect }[],
    totals: { grossCents: number; discountCents: number },
    previous: SaleRow | null,
  ) {
    if (totals.discountCents === 0) return;
    if (previous) {
      const prevGross = toCents(previous.grossTotal);
      const prevDiscount = toCents(previous.discountTotal);
      // d/G <= d0/G0, em inteiros.
      if (prevGross > 0 && totals.discountCents * prevGross <= prevDiscount * totals.grossCents) {
        return;
      }
    }
    if (!auth.permissions.has('sales.discount')) {
      throw invalid('discount.value', 'Você não tem permissão para conceder desconto');
    }
    const userLimit = await this.userLimit(tx, auth);
    let limit = userLimit;
    let limitedBy: string | null = null;
    for (const { product } of lines) {
      if (product.discountLimitPercent !== null && product.discountLimitPercent < limit) {
        limit = product.discountLimitPercent;
        limitedBy = product.name;
      }
    }
    // d/G <= limite/100, em inteiros (limite tem duas casas).
    if (totals.discountCents * 10_000 > totals.grossCents * Math.round(limit * 100)) {
      throw invalid(
        'discount.value',
        limitedBy
          ? `Desconto acima do limite de ${pct(limit)} do item ${limitedBy}`
          : `Desconto acima do seu limite de ${pct(limit)}`,
      );
    }
  }

  private async insertItems(
    tx: Executor,
    saleId: string,
    items: Omit<ItemRow, 'saleId' | 'position'>[],
  ) {
    await tx
      .insert(saleItems)
      .values(items.map((item, position) => ({ saleId, position, ...item })));
  }

  private async auditSnapshot(tx: Executor, id: string) {
    const [row] = await tx
      .select({ s: sales, client: clients.name, patient: patients.name })
      .from(sales)
      .leftJoin(clients, eq(clients.id, sales.clientId))
      .leftJoin(patients, eq(patients.id, sales.patientId))
      .where(eq(sales.id, id));
    if (!row) throw notFound('Venda');
    const items = await tx
      .select({ i: saleItems, professional: users.name })
      .from(saleItems)
      .innerJoin(users, eq(users.id, saleItems.professionalId))
      .where(eq(saleItems.saleId, id))
      .orderBy(asc(saleItems.position));
    const s = row.s;
    return {
      code: s.code,
      status: saleStatusLabels[s.status],
      saleType: saleTypeLabels[s.saleType as keyof typeof saleTypeLabels],
      client: row.client,
      patient: row.patient,
      items: items
        .map(
          ({ i, professional }) =>
            `${qty(i.quantity)} × ${i.name} a ${brl(i.unitPrice)} (${professional})`,
        )
        .join('; '),
      discount: s.discountMode === 'percent' ? pct(s.discountValue) : brl(s.discountValue),
      grossTotal: s.grossTotal,
      discountTotal: s.discountTotal,
      netTotal: s.netTotal,
      notes: s.notes,
    };
  }
}

const settingsSnapshot = (s: SalesSettings) => ({
  discountLimitPercent: s.discountLimitPercent,
  defaultSaleType: saleTypeLabels[s.defaultSaleType],
});
