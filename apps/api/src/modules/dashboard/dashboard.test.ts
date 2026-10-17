import {
  emptyVitals,
  type AppointmentType,
  type Client,
  type Dashboard,
  type DashboardLayout,
  type Patient,
  type PaymentMethod,
  type Product,
  type ProductInput,
  type Sale,
  type SaleInput,
  type Session,
} from '@clinica/contracts';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { instantToZoned } from '../../core/zoned-time.js';
import { clientInput, patientInput } from '../../test/fixtures.js';
import { ADMIN, createHarness, loginAs, TestClient, type Harness } from '../../test/harness.js';
import { resolveLayout } from './service.js';

let h: Harness;
let admin: TestClient;
let adminId: string;
let client: Client;
let thor: Patient;
let consultaType: AppointmentType;
let consulta: Product;
let racao: Product;
let dinheiro: PaymentMethod;

const productInput = (overrides: Partial<ProductInput>): ProductInput => ({
  kind: 'product',
  serviceKind: null,
  name: 'Ração 1 kg',
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
  ...overrides,
});

async function create<T>(path: string, body: unknown): Promise<T> {
  const res = await admin.send('POST', path, body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<T>();
}

const sale = (kind: 'sale' | 'quote', lines: [Product, number][], clientId = client.id) =>
  create<Sale>('/api/sales', {
    kind,
    saleType: 'in_person_consumer',
    clientId,
    patientId: null,
    items: lines.map(([p, quantity]) => ({
      productId: p.id,
      professionalId: adminId,
      quantity,
      unitPrice: null,
    })),
    discount: { mode: 'amount', value: 0 },
    notes: '',
  } satisfies SaleInput);

async function dashboard(as = admin): Promise<Dashboard> {
  const res = await as.get('/api/dashboard');
  expect(res.statusCode, res.body).toBe(200);
  return res.json<Dashboard>();
}

const currentMonth = () => instantToZoned(new Date(), 'America/Sao_Paulo').date.slice(0, 7);

beforeEach(async () => {
  h = await createHarness();
  admin = new TestClient(h.app);
  await admin.login(ADMIN.email, ADMIN.password);
  adminId = (await admin.get('/api/auth/session')).json<Session>().user.id;
  client = await create<Client>('/api/clients', clientInput());
  thor = await create<Patient>('/api/patients', {
    clientId: client.id,
    patient: patientInput({ name: 'Thor' }),
  });
  const types = (await admin.get('/api/catalogs/appointment-types')).json<AppointmentType[]>();
  consultaType = types.find((t) => t.name === 'Consulta')!;
  consulta = await create<Product>(
    '/api/products',
    productInput({
      kind: 'service',
      serviceKind: 'consultation',
      name: 'Consulta clínica',
      salePrice: 150,
    }),
  );
  racao = await create<Product>(
    '/api/products',
    productInput({ tracksStock: true, minStock: 5, idealStock: 10 }),
  );
  const methods = (await admin.get('/api/payment-methods')).json<PaymentMethod[]>();
  dinheiro = methods.find((m) => m.name === 'Dinheiro')!;
  expect((await admin.send('POST', '/api/cash', { openingAmount: 0 })).statusCode).toBe(201);
});
afterEach(async () => {
  await h.close();
});

describe('painel de controle [p.3]', () => {
  it('indicadores e widgets do mês com as regras de cada um', async () => {
    // Uma consulta recebida, outra em aberto (débito do cliente); orçamento não conta.
    const paid = await sale('sale', [[consulta, 1]]);
    const res = await admin.send('POST', `/api/sales/${paid.id}/receive`, {
      payments: [{ methodId: dinheiro.id, amount: 150, installments: 1 }],
    });
    expect(res.statusCode, res.body).toBe(200);
    await sale('sale', [[consulta, 1]]);
    await sale('quote', [[consulta, 3]]);
    // Atendimento finalizado entra; rascunho não.
    for (const publish of [true, false]) {
      await create(`/api/clinical/patients/${thor.id}/events`, {
        kind: 'encounter',
        occurredAt: null,
        typeId: consultaType.id,
        appointmentId: null,
        summary: 'Consulta de rotina',
        narrative: '',
        vitals: emptyVitals,
        pathologyIds: [],
        publish,
      });
    }

    const d = await dashboard();
    expect(d.month).toBe(currentMonth());
    expect(d.layout.map((w) => w.id)).toEqual([
      'patients_by_month',
      'patients_by_year',
      'consultations_by_month',
      'recent_encounters',
      'recent_patients',
      'client_lifecycle',
      'low_stock',
      'recent_logins',
    ]);
    expect(d.indicators.base).toMatchObject({
      patients: 1,
      clients: 1,
      averageWaitMinutes: null,
      files: { count: 0, bytes: 0 },
    });
    expect(d.indicators.sales).toEqual({
      net: 300,
      discountPercent: 0,
      averageTicket: 150,
      clientDebts: 150,
    });
    expect(d.data.patientsByMonth).toHaveLength(12);
    expect(d.data.patientsByMonth?.at(-1)).toEqual({ month: currentMonth(), count: 1 });
    expect(d.data.patientsByYear?.at(-1)).toMatchObject({ added: 1, total: 1 });
    expect(d.data.consultationsByMonth?.at(-1)).toEqual({ month: currentMonth(), count: 2 });
    expect(d.data.recentEncounters).toHaveLength(1);
    expect(d.data.recentEncounters?.[0]).toMatchObject({
      patientName: 'Thor',
      clientName: client.name,
      professionalName: ADMIN.name,
      typeName: 'Consulta',
    });
    expect(d.data.recentPatients?.map((p) => p.name)).toEqual(['Thor']);
    expect(d.data.lowStock).toEqual([
      expect.objectContaining({ productId: racao.id, onHand: 0, minStock: 5 }),
    ]);
    expect(d.data.recentLogins?.[0]).toMatchObject({ userId: adminId, name: ADMIN.name });
    expect(d.data.clientLifecycle?.at(-1)).toEqual({
      month: currentMonth(),
      active: 1,
      attention: 0,
    });
  });

  it('ciclo de vida: ativo até 180 dias, atenção até 365, depois some', async () => {
    const ids: string[] = [];
    for (const [name, days] of [
      ['Recente', 10],
      ['Sumido', 200],
      ['Perdido', 400],
    ] as const) {
      const c = await create<Client>('/api/clients', clientInput({ name }));
      const s = await sale('sale', [[consulta, 1]], c.id);
      await h.db.execute(
        sql`update sales set sold_at = now() - make_interval(days => ${days}) where id = ${s.id}`,
      );
      ids.push(c.id);
    }
    const lifecycle = (await dashboard()).data.clientLifecycle!;
    expect(lifecycle.at(-1)).toMatchObject({ active: 1, attention: 1 });
    // Há doze meses o "Perdido" (400 dias) ainda estava ativo.
    expect(lifecycle[0]!.active + lifecycle[0]!.attention).toBeGreaterThanOrEqual(1);
    // Arquivado sai da conta.
    expect((await admin.send('POST', `/api/clients/${ids[1]}/archive`, {})).statusCode).toBe(200);
    expect((await dashboard()).data.clientLifecycle!.at(-1)).toMatchObject({
      active: 1,
      attention: 0,
    });
  });

  it('cada perfil vê só os widgets e indicadores liberados', async () => {
    const vet = await loginAs(h, admin, 'Veterinário');
    const d = await dashboard(vet);
    expect(d.layout.map((w) => w.id)).toEqual([
      'patients_by_month',
      'patients_by_year',
      'consultations_by_month',
      'recent_encounters',
      'recent_patients',
    ]);
    expect(d.indicators.base).not.toBeNull();
    expect(d.indicators.sales).toBeNull();
    expect(d.data.lowStock).toBeUndefined();
    expect(d.data.recentLogins).toBeUndefined();
    expect(d.data.clientLifecycle).toBeUndefined();
  });

  it('montagem por usuário: ordem e liga/desliga, só entre os widgets liberados', async () => {
    const vet = await loginAs(h, admin, 'Veterinário');
    const layout: DashboardLayout = {
      widgets: [
        { id: 'recent_encounters', visible: true },
        { id: 'patients_by_month', visible: false },
        { id: 'recent_logins', visible: true },
      ],
    };
    const res = await vet.send('PUT', '/api/dashboard/layout', layout);
    expect(res.statusCode, res.body).toBe(200);
    const saved = res.json<DashboardLayout>().widgets;
    // O widget sem permissão sai; os que faltavam entram ligados no fim.
    expect(saved).toEqual([
      { id: 'recent_encounters', visible: true },
      { id: 'patients_by_month', visible: false },
      { id: 'patients_by_year', visible: true },
      { id: 'consultations_by_month', visible: true },
      { id: 'recent_patients', visible: true },
    ]);
    const d = await dashboard(vet);
    expect(d.layout).toEqual(saved);
    expect(d.data.patientsByMonth).toBeUndefined();
    expect(d.data.recentEncounters).toEqual([]);
    expect(d.data.recentLogins).toBeUndefined();
    // A montagem é de cada usuário.
    expect((await dashboard()).layout[0]?.id).toBe('patients_by_month');

    const dup = await vet.send('PUT', '/api/dashboard/layout', {
      widgets: [
        { id: 'recent_patients', visible: true },
        { id: 'recent_patients', visible: false },
      ],
    });
    expect(dup.statusCode).toBe(400);
  });

  it('exige sessão', async () => {
    expect((await new TestClient(h.app).get('/api/dashboard')).statusCode).toBe(401);
  });
});

describe('resolveLayout', () => {
  it('perfil que ganha um widget o recebe ligado no fim', () => {
    const can = (w: string) => w !== 'recent_logins';
    expect(
      resolveLayout([{ id: 'low_stock', visible: false }], can).map((w) => [w.id, w.visible]),
    ).toEqual([
      ['low_stock', false],
      ['patients_by_month', true],
      ['patients_by_year', true],
      ['consultations_by_month', true],
      ['recent_encounters', true],
      ['recent_patients', true],
      ['client_lifecycle', true],
    ]);
  });
});
