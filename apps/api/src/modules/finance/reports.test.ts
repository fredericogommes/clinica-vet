import type {
  ApiError,
  CashFlow,
  Entry,
  EntryInput,
  FinanceOptions,
  FinancialAccount,
  FinancialCategory,
  Statement,
} from '@clinica/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, createHarness, loginAs, TestClient, type Harness } from '../../test/harness.js';

let h: Harness;
let admin: TestClient;
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
const thisMonth = today.slice(0, 7);
const lastMonth = shift(`${thisMonth}-01`, -1).slice(0, 7);

const fieldError = (body: string) => (JSON.parse(body) as ApiError).error.details?.[0];

async function send<T>(method: 'POST' | 'PUT', path: string, body: unknown, status = 200) {
  const res = await admin.send(method, path, body);
  expect(res.statusCode, res.body).toBe(status);
  return res.json<T>();
}

const entry = (overrides: Partial<EntryInput>): EntryInput => ({
  kind: 'expense',
  description: 'Lançamento',
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

const statement = async (query: string) =>
  (await admin.get(`/api/finance/statement?${query}`)).json<Statement>();
const cashFlow = async (query: string) =>
  (await admin.get(`/api/finance/cash-flow?${query}`)).json<CashFlow>();

beforeEach(async () => {
  h = await createHarness();
  admin = new TestClient(h.app);
  await admin.login(ADMIN.email, ADMIN.password);
  const options = (await admin.get('/api/finance/options')).json<FinanceOptions>();
  caixa = options.accounts.find((a) => a.name === 'Caixa')!;
  banco = options.accounts.find((a) => a.name === 'Banco')!;
  aluguel = options.categories.find((c) => c.name === 'Aluguel')!;
  outrasReceitas = options.categories.find((c) => c.name === 'Outras receitas')!;

  // Aluguel do mês passado pago hoje com juros; receita recebida hoje; receita a receber.
  const [rent] = await send<Entry[]>(
    'POST',
    '/api/finance/entries',
    entry({ description: 'Aluguel', amount: 1000, competenceDate: `${lastMonth}-05` }),
    201,
  );
  await send('POST', `/api/finance/entries/${rent!.id}/pay`, {
    paidOn: today,
    accountId: banco.id,
    amount: 1010,
  });
  await send(
    'POST',
    '/api/finance/entries',
    entry({
      kind: 'income',
      description: 'Sublocação',
      categoryId: outrasReceitas.id,
      amount: 300,
      paidOn: today,
    }),
    201,
  );
  await send(
    'POST',
    '/api/finance/entries',
    entry({
      kind: 'income',
      description: 'Parceria',
      categoryId: outrasReceitas.id,
      amount: 500,
      dueDate: shift(today, 10),
      competenceDate: today,
    }),
    201,
  );
  // Transferência não é receita nem despesa.
  await send(
    'POST',
    '/api/finance/transfers',
    {
      fromAccountId: banco.id,
      toAccountId: caixa.id,
      amount: 50,
      date: today,
      description: 'Troco',
    },
    201,
  );
});
afterEach(async () => {
  await h.close();
});

describe('demonstrativo', () => {
  it('alterna competência e caixa, com subcategorias e o que segue em aberto', async () => {
    const competencia = await statement(`de=${lastMonth}&ate=${thisMonth}`);
    expect(competencia.months).toEqual([lastMonth, thisMonth]);
    expect(competencia.income.rows).toEqual([
      {
        categoryId: outrasReceitas.id,
        name: 'Outras receitas',
        depth: 0,
        values: [0, 800],
        total: 800,
      },
    ]);
    expect(competencia.expense.rows.map((r) => [r.name, r.depth, r.values])).toEqual([
      ['Gastos gerais operacionais', 0, [1010, 0]],
      ['Aluguel', 1, [1010, 0]],
    ]);
    expect(competencia.result).toEqual({ values: [-1010, 800], total: -210 });
    expect(competencia.open).toEqual({ values: [0, 500], total: 500 });

    const caixaRegime = await statement(`regime=caixa&de=${lastMonth}&ate=${thisMonth}`);
    expect(caixaRegime.income.values).toEqual([0, 300]);
    expect(caixaRegime.expense.values).toEqual([0, 1010]);
    expect(caixaRegime.result).toEqual({ values: [0, -710], total: -710 });
    expect(caixaRegime.open.total).toBe(0);

    // Sem período, o ano corrente.
    const year = await statement('');
    expect(year.months).toHaveLength(12);
    expect(year.months[0]).toBe(`${today.slice(0, 4)}-01`);
  });

  it('valida período e centro de custo', async () => {
    let res = await admin.get(`/api/finance/statement?de=${thisMonth}&ate=${lastMonth}`);
    expect(fieldError(res.body)).toEqual({
      path: 'ate',
      message: 'O último mês vem depois do primeiro',
    });
    res = await admin.get('/api/finance/statement?de=2024-01&ate=2026-12');
    expect(fieldError(res.body)?.message).toBe('Escolha até 24 meses');
    res = await admin.get('/api/finance/statement?centro=0190f0a0-0000-7000-8000-000000000000');
    expect(fieldError(res.body)).toEqual({
      path: 'centro',
      message: 'Centro de custo indisponível',
    });
    const options = (await admin.get('/api/finance/options')).json<FinanceOptions>();
    const centered = await statement(
      `de=${lastMonth}&ate=${thisMonth}&centro=${options.costCenters[0]!.id}`,
    );
    expect(centered.result.total).toBe(-210);
  });
});

describe('fluxo de caixa', () => {
  it('saldo diário real até hoje e previsto com o que vence', async () => {
    const flow = await cashFlow(`de=${shift(today, -1)}&ate=${shift(today, 15)}`);
    expect(flow.days).toHaveLength(17);
    expect(flow.days[0]).toEqual({ date: shift(today, -1), real: 0, forecast: 0 });
    expect(flow.days[1]).toEqual({ date: today, real: -710, forecast: -710 });
    expect(flow.days[2]?.real).toBeNull();
    expect(flow.days[11]).toEqual({ date: shift(today, 10), real: null, forecast: -210 });
    expect(flow.summary).toEqual({
      openingBalance: 0,
      realBalance: -710,
      forecastBalance: -210,
      income: { paid: 300, open: 500 },
      expense: { paid: 1010, open: 0 },
    });
    const months = flow.months.reduce((sum, m) => sum + m.income.paid + m.income.open, 0);
    expect(months).toBe(800);

    // Por conta, a transferência move o saldo.
    const bank = await cashFlow(`de=${today}&ate=${today}&conta=${banco.id}`);
    expect(bank.summary.realBalance).toBe(-760);
    const cash = await cashFlow(`de=${today}&ate=${today}&conta=${caixa.id}`);
    expect(cash.summary.realBalance).toBe(50);

    // Pago antes do período entra no saldo inicial.
    const later = await cashFlow(`de=${shift(today, 1)}&ate=${shift(today, 12)}`);
    expect(later.summary.openingBalance).toBe(-710);
    expect(later.summary.forecastBalance).toBe(-210);

    const res = await admin.get(`/api/finance/cash-flow?de=${today}&ate=${shift(today, 400)}`);
    expect(fieldError(res.body)?.message).toBe('Escolha um período de até 366 dias');
  });

  it('só quem vê os relatórios do financeiro', async () => {
    const recep = await loginAs(h, admin, 'Recepcionista');
    expect((await recep.get('/api/finance/statement')).statusCode).toBe(403);
    expect((await recep.get('/api/finance/cash-flow')).statusCode).toBe(403);
  });
});
