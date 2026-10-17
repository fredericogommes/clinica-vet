import type {
  ApiError,
  Client,
  Entry,
  EntryInput,
  EntryList,
  FinanceOptions,
  FinancialAccount,
  FinancialCategory,
  PaymentMethod,
  Patient,
  Product,
  ProductInput,
  Sale,
  Session,
  Supplier,
} from '@clinica/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { provisionOrganization } from '../admin/provisioning.js';
import { clientInput, patientInput } from '../../test/fixtures.js';
import { ADMIN, createHarness, loginAs, TestClient, type Harness } from '../../test/harness.js';

let h: Harness;
let admin: TestClient;
let options: FinanceOptions;
let caixa: FinancialAccount;
let banco: FinancialAccount;
let aluguel: FinancialCategory;
let outrasReceitas: FinancialCategory;

const TZ = 'America/Sao_Paulo';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const shift = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const monthStart = `${today.slice(0, 7)}-01`;

const fieldError = (body: string) => (JSON.parse(body) as ApiError).error.details?.[0];
const message = (body: string) => (JSON.parse(body) as ApiError).error.message;

async function send<T>(method: 'POST' | 'PUT', path: string, body: unknown, status = 200) {
  const res = await admin.send(method, path, body);
  expect(res.statusCode, res.body).toBe(status);
  return res.json<T>();
}

const expense = (overrides: Partial<EntryInput> = {}): EntryInput => ({
  kind: 'expense',
  description: 'Aluguel da sala',
  document: '',
  accountId: banco.id,
  categoryId: aluguel.id,
  supplierId: null,
  costCenterId: null,
  amount: 100,
  dueDate: today,
  competenceDate: null,
  repeat: 'none',
  count: 1,
  paidOn: null,
  notes: '',
  ...overrides,
});

const accounts = async () => (await admin.get('/api/finance/accounts')).json<FinancialAccount[]>();
const balanceOf = async (id: string) => (await accounts()).find((a) => a.id === id)!;
const list = async (query: string) =>
  (await admin.get(`/api/finance/entries?${query}`)).json<EntryList>();

beforeEach(async () => {
  h = await createHarness();
  admin = new TestClient(h.app);
  await admin.login(ADMIN.email, ADMIN.password);
  options = (await admin.get('/api/finance/options')).json<FinanceOptions>();
  caixa = options.accounts.find((a) => a.name === 'Caixa')!;
  banco = options.accounts.find((a) => a.name === 'Banco')!;
  aluguel = options.categories.find((c) => c.name === 'Aluguel')!;
  outrasReceitas = options.categories.find((c) => c.name === 'Outras receitas')!;
});
afterEach(async () => {
  await h.close();
});

