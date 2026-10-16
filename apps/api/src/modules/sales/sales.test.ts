import type {
  ApiError,
  AuditEntry,
  Client,
  Patient,
  Product,
  ProductInput,
  Sale,
  SaleContext,
  SaleInput,
  SaleListItem,
  SalesSettings,
  SellableItem,
  Session,
  User,
} from '@clinica/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { provisionOrganization } from '../admin/provisioning.js';
import { clientInput, patientInput, VALID_CPF } from '../../test/fixtures.js';
import { ADMIN, createHarness, loginAs, TestClient, type Harness } from '../../test/harness.js';

let h: Harness;
let admin: TestClient;
let adminId: string;
let client: Client;
let thor: Patient;
let apoquel: Product;
let consulta: Product;

const productInput = (overrides: Partial<ProductInput> = {}): ProductInput => ({
  kind: 'product',
  serviceKind: null,
  name: 'Apoquel 16 mg',
  unit: 'cp',
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
  salePrice: 12.5,
  cost: 8,
  purpose: 'sale',
  desiredMarkup: null,
  allowPriceChange: false,
  showInPriceList: true,
  discountLimitPercent: null,
  defaultCommissionPercent: 5,
  commissions: [],
  tracksStock: false,
  minStock: null,
  idealStock: null,
  ...overrides,
});

async function createProduct(overrides: Partial<ProductInput> = {}): Promise<Product> {
  const res = await admin.send('POST', '/api/products', productInput(overrides));
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Product>();
}

const sale = (overrides: Partial<SaleInput> = {}): SaleInput => ({
  kind: 'sale',
  saleType: 'in_person_consumer',
  clientId: client.id,
  patientId: thor.id,
  items: [
    { productId: consulta.id, professionalId: adminId, quantity: 1, unitPrice: null },
    { productId: apoquel.id, professionalId: adminId, quantity: 30, unitPrice: null },
  ],
  discount: { mode: 'amount', value: 0 },
  notes: '',
  ...overrides,
});

async function createSale(input: SaleInput, as = admin): Promise<Sale> {
  const res = await as.send('POST', '/api/sales', input);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Sale>();
}

const fieldError = (body: string) => (JSON.parse(body) as ApiError).error.details?.[0];

beforeEach(async () => {
  h = await createHarness();
  admin = new TestClient(h.app);
  await admin.login(ADMIN.email, ADMIN.password);
  adminId = (await admin.get('/api/auth/session')).json<Session>().user.id;
  client = (
    await admin.send('POST', '/api/clients', clientInput({ cpf: VALID_CPF }))
  ).json<Client>();
  thor = (
    await admin.send('POST', '/api/patients', {
      clientId: client.id,
      patient: patientInput({ name: 'Thor' }),
    })
  ).json<Patient>();
  apoquel = await createProduct();
  consulta = await createProduct({
    kind: 'service',
    serviceKind: 'consultation',
    name: 'Consulta clínica',
    unit: 'un',
    salePrice: 180,
    cost: null,
    defaultCommissionPercent: 30,
  });
});
afterEach(async () => {
  await h.close();
});

