import type { CatalogItem, Client, Patient, Session } from '@clinica/contracts';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STATE, run, sidebar, toasts } from './helpers';

test.use({ storageState: ADMIN_STATE });

const tag = `cv${Array.from(run).reverse().join('')}`;

/** Cliente com um cão e um serviço de venda, via API. */
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
    const species = (await (await fetch('/api/catalogs/species')).json()) as CatalogItem[];
    const client = await send<Client>('/clients', {
      personType: 'individual',
      name: `Tutor Convênio ${suffix}`,
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
    const pet = `Nina ${suffix}`;
    const patient = await send<Patient>('/patients', {
      clientId: client.id,
      patient: {
        name: pet,
        status: 'alive',
        deceasedOn: '',
        sex: 'female',
        sterilized: null,
        birthDate: '',
        speciesId: species.find((s) => s.name === 'Canina')?.id ?? null,
        breedId: null,
        coatId: null,
        microchip: '',
        hasPedigree: false,
        pedigreeNumber: '',
        markings: [],
      },
    });
    const service = `Consulta plano ${suffix}`;
    await send<unknown>('/products', {
      kind: 'service',
      serviceKind: 'consultation',
      name: service,
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
    return { pet, patientId: patient.id, service };
  }, tag);
}

test('convênio: cadastro, tabela de preços com coparticipação e plano do animal', async ({
  page,
}) => {
  const { pet, patientId, service } = await seed(page);
  const insurer = `PetSaúde ${tag}`;

  await page.goto('/');
  await sidebar(page).getByRole('link', { name: 'Convênios' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Convênios' })).toBeVisible();
  await page.getByRole('button', { name: 'Adicionar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Novo convênio' });
  await dialog.getByLabel('Nome').fill(insurer);
  await dialog.getByLabel('CNPJ').fill('123');
  await dialog.getByLabel('Prazo de repasse (dias)').fill('45');
  await dialog.getByLabel('Coparticipação do tutor (%)').fill('20');
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(dialog.getByText('CNPJ inválido')).toBeVisible();
  await dialog.getByLabel('CNPJ').fill('');
  await dialog.getByRole('checkbox', { name: 'Exige autorização prévia' }).check();
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(dialog).toBeHidden();
  await expect(toasts(page)).toContainText(`Convênio ${insurer} incluído.`);
  const row = page
    .getByRole('list', { name: 'Convênios' })
    .getByRole('listitem')
    .filter({ hasText: insurer });
  await expect(row).toContainText('Repasse em 45 dias · coparticipação 20% · autorização prévia');
  await expect(row).toContainText('0 itens na tabela · 0 animais com plano');

  // Tabela de preços: o mesmo item do catálogo, com o valor do convênio.
  await row.getByRole('link', { name: `Tabela de preços de ${insurer}` }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: `Tabela de preços: ${insurer}` }),
  ).toBeVisible();
  await expect(page.getByText('Nenhum item na tabela')).toBeVisible();
  await page.getByLabel('Buscar no catálogo').fill(service);
  await page.getByRole('button', { name: `Incluir ${service}` }).click();
  const items = page.getByRole('list', { name: 'Itens da tabela' });
  const item = items.getByRole('listitem').filter({ hasText: service });
  await expect(item.getByRole('checkbox', { name: 'Exige autorização' })).toBeChecked();
  await item.getByLabel('Valor no convênio (R$)').fill('120,00');
  await expect(item).toContainText('Tutor paga R$ 24,00 · convênio repassa R$ 96,00');
  await item.getByLabel('Coparticipação (%)').fill('10');
  await expect(item).toContainText('Tutor paga R$ 12,00 · convênio repassa R$ 108,00');
  await expect(page.getByText('Alterações ainda não salvas.')).toBeVisible();
  await page.getByRole('button', { name: 'Salvar tabela' }).click();
  await expect(toasts(page)).toContainText('Tabela de preços salva.');
  await expect(page.getByText('Tabela salva.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salvar tabela' })).toBeDisabled();

  // Recarregada, a tabela volta como foi salva.
  await page.reload();
  await expect(item.getByLabel('Valor no convênio (R$)')).toHaveValue('120,00');
  await expect(item.getByLabel('Coparticipação (%)')).toHaveValue('10');

  // Plano de saúde no cadastro do animal.
  await page.goto(`/animais/${patientId}/editar`);
  await page.getByRole('checkbox', { name: 'Possui plano de saúde' }).check();
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Escolha o convênio' })).toBeVisible();
  await expect(page.getByText('Informe o número da carteirinha')).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Convênio', exact: true })
    .selectOption({ label: insurer });
  await page.getByLabel('Carteirinha').fill('0042-7');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(toasts(page)).toContainText('Alterações salvas.');
  await expect(page.getByRole('heading', { level: 1, name: pet })).toBeVisible();
  await expect(page.getByText(`${insurer} · carteirinha 0042-7`)).toBeVisible();

  await page.goto('/convenios');
  await expect(row).toContainText('1 item na tabela · 1 animal com plano');
});

test('convênios no celular: lista, tabela e plano sem rolagem lateral @mobile', async ({
  page,
}) => {
  const { patientId, service } = await seed(page);
  const noOverflow = async () => {
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
  };
  const insurer = await page.evaluate(async (name) => {
    const session = (await (await fetch('/api/auth/session')).json()) as Session;
    const r = await fetch('/api/insurers', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken },
      body: JSON.stringify({ name, paymentDays: 30, copayPercent: 10 }),
    });
    if (!r.ok) throw new Error(await r.text());
    return (await r.json()) as { id: string };
  }, `Plano celular ${tag}`);
  await page.goto('/convenios');
  await expect(page.getByRole('heading', { level: 1, name: 'Convênios' })).toBeVisible();
  await noOverflow();
  await page.goto(`/convenios/${insurer.id}`);
  await page.getByLabel('Buscar no catálogo').fill(service);
  await page.getByRole('button', { name: `Incluir ${service}` }).click();
  await expect(page.getByLabel('Valor no convênio (R$)')).toHaveValue('150,00');
  await noOverflow();
  await page.goto(`/animais/${patientId}/editar`);
  await page.getByRole('checkbox', { name: 'Possui plano de saúde' }).check();
  await expect(page.getByLabel('Carteirinha')).toBeVisible();
  await noOverflow();
});
