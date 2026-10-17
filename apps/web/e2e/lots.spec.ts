import { expect, test, type Page } from '@playwright/test';
import type { Product, Session } from '@clinica/contracts';
import { ADMIN_STATE, run, sidebar, toasts } from './helpers';

test.use({ storageState: ADMIN_STATE });

/** Data daqui a `days` dias (AAAA-MM-DD) e o mesmo dia como a tela mostra. */
const inDays = (days: number) => {
  const iso = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  return { iso, br: iso.split('-').reverse().join('/') };
};

/** Produto com estoque controlado e 4 un de saldo, ainda sem lote, criado pela API. */
async function seedProduct(page: Page, name: string) {
  await page.goto('/');
  return page.evaluate(async (productName) => {
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
    const product = await send<Product>('/products', {
      kind: 'product',
      serviceKind: null,
      name: productName,
      unit: 'un',
      barcode: '',
      brandId: null,
      groupId: null,
      ncm: '',
      origin: '0',
      acquisition: 'resale',
      cfop: '',
      taxSituation: '',
      municipalServiceCode: '',
      taxProfile: '',
      salePrice: 90,
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
    });
    await send<unknown>(`/products/${product.id}/stock`, {
      kind: 'entry',
      quantity: 4,
      notes: 'Saldo inicial',
    });
    return product;
  }, name);
}

test('lote e validade: controle ligado no cadastro, entradas por lote, contagem e rastreio', async ({
  page,
}) => {
  // Sem o sufixo `run` no nome: outras specs buscam por ele e contam as linhas.
  const name = `Vacina V10 ${run.split('').reverse().join('')}`;
  const product = await seedProduct(page, name);
  const soon = inDays(12);
  const later = inDays(400);

  // Ligar o controle de lote leva o saldo atual para "SEM LOTE" [RN-32].
  await page.goto(`/estoque/produtos/${product.id}`);
  await page.getByRole('checkbox', { name: /Controla lote e validade/ }).click();
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(toasts(page).getByText('Alterações salvas.').last()).toBeVisible();
  const panel = page.getByRole('region', { name: /^Estoque · / });
  const lots = panel.getByRole('list', { name: 'Lotes em estoque' });
  await expect(lots.getByRole('listitem')).toHaveCount(1);
  await expect(lots).toContainText('SEM LOTE');
  await expect(lots).toContainText('Saldo anterior ao controle de lote');

  // Entrada exige lote e validade; o lote é gravado em maiúsculas.
  for (const [code, date, quantity] of [
    ['v10-b', later.iso, '6'],
    ['v10-a', soon.iso, '3'],
  ] as const) {
    await panel.getByRole('button', { name: 'Lançar entrada' }).click();
    const entry = page.getByRole('dialog', { name: 'Lançar entrada de estoque' });
    await entry.getByLabel('Quantidade (un)').fill(quantity);
    await entry.getByLabel('Origem').fill('NF 55');
    await entry.getByRole('button', { name: 'Lançar entrada' }).click();
    await expect(entry.getByText('Informe o lote')).toBeVisible();
    await entry.getByLabel('Lote').fill(code);
    await entry.getByLabel('Validade').fill(date);
    await entry.getByRole('button', { name: 'Lançar entrada' }).click();
    await expect(entry).toBeHidden();
  }
  await expect(panel).toContainText(/Em estoque\s*13 un/);
  await expect(panel).toContainText(new RegExp(`Validade mais antiga em estoque\\s*${soon.br}`));
  const rows = lots.getByRole('listitem');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('V10-A');
  await expect(rows.nth(0)).toContainText('Vence em breve');
  await expect(rows.nth(1)).toContainText('V10-B');
  await expect(rows.nth(2)).toContainText('SEM LOTE');
  const moves = panel.getByRole('list', { name: 'Movimentações de estoque' });
  await expect(moves.getByRole('listitem').first()).toContainText('lote V10-A +3');

  // A contagem é por lote: zerar o "SEM LOTE" tira só ele do estoque.
  await panel.getByRole('button', { name: 'Contagem' }).click();
  const count = page.getByRole('dialog', { name: 'Registrar contagem' });
  await count.getByLabel('Lote').selectOption({ label: 'SEM LOTE · sem validade · 4 un' });
  await count.getByLabel('Quantidade contada (un)').fill('0');
  await count.getByLabel('Observação').fill('Sem lote identificado, descartado');
  await count.getByRole('button', { name: 'Registrar contagem' }).click();
  await expect(count).toBeHidden();
  await expect(rows).toHaveCount(2);
  await expect(panel).toContainText(/Em estoque\s*9 un/);

  // Rastreio do lote: de onde veio cada unidade.
  await lots.getByRole('button', { name: 'Rastrear lote V10-B' }).click();
  const trace = page.getByRole('dialog', { name: 'Lote V10-B' });
  await expect(trace).toContainText(`Validade ${later.br} · saldo 6 un`);
  await expect(trace.getByRole('list', { name: 'Rastreio do lote' })).toContainText(
    'Entrada · NF 55',
  );
  await trace.getByRole('button', { name: 'Fechar' }).first().click();

  // A lista avisa a validade próxima.
  await sidebar(page).getByRole('link', { name: 'Produtos e serviços' }).click();
  await page.getByLabel('Buscar produtos e serviços').fill(name);
  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toContainText(`Vence ${soon.br}`);
  await expect(row).toContainText('9 un');
});