describe('estrutura inicial', () => {
  it('cria contas e plano de contas uma vez só, com as categorias das vendas protegidas', async () => {
    expect(options.today).toBe(today);
    expect(options.accounts.map((a) => [a.name, a.kind, a.balance])).toEqual([
      ['Caixa', 'cash', 0],
      ['Banco', 'bank', 0],
    ]);
    const gerais = options.categories.find((c) => c.name === 'Gastos gerais operacionais')!;
    expect(aluguel.parentId).toBe(gerais.id);
    expect(
      options.categories
        .filter((c) => c.system)
        .map((c) => c.name)
        .sort(),
    ).toEqual(['Taxas de cartão', 'Vendas']);
    expect(options.costCenters.length).toBeGreaterThan(0);

    // Chamadas em paralelo não duplicam nada.
    await Promise.all([admin.get('/api/finance/options'), admin.get('/api/finance/accounts')]);
    const again = (await admin.get('/api/finance/options')).json<FinanceOptions>();
    expect(again.accounts).toHaveLength(2);
    expect(again.categories).toHaveLength(options.categories.length);

    const vendas = options.categories.find((c) => c.name === 'Vendas')!;
    let res = await admin.send('PUT', `/api/finance/categories/${vendas.id}`, {
      name: 'Vendas',
      kind: 'income',
      parentId: null,
      archived: true,
    });
    expect(res.statusCode).toBe(409);
    res = await admin.send('PUT', `/api/finance/categories/${vendas.id}`, {
      name: 'Vendas e serviços',
      kind: 'income',
      parentId: null,
      archived: false,
    });
    expect(res.statusCode, res.body).toBe(200);
  });

  it('valida o plano de contas: um nível, mesmo tipo e nomes únicos no mesmo lugar', async () => {
    const gerais = options.categories.find((c) => c.name === 'Gastos gerais operacionais')!;
    let res = await admin.send('POST', '/api/finance/categories', {
      name: 'Sublocação',
      kind: 'expense',
      parentId: aluguel.id,
    });
    expect(fieldError(res.body)).toEqual({
      path: 'parentId',
      message: 'Use uma categoria principal como mãe',
    });
    res = await admin.send('POST', '/api/finance/categories', {
      name: 'Juros recebidos',
      kind: 'income',
      parentId: gerais.id,
    });
    expect(fieldError(res.body)?.path).toBe('parentId');
    res = await admin.send('POST', '/api/finance/categories', {
      name: 'aluguel',
      kind: 'expense',
      parentId: gerais.id,
    });
    expect(res.statusCode).toBe(409);
    const software = await send<FinancialCategory>(
      'POST',
      '/api/finance/categories',
      { name: 'Software', kind: 'expense', parentId: gerais.id },
      201,
    );
    expect(software).toMatchObject({ parentId: gerais.id, system: false, archived: false });
    res = await admin.send('PUT', `/api/finance/categories/${gerais.id}`, {
      name: 'Gastos gerais operacionais',
      kind: 'income',
      parentId: null,
      archived: false,
    });
    expect(message(res.body)).toBe('Categoria com subcategorias não muda de tipo.');
  });
});

describe('contas', () => {
  it('cadastra conta com saldo inicial e recusa nome repetido', async () => {
    const poupanca = await send<FinancialAccount>(
      'POST',
      '/api/finance/accounts',
      { name: 'Poupança', kind: 'bank', openingBalance: 1500.5, openingDate: today },
      201,
    );
    expect([poupanca.balance, poupanca.forecast]).toEqual([1500.5, 1500.5]);
    const res = await admin.send('POST', '/api/finance/accounts', {
      name: 'poupança',
      kind: 'bank',
      openingBalance: 0,
      openingDate: today,
    });
    expect(res.statusCode).toBe(409);
    const archived = await send<FinancialAccount>('PUT', `/api/finance/accounts/${poupanca.id}`, {
      name: 'Poupança',
      kind: 'bank',
      openingBalance: -20,
      openingDate: today,
      archived: true,
    });
    expect(archived).toMatchObject({ archived: true, balance: -20 });
    // Conta arquivada não recebe lançamento novo.
    const blocked = await admin.send(
      'POST',
      '/api/finance/entries',
      expense({ accountId: poupanca.id }),
    );
    expect(fieldError(blocked.body)).toEqual({ path: 'accountId', message: 'Conta indisponível' });
  });
});

