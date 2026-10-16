import { expect, test, type Page } from '@playwright/test';

const admin = {
  email: process.env.E2E_ADMIN_EMAIL ?? 'admin@clinica.local',
  password: process.env.E2E_ADMIN_PASSWORD ?? 'senha-local-123',
};
const run = Date.now().toString(36);

const toasts = (page: Page) => page.getByRole('region', { name: /Avisos/ });
const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Principal' });

async function login(page: Page, email: string, password: string) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/entrar/);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

test('mostra erro claro com senha errada', async ({ page }) => {
  await login(page, admin.email, 'senha-incorreta');
  await expect(page.getByRole('alert')).toHaveText('E-mail ou senha inválidos.');
});

test('valida campos antes de enviar', async ({ page }) => {
  await page.goto('/entrar');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('Informe um e-mail válido')).toBeVisible();
  await expect(page.getByText('Informe a senha')).toBeVisible();
});

test('administrador clona perfil, cria usuário e o acesso fica restrito ao perfil', async ({
  page,
  browser,
}) => {
  await login(page, admin.email, admin.password);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Olá');

  // Clona o modelo Recepcionista e libera apenas a visualização de usuários.
  await sidebar(page).getByRole('link', { name: 'Perfis de acesso' }).click();
  await page.getByRole('button', { name: 'Clonar Recepcionista' }).click();
  const roleName = `Recepção ${run}`;
  await page.getByLabel('Nome do novo perfil').fill(roleName);
  await page.getByRole('button', { name: 'Clonar perfil' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(roleName);
  await page.getByLabel(/Ver usuários/).check();
  await page.getByRole('button', { name: 'Salvar perfil' }).click();
  await expect(toasts(page).getByText('Perfil salvo.')).toBeVisible();

  // Cria um usuário com esse perfil.
  await sidebar(page).getByRole('link', { name: 'Usuários' }).click();
  await page.getByRole('button', { name: 'Novo usuário' }).click();
  const email = `rita.${run}@clinica.local`;
  await page.getByLabel('Nome').fill('Rita Souza');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha inicial').fill('senha-da-rita-1');
  await page.getByLabel('Perfil de acesso').selectOption({ label: roleName });
  await page.getByRole('button', { name: 'Criar usuário' }).click();
  await expect(toasts(page).getByText('Usuário Rita Souza criado.')).toBeVisible();
  await expect(page.getByRole('cell', { name: new RegExp(email) })).toBeVisible();

  // A nova usuária vê usuários, mas não perfis nem auditoria.
  const context = await browser.newContext();
  const ritaPage = await context.newPage();
  await login(ritaPage, email, 'senha-da-rita-1');
  const nav = ritaPage.getByRole('navigation', { name: 'Principal' });
  await expect(nav.getByRole('link', { name: 'Usuários' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Perfis de acesso' })).toHaveCount(0);
  await expect(ritaPage.getByRole('button', { name: 'Novo usuário' })).toHaveCount(0);
  await ritaPage.goto('/consultas/auditoria');
  await expect(ritaPage.getByText('Sem acesso a esta tela')).toBeVisible();
  await context.close();

  // A auditoria registra as alterações com autor.
  await sidebar(page).getByRole('link', { name: 'Auditoria' }).click();
  await expect(page.getByRole('cell', { name: 'Criou Usuário' }).first()).toBeVisible();
});

test('sair encerra a sessão', async ({ page }) => {
  await login(page, admin.email, admin.password);
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/entrar/);
  await page.goto('/configuracao/usuarios');
  await expect(page).toHaveURL(/\/entrar\?redirect=/);
});

test('menu móvel abre e navega @mobile', async ({ page }) => {
  await login(page, admin.email, admin.password);
  await page.getByRole('button', { name: 'Abrir menu' }).click();
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Usuários' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Usuários');
  await expect(page.getByRole('dialog', { name: 'Menu' })).toHaveCount(0);
});
