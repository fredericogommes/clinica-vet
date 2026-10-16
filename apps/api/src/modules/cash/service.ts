import {
  cashSessionStatusLabels,
  fromCents,
  toCents,
  type CashEntry,
  type CashListQuery,
  type CashMovementInput,
  type CashSession,
  type CashSessionSummary,
  type CloseCashInput,
  type PaymentKind,
} from '@clinica/contracts';
import { and, asc, count, desc, eq, gte, lt, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { actorOf } from '../../core/actor.js';
import { recordAudit } from '../../core/audit.js';
import { nextCounter } from '../../core/counters.js';
import { AppError, conflict, forbidden, notFound } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import { addDays, zonedToInstant } from '../../core/zoned-time.js';
import type { Database, Executor } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import { cashMovements, cashSessions, salePayments, sales, units, users } from '../../db/schema.js';
import type { AuthContext } from '../auth/sessions.js';

type SessionRow = typeof cashSessions.$inferSelect;

const invalid = (path: string, message: string) =>
  new AppError('validation_failed', 'Dados do caixa inválidos.', [{ path, message }]);

const brl = (value: number) =>
  `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** O que entrou e saiu de um caixa, em centavos. */
interface Ledger {
  receipts: {
    id: string;
    at: Date;
    methodName: string;
    kind: PaymentKind;
    cents: number;
    sale: { id: string; code: number };
    by: string;
  }[];
  movements: {
    id: string;
    at: Date;
    kind: 'supply' | 'withdrawal' | 'refund';
    cents: number;
    description: string;
    methodName: string | null;
    paymentKind: PaymentKind | null;
    sale: { id: string; code: number } | null;
    by: string;
  }[];
}

/** Dinheiro esperado na gaveta: troco + recebido em dinheiro + suprimento − sangria − devolvido. */
function expectedCashCents(openingCents: number, ledger: Ledger): number {
  const cashIn = ledger.receipts.filter((r) => r.kind === 'cash').reduce((a, r) => a + r.cents, 0);
  const moves = ledger.movements.reduce((a, m) => {
    if (m.kind === 'supply') return a + m.cents;
    if (m.kind === 'withdrawal') return a - m.cents;
    return m.paymentKind === 'cash' ? a - m.cents : a;
  }, 0);
  return openingCents + cashIn + moves;
}

/**
 * Caixa por operador e unidade [RN-29]: abertura com troco, recebimentos das vendas, sangria,
 * suprimento, estornos e fechamento com a contagem do dinheiro.
 */
export class CashService {
  constructor(private readonly db: Database) {}

  /**
   * Caixa aberto do usuário nesta unidade, travado até o fim da transação: um recebimento ou
   * estorno e o fechamento do mesmo caixa nunca se cruzam.
   */
  async openSessionFor(tx: Executor, auth: AuthContext, action: string): Promise<SessionRow> {
    const [row] = await tx
      .select()
      .from(cashSessions)
      .where(
        and(
          eq(cashSessions.unitId, auth.unitId),
          eq(cashSessions.operatorId, auth.userId),
          eq(cashSessions.status, 'open'),
        ),
      )
      .for('update');
    if (!row) throw conflict(`Abra o seu caixa antes de ${action}.`);
    return row;
  }

  /** Dinheiro esperado agora no caixa, para conferir sangria e devolução. */
  async expectedCash(tx: Executor, session: SessionRow): Promise<number> {
    return expectedCashCents(toCents(session.openingAmount), await this.ledger(tx, session.id));
  }

  async current(auth: AuthContext): Promise<CashSessionSummary | null> {
    const [row] = await this.db
      .select({ id: cashSessions.id })
      .from(cashSessions)
      .where(
        and(
          eq(cashSessions.unitId, auth.unitId),
          eq(cashSessions.operatorId, auth.userId),
          eq(cashSessions.status, 'open'),
        ),
      );
    return row ? this.summaryOf(this.db, auth, row.id) : null;
  }

  async open(
    auth: AuthContext,
    input: { openingAmount: number; notes: string },
  ): Promise<CashSession> {
    try {
      return await this.db.transaction(async (tx) => {
        const id = newId();
        const code = await nextCounter(tx, auth.organizationId, 'cash_session');
        await tx.insert(cashSessions).values({
          id,
          organizationId: auth.organizationId,
          unitId: auth.unitId,
          code,
          operatorId: auth.userId,
          status: 'open',
          openedAt: new Date(),
          openingAmount: input.openingAmount,
          openingNotes: input.notes,
        });
        await recordAudit(tx, actorOf(auth), {
          entity: 'cash_session',
          entityId: id,
          action: 'open',
          after: { code, openingAmount: input.openingAmount, notes: input.notes },
        });
        return this.get(auth, id, tx);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('Você já tem um caixa aberto nesta unidade.');
      throw error;
    }
  }

  async list(
    auth: AuthContext,
    query: CashListQuery,
  ): Promise<{ items: CashSessionSummary[]; total: number }> {
    assertCashAccess(auth);
    const filters: SQL[] = [
      eq(cashSessions.organizationId, auth.organizationId),
      eq(cashSessions.unitId, auth.unitId),
    ];
    // Sem supervisão, cada operador vê só os próprios caixas.
    if (!auth.permissions.has('cash.supervise')) {
      filters.push(eq(cashSessions.operatorId, auth.userId));
    }
    if (query.status) filters.push(eq(cashSessions.status, query.status));
    if (query.from || query.to) {
      const [unit] = await this.db
        .select({ timeZone: units.timeZone })
        .from(units)
        .where(eq(units.id, auth.unitId));
      const tz = unit?.timeZone ?? 'America/Sao_Paulo';
      if (query.from) filters.push(gte(cashSessions.openedAt, zonedToInstant(query.from, 0, tz)));
      if (query.to) {
        filters.push(lt(cashSessions.openedAt, zonedToInstant(addDays(query.to, 1), 0, tz)));
      }
    }
    const where = and(...filters);
    const [rows, totals] = await Promise.all([
      this.db
        .select({ id: cashSessions.id })
        .from(cashSessions)
        .where(where)
        .orderBy(desc(cashSessions.openedAt), desc(cashSessions.code))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ n: count() }).from(cashSessions).where(where),
    ]);
    const items: CashSessionSummary[] = [];
    for (const r of rows) items.push(await this.summaryOf(this.db, auth, r.id));
    return { items, total: totals[0]?.n ?? 0 };
  }

  async get(auth: AuthContext, id: string, executor?: Executor): Promise<CashSession> {
    const db = executor ?? this.db;
    const row = await this.visible(db, auth, id);
    const ledger = await this.ledger(db, id);
    const summary = this.summarize(row.session, row.operatorName, row.unitName, ledger);
    const methods = new Map<string, CashSession['byMethod'][number]>();
    const bucket = (methodName: string, paymentKind: PaymentKind) => {
      const key = `${paymentKind}|${methodName}`;
      let b = methods.get(key);
      if (!b) {
        b = { methodName, paymentKind, received: 0, refunded: 0, net: 0 };
        methods.set(key, b);
      }
      return b;
    };
    for (const r of ledger.receipts) bucket(r.methodName, r.kind).received += r.cents;
    for (const m of ledger.movements) {
      if (m.kind === 'refund' && m.methodName && m.paymentKind) {
        bucket(m.methodName, m.paymentKind).refunded += m.cents;
      }
    }
    const sum = (kind: 'supply' | 'withdrawal') =>
      ledger.movements.filter((m) => m.kind === kind).reduce((a, m) => a + m.cents, 0);
    const s = row.session;
    const opening: CashEntry = {
      id: `opening-${s.id}`,
      kind: 'opening',
      at: s.openedAt.toISOString(),
      description: s.openingNotes ? `Troco inicial: ${s.openingNotes}` : 'Troco inicial',
      methodName: null,
      paymentKind: 'cash',
      amount: s.openingAmount,
      sale: null,
      by: row.operatorName,
    };
    const entries: CashEntry[] = [
      opening,
      ...ledger.receipts.map((r) => ({
        id: r.id,
        kind: 'receipt' as const,
        at: r.at.toISOString(),
        description: `Venda ${String(r.sale.code)}`,
        methodName: r.methodName,
        paymentKind: r.kind,
        amount: fromCents(r.cents),
        sale: r.sale,
        by: r.by,
      })),
      ...ledger.movements.map((m) => ({
        id: m.id,
        kind: m.kind,
        at: m.at.toISOString(),
        description: m.description,
        methodName: m.methodName,
        paymentKind: m.kind === 'refund' ? m.paymentKind : ('cash' as const),
        amount: fromCents(m.kind === 'supply' ? m.cents : -m.cents),
        sale: m.sale,
        by: m.by,
      })),
    ].sort((a, b) => a.at.localeCompare(b.at));
    const mine = s.operatorId === auth.userId;
    return {
      ...summary,
      openingNotes: s.openingNotes,
      closingNotes: s.closingNotes,
      closedBy: row.closedByName,
      byMethod: [...methods.values()].map((b) => ({
        ...b,
        received: fromCents(b.received),
        refunded: fromCents(b.refunded),
        net: fromCents(b.received - b.refunded),
      })),
      supplies: fromCents(sum('supply')),
      withdrawals: fromCents(sum('withdrawal')),
      entries,
      canMove: s.status === 'open' && mine && auth.permissions.has('cash.operate'),
      canClose:
        s.status === 'open' &&
        ((mine && auth.permissions.has('cash.operate')) || auth.permissions.has('cash.supervise')),
    };
  }

  /** Sangria ou suprimento, só pelo operador do caixa aberto. */
  async addMovement(auth: AuthContext, id: string, input: CashMovementInput): Promise<CashSession> {
    return this.db.transaction(async (tx) => {
      const session = await this.lock(tx, auth, id);
      if (session.status !== 'open') throw conflict('Este caixa já está fechado.');
      if (session.operatorId !== auth.userId) {
        throw conflict('Só o operador lança sangria e suprimento no próprio caixa.');
      }
      if (input.kind === 'withdrawal') {
        const available = await this.expectedCash(tx, session);
        if (toCents(input.amount) > available) {
          throw invalid(
            'amount',
            `A sangria passa do dinheiro em caixa (${brl(fromCents(available))})`,
          );
        }
      }
      const movementId = newId();
      await tx.insert(cashMovements).values({
        id: movementId,
        cashSessionId: id,
        kind: input.kind,
        amount: input.amount,
        description: input.description,
        createdBy: auth.userId,
      });
      await recordAudit(tx, actorOf(auth), {
        entity: 'cash_session',
        entityId: id,
        action: input.kind,
        after: { code: session.code, amount: input.amount, description: input.description },
      });
      return this.get(auth, id, tx);
    });
  }

  /**
   * Fecha com o dinheiro contado; o sistema guarda o esperado e a diferença. Diferença exige
   * explicação. Fecha o próprio caixa ou, com supervisão, o de outro operador.
   */
  async close(auth: AuthContext, id: string, input: CloseCashInput & { notes: string }) {
    return this.db.transaction(async (tx) => {
      const session = await this.lock(tx, auth, id);
      if (session.status !== 'open') throw conflict('Este caixa já está fechado.');
      const mine = session.operatorId === auth.userId;
      if (
        !(mine && auth.permissions.has('cash.operate')) &&
        !auth.permissions.has('cash.supervise')
      ) {
        throw conflict('Só o operador ou um supervisor fecha este caixa.');
      }
      const expected = await this.expectedCash(tx, session);
      const counted = toCents(input.countedCash);
      if (counted !== expected && input.notes.trim().length < 3) {
        throw invalid('notes', 'Explique a diferença entre o contado e o esperado');
      }
      const now = new Date();
      await tx
        .update(cashSessions)
        .set({
          status: 'closed',
          closedAt: now,
          closedBy: auth.userId,
          expectedCash: fromCents(expected),
          countedCash: input.countedCash,
          closingNotes: input.notes,
          updatedAt: now,
        })
        .where(eq(cashSessions.id, id));
      await recordAudit(tx, actorOf(auth), {
        entity: 'cash_session',
        entityId: id,
        action: 'close',
        before: { code: session.code, status: cashSessionStatusLabels.open },
        after: {
          code: session.code,
          status: cashSessionStatusLabels.closed,
          expectedCash: fromCents(expected),
          countedCash: input.countedCash,
          difference: fromCents(counted - expected),
          notes: input.notes,
        },
      });
      return this.get(auth, id, tx);
    });
  }

  private async lock(tx: Executor, auth: AuthContext, id: string): Promise<SessionRow> {
    await this.visible(tx, auth, id);
    const [row] = await tx.select().from(cashSessions).where(eq(cashSessions.id, id)).for('update');
    if (!row) throw notFound('Caixa');
    return row;
  }

  /** Caixa desta unidade; sem supervisão, só o do próprio operador. */
  private async visible(db: Executor, auth: AuthContext, id: string) {
    assertCashAccess(auth);
    const operator = alias(users, 'operator');
    const closer = alias(users, 'closer');
    const [row] = await db
      .select({
        session: cashSessions,
        operatorName: operator.name,
        closedByName: closer.name,
        unitName: units.name,
      })
      .from(cashSessions)
      .innerJoin(operator, eq(operator.id, cashSessions.operatorId))
      .innerJoin(units, eq(units.id, cashSessions.unitId))
      .leftJoin(closer, eq(closer.id, cashSessions.closedBy))
      .where(
        and(
          eq(cashSessions.id, id),
          eq(cashSessions.organizationId, auth.organizationId),
          eq(cashSessions.unitId, auth.unitId),
        ),
      );
    if (
      !row ||
      (row.session.operatorId !== auth.userId && !auth.permissions.has('cash.supervise'))
    ) {
      throw notFound('Caixa');
    }
    return row;
  }

  private async summaryOf(db: Executor, auth: AuthContext, id: string) {
    const row = await this.visible(db, auth, id);
    return this.summarize(row.session, row.operatorName, row.unitName, await this.ledger(db, id));
  }

  private summarize(
    s: SessionRow,
    operatorName: string,
    unitName: string,
    ledger: Ledger,
  ): CashSessionSummary {
    const expected =
      s.status === 'closed' && s.expectedCash !== null
        ? toCents(s.expectedCash)
        : expectedCashCents(toCents(s.openingAmount), ledger);
    const received = ledger.receipts.reduce((a, r) => a + r.cents, 0);
    const refunded = ledger.movements
      .filter((m) => m.kind === 'refund')
      .reduce((a, m) => a + m.cents, 0);
    return {
      id: s.id,
      code: s.code,
      status: s.status,
      operator: { id: s.operatorId, name: operatorName },
      unitName,
      openedAt: s.openedAt.toISOString(),
      closedAt: s.closedAt?.toISOString() ?? null,
      openingAmount: s.openingAmount,
      expectedCash: fromCents(expected),
      countedCash: s.countedCash,
      difference: s.countedCash === null ? null : fromCents(toCents(s.countedCash) - expected),
      salesTotal: fromCents(received - refunded),
    };
  }

  private async ledger(db: Executor, sessionId: string): Promise<Ledger> {
    const receiver = alias(users, 'receiver');
    const [receipts, movements] = await Promise.all([
      db
        .select({
          id: salePayments.id,
          at: salePayments.receivedAt,
          methodName: salePayments.methodName,
          kind: salePayments.kind,
          amount: salePayments.amount,
          saleId: sales.id,
          saleCode: sales.code,
          by: receiver.name,
        })
        .from(salePayments)
        .innerJoin(sales, eq(sales.id, salePayments.saleId))
        .innerJoin(receiver, eq(receiver.id, salePayments.receivedBy))
        .where(eq(salePayments.cashSessionId, sessionId))
        .orderBy(asc(salePayments.receivedAt), asc(salePayments.position)),
      db
        .select({ m: cashMovements, by: users.name, saleCode: sales.code })
        .from(cashMovements)
        .innerJoin(users, eq(users.id, cashMovements.createdBy))
        .leftJoin(sales, eq(sales.id, cashMovements.saleId))
        .where(eq(cashMovements.cashSessionId, sessionId))
        .orderBy(asc(cashMovements.createdAt)),
    ]);
    return {
      receipts: receipts.map((r) => ({
        id: r.id,
        at: r.at,
        methodName: r.methodName,
        kind: r.kind as PaymentKind,
        cents: toCents(r.amount),
        sale: { id: r.saleId, code: r.saleCode },
        by: r.by,
      })),
      movements: movements.map(({ m, by, saleCode }) => ({
        id: m.id,
        at: m.createdAt,
        kind: m.kind,
        cents: toCents(m.amount),
        description: m.description,
        methodName: m.methodName,
        paymentKind: m.paymentKind as PaymentKind | null,
        sale: m.saleId && saleCode !== null ? { id: m.saleId, code: saleCode } : null,
        by,
      })),
    };
  }
}

/** Movimentos de caixa: o operador vê os seus; o supervisor, os de todos. */
function assertCashAccess(auth: AuthContext) {
  if (!auth.permissions.has('cash.operate') && !auth.permissions.has('cash.supervise')) {
    throw forbidden();
  }
}
