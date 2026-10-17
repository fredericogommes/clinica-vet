import type {
  Appointment,
  AppointmentType,
  PortalBookingOptions,
  PortalSlots,
  Session,
  Client,
  PortalAccount,
  PortalHome,
  PortalInviteResult,
  PortalPatient,
  PortalSession,
  PortalSettings,
  Patient,
} from '@clinica/contracts';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDays, instantToZoned, weekdayOf } from '../../core/zoned-time.js';
import { clientInput, patientInput, VALID_CNPJ, VALID_CPF } from '../../test/fixtures.js';
import { ADMIN, createHarness, loginAs, TestClient, type Harness } from '../../test/harness.js';

/** Navegador do tutor: guarda o cookie do portal e o token CSRF da sessão do portal. */
class Tutor {
  cookie: string | undefined;
  csrf: string | undefined;
  constructor(private readonly app: FastifyInstance) {}

  private keep(res: LightMyRequestResponse) {
    const raw = res.headers['set-cookie'];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.split(';')[0];
    if (res.statusCode === 204 && value) this.cookie = value;
    return res;
  }
  async login(email: string, password: string) {
    const res = this.keep(
      await this.app.inject({
        method: 'POST',
        url: '/api/portal/login',
        payload: { email, password },
      }),
    );
    if (res.statusCode === 204) this.csrf = (await this.session()).csrfToken;
    return res;
  }
  async activate(link: string, password: string) {
    const token = link.split('/').at(-1);
    const res = this.keep(
      await this.app.inject({
        method: 'POST',
        url: `/api/portal/link/${token ?? ''}`,
        payload: { password, confirmation: password },
      }),
    );
    if (res.statusCode === 204) this.csrf = (await this.session()).csrfToken;
    return res;
  }
  get(url: string) {
    return this.app.inject({
      method: 'GET',
      url,
      headers: this.cookie ? { cookie: this.cookie } : {},
    });
  }
  post(url: string, csrf = true, payload?: object) {
    const headers: Record<string, string> = this.cookie ? { cookie: this.cookie } : {};
    if (csrf && this.csrf) headers['x-csrf-token'] = this.csrf;
    return this.app.inject({ method: 'POST', url, headers, ...(payload ? { payload } : {}) });
  }
  async session() {
    return (await this.get('/api/portal/session')).json<PortalSession>();
  }
}

let h: Harness;
let admin: TestClient;
let carla: Client;
let thor: Patient;
let bidu: Patient;

const SECTIONS_ON = {
  appointments: true,
  weight: true,
  vaccines: true,
  exams: true,
  prescriptions: true,
};

const BOOKING_OFF = { enabled: false, typeIds: [], leadHours: 2, windowDays: 30 };

async function configure(
  settings: Omit<PortalSettings, 'booking'> & { booking?: PortalSettings['booking'] },
) {
  const res = await admin.send('PUT', '/api/portal-admin/settings', {
    booking: BOOKING_OFF,
    ...settings,
  });
  expect(res.statusCode, res.body).toBe(200);
}

async function invite(clientId: string, email: string) {
  const res = await admin.send('POST', `/api/portal-admin/clients/${clientId}/link`, { email });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<PortalInviteResult>();
}

async function prescription(patientId: string, title: string, publish: boolean) {
  const res = await admin.send('POST', `/api/clinical/patients/${patientId}/events`, {
    kind: 'prescription',
    occurredAt: null,
    templateId: null,
    title,
    body: 'Amoxicilina 250 mg, 1 comprimido a cada 12 horas por 7 dias.',
    publish,
  });
  expect(res.statusCode, res.body).toBe(201);
}

