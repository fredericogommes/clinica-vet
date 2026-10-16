import type { Client, Session } from '@clinica/contracts';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STATE, run, sidebar, toasts } from './helpers';

test.use({ storageState: ADMIN_STATE });

/** Cliente com animal e dois itens à venda, via API: o cadastro não é o objeto deste teste. */
async function seed(page: Page, tag = '') {
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
    const tutor = `Tutor Venda ${suffix}`;
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
    const pet = `Bidu ${suffix}`;
    await send<unknown>('/patients', {
      clientId: client.id,
      patient: {
        name: pet,
        status: 'alive',
        deceasedOn: '',
        sex: 'male',
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
    const item = (o: Record<string, unknown>) => ({
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
      defaultCommissionPercent: 0,
      commissions: [],
      tracksStock: false,
      minStock: null,
      idealStock: null,
      ...o,
    });
    const service = `Consulta venda ${suffix}`;
    const product = `Vermífugo ${suffix}`;
    await send<unknown>(
      '/products',
      item({ kind: 'service', serviceKind: 'consultation', name: service, salePrice: 150 }),
    );
    await send<unknown>('/products', item({ name: product, salePrice: 40 }));
    return { tutor, pet, service, product };
  }, run + tag);
}

test('PDV: venda com profissional por item, limite de desconto, orçamento e cancelamento', async ({
  page,
}) => {
  const { tutor, pet, service, product } = await seed(page);
  await sidebar(page).getByRole('link', { name: 'Ponto de venda' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ponto de venda');

  // Cliente localizado pelo nome do animal [p.8].
  await page.getByLabel('Localizar cliente').fill(pet);
  await page
    .getByRole('list', { name: 'Clientes encontrados' })
    .getByRole('button', { name: pet })
    .click();
  await expect(page.getByLabel('Animal')).toHaveValue(/.+/);

  // Itens: Enter adiciona o primeiro resultado, como o leitor de código de barras.
  const add = page.getByLabel('Adicionar item');
  await add.fill(service);
  await expect(page.getByRole('list', { name: 'Itens encontrados' })).toContainText(service);
  await add.press('Enter');
  await add.fill(product);
  await expect(page.getByRole('list', { name: 'Itens encontrados' })).toContainText(product);
  await add.press('Enter');
  await page.getByLabel(`Quantidade de ${product}`).fill('2');
  await expect(page.getByLabel(`Profissional de ${service}`)).not.toHaveValue('');

  // Desconto acima do limite é recusado pelo servidor e apontado no campo.
  await page.getByRole('group', { name: 'Desconto em' }).getByText('%', { exact: true }).click();
  await page.getByLabel('Desconto (%)').fill('50');
  await page.getByRole('button', { name: 'Salvar venda' }).click();
  await expect(page.getByText(/Desconto acima do seu limite/)).toBeVisible();
  await page.getByLabel('Desconto (%)').fill('5');
  await expect(
    page.getByRole('region', { name: 'Desconto e observações' }).getByText('R$ 218,50'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Salvar venda' }).click();
  await expect(toasts(page).getByText(/Venda \d+ gravada: R\$\s218,50\./)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tutor);
  await expect(page.getByText('Em aberto', { exact: true }).first()).toBeVisible();
  // Venda em aberto não volta a orçamento.
  await expect(page.getByRole('group', { name: 'Registrar como' })).toHaveCount(0);

  // Orçamento vira venda sem redigitar.
  await page.getByRole('link', { name: 'Nova venda' }).click();
  await page.getByRole('group', { name: 'Registrar como' }).getByText('Orçamento').click();
  await add.fill(service);
  await expect(page.getByRole('list', { name: 'Itens encontrados' })).toContainText(service);
  await add.press('Enter');
  await page.getByRole('button', { name: 'Salvar orçamento' }).click();
  await expect(toasts(page).getByText(/Orçamento \d+ gravado: R\$\s150,00\./)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Venda de balcão');
  await page
    .getByRole('group', { name: 'Registrar como' })
    .getByText('Venda', { exact: true })
    .click();
  await page.getByRole('button', { name: 'Converter em venda' }).click();
  await expect(toasts(page).getByText(/Orçamento convertido na venda \d+\./)).toBeVisible();

  // Cancelamento exige motivo e deixa a venda só para leitura.
  await page.getByRole('button', { name: 'Cancelar venda' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Cancelar venda' }).click();
  await expect(dialog.getByText('Explique o motivo em poucas palavras')).toBeVisible();
  await dialog.getByLabel('Motivo').fill('Cliente desistiu');
  await dialog.getByRole('button', { name: 'Cancelar venda' }).click();
  await expect(page.getByRole('note')).toContainText('Motivo: Cliente desistiu');
  await expect(page.getByRole('button', { name: 'Salvar alterações' })).toHaveCount(0);

  // Painel lateral localiza a venda pelo animal.
  await page.getByLabel('Localizar venda').fill(pet);
  await page.getByRole('link', { name: new RegExp(tutor) }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tutor);
});

test('PDV no celular: formulário em uma coluna, sem rolagem lateral', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { product } = await seed(page);
  await page.goto('/vendas/pdv');
  const add = page.getByLabel('Adicionar item');
  await add.fill(product);
  await expect(page.getByRole('list', { name: 'Itens encontrados' })).toContainText(product);
  await add.press('Enter');
  await expect(page.getByLabel(`Quantidade de ${product}`)).toHaveValue('1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(
    0,
  );
});

test('ficha clínica: atendimento finalizado e item lançado caem na venda aberta do animal', async ({
  page,
}) => {
  // Sufixo próprio: os outros testes deste arquivo semeiam animais com o mesmo nome.
  const { tutor, pet, service, product } = await seed(page, 'f');
  const type = `Consulta cobrada ${run}`;

  // Tipo de atendimento ligado ao serviço cobrado [RN-19].
  await sidebar(page).getByRole('link', { name: 'Tipos de atendimento' }).click();
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  const typeDialog = page.getByRole('dialog', { name: 'Novo tipo de atendimento' });
  await typeDialog.getByLabel('Nome').fill(type);
  await typeDialog.getByLabel('Serviço cobrado').selectOption({ label: service });
  await typeDialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(toasts(page).getByText('Tipo de atendimento incluído.')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: type })).toContainText(
    `Cobra ${service}`,
  );

  // Sem venda aberta, a coluna avisa; finalizar o atendimento abre a venda com o serviço.
  await page.goto(`/atendimento?animal=${encodeURIComponent(pet)}`);
  await page.getByRole('link', { name: new RegExp(pet) }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(pet);
  const panel = page.getByRole('region', { name: /^Venda/ });
  await expect(panel.getByText(`Nenhuma venda aberta para ${pet}.`)).toBeVisible();
  await page.getByLabel('Adicionar').getByRole('button', { name: 'Atendimento' }).click();
  const encounter = page.getByRole('dialog', { name: 'Novo atendimento' });
  await encounter.getByLabel('Tipo de atendimento').selectOption({ label: type });
  await encounter.getByLabel('Resumo').fill('Check-up anual');
  await encounter.getByRole('button', { name: 'Finalizar atendimento' }).click();
  await expect(toasts(page).getByText('Atendimento registrado na ficha.')).toBeVisible();
  const items = panel.getByRole('list', { name: 'Itens da venda aberta' });
  await expect(items).toContainText(service);
  await expect(panel.getByRole('heading', { name: /^Venda \d+$/ })).toBeVisible();

  // Item lançado direto da ficha entra na mesma venda.
  const search = panel.getByLabel('Lançar na venda');
  await search.fill(product);
  await expect(page.getByRole('list', { name: 'Itens encontrados' })).toContainText(product);
  await search.press('Enter');
  await expect(
    toasts(page).getByText(new RegExp(`${product} lançado na venda \\d+\\.`)),
  ).toBeVisible();
  await expect(items.getByRole('listitem')).toHaveCount(2);
  await expect(panel).toContainText(/Total\s*R\$\s190,00/);

  // A venda segue para o PDV com a origem de cada item.
  await panel.getByRole('link', { name: 'Abrir no PDV' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tutor);
  await expect(page.getByText('Lançado pela ficha clínica')).toHaveCount(1);
});
