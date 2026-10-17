import type {
  ApiError,
  AuditEntry,
  CatalogItem,
  Client,
  Patient,
  PaymentMethod,
  Product,
  ProductInput,
  ProductListItem,
  LotTrace,
  ProductStock,
  Sale,
  Session,
} from '@clinica/contracts';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clientInput, patientInput } from '../../test/fixtures.js';
import { ADMIN, createHarness, TestClient, type Harness } from '../../test/harness.js';

let h: Harness;
let admin: TestClient;
let adminId: string;
let client: Client;
let thor: Patient;
let dinheiro: PaymentMethod;
/** Grupo que bloqueia venda sem saldo (padrão) e grupo liberado. */
let controlados: CatalogItem;
let consumo: CatalogItem;
let vacina: Product;
let seringa: Product;

const productInput = (overrides: Partial<ProductInput>): ProductInput => ({
  kind: 'product',
  serviceKind: null,
  name: 'Item',
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
  salePrice: 10,
  cost: null,
  purpose: 'sale',
  desiredMarkup: null,
  allowPriceChange: false,
  showInPriceList: true,
  discountLimitPercent: null,
  defaultCommissionPercent: 0,
  commissions: [],
  tracksStock: true,
  minStock: null,
  idealStock: null,
  ...overrides,
});

async function createProduct(overrides: Partial<ProductInput>): Promise<Product> {
  const res = await admin.send('POST', '/api/products', productInput(overrides));
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Product>();
}

