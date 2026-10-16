import type { ApiError, Breed, CatalogItem } from '@clinica/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

describe('cadastros de apoio', () => {
  it('provisiona Canina e Felina, cada uma com SRD', async () => {
    const species = (await admin.get('/api/catalogs/species')).json<CatalogItem[]>();
    expect(species.map((s) => s.name)).toEqual(['Canina', 'Felina']);
    const breeds = (await admin.get(`/api/catalogs/species/${species[0]!.id}/breeds`)).json<
      Breed[]
    >();
    expect(breeds.map((b) => b.name)).toEqual(['Sem raça definida (SRD)']);
  });

  it('cria, renomeia e arquiva pelagens; nome repetido é conflito sem diferenciar maiúsculas', async () => {
    const created = await admin.send('POST', '/api/catalogs/coats', { name: 'Tricolor' });
    expect(created.statusCode).toBe(201);
    const coat = created.json<CatalogItem>();

    const dup = await admin.send('POST', '/api/catalogs/coats', { name: 'TRICOLOR' });
    expect(dup.statusCode).toBe(409);

    const archived = await admin.send('PUT', `/api/catalogs/coats/${coat.id}`, {
      name: 'Tricolor',
      archived: true,
    });
    expect(archived.json<CatalogItem>().archived).toBe(true);
  });

  it('raça com o mesmo nome em outra espécie é permitida', async () => {
    const species = (await admin.get('/api/catalogs/species')).json<CatalogItem[]>();
    for (const s of species) {
      const res = await admin.send('POST', `/api/catalogs/species/${s.id}/breeds`, {
        name: 'Mestiço',
      });
      expect(res.statusCode).toBe(201);
    }
  });

  it('sem catalogs.manage o usuário lê, mas não altera', async () => {
    const recep = await loginAs(h, admin, 'Recepcionista');
    expect((await recep.get('/api/catalogs/coats')).statusCode).toBe(200);
    const res = await recep.send('POST', '/api/catalogs/coats', { name: 'Preta' });
    expect(res.statusCode).toBe(403);
    expect(res.json<ApiError>().error.code).toBe('forbidden');
  });
});
