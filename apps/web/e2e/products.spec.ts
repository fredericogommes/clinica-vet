import { expect, test } from '@playwright/test';
import { ADMIN_STATE, run, sidebar, toasts } from './helpers';

test.use({ storageState: ADMIN_STATE });

test('produtos e serviços: grupo, serviço classificado, produto com markup e arquivamento', async ({
  page,
}) => {
  const group = `Antiparasitários ${run}`;
  const service = `Consulta dermatológica ${run}`;
  const product = `Bravecto 20 kg ${run}`;
  await page.goto('/');

  // Grupo de produtos (taxonomia do catálogo).
  await sidebar(page).getByRole('link', { name: 'Grupos de produtos' }).click();
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  const groupDialog = page.getByRole('dialog', { name: 'Novo grupo' });
  await groupDialog.getByLabel('Nome').fill(group);
  await groupDialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(toasts(page).getByText('Cadastro incluído.')).toBeVisible();

  // Serviço classificado por tipo, não pelo nome (F1-18).
  await sidebar(page).getByRole('link', { name: 'Produtos e serviços' }).click();
  await page.getByRole('link', { name: 'Novo item' }).click();
  await page.getByRole('group', { name: 'Tipo' }).getByText('Serviço', { exact: true }).click();
  await expect(page.getByLabel('Código de barras')).toHaveCount(0);
  await page.getByLabel('Classificação do serviço').selectOption({ label: 'Consulta' });
  await page.getByLabel('Nome', { exact: true }).fill(service);
  await page.getByLabel('Preço de venda (R$)').fill('220');
  await page.getByLabel('Código do serviço (lista municipal)').fill('05.01');
  await page.getByRole('button', { name: 'Cadastrar' }).click();
  await expect(toasts(page).getByText(/Serviço cadastrado com o código \d+\./)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(service);

  // Produto: código de barras inválido é apontado; preço sai do markup calculado no servidor.
  await page.getByRole('link', { name: 'Voltar à lista' }).click();
  await page.getByRole('link', { name: 'Novo item' }).click();
  await page.getByLabel('Nome', { exact: true }).fill(product);
  await page.getByLabel('Unidade de venda').selectOption({ label: 'Comprimido' });
  await page.getByLabel('Código de barras').fill('7891234567890');
  await page.getByLabel('Grupo').selectOption({ label: group });
  await page.getByLabel('Custo de aquisição (R$)').fill('150');
  await page.getByLabel('Markup desejado (%)').fill('45');
  await expect(page.getByText('R$ 217,50')).toBeVisible();
  await page.getByRole('button', { name: 'Usar este preço' }).click();
  await expect(page.getByLabel('Preço de venda (R$)')).toHaveValue('217,50');
  await page.getByRole('button', { name: 'Cadastrar' }).click();
  await expect(page.getByText('Código de barras inválido')).toBeVisible();
  await page.getByLabel('Código de barras').fill('');
  await page.getByLabel('NCM').fill('30049099');
  await page.getByRole('button', { name: 'Cadastrar' }).click();
  await expect(toasts(page).getByText(/Produto cadastrado com o código \d+\./)).toBeVisible();
  await expect(page.getByText('45%', { exact: true })).toBeVisible();

  // Lista: busca, filtro por tipo e arquivamento.
  await page.getByRole('link', { name: 'Voltar à lista' }).click();
  await page.getByLabel('Buscar produtos e serviços').fill(run);
  const table = page.getByRole('table', { name: 'Produtos e serviços' });
  await expect(table.getByRole('row')).toHaveCount(3);
  await page.getByRole('group', { name: 'Tipo' }).getByRole('button', { name: 'Serviços' }).click();
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(table).toContainText(service);
  await expect(table).toContainText('R$ 220,00');
  await page.getByRole('group', { name: 'Tipo' }).getByRole('button', { name: 'Todos' }).click();
  await table.getByRole('link', { name: product }).click();
  await page.getByRole('button', { name: 'Arquivar' }).click();
  await expect(toasts(page).getByText('Item arquivado.')).toBeVisible();
  await expect(page.getByLabel('Nome', { exact: true })).toBeDisabled();
  await page.getByRole('link', { name: 'Voltar à lista' }).click();
  await page.getByLabel('Buscar produtos e serviços').fill(run);
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(table).not.toContainText(product);
});

test('produtos no celular: lista e ficha sem rolagem lateral @mobile', async ({ page }) => {
  await page.goto('/estoque/produtos');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Produtos e serviços');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
  await page.goto('/estoque/produtos/novo');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Novo produto ou serviço');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
});
