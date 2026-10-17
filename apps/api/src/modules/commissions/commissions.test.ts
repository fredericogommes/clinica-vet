import type {
  ApiError,
  AuditEntry,
  Client,
  CommissionOpen,
  CommissionSettings,
  CommissionSettingsInput,
  CommissionStatement,
  CommissionStatementList,
  Entry,
  MyCommissions,
  PaymentMethod,
  Product,
  ProductInput,
  Sale,
  SaleInput,
  Session,
} from '@clinica/contracts';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clientInput } from '../../test/fixtures.js';
import { ADMIN, createHarness, loginAs, TestClient, type Harness } from '../../test/harness.js';

let h: Harness;
let admin: TestClient;
let vet: TestClient;
let adminId: string;
let vetId: string;
let client: Client;
let consulta: Product;
let apoquel: Product;
let dinheiro: PaymentMethod;

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
  new Date(),
);
const tomorrow = (() => {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
})();

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

type Line = SaleInput['items'][number];
const line = (product: Product, professionalId: string, quantity = 1): Line => ({
  productId: product.id,
  professionalId,
  quantity,
  unitPrice: null,
});

const saleBody = (items: Line[], discount = 0): SaleInput => ({
  kind: 'sale',
  saleType: 'in_person_consumer',
  clientId: client.id,
  patientId: null,
  items,
  discount: { mode: 'amount', value: discount },
  notes: '',
});

async function sell(items: Line[], discount = 0): Promise<Sale> {
  const res = await admin.send('POST', '/api/sales', saleBody(items, discount));
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Sale>();
}

const settingsBody = (overrides: Partial<CommissionSettingsInput> = {}) => ({
  base: 'net',
  criterion: 'sold',
  financeIntegration: true,
  staffCanSeeOwn: true,
  ...overrides,
});

async function configure(overrides: Partial<CommissionSettingsInput>) {
  const res = await admin.send('PUT', '/api/commissions/settings', settingsBody(overrides));
  expect(res.statusCode, res.body).toBe(200);
}

