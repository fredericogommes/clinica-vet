import { expect, test } from '@playwright/test';
import { ADMIN_STATE, run, sidebar, toasts } from './helpers';

test.use({ storageState: ADMIN_STATE });

// Prefixo próprio: outros testes usam o mesmo sufixo invertido e a busca por ele os encontraria.
const tag = `fin${run.split('').reverse().join('')}`;

/** Dia `days` a partir de hoje no fuso da unidade (o do navegador nos testes), em AAAA-MM-DD. */
function day(days: number) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const br = (iso: string) => iso.split('-').reverse().join('/');

test('lança despesa parcelada com fornecedor, paga a vencida e cancela as seguintes', async ({
  page,
}) => {
  const supplier = `Imobiliária ${tag}`;
  const rent = `Aluguel ${tag}`;
  await page.goto('/');
  await sidebar(page).getByRole('link', { name: 'Fornecedores' }).click();
  await page.getByRole('button', { name: 'Adicionar' }).click();
  const supplierDialog = page.getByRole('dialog', { name: 'Novo fornecedor' });
  await supplierDialog.getByLabel('Nome ou razão social').fill(supplier);
  await supplierDialog.getByLabel('CPF ou CNPJ').fill('123');
  await supplierDialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(supplierDialog.getByText('CPF ou CNPJ inválido')).toBeVisible();
  await supplierDialog.getByLabel('CPF ou CNPJ').fill('');
  await supplierDialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(supplierDialog).toBeHidden();
  await expect(page.getByText(supplier)).toBeVisible();

  await sidebar(page).getByRole('link', { name: 'Contas a pagar' }).click();
  await expect(sidebar(page).getByRole('link', { name: 'Contas a pagar' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(sidebar(page).getByRole('link', { name: 'Lançamentos' })).not.toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.getByRole('button', { name: 'Nova despesa' }).click();
  const form = page.getByRole('dialog', { name: 'Nova despesa' });
  await form.getByRole('button', { name: 'Salvar' }).click();
  await expect(form.getByText('Descreva o lançamento')).toBeVisible();
  await form.getByLabel('Descrição').fill(rent);
  await form
    .getByRole('combobox', { name: 'Repetição' })
    .selectOption({ label: 'Parcelado (divide o valor)' });
  await form.getByLabel('Valor total').fill('3000,00');
  await form.getByLabel('Primeiro vencimento').fill(day(-2));
  await form
    .getByRole('combobox', { name: 'Categoria', exact: true })
    .selectOption({ label: 'Gastos gerais operacionais › Aluguel' });
  await form.getByRole('combobox', { name: 'Fornecedor' }).selectOption({ label: supplier });
  await form.getByLabel('Parcelas').fill('3');
  await form.getByRole('button', { name: 'Salvar' }).click();
  await expect(form).toBeHidden();
  await expect(toasts(page).getByText('Despesa lançada.')).toBeVisible();

  await page.getByRole('searchbox', { name: 'Buscar lançamento' }).fill(tag);
  await expect(page).toHaveURL(new RegExp(`q=${tag}`));
  const rows = page.getByRole('button', { name: rent });
  await expect(rows).toHaveCount(3);
  await expect(page.getByText(`Aluguel · ${supplier} · Parcela 1/3`)).toBeVisible();
  await expect(
    page.getByRole('row', { name: new RegExp(`${br(day(-2))}.*Vencido`) }),
  ).toBeVisible();

  // Paga a parcela vencida com juros.
  await rows.first().click();
  const detail = page.getByRole('dialog', { name: rent });
  await expect(detail.getByText('Vencido')).toBeVisible();
  await detail.getByRole('button', { name: 'Registrar pagamento' }).click();
  const pay = page.getByRole('dialog', { name: 'Registrar pagamento' });
  await expect(pay.getByLabel('Valor pago')).toHaveValue('1000,00');
  await pay.getByLabel('Valor pago').fill('1012,50');
  await pay.getByRole('button', { name: 'Confirmar pagamento' }).click();
  await expect(pay).toBeHidden();
  await expect(rows).toHaveCount(2);
  await page.getByRole('group', { name: 'Situação' }).getByText('Pagas').click();
  await expect(
    page.getByRole('row', { name: new RegExp(`${rent}.*R\\$\\s1\\.012,50`) }),
  ).toBeVisible();

  // Cancela a segunda parcela e a terceira junto.
  await page.getByRole('group', { name: 'Situação' }).getByText('A pagar').click();
  await rows.first().click();
  await page
    .getByRole('dialog', { name: rent })
    .getByRole('button', { name: 'Cancelar lançamento' })
    .click();
  const cancel = page.getByRole('dialog', { name: 'Cancelar lançamento' });
  await cancel.getByLabel('Motivo').fill('Contrato encerrado');
  await cancel.getByText('Cancelar também as próximas parcelas em aberto').click();
  await cancel.getByRole('button', { name: 'Cancelar lançamento' }).click();
  await expect(cancel).toBeHidden();
  await expect(page.getByText('Nenhum lançamento nesta busca')).toBeVisible();

  await page.goto(`/financeiro?situacao=cancelados&q=${tag}&de=${day(-5)}&ate=${day(90)}`);
  await expect(page.getByRole('button', { name: rent })).toHaveCount(2);
});

test('cadastra conta e transfere para o banco, com o saldo atualizado', async ({ page }) => {
  const account = `Poupança ${tag}`;
  await page.goto('/financeiro/contas');
  await page.getByRole('button', { name: 'Adicionar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nova conta' });
  await dialog.getByLabel('Nome', { exact: true }).fill(account);
  await dialog.getByLabel('Saldo inicial', { exact: true }).fill('100,00');
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('listitem').filter({ hasText: account })).toContainText(
    /R\$\s100,00/,
  );

  await sidebar(page).getByRole('link', { name: 'Lançamentos' }).click();
  await page.getByRole('button', { name: 'Transferência', exact: true }).click();
  const transfer = page.getByRole('dialog', { name: 'Transferência entre contas' });
  await transfer.getByRole('combobox', { name: 'Sai de' }).selectOption({ label: account });
  await transfer.getByRole('combobox', { name: 'Entra em' }).selectOption({ label: account });
  await transfer.getByLabel('Valor').fill('40');
  await transfer.getByRole('button', { name: 'Transferir' }).click();
  await expect(transfer.getByText('Escolha uma conta diferente da origem')).toBeVisible();
  await transfer.getByRole('combobox', { name: 'Entra em' }).selectOption({ label: 'Banco' });
  await transfer.getByRole('button', { name: 'Transferir' }).click();
  await expect(transfer).toBeHidden();
  await expect(page.getByLabel('Saldos das contas')).toContainText(
    new RegExp(`${account}R\\$\\s60,00`),
  );

  await page.goto('/financeiro/contas');
  await expect(page.getByRole('listitem').filter({ hasText: account })).toContainText(/R\$\s60,00/);
});

test('contas a pagar no celular: lança e lista sem rolagem lateral @mobile', async ({ page }) => {
  const bill = `Luz ${tag}`;
  await page.goto('/financeiro/contas-a-pagar');
  await page.getByRole('button', { name: 'Nova despesa' }).click();
  const form = page.getByRole('dialog', { name: 'Nova despesa' });
  await form.getByLabel('Descrição').fill(bill);
  await form.getByLabel('Valor', { exact: true }).fill('245,90');
  await form
    .getByRole('combobox', { name: 'Categoria', exact: true })
    .selectOption({ label: 'Gastos gerais operacionais › Água, luz e telefone' });
  await form.getByRole('button', { name: 'Salvar' }).click();
  await expect(form).toBeHidden();
  await page.getByRole('searchbox', { name: 'Buscar lançamento' }).fill(tag);
  await expect(page).toHaveURL(new RegExp(`q=${tag}`));
  await expect(page.getByRole('button', { name: bill })).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(`${bill}.*R\\$\\s245,90`) })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBe(0);
});
