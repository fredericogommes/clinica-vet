import type { CatalogItem, Product, Session } from '@clinica/contracts';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STATE, run, sidebar } from './helpers';

test.use({ storageState: ADMIN_STATE });

const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Grupo próprio com luva (200 un, custo 0,60, mínimo 250) e vacina com lote (8 un, custo 42), via API. */
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
      const luva = await product({ name: `Luva ${suffix}`, cost: 0.6, minStock: 250 });
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

test('análise mostra o produto abaixo do mínimo em Repor e a ficha repete a situação', async ({
  page,
}) => {
  const suffix = `a${run}`;
  const { luva, vacina } = await seed(page, suffix);
  // Mínimo acima do saldo: a luva vai para Repor; a vacina, recém-chegada, fica em Novos.
  await sidebar(page).getByRole('link', { name: 'Análise de estoque' }).click();
  await expect(page.getByRole('heading', { name: 'Análise de estoque', level: 1 })).toBeVisible();
  await page.getByLabel('Buscar produto').fill(suffix);
  const situations = page.getByRole('group', { name: 'Situações do estoque' });
  await expect(situations.getByRole('button', { name: /^Total/ })).toContainText('2 produtos');
  await expect(situations.getByRole('button', { name: /^Repor/ })).toContainText('1 produto');
  await situations.getByRole('button', { name: /^Repor/ }).click();
  const table = page.getByRole('table', { name: 'Análise de estoque' });
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(table).toContainText(luva.name);
  await expect(table).toContainText('mín. 250');
  await situations.getByRole('button', { name: /^Novos/ }).click();
  await expect(table).toContainText(vacina.name);

  await table.getByRole('link', { name: vacina.name }).click();
  await expect(page.getByText('Duração estimada')).toBeVisible();
  await expect(page.getByText('Novos', { exact: true }).first()).toBeVisible();
});

test('análise de estoque no celular sem rolagem lateral @mobile', async ({ page }) => {
  await seed(page, `n${run}`);
  await page.goto('/estoque/analise');
  await expect(page.getByRole('table', { name: 'Análise de estoque' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(
    0,
  );
});
