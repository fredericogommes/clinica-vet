import { expect, test } from '@playwright/test';
import { ADMIN_STATE, sidebar, toasts } from './helpers';

test.use({ storageState: ADMIN_STATE });

test('painel: indicadores, widgets e montagem por usuário', async ({ page }) => {
  await page.goto('/');
  await sidebar(page).getByRole('link', { name: 'Início' }).click();
  const indicators = page.locator('dl[aria-label="Indicadores"]');
  for (const label of ['Animais', 'Responsáveis', 'Venda líquida no mês', 'Débitos de clientes']) {
    await expect(indicators.getByText(label, { exact: true })).toBeVisible();
  }
  const widget = (name: string) => page.getByRole('region', { name });
  await expect(widget('Animais por mês').getByRole('table')).toContainText('Animais');
  await expect(widget('Últimos acessos')).toBeVisible();
  await expect(widget('Estoque abaixo do mínimo')).toBeVisible();

  // Desliga "Últimos acessos" e sobe "Estoque abaixo do mínimo" para o topo.
  await page.getByRole('button', { name: 'Configurar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Configurar painel' });
  await dialog.getByRole('checkbox', { name: 'Últimos acessos' }).click();
  for (let i = 0; i < 6; i++) {
    await dialog.getByRole('button', { name: 'Subir Estoque abaixo do mínimo' }).click();
  }
  await expect(
    dialog.getByRole('button', { name: 'Subir Estoque abaixo do mínimo' }),
  ).toBeDisabled();
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(toasts(page).getByText('Painel atualizado.')).toBeVisible();
  await expect(widget('Últimos acessos')).toHaveCount(0);
  const first = page.getByRole('main').getByRole('region').first();
  await expect(first).toHaveAccessibleName('Estoque abaixo do mínimo');

  // A montagem fica salva para o usuário.
  await page.reload();
  await expect(page.getByRole('main').getByRole('region').first()).toHaveAccessibleName(
    'Estoque abaixo do mínimo',
  );
  await expect(widget('Últimos acessos')).toHaveCount(0);

  // Volta à montagem padrão para não afetar outras execuções.
  await page.getByRole('button', { name: 'Configurar' }).click();
  await dialog.getByRole('checkbox', { name: 'Últimos acessos' }).click();
  for (let i = 0; i < 6; i++) {
    await dialog.getByRole('button', { name: 'Descer Estoque abaixo do mínimo' }).click();
  }
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(widget('Últimos acessos')).toBeVisible();
  await expect(page.getByRole('main').getByRole('region').first()).toHaveAccessibleName(
    'Animais por mês',
  );
});

test('painel no celular: indicadores antes dos widgets, sem rolagem lateral @mobile', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('dl[aria-label="Indicadores"]')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBe(0);
});
