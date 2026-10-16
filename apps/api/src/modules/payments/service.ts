import { paymentKindLabels, type PaymentMethod, type PaymentMethodData } from '@clinica/contracts';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { actorOf } from '../../core/actor.js';
import { recordAudit } from '../../core/audit.js';
import { conflict, notFound } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import type { Database, Executor } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import { paymentMethods } from '../../db/schema.js';
import type { AuthContext } from '../auth/sessions.js';

type Row = typeof paymentMethods.$inferSelect;

const toMethod = (r: Row): PaymentMethod => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  acquirer: r.acquirer,
  brand: r.brand,
  settlementDays: r.settlementDays,
  maxInstallments: r.maxInstallments,
  feePercent: r.feePercent,
  archived: r.archivedAt !== null,
});

const snapshot = (m: PaymentMethod) => ({
  name: m.name,
  kind: paymentKindLabels[m.kind],
  acquirer: m.acquirer,
  cardBrand: m.brand,
  settlementDays: m.settlementDays,
  maxInstallments: m.maxInstallments,
  feePercent: m.feePercent,
  archived: m.archived,
});

/** Formas de recebimento por adquirente e bandeira [RN-27]. */
export class PaymentMethodService {
  constructor(private readonly db: Database) {}

  async list(auth: AuthContext, opts: { activeOnly: boolean }, executor?: Executor) {
    const filters = [eq(paymentMethods.organizationId, auth.organizationId)];
    if (opts.activeOnly) filters.push(isNull(paymentMethods.archivedAt));
    const rows = await (executor ?? this.db)
      .select()
      .from(paymentMethods)
      .where(and(...filters))
      .orderBy(
        sql`${paymentMethods.archivedAt} is not null`,
        asc(paymentMethods.createdAt),
        asc(paymentMethods.id),
      );
    return rows.map(toMethod);
  }

  async create(auth: AuthContext, input: PaymentMethodData): Promise<PaymentMethod> {
    return this.write(async (tx) => {
      const row: Row = {
        id: newId(),
        organizationId: auth.organizationId,
        ...fields(input),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await tx.insert(paymentMethods).values(row);
      const method = toMethod(row);
      await recordAudit(tx, actorOf(auth), {
        entity: 'payment_method',
        entityId: row.id,
        action: 'create',
        after: snapshot(method),
      });
      return method;
    });
  }

  async update(auth: AuthContext, id: string, input: PaymentMethodData): Promise<PaymentMethod> {
    return this.write(async (tx) => {
      const [current] = await tx
        .select()
        .from(paymentMethods)
        .where(
          and(eq(paymentMethods.id, id), eq(paymentMethods.organizationId, auth.organizationId)),
        )
        .for('update');
      if (!current) throw notFound('Forma de recebimento');
      const next = fields(input);
      // Arquivar de novo não muda a data original do arquivamento.
      const archivedAt = input.archived ? (current.archivedAt ?? new Date()) : null;
      const [row] = await tx
        .update(paymentMethods)
        .set({ ...next, archivedAt, updatedAt: new Date() })
        .where(eq(paymentMethods.id, id))
        .returning();
      if (!row) throw notFound('Forma de recebimento');
      const method = toMethod(row);
      await recordAudit(tx, actorOf(auth), {
        entity: 'payment_method',
        entityId: id,
        action: 'update',
        before: snapshot(toMethod(current)),
        after: snapshot(method),
      });
      return method;
    });
  }

  private async write<T>(work: (tx: Executor) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(work);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict('Já existe uma forma de recebimento com este nome.');
      }
      throw error;
    }
  }
}

function fields(input: PaymentMethodData) {
  return {
    name: input.name,
    kind: input.kind,
    acquirer: input.acquirer,
    brand: input.brand,
    settlementDays: input.settlementDays,
    maxInstallments: input.maxInstallments,
    feePercent: input.feePercent,
    archivedAt: input.archived ? new Date() : null,
  };
}
