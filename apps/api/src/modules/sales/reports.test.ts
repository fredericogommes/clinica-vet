import type {
  ApiError,
  Client,
  Patient,
  PaymentMethod,
  MySales,
  PaymentMethodInput,
  Product,
  ProductInput,
  Sale,
  SaleInput,
  SaleListItem,
  SalesByItem,
  SalesSummary,
  Session,
} from '@clinica/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDays, instantToZoned } from '../../core/zoned-time.js';
import { clientInput, patientInput } from '../../test/fixtures.js';
import { ADMIN, createHarness, loginAs, TestClient, type Harness } from '../../test/harness.js';

let h: Harness;
let admin: TestClient;
let adminId: string;
let client: Client;
let thor: Patient;
let consulta: Product;
let apoquel: Product;
let dinheiro: PaymentMethod;
let visa: PaymentMethod;
let vet: TestClient;
let vetId: string;

const productInput = (overrides: Partial<ProductInput>): ProductInput => ({
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
  ...overrides,
});

const methodInput = (overrides: Partial<PaymentMethodInput> = {}): PaymentMethodInput => ({
  name: 'Rede Visa Crédito',
  kind: 'credit',
  acquirer: 'Rede',
  brand: 'Visa',
  settlementDays: 30,
  maxInstallments: 6,
  feePercent: 3.5,
  ...overrides,
});

async function createMethod(overrides: Partial<PaymentMethodInput> = {}) {
  const res = await admin.send('POST', '/api/payment-methods', methodInput(overrides));
  expect(res.statusCode, res.body).toBe(201);
  return res.json<PaymentMethod>();
}

type Line = [Product, number, string];

async function createSale(lines: Line[], extra: Partial<SaleInput> = {}): Promise<Sale> {
  const res = await admin.send('POST', '/api/sales', {
    kind: 'sale',
    saleType: 'in_person_consumer',
    clientId: client.id,
    patientId: thor.id,
    items: lines.map(([p, quantity, professionalId]) => ({
      productId: p.id,
      professionalId,
      quantity,
      unitPrice: null,
    })),
    discount: { mode: 'amount', value: 0 },
    notes: '',
    ...extra,
  } satisfies SaleInput);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Sale>();
}

const receive = (sale: Sale, payments: unknown[], as = admin) =>
  as.send('POST', `/api/sales/${sale.id}/receive`, { payments });

const fieldError = (body: string) => (JSON.parse(body) as ApiError).error.details?.[0];

const today = () => instantToZoned(new Date(), 'America/Sao_Paulo').date;
const period = (from = today(), to = today()) => `from=${from}&to=${to}`;

