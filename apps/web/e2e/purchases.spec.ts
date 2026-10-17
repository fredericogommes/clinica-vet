import type { Product, Session } from '@clinica/contracts';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STATE, run, sidebar, toasts } from './helpers';

test.use({ storageState: ADMIN_STATE });

const digits = (n: number) =>
  Array.from({ length: n }, () => String(Math.floor(Math.random() * 10))).join('');

/** EAN-13 com dígito verificador, único por teste: o código de barras não se repete. */
function ean13() {
  const base = `789${digits(9)}`;
  let sum = 0;
  for (let i = 0; i < base.length; i += 1) sum += Number(base.charAt(i)) * (i % 2 ? 3 : 1);
  return base + String((10 - (sum % 10)) % 10);
}

const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Vacina com lote reconhecida pelo código de barras e ração em saco, via API. */
async function seedProducts(page: Page, suffix: string, barcode: string) {
  await page.goto('/');
  return page.evaluate(
    async ({ suffix, barcode }) => {
      const session = (await (await fetch('/api/auth/session')).json()) as Session;
      const create = async (body: Record<string, unknown>) => {
        const r = await fetch('/api/products', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken },
          body: JSON.stringify({
            kind: 'product',
            serviceKind: null,
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
            defaultCommissionPercent: 0,
            commissions: [],
            tracksStock: true,
            minStock: null,
            idealStock: null,
            ...body,
          }),
        });
        if (!r.ok) throw new Error(await r.text());
        return (await r.json()) as Product;
      };
      const vacina = await create({
        name: `Vacina V10 ${suffix}`,
        unit: 'un',
        barcode,
        tracksLots: true,
        salePrice: 95,
      });
      const racao = await create({ name: `Ração ${suffix}`, unit: 'kg', salePrice: 32 });
      return { vacina, racao };
    },
    { suffix, barcode },
  );
}

function nfe(suffix: string, barcode: string) {
  const key = `35261045338051000166550010${digits(18)}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${key}" versao="4.00">
<ide><nNF>${digits(6)}</nNF><serie>1</serie><dhEmi>${inDays(-1)}T10:00:00-03:00</dhEmi></ide>
<emit><CNPJ>45338051000166</CNPJ><xNome>Distribuidora E2E Ltda</xNome></emit>
<det nItem="1"><prod><cProd>VAC-${suffix}</cProd><cEAN>${barcode}</cEAN><xProd>VACINA V10 DOSE</xProd><uCom>UN</uCom><qCom>10.0000</qCom><vProd>400.00</vProd>
<rastro><nLote>A${suffix}</nLote><qLote>6</qLote><dVal>${inDays(300)}</dVal></rastro>
<rastro><nLote>B${suffix}</nLote><qLote>4</qLote><dVal>${inDays(500)}</dVal></rastro></prod></det>
<det nItem="2"><prod><cProd>RAC-${suffix}</cProd><cEAN>SEM GTIN</cEAN><xProd>RACAO PREMIUM 15KG</xProd><uCom>SC</uCom><qCom>2.0000</qCom><vProd>300.00</vProd></prod></det>
<total><ICMSTot><vProd>700.00</vProd><vFrete>30.00</vFrete><vDesc>15.00</vDesc><vNF>715.00</vNF></ICMSTot></total>
<cobr><dup><nDup>001</nDup><dVenc>${inDays(28)}</dVenc><vDup>357.50</vDup></dup><dup><nDup>002</nDup><dVenc>${inDays(56)}</dVenc><vDup>357.50</vDup></dup></cobr>
</infNFe></NFe></nfeProc>`;
}

async function importXml(page: Page, xml: string) {
  await page.goto('/estoque/compras');
  await page.getByRole('button', { name: 'Importar XML' }).click();
  await page.getByLabel('Arquivo XML').setInputFiles({
    name: 'nfe.xml',
    mimeType: 'text/xml',
    buffer: Buffer.from(xml),
  });
  await page.getByRole('dialog').getByRole('button', { name: 'Importar' }).click();
  await expect(page).toHaveURL(/\/estoque\/compras\/[0-9a-f-]{36}$/);
}

test('importa a NF-e, casa os itens, confirma e cancela a compra', async ({ page }) => {
  const suffix = `c${run}`;
  const barcode = ean13();
  const { vacina, racao } = await seedProducts(page, suffix, barcode);

  await page.goto('/');
  await sidebar(page).getByRole('link', { name: 'Compras' }).click();
  await expect(page.getByRole('heading', { name: 'Compras', level: 1 })).toBeVisible();
  await importXml(page, nfe(suffix, barcode));
  await expect(page.getByText('Rascunho', { exact: true }).first()).toBeVisible();

  // A vacina veio casada pelo código de barras, já com os dois lotes; a ração, não.
  const items = page.getByRole('listitem', { name: /^Item \d$/ });
  await expect(items).toHaveCount(3);
  await expect(items.nth(0).getByLabel('Lote')).toHaveValue(`A${suffix}`.toUpperCase());
  await expect(items.nth(1).getByLabel('Lote')).toHaveValue(`B${suffix}`.toUpperCase());
  await expect(page.getByLabel('Totais da compra')).toContainText(/Total da compraR\$\s715,00/);

  await page.getByRole('button', { name: 'Confirmar compra' }).click();
  await expect(items.nth(2).getByText('Escolha o produto de "RACAO PREMIUM 15KG"')).toBeVisible();
  await items.nth(2).getByLabel('Produto da clínica').selectOption(racao.id);
  await items.nth(2).getByLabel('Fator').fill('15');
  await expect(items.nth(2)).toContainText('Entra no estoque: 30 kg.');
  await page.getByRole('button', { name: 'Confirmar compra' }).click();
  await expect(toasts(page)).toContainText('Compra confirmada');
  await expect(page.getByText('Confirmada', { exact: true }).first()).toBeVisible();
  const payables = page.getByRole('table', { name: 'Parcelas lançadas no financeiro' });
  await expect(payables.getByRole('row')).toHaveCount(3);

  // O estoque recebeu por lote e a movimentação aponta para a compra.
  const purchaseUrl = page.url();
  await page.getByRole('link', { name: vacina.name }).first().click();
  await expect(page.getByRole('list', { name: 'Movimentações de estoque' })).toContainText(
    /Compra · Compra \d+/,
  );

  await page.goto(purchaseUrl);
  await page.getByRole('button', { name: 'Cancelar compra' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Motivo').fill('Nota lançada em teste');
  await dialog.getByRole('button', { name: 'Cancelar compra' }).click();
  await expect(toasts(page)).toContainText('Compra cancelada.');
  await expect(page.getByText('Cancelada', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Nota lançada em teste')).toBeVisible();
});

test('compras no celular sem rolagem lateral @mobile', async ({ page }) => {
  const suffix = `m${run}`;
  const barcode = ean13();
  await seedProducts(page, suffix, barcode);
  await importXml(page, nfe(suffix, barcode));
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await expect(page.getByRole('listitem', { name: 'Item 3' })).toBeVisible();
  expect(await overflow()).toBe(0);
  await page.goto('/estoque/compras');
  await expect(page.getByRole('table', { name: 'Compras' })).toBeVisible();
  expect(await overflow()).toBe(0);
});
