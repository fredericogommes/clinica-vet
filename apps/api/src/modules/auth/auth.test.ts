import type { ApiError, Session } from '@clinica/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, createHarness, TestClient, type Harness } from '../../test/harness.js';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

describe('login e sessão', () => {
  it('autentica com e-mail em qualquer caixa e devolve a sessão com permissões e unidade', async () => {
    const client = new TestClient(h.app);
    const res = await client.login('ANA@clinica.test', ADMIN.password);
    expect(res.statusCode).toBe(204);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const session = (await client.get('/api/auth/session')).json<Session>();
    expect(session.user.email).toBe(ADMIN.email);
    expect(session.currentUnit.name).toBe('Matriz');
    expect(session.permissions).toContain('admin.roles.manage');
  });

  it('responde igual para senha errada e e-mail inexistente', async () => {
    const wrongPassword = await new TestClient(h.app).login(ADMIN.email, 'errada-errada');
    const unknownEmail = await new TestClient(h.app).login('ninguem@clinica.test', 'errada-errada');
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(unknownEmail.json());
  });

  it('valida o corpo do login com mensagens por campo', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'x' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<ApiError>();
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details?.map((d) => d.path)).toEqual(
      expect.arrayContaining(['email', 'password']),
    );
  });

  it('limita tentativas de login por minuto', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await new TestClient(h.app).login(ADMIN.email, 'errada-errada')).statusCode);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('logout invalida a sessão no servidor', async () => {
    const client = new TestClient(h.app);
    await client.login(ADMIN.email, ADMIN.password);
    expect((await client.send('POST', '/api/auth/logout')).statusCode).toBe(204);
    expect((await client.get('/api/auth/session')).statusCode).toBe(401);
  });

  it('rejeita escrita sem token CSRF', async () => {
    const client = new TestClient(h.app);
    await client.login(ADMIN.email, ADMIN.password);
    const res = await client.send('POST', '/api/auth/logout', undefined, { csrf: false });
    expect(res.statusCode).toBe(403);
    expect(res.json<ApiError>().error.code).toBe('csrf_invalid');
  });

  it('não permite trocar para unidade sem vínculo', async () => {
    const client = new TestClient(h.app);
    await client.login(ADMIN.email, ADMIN.password);
    const res = await client.send('POST', '/api/auth/unit', {
      unitId: '0192f3c0-0000-7000-8000-000000000000',
    });
    expect(res.statusCode).toBe(403);
  });

  it('não grava o token de sessão em claro', async () => {
    const client = new TestClient(h.app);
    const res = await client.login(ADMIN.email, ADMIN.password);
    const token = String(res.headers['set-cookie']).split(';')[0]?.split('=')[1];
    const rows = await h.db.query.sessions.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).not.toBe(token);
  });
});