beforeEach(async () => {
  h = await createHarness();
  admin = new TestClient(h.app);
  await admin.login(ADMIN.email, ADMIN.password);
  carla = (
    await admin.send(
      'POST',
      '/api/clients',
      clientInput({
        cpf: VALID_CPF,
        contacts: [
          { kind: 'mobile', value: '(11) 98765-4321', isWhatsapp: true },
          { kind: 'email', value: 'carla@exemplo.com', isWhatsapp: false },
        ],
      }),
    )
  ).json<Client>();
  const pet = async (clientId: string, name: string) =>
    (
      await admin.send('POST', '/api/patients', { clientId, patient: patientInput({ name }) })
    ).json<Patient>();
  thor = await pet(carla.id, 'Thor');
  const other = (
    await admin.send(
      'POST',
      '/api/clients',
      clientInput({ personType: 'company', name: 'Canil Vizinho', cnpj: VALID_CNPJ }),
    )
  ).json<Client>();
  bidu = await pet(other.id, 'Bidu');
});
afterEach(async () => {
  await h.close();
});

describe('convite e acesso do tutor [RN-44]', () => {
  it('convida pelo link, cria a senha e entra só com o portal ligado', async () => {
    const before = (await admin.get(`/api/portal-admin/clients/${carla.id}`)).json<PortalAccount>();
    expect(before).toMatchObject({
      status: 'none',
      suggestedEmail: 'carla@exemplo.com',
      whatsapp: '11987654321',
    });

    const { link, account } = await invite(carla.id, 'Carla@Exemplo.com');
    expect(link).toMatch(/^http:\/\/localhost:5173\/portal\/acesso\/[\w-]{43}$/);
    expect(account).toMatchObject({ status: 'invited', email: 'carla@exemplo.com' });

    const token = link.split('/').at(-1) ?? '';
    const info = await h.app.inject({ method: 'GET', url: `/api/portal/link/${token}` });
    expect(info.json()).toEqual({
      clinic: 'Clínica Teste',
      clientName: 'Carla Mendes',
      email: 'carla@exemplo.com',
      firstAccess: true,
    });

    const tutor = new Tutor(h.app);
    // Portal ainda desligado: o link não abre.
    expect((await tutor.activate(link, 'senha-do-tutor-1')).statusCode).toBe(403);
    await configure({ enabled: true, sections: SECTIONS_ON });
    expect((await tutor.activate(link, 'curta')).statusCode).toBe(400);
    expect((await tutor.activate(link, 'senha-do-tutor-1')).statusCode).toBe(204);
    expect(await tutor.session()).toMatchObject({
      clinic: 'Clínica Teste',
      client: { name: 'Carla Mendes', email: 'carla@exemplo.com' },
    });
    // O link vale uma vez.
    expect((await new Tutor(h.app).activate(link, 'outra-senha-22')).statusCode).toBe(404);

    const after = (await admin.get(`/api/portal-admin/clients/${carla.id}`)).json<PortalAccount>();
    expect(after.status).toBe('active');
    expect(after.lastLoginAt).not.toBeNull();
    expect(after.linkExpiresAt).toBeNull();

    // Desligar o portal derruba a sessão aberta.
    await configure({ enabled: false, sections: SECTIONS_ON });
    expect((await tutor.get('/api/portal/home')).statusCode).toBe(401);
  });

  it('recupera a senha por um novo link e bloqueia o acesso', async () => {
    await configure({ enabled: true, sections: SECTIONS_ON });
    const first = await invite(carla.id, 'carla@exemplo.com');
    const tutor = new Tutor(h.app);
    await tutor.activate(first.link, 'senha-do-tutor-1');

    const wrong = new Tutor(h.app);
    expect((await wrong.login('carla@exemplo.com', 'errada-123456')).statusCode).toBe(401);

    const reset = await invite(carla.id, 'carla@exemplo.com');
    const token = reset.link.split('/').at(-1) ?? '';
    expect(
      (await h.app.inject({ method: 'GET', url: `/api/portal/link/${token}` })).json(),
    ).toMatchObject({ firstAccess: false });
    // Até o tutor usar o link, a senha antiga continua valendo.
    expect((await new Tutor(h.app).login('carla@exemplo.com', 'senha-do-tutor-1')).statusCode).toBe(
      204,
    );
    const again = new Tutor(h.app);
    expect((await again.activate(reset.link, 'senha-nova-do-tutor')).statusCode).toBe(204);
    // A troca encerra as sessões antigas.
    expect((await tutor.get('/api/portal/home')).statusCode).toBe(401);
    expect((await new Tutor(h.app).login('carla@exemplo.com', 'senha-do-tutor-1')).statusCode).toBe(
      401,
    );

    const blocked = await admin.send('POST', `/api/portal-admin/clients/${carla.id}/block`);
    expect(blocked.json<PortalAccount>().status).toBe('blocked');
    expect((await again.get('/api/portal/home')).statusCode).toBe(401);
    expect(
      (await new Tutor(h.app).login('carla@exemplo.com', 'senha-nova-do-tutor')).statusCode,
    ).toBe(401);
    expect(
      (
        await admin.send('POST', `/api/portal-admin/clients/${carla.id}/link`, {
          email: 'carla@exemplo.com',
        })
      ).statusCode,
    ).toBe(409);
    await admin.send('POST', `/api/portal-admin/clients/${carla.id}/unblock`);
    expect(
      (await new Tutor(h.app).login('carla@exemplo.com', 'senha-nova-do-tutor')).statusCode,
    ).toBe(204);

    const list = (await admin.get('/api/portal-admin/accounts')).json<{
      items: { email: string; status: string }[];
    }>();
    expect(list.items).toEqual([
      expect.objectContaining({ email: 'carla@exemplo.com', status: 'active' }),
    ]);
  });

  it('um e-mail é login de um cliente só', async () => {
    await invite(carla.id, 'carla@exemplo.com');
    const other = (await admin.get('/api/clients?q=Canil')).json<{ items: { id: string }[] }>();
    const res = await admin.send(
      'POST',
      `/api/portal-admin/clients/${other.items[0]?.id ?? ''}/link`,
      { email: 'CARLA@exemplo.com' },
    );
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { details: [{ path: 'email' }] } });
  });
});

