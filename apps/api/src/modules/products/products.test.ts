import type {
  ApiError,
  AuditEntry,
  CatalogItem,
  Product,
  ProductInput,
  ProductListItem,
  Session,
} from '@clinica/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { provisionOrganization } from '../admin/provisioning.js';
import { ADMIN, createHarness, loginAs, TestClient, type Harness } from '../../test/harness.js';

let h: Harness;
let admin: TestClient;
let adminId: string;

beforeEach(async () => {
  h = await createHarness();
  admin = new TestClient(h.app);
  await admin.login(ADMIN.email, ADMIN.password);
  adminId = (await admin.get('/api/auth/session')).json<Session>().user.id;
});
afterEach(async () => {
  await h.close();
});

const product = (overrides: Partial<ProductInput> = {}): ProductInput => ({
  kind: 'product',
  serviceKind: null,
  name: 'Apoquel 16 mg',
  unit: 'cp',
  barcode: '',
  brandId: null,
  groupId: null,
  ncm: '30049099',
  origin: '2',
  acquisition: 'resale',
  cfop: '5102',
  taxSituation: '102',
  municipalServiceCode: '',
  taxProfile: '',
  salePrice: 12.5,
  cost: 8,
  purpose: 'sale',
  desiredMarkup: 60,
  allowPriceChange: false,
  showInPriceList: true,
  discountLimitPercent: null,
  defaultCommissionPercent: 5,
  commissions: [],
  tracksStock: true,
  minStock: 30,
  idealStock: 90,
  ...overrides,
});

const service = (overrides: Partial<ProductInput> = {}): ProductInput =>
  product({
    kind: 'service',
    serviceKind: 'consultation',
    name: 'Consulta clínica',
    unit: 'un',
    ncm: '',
    cfop: '',
    taxSituation: '',
    municipalServiceCode: '05.01',
    salePrice: 180,
    cost: null,
    desiredMarkup: null,
    tracksStock: false,
    minStock: null,
    idealStock: null,
    ...overrides,
  });

async function create(input: ProductInput, as = admin): Promise<Product> {
  const res = await as.send('POST', '/api/products', input);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Product>();
}

async function catalog(kind: 'product-groups' | 'product-brands', name: string) {
  const res = await admin.send('POST', `/api/catalogs/${kind}`, { name });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<CatalogItem>();
}

describe('cadastro de produto e serviço [RN-22]', () => {
  it('produto com grupo, marca, fiscal e markup real calculado no servidor', async () => {
    const group = await catalog('product-groups', 'Medicamentos');
    const brand = await catalog('product-brands', 'Zoetis');
    const p = await create(
      product({ groupId: group.id, brandId: brand.id, barcode: '7891234567895' }),
    );
    expect(p.code).toBe(1);
    expect(p.group).toEqual({ id: group.id, name: 'Medicamentos' });
    expect(p.brand).toEqual({ id: brand.id, name: 'Zoetis' });
    expect(p.ncm).toBe('30049099');
    expect(p.costVisible).toBe(true);
    expect(p.cost).toBe(8);
    expect(p.realMarkup).toBe(56.25);
    expect(p.suggestedPrice).toBe(12.8);
    expect(p.minStock).toBe(30);

    const second = await create(product({ name: 'Simparic 40 mg', barcode: '' }));
    expect(second.code).toBe(2);
  });

  it('serviço é classificado por tipo e perde campos de mercadoria', async () => {
    const s = await create(
      service({ barcode: '7891234567895', ncm: '30049099', tracksStock: true, minStock: 5 }),
    );
    expect(s.serviceKind).toBe('consultation');
    expect(s.municipalServiceCode).toBe('05.01');
    expect(s.barcode).toBeNull();
    expect(s.ncm).toBeNull();
    expect(s.tracksStock).toBe(false);
    expect(s.minStock).toBeNull();

    const unclassified = await admin.send('POST', '/api/products', service({ serviceKind: null }));
    expect(unclassified.statusCode).toBe(400);
    expect(unclassified.json<ApiError>().error.details?.[0]?.path).toBe('serviceKind');
  });

  it('valida código de barras, NCM, dinheiro e estoque mínimo e ideal', async () => {
    const cases: [Partial<ProductInput>, string][] = [
      [{ barcode: '7891234567890' }, 'barcode'],
      [{ ncm: '3004' }, 'ncm'],
      [{ salePrice: 10.005 }, 'salePrice'],
      [{ salePrice: -1 }, 'salePrice'],
      [{ cfop: '9102' }, 'cfop'],
      [{ minStock: 10, idealStock: 5 }, 'idealStock'],
      [{ discountLimitPercent: 120 }, 'discountLimitPercent'],
    ];
    for (const [overrides, path] of cases) {
      const res = await admin.send('POST', '/api/products', product(overrides));
      expect(res.statusCode, JSON.stringify(overrides)).toBe(400);
      expect(res.json<ApiError>().error.details?.map((d) => d.path)).toContain(path);
    }
  });

  it('código de barras é único na organização', async () => {
    await create(product({ barcode: '7891234567895' }));
    const dup = await admin.send(
      'POST',
      '/api/products',
      product({ name: 'Outro', barcode: '7891234567895' }),
    );
    expect(dup.statusCode).toBe(409);
    expect(dup.json<ApiError>().error.message).toBe(
      'Já existe um produto com este código de barras.',
    );
  });

  it('grupo arquivado não entra em item novo, mas o item que já o tinha continua editável', async () => {
    const group = await catalog('product-groups', 'Rações');
    const p = await create(product({ groupId: group.id }));
    await admin.send('PUT', `/api/catalogs/product-groups/${group.id}`, {
      name: 'Rações',
      archived: true,
    });
    const fresh = await admin.send('POST', '/api/products', product({ groupId: group.id }));
    expect(fresh.statusCode).toBe(400);
    const kept = await admin.send(
      'PUT',
      `/api/products/${p.id}`,
      product({ groupId: group.id, salePrice: 14 }),
    );
    expect(kept.statusCode, kept.body).toBe(200);
  });
});

