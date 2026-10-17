import type {
  Client,
  ClientRanking,
  Product,
  ProductInput,
  Sale,
  Session,
} from '@clinica/contracts';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { instantToZoned } from '../../core/zoned-time.js';
import { clientInput } from '../../test/fixtures.js';
import { ADMIN, createHarness, loginAs, TestClient, type Harness } from '../../test/harness.js';

let h: Harness;
let admin: TestClient;
let adminId: string;
let banho: Product;

const productInput: ProductInput = {
  kind: 'service',
  serviceKind: 'grooming',
  name: 'Banho',
  unit: 'un',
  barcode: '',
  brandId: null,
  groupId: null,
  ncm: '',
  origin: '0',
  acquisition: 'resale',
  cfop: '',
  taxSituation: '',
  municipalServiceCode: '',
  taxProfile: '',
  salePrice: 50,
  cost: null,
  purpose: 'sale',
  desiredMarkup: null,
  allowPriceChange: false,
  showInPriceList: true,
  discountLimitPercent: null,
  defaultCommissionPercent: 0,
  commissions: [],
  tracksStock: false,
  minStock: null,
  idealStock: null,
};

async function newClient(name: string) {
  const res = await admin.send('POST', '/api/clients', clientInput({ name }));
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Client>();
}

async function sell(client: Client, quantity: number, kind: 'sale' | 'quote' = 'sale') {
  const res = await admin.send('POST', '/api/sales', {
    kind,
    saleType: 'in_person_consumer',
    clientId: client.id,
    patientId: null,
    items: [{ productId: banho.id, professionalId: adminId, quantity, unitPrice: null }],
    discount: { mode: 'amount', value: 0 },
    notes: '',
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Sale>();
}

const today = () => instantToZoned(new Date(), 'America/Sao_Paulo').date;

async function ranking(): Promise<ClientRanking> {
  const res = await admin.get(`/api/sales/reports/clients?from=${today()}&to=${today()}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<ClientRanking>();
}

const abcOf = async (client: Client) =>
  (await admin.get(`/api/clients/${client.id}`)).json<Client>().abcClass;

beforeEach(async () => {
  h = await createHarness();
  admin = new TestClient(h.app);
  await admin.login(ADMIN.email, ADMIN.password);
  adminId = (await admin.get('/api/auth/session')).json<Session>().user.id;
  const res = await admin.send('POST', '/api/products', productInput);
  expect(res.statusCode, res.body).toBe(201);
  banho = res.json<Product>();
});
afterEach(async () => {
  await h.close();
});

describe('ranking de clientes [RN-10]', () => {
  it('classifica pela curva ABC: A até 80%, B até 95%, C o resto', async () => {
    const [ana, bia, caio, davi, eva] = await Promise.all(
      ['Ana', 'Bia', 'Caio', 'Davi', 'Eva'].map((n) => newClient(n)),
    );
    await sell(ana!, 10); // 500
    await sell(bia!, 6); // 300
    await sell(caio!, 3); // 150
    await sell(davi!, 1); // 50
    // Ficam de fora: orçamento e venda cancelada.
    await sell(eva!, 20, 'quote');
    const cancelled = await sell(eva!, 20);
    expect(
      (
        await admin.send('POST', `/api/sales/${cancelled.id}/cancel`, {
          reason: 'Cliente desistiu',
        })
      ).statusCode,
    ).toBe(200);

    const r = await ranking();
    expect(r.total).toBe(1000);
    expect(r.items.map((i) => [i.client.name, i.net, i.class, i.cumulativeShare])).toEqual([
      ['Ana', 500, 'A', 50],
      ['Bia', 300, 'A', 80],
      ['Caio', 150, 'B', 95],
      ['Davi', 50, 'C', 100],
    ]);
    expect(r.items[0]).toMatchObject({ position: 1, salesCount: 1, share: 50 });
    expect(r.classes).toEqual([
      { class: 'A', clients: 2, net: 800, share: 80 },
      { class: 'B', clients: 1, net: 150, share: 15 },
      { class: 'C', clients: 1, net: 50, share: 5 },
    ]);

    // A ficha mostra a classe dos últimos 12 meses; quem não comprou fica sem classe.
    expect(await abcOf(ana!)).toBe('A');
    expect(await abcOf(caio!)).toBe('B');
    expect(await abcOf(davi!)).toBe('C');
    expect(await abcOf(eva!)).toBeNull();
  });

  it('a ficha só conta os últimos 12 meses', async () => {
    const [ana, bia] = await Promise.all(['Ana', 'Bia'].map((n) => newClient(n)));
    const old = await sell(ana!, 100);
    await sell(bia!, 1);
    await h.db.execute(
      sql`update sales set sold_at = now() - interval '400 days' where id = ${old.id}`,
    );
    expect(await abcOf(ana!)).toBeNull();
    expect(await abcOf(bia!)).toBe('A');
  });

  it('só quem tem a permissão vê o ranking', async () => {
    const vet = await loginAs(h, admin, 'Veterinário');
    expect(
      (await vet.get(`/api/sales/reports/clients?from=${today()}&to=${today()}`)).statusCode,
    ).toBe(403);
    const recepcao = await loginAs(h, admin, 'Recepcionista');
    expect(
      (await recepcao.get(`/api/sales/reports/clients?from=${today()}&to=${today()}`)).statusCode,
    ).toBe(403);
  });
});
