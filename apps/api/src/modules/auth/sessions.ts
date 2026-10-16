import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Permission, Session } from '@clinica/contracts';
import { and, asc, eq, gt, isNull, lt } from 'drizzle-orm';
import { loadRolePermissions } from '../../core/access.js';
import { recordAudit } from '../../core/audit.js';
import { AppError } from '../../core/errors.js';
import { LoginThrottle } from '../../core/login-throttle.js';
import { timingSafeDummyHash, verifyPassword } from '../../core/passwords.js';
import type { Database } from '../../db/client.js';
import { organizations, sessions, units, userUnits, users } from '../../db/schema.js';

export interface AuthContext {
  userId: string;
  organizationId: string;
  unitId: string;
  permissions: ReadonlySet<Permission>;
  csrfToken: string;
  tokenHash: string;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const randomToken = () => randomBytes(32).toString('base64url');

export function tokensMatch(expected: string, received: string | undefined): boolean {
  if (received === undefined) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

const invalidCredentials = () => new AppError('unauthenticated', 'E-mail ou senha inválidos.');

export class SessionService {
  constructor(
    private readonly db: Database,
    private readonly ttlMs: number,
    private readonly throttle = new LoginThrottle(),
  ) {}

  /** Retorna o token do cookie. Mensagem idêntica para e-mail inexistente, inativo ou senha errada. */
  async login(email: string, password: string): Promise<{ token: string; expiresAt: Date }> {
    const key = email.toLowerCase();
    if (this.throttle.isBlocked(key)) {
      throw new AppError(
        'rate_limited',
        'Muitas tentativas com este e-mail. Aguarde 15 minutos ou peça ao administrador para redefinir a senha.',
      );
    }
    const [user] = await this.db
      .select({
        id: users.id,
        organizationId: users.organizationId,
        passwordHash: users.passwordHash,
        active: users.active,
      })
      .from(users)
      .where(eq(users.email, key));

    if (!user) {
      await verifyPassword(await timingSafeDummyHash(), password);
      this.throttle.recordFailure(key);
      throw invalidCredentials();
    }
    const valid = await verifyPassword(user.passwordHash, password);
    if (!valid || !user.active) {
      this.throttle.recordFailure(key);
      throw invalidCredentials();
    }
    this.throttle.reset(key);

    const [firstUnit] = await this.db
      .select({ id: units.id })
      .from(userUnits)
      .innerJoin(units, eq(units.id, userUnits.unitId))
      .where(and(eq(userUnits.userId, user.id), isNull(units.archivedAt)))
      .orderBy(asc(units.name))
      .limit(1);
    if (!firstUnit) throw new AppError('forbidden', 'Usuário sem unidade ativa vinculada.');

    const token = randomToken();
    const expiresAt = new Date(Date.now() + this.ttlMs);
    await this.db.transaction(async (tx) => {
      await tx.delete(sessions).where(lt(sessions.expiresAt, new Date()));
      await tx.insert(sessions).values({
        tokenHash: hashToken(token),
        userId: user.id,
        currentUnitId: firstUnit.id,
        csrfToken: randomToken(),
        expiresAt,
      });
      await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      await recordAudit(
        tx,
        { organizationId: user.organizationId, unitId: firstUnit.id, userId: user.id },
        { entity: 'session', entityId: user.id, action: 'login' },
      );
    });
    return { token, expiresAt };
  }

  /** Valida o token, renova a expiração (sessão deslizante) e carrega as permissões atuais. */
  async authenticate(token: string): Promise<AuthContext | null> {
    const tokenHash = hashToken(token);
    const now = new Date();
    const [row] = await this.db
      .select({
        userId: users.id,
        organizationId: users.organizationId,
        roleId: users.roleId,
        unitId: sessions.currentUnitId,
        csrfToken: sessions.csrfToken,
        lastSeenAt: sessions.lastSeenAt,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .innerJoin(
        userUnits,
        and(eq(userUnits.userId, users.id), eq(userUnits.unitId, sessions.currentUnitId)),
      )
      .innerJoin(units, and(eq(units.id, sessions.currentUnitId), isNull(units.archivedAt)))
      .where(
        and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now), eq(users.active, true)),
      );
    if (!row) return null;

    // Evita uma escrita por requisição: renova no máximo uma vez por minuto.
    if (now.getTime() - row.lastSeenAt.getTime() > 60_000) {
      await this.db
        .update(sessions)
        .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + this.ttlMs) })
        .where(eq(sessions.tokenHash, tokenHash));
    }
    return {
      userId: row.userId,
      organizationId: row.organizationId,
      unitId: row.unitId,
      permissions: new Set(await loadRolePermissions(this.db, row.roleId)),
      csrfToken: row.csrfToken,
      tokenHash,
    };
  }

  async logout(auth: AuthContext): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, auth.tokenHash));
  }

  async switchUnit(auth: AuthContext, unitId: string): Promise<void> {
    const [allowed] = await this.db
      .select({ unitId: userUnits.unitId })
      .from(userUnits)
      .innerJoin(units, eq(units.id, userUnits.unitId))
      .where(
        and(
          eq(userUnits.userId, auth.userId),
          eq(userUnits.unitId, unitId),
          isNull(units.archivedAt),
        ),
      );
    if (!allowed) throw new AppError('forbidden', 'Você não tem acesso a esta unidade.');
    await this.db
      .update(sessions)
      .set({ currentUnitId: unitId })
      .where(eq(sessions.tokenHash, auth.tokenHash));
  }

  async describe(auth: AuthContext): Promise<Session> {
    const [user] = await this.db
      .select({ id: users.id, name: users.name, email: users.email, orgName: organizations.name })
      .from(users)
      .innerJoin(organizations, eq(organizations.id, users.organizationId))
      .where(eq(users.id, auth.userId));
    if (!user) throw new AppError('unauthenticated', 'Sessão inválida.');
    const userUnitRows = await this.db
      .select({ id: units.id, name: units.name })
      .from(userUnits)
      .innerJoin(units, eq(units.id, userUnits.unitId))
      .where(and(eq(userUnits.userId, auth.userId), isNull(units.archivedAt)))
      .orderBy(asc(units.name));
    const currentUnit = userUnitRows.find((u) => u.id === auth.unitId);
    if (!currentUnit) throw new AppError('unauthenticated', 'Sessão inválida.');
    return {
      user: { id: user.id, name: user.name, email: user.email },
      organization: { id: auth.organizationId, name: user.orgName },
      currentUnit,
      units: userUnitRows,
      permissions: [...auth.permissions].sort(),
      csrfToken: auth.csrfToken,
    };
  }
}
