import type {
  ApiError,
  AuditEntry,
  Client,
  Patient,
  PaymentMethod,
  PaymentMethodInput,
  Product,
  ProductInput,
  Sale,
  SaleContext,
  SaleInput,
  Session,
} from '@clinica/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { provisionOrganization } from '../admin/provisioning.js';
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

/** Consulta R$ 180 + 6 × Apoquel R$ 12,50 = R$ 255,00. */
async function openSale(overrides: Partial<SaleInput> = {}, as = admin): Promise<Sale> {
  const res = await as.send('POST', '/api/sales', {
    kind: 'sale',
    saleType: 'in_person_consumer',
    clientId: client.id,
    patientId: thor.id,
    items: [
      { productId: consulta.id, professionalId: adminId, quantity: 1, unitPrice: null },
      { productId: apoquel.id, professionalId: adminId, quantity: 6, unitPrice: null },
    ],
    discount: { mode: 'amount', value: 0 },
    notes: '',
    ...overrides,
  } satisfies SaleInput);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Sale>();
}

const receive = (sale: Sale, payments: unknown[], as = admin) =>
  as.send('POST', `/api/sales/${sale.id}/receive`, { payments });

const fieldError = (body: string) => (JSON.parse(body) as ApiError).error.details?.[0];

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
        salePrice: 180,
      }),
    )
  ).json<Product>();
  apoquel = (await admin.send('POST', '/api/products', productInput({}))).json<Product>();
  const methods = (await admin.get('/api/payment-methods')).json<PaymentMethod[]>();
  dinheiro = methods.find((m) => m.name === 'Dinheiro')!;
  visa = await createMethod();
  // Recebimento entra no caixa aberto do operador [RN-29].
  expect((await admin.send('POST', '/api/cash', { openingAmount: 100 })).statusCode).toBe(201);
});
afterEach(async () => {
  await h.close();
});

describe('formas de recebimento [RN-27]', () => {
  it('clínica nova já tem Dinheiro e PIX; cartão é por adquirente e bandeira', async () => {
    const methods = (await admin.get('/api/payment-methods')).json<PaymentMethod[]>();
    expect(methods.map((m) => [m.name, m.kind, m.maxInstallments])).toEqual([
      ['Dinheiro', 'cash', 1],
      ['PIX', 'pix', 1],
      ['Rede Visa Crédito', 'credit', 6],
    ]);
    expect(visa).toMatchObject({
      acquirer: 'Rede',
      brand: 'Visa',
      settlementDays: 30,
      feePercent: 3.5,
    });

    // Débito não parcela; nome repetido (sem diferença de maiúsculas) é recusado.
    let res = await admin.send(
      'POST',
      '/api/payment-methods',
      methodInput({ name: 'Rede Visa Débito', kind: 'debit', maxInstallments: 3 }),
    );
    expect(res.statusCode).toBe(400);
    expect(fieldError(res.body)?.path).toBe('maxInstallments');
    res = await admin.send(
      'POST',
      '/api/payment-methods',
      methodInput({ name: 'rede visa crédito' }),
    );
    expect(res.statusCode).toBe(409);

    // Arquivada some do PDV, mas continua no cadastro.
    res = await admin.send(
      'PUT',
      `/api/payment-methods/${visa.id}`,
      methodInput({ archived: true }),
    );
    expect(res.statusCode, res.body).toBe(200);
    const context = (await admin.get('/api/sales/context')).json<SaleContext>();
    expect(context.paymentMethods.map((m) => m.name)).toEqual(['Dinheiro', 'PIX']);
    const audit = (
      await admin.get(`/api/admin/audit?entity=payment_method&entityId=${visa.id}`)
    ).json<{ items: AuditEntry[] }>();
    expect(audit.items.map((a) => a.action)).toEqual(['update', 'create']);
    expect(audit.items[0]?.after).toMatchObject({ archived: true, kind: 'Cartão de crédito' });
  });

  it('só quem configura vendas cadastra formas', async () => {
    const recep = await loginAs(h, admin, 'Recepcionista');
    expect(
      (await recep.send('POST', '/api/payment-methods', methodInput({ name: 'Elo' }))).statusCode,
    ).toBe(403);
    expect((await recep.get('/api/payment-methods')).statusCode).toBe(403);
    // Mas vê as formas ativas no PDV.
    const context = (await recep.get('/api/sales/context')).json<SaleContext>();
    expect(context.paymentMethods).toHaveLength(3);
  });
});

