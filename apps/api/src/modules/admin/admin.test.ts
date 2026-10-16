import type { ApiError, AuditEntry, Role, User } from '@clinica/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, createHarness, TestClient, type Harness } from '../../test/harness.js';

let h: Harness;
let client: TestClient;

beforeEach(async () => {
  h = await createHarness();
  client = new TestClient(h.app);
  await client.login(ADMIN.email, ADMIN.password);
});
afterEach(async () => {
  await h.close();
});

const roleByName = async (name: string) =>
  (await client.get('/api/admin/roles')).json<Role[]>().find((r) => r.name === name)!;

describe('perfis de acesso', () => {
  it('cria os cinco perfis-modelo', async () => {
    const roles = (await client.get('/api/admin/roles')).json<Role[]>();
    expect(
      roles
        .filter((r) => r.isTemplate)
        .map((r) => r.name)
        .sort(),
    ).toEqual([
      'Administrador do sistema',
      'Esteticista',
      'Gestor da Clínica',
      'Recepcionista',
      'Veterinário',
    ]);
  });

  it('clona um modelo com as mesmas chaves e permite editá-lo, registrando auditoria', async () => {
    const gestor = await roleByName('Gestor da Clínica');
    const clone = await client.send('POST', `/api/admin/roles/${gestor.id}/clone`, {
      name: 'Gestor AME',
    });
    expect(clone.statusCode).toBe(201);
    const cloned = clone.json<Role>();
    expect(cloned.isTemplate).toBe(false);
    expect(cloned.permissions).toEqual(gestor.permissions);

    const updated = await client.send('PUT', `/api/admin/roles/${cloned.id}`, {
      name: 'Gestor AME',
      description: 'Unidade AME',
      permissions: ['admin.users.view'],
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json<Role>().permissions).toEqual(['admin.users.view']);

    const audit = (await client.get('/api/admin/audit')).json<{ items: AuditEntry[] }>();
    const entry = audit.items.find((a) => a.entity === 'role' && a.action === 'update');
    expect(entry?.actorName).toBe(ADMIN.name);
    expect(entry?.before).toMatchObject({ permissions: gestor.permissions });
    expect(entry?.after).toMatchObject({ permissions: ['admin.users.view'] });
  });

  it('não permite editar nem excluir perfil-modelo', async () => {
    const vet = await roleByName('Veterinário');
    const res = await client.send('PUT', `/api/admin/roles/${vet.id}`, {
      name: 'Vet',
      description: null,
      permissions: [],
    });
    expect(res.statusCode).toBe(409);
    expect((await client.send('DELETE', `/api/admin/roles/${vet.id}`)).statusCode).toBe(409);
  });

  it('rejeita chave de permissão fora do catálogo', async () => {
    const vet = await roleByName('Veterinário');
    const clone = (
      await client.send('POST', `/api/admin/roles/${vet.id}/clone`, { name: 'Vet 2' })
    ).json<Role>();
    const res = await client.send('PUT', `/api/admin/roles/${clone.id}`, {
      name: 'Vet 2',
      description: null,
      permissions: ['financeiro.tudo'],
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejeita nome de perfil duplicado', async () => {
    const vet = await roleByName('Veterinário');
    const res = await client.send('POST', `/api/admin/roles/${vet.id}/clone`, {
      name: 'Recepcionista',
    });
    expect(res.statusCode).toBe(409);
  });

  it('impede que a clínica fique sem administrador', async () => {
    const adminRole = await roleByName('Administrador do sistema');
    const custom = (
      await client.send('POST', `/api/admin/roles/${adminRole.id}/clone`, { name: 'Admin próprio' })
    ).json<Role>();
    const me = (await client.get('/api/admin/users')).json<User[]>()[0]!;
    await client.send('PUT', `/api/admin/users/${me.id}`, {
      name: me.name,
      active: true,
      roleId: custom.id,
      unitIds: me.unitIds,
    });
    const res = await client.send('PUT', `/api/admin/roles/${custom.id}`, {
      name: 'Admin próprio',
      description: null,
      permissions: ['admin.users.view'],
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<ApiError>().error.message).toMatch(/administrador/);
  });
});

describe('usuários', () => {
  it('cria usuário com perfil e unidade e rejeita e-mail duplicado', async () => {
    const recep = await roleByName('Recepcionista');
    const payload = {
      name: 'Rita Recepção',
      email: 'rita@clinica.test',
      password: 'senha-da-rita-1',
      roleId: recep.id,
      unitIds: [h.org.unitId],
    };
    const res = await client.send('POST', '/api/admin/users', payload);
    expect(res.statusCode).toBe(201);
    expect(res.json<User>()).toMatchObject({ roleName: 'Recepcionista', active: true });
    expect(JSON.stringify(res.json())).not.toContain('senha');

    const dup = await client.send('POST', '/api/admin/users', {
      ...payload,
      email: 'RITA@clinica.test',
    });
    expect(dup.statusCode).toBe(409);
  });

  it('exige senha com pelo menos 10 caracteres', async () => {
    const recep = await roleByName('Recepcionista');
    const res = await client.send('POST', '/api/admin/users', {
      name: 'Curta',
      email: 'curta@clinica.test',
      password: '123',
      roleId: recep.id,
      unitIds: [h.org.unitId],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<ApiError>().error.details?.[0]?.path).toBe('password');
  });

  it('usuário desativado perde a sessão na requisição seguinte', async () => {
    const recep = await roleByName('Recepcionista');
    const created = (
      await client.send('POST', '/api/admin/users', {
        name: 'Rui',
        email: 'rui@clinica.test',
        password: 'senha-do-rui-1',
        roleId: recep.id,
        unitIds: [h.org.unitId],
      })
    ).json<User>();
    const rui = new TestClient(h.app);
    await rui.login('rui@clinica.test', 'senha-do-rui-1');
    expect((await rui.get('/api/auth/session')).statusCode).toBe(200);

    await client.send('PUT', `/api/admin/users/${created.id}`, {
      name: 'Rui',
      active: false,
      roleId: recep.id,
      unitIds: [h.org.unitId],
    });
    expect((await rui.get('/api/auth/session')).statusCode).toBe(401);
  });

  it('não permite desativar o próprio usuário', async () => {
    const me = (await client.get('/api/admin/users')).json<User[]>()[0]!;
    const res = await client.send('PUT', `/api/admin/users/${me.id}`, {
      name: me.name,
      active: false,
      roleId: me.roleId,
      unitIds: me.unitIds,
    });
    expect(res.statusCode).toBe(409);
  });
});
