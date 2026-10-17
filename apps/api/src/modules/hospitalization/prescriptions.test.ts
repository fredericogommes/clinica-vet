import type {
  ApiError,
  CatalogItem,
  Client,
  ExecutionMap,
  HospitalizationDetail,
  Patient,
  PrescriptionDay,
  PrescriptionTemplate,
  Session,
} from '@clinica/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clientInput, patientInput } from '../../test/fixtures.js';
import { ADMIN, createHarness, loginAs, TestClient, type Harness } from '../../test/harness.js';

let h: Harness;
let admin: TestClient;
let hospitalizationId: string;

const fieldError = (body: string) => (JSON.parse(body) as ApiError).error.details?.[0];
const base = () => `/api/hospitalizations/${hospitalizationId}`;
const localDate = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(at);

async function day(at: Date, as = admin) {
  const probe = (await as.get(`${base()}/prescriptions?date=2026-01-01`)).json<PrescriptionDay>();
  const res = await as.get(`${base()}/prescriptions?date=${localDate(at, probe.timeZone)}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<PrescriptionDay>();
}

const prescribe = (o: Record<string, unknown> = {}, as = admin) =>
  as.send('POST', `${base()}/prescriptions`, {
    name: 'Dipirona',
    dose: 25,
    doseUnit: 'mg/kg',
    concentration: 500,
    route: 'IV',
    intervalHours: 8,
    firstAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    durationDays: 3,
    notes: '',
    ...o,
  });

beforeEach(async () => {
  h = await createHarness();
  admin = new TestClient(h.app);
  await admin.login(ADMIN.email, ADMIN.password);
  const adminId = (await admin.get('/api/auth/session')).json<Session>().user.id;
  const canina = (await admin.get('/api/catalogs/species'))
    .json<CatalogItem[]>()
    .find((s) => s.name === 'Canina')!;
  const client = (
    await admin.send('POST', '/api/clients', clientInput({ name: 'Carla Mendes' }))
  ).json<Client>();
  const thor = (
    await admin.send('POST', '/api/patients', {
      clientId: client.id,
      patient: patientInput({ name: 'Thor', speciesId: canina.id }),
    })
  ).json<Patient>();
  const res = await admin.send('POST', '/api/hospitalizations', {
    patientId: thor.id,
    veterinarianId: adminId,
    priority: 'urgent',
    reason: 'Gastroenterite',
    expectedDischargeOn: null,
    boxId: null,
  });
  expect(res.statusCode, res.body).toBe(201);
  hospitalizationId = res.json<HospitalizationDetail>().id;
});
afterEach(async () => {
  await h.close();
});

describe('prescrição da internação [p.15, RN-42]', () => {
  it('aprazamento, execução com dose pelo peso, mapa e suspensão', async () => {
    let r = await admin.send('POST', `${base()}/entries`, { kind: 'weight', weightKg: 12.4 });
    expect(r.statusCode, r.body).toBe(200);
    const firstAt = new Date(Date.now() - 30 * 60_000);
    r = await prescribe({ firstAt: firstAt.toISOString() });
    expect(r.statusCode, r.body).toBe(201);
    const { id } = r.json<{ id: string }>();

    let today = await day(firstAt);
    expect(today.weightKg).toBe(12.4);
    const p = today.prescriptions[0]!;
    expect(p).toMatchObject({ name: 'Dipirona', intervalHours: 8, prescribedBy: ADMIN.name });
    expect(p.doses[0]).toEqual({ scheduledAt: firstAt.toISOString(), execution: null });

    // Horário fora da prescrição, execução no futuro e "não executado" sem motivo são recusados.
    const exec = (o: Record<string, unknown>) =>
      admin.send('POST', `${base()}/prescriptions/${id}/executions`, {
        scheduledAt: firstAt.toISOString(),
        executedAt: new Date().toISOString(),
        status: 'done',
        notes: '',
        ...o,
      });
    r = await exec({ scheduledAt: new Date(firstAt.getTime() + 3_600_000).toISOString() });
    expect(fieldError(r.body)?.message).toBe('Este horário não está na prescrição');
    r = await exec({ executedAt: new Date(Date.now() + 3_600_000).toISOString() });
    expect(fieldError(r.body)?.path).toBe('executedAt');
    r = await exec({ status: 'skipped' });
    expect(r.statusCode).toBe(400);
    r = await exec({ scheduledAt: new Date(firstAt.getTime() + 16 * 3_600_000).toISOString() });
    expect(fieldError(r.body)?.message).toBe('Este horário ainda não chegou');

    // Executa: o servidor calcula 25 mg/kg × 12,4 kg = 310 mg, ÷ 500 mg/mL = 0,62 mL.
    r = await exec({ notes: 'Sem intercorrências' });
    expect(r.statusCode, r.body).toBe(201);
    r = await exec({});
    expect(r.statusCode).toBe(409);
    today = await day(firstAt);
    expect(today.prescriptions[0]?.doses[0]?.execution).toMatchObject({
      status: 'done',
      by: ADMIN.name,
      weightKg: 12.4,
      amount: 310,
      volumeMl: 0.62,
      notes: 'Sem intercorrências',
    });

    const map = (
      await admin.get(
        `/api/hospitalizations/execution-map?date=${localDate(firstAt, today.timeZone)}`,
      )
    ).json<ExecutionMap>();
    const row = map.rows.find((x) => x.hospitalizationId === hospitalizationId);
    expect(row?.patient).toBe('Thor');
    expect(row?.priority).toBe('urgent');
    expect(row?.cells).toHaveLength(24);
    expect(row?.cells.reduce((n, c) => n + c.done, 0)).toBe(1);

    // Suspensa, não gera mais horários depois de agora.
    r = await admin.send('POST', `${base()}/prescriptions/${id}/stop`, { reason: 'Febre cedeu' });
    expect(r.statusCode, r.body).toBe(200);
    r = await admin.send('POST', `${base()}/prescriptions/${id}/stop`, { reason: 'De novo' });
    expect(r.statusCode).toBe(409);
    today = await day(firstAt);
    const stopped = today.prescriptions[0]!;
    expect(stopped.stopped).toMatchObject({ reason: 'Febre cedeu', by: ADMIN.name });
    expect(stopped.doses).toHaveLength(1);

    const detail = (await admin.get(base())).json<HospitalizationDetail>();
    const kinds = detail.entries.map((e) => e.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(['prescription', 'execution', 'prescription_stop']),
    );
    const execution = detail.entries.find((e) => e.kind === 'execution');
    expect(execution?.text).toContain('Executado: Dipirona 310 mg (0,62 mL) IV');
    expect(execution?.text).toContain('Programado para');

    // Encerrada a internação, nada mais muda.
    await admin.send('POST', `${base()}/close`, { outcome: 'discharged', notes: 'Alta' });
    r = await prescribe();
    expect(r.statusCode).toBe(409);
  });

  it('dose por kg sem peso fica sem cálculo; primeiro horário antes da internação é recusado', async () => {
    let r = await prescribe({ firstAt: new Date(Date.now() - 5 * 3_600_000).toISOString() });
    expect(fieldError(r.body)?.path).toBe('firstAt');
    const firstAt = new Date(Date.now() - 10 * 60_000);
    r = await prescribe({ firstAt: firstAt.toISOString(), doseUnit: 'mL', concentration: 5 });
    expect(fieldError(r.body)?.path).toBe('concentration');
    r = await prescribe({ firstAt: firstAt.toISOString() });
    const { id } = r.json<{ id: string }>();
    r = await admin.send('POST', `${base()}/prescriptions/${id}/executions`, {
      scheduledAt: firstAt.toISOString(),
      executedAt: new Date().toISOString(),
      status: 'done',
      notes: '',
    });
    expect(r.statusCode, r.body).toBe(201);
    const exec = (await day(firstAt)).prescriptions[0]?.doses[0]?.execution;
    expect(exec).toMatchObject({ weightKg: null, amount: null, volumeMl: null });
  });

  it('veterinário prescreve; recepcionista só consulta', async () => {
    const vet = await loginAs(h, admin, 'Veterinário');
    const firstAt = new Date(Date.now() - 30 * 60_000);
    let r = await prescribe({ firstAt: firstAt.toISOString() }, vet);
    expect(r.statusCode, r.body).toBe(201);
    const desk = await loginAs(h, admin, 'Recepcionista');
    r = await prescribe({}, desk);
    expect(r.statusCode).toBe(403);
    const { id } = (await day(firstAt, desk)).prescriptions[0]!;
    r = await desk.send('POST', `${base()}/prescriptions/${id}/executions`, {
      scheduledAt: firstAt.toISOString(),
      executedAt: new Date().toISOString(),
      status: 'done',
      notes: '',
    });
    expect(r.statusCode).toBe(403);
    expect((await desk.get('/api/hospitalizations/execution-map?date=2026-10-17')).statusCode).toBe(
      200,
    );
  });

  it('modelo de prescrição: salvar, aplicar de uma vez, substituir e excluir', async () => {
    const item = {
      name: 'Ceftriaxona',
      dose: 30,
      doseUnit: 'mg/kg',
      concentration: 100,
      route: 'IV',
      intervalHours: 12,
      durationDays: 5,
      notes: '',
    };
    let r = await admin.send('POST', '/api/hospitalizations/prescription-templates', {
      name: 'Gastroenterite',
      items: [],
    });
    expect(fieldError(r.body)?.path).toBe('items');
    r = await admin.send('POST', '/api/hospitalizations/prescription-templates', {
      name: 'Gastroenterite',
      items: [item, { ...item, name: 'Omeprazol', dose: 1, concentration: 4, intervalHours: 24 }],
    });
    expect(r.statusCode, r.body).toBe(200);
    const template = r.json<PrescriptionTemplate>();
    expect(template).toMatchObject({ name: 'Gastroenterite', createdBy: ADMIN.name });
    expect(template.items).toHaveLength(2);

    // Mesmo nome (sem diferenciar maiúsculas) substitui as prescrições do modelo.
    r = await admin.send('POST', '/api/hospitalizations/prescription-templates', {
      name: 'gastroenterite',
      items: [
        item,
        { ...item, name: 'Omeprazol', dose: 1, concentration: 4, intervalHours: 24 },
        { ...item, name: 'Dipirona', dose: 25, concentration: 500, intervalHours: 8 },
      ],
    });
    expect(r.json<PrescriptionTemplate>().id).toBe(template.id);
    const list = (await admin.get('/api/hospitalizations/prescription-templates')).json<
      PrescriptionTemplate[]
    >();
    expect(list).toHaveLength(1);
    expect(list[0]?.items.map((i) => i.name)).toEqual(['Ceftriaxona', 'Omeprazol', 'Dipirona']);

    const firstAt = new Date(Date.now() - 20 * 60_000);
    r = await admin.send('POST', `${base()}/prescriptions/template`, {
      templateId: template.id,
      firstAt: firstAt.toISOString(),
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json<{ ids: string[] }>().ids).toHaveLength(3);
    const today = await day(firstAt);
    expect(today.prescriptions.map((p) => p.name)).toEqual([
      'Ceftriaxona',
      'Omeprazol',
      'Dipirona',
    ]);
    expect(today.prescriptions.every((p) => p.firstAt === firstAt.toISOString())).toBe(true);
    const detail = (await admin.get(base())).json<HospitalizationDetail>();
    expect(detail.entries.filter((e) => e.text.includes('Do modelo Gastroenterite'))).toHaveLength(
      3,
    );

    // Recepção vê os modelos mas não aplica nem exclui.
    const desk = await loginAs(h, admin, 'Recepcionista');
    expect((await desk.get('/api/hospitalizations/prescription-templates')).statusCode).toBe(200);
    r = await desk.send('DELETE', `/api/hospitalizations/prescription-templates/${template.id}`);
    expect(r.statusCode).toBe(403);
    r = await admin.send('DELETE', `/api/hospitalizations/prescription-templates/${template.id}`);
    expect(r.statusCode).toBe(204);
    r = await admin.send('POST', `${base()}/prescriptions/template`, {
      templateId: template.id,
      firstAt: firstAt.toISOString(),
    });
    expect(fieldError(r.body)?.path).toBe('templateId');
  });

  it('mensagem ao tutor fica no histórico da internação', async () => {
    let r = await admin.send('POST', `${base()}/entries`, { kind: 'message', text: '' });
    expect(fieldError(r.body)?.message).toBe('Escreva a mensagem');
    r = await admin.send('POST', `${base()}/entries`, {
      kind: 'message',
      text: 'Thor comeu bem hoje e está mais ativo.',
    });
    expect(r.statusCode, r.body).toBe(200);
    const last = r.json<HospitalizationDetail>().entries.at(-1);
    expect(last).toMatchObject({ kind: 'message', text: 'Thor comeu bem hoje e está mais ativo.' });
  });
});
