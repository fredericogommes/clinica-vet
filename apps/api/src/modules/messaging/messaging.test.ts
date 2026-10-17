import type {
  ApiError,
  CatalogItem,
  Client,
  ClinicalEventInput,
  Exam,
  MessageList,
  MessageSettingInput,
  MessagingSettings,
  Patient,
  Session,
  Vaccine,
} from '@clinica/contracts';
import { defaultTemplates } from '@clinica/contracts';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../core/ids.js';
import { zonedToInstant } from '../../core/zoned-time.js';
import { appointmentTypes, appointments, appointmentPatients, clients } from '../../db/schema.js';
import { clientInput, patientInput } from '../../test/fixtures.js';
import { ADMIN, createHarness, loginAs, TestClient, type Harness } from '../../test/harness.js';
import type { MessageSender } from './sender.js';
import { MessagingService } from './service.js';

let h: Harness;
let admin: TestClient;
let canina: CatalogItem;
let carla: Client;
let thor: Patient;

const TZ = 'America/Sao_Paulo';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const shift = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const br = (iso: string) => iso.split('-').reverse().join('/');
/** Instante de hoje às `hh:mm` no fuso da clínica. */
const todayAt = (hh: number, mm = 0) => zonedToInstant(today, hh * 60 + mm, TZ);

async function send<T>(method: 'POST' | 'PUT', path: string, body: unknown, status = 200) {
  const res = await admin.send(method, path, body);
  expect(res.statusCode, res.body).toBe(status);
  return res.json<T>();
}
const listOf = async (query = '') =>
  (await admin.get(`/api/messages?situacao=todas${query}`)).json<MessageList>();
const run = async () => (await admin.send('POST', '/api/messages/run')).json<{ created: number }>();
const setting = async (
  patch: Partial<MessageSettingInput> & Pick<MessageSettingInput, 'trigger'>,
) => {
  const current = (await admin.get('/api/messages/settings'))
    .json<MessagingSettings>()
    .settings.find((s) => s.trigger === patch.trigger)!;
  return admin.send('PUT', '/api/messages/settings', {
    enabled: current.enabled,
    offset: current.offset,
    template: current.template,
    providerTemplate: current.providerTemplate,
    ...patch,
  });
};

async function newClient(name: string, overrides: Parameters<typeof clientInput>[0] = {}) {
  return send<Client>('POST', '/api/clients', clientInput({ name, ...overrides }), 201);
}
async function newPatient(client: Client, name: string, birthDate = '') {
  return send<Patient>(
    'POST',
    '/api/patients',
    { clientId: client.id, patient: patientInput({ name, speciesId: canina.id, birthDate }) },
    201,
  );
}
/** Recua o cadastro do cliente, como se ele já existisse antes de o gatilho ser ligado. */
const age = (client: Client, hours: number) =>
  h.db
    .update(clients)
    .set({ createdAt: sql`created_at - make_interval(hours => ${hours})` })
    .where(eq(clients.id, client.id));

async function applyVaccine(patient: Patient, nextDueOn: string) {
  const vaccines = (await admin.get('/api/vaccines')).json<Vaccine[]>();
  const rabies = vaccines.find((v) => v.name === 'Antirrábica')!;
  await send(
    'POST',
    `/api/clinical/patients/${patient.id}/events`,
    {
      kind: 'vaccine',
      occurredAt: null,
      vaccineId: rabies.id,
      doseNumber: 1,
      lotNumber: '',
      nextDueOn,
      notes: '',
    } satisfies ClinicalEventInput,
    201,
  );
  return rabies;
}

beforeEach(async () => {
  h = await createHarness();
  admin = new TestClient(h.app);
  await admin.login(ADMIN.email, ADMIN.password);
  const species = (await admin.get('/api/catalogs/species')).json<CatalogItem[]>();
  canina = species.find((s) => s.name === 'Canina')!;
  carla = await newClient('Carla Mendes');
  thor = await newPatient(carla, 'Thor');
});

afterEach(async () => {
  await h.close();
});

