import type {
  Agenda,
  ApiError,
  Appointment,
  AppointmentType,
  AuditEntry,
  Client,
  Patient,
  ScheduleConfig,
  Session,
  Shift,
  Slot,
} from '@clinica/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDays, instantToZoned, weekdayOf } from '../../core/zoned-time.js';
import { clientInput, patientInput } from '../../test/fixtures.js';
import { ADMIN, createHarness, loginAs, TestClient, type Harness } from '../../test/harness.js';

let h: Harness;
let admin: TestClient;
let adminId: string;
let client: Client;
let thor: Patient;
let mel: Patient;
let consulta: AppointmentType;

const TZ = 'America/Sao_Paulo';
const today = () => instantToZoned(new Date(), TZ).date;

/** Próxima data (a partir de 7 dias) que cai no dia da semana pedido. */
function upcoming(weekday: number, weeksAhead = 1): string {
  let d = addDays(today(), 7 * weeksAhead);
  while (weekdayOf(d) !== weekday) d = addDays(d, 1);
  return d;
}

const MON_TO_FRI = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '09:00', end: '17:00' }));

async function makeMember(
  userId: string,
  body: object = { mode: 'fixed', fixedHours: MON_TO_FRI },
) {
  const res = await admin.send('PUT', `/api/schedule/members/${userId}`, body);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<ScheduleConfig>();
}

function booking(overrides: Record<string, unknown> = {}) {
  return {
    clientId: client.id,
    patientIds: [thor.id],
    typeId: consulta.id,
    durationMinutes: 60,
    date: upcoming(1),
    start: '10:00',
    professionalId: adminId,
    notes: '',
    ...overrides,
  };
}

async function book(overrides: Record<string, unknown> = {}, as: TestClient = admin) {
  const res = await as.send('POST', '/api/appointments', booking(overrides));
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ items: Appointment[] }>().items;
}

const slotsOf = async (date: string, duration = 60, extra = '') =>
  (await admin.get(`/api/schedule/slots?date=${date}&durationMinutes=${duration}${extra}`)).json<
    Slot[]
  >();

beforeEach(async () => {
  h = await createHarness();
  admin = new TestClient(h.app);
  await admin.login(ADMIN.email, ADMIN.password);
  adminId = (await admin.get('/api/auth/session')).json<Session>().user.id;
  client = (await admin.send('POST', '/api/clients', clientInput())).json<Client>();
  const create = async (name: string) =>
    (
      await admin.send('POST', '/api/patients', {
        clientId: client.id,
        patient: patientInput({ name }),
      })
    ).json<Patient>();
  thor = await create('Thor');
  mel = await create('Mel');
  const types = (await admin.get('/api/catalogs/appointment-types')).json<AppointmentType[]>();
  consulta = types.find((t) => t.name === 'Consulta')!;
});
afterEach(async () => {
  await h.close();
});

