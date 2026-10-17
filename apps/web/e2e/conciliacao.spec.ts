import type { FinancialAccount, PaymentMethod, Product, Sale, Session } from '@clinica/contracts';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STATE, run, sidebar, toasts } from './helpers';

test.use({ storageState: ADMIN_STATE });

const tag = run.split('').reverse().join('');

/**
 * Conta, serviço de R$ 150 e vendas recebidas na forma `methodName`, via API. Abre o caixa do
 * administrador se outro teste o deixou fechado.
 */
async function seedSales(page: Page, methodName: string, sales: number) {
  await page.goto('/');
  return page.evaluate(
    async ({ methodName, sales, suffix }) => {
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
      const methods = (await (await fetch('/api/payment-methods')).json()) as PaymentMethod[];
      const method = methods.find((m) => m.name === methodName);
      if (!method) throw new Error(`Forma ${methodName} não encontrada`);
      const product = await send<Product>('/products', {
        kind: 'service',
        serviceKind: 'other',
        name: `Banho conciliação ${suffix}`,
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
        salePrice: 150,
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
      for (let i = 0; i < sales; i++) {
        const sale = await send<Sale>('/sales', {
          kind: 'sale',
          saleType: 'in_person_consumer',
          clientId: null,
          patientId: null,
          items: [
            {
              productId: product.id,
              professionalId: session.user.id,
              quantity: 1,
              unitPrice: null,
            },
          ],
          discount: { mode: 'amount', value: 0 },
          notes: '',
        });
        const receive = () =>
          send(`/sales/${sale.id}/receive`, {
            payments: [{ methodId: method.id, amount: sale.netTotal, installments: 1 }],
          });
        try {
          await receive();
        } catch {
          await send('/cash', { openingAmount: 0 }).catch(() => undefined);
          await receive();
        }
      }
    },
    { methodName, sales, suffix: tag },
  );
}

async function createAccount(page: Page, name: string) {
  await page.goto('/');
  await page.evaluate(async (name) => {
    const session = (await (await fetch('/api/auth/session')).json()) as Session;
    const options = (await (await fetch('/api/finance/options')).json()) as { today: string };
    const r = await fetch('/api/finance/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken },
      body: JSON.stringify({ name, kind: 'bank', openingBalance: 0, openingDate: options.today }),
    });
    if (!r.ok) throw new Error(await r.text());
    return (await r.json()) as FinancialAccount;
  }, name);
}

async function createDebitMethod(page: Page, name: string, account: string) {
  await page.goto('/vendas/formas-de-recebimento');
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Nova forma de recebimento' });
  await form.getByLabel('Nome').fill(name);
  await form.getByLabel('Tipo', { exact: true }).selectOption({ label: 'Cartão de débito' });
  await form.getByLabel('Adquirente', { exact: true }).fill('Stone');
  await form.getByLabel('Bandeira').fill('Elo');
  await form.getByLabel('Prazo de liquidação (dias)').fill('0');
  await form.getByLabel('Taxa da adquirente (%)').fill('2');
  await form.getByRole('combobox', { name: 'Conta de destino' }).selectOption({ label: account });
  await form.getByRole('button', { name: 'Salvar' }).click();
  await expect(form).toBeHidden();
  await expect(page.getByRole('listitem').filter({ hasText: name })).toContainText(
    `cai em ${account}`,
  );
}

test('concilia o depósito do débito com a diferença e desfaz', async ({ page }) => {
  const account = `Conta Stone ${tag}`;
  const method = `Stone Débito ${tag}`;
  await createAccount(page, account);
  await createDebitMethod(page, method, account);
  await seedSales(page, method, 2);

  await sidebar(page).getByRole('link', { name: 'Conciliação de cartões' }).click();
  await page
    .getByRole('combobox', { name: 'Forma de recebimento' })
    .selectOption({ label: method });
  await expect(page).toHaveURL(/forma=/);
  const row = page.getByRole('row').filter({ hasText: method });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(`${account} · 2 parcelas`);
  await expect(row).toContainText(/R\$\s300,00.*R\$\s6,00.*R\$\s294,00.*Não conciliado/);

  await row.getByRole('button', { name: /^Conciliar/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Conciliar depósito' });
  await expect(dialog.getByLabel('Valor que caiu')).toHaveValue('294,00');
  await dialog.getByLabel('Valor que caiu').fill('293,50');
  await expect(dialog).toContainText(
    /Diferença de -R\$\s0,50: entra como despesa em Taxas de cartão/,
  );
  await dialog.getByRole('button', { name: 'Conciliar' }).click();
  await expect(dialog).toBeHidden();
  await expect(toasts(page).getByText('Depósito conciliado.')).toBeVisible();
  await expect(page.getByText('Nenhum depósito')).toBeVisible();

  await page
    .getByRole('group', { name: 'Situação' })
    .getByText('Conciliados', { exact: true })
    .click();
  await expect(row).toContainText(/R\$\s293,50.*-R\$\s0,50.*Conciliado/);

  await page.goto('/financeiro/contas');
  await expect(page.getByRole('listitem').filter({ hasText: account })).toContainText(
    /R\$\s293,50/,
  );

  await page.goBack();
  await row.getByRole('button', { name: /^Desfazer conciliação/ }).click();
  const undo = page.getByRole('dialog', { name: 'Desfazer conciliação' });
  await undo.getByRole('button', { name: 'Desfazer conciliação' }).click();
  await expect(undo).toBeHidden();
  await expect(toasts(page).getByText('Conciliação desfeita.')).toBeVisible();
  await page.getByRole('group', { name: 'Situação' }).getByText('Não conciliados').click();
  await expect(row).toContainText(/R\$\s294,00.*Não conciliado/);
});

test('conciliação no celular sem rolagem lateral @mobile', async ({ page }) => {
  const account = `Conta Cielo ${tag}`;
  const method = `Cielo Débito ${tag}`;
  await createAccount(page, account);
  await createDebitMethod(page, method, account);
  await seedSales(page, method, 1);

  await page.goto('/financeiro/conciliacao');
  await page
    .getByRole('combobox', { name: 'Forma de recebimento' })
    .selectOption({ label: method });
  await page.getByRole('button', { name: new RegExp(`^Conciliar ${method}`) }).click();
  const dialog = page.getByRole('dialog', { name: 'Conciliar depósito' });
  await expect(dialog.getByLabel('Valor que caiu')).toHaveValue('147,00');
  await dialog.getByRole('button', { name: 'Conciliar' }).click();
  await expect(dialog).toBeHidden();
  await page
    .getByRole('group', { name: 'Situação' })
    .getByText('Conciliados', { exact: true })
    .click();
  await expect(page.getByRole('row').filter({ hasText: method })).toContainText('Sem diferença');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBe(0);
});
