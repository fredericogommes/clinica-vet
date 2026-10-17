import type {
  ApiError,
  CardDepositList,
  Entry,
  EntryList,
  FinanceOptions,
  FinancialAccount,
  PaymentMethod,
  PaymentMethodInput,
  Product,
  ProductInput,
  Sale,
  Session,
} from '@clinica/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, createHarness, loginAs, TestClient, type Harness } from '../../test/harness.js';

let h: Harness;
let admin: TestClient;
let adminId: string;
let options: FinanceOptions;
let banco: FinancialAccount;
let consulta: Product;
let debito: PaymentMethod;
let credito: PaymentMethod;

const TZ = 'America/Sao_Paulo';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const shift = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const message = (body: string) => (JSON.parse(body) as ApiError).error.message;
const fieldError = (body: string) => (JSON.parse(body) as ApiError).error.details?.[0];

async function send<T>(method: 'POST' | 'PUT', path: string, body: unknown, status = 200) {
  const res = await admin.send(method, path, body);
  expect(res.statusCode, res.body).toBe(status);
  return res.json<T>();
}

const methodInput = (overrides: Partial<PaymentMethodInput>): PaymentMethodInput => ({
  name: 'Rede Visa Débito',
  kind: 'debit',
  acquirer: 'Rede',
  brand: 'Visa',
  settlementDays: 0,
  maxInstallments: 1,
  feePercent: 2,
  ...overrides,
});

/** Venda de consulta (R$ 200 cada) recebida numa forma. */
async function sellWith(method: PaymentMethod, quantity = 1, installments = 1) {
  const sale = await send<Sale>(
    'POST',
    '/api/sales',
    {
      kind: 'sale',
      saleType: 'in_person_consumer',
      clientId: null,
      patientId: null,
      items: [{ productId: consulta.id, professionalId: adminId, quantity, unitPrice: null }],
      discount: { mode: 'amount', value: 0 },
      notes: '',
    },
    201,
  );
  return send<Sale>('POST', `/api/sales/${sale.id}/receive`, {
    payments: [{ methodId: method.id, amount: sale.netTotal, installments }],
  });
}

const deposits = async (query = '') =>
  (await admin.get(`/api/finance/card-deposits?${query}`)).json<CardDepositList>();
const balanceOf = async (id: string) =>
  (await admin.get('/api/finance/accounts')).json<FinancialAccount[]>().find((a) => a.id === id)!
    .balance;

beforeEach(async () => {
  h = await createHarness();
  admin = new TestClient(h.app);
  await admin.login(ADMIN.email, ADMIN.password);
  adminId = (await admin.get('/api/auth/session')).json<Session>().user.id;
  options = (await admin.get('/api/finance/options')).json<FinanceOptions>();
  banco = options.accounts.find((a) => a.name === 'Banco')!;
  consulta = await send<Product>(
    'POST',
    '/api/products',
    {
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
      salePrice: 200,
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
    } satisfies ProductInput,
    201,
  );
  debito = await send<PaymentMethod>('POST', '/api/payment-methods', methodInput({}), 201);
  credito = await send<PaymentMethod>(
    'POST',
    '/api/payment-methods',
    methodInput({
      name: 'Rede Visa Crédito',
      kind: 'credit',
      settlementDays: 30,
      maxInstallments: 6,
      feePercent: 3.5,
    }),
    201,
  );
  await send('POST', '/api/cash', { openingAmount: 0 }, 201);
});
afterEach(async () => {
  await h.close();
});