describe('lançamentos', () => {
  it('parcela a despesa com centavos na primeira parcela e vencimentos mensais', async () => {
    const created = await send<Entry[]>(
      'POST',
      '/api/finance/entries',
      expense({ amount: 100, repeat: 'installments', count: 3, dueDate: '2026-01-31' }),
      201,
    );
    expect(created.map((e) => [e.amount, e.dueDate, e.competenceDate, e.installment])).toEqual([
      [33.34, '2026-01-31', '2026-01-31', { number: 1, total: 3 }],
      [33.33, '2026-02-28', '2026-01-31', { number: 2, total: 3 }],
      [33.33, '2026-03-31', '2026-01-31', { number: 3, total: 3 }],
    ]);
    expect(created.every((e) => e.status === 'open' && e.direction === 'out')).toBe(true);
    expect(created[0]?.costCenter).not.toBeNull();

    const monthly = await send<Entry[]>(
      'POST',
      '/api/finance/entries',
      expense({
        description: 'Internet',
        amount: 120,
        repeat: 'monthly',
        count: 2,
        dueDate: today,
        paidOn: today,
      }),
      201,
    );
    expect(monthly.map((e) => [e.amount, e.status, e.paidOn])).toEqual([
      [120, 'paid', today],
      [120, 'open', null],
    ]);
    expect(monthly[1]?.competenceDate).not.toBe(monthly[0]?.competenceDate);
    expect((await balanceOf(banco.id)).balance).toBe(-120);
  });

  it('recusa categoria do tipo errado, repetição inconsistente e pagamento no futuro', async () => {
    let res = await admin.send(
      'POST',
      '/api/finance/entries',
      expense({ categoryId: outrasReceitas.id }),
    );
    expect(fieldError(res.body)).toEqual({
      path: 'categoryId',
      message: 'Escolha uma categoria de despesa',
    });
    res = await admin.send(
      'POST',
      '/api/finance/entries',
      expense({ repeat: 'monthly', count: 1 }),
    );
    expect(fieldError(res.body)).toEqual({ path: 'count', message: 'Ao menos 2' });
    res = await admin.send('POST', '/api/finance/entries', expense({ paidOn: shift(today, 1) }));
    expect(fieldError(res.body)?.path).toBe('paidOn');
    res = await admin.send('POST', '/api/finance/entries', expense({ amount: 0 }));
    expect(fieldError(res.body)?.path).toBe('amount');
  });

  it('baixa com juros em outra conta, reabre e edita; pago não se edita', async () => {
    const [entry] = await send<Entry[]>('POST', '/api/finance/entries', expense(), 201);
    let res = await admin.send('POST', `/api/finance/entries/${entry!.id}/pay`, {
      paidOn: shift(today, 1),
      accountId: caixa.id,
      amount: 102.5,
    });
    expect(fieldError(res.body)?.path).toBe('paidOn');
    const paid = await send<Entry>('POST', `/api/finance/entries/${entry!.id}/pay`, {
      paidOn: today,
      accountId: caixa.id,
      amount: 102.5,
    });
    expect(paid).toMatchObject({ status: 'paid', paidAmount: 102.5, account: { id: caixa.id } });
    expect((await balanceOf(caixa.id)).balance).toBe(-102.5);
    res = await admin.send('POST', `/api/finance/entries/${entry!.id}/pay`, {
      paidOn: today,
      accountId: caixa.id,
      amount: 1,
    });
    expect(message(res.body)).toBe('Lançamento já está pago.');
    res = await admin.send('PUT', `/api/finance/entries/${entry!.id}`, {
      ...expense(),
      competenceDate: today,
    });
    expect(message(res.body)).toBe('Reabra o lançamento pago antes de editar.');

    const reopened = await send<Entry>('POST', `/api/finance/entries/${entry!.id}/reopen`, {});
    expect(reopened).toMatchObject({ status: 'open', paidOn: null, paidAmount: null });
    expect((await balanceOf(caixa.id)).balance).toBe(0);
    expect((await balanceOf(caixa.id)).forecast).toBe(-100);

    const edited = await send<Entry>('PUT', `/api/finance/entries/${entry!.id}`, {
      ...expense({ description: 'Aluguel de março', amount: 2500 }),
      competenceDate: monthStart,
    });
    expect(edited).toMatchObject({
      description: 'Aluguel de março',
      amount: 2500,
      competenceDate: monthStart,
    });

    const audit = (
      await admin.get(`/api/admin/audit?entity=financial_entry&entityId=${entry!.id}`)
    ).json<{ items: { action: string }[] }>();
    expect(audit.items.map((a) => a.action).sort()).toEqual(['create', 'pay', 'reopen', 'update']);
  });

  it('cancela a parcela e as seguintes em aberto, com o motivo', async () => {
    const created = await send<Entry[]>(
      'POST',
      '/api/finance/entries',
      expense({ repeat: 'monthly', count: 4, paidOn: today }),
      201,
    );
    let res = await admin.send('POST', `/api/finance/entries/${created[1]!.id}/cancel`, {
      reason: 'x',
      following: true,
    });
    expect(fieldError(res.body)?.path).toBe('reason');
    const cancelled = await send<Entry>('POST', `/api/finance/entries/${created[1]!.id}/cancel`, {
      reason: 'Contrato encerrado',
      following: true,
    });
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelReason: 'Contrato encerrado' });
    const all = await list(`de=${shift(today, -1)}&ate=${shift(today, 200)}&situacao=cancelados`);
    expect(all.items.map((e) => e.installment?.number)).toEqual([2, 3, 4]);
    const first = await list(`de=${shift(today, -1)}&ate=${shift(today, 200)}`);
    expect(first.items.map((e) => e.installment?.number)).toEqual([1]);
    res = await admin.send('POST', `/api/finance/entries/${created[1]!.id}/cancel`, {
      reason: 'De novo',
    });
    expect(res.statusCode).toBe(409);
  });

  it('transfere entre contas e cancela as duas pontas juntas', async () => {
    let res = await admin.send('POST', '/api/finance/transfers', {
      fromAccountId: caixa.id,
      toAccountId: caixa.id,
      amount: 10,
      date: today,
      description: '',
    });
    expect(fieldError(res.body)?.path).toBe('toAccountId');
    const [out, inn] = await send<Entry[]>(
      'POST',
      '/api/finance/transfers',
      { fromAccountId: caixa.id, toAccountId: banco.id, amount: 300, date: today, description: '' },
      201,
    );
    expect(out).toMatchObject({
      kind: 'transfer',
      direction: 'out',
      status: 'paid',
      description: 'Transferência de Caixa para Banco',
      counterpart: { id: banco.id, name: 'Banco' },
    });
    expect(inn?.counterpart?.id).toBe(caixa.id);
    expect([(await balanceOf(caixa.id)).balance, (await balanceOf(banco.id)).balance]).toEqual([
      -300, 300,
    ]);
    // Transferência não entra nos totais de receita e despesa.
    expect((await list('tipo=todos')).totals).toEqual({ income: 0, expense: 0 });
    res = await admin.send('POST', `/api/finance/entries/${inn!.id}/reopen`, {});
    expect(res.statusCode).toBe(409);
    await send<Entry>('POST', `/api/finance/entries/${inn!.id}/cancel`, {
      reason: 'Lançada em duplicidade',
    });
    expect([(await balanceOf(caixa.id)).balance, (await balanceOf(banco.id)).balance]).toEqual([
      0, 0,
    ]);
  });

  it('lista o extrato da conta com saldo anterior, saldo linha a linha e pendências', async () => {
    await send<FinancialAccount>('PUT', `/api/finance/accounts/${banco.id}`, {
      name: 'Banco',
      kind: 'bank',
      openingBalance: 1000,
      openingDate: '2020-01-01',
      archived: false,
    });
    const yesterday = shift(today, -1);
    // Pago antes do período: entra no saldo anterior.
    await send(
      'POST',
      '/api/finance/entries',
      expense({ amount: 50, paidOn: shift(today, -40), dueDate: shift(today, -40) }),
      201,
    );
    await send(
      'POST',
      '/api/finance/entries',
      {
        ...expense({
          kind: 'income',
          categoryId: outrasReceitas.id,
          description: 'Aluguel de sala',
        }),
        amount: 400,
        dueDate: yesterday,
        paidOn: yesterday,
      },
      201,
    );
    await send('POST', '/api/finance/entries', expense({ amount: 80, paidOn: today }), 201);
    await send('POST', '/api/finance/entries', expense({ amount: 30, dueDate: yesterday }), 201);
    await send(
      'POST',
      '/api/finance/entries',
      expense({ amount: 20, dueDate: shift(today, 3) }),
      201,
    );

    const from = shift(today, -7);
    const to = shift(today, 7);
    const statement = await list(`conta=${banco.id}&de=${from}&ate=${to}`);
    expect(statement.openingBalance).toBe(950);
    expect(statement.items.map((e) => [e.amount, e.status, e.runningBalance, e.overdue])).toEqual([
      [400, 'paid', 1350, false],
      [30, 'open', null, true],
      [80, 'paid', 1270, false],
      [20, 'open', null, false],
    ]);
    expect(statement.totals).toEqual({ income: 400, expense: 130 });
    expect(statement.pending).toEqual({
      overdue: { count: 1, amount: 30 },
      next7: { count: 1, amount: 20 },
    });

    // Contas a pagar: em aberto sem período mostra tudo, do mais antigo ao mais novo.
    const payable = await list('tipo=despesas&situacao=abertos');
    expect([payable.from, payable.to]).toEqual([null, null]);
    expect(payable.items.map((e) => e.amount)).toEqual([30, 20]);
    const overdue = await list('tipo=despesas&situacao=vencidos');
    expect(overdue.items.map((e) => e.amount)).toEqual([30]);
    // Busca pela categoria-mãe traz as subcategorias.
    const gerais = options.categories.find((c) => c.name === 'Gastos gerais operacionais')!;
    const byParent = await list(`categoria=${gerais.id}&de=${from}&ate=${to}`);
    expect(byParent.items).toHaveLength(3);
    expect(byParent.items.every((e) => e.runningBalance === null)).toBe(true);
    // Sem período, o extrato é o mês corrente.
    const month = await list('');
    expect(month.from).toBe(monthStart);
  });
});