describe('configuração', () => {
  it('os sete gatilhos começam ligados; texto e antecedência são validados', async () => {
    const view = (await admin.get('/api/messages/settings')).json<MessagingSettings>();
    expect(view.delivery).toBe('manual');
    expect(view.settings.map((s) => [s.trigger, s.enabled])).toEqual([
      ['vaccine_reminder', true],
      ['appointment_reminder', true],
      ['exam_result', true],
      ['welcome_client', true],
      ['welcome_patient', true],
      ['patient_birthday', true],
      ['client_birthday', true],
    ]);
    expect(view.settings[0]).toMatchObject({
      offset: 3,
      template: defaultTemplates.vaccine_reminder,
    });

    const unknown = await setting({
      trigger: 'welcome_client',
      template: 'Oi {cliente}, e {vacina}?',
    });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json<ApiError>().error.details?.[0]?.message).toContain('{vacina}');
    const offset = await setting({ trigger: 'appointment_reminder', offset: 0 });
    expect(offset.statusCode).toBe(400);
    const meta = await setting({ trigger: 'welcome_client', providerTemplate: 'Boas Vindas' });
    expect(meta.statusCode).toBe(400);

    const before = view.settings.find((s) => s.trigger === 'welcome_client')!;
    expect((await setting({ trigger: 'welcome_client', enabled: false })).statusCode).toBe(200);
    const on = await setting({ trigger: 'welcome_client', enabled: true });
    const after = on
      .json<MessagingSettings>()
      .settings.find((s) => s.trigger === 'welcome_client')!;
    expect(Date.parse(after.activeSince)).toBeGreaterThan(Date.parse(before.activeSince));
  });

  it('recepção vê a fila mas não configura; veterinário não vê mensagens', async () => {
    const reception = await loginAs(h, admin, 'Recepcionista');
    expect((await reception.get('/api/messages')).statusCode).toBe(200);
    expect((await reception.get('/api/messages/settings')).statusCode).toBe(403);
    expect((await reception.send('POST', '/api/messages/run')).statusCode).toBe(403);
    const vet = await loginAs(h, admin, 'Veterinário');
    expect((await vet.get('/api/messages')).statusCode).toBe(403);
  });
});

