import {
  acquirerKinds,
  fromCents,
  toCents,
  type CardDeposit,
  type CardDepositList,
  type CardDepositQuery,
  type ReconcileInput,
} from '@clinica/contracts';
import { and, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { actorOf } from '../../core/actor.js';
import { recordAudit } from '../../core/audit.js';
import { AppError, conflict, notFound } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import type { Database, Executor } from '../../db/client.js';
import {
  cardSettlements,
  costCenters,
  financialAccounts,
  financialCategories,
  financialEntries,
  paymentMethods,
  salePayments,
  saleReceivables,
  users,
} from '../../db/schema.js';
import type { AuthContext } from '../auth/sessions.js';
import type { FinanceService } from './service.js';

const invalid = (path: string, message: string) =>
  new AppError('validation_failed', 'Dados da conciliação inválidos.', [{ path, message }]);

const brl = (value: number) =>
  `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const br = (iso: string) => iso.split('-').reverse().join('/');

const keyOf = (methodId: string, date: string, accountId: string) =>
  `${methodId}:${date}:${accountId}`;

/**
 * Conciliação de cartões [p.18, RN-37]: agrupa as parcelas de cartão em aberto por forma, data
 * prevista e conta (o depósito que a adquirente deve fazer), confirma o que caiu e lança a
 * diferença para o líquido previsto. Desfazer devolve tudo como estava.
 */
export class CardReconciliationService {
  constructor(
    private readonly db: Database,
    private readonly finance: FinanceService,
  ) {}

  async list(auth: AuthContext, query: CardDepositQuery): Promise<CardDepositList> {
    const today = await this.finance.today(this.db, auth);
    await this.db.transaction((tx) => this.finance.ensure(tx, auth.organizationId, today));

    // Depósitos ainda não conciliados: parcelas de venda e taxas em aberto, agrupadas.
    const openFilters: SQL[] = [
      eq(financialEntries.organizationId, auth.organizationId),
      eq(financialEntries.status, 'open'),
      inArray(financialEntries.origin, ['sale', 'card_fee']),
      inArray(salePayments.kind, [...acquirerKinds]),
    ];
    if (query.forma) openFilters.push(eq(salePayments.paymentMethodId, query.forma));
    if (query.de) openFilters.push(gte(financialEntries.dueDate, query.de));
    if (query.ate) openFilters.push(lte(financialEntries.dueDate, query.ate));
    const groups = await this.db
      .select({
        methodId: salePayments.paymentMethodId,
        methodName: paymentMethods.name,
        accountId: financialEntries.accountId,
        accountName: financialAccounts.name,
        dueDate: financialEntries.dueDate,
        count: sql<number>`count(*) filter (where ${financialEntries.origin} = 'sale')::int`,
        gross: sql<string>`coalesce(sum(${financialEntries.amount}) filter (where ${financialEntries.origin} = 'sale'), 0)`,
        fee: sql<string>`coalesce(sum(${financialEntries.amount}) filter (where ${financialEntries.origin} = 'card_fee'), 0)`,
      })
      .from(financialEntries)
      .innerJoin(saleReceivables, eq(saleReceivables.id, financialEntries.saleReceivableId))
      .innerJoin(salePayments, eq(salePayments.id, saleReceivables.salePaymentId))
      .innerJoin(paymentMethods, eq(paymentMethods.id, salePayments.paymentMethodId))
      .innerJoin(financialAccounts, eq(financialAccounts.id, financialEntries.accountId))
      .where(and(...openFilters))
      .groupBy(
        salePayments.paymentMethodId,
        paymentMethods.name,
        financialEntries.accountId,
        financialAccounts.name,
        financialEntries.dueDate,
      );
    const pending: CardDeposit[] = groups
      .filter((g) => g.count > 0)
      .map((g) => {
        const gross = toCents(Number(g.gross));
        const fee = toCents(Number(g.fee));
        return {
          key: keyOf(g.methodId, g.dueDate, g.accountId),
          paymentMethod: { id: g.methodId, name: g.methodName },
          account: { id: g.accountId, name: g.accountName },
          expectedDate: g.dueDate,
          status: g.dueDate <= today ? 'unreconciled' : 'expected',
          count: g.count,
          gross: fromCents(gross),
          fee: fromCents(fee),
          expectedNet: fromCents(gross - fee),
          settlement: null,
        };
      });

    const doneFilters: SQL[] = [eq(cardSettlements.organizationId, auth.organizationId)];
    if (query.forma) doneFilters.push(eq(cardSettlements.paymentMethodId, query.forma));
    if (query.de) doneFilters.push(gte(cardSettlements.expectedDate, query.de));
    if (query.ate) doneFilters.push(lte(cardSettlements.expectedDate, query.ate));
    const settled = await this.db
      .select({
        s: cardSettlements,
        methodName: paymentMethods.name,
        accountName: financialAccounts.name,
        by: users.name,
        count: sql<number>`(select count(*)::int from ${financialEntries}
          where ${financialEntries.cardSettlementId} = ${cardSettlements.id}
          and ${financialEntries.origin} = 'sale')`,
      })
      .from(cardSettlements)
      .innerJoin(paymentMethods, eq(paymentMethods.id, cardSettlements.paymentMethodId))
      .innerJoin(financialAccounts, eq(financialAccounts.id, cardSettlements.accountId))
      .innerJoin(users, eq(users.id, cardSettlements.reconciledBy))
      .where(and(...doneFilters));
    const reconciled: CardDeposit[] = settled.map(({ s, methodName, accountName, by, count }) => ({
      key: keyOf(s.paymentMethodId, s.expectedDate, s.accountId),
      paymentMethod: { id: s.paymentMethodId, name: methodName },
      account: { id: s.accountId, name: accountName },
      expectedDate: s.expectedDate,
      status: 'reconciled',
      count,
      gross: s.gross,
      fee: s.fee,
      expectedNet: s.expectedNet,
      settlement: {
        id: s.id,
        depositDate: s.depositDate,
        receivedNet: s.receivedNet,
        difference: fromCents(toCents(s.receivedNet) - toCents(s.expectedNet)),
        by,
        at: s.reconciledAt.toISOString(),
      },
    }));

    const all = [...pending, ...reconciled];
    const sum = (items: CardDeposit[], pick: (d: CardDeposit) => number) =>
      fromCents(items.reduce((a, d) => a + toCents(pick(d)), 0));
    const unreconciled = all.filter((d) => d.status === 'unreconciled');
    const expected = all.filter((d) => d.status === 'expected');
    const counts = {
      unreconciled: { count: unreconciled.length, amount: sum(unreconciled, (d) => d.expectedNet) },
      expected: { count: expected.length, amount: sum(expected, (d) => d.expectedNet) },
      reconciled: {
        count: reconciled.length,
        amount: sum(reconciled, (d) => d.settlement?.receivedNet ?? 0),
      },
      difference: sum(reconciled, (d) => d.settlement?.difference ?? 0),
    };
    const wanted = {
      'nao-conciliados': unreconciled,
      previstos: expected,
      conciliados: reconciled,
      todos: all,
    }[query.situacao];
    // Não conciliados e previstos do mais antigo; conciliados do mais recente.
    const items = [...wanted].sort((a, b) =>
      a.status === 'reconciled' && b.status === 'reconciled'
        ? b.expectedDate.localeCompare(a.expectedDate)
        : a.expectedDate.localeCompare(b.expectedDate) ||
          a.paymentMethod.name.localeCompare(b.paymentMethod.name, 'pt-BR'),
    );
    return { items, counts, today };
  }

  async reconcile(auth: AuthContext, input: ReconcileInput): Promise<{ id: string }> {
    return this.db.transaction(async (tx) => {
      const today = await this.finance.today(tx, auth);
      if (input.depositDate > today) {
        throw invalid('depositDate', 'O depósito não pode ser no futuro');
      }
      const entries = await this.lockGroup(tx, auth, input);
      const sales = entries.filter((e) => e.origin === 'sale');
      if (sales.length === 0) {
        throw conflict('Nada a conciliar: as parcelas deste depósito já foram baixadas.');
      }
      const fees = entries.filter((e) => e.origin === 'card_fee');
      const gross = sales.reduce((a, e) => a + toCents(e.amount), 0);
      const fee = fees.reduce((a, e) => a + toCents(e.amount), 0);
      const expectedNet = gross - fee;
      const received = toCents(input.receivedNet);
      const difference = received - expectedNet;
      const [method] = await tx
        .select({ name: paymentMethods.name })
        .from(paymentMethods)
        .where(eq(paymentMethods.id, input.paymentMethodId));
      const settlementId = newId();
      const now = new Date();

      let adjustmentEntryId: string | null = null;
      if (difference !== 0) {
        adjustmentEntryId = newId();
        const key = difference < 0 ? 'card_fees' : 'sales';
        const [category] = await tx
          .select({ id: financialCategories.id })
          .from(financialCategories)
          .where(
            and(
              eq(financialCategories.organizationId, auth.organizationId),
              eq(financialCategories.systemKey, key),
            ),
          );
        if (!category) throw notFound('Categoria de vendas');
        const [center] = await tx
          .select({ id: costCenters.id })
          .from(costCenters)
          .where(and(eq(costCenters.unitId, auth.unitId), eq(costCenters.isDefault, true)));
        const amount = fromCents(Math.abs(difference));
        // A referência ao depósito entra depois de ele existir (as chaves se apontam).
        await tx.insert(financialEntries).values({
          id: adjustmentEntryId,
          organizationId: auth.organizationId,
          unitId: auth.unitId,
          kind: difference < 0 ? 'expense' : 'income',
          direction: difference < 0 ? 'out' : 'in',
          origin: 'card_adjustment',
          status: 'paid',
          description: `Diferença na conciliação - ${method?.name ?? 'cartão'} - ${br(input.expectedDate)}`,
          accountId: input.accountId,
          categoryId: category.id,
          costCenterId: center?.id ?? null,
          amount,
          paidAmount: amount,
          dueDate: input.depositDate,
          competenceDate: input.depositDate,
          paidOn: input.depositDate,
          paidBy: auth.userId,
          createdBy: auth.userId,
          createdAt: now,
          updatedAt: now,
        });
      }
      await tx.insert(cardSettlements).values({
        id: settlementId,
        organizationId: auth.organizationId,
        paymentMethodId: input.paymentMethodId,
        accountId: input.accountId,
        expectedDate: input.expectedDate,
        depositDate: input.depositDate,
        gross: fromCents(gross),
        fee: fromCents(fee),
        expectedNet: fromCents(expectedNet),
        receivedNet: input.receivedNet,
        adjustmentEntryId,
        reconciledBy: auth.userId,
        reconciledAt: now,
      });
      await tx
        .update(financialEntries)
        .set({
          status: 'paid',
          paidOn: input.depositDate,
          paidAmount: sql`${financialEntries.amount}`,
          paidBy: auth.userId,
          cardSettlementId: settlementId,
          updatedAt: now,
        })
        .where(
          inArray(
            financialEntries.id,
            entries.map((e) => e.id),
          ),
        );
      if (adjustmentEntryId) {
        await tx
          .update(financialEntries)
          .set({ cardSettlementId: settlementId })
          .where(eq(financialEntries.id, adjustmentEntryId));
      }
      await recordAudit(tx, actorOf(auth), {
        entity: 'card_settlement',
        entityId: settlementId,
        action: 'reconcile',
        after: {
          paymentMethod: method?.name ?? null,
          expectedDate: br(input.expectedDate),
          depositDate: br(input.depositDate),
          installments: sales.length,
          gross: brl(fromCents(gross)),
          fee: brl(fromCents(fee)),
          expectedNet: brl(fromCents(expectedNet)),
          receivedNet: brl(input.receivedNet),
          difference: brl(fromCents(difference)),
        },
      });
      return { id: settlementId };
    });
  }

  /** Desfaz a conciliação: as parcelas voltam a aguardar e o ajuste é cancelado. */
  async undo(auth: AuthContext, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [settlement] = await tx
        .select()
        .from(cardSettlements)
        .where(
          and(eq(cardSettlements.id, id), eq(cardSettlements.organizationId, auth.organizationId)),
        )
        .for('update');
      if (!settlement) throw notFound('Conciliação');
      const now = new Date();
      await tx
        .update(financialEntries)
        .set({
          status: 'open',
          paidOn: null,
          paidAmount: null,
          paidBy: null,
          cardSettlementId: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(financialEntries.cardSettlementId, id),
            inArray(financialEntries.origin, ['sale', 'card_fee']),
            eq(financialEntries.status, 'paid'),
          ),
        );
      if (settlement.adjustmentEntryId) {
        await tx
          .update(cardSettlements)
          .set({ adjustmentEntryId: null })
          .where(eq(cardSettlements.id, id));
        await tx
          .update(financialEntries)
          .set({
            status: 'cancelled',
            cancelReason: 'Conciliação desfeita',
            cancelledAt: now,
            cardSettlementId: null,
            updatedAt: now,
          })
          .where(eq(financialEntries.id, settlement.adjustmentEntryId));
      }
      // Lançamentos cancelados depois (estorno) não seguram o depósito.
      await tx
        .update(financialEntries)
        .set({ cardSettlementId: null })
        .where(eq(financialEntries.cardSettlementId, id));
      await tx.delete(cardSettlements).where(eq(cardSettlements.id, id));
      await recordAudit(tx, actorOf(auth), {
        entity: 'card_settlement',
        entityId: id,
        action: 'undo',
        before: {
          expectedDate: br(settlement.expectedDate),
          depositDate: br(settlement.depositDate),
          receivedNet: brl(settlement.receivedNet),
        },
      });
    });
  }

  /** Parcelas e taxas em aberto do depósito (forma, data prevista e conta), travadas. */
  private async lockGroup(tx: Executor, auth: AuthContext, input: ReconcileInput) {
    const ids = await tx
      .select({ id: financialEntries.id })
      .from(financialEntries)
      .innerJoin(saleReceivables, eq(saleReceivables.id, financialEntries.saleReceivableId))
      .innerJoin(salePayments, eq(salePayments.id, saleReceivables.salePaymentId))
      .where(
        and(
          eq(financialEntries.organizationId, auth.organizationId),
          eq(financialEntries.status, 'open'),
          inArray(financialEntries.origin, ['sale', 'card_fee']),
          eq(financialEntries.accountId, input.accountId),
          eq(financialEntries.dueDate, input.expectedDate),
          eq(salePayments.paymentMethodId, input.paymentMethodId),
          inArray(salePayments.kind, [...acquirerKinds]),
        ),
      );
    if (ids.length === 0) return [];
    return tx
      .select()
      .from(financialEntries)
      .where(
        and(
          inArray(
            financialEntries.id,
            ids.map((r) => r.id),
          ),
          eq(financialEntries.status, 'open'),
        ),
      )
      .for('update');
  }
}
