import type {
  ApiError,
  CatalogItem,
  Product,
  ProductInput,
  ProductStock,
  StockCount,
  StockExit,
  StockExitInput,
  StockExitList,
  StockOptions,
} from '@clinica/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, createHarness, loginAs, TestClient, type Harness } from '../../test/harness.js';

let h: Harness;
let admin: TestClient;
let luva: Product;
let vacina: Product;
let vacinas: CatalogItem;

const TZ = 'America/Sao_Paulo';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const shift = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const fieldError = (body: string) => (JSON.parse(body) as ApiError).error.details?.[0];

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

async function entry(
  product: Product,
  quantity: number,
  lot?: { code: string; expiresOn: string },
) {
  const res = await admin.send('POST', `/api/products/${product.id}/stock`, {
    kind: 'entry',
    quantity,
    ...(lot ? { lot } : {}),
    notes: 'Estoque inicial',
  });
  expect(res.statusCode, res.body).toBe(200);
}

const stockOf = async (product: Product) =>
  (await admin.get(`/api/products/${product.id}/stock`)).json<ProductStock>();

const lotsOf = async (product: Product) =>
  Object.fromEntries((await stockOf(product)).lots.map((l) => [l.code, l.onHand]));

beforeEach(async () => {
  h = await createHarness();
  admin = new TestClient(h.app);
  await admin.login(ADMIN.email, ADMIN.password);
  const group = await admin.send('POST', '/api/catalogs/product-groups', { name: 'Vacinas' });
  expect(group.statusCode, group.body).toBe(201);
  vacinas = group.json<CatalogItem>();
  luva = await createProduct({ name: 'Luva de procedimento', cost: 0.5 });
  vacina = await createProduct({
    name: 'Vacina V10',
    groupId: vacinas.id,
    tracksLots: true,
    cost: 40,
  });
  await entry(luva, 100);
  await entry(vacina, 6, { code: 'A1', expiresOn: shift(today, 200) });
  await entry(vacina, 4, { code: 'B2', expiresOn: shift(today, 400) });
});
afterEach(async () => {
  await h.close();
});

