import type { CatalogItem, Product, Session } from '@clinica/contracts';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STATE, run, sidebar, toasts } from './helpers';

test.use({ storageState: ADMIN_STATE });

const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Grupo próprio com luva (200 un, custo 0,60) e vacina com lote (8 un, custo 42), via API. */
async function seed(page: Page, suffix: string) {
  await page.goto('/');
  return page.evaluate(
    async ({ suffix, expiresOn }) => {
      const session = (await (await fetch('/api/auth/session')).json()) as Session;
      const send = async <T>(path: string, body: unknown) => {
        const r = await fetch(`/api${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken },
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(await r.text());
        return (await r.json()) as T;
      };
      const group = await send<CatalogItem>('/catalogs/product-groups', {
        name: `Descartáveis ${suffix}`,
      });
      const product = (body: Record<string, unknown>) =>
        send<Product>('/products', {
          kind: 'product',
          serviceKind: null,
          unit: 'un',
          barcode: '',
          brandId: null,
          groupId: group.id,
          ncm: '',
          origin: '0',
          acquisition: 'resale',
          cfop: '',
          taxSituation: '',
          municipalServiceCode: '',
          taxProfile: '',
          salePrice: 10,
          purpose: 'sale',
          desiredMarkup: null,
          allowPriceChange: false,
          showInPriceList: true,
          discountLimitPercent: null,
          defaultCommissionPercent: 0,
          commissions: [],
          tracksStock: true,
          minStock: null,
          idealStock: null,
          ...body,
        });
      const luva = await product({ name: `Luva ${suffix}`, cost: 0.6 });
      const vacina = await product({ name: `Vacina ${suffix}`, cost: 42, tracksLots: true });
      await send(`/products/${luva.id}/stock`, {
        kind: 'entry',
        quantity: 200,
        notes: 'Estoque inicial',
      });
      await send(`/products/${vacina.id}/stock`, {
        kind: 'entry',
        quantity: 8,
        lot: { code: `L${suffix}`, expiresOn },
        notes: 'Estoque inicial',
      });
      return { group, luva, vacina };
    },
    { suffix, expiresOn: inDays(30) },
  );
}

test('lança saída por lote, recusa sem saldo e cancela devolvendo ao estoque', async ({ page }) => {
  const suffix = `s${run}`;
  const { luva, vacina } = await seed(page, suffix);

  await sidebar(page).getByRole('link', { name: 'Outras saídas' }).click();
  await expect(page.getByRole('heading', { name: 'Outras saídas', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Nova saída' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Motivo').selectOption('breakage');
  const first = dialog.getByRole('listitem', { name: 'Item 1' });
  await first.getByLabel('Produto').selectOption(vacina.id);
  await first.getByLabel('Lote').selectOption({ index: 1 });
  await first.getByLabel(/Quantidade/).fill('2');
  await dialog.getByRole('button', { name: 'Adicionar item' }).click();
  const second = dialog.getByRole('listitem', { name: 'Item 2' });
  await second.getByLabel('Produto').selectOption(luva.id);
  await second.getByLabel(/Quantidade/).fill('500');
  await dialog.getByRole('button', { name: 'Registrar saída' }).click();
  await expect(second).toContainText(`Só há 200 un de ${luva.name} em estoque`);
  await second.getByLabel(/Quantidade/).fill('20');
  await dialog.getByRole('button', { name: 'Registrar saída' }).click();
  await expect(toasts(page)).toContainText(/Saída \d+ registrada\./);

  // 2 × 42 + 20 × 0,60 = 96, guardado com o custo do momento.
  const row = page.getByRole('row').filter({ hasText: vacina.name });
  await expect(row).toContainText(/R\$\s96,00/);
  await row.getByRole('button').first().click();
  await expect(page.getByRole('dialog')).toContainText(`Lote L${suffix.toUpperCase()}`);
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar saída' }).click();
  await page.getByRole('dialog').getByLabel('Motivo do cancelamento').fill('Lançada errada');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar saída' }).click();
  await expect(toasts(page)).toContainText('Saída cancelada; o estoque voltou.');

  await page.goto(`/estoque/produtos/${luva.id}`);
  const movements = page.getByRole('list', { name: 'Movimentações de estoque' });
  await expect(movements).toContainText(/Saída cancelada · Saída \d+/);
  await expect(page.getByText('200 un').first()).toBeVisible();
});

test('inventário por grupo aplica a contagem e liga a movimentação', async ({ page }) => {
  const suffix = `i${run}`;
  const { group, luva, vacina } = await seed(page, suffix);

  await sidebar(page).getByRole('link', { name: 'Inventário' }).click();
  await page.getByRole('button', { name: 'Novo inventário' }).click();
  await page.getByRole('dialog').getByLabel('Produtos').selectOption(group.id);
  await page.getByRole('dialog').getByRole('button', { name: 'Abrir inventário' }).click();
  await expect(page).toHaveURL(/\/estoque\/inventario\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Em contagem', { exact: true }).first()).toBeVisible();

  await page.getByLabel(`Contado de ${luva.name}`).fill('190');
  await page.getByLabel(new RegExp(`^Contado de ${vacina.name}, lote`)).fill('8');
  await expect(page.getByText('2 de 2 contados · 1 diferença', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Aplicar ao estoque' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Aplicar' }).click();
  await expect(toasts(page)).toContainText('Inventário aplicado ao estoque.');
  await expect(page.getByText('Aplicado', { exact: true }).first()).toBeVisible();
  await page.getByText('Só diferenças', { exact: true }).click();
  const result = page.getByRole('table', { name: 'Resultado do inventário' });
  await expect(result.getByRole('row')).toHaveCount(2);
  await expect(result).toContainText(luva.name);

  await page.goto(`/estoque/produtos/${luva.id}`);
  await page
    .getByRole('link', { name: /^Inventário \d+$/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/estoque\/inventario\/[0-9a-f-]{36}$/);
});

test('saídas e inventário no celular sem rolagem lateral @mobile', async ({ page }) => {
  const suffix = `m${run}`;
  await seed(page, suffix);
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.goto('/estoque/saidas');
  await page.getByRole('button', { name: 'Nova saída' }).click();
  await expect(page.getByRole('listitem', { name: 'Item 1' })).toBeVisible();
  expect(await overflow()).toBe(0);
  await page.goto('/estoque/inventario');
  await expect(page.getByRole('heading', { name: 'Inventário', level: 1 })).toBeVisible();
  expect(await overflow()).toBe(0);
});