describe('o que o tutor vê', () => {
  let tutor: Tutor;
  beforeEach(async () => {
    await configure({ enabled: true, sections: SECTIONS_ON });
    tutor = new Tutor(h.app);
    await tutor.activate((await invite(carla.id, 'carla@exemplo.com')).link, 'senha-do-tutor-1');
  });

  it('só os próprios animais e só o que foi publicado', async () => {
    await prescription(thor.id, 'Receita publicada', true);
    await prescription(thor.id, 'Receita em rascunho', false);
    const weight = await admin.send('POST', `/api/clinical/patients/${thor.id}/events`, {
      kind: 'weight',
      occurredAt: null,
      weightKg: 12.4,
      notes: '',
    });
    expect(weight.statusCode, weight.body).toBe(201);

    const home = (await tutor.get('/api/portal/home')).json<PortalHome>();
    expect(home.patients.map((p) => p.name)).toEqual(['Thor']);
    expect(home.appointments).toEqual([]);

    const ficha = (await tutor.get(`/api/portal/patients/${thor.id}`)).json<PortalPatient>();
    expect(ficha.prescriptions?.map((p) => p.title)).toEqual(['Receita publicada']);
    expect(ficha.weights?.map((w) => w.weightKg)).toEqual([12.4]);
    expect(ficha.vaccines).toEqual([]);
    expect(ficha.exams).toEqual([]);

    // Animal de outro cliente responde como inexistente.
    expect((await tutor.get(`/api/portal/patients/${bidu.id}`)).statusCode).toBe(404);
  });

  it('seção desligada não sai da API', async () => {
    await prescription(thor.id, 'Receita publicada', true);
    await configure({
      enabled: true,
      sections: { ...SECTIONS_ON, prescriptions: false, appointments: false },
    });
    const ficha = (await tutor.get(`/api/portal/patients/${thor.id}`)).json<PortalPatient>();
    expect(ficha.prescriptions).toBeNull();
    expect(ficha.weights).toEqual([]);
    expect((await tutor.get('/api/portal/home')).json<PortalHome>().appointments).toBeNull();
    expect((await tutor.session()).sections).toMatchObject({
      prescriptions: false,
      weight: true,
    });
  });

  it('sessões da equipe e do tutor não se misturam', async () => {
    // A equipe não entra no portal com a sessão dela...
    expect((await admin.get('/api/portal/home')).statusCode).toBe(401);
    // ...e o tutor não abre nada da equipe.
    for (const url of [
      '/api/clients',
      '/api/auth/session',
      `/api/portal-admin/clients/${carla.id}`,
    ]) {
      expect((await tutor.get(url)).statusCode, url).toBe(401);
    }
    // O cookie do portal só vai para as rotas do portal.
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/portal/login',
      payload: { email: 'carla@exemplo.com', password: 'senha-do-tutor-1' },
    });
    expect(String(res.headers['set-cookie'])).toMatch(
      /Path=\/api\/portal;.*HttpOnly;.*SameSite=Strict/,
    );

    expect((await tutor.post('/api/portal/logout', false)).statusCode).toBe(403);
    expect((await tutor.post('/api/portal/logout')).statusCode).toBe(204);
    expect((await tutor.get('/api/portal/home')).statusCode).toBe(401);
  });

  it('recepção convida; veterinário não', async () => {
    const reception = await loginAs(h, admin, 'Recepcionista');
    expect((await reception.get(`/api/portal-admin/clients/${carla.id}`)).statusCode).toBe(200);
    expect((await reception.get('/api/portal-admin/settings')).statusCode).toBe(403);
    const vet = await loginAs(h, admin, 'Veterinário');
    expect((await vet.get(`/api/portal-admin/clients/${carla.id}`)).statusCode).toBe(403);
  });
});

