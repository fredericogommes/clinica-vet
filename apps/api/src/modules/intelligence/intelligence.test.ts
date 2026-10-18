import type {
  ApiError,
  CatalogItem,
  Client,
  ClientsIntelligence,
  IntelligenceFavorites,
  Patient,
  PatientsIntelligence,
  Product,
  ProductInput,
  Sale,
  SalesIntelligence,
  Session,
} from '@clinica/contracts';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clients, patients, sales } from '../../db/schema.js';
import { clientInput, emptyAddress, patientInput, VALID_CNPJ } from '../../test/fixtures.js';
import { ADMIN, createHarness, loginAs, TestClient, type Harness } from '../../test/harness.js';

let h: Harness;
let admin: TestClient;
let adminId: string;
let carla: Client;
let petshop: Client;
let thor: Patient;
let mimi: Patient;
let consulta: Product;
let racao: Product;

const productInput = (overrides: Partial<ProductInput> = {}): ProductInput => ({
  kind: 'service',
  serviceKind: 'consultation',
  name: 'Consulta',
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
  salePrice: 180,
  cost: null,
  purpose: 'sale',
  desiredMarkup: null,
  allowPriceChange: true,
  showInPriceList: true,
  discountLimitPercent: null,
  defaultCommissionPercent: 0,
  commissions: [],
  tracksStock: false,
  minStock: null,
  idealStock: null,
  ...overrides,
});

