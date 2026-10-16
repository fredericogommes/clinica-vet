import type {
  AuditEntry,
  CreateUserRequest,
  Permission,
  Role,
  UpdateRoleRequest,
  UpdateUserRequest,
  User,
} from '@clinica/contracts';
import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { loadRolePermissions } from '../../core/access.js';
import { recordAudit, type Actor } from '../../core/audit.js';
import { AppError, conflict, notFound } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import { hashPassword } from '../../core/passwords.js';
import type { Database, Executor } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import {
  auditLog,
  organizations,
  rolePermissions,
  roles,
  units,
  userUnits,
  users,
} from '../../db/schema.js';
import type { AuthContext } from '../auth/sessions.js';

/** Permissões que garantem que a organização continue administrável. */
const ADMIN_PERMISSIONS: readonly Permission[] = ['admin.roles.manage', 'admin.users.manage'];

const actorOf = (auth: AuthContext): Actor => ({
  organizationId: auth.organizationId,
  unitId: auth.unitId,
  userId: auth.userId,
});

export class AdminService {
  constructor(private readonly db: Database) {}

  async listRoles(auth: AuthContext): Promise<Role[]> {
    const rows = await this.db
      .select({
        id: roles.id,
        name: roles.name,
        description: roles.description,
        isTemplate: roles.isTemplate,
        userCount: sql<number>`(select count(*)::int from ${users} where ${users.roleId} = ${roles.id})`,
      })
      .from(roles)
      .where(eq(roles.organizationId, auth.organizationId))
      .orderBy(desc(roles.isTemplate), asc(roles.name));
    const perms = rows.length
      ? await this.db
          .select()
          .from(rolePermissions)
          .where(
            inArray(
              rolePermissions.roleId,
              rows.map((r) => r.id),
            ),
          )
      : [];
    return rows.map((r) => ({
      ...r,
      permissions: perms
        .filter((p) => p.roleId === r.id)
        .map((p) => p.permission as Permission)
        .sort(),
    }));
  }

  async cloneRole(auth: AuthContext, sourceId: string, name: string): Promise<Role> {
    const id = newId();
    await this.inTransaction(auth, async (tx) => {
      const source = await this.findRole(tx, auth, sourceId);
      const permissions = await loadRolePermissions(tx, source.id);
      await tx.insert(roles).values({
        id,
        organizationId: auth.organizationId,
        name,
        description: source.description,
        isTemplate: false,
      });
      if (permissions.length) {
        await tx
          .insert(rolePermissions)
          .values(permissions.map((permission) => ({ roleId: id, permission })));
      }
      await recordAudit(tx, actorOf(auth), {
        entity: 'role',
        entityId: id,
        action: 'clone',
        after: { name, clonedFrom: source.name, permissions },
      });
    });
    return this.getRole(auth, id);
  }

  async updateRole(auth: AuthContext, roleId: string, input: UpdateRoleRequest): Promise<Role> {
    await this.inTransaction(auth, async (tx) => {
      const role = await this.findRole(tx, auth, roleId);
      if (role.isTemplate) {
        throw conflict(
          'Perfis-modelo não podem ser alterados. Clone o perfil para personalizá-lo.',
        );
      }
      const before = {
        name: role.name,
        description: role.description,
        permissions: await loadRolePermissions(tx, roleId),
      };
      const permissions = [...new Set(input.permissions)].sort();
      await tx
        .update(roles)
        .set({ name: input.name, description: input.description, updatedAt: new Date() })
        .where(eq(roles.id, roleId));
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
      if (permissions.length) {
        await tx
          .insert(rolePermissions)
          .values(permissions.map((permission) => ({ roleId, permission })));
      }
      await this.assertAdministrable(tx, auth.organizationId);
      await recordAudit(tx, actorOf(auth), {
        entity: 'role',
        entityId: roleId,
        action: 'update',
        before,
        after: { name: input.name, description: input.description, permissions },
      });
    });
    return this.getRole(auth, roleId);
  }

