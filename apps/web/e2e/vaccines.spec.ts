import type { CatalogItem, Client, Session } from '@clinica/contracts';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STATE, run, sidebar, toasts } from './helpers';

test.use({ storageState: ADMIN_STATE });

const tag = run.split('').reverse().join('');

/** Dia `days` a partir de hoje no fuso da unidade (o do navegador nos testes), em AAAA-MM-DD. */
function day(days: number) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const br = (iso: string) => iso.split('-').reverse().join('/');

/** Cão com responsável, via API: o cadastro não é o objeto deste teste. */
async function seedDog(page: Page, label: string) {
  await page.goto('/');
  return page.evaluate(
    async ({ suffix, label }) => {
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
      const dog = species.find((s) => s.name === 'Canina') ?? species[0];
      if (!dog) throw new Error('Sem espécies semeadas');
      const client = await send<Client>('/clients', {
        personType: 'individual',
        name: `Tutor Vacina ${suffix}`,
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
      const pet = `${label} ${suffix}`;
      const created = await send<{ id: string }>('/patients', {
        clientId: client.id,
        patient: {
          name: pet,
          status: 'alive',
          deceasedOn: '',
          sex: 'female',
          sterilized: null,
          birthDate: '',
          speciesId: dog.id,
          breedId: null,
          coatId: null,
          microchip: '',
          hasPedigree: false,
          pedigreeNumber: '',
          markings: [],
        },
      });
      return { pet, patientId: created.id };
    },
    { suffix: tag, label },
  );
}

test('vacinas: protocolo do cadastro, dose sugerida, consulta Vacinação e encerramento', async ({
  page,
}) => {
  const { pet, patientId } = await seedDog(page, 'Mel');
  const vaccine = `V10 ${tag}`;

  // Cadastro com série inicial e reforço (F2-2).
  await sidebar(page).getByRole('link', { name: 'Vacinas', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Vacinas');
  await page.getByRole('button', { name: 'Adicionar' }).click();
  const form = page.getByRole('dialog', { name: 'Nova vacina' });
  await form.getByLabel('Nome').fill(vaccine);
  await form.getByLabel('Doses da série').selectOption('3');
  await form.getByRole('button', { name: 'Salvar' }).click();
  await expect(form.getByText('Informe o intervalo entre as doses')).toBeVisible();
  await form.getByLabel('Intervalo (dias)').fill('21');
  await expect(form.getByText('Protocolo: 3 doses a cada 21 dias, depois anual.')).toBeVisible();
  await form.getByRole('button', { name: 'Salvar' }).click();
  await expect(toasts(page).getByText('Vacina incluída.')).toBeVisible();
  await expect(page.getByText(vaccine, { exact: true })).toBeVisible();

  // 1ª dose aplicada há 30 dias: a próxima (21 dias depois) já venceu.
  await page.goto(`/atendimento/${patientId}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(pet);
  await page.getByLabel('Adicionar').getByRole('button', { name: 'Vacina' }).click();
  const apply = page.getByRole('dialog', { name: 'Aplicar vacina' });
  await apply.getByLabel('Vacina', { exact: true }).selectOption({ label: vaccine });
  await expect(apply.getByLabel('Dose', { exact: true })).toHaveValue('1');
  await expect(apply.getByLabel('Próxima dose')).toHaveValue(day(21));
  await apply.getByLabel('Data e hora').fill(`${day(-30)}T10:00`);
  await expect(apply.getByLabel('Próxima dose')).toHaveValue(day(-9));
  await apply.getByLabel('Lote').fill('AB123');
  await apply.getByRole('button', { name: 'Registrar aplicação' }).click();
  await expect(toasts(page).getByText('Aplicação registrada na ficha.')).toBeVisible();
  const timeline = page.getByRole('tabpanel', { name: 'Linha do tempo' });
  const applied = timeline.getByRole('article', { name: new RegExp(`${vaccine} · 1ª dose`) });
  await expect(applied).toContainText(`Próxima dose:${br(day(-9))}`);
  await expect(applied).toContainText('AB123');

  await page.getByRole('tab', { name: 'Protocolos' }).click();
  const protocols = page.getByRole('tabpanel', { name: 'Protocolos' });
  await expect(protocols.getByRole('listitem')).toContainText('Vencida');

  // Busca ativa: o animal aparece com o contato do responsável.
  await sidebar(page).getByRole('link', { name: 'Vacinação' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Vacinação');
  await page.getByRole('group', { name: 'Situação' }).getByText('Vencidas').click();
  await expect(page).toHaveURL(/situacao=vencidas/);
  const row = page.getByRole('row', { name: new RegExp(pet) });
  await expect(row).toContainText('Vencida há 9 dias');
  await expect(row.getByRole('link', { name: `WhatsApp de Tutor Vacina ${tag}` })).toBeVisible();

  // Aplicar pelo protocolo: 2ª dose sugerida, próxima em 21 dias.
  await row.getByRole('link', { name: pet }).click();
  await page.getByRole('tab', { name: 'Protocolos' }).click();
  await protocols.getByRole('button', { name: 'Aplicar' }).click();
  const second = page.getByRole('dialog', { name: 'Aplicar vacina' });
  await expect(second.getByLabel('Dose', { exact: true })).toHaveValue('2');
  await expect(second.getByLabel('Próxima dose')).toHaveValue(day(21));
  await second.getByRole('button', { name: 'Registrar aplicação' }).click();
  await expect(second).toBeHidden();
  await expect(protocols.getByRole('listitem')).toContainText('A vencer');
  await expect(protocols.getByRole('listitem')).toContainText('2 aplicações');

  // Encerrar: exige motivo e tira o animal da consulta.
  await protocols.getByRole('button', { name: `Encerrar protocolo de ${vaccine}` }).click();
  const close = page.getByRole('dialog', { name: `Encerrar ${vaccine}?` });
  await close.getByRole('button', { name: 'Encerrar protocolo' }).click();
  await expect(close.getByText('Explique o motivo em poucas palavras')).toBeVisible();
  await close.getByLabel('Motivo').fill('Tutor mudou de cidade');
  await close.getByRole('button', { name: 'Encerrar protocolo' }).click();
  await expect(close).toBeHidden();
  await expect(protocols.getByRole('listitem')).toContainText('Encerrado');
  await expect(protocols.getByRole('listitem')).toContainText('Tutor mudou de cidade');

  await page.goto(`/consultas/vacinacao?ate=${day(30)}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Vacinação');
  await expect(page.getByRole('row', { name: new RegExp(pet) })).toHaveCount(0);
});

test('vacinação no celular: consulta e protocolos sem rolagem lateral @mobile', async ({
  page,
}) => {
  const { pet, patientId } = await seedDog(page, 'Pipoca');
  const vaccine = await page.evaluate(async (name) => {
    const session = (await (await fetch('/api/auth/session')).json()) as Session;
    const r = await fetch('/api/vaccines', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken },
      body: JSON.stringify({
        name,
        kind: 'dewormer',
        primaryDoses: 1,
        primaryIntervalDays: null,
        boosterIntervalDays: 90,
        serviceId: null,
        archived: false,
      }),
    });
    if (!r.ok) throw new Error(await r.text());
    return (await r.json()) as { id: string };
  }, `Vermífugo ${tag}`);
  await page.goto(`/atendimento/${patientId}`);
  await page.getByLabel('Adicionar').getByRole('button', { name: 'Vacina' }).click();
  const apply = page.getByRole('dialog', { name: 'Aplicar vacina' });
  await apply.getByLabel('Vacina', { exact: true }).selectOption(vaccine.id);
  await apply.getByLabel('Próxima dose').fill(day(5));
  await apply.getByRole('button', { name: 'Registrar aplicação' }).click();
  await expect(apply).toBeHidden();
  await page.getByRole('tab', { name: 'Protocolos' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Protocolos' })).toContainText('A vencer');
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(await overflow()).toBe(0);

  await page.goto('/consultas/vacinacao?situacao=a-vencer');
  await expect(page.getByRole('row', { name: new RegExp(pet) })).toContainText('Vence em 5 dias');
  expect(await overflow()).toBe(0);
});
