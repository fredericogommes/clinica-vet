import type {
  ApiError,
  Product,
  ProductInput,
  ProductStock,
  Purchase,
  PurchaseOrder,
  PurchaseOrderInput,
  PurchaseOrderList,
  PurchaseSuggestion,
  StockExitInput,
} from '@clinica/contracts';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, createHarness, loginAs, TestClient, type Harness } from '../../test/harness.js';

let h: Harness;
let admin: TestClient;

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
  new Date(),
);

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

/** Produto com estoque inicial; `old` joga cadastro e entrada para 200 dias atrás. */
async function product(
  overrides: Partial<ProductInput>,
  stock: { entry?: number; out?: number; old?: boolean },
): Promise<Product> {
  const res = await admin.send('POST', '/api/products', productInput(overrides));
  expect(res.statusCode, res.body).toBe(201);
  const created = res.json<Product>();
  if (stock.entry) {
    const entry = await admin.send('POST', `/api/products/${created.id}/stock`, {
      kind: 'entry',
      quantity: stock.entry,
      notes: 'Estoque inicial',
    });
    expect(entry.statusCode, entry.body).toBe(200);
  }
  if (stock.old) {
    await h.db.execute(
      sql`update products set created_at = now() - interval '200 days' where id = ${created.id}`,
    );
    await h.db.execute(
      sql`update stock_movements set created_at = now() - interval '200 days' where product_id = ${created.id}`,
    );
  }
  if (stock.out) {
    const body: StockExitInput = {
      reason: 'internal_use',
      occurredOn: today,
      notes: '',
      items: [{ productId: created.id, lotId: null, quantity: stock.out }],
    };
    const exit = await admin.send('POST', '/api/stock/exits', body);
    expect(exit.statusCode, exit.body).toBe(201);
  }
  return created;
}

let luva: Product;
let fio: Product;
let supplierId: string;

const tomorrow = (() => {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
})();
const fieldError = (body: string) => (JSON.parse(body) as ApiError).error.details?.[0];

beforeEach(async () => {
  h = await createHarness();
  admin = new TestClient(h.app);
  await admin.login(ADMIN.email, ADMIN.password);
  // Luva: 10 em estoque, mínimo 20, 40 saídas em 90 dias. Sem ideal, pede o dobro do mínimo.
  luva = await product(
    { name: 'Luva', cost: 0.5, minStock: 20 },
    { entry: 50, out: 40, old: true },
  );
  // Fio: 7 em estoque, abaixo do mínimo 10; pede até o ideal 50.
  fio = await product(
    { name: 'Fio de sutura', cost: 9.9, minStock: 10, idealStock: 50 },
    { entry: 15, out: 8, old: true },
  );
  await product({ name: 'Coleira', cost: 20 }, { entry: 5, old: true });
  const supplier = await admin.send('POST', '/api/finance/suppliers', {
    name: 'Distribuidora Vet',
    document: '',
    phone: '(11) 98888-7777',
    email: 'pedidos@distribuidora.test',
    notes: '',
  });
  expect(supplier.statusCode, supplier.body).toBe(201);
  supplierId = supplier.json<{ id: string }>().id;
});
afterEach(async () => {
  await h.close();
});

const orderBody = (overrides: Partial<PurchaseOrderInput> = {}): PurchaseOrderInput => ({
  supplierId,
  expectedOn: tomorrow,
  notes: 'Entregar pela manhã',
  items: [
    { productId: luva.id, quantity: 30, unitCost: 0.5 },
    { productId: fio.id, quantity: 43, unitCost: null },
  ],
  ...overrides,
});

const suggestion = async () =>
  (
    await admin.get(`/api/purchase-orders/suggestion?supplierId=${supplierId}`)
  ).json<PurchaseSuggestion>();