describe('comissão [p.16]', () => {
  it('padrão do item mais diferenciada por profissional, só de usuários da clínica', async () => {
    const p = await create(
      service({ defaultCommissionPercent: 10, commissions: [{ userId: adminId, percent: 25 }] }),
    );
    expect(p.defaultCommissionPercent).toBe(10);
    expect(p.commissions).toEqual([{ userId: adminId, userName: ADMIN.name, percent: 25 }]);
    const professionals = (await admin.get('/api/products/professionals')).json<
      { id: string; name: string }[]
    >();
    expect(professionals).toEqual([{ id: adminId, name: ADMIN.name }]);

    const repeated = await admin.send(
      'POST',
      '/api/products',
      service({
        commissions: [
          { userId: adminId, percent: 25 },
          { userId: adminId, percent: 30 },
        ],
      }),
    );
    expect(repeated.statusCode).toBe(400);

    const stranger = await admin.send(
      'POST',
      '/api/products',
      service({ commissions: [{ userId: '01900000-0000-7000-8000-000000000000', percent: 5 }] }),
    );
    expect(stranger.statusCode).toBe(400);
    expect(stranger.json<ApiError>().error.details?.[0]?.path).toBe('commissions.0.userId');
  });
});

describe('custo e permissões', () => {
  it('quem não tem "ver custo" não vê nem altera custo e markup', async () => {
    const p = await create(product());
    const roles = (await admin.get('/api/admin/roles')).json<
      { id: string; name: string; permissions: string[] }[]
    >();
    const gestor = roles.find((r) => r.name === 'Gestor da Clínica');
    if (!gestor) throw new Error('Perfil Gestor ausente');
    const clone = await admin.send('POST', `/api/admin/roles/${gestor.id}/clone`, {
      name: 'Estoquista',
    });
    expect(clone.statusCode, clone.body).toBe(201);
    const role = clone.json<{ id: string; permissions: string[] }>();
    const res = await admin.send('PUT', `/api/admin/roles/${role.id}`, {
      name: 'Estoquista',
      description: '',
      permissions: role.permissions.filter((k) => k !== 'products.view_cost'),
    });
    expect(res.statusCode, res.body).toBe(200);
    const stock = await loginAs(h, admin, 'Estoquista');

    const seen = (await stock.get(`/api/products/${p.id}`)).json<Product>();
    expect(seen.costVisible).toBe(false);
    expect(seen.cost).toBeNull();
    expect(seen.realMarkup).toBeNull();
    expect(seen.salePrice).toBe(12.5);

    const updated = await stock.send(
      'PUT',
      `/api/products/${p.id}`,
      product({ salePrice: 15, cost: 0.01, desiredMarkup: 0 }),
    );
    expect(updated.statusCode, updated.body).toBe(200);
    const after = (await admin.get(`/api/products/${p.id}`)).json<Product>();
    expect(after.salePrice).toBe(15);
    expect(after.cost).toBe(8);
    expect(after.desiredMarkup).toBe(60);
    expect(after.realMarkup).toBe(87.5);

    const created = await create(product({ name: 'Sem custo', cost: 3 }), stock);
    expect((await admin.get(`/api/products/${created.id}`)).json<Product>().cost).toBeNull();
  });

  it('recepção vê a lista de preços, mas não cadastra', async () => {
    await create(service());
    const recep = await loginAs(h, admin, 'Recepcionista');
    const list = (await recep.get('/api/products?priceList=true')).json<{
      items: ProductListItem[];
    }>();
    expect(list.items.map((i) => i.name)).toEqual(['Consulta clínica']);
    const res = await recep.send('POST', '/api/products', service({ name: 'Retorno' }));
    expect(res.statusCode).toBe(403);
  });

  it('outra organização não enxerga nem altera os itens', async () => {
    const p = await create(product());
    await h.db.transaction((tx) =>
      provisionOrganization(tx, {
        organizationName: 'Outra Clínica',
        unitName: 'Sede',
        admin: { name: 'Olga', email: 'olga@outra.test', password: 'senha-forte-789' },
      }),
    );
    const stranger = new TestClient(h.app);
    await stranger.login('olga@outra.test', 'senha-forte-789');
    expect((await stranger.get(`/api/products/${p.id}`)).statusCode).toBe(404);
    expect((await stranger.send('PUT', `/api/products/${p.id}`, product())).statusCode).toBe(404);
    const list = (await stranger.get('/api/products')).json<{ items: ProductListItem[] }>();
    expect(list.items).toEqual([]);
    const own = await create(product(), stranger);
    expect(own.code).toBe(1);
  });
});

