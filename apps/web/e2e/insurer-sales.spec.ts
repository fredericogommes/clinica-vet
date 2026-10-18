import type { CatalogItem, Client, Session } from '@clinica/contracts';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STATE, run, sidebar, toasts } from './helpers';

test.use({ storageState: ADMIN_STATE });

/**
 * Convênio com consulta (R$ 120 na tabela) e ultrassom (R$ 200, com autorização), coparticipação
 * de 20%, e um cão com plano nele. Tudo via API; a venda e os repasses são feitos pela tela.
 */
async function seed(page: Page, suffix: string) {
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
    const service = (name: string, salePrice: number) =>
      send<{ id: string }>('POST', '/products', {
        kind: 'service',
        serviceKind: 'consultation',
        name,
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
        salePrice,
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
    const consulta = `Consulta conv ${tag}`;
    const exame = `Ultrassom conv ${tag}`;
    const c = await service(consulta, 150);
    const e = await service(exame, 260);
    const insurer = `VetPlano ${tag}`;
    const ins = await send<{ id: string }>('POST', '/insurers', {
      name: insurer,
      paymentDays: 30,
      copayPercent: 20,
    });
    await send('PUT', `/insurers/${ins.id}/prices`, {
      items: [
        { productId: c.id, price: 120, copayPercent: null, requiresAuthorization: false },
        { productId: e.id, price: 200, copayPercent: null, requiresAuthorization: true },
      ],
    });
    const species = (await (await fetch('/api/catalogs/species')).json()) as CatalogItem[];
    const client = await send<Client>('POST', '/clients', {
      personType: 'individual',
      name: `Tutora Plano ${tag}`,
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
    const pet = `Bento ${tag}`;
    await send('POST', '/patients', {
      clientId: client.id,
      patient: {
        name: pet,
        status: 'alive',
        deceasedOn: '',
        sex: 'male',
        sterilized: null,
        birthDate: '',
        speciesId: species.find((s) => s.name === 'Canina')?.id ?? null,
        breedId: null,
        coatId: null,
        microchip: '',
        hasPedigree: false,
        pedigreeNumber: '',
        markings: [],
        insurance: { insurerId: ins.id, cardNumber: 'C-77', validUntil: '' },
      },
    });
    return { consulta, exame, insurer, insurerId: ins.id, pet };
  }, suffix);
}

async function startSale(page: Page, pet: string, insurer: string, items: string[]) {
  await sidebar(page).getByRole('link', { name: 'Ponto de venda' }).click();
  await page.getByLabel('Localizar cliente').fill(pet);
  await page
    .getByRole('list', { name: 'Clientes encontrados' })
    .getByRole('button', { name: pet })
    .click();
  await expect(page.getByText(`O animal tem plano ${insurer}.`)).toBeVisible();
  await page.getByRole('group', { name: 'Atendimento' }).getByText(insurer).click();
  const add = page.getByLabel('Adicionar item');
  for (const item of items) {
    await add.fill(item);
    await expect(page.getByRole('list', { name: 'Itens encontrados' })).toContainText(item);
    await add.press('Enter');
  }
}

test('venda pelo convênio: coparticipação, autorização e repasses conciliados e glosados', async ({
  page,
}) => {
  const tag = `rp${run}`;
  const { consulta, exame, insurer, pet } = await seed(page, tag);

  // PDV: os itens da tabela saem pelo valor do convênio, divididos entre tutor e convênio.
  await startSale(page, pet, insurer, [consulta, exame]);
  const rows = page.getByRole('list', { name: 'Itens da venda' }).getByRole('listitem');
  await expect(rows.filter({ hasText: consulta })).toContainText(
    /Tutor paga R\$\s24,00 · convênio repassa R\$\s96,00/,
  );
  await expect(rows.filter({ hasText: exame })).toContainText(
    /Tutor paga R\$\s40,00 · convênio repassa R\$\s160,00/,
  );
  await expect(page.getByText('Convênio paga')).toBeVisible();
  await expect(page.getByText(/^R\$\s256,00$/)).toBeVisible();
  await expect(page.getByText(/^R\$\s64,00$/)).toBeVisible();

  // Sem a autorização do ultrassom, a venda não é recebida.
  await page.getByRole('button', { name: 'Registrar recebimento' }).click();
  await expect(
    rows.filter({ hasText: exame }).getByText('Informe a autorização para receber'),
  ).toBeVisible();
  await page.getByLabel(`Autorização de ${exame}`).fill('AUT-9');
  await page.getByRole('button', { name: 'Registrar recebimento' }).click();
  const opening = page.getByRole('dialog', { name: 'Abrir caixa' });
  const dialog = page.getByRole('dialog', { name: /Registrar recebimento da venda \d+/ });
  await expect(opening.or(dialog)).toBeVisible();
  if (await opening.isVisible()) {
    await opening.getByLabel('Troco inicial (R$)').fill('0');
    await opening.getByRole('button', { name: 'Abrir caixa' }).click();
  }
  await expect(dialog).toContainText(
    new RegExp(`O tutor paga R\\$\\s64,00; R\\$\\s256,00 vêm pelo repasse de ${insurer}\\.`),
  );
  await expect(dialog.getByLabel('Forma 1: valor')).toHaveValue('64,00');
  await dialog.getByLabel('Forma 1: forma de recebimento').selectOption({ label: 'PIX' });
  await dialog.getByRole('button', { name: 'Receber e baixar venda' }).click();
  await expect(toasts(page).getByText(/Venda \d+ recebida e baixada\./)).toBeVisible();
  await expect(page.getByText(`Convênio ${insurer}, carteirinha C-77`)).toBeVisible();
  await expect(page.getByText(/Convênio repassa R\$\s160,00 · autorização AUT-9/)).toBeVisible();

  // Repasses: cada procedimento a receber do convênio, na data prevista.
  await sidebar(page).getByRole('link', { name: 'Repasses' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Repasses' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Convênio' }).selectOption({ label: insurer });
  const stats = page.getByLabel('Resumo dos repasses');
  await expect(stats).toContainText(/Não conciliados\s*R\$\s256,00\s*2 procedimentos/);
  const table = page.getByRole('table', { name: 'Repasses dos convênios' });
  const consultaRow = table.getByRole('row').filter({ hasText: consulta });
  const exameRow = table.getByRole('row').filter({ hasText: exame });
  await expect(exameRow).toContainText('autorização AUT-9');

  // Glosa parcial do ultrassom, com motivo; o resto segue a conciliar.
  await exameRow.getByRole('button', { name: /^Glosar / }).click();
  const gloss = page.getByRole('dialog', { name: 'Glosar procedimento' });
  await expect(gloss.getByLabel('Valor glosado (R$)')).toHaveValue('160,00');
  await gloss.getByLabel('Valor glosado (R$)').fill('60');
  await expect(gloss.getByText('Glosa parcial: o resto segue a conciliar.')).toBeVisible();
  await gloss.getByRole('button', { name: 'Glosar' }).click();
  await expect(gloss.getByText('Diga o motivo da glosa')).toBeVisible();
  await gloss.getByLabel('Motivo').fill('Sem laudo anexado');
  await gloss.getByRole('button', { name: 'Glosar' }).click();
  await expect(toasts(page)).toContainText('Glosa registrada.');
  await expect(exameRow).toContainText(/R\$\s100,00/);
  await expect(exameRow).toContainText('Glosa: Sem laudo anexado');
  await expect(stats).toContainText(/Glosados\s*R\$\s60,00\s*1 procedimento/);

  // Conciliar os dois de uma vez.
  await consultaRow.getByRole('checkbox', { name: consulta }).check();
  await exameRow.getByRole('checkbox', { name: exame }).check();
  await expect(page.getByText(/2 selecionados · R\$\s196,00/)).toBeVisible();
  await page.getByRole('button', { name: 'Conciliar selecionados' }).click();
  const reconcile = page.getByRole('dialog', { name: 'Conciliar repasse' });
  await expect(reconcile).toContainText(/2 procedimentos · R\$\s196,00/);
  await reconcile.getByRole('button', { name: 'Conciliar' }).click();
  await expect(toasts(page)).toContainText('2 repasses conciliados.');
  await expect(page.getByText('Nenhum repasse esperando conciliação')).toBeVisible();
  await expect(stats).toContainText(/Conciliados\s*R\$\s196,00\s*2 procedimentos/);

  // Desfazer a conciliação da consulta: ela volta a não conciliada.
  await page
    .getByRole('group', { name: 'Situação' })
    .getByText('Conciliados', { exact: true })
    .click();
  await consultaRow.getByRole('button', { name: /^Desfazer conciliação de / }).click();
  const undo = page.getByRole('dialog', { name: 'Desfazer conciliação' });
  await undo.getByRole('button', { name: 'Desfazer conciliação' }).click();
  await expect(toasts(page)).toContainText('Conciliação desfeita.');
  await expect(stats).toContainText(/Não conciliados\s*R\$\s96,00\s*1 procedimento/);
});

test('venda pelo convênio e repasses no celular sem rolagem lateral @mobile', async ({ page }) => {
  const tag = `rm${run}`;
  const { consulta, exame, insurer, insurerId, pet } = await seed(page, tag);
  const noOverflow = async () => {
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
  };
  await page.goto('/vendas/pdv');
  await page.getByLabel('Localizar cliente').fill(pet);
  await page
    .getByRole('list', { name: 'Clientes encontrados' })
    .getByRole('button', { name: pet })
    .click();
  await page.getByRole('group', { name: 'Atendimento' }).getByText(insurer).click();
  const add = page.getByLabel('Adicionar item');
  for (const item of [consulta, exame]) {
    await add.fill(item);
    await expect(page.getByRole('list', { name: 'Itens encontrados' })).toContainText(item);
    await add.press('Enter');
  }
  await expect(page.getByLabel(`Autorização de ${exame}`)).toBeVisible();
  await expect(page.getByText('Tutor paga', { exact: true })).toBeVisible();
  await noOverflow();
  await page.goto(`/convenios/repasses?convenio=${insurerId}&situacao=todos`);
  await expect(page.getByRole('heading', { level: 1, name: 'Repasses' })).toBeVisible();
  await noOverflow();
});
