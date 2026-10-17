import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { recordAudit } from '../../core/audit.js';
import { AppError } from '../../core/errors.js';
import { LoginThrottle } from '../../core/login-throttle.js';
import { timingSafeDummyHash, verifyPassword } from '../../core/passwords.js';
import type { Database, Executor } from '../../db/client.js';
import { clients, portalAccounts, portalSessions, portalSettings } from '../../db/schema.js';

/** Quem está no portal: sempre um cliente só; toda leitura do tutor é filtrada por ele. */
export interface PortalContext {
  accountId: string;
  clientId: string;
  organizationId: string;
  csrfToken: string;
  tokenHash: string;
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');

const invalidCredentials = () => new AppError('unauthenticated', 'E-mail ou senha inválidos.');
export const portalClosed = () =>
  new AppError('forbidden', 'O portal da clínica está fechado no momento. Fale com a clínica.');

/**
 * Sessão do tutor, separada da sessão da equipe: outra tabela, outro cookie e outro limite de
 * tentativas. Um token de portal nunca abre rota da equipe, e o contrário também vale.
 */
export class PortalSessionService {
  constructor(
    private readonly db: Database,
    readonly ttlMs: number,
    private readonly throttle = new LoginThrottle(),
  ) {}

  async login(email: string, password: string): Promise<string> {
    const key = email.toLowerCase();
    if (this.throttle.isBlocked(key)) {
      throw new AppError(
        'rate_limited',
        'Muitas tentativas com este e-mail. Aguarde 15 minutos ou peça à clínica um link para trocar a senha.',
      );
    }
    const [account] = await this.db
      .select({
        id: portalAccounts.id,
        organizationId: portalAccounts.organizationId,
        passwordHash: portalAccounts.passwordHash,
        active: portalAccounts.active,
        archivedAt: clients.archivedAt,
      })
      .from(portalAccounts)
      .innerJoin(clients, eq(clients.id, portalAccounts.clientId))
      .where(eq(portalAccounts.email, key));
    // Conta sem senha (convite não aceito) se comporta como e-mail inexistente.
    const valid = await verifyPassword(
      account?.passwordHash ?? (await timingSafeDummyHash()),
      password,
    );
    if (!account?.passwordHash || !valid || !account.active || account.archivedAt) {
      this.throttle.recordFailure(key);
      throw invalidCredentials();
    }
    this.throttle.reset(key);
    if (!(await isPortalEnabled(this.db, account.organizationId))) throw portalClosed();
    return this.db.transaction(async (tx) => {
      await recordAudit(
        tx,
        { organizationId: account.organizationId, unitId: null, userId: null },
        { entity: 'portal_account', entityId: account.id, action: 'login' },
      );
      return this.start(tx, account.id);
    });
  }

  /** Abre uma sessão para a conta; usado no login e ao criar a senha pelo link. */
  async start(tx: Executor, accountId: string): Promise<string> {
    const token = randomToken();
    await tx.delete(portalSessions).where(lt(portalSessions.expiresAt, new Date()));
    await tx.insert(portalSessions).values({
      tokenHash: hashToken(token),
      accountId,
      csrfToken: randomToken(),
      expiresAt: new Date(Date.now() + this.ttlMs),
    });
    await tx
      .update(portalAccounts)
      .set({ lastLoginAt: new Date() })
      .where(eq(portalAccounts.id, accountId));
    return token;
  }

  /**
   * Valida o token e renova a validade. Conta bloqueada, cliente arquivado ou portal desligado
   * derrubam a sessão na hora, sem esperar a expiração.
   */
  async authenticate(token: string): Promise<PortalContext | null> {
    const tokenHash = hashToken(token);
    const now = new Date();
    const [row] = await this.db
      .select({
        accountId: portalAccounts.id,
        clientId: portalAccounts.clientId,
        organizationId: portalAccounts.organizationId,
        csrfToken: portalSessions.csrfToken,
        lastSeenAt: portalSessions.lastSeenAt,
      })
      .from(portalSessions)
      .innerJoin(portalAccounts, eq(portalAccounts.id, portalSessions.accountId))
      .innerJoin(clients, eq(clients.id, portalAccounts.clientId))
      .innerJoin(portalSettings, eq(portalSettings.organizationId, portalAccounts.organizationId))
      .where(
        and(
          eq(portalSessions.tokenHash, tokenHash),
          gt(portalSessions.expiresAt, now),
          eq(portalAccounts.active, true),
          isNull(clients.archivedAt),
          eq(portalSettings.enabled, true),
        ),
      );
    if (!row) return null;
    if (now.getTime() - row.lastSeenAt.getTime() > 60_000) {
      await this.db
        .update(portalSessions)
        .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + this.ttlMs) })
        .where(eq(portalSessions.tokenHash, tokenHash));
    }
    return {
      accountId: row.accountId,
      clientId: row.clientId,
      organizationId: row.organizationId,
      csrfToken: row.csrfToken,
      tokenHash,
    };
  }

  async logout(ctx: PortalContext): Promise<void> {
    await this.db.delete(portalSessions).where(eq(portalSessions.tokenHash, ctx.tokenHash));
  }
}

export async function isPortalEnabled(db: Executor, organizationId: string): Promise<boolean> {
  const [row] = await db
    .select({ enabled: portalSettings.enabled })
    .from(portalSettings)
    .where(eq(portalSettings.organizationId, organizationId));
  return row?.enabled ?? false;
}