describe('fornecedores', () => {
  it('valida documento e recusa CNPJ repetido', async () => {
    let res = await admin.send('POST', '/api/finance/suppliers', {
      name: 'Distribuidora Pet',
      document: '11.111.111/1111-11',
      phone: '',
      email: '',
      notes: '',
    });
    expect(fieldError(res.body)).toEqual({ path: 'document', message: 'CPF ou CNPJ inválido' });
    const supplier = await send<Supplier>(
      'POST',
      '/api/finance/suppliers',
      {
        name: 'Distribuidora Pet',
        document: '11.222.333/0001-81',
        phone: '(11) 3333-4444',
        email: 'vendas@distribuidora.test',
        notes: '',
      },
      201,
    );
    expect(supplier).toMatchObject({ document: '11222333000181', phone: '1133334444' });
    res = await admin.send('POST', '/api/finance/suppliers', {
      name: 'Outra razão social',
      document: '11222333000181',
      phone: '',
      email: '',
      notes: '',
    });
    expect(message(res.body)).toBe('Já existe um fornecedor com este CPF ou CNPJ.');
    const [entry] = await send<Entry[]>(
      'POST',
      '/api/finance/entries',
      expense({ supplierId: supplier.id, document: 'NF 123' }),
      201,
    );
    expect(entry?.supplier).toEqual({ id: supplier.id, name: 'Distribuidora Pet' });
    expect((await list('q=distribuidora')).items).toHaveLength(1);
    expect((await list('q=nf 123')).items).toHaveLength(1);
  });
});

