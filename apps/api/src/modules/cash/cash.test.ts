import type {
  ApiError,
  AuditEntry,
  CashSession,
  CashSessionSummary,
  Client,
  CurrentCash,
  Patient,
  PaymentMethod,
  Product,
  Sale,
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
let consulta: Product;
let dinheiro: PaymentMethod;
let visa: PaymentMethod;

async function openCash(as: TestClient, openingAmount: number): Promise<CashSession> {
  const res = await as.send('POST', '/api/cash', { openingAmount, notes: '' });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<CashSession>();
}

const cashOf = async (id: string, as = admin) => {
  const res = await as.get(`/api/cash/${id}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<CashSession>();
};

/** Venda de R$ 255,00 recebida em dinheiro (R$ 55) e no cartão (R$ 200). */
async function paidSale(as = admin, payments?: unknown[]): Promise<Sale> {
  let res = await as.send('POST', '/api/sales', {
    kind: 'sale',
    saleType: 'in_person_consumer',
    clientId: client.id,
    patientId: thor.id,
    items: [{ productId: consulta.id, professionalId: adminId, quantity: 1, unitPrice: null }],
    discount: { mode: 'amount', value: 0 },
    notes: '',
  });
  expect(res.statusCode, res.body).toBe(201);
  const sale = res.json<Sale>();
  res = await as.send('POST', `/api/sales/${sale.id}/receive`, {
    payments: payments ?? [
      { methodId: dinheiro.id, amount: 55, installments: 1 },
      { methodId: visa.id, amount: 200, installments: 2 },
    ],
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<Sale>();
}

const message = (body: string) => (JSON.parse(body) as ApiError).error;

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
    await admin.send('POST', '/api/products', {
      kind: 'service',
      serviceKind: 'consultation',
      name: 'Consulta clínica',
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
      salePrice: 255,
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
    })
  ).json<Product>();
  dinheiro = (await admin.get('/api/payment-methods'))
    .json<PaymentMethod[]>()
    .find((m) => m.kind === 'cash')!;
  visa = (
    await admin.send('POST', '/api/payment-methods', {
      name: 'Rede Visa Crédito',
      kind: 'credit',
      acquirer: 'Rede',
      brand: 'Visa',
      settlementDays: 30,
      maxInstallments: 6,
      feePercent: 3,
    })
  ).json<PaymentMethod>();
});
afterEach(async () => {
  await h.close();
});

describe('caixa [RN-29]', () => {
  it('um caixa aberto por operador; recebe vendas, sangria e suprimento e fecha com contagem', async () => {
    expect((await admin.get('/api/cash/current')).json<CurrentCash>().session).toBeNull();
    const session = await openCash(admin, 100);
    expect(session).toMatchObject({
      code: 1,
      status: 'open',
      operator: { id: adminId },
      expectedCash: 100,
      canMove: true,
      canClose: true,
    });
    const again = await admin.send('POST', '/api/cash', { openingAmount: 0 });
    expect(again.statusCode).toBe(409);
    expect(message(again.body).message).toBe('Você já tem um caixa aberto nesta unidade.');

    const sale = await paidSale();
    let cash = await cashOf(session.id);
    expect(cash).toMatchObject({ expectedCash: 155, salesTotal: 255 });
    expect(cash.byMethod).toEqual([
      { methodName: 'Dinheiro', paymentKind: 'cash', received: 55, refunded: 0, net: 55 },
      {
        methodName: 'Rede Visa Crédito',
        paymentKind: 'credit',
        received: 200,
        refunded: 0,
        net: 200,
      },
    ]);

    // Suprimento entra; sangria não passa do dinheiro em caixa.
    let res = await admin.send('POST', `/api/cash/${session.id}/movements`, {
      kind: 'supply',
      amount: 50,
      description: 'Troco do cofre',
    });
    expect(res.json<CashSession>().expectedCash).toBe(205);
    res = await admin.send('POST', `/api/cash/${session.id}/movements`, {
      kind: 'withdrawal',
      amount: 300,
      description: 'Depósito no banco',
    });
    expect(res.statusCode).toBe(400);
    expect(message(res.body).details?.[0]).toEqual({
      path: 'amount',
      message: 'A sangria passa do dinheiro em caixa (R$ 205,00)',
    });
    res = await admin.send('POST', `/api/cash/${session.id}/movements`, {
      kind: 'withdrawal',
      amount: 80,
      description: 'Depósito no banco',
    });
    cash = res.json<CashSession>();
    expect([cash.expectedCash, cash.supplies, cash.withdrawals]).toEqual([125, 50, 80]);
    expect(cash.entries.map((e) => [e.kind, e.amount])).toEqual([
      ['opening', 100],
      ['receipt', 55],
      ['receipt', 200],
      ['supply', 50],
      ['withdrawal', -80],
    ]);
    expect(cash.entries[1]?.sale).toEqual({ id: sale.id, code: sale.code });

    // Diferença no fechamento precisa de explicação; o esperado fica gravado.
    res = await admin.send('POST', `/api/cash/${session.id}/close`, { countedCash: 120 });
    expect(res.statusCode).toBe(400);
    expect(message(res.body).details?.[0]?.path).toBe('notes');
    res = await admin.send('POST', `/api/cash/${session.id}/close`, {
      countedCash: 120,
      notes: 'Troco dado a mais',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<CashSession>()).toMatchObject({
      status: 'closed',
      expectedCash: 125,
      countedCash: 120,
      difference: -5,
      closedBy: ADMIN.name,
      canMove: false,
      canClose: false,
    });

    // Fechado não recebe nem movimenta; sem caixa aberto não há recebimento.
    res = await admin.send('POST', `/api/cash/${session.id}/movements`, {
      kind: 'supply',
      amount: 10,
      description: 'Troco',
    });
    expect(res.statusCode).toBe(409);
    const open = (
      await admin.send('POST', '/api/sales', {
        kind: 'sale',
        saleType: 'in_person_consumer',
        clientId: null,
        patientId: null,
        items: [{ productId: consulta.id, professionalId: adminId, quantity: 1, unitPrice: null }],
        discount: { mode: 'amount', value: 0 },
        notes: '',
      })
    ).json<Sale>();
    res = await admin.send('POST', `/api/sales/${open.id}/receive`, {
      payments: [{ methodId: dinheiro.id, amount: 255, installments: 1 }],
    });
    expect(res.statusCode).toBe(409);

    const audit = (
      await admin.get(`/api/admin/audit?entity=cash_session&entityId=${session.id}`)
    ).json<{ items: AuditEntry[] }>();
    expect(audit.items.map((a) => a.action)).toEqual(['close', 'withdrawal', 'supply', 'open']);
    expect(audit.items[0]?.after).toMatchObject({ difference: -5, notes: 'Troco dado a mais' });
  });

  it('estorno devolve cada forma pelo caixa aberto e cancela a venda', async () => {
    const session = await openCash(admin, 10);
    const sale = await paidSale();
    expect(sale.reversible).toBe(true);

    let res = await admin.send('POST', `/api/sales/${sale.id}/reverse`, {
      reason: 'Cobrado errado',
    });
    expect(res.statusCode, res.body).toBe(200);
    const reversed = res.json<Sale>();
    expect(reversed).toMatchObject({
      status: 'cancelled',
      cancelled: { reason: 'Cobrado errado' },
      reversible: false,
      cancellable: false,
    });
    const cash = await cashOf(session.id);
    expect(cash).toMatchObject({ expectedCash: 10, salesTotal: 0 });
    expect(cash.byMethod.map((m) => [m.methodName, m.received, m.refunded, m.net])).toEqual([
      ['Dinheiro', 55, 55, 0],
      ['Rede Visa Crédito', 200, 200, 0],
    ]);
    expect(cash.entries.filter((e) => e.kind === 'refund').map((e) => e.amount)).toEqual([
      -55, -200,
    ]);

    res = await admin.send('POST', `/api/sales/${sale.id}/reverse`, { reason: 'De novo' });
    expect(res.statusCode).toBe(409);
    const audit = (await admin.get(`/api/admin/audit?entity=sale&entityId=${sale.id}`)).json<{
      items: AuditEntry[];
    }>();
    expect(audit.items[0]).toMatchObject({
      action: 'reverse',
      after: { reason: 'Cobrado errado' },
    });
  });

  it('devolução em dinheiro precisa caber no caixa; sem caixa aberto não estorna', async () => {
    const session = await openCash(admin, 0);
    const sale = await paidSale(admin, [{ methodId: dinheiro.id, amount: 255, installments: 1 }]);
    await admin.send('POST', `/api/cash/${session.id}/movements`, {
      kind: 'withdrawal',
      amount: 200,
      description: 'Depósito no banco',
    });
    let res = await admin.send('POST', `/api/sales/${sale.id}/reverse`, { reason: 'Desistiu' });
    expect(res.statusCode).toBe(409);
    expect(message(res.body).message).toBe(
      'O dinheiro do caixa (R$ 55,00) não cobre a devolução de R$ 255,00.',
    );
    await admin.send('POST', `/api/cash/${session.id}/close`, { countedCash: 55 });
    res = await admin.send('POST', `/api/sales/${sale.id}/reverse`, { reason: 'Desistiu' });
    expect(message(res.body).message).toBe('Abra o seu caixa antes de estornar a venda.');
    expect((await admin.get(`/api/sales/${sale.id}`)).json<Sale>().status).toBe('closed');
  });

  it('operador vê só o próprio caixa; supervisor vê e fecha o de todos', async () => {
    const mine = await openCash(admin, 0);
    const recep = await loginAs(h, admin, 'Recepcionista');
    const theirs = await openCash(recep, 20);

    expect((await recep.get(`/api/cash/${mine.id}`)).statusCode).toBe(404);
    expect(
      (await recep.send('POST', `/api/cash/${mine.id}/close`, { countedCash: 0 })).statusCode,
    ).toBe(404);
    const list = (await recep.get('/api/cash')).json<{ items: CashSessionSummary[] }>();
    expect(list.items.map((s) => s.id)).toEqual([theirs.id]);
    // Recepção recebe, mas não estorna.
    const sale = await paidSale(recep, [{ methodId: dinheiro.id, amount: 255, installments: 1 }]);
    expect(sale.reversible).toBe(false);
    expect(
      (await recep.send('POST', `/api/sales/${sale.id}/reverse`, { reason: 'Engano' })).statusCode,
    ).toBe(403);

    const all = (await admin.get('/api/cash?status=open')).json<{ items: CashSessionSummary[] }>();
    expect(all.items.map((s) => s.operator.name).sort()).toEqual(
      [ADMIN.name, 'Recepcionista'].sort(),
    );
    const other = await cashOf(theirs.id);
    expect(other).toMatchObject({ expectedCash: 275, canMove: false, canClose: true });
    const res = await admin.send('POST', `/api/cash/${theirs.id}/close`, { countedCash: 275 });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<CashSession>()).toMatchObject({ difference: 0, closedBy: ADMIN.name });

    // Veterinário não opera caixa.
    const vet = await loginAs(h, admin, 'Veterinário');
    expect((await vet.send('POST', '/api/cash', { openingAmount: 0 })).statusCode).toBe(403);
    expect((await vet.get('/api/cash')).statusCode).toBe(403);
  });
});
