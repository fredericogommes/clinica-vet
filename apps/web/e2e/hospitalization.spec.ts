import type { CatalogItem, Client, Patient, Session } from '@clinica/contracts';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STATE, run, sidebar, toasts } from './helpers';

test.use({ storageState: ADMIN_STATE });

// Sufixo próprio: a busca por `run` em outros testes não deve achar estes cadastros.
const tag = `in${Array.from(run).reverse().join('')}`;

/** Cliente com um cão, via API. */
async function seed(page: Page, petName = 'Bob') {
  await page.goto('/');
  return page.evaluate(
    async ({ suffix, petName }) => {
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
      const pet = `${petName} ${suffix}`;
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
    },
    { suffix: tag, petName },
  );
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

test('prescrição: dose pelo peso, execução, mapa de execução e suspensão', async ({ page }) => {
  const { pet, patientId } = await seed(page, 'Rex');
  const id = await page.evaluate(async (patientId) => {
    const session = (await (await fetch('/api/auth/session')).json()) as Session;
    const send = async (path: string, body: unknown) => {
      const r = await fetch(`/api${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`${path}: ${await r.text()}`);
      return (await r.json()) as { id: string };
    };
    const h = await send('/hospitalizations', {
      patientId,
      veterinarianId: session.user.id,
      priority: 'attention',
      reason: 'Pós-operatório',
      expectedDischargeOn: null,
      boxId: null,
    });
    await send(`/hospitalizations/${h.id}/entries`, { kind: 'weight', weightKg: 12.4, text: '' });
    return h.id;
  }, patientId);

  await page.goto(`/internacao/${id}`);
  await page.getByRole('tab', { name: 'Prescrição médica' }).click();
  await expect(page.getByText('Nenhuma prescrição neste dia')).toBeVisible();
  await page.getByRole('button', { name: 'Prescrever' }).click();
  const form = page.getByRole('dialog', { name: 'Nova prescrição' });
  await form.getByRole('button', { name: 'Prescrever' }).click();
  await expect(form.getByText('Informe o medicamento')).toBeVisible();
  await form.getByLabel('Medicamento').fill('Dipirona');
  await form.getByLabel('Dose', { exact: true }).fill('25');
  await form.getByLabel('Concentração (mg/mL)').fill('500');
  // Dose por horário calculada pelo peso atual: 25 mg/kg × 12,4 kg = 310 mg ÷ 500 mg/mL.
  await expect(form.getByRole('status')).toContainText('310 mg · 0,62 mL');
  await form.getByLabel('Duração (dias)').fill('3');
  await form.getByRole('button', { name: 'Prescrever' }).click();
  await expect(toasts(page).getByText('Dipirona prescrito.')).toBeVisible();

  const grid = page.getByRole('table', { name: /Prescrições de/ });
  const row = grid.getByRole('row').filter({ hasText: 'Dipirona' });
  await expect(row).toContainText('25 mg/kg IV a cada 8 h');
  await expect(row).toContainText('310 mg · 0,62 mL');
  const dose = row.getByRole('button', { name: /^Dipirona às .*: Programado$/ }).first();
  await dose.click();
  const execute = page.getByRole('dialog', { name: /^Dipirona às/ });
  await expect(execute).toContainText('310 mg · 0,62 mL');
  await execute.getByText('Não executado', { exact: true }).click();
  await execute.getByRole('button', { name: 'Registrar' }).click();
  await expect(execute.getByText('Diga por que não foi executado')).toBeVisible();
  await execute.getByText('Executado', { exact: true }).click();
  await execute.getByLabel('Observações').fill('Aplicado lento');
  await execute.getByRole('button', { name: 'Registrar' }).click();
  await expect(toasts(page).getByText('Executado: Dipirona.')).toBeVisible();
  await expect(row.getByRole('button', { name: /: Executado$/ })).toHaveCount(1);

  // Detalhe do horário executado: quem, quando e a dose aplicada.
  await row.getByRole('button', { name: /: Executado$/ }).click();
  const done = page.getByRole('dialog', { name: /^Dipirona às/ });
  await expect(done).toContainText('Executado em');
  await expect(done).toContainText('Aplicado lento');
  await expect(done).toContainText('310 mg · 0,62 mL');
  await done.getByRole('button', { name: 'Voltar' }).click();

  await page.getByRole('tab', { name: 'Histórico' }).click();
  const entries = page
    .getByRole('list', { name: 'Histórico da internação' })
    .locator(':scope > li');
  await expect(entries.first()).toContainText('Executado: Dipirona 310 mg (0,62 mL) IV');
  await expect(entries.nth(1)).toContainText('Dipirona: 25 mg/kg IV a cada 8 h, por 3 dias');

  // Mapa de execução: o animal com o horário registrado.
  await sidebar(page).getByRole('link', { name: 'Mapa de execução' }).click();
  await page.getByLabel('Buscar no mapa').fill(pet);
  const mapRow = page.getByRole('row').filter({ hasText: pet });
  await expect(mapRow).toHaveCount(1);
  await expect(mapRow.getByRole('cell', { name: /1 registrado/ })).toHaveCount(1);
  await mapRow.getByRole('link', { name: pet }).click();
  await expect(page.getByRole('tab', { name: 'Prescrição médica' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await page.getByRole('button', { name: 'Suspender' }).click();
  const stop = page.getByRole('dialog', { name: 'Suspender Dipirona' });
  await stop.getByLabel('Motivo da suspensão').fill('Dor controlada');
  await stop.getByRole('button', { name: 'Suspender' }).click();
  await expect(toasts(page).getByText('Dipirona suspenso.')).toBeVisible();
  await expect(page.getByRole('table', { name: /Prescrições de/ })).toContainText('Dor controlada');
});

test('modelo de prescrição, mensagem ao tutor e impressão da ficha', async ({ page, context }) => {
  const { pet, patientId } = await seed(page, 'Mel');
  const id = await page.evaluate(async (patientId) => {
    const session = (await (await fetch('/api/auth/session')).json()) as Session;
    const send = async (path: string, body: unknown) => {
      const r = await fetch(`/api${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`${path}: ${await r.text()}`);
      return (await r.json()) as { id: string };
    };
    const h = await send('/hospitalizations', {
      patientId,
      veterinarianId: session.user.id,
      priority: 'routine',
      reason: 'Pós-operatório de mastectomia',
      expectedDischargeOn: null,
      boxId: null,
    });
    await send(`/hospitalizations/${h.id}/entries`, { kind: 'weight', weightKg: 10, text: '' });
    const at = new Date(Date.now() + 3_600_000).toISOString();
    for (const name of ['Meloxicam', 'Cefalexina']) {
      await send(`/hospitalizations/${h.id}/prescriptions`, {
        name,
        dose: name === 'Meloxicam' ? 0.1 : 30,
        doseUnit: 'mg/kg',
        concentration: name === 'Meloxicam' ? 2 : null,
        route: name === 'Meloxicam' ? 'SC' : 'VO',
        intervalHours: name === 'Meloxicam' ? 24 : 12,
        firstAt: at,
        durationDays: 5,
        notes: '',
      });
    }
    return h.id;
  }, patientId);
  const model = `Pós-cirúrgico ${tag}`;

  // Salvar como modelo só com o anti-inflamatório.
  await page.goto(`/internacao/${id}?aba=prescricao`);
  await page.getByRole('button', { name: 'Salvar como modelo' }).click();
  const save = page.getByRole('dialog', { name: 'Salvar como modelo' });
  await save.getByLabel('Nome do modelo').fill(model);
  await save.getByRole('checkbox', { name: /Cefalexina/ }).click();
  await save.getByRole('button', { name: 'Salvar modelo' }).click();
  await expect(toasts(page).getByText(`Modelo ${model} salvo.`)).toBeVisible();

  // Usar modelo: prescreve de uma vez, com a dose calculada para o peso.
  await page.getByRole('button', { name: 'Usar modelo' }).click();
  const apply = page.getByRole('dialog', { name: 'Usar modelo de prescrição' });
  const select = apply.getByRole('combobox', { name: 'Modelo' });
  const value = await select.locator('option', { hasText: model }).getAttribute('value');
  await select.selectOption(value ?? '');
  const items = apply.getByRole('list', { name: 'Prescrições do modelo' });
  await expect(items.getByRole('listitem')).toHaveCount(1);
  await expect(items).toContainText('1 mg · 0,5 mL');
  await apply.getByRole('button', { name: 'Prescrever modelo' }).click();
  await expect(toasts(page).getByText(`1 prescrição do modelo ${model}.`)).toBeVisible();
  const grid = page.getByRole('table', { name: /Prescrições de/ });
  await expect(grid.getByRole('row').filter({ hasText: 'Meloxicam' })).toHaveCount(2);

  // Mensagem ao tutor: fica no histórico e sai pronta para o WhatsApp.
  await page.getByRole('tab', { name: 'Histórico' }).click();
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  const message = page.getByRole('dialog', { name: 'Enviar mensagem ao tutor' });
  const box = message.getByRole('textbox', { name: 'Mensagem' });
  await expect(box).toHaveValue(new RegExp(`Notícias do ${pet}`));
  await box.fill('Mel comeu bem e está caminhando.');
  await message.getByRole('button', { name: 'Registrar mensagem' }).click();
  const sent = page.getByRole('dialog', { name: 'Mensagem registrada' });
  await expect(sent).toContainText('Mel comeu bem e está caminhando.');
  await sent.getByRole('button', { name: 'Concluir' }).click();
  const entries = page
    .getByRole('list', { name: 'Histórico da internação' })
    .locator(':scope > li');
  await expect(entries.first()).toContainText('Mensagem ao tutor');
  await expect(entries.first()).toContainText('Mel comeu bem e está caminhando.');

  // Imprimir abre a ficha em folha própria, com prescrição e histórico.
  const [sheet] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('link', { name: 'Imprimir' }).click(),
  ]);
  await expect(sheet.getByRole('heading', { level: 1 })).toContainText('Ficha de internação nº');
  await expect(sheet.getByText(pet).first()).toBeVisible();
  await expect(sheet.getByRole('table')).toContainText('Meloxicam');
  await expect(sheet.getByText('Mel comeu bem e está caminhando.')).toBeVisible();
  await sheet.close();

  // O modelo de teste sai da lista para não acumular.
  await page.getByRole('tab', { name: 'Prescrição médica' }).click();
  await page.getByRole('button', { name: 'Usar modelo' }).click();
  await select.selectOption(value ?? '');
  page.once('dialog', (d) => void d.accept());
  await apply.getByRole('button', { name: 'Excluir modelo' }).click();
  await expect(select.locator('option', { hasText: model })).toHaveCount(0);
});

test('internação no celular sem rolagem lateral @mobile', async ({ page }) => {
  for (const path of [
    '/internacao',
    '/internacao/historico',
    '/internacao/mapa',
    '/internacao/boxes',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
  }
});
