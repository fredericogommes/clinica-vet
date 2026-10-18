import type {
  ApiError,
  Client,
  ClaimList,
  Claim,
  Insurer,
  Patient,
  PaymentMethod,
  Product,
  ProductInput,
  Sale,
  SaleCoverage,
  SaleInput,
  Session,
} from '@clinica/contracts';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { financialEntries } from '../../db/schema.js';
import { clientInput, patientInput } from '../../test/fixtures.js';
import { ADMIN, createHarness, loginAs, TestClient, type Harness } from '../../test/harness.js';

let h: Harness;
let admin: TestClient;
let adminId: string;
let client: Client;
let thor: Patient;
let consulta: Product;
let exame: Product;
let racao: Product;
let insurer: Insurer;
let pix: PaymentMethod;

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

const line = (p: Product, extra: Record<string, unknown> = {}) => ({
  productId: p.id,
  professionalId: adminId,
  quantity: 1,
  unitPrice: null,
  ...extra,
});

const saleInput = (overrides: Partial<SaleInput> = {}): SaleInput => ({
  kind: 'sale',
  saleType: 'in_person_consumer',
  clientId: client.id,
  patientId: thor.id,
  insurerId: insurer.id,
  items: [line(consulta), line(exame, { authorizationCode: 'AUT-77' }), line(racao)],
  discount: { mode: 'amount', value: 0 },
  notes: '',
  ...overrides,
});

const receive = (sale: Sale, payments: unknown[]) =>
  admin.send('POST', `/api/sales/${sale.id}/receive`, { payments });

const claimsOf = async (status = 'all') =>
  (
    await admin.get(
      `/api/insurers/claims?from=2000-01-01&to=2999-12-31&status=${status}&insurerId=${insurer.id}`,
    )
  ).json<ClaimList>();

beforeEach(async () => {
  h = await createHarness();
  admin = new TestClient(h.app);
  await admin.login(ADMIN.email, ADMIN.password);
  adminId = (await admin.get('/api/auth/session')).json<Session>().user.id;
  client = await create<Client>('/api/clients', clientInput());
  consulta = await create<Product>('/api/products', productInput());
  exame = await create<Product>(
    '/api/products',
    productInput({ name: 'Ultrassom', serviceKind: 'exam', salePrice: 260 }),
  );
  racao = await create<Product>(
    '/api/products',
    productInput({ name: 'Ração', kind: 'product', serviceKind: null, salePrice: 90 }),
  );
  insurer = await create<Insurer>('/api/insurers', {
    name: 'VetSaúde',
    paymentDays: 45,
    copayPercent: 20,
  });
  // Consulta R$ 150 (20%: tutor 30, convênio 120); ultrassom R$ 220 (30%: tutor 66, convênio
  // 154) com autorização; ração fora da tabela, a R$ 90 do tutor.
  const prices = await admin.send('PUT', `/api/insurers/${insurer.id}/prices`, {
    items: [
      { productId: consulta.id, price: 150, copayPercent: null, requiresAuthorization: false },
      { productId: exame.id, price: 220, copayPercent: 30, requiresAuthorization: true },
    ],
  });
  expect(prices.statusCode, prices.body).toBe(200);
  thor = await create<Patient>('/api/patients', {
    clientId: client.id,
    patient: {
      ...patientInput({ name: 'Thor' }),
      insurance: { insurerId: insurer.id, cardNumber: 'C-1', validUntil: null },
    },
  });
  pix = (await admin.get('/api/payment-methods'))
    .json<PaymentMethod[]>()
    .find((m) => m.kind === 'pix')!;
  expect((await admin.send('POST', '/api/cash', { openingAmount: 0 })).statusCode).toBe(201);
});
afterEach(async () => {
  await h.close();
});