describe('vendas no financeiro', () => {
  let client: Client;
  let thor: Patient;
  let consulta: Product;
  let dinheiro: PaymentMethod;
  let visa: PaymentMethod;
  let adminId: string;

  beforeEach(async () => {
    adminId = (await admin.get('/api/auth/session')).json<Session>().user.id;
    client = (await admin.send('POST', '/api/clients', clientInput())).json<Client>();
    thor = (
      await admin.send('POST', '/api/patients', {
        clientId: client.id,
        patient: patientInput({ name: 'Thor' }),
      })
    ).json<Patient>();
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
    const methods = (await admin.get('/api/payment-methods')).json<PaymentMethod[]>();
    dinheiro = methods.find((m) => m.name === 'Dinheiro')!;
    visa = await send<PaymentMethod>(
      'POST',
      '/api/payment-methods',
      {
        name: 'Rede Visa Crédito',
        kind: 'credit',
        acquirer: 'Rede',
        brand: 'Visa',
        settlementDays: 30,
        maxInstallments: 6,
        feePercent: 3.5,
      },
      201,
    );
    await send('POST', '/api/cash', { openingAmount: 100 }, 201);
  });

  const sell = async () =>
    send<Sale>(
      'POST',
      '/api/sales',
      {
        kind: 'sale',
        saleType: 'in_person_consumer',
        clientId: client.id,
        patientId: thor.id,
        items: [{ productId: consulta.id, professionalId: adminId, quantity: 1, unitPrice: null }],
        discount: { mode: 'amount', value: 0 },
        notes: '',
      },
      201,
    );

  it('lança dinheiro como receita paga no caixa e cartão como receita a receber com a taxa', async () => {
    const sale = await sell();
    const received = await send<Sale>('POST', `/api/sales/${sale.id}/receive`, {
      payments: [
        { methodId: dinheiro.id, amount: 50, installments: 1 },
        { methodId: visa.id, amount: 150, installments: 2 },
      ],
    });
    const visaParts = received.payments[1]!.receivables;
    const entries = (await list(`de=${today}&ate=${shift(today, 90)}`)).items;
    expect(entries.map((e) => [e.origin, e.status, e.account.name, e.amount])).toEqual([
      ['sale', 'paid', 'Caixa', 50],
      ['sale', 'open', 'Banco', visaParts[0]!.amount],
      ['card_fee', 'open', 'Banco', visaParts[0]!.feeAmount],
      ['sale', 'open', 'Banco', visaParts[1]!.amount],
      ['card_fee', 'open', 'Banco', visaParts[1]!.feeAmount],
    ]);
    expect(entries[0]).toMatchObject({
      description: `Venda ${String(sale.code)} - ${client.name} - Dinheiro`,
      category: { name: 'Vendas' },
      client: { id: client.id },
      sale: { id: sale.id, code: sale.code },
      competenceDate: today,
      paidOn: today,
    });
    expect(entries[1]).toMatchObject({
      dueDate: visaParts[0]!.dueDate,
      installment: { number: 1, total: 2 },
    });
    expect(entries[2]?.category?.name).toBe('Taxas de cartão');
    expect((await balanceOf(caixa.id)).balance).toBe(50);

    // Lançamento de venda não se edita nem se cancela pelo financeiro.
    let res = await admin.send('POST', `/api/finance/entries/${entries[1]!.id}/cancel`, {
      reason: 'Teste de cancelamento',
    });
    expect(message(res.body)).toBe(
      'Lançamento de venda acompanha a venda: estorne a venda para cancelar.',
    );
    res = await admin.send('PUT', `/api/finance/entries/${entries[1]!.id}`, {
      ...expense(),
      competenceDate: today,
    });
    expect(res.statusCode).toBe(409);

    // Estorno da venda cancela tudo o que ela lançou.
    await send('POST', `/api/sales/${sale.id}/reverse`, { reason: 'Cliente desistiu' });
    const after = await list(`de=${today}&ate=${shift(today, 90)}&situacao=cancelados`);
    expect(after.items).toHaveLength(5);
    expect(after.items[0]?.cancelReason).toBe(
      `Estorno da venda ${String(sale.code)}: Cliente desistiu`,
    );
    expect((await balanceOf(caixa.id)).balance).toBe(0);
  });
});

