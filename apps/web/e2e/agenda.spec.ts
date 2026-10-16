import type { Client, Role, Session } from '@clinica/contracts';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STATE, run, sidebar, toasts } from './helpers';

test.use({ storageState: ADMIN_STATE });

/** Segunda-feira daqui a pelo menos uma semana, no fuso da clínica. */
function nextMonday(): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
    new Date(),
  );
  let t = Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000;
  while (new Date(t).getUTCDay() !== 1) t += 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Prepara via API o que não é objeto do teste: um profissional e um cliente com animal. */
async function seed(page: Page) {
  await page.goto('/');
  return page.evaluate(async (suffix) => {
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
    const roles = (await (await fetch('/api/admin/roles')).json()) as Role[];
    const vet = roles.find((r) => r.name === 'Veterinário');
    if (!vet) throw new Error('Perfil Veterinário ausente');
    const professional = `Dra. Agenda ${suffix}`;
    await send<unknown>('POST', '/admin/users', {
      name: professional,
      email: `agenda-${suffix}@clinica.test`,
      password: 'senha-agenda-123',
      roleId: vet.id,
      unitIds: [session.currentUnit.id],
    });
    const tutor = `Tutor Agenda ${suffix}`;
    const client = await send<Client>('POST', '/clients', {
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
      contacts: [{ kind: 'mobile', value: '11977776666', isWhatsapp: true }],
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
    const pet = `Bolota ${suffix}`;
    await send<unknown>('POST', '/patients', {
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
        markings: ['Alergia a dipirona'],
      },
    });
    return { professional, tutor, pet };
  }, run);
}

test('agenda: configura profissional, agenda no horário livre e percorre o ciclo de status', async ({
  page,
}) => {
  const { professional, tutor, pet } = await seed(page);
  const date = nextMonday();

  // Configuração: profissional com horário fixo Seg–Sex 09:00–18:00 (RN-11).
  await sidebar(page).getByRole('link', { name: 'Configuração da agenda' }).click();
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  const memberDialog = page.getByRole('dialog', { name: 'Adicionar profissional à agenda' });
  await memberDialog.getByLabel('Usuário').selectOption({ label: professional });
  await memberDialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(toasts(page).getByText('Profissional incluído na agenda.')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: professional })).toContainText(
    'Seg, Ter, Qua, Qui, Sex 09:00–18:00',
  );

  // Agendamento em dois passos com horário livre já cruzado com o profissional (RN-12).
  await sidebar(page).getByRole('link', { name: 'Agenda', exact: true }).click();
  await page.getByRole('button', { name: 'Novo agendamento' }).click();
  const booking = page.getByRole('dialog', { name: 'Novo agendamento' });
  await booking.getByLabel('Localizar cliente').fill(tutor);
  await booking.getByRole('button', { name: pet }).click();
  await booking.getByLabel('Tipo de atendimento').selectOption({ label: 'Consulta' });
  await booking.getByLabel('Data', { exact: true }).fill(date);
  await booking.getByLabel('Profissional', { exact: true }).selectOption({ label: professional });
  const slots = booking.getByRole('radiogroup', { name: 'Horários livres' });
  await expect(slots.getByRole('radio').first()).toHaveText(`09:00 – ${professional}`);
  await expect(slots.getByRole('radio').last()).toHaveText(`17:00 – ${professional}`);
  await slots.getByRole('radio', { name: `09:00 – ${professional}` }).click();
  await booking.getByRole('button', { name: 'Agendar' }).click();
  await expect(toasts(page).getByText('Agendamento criado.')).toBeVisible();

  // A agenda abre no dia do agendamento; o bloco mostra responsável – animal.
  await page.getByLabel('Profissional', { exact: true }).selectOption({ label: professional });
  const block = page.getByRole('button', { name: new RegExp(`09:00 às 10:00, ${tutor} – ${pet}`) });
  await expect(block).toBeVisible();

  // O horário ocupado some dos livres (sem conflito na origem).
  await page.getByRole('button', { name: 'Novo agendamento' }).click();
  await booking.getByLabel('Localizar cliente').fill(tutor);
  await booking.getByRole('button', { name: pet }).click();
  await booking.getByLabel('Data', { exact: true }).fill(date);
  await booking.getByLabel('Profissional', { exact: true }).selectOption({ label: professional });
  await expect(slots.getByRole('radio').first()).toHaveText(`10:00 – ${professional}`);
  await booking.getByRole('button', { name: 'Cancelar' }).click();

  // Ciclo de status com marcos de tempo (RN-13); marcação do animal em destaque.
  await block.click();
  const detail = page.getByRole('dialog', { name: `${tutor} – ${pet}` });
  await expect(detail.getByText(`${pet}: Alergia a dipirona`)).toBeVisible();
  for (const [action, label] of [
    ['Confirmar', 'Confirmado'],
    ['Registrar chegada', 'Em espera'],
    ['Iniciar atendimento', 'Em atendimento'],
    ['Animal pronto', 'Animal pronto'],
  ] as const) {
    await detail.getByRole('button', { name: action }).click();
    // Com o diálogo aberto, o aviso fica fora da árvore acessível; confere o selo de status.
    await expect(detail.getByText(label, { exact: true }).first()).toBeVisible();
    await expect(detail.getByRole('button', { name: action })).toHaveCount(0);
  }
  await expect(detail.getByText('Início do atendimento')).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Remarcar ou editar' })).toHaveCount(0);
  await detail.getByRole('button', { name: 'Fechar' }).first().click();
  await expect(block).toHaveAccessibleName(/Animal pronto$/);
});

test('agenda no celular: grade rola dentro do painel, sem estourar a página @mobile', async ({
  page,
}) => {
  await page.goto('/agenda?view=semana');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Semana de');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.goto('/agenda/escala');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Escala');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
});
