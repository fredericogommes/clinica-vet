import { expect, test, type Page } from '@playwright/test';
import type { CatalogItem, Product, Session } from '@clinica/contracts';
import { ADMIN_STATE, run, sidebar, toasts } from './helpers';

test.use({ storageState: ADMIN_STATE });

/** Dois produtos com estoque controlado, um em cada grupo, criados pela API. */
async function seedProducts(page: Page, groups: { blocking: string; free: string }) {
  return page.evaluate(
    async ({ suffix, blocking, free }) => {
      const session = (await (await fetch('/api/auth/session')).json()) as Session;
      const all = (await (await fetch('/api/catalogs/product-groups')).json()) as CatalogItem[];
      const groupId = (name: string) => all.find((g) => g.name === name)?.id ?? null;
      const create = async (o: Record<string, unknown>) => {
        const r = await fetch('/api/products', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken },
          body: JSON.stringify({
            kind: 'product',
            serviceKind: null,
            unit: 'un',
            barcode: '',
            brandId: null,
            ncm: '',
            origin: '0',
            acquisition: 'resale',
            cfop: '',
            taxSituation: '',
            municipalServiceCode: '',
            taxProfile: '',
            salePrice: 20,
            cost: null,
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
            ...o,
          }),
        });
        if (!r.ok) throw new Error(await r.text());
        return (await r.json()) as Product;
      };
      const dipirona = await create({
        name: `Dipirona gotas ${suffix}`,
        unit: 'fr',
        groupId: groupId(blocking),
        minStock: 5,
      });
      const luva = await create({ name: `Luva ${suffix}`, groupId: groupId(free) });
      return { dipirona, luva };
    },
    { suffix: run, ...groups },
  );
}

test('estoque: grupo que bloqueia, entrada, reserva no PDV e contagem', async ({ page }) => {
  const blocking = `Controlados ${run}`;
  const free = `Consumo ${run}`;

  // Grupo novo bloqueia venda sem saldo; o de material de consumo libera [RN-31].
  await page.goto('/estoque/grupos');
  for (const [name, blocks] of [
    [blocking, true],
    [free, false],
  ] as const) {
    await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Novo grupo' });
    await dialog.getByLabel('Nome').fill(name);
    const rule = dialog.getByRole('checkbox', { name: /Bloquear venda sem saldo/ });
    await expect(rule).toBeChecked();
    if (!blocks) await rule.click();
    await dialog.getByRole('button', { name: 'Salvar' }).click();
    await expect(toasts(page).getByText('Cadastro incluído.').last()).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: name })).toContainText(
      blocks ? 'Bloqueia sem saldo' : 'Vende sem saldo',
    );
  }
  const { dipirona, luva } = await seedProducts(page, { blocking, free });

  // Entrada avulsa pela ficha do produto.
  await page.goto(`/estoque/produtos/${dipirona.id}`);
  const panel = page.getByRole('region', { name: /^Estoque · / });
  await expect(panel).toContainText(/Em estoque\s*0 fr/);
  await panel.getByRole('button', { name: 'Lançar entrada' }).click();
  const entry = page.getByRole('dialog', { name: 'Lançar entrada de estoque' });
  await entry.getByLabel('Quantidade (fr)').fill('3');
  await entry.getByLabel('Origem').fill('NF 10');
  await entry.getByRole('button', { name: 'Lançar entrada' }).click();
  await expect(toasts(page).getByText('Entrada lançada. Saldo: 3 fr.')).toBeVisible();
  const moves = panel.getByRole('list', { name: 'Movimentações de estoque' });
  await expect(moves.getByRole('listitem').first()).toContainText('Entrada · NF 10');
  await expect(moves.getByRole('listitem').first()).toContainText('+3');

  // No PDV, o disponível aparece na busca e a venda acima dele é recusada.
  await sidebar(page).getByRole('link', { name: 'Ponto de venda' }).click();
  const add = page.getByLabel('Adicionar item');
  await add.fill(dipirona.name);
  await expect(page.getByRole('list', { name: 'Itens encontrados' })).toContainText(
    '3 fr disponível',
  );
  await add.press('Enter');
  const quantity = page.getByLabel(`Quantidade de ${dipirona.name}`);
  await quantity.fill('4');
  await expect(
    page.getByText('Só 3 fr disponível, e o grupo do item bloqueia venda sem saldo.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Salvar em aberto' }).click();
  await expect(page.getByText(`Só há 3 fr de ${dipirona.name} disponível`)).toBeVisible();
  await quantity.fill('3');
  await expect(page.getByText('Estoque: 3 fr disponível.')).toBeVisible();
  await add.fill(luva.name);
  await expect(page.getByRole('list', { name: 'Itens encontrados' })).toContainText('sem estoque');
  await add.press('Enter');
  await expect(
    page.getByText(
      'Sem estoque disponível. A venda segue e a falta fica como pendência no estoque.',
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Salvar em aberto' }).click();
  await expect(toasts(page).getByText(/Venda \d+ gravada/)).toBeVisible();

  // A venda em aberto reserva; a contagem corrige o saldo.
  await page.goto(`/estoque/produtos/${dipirona.id}`);
  await expect(panel).toContainText(/Reservado em vendas em aberto\s*3 fr/);
  await expect(panel).toContainText(/Disponível para venda\s*0 fr/);
  await panel.getByRole('button', { name: 'Contagem' }).click();
  const count = page.getByRole('dialog', { name: 'Registrar contagem' });
  await count.getByLabel('Quantidade contada (fr)').fill('2');
  await count.getByLabel('Observação').fill('Frasco quebrado');
  await count.getByRole('button', { name: 'Registrar contagem' }).click();
  await expect(toasts(page).getByText('Contagem registrada. Saldo: 2 fr.')).toBeVisible();
  await expect(moves.getByRole('listitem').first()).toContainText('Contagem · Frasco quebrado');
  await expect(moves.getByRole('listitem').first()).toContainText('− 1');

  // A lista mostra o saldo e o alerta de mínimo.
  await sidebar(page).getByRole('link', { name: 'Produtos e serviços' }).click();
  await page.getByLabel('Buscar produtos e serviços').fill(dipirona.name);
  const row = page.getByRole('row').filter({ hasText: dipirona.name });
  await expect(row).toContainText('Abaixo do mínimo');
  await expect(row).toContainText('2 fr');
});