describe('agendamento online [p.20–21]', () => {
  let tutor: Tutor;
  let consulta: AppointmentType;
  let banho: AppointmentType;
  let unitId: string;
  let monday: string;

  beforeEach(async () => {
    const session = (await admin.get('/api/auth/session')).json<Session>();
    unitId = session.currentUnit.id;
    const member = await admin.send('PUT', `/api/schedule/members/${session.user.id}`, {
      mode: 'fixed',
      fixedHours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '09:00', end: '12:00' })),
    });
    expect(member.statusCode, member.body).toBe(200);
    const types = (await admin.get('/api/catalogs/appointment-types')).json<AppointmentType[]>();
    consulta = types.find((t) => t.name === 'Consulta')!;
    banho = types.find((t) => t.id !== consulta.id)!;
    monday = addDays(instantToZoned(new Date(), 'America/Sao_Paulo').date, 7);
    while (weekdayOf(monday) !== 1) monday = addDays(monday, 1);
    await configure({ enabled: true, sections: SECTIONS_ON });
    tutor = new Tutor(h.app);
    await tutor.activate((await invite(carla.id, 'carla@exemplo.com')).link, 'senha-do-tutor-1');
  });

  const open = (overrides: Partial<PortalSettings['booking']> = {}) =>
    configure({
      enabled: true,
      sections: SECTIONS_ON,
      booking: {
        enabled: true,
        typeIds: [consulta.id],
        leadHours: 2,
        windowDays: 30,
        ...overrides,
      },
    });
  const slots = async (date = monday, typeId = consulta.id) =>
    (
      await tutor.get(`/api/portal/booking/slots?unitId=${unitId}&typeId=${typeId}&date=${date}`)
    ).json<PortalSlots>();
  const book = (start: string, overrides: Record<string, unknown> = {}) =>
    tutor.post('/api/portal/appointments', true, {
      unitId,
      typeId: consulta.id,
      patientIds: [thor.id],
      date: monday,
      start,
      professionalId: slotsCache[0]?.professionalId,
      notes: 'Primeira consulta do Thor',
      ...overrides,
    });
  let slotsCache: PortalSlots = [];

  it('só abre com a clínica ligando e exige um tipo liberado', async () => {
    expect((await tutor.get('/api/portal/booking')).statusCode).toBe(403);
    expect((await tutor.session()).booking).toBe(false);
    const res = await admin.send('PUT', '/api/portal-admin/settings', {
      enabled: true,
      sections: SECTIONS_ON,
      booking: { enabled: true, typeIds: [], leadHours: 2, windowDays: 30 },
    });
    expect(res.statusCode).toBe(400);
    await open();
    expect((await tutor.session()).booking).toBe(true);
    const options = (await tutor.get('/api/portal/booking')).json<PortalBookingOptions>();
    expect(options.types.map((t) => t.id)).toEqual([consulta.id]);
    expect(options.patients.map((p) => p.name)).toEqual(['Thor']);
    expect(options.units).toHaveLength(1);
  });

  it('marca um horário livre, aparece para a equipe e o tutor cancela', async () => {
    await open();
    slotsCache = await slots();
    // Consulta de 60 minutos na faixa 09:00–12:00, grade de 15 minutos.
    expect(slotsCache.map((s) => s.start)).toEqual([
      '09:00',
      '09:15',
      '09:30',
      '09:45',
      '10:00',
      '10:15',
      '10:30',
      '10:45',
      '11:00',
    ]);
    expect((await book('09:00')).statusCode).toBe(204);
    expect((await slots()).map((s) => s.start)).toEqual([
      '10:00',
      '10:15',
      '10:30',
      '10:45',
      '11:00',
    ]);
    // O mesmo horário de novo: ocupado.
    expect((await book('09:30')).statusCode).toBe(409);

    const home = (await tutor.get('/api/portal/home')).json<PortalHome>();
    const mine = home.appointments?.[0];
    expect(mine).toMatchObject({ bookedOnline: true, cancellable: true, patients: ['Thor'] });
    const staff = (await admin.get(`/api/appointments/${mine?.id ?? ''}`)).json<Appointment>();
    expect(staff).toMatchObject({
      bookedOnline: true,
      status: 'scheduled',
      start: '09:00',
      notes: 'Primeira consulta do Thor',
    });

    expect((await tutor.post(`/api/portal/appointments/${mine?.id ?? ''}/cancel`)).statusCode).toBe(
      204,
    );
    const after = (await admin.get(`/api/appointments/${mine?.id ?? ''}`)).json<Appointment>();
    expect(after).toMatchObject({
      status: 'cancelled',
      cancelReason: 'Cancelado pelo tutor no portal',
    });
    expect((await slots()).map((s) => s.start)).toContain('09:00');
  });

  it('respeita tipo liberado, alcance, antecedência e os próprios animais', async () => {
    await open({ windowDays: 3 });
    slotsCache = await slots(monday);
    expect(slotsCache).toEqual([]);
    expect((await book('09:00', { professionalId: carla.id })).statusCode).toBe(409);
    await open();
    slotsCache = await slots();
    expect(
      (
        await tutor.get(
          `/api/portal/booking/slots?unitId=${unitId}&typeId=${banho.id}&date=${monday}`,
        )
      ).statusCode,
    ).toBe(404);
    expect((await book('09:00', { typeId: banho.id })).statusCode).toBe(404);
    expect((await book('09:00', { patientIds: [bidu.id] })).statusCode).toBe(400);
    // Antecedência de uma semana: segunda que vem fica fora quando falta menos que isso.
    await open({ leadHours: 168 });
    const tooSoon = addDays(instantToZoned(new Date(), 'America/Sao_Paulo').date, 1);
    expect(await slots(tooSoon)).toEqual([]);
    // Agendamento marcado pela equipe não é cancelado pelo portal.
    const staff = await admin.send('POST', '/api/appointments', {
      clientId: carla.id,
      patientIds: [thor.id],
      typeId: consulta.id,
      durationMinutes: 60,
      date: addDays(monday, 1),
      start: '10:00',
      professionalId: slotsCache[0]?.professionalId,
      notes: '',
    });
    expect(staff.statusCode, staff.body).toBe(201);
    const [created] = staff.json<{ items: Appointment[] }>().items;
    const home = (await tutor.get('/api/portal/home')).json<PortalHome>();
    expect(home.appointments?.find((a) => a.id === created?.id)).toMatchObject({
      bookedOnline: false,
      cancellable: false,
    });
    expect(
      (await tutor.post(`/api/portal/appointments/${created?.id ?? ''}/cancel`)).statusCode,
    ).toBe(409);
  });
});
