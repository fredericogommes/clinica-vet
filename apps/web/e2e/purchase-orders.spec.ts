import type { CatalogItem, Product, Session } from '@clinica/contracts';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STATE, run, sidebar, toasts } from './helpers';

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

async function supplier(page: Page, name: string) {
  return page.evaluate(async (name) => {
    const session = (await (await fetch('/api/auth/session')).json()) as Session;
    const r = await fetch('/api/finance/suppliers', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken },
      body: JSON.stringify({
        name,
        document: '',
        phone: '(51) 99876-5432',
        email: 'pedidos@fornecedor.test',
        notes: '',
      }),
    });
    if (!r.ok) throw new Error(await r.text());
    return ((await r.json()) as { id: string }).id;
  }, name);
}

test('sugere a reposição, envia ao fornecedor e lança a compra quando chega', async ({ page }) => {
  const suffix = `p${run}`;
  const { luva } = await seed(page, suffix);
  const supplierId = await supplier(page, `Fornecedor ${suffix}`);

  await sidebar(page).getByRole('link', { name: 'Pedidos de compra' }).click();
  await page.getByRole('link', { name: 'Novo pedido' }).click();
  await page.getByLabel('Fornecedor', { exact: true }).selectOption(supplierId);
  await page.getByLabel('Entrega desejada').fill(inDays(3));
  await page.getByRole('button', { name: 'Sugerir o que repor' }).click();
  await expect(toasts(page)).toContainText(/sugeridos? incluídos?/);

  // A luva (200 em estoque, mínimo 250, sem consumo) pede o dobro do mínimo: 300.
  const index = await page
    .getByRole('listitem', { name: /^Item \d+$/ })
    .evaluateAll(
      (items, id) => items.findIndex((li) => li.querySelector('select')?.value === id),
      luva.id,
    );
  expect(index).toBeGreaterThanOrEqual(0);
  const line = page.getByRole('listitem', { name: `Item ${String(index + 1)}` });
  await expect(line.getByLabel(/Quantidade/)).toHaveValue('300');
  await expect(line.getByLabel('Custo unitário (R$)')).toHaveValue('0,60');
  await expect(line).toContainText('Saldo 200 un · mínimo 250');

  await page.getByRole('button', { name: 'Salvar e enviar' }).click();
  await expect(page).toHaveURL(/\/estoque\/pedidos\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Enviado', { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel('Texto do pedido')).toContainText(`- 300 un de ${luva.name}`);
  await expect(page.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute(
    'href',
    /^https:\/\/wa\.me\/5551998765432\?text=/,
  );

  await page.getByRole('button', { name: 'Mercadoria chegou: lançar compra' }).click();
  await expect(page).toHaveURL(/\/estoque\/compras\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Rascunho', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Observações' })).toHaveValue(
    /^Pedido de compra \d+$/,
  );
});

test('pedidos de compra no celular sem rolagem lateral @mobile', async ({ page }) => {
  await seed(page, `q${run}`);
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.goto('/estoque/pedidos/novo');
  await expect(page.getByRole('listitem', { name: 'Item 1' })).toBeVisible();
  expect(await overflow()).toBe(0);
  await page.goto('/estoque/pedidos?situacao=todos');
  await expect(page.getByRole('heading', { name: 'Pedidos de compra', level: 1 })).toBeVisible();
  expect(await overflow()).toBe(0);
});
