import type { CatalogItem, Client, Patient, Session } from '@clinica/contracts';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STATE, run, sidebar, toasts } from './helpers';

test.use({ storageState: ADMIN_STATE });

// Sufixo próprio: a busca por `run` em outros testes não deve achar estes cadastros.
const tag = `in${Array.from(run).reverse().join('')}`;

/** Cliente com um cão, via API. */
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
    const tutor = `Tutor Internação ${suffix}`;
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
    const pet = `Bob ${suffix}`;
    const patient = await send<Patient>('/patients', {
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
      },
    });
    return { tutor, pet, patientId: patient.id };
  }, tag);
}

test('internação: box, internar pela ficha, histórico, painel e alta', async ({ page }) => {
  const { pet, patientId } = await seed(page);
  const code = `I${run.slice(-6).toUpperCase()}`;

  // Box só para cães, com uma vaga.
  await sidebar(page).getByRole('link', { name: 'Boxes' }).click();
  await page.getByRole('button', { name: 'Novo box' }).click();
  const boxForm = page.getByRole('form', { name: 'Box' });
  await boxForm.getByLabel('Sigla').fill(code);
  await boxForm.getByLabel('Nome').fill(`Isolamento ${tag}`);
  await boxForm.getByLabel('Tipo').selectOption({ label: 'Isolamento' });
  await boxForm.getByLabel('Capacidade (animais)').fill('1');
  await boxForm.getByRole('checkbox', { name: 'Canina' }).click();
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(toasts(page).getByText(`Box ${code} cadastrado.`)).toBeVisible();
  const boxRow = page.getByRole('row').filter({ hasText: code });
  await expect(boxRow).toContainText('0 de 1');
  await expect(boxRow).toContainText('Canina');

  // Internar a partir da ficha clínica.
  await page.goto(`/atendimento/${patientId}`);
  await page.getByRole('button', { name: 'Internar', exact: true }).click();
  const admit = page.getByRole('dialog', { name: `Internar ${pet}` });
  await admit.getByRole('button', { name: 'Internar', exact: true }).click();
  await expect(admit.getByText('Descreva o motivo da internação')).toBeVisible();
  await admit.getByLabel('Motivo da internação').fill('Gastroenterite com desidratação');
  const boxSelect = admit.getByLabel('Box', { exact: true });
  const option = await boxSelect.locator('option', { hasText: code }).getAttribute('value');
  await boxSelect.selectOption(option ?? '');
  await admit.getByText('Urgente', { exact: true }).click();
  await admit.getByRole('button', { name: 'Internar', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: pet })).toBeVisible();
  const facts = page.getByRole('region', { name: 'Dados da internação' });
  await expect(facts).toContainText('Urgente');
  await expect(facts).toContainText(code);
  const history = page.getByRole('list', { name: 'Histórico da internação' });
  // Só os registros: os parâmetros de um registro também são itens de lista.
  const entries = history.locator(':scope > li');
  await expect(entries).toHaveCount(1);

  // Peso, parâmetros clínicos com opções fechadas e ocorrência.
  await page.getByRole('button', { name: 'Peso', exact: true }).click();
  const weight = page.getByRole('dialog', { name: 'Registrar peso' });
  await weight.getByLabel('Peso (kg)').fill('12,4');
  await weight.getByRole('button', { name: 'Registrar' }).click();
  await expect(entries.first()).toContainText(/12,4\d* kg/);
  await expect(facts).toContainText(/12,4\d* kg/);

  await page.getByRole('button', { name: 'Parâmetros', exact: true }).click();
  const params = page.getByRole('dialog', { name: 'Registrar parâmetros clínicos' });
  await params.getByRole('button', { name: 'Registrar' }).click();
  await expect(params.getByText('Preencha ao menos um parâmetro')).toBeVisible();
  await params.getByLabel('Apetite').selectOption('Diminuído');
  await params.getByLabel('FC (bpm)').fill('120');
  await params.getByRole('button', { name: 'Registrar' }).click();
  const latest = entries.first();
  await expect(latest).toContainText('Apetite: Diminuído');
  await expect(latest).toContainText('FC: 120 bpm');

  await page.getByRole('button', { name: 'Ocorrência', exact: true }).click();
  const occurrence = page.getByRole('dialog', { name: 'Registrar ocorrência' });
  await occurrence.getByRole('textbox', { name: 'Ocorrência' }).fill('Vomitou após a medicação');
  await occurrence.getByRole('button', { name: 'Registrar' }).click();
  await expect(entries).toHaveCount(4);
  await expect(entries.first()).toContainText('Vomitou após a medicação');

  // Painel: o cartão com a tarja de urgente e o box.
  await sidebar(page).getByRole('link', { name: 'Animais internados' }).click();
  await page.getByLabel('Buscar internados').fill(pet);
  const card = page.getByRole('link', { name: `${pet}, Urgente, ${code}` });
  await expect(card).toBeVisible();
  await card.click();

  // Alta: a internação encerra, vai para o histórico e libera o box.
  await page.getByRole('button', { name: 'Alta', exact: true }).click();
  const discharge = page.getByRole('dialog', { name: `Dar alta a ${pet}` });
  await discharge.getByLabel('Orientações e observações da alta').fill('Retorno em 7 dias');
  await discharge.getByRole('button', { name: 'Dar alta' }).click();
  await expect(toasts(page).getByText('Alta registrada.')).toBeVisible();
  await expect(facts).toContainText('Retorno em 7 dias');
  await expect(page.getByRole('group', { name: 'Ações da internação' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Peso', exact: true })).toHaveCount(0);

  await sidebar(page).getByRole('link', { name: 'Histórico de internações' }).click();
  await page.getByLabel('Buscar no histórico').fill(pet);
  const row = page.getByRole('row').filter({ hasText: pet });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Alta');

  await sidebar(page).getByRole('link', { name: 'Boxes' }).click();
  await expect(page.getByRole('row').filter({ hasText: code })).toContainText('0 de 1');
});

test('internação no celular sem rolagem lateral @mobile', async ({ page }) => {
  for (const path of ['/internacao', '/internacao/historico', '/internacao/boxes']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
  }
});
