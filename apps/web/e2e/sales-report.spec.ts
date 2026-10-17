import type { Client, Product, Sale, Session } from '@clinica/contracts';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STATE, run, sidebar } from './helpers';

test.use({ storageState: ADMIN_STATE });

/**
 * Um produto e um cliente próprios deste teste, com duas vendas em aberto e um orçamento, via
 * API. Outros testes vendem no mesmo dia, então as conferências usam só o que é deste teste.
 */
async function seed(page: Page, prefix = '') {
  await page.goto('/');
  return page.evaluate(
    async (suffix) => {
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
      const tutor = `Tutor Relatório ${suffix}`;
      const client = await send<Client>('/clients', {
        personType: 'individual',
        name: tutor,
        nationality: '',
        sex: null,
        cpf: '',
        cnpj: '',
        rg: '',
        birthDate: '',
        originId: null,
        profession: '',
        municipalRegistration: '',
        notes: '',
        contacts: [],
        address: {
          cep: '',
          street: '',
          number: '',
          complement: '',
          district: '',
          city: '',
          state: '',
        },
      });
      const product = await send<Product>('/products', {
        kind: 'product',
        serviceKind: null,
        name: `Shampoo relatório ${suffix}`,
        unit: 'fr',
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
        salePrice: 35,
        cost: null,
        purpose: 'sale',
        desiredMarkup: null,
        allowPriceChange: false,
        showInPriceList: true,
        discountLimitPercent: null,
        defaultCommissionPercent: 0,
        commissions: [],
        tracksStock: false,
        minStock: null,
        idealStock: null,
      });
      const sale = (kind: 'sale' | 'quote', quantity: number) =>
        send<Sale>('/sales', {
          kind,
          saleType: 'in_person_consumer',
          clientId: client.id,
          patientId: null,
          items: [
            { productId: product.id, professionalId: session.user.id, quantity, unitPrice: null },
          ],
          discount: { mode: 'amount', value: 0 },
          notes: '',
        });
      const sales = [await sale('sale', 2), await sale('sale', 1), await sale('quote', 5)];
      return {
        tutor,
        product: product.name,
        codes: sales.map((s) => s.code),
        me: session.user.name,
      };
      // Sem o sufixo `run` literal: outras specs buscam por ele e contam as linhas.
    },
    prefix + run.split('').reverse().join(''),
  );
}

test('consulta vendas: resumo, totais por item, lista e Minhas vendas', async ({ page }) => {
  const { tutor, product, codes, me } = await seed(page);

  await sidebar(page).getByRole('link', { name: 'Consulta vendas' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Consulta vendas');
  await page.getByRole('button', { name: 'Hoje' }).click();
  const tabs = page.getByRole('tablist', { name: 'Consulta vendas' });
  await expect(tabs.getByRole('tab', { name: 'Resumo' })).toHaveAttribute('aria-selected', 'true');

  // Resumo: cartões e quebras do período [p.9].
  const totals = page.locator('dl[aria-label="Totais do período"]');
  await expect(totals).toContainText('Venda líquida');
  await expect(totals).toContainText('Em aberto (cliente)');
  await expect(page.getByRole('table', { name: 'Vendas por data' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Por profissional' })).toContainText(me);

  // Totais por item: o orçamento não conta.
  await tabs.getByRole('tab', { name: 'Por produto/serviço' }).click();
  await expect(page).toHaveURL(/aba=itens/);
  const row = page.getByRole('row').filter({ hasText: product });
  await expect(row).toContainText('3 fr');
  await expect(row).toContainText(/R\$\s105,00/);
  await page.getByRole('group', { name: 'Tipo' }).getByRole('button', { name: 'Serviços' }).click();
  await expect(page.getByRole('row').filter({ hasText: product })).toHaveCount(0);

  // Lista: o orçamento aparece com a situação.
  await tabs.getByRole('tab', { name: 'Lista de vendas' }).click();
  await page.getByLabel('Buscar vendas').fill(tutor);
  // A busca vai para o link depois da digitação; só então a lista é só deste teste.
  await expect(page).toHaveURL(/[?&]q=/);
  const list = page.getByRole('table', { name: 'Lista de vendas' });
  await expect(list.getByRole('row')).toHaveCount(4);
  await page
    .getByRole('group', { name: 'Situação' })
    .getByRole('button', { name: 'Orçamento' })
    .click();
  await expect(page).toHaveURL(/situacao=quote/);
  await expect(list.getByRole('row')).toHaveCount(2);
  await expect(list).toContainText(String(codes[2]));

  // O link copiado reabre a mesma consulta.
  await page.reload();
  await expect(page.getByLabel('Buscar vendas')).toHaveValue(tutor);
  await expect(list.getByRole('row')).toHaveCount(2);

  // Minhas vendas: os itens do próprio profissional.
  await sidebar(page).getByRole('link', { name: 'Minhas vendas' }).click();
  await page.getByRole('button', { name: 'Hoje' }).click();
  const mine = page.getByRole('table', { name: 'Meus itens vendidos' });
  await expect(mine.getByRole('row').filter({ hasText: product })).toHaveCount(2);
  await expect(mine.getByRole('row').filter({ hasText: product }).first()).toContainText(tutor);
});

test('ranking de clientes: curva ABC e a classe na ficha do cliente', async ({ page }) => {
  const { tutor } = await seed(page, 'abc');
  await sidebar(page).getByRole('link', { name: 'Ranking de clientes' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ranking de clientes');
  await expect(page.getByRole('button', { name: 'Últimos 12 meses' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const stats = page.locator('dl[aria-label^="Curva ABC de "]');
  await expect(stats).toContainText('Classe A');
  const row = page.getByRole('row').filter({ hasText: tutor });
  // Duas vendas em aberto (2 + 1 frascos de 35); o orçamento não entra.
  await expect(row).toContainText('R$ 105,00');
  await expect(row).toContainText('2 vendas');
  const abc = (await row.getByRole('cell').last().innerText()).trim();
  expect(['A', 'B', 'C']).toContain(abc);

  await row.getByRole('link', { name: tutor }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tutor);
  await expect(page.getByText(`Classe ${abc}`, { exact: true })).toBeVisible();

  await page.goBack();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ranking de clientes');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
});