describe('lista, arquivamento e auditoria', () => {
  it('busca por nome sem acento, código e código de barras; filtra por tipo e classificação', async () => {
    await create(product({ name: 'Vermífugo Drontal', barcode: '7891234567895' }));
    await create(service());
    await create(service({ name: 'Vacina V10', serviceKind: 'vaccine' }));
    const names = async (qs: string) =>
      (await admin.get(`/api/products?${qs}`))
        .json<{ items: ProductListItem[] }>()
        .items.map((i) => i.name);
    expect(await names('q=vermifugo')).toEqual(['Vermífugo Drontal']);
    expect(await names('q=7891234567895')).toEqual(['Vermífugo Drontal']);
    expect(await names('q=2')).toEqual(['Consulta clínica']);
    expect(await names('kind=service')).toEqual(['Consulta clínica', 'Vacina V10']);
    expect(await names('serviceKind=vaccine')).toEqual(['Vacina V10']);
  });

  it('arquivado sai da lista, não é editado e volta ao restaurar; tudo no log', async () => {
    const p = await create(product());
    const archived = (await admin.send('POST', `/api/products/${p.id}/archive`)).json<Product>();
    expect(archived.archived).toBe(true);
    const list = (await admin.get('/api/products')).json<{ total: number }>();
    expect(list.total).toBe(0);
    expect((await admin.send('PUT', `/api/products/${p.id}`, product())).statusCode).toBe(409);
    await admin.send('POST', `/api/products/${p.id}/restore`);
    await admin.send('PUT', `/api/products/${p.id}`, product({ salePrice: 13.9 }));

    const audit = (await admin.get(`/api/admin/audit?entity=product&entityId=${p.id}`)).json<{
      items: AuditEntry[];
    }>();
    expect(audit.items.map((a) => a.action)).toEqual(['update', 'restore', 'archive', 'create']);
    const update = audit.items[0];
    expect(update?.before).toMatchObject({ salePrice: 12.5 });
    expect(update?.after).toMatchObject({ salePrice: 13.9 });
  });
});
