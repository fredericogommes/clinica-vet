import { isPermission, type Permission } from '@clinica/contracts';
import { asc, eq } from 'drizzle-orm';
import type { Executor } from '../db/client.js';
import { rolePermissions } from '../db/schema.js';

/** Chaves do perfil em ordem estável, para comparação e auditoria. */
export async function loadRolePermissions(db: Executor, roleId: string): Promise<Permission[]> {
  const rows = await db
    .select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, roleId))
    .orderBy(asc(rolePermissions.permission));
  // Chaves removidas do catálogo deixam de valer mesmo que ainda estejam gravadas.
  return rows.map((r) => r.permission).filter(isPermission);
}
