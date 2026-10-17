import {
  categoryKindLabels,
  entryStatusLabels,
  financialAccountKindLabels,
  acquirerKinds,
  fromCents,
  splitInstallments,
  toCents,
  type CancelEntryInput,
  type Entry,
  type PaymentKind,
  type EntryInput,
  type EntryList,
  type EntryQuery,
  type EntryUpdate,
  type FinanceOptions,
  type FinancialAccount,
  type FinancialAccountInput,
  type FinancialCategory,
  type FinancialCategoryInput,
  type PayEntryInput,
  type Supplier,
  type SupplierInput,
  type TransferInput,
} from '@clinica/contracts';
import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { actorOf } from '../../core/actor.js';
import { recordAudit } from '../../core/audit.js';
import { AppError, conflict, notFound } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import { containsText } from '../../core/search.js';
import { addDays, addMonths, instantToZoned } from '../../core/zoned-time.js';
import type { Database, Executor } from '../../db/client.js';
import { isUniqueViolation, violatedConstraint } from '../../db/errors.js';
import {
  clients,
  costCenters,
  financialAccounts,
  financialCategories,
  financialEntries,
  purchases,
  sales,
  suppliers,
} from '../../db/schema.js';
import type { AuthContext } from '../auth/sessions.js';
import { unitTimeZone } from '../scheduling/availability.js';

type AccountRow = typeof financialAccounts.$inferSelect;
type CategoryRow = typeof financialCategories.$inferSelect;
type SupplierRow = typeof suppliers.$inferSelect;
type EntryRow = typeof financialEntries.$inferSelect;
type SaleRow = typeof sales.$inferSelect;

const invalid = (path: string, message: string) =>
  new AppError('validation_failed', 'Dados do lançamento inválidos.', [{ path, message }]);