async function group(name: string, blocksSaleWithoutStock?: boolean): Promise<CatalogItem> {
  const res = await admin.send('POST', '/api/catalogs/product-groups', {
    name,
    ...(blocksSaleWithoutStock === undefined ? {} : { blocksSaleWithoutStock }),
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<CatalogItem>();
}

const saleBody = (lines: [Product, number][], kind: 'sale' | 'quote' = 'sale') => ({
  kind,
  saleType: 'in_person_consumer',
  clientId: client.id,
  patientId: thor.id,
  items: lines.map(([p, quantity]) => ({
    productId: p.id,
    professionalId: adminId,
    quantity,
    unitPrice: null,
  })),
  discount: { mode: 'amount', value: 0 },
  notes: '',
});

async function createSale(lines: [Product, number][], kind: 'sale' | 'quote' = 'sale') {
  const res = await admin.send('POST', '/api/sales', saleBody(lines, kind));
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Sale>();
}

async function receive(sale: Sale) {
  return admin.send('POST', `/api/sales/${sale.id}/receive`, {
    payments: [{ methodId: dinheiro.id, amount: sale.netTotal, installments: 1 }],
  });
}

async function adjust(product: Product, body: unknown, as = admin) {
  return as.send('POST', `/api/products/${product.id}/stock`, body);
}

/** Data daqui a `days` dias (AAAA-MM-DD); offsets de 2+ dias evitam a virada do fuso. */
const inDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function entry(product: Product, quantity: number, code: string, expiresOn: string) {
  const res = await adjust(product, {
    kind: 'entry',
    quantity,
    lot: { code, expiresOn },
    notes: 'Nota 123',
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<ProductStock>();
}

/** Estoque do produto, conferindo que a soma dos lotes é o saldo. */
async function stockOf(product: Product): Promise<ProductStock> {
  const res = await admin.get(`/api/products/${product.id}/stock`);
  expect(res.statusCode, res.body).toBe(200);
  const stock = res.json<ProductStock>();
  if (stock.tracksLots) {
    const sumLots = stock.lots.reduce((total, l) => total + Math.round(l.onHand * 1000), 0);
    expect(sumLots / 1000).toBe(stock.onHand);
  }
  return stock;
}

const lots = (stock: ProductStock) => stock.lots.map((l) => [l.code, l.onHand]);

async function trace(product: Product, lotId: string, as = admin): Promise<LotTrace> {
  const res = await as.get(`/api/products/${product.id}/lots/${lotId}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<LotTrace>();
}

async function expire(code: string) {
  await h.db.execute(sql`update stock_lots set expires_on = current_date - 3 where code = ${code}`);
}

const error = (body: string) => (JSON.parse(body) as ApiError).error;

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
  dinheiro = (await admin.get('/api/payment-methods'))
    .json<PaymentMethod[]>()
    .find((m) => m.kind === 'cash')!;
  await admin.send('POST', '/api/cash', { openingAmount: 100, notes: '' });
  controlados = await group('Controlados');
  consumo = await group('Material de consumo', false);
  vacina = await createProduct({
    name: 'Vacina V10',
    unit: 'dose',
    groupId: controlados.id,
    tracksLots: true,
  });
  seringa = await createProduct({ name: 'Seringa 3 ml', groupId: consumo.id, tracksLots: true });
});
afterEach(async () => {
  await h.close();
});

describe('lote e validade [RN-32]', () => {
  it('entrada exige lote e validade; lotes listados pela validade mais próxima', async () => {
    let res = await adjust(vacina, { kind: 'entry', quantity: 5, notes: 'Nota 1' });
    expect(res.statusCode).toBe(400);
    expect(error(res.body).details?.[0]?.path).toBe('lot.code');
    res = await adjust(vacina, {
      kind: 'entry',
      quantity: 5,
      lot: { code: 'v1', expiresOn: inDays(-5) },
      notes: 'Nota 1',
    });
    expect(res.statusCode).toBe(400);
    expect(error(res.body).details?.[0]).toMatchObject({
      path: 'lot.expiresOn',
      message: 'Lote vencido não entra no estoque',
    });

    await entry(vacina, 10, 'b-200', inDays(200));
    await entry(vacina, 4, ' a-10 ', inDays(10));
    // Mesmo lote soma; com outra validade é recusado.
    await entry(vacina, 2, 'B-200', inDays(200));
    res = await adjust(vacina, {
      kind: 'entry',
      quantity: 1,
      lot: { code: 'B-200', expiresOn: inDays(300) },
      notes: 'Nota 2',
    });
    expect(res.statusCode).toBe(400);
    expect(error(res.body).details?.[0]?.message).toMatch(/^O lote B-200 já está cadastrado/);

    const stock = await stockOf(vacina);
    expect(stock).toMatchObject({ tracksLots: true, onHand: 16, available: 16, expired: 0 });
    expect(lots(stock)).toEqual([
      ['A-10', 4],
      ['B-200', 12],
    ]);
    expect(stock.lots.map((l) => l.expiry)).toEqual(['expiring', 'ok']);
    expect(stock.movements[0]?.lots).toEqual([{ code: 'B-200', quantity: 2 }]);

    const list = (await admin.get('/api/products?q=Vacina')).json<{ items: ProductListItem[] }>();
    expect(list.items[0]?.stock).toMatchObject({
      onHand: 16,
      oldestExpiry: inDays(10),
      expiry: 'expiring',
    });

    const audit = (await admin.get(`/api/admin/audit?entity=product&entityId=${vacina.id}`)).json<{
      items: AuditEntry[];
    }>();
    expect(audit.items[0]).toMatchObject({ action: 'stock_entry' });
    expect(audit.items[0]?.after).toMatchObject({ lot: 'B-200', onHand: 16 });
  });

  it('venda sai do lote que vence antes e o rastreio chega ao animal; estorno devolve', async () => {
    await entry(vacina, 3, 'L-60', inDays(60));
    await entry(vacina, 5, 'L-20', inDays(20));
    const sale = await createSale([[vacina, 6]]);
    let res = await receive(sale);
    expect(res.statusCode, res.body).toBe(200);
    let stock = await stockOf(vacina);
    expect(lots(stock)).toEqual([['L-60', 2]]);
    expect(stock.movements[0]).toMatchObject({ kind: 'sale', quantity: -6 });
    expect(stock.movements[0]?.lots).toEqual([
      { code: 'L-20', quantity: -5 },
      { code: 'L-60', quantity: -1 },
    ]);

    const l20 = (
      await adjust(vacina, {
        kind: 'entry',
        quantity: 1,
        lot: { code: 'L-20', expiresOn: inDays(20) },
        notes: 'Nota 9',
      })
    )
      .json<ProductStock>()
      .lots.find((l) => l.code === 'L-20')!;
    const t = await trace(vacina, l20.id);
    expect(t.lot).toMatchObject({ code: 'L-20', onHand: 1, expiresOn: inDays(20) });
    expect(t.movements.map((m) => [m.kind, m.quantity])).toEqual([
      ['entry', 1],
      ['sale', -5],
      ['entry', 5],
    ]);
    expect(t.movements[1]).toMatchObject({
      sale: { id: sale.id, code: sale.code },
      patient: { id: thor.id, name: 'Thor' },
      client: { id: client.id },
    });

    res = await admin.send('POST', `/api/sales/${sale.id}/reverse`, { reason: 'Devolução' });
    expect(res.statusCode, res.body).toBe(200);
    stock = await stockOf(vacina);
    expect(lots(stock)).toEqual([
      ['L-20', 6],
      ['L-60', 3],
    ]);
    expect(stock.movements[0]?.lots).toEqual([
      { code: 'L-20', quantity: 5 },
      { code: 'L-60', quantity: 1 },
    ]);

    // Lote de outro produto não é rastreado por este.
    expect((await admin.get(`/api/products/${seringa.id}/lots/${l20.id}`)).statusCode).toBe(404);
  });

  it('lote vencido fica fora do disponível; a contagem do lote dá a baixa', async () => {
    await entry(vacina, 4, 'VELHO', inDays(40));
    await entry(vacina, 2, 'NOVO', inDays(400));
    await expire('VELHO');
    let stock = await stockOf(vacina);
    expect(stock).toMatchObject({ onHand: 6, expired: 4, available: 2, reserved: 0 });
    expect(stock.lots.map((l) => [l.code, l.expiry])).toEqual([
      ['VELHO', 'expired'],
      ['NOVO', 'ok'],
    ]);

    let res = await admin.send('POST', '/api/sales', saleBody([[vacina, 3]]));
    expect(res.statusCode).toBe(400);
    expect(error(res.body).message).toBe(
      'Só há 2 dose de Vacina V10 disponível (4 dose vencidas ficam de fora).',
    );
    const sale = await createSale([[vacina, 2]]);
    expect((await receive(sale)).statusCode).toBe(200);
    stock = await stockOf(vacina);
    expect(lots(stock)).toEqual([['VELHO', 4]]);
    expect(stock.available).toBe(0);

    // Sem lote informado a contagem é recusada; com o lote, vira o saldo dele.
    res = await adjust(vacina, { kind: 'count', countedQuantity: 0, notes: 'Descarte' });
    expect(res.statusCode).toBe(400);
    expect(error(res.body).details?.[0]?.path).toBe('lotId');
    const velho = stock.lots[0]!;
    res = await adjust(vacina, {
      kind: 'count',
      countedQuantity: 0,
      lotId: velho.id,
      notes: 'Descarte por validade',
    });
    expect(res.statusCode, res.body).toBe(200);
    stock = await stockOf(vacina);
    expect(stock).toMatchObject({ onHand: 0, expired: 0, lots: [] });
    expect(stock.movements[0]).toMatchObject({
      kind: 'count',
      quantity: -4,
      lots: [{ code: 'VELHO', quantity: -4 }],
    });
  });

  it('grupo liberado: venda com lote vencido vira pendência; estorno volta ao lote certo', async () => {
    await entry(seringa, 3, 'S1', inDays(30));
    await entry(seringa, 2, 'S0', inDays(60));
    await expire('S0');
    const sale = await createSale([[seringa, 5]]);
    expect((await receive(sale)).statusCode).toBe(200);
    let stock = await stockOf(seringa);
    // Saldo e pendência convivem: as 2 vencidas seguem no saldo, fora da venda.
    expect(stock).toMatchObject({ onHand: 2, shortfall: 2, expired: 2, available: 0 });

    // A entrada quita a pendência antes de entrar no lote.
    stock = await entry(seringa, 10, 'S2', inDays(90));
    expect(stock).toMatchObject({ onHand: 10, shortfall: 0 });
    expect(lots(await stockOf(seringa))).toEqual([
      ['S0', 2],
      ['S2', 8],
    ]);

    const res = await admin.send('POST', `/api/sales/${sale.id}/reverse`, {
      reason: 'Devolução',
    });
    expect(res.statusCode, res.body).toBe(200);
    stock = await stockOf(seringa);
    expect(stock.onHand).toBe(15);
    expect(lots(stock)).toEqual([
      ['S0', 2],
      ['S1', 3],
      ['S2', 8],
      ['SEM LOTE', 2],
    ]);
  });

  it('ligar o controle de lote leva o saldo para "SEM LOTE"; desligar exige lotes zerados', async () => {
    const product = await createProduct({ name: 'Antipulgas', groupId: controlados.id });
    let res = await adjust(product, { kind: 'entry', quantity: 7, notes: 'Nota 7' });
    expect(res.statusCode, res.body).toBe(200);
    const update = (tracksLots: boolean, tracksStock = true) =>
      admin.send(
        'PUT',
        `/api/products/${product.id}`,
        productInput({ name: 'Antipulgas', groupId: controlados.id, tracksLots, tracksStock }),
      );
    res = await update(true);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<Product>().tracksLots).toBe(true);
    let stock = await stockOf(product);
    expect(lots(stock)).toEqual([['SEM LOTE', 7]]);
    expect(stock.lots[0]?.expiresOn).toBeNull();

    // O lote com validade sai antes do saldo antigo.
    await entry(product, 2, 'AP-1', inDays(100));
    const sale = await createSale([[product, 3]]);
    expect((await receive(sale)).statusCode).toBe(200);
    stock = await stockOf(product);
    expect(lots(stock)).toEqual([['SEM LOTE', 6]]);

    res = await update(false);
    expect(res.statusCode).toBe(409);
    res = await update(false, false);
    expect(res.statusCode).toBe(409);
    const legacy = stock.lots[0]!;
    res = await adjust(product, {
      kind: 'count',
      countedQuantity: 0,
      lotId: legacy.id,
      notes: 'Zerado',
    });
    expect(res.statusCode, res.body).toBe(200);
    res = await update(false);
    expect(res.statusCode, res.body).toBe(200);
    stock = await stockOf(product);
    expect(stock).toMatchObject({ tracksLots: false, lots: [] });
    // Sem lote, a entrada volta a dispensar lote e validade.
    res = await adjust(product, { kind: 'entry', quantity: 1, notes: 'Nota 8' });
    expect(res.statusCode, res.body).toBe(200);
  });
});