async function summary(query = period()): Promise<SalesSummary> {
  const res = await admin.get(`/api/sales/reports/summary?${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<SalesSummary>();
}

beforeEach(async () => {
  h = await createHarness();
  admin = new TestClient(h.app);
  await admin.login(ADMIN.email, ADMIN.password);
  adminId = (await admin.get('/api/auth/session')).json<Session>().user.id;
  client = (await admin.send('POST', '/api/clients', clientInput())).json<Client>();
  thor = (
    await admin.send('POST', '/api/patients', {
      clientId: client.id,
      patient: patientInput({ name: 'Thor' }),
    })
  ).json<Patient>();
  consulta = (
    await admin.send(
      'POST',
      '/api/products',
      productInput({
        kind: 'service',
        serviceKind: 'consultation',
        name: 'Consulta clínica',
        unit: 'un',
        salePrice: 150,
      }),
    )
  ).json<Product>();
  apoquel = (
    await admin.send(
      'POST',
      '/api/products',
      productInput({ name: 'Apoquel 16 mg', salePrice: 40 }),
    )
  ).json<Product>();
  const methods = (await admin.get('/api/payment-methods')).json<PaymentMethod[]>();
  dinheiro = methods.find((m) => m.name === 'Dinheiro')!;
  visa = await createMethod();
  // Recebimento entra no caixa aberto do operador [RN-29].
  expect((await admin.send('POST', '/api/cash', { openingAmount: 100 })).statusCode).toBe(201);
  vet = await loginAs(h, admin, 'Veterinário');
  vetId = (await vet.get('/api/auth/session')).json<Session>().user.id;
});
afterEach(async () => {
  await h.close();
});

/**
 * Cenário: A (consulta 150 pela admin + 2 Apoquel 40 pelo vet, desconto 10) recebida em
 * dinheiro e cartão em 3×; B (1 Apoquel) em aberto; D (orçamento de 1 Apoquel convertido)
 * em aberto. Ficam de fora: orçamento C, venda E recebida e estornada, venda F cancelada.
 */
async function scenario() {
  const a = await createSale(
    [
      [consulta, 1, adminId],
      [apoquel, 2, vetId],
    ],
    { discount: { mode: 'amount', value: 10 } },
  );
  let res = await receive(a, [
    { methodId: dinheiro.id, amount: 100, installments: 1 },
    { methodId: visa.id, amount: 120, installments: 3 },
  ]);
  expect(res.statusCode, res.body).toBe(200);
  const b = await createSale([[apoquel, 1, vetId]]);
  const c = await createSale([[consulta, 1, adminId]], { kind: 'quote' });
  const d = await createSale([[apoquel, 1, vetId]], { kind: 'quote' });
  res = await admin.send('PUT', `/api/sales/${d.id}`, {
    kind: 'sale',
    saleType: 'in_person_consumer',
    clientId: client.id,
    patientId: thor.id,
    items: [{ productId: apoquel.id, professionalId: vetId, quantity: 1, unitPrice: null }],
    discount: { mode: 'amount', value: 0 },
    notes: '',
  } satisfies SaleInput);
  expect(res.statusCode, res.body).toBe(200);
  const e = await createSale([[consulta, 1, adminId]]);
  expect(
    (await receive(e, [{ methodId: dinheiro.id, amount: 150, installments: 1 }])).statusCode,
  ).toBe(200);
  res = await admin.send('POST', `/api/sales/${e.id}/reverse`, { reason: 'Devolução' });
  expect(res.statusCode, res.body).toBe(200);
  const f = await createSale([[consulta, 1, adminId]]);
  res = await admin.send('POST', `/api/sales/${f.id}/cancel`, { reason: 'Engano' });
  expect(res.statusCode, res.body).toBe(200);
  return { a, b, c, d, e, f };
}

describe('consulta vendas [p.9]', () => {
  it('resumo soma só vendas em aberto e baixadas, com quebras por dia, forma, profissional e tipo', async () => {
    await scenario();
    const s = await summary();
    expect(s.totals).toEqual({
      count: 3,
      gross: 310,
      discount: 10,
      discountPercent: 3.23,
      net: 300,
      averageTicket: 100,
      received: 220,
      open: 80,
    });
    expect(s.byDay).toEqual([{ date: today(), ...s.totals }]);
    expect(s.byMethod).toEqual([
      {
        methodName: 'Rede Visa Crédito',
        kind: 'credit',
        count: 1,
        upfront: 0,
        installments: 120,
        total: 120,
      },
      { methodName: 'Dinheiro', kind: 'cash', count: 1, upfront: 100, installments: 0, total: 100 },
    ]);
    const net = (items: { net: number }[]) =>
      items.reduce((t, i) => t + Math.round(i.net * 100), 0) / 100;
    expect(net(s.byProfessional)).toBe(300);
    expect(s.byProfessional.find((p) => p.userId === vetId)).toMatchObject({
      salesCount: 3,
      itemsCount: 3,
    });
    expect(s.byProfessional.find((p) => p.userId === adminId)).toMatchObject({
      salesCount: 1,
      itemsCount: 1,
    });
    expect(net(s.byKind)).toBe(300);
    expect(s.byKind.map((k) => [k.kind, k.salesCount, k.itemsCount])).toEqual([
      ['product', 3, 3],
      ['service', 1, 1],
    ]);

    // Fora do período, nada; período invertido ou longo demais é recusado.
    const empty = await summary(period(addDays(today(), 2), addDays(today(), 3)));
    expect(empty).toMatchObject({ byDay: [], byMethod: [], byProfessional: [], byKind: [] });
    expect(empty.totals).toMatchObject({ count: 0, net: 0, averageTicket: 0, discountPercent: 0 });
    let res = await admin.get(
      `/api/sales/reports/summary?${period(today(), addDays(today(), -1))}`,
    );
    expect(res.statusCode).toBe(400);
    expect(fieldError(res.body)?.message).toBe('A data final vem antes da inicial');
    res = await admin.get(`/api/sales/reports/summary?${period(addDays(today(), -400))}`);
    expect(res.statusCode).toBe(400);
  });

  it('totais por produto e serviço ranqueiam pelo líquido; o filtro de tipo restringe', async () => {
    await scenario();
    let res = await admin.get(`/api/sales/reports/items?${period()}`);
    expect(res.statusCode, res.body).toBe(200);
    let report = res.json<SalesByItem>();
    expect(report.items.map((i) => [i.name, i.quantity, i.salesCount, i.gross])).toEqual([
      ['Apoquel 16 mg', 4, 3, 160],
      ['Consulta clínica', 1, 1, 150],
    ]);
    expect(report.totals).toEqual({ gross: 310, discount: 10, net: 300 });
    res = await admin.get(`/api/sales/reports/items?${period()}&kind=service`);
    report = res.json<SalesByItem>();
    expect(report.items.map((i) => i.name)).toEqual(['Consulta clínica']);
  });

  it('lista filtra pelo período da venda e mostra quando o orçamento virou venda', async () => {
    const { c, d } = await scenario();
    let res = await admin.get(`/api/sales?${period()}&pageSize=50`);
    expect(res.statusCode, res.body).toBe(200);
    const items = res.json<{ items: SaleListItem[]; total: number }>().items;
    expect(items).toHaveLength(6);
    expect(items.find((i) => i.id === c.id)).toMatchObject({ status: 'quote', soldAt: null });
    expect(items.find((i) => i.id === d.id)?.soldAt).not.toBeNull();
    res = await admin.get(`/api/sales?${period(addDays(today(), 1), addDays(today(), 1))}`);
    expect(res.json<{ total: number }>().total).toBe(0);
  });

  it('Minhas vendas traz só os itens do profissional; a consulta geral exige permissão', async () => {
    await scenario();
    let res = await vet.get(`/api/sales/mine?${period()}`);
    expect(res.statusCode, res.body).toBe(200);
    const mine = res.json<MySales>();
    expect(mine.totals).toMatchObject({ salesCount: 3, itemsCount: 3, open: 80 });
    expect(mine.items.map((i) => [i.name, i.quantity])).toEqual([
      ['Apoquel 16 mg', 1],
      ['Apoquel 16 mg', 1],
      ['Apoquel 16 mg', 2],
    ]);
    expect(mine.items[0]).toMatchObject({ clientName: client.name, patientName: 'Thor' });
    expect(mine.truncated).toBe(false);

    res = await admin.get(`/api/sales/mine?${period()}`);
    expect(res.json<MySales>().items.map((i) => i.name)).toEqual(['Consulta clínica']);

    expect((await vet.get(`/api/sales/reports/summary?${period()}`)).statusCode).toBe(403);
    expect((await vet.get(`/api/sales/reports/items?${period()}`)).statusCode).toBe(403);
  });
});