const brl = (value: number) =>
  `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const br = (iso: string) => iso.split('-').reverse().join('/');

/** Plano de contas inicial, criado na primeira vez que a organização abre o financeiro. */
const STARTER_CATEGORIES: {
  name: string;
  kind: 'income' | 'expense';
  systemKey?: 'sales' | 'card_fees';
  children?: string[];
}[] = [
  { name: 'Vendas', kind: 'income', systemKey: 'sales' },
  { name: 'Outras receitas', kind: 'income' },
  { name: 'Taxas de cartão', kind: 'expense', systemKey: 'card_fees' },
  { name: 'Comissões', kind: 'expense' },
  {
    name: 'Gastos gerais operacionais',
    kind: 'expense',
    children: [
      'Aluguel',
      'Água, luz e telefone',
      'Salários e encargos',
      'Impostos e taxas',
      'Compras de mercadorias',
      'Manutenção',
      'Marketing',
    ],
  },
  { name: 'Tarifas bancárias', kind: 'expense' },
];

/** Valor com sinal de um lançamento pago (entra soma, sai subtrai). */
const signedPaid = sql<number>`case when ${financialEntries.status} = 'paid' then
  case when ${financialEntries.direction} = 'in' then ${financialEntries.paidAmount}
  else -${financialEntries.paidAmount} end else 0 end`;
const signedOpen = sql<number>`case when ${financialEntries.status} = 'open' then
  case when ${financialEntries.direction} = 'in' then ${financialEntries.amount}
  else -${financialEntries.amount} end else 0 end`;
/** Data que posiciona o lançamento no extrato: o pagamento, ou o vencimento enquanto aberto. */
const effectiveDate = sql<string>`coalesce(${financialEntries.paidOn}, ${financialEntries.dueDate})`;

const toCategory = (r: CategoryRow): FinancialCategory => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  parentId: r.parentId,
  system: r.systemKey !== null,
  archived: r.archivedAt !== null,
});

const toSupplier = (r: SupplierRow): Supplier => ({
  id: r.id,
  name: r.name,
  document: r.document,
  phone: r.phone,
  email: r.email,
  notes: r.notes,
  archived: r.archivedAt !== null,
});

const counterpartEntry = alias(financialEntries, 'counterpart_entry');
const counterpartAccount = alias(financialAccounts, 'counterpart_account');

function selectEntries(db: Executor) {
  return db
    .select({
      entry: financialEntries,
      account: { id: financialAccounts.id, name: financialAccounts.name },
      category: { id: financialCategories.id, name: financialCategories.name },
      supplier: { id: suppliers.id, name: suppliers.name },
      client: { id: clients.id, name: clients.name },
      costCenter: { id: costCenters.id, name: costCenters.name },
      sale: { id: sales.id, code: sales.code },
      purchase: { id: purchases.id, code: purchases.code },
      counterpart: { id: counterpartAccount.id, name: counterpartAccount.name },
    })
    .from(financialEntries)
    .innerJoin(financialAccounts, eq(financialAccounts.id, financialEntries.accountId))
    .leftJoin(financialCategories, eq(financialCategories.id, financialEntries.categoryId))
    .leftJoin(suppliers, eq(suppliers.id, financialEntries.supplierId))
    .leftJoin(clients, eq(clients.id, financialEntries.clientId))
    .leftJoin(costCenters, eq(costCenters.id, financialEntries.costCenterId))
    .leftJoin(sales, eq(sales.id, financialEntries.saleId))
    .leftJoin(purchases, eq(purchases.id, financialEntries.purchaseId))
    .leftJoin(
      counterpartEntry,
      and(
        eq(counterpartEntry.transferId, financialEntries.transferId),
        ne(counterpartEntry.id, financialEntries.id),
      ),
    )
    .leftJoin(counterpartAccount, eq(counterpartAccount.id, counterpartEntry.accountId));
}

type EntryJoinRow = Awaited<ReturnType<typeof selectEntries>>[number];

/**
 * Financeiro [p.18–19, RN-35]: contas, plano de contas, fornecedores e lançamentos. Saldo nunca é
 * gravado: sai do saldo inicial mais os lançamentos pagos. As vendas lançam sozinhas por aqui.
 */
export class FinanceService {
  constructor(private readonly db: Database) {}

  // Estrutura inicial ------------------------------------------------------------------------------

  /** Cria contas e plano de contas iniciais uma única vez por organização, mesmo em paralelo. */
  async ensure(tx: Executor, organizationId: string, today: string): Promise<void> {
    const [ready] = await tx
      .select({ id: financialCategories.id })
      .from(financialCategories)
      .where(
        and(
          eq(financialCategories.organizationId, organizationId),
          eq(financialCategories.systemKey, 'sales'),
        ),
      );
    if (ready) return;
    const now = new Date();
    const [first, ...rest] = STARTER_CATEGORIES;
    if (!first) return;
    // A categoria Vendas funciona como trava: só quem a inseriu cria o resto.
    const claimed = await tx
      .insert(financialCategories)
      .values({
        id: newId(),
        organizationId,
        name: first.name,
        kind: first.kind,
        systemKey: first.systemKey ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: financialCategories.id });
    if (claimed.length === 0) return;
    for (const c of rest) {
      const id = newId();
      await tx.insert(financialCategories).values({
        id,
        organizationId,
        name: c.name,
        kind: c.kind,
        systemKey: c.systemKey ?? null,
        createdAt: now,
        updatedAt: now,
      });
      if (c.children?.length) {
        await tx.insert(financialCategories).values(
          c.children.map((name) => ({
            id: newId(),
            organizationId,
            name,
            kind: c.kind,
            parentId: id,
            createdAt: now,
            updatedAt: now,
          })),
        );
      }
    }
    const [hasAccount] = await tx
      .select({ id: financialAccounts.id })
      .from(financialAccounts)
      .where(eq(financialAccounts.organizationId, organizationId))
      .limit(1);
    if (!hasAccount) {
      await tx.insert(financialAccounts).values([
        {
          id: newId(),
          organizationId,
          name: 'Caixa',
          kind: 'cash',
          openingDate: today,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: newId(),
          organizationId,
          name: 'Banco',
          kind: 'bank',
          openingDate: today,
          createdAt: now,
          updatedAt: now,
        },
      ]);
    }
  }

  async today(db: Executor, auth: AuthContext): Promise<string> {
    return instantToZoned(new Date(), await unitTimeZone(db, auth.unitId)).date;
  }

  private async ready(auth: AuthContext): Promise<string> {
    const today = await this.today(this.db, auth);
    await this.db.transaction((tx) => this.ensure(tx, auth.organizationId, today));
    return today;
  }

  async options(auth: AuthContext): Promise<FinanceOptions> {
    const today = await this.ready(auth);
    const [accounts, categories, supplierRows, centers] = await Promise.all([
      this.accountsWithBalance(auth),
      this.listCategories(auth),
      this.db
        .select({ id: suppliers.id, name: suppliers.name })
        .from(suppliers)
        .where(and(eq(suppliers.organizationId, auth.organizationId), isNull(suppliers.archivedAt)))
        .orderBy(asc(suppliers.name)),
      this.db
        .select({ id: costCenters.id, name: costCenters.name })
        .from(costCenters)
        .where(
          and(eq(costCenters.organizationId, auth.organizationId), isNull(costCenters.archivedAt)),
        )
        .orderBy(asc(costCenters.name)),
    ]);
    return { accounts, categories, suppliers: supplierRows, costCenters: centers, today };
  }

  // Contas -----------------------------------------------------------------------------------------

  async listAccounts(auth: AuthContext): Promise<FinancialAccount[]> {
    await this.ready(auth);
    return this.accountsWithBalance(auth);
  }

  private async accountsWithBalance(auth: AuthContext, db: Executor = this.db) {
    const sums = db
      .select({
        accountId: financialEntries.accountId,
        paid: sql<string | null>`sum(${signedPaid})`.as('paid'),
        open: sql<string>`sum(${signedOpen})`.as('open'),
      })
      .from(financialEntries)
      .where(eq(financialEntries.organizationId, auth.organizationId))
      .groupBy(financialEntries.accountId)
      .as('sums');
    const rows = await db
      .select({ account: financialAccounts, paid: sums.paid, open: sums.open })
      .from(financialAccounts)
      .leftJoin(sums, eq(sums.accountId, financialAccounts.id))
      .where(eq(financialAccounts.organizationId, auth.organizationId))
      .orderBy(
        sql`${financialAccounts.archivedAt} is not null`,
        asc(financialAccounts.createdAt),
        asc(financialAccounts.id),
      );
    return rows.map(({ account: a, paid, open }) => {
      const balance = toCents(a.openingBalance) + toCents(Number(paid));
      return {
        id: a.id,
        name: a.name,
        kind: a.kind,
        openingBalance: a.openingBalance,
        openingDate: a.openingDate,
        archived: a.archivedAt !== null,
        balance: fromCents(balance),
        forecast: fromCents(balance + toCents(Number(open))),
      };
    });
  }

  async createAccount(auth: AuthContext, input: FinancialAccountInput): Promise<FinancialAccount> {
    await this.ready(auth);
    return this.write(async (tx) => {
      const now = new Date();
      const id = newId();
      await tx.insert(financialAccounts).values({
        id,
        organizationId: auth.organizationId,
        name: input.name,
        kind: input.kind,
        openingBalance: input.openingBalance,
        openingDate: input.openingDate,
        archivedAt: input.archived ? now : null,
        createdAt: now,
        updatedAt: now,
      });
      await recordAudit(tx, actorOf(auth), {
        entity: 'financial_account',
        entityId: id,
        action: 'create',
        after: accountSnapshot(input),
      });
      return this.account(tx, auth, id);
    });
  }

  async updateAccount(
    auth: AuthContext,
    id: string,
    input: FinancialAccountInput,
  ): Promise<FinancialAccount> {
    return this.write(async (tx) => {
      const current = await this.lockAccount(tx, auth, id);
      await tx
        .update(financialAccounts)
        .set({
          name: input.name,
          kind: input.kind,
          openingBalance: input.openingBalance,
          openingDate: input.openingDate,
          archivedAt: input.archived ? (current.archivedAt ?? new Date()) : null,
          updatedAt: new Date(),
        })
        .where(eq(financialAccounts.id, id));
      await recordAudit(tx, actorOf(auth), {
        entity: 'financial_account',
        entityId: id,
        action: 'update',
        before: accountSnapshot({ ...current, archived: current.archivedAt !== null }),
        after: accountSnapshot(input),
      });
      return this.account(tx, auth, id);
    });
  }

  private async account(tx: Executor, auth: AuthContext, id: string) {
    const found = (await this.accountsWithBalance(auth, tx)).find((a) => a.id === id);
    if (!found) throw notFound('Conta');
    return found;
  }

  private async lockAccount(tx: Executor, auth: AuthContext, id: string): Promise<AccountRow> {
    const [row] = await tx
      .select()
      .from(financialAccounts)
      .where(
        and(
          eq(financialAccounts.id, id),
          eq(financialAccounts.organizationId, auth.organizationId),
        ),
      )
      .for('update');
    if (!row) throw notFound('Conta');
    return row;
  }

  // Plano de contas --------------------------------------------------------------------------------

  async listCategories(auth: AuthContext): Promise<FinancialCategory[]> {
    await this.ready(auth);
    const rows = await this.db
      .select()
      .from(financialCategories)
      .where(eq(financialCategories.organizationId, auth.organizationId))
      .orderBy(asc(financialCategories.kind));
    return rows
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
      .sort((a, b) => a.kind.localeCompare(b.kind))
      .map(toCategory);
  }

  async createCategory(
    auth: AuthContext,
    input: FinancialCategoryInput,
  ): Promise<FinancialCategory> {
    await this.ready(auth);
    return this.write(async (tx) => {
      await this.checkParent(tx, auth, input, null);
      const now = new Date();
      const [row] = await tx
        .insert(financialCategories)
        .values({
          id: newId(),
          organizationId: auth.organizationId,
          name: input.name,
          kind: input.kind,
          parentId: input.parentId,
          archivedAt: input.archived ? now : null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!row) throw notFound('Categoria');
      await recordAudit(tx, actorOf(auth), {
        entity: 'financial_category',
        entityId: row.id,
        action: 'create',
        after: categorySnapshot(row),
      });
      return toCategory(row);
    });
  }

  async updateCategory(
    auth: AuthContext,
    id: string,
    input: FinancialCategoryInput,
  ): Promise<FinancialCategory> {
    return this.write(async (tx) => {
      const [current] = await tx
        .select()
        .from(financialCategories)
        .where(
          and(
            eq(financialCategories.id, id),
            eq(financialCategories.organizationId, auth.organizationId),
          ),
        )
        .for('update');
      if (!current) throw notFound('Categoria');
      if (current.systemKey) {
        if (input.kind !== current.kind || input.parentId !== current.parentId) {
          throw conflict('Categoria usada pelas vendas não muda de tipo nem de lugar.');
        }
        if (input.archived) throw conflict('Categoria usada pelas vendas não pode ser arquivada.');
      }
      const children = await tx
        .select({ id: financialCategories.id })
        .from(financialCategories)
        .where(eq(financialCategories.parentId, id));
      if (children.length > 0 && input.parentId !== null) {
        throw invalid('parentId', 'Categoria com subcategorias não pode ser subcategoria');
      }
      if (input.kind !== current.kind) {
        if (children.length > 0) {
          throw conflict('Categoria com subcategorias não muda de tipo.');
        }
        const [used] = await tx
          .select({ id: financialEntries.id })
          .from(financialEntries)
          .where(eq(financialEntries.categoryId, id))
          .limit(1);
        if (used) throw conflict('Categoria com lançamentos não muda de tipo.');
      }
      await this.checkParent(tx, auth, input, id);
      const [row] = await tx
        .update(financialCategories)
        .set({
          name: input.name,
          kind: input.kind,
          parentId: input.parentId,
          archivedAt: input.archived ? (current.archivedAt ?? new Date()) : null,
          updatedAt: new Date(),
        })
        .where(eq(financialCategories.id, id))
        .returning();
      if (!row) throw notFound('Categoria');
      await recordAudit(tx, actorOf(auth), {
        entity: 'financial_category',
        entityId: id,
        action: 'update',
        before: categorySnapshot(current),
        after: categorySnapshot(row),
      });
      return toCategory(row);
    });
  }

  private async checkParent(
    tx: Executor,
    auth: AuthContext,
    input: FinancialCategoryInput,
    selfId: string | null,
  ) {
    if (!input.parentId) return;
    if (input.parentId === selfId) {
      throw invalid('parentId', 'A categoria não pode ser mãe de si mesma');
    }
    const [parent] = await tx
      .select()
      .from(financialCategories)
      .where(
        and(
          eq(financialCategories.id, input.parentId),
          eq(financialCategories.organizationId, auth.organizationId),
        ),
      );
    if (!parent) throw invalid('parentId', 'Categoria-mãe não encontrada');
    if (parent.parentId) throw invalid('parentId', 'Use uma categoria principal como mãe');
    if (parent.kind !== input.kind) {
      throw invalid(
        'parentId',
        `A categoria-mãe é de ${categoryKindLabels[parent.kind].toLowerCase()}`,
      );
    }
  }

  // Fornecedores -----------------------------------------------------------------------------------

  async listSuppliers(auth: AuthContext): Promise<Supplier[]> {
    const rows = await this.db
      .select()
      .from(suppliers)
      .where(eq(suppliers.organizationId, auth.organizationId))
      .orderBy(sql`${suppliers.archivedAt} is not null`, asc(suppliers.name));
    return rows.map(toSupplier);
  }

  async createSupplier(auth: AuthContext, input: SupplierInput): Promise<Supplier> {
    return this.write(async (tx) => {
      const now = new Date();
      const [row] = await tx
        .insert(suppliers)
        .values({
          id: newId(),
          organizationId: auth.organizationId,
          ...supplierFields(input),
          archivedAt: input.archived ? now : null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!row) throw notFound('Fornecedor');
      await recordAudit(tx, actorOf(auth), {
        entity: 'supplier',
        entityId: row.id,
        action: 'create',
        after: supplierSnapshot(row),
      });
      return toSupplier(row);
    });
  }

  async updateSupplier(auth: AuthContext, id: string, input: SupplierInput): Promise<Supplier> {
    return this.write(async (tx) => {
      const [current] = await tx
        .select()
        .from(suppliers)
        .where(and(eq(suppliers.id, id), eq(suppliers.organizationId, auth.organizationId)))
        .for('update');
      if (!current) throw notFound('Fornecedor');
      const [row] = await tx
        .update(suppliers)
        .set({
          ...supplierFields(input),
          archivedAt: input.archived ? (current.archivedAt ?? new Date()) : null,
          updatedAt: new Date(),
        })
        .where(eq(suppliers.id, id))
        .returning();
      if (!row) throw notFound('Fornecedor');
      await recordAudit(tx, actorOf(auth), {
        entity: 'supplier',
        entityId: id,
        action: 'update',
        before: supplierSnapshot(current),
        after: supplierSnapshot(row),
      });
      return toSupplier(row);
    });
  }

  // Lançamentos ------------------------------------------------------------------------------------

  async list(auth: AuthContext, query: EntryQuery): Promise<EntryList> {
    const today = await this.ready(auth);
    const situacao = query.situacao;
    const tipo = query.tipo;
    const page = query.page;
    const pageSize = query.pageSize;
    // Sem período, as listas de contas em aberto mostram tudo; o extrato mostra o mês corrente.
    const openList = situacao === 'abertos' || situacao === 'vencidos';
    let from: string | null = query.de ?? null;
    let to: string | null = query.ate ?? null;
    if (!from && !to && !openList) {
      from = `${today.slice(0, 7)}-01`;
      to = addDays(addMonths(from, 1), -1);
    }

    const base: SQL[] = [eq(financialEntries.organizationId, auth.organizationId)];
    if (query.conta) base.push(eq(financialEntries.accountId, query.conta));
    if (query.categoria) {
      base.push(
        sql`${financialEntries.categoryId} in (select ${financialCategories.id} from ${financialCategories}
          where ${financialCategories.id} = ${query.categoria} or ${financialCategories.parentId} = ${query.categoria})`,
      );
    }
    if (tipo !== 'todos') {
      base.push(
        eq(
          financialEntries.kind,
          tipo === 'receitas' ? 'income' : tipo === 'despesas' ? 'expense' : 'transfer',
        ),
      );
    }
    if (query.q) {
      const term = query.q;
      base.push(
        or(
          containsText(financialEntries.description, term),
          containsText(financialEntries.document, term),
          sql`exists (select 1 from ${suppliers} where ${suppliers.id} = ${financialEntries.supplierId}
            and ${containsText(suppliers.name, term)})`,
          sql`exists (select 1 from ${clients} where ${clients.id} = ${financialEntries.clientId}
            and ${containsText(clients.name, term)})`,
        ) as SQL,
      );
    }

    const filters = [...base];
    if (from) filters.push(gte(effectiveDate, from));
    if (to) filters.push(lte(effectiveDate, to));
    const status = {
      todos: ne(financialEntries.status, 'cancelled'),
      abertos: eq(financialEntries.status, 'open'),
      pagos: eq(financialEntries.status, 'paid'),
      vencidos: and(eq(financialEntries.status, 'open'), lt(financialEntries.dueDate, today)),
      cancelados: eq(financialEntries.status, 'cancelled'),
    }[situacao];
    if (status) filters.push(status);
    const where = and(...filters);

    const [summary] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        income: sql<string>`coalesce(sum(case when ${financialEntries.kind} = 'income'
          and ${financialEntries.status} <> 'cancelled'
          then coalesce(${financialEntries.paidAmount}, ${financialEntries.amount}) end), 0)`,
        expense: sql<string>`coalesce(sum(case when ${financialEntries.kind} = 'expense'
          and ${financialEntries.status} <> 'cancelled'
          then coalesce(${financialEntries.paidAmount}, ${financialEntries.amount}) end), 0)`,
      })
      .from(financialEntries)
      .where(where);

    const rows = await selectEntries(this.db)
      .where(where)
      .orderBy(
        asc(effectiveDate),
        asc(financialEntries.createdAt),
        asc(financialEntries.installmentNumber),
        asc(financialEntries.id),
      )
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    // Saldo do extrato: só com uma conta e sem filtros que escondam lançamentos pagos.
    let openingBalance: number | null = null;
    const running = new Map<string, number>();
    if (query.conta && from) {
      const [account] = await this.db
        .select()
        .from(financialAccounts)
        .where(
          and(
            eq(financialAccounts.id, query.conta),
            eq(financialAccounts.organizationId, auth.organizationId),
          ),
        );
      if (account) {
        const [before] = await this.db
          .select({ sum: sql<string>`coalesce(sum(${signedPaid}), 0)` })
          .from(financialEntries)
          .where(
            and(eq(financialEntries.accountId, account.id), lt(financialEntries.paidOn, from)),
          );
        const openingCents = toCents(account.openingBalance) + toCents(Number(before?.sum ?? 0));
        openingBalance = fromCents(openingCents);
        const complete =
          !query.categoria && !query.q && tipo === 'todos' && ['todos', 'pagos'].includes(situacao);
        const ids = rows.filter((r) => r.entry.status === 'paid').map((r) => r.entry.id);
        if (complete && ids.length) {
          const window = this.db
            .select({
              id: financialEntries.id,
              run: sql<string>`sum(${signedPaid}) over (order by ${effectiveDate},
                ${financialEntries.createdAt}, ${financialEntries.installmentNumber},
                ${financialEntries.id})`.as('run'),
            })
            .from(financialEntries)
            .where(
              and(
                eq(financialEntries.accountId, account.id),
                ne(financialEntries.status, 'cancelled'),
                gte(effectiveDate, from),
                ...(to ? [lte(effectiveDate, to)] : []),
              ),
            )
            .as('w');
          const runs = await this.db.select().from(window).where(inArray(window.id, ids));
          for (const r of runs) running.set(r.id, fromCents(openingCents + toCents(Number(r.run))));
        }
      }
    }

    const pendingRows = await this.db
      .select({
        overdueCount: sql<number>`count(*) filter (where ${financialEntries.dueDate} < ${today})::int`,
        overdueAmount: sql<string>`coalesce(sum(${financialEntries.amount}) filter (where ${financialEntries.dueDate} < ${today}), 0)`,
        nextCount: sql<number>`count(*) filter (where ${financialEntries.dueDate} between ${today} and ${addDays(today, 7)})::int`,
        nextAmount: sql<string>`coalesce(sum(${financialEntries.amount}) filter (where ${financialEntries.dueDate} between ${today} and ${addDays(today, 7)}), 0)`,
      })
      .from(financialEntries)
      .where(and(...base, eq(financialEntries.status, 'open')));
    const pending = pendingRows[0];

    return {
      items: rows.map((r) => ({
        ...this.toEntry(r, today),
        runningBalance: running.get(r.entry.id) ?? null,
      })),
      total: summary?.total ?? 0,
      page,
      pageSize,
      from,
      to,
      totals: { income: Number(summary?.income ?? 0), expense: Number(summary?.expense ?? 0) },
      openingBalance,
      pending: {
        overdue: {
          count: pending?.overdueCount ?? 0,
          amount: Number(pending?.overdueAmount ?? 0),
        },
        next7: { count: pending?.nextCount ?? 0, amount: Number(pending?.nextAmount ?? 0) },
      },
    };
  }

  async get(auth: AuthContext, id: string, db: Executor = this.db): Promise<Entry> {
    const [row] = await selectEntries(db).where(
      and(eq(financialEntries.id, id), eq(financialEntries.organizationId, auth.organizationId)),
    );
    if (!row) throw notFound('Lançamento');
    return this.toEntry(row, await this.today(db, auth));
  }

  private toEntry(r: EntryJoinRow, today: string): Entry {
    const e = r.entry;
    return {
      id: e.id,
      kind: e.kind,
      direction: e.direction,
      origin: e.origin,
      status: e.status,
      description: e.description,
      document: e.document,
      account: r.account,
      category: r.category,
      supplier: r.supplier,
      client: r.client,
      costCenter: r.costCenter,
      sale: r.sale,
      purchase: r.purchase,
      counterpart: r.counterpart,
      installment:
        e.installmentNumber !== null && e.installmentTotal !== null
          ? { number: e.installmentNumber, total: e.installmentTotal }
          : null,
      amount: e.amount,
      paidAmount: e.paidAmount,
      dueDate: e.dueDate,
      competenceDate: e.competenceDate,
      paidOn: e.paidOn,
      overdue: e.status === 'open' && e.dueDate < today,
      notes: e.notes,
      cancelReason: e.cancelReason,
      runningBalance: null,
    };
  }

  async create(auth: AuthContext, input: EntryInput): Promise<Entry[]> {
    const today = await this.ready(auth);
    return this.db.transaction(async (tx) => {
      const refs = await this.checkRefs(tx, auth, input, null);
      if (input.paidOn && input.paidOn > today) {
        throw invalid('paidOn', 'O pagamento não pode ser no futuro');
      }
      const count = input.repeat === 'none' ? 1 : input.count;
      const cents = toCents(input.amount);
      const amounts =
        input.repeat === 'installments'
          ? splitInstallments(cents, count)
          : Array.from({ length: count }, () => cents);
      const groupId = count > 1 ? newId() : null;
      const competence = input.competenceDate ?? input.dueDate;
      const now = new Date();
      const rows = amounts.map((c, i) => ({
        id: newId(),
        organizationId: auth.organizationId,
        unitId: auth.unitId,
        kind: input.kind,
        direction: input.kind === 'income' ? ('in' as const) : ('out' as const),
        origin: 'manual' as const,
        status: i === 0 && input.paidOn ? ('paid' as const) : ('open' as const),
        description: input.description,
        document: input.document,
        accountId: input.accountId,
        categoryId: input.categoryId,
        supplierId: input.supplierId,
        costCenterId: refs.costCenterId,
        groupId,
        installmentNumber: groupId ? i + 1 : null,
        installmentTotal: groupId ? count : null,
        amount: fromCents(c),
        paidAmount: i === 0 && input.paidOn ? fromCents(c) : null,
        dueDate: addMonths(input.dueDate, i),
        // Parcelas de uma compra pertencem ao mês da compra; repetições, cada uma ao seu mês.
        competenceDate: input.repeat === 'monthly' ? addMonths(competence, i) : competence,
        paidOn: i === 0 ? input.paidOn : null,
        paidBy: i === 0 && input.paidOn ? auth.userId : null,
        notes: input.notes,
        createdBy: auth.userId,
        createdAt: now,
        updatedAt: now,
      }));
      await tx.insert(financialEntries).values(rows);
      await recordAudit(tx, actorOf(auth), {
        entity: 'financial_entry',
        entityId: rows[0]?.id ?? '',
        action: 'create',
        after: {
          description: input.description,
          kind: categoryKindLabels[input.kind],
          amount: brl(input.amount),
          ...(count > 1
            ? {
                repeat:
                  input.repeat === 'installments'
                    ? `${String(count)} parcelas`
                    : `${String(count)} meses`,
              }
            : {}),
          dueDate: br(input.dueDate),
          account: refs.account.name,
          category: refs.category.name,
          ...(input.paidOn ? { paidOn: br(input.paidOn) } : {}),
        },
      });
      const created: Entry[] = [];
      for (const r of rows) created.push(await this.get(auth, r.id, tx));
      return created;
    });
  }

  async update(auth: AuthContext, id: string, input: EntryUpdate): Promise<Entry> {
    return this.db.transaction(async (tx) => {
      const current = await this.lock(tx, auth, id);
      if (current.origin !== 'manual') {
        throw conflict(
          current.origin === 'transfer'
            ? 'Transferência não se edita: cancele e lance de novo.'
            : current.origin === 'purchase'
              ? 'Parcela de compra acompanha a compra e não se edita aqui.'
              : 'Lançamento de venda acompanha a venda e não se edita aqui.',
        );
      }
      if (current.status === 'paid') {
        throw conflict('Reabra o lançamento pago antes de editar.');
      }
      if (current.status === 'cancelled') throw conflict('Lançamento cancelado não muda.');
      const kind = current.kind === 'income' ? 'income' : 'expense';
      const before = await this.get(auth, id, tx);
      const refs = await this.checkRefs(tx, auth, { ...input, kind }, current);
      await tx
        .update(financialEntries)
        .set({
          description: input.description,
          document: input.document,
          accountId: input.accountId,
          categoryId: input.categoryId,
          supplierId: input.supplierId,
          costCenterId: refs.costCenterId,
          amount: input.amount,
          dueDate: input.dueDate,
          competenceDate: input.competenceDate,
          notes: input.notes,
          updatedAt: new Date(),
        })
        .where(eq(financialEntries.id, id));
      const after = await this.get(auth, id, tx);
      await recordAudit(tx, actorOf(auth), {
        entity: 'financial_entry',
        entityId: id,
        action: 'update',
        before: entrySnapshot(before),
        after: entrySnapshot(after),
      });
      return after;
    });
  }

  async pay(auth: AuthContext, id: string, input: PayEntryInput): Promise<Entry> {
    return this.db.transaction(async (tx) => {
      const current = await this.lock(tx, auth, id);
      if (current.status !== 'open') {
        throw conflict(
          current.status === 'paid' ? 'Lançamento já está pago.' : 'Lançamento cancelado não muda.',
        );
      }
      const today = await this.today(tx, auth);
      if (input.paidOn > today) throw invalid('paidOn', 'O pagamento não pode ser no futuro');
      const account = await this.activeAccount(tx, auth, input.accountId, current.accountId);
      await tx
        .update(financialEntries)
        .set({
          status: 'paid',
          paidOn: input.paidOn,
          paidAmount: input.amount,
          accountId: account.id,
          paidBy: auth.userId,
          updatedAt: new Date(),
        })
        .where(eq(financialEntries.id, id));
      await recordAudit(tx, actorOf(auth), {
        entity: 'financial_entry',
        entityId: id,
        action: 'pay',
        before: { description: current.description, status: entryStatusLabels.open },
        after: {
          description: current.description,
          status: entryStatusLabels.paid,
          paidOn: br(input.paidOn),
          paidAmount: brl(input.amount),
          account: account.name,
        },
      });
      return this.get(auth, id, tx);
    });
  }

  /** Desfaz a baixa (pagamento lançado por engano). */
  async reopen(auth: AuthContext, id: string): Promise<Entry> {
    return this.db.transaction(async (tx) => {
      const current = await this.lock(tx, auth, id);
      if (current.kind === 'transfer') {
        throw conflict('Transferência não se reabre: cancele e lance de novo.');
      }
      if (current.status !== 'paid') throw conflict('Só lançamento pago pode ser reaberto.');
      if (current.cardSettlementId) {
        throw conflict('Lançamento conciliado: desfaça a conciliação do depósito.');
      }
      await tx
        .update(financialEntries)
        .set({
          status: 'open',
          paidOn: null,
          paidAmount: null,
          paidBy: null,
          updatedAt: new Date(),
        })
        .where(eq(financialEntries.id, id));
      await recordAudit(tx, actorOf(auth), {
        entity: 'financial_entry',
        entityId: id,
        action: 'reopen',
        before: {
          description: current.description,
          status: entryStatusLabels.paid,
          paidOn: current.paidOn ? br(current.paidOn) : null,
          paidAmount: current.paidAmount === null ? null : brl(current.paidAmount),
        },
        after: { description: current.description, status: entryStatusLabels.open },
      });
      return this.get(auth, id, tx);
    });
  }

  async cancel(auth: AuthContext, id: string, input: CancelEntryInput): Promise<Entry> {
    return this.db.transaction(async (tx) => {
      const current = await this.lock(tx, auth, id);
      if (current.origin === 'card_adjustment') {
        throw conflict('Ajuste de conciliação: desfaça a conciliação do depósito para cancelar.');
      }
      if (current.origin === 'sale' || current.origin === 'card_fee') {
        throw conflict('Lançamento de venda acompanha a venda: estorne a venda para cancelar.');
      }
      if (current.origin === 'purchase') {
        throw conflict('Parcela de compra acompanha a compra: cancele a compra para cancelar.');
      }
      if (current.status === 'cancelled') throw conflict('Lançamento já está cancelado.');
      const ids = [id];
      if (current.transferId) {
        const other = await tx
          .select({ id: financialEntries.id })
          .from(financialEntries)
          .where(
            and(eq(financialEntries.transferId, current.transferId), ne(financialEntries.id, id)),
          );
        ids.push(...other.map((o) => o.id));
      } else if (input.following && current.groupId && current.installmentNumber) {
        const next = await tx
          .select({ id: financialEntries.id })
          .from(financialEntries)
          .where(
            and(
              eq(financialEntries.groupId, current.groupId),
              gt(financialEntries.installmentNumber, current.installmentNumber),
              eq(financialEntries.status, 'open'),
            ),
          );
        ids.push(...next.map((o) => o.id));
      }
      await tx
        .update(financialEntries)
        .set({
          status: 'cancelled',
          cancelReason: input.reason,
          cancelledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(inArray(financialEntries.id, ids));
      await recordAudit(tx, actorOf(auth), {
        entity: 'financial_entry',
        entityId: id,
        action: 'cancel',
        before: { description: current.description, status: entryStatusLabels[current.status] },
        after: {
          description: current.description,
          status: entryStatusLabels.cancelled,
          reason: input.reason,
          ...(ids.length > 1 && !current.transferId
            ? { following: `mais ${String(ids.length - 1)} parcela(s)` }
            : {}),
        },
      });
      return this.get(auth, id, tx);
    });
  }

  async transfer(auth: AuthContext, input: TransferInput): Promise<Entry[]> {
    const today = await this.ready(auth);
    return this.db.transaction(async (tx) => {
      if (input.date > today) throw invalid('date', 'A transferência não pode ser no futuro');
      const fromAccount = await this.activeAccount(
        tx,
        auth,
        input.fromAccountId,
        null,
        'fromAccountId',
      );
      const toAccount = await this.activeAccount(tx, auth, input.toAccountId, null, 'toAccountId');
      const transferId = newId();
      const description =
        input.description || `Transferência de ${fromAccount.name} para ${toAccount.name}`;
      const now = new Date();
      const common = {
        organizationId: auth.organizationId,
        unitId: auth.unitId,
        kind: 'transfer' as const,
        origin: 'transfer' as const,
        status: 'paid' as const,
        description,
        transferId,
        amount: input.amount,
        paidAmount: input.amount,
        dueDate: input.date,
        competenceDate: input.date,
        paidOn: input.date,
        paidBy: auth.userId,
        createdBy: auth.userId,
        createdAt: now,
        updatedAt: now,
      };
      const outId = newId();
      const inId = newId();
      await tx.insert(financialEntries).values([
        { ...common, id: outId, direction: 'out', accountId: fromAccount.id },
        { ...common, id: inId, direction: 'in', accountId: toAccount.id },
      ]);
      await recordAudit(tx, actorOf(auth), {
        entity: 'financial_entry',
        entityId: outId,
        action: 'transfer',
        after: {
          description,
          amount: brl(input.amount),
          from: fromAccount.name,
          to: toAccount.name,
          date: br(input.date),
        },
      });
      return [await this.get(auth, outId, tx), await this.get(auth, inId, tx)];
    });
  }

  // Integração com as vendas -----------------------------------------------------------------------

  /**
   * Lança cada parcela recebida de uma venda como receita e a taxa como despesa [RN-35]. Dinheiro
   * vai para a conta de dinheiro; o resto, para a conta bancária. O que vence até hoje (dinheiro,
   * PIX, débito na hora) já nasce pago; cartão fica em aberto até a liquidação.
   */
  async recordSaleReceipt(
    tx: Executor,
    auth: AuthContext,
    sale: SaleRow,
    payment: {
      kind: string;
      methodName: string;
      installments: number;
      accountId: string | null;
    },
    receivables: {
      id: string;
      number: number;
      dueDate: string;
      amount: number;
      feeAmount: number;
    }[],
    today: string,
    timeZone: string,
  ): Promise<void> {
    await this.ensure(tx, auth.organizationId, today);
    const accounts = await tx
      .select()
      .from(financialAccounts)
      .where(eq(financialAccounts.organizationId, auth.organizationId))
      .orderBy(
        sql`${financialAccounts.archivedAt} is not null`,
        asc(financialAccounts.createdAt),
        asc(financialAccounts.id),
      );
    const wanted = payment.kind === 'cash' ? 'cash' : 'bank';
    const account =
      accounts.find((a) => a.id === payment.accountId && a.archivedAt === null) ??
      accounts.find((a) => a.kind === wanted && a.archivedAt === null) ??
      accounts.find((a) => a.archivedAt === null) ??
      accounts[0];
    if (!account) throw conflict('Cadastre uma conta financeira antes de receber vendas.');
    const system = await tx
      .select({ id: financialCategories.id, key: financialCategories.systemKey })
      .from(financialCategories)
      .where(
        and(
          eq(financialCategories.organizationId, auth.organizationId),
          inArray(financialCategories.systemKey, ['sales', 'card_fees']),
        ),
      );
    const salesCategory = system.find((s) => s.key === 'sales')?.id;
    const feesCategory = system.find((s) => s.key === 'card_fees')?.id;
    if (!salesCategory || !feesCategory) throw notFound('Categoria de vendas');
    const [client] = sale.clientId
      ? await tx.select({ name: clients.name }).from(clients).where(eq(clients.id, sale.clientId))
      : [];
    const costCenterId = sale.costCenterId ?? (await this.defaultCostCenter(tx, sale.unitId));
    const competence = instantToZoned(sale.soldAt ?? new Date(), timeZone).date;
    const who = client?.name ?? 'Ao consumidor';
    const now = new Date();
    const many = payment.installments > 1;
    const rows: (typeof financialEntries.$inferInsert)[] = [];
    for (const r of receivables) {
      // Cartão e convênio só ficam pagos na conciliação, quando o depósito cai [RN-37].
      const paid = !acquirerKinds.includes(payment.kind as PaymentKind) && r.dueDate <= today;
      const common = {
        organizationId: auth.organizationId,
        unitId: sale.unitId,
        status: paid ? ('paid' as const) : ('open' as const),
        accountId: account.id,
        clientId: sale.clientId,
        costCenterId,
        saleId: sale.id,
        saleReceivableId: r.id,
        installmentNumber: many ? r.number : null,
        installmentTotal: many ? payment.installments : null,
        dueDate: r.dueDate,
        competenceDate: competence,
        paidOn: paid ? today : null,
        paidBy: paid ? auth.userId : null,
        createdBy: auth.userId,
        createdAt: now,
        updatedAt: now,
      };
      rows.push({
        ...common,
        id: newId(),
        kind: 'income',
        direction: 'in',
        origin: 'sale',
        description: `Venda ${String(sale.code)} - ${who} - ${payment.methodName}`,
        categoryId: salesCategory,
        amount: r.amount,
        paidAmount: paid ? r.amount : null,
      });
      if (r.feeAmount > 0) {
        rows.push({
          ...common,
          id: newId(),
          kind: 'expense',
          direction: 'out',
          origin: 'card_fee',
          description: `Taxa ${payment.methodName} - venda ${String(sale.code)}`,
          categoryId: feesCategory,
          amount: r.feeAmount,
          paidAmount: paid ? r.feeAmount : null,
        });
      }
    }
    if (rows.length) await tx.insert(financialEntries).values(rows);
  }

  /** Estorno da venda cancela as receitas e taxas que ela lançou, guardando o motivo. */
  async cancelSaleEntries(tx: Executor, saleId: string, code: number, reason: string) {
    const [reconciled] = await tx
      .select({ id: financialEntries.id })
      .from(financialEntries)
      .where(and(eq(financialEntries.saleId, saleId), isNotNull(financialEntries.cardSettlementId)))
      .limit(1);
    if (reconciled) {
      throw conflict(
        'O cartão desta venda já foi conciliado: desfaça a conciliação do depósito antes de estornar.',
      );
    }
    await tx
      .update(financialEntries)
      .set({
        status: 'cancelled',
        cancelReason: `Estorno da venda ${String(code)}: ${reason}`,
        cancelledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(financialEntries.saleId, saleId), ne(financialEntries.status, 'cancelled')));
  }

  /**
   * Parcelas a pagar da compra confirmada [p.17]: uma despesa por parcela, no fornecedor, na
   * categoria e na conta escolhidas, com competência na emissão da nota.
   */
  async recordPurchase(
    tx: Executor,
    auth: AuthContext,
    purchase: {
      id: string;
      unitId: string;
      code: number;
      supplierId: string;
      supplierName: string;
      invoiceNumber: string;
      accountId: string;
      categoryId: string;
      competenceDate: string;
    },
    installments: { number: number; dueDate: string; amount: number }[],
    today: string,
  ): Promise<void> {
    await this.ensure(tx, auth.organizationId, today);
    const costCenterId = await this.defaultCostCenter(tx, purchase.unitId);
    const many = installments.length > 1;
    const groupId = many ? newId() : null;
    const now = new Date();
    const nf = purchase.invoiceNumber ? ` - NF ${purchase.invoiceNumber}` : '';
    await tx.insert(financialEntries).values(
      installments.map((i) => ({
        id: newId(),
        organizationId: auth.organizationId,
        unitId: purchase.unitId,
        kind: 'expense' as const,
        direction: 'out' as const,
        origin: 'purchase' as const,
        status: 'open' as const,
        description: `Compra ${String(purchase.code)} - ${purchase.supplierName}${nf}`,
        document: purchase.invoiceNumber,
        accountId: purchase.accountId,
        categoryId: purchase.categoryId,
        supplierId: purchase.supplierId,
        costCenterId,
        purchaseId: purchase.id,
        groupId,
        installmentNumber: many ? i.number : null,
        installmentTotal: many ? installments.length : null,
        amount: i.amount,
        dueDate: i.dueDate,
        competenceDate: purchase.competenceDate,
        notes: '',
        createdBy: auth.userId,
        createdAt: now,
        updatedAt: now,
      })),
    );
  }

  /** Cancelar a compra cancela as parcelas; parcela já paga precisa ser reaberta antes. */
  async cancelPurchaseEntries(tx: Executor, purchaseId: string, code: number, reason: string) {
    const rows = await tx
      .select({ id: financialEntries.id, status: financialEntries.status })
      .from(financialEntries)
      .where(eq(financialEntries.purchaseId, purchaseId))
      .for('update');
    if (rows.some((r) => r.status === 'paid')) {
      throw conflict(
        'Há parcela desta compra já paga: desfaça a baixa no financeiro antes de cancelar a compra.',
      );
    }
    await tx
      .update(financialEntries)
      .set({
        status: 'cancelled',
        cancelReason: `Cancelamento da compra ${String(code)}: ${reason}`,
        cancelledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(eq(financialEntries.purchaseId, purchaseId), ne(financialEntries.status, 'cancelled')),
      );
  }

  // Apoio ------------------------------------------------------------------------------------------

  private async lock(tx: Executor, auth: AuthContext, id: string): Promise<EntryRow> {
    const [row] = await tx
      .select()
      .from(financialEntries)
      .where(
        and(eq(financialEntries.id, id), eq(financialEntries.organizationId, auth.organizationId)),
      )
      .for('update');
    if (!row) throw notFound('Lançamento');
    return row;
  }

  private async defaultCostCenter(tx: Executor, unitId: string): Promise<string | null> {
    const [center] = await tx
      .select({ id: costCenters.id })
      .from(costCenters)
      .where(and(eq(costCenters.unitId, unitId), eq(costCenters.isDefault, true)));
    return center?.id ?? null;
  }

  /** Conta ativa da organização; a conta atual do lançamento vale mesmo se arquivada depois. */
  private async activeAccount(
    tx: Executor,
    auth: AuthContext,
    id: string,
    keep: string | null,
    path = 'accountId',
  ): Promise<AccountRow> {
    const [account] = await tx
      .select()
      .from(financialAccounts)
      .where(
        and(
          eq(financialAccounts.id, id),
          eq(financialAccounts.organizationId, auth.organizationId),
        ),
      );
    if (!account || (account.archivedAt && account.id !== keep)) {
      throw invalid(path, 'Conta indisponível');
    }
    return account;
  }

  private async checkRefs(
    tx: Executor,
    auth: AuthContext,
    input: {
      kind: 'income' | 'expense';
      accountId: string;
      categoryId: string;
      supplierId: string | null;
      costCenterId: string | null;
    },
    current: EntryRow | null,
  ) {
    const account = await this.activeAccount(tx, auth, input.accountId, current?.accountId ?? null);
    const [category] = await tx
      .select()
      .from(financialCategories)
      .where(
        and(
          eq(financialCategories.id, input.categoryId),
          eq(financialCategories.organizationId, auth.organizationId),
        ),
      );
    if (!category || (category.archivedAt && category.id !== current?.categoryId)) {
      throw invalid('categoryId', 'Categoria indisponível');
    }
    if (category.kind !== input.kind) {
      throw invalid(
        'categoryId',
        input.kind === 'income'
          ? 'Escolha uma categoria de receita'
          : 'Escolha uma categoria de despesa',
      );
    }
    if (input.supplierId) {
      const [supplier] = await tx
        .select()
        .from(suppliers)
        .where(
          and(
            eq(suppliers.id, input.supplierId),
            eq(suppliers.organizationId, auth.organizationId),
          ),
        );
      if (!supplier || (supplier.archivedAt && supplier.id !== current?.supplierId)) {
        throw invalid('supplierId', 'Fornecedor indisponível');
      }
    }
    let costCenterId = input.costCenterId;
    if (costCenterId) {
      const [center] = await tx
        .select()
        .from(costCenters)
        .where(
          and(
            eq(costCenters.id, costCenterId),
            eq(costCenters.organizationId, auth.organizationId),
          ),
        );
      if (!center || (center.archivedAt && center.id !== current?.costCenterId)) {
        throw invalid('costCenterId', 'Centro de custo indisponível');
      }
    } else {
      costCenterId = await this.defaultCostCenter(tx, auth.unitId);
    }
    return { account, category, costCenterId };
  }

  private async write<T>(work: (tx: Executor) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(work);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const constraint = violatedConstraint(error);
        throw conflict(
          constraint === 'financial_accounts_org_name_uq'
            ? 'Já existe uma conta com este nome.'
            : constraint === 'financial_categories_org_name_uq'
              ? 'Já existe uma categoria com este nome neste lugar do plano de contas.'
              : constraint === 'suppliers_org_document_uq'
                ? 'Já existe um fornecedor com este CPF ou CNPJ.'
                : 'Já existe um fornecedor com este nome.',
        );
      }
      throw error;
    }
  }
}

function supplierFields(input: SupplierInput) {
  return {
    name: input.name,
    document: input.document,
    phone: input.phone,
    email: input.email,
    notes: input.notes,
  };
}

const accountSnapshot = (a: {
  name: string;
  kind: FinancialAccount['kind'];
  openingBalance: number;
  openingDate: string;
  archived?: boolean | undefined;
}) => ({
  name: a.name,
  kind: financialAccountKindLabels[a.kind],
  openingBalance: brl(a.openingBalance),
  openingDate: br(a.openingDate),
  archived: a.archived ?? false,
});

const categorySnapshot = (c: CategoryRow) => ({
  name: c.name,
  kind: categoryKindLabels[c.kind],
  parentId: c.parentId,
  archived: c.archivedAt !== null,
});

const supplierSnapshot = (s: SupplierRow) => ({
  name: s.name,
  document: s.document,
  phone: s.phone,
  email: s.email,
  archived: s.archivedAt !== null,
});

const entrySnapshot = (e: Entry) => ({
  description: e.description,
  document: e.document,
  account: e.account.name,
  category: e.category?.name ?? null,
  supplier: e.supplier?.name ?? null,
  costCenter: e.costCenter?.name ?? null,
  amount: brl(e.amount),
  dueDate: br(e.dueDate),
  competenceDate: br(e.competenceDate),
  notes: e.notes,
});