const create = async <T>(path: string, body: unknown): Promise<T> => {
  const res = await admin.send('POST', path, body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<T>();
};

/** Venda lançada e movida para o instante dado (UTC), para fixar dia da semana e turno. */
const sell = async (client: Client, patient: Patient, products: Product[], soldAt: string) => {
  const sale = await create<Sale>('/api/sales', {
    kind: 'sale',
    saleType: 'in_person_consumer',
    clientId: client.id,
    patientId: patient.id,
    insurerId: null,
    items: products.map((p) => ({
      productId: p.id,
      professionalId: adminId,
      quantity: 1,
      unitPrice: null,
    })),
    discount: { mode: 'amount', value: 0 },
    notes: '',
  });
  await h.db
    .update(sales)
    .set({ soldAt: new Date(soldAt) })
    .where(eq(sales.id, sale.id));
  return sale;
};

const week = 'from=2026-03-02&to=2026-03-08';

beforeEach(async () => {
  h = await createHarness();
  admin = new TestClient(h.app);
  await admin.login(ADMIN.email, ADMIN.password);
  adminId = (await admin.get('/api/auth/session')).json<Session>().user.id;
  const species = (await admin.get('/api/catalogs/species')).json<CatalogItem[]>();
  const canina = species.find((s) => s.name === 'Canina')!;
  const felina = species.find((s) => s.name === 'Felina')!;
  carla = await create<Client>(
    '/api/clients',
    clientInput({
      sex: 'female',
      profession: 'Professora',
      address: { ...emptyAddress, city: 'Campinas', district: 'Centro' },
    }),
  );
  petshop = await create<Client>(
    '/api/clients',
    clientInput({ personType: 'company', name: 'Pet Shop Ltda', cnpj: VALID_CNPJ }),
  );
  thor = await create<Patient>('/api/patients', {
    clientId: carla.id,
    patient: patientInput({ speciesId: canina.id, sterilized: true, birthDate: '2022-01-10' }),
  });
  mimi = await create<Patient>('/api/patients', {
    clientId: petshop.id,
    patient: patientInput({ name: 'Mimi', sex: 'female', speciesId: felina.id }),
  });
  // O cadastro conta até o fim do período: os dois chegaram antes da semana consultada.
  const before = new Date('2025-06-01T12:00:00Z');
  await h.db
    .update(clients)
    .set({ createdAt: before })
    .where(inArray(clients.id, [carla.id, petshop.id]));
  await h.db
    .update(patients)
    .set({ createdAt: before })
    .where(inArray(patients.id, [thor.id, mimi.id]));
  consulta = await create<Product>('/api/products', productInput());
  racao = await create<Product>(
    '/api/products',
    productInput({ name: 'Ração', kind: 'product', serviceKind: null, salePrice: 90 }),
  );
  // Segunda 9h30 em São Paulo (manhã) e quarta 20h (noite); a do dia 10 fica fora do período.
  await sell(carla, thor, [consulta, racao], '2026-03-02T12:30:00Z');
  await sell(petshop, mimi, [consulta], '2026-03-04T23:00:00Z');
  await sell(carla, thor, [racao], '2026-03-10T12:00:00Z');
  const cancelled = await sell(carla, thor, [consulta], '2026-03-03T15:00:00Z');
  const res = await admin.send('POST', `/api/sales/${cancelled.id}/cancel`, {
    reason: 'Lançada em duplicidade',
  });
  expect(res.statusCode, res.body).toBe(200);
});
afterEach(async () => {
  await h.close();
});

describe('Inteligência › Vendas [p.11–12]', () => {
  it('soma as vendas do período por data, item, dia da semana, turno, tipo e espécie', async () => {
    const res = await admin.get(`/api/intelligence/sales?${week}`);
    expect(res.statusCode, res.body).toBe(200);
    const bi = res.json<SalesIntelligence>();
    expect(bi.totals).toEqual({ count: 2, net: 450, averageTicket: 225 });
    expect(bi.evolution.granularity).toBe('day');
    expect(bi.evolution.points).toHaveLength(7);
    expect(bi.evolution.points[0]).toEqual({ period: '2026-03-02', value: 270, count: 1 });
    expect(bi.byDate).toEqual([
      { date: '2026-03-02', count: 1, net: 270, averageTicket: 270 },
      { date: '2026-03-04', count: 1, net: 180, averageTicket: 180 },
    ]);
    expect(bi.topItems).toEqual([
      { label: 'Consulta', value: 360, count: 2 },
      { label: 'Ração', value: 90, count: 1 },
    ]);
    expect(bi.byGroup).toEqual([{ label: 'Sem grupo', value: 450, count: 3 }]);
    expect(bi.byWeekday.map((d) => [d.label, d.value])).toEqual([
      ['Domingo', 0],
      ['Segunda', 270],
      ['Terça', 0],
      ['Quarta', 180],
      ['Quinta', 0],
      ['Sexta', 0],
      ['Sábado', 0],
    ]);
    expect(bi.byShift.map((s) => [s.label, s.count])).toEqual([
      ['Manhã (6h–12h)', 1],
      ['Tarde (12h–18h)', 0],
      ['Noite (18h–0h)', 1],
      ['Madrugada (0h–6h)', 0],
    ]);
    expect(bi.byKind).toEqual([
      { label: 'Produtos', value: 90, count: 1 },
      { label: 'Serviços', value: 360, count: 2 },
    ]);
    expect(bi.bySpecies).toEqual([
      { label: 'Canina', value: 270, count: 1 },
      { label: 'Felina', value: 180, count: 1 },
    ]);
    expect(bi.topPackages).toEqual([]);
  });

  it('filtra por dia da semana e por turno, e agrupa por mês em períodos longos', async () => {
    const monday = (
      await admin.get(`/api/intelligence/sales?${week}&weekday=1`)
    ).json<SalesIntelligence>();
    expect(monday.totals).toEqual({ count: 1, net: 270, averageTicket: 270 });
    const night = (
      await admin.get(`/api/intelligence/sales?${week}&shift=night`)
    ).json<SalesIntelligence>();
    expect(night.totals).toEqual({ count: 1, net: 180, averageTicket: 180 });
    expect(night.bySpecies).toEqual([{ label: 'Felina', value: 180, count: 1 }]);

    const quarter = (
      await admin.get('/api/intelligence/sales?from=2026-01-01&to=2026-03-31')
    ).json<SalesIntelligence>();
    expect(quarter.evolution).toEqual({
      granularity: 'month',
      points: [
        { period: '2026-01', value: 0, count: 0 },
        { period: '2026-02', value: 0, count: 0 },
        { period: '2026-03', value: 540, count: 3 },
      ],
    });
  });

  it('recusa período invertido ou maior que um ano', async () => {
    const inverted = await admin.get('/api/intelligence/sales?from=2026-03-08&to=2026-03-02');
    expect(inverted.statusCode).toBe(400);
    expect(inverted.json<ApiError>().error.details).toContainEqual({
      path: 'to',
      message: 'A data final vem antes da inicial',
    });
    const long = await admin.get('/api/intelligence/sales?from=2025-01-01&to=2026-03-02');
    expect(long.statusCode).toBe(400);
    expect(long.json<ApiError>().error.details?.[0]?.message).toBe(
      'Consulte no máximo um ano por vez',
    );
  });

  it('distribui os clientes do cadastro e quem comprou no período', async () => {
    const bi = (await admin.get(`/api/intelligence/clients?${week}`)).json<ClientsIntelligence>();
    expect(bi.base).toBe(2);
    expect(bi.attendedCount).toBe(2);
    expect(bi.topClients).toEqual([
      { label: 'Carla Mendes', value: 270, count: 1 },
      { label: 'Pet Shop Ltda', value: 180, count: 1 },
    ]);
    expect(bi.byRelationship.find((b) => b.value > 0)).toEqual({
      label: '6 a 12 meses',
      value: 2,
      count: 2,
    });
    expect(bi.byCity).toEqual([
      { label: 'Campinas', value: 1, count: 1 },
      { label: 'Cidade não informada', value: 1, count: 1 },
    ]);
    expect(bi.bySex.map((s) => [s.label, s.value])).toEqual([
      ['Feminino', 1],
      ['Masculino', 0],
      ['Não informado', 1],
    ]);
    expect(bi.byPersonType.map((s) => s.value)).toEqual([1, 1]);
    expect(bi.byProfession).toContainEqual({ label: 'Professora', value: 1, count: 1 });
    expect(bi.newClients.points.every((p) => p.count === 0)).toBe(true);
  });

  it('distribui os animais por espécie, idade, sexo e esterilização', async () => {
    const bi = (await admin.get(`/api/intelligence/patients?${week}`)).json<PatientsIntelligence>();
    expect(bi.base).toBe(2);
    expect(bi.bySpecies.map((s) => s.label).sort()).toEqual(['Canina', 'Felina']);
    expect(bi.byAge.filter((b) => b.value > 0).map((b) => b.label)).toEqual([
      '4 a 7 anos',
      'Sem data de nascimento',
    ]);
    expect(bi.bySex.map((s) => s.value)).toEqual([1, 1, 0]);
    expect(bi.byWeight.at(-1)).toEqual({ label: 'Sem peso registrado', value: 2, count: 2 });
    expect(bi.sterilization.map((s) => s.value)).toEqual([1, 0, 1]);
  });

  it('guarda os favoritos de cada usuário na ordem escolhida', async () => {
    expect((await admin.get('/api/intelligence/favorites')).json<IntelligenceFavorites>()).toEqual({
      keys: [],
    });
    const saved = await admin.send('PUT', '/api/intelligence/favorites', {
      keys: ['patients.bySpecies', 'sales.bySpecies', 'patients.bySpecies'],
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json<IntelligenceFavorites>()).toEqual({
      keys: ['patients.bySpecies', 'sales.bySpecies'],
    });
    expect((await admin.get('/api/intelligence/favorites')).json<IntelligenceFavorites>()).toEqual({
      keys: ['patients.bySpecies', 'sales.bySpecies'],
    });
    const unknown = await admin.send('PUT', '/api/intelligence/favorites', { keys: ['sales.x'] });
    expect(unknown.statusCode).toBe(400);
  });

  it('exige a permissão de inteligência', async () => {
    const recep = await loginAs(h, admin, 'Recepcionista');
    expect((await recep.get(`/api/intelligence/sales?${week}`)).statusCode).toBe(403);
    expect((await recep.get('/api/intelligence/favorites')).statusCode).toBe(403);
  });
});
