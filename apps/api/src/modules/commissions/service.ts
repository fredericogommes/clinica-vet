import {
  commissionStatementStatusLabels,
  fromCents,
  toCents,
  type CommissionBase,
  type CommissionLineKind,
  type CommissionOpen,
  type CommissionSettings,
  type CommissionSettingsInput,
  type CommissionStaffInput,
  type CommissionStatement,
  type CommissionStatementClose,
  type CommissionStatementCreate,
  type CommissionStatementList,
  type CommissionStatementPay,
  type CommissionStatementQuery,
  type CommissionStatementRefresh,
  type CommissionStatementReview,
  type MyCommissions,
} from '@clinica/contracts';
import { and, asc, count, desc, eq, inArray, isNotNull, ne, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { actorOf } from '../../core/actor.js';
import { recordAudit } from '../../core/audit.js';
import { nextCounter } from '../../core/counters.js';
import { AppError, conflict, forbidden, notFound } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import { instantToZoned } from '../../core/zoned-time.js';
import type { Database, Executor } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import {
  clients,
  commissionSettings,
  commissionStatementLines,
  commissionStatements,
  financialEntries,
  roles,
  saleItems,
  sales,
  users,
  userUnits,
} from '../../db/schema.js';
import type { AuthContext } from '../auth/sessions.js';
import type { FinanceService } from '../finance/service.js';
import { unitTimeZone } from '../scheduling/availability.js';

const invalid = (path: string, message: string) =>
  new AppError('validation_failed', `${message}.`, [{ path, message }]);

const brl = (value: number) =>
  `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const br = (iso: string) => iso.split('-').reverse().join('/');
const pct = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

type Settings = Omit<typeof commissionSettings.$inferSelect, 'organizationId' | 'updatedAt'>;
type StatementRow = typeof commissionStatements.$inferSelect;

const DEFAULTS: Settings = {
  base: 'net',
  criterion: 'sold',
  financeIntegration: true,
  staffCanSeeOwn: true,
};

/** Comissão de uma venda para um profissional que ainda não entrou em extrato (ou mudou depois). */
export interface PendingLine {
  userId: string;
  saleId: string;
  kind: CommissionLineKind;
  base: CommissionBase;
  baseAmount: number;
  amount: number;
  description: string;
}

/**
 * Comissionamento [p.10–11, RN-38, RN-39]. A comissão de cada venda sai dos itens (percentual
 * copiado na venda e profissional do item) e é sempre recalculada aqui; o extrato guarda o que já
 * foi comissionado, e qualquer mudança posterior na venda vira ajuste no extrato seguinte.
 */
export class CommissionsService {
  constructor(
    private readonly db: Database,
    private readonly finance: FinanceService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // Configuração -----------------------------------------------------------------------------------

  private async rules(db: Executor, organizationId: string): Promise<Settings> {
    const [row] = await db
      .select()
      .from(commissionSettings)
      .where(eq(commissionSettings.organizationId, organizationId));
    return row
      ? {
          base: row.base,
          criterion: row.criterion,
          financeIntegration: row.financeIntegration,
          staffCanSeeOwn: row.staffCanSeeOwn,
        }
      : DEFAULTS;
  }

  async settings(auth: AuthContext, db: Executor = this.db): Promise<CommissionSettings> {
    const [rules, staff] = await Promise.all([
      this.rules(db, auth.organizationId),
      db
        .select({
          id: users.id,
          name: users.name,
          role: roles.name,
          since: users.commissionSince,
        })
        .from(users)
        .innerJoin(roles, eq(roles.id, users.roleId))
        .where(and(eq(users.organizationId, auth.organizationId), eq(users.active, true)))
        .orderBy(asc(users.name)),
    ]);
    return { ...rules, staff };
  }

  async updateSettings(
    auth: AuthContext,
    input: CommissionSettingsInput,
  ): Promise<CommissionSettings> {
    return this.db.transaction(async (tx) => {
      const before = await this.rules(tx, auth.organizationId);
      await tx
        .insert(commissionSettings)
        .values({ organizationId: auth.organizationId, ...input })
        .onConflictDoUpdate({
          target: commissionSettings.organizationId,
          set: { ...input, updatedAt: new Date() },
        });
      await recordAudit(tx, actorOf(auth), {
        entity: 'commission_settings',
        entityId: auth.organizationId,
        action: 'update',
        before,
        after: input,
      });
      return this.settings(auth, tx);
    });
  }

  /** Liga ou desliga a comissão de alguém; ligada, vale para as vendas a partir de hoje. */
  async setStaff(
    auth: AuthContext,
    userId: string,
    input: CommissionStaffInput,
  ): Promise<CommissionSettings> {
    return this.db.transaction(async (tx) => {
      const [user] = await tx
        .select({ id: users.id, name: users.name, since: users.commissionSince })
        .from(users)
        .where(and(eq(users.id, userId), eq(users.organizationId, auth.organizationId)))
        .for('update');
      if (!user) throw notFound('Usuário');
      if (input.commissioned === (user.since !== null)) return this.settings(auth, tx);
      const since = input.commissioned ? await this.today(tx, auth.unitId) : null;
      await tx
        .update(users)
        .set({ commissionSince: since, updatedAt: new Date() })
        .where(eq(users.id, userId));
      await recordAudit(tx, actorOf(auth), {
        entity: 'user',
        entityId: userId,
        action: 'commission',
        before: { name: user.name, commissionSince: user.since && br(user.since) },
        after: { name: user.name, commissionSince: since && br(since) },
      });
      return this.settings(auth, tx);
    });
  }

  // Cálculo ----------------------------------------------------------------------------------------

  private async today(db: Executor, unitId: string): Promise<string> {
    return instantToZoned(this.now(), await unitTimeZone(db, unitId)).date;
  }

  private async cutoffOf(db: Executor, unitId: string, cutoff: string | undefined) {
    const today = await this.today(db, unitId);
    if (cutoff && cutoff > today) throw invalid('cutoff', 'A data de corte não pode ser futura');
    return { cutoff: cutoff ?? today, today };
  }

  /**
   * O que falta comissionar até a data de corte, por venda e profissional: a comissão atual da
   * venda menos o que já entrou nos extratos (fora o extrato `except`, que está sendo refeito).
   */
  async pending(
    db: Executor,
    organizationId: string,
    unitId: string,
    cutoff: string,
    opts: { userIds?: string[]; except?: string } = {},
  ): Promise<PendingLine[]> {
    const rules = await this.rules(db, organizationId);
    const timeZone = await unitTimeZone(db, unitId);
    const soldOn = sql`(${sales.soldAt} at time zone ${timeZone})::date`;
    const userFilter: SQL[] = [
      eq(users.organizationId, organizationId),
      isNotNull(users.commissionSince),
    ];
    if (opts.userIds) userFilter.push(inArray(users.id, opts.userIds));
    const items = await db
      .select({
        saleId: sales.id,
        status: sales.status,
        soldAt: sales.soldAt,
        closedAt: sales.closedAt,
        cancelledAt: sales.cancelledAt,
        userId: saleItems.professionalId,
        name: saleItems.name,
        percent: saleItems.commissionPercent,
        grossTotal: saleItems.grossTotal,
        netTotal: saleItems.netTotal,
      })
      .from(saleItems)
      .innerJoin(sales, eq(sales.id, saleItems.saleId))
      .innerJoin(users, eq(users.id, saleItems.professionalId))
      .where(
        and(
          ...userFilter,
          eq(sales.unitId, unitId),
          isNotNull(sales.soldAt),
          sql`${soldOn} >= ${users.commissionSince}`,
          sql`${soldOn} <= ${cutoff}`,
        ),
      )
      .orderBy(asc(sales.soldAt), asc(saleItems.position));
    const includedFilter: SQL[] = [eq(commissionStatements.unitId, unitId)];
    if (opts.except) includedFilter.push(ne(commissionStatements.id, opts.except));
    if (opts.userIds) includedFilter.push(inArray(commissionStatements.userId, opts.userIds));
    const included = await db
      .select({
        saleId: commissionStatementLines.saleId,
        userId: commissionStatements.userId,
        amount: sql<string>`sum(${commissionStatementLines.amount})`,
        base: sql<CommissionBase>`(array_agg(${commissionStatementLines.base} order by ${commissionStatements.createdAt}))[1]`,
      })
      .from(commissionStatementLines)
      .innerJoin(
        commissionStatements,
        eq(commissionStatements.id, commissionStatementLines.statementId),
      )
      .where(and(...includedFilter))
      .groupBy(commissionStatementLines.saleId, commissionStatements.userId);
    const key = (saleId: string, userId: string) => `${saleId}:${userId}`;
    const done = new Map(included.map((i) => [key(i.saleId, i.userId), i]));
    const groups = new Map<string, typeof items>();
    for (const item of items) {
      const k = key(item.saleId, item.userId);
      const list = groups.get(k);
      if (list) list.push(item);
      else groups.set(k, [item]);
    }
    const day = (d: Date | null) => (d ? instantToZoned(d, timeZone).date : null);
    const lines: PendingLine[] = [];
    for (const [k, list] of groups) {
      const [first] = list;
      if (!first) continue;
      const before = done.get(k);
      const cancelledOn = day(first.cancelledAt);
      const counted = before
        ? first.status !== 'cancelled' || (cancelledOn !== null && cancelledOn > cutoff)
        : rules.criterion === 'sold'
          ? first.status === 'open' || first.status === 'closed'
          : first.status === 'closed' && (day(first.closedAt) ?? '') <= cutoff;
      const base = before?.base ?? rules.base;
      let baseCents = 0;
      let amountCents = 0;
      for (const item of list) {
        const itemBase = toCents(base === 'net' ? item.netTotal : item.grossTotal);
        baseCents += itemBase;
        amountCents += Math.round((itemBase * item.percent) / 100);
      }
      const current = counted ? amountCents : 0;
      const delta = current - (before ? toCents(Number(before.amount)) : 0);
      if (delta === 0) continue;
      lines.push({
        userId: first.userId,
        saleId: first.saleId,
        kind: !before ? 'sale' : counted ? 'adjustment' : 'reversal',
        base,
        baseAmount: fromCents(counted ? baseCents : 0),
        amount: fromCents(delta),
        description: list.map((i) => `${i.name} (${pct(i.percent)})`).join('; '),
      });
    }
    return lines;
  }

  // Comissões em aberto ----------------------------------------------------------------------------

  async open(auth: AuthContext, ate: string | undefined): Promise<CommissionOpen> {
    const { cutoff } = await this.cutoffOf(this.db, auth.unitId, ate);
    const [rules, staff, lines, openStatements] = await Promise.all([
      this.rules(this.db, auth.organizationId),
      this.db
        .selectDistinct({ id: users.id, name: users.name, since: users.commissionSince })
        .from(users)
        .innerJoin(userUnits, eq(userUnits.userId, users.id))
        .where(
          and(
            eq(users.organizationId, auth.organizationId),
            eq(users.active, true),
            eq(userUnits.unitId, auth.unitId),
          ),
        ),
      this.pending(this.db, auth.organizationId, auth.unitId, cutoff),
      this.db
        .select({
          id: commissionStatements.id,
          code: commissionStatements.code,
          status: commissionStatements.status,
          userId: commissionStatements.userId,
        })
        .from(commissionStatements)
        .where(
          and(
            eq(commissionStatements.unitId, auth.unitId),
            inArray(commissionStatements.status, ['open', 'review']),
          ),
        ),
    ]);
    const byUser = new Map<string, { sales: number; base: number; amount: number }>();
    for (const l of lines) {
      const acc = byUser.get(l.userId) ?? { sales: 0, base: 0, amount: 0 };
      acc.sales += 1;
      acc.base += toCents(l.baseAmount);
      acc.amount += toCents(l.amount);
      byUser.set(l.userId, acc);
    }
    const statementOf = new Map(openStatements.map((s) => [s.userId, s]));
    const rows = staff
      .map((u) => {
        const acc = byUser.get(u.id);
        const statement = statementOf.get(u.id);
        return {
          user: { id: u.id, name: u.name },
          commissioned: u.since !== null,
          sales: acc?.sales ?? 0,
          baseAmount: fromCents(acc?.base ?? 0),
          amount: fromCents(acc?.amount ?? 0),
          statement: statement
            ? { id: statement.id, code: statement.code, status: statement.status }
            : null,
        };
      })
      // Comissionados primeiro, depois pelo nome.
      .sort(
        (a, b) =>
          Number(b.commissioned) - Number(a.commissioned) ||
          a.user.name.localeCompare(b.user.name, 'pt-BR'),
      );
    const total = rows.reduce((sum, r) => sum + toCents(r.amount), 0);
    return {
      cutoff,
      base: rules.base,
      criterion: rules.criterion,
      rows,
      total: fromCents(total),
    };
  }

  // Extratos ---------------------------------------------------------------------------------------

  async create(auth: AuthContext, input: CommissionStatementCreate): Promise<CommissionStatement> {
    const id = await this.db.transaction(async (tx) => {
      const { cutoff } = await this.cutoffOf(tx, auth.unitId, input.cutoff);
      const [user] = await tx
        .select({ id: users.id, name: users.name, since: users.commissionSince })
        .from(users)
        .where(and(eq(users.id, input.userId), eq(users.organizationId, auth.organizationId)));
      if (!user) throw notFound('Profissional');
      if (user.since === null) {
        throw conflict(`${user.name} não recebe comissão: ligue na configuração de comissões.`);
      }
      const id = newId();
      const code = await nextCounter(tx, auth.organizationId, 'commission_statement');
      try {
        await tx.insert(commissionStatements).values({
          id,
          organizationId: auth.organizationId,
          unitId: auth.unitId,
          code,
          userId: user.id,
          status: 'open',
          cutoff,
          total: 0,
          createdBy: auth.userId,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict(
            `${user.name} já tem um extrato não fechado nesta unidade: atualize-o em vez de gerar outro.`,
          );
        }
        throw error;
      }
      const total = await this.fill(tx, auth, id, user.id, cutoff);
      if (total.lines === 0) {
        throw conflict(`Não há comissão de ${user.name} a lançar até ${br(cutoff)}.`);
      }
      await recordAudit(tx, actorOf(auth), {
        entity: 'commission_statement',
        entityId: id,
        action: 'create',
        after: { code, user: user.name, cutoff: br(cutoff), total: brl(total.amount) },
      });
      return id;
    });
    return this.get(auth, id);
  }

  /** Refaz as linhas do extrato com o que está pendente até a data de corte. */
  private async fill(
    tx: Executor,
    auth: AuthContext,
    statementId: string,
    userId: string,
    cutoff: string,
  ): Promise<{ lines: number; amount: number }> {
    await tx
      .delete(commissionStatementLines)
      .where(eq(commissionStatementLines.statementId, statementId));
    const lines = await this.pending(tx, auth.organizationId, auth.unitId, cutoff, {
      userIds: [userId],
      except: statementId,
    });
    if (lines.length) {
      await tx.insert(commissionStatementLines).values(
        lines.map((l) => ({
          id: newId(),
          statementId,
          saleId: l.saleId,
          kind: l.kind,
          base: l.base,
          baseAmount: l.baseAmount,
          amount: l.amount,
          description: l.description,
        })),
      );
    }
    const amount = fromCents(lines.reduce((sum, l) => sum + toCents(l.amount), 0));
    await tx
      .update(commissionStatements)
      .set({ cutoff, total: amount, updatedAt: new Date() })
      .where(eq(commissionStatements.id, statementId));
    return { lines: lines.length, amount };
  }

  async refresh(
    auth: AuthContext,
    id: string,
    input: CommissionStatementRefresh,
  ): Promise<CommissionStatement> {
    await this.db.transaction(async (tx) => {
      const current = await this.lock(tx, auth, id);
      this.expect(
        current,
        ['open', 'review'],
        'Só extrato não fechado ou em revisão é atualizado.',
      );
      const { cutoff } = await this.cutoffOf(tx, auth.unitId, input.cutoff);
      const result = await this.fill(tx, auth, id, current.userId, cutoff);
      await recordAudit(tx, actorOf(auth), {
        entity: 'commission_statement',
        entityId: id,
        action: 'refresh',
        before: { cutoff: br(current.cutoff), total: brl(current.total) },
        after: { cutoff: br(cutoff), total: brl(result.amount) },
      });
    });
    return this.get(auth, id);
  }

  /** Descarta o extrato ainda não fechado: as vendas voltam para as comissões em aberto. */
  async discard(auth: AuthContext, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const current = await this.lock(tx, auth, id);
      this.expect(
        current,
        ['open', 'review'],
        'Só extrato não fechado ou em revisão é descartado.',
      );
      await tx
        .update(financialEntries)
        .set({ commissionStatementId: null })
        .where(eq(financialEntries.commissionStatementId, id));
      await tx.delete(commissionStatements).where(eq(commissionStatements.id, id));
      await recordAudit(tx, actorOf(auth), {
        entity: 'commission_statement',
        entityId: id,
        action: 'discard',
        before: {
          code: current.code,
          status: commissionStatementStatusLabels[current.status],
          total: brl(current.total),
        },
      });
    });
  }

  async close(
    auth: AuthContext,
    id: string,
    input: CommissionStatementClose,
  ): Promise<CommissionStatement> {
    await this.db.transaction(async (tx) => {
      const current = await this.lock(tx, auth, id);
      this.expect(current, ['open', 'review'], 'Este extrato já está fechado.');
      // Fecha com o que vale agora: vendas editadas ou estornadas desde a geração entram certas.
      const result = await this.fill(tx, auth, id, current.userId, current.cutoff);
      if (result.amount <= 0) {
        throw conflict(
          result.lines === 0
            ? 'O extrato ficou sem vendas: descarte-o.'
            : 'O extrato não tem valor a pagar: os estornos superam as comissões. Descarte-o e espere novas vendas.',
        );
      }
      if (input.dueDate < current.cutoff) {
        throw invalid('dueDate', 'O vencimento não pode ser antes da data de corte');
      }
      const rules = await this.rules(tx, auth.organizationId);
      const now = this.now();
      await tx
        .update(commissionStatements)
        .set({
          status: 'closed',
          dueDate: input.dueDate,
          notes: input.notes,
          closedBy: auth.userId,
          closedAt: now,
          updatedAt: now,
        })
        .where(eq(commissionStatements.id, id));
      if (rules.financeIntegration) {
        const [user] = await tx
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, current.userId));
        await this.finance.commissionEntry(
          tx,
          auth,
          {
            id,
            code: current.code,
            unitId: current.unitId,
            userName: user?.name ?? '',
            total: result.amount,
            dueDate: input.dueDate,
            cutoff: current.cutoff,
          },
          await this.today(tx, auth.unitId),
        );
      }
      await recordAudit(tx, actorOf(auth), {
        entity: 'commission_statement',
        entityId: id,
        action: 'close',
        before: { status: commissionStatementStatusLabels[current.status] },
        after: {
          status: commissionStatementStatusLabels.closed,
          total: brl(result.amount),
          dueDate: br(input.dueDate),
          payable: rules.financeIntegration,
        },
      });
    });
    return this.get(auth, id);
  }

  /** Sem integração com o financeiro, o pagamento é marcado aqui; com ela, em contas a pagar. */
  async pay(
    auth: AuthContext,
    id: string,
    input: CommissionStatementPay,
  ): Promise<CommissionStatement> {
    await this.db.transaction(async (tx) => {
      const current = await this.lock(tx, auth, id);
      this.expect(current, ['closed'], 'Só extrato fechado é pago.');
      await this.noEntry(tx, id, 'Registre o pagamento em Contas a pagar.');
      if (input.paidOn > (await this.today(tx, auth.unitId))) {
        throw invalid('paidOn', 'O pagamento não pode ser no futuro');
      }
      await tx
        .update(commissionStatements)
        .set({ status: 'paid', paidOn: input.paidOn, updatedAt: new Date() })
        .where(eq(commissionStatements.id, id));
      await recordAudit(tx, actorOf(auth), {
        entity: 'commission_statement',
        entityId: id,
        action: 'pay',
        before: { status: commissionStatementStatusLabels.closed },
        after: { status: commissionStatementStatusLabels.paid, paidOn: br(input.paidOn) },
      });
    });
    return this.get(auth, id);
  }

  async unpay(auth: AuthContext, id: string): Promise<CommissionStatement> {
    await this.db.transaction(async (tx) => {
      const current = await this.lock(tx, auth, id);
      this.expect(current, ['paid'], 'Só extrato pago tem pagamento a desfazer.');
      await this.noEntry(tx, id, 'Desfaça a baixa em Contas a pagar.');
      await tx
        .update(commissionStatements)
        .set({ status: 'closed', paidOn: null, updatedAt: new Date() })
        .where(eq(commissionStatements.id, id));
      await recordAudit(tx, actorOf(auth), {
        entity: 'commission_statement',
        entityId: id,
        action: 'unpay',
        before: {
          status: commissionStatementStatusLabels.paid,
          paidOn: current.paidOn && br(current.paidOn),
        },
        after: { status: commissionStatementStatusLabels.closed },
      });
    });
    return this.get(auth, id);
  }

  /** Fechado volta para revisão: a despesa em aberto é cancelada e o extrato pode ser refeito. */
  async review(
    auth: AuthContext,
    id: string,
    input: CommissionStatementReview,
  ): Promise<CommissionStatement> {
    await this.db.transaction(async (tx) => {
      const current = await this.lock(tx, auth, id);
      if (current.status === 'paid') {
        throw conflict('Extrato pago: desfaça o pagamento antes de revisar.');
      }
      this.expect(current, ['closed'], 'Só extrato fechado vai para revisão.');
      await this.finance.cancelCommissionEntries(
        tx,
        id,
        `Extrato de comissão ${String(current.code)} em revisão: ${input.reason}`,
      );
      await tx
        .update(commissionStatements)
        .set({
          status: 'review',
          reviewReason: input.reason,
          dueDate: null,
          closedAt: null,
          closedBy: null,
          updatedAt: new Date(),
        })
        .where(eq(commissionStatements.id, id));
      await recordAudit(tx, actorOf(auth), {
        entity: 'commission_statement',
        entityId: id,
        action: 'review',
        before: { status: commissionStatementStatusLabels.closed },
        after: { status: commissionStatementStatusLabels.review, reason: input.reason },
      });
    });
    return this.get(auth, id);
  }

  async archive(auth: AuthContext, id: string): Promise<CommissionStatement> {
    await this.db.transaction(async (tx) => {
      const current = await this.lock(tx, auth, id);
      this.expect(current, ['paid'], 'Só extrato pago é arquivado.');
      await tx
        .update(commissionStatements)
        .set({ status: 'archived', updatedAt: new Date() })
        .where(eq(commissionStatements.id, id));
      await recordAudit(tx, actorOf(auth), {
        entity: 'commission_statement',
        entityId: id,
        action: 'archive',
        before: { status: commissionStatementStatusLabels.paid },
        after: { status: commissionStatementStatusLabels.archived },
      });
    });
    return this.get(auth, id);
  }

  // Leitura ----------------------------------------------------------------------------------------

  async list(
    auth: AuthContext,
    query: CommissionStatementQuery,
    onlyUser?: string,
  ): Promise<CommissionStatementList> {
    const filters: SQL[] = [
      eq(commissionStatements.organizationId, auth.organizationId),
      eq(commissionStatements.unitId, auth.unitId),
    ];
    const status = {
      abertos: ['open', 'review'],
      fechados: ['closed'],
      pagos: ['paid'],
      arquivados: ['archived'],
      todos: null,
    }[query.situacao] as StatementRow['status'][] | null;
    if (status) filters.push(inArray(commissionStatements.status, status));
    const userId = onlyUser ?? query.profissional;
    if (userId) filters.push(eq(commissionStatements.userId, userId));
    const where = and(...filters);
    const counts = this.db
      .select({ statementId: commissionStatementLines.statementId, n: count().as('n') })
      .from(commissionStatementLines)
      .groupBy(commissionStatementLines.statementId)
      .as('counts');
    const [rows, [totals]] = await Promise.all([
      this.db
        .select({
          id: commissionStatements.id,
          code: commissionStatements.code,
          status: commissionStatements.status,
          user: { id: users.id, name: users.name },
          cutoff: commissionStatements.cutoff,
          lines: sql<number>`coalesce(${counts.n}, 0)::int`,
          total: commissionStatements.total,
          dueDate: commissionStatements.dueDate,
          paidOn: commissionStatements.paidOn,
        })
        .from(commissionStatements)
        .innerJoin(users, eq(users.id, commissionStatements.userId))
        .leftJoin(counts, eq(counts.statementId, commissionStatements.id))
        .where(where)
        .orderBy(desc(commissionStatements.code))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ n: count() }).from(commissionStatements).where(where),
    ]);
    return { items: rows, total: totals?.n ?? 0, page: query.page, pageSize: query.pageSize };
  }

  /** Quem vê todos os extratos, ou o próprio profissional quando a clínica mostra à equipe. */
  async read(auth: AuthContext, id: string): Promise<CommissionStatement> {
    const statement = await this.get(auth, id);
    if (auth.permissions.has('commissions.view')) return statement;
    if (statement.user.id === auth.userId && (await this.canSeeOwn(auth))) return statement;
    throw forbidden();
  }

  private async canSeeOwn(auth: AuthContext): Promise<boolean> {
    if (!auth.permissions.has('commissions.view_own')) return false;
    return (await this.rules(this.db, auth.organizationId)).staffCanSeeOwn;
  }

  async mine(auth: AuthContext): Promise<MyCommissions> {
    if (!(await this.canSeeOwn(auth))) {
      throw new AppError('forbidden', 'A clínica não mostra as comissões à equipe.');
    }
    const [rules, [user]] = await Promise.all([
      this.rules(this.db, auth.organizationId),
      this.db.select({ since: users.commissionSince }).from(users).where(eq(users.id, auth.userId)),
    ]);
    const cutoff = await this.today(this.db, auth.unitId);
    const since = user?.since ?? null;
    const lines =
      since !== null
        ? await this.pending(this.db, auth.organizationId, auth.unitId, cutoff, {
            userIds: [auth.userId],
          })
        : [];
    const statements = await this.list(
      auth,
      { situacao: 'todos', page: 1, pageSize: 24 },
      auth.userId,
    );
    return {
      commissioned: since !== null,
      since,
      cutoff,
      criterion: rules.criterion,
      open: {
        sales: lines.length,
        amount: fromCents(lines.reduce((sum, l) => sum + toCents(l.amount), 0)),
      },
      statements: statements.items,
    };
  }

  async get(auth: AuthContext, id: string, db: Executor = this.db): Promise<CommissionStatement> {
    const creator = alias(users, 'creator');
    const closer = alias(users, 'closer');
    const [row] = await db
      .select({
        statement: commissionStatements,
        user: { id: users.id, name: users.name },
        createdBy: creator.name,
        closedBy: closer.name,
      })
      .from(commissionStatements)
      .innerJoin(users, eq(users.id, commissionStatements.userId))
      .innerJoin(creator, eq(creator.id, commissionStatements.createdBy))
      .leftJoin(closer, eq(closer.id, commissionStatements.closedBy))
      .where(
        and(
          eq(commissionStatements.id, id),
          eq(commissionStatements.organizationId, auth.organizationId),
        ),
      );
    if (!row) throw notFound('Extrato de comissão');
    const s = row.statement;
    const timeZone = await unitTimeZone(db, s.unitId);
    const [lines, [entry], rules] = await Promise.all([
      db
        .select({
          line: commissionStatementLines,
          sale: {
            id: sales.id,
            code: sales.code,
            soldAt: sales.soldAt,
            status: sales.status,
          },
          client: clients.name,
        })
        .from(commissionStatementLines)
        .innerJoin(sales, eq(sales.id, commissionStatementLines.saleId))
        .leftJoin(clients, eq(clients.id, sales.clientId))
        .where(eq(commissionStatementLines.statementId, id))
        .orderBy(asc(sales.soldAt)),
      db
        .select({
          id: financialEntries.id,
          status: financialEntries.status,
          dueDate: financialEntries.dueDate,
          amount: financialEntries.amount,
        })
        .from(financialEntries)
        .where(
          and(
            eq(financialEntries.commissionStatementId, id),
            ne(financialEntries.status, 'cancelled'),
          ),
        ),
      this.rules(db, auth.organizationId),
    ]);
    return {
      id: s.id,
      code: s.code,
      status: s.status,
      user: row.user,
      cutoff: s.cutoff,
      total: s.total,
      dueDate: s.dueDate,
      paidOn: s.paidOn,
      notes: s.notes,
      reviewReason: s.reviewReason,
      lines: lines.map((l) => ({
        id: l.line.id,
        kind: l.line.kind,
        sale: {
          id: l.sale.id,
          code: l.sale.code,
          soldAt: l.sale.soldAt ? instantToZoned(l.sale.soldAt, timeZone).date : '',
          client: l.client,
          status: l.sale.status,
        },
        base: l.line.base,
        baseAmount: l.line.baseAmount,
        amount: l.line.amount,
        description: l.line.description,
      })),
      entry: entry ?? null,
      financeIntegration: rules.financeIntegration,
      createdBy: row.createdBy,
      createdAt: s.createdAt.toISOString(),
      closedBy: row.closedBy,
      closedAt: s.closedAt?.toISOString() ?? null,
    };
  }

  // Apoio ------------------------------------------------------------------------------------------

  private async lock(tx: Executor, auth: AuthContext, id: string): Promise<StatementRow> {
    const [row] = await tx
      .select()
      .from(commissionStatements)
      .where(
        and(
          eq(commissionStatements.id, id),
          eq(commissionStatements.organizationId, auth.organizationId),
        ),
      )
      .for('update');
    if (!row) throw notFound('Extrato de comissão');
    return row;
  }

  private expect(row: StatementRow, allowed: StatementRow['status'][], message: string) {
    if (!allowed.includes(row.status)) throw conflict(message);
  }

  private async noEntry(tx: Executor, id: string, message: string) {
    const [entry] = await tx
      .select({ id: financialEntries.id })
      .from(financialEntries)
      .where(
        and(
          eq(financialEntries.commissionStatementId, id),
          ne(financialEntries.status, 'cancelled'),
        ),
      );
    if (entry) throw conflict(`Este extrato está em contas a pagar. ${message}`);
  }
}