  async deleteRole(auth: AuthContext, roleId: string): Promise<void> {
    await this.inTransaction(auth, async (tx) => {
      const role = await this.findRole(tx, auth, roleId);
      if (role.isTemplate) throw conflict('Perfis-modelo não podem ser excluídos.');
      const [usage] = await tx.select({ n: count() }).from(users).where(eq(users.roleId, roleId));
      if ((usage?.n ?? 0) > 0)
        throw conflict('Há usuários neste perfil. Mova-os antes de excluir.');
      const permissions = await loadRolePermissions(tx, roleId);
      await tx.delete(roles).where(eq(roles.id, roleId));
      await recordAudit(tx, actorOf(auth), {
        entity: 'role',
        entityId: roleId,
        action: 'delete',
        before: { name: role.name, permissions },
      });
    });
  }

  async listUsers(auth: AuthContext): Promise<User[]> {
    const rows = await this.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        active: users.active,
        roleId: users.roleId,
        roleName: roles.name,
        lastLoginAt: users.lastLoginAt,
      })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(eq(users.organizationId, auth.organizationId))
      .orderBy(asc(users.name));
    const links = rows.length
      ? await this.db
          .select()
          .from(userUnits)
          .where(
            inArray(
              userUnits.userId,
              rows.map((r) => r.id),
            ),
          )
      : [];
    return rows.map((r) => ({
      ...r,
      lastLoginAt: r.lastLoginAt?.toISOString() ?? null,
      unitIds: links.filter((l) => l.userId === r.id).map((l) => l.unitId),
    }));
  }

  async createUser(auth: AuthContext, input: CreateUserRequest): Promise<User> {
    const id = newId();
    const passwordHash = await hashPassword(input.password);
    await this.inTransaction(auth, async (tx) => {
      await this.findRole(tx, auth, input.roleId);
      await this.assertUnits(tx, auth, input.unitIds);
      try {
        await tx.insert(users).values({
          id,
          organizationId: auth.organizationId,
          roleId: input.roleId,
          name: input.name,
          email: input.email,
          passwordHash,
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw conflict('Já existe um usuário com este e-mail.');
        throw error;
      }
      await tx.insert(userUnits).values(input.unitIds.map((unitId) => ({ userId: id, unitId })));
      await recordAudit(tx, actorOf(auth), {
        entity: 'user',
        entityId: id,
        action: 'create',
        after: await this.userSnapshot(tx, auth, id),
      });
    });
    return this.getUser(auth, id);
  }

  async updateUser(auth: AuthContext, userId: string, input: UpdateUserRequest): Promise<User> {
    if (userId === auth.userId && !input.active) {
      throw conflict('Você não pode desativar o seu próprio usuário.');
    }
    await this.inTransaction(auth, async (tx) => {
      const before = await this.userSnapshot(tx, auth, userId);
      await this.findRole(tx, auth, input.roleId);
      await this.assertUnits(tx, auth, input.unitIds);
      await tx
        .update(users)
        .set({
          name: input.name,
          active: input.active,
          roleId: input.roleId,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
      await tx.delete(userUnits).where(eq(userUnits.userId, userId));
      await tx.insert(userUnits).values(input.unitIds.map((unitId) => ({ userId, unitId })));
      await this.assertAdministrable(tx, auth.organizationId);
      await recordAudit(tx, actorOf(auth), {
        entity: 'user',
        entityId: userId,
        action: 'update',
        before,
        after: await this.userSnapshot(tx, auth, userId),
      });
    });
    return this.getUser(auth, userId);
  }

  async listAudit(
    auth: AuthContext,
    page: number,
    pageSize: number,
  ): Promise<{ items: AuditEntry[]; total: number }> {
    const where = eq(auditLog.organizationId, auth.organizationId);
    const [rows, totals] = await Promise.all([
      this.db
        .select({
          id: auditLog.id,
          occurredAt: auditLog.occurredAt,
          actorName: users.name,
          entity: auditLog.entity,
          entityId: auditLog.entityId,
          action: auditLog.action,
          before: auditLog.before,
          after: auditLog.after,
        })
        .from(auditLog)
        .leftJoin(users, eq(users.id, auditLog.actorUserId))
        .where(where)
        .orderBy(desc(auditLog.occurredAt), desc(auditLog.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.db.select({ n: count() }).from(auditLog).where(where),
    ]);
    return {
      items: rows.map((r) => ({ ...r, occurredAt: r.occurredAt.toISOString() })),
      total: totals[0]?.n ?? 0,
    };
  }

  private async getRole(auth: AuthContext, roleId: string): Promise<Role> {
    const role = (await this.listRoles(auth)).find((r) => r.id === roleId);
    if (!role) throw notFound('Perfil');
    return role;
  }

  private async getUser(auth: AuthContext, userId: string, executor?: Executor): Promise<User> {
    const db = executor ?? this.db;
    const [row] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        active: users.active,
        roleId: users.roleId,
        roleName: roles.name,
        lastLoginAt: users.lastLoginAt,
      })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(users.id, userId), eq(users.organizationId, auth.organizationId)));
    if (!row) throw notFound('Usuário');
    const links = await db.select().from(userUnits).where(eq(userUnits.userId, userId));
    return {
      ...row,
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
      unitIds: links.map((l) => l.unitId),
    };
  }

  /** Retrato do usuário para auditoria: guarda ids e os nomes vigentes no momento da alteração. */
  private async userSnapshot(tx: Executor, auth: AuthContext, userId: string) {
    const user = await this.getUser(auth, userId, tx);
    const unitRows = await tx
      .select({ id: units.id, name: units.name })
      .from(units)
      .where(inArray(units.id, user.unitIds))
      .orderBy(asc(units.name));
    return {
      name: user.name,
      email: user.email,
      active: user.active,
      role: { id: user.roleId, name: user.roleName },
      units: unitRows,
    };
  }

  private async findRole(tx: Executor, auth: AuthContext, roleId: string) {
    const [role] = await tx
      .select()
      .from(roles)
      .where(and(eq(roles.id, roleId), eq(roles.organizationId, auth.organizationId)));
    if (!role) throw notFound('Perfil');
    return role;
  }

  private async assertUnits(tx: Executor, auth: AuthContext, unitIds: string[]): Promise<void> {
    const unique = [...new Set(unitIds)];
    const found = await tx
      .select({ id: units.id })
      .from(units)
      .where(
        and(
          inArray(units.id, unique),
          eq(units.organizationId, auth.organizationId),
          isNull(units.archivedAt),
        ),
      );
    if (found.length !== unique.length) {
      throw new AppError('validation_failed', 'Unidade inválida.', [
        { path: 'unitIds', message: 'Selecione unidades ativas desta organização' },
      ]);
    }
  }

  /** Impede que uma alteração deixe a organização sem ninguém capaz de administrar acessos. */
  private async assertAdministrable(tx: Executor, organizationId: string): Promise<void> {
    const result = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from ${users} u
      where u.organization_id = ${organizationId} and u.active
        and (select count(*) from ${rolePermissions} rp
             where rp.role_id = u.role_id and rp.permission in (${sql.join(
               ADMIN_PERMISSIONS.map((p) => sql`${p}`),
               sql`, `,
             )})) = ${ADMIN_PERMISSIONS.length}`);
    if ((result.rows[0]?.n ?? 0) === 0) {
      throw conflict('A alteração deixaria a clínica sem nenhum administrador ativo.');
    }
  }

  /** Serializa alterações administrativas da organização para que a checagem acima seja confiável. */
  private async inTransaction(
    auth: AuthContext,
    work: (tx: Executor) => Promise<void>,
  ): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        await tx
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.id, auth.organizationId))
          .for('update');
        await work(tx);
      });
    } catch (error) {
      if (!(error instanceof AppError) && isUniqueViolation(error)) {
        throw conflict('Já existe um registro com este nome.');
      }
      throw error;
    }
  }
}