describe('registrar recebimento [RN-27]', () => {
  it('pagamento dividido baixa a venda e gera as parcelas com taxa e data prevista', async () => {
    const sale = await openSale();
    expect(sale).toMatchObject({ netTotal: 255, receivable: true, payments: [], closed: null });
    const res = await receive(sale, [
      { methodId: dinheiro.id, amount: 15, installments: 1 },
      { methodId: visa.id, amount: 240, installments: 3 },
    ]);
    expect(res.statusCode, res.body).toBe(200);
    const closed = res.json<Sale>();
    expect(closed).toMatchObject({
      status: 'closed',
      closed: { by: ADMIN.name },
      editable: false,
      cancellable: false,
      receivable: false,
    });
    const today = instantToZoned(new Date(), 'America/Sao_Paulo').date;
    expect(closed.payments).toMatchObject([
      {
        methodName: 'Dinheiro',
        kind: 'cash',
        amount: 15,
        installments: 1,
        feePercent: 0,
        receivables: [{ number: 1, dueDate: today, amount: 15, feeAmount: 0, netAmount: 15 }],
      },
      {
        methodName: 'Rede Visa Crédito',
        kind: 'credit',
        amount: 240,
        installments: 3,
        feePercent: 3.5,
        receivables: [30, 60, 90].map((days, i) => ({
          number: i + 1,
          dueDate: addDays(today, days),
          amount: 80,
          feeAmount: 2.8,
          netAmount: 77.2,
        })),
      },
    ]);

    // Baixada não volta: nem edição, nem cancelamento, nem segundo recebimento.
    expect(
      (await receive(sale, [{ methodId: dinheiro.id, amount: 255, installments: 1 }])).statusCode,
    ).toBe(409);
    expect(
      (await admin.send('POST', `/api/sales/${sale.id}/cancel`, { reason: 'Engano' })).statusCode,
    ).toBe(409);
    const audit = (await admin.get(`/api/admin/audit?entity=sale&entityId=${sale.id}`)).json<{
      items: AuditEntry[];
    }>();
    expect(audit.items[0]).toMatchObject({
      action: 'receive',
      after: {
        status: 'Baixada',
        payments: 'Dinheiro R$ 15,00; Rede Visa Crédito R$ 240,00 em 3×',
      },
    });
  });

  it('as formas precisam fechar o total e respeitar o parcelamento de cada uma', async () => {
    const sale = await openSale();
    let res = await receive(sale, [{ methodId: dinheiro.id, amount: 245, installments: 1 }]);
    expect(res.statusCode).toBe(400);
    expect(fieldError(res.body)).toEqual({
      path: 'payments',
      message: 'Faltam R$ 10,00 para fechar R$ 255,00',
    });
    res = await receive(sale, [{ methodId: dinheiro.id, amount: 260, installments: 1 }]);
    expect(fieldError(res.body)?.message).toBe('Passou R$ 5,00 do total de R$ 255,00');
    res = await receive(sale, []);
    expect(fieldError(res.body)?.message).toBe('Informe ao menos uma forma de recebimento');
    res = await receive(sale, [{ methodId: dinheiro.id, amount: 255, installments: 2 }]);
    expect(fieldError(res.body)).toEqual({
      path: 'payments.0.installments',
      message: 'Esta forma não parcela',
    });
    res = await receive(sale, [{ methodId: visa.id, amount: 255, installments: 7 }]);
    expect(fieldError(res.body)?.message).toBe('Esta forma aceita até 6 parcelas');

    // Forma arquivada ou de outra clínica não serve.
    await admin.send('PUT', `/api/payment-methods/${visa.id}`, methodInput({ archived: true }));
    res = await receive(sale, [{ methodId: visa.id, amount: 255, installments: 1 }]);
    expect(fieldError(res.body)).toEqual({
      path: 'payments.0.methodId',
      message: 'Forma de recebimento indisponível',
    });
    const other = await h.db.transaction((tx) =>
      provisionOrganization(tx, {
        organizationName: 'Outra Clínica',
        unitName: 'Sede',
        admin: { name: 'Olga', email: 'olga@outra.test', password: 'senha-forte-789' },
      }),
    );
    const stranger = new TestClient(h.app);
    await stranger.login('olga@outra.test', 'senha-forte-789');
    const theirs = (await stranger.get('/api/payment-methods')).json<PaymentMethod[]>();
    expect(other.organizationId).toBeTruthy();
    res = await receive(sale, [{ methodId: theirs[0]!.id, amount: 255, installments: 1 }]);
    expect(fieldError(res.body)?.path).toBe('payments.0.methodId');
    // E ela não recebe a venda desta clínica.
    expect(
      (await receive(sale, [{ methodId: theirs[0]!.id, amount: 255, installments: 1 }], stranger))
        .statusCode,
    ).toBe(404);

    expect((await admin.get(`/api/sales/${sale.id}`)).json<Sale>().status).toBe('open');
  });

  it('orçamento não recebe; venda zerada por desconto baixa sem forma', async () => {
    const quote = await openSale({ kind: 'quote' });
    expect(quote.receivable).toBe(false);
    expect(
      (await receive(quote, [{ methodId: dinheiro.id, amount: 255, installments: 1 }])).statusCode,
    ).toBe(409);

    await admin.send('PUT', '/api/sales/settings', {
      discountLimitPercent: 100,
      defaultSaleType: 'in_person_consumer',
    });
    const free = await openSale({ discount: { mode: 'percent', value: 100 } });
    const res = await receive(free, []);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<Sale>()).toMatchObject({ status: 'closed', netTotal: 0, payments: [] });
  });

  it('recepção recebe; veterinário lança mas não baixa', async () => {
    const vet = await loginAs(h, admin, 'Veterinário');
    const sale = await openSale({}, vet);
    expect(sale.receivable).toBe(false);
    expect(
      (await receive(sale, [{ methodId: dinheiro.id, amount: 255, installments: 1 }], vet))
        .statusCode,
    ).toBe(403);
    const recep = await loginAs(h, admin, 'Recepcionista');
    let res = await receive(sale, [{ methodId: dinheiro.id, amount: 255, installments: 1 }], recep);
    expect(res.statusCode).toBe(409);
    expect(res.json<ApiError>().error.message).toBe(
      'Abra o seu caixa antes de registrar recebimento.',
    );
    await recep.send('POST', '/api/cash', { openingAmount: 0 });
    res = await receive(sale, [{ methodId: dinheiro.id, amount: 255, installments: 1 }], recep);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<Sale>().closed?.by).toBe('Recepcionista');
  });
});
