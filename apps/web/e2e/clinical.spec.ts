import type { Client, Session } from '@clinica/contracts';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STATE, run, sidebar, toasts } from './helpers';

test.use({ storageState: ADMIN_STATE });

/** Cliente com um animal, via API: o cadastro não é o objeto deste teste. */
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
    const tutor = `Tutor Ficha ${suffix}`;
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
      contacts: [{ kind: 'mobile', value: '11955554444', isWhatsapp: true }],
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
    const pet = `Pingo ${suffix}`;
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
    return { tutor, pet };
  }, run);
}

test('ficha clínica: patologia, atendimento em rascunho, finalização, peso, filtro e invalidação', async ({
  page,
}) => {
  const { tutor, pet } = await seed(page);
  const pathology = `Otite ${run}`;

  // Catálogo de patologias (F1-5): o diagnóstico do atendimento sai daqui.
  await sidebar(page).getByRole('link', { name: 'Patologias' }).click();
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  const pathologyDialog = page.getByRole('dialog', { name: 'Nova patologia' });
  await pathologyDialog.getByLabel('Nome').fill(pathology);
  await pathologyDialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(toasts(page).getByText('Patologia incluída.')).toBeVisible();

  // Busca por responsável ou animal (F1-11) e abertura da ficha.
  await sidebar(page).getByRole('link', { name: 'Atendimento', exact: true }).click();
  await page.getByLabel('Animal').fill(pet);
  await expect(page.getByRole('list', { name: 'Responsáveis e animais' })).toContainText(tutor);
  await page.getByRole('link', { name: new RegExp(pet) }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(pet);
  const timeline = page.getByRole('tabpanel', { name: 'Linha do tempo' });
  await expect(timeline.getByText('Linha do tempo vazia')).toBeVisible();

  // Atendimento salvo como rascunho [D2]: aparece tracejado e só para o autor.
  const add = page.getByLabel('Adicionar');
  await add.getByRole('button', { name: 'Atendimento' }).click();
  const encounter = page.getByRole('dialog', { name: 'Novo atendimento' });
  await encounter.getByLabel('FC (bpm)').fill('500');
  await encounter.getByLabel('Resumo').fill('Coceira no ouvido direito');
  await encounter.getByRole('button', { name: 'Finalizar atendimento' }).click();
  await expect(encounter.getByText(/FC.*400|400/).first()).toBeVisible();
  await encounter.getByLabel('FC (bpm)').fill('120');
  await encounter.getByLabel('Temperatura (°C)').fill('38,9');
  await encounter.getByLabel('Peso (kg)').fill('8,4');
  await encounter.getByLabel('Patologia').selectOption({ label: pathology });
  await encounter.getByRole('button', { name: 'Adicionar' }).click();
  await expect(encounter.getByRole('list', { name: 'Diagnósticos escolhidos' })).toContainText(
    pathology,
  );
  await encounter.getByRole('button', { name: 'Salvar rascunho' }).click();
  await expect(toasts(page).getByText('Rascunho salvo. Só você o vê até finalizar.')).toBeVisible();
  const draft = timeline.getByRole('article', { name: /Atendimento .*Coceira no ouvido direito/ });
  await expect(draft).toContainText('Rascunho');

  // Finalização: os sinais vitais estruturados aparecem no evento.
  await draft.getByRole('button', { name: 'Continuar rascunho' }).click();
  const resume = page.getByRole('dialog', { name: 'Continuar atendimento' });
  await expect(resume.getByLabel('FC (bpm)')).toHaveValue('120');
  await resume.getByRole('button', { name: 'Finalizar atendimento' }).click();
  await expect(toasts(page).getByText('Atendimento registrado na ficha.')).toBeVisible();
  const published = timeline.getByRole('article', {
    name: /Atendimento .*Coceira no ouvido direito/,
  });
  await expect(published).not.toContainText('Rascunho');
  await expect(published.getByRole('list', { name: 'Sinais vitais' })).toContainText('FC 120 bpm');
  await expect(published).toContainText(pathology);

  // Pesagem avulsa (RN-08): entra na curva junto com o peso do atendimento.
  await add.getByRole('button', { name: 'Peso' }).click();
  const weight = page.getByRole('dialog', { name: 'Peso' });
  await weight.getByLabel('Peso (kg)').fill('8,7');
  await weight.getByRole('button', { name: 'Registrar' }).click();
  await expect(toasts(page).getByText('Peso registrado na ficha.')).toBeVisible();
  await page.getByRole('tab', { name: 'Evolução do peso' }).click();
  const curve = page.getByRole('tabpanel', { name: 'Evolução do peso' });
  await expect(curve.getByRole('img', { name: /em 2 registros/ })).toBeVisible();
  await expect(curve.getByRole('table')).toContainText('8,7 kg');
  await expect(curve.getByRole('table')).toContainText('8,4 kg');
  await page.getByRole('tab', { name: 'Linha do tempo' }).click();

  // Filtro por tipo, aplicado no servidor.
  const kinds = timeline.getByRole('group', { name: 'Tipos de evento' });
  await kinds.getByRole('button', { name: 'Peso' }).click();
  await expect(timeline.getByRole('article')).toHaveCount(1);
  await kinds.getByRole('button', { name: 'Peso' }).click();
  await expect(timeline.getByRole('article')).toHaveCount(2);

  // Invalidação com motivo: o evento fica riscado, com o motivo, e sai da curva.
  const weighing = timeline.getByRole('article', { name: /Peso .*8,7 kg/ });
  await weighing.getByRole('button', { name: 'Invalidar' }).click();
  const voiding = page.getByRole('dialog', { name: 'Invalidar peso?' });
  await voiding.getByLabel('Motivo').fill('Balança descalibrada');
  await voiding.getByRole('button', { name: 'Invalidar' }).click();
  await expect(
    toasts(page).getByText('Evento invalidado. Ele continua na linha do tempo, riscado.'),
  ).toBeVisible();
  await expect(weighing).toContainText('Invalidado');
  await expect(weighing).toContainText('Balança descalibrada');
  await page.getByRole('tab', { name: 'Evolução do peso' }).click();
  await expect(curve.getByRole('img', { name: /em 1 registros/ })).toBeVisible();
});

test('ficha clínica no celular: sem rolagem lateral @mobile', async ({ page }) => {
  const { pet } = await seed(page);
  await page.goto(`/atendimento?animal=${encodeURIComponent(pet)}`);
  await page.getByRole('link', { name: new RegExp(pet) }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(pet);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
  await page.getByLabel('Adicionar').getByRole('button', { name: 'Atendimento' }).click();
  const encounter = page.getByRole('dialog', { name: 'Novo atendimento' });
  await expect(encounter.getByRole('button', { name: 'Finalizar atendimento' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
});
