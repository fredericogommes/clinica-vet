import type {
  FinanceOptions,
  FinancialAccount,
  FinancialCategory,
  Session,
} from '@clinica/contracts';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STATE, run, sidebar } from './helpers';

test.use({ storageState: ADMIN_STATE });

const tag = `rel${run.split('').reverse().join('')}`;

/**
 * Conta e categoria próprias do teste, com receita recebida, receita a receber e despesa paga, via
 * API. A conta isola o fluxo de caixa e a categoria isola a linha do demonstrativo.
 */
async function seed(page: Page, suffix: string) {
  await page.goto('/');
  return page.evaluate(async (suffix) => {
    const session = (await (await fetch('/api/auth/session')).json()) as Session;
    const send = async <T>(path: string, body: unknown): Promise<T> => {
      const r = await fetch(`/api${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`${path}: ${await r.text()}`);
      return (await r.json()) as T;
    };
    const options = (await (await fetch('/api/finance/options')).json()) as FinanceOptions;
    const today = options.today;
    const inFive = new Date(`${today}T12:00:00Z`);
    inFive.setUTCDate(inFive.getUTCDate() + 5);
    const account = await send<FinancialAccount>('/finance/accounts', {
      name: `Conta Fluxo ${suffix}`,
      kind: 'bank',
      openingBalance: 1000,
      openingDate: today,
    });
    const category = await send<FinancialCategory>('/finance/categories', {
      name: `Consultoria ${suffix}`,
      kind: 'income',
      parentId: null,
    });
    const aluguel = options.categories.find((c) => c.name === 'Aluguel');
    if (!aluguel) throw new Error('Categoria Aluguel não encontrada');
    const entry = {
      document: '',
      accountId: account.id,
      supplierId: null,
      costCenterId: null,
      competenceDate: null,
      repeat: 'none',
      count: 1,
      notes: '',
    };
    await send('/finance/entries', {
      ...entry,
      kind: 'income',
      description: `Consultoria recebida ${suffix}`,
      categoryId: category.id,
      amount: 600,
      dueDate: today,
      paidOn: today,
    });
    await send('/finance/entries', {
      ...entry,
      kind: 'income',
      description: `Consultoria a receber ${suffix}`,
      categoryId: category.id,
      amount: 400,
      dueDate: inFive.toISOString().slice(0, 10),
      competenceDate: today,
      paidOn: null,
    });
    await send('/finance/entries', {
      ...entry,
      kind: 'expense',
      description: `Aluguel ${suffix}`,
      categoryId: aluguel.id,
      amount: 250,
      dueDate: today,
      paidOn: today,
    });
    return { account: account.name, category: category.name };
  }, suffix);
}

test('demonstrativo alterna competência e caixa; fluxo filtra conta, tipo e situação', async ({
  page,
}) => {
  const { account, category } = await seed(page, `d${tag}`);

  await sidebar(page).getByRole('link', { name: 'Demonstrativo' }).click();
  const row = page.getByRole('row', { name: new RegExp(`^${category}`) });
  await expect(row).toContainText(/R\$\s1\.000,00/);
  await expect(page.getByRole('row', { name: /^Ainda em aberto/ })).toBeVisible();
  await page.getByRole('group', { name: 'Regime' }).getByText('Caixa').click();
  await expect(page).toHaveURL(/regime=caixa/);
  await expect(row).not.toContainText(/R\$\s1\.000,00/);
  await expect(row).toContainText(/R\$\s600,00/);
  await expect(page.getByRole('row', { name: /^Ainda em aberto/ })).toHaveCount(0);

  await sidebar(page).getByRole('link', { name: 'Fluxo de caixa' }).click();
  await page.getByRole('combobox', { name: 'Conta' }).selectOption({ label: account });
  await expect(page).toHaveURL(/conta=/);
  const summary = page.getByLabel('Resumo do fluxo de caixa');
  await expect(summary).toContainText(/Saldo inicialR\$\s1\.000,00/);
  await expect(summary).toContainText(/Saldo realR\$\s1\.350,00/);
  await expect(summary).toContainText(/Saldo previstoR\$\s1\.750,00/);
  await expect(summary).toContainText(/ReceitasR\$\s1\.000,00R\$\s400,00 a receber/);

  const months = page.getByRole('table', { name: 'Resultado por mês' });
  await expect(months.getByRole('columnheader', { name: 'Despesas' })).toBeVisible();
  await page.getByRole('group', { name: 'Tipo' }).getByText('Receitas', { exact: true }).click();
  await expect(months.getByRole('columnheader', { name: 'Despesas' })).toHaveCount(0);
  await page
    .getByRole('group', { name: 'Situação' })
    .getByText('Previsto', { exact: true })
    .click();
  await expect(page).toHaveURL(/situacao=previsto/);
  const current = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const monthNames = [
    'jan',
    'fev',
    'mar',
    'abr',
    'mai',
    'jun',
    'jul',
    'ago',
    'set',
    'out',
    'nov',
    'dez',
  ];
  const label = `${monthNames[Number(current.slice(5, 7)) - 1] ?? ''}/${current.slice(2, 4)}`;
  await expect(months.getByRole('row', { name: new RegExp(`^${label}`) })).toContainText(
    /R\$\s400,00/,
  );
});

test('relatórios do financeiro no celular sem rolagem lateral @mobile', async ({ page }) => {
  const { category } = await seed(page, `m${tag}`);
  await page.goto('/financeiro/demonstrativo');
  await expect(page.getByRole('row', { name: new RegExp(`^${category}`) })).toBeVisible();
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(await overflow()).toBe(0);
  await page.goto('/financeiro/fluxo-de-caixa');
  await expect(page.getByRole('heading', { name: 'Saldo diário' })).toBeVisible();
  expect(await overflow()).toBe(0);
});