describe('configuração da agenda', () => {
  it('vem com funcionamento Seg–Sáb e tipos de atendimento iniciais', async () => {
    const config = (await admin.get('/api/schedule/config')).json<ScheduleConfig>();
    expect(config.timeZone).toBe(TZ);
    expect(config.openingHours.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(config.openingHours[0]).toMatchObject({ start: '08:00', end: '18:00' });
    expect(config.members).toEqual([]);
    expect(config.candidates.map((c) => c.name)).toEqual([ADMIN.name]);
    expect(consulta.durationMinutes).toBe(60);
  });

  it('inclui profissional com horário fixo e valida a faixa', async () => {
    const config = await makeMember(adminId);
    expect(config.members[0]).toMatchObject({ userId: adminId, mode: 'fixed' });
    expect(config.members[0]?.fixedHours).toHaveLength(5);
    expect(config.candidates).toEqual([]);

    const bad = await admin.send('PUT', `/api/schedule/members/${adminId}`, {
      mode: 'fixed',
      fixedHours: [{ weekday: 1, start: '18:00', end: '09:00' }],
    });
    expect(bad.statusCode).toBe(400);
    const empty = await admin.send('PUT', `/api/schedule/members/${adminId}`, {
      mode: 'fixed',
      fixedHours: [],
    });
    expect(empty.statusCode).toBe(400);
  });

  it('só quem configura altera funcionamento, profissionais e escala', async () => {
    const recep = await loginAs(h, admin, 'Recepcionista');
    expect((await recep.get('/api/schedule/config')).statusCode).toBe(200);
    expect((await recep.send('PUT', '/api/schedule/opening-hours', { days: [] })).statusCode).toBe(
      403,
    );
    expect(
      (
        await recep.send('PUT', `/api/schedule/members/${adminId}`, {
          mode: 'variable',
          fixedHours: [],
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe('horários livres', () => {
  it('cruza escala, funcionamento e duração, a cada 15 minutos', async () => {
    await makeMember(adminId);
    const slots = await slotsOf(upcoming(1));
    expect(slots[0]).toMatchObject({ start: '09:00', professionalName: ADMIN.name });
    expect(slots.at(-1)?.start).toBe('16:00');
    expect(slots).toHaveLength(29);
    // Domingo: clínica fechada.
    expect(await slotsOf(upcoming(0))).toEqual([]);
    // Sábado: aberto, mas fora do horário fixo do profissional.
    expect(await slotsOf(upcoming(6))).toEqual([]);
  });

  it('o horário de funcionamento recorta a escala', async () => {
    await makeMember(adminId, {
      mode: 'fixed',
      fixedHours: [{ weekday: 1, start: '07:00', end: '21:00' }],
    });
    const slots = await slotsOf(upcoming(1));
    expect(slots[0]?.start).toBe('08:00');
    expect(slots.at(-1)?.start).toBe('17:00');
  });

  it('agendamento ocupa o horário e a duração escolhida', async () => {
    await makeMember(adminId);
    const [appt] = await book();
    expect(appt).toMatchObject({ start: '10:00', end: '11:00', status: 'scheduled', late: false });
    const starts = (await slotsOf(upcoming(1))).map((s) => s.start);
    expect(starts).toContain('09:00');
    expect(starts).not.toContain('09:15');
    expect(starts).not.toContain('10:45');
    expect(starts).toContain('11:00');
    // Ao remarcar, o próprio horário volta a aparecer.
    const own = await slotsOf(upcoming(1), 60, `&excludeAppointmentId=${appt?.id}`);
    expect(own.map((s) => s.start)).toContain('10:00');
  });

  it('turno de escala variável só abre horários depois de confirmado', async () => {
    await makeMember(adminId, { mode: 'variable', fixedHours: [] });
    const date = upcoming(2);
    const created = await admin.send('POST', '/api/schedule/shifts', {
      userId: adminId,
      date,
      start: '13:00',
      end: '17:00',
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json<Shift>().confirmed).toBe(false);
    expect(await slotsOf(date)).toEqual([]);

    const overlap = await admin.send('POST', '/api/schedule/shifts', {
      userId: adminId,
      date,
      start: '16:00',
      end: '19:00',
    });
    expect(overlap.statusCode).toBe(400);

    const confirm = await admin.send('POST', '/api/schedule/shifts/confirm', {
      month: date.slice(0, 7),
    });
    expect(confirm.json()).toEqual({ confirmed: 1 });
    const slots = await slotsOf(date);
    expect(slots[0]?.start).toBe('13:00');
    expect(slots.at(-1)?.start).toBe('16:00');
  });
});

describe('agendamento', () => {
  beforeEach(async () => {
    await makeMember(adminId);
  });

  it('aceita mais de um animal do mesmo cliente e rejeita animal de outro', async () => {
    const [appt] = await book({ patientIds: [thor.id, mel.id] });
    expect(appt?.patients.map((p) => p.name)).toEqual(['Thor', 'Mel']);
    expect(appt?.client.phone).toBe('11987654321');

    const other = (
      await admin.send('POST', '/api/clients', clientInput({ name: 'Outro', contacts: [] }))
    ).json<Client>();
    const res = await admin.send(
      'POST',
      '/api/appointments',
      booking({ clientId: other.id, start: '14:00' }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json<ApiError>().error.details?.[0]?.message).toBe(
      'O animal não pertence a este cliente',
    );
  });

  it('impede sobreposição e horário fora da escala', async () => {
    await book();
    const clash = await admin.send('POST', '/api/appointments', booking({ start: '10:30' }));
    expect(clash.statusCode).toBe(409);
    expect(clash.json<ApiError>().error.message).toContain('já tem atendimento');

    const outside = await admin.send('POST', '/api/appointments', booking({ start: '17:00' }));
    expect(outside.statusCode).toBe(409);
    expect(outside.json<ApiError>().error.message).toContain('fora da escala');
  });

  it('dois agendamentos simultâneos no mesmo horário: só um grava', async () => {
    const results = await Promise.all([
      admin.send('POST', '/api/appointments', booking({ start: '15:00' })),
      admin.send('POST', '/api/appointments', booking({ start: '15:30' })),
      admin.send('POST', '/api/appointments', booking({ start: '15:00', patientIds: [mel.id] })),
    ]);
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(2);
  });

  it('encaixe fora da escala exige permissão própria e continua sem sobreposição', async () => {
    const [fit] = await book({ start: '18:30', fitIn: true });
    expect(fit?.fitIn).toBe(true);

    const vet = await loginAs(h, admin, 'Veterinário');
    const denied = await vet.send(
      'POST',
      '/api/appointments',
      booking({ start: '19:30', fitIn: true }),
    );
    expect(denied.statusCode).toBe(403);

    const clash = await admin.send(
      'POST',
      '/api/appointments',
      booking({ start: '18:00', fitIn: true }),
    );
    expect(clash.statusCode).toBe(409);
  });

  it('marca como atrasado quando o horário passou sem chegada', async () => {
    const [late] = await book({ date: today(), start: '00:00', durationMinutes: 15, fitIn: true });
    expect(late?.late).toBe(true);
    const arrived = await admin.send('POST', `/api/appointments/${late?.id}/status`, {
      status: 'waiting',
    });
    expect(arrived.json<Appointment>().late).toBe(false);
  });

  it('recorrência grava a série inteira ou nada', async () => {
    const items = await book({ recurrence: { frequency: 'weekly', count: 4 } });
    expect(items).toHaveLength(4);
    expect(new Set(items.map((i) => i.seriesId)).size).toBe(1);
    expect(items.map((i) => i.date)).toEqual([
      upcoming(1),
      addDays(upcoming(1), 7),
      addDays(upcoming(1), 14),
      addDays(upcoming(1), 21),
    ]);

    // A 3ª ocorrência bate com um agendamento existente: nada é gravado.
    await book({ date: addDays(upcoming(1), 14), start: '14:00' });
    const res = await admin.send(
      'POST',
      '/api/appointments',
      booking({ start: '14:00', recurrence: { frequency: 'weekly', count: 4 } }),
    );
    expect(res.statusCode).toBe(409);
    const error = res.json<ApiError>().error;
    expect(error.message).toBe('1 de 4 ocorrências não podem ser agendadas. Nada foi gravado.');
    expect(error.details?.[0]?.path).toBe('occurrences.2');
    const agenda = (
      await admin.get(`/api/schedule/agenda?from=${upcoming(1)}&to=${addDays(upcoming(1), 21)}`)
    ).json<Agenda>();
    expect(agenda.appointments.filter((a) => a.start === '14:00')).toHaveLength(1);
  });

  it('remarca antes da chegada e bloqueia depois', async () => {
    const [appt] = await book();
    const moved = await admin.send('PUT', `/api/appointments/${appt?.id}`, {
      ...booking({ start: '11:00', durationMinutes: 30 }),
      clientId: undefined,
    });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json<Appointment>()).toMatchObject({ start: '11:00', end: '11:30' });

    await admin.send('POST', `/api/appointments/${appt?.id}/status`, { status: 'waiting' });
    const locked = await admin.send('PUT', `/api/appointments/${appt?.id}`, booking());
    expect(locked.statusCode).toBe(409);
  });
});

describe('ciclo de status', () => {
  beforeEach(async () => {
    await makeMember(adminId);
  });

  const move = (id: string, status: string, reason?: string) =>
    admin.send('POST', `/api/appointments/${id}/status`, { status, reason });

  it('registra os marcos e alimenta as médias de espera e de atendimento', async () => {
    const [appt] = await book();
    const id = appt?.id ?? '';
    expect(appt?.nextStatuses).toEqual(['confirmed', 'waiting', 'cancelled', 'no_show']);
    for (const status of ['confirmed', 'waiting', 'in_progress', 'ready']) {
      const res = await move(id, status);
      expect(res.statusCode, res.body).toBe(200);
    }
    const done = (await admin.get(`/api/appointments/${id}`)).json<Appointment>();
    expect(done.status).toBe('ready');
    expect(done.editable).toBe(false);
    expect(Object.values(done.milestones).filter(Boolean)).toHaveLength(4);

    const agenda = (
      await admin.get(`/api/schedule/agenda?from=${upcoming(1)}&to=${upcoming(1)}`)
    ).json<Agenda>();
    expect(agenda.metrics.averageWaitMinutes).toBe(0);
    expect(agenda.metrics.averageServiceMinutes).toBe(0);
  });

  it('rejeita transição inválida', async () => {
    const [appt] = await book();
    const res = await move(appt?.id ?? '', 'in_progress');
    expect(res.statusCode).toBe(409);
    expect(res.json<ApiError>().error.message).toBe(
      'Não é possível passar de "Agendado" para "Em atendimento".',
    );
  });

  it('cancelar libera o horário; reativar exige que ele continue livre', async () => {
    const [appt] = await book();
    const cancelled = await move(appt?.id ?? '', 'cancelled', 'Tutor viajou');
    expect(cancelled.json<Appointment>()).toMatchObject({
      status: 'cancelled',
      cancelReason: 'Tutor viajou',
    });
    expect((await slotsOf(upcoming(1))).map((s) => s.start)).toContain('10:00');

    await book({ start: '10:00', patientIds: [mel.id] });
    const reactivate = await move(appt?.id ?? '', 'scheduled');
    expect(reactivate.statusCode).toBe(409);
  });

  it('audita criação e mudança de status', async () => {
    const [appt] = await book();
    await move(appt?.id ?? '', 'confirmed');
    const audit = (
      await admin.get(`/api/admin/audit?entity=appointment&entityId=${appt?.id}`)
    ).json<{ items: AuditEntry[] }>();
    expect(audit.items.map((e) => e.action).sort()).toEqual(['create', 'status']);
  });
});

describe('agenda do período', () => {
  it('traz profissionais, faixas abertas, funcionamento e agendamentos', async () => {
    await makeMember(adminId);
    await book();
    const date = upcoming(1);
    const agenda = (
      await admin.get(`/api/schedule/agenda?from=${date}&to=${addDays(date, 6)}`)
    ).json<Agenda>();
    expect(agenda.professionals).toEqual([{ id: adminId, name: ADMIN.name }]);
    expect(agenda.availability.find((a) => a.date === date)?.ranges).toEqual([
      { start: '09:00', end: '17:00' },
    ]);
    expect(agenda.openingHours.find((o) => weekdayOf(o.date) === 0)?.range).toBeNull();
    expect(agenda.appointments).toHaveLength(1);
    expect(agenda.today).toBe(today());

    const tooLong = await admin.get(`/api/schedule/agenda?from=${date}&to=${addDays(date, 60)}`);
    expect(tooLong.statusCode).toBe(400);
  });

  it('esteticista vê a agenda, mas não encaixa', async () => {
    await makeMember(adminId);
    const est = await loginAs(h, admin, 'Esteticista');
    const date = upcoming(1);
    expect((await est.get(`/api/schedule/agenda?from=${date}&to=${date}`)).statusCode).toBe(200);
    const res = await est.send('POST', '/api/appointments', booking({ fitIn: true }));
    expect(res.statusCode).toBe(403);
  });
});

describe('tipos de atendimento', () => {
  it('cadastra com duração padrão e rejeita nome repetido', async () => {
    const res = await admin.send('POST', '/api/catalogs/appointment-types', {
      name: 'Ultrassonografia',
      durationMinutes: 45,
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json<AppointmentType>()).toMatchObject({ durationMinutes: 45, archived: false });
    const dup = await admin.send('POST', '/api/catalogs/appointment-types', {
      name: 'consulta',
      durationMinutes: 30,
    });
    expect(dup.statusCode).toBe(409);
    const odd = await admin.send('POST', '/api/catalogs/appointment-types', {
      name: 'Esquisito',
      durationMinutes: 50,
    });
    expect(odd.statusCode).toBe(400);
  });

  it('tipo arquivado não aceita novos agendamentos', async () => {
    await makeMember(adminId);
    await admin.send('PUT', `/api/catalogs/appointment-types/${consulta.id}`, {
      name: 'Consulta',
      durationMinutes: 60,
      archived: true,
    });
    const res = await admin.send('POST', '/api/appointments', booking());
    expect(res.statusCode).toBe(400);
  });
});
