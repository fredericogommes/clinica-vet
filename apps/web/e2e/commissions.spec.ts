import type { Product, Session } from '@clinica/contracts';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STATE, run, sidebar, toasts } from './helpers';

test.use({ storageState: ADMIN_STATE });

// Derivado de `run` para que a busca por `run` de outras telas (ex. produtos) não ache estes cadastros.
const tag = (Number.parseInt(run, 36) * 7).toString(36);

/**
 * Profissional comissionado com duas vendas de balcão, via API: consulta R$ 150 com 10% e duas
 * ampolas de R$ 40 com 5%, menos R$ 23 de desconto. Base líquida: 135 × 10% + 72 × 5% = 17,10.
 */
async function seed(page: Page, suffix: string) {
  await page.goto('/');
  return page.evaluate(async (suffix) => {
    const session = (await (await fetch('/api/auth/session')).json()) as Session;
    const call = async <T>(method: string, path: string, body?: unknown) => {
      const r = await fetch(`/api${path}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken },
        body: body === undefined ? null : JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text());
      return (await r.json()) as T;
    };
    await call('PUT', '/commissions/settings', {
      base: 'net',
      criterion: 'sold',
      financeIntegration: true,
      staffCanSeeOwn: true,
    });
    const roles = await call<{ id: string; name: string }[]>('GET', '/admin/roles');
    const vet = await call<{ id: string; name: string }>('POST', '/admin/users', {
      name: `Dra. Comissão ${suffix}`,
      email: `comissao-${suffix}@clinica.local`,
      password: 'senha-local-123',
      roleId: roles.find((r) => r.name === 'Veterinário')?.id,
      unitIds: [session.currentUnit.id],
    });
    await call('PUT', `/commissions/staff/${vet.id}`, { commissioned: true });
    const product = (body: Record<string, unknown>) =>
      call<Product>('POST', '/products', {
        kind: 'product',
        serviceKind: null,
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
        cost: null,
        purpose: 'sale',
        desiredMarkup: null,
        allowPriceChange: false,
        showInPriceList: true,
        discountLimitPercent: null,
        commissions: [],
        tracksStock: false,
        minStock: null,
        idealStock: null,
        ...body,
      });
    const consulta = await product({
      kind: 'service',
      serviceKind: 'consultation',
      name: `Consulta ${suffix}`,
      salePrice: 150,
      defaultCommissionPercent: 10,
    });
    const ampola = await product({
      name: `Ampola ${suffix}`,
      salePrice: 40,
      defaultCommissionPercent: 5,
    });
    const sale = (items: { productId: string; quantity: number }[], discount: number) =>
      call('POST', '/sales', {
        kind: 'sale',
        saleType: 'in_person_consumer',
        clientId: null,
        patientId: null,
        items: items.map((i) => ({ ...i, professionalId: vet.id, unitPrice: null })),
        discount: { mode: 'amount', value: discount },
        notes: '',
      });
    await sale([{ productId: consulta.id, quantity: 1 }], 15);
    await sale([{ productId: ampola.id, quantity: 2 }], 8);
    return vet;
  }, suffix);
}

test('comissões: gera o extrato, fecha em contas a pagar e paga pelo financeiro', async ({
  page,
}) => {
  const vet = await seed(page, `c${tag}`);
  await sidebar(page).getByRole('link', { name: 'Comissões em aberto' }).click();
  await expect(page.getByRole('heading', { name: 'Comissões em aberto', level: 1 })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: vet.name });
  await expect(row).toContainText('2 vendas · base R$ 207,00');
  await expect(row).toContainText('R$ 17,10');

  await row.getByRole('button', { name: `Gerar extrato de ${vet.name}` }).click();
  await expect(page).toHaveURL(/\/comissoes\/extratos\/[0-9a-f-]{36}$/);
  await expect(toasts(page)).toContainText('gerado');
  await expect(page.getByText('Não fechado', { exact: true })).toBeVisible();
  const lines = page.getByRole('table', { name: 'Vendas do extrato' });
  await expect(lines.getByRole('row')).toHaveCount(3);
  await expect(lines).toContainText(`Consulta c${tag} (10%)`);
  await expect(lines).toContainText('R$ 13,50');
  await expect(lines).toContainText('R$ 3,60');

  await page.getByRole('button', { name: 'Fechar extrato' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('R$ 17,10 vira uma despesa em contas a pagar');
  await dialog.getByRole('button', { name: 'Fechar extrato' }).click();
  await expect(toasts(page)).toContainText('lançado em contas a pagar');
  await expect(page.getByText('Fechado', { exact: true })).toBeVisible();
  await expect(page.getByText(/Está em contas a pagar/)).toBeVisible();
  // Com integração, o pagamento é feito no financeiro.
  await expect(page.getByRole('button', { name: 'Marcar como pago' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Abrir contas a pagar' }).click();
  await expect(page.getByRole('heading', { name: 'Contas a pagar', level: 1 })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Buscar lançamento' }).fill(vet.name);
  await page
    .getByRole('button', { name: new RegExp(`^Comissão de ${vet.name} - extrato`) })
    .click();
  const entry = page.getByRole('dialog', { name: /^Comissão de/ });
  await expect(entry).toContainText('Lançado pelo extrato de comissão');
  await expect(entry.getByRole('link', { name: /^Extrato \d+$/ })).toBeVisible();
  await entry.getByRole('button', { name: 'Registrar pagamento' }).click();
  const pay = page.getByRole('dialog', { name: 'Registrar pagamento' });
  await expect(pay.getByLabel('Valor pago')).toHaveValue('17,10');
  await pay.getByRole('button', { name: 'Confirmar pagamento' }).click();
  await expect(pay).toBeHidden();

  await page.goto('/comissoes/extratos?situacao=pagos');
  const paid = page.getByRole('row').filter({ hasText: vet.name });
  await expect(paid).toContainText('Pago');
  await expect(paid).toContainText('R$ 17,10');
  await paid.getByRole('link').first().click();
  await page.getByRole('button', { name: 'Arquivar' }).click();
  await expect(page.getByText('Arquivado', { exact: true })).toBeVisible();
});

test('configuração de comissões liga e desliga quem recebe', async ({ page }) => {
  const vet = await seed(page, `k${tag}`);
  await page.goto('/comissoes/configuracao');
  await expect(
    page.getByRole('heading', { name: 'Configuração de comissões', level: 1 }),
  ).toBeVisible();
  await expect(page.getByLabel('Base de cálculo')).toHaveValue('net');
  const person = page.getByRole('checkbox', { name: new RegExp(vet.name) });
  await expect(person).toBeChecked();
  await person.click();
  await expect(toasts(page)).toContainText(`${vet.name} deixa de receber comissão`);
  await page.goto('/comissoes');
  const row = page.getByRole('row').filter({ hasText: vet.name });
  await expect(row).toHaveCount(0);
  await page.getByRole('button', { name: /^Mostrar quem não recebe comissão/ }).click();
  await expect(row).toContainText('Não recebe comissão');
});

test('comissões no celular sem rolagem lateral @mobile', async ({ page }) => {
  await seed(page, `m${tag}`);
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  for (const path of [
    '/comissoes',
    '/comissoes/extratos?situacao=todos',
    '/comissoes/configuracao',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await overflow(), path).toBe(0);
  }
});
