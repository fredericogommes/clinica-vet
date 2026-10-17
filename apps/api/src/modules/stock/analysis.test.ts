import type {
  Product,
  ProductInput,
  ProductStock,
  StockAnalysis,
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

let seringa: Product;

beforeEach(async () => {
  h = await createHarness();
  admin = new TestClient(h.app);
  await admin.login(ADMIN.email, ADMIN.password);
  // 30 saídas em 90 dias: 10 por mês. 70 em estoque duram 210 dias, acima de 180: excesso de 10.
  seringa = await product({ name: 'Seringa 3 ml', cost: 1 }, { entry: 100, out: 30, old: true });
  await product({ name: 'Luva', cost: 0.5, minStock: 20 }, { entry: 50, out: 35, old: true });
  await product({ name: 'Coleira', cost: 20 }, { entry: 5, old: true });
  await product({ name: 'Vacina nova', cost: 40 }, { entry: 10 });
  await product({ name: 'Gaze', cost: 2 }, { entry: 30, out: 15, old: true });
  await product(
    { name: 'Fio de sutura', cost: 1, idealStock: 10 },
    { entry: 40, out: 6, old: true },
  );
  await product({ name: 'Shampoo', cost: 10 }, { old: true });
  await product(
    { name: 'Consulta', kind: 'service', serviceKind: 'consultation', tracksStock: false },
    {},
  );
});
afterEach(async () => {
  await h.close();
});

describe('análise de estoque', () => {
  it('classifica a carteira com contagem e valor por situação', async () => {
    const res = await admin.get('/api/stock/analysis');
    expect(res.statusCode, res.body).toBe(200);
    const analysis = res.json<StockAnalysis>();
    expect(analysis.summary).toEqual([
      { situation: 'repor', count: 1, value: 7.5 },
      { situation: 'excesso', count: 2, value: 104 },
      { situation: 'parado', count: 1, value: 100 },
      { situation: 'novos', count: 1, value: 400 },
      { situation: 'adequado', count: 1, value: 30 },
    ]);
    expect(analysis.total).toEqual({ count: 6, value: 641.5 });
    // Shampoo está sem saldo e sem giro; o serviço nem entra.
    expect(analysis.idle).toBe(1);
    expect(analysis.items.map((i) => [i.name, i.situation])).toEqual([
      ['Vacina nova', 'novos'],
      ['Coleira', 'parado'],
      ['Seringa 3 ml', 'excesso'],
      ['Fio de sutura', 'excesso'],
      ['Gaze', 'adequado'],
      ['Luva', 'repor'],
    ]);
    expect(analysis.items.find((i) => i.name === 'Fio de sutura')).toMatchObject({
      onHand: 34,
      monthlyConsumption: 2,
      durationDays: 510,
      excess: 24,
      excessCost: 24,
    });
    expect(analysis.items.find((i) => i.name === 'Luva')).toMatchObject({
      onHand: 15,
      minStock: 20,
      durationDays: 38,
      excess: null,
    });
  });

  it('filtra por situação e busca, e a ficha mostra os mesmos indicadores', async () => {
    const excess = (await admin.get('/api/stock/analysis?situacao=excesso')).json<StockAnalysis>();
    expect(excess.matches).toBe(2);
    expect(excess.items.map((i) => i.name)).toEqual(['Seringa 3 ml', 'Fio de sutura']);
    expect(excess.total.count).toBe(6);

    const search = (await admin.get('/api/stock/analysis?q=LUVA')).json<StockAnalysis>();
    expect(search.total).toEqual({ count: 1, value: 7.5 });

    const stock = (await admin.get(`/api/products/${seringa.id}/stock`)).json<ProductStock>();
    expect(stock.indicators).toMatchObject({
      situation: 'excesso',
      monthlyConsumption: 10,
      durationDays: 210,
      excess: 10,
      totalCost: 70,
      excessCost: 10,
    });
    expect(stock.indicators.lastOutAt).not.toBeNull();
  });

  it('esconde valores de quem não vê custo e exige a permissão', async () => {
    const recep = await loginAs(h, admin, 'Recepcionista');
    expect((await recep.get('/api/stock/analysis')).statusCode).toBe(403);
    const stock = (await recep.get(`/api/products/${seringa.id}/stock`)).json<ProductStock>();
    expect(stock.indicators).toMatchObject({
      situation: 'excesso',
      totalCost: null,
      excessCost: null,
    });
  });
});