describe('venda pelo convênio [RN-43]', () => {
  it('cobra a tabela do convênio, separa coparticipação e repasse e mostra o plano no PDV', async () => {
    const coverage = (
      await admin.get(`/api/sales/coverage?patientId=${thor.id}`)
    ).json<SaleCoverage>();
    expect(coverage).toMatchObject({
      insurer: { name: 'VetSaúde', cardNumber: 'C-1', copayPercent: 20 },
      active: true,
    });
    expect(coverage.prices).toHaveLength(2);

    const sale = await create<Sale>('/api/sales', saleInput());
    expect(sale.insurer).toEqual({ id: insurer.id, name: 'VetSaúde', cardNumber: 'C-1' });
    expect(sale.items.map((i) => [i.name, i.unitPrice, i.coverage?.insurerAmount ?? null])).toEqual(
      [
        ['Consulta', 150, 120],
        ['Ultrassom', 220, 154],
        ['Ração', 90, null],
      ],
    );
    expect(sale.items[1]?.coverage).toMatchObject({
      copayPercent: 30,
      requiresAuthorization: true,
      authorizationCode: 'AUT-77',
    });
    expect(sale).toMatchObject({ netTotal: 460, insurerTotal: 274, customerTotal: 186 });

    // Particular, a mesma venda sai pelo preço de venda.
    const particular = await create<Sale>('/api/sales', saleInput({ insurerId: null }));
    expect(particular).toMatchObject({ netTotal: 530, insurerTotal: 0, insurer: null });
  });

  it('recusa preço fora da tabela, plano de outro convênio e desconto maior que a coparticipação', async () => {
    const price = await admin.send(
      'POST',
      '/api/sales',
      saleInput({ items: [line(consulta, { unitPrice: 140 })] }),
    );
    expect(price.statusCode).toBe(400);
    expect(price.json<ApiError>().error.details).toContainEqual({
      path: 'items.0.unitPrice',
      message: 'Item do convênio sai pelo valor da tabela',
    });

    const other = await create<Insurer>('/api/insurers', {
      name: 'Outro',
      paymentDays: 30,
      copayPercent: 0,
    });
    const wrong = await admin.send('POST', '/api/sales', saleInput({ insurerId: other.id }));
    expect(wrong.json<ApiError>().error.details).toContainEqual({
      path: 'insurerId',
      message: 'O animal não tem plano neste convênio',
    });

    // Só consulta: R$ 150, coparticipação R$ 30. Desconto de R$ 31 tocaria a parte do convênio.
    const discount = await admin.send(
      'POST',
      '/api/sales',
      saleInput({ items: [line(consulta)], discount: { mode: 'amount', value: 31 } }),
    );
    expect(discount.statusCode).toBe(400);
    expect(discount.json<ApiError>().error.details?.[0]?.message).toMatch(
      /passa da coparticipação de Consulta/,
    );
    const ok = await create<Sale>(
      '/api/sales',
      saleInput({ items: [line(consulta)], discount: { mode: 'amount', value: 10 } }),
    );
    expect(ok).toMatchObject({ netTotal: 140, insurerTotal: 120, customerTotal: 20 });
  });

  it('plano vencido não abre venda nova pelo convênio', async () => {
    await admin.send('PUT', `/api/patients/${thor.id}`, {
      ...patientInput({ name: 'Thor' }),
      insurance: { insurerId: insurer.id, cardNumber: 'C-1', validUntil: '2020-01-01' },
    });
    const res = await admin.send('POST', '/api/sales', saleInput());
    expect(res.json<ApiError>().error.details).toContainEqual({
      path: 'insurerId',
      message: 'O plano do animal está fora da validade',
    });
  });

  it('baixa exige autorização; o tutor paga a parte dele e cada procedimento vira repasse', async () => {
    const pending = await create<Sale>(
      '/api/sales',
      saleInput({ items: [line(consulta), line(exame), line(racao)] }),
    );
    const blocked = await receive(pending, [{ methodId: pix.id, amount: 186, installments: 1 }]);
    expect(blocked.statusCode, blocked.body).toBe(409);
    expect(blocked.body).toContain('Informe a autorização do convênio para Ultrassom');

    const sale = await create<Sale>('/api/sales', saleInput());
    const wrong = await receive(sale, [{ methodId: pix.id, amount: 460, installments: 1 }]);
    expect(wrong.statusCode).toBe(400);
    expect(wrong.body).toContain('Passou R$ 274,00 do total de R$ 186,00');
    const res = await receive(sale, [{ methodId: pix.id, amount: 186, installments: 1 }]);
    expect(res.statusCode, res.body).toBe(200);

    const list = await claimsOf();
    expect(list.totals.all).toEqual({ count: 2, amount: 274 });
    expect(list.totals.pending).toEqual({ count: 2, amount: 274 });
    expect(
      list.items.map((c) => [c.procedure, c.amount, c.authorizationCode, c.cardNumber]),
    ).toEqual([
      ['Consulta', 120, '', 'C-1'],
      ['Ultrassom', 154, 'AUT-77', 'C-1'],
    ]);
    const entries = await h.db
      .select()
      .from(financialEntries)
      .where(eq(financialEntries.origin, 'insurer'));
    expect(entries.map((e) => [e.amount, e.status])).toEqual([
      [120, 'open'],
      [154, 'open'],
    ]);
    expect(entries[0]?.dueDate).toBe(list.items[0]?.dueDate);

    // Lançamento de repasse não se baixa pelo financeiro.
    const pay = await admin.send('POST', `/api/finance/entries/${entries[0]!.id}/pay`, {
      paidOn: list.items[0]!.serviceDate,
      amount: 120,
      accountId: entries[0]!.accountId,
    });
    expect(pay.statusCode, pay.body).toBe(409);
  });
});