describe('PDV', () => {
  it('grava venda com totais calculados no servidor, profissional por item e auditoria', async () => {
    const created = await createSale(sale());
    expect(created.code).toBe(1);
    expect(created.status).toBe('open');
    expect(created.client).toMatchObject({ id: client.id, code: client.code });
    expect(created.patient).toEqual({ id: thor.id, name: 'Thor' });
    expect(created.items.map((i) => [i.name, i.quantity, i.unitPrice, i.grossTotal])).toEqual([
      ['Consulta clínica', 1, 180, 180],
      ['Apoquel 16 mg', 30, 12.5, 375],
    ]);
    expect(created.items.every((i) => i.professional.id === adminId)).toBe(true);
    expect([created.grossTotal, created.discountTotal, created.netTotal]).toEqual([555, 0, 555]);
    expect(created.editable).toBe(true);

    // Campos de total enviados pelo cliente são ignorados (o contrato nem os aceita).
    const tampered = await createSale({
      ...sale(),
      grossTotal: 1,
      netTotal: 1,
    } as SaleInput);
    expect(tampered.code).toBe(2);
    expect(tampered.netTotal).toBe(555);

    const audit = (await admin.get(`/api/admin/audit?entity=sale&entityId=${created.id}`)).json<{
      items: AuditEntry[];
    }>();
    expect(audit.items[0]?.action).toBe('create');
    expect(audit.items[0]?.after).toMatchObject({
      code: 1,
      status: 'Em aberto',
      client: client.name,
      patient: 'Thor',
      netTotal: 555,
    });
    expect((audit.items[0]?.after as { items: string }).items).toContain(
      '30 × Apoquel 16 mg a R$ 12,50',
    );
  });

  it('rateia o desconto pelos itens sem perder centavos', async () => {
    const tres = await createProduct({ name: 'Item 10', salePrice: 10 });
    const created = await createSale(
      sale({
        items: [0, 1, 2].map(() => ({
          productId: tres.id,
          professionalId: adminId,
          quantity: 1,
          unitPrice: null,
        })),
        discount: { mode: 'amount', value: 1 },
      }),
    );
    expect(created.items.map((i) => i.discountAmount)).toEqual([0.34, 0.33, 0.33]);
    expect(created.items.reduce((a, i) => a + Math.round(i.netTotal * 100), 0)).toBe(2900);
    expect(created.netTotal).toBe(29);
  });

  it('limita o desconto pela clínica, pelo usuário e pelo item', async () => {
    // Limite padrão da clínica: 10%.
    const ok = await createSale(sale({ discount: { mode: 'percent', value: 10 } }));
    expect(ok.discountTotal).toBe(55.5);
    let res = await admin.send(
      'POST',
      '/api/sales',
      sale({ discount: { mode: 'percent', value: 10.01 } }),
    );
    expect(res.statusCode).toBe(400);
    expect(fieldError(res.body)).toEqual({
      path: 'discount.value',
      message: 'Desconto acima do seu limite de 10%',
    });
    // Em reais, o percentual efetivo é o que conta: 55,51 de 555 passa de 10%.
    res = await admin.send(
      'POST',
      '/api/sales',
      sale({ discount: { mode: 'amount', value: 55.51 } }),
    );
    expect(res.statusCode).toBe(400);

    // Limite próprio do usuário prevalece sobre o da clínica.
    const me = (await admin.get('/api/admin/users')).json<User[]>().find((u) => u.id === adminId);
    if (!me) throw new Error('admin não encontrado');
    const put = await admin.send('PUT', `/api/admin/users/${adminId}`, {
      name: me.name,
      active: true,
      roleId: me.roleId,
      unitIds: me.unitIds,
      discountLimitPercent: 20,
    });
    expect(put.statusCode, put.body).toBe(200);
    expect((await admin.get('/api/sales/context')).json<SaleContext>().discountLimitPercent).toBe(
      20,
    );
    await createSale(sale({ discount: { mode: 'percent', value: 20 } }));

    // O item com limite menor manda.
    const restrito = await createProduct({
      name: 'Ração premium',
      salePrice: 100,
      discountLimitPercent: 5,
    });
    res = await admin.send(
      'POST',
      '/api/sales',
      sale({
        items: [{ productId: restrito.id, professionalId: adminId, quantity: 1, unitPrice: null }],
        discount: { mode: 'percent', value: 6 },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(fieldError(res.body)?.message).toBe(
      'Desconto acima do limite de 5% do item Ração premium',
    );

    res = await admin.send(
      'POST',
      '/api/sales',
      sale({ discount: { mode: 'amount', value: 600 } }),
    );
    expect(res.statusCode).toBe(400);
    expect(fieldError(res.body)?.message).toBe('O desconto não pode passar do total da venda');
  });

  it('recepção lança venda sem desconto e edita venda com desconto já concedido', async () => {
    const recep = await loginAs(h, admin, 'Recepcionista');
    const ctx = (await recep.get('/api/sales/context')).json<SaleContext>();
    expect(ctx.discountLimitPercent).toBe(0);
    expect(ctx.professionals.map((p) => p.name)).toContain(ADMIN.name);

    let res = await recep.send(
      'POST',
      '/api/sales',
      sale({ discount: { mode: 'percent', value: 5 } }),
    );
    expect(res.statusCode).toBe(400);
    expect(fieldError(res.body)?.message).toBe('Você não tem permissão para conceder desconto');
    await createSale(sale(), recep);

    const discounted = await createSale(sale({ discount: { mode: 'percent', value: 10 } }));
    res = await recep.send('PUT', `/api/sales/${discounted.id}`, {
      ...sale({ discount: { mode: 'percent', value: 10 } }),
      notes: 'Entregar o remédio amanhã',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<Sale>().notes).toBe('Entregar o remédio amanhã');
    res = await recep.send(
      'PUT',
      `/api/sales/${discounted.id}`,
      sale({ discount: { mode: 'percent', value: 11 } }),
    );
    expect(res.statusCode).toBe(400);

    expect(
      (await recep.send('POST', `/api/sales/${discounted.id}/cancel`, { reason: 'Desistiu' }))
        .statusCode,
    ).toBe(403);
    expect((await recep.get('/api/sales/settings')).statusCode).toBe(403);
  });

  it('preço diferente do cadastro só com a flag do item e a permissão', async () => {
    let res = await admin.send(
      'POST',
      '/api/sales',
      sale({
        items: [{ productId: apoquel.id, professionalId: adminId, quantity: 1, unitPrice: 10 }],
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(fieldError(res.body)).toEqual({
      path: 'items.0.unitPrice',
      message: 'Este item não permite alterar o preço',
    });

    const livre = await createProduct({ name: 'Banho', salePrice: 60, allowPriceChange: true });
    const item = { productId: livre.id, professionalId: adminId, quantity: 1, unitPrice: 75 };
    const created = await createSale(sale({ items: [item] }));
    expect(created.items[0]).toMatchObject({ listPrice: 60, unitPrice: 75, netTotal: 75 });

    const vet = await loginAs(h, admin, 'Veterinário');
    res = await vet.send('POST', '/api/sales', sale({ items: [item] }));
    expect(res.statusCode).toBe(400);
    expect(fieldError(res.body)?.message).toBe('Você não tem permissão para alterar o preço');
    // Mantendo o preço que o gestor deu, o veterinário pode editar a venda.
    res = await vet.send('PUT', `/api/sales/${created.id}`, sale({ items: [item], notes: 'ok' }));
    expect(res.statusCode, res.body).toBe(200);
  });

  it('confere cliente, animal, item e profissional', async () => {
    const other = (
      await admin.send('POST', '/api/clients', clientInput({ name: 'Davi Souza', contacts: [] }))
    ).json<Client>();
    let res = await admin.send('POST', '/api/sales', sale({ clientId: other.id }));
    expect(res.statusCode).toBe(400);
    expect(fieldError(res.body)?.path).toBe('patientId');

    res = await admin.send('POST', '/api/sales', sale({ clientId: null }));
    expect(res.statusCode).toBe(400);

    // Venda de balcão, sem cliente.
    const counter = await createSale(sale({ clientId: null, patientId: null }));
    expect(counter.client).toBeNull();

    const interno = await createProduct({ name: 'Luva de procedimento', purpose: 'internal' });
    res = await admin.send(
      'POST',
      '/api/sales',
      sale({
        items: [{ productId: interno.id, professionalId: adminId, quantity: 1, unitPrice: null }],
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(fieldError(res.body)?.message).toBe('Item indisponível para venda');
    const sellable = (await admin.get('/api/sales/sellable?q=luva')).json<SellableItem[]>();
    expect(sellable).toEqual([]);
    expect(
      (await admin.get(`/api/sales/sellable?q=${apoquel.code}`)).json<SellableItem[]>()[0]?.name,
    ).toBe('Apoquel 16 mg');

    await admin.send('POST', `/api/products/${apoquel.id}/archive`);
    res = await admin.send('POST', '/api/sales', sale());
    expect(res.statusCode).toBe(400);

    res = await admin.send(
      'POST',
      '/api/sales',
      sale({
        items: [
          { productId: consulta.id, professionalId: client.id, quantity: 1, unitPrice: null },
        ],
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(fieldError(res.body)?.message).toBe('Profissional inválido');
  });

  it('orçamento vira venda sem redigitar; venda não volta a orçamento; cancelamento com motivo', async () => {
    const quote = await createSale(sale({ kind: 'quote' }));
    expect(quote.status).toBe('quote');
    let res = await admin.send('PUT', `/api/sales/${quote.id}`, sale());
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<Sale>()).toMatchObject({ status: 'open', code: quote.code });
    res = await admin.send('PUT', `/api/sales/${quote.id}`, sale({ kind: 'quote' }));
    expect(res.statusCode).toBe(409);

    res = await admin.send('POST', `/api/sales/${quote.id}/cancel`, { reason: '' });
    expect(res.statusCode).toBe(400);
    res = await admin.send('POST', `/api/sales/${quote.id}/cancel`, { reason: 'Cliente desistiu' });
    expect(res.statusCode).toBe(200);
    const cancelled = res.json<Sale>();
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancelled).toMatchObject({ by: ADMIN.name, reason: 'Cliente desistiu' });
    expect(cancelled.editable).toBe(false);
    expect((await admin.send('PUT', `/api/sales/${quote.id}`, sale())).statusCode).toBe(409);
    expect(
      (await admin.send('POST', `/api/sales/${quote.id}/cancel`, { reason: 'De novo' })).statusCode,
    ).toBe(409);

    const audit = (await admin.get(`/api/admin/audit?entity=sale&entityId=${quote.id}`)).json<{
      items: AuditEntry[];
    }>();
    expect(audit.items.map((a) => a.action)).toEqual(['cancel', 'convert', 'create']);
  });

  it('lista por período, status e busca por cliente, animal ou código', async () => {
    const a = await createSale(sale());
    const b = await createSale(sale({ kind: 'quote', clientId: null, patientId: null }));
    await h.db.execute(
      `update sales set created_at = now() - interval '2 days' where id = '${b.id}'`,
    );
    const page = async (qs: string) =>
      (await admin.get(`/api/sales?${qs}`)).json<{ items: SaleListItem[]; total: number }>();
    expect((await page('')).items.map((s) => s.code)).toEqual([a.code, b.code]);
    expect((await page('sinceHours=24')).items.map((s) => s.code)).toEqual([a.code]);
    expect((await page('status=quote')).items.map((s) => s.code)).toEqual([b.code]);
    expect((await page('q=thor')).items.map((s) => s.code)).toEqual([a.code]);
    expect((await page(`q=${b.code}`)).items.map((s) => s.code)).toEqual([b.code]);
    expect((await page('q=thor')).items[0]).toMatchObject({
      clientName: client.name,
      patientName: 'Thor',
      netTotal: 555,
    });
  });

  it('configuração de vendas com auditoria', async () => {
    expect((await admin.get('/api/sales/settings')).json<SalesSettings>()).toEqual({
      discountLimitPercent: 10,
      defaultSaleType: 'in_person_consumer',
    });
    const res = await admin.send('PUT', '/api/sales/settings', {
      discountLimitPercent: 0,
      defaultSaleType: 'delivery_consumer',
    });
    expect(res.statusCode, res.body).toBe(200);
    const ctx = (await admin.get('/api/sales/context')).json<SaleContext>();
    expect(ctx).toMatchObject({ discountLimitPercent: 0, defaultSaleType: 'delivery_consumer' });
    const denied = await admin.send(
      'POST',
      '/api/sales',
      sale({ discount: { mode: 'amount', value: 1 } }),
    );
    expect(denied.statusCode).toBe(400);
    const audit = (await admin.get('/api/admin/audit?entity=sales_settings')).json<{
      items: AuditEntry[];
    }>();
    expect(audit.items[0]?.after).toEqual({
      discountLimitPercent: 0,
      defaultSaleType: 'Delivery ou atendimento domiciliar',
    });
  });

  it('outra organização não enxerga a venda nem usa itens alheios', async () => {
    const mine = await createSale(sale());
    await h.db.transaction((tx) =>
      provisionOrganization(tx, {
        organizationName: 'Outra Clínica',
        unitName: 'Sede',
        admin: { name: 'Olga', email: 'olga@outra.test', password: 'senha-forte-789' },
      }),
    );
    const stranger = new TestClient(h.app);
    await stranger.login('olga@outra.test', 'senha-forte-789');
    const olgaId = (await stranger.get('/api/auth/session')).json<Session>().user.id;
    expect((await stranger.get(`/api/sales/${mine.id}`)).statusCode).toBe(404);
    expect((await stranger.send('PUT', `/api/sales/${mine.id}`, sale())).statusCode).toBe(404);
    expect((await stranger.get('/api/sales')).json<{ total: number }>().total).toBe(0);
    const res = await stranger.send(
      'POST',
      '/api/sales',
      sale({
        clientId: null,
        patientId: null,
        items: [{ productId: apoquel.id, professionalId: olgaId, quantity: 1, unitPrice: null }],
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(fieldError(res.body)?.path).toBe('items.0.productId');
  });
});
