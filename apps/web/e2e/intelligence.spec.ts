import type { CatalogItem, Client, Session } from '@clinica/contracts';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STATE, run, sidebar } from './helpers';

test.use({ storageState: ADMIN_STATE });

// Nomes sem o sufixo `run` literal: products.spec conta as linhas por ele.
const reversed = Array.from(run).reverse().join('');

/**
 * Tutora com um cão e uma venda de valor alto (para liderar os rankings mesmo num banco com
 * outras vendas), feita agora: entra no período padrão, o mês corrente.
 */
async function seed(page: Page, tag: string) {
  await page.goto('/');
  return page.evaluate(async (tag) => {
    const session = (await (await fetch('/api/auth/session')).json()) as Session;
    const send = async <T>(method: string, path: string, body: unknown): Promise<T> => {
      const r = await fetch(`/api${path}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`${path}: ${await r.text()}`);
      return (await r.json()) as T;
    };
    const product = `Cirurgia BI ${tag}`;
    const p = await send<{ id: string }>('POST', '/products', {
      kind: 'service',
      serviceKind: 'surgery',
      name: product,
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
      salePrice: 95000,
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
    const species = (await (await fetch('/api/catalogs/species')).json()) as CatalogItem[];
    const tutor = `Tutora BI ${tag}`;
    const client = await send<Client>('POST', '/clients', {
      personType: 'individual',
      name: tutor,
      nationality: '',
      sex: 'female',
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
    const pet = await send<{ id: string }>('POST', '/patients', {
      clientId: client.id,
      patient: {
        name: `Pipoca ${tag}`,
        status: 'alive',
        deceasedOn: '',
        sex: 'female',
        sterilized: true,
        birthDate: '2021-05-10',
        speciesId: species.find((s) => s.name === 'Canina')?.id ?? null,
        breedId: null,
        coatId: null,
        microchip: '',
        hasPedigree: false,
        pedigreeNumber: '',
        markings: [],
      },
    });
    await send('POST', '/sales', {
      kind: 'sale',
      saleType: 'in_person_consumer',
      clientId: client.id,
      patientId: pet.id,
      insurerId: null,
      items: [{ productId: p.id, professionalId: session.user.id, quantity: 1, unitPrice: null }],
      discount: { mode: 'amount', value: 0 },
      notes: '',
    });
    return { product, tutor };
  }, tag);
}

/** Dia da semana de hoje em São Paulo, o fuso da unidade e do navegador nos testes. */
const todayWeekday = () =>
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(
      new Date(),
    ),
  );

test('indicadores de vendas, clientes e animais, com filtros e favoritos', async ({ page }) => {
  const tag = `bi${reversed}`;
  const { product, tutor } = await seed(page, tag);

  await sidebar(page).getByRole('link', { name: 'Vendas', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Vendas' })).toBeVisible();
  await expect(page).toHaveURL(/\/inteligencia\/vendas/);

  // Vendas: a venda de hoje lidera os itens e entra na receita por espécie.
  await expect(page.getByLabel('Totais das vendas')).toContainText('Venda líquida');
  const items = page.getByRole('list', { name: 'Produtos e serviços mais vendidos' });
  const ours = items.getByRole('listitem').filter({ hasText: product });
  await expect(ours).toContainText(/R\$\s95\.000,00\s*× 1/);
  await expect(page.getByRole('list', { name: 'Receita por espécie' })).toContainText('Canina');
  await expect(page.getByRole('table', { name: 'Vendas por data' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Vendas por turno' })).toContainText(
    'Madrugada (0h–6h)',
  );

  // Filtro por dia da semana: outro dia tira a venda de hoje; o de hoje a traz de volta.
  const today = todayWeekday();
  const weekdays = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  await page
    .getByRole('combobox', { name: 'Dia da semana' })
    .selectOption({ label: weekdays[(today + 1) % 7] ?? '' });
  await expect(page).toHaveURL(new RegExp(`dia=${String((today + 1) % 7)}`));
  await expect(ours).toHaveCount(0);
  await page
    .getByRole('combobox', { name: 'Dia da semana' })
    .selectOption({ label: weekdays[today] ?? '' });
  await expect(ours).toBeVisible();
  await page.getByRole('combobox', { name: 'Dia da semana' }).selectOption({ label: 'Todos' });

  // Favoritar a receita por espécie: ela sobe para o topo e continua lá depois de recarregar.
  const star = page.getByRole('button', { name: 'Favoritar Receita por espécie' });
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  await star.click();
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  const firstCard = page.getByRole('tabpanel').getByRole('heading', { level: 2 }).first();
  await expect(firstCard).toHaveText('Receita por espécie');
  await page.reload();
  await expect(firstCard).toHaveText('Receita por espécie');
  await page
    .getByRole('group', { name: 'Mostrar' })
    .getByText('Só favoritos', { exact: true })
    .click();
  await expect(page.getByRole('tabpanel').getByRole('heading', { level: 2 })).toHaveCount(1);
  await page.getByRole('button', { name: 'Favoritar Receita por espécie' }).click();
  await expect(page.getByText('Nenhum favorito nesta aba')).toBeVisible();
  await page
    .getByRole('group', { name: 'Mostrar' })
    .getByText('Todos os indicadores', { exact: true })
    .click();

  // Clientes: quem comprou aparece no ranking; o filtro de turno é só das vendas.
  await page.getByRole('tab', { name: 'Clientes' }).click();
  await expect(page).toHaveURL(/aba=clientes/);
  await expect(page.getByRole('combobox', { name: 'Turno' })).toHaveCount(0);
  const top = page.getByRole('list', { name: 'Clientes que mais compraram' });
  await expect(top.getByRole('listitem').filter({ hasText: tutor })).toContainText(
    /R\$\s95\.000,00\s*1 venda/,
  );
  // Compareceram conta dias com venda; o banco de testes tem outros clientes empatados em um dia.
  await expect(page.getByRole('list', { name: 'Clientes que compareceram' })).toContainText(
    /\d+\s*dias?/,
  );
  await expect(page.getByRole('list', { name: 'Clientes por sexo' })).toContainText('Feminino');

  // Animais: o corte veterinário por espécie, idade, peso e esterilização.
  await page.getByRole('tab', { name: 'Animais' }).click();
  await expect(page.getByLabel('Totais dos animais')).toContainText('Animais ativos');
  await expect(page.getByRole('list', { name: 'Animais por espécie' })).toContainText('Canina');
  await expect(page.getByRole('list', { name: 'Animais por faixa de idade' })).toContainText(
    '4 a 7 anos',
  );
  await expect(page.getByRole('list', { name: 'Animais por faixa de peso' })).toContainText(
    'Sem peso registrado',
  );
  await expect(page.getByRole('list', { name: 'Esterilização' })).toContainText('Castrado');
});

test('inteligência no celular sem rolagem lateral @mobile', async ({ page }) => {
  await seed(page, `bm${reversed}`);
  const noOverflow = async () => {
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
  };
  for (const aba of ['', '?aba=clientes', '?aba=animais']) {
    await page.goto(`/inteligencia/vendas${aba}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Vendas' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
    await noOverflow();
  }
});