describe('repasses: conciliação e glosa [p.20]', () => {
  async function soldClaims(): Promise<{ sale: Sale; claims: Claim[] }> {
    const sale = await create<Sale>('/api/sales', saleInput());
    expect(
      (await receive(sale, [{ methodId: pix.id, amount: 186, installments: 1 }])).statusCode,
    ).toBe(200);
    return { sale, claims: (await claimsOf()).items };
  }

  it('concilia, desfaz, glosa em parte e no todo, com o financeiro acompanhando', async () => {
    const { claims } = await soldClaims();
    const [consultaClaim, exameClaim] = claims as [Claim, Claim];

    const future = await admin.send('POST', '/api/insurers/claims/reconcile', {
      claimIds: [consultaClaim.id],
      receivedOn: '2999-01-01',
    });
    expect(future.statusCode).toBe(400);
    const done = await admin.send('POST', '/api/insurers/claims/reconcile', {
      claimIds: [consultaClaim.id],
      receivedOn: consultaClaim.serviceDate,
    });
    expect(done.statusCode, done.body).toBe(200);
    let list = await claimsOf();
    expect(list.totals.reconciled).toEqual({ count: 1, amount: 120 });
    expect(list.items[0]).toMatchObject({ status: 'reconciled', reconciledBy: 'Ana Admin' });
    const [paid] = await h.db
      .select()
      .from(financialEntries)
      .where(eq(financialEntries.amount, 120));
    expect(paid).toMatchObject({ status: 'paid', paidAmount: 120 });

    // Conciliado não é glosado; desfazendo, volta a aberto.
    expect(
      (
        await admin.send('POST', `/api/insurers/claims/${consultaClaim.id}/gloss`, {
          amount: 10,
          reason: 'Erro',
        })
      ).statusCode,
    ).toBe(409);
    const undo = await admin.send('POST', `/api/insurers/claims/${consultaClaim.id}/undo`);
    expect(undo.json<Claim>()).toMatchObject({ status: 'pending', reconciledOn: null });

    // Glosa parcial do ultrassom: R$ 54 recusados, R$ 100 a receber.
    const partial = await admin.send('POST', `/api/insurers/claims/${exameClaim.id}/gloss`, {
      amount: 54,
      reason: 'Valor acima do contrato',
    });
    expect(partial.statusCode, partial.body).toBe(200);
    expect(partial.json<Claim>()).toMatchObject({
      status: 'pending',
      glossAmount: 54,
      expected: 100,
    });
    const tooMuch = await admin.send('POST', `/api/insurers/claims/${exameClaim.id}/gloss`, {
      amount: 101,
      reason: 'Tudo',
    });
    expect(tooMuch.statusCode).toBe(400);
    // Glosa do resto: o procedimento fica glosado e a receita é cancelada.
    const full = await admin.send('POST', `/api/insurers/claims/${exameClaim.id}/gloss`, {
      amount: 100,
      reason: 'Sem autorização válida',
    });
    expect(full.json<Claim>()).toMatchObject({
      status: 'glossed',
      glossAmount: 154,
      expected: 0,
      glossReason: 'Valor acima do contrato; Sem autorização válida',
    });
    list = await claimsOf();
    expect(list.totals).toMatchObject({
      all: { count: 2, amount: 120 },
      pending: { count: 1, amount: 120 },
      glossed: { count: 1, amount: 154 },
    });
    expect((await claimsOf('glossed')).items.map((c) => c.procedure)).toEqual(['Ultrassom']);
    const entries = await h.db
      .select()
      .from(financialEntries)
      .where(eq(financialEntries.origin, 'insurer'));
    expect(entries.find((e) => e.amount === 100)).toMatchObject({ status: 'cancelled' });
  });

  it('estorno cancela repasses abertos e é recusado com repasse conciliado ou glosado', async () => {
    const { sale, claims } = await soldClaims();
    await admin.send('POST', '/api/insurers/claims/reconcile', {
      claimIds: [claims[0]!.id],
      receivedOn: claims[0]!.serviceDate,
    });
    const blocked = await admin.send('POST', `/api/sales/${sale.id}/reverse`, {
      reason: 'Lançada errada',
    });
    expect(blocked.statusCode).toBe(409);
    await admin.send('POST', `/api/insurers/claims/${claims[0]!.id}/undo`);
    const reversed = await admin.send('POST', `/api/sales/${sale.id}/reverse`, {
      reason: 'Lançada errada',
    });
    expect(reversed.statusCode, reversed.body).toBe(200);
    expect((await claimsOf()).items).toEqual([]);
    const entries = await h.db
      .select()
      .from(financialEntries)
      .where(eq(financialEntries.origin, 'insurer'));
    expect(entries.every((e) => e.status === 'cancelled')).toBe(true);
  });

  it('só quem concilia vê os repasses', async () => {
    const vet = await loginAs(h, admin, 'Veterinário');
    expect((await vet.get('/api/insurers/claims?from=2000-01-01&to=2999-12-31')).statusCode).toBe(
      403,
    );
    const gestor = await loginAs(h, admin, 'Gestor da Clínica');
    expect(
      (await gestor.get('/api/insurers/claims?from=2000-01-01&to=2999-12-31')).statusCode,
    ).toBe(200);
  });
});