describe('conciliação de cartões', () => {
  it('agrupa as parcelas por forma e data e concilia com a diferença lançada', async () => {
    await sellWith(debito);
    await sellWith(debito);
    await sellWith(credito, 1, 2);

    // Cartão não nasce pago, nem no débito que cai no mesmo dia.
    const entries = (
      await admin.get(`/api/finance/entries?de=${today}&ate=${today}`)
    ).json<EntryList>();
    expect(entries.items.every((e) => e.status === 'open')).toBe(true);

    let list = await deposits();
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      paymentMethod: { id: debito.id },
      account: { id: banco.id },
      expectedDate: today,
      status: 'unreconciled',
      count: 2,
      gross: 400,
      fee: 8,
      expectedNet: 392,
      settlement: null,
    });
    expect(list.counts.unreconciled).toEqual({ count: 1, amount: 392 });
    expect(list.counts.expected.count).toBe(2);
    const expected = await deposits('situacao=previstos');
    expect(expected.items.map((d) => [d.paymentMethod.name, d.count, d.expectedDate])).toEqual([
      ['Rede Visa Crédito', 1, shift(today, 30)],
      ['Rede Visa Crédito', 1, shift(today, 60)],
    ]);

    const input = {
      paymentMethodId: debito.id,
      accountId: banco.id,
      expectedDate: today,
      depositDate: shift(today, 1),
      receivedNet: 390,
    };
    let res = await admin.send('POST', '/api/finance/card-deposits/reconcile', input);
    expect(fieldError(res.body)?.path).toBe('depositDate');
    const before = await balanceOf(banco.id);
    const { id } = await send<{ id: string }>(
      'POST',
      '/api/finance/card-deposits/reconcile',
      { ...input, depositDate: today },
      201,
    );
    expect(await balanceOf(banco.id)).toBe(before + 390);

    list = await deposits('situacao=conciliados');
    expect(list.items[0]).toMatchObject({
      status: 'reconciled',
      count: 2,
      expectedNet: 392,
      settlement: { id, depositDate: today, receivedNet: 390, difference: -2, by: 'Ana Admin' },
    });
    expect(list.counts.difference).toBe(-2);
    expect((await deposits()).items).toHaveLength(0);

    const paid = (
      await admin.get(`/api/finance/entries?de=${today}&ate=${today}&situacao=pagos`)
    ).json<EntryList>();
    const adjustment = paid.items.find((e) => e.origin === 'card_adjustment');
    expect(adjustment).toMatchObject({
      kind: 'expense',
      amount: 2,
      category: { name: 'Taxas de cartão' },
    });
    // Conciliado não se reabre nem se estorna sem desfazer a conciliação.
    const saleEntry = paid.items.find((e) => e.origin === 'sale')!;
    res = await admin.send('POST', `/api/finance/entries/${saleEntry.id}/reopen`, {});
    expect(message(res.body)).toBe('Lançamento conciliado: desfaça a conciliação do depósito.');
    res = await admin.send('POST', `/api/finance/entries/${adjustment!.id}/cancel`, {
      reason: 'Teste de ajuste',
    });
    expect(res.statusCode).toBe(409);
    res = await admin.send('POST', `/api/sales/${saleEntry.sale!.id}/reverse`, {
      reason: 'Cliente desistiu',
    });
    expect(res.statusCode).toBe(409);
    res = await admin.send('POST', '/api/finance/card-deposits/reconcile', {
      ...input,
      depositDate: today,
    });
    expect(message(res.body)).toBe(
      'Nada a conciliar: as parcelas deste depósito já foram baixadas.',
    );

    // Desfazer volta tudo como estava.
    expect((await admin.send('POST', `/api/finance/card-deposits/${id}/undo`)).statusCode).toBe(
      204,
    );
    expect(await balanceOf(banco.id)).toBe(before);
    list = await deposits();
    expect(list.items[0]).toMatchObject({ status: 'unreconciled', count: 2, settlement: null });
    const cancelled = (
      await admin.get(`/api/finance/entries?de=${today}&ate=${today}&situacao=cancelados`)
    ).json<EntryList>();
    expect(cancelled.items.map((e) => [e.origin, e.cancelReason])).toEqual([
      ['card_adjustment', 'Conciliação desfeita'],
    ]);

    // Depósito antecipado, sem diferença: nenhum ajuste.
    const early = await send<{ id: string }>(
      'POST',
      '/api/finance/card-deposits/reconcile',
      {
        paymentMethodId: credito.id,
        accountId: banco.id,
        expectedDate: shift(today, 30),
        depositDate: today,
        receivedNet: expected.items[0]!.expectedNet,
      },
      201,
    );
    const done = await deposits(`situacao=conciliados&forma=${credito.id}`);
    expect(done.items[0]?.settlement).toMatchObject({ id: early.id, difference: 0 });

    const audit = (await admin.get('/api/admin/audit?entity=card_settlement')).json<{
      items: { action: string }[];
    }>();
    expect(audit.items.map((a) => a.action).sort()).toEqual(['reconcile', 'reconcile', 'undo']);
  });

  it('a forma de recebimento escolhe a conta onde o dinheiro cai', async () => {
    const rede = await send<FinancialAccount>(
      'POST',
      '/api/finance/accounts',
      { name: 'Conta Rede', kind: 'bank', openingBalance: 0, openingDate: today },
      201,
    );
    const updated = await send<PaymentMethod>('PUT', `/api/payment-methods/${debito.id}`, {
      ...methodInput({}),
      accountId: rede.id,
    });
    expect(updated.accountId).toBe(rede.id);
    await sellWith(debito);
    const list = await deposits();
    expect(list.items[0]?.account).toEqual({ id: rede.id, name: 'Conta Rede' });

    const res = await admin.send('PUT', `/api/payment-methods/${debito.id}`, {
      ...methodInput({}),
      accountId: '0190f0a0-0000-7000-8000-000000000000',
    });
    expect(fieldError(res.body)).toEqual({ path: 'accountId', message: 'Conta indisponível' });
  });

  it('só quem gerencia o financeiro concilia', async () => {
    await sellWith(debito);
    const recep = await loginAs(h, admin, 'Recepcionista');
    expect((await recep.get('/api/finance/card-deposits')).statusCode).toBe(403);
    const entries = (await admin.get('/api/finance/entries')).json<EntryList>();
    expect(entries.items.some((e: Entry) => e.origin === 'sale')).toBe(true);
    expect(
      (
        await recep.send('POST', '/api/finance/card-deposits/reconcile', {
          paymentMethodId: debito.id,
          accountId: banco.id,
          expectedDate: today,
          depositDate: today,
          receivedNet: 196,
        })
      ).statusCode,
    ).toBe(403);
  });
});
