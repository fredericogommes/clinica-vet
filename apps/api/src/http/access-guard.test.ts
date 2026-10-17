import { allPermissions } from '@clinica/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, createHarness, TestClient, type Harness } from '../test/harness.js';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

describe('controle de acesso no servidor', () => {
  it('impede a aplicação de subir com rota sem declaração de acesso', async () => {
    const Fastify = (await import('fastify')).default;
    const { accessGuard } = await import('./access-guard.js');
    const { SessionService } = await import('../modules/auth/sessions.js');
    const app = Fastify();
    const { PortalSessionService } = await import('../modules/portal/sessions.js');
    await app.register(accessGuard, {
      sessions: new SessionService(h.db, 1000),
      portalSessions: new PortalSessionService(h.db, 1000),
    });
    expect(() => app.get('/api/esquecida', async () => 'ok')).toThrow(/sem declaração de acesso/);
    await app.close();
  });

  it('rejeita requisição sem sessão antes de validar o corpo', async () => {
    const res = await h.app.inject({ method: 'POST', url: '/api/admin/users', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('nega por padrão quando o perfil não tem a chave da ação', async () => {
    const admin = new TestClient(h.app);
    await admin.login(ADMIN.email, ADMIN.password);
    const roles = (await admin.get('/api/admin/roles')).json<{ id: string; name: string }[]>();
    const vet = roles.find((r) => r.name === 'Veterinário');
    await admin.send('POST', '/api/admin/users', {
      name: 'Vera Vet',
      email: 'vera@clinica.test',
      password: 'outra-senha-123',
      roleId: vet?.id,
      unitIds: [h.org.unitId],
    });

    const vetClient = new TestClient(h.app);
    expect((await vetClient.login('vera@clinica.test', 'outra-senha-123')).statusCode).toBe(204);
    for (const url of ['/api/admin/roles', '/api/admin/users', '/api/admin/audit']) {
      expect((await vetClient.get(url)).statusCode, url).toBe(403);
    }
  });

  it('isola dados entre organizações', async () => {
    const { provisionOrganization } = await import('../modules/admin/provisioning.js');
    await h.db.transaction((tx) =>
      provisionOrganization(tx, {
        organizationName: 'Outra Clínica',
        unitName: 'Sede',
        admin: { name: 'Bruno', email: 'bruno@outra.test', password: 'senha-forte-456' },
      }),
    );
    const other = new TestClient(h.app);
    await other.login('bruno@outra.test', 'senha-forte-456');
    const users = (await other.get('/api/admin/users')).json<{ email: string }[]>();
    expect(users.map((u) => u.email)).toEqual(['bruno@outra.test']);

    const ourRoles = await (async () => {
      const c = new TestClient(h.app);
      await c.login(ADMIN.email, ADMIN.password);
      return (await c.get('/api/admin/roles')).json<{ id: string; isTemplate: boolean }[]>();
    })();
    const res = await other.send('POST', `/api/admin/roles/${ourRoles[0]?.id}/clone`, {
      name: 'Invasor',
    });
    expect(res.statusCode).toBe(404);
  });

  it('o perfil Administrador do sistema recebe todas as chaves do catálogo', async () => {
    const client = new TestClient(h.app);
    await client.login(ADMIN.email, ADMIN.password);
    const session = (await client.get('/api/auth/session')).json<{ permissions: string[] }>();
    expect(session.permissions).toEqual([...allPermissions].sort());
  });
});
