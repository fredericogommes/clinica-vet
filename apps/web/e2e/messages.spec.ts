import type { CatalogItem, Client, Session, Vaccine } from '@clinica/contracts';
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

/** Cliente com WhatsApp, um animal e a 1ª dose de uma vacina com a próxima em 2 dias. */
async function seed(page: Page) {
  await page.goto('/');
  return page.evaluate(
    async ({ suffix, nextDueOn }) => {
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
        name: `Bia Mensagem ${suffix}`,
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
        contacts: [{ kind: 'mobile', value: '11966661111', isWhatsapp: true }],
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
      const pet = `Fumaça ${suffix}`;
      const patient = await send<{ id: string }>('/patients', {
        clientId: client.id,
        patient: {
          name: pet,
          status: 'alive',
          deceasedOn: '',
          sex: 'female',
          sterilized: null,
          birthDate: '',
          speciesId: species[0]?.id ?? null,
          breedId: null,
          coatId: null,
          microchip: '',
          hasPedigree: false,
          pedigreeNumber: '',
          markings: [],
        },
      });
      const vaccine = await send<Vaccine>('/vaccines', {
        name: `Giárdia ${suffix}`,
        kind: 'vaccine',
        primaryDoses: 1,
        primaryIntervalDays: null,
        boosterIntervalDays: 365,
        serviceId: null,
        archived: false,
      });
      await send(`/clinical/patients/${patient.id}/events`, {
        kind: 'vaccine',
        occurredAt: null,
        vaccineId: vaccine.id,
        doseNumber: 1,
        lotNumber: '',
        nextDueOn,
        notes: '',
      });
      return { client: client.name, pet, vaccine: vaccine.name };
    },
    { suffix: tag, nextDueOn: day(2) },
  );
}

test('mensagens: texto do lembrete, fila com WhatsApp, enviada pela recepção e cancelamento', async ({
  page,
}) => {
  // Texto próprio do lembrete de vacina, com prévia e variável inválida recusada.
  await page.goto('/');
  await sidebar(page).getByRole('link', { name: 'Mensagens automáticas' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mensagens automáticas');
  const card = page.getByRole('form', { name: 'Lembrete de vacina e vermifugação' });
  await expect(card.getByLabel('Ligada')).toBeChecked();
  const text = card.getByLabel('Texto da mensagem');
  await text.fill(`Oi {cliente}! {animal} precisa da {vacina} até {data}. {exame}`);
  await card.getByRole('button', { name: 'Salvar' }).click();
  await expect(card.getByText('Variável que esta mensagem não conhece: {exame}')).toBeVisible();
  await text.fill(
    `Oi {cliente}! {animal} precisa da {vacina} até {data}. Responda para agendar (${tag}).`,
  );
  await card.getByRole('button', { name: 'Inserir Nome da clínica' }).click();
  await expect(card.getByLabel('Prévia: Lembrete de vacina e vermifugação')).toHaveText(
    `Oi Ana! Thor precisa da Antirrábica até 18/11/2026. Responda para agendar (${tag}).Clínica Exemplo`,
  );
  await text.fill(
    `Oi {cliente}! {animal} precisa da {vacina} até {data}. Responda para agendar (${tag}).`,
  );
  await card.getByLabel('Dias antes').fill('5');
  await card.getByRole('button', { name: 'Salvar' }).click();
  await expect(
    toasts(page).getByText('Lembrete de vacina e vermifugação: alterações salvas.'),
  ).toBeVisible();

  // O lembrete entra na fila com o link do WhatsApp já com o texto.
  const { client, pet, vaccine } = await seed(page);
  await sidebar(page).getByRole('link', { name: 'Fila de mensagens' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fila de mensagens');
  await page.getByRole('button', { name: 'Gerar agora' }).click();
  await expect(toasts(page).getByText(/fila/)).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Mensagem', exact: true })
    .selectOption({ label: 'Lembrete de vacina e vermifugação' });
  await expect(page).toHaveURL(/tipo=vaccine_reminder/);
  const reminder = page.getByRole('listitem', {
    name: `Lembrete de vacina e vermifugação: ${client} · ${pet}`,
  });
  const body = `Oi Bia! ${pet} precisa da ${vaccine} até ${day(2).split('-').reverse().join('/')}. Responda para agendar (${tag}).`;
  await expect(reminder).toContainText(body);
  await expect(reminder.getByRole('link', { name: 'Abrir no WhatsApp' })).toHaveAttribute(
    'href',
    `https://wa.me/5511966661111?text=${encodeURIComponent(body)}`,
  );
  await reminder.getByRole('button', { name: 'Marcar como enviada' }).click();
  await expect(toasts(page).getByText('Mensagem marcada como enviada.')).toBeVisible();
  await expect(reminder).toBeHidden();
  await page
    .getByRole('group', { name: 'Situação' })
    .getByText('Enviadas', { exact: true })
    .click();
  await expect(reminder).toContainText('Enviada por');

  // Boas-vindas do cliente novo: a recepção pode cancelar.
  await page.getByRole('group', { name: 'Situação' }).getByText('Aguardando').click();
  await page
    .getByRole('combobox', { name: 'Mensagem', exact: true })
    .selectOption({ label: 'Boas-vindas para novos clientes' });
  const welcome = page.getByRole('listitem', {
    name: `Boas-vindas para novos clientes: ${client}`,
  });
  await welcome.getByRole('button', { name: `Cancelar mensagem para ${client}` }).click();
  await expect(toasts(page).getByText('Mensagem cancelada.')).toBeVisible();
  await page.getByRole('group', { name: 'Situação' }).getByText('Não enviadas').click();
  await expect(welcome).toContainText('Cancelada');
});

test('mensagens no celular: fila e configuração sem rolagem lateral @mobile', async ({ page }) => {
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.goto('/mensagens?situacao=todas');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fila de mensagens');
  await expect(page.getByText('Aguardando envio').first()).toBeVisible();
  expect(await overflow()).toBe(0);
  await page.goto('/mensagens/automaticas');
  await expect(page.getByRole('form', { name: 'Aniversário do animal' })).toBeVisible();
  expect(await overflow()).toBe(0);
});
