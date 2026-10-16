import type { Executor } from '../db/client.js';
import { auditLog } from '../db/schema.js';
import { newId } from './ids.js';

export interface Actor {
  organizationId: string;
  unitId: string | null;
  userId: string | null;
}

export interface AuditRecord {
  entity: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
}

/** Deve ser chamado na mesma transação da escrita auditada. */
export async function recordAudit(tx: Executor, actor: Actor, record: AuditRecord): Promise<void> {
  await tx.insert(auditLog).values({
    id: newId(),
    organizationId: actor.organizationId,
    unitId: actor.unitId,
    actorUserId: actor.userId,
    entity: record.entity,
    entityId: record.entityId,
    action: record.action,
    before: record.before ?? null,
    after: record.after ?? null,
  });
}
