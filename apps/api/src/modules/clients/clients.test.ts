import type { ApiError, AuditEntry, CatalogItem, Client, ClientListItem } from '@clinica/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clientInput, patientInput, VALID_CNPJ, VALID_CPF } from '../../test/fixtures.js';
import { ADMIN, createHarness, loginAs, TestClient, type Harness } from '../../test/harness.js';

let h: Harness;
let admin: TestClient;

beforeEach(async () => {
  h = await createHarness();
  admin = new TestClient(h.app);
  await admin.login(ADMIN.email, ADMIN.password);
});
afterEach(async () => {
  await h.close();
});

const createClient = async (overrides: Parameters<typeof clientInput>[0] = {}) => {
  const res = await admin.send('POST', '/api/clients', clientInput(overrides));
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Client>();
};

type Page = { items: ClientListItem[]; total: number };

describe('cadastro de clientes', () => {
  it('aceita o cadastro mínimo do balcão: só nome e telefone (RN-06)', async () => {
    const client = await createClient();
    expect(client.code).toBe(1);
    expect(client.cpf).toBeNull();
    expect(client.birthDate).toBeNull();
    expect(client.contacts).toEqual([{ kind: 'mobile', value: '11987654321', isWhatsapp: true }]);
    expect((await createClient({ name: 'Outro Cliente' })).code).toBe(2);
  });

  it('valida CPF e impede duplicidade na organização', async () => {
    const bad = await admin.send('POST', '/api/clients', clientInput({ cpf: '111.111.111-11' }));
    expect(bad.statusCode).toBe(400);
    expect(bad.json<ApiError>().error.details).toContainEqual({
      path: 'cpf',
      message: 'CPF inválido',
    });

    await createClient({ cpf: VALID_CPF });
    const dup = await admin.send(
      'POST',
      '/api/clients',
      clientInput({ name: 'Xará', cpf: VALID_CPF }),
    );
    expect(dup.statusCode).toBe(409);
    expect(dup.json<ApiError>().error.message).toBe('Já existe um cliente com este CPF.');
  });

  it('pessoa jurídica usa CNPJ e recusa CPF', async () => {
    const res = await admin.send(
      'POST',
      '/api/clients',
      clientInput({ personType: 'company', name: 'Canil Boa Vista', cpf: VALID_CPF }),
    );
    expect(res.statusCode).toBe(400);
    const ok = await createClient({
      personType: 'company',
      name: 'Canil Boa Vista',
      cnpj: VALID_CNPJ,
    });
    expect(ok.cnpj).toBe('11222333000181');
  });

  it('busca por nome sem acento, telefone, CPF e nome do animal', async () => {
    const joao = await createClient({ name: 'João Araújo', cpf: VALID_CPF });
    await createClient({ name: 'Maria Silva', contacts: [{ kind: 'phone', value: '1133334444' }] });
    await admin.send('POST', '/api/patients', {
      clientId: joao.id,
      patient: patientInput({ name: 'Paçoca' }),
    });

    const search = async (q: string) =>
      (await admin.get(`/api/clients?q=${encodeURIComponent(q)}`))
        .json<Page>()
        .items.map((c) => c.name);
    expect(await search('joao araujo')).toEqual(['João Araújo']);
    expect(await search('3333-4444')).toEqual(['Maria Silva']);
    expect(await search('529.982')).toEqual(['João Araújo']);
    expect(await search('pacoca')).toEqual(['João Araújo']);
    expect(await search('%')).toEqual([]);

    const list = (await admin.get('/api/clients')).json<Page>();
    expect(list.total).toBe(2);
    expect(list.items[0]).toMatchObject({ name: 'João Araújo', patients: [{ name: 'Paçoca' }] });
  });

  it('edita, audita antes/depois e recusa origem arquivada', async () => {
    const origin = (
      await admin.send('POST', '/api/catalogs/client-origins', { name: 'Indicação' })
    ).json<CatalogItem>();
    const client = await createClient({ originId: origin.id });
    expect(client.originName).toBe('Indicação');

    const updated = await admin.send(
      'PUT',
      `/api/clients/${client.id}`,
      clientInput({ name: 'Carla Mendes Souza', originId: origin.id }),
    );
    expect(updated.statusCode).toBe(200);
    const audit = (await admin.get('/api/admin/audit')).json<{ items: AuditEntry[] }>();
    const entry = audit.items.find((a) => a.entity === 'client' && a.action === 'update');
    expect(entry?.before).toMatchObject({ name: 'Carla Mendes', origin: { name: 'Indicação' } });
    expect(entry?.after).toMatchObject({ name: 'Carla Mendes Souza' });

    const other = (
      await admin.send('POST', '/api/catalogs/client-origins', {
        name: 'Instagram',
        archived: true,
      })
    ).json<CatalogItem>();
    const res = await admin.send('POST', '/api/clients', clientInput({ originId: other.id }));
    expect(res.statusCode).toBe(404);
  });

  it('arquiva e restaura; arquivado sai da lista padrão e fica somente leitura', async () => {
    const client = await createClient();
    await admin.send('POST', `/api/clients/${client.id}/archive`);
    expect((await admin.get('/api/clients')).json<Page>().total).toBe(0);
    expect((await admin.get('/api/clients?archived=true')).json<Page>().total).toBe(1);
    const edit = await admin.send('PUT', `/api/clients/${client.id}`, clientInput());
    expect(edit.statusCode).toBe(409);
    const restored = await admin.send('POST', `/api/clients/${client.id}/restore`);
    expect(restored.json<Client>().archived).toBe(false);
  });
});

