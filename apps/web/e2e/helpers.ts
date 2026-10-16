import { expect, type Page } from '@playwright/test';

export const admin = {
  email: process.env.E2E_ADMIN_EMAIL ?? 'admin@clinica.local',
  password: process.env.E2E_ADMIN_PASSWORD ?? 'senha-local-123',
};

/** Sufixo único por execução: os testes rodam contra o mesmo banco semeado. */
export const run = Date.now().toString(36);

export const ADMIN_STATE = 'e2e/.auth/admin.json';

export const toasts = (page: Page) => page.getByRole('region', { name: /Avisos/ });
export const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Principal' });

export async function login(page: Page, email: string, password: string) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/entrar/);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

/** Entra como administrador e espera a tela inicial, para que a sessão já esteja ativa. */
export async function loginAsAdmin(page: Page) {
  await login(page, admin.email, admin.password);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Olá');
}
