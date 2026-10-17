import type { Client, Session } from '@clinica/contracts';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STATE, run, sidebar, toasts } from './helpers';

test.use({ storageState: ADMIN_STATE });

// Sufixo próprio: a busca por `run` em outros testes não deve achar estes cadastros.
const tag = [...run].reverse().join('');

/** Cliente com animal e o serviço avulso que o pacote vai conter, via API. */
async function seed(page: Page) {
  await page.goto('/');
  return page.evaluate(async (suffix) => {
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
    const tutor = `Tutor Pacote ${suffix}`;
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
    const pet = `Mel ${suffix}`;
    await send<unknown>('/patients', {
      clientId: client.id,
      patient: {
        name: pet,
        status: 'alive',
        deceasedOn: '',
        sex: 'female',
        sterilized: null,
        birthDate: '',
        speciesId: null,
        breedId: null,
        coatId: null,
        microchip: '',
        hasPedigree: false,
        pedigreeNumber: '',
        markings: [],
      },
    });
    const bath = `Banho pacote ${suffix}`;
    await send<unknown>('/products', {
      kind: 'service',
      serviceKind: 'grooming',
      name: bath,
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
      salePrice: 60,
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
    return { tutor, pet, bath };
  }, tag);
}

test('pacotes: cadastro, venda, sessões usadas, desfeita e pacote concluído', async ({ page }) => {
  const { tutor, pet, bath } = await seed(page);
  const pkg = `Pacote 3 banhos ${tag}`;

  // Cadastro: serviço classificado como Pacote, com o serviço, as sessões e a validade.
  await sidebar(page).getByRole('link', { name: 'Produtos e serviços' }).click();
  await page.getByRole('link', { name: 'Novo item' }).click();
  await page.getByRole('group', { name: 'Tipo' }).getByText('Serviço', { exact: true }).click();
  await page.getByLabel('Classificação do serviço').selectOption({ label: 'Pacote' });
  await page.getByLabel('Nome', { exact: true }).fill(pkg);
  await page.getByLabel('Preço de venda (R$)').fill('150');
  await page.getByRole('button', { name: 'Cadastrar' }).click();
  await expect(page.getByText('Escolha o serviço do pacote')).toBeVisible();
  await page.getByLabel('Buscar serviço').fill(bath);
  const serviceSelect = page.getByLabel('Serviço do pacote');
  await expect(serviceSelect.getByRole('option', { name: bath })).toHaveCount(1);
  await serviceSelect.selectOption({ label: bath });
  await page.getByLabel('Sessões').fill('3');
  await page.getByLabel('Validade (dias)').fill('60');
  await page.getByRole('button', { name: 'Cadastrar' }).click();
  await expect(toasts(page).getByText(/Serviço cadastrado com o código \d+\./)).toBeVisible();

  // Venda baixada abre o pacote do cliente.
  await sidebar(page).getByRole('link', { name: 'Ponto de venda' }).click();
  await page.getByLabel('Localizar cliente').fill(pet);
  await page
    .getByRole('list', { name: 'Clientes encontrados' })
    .getByRole('button', { name: pet })
    .click();
  const add = page.getByLabel('Adicionar item');
  await add.fill(pkg);
  await expect(page.getByRole('list', { name: 'Itens encontrados' })).toContainText(pkg);
  await add.press('Enter');
  await page.getByRole('button', { name: 'Registrar recebimento' }).click();
  const opening = page.getByRole('dialog', { name: 'Abrir caixa' });
  if (await opening.isVisible().catch(() => false)) {
    await opening.getByLabel('Troco inicial (R$)').fill('0');
    await opening.getByRole('button', { name: 'Abrir caixa' }).click();
  }
  const receive = page.getByRole('dialog', { name: /Registrar recebimento da venda \d+/ });
  await receive.getByLabel('Forma 1: forma de recebimento').selectOption({ label: 'Dinheiro' });
  await receive.getByRole('button', { name: 'Receber e baixar venda' }).click();
  await expect(toasts(page).getByText(/Venda \d+ recebida e baixada\./)).toBeVisible();

  // Pacotes vendidos: sessão registrada, desfeita com motivo e pacote até o fim.
  await sidebar(page).getByRole('link', { name: 'Pacotes vendidos' }).click();
  await page.getByLabel('Buscar pacotes').fill(tutor);
  const row = page.getByRole('row').filter({ hasText: tutor });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('0 de 3');
  await expect(row).toContainText('Em uso');
  await row.getByRole('button', { name: /^Usar sessão de/ }).click();
  const dialog = page.getByRole('dialog', { name: `${pkg}, ${tutor}` });
  await expect(dialog).toContainText('3 de 3 sessões restantes');
  const form = dialog.getByRole('form', { name: 'Registrar sessão' });
  await expect(form.getByLabel('Animal')).toHaveValue(/.+/);
  await form.getByRole('button', { name: 'Registrar sessão' }).click();
  await expect(form.getByText('Escolha o profissional')).toBeVisible();
  await form.getByLabel('Profissional').selectOption({ index: 1 });
  await form.getByLabel('Observação').fill('Banho com hidratação');
  await form.getByRole('button', { name: 'Registrar sessão' }).click();
  // O diálogo é modal: o aviso fica fora da árvore acessível; o progresso aparece no formulário.
  await expect(form.getByRole('heading')).toHaveText('Registrar a sessão 2 de 3');
  const usages = dialog.getByRole('list', { name: 'Sessões do pacote' });
  await expect(usages.getByRole('listitem')).toHaveCount(1);
  await expect(usages).toContainText('Banho com hidratação');

  await usages.getByRole('button', { name: /^Desfazer sessão de/ }).click();
  const undo = dialog.getByRole('form', { name: 'Desfazer sessão' });
  await undo.getByRole('button', { name: 'Desfazer sessão' }).click();
  await expect(undo.getByText('Explique o motivo em poucas palavras')).toBeVisible();
  await undo.getByLabel('Motivo').fill('Lançada por engano');
  await undo.getByRole('button', { name: 'Desfazer sessão' }).click();
  await expect(usages).toContainText('Lançada por engano');
  await expect(form.getByRole('heading')).toHaveText('Registrar a sessão 1 de 3');

  for (const next of ['2 de 3', '3 de 3']) {
    await form.getByLabel('Profissional').selectOption({ index: 1 });
    await form.getByRole('button', { name: 'Registrar sessão' }).click();
    await expect(form.getByRole('heading')).toHaveText(`Registrar a sessão ${next}`);
  }
  await form.getByLabel('Profissional').selectOption({ index: 1 });
  await form.getByRole('button', { name: 'Registrar sessão' }).click();
  await expect(dialog.getByRole('note')).toHaveText('Todas as sessões foram usadas.');
  await expect(usages.getByRole('listitem')).toHaveCount(4);
  await dialog.getByRole('button', { name: 'Fechar' }).first().click();
  await expect(row).toContainText('3 de 3');
  await expect(row).toContainText('Concluído');
});

test('pacotes vendidos no celular sem rolagem lateral @mobile', async ({ page }) => {
  await page.goto('/vendas/pacotes');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pacotes vendidos');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
});