describe('consentimento LGPD (RN-04)', () => {
  it('registra canal, data, origem e autor sem apagar o histórico', async () => {
    const client = await createClient();
    const first = await admin.send('PUT', `/api/clients/${client.id}/consents`, {
      source: 'Termo assinado no balcão',
      channels: [
        { channel: 'whatsapp', granted: true },
        { channel: 'sms_campaign', granted: false },
      ],
    });
    expect(first.statusCode).toBe(200);
    expect(first.json<Client>().consents).toHaveLength(2);

    const second = await admin.send('PUT', `/api/clients/${client.id}/consents`, {
      source: 'Pedido por telefone',
      channels: [
        { channel: 'whatsapp', granted: false },
        { channel: 'sms_campaign', granted: false },
      ],
    });
    const consents = second.json<Client>().consents;
    // Só o canal que mudou gera linha nova; a decisão anterior continua registrada.
    expect(consents).toHaveLength(3);
    expect(consents[0]).toMatchObject({
      channel: 'whatsapp',
      granted: false,
      source: 'Pedido por telefone',
      recordedByName: ADMIN.name,
    });
    expect(consents.filter((c) => c.channel === 'whatsapp').map((c) => c.granted)).toEqual([
      false,
      true,
    ]);
  });

  it('exige a origem do consentimento', async () => {
    const client = await createClient();
    const res = await admin.send('PUT', `/api/clients/${client.id}/consents`, {
      source: '',
      channels: [{ channel: 'email', granted: true }],
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('permissões e isolamento', () => {
  it('Esteticista consulta, mas não cadastra nem arquiva', async () => {
    const client = await createClient();
    const est = await loginAs(h, admin, 'Esteticista');
    expect((await est.get(`/api/clients/${client.id}`)).statusCode).toBe(200);
    expect((await est.send('POST', '/api/clients', clientInput())).statusCode).toBe(403);
    expect((await est.send('POST', `/api/clients/${client.id}/archive`)).statusCode).toBe(403);
  });

  it('Recepcionista cadastra, mas não arquiva', async () => {
    const recep = await loginAs(h, admin, 'Recepcionista');
    const res = await recep.send('POST', '/api/clients', clientInput());
    expect(res.statusCode).toBe(201);
    const archive = await recep.send('POST', `/api/clients/${res.json<Client>().id}/archive`);
    expect(archive.statusCode).toBe(403);
  });

  it('cliente de outra organização não é encontrado', async () => {
    const { provisionOrganization } = await import('../admin/provisioning.js');
    await h.db.transaction((tx) =>
      provisionOrganization(tx, {
        organizationName: 'Outra Clínica',
        unitName: 'Sede',
        admin: { name: 'Beto', email: 'beto@outra.test', password: 'senha-forte-789' },
      }),
    );
    const outsider = new TestClient(h.app);
    await outsider.login('beto@outra.test', 'senha-forte-789');
    const client = await createClient();
    expect((await outsider.get(`/api/clients/${client.id}`)).statusCode).toBe(404);
    expect((await outsider.get('/api/clients')).json<Page>().total).toBe(0);
  });
});