describe('outras saídas', () => {
  async function lotId(code: string) {
    const options = (await admin.get('/api/stock/options')).json<StockOptions>();
    const lot = options.products.find((p) => p.id === vacina.id)?.lots.find((l) => l.code === code);
    if (!lot) throw new Error(`lote ${code}`);
    return lot.id;
  }

  const exitBody = (overrides: Partial<StockExitInput>): StockExitInput => ({
    reason: 'breakage',
    occurredOn: today,
    notes: '',
    items: [],
    ...overrides,
  });

  it('baixa por lote com o custo do momento e cancela devolvendo ao lote', async () => {
    const a1 = await lotId('A1');
    let res = await admin.send(
      'POST',
      '/api/stock/exits',
      exitBody({
        items: [
          { productId: luva.id, lotId: null, quantity: 20 },
          { productId: vacina.id, lotId: a1, quantity: 2 },
        ],
      }),
    );
    expect(res.statusCode, res.body).toBe(201);
    const exit = res.json<StockExit>();
    expect(exit).toMatchObject({
      reason: 'breakage',
      totalCost: 90,
      createdBy: ADMIN.name,
      cancelledAt: null,
    });
    expect(
      exit.items.map((i) => [i.product.name, i.lot?.code ?? null, i.quantity, i.unitCost]),
    ).toEqual([
      ['Luva de procedimento', null, 20, 0.5],
      ['Vacina V10', 'A1', 2, 40],
    ]);
    expect((await stockOf(luva)).onHand).toBe(80);
    expect(await lotsOf(vacina)).toEqual({ A1: 4, B2: 4 });
    expect((await stockOf(vacina)).movements[0]).toMatchObject({
      kind: 'exit',
      quantity: -2,
      exit: { id: exit.id, code: exit.code },
    });

    const list = (await admin.get('/api/stock/exits')).json<StockExitList>();
    expect(list).toMatchObject({ total: 1, totalCost: 90 });
    expect(list.items[0]).toMatchObject({
      products: 'Luva de procedimento, Vacina V10',
      itemCount: 2,
      cancelled: false,
    });

    res = await admin.send('POST', `/api/stock/exits/${exit.id}/cancel`, {
      reason: 'Lançada errada',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<StockExit>()).toMatchObject({
      cancelReason: 'Lançada errada',
      cancelledBy: ADMIN.name,
    });
    expect((await stockOf(luva)).onHand).toBe(100);
    expect(await lotsOf(vacina)).toEqual({ A1: 6, B2: 4 });
    expect((await stockOf(luva)).movements[0]).toMatchObject({ kind: 'exit_cancel', quantity: 20 });
    res = await admin.send('POST', `/api/stock/exits/${exit.id}/cancel`, { reason: 'De novo' });
    expect(res.statusCode).toBe(409);

    const active = (await admin.get('/api/stock/exits')).json<StockExitList>();
    expect(active).toMatchObject({ total: 0, totalCost: 0 });
    const cancelled = (
      await admin.get('/api/stock/exits?situacao=canceladas&motivo=breakage')
    ).json<StockExitList>();
    expect(cancelled.total).toBe(1);
  });

  it('recusa sem saldo, sem lote, no futuro e outro motivo sem descrição', async () => {
    const b2 = await lotId('B2');
    const send = (body: StockExitInput) => admin.send('POST', '/api/stock/exits', body);
    let res = await send(exitBody({ items: [{ productId: luva.id, lotId: null, quantity: 101 }] }));
    expect(fieldError(res.body)).toEqual({
      path: 'items.0.quantity',
      message: 'Só há 100 un de Luva de procedimento em estoque',
    });
    res = await send(exitBody({ items: [{ productId: vacina.id, lotId: null, quantity: 1 }] }));
    expect(fieldError(res.body)).toEqual({
      path: 'items.0.lotId',
      message: 'Escolha o lote que sai',
    });
    res = await send(
      exitBody({
        items: [
          { productId: vacina.id, lotId: b2, quantity: 3 },
          { productId: vacina.id, lotId: b2, quantity: 2 },
        ],
      }),
    );
    expect(fieldError(res.body)).toEqual({
      path: 'items.1.quantity',
      message: 'Só há 1 un no lote B2',
    });
    res = await send(
      exitBody({
        occurredOn: shift(today, 1),
        items: [{ productId: luva.id, lotId: null, quantity: 1 }],
      }),
    );
    expect(fieldError(res.body)?.path).toBe('occurredOn');
    res = await send(
      exitBody({ reason: 'other', items: [{ productId: luva.id, lotId: null, quantity: 1 }] }),
    );
    expect(fieldError(res.body)).toEqual({ path: 'notes', message: 'Descreva o motivo' });
    // Nada saiu pela metade.
    expect((await stockOf(luva)).onHand).toBe(100);
    expect(await lotsOf(vacina)).toEqual({ A1: 6, B2: 4 });
  });
});

describe('inventário', () => {
  it('conta por lote, aplica as diferenças e guarda o saldo de antes', async () => {
    let res = await admin.send('POST', '/api/stock/counts', {
      groupId: null,
      notes: 'Fechamento do mês',
    });
    expect(res.statusCode, res.body).toBe(201);
    const count = res.json<StockCount>();
    expect(count.status).toBe('open');
    expect(
      count.lines.map((l) => [l.product.name, l.lot?.code ?? null, l.expected, l.counted]),
    ).toEqual([
      ['Luva de procedimento', null, 100, null],
      ['Vacina V10', 'A1', 6, null],
      ['Vacina V10', 'B2', 4, null],
    ]);
    const [luvaLine, a1Line] = count.lines;

    // Venda ou saída durante a contagem: o saldo esperado acompanha até aplicar.
    await admin.send('POST', '/api/stock/exits', {
      reason: 'internal_use',
      occurredOn: today,
      notes: '',
      items: [{ productId: luva.id, lotId: null, quantity: 10 }],
    });
    res = await admin.send('PUT', `/api/stock/counts/${count.id}`, {
      lines: [
        { id: luvaLine!.id, counted: 85 },
        { id: a1Line!.id, counted: 5 },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<StockCount>().lines.map((l) => [l.expected, l.counted])).toEqual([
      [90, 85],
      [6, 5],
      [4, null],
    ]);

    res = await admin.send('POST', `/api/stock/counts/${count.id}/apply`);
    expect(res.statusCode, res.body).toBe(200);
    const applied = res.json<StockCount>();
    expect(applied).toMatchObject({ status: 'applied', closedBy: ADMIN.name });
    // O lote não contado sai do inventário e fica como estava.
    expect(applied.lines.map((l) => [l.lot?.code ?? null, l.expected, l.counted])).toEqual([
      [null, 90, 85],
      ['A1', 6, 5],
    ]);
    expect((await stockOf(luva)).onHand).toBe(85);
    expect(await lotsOf(vacina)).toEqual({ A1: 5, B2: 4 });
    expect((await stockOf(vacina)).onHand).toBe(9);
    expect((await stockOf(luva)).movements[0]).toMatchObject({
      kind: 'count',
      quantity: -5,
      count: { id: count.id, code: count.code },
    });

    res = await admin.send('PUT', `/api/stock/counts/${count.id}`, { lines: [] });
    expect(res.statusCode).toBe(409);
    res = await admin.send('POST', `/api/stock/counts/${count.id}/apply`);
    expect(res.statusCode).toBe(409);
  });

  it('por grupo, sem contagem não aplica, cancela e respeita permissões', async () => {
    let res = await admin.send('POST', '/api/stock/counts', { groupId: vacinas.id, notes: '' });
    const count = res.json<StockCount>();
    expect(count.group).toEqual({ id: vacinas.id, name: 'Vacinas' });
    expect(count.lines.map((l) => l.product.name)).toEqual(['Vacina V10', 'Vacina V10']);
    res = await admin.send('POST', `/api/stock/counts/${count.id}/apply`);
    expect(res.statusCode).toBe(409);
    res = await admin.send('POST', `/api/stock/counts/${count.id}/cancel`);
    expect(res.json<StockCount>().status).toBe('cancelled');
    const list = (await admin.get('/api/stock/counts')).json<{
      items: { status: string; lines: number }[];
    }>();
    expect(list.items[0]).toMatchObject({ status: 'cancelled', lines: 2 });

    const recep = await loginAs(h, admin, 'Recepcionista');
    expect((await recep.get('/api/stock/options')).statusCode).toBe(403);
    expect((await recep.get('/api/stock/exits')).statusCode).toBe(403);
    expect(
      (await recep.send('POST', '/api/stock/counts', { groupId: null, notes: '' })).statusCode,
    ).toBe(403);
  });
});
