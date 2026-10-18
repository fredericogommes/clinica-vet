import {
  claimStatusLabels,
  fromCents,
  toCents,
  type Claim,
  type ClaimList,
  type ClaimListQuery,
  type GlossClaimInput,
  type ReconcileClaimsInput,
} from '@clinica/contracts';
import { and, asc, eq, gte, inArray, lte, ne, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { actorOf } from '../../core/actor.js';
import { recordAudit } from '../../core/audit.js';
import { AppError, conflict, notFound } from '../../core/errors.js';
import { instantToZoned } from '../../core/zoned-time.js';
import type { Database, Executor } from '../../db/client.js';
import {
  clients,
  financialEntries,
  insurerClaims,
  insurers,
  patients,
  saleItems,
  sales,
  users,
} from '../../db/schema.js';
import type { AuthContext } from '../auth/sessions.js';
import { unitTimeZone } from '../scheduling/availability.js';

type ClaimRow = typeof insurerClaims.$inferSelect;

const brl = (value: number) =>
  `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const invalid = (path: string, message: string) =>
  new AppError('validation_failed', 'Dados do repasse inválidos.', [{ path, message }]);

/**
 * Repasses dos convênios [p.20, RN-43]: os procedimentos cobertos por data, conciliados quando o
 * dinheiro cai e glosados (total ou em parte) com motivo. Cada repasse tem a sua receita a
 * receber no financeiro, que fica paga na conciliação e diminui ou é cancelada na glosa.
 */
export class ClaimService {
  constructor(private readonly db: Database) {}

  async list(auth: AuthContext, query: ClaimListQuery, executor?: Executor): Promise<ClaimList> {
    const filters: SQL[] = [
      eq(insurerClaims.organizationId, auth.organizationId),
      ne(insurerClaims.status, 'cancelled'),
      gte(insurerClaims.serviceDate, query.from),
      lte(insurerClaims.serviceDate, query.to),
    ];
    if (query.insurerId) filters.push(eq(insurerClaims.insurerId, query.insurerId));
    const reconciler = alias(users, 'reconciler');
    const rows = await (executor ?? this.db)
      .select({
        claim: insurerClaims,
        insurerName: insurers.name,
        saleCode: sales.code,
        cardNumber: sales.insuranceCardNumber,
        client: clients.name,
        patient: patients.name,
        procedure: saleItems.name,
        authorizationCode: saleItems.authorizationCode,
        professional: users.name,
        reconciledBy: reconciler.name,
      })
      .from(insurerClaims)
      .innerJoin(insurers, eq(insurers.id, insurerClaims.insurerId))
      .innerJoin(sales, eq(sales.id, insurerClaims.saleId))
      .innerJoin(saleItems, eq(saleItems.id, insurerClaims.saleItemId))
      .innerJoin(users, eq(users.id, saleItems.professionalId))
      .leftJoin(clients, eq(clients.id, sales.clientId))
      .leftJoin(patients, eq(patients.id, sales.patientId))
      .leftJoin(reconciler, eq(reconciler.id, insurerClaims.reconciledBy))
      .where(and(...filters))
      .orderBy(asc(insurerClaims.serviceDate), asc(sales.code), asc(saleItems.position));
    const items: Claim[] = rows.map((r) => {
      const c = r.claim;
      return {
        id: c.id,
        insurer: { id: c.insurerId, name: r.insurerName },
        saleId: c.saleId,
        saleCode: r.saleCode,
        serviceDate: c.serviceDate,
        dueDate: c.dueDate,
        client: r.client ?? '',
        patient: r.patient ?? '',
        cardNumber: r.cardNumber ?? '',
        procedure: r.procedure,
        professional: r.professional,
        authorizationCode: r.authorizationCode,
        amount: c.amount,
        glossAmount: c.glossAmount,
        glossReason: c.glossReason,
        expected: fromCents(toCents(c.amount) - toCents(c.glossAmount)),
        status: c.status,
        reconciledOn: c.reconciledOn,
        reconciledBy: r.reconciledBy,
      };
    });
    const sum = (list: Claim[], pick: (c: Claim) => number) => ({
      count: list.length,
      amount: fromCents(list.reduce((a, c) => a + toCents(pick(c)), 0)),
    });
    const db = executor ?? this.db;
    const options = await db
      .select({ id: insurers.id, name: insurers.name })
      .from(insurers)
      .where(eq(insurers.organizationId, auth.organizationId))
      .orderBy(asc(insurers.name));
    const today = instantToZoned(new Date(), await unitTimeZone(db, auth.unitId)).date;
    const pending = items.filter((c) => c.status === 'pending');
    const reconciled = items.filter((c) => c.status === 'reconciled');
    const glossed = items.filter((c) => c.glossAmount > 0);
    const shown =
      query.status === 'all'
        ? items
        : query.status === 'glossed'
          ? glossed
          : query.status === 'pending'
            ? pending
            : reconciled;
    return {
      totals: {
        all: sum(items, (c) => c.expected),
        pending: sum(pending, (c) => c.expected),
        reconciled: sum(reconciled, (c) => c.expected),
        glossed: sum(glossed, (c) => c.glossAmount),
      },
      items: shown,
      insurers: options,
      today,
    };
  }

  /** Conciliar: o repasse caiu na data informada; as receitas ficam pagas pelo valor esperado. */
  async reconcile(auth: AuthContext, input: ReconcileClaimsInput): Promise<{ count: number }> {
    return this.db.transaction(async (tx) => {
      const today = instantToZoned(new Date(), await unitTimeZone(tx, auth.unitId)).date;
      if (input.receivedOn > today) {
        throw invalid('receivedOn', 'O repasse não pode ter caído no futuro');
      }
      const ids = [...new Set(input.claimIds)];
      const rows = await this.lockMany(tx, auth, ids);
      for (const c of rows) {
        if (c.status !== 'pending') {
          throw conflict(
            `Só procedimento não conciliado é conciliado; um dos escolhidos está ${claimStatusLabels[c.status].toLowerCase()}.`,
          );
        }
        if (input.receivedOn < c.serviceDate) {
          throw invalid('receivedOn', 'O repasse não cai antes do atendimento');
        }
      }
      const now = new Date();
      await tx
        .update(insurerClaims)
        .set({ status: 'reconciled', reconciledOn: input.receivedOn, reconciledBy: auth.userId })
        .where(inArray(insurerClaims.id, ids));
      for (const c of rows) {
        if (!c.financialEntryId) continue;
        const expected = fromCents(toCents(c.amount) - toCents(c.glossAmount));
        await tx
          .update(financialEntries)
          .set({
            status: 'paid',
            paidOn: input.receivedOn,
            paidAmount: expected,
            paidBy: auth.userId,
            updatedAt: now,
          })
          .where(eq(financialEntries.id, c.financialEntryId));
      }
      for (const c of rows) {
        await recordAudit(tx, actorOf(auth), {
          entity: 'insurer_claim',
          entityId: c.id,
          action: 'reconcile',
          before: { status: claimStatusLabels.pending },
          after: {
            status: claimStatusLabels.reconciled,
            amount: brl(fromCents(toCents(c.amount) - toCents(c.glossAmount))),
            receivedOn: input.receivedOn,
          },
        });
      }
      return { count: rows.length };
    });
  }

  /** Desfaz a conciliação: o procedimento volta a não conciliado e a receita, a aberta. */
  async undo(auth: AuthContext, id: string): Promise<Claim> {
    return this.db.transaction(async (tx) => {
      const [c] = await this.lockMany(tx, auth, [id]);
      if (!c) throw notFound('Repasse');
      if (c.status !== 'reconciled') throw conflict('Este procedimento não está conciliado.');
      await tx
        .update(insurerClaims)
        .set({ status: 'pending', reconciledOn: null, reconciledBy: null })
        .where(eq(insurerClaims.id, id));
      if (c.financialEntryId) {
        await tx
          .update(financialEntries)
          .set({
            status: 'open',
            paidOn: null,
            paidAmount: null,
            paidBy: null,
            updatedAt: new Date(),
          })
          .where(eq(financialEntries.id, c.financialEntryId));
      }
      await recordAudit(tx, actorOf(auth), {
        entity: 'insurer_claim',
        entityId: id,
        action: 'undo_reconcile',
        before: { status: claimStatusLabels.reconciled, receivedOn: c.reconciledOn },
        after: { status: claimStatusLabels.pending },
      });
      return this.one(tx, auth, id);
    });
  }

  /**
   * Glosa: o convênio recusou o procedimento, inteiro ou em parte, com motivo. A glosa total
   * encerra o repasse e cancela a receita; a parcial reduz o que falta receber.
   */
  async gloss(auth: AuthContext, id: string, input: GlossClaimInput): Promise<Claim> {
    return this.db.transaction(async (tx) => {
      const [c] = await this.lockMany(tx, auth, [id]);
      if (!c) throw notFound('Repasse');
      if (c.status !== 'pending') {
        throw conflict(
          c.status === 'reconciled'
            ? 'Procedimento conciliado: desfaça a conciliação antes de glosar.'
            : `Procedimento ${claimStatusLabels[c.status].toLowerCase()} não recebe glosa.`,
        );
      }
      const open = toCents(c.amount) - toCents(c.glossAmount);
      const glossCents = toCents(input.amount);
      if (glossCents > open) {
        throw invalid('amount', `A glosa passa do que falta receber (${brl(fromCents(open))})`);
      }
      const totalGloss = toCents(c.glossAmount) + glossCents;
      const full = totalGloss === toCents(c.amount);
      const reason = c.glossReason ? `${c.glossReason}; ${input.reason}` : input.reason;
      const now = new Date();
      await tx
        .update(insurerClaims)
        .set({
          glossAmount: fromCents(totalGloss),
          glossReason: reason,
          glossedAt: now,
          glossedBy: auth.userId,
          status: full ? 'glossed' : 'pending',
        })
        .where(eq(insurerClaims.id, id));
      if (c.financialEntryId) {
        await tx
          .update(financialEntries)
          .set(
            full
              ? {
                  status: 'cancelled',
                  cancelReason: `Glosa do convênio: ${input.reason}`,
                  cancelledAt: now,
                  updatedAt: now,
                }
              : { amount: fromCents(open - glossCents), updatedAt: now },
          )
          .where(eq(financialEntries.id, c.financialEntryId));
      }
      await recordAudit(tx, actorOf(auth), {
        entity: 'insurer_claim',
        entityId: id,
        action: 'gloss',
        before: { glossAmount: brl(c.glossAmount), expected: brl(fromCents(open)) },
        after: {
          glossAmount: brl(fromCents(totalGloss)),
          expected: brl(fromCents(open - glossCents)),
          reason: input.reason,
        },
      });
      return this.one(tx, auth, id);
    });
  }

  private async lockMany(tx: Executor, auth: AuthContext, ids: string[]): Promise<ClaimRow[]> {
    const rows = await tx
      .select()
      .from(insurerClaims)
      .where(
        and(inArray(insurerClaims.id, ids), eq(insurerClaims.organizationId, auth.organizationId)),
      )
      .orderBy(asc(insurerClaims.id))
      .for('update');
    if (rows.length !== ids.length) throw notFound('Repasse');
    return rows;
  }

  private async one(tx: Executor, auth: AuthContext, id: string): Promise<Claim> {
    const [c] = await tx.select().from(insurerClaims).where(eq(insurerClaims.id, id));
    if (!c) throw notFound('Repasse');
    const list = await this.list(
      auth,
      { from: c.serviceDate, to: c.serviceDate, status: 'all' },
      tx,
    );
    const found = list.items.find((x) => x.id === id);
    if (!found) throw notFound('Repasse');
    return found;
  }
}
