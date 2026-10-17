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
  ProductStock,
  Sale,
  SellableItem,
  Session,
} from '@clinica/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clientInput, patientInput } from '../../test/fixtures.js';
import { ADMIN, createHarness, loginAs, TestClient, type Harness } from '../../test/harness.js';

let h: Harness;
let admin: TestClient;
let adminId: string;
let client: Client;
let thor: Patient;
let dinheiro: PaymentMethod;
/** Grupo que bloqueia venda sem saldo (padrão) e grupo liberado. */
let controlados: CatalogItem;
let consumo: CatalogItem;
let dipirona: Product;
let luva: Product;

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

async function entry(product: Product, quantity: number) {
  const res = await adjust(product, { kind: 'entry', quantity, notes: 'Nota 123' });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<ProductStock>();
}

async function stockOf(product: Product): Promise<ProductStock> {
  const res = await admin.get(`/api/products/${product.id}/stock`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<ProductStock>();
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
  dipirona = await createProduct({ name: 'Dipirona gotas', unit: 'fr', groupId: controlados.id });
  luva = await createProduct({ name: 'Luva de procedimento', groupId: consumo.id, minStock: 10 });
});
afterEach(async () => {
  await h.close();
});

describe('estoque [RN-31]', () => {
  it('entrada e contagem mudam o saldo com movimento e auditoria; só com permissão', async () => {
    expect(controlados.blocksSaleWithoutStock).toBe(true);
    expect(consumo.blocksSaleWithoutStock).toBe(false);
    const servico = await createProduct({
      kind: 'service',
      serviceKind: 'consultation',
      name: 'Consulta',
      tracksStock: false,
    });
    expect((await admin.get(`/api/products/${servico.id}/stock`)).json()).toBeNull();
    expect((await adjust(servico, { kind: 'entry', quantity: 1, notes: 'Nota' })).statusCode).toBe(
      409,
    );

    expect((await stockOf(luva)).onHand).toBe(0);
    let stock = await entry(luva, 12.5);
    expect(stock).toMatchObject({ onHand: 12.5, available: 12.5, shortfall: 0, canAdjust: true });
    let res = await adjust(luva, { kind: 'count', countedQuantity: 9, notes: 'Contagem mensal' });
    expect(res.statusCode, res.body).toBe(200);
    stock = res.json<ProductStock>();
    expect(stock.onHand).toBe(9);
    expect(stock.movements.map((m) => [m.kind, m.quantity, m.onHandAfter])).toEqual([
      ['count', -3.5, 9],
      ['entry', 12.5, 12.5],
    ]);

    res = await adjust(luva, { kind: 'entry', quantity: 0, notes: 'x' });
    expect(res.statusCode).toBe(400);
    expect(
      error(res.body)
        .details?.map((d) => d.path)
        .sort(),
    ).toEqual(['notes', 'quantity']);

    // Lista mostra o saldo e o alerta de mínimo; serviço não controla estoque.
    const list = (await admin.get('/api/products?pageSize=50')).json<{
      items: ProductListItem[];
    }>();
    expect(list.items.find((p) => p.id === luva.id)?.stock).toEqual({
      onHand: 9,
      shortfall: 0,
      belowMin: true,
    });
    expect(list.items.find((p) => p.id === servico.id)?.stock).toBeNull();

    const vet = await loginAs(h, admin, 'Veterinário');
    expect((await vet.get(`/api/products/${luva.id}/stock`)).json<ProductStock>().canAdjust).toBe(
      false,
    );
    expect(
      (await adjust(luva, { kind: 'entry', quantity: 1, notes: 'Nota' }, vet)).statusCode,
    ).toBe(403);

    const audit = (await admin.get(`/api/admin/audit?entity=product&entityId=${luva.id}`)).json<{
      items: AuditEntry[];
    }>();
    expect(audit.items.map((a) => a.action).slice(0, 2)).toEqual(['stock_count', 'stock_entry']);
    expect(audit.items[0]).toMatchObject({
      before: { onHand: 12.5 },
      after: { onHand: 9, notes: 'Contagem mensal' },
    });
  });

  it('venda em aberto reserva; grupo que bloqueia recusa acima do disponível', async () => {
    await entry(dipirona, 5);
    const first = await createSale([[dipirona, 3]]);
    expect(first.items[0]?.stock).toEqual({
      available: 5,
      shortfall: 0,
      blocksSaleWithoutStock: true,
    });
    const sellable = (await admin.get('/api/sales/sellable?q=Dipirona')).json<SellableItem[]>();
    expect(sellable[0]?.stock?.available).toBe(2);
    expect(await stockOf(dipirona)).toMatchObject({ onHand: 5, reserved: 3, available: 2 });

    let res = await admin.send('POST', '/api/sales', saleBody([[dipirona, 3]]));
    expect(res.statusCode).toBe(400);
    expect(error(res.body).details).toEqual([
      { path: 'items.0.quantity', message: 'Só há 2 fr de Dipirona gotas disponível' },
    ]);
    // Duas linhas do mesmo item somam; orçamento não reserva nem bloqueia.
    res = await admin.send(
      'POST',
      '/api/sales',
      saleBody([
        [dipirona, 1],
        [dipirona, 2],
      ]),
    );
    expect(res.statusCode).toBe(400);
    const quote = await createSale([[dipirona, 50]], 'quote');
    expect((await stockOf(dipirona)).reserved).toBe(3);
    res = await admin.send('PUT', `/api/sales/${quote.id}`, saleBody([[dipirona, 50]]));
    expect(res.statusCode).toBe(400);

    // Editar a própria venda não conta a reserva dela contra ela mesma.
    res = await admin.send('PUT', `/api/sales/${first.id}`, saleBody([[dipirona, 5]]));
    expect(res.statusCode, res.body).toBe(200);
    // Cancelar libera a reserva.
    res = await admin.send('POST', `/api/sales/${first.id}/cancel`, { reason: 'Desistiu' });
    expect(res.statusCode, res.body).toBe(200);
    expect(await stockOf(dipirona)).toMatchObject({ reserved: 0, available: 5 });
    res = await admin.send('PUT', `/api/sales/${quote.id}`, saleBody([[dipirona, 5]]));
    expect(res.statusCode, res.body).toBe(200);
  });

  it('baixa tira do saldo e o estorno devolve; sem saldo na baixa, grupo que bloqueia recusa', async () => {
    await entry(dipirona, 5);
    const sale = await createSale([[dipirona, 3]]);
    let res = await receive(sale);
    expect(res.statusCode, res.body).toBe(200);
    let stock = await stockOf(dipirona);
    expect(stock).toMatchObject({ onHand: 2, reserved: 0, available: 2 });
    expect(stock.movements[0]).toMatchObject({
      kind: 'sale',
      quantity: -3,
      onHandAfter: 2,
      sale: { id: sale.id, code: sale.code },
    });

    res = await admin.send('POST', `/api/sales/${sale.id}/reverse`, { reason: 'Devolução' });
    expect(res.statusCode, res.body).toBe(200);
    stock = await stockOf(dipirona);
    expect(stock.onHand).toBe(5);
    expect(stock.movements[0]).toMatchObject({ kind: 'sale_return', quantity: 3, onHandAfter: 5 });

    // A contagem baixou o saldo depois da reserva: a baixa não deixa ficar negativo.
    const late = await createSale([[dipirona, 4]]);
    res = await adjust(dipirona, { kind: 'count', countedQuantity: 1, notes: 'Frasco quebrado' });
    expect(res.statusCode, res.body).toBe(200);
    res = await receive(late);
    expect(res.statusCode).toBe(409);
    expect(error(res.body).message).toBe(
      'Só há 1 fr de Dipirona gotas em estoque para baixar a venda.',
    );
    expect((await admin.get(`/api/sales/${late.id}`)).json<Sale>().status).toBe('open');
    expect((await stockOf(dipirona)).onHand).toBe(1);
  });

  it('grupo liberado vende sem saldo e a falta vira pendência, quitada pela entrada', async () => {
    await entry(luva, 2);
    const sale = await createSale([[luva, 5]]);
    expect(sale.items[0]?.stock).toMatchObject({ available: 2, blocksSaleWithoutStock: false });
    const res = await receive(sale);
    expect(res.statusCode, res.body).toBe(200);
    let stock = await stockOf(luva);
    expect(stock).toMatchObject({ onHand: 0, shortfall: 3 });
    expect(stock.movements[0]).toMatchObject({ kind: 'sale', quantity: -5, shortfall: 3 });

    stock = await entry(luva, 10);
    expect(stock).toMatchObject({ onHand: 7, shortfall: 0 });
    // Pendência de novo, agora resolvida pela contagem: o contado vira o saldo.
    await receive(await createSale([[luva, 9]]));
    expect(await stockOf(luva)).toMatchObject({ onHand: 0, shortfall: 2 });
    const counted = await adjust(luva, { kind: 'count', countedQuantity: 4, notes: 'Achei caixa' });
    expect(counted.json<ProductStock>()).toMatchObject({ onHand: 4, shortfall: 0 });
    expect(counted.json<ProductStock>().movements[0]).toMatchObject({ kind: 'count', quantity: 6 });

    // Mudar o grupo para bloquear passa a recusar.
    const put = await admin.send('PUT', `/api/catalogs/product-groups/${consumo.id}`, {
      name: consumo.name,
      blocksSaleWithoutStock: true,
    });
    expect(put.json<CatalogItem>().blocksSaleWithoutStock).toBe(true);
    expect((await admin.send('POST', '/api/sales', saleBody([[luva, 5]]))).statusCode).toBe(400);
    // Renomear sem informar a regra mantém a regra.
    const renamed = await admin.send('PUT', `/api/catalogs/product-groups/${consumo.id}`, {
      name: 'Descartáveis',
    });
    expect(renamed.json<CatalogItem>().blocksSaleWithoutStock).toBe(true);
  });

  it('vendas simultâneas do mesmo item nunca reservam além do saldo', async () => {
    await entry(dipirona, 5);
    // Orçamentos não reservam; convertê-los ao mesmo tempo disputa o mesmo saldo (a conversão
    // não passa pelo contador de código, que serializaria a criação por outro motivo).
    const quotes = await Promise.all(
      Array.from({ length: 8 }, () => createSale([[dipirona, 1]], 'quote')),
    );
    const results = await Promise.all(
      quotes.map((q) => admin.send('PUT', `/api/sales/${q.id}`, saleBody([[dipirona, 1]]))),
    );
    const codes = results.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 200)).toHaveLength(5);
    expect(codes.filter((c) => c === 400)).toHaveLength(3);
    expect(await stockOf(dipirona)).toMatchObject({ onHand: 5, reserved: 5, available: 0 });
  });
});