describe('pedido de compra', () => {
  it('sugere o que está em Repor e desconta o que já foi pedido', async () => {
    expect(
      (await suggestion()).items.map((i) => [i.name, i.onHand, i.onOrder, i.suggested, i.unitCost]),
    ).toEqual([
      ['Fio de sutura', 7, 0, 43, 9.9],
      ['Luva', 10, 0, 30, 0.5],
    ]);
    const created = (
      await admin.send('POST', '/api/purchase-orders', orderBody())
    ).json<PurchaseOrder>();
    // O rascunho ainda não conta como pedido.
    expect((await suggestion()).items).toHaveLength(2);
    await admin.send('POST', `/api/purchase-orders/${created.id}/send`);
    expect((await suggestion()).items.map((i) => [i.name, i.onOrder, i.suggested])).toEqual([]);
  });

  it('cria, envia e recebe como compra em rascunho', async () => {
    let res = await admin.send('POST', '/api/purchase-orders', orderBody());
    expect(res.statusCode, res.body).toBe(201);
    let order = res.json<PurchaseOrder>();
    expect(order).toMatchObject({
      status: 'draft',
      total: 15,
      supplier: { name: 'Distribuidora Vet', phone: '11988887777' },
      createdBy: ADMIN.name,
      purchase: null,
    });
    expect(order.message).toContain('- 30 un de Luva');
    expect(order.message).toContain('- 43 un de Fio de sutura');
    expect(order.message).toContain('Entrega desejada:');
    expect(order.message).toContain('Entregar pela manhã');

    res = await admin.send(
      'PUT',
      `/api/purchase-orders/${order.id}`,
      orderBody({ items: [{ productId: luva.id, quantity: 40, unitCost: 0.45 }] }),
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<PurchaseOrder>()).toMatchObject({ total: 18 });

    res = await admin.send('POST', `/api/purchase-orders/${order.id}/send`);
    expect(res.json<PurchaseOrder>()).toMatchObject({ status: 'sent', sentBy: ADMIN.name });
    res = await admin.send('PUT', `/api/purchase-orders/${order.id}`, orderBody());
    expect(res.statusCode).toBe(409);
    res = await admin.send('POST', `/api/purchase-orders/${order.id}/send`);
    expect(res.statusCode).toBe(409);

    res = await admin.send('POST', `/api/purchase-orders/${order.id}/receive`);
    expect(res.statusCode, res.body).toBe(200);
    order = res.json<PurchaseOrder>();
    expect(order.status).toBe('received');
    expect(order.purchase).not.toBeNull();
    const purchase = (await admin.get(`/api/purchases/${order.purchase!.id}`)).json<Purchase>();
    expect(purchase).toMatchObject({
      status: 'draft',
      supplier: { id: supplierId },
      notes: `Pedido de compra ${String(order.code)}`,
    });
    expect(purchase.items.map((i) => [i.product?.name, i.quantity, i.total])).toEqual([
      ['Luva', 40, 18],
    ]);
    // A compra em rascunho não mexe no estoque.
    expect((await admin.get(`/api/products/${luva.id}/stock`)).json<ProductStock>().onHand).toBe(
      10,
    );
    res = await admin.send('POST', `/api/purchase-orders/${order.id}/cancel`, { reason: 'Engano' });
    expect(res.statusCode).toBe(409);

    const open = (await admin.get('/api/purchase-orders')).json<PurchaseOrderList>();
    expect(open.total).toBe(0);
    const received = (
      await admin.get('/api/purchase-orders?situacao=recebidos')
    ).json<PurchaseOrderList>();
    expect(received.items[0]).toMatchObject({ supplier: 'Distribuidora Vet', itemCount: 1 });
  });

  it('valida itens e data, cancela e respeita permissões', async () => {
    const send = (body: PurchaseOrderInput) => admin.send('POST', '/api/purchase-orders', body);
    let res = await send(
      orderBody({
        items: [
          { productId: luva.id, quantity: 1, unitCost: null },
          { productId: luva.id, quantity: 2, unitCost: null },
        ],
      }),
    );
    expect(fieldError(res.body)).toEqual({
      path: 'items.1.productId',
      message: 'Produto repetido no pedido',
    });
    res = await send(orderBody({ expectedOn: '2020-01-01' }));
    expect(fieldError(res.body)?.path).toBe('expectedOn');
    res = await send(orderBody({ items: [] }));
    expect(fieldError(res.body)?.path).toBe('items');

    const order = (await send(orderBody())).json<PurchaseOrder>();
    res = await admin.send('POST', `/api/purchase-orders/${order.id}/cancel`, {
      reason: 'Fornecedor sem estoque',
    });
    expect(res.json<PurchaseOrder>()).toMatchObject({
      status: 'cancelled',
      cancelReason: 'Fornecedor sem estoque',
      cancelledBy: ADMIN.name,
    });
    res = await admin.send('POST', `/api/purchase-orders/${order.id}/receive`);
    expect(res.statusCode).toBe(409);

    const recep = await loginAs(h, admin, 'Recepcionista');
    expect((await recep.get('/api/purchase-orders')).statusCode).toBe(403);
    expect((await recep.get('/api/purchase-orders/suggestion')).statusCode).toBe(403);
  });
});