async function openRows(cutoff = today) {
  const res = await admin.get(`/api/commissions/open?ate=${cutoff}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<CommissionOpen>();
}
const rowOf = (open: CommissionOpen, userId: string) => open.rows.find((r) => r.user.id === userId);

async function generate(userId = vetId, cutoff = today) {
  const res = await admin.send('POST', '/api/commissions/statements', { userId, cutoff });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<CommissionStatement>();
}

async function close(statement: CommissionStatement, dueDate = today) {
  const res = await admin.send('POST', `/api/commissions/statements/${statement.id}/close`, {
    dueDate,
    notes: '',
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<CommissionStatement>();
}

const message = (body: string) => (JSON.parse(body) as ApiError).error.message;

beforeEach(async () => {
  h = await createHarness();
  admin = new TestClient(h.app);
  await admin.login(ADMIN.email, ADMIN.password);
  adminId = (await admin.get('/api/auth/session')).json<Session>().user.id;
  vet = await loginAs(h, admin, 'Veterinário');
  vetId = (await vet.get('/api/auth/session')).json<Session>().user.id;
  client = (await admin.send('POST', '/api/clients', clientInput())).json<Client>();
  // Consulta: 10% para todos. Apoquel: 5% padrão, 8% para a veterinária.
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
        defaultCommissionPercent: 10,
      }),
    )
  ).json<Product>();
  apoquel = (
    await admin.send(
      'POST',
      '/api/products',
      productInput({ defaultCommissionPercent: 5, commissions: [{ userId: vetId, percent: 8 }] }),
    )
  ).json<Product>();
  const methods = (await admin.get('/api/payment-methods')).json<PaymentMethod[]>();
  dinheiro = methods.find((m) => m.name === 'Dinheiro')!;
  expect((await admin.send('POST', '/api/cash', { openingAmount: 0 })).statusCode).toBe(201);
  const on = await admin.send('PUT', `/api/commissions/staff/${vetId}`, { commissioned: true });
  expect(on.statusCode, on.body).toBe(200);
});
afterEach(async () => {
  await h.close();
});

describe('comissões em aberto [RN-38]', () => {
  it('soma por profissional com a base e o critério da clínica', async () => {
    const settings = (await admin.get('/api/commissions/settings')).json<CommissionSettings>();
    expect(settings).toMatchObject({
      base: 'net',
      criterion: 'sold',
      financeIntegration: true,
      staffCanSeeOwn: true,
    });
    expect(settings.staff.find((s) => s.id === vetId)?.since).toBe(today);
    expect(settings.staff.find((s) => s.id === adminId)?.since).toBeNull();

    // R$ 255 com R$ 25,50 de desconto rateado: consulta 162 (10%) e Apoquel 67,50 (8%).
    const a = await sell([line(consulta, vetId), line(apoquel, vetId, 6)], 25.5);
    await sell([line(consulta, vetId)]);
    // Venda da administradora, que não é comissionada.
    await sell([line(consulta, adminId)]);

    const open = await openRows();
    expect(rowOf(open, vetId)).toMatchObject({
      commissioned: true,
      sales: 2,
      baseAmount: 409.5,
      amount: 39.6,
      statement: null,
    });
    expect(rowOf(open, adminId)).toMatchObject({ commissioned: false, amount: 0 });
    expect(open.rows[0]?.user.id).toBe(vetId);
    expect(open.total).toBe(39.6);

    // Base bruta: 10% de 180 + 8% de 75, mais 18 da segunda venda.
    await configure({ base: 'gross' });
    expect(rowOf(await openRows(), vetId)?.amount).toBe(42);

    // Só recebidas: nada até a baixa no caixa.
    await configure({ base: 'gross', criterion: 'received' });
    expect(rowOf(await openRows(), vetId)).toMatchObject({ sales: 0, amount: 0 });
    const paid = await admin.send('POST', `/api/sales/${a.id}/receive`, {
      payments: [{ methodId: dinheiro.id, amount: 229.5, installments: 1 }],
    });
    expect(paid.statusCode, paid.body).toBe(200);
    expect(rowOf(await openRows(), vetId)).toMatchObject({ sales: 1, amount: 24 });

    // Data de corte futura é recusada; venda antes de virar comissionado não conta.
    expect((await admin.get(`/api/commissions/open?ate=${tomorrow}`)).statusCode).toBe(400);
    await h.db.execute(sql`update users set commission_since = ${tomorrow} where id = ${vetId}`);
    expect(rowOf(await openRows(), vetId)).toMatchObject({ sales: 0, amount: 0 });

    const audit = (
      await admin.get(
        `/api/admin/audit?entity=commission_settings&entityId=${h.org.organizationId}`,
      )
    ).json<{ items: AuditEntry[] }>();
    expect(audit.items[0]?.after).toMatchObject({ base: 'gross', criterion: 'received' });
  });
});

describe('extrato de comissão [RN-38, RN-39]', () => {
  it('gera, atualiza, fecha em contas a pagar, paga, arquiva e leva ajustes adiante', async () => {
    await sell([line(consulta, vetId), line(apoquel, vetId, 6)], 25.5);
    const c = await sell([line(consulta, vetId)]);

    let statement = await generate();
    expect(statement).toMatchObject({
      code: 1,
      status: 'open',
      user: { id: vetId, name: 'Veterinário' },
      cutoff: today,
      total: 39.6,
      entry: null,
    });
    expect(statement.lines.map((l) => [l.kind, l.amount])).toEqual([
      ['sale', 21.6],
      ['sale', 18],
    ]);
    expect(statement.lines[0]?.description).toBe('Consulta clínica (10%); Apoquel 16 mg (8%)');
    let open = await openRows();
    expect(rowOf(open, vetId)).toMatchObject({
      amount: 0,
      statement: { id: statement.id, status: 'open' },
    });

    // Um extrato não fechado por profissional; sem comissão, nada a gerar.
    let res = await admin.send('POST', '/api/commissions/statements', {
      userId: vetId,
      cutoff: today,
    });
    expect(res.statusCode).toBe(409);
    res = await admin.send('POST', '/api/commissions/statements', {
      userId: adminId,
      cutoff: today,
    });
    expect(res.statusCode).toBe(409);
    expect(message(res.body)).toMatch(/não recebe comissão/);

    // A venda em aberto ganha um item: atualizar o extrato recalcula a linha.
    res = await admin.send(
      'PUT',
      `/api/sales/${c.id}`,
      saleBody([line(consulta, vetId), line(apoquel, vetId, 2)]),
    );
    expect(res.statusCode, res.body).toBe(200);
    res = await admin.send('POST', `/api/commissions/statements/${statement.id}/refresh`, {
      cutoff: today,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<CommissionStatement>().total).toBe(41.6);

    // Fechar gera a despesa em contas a pagar, na categoria Comissões.
    statement = await close(statement);
    expect(statement).toMatchObject({ status: 'closed', total: 41.6, dueDate: today });
    expect(statement.entry).toMatchObject({ status: 'open', amount: 41.6, dueDate: today });
    const entryId = statement.entry!.id;
    let entry = (await admin.get(`/api/finance/entries/${entryId}`)).json<Entry>();
    expect(entry).toMatchObject({
      origin: 'commission',
      description: 'Comissão de Veterinário - extrato 1',
      category: { name: 'Comissões' },
      commissionStatement: { id: statement.id, code: 1 },
    });
    // Comissão não se cancela nem se edita pelo financeiro.
    res = await admin.send('POST', `/api/finance/entries/${entryId}/cancel`, {
      reason: 'Teste',
      following: false,
    });
    expect(res.statusCode).toBe(409);
    expect(message(res.body)).toMatch(/extrato em revisão/);
    // Nem se paga pelo extrato quando está em contas a pagar.
    res = await admin.send('POST', `/api/commissions/statements/${statement.id}/pay`, {
      paidOn: today,
    });
    expect(res.statusCode).toBe(409);

    // Revisão cancela a despesa; fechar de novo gera outra.
    res = await admin.send('POST', `/api/commissions/statements/${statement.id}/review`, {
      reason: 'Conferir desconto',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<CommissionStatement>()).toMatchObject({
      status: 'review',
      reviewReason: 'Conferir desconto',
      entry: null,
    });
    entry = (await admin.get(`/api/finance/entries/${entryId}`)).json<Entry>();
    expect(entry.status).toBe('cancelled');
    statement = await close(statement, tomorrow);
    const second = statement.entry!.id;
    expect(second).not.toBe(entryId);

    // Pagar em contas a pagar marca o extrato como pago; desfazer a baixa volta a fechado.
    const pay = (id: string) =>
      admin.send('POST', `/api/finance/entries/${id}/pay`, {
        paidOn: today,
        accountId: entry.account.id,
        amount: 41.6,
      });
    expect((await pay(second)).statusCode).toBe(200);
    const read = async () =>
      (await admin.get(`/api/commissions/statements/${statement.id}`)).json<CommissionStatement>();
    expect(await read()).toMatchObject({ status: 'paid', paidOn: today });
    res = await admin.send('POST', `/api/commissions/statements/${statement.id}/review`, {
      reason: 'Errado',
    });
    expect(res.statusCode).toBe(409);
    expect((await admin.send('POST', `/api/finance/entries/${second}/reopen`)).statusCode).toBe(
      200,
    );
    expect((await read()).status).toBe('closed');
    expect((await pay(second)).statusCode).toBe(200);
    res = await admin.send('POST', `/api/commissions/statements/${statement.id}/archive`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<CommissionStatement>().status).toBe('archived');

    // A venda comissionada é cancelada: o estorno entra no próximo extrato.
    res = await admin.send('POST', `/api/sales/${c.id}/cancel`, { reason: 'Desistiu' });
    expect(res.statusCode, res.body).toBe(200);
    open = await openRows();
    expect(rowOf(open, vetId)).toMatchObject({ sales: 1, amount: -20 });
    const next = await generate();
    expect(next.lines.map((l) => [l.kind, l.amount, l.sale.status])).toEqual([
      ['reversal', -20, 'cancelled'],
    ]);
    res = await admin.send('POST', `/api/commissions/statements/${next.id}/close`, {
      dueDate: today,
      notes: '',
    });
    expect(res.statusCode).toBe(409);
    expect(message(res.body)).toMatch(/estornos superam/);
    // Descartar devolve a venda às comissões em aberto.
    expect((await admin.send('DELETE', `/api/commissions/statements/${next.id}`)).statusCode).toBe(
      204,
    );
    expect(rowOf(await openRows(), vetId)?.amount).toBe(-20);

    const list = (
      await admin.get('/api/commissions/statements?situacao=todos')
    ).json<CommissionStatementList>();
    expect(list.items.map((s) => [s.code, s.status, s.lines, s.total])).toEqual([
      [1, 'archived', 2, 41.6],
    ]);
    const audit = (
      await admin.get(`/api/admin/audit?entity=commission_statement&entityId=${statement.id}`)
    ).json<{ items: AuditEntry[] }>();
    expect(audit.items.map((a) => a.action)).toEqual([
      'archive',
      'close',
      'review',
      'close',
      'refresh',
      'create',
    ]);
  });

  it('sem integração o pagamento é marcado no extrato; base bruta fica gravada', async () => {
    await configure({ financeIntegration: false, base: 'gross' });
    await sell([line(consulta, vetId)], 18);
    let statement = await generate();
    expect(statement.lines[0]).toMatchObject({ base: 'gross', baseAmount: 180, amount: 18 });

    // Trocar a base depois não muda o que já está no extrato: a venda mantém a base da 1ª vez.
    await configure({ financeIntegration: false, base: 'net' });
    expect(rowOf(await openRows(), vetId)?.amount).toBe(0);

    statement = await close(statement);
    expect(statement).toMatchObject({ status: 'closed', entry: null, financeIntegration: false });
    const entries = await h.db.execute(
      sql`select count(*)::int as n from financial_entries where origin = 'commission'`,
    );
    expect(entries.rows[0]).toEqual({ n: 0 });

    let res = await admin.send('POST', `/api/commissions/statements/${statement.id}/pay`, {
      paidOn: tomorrow,
    });
    expect(res.statusCode).toBe(400);
    res = await admin.send('POST', `/api/commissions/statements/${statement.id}/pay`, {
      paidOn: today,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<CommissionStatement>()).toMatchObject({ status: 'paid', paidOn: today });
    res = await admin.send('POST', `/api/commissions/statements/${statement.id}/unpay`);
    expect(res.json<CommissionStatement>()).toMatchObject({ status: 'closed', paidOn: null });
  });
});

describe('transparência e permissões', () => {
  it('o profissional vê só as próprias comissões, se a clínica deixar', async () => {
    await sell([line(consulta, vetId)]);
    const statement = await generate();
    await sell([line(consulta, vetId)]);

    let res = await vet.get('/api/commissions/mine');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<MyCommissions>()).toMatchObject({
      commissioned: true,
      since: today,
      open: { sales: 1, amount: 18 },
      statements: [{ id: statement.id, status: 'open', total: 18 }],
    });
    expect((await vet.get(`/api/commissions/statements/${statement.id}`)).statusCode).toBe(200);
    // Não vê a equipe nem mexe em extratos.
    expect((await vet.get('/api/commissions/open')).statusCode).toBe(403);
    expect((await vet.get('/api/commissions/statements')).statusCode).toBe(403);
    expect(
      (
        await vet.send('POST', `/api/commissions/statements/${statement.id}/close`, {
          dueDate: today,
          notes: '',
        })
      ).statusCode,
    ).toBe(403);
    expect((await vet.send('PUT', '/api/commissions/settings', settingsBody())).statusCode).toBe(
      403,
    );

    // Extrato de outra pessoa, não.
    const recep = await loginAs(h, admin, 'Recepcionista');
    expect((await recep.get(`/api/commissions/statements/${statement.id}`)).statusCode).toBe(403);

    // Sem transparência, nada.
    await configure({ staffCanSeeOwn: false });
    expect((await vet.get('/api/commissions/mine')).statusCode).toBe(403);
    expect((await vet.get(`/api/commissions/statements/${statement.id}`)).statusCode).toBe(403);

    // Desligar a comissão tira a pessoa do cálculo.
    res = await admin.send('PUT', `/api/commissions/staff/${vetId}`, { commissioned: false });
    expect(res.statusCode).toBe(200);
    expect(rowOf(await openRows(), vetId)).toMatchObject({ commissioned: false, amount: 0 });
    const audit = (await admin.get(`/api/admin/audit?entity=user&entityId=${vetId}`)).json<{
      items: AuditEntry[];
    }>();
    expect(audit.items[0]).toMatchObject({
      action: 'commission',
      after: { commissionSince: null },
    });
  });
});