describe('acesso', () => {
  it('só o perfil financeiro vê e lança; outra clínica não enxerga os lançamentos', async () => {
    const [entry] = await send<Entry[]>('POST', '/api/finance/entries', expense(), 201);
    const recep = await loginAs(h, admin, 'Recepcionista');
    expect((await recep.get('/api/finance/entries')).statusCode).toBe(403);
    expect((await recep.send('POST', '/api/finance/entries', expense())).statusCode).toBe(403);
    const gestor = await loginAs(h, admin, 'Gestor da Clínica');
    expect((await gestor.get('/api/finance/entries')).statusCode).toBe(200);

    await h.db.transaction((tx) =>
      provisionOrganization(tx, {
        organizationName: 'Outra Clínica',
        unitName: 'Sede',
        admin: { name: 'Olga', email: 'olga@outra.test', password: 'senha-forte-789' },
      }),
    );
    const stranger = new TestClient(h.app);
    await stranger.login('olga@outra.test', 'senha-forte-789');
    expect((await stranger.get(`/api/finance/entries/${entry!.id}`)).statusCode).toBe(404);
    const theirs = await stranger.get('/api/finance/entries');
    expect(theirs.json<EntryList>().items).toHaveLength(0);
    // Nem usa a conta desta clínica.
    const res = await stranger.send('POST', `/api/finance/entries/${entry!.id}/pay`, {
      paidOn: today,
      accountId: banco.id,
      amount: 100,
    });
    expect(res.statusCode).toBe(404);
  });
});
