import type {
  ApiError,
  Client,
  ClientBalances,
  ClientDebtList,
  CurrentCash,
  PaymentMethod,
  Product,
  Role,
  ProductInput,
  Sale,
  SalesSummary,
  Session,
} from '@clinica/contracts';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDays, instantToZoned } from '../../core/zoned-time.js';
import { clientInput } from '../../test/fixtures.js';
import { ADMIN, createHarness, loginAs, TestClient, type Harness } from '../../test/harness.js';

let h: Harness;
let admin: TestClient;
let adminId: string;
let client: Client;
let banho: Product;
let dinheiro: PaymentMethod;
let pix: PaymentMethod;
let conta: PaymentMethod;

const productInput: ProductInput = {
  kind: 'service',
  serviceKind: 'grooming',
  name: 'Banho e tosa',
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
  salePrice: 95,
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
};

async function newSale(quantity = 2, clientId: string | null = client.id, as = admin) {
  const res = await as.send('POST', '/api/sales', {
    kind: 'sale',
    saleType: 'in_person_consumer',
    clientId,
    patientId: null,
    items: [{ productId: banho.id, professionalId: adminId, quantity, unitPrice: null }],
    discount: { mode: 'amount', value: 0 },
    notes: '',
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Sale>();
}

const pay = (method: PaymentMethod, amount: number) => ({
  methodId: method.id,
  amount,
  installments: 1,
});

const receive = (sale: Sale, payments: unknown[], as = admin) =>
  as.send('POST', `/api/sales/${sale.id}/receive`, { payments });
const settle = (sale: Sale, payments: unknown[], as = admin) =>
  as.send('POST', `/api/sales/${sale.id}/settle`, { payments });

const fieldError = (body: string) => (JSON.parse(body) as ApiError).error.details?.[0];
const today = () => instantToZoned(new Date(), 'America/Sao_Paulo').date;

async function debts(query = ''): Promise<ClientDebtList> {
  const res = await admin.get(`/api/sales/debts${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<ClientDebtList>();
}

/** Lançamentos da venda no financeiro, por origem. */
async function entries(sale: Sale) {
  const { rows } = await h.db.execute<{ origin: string; status: string; amount: string }>(
    sql`select origin, status, amount from financial_entries where sale_id = ${sale.id}
      order by origin, created_at`,
  );
  return rows.map((r) => [r.origin, r.status, Number(r.amount)]);
}

beforeEach(async () => {
  h = await createHarness();
  admin = new TestClient(h.app);
  await admin.login(ADMIN.email, ADMIN.password);
  adminId = (await admin.get('/api/auth/session')).json<Session>().user.id;
  client = (
    await admin.send('POST', '/api/clients', clientInput({ name: 'Carla Mendes' }))
  ).json<Client>();
  banho = (await admin.send('POST', '/api/products', productInput)).json<Product>();
  const methods = (await admin.get('/api/payment-methods')).json<PaymentMethod[]>();
  dinheiro = methods.find((m) => m.kind === 'cash')!;
  pix = methods.find((m) => m.kind === 'pix')!;
  conta = methods.find((m) => m.kind === 'account')!;
  expect((await admin.send('POST', '/api/cash', { openingAmount: 0 })).statusCode).toBe(201);
});
afterEach(async () => {
  await h.close();
});

describe('conta do cliente (fiado) [p.10]', () => {
  it('clínica nova já tem a forma Conta do cliente, com 30 dias de prazo', () => {
    expect(conta).toMatchObject({ name: 'Conta do cliente', settlementDays: 30, feePercent: 0 });
  });

  it('baixa a venda com parte na conta, recebe depois em partes e quita', async () => {
    const sale = await newSale(); // 190
    let res = await receive(sale, [pay(dinheiro, 40), pay(conta, 150)]);
    expect(res.statusCode, res.body).toBe(200);
    let s = res.json<Sale>();
    expect(s).toMatchObject({ status: 'closed', clientDebt: 150, settleable: true });
    const account = s.payments.find((p) => p.kind === 'account')!;
    expect(account).toMatchObject({ open: 150, settlesPaymentId: null });
    expect(account.receivables[0]?.dueDate).toBe(addDays(today(), 30));
    // O fiado não entra no caixa; fica a receber no financeiro.
    const cash = (await admin.get('/api/cash/current')).json<CurrentCash>();
    expect(cash.session?.expectedCash).toBe(40);
    expect(await entries(sale)).toEqual([
      ['client_account', 'open', 150],
      ['sale', 'paid', 40],
    ]);

    let list = await debts();
    expect(list.items).toEqual([
      expect.objectContaining({
        id: account.id,
        client: expect.objectContaining({ name: 'Carla Mendes' }) as unknown,
        amount: 150,
        paid: 0,
        open: 150,
        overdue: false,
      }),
    ]);
    expect(list.totals).toEqual({ open: 150, overdue: 0, clients: 1 });

    // Não passa do que falta nem usa a própria conta para quitar.
    res = await settle(s, [pay(pix, 151)]);
    expect(res.statusCode).toBe(400);
    expect(fieldError(res.body)?.message).toContain('Passou R$');
    res = await settle(s, [pay(conta, 10)]);
    expect(res.statusCode).toBe(400);
    expect(fieldError(res.body)?.message).toContain('outra forma');

    res = await settle(s, [pay(pix, 100)]);
    expect(res.statusCode, res.body).toBe(200);
    s = res.json<Sale>();
    expect(s.clientDebt).toBe(50);
    expect(s.payments.at(-1)).toMatchObject({
      kind: 'pix',
      amount: 100,
      settlesPaymentId: account.id,
    });
    expect((await entries(sale)).find((e) => e[0] === 'client_account')).toEqual([
      'client_account',
      'open',
      50,
    ]);
    list = await debts();
    expect(list.items[0]).toMatchObject({ paid: 100, open: 50 });

    res = await settle(s, [pay(dinheiro, 50)]);
    expect(res.statusCode, res.body).toBe(200);
    s = res.json<Sale>();
    expect(s).toMatchObject({ clientDebt: 0, settleable: false });
    expect((await entries(sale)).find((e) => e[0] === 'client_account')?.[1]).toBe('cancelled');
    expect((await debts()).items).toEqual([]);
    expect((await settle(s, [pay(dinheiro, 1)])).statusCode).toBe(409);
    expect((await admin.get('/api/cash/current')).json<CurrentCash>().session?.expectedCash).toBe(
      90,
    );
  });

  it('a conta do cliente não é paga pelo financeiro', async () => {
    const sale = await newSale(1);
    expect((await receive(sale, [pay(conta, 95)])).statusCode).toBe(200);
    const { rows } = await h.db.execute<{ id: string; account_id: string }>(
      sql`select id, account_id from financial_entries
        where sale_id = ${sale.id} and origin = 'client_account'`,
    );
    const res = await admin.send('POST', `/api/finance/entries/${rows[0]!.id}/pay`, {
      paidOn: today(),
      amount: 95,
      accountId: rows[0]!.account_id,
    });
    expect(res.statusCode).toBe(409);
  });

  it('exige cliente, permissão e uma conta só por venda', async () => {
    const avulsa = await newSale(1, null);
    let res = await receive(avulsa, [pay(conta, 95)]);
    expect(res.statusCode).toBe(400);
    expect(fieldError(res.body)?.message).toContain('sem cliente');

    const sale = await newSale(1);
    res = await receive(sale, [pay(conta, 50), pay(conta, 45)]);
    expect(res.statusCode).toBe(400);
    expect(fieldError(res.body)?.message).toBe('Use a conta do cliente uma vez só');

    // Um perfil que recebe, mas sem a permissão de vender fiado, não vê nem usa a conta.
    const roles = (await admin.get('/api/admin/roles')).json<Role[]>();
    const recepRole = roles.find((r) => r.name === 'Recepcionista')!;
    const clone = (
      await admin.send('POST', `/api/admin/roles/${recepRole.id}/clone`, { name: 'Balcao' })
    ).json<Role>();
    await admin.send('PUT', `/api/admin/roles/${clone.id}`, {
      name: 'Balcao',
      description: '',
      permissions: clone.permissions.filter((p) => p !== 'sales.on_account'),
    });
    const balcao = await loginAs(h, admin, 'Balcao');
    const kinds = async (as: TestClient) =>
      (await as.get('/api/sales/context'))
        .json<{ paymentMethods: PaymentMethod[] }>()
        .paymentMethods.map((m) => m.kind);
    expect(await kinds(balcao)).not.toContain('account');
    res = await receive(sale, [pay(conta, 95)], balcao);
    expect(res.statusCode).toBe(400);
    expect(fieldError(res.body)?.message).toContain('permissão');

    // A recepção vende fiado e recebe o que está pendurado.
    const recep = await loginAs(h, admin, 'Recepcionista');
    await recep.send('POST', '/api/cash', { openingAmount: 0 });
    expect(await kinds(recep)).toContain('account');
    res = await receive(sale, [pay(conta, 95)], recep);
    expect(res.statusCode, res.body).toBe(200);
    expect((await recep.get('/api/sales/debts')).statusCode).toBe(200);
    const methods = (await recep.get('/api/sales/debts/methods')).json<PaymentMethod[]>();
    expect(methods.map((m) => m.kind)).not.toContain('account');
    expect(methods.length).toBeGreaterThan(0);
    expect((await settle(sale, [pay(pix, 95)], recep)).statusCode).toBe(200);

    const vet = await loginAs(h, admin, 'Veterinário');
    expect((await vet.get('/api/sales/debts')).statusCode).toBe(403);
  });

  it('estorno devolve só o que entrou no caixa e tira o débito', async () => {
    const sale = await newSale(); // 190
    await receive(sale, [pay(dinheiro, 40), pay(conta, 150)]);
    await settle(sale, [pay(dinheiro, 60)]);
    const res = await admin.send('POST', `/api/sales/${sale.id}/reverse`, {
      reason: 'Cliente devolveu',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<Sale>()).toMatchObject({ status: 'cancelled', clientDebt: 0 });
    const cash = (await admin.get('/api/cash/current')).json<CurrentCash>();
    expect(cash.session?.expectedCash).toBe(0);
    expect((await entries(sale)).every((e) => e[1] === 'cancelled')).toBe(true);
    expect((await debts()).items).toEqual([]);
  });

  it('consulta vendas conta o fiado em aberto, não como recebido; saldo por cliente', async () => {
    const a = await newSale(2); // 190
    await receive(a, [pay(dinheiro, 40), pay(conta, 150)]);
    const b = await newSale(1); // 95, em aberto
    const outro = (
      await admin.send('POST', '/api/clients', clientInput({ name: 'Bruno Lima' }))
    ).json<Client>();
    const c = await newSale(1, outro.id);
    await receive(c, [pay(conta, 95)]);
    await h.db.execute(
      sql`update sale_receivables set due_date = ${addDays(today(), -1)}
        where sale_payment_id in (select id from sale_payments where sale_id = ${c.id})`,
    );
    expect(b.status).toBe('open');

    const summary = (
      await admin.get(`/api/sales/reports/summary?from=${today()}&to=${today()}`)
    ).json<SalesSummary>();
    expect(summary.totals).toMatchObject({ net: 380, received: 40, open: 340 });
    expect(summary.byMethod.map((m) => m.methodName)).toEqual(['Dinheiro']);

    const overdue = await debts('?overdue=true');
    expect(overdue.items.map((d) => d.client.name)).toEqual(['Bruno Lima']);
    expect((await debts('?q=carla')).items).toHaveLength(1);

    const balances = (await admin.get('/api/sales/debts/clients')).json<ClientBalances>();
    expect(balances.items.map((i) => [i.client.name, i.open, i.overdue])).toEqual([
      ['Carla Mendes', 150, 0],
      ['Bruno Lima', 95, 95],
    ]);
    expect(balances.totals).toEqual({ open: 245, overdue: 95, clients: 2 });
  });
});
