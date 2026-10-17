import type { Client, Patient, Session } from '@clinica/contracts';
import { devices, expect, test, type Page } from '@playwright/test';
import { ADMIN_STATE, run, toasts } from './helpers';

test.use({ storageState: ADMIN_STATE });

// Derivado de `run` para que a busca por `run` de outras telas não ache estes cadastros.
const tag = (Number.parseInt(run, 36) * 11).toString(36);

/**
 * Tutor com um animal, uma pesagem e uma receita publicada, e o portal ligado mostrando tudo.
 * O link de acesso não é criado aqui: o teste usa a tela da ficha do cliente.
 */
async function seed(page: Page, suffix: string) {
  await page.goto('/');
  return page.evaluate(async (suffix) => {
    const session = (await (await fetch('/api/auth/session')).json()) as Session;
    const call = async <T>(method: string, path: string, body?: unknown) => {
      const r = await fetch(`/api${path}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken },
        body: body === undefined ? null : JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text());
      return (await r.json()) as T;
    };
    const types = await call<{ id: string; name: string }[]>('GET', '/catalogs/appointment-types');
    const consulta = types.find((t) => t.name === 'Consulta');
    await call('PUT', '/portal-admin/settings', {
      enabled: true,
      sections: {
        appointments: true,
        weight: true,
        vaccines: true,
        exams: true,
        prescriptions: true,
      },
      booking: {
        enabled: true,
        typeIds: consulta ? [consulta.id] : [],
        leadHours: 2,
        windowDays: 30,
      },
    });
    // Profissional próprio do teste, com agenda de segunda a sexta, para os horários livres.
    const roles = await call<{ id: string; name: string }[]>('GET', '/admin/roles');
    const vet = await call<{ id: string; name: string }>('POST', '/admin/users', {
      name: `Dra. Portal ${suffix}`,
      email: `portal-vet-${suffix}@clinica.local`,
      password: 'senha-local-123',
      roleId: roles.find((r) => r.name === 'Veterinário')?.id,
      unitIds: [session.currentUnit.id],
    });
    await call('PUT', `/schedule/members/${vet.id}`, {
      mode: 'fixed',
      fixedHours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '08:00', end: '18:00' })),
    });
    const email = `tutor-${suffix}@exemplo.com`;
    const client = await call<Client>('POST', '/clients', {
      personType: 'individual',
      name: `Marina Tutora ${suffix}`,
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
      contacts: [
        { kind: 'mobile', value: '(11) 97777-6655', isWhatsapp: true },
        { kind: 'email', value: email, isWhatsapp: false },
      ],
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
    const patient = await call<Patient>('POST', '/patients', {
      clientId: client.id,
      patient: {
        name: `Paçoca ${suffix}`,
        status: 'alive',
        deceasedOn: '',
        sex: 'female',
        sterilized: null,
        birthDate: '2021-03-01',
        speciesId: null,
        breedId: null,
        coatId: null,
        microchip: '',
        hasPedigree: false,
        pedigreeNumber: '',
        markings: [],
      },
    });
    const event = (body: Record<string, unknown>) =>
      call('POST', `/clinical/patients/${patient.id}/events`, { occurredAt: null, ...body });
    await event({ kind: 'weight', weightKg: 8.35, notes: '' });
    await event({
      kind: 'prescription',
      templateId: null,
      title: `Receita de antibiótico ${suffix}`,
      body: 'Amoxicilina 250 mg\n1 comprimido a cada 12 horas por 7 dias.',
      publish: true,
    });
    await event({
      kind: 'prescription',
      templateId: null,
      title: `Rascunho ${suffix}`,
      body: 'Ainda não revisada.',
      publish: false,
    });
    return { client, patient, email, vet };
  }, suffix);
}

/** Gera o link pela ficha do cliente e devolve só o caminho, para abrir no servidor do teste. */
async function inviteFromClientPage(page: Page, clientId: string, email: string, button: string) {
  await page.goto(`/clientes/${clientId}`);
  const section = page.getByRole('region', { name: 'Portal do cliente' });
  await section.getByRole('button', { name: button }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('E-mail de login')).toHaveValue(email);
  await dialog.getByRole('button', { name: 'Gerar link' }).click();
  const link = dialog.getByLabel('Link de acesso');
  await expect(link).toHaveValue(/\/portal\/acesso\/[\w-]{43}$/);
  await expect(dialog.getByRole('link', { name: 'Enviar pelo WhatsApp' })).toHaveAttribute(
    'href',
    /^https:\/\/wa\.me\/5511977776655\?text=.*portal%2Facesso/,
  );
  const path = new URL(await link.inputValue()).pathname;
  await dialog.getByRole('button', { name: 'Concluir' }).click();
  return path;
}

test('portal do tutor: convite pela ficha, senha pelo link e o que a clínica mostra', async ({
  page,
  browser,
}) => {
  const { client, patient, email } = await seed(page, `p${tag}`);
  const path = await inviteFromClientPage(page, client.id, email, 'Convidar para o portal');
  const section = page.getByRole('region', { name: 'Portal do cliente' });
  await expect(section).toContainText('Convite enviado');
  await expect(section).toContainText('Link válido até');

  // O tutor abre o link num navegador sem sessão da equipe.
  const tutorContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const tutor = await tutorContext.newPage();
  await tutor.goto(path);
  await expect(tutor.getByRole('heading', { name: 'Crie a sua senha' })).toBeVisible();
  await expect(tutor.getByText(email)).toBeVisible();
  await tutor.getByLabel('Nova senha').fill('senha-do-tutor-1');
  await tutor.getByLabel('Repita a senha').fill('senha-diferente-1');
  await tutor.getByRole('button', { name: 'Criar senha e entrar' }).click();
  await expect(tutor.getByText('As senhas não conferem')).toBeVisible();
  await tutor.getByLabel('Repita a senha').fill('senha-do-tutor-1');
  await tutor.getByRole('button', { name: 'Criar senha e entrar' }).click();

  await expect(tutor).toHaveURL(/\/portal$/);
  await expect(tutor.getByRole('heading', { name: 'Seus animais', level: 1 })).toBeVisible();
  await expect(tutor.getByText(`Portal do tutor · ${client.name}`)).toBeVisible();
  await expect(tutor.getByRole('region', { name: 'Próximos agendamentos' })).toContainText(
    'Nenhum agendamento marcado',
  );
  await tutor.getByRole('link', { name: new RegExp(patient.name) }).click();
  await expect(tutor.getByRole('heading', { name: patient.name, level: 1 })).toBeVisible();
  await expect(tutor.getByRole('region', { name: 'Peso' })).toContainText('8,35');
  const receitas = tutor.getByRole('region', { name: 'Receitas' });
  await expect(receitas).toContainText(`Receita de antibiótico p${tag}`);
  await expect(receitas).not.toContainText(`Rascunho p${tag}`);
  await receitas.getByText(`Receita de antibiótico p${tag}`).click();
  await expect(receitas.getByText('1 comprimido a cada 12 horas por 7 dias.')).toBeVisible();

  // O link vale uma vez.
  const reuse = await tutorContext.newPage();
  await reuse.goto(path);
  await expect(reuse.getByRole('heading', { name: 'Link expirado' })).toBeVisible();
  await reuse.close();

  // Sair e entrar de novo com o e-mail e a senha.
  await tutor.getByRole('button', { name: 'Sair' }).click();
  await expect(tutor.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await tutor.getByLabel('E-mail').fill(email);
  await tutor.getByLabel('Senha').fill('senha-errada-12');
  await tutor.getByRole('button', { name: 'Entrar' }).click();
  await expect(tutor.getByRole('alert')).toContainText('E-mail ou senha inválidos');
  await tutor.getByLabel('Senha').fill('senha-do-tutor-1');
  await tutor.getByRole('button', { name: 'Entrar' }).click();
  await expect(tutor.getByRole('heading', { name: 'Seus animais', level: 1 })).toBeVisible();

  // A equipe vê o último acesso e bloqueia; o tutor cai na entrada.
  await page.reload();
  await expect(section).toContainText('Ativo');
  await expect(section).not.toContainText('Nunca entrou');
  await section.getByRole('button', { name: 'Bloquear' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Bloquear acesso' }).click();
  await expect(toasts(page)).toContainText('Acesso ao portal bloqueado.');
  await tutor.reload();
  await expect(tutor.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await tutorContext.close();
});

test('recuperar senha do portal e configurar o que o tutor vê', async ({ page, browser }) => {
  const { client, patient, email } = await seed(page, `r${tag}`);
  const invite = await inviteFromClientPage(page, client.id, email, 'Convidar para o portal');
  const tutorContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const tutor = await tutorContext.newPage();
  await tutor.goto(invite);
  await tutor.getByLabel('Nova senha').fill('senha-do-tutor-1');
  await tutor.getByLabel('Repita a senha').fill('senha-do-tutor-1');
  await tutor.getByRole('button', { name: 'Criar senha e entrar' }).click();
  await expect(tutor.getByRole('heading', { name: 'Seus animais', level: 1 })).toBeVisible();

  const reset = await inviteFromClientPage(page, client.id, email, 'Recuperar senha do Portal');
  await tutor.goto(reset);
  await expect(tutor.getByRole('heading', { name: 'Troque a sua senha' })).toBeVisible();
  await tutor.getByLabel('Nova senha').fill('senha-nova-do-tutor');
  await tutor.getByLabel('Repita a senha').fill('senha-nova-do-tutor');
  await tutor.getByRole('button', { name: 'Trocar senha e entrar' }).click();
  await expect(tutor.getByRole('heading', { name: 'Seus animais', level: 1 })).toBeVisible();

  // Configuração: a seção desligada some do portal.
  await page.goto('/configuracao/portal');
  await expect(page.getByRole('heading', { name: 'Portal do tutor', level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Clientes com acesso' })).toContainText(email);
  const peso = page.getByRole('checkbox', { name: /^Peso/ });
  await expect(peso).toBeChecked();
  await peso.click();
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(toasts(page)).toContainText('Portal ligado e configuração salva.');
  await tutor.goto(`/portal/animais/${patient.id}`);
  await expect(tutor.getByRole('region', { name: 'Receitas' })).toBeVisible();
  await expect(tutor.getByRole('region', { name: 'Peso' })).toHaveCount(0);

  await peso.click();
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(toasts(page)).toContainText('configuração salva');
  await tutorContext.close();
});

test('portal do tutor no celular sem rolagem lateral @mobile', async ({ page, browser }) => {
  const { client, patient, email } = await seed(page, `m${tag}`);
  const path = await inviteFromClientPage(page, client.id, email, 'Convidar para o portal');
  const tutorContext = await browser.newContext({
    ...devices['Pixel 7'],
    storageState: { cookies: [], origins: [] },
  });
  const tutor = await tutorContext.newPage();
  const overflow = () =>
    tutor.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await tutor.goto(path);
  await expect(tutor.getByRole('heading', { name: 'Crie a sua senha' })).toBeVisible();
  expect(await overflow(), 'link').toBe(0);
  await tutor.getByLabel('Nova senha').fill('senha-do-tutor-1');
  await tutor.getByLabel('Repita a senha').fill('senha-do-tutor-1');
  await tutor.getByRole('button', { name: 'Criar senha e entrar' }).click();
  await expect(tutor.getByRole('heading', { name: 'Seus animais', level: 1 })).toBeVisible();
  expect(await overflow(), 'home').toBe(0);
  await tutor.goto(`/portal/animais/${patient.id}`);
  await expect(tutor.getByRole('region', { name: 'Receitas' })).toBeVisible();
  expect(await overflow(), 'animal').toBe(0);
  await page.goto('/configuracao/portal');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    'configuração',
  ).toBe(0);
  await tutorContext.close();
});

/** Próximo dia útil a partir de depois de amanhã, no fuso da clínica. */
function nextWeekday(): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
    new Date(),
  );
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 2);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Com mais de um profissional livre, escolhe o do teste; com um só, o seletor não aparece. */
async function chooseProfessional(tutor: Page, name: string) {
  await expect(tutor.getByRole('radiogroup', { name: 'Horários livres' })).toBeVisible();
  const professional = tutor.getByLabel('Profissional', { exact: true });
  if ((await professional.count()) > 0) await professional.selectOption({ label: name });
}

test('agendamento online: o tutor marca um horário livre e cancela', async ({ page, browser }) => {
  const { client, patient, email, vet } = await seed(page, `a${tag}`);
  const path = await inviteFromClientPage(page, client.id, email, 'Convidar para o portal');
  const tutorContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const tutor = await tutorContext.newPage();
  await tutor.goto(path);
  await tutor.getByLabel('Nova senha').fill('senha-do-tutor-1');
  await tutor.getByLabel('Repita a senha').fill('senha-do-tutor-1');
  await tutor.getByRole('button', { name: 'Criar senha e entrar' }).click();

  await tutor.getByRole('link', { name: 'Agendar horário' }).click();
  await expect(tutor.getByRole('heading', { name: 'Agendar horário', level: 1 })).toBeVisible();
  await expect(tutor.getByRole('checkbox', { name: patient.name })).toBeChecked();
  await tutor.getByRole('button', { name: 'Confirmar agendamento' }).click();
  await expect(tutor.getByRole('alert')).toContainText('Escolha o dia');

  await expect(tutor.getByLabel('Atendimento', { exact: true })).toHaveValue(/.+/);
  await tutor
    .getByLabel('Atendimento', { exact: true })
    .selectOption({ label: 'Consulta (60 min)' });
  const day = nextWeekday();
  await tutor.getByLabel('Dia', { exact: true }).fill(day);
  await chooseProfessional(tutor, vet.name);
  const slot = tutor.getByRole('radio', { name: `17:00 com ${vet.name}` });
  await slot.click();
  await expect(slot).toHaveAttribute('aria-checked', 'true');
  await tutor.getByLabel('Observações (opcional)').fill('Ele fica nervoso no carro.');
  await tutor.getByRole('button', { name: 'Confirmar agendamento' }).click();
  await expect(tutor.getByRole('heading', { name: 'Seus animais', level: 1 })).toBeVisible();
  const next = tutor.getByRole('region', { name: 'Próximos agendamentos' });
  await expect(next).toContainText(`Consulta · ${patient.name}`);
  await expect(next).toContainText(vet.name);

  // A equipe vê o agendamento na agenda, marcado pelo portal.
  const staff = await page.evaluate(
    async ({ day, vetId }) => {
      const r = await fetch(`/api/schedule/agenda?from=${day}&to=${day}&professionalId=${vetId}`);
      return (await r.json()) as {
        appointments: { start: string; bookedOnline: boolean; notes: string | null }[];
      };
    },
    { day, vetId: vet.id },
  );
  expect(staff.appointments).toEqual([
    expect.objectContaining({
      start: '17:00',
      bookedOnline: true,
      notes: 'Ele fica nervoso no carro.',
    }),
  ]);

  // O horário sai da lista e o tutor cancela.
  await tutor.getByRole('link', { name: 'Agendar horário' }).click();
  await tutor
    .getByLabel('Atendimento', { exact: true })
    .selectOption({ label: 'Consulta (60 min)' });
  await tutor.getByLabel('Dia', { exact: true }).fill(day);
  await chooseProfessional(tutor, vet.name);
  await expect(tutor.getByRole('radio', { name: `16:00 com ${vet.name}` })).toBeVisible();
  await expect(tutor.getByRole('radio', { name: `17:00 com ${vet.name}` })).toHaveCount(0);
  await tutor.getByRole('link', { name: 'Seus animais' }).click();
  await next.getByRole('button', { name: /^Cancelar Consulta/ }).click();
  await tutor.getByRole('dialog').getByRole('button', { name: 'Cancelar agendamento' }).click();
  await expect(next).not.toContainText(vet.name);
  await tutorContext.close();
});