describe('geração', () => {
  it('lembrete de vacina na antecedência, uma vez por dose, respeitando consentimento e celular', async () => {
    await run(); // liga os gatilhos: cadastros de antes não recebem boas-vindas
    const rabies = await applyVaccine(thor, shift(today, 2));
    const refused = await newClient('Rui Prado');
    await send('PUT', `/api/clients/${refused.id}/consents`, {
      source: 'Pediu para não receber',
      channels: [{ channel: 'whatsapp', granted: false }],
    });
    await applyVaccine(await newPatient(refused, 'Bob'), shift(today, 1));
    const landline = await newClient('Lia Souza', {
      contacts: [{ kind: 'phone', value: '(11) 3333-4444', isWhatsapp: false }],
    });
    await applyVaccine(await newPatient(landline, 'Nina'), shift(today, 1));
    const later = await newClient('Davi Lopes');
    await applyVaccine(await newPatient(later, 'Rex'), shift(today, 10));
    const closed = await newClient('Eva Lima');
    const luna = await newPatient(closed, 'Luna');
    await applyVaccine(luna, shift(today, 1));
    await send('POST', `/api/clinical/patients/${luna.id}/protocols/${rabies.id}/close`, {
      reason: 'Mudou de cidade',
    });

    await run();
    const vaccine = (await listOf('&tipo=vaccine_reminder')).items;
    expect(vaccine.map((m) => [m.patient?.name, m.status, m.skipReason]).sort()).toEqual([
      ['Bob', 'skipped', 'no_consent'],
      ['Nina', 'skipped', 'no_phone'],
      ['Thor', 'pending', null],
    ]);
    const message = vaccine.find((m) => m.patient?.name === 'Thor')!;
    expect(message.phone).toBe('11987654321');
    expect(message.body).toBe(
      `Olá, Carla! A próxima dose de Antirrábica de Thor vence em ${br(shift(today, 2))}. Responda esta mensagem para agendar a aplicação na Clínica Teste.`,
    );
    expect((await run()).created).toBe(0);
  });

  it('boas-vindas só para cadastros feitos com o gatilho ligado; animal junto do cliente não duplica', async () => {
    await run();
    const nova = await newClient('Joana Reis');
    await newPatient(nova, 'Pipoca');
    await age(carla, 3);
    await newPatient(carla, 'Mel');
    await run();
    const items = (await listOf()).items;
    expect(items.map((m) => [m.trigger, m.client.name, m.patient?.name ?? null]).sort()).toEqual([
      ['welcome_client', 'Joana Reis', null],
      ['welcome_patient', 'Carla Mendes', 'Mel'],
    ]);
    expect(items.find((m) => m.trigger === 'welcome_client')!.body).toContain('Olá, Joana!');
  });

  it('aniversários do dia, sem o de quem nasceu hoje; gatilho desligado não gera', async () => {
    const year = Number(today.slice(0, 4)) - 3;
    await newPatient(carla, 'Bolt', `${String(year)}${today.slice(4)}`);
    await newPatient(carla, 'Nasceu hoje', today);
    await newClient('Gil Alves', { birthDate: `1990${today.slice(4)}` });
    await setting({ trigger: 'client_birthday', enabled: false });
    await run();
    const items = (await listOf()).items.filter((m) => m.trigger.endsWith('birthday'));
    expect(items.map((m) => [m.trigger, m.patient?.name])).toEqual([['patient_birthday', 'Bolt']]);
    expect(items[0]!.body).toContain('Parabéns, Bolt!');
  });

  it('lembrete de agendamento com data, hora e profissional; sai da fila se o horário mudar', async () => {
    await run();
    const session = (await admin.get('/api/auth/session')).json<Session>();
    const [type] = await h.db.select().from(appointmentTypes).limit(1);
    const startsAt = new Date(Date.now() + 5 * 3_600_000);
    startsAt.setUTCMinutes(30, 0, 0);
    const id = newId();
    await h.db.insert(appointments).values({
      id,
      organizationId: h.org.organizationId,
      unitId: h.org.unitId,
      professionalId: session.user.id,
      clientId: carla.id,
      typeId: type!.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 1_800_000),
      status: 'scheduled',
    });
    await h.db
      .insert(appointmentPatients)
      .values({ appointmentId: id, patientId: thor.id, position: 0 });
    await run();
    const [reminder] = (await listOf('&tipo=appointment_reminder')).items;
    const local = new Intl.DateTimeFormat('pt-BR', {
      timeZone: TZ,
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(startsAt);
    expect(reminder?.body).toBe(
      `Olá, Carla! Lembrete: Thor tem horário na Clínica Teste em ${local.replace(', ', ' às ')} com Ana Admin. Para confirmar ou remarcar, responda esta mensagem.`,
    );
    await h.db.update(appointments).set({ status: 'cancelled' }).where(eq(appointments.id, id));
    await run();
    const [after] = (await listOf('&tipo=appointment_reminder')).items;
    expect(after).toMatchObject({
      status: 'cancelled',
      error: 'O agendamento mudou ou já passou.',
    });
  });

  it('resultado de exame finalizado avisa o responsável', async () => {
    await run();
    const [listed] = (await admin.get('/api/exams')).json<{ id: string }[]>();
    const exam = (await admin.get(`/api/exams/${listed!.id}`)).json<Exam>();
    const field = exam.attributes.find((a) => a.kind === 'field')!;
    await send(
      'POST',
      `/api/clinical/patients/${thor.id}/events`,
      {
        kind: 'exam',
        occurredAt: null,
        examId: exam.id,
        values: [{ attributeId: field.id, value: '7' }],
        notes: '',
        publish: true,
      } satisfies ClinicalEventInput,
      201,
    );
    await run();
    const [message] = (await listOf('&tipo=exam_result')).items;
    expect(message?.body).toContain(`O resultado do exame ${exam.name} de Thor já está pronto`);
  });
});

describe('envio', () => {
  it('pela fila: marcar como enviada registra quem enviou; não sai duas vezes', async () => {
    await run();
    await applyVaccine(thor, shift(today, 1));
    await run();
    const [pending] = (await admin.get('/api/messages')).json<MessageList>().items;
    expect(pending?.status).toBe('pending');
    expect((await admin.send('POST', `/api/messages/${pending!.id}/sent`)).statusCode).toBe(204);
    const again = await admin.send('POST', `/api/messages/${pending!.id}/sent`);
    expect(again.statusCode).toBe(409);
    const sent = (await admin.get('/api/messages?situacao=enviadas')).json<MessageList>();
    expect(sent.items[0]).toMatchObject({ channel: 'manual', sentBy: 'Ana Admin' });
    expect(sent.counts).toMatchObject({ pending: 0, sentToday: 1 });
  });

  it('pela API oficial: modelo da Meta com as variáveis em ordem, janela de horário e novas tentativas', async () => {
    const calls: { phone: string; template: string; params: string[] }[] = [];
    let fail = 0;
    const sender: MessageSender = {
      configured: true,
      send: async (input) => {
        calls.push(input);
        if (fail > 0) {
          fail--;
          throw new Error('WhatsApp recusou (500): instável');
        }
        return { id: `wamid.${String(calls.length)}` };
      },
    };
    let clock = todayAt(10);
    const service = new MessagingService(h.db, sender, () => clock);
    await service.run(h.org.organizationId);
    await applyVaccine(thor, shift(today, 1));
    expect(
      (await setting({ trigger: 'vaccine_reminder', providerTemplate: 'lembrete_vacina' }))
        .statusCode,
    ).toBe(200);

    clock = todayAt(21);
    expect(await service.run(h.org.organizationId)).toEqual({ created: 1, sent: 0 });

    clock = todayAt(10);
    fail = 1;
    expect((await service.run(h.org.organizationId)).sent).toBe(0);
    let [message] = (await listOf()).items;
    expect(message).toMatchObject({ status: 'pending', error: 'WhatsApp recusou (500): instável' });
    expect((await service.run(h.org.organizationId)).sent).toBe(1);
    expect(calls.at(-1)).toEqual({
      phone: '11987654321',
      template: 'lembrete_vacina',
      params: ['Carla', 'Antirrábica', 'Thor', br(shift(today, 1)), 'Clínica Teste'],
    });
    [message] = (await listOf()).items;
    expect(message).toMatchObject({ status: 'sent', channel: 'api', sentBy: null });

    // Três falhas seguidas: desiste e deixa a mensagem como falha, para envio manual.
    const davi = await newClient('Davi Lopes');
    await applyVaccine(await newPatient(davi, 'Rex'), shift(today, 2));
    fail = 3;
    for (let i = 0; i < 3; i++) await service.run(h.org.organizationId);
    const rex = (await listOf()).items.find((m) => m.patient?.name === 'Rex');
    expect(rex).toMatchObject({ status: 'failed' });
    expect(calls).toHaveLength(5);
  });
});
